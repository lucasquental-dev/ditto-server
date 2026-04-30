const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const MAPS_KEY = process.env.MAPS_KEY;
const APIFY_KEY = process.env.APIFY_KEY;
const GEMINI_KEY = process.env.GEMINI_KEY;

app.get('/maps/textsearch', async (req, res) => {
  try {
    const params = new URLSearchParams({...req.query, key: MAPS_KEY});
    const response = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
    res.json(await response.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/maps/details', async (req, res) => {
  try {
    const params = new URLSearchParams({...req.query, key: MAPS_KEY});
    const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
    res.json(await response.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/maps/findplace', async (req, res) => {
  try {
    const params = new URLSearchParams({...req.query, key: MAPS_KEY});
    const response = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params}`);
    res.json(await response.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/fetch-html', async (req, res) => {
  try {
    const response = await fetch(req.query.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000
    });
    res.json({ contents: await response.text() });
  } catch(e) { res.json({ contents: '' }); }
});

app.get('/buscar-instagram', async (req, res) => {
  try {
    const { site } = req.query;
    if (!site) return res.json({ instagram: null });
    try {
      const htmlRes = await fetch(site, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000
      });
      const html = await htmlRes.text();
      const match = html.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
      if (match && !['p','reel','explore','accounts','sharer','share','stories'].includes(match[1])) {
        return res.json({ instagram: '@' + match[1] });
      }
    } catch(e) {}
    const domain = site.replace(/https?:\/\//i, '').replace(/www\./i, '').split('/')[0].split('.')[0];
    if (domain && domain.length > 3) {
      try {
        const runRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${APIFY_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: [domain] })
        });
        const runData = await runRes.json();
        const runId = runData.data?.id;
        if (runId) {
          let status = 'RUNNING';
          let tentativas = 0;
          while (status === 'RUNNING' && tentativas < 15) {
            await new Promise(r => setTimeout(r, 2000));
            const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`);
            const statusData = await statusRes.json();
            status = statusData.data?.status || 'FAILED';
            tentativas++;
          }
          if (status === 'SUCCEEDED') {
            const resultRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}`);
            const items = await resultRes.json();
            if (items && items.length > 0 && items[0].username) {
              return res.json({ instagram: '@' + items[0].username });
            }
          }
        }
      } catch(e) {}
    }
    return res.json({ instagram: null });
  } catch(e) { res.json({ instagram: null }); }
});

app.get('/analisar-instagram', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.json({ erro: 'Username não informado' });

    const handle = username.replace('@', '');

    const runRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${handle}/`],
        resultsType: 'posts',
        resultsLimit: 12,
        addParentData: true
      })
    });

    const runData = await runRes.json();
    const runId = runData.data?.id;
    if (!runId) return res.json({ erro: 'Erro ao iniciar scraping' });

    let status = 'RUNNING';
    let tentativas = 0;
    while (status === 'RUNNING' && tentativas < 20) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`);
      const statusData = await statusRes.json();
      status = statusData.data?.status || 'FAILED';
      tentativas++;
    }

    if (status !== 'SUCCEEDED') return res.json({ erro: 'Scraping falhou' });

    const resultRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}`);
    const posts = await resultRes.json();

    if (!posts || posts.length === 0) return res.json({ erro: 'Nenhum dado encontrado' });

    const primeiro = posts[0];
    const perfil = {
      username: primeiro.ownerUsername || handle,
      nome: primeiro.ownerFullName || primeiro.fullName || '',
      bio: primeiro.biography || primeiro.metaData?.biography || '',
      seguidores: primeiro.followersCount || primeiro.metaData?.followersCount || 0,
      totalPosts: primeiro.metaData?.postsCount || posts.length,
      isBusinessAccount: primeiro.metaData?.isBusinessAccount || false
    };

    const postsComData = posts.filter(p => p.timestamp);
    let frequenciaTexto = 'Não foi possível calcular';
    let diasDesdeUltimoPost = null;

    if (postsComData.length > 0) {
      const datas = postsComData.map(p => new Date(p.timestamp)).sort((a, b) => b - a);
      const ultimoPost = datas[0];
      const hoje = new Date();
      diasDesdeUltimoPost = Math.floor((hoje - ultimoPost) / (1000 * 60 * 60 * 24));

      if (diasDesdeUltimoPost > 365) {
        frequenciaTexto = `Perfil inativo — último post há mais de ${Math.floor(diasDesdeUltimoPost/365)} ano(s)`;
      } else if (diasDesdeUltimoPost > 60) {
        frequenciaTexto = `Postagem muito irregular — último post há ${diasDesdeUltimoPost} dias`;
      } else if (postsComData.length >= 2) {
        const maisAntigo = datas[datas.length - 1];
        const periodoEmDias = Math.floor((datas[0] - maisAntigo) / (1000 * 60 * 60 * 24));
        const postsPorSemana = periodoEmDias > 0 ? (postsComData.length / periodoEmDias * 7).toFixed(1) : 0;
        frequenciaTexto = `Aproximadamente ${postsPorSemana} posts por semana`;
      }
    }

    const resumoPosts = posts.slice(0, 8).map(p => ({
      legenda: (p.caption || '').substring(0, 200),
      likes: p.likesCount || 0,
      data: p.timestamp ? new Date(p.timestamp).toLocaleDateString('pt-BR') : 'desconhecida',
      tipo: p.type || 'post'
    }));

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: { temperature: 0 },
        contents: [{
          parts: [{
            text: `Você é um especialista em marketing digital e redes sociais brasileiras. Analise o perfil do Instagram abaixo com rigor e retorne APENAS um JSON válido sem markdown.

Dados do perfil @${handle}:
- Nome: ${perfil.nome}
- Bio: ${perfil.bio || 'Não preenchida'}
- Seguidores: ${perfil.seguidores}
- Total de posts: ${perfil.totalPosts}
- Conta business: ${perfil.isBusinessAccount ? 'Sim' : 'Não'}
- Frequência calculada: ${frequenciaTexto}
- Dias desde último post: ${diasDesdeUltimoPost !== null ? diasDesdeUltimoPost + ' dias' : 'desconhecido'}

Últimos posts:
${JSON.stringify(resumoPosts, null, 2)}

REGRAS DE PONTUAÇÃO OBRIGATÓRIAS:
- Nota 1-2: Perfil abandonado (último post > 1 ano) ou sem conteúdo
- Nota 3-4: Perfil muito fraco — irregular, bio vazia, conteúdo sem valor ou genérico
- Nota 5: Perfil mediano — posts esporádicos, bio básica, sem estratégia clara
- Nota 6: Perfil razoável — frequência ok mas conteúdo sem diferencial
- Nota 7-8: Perfil bom — frequência regular, conteúdo relevante, bio completa
- Nota 9-10: Perfil excelente — estratégia clara, alto engajamento, referência no segmento (MUITO raro)

REGRA CRÍTICA: Se o último post foi há mais de 60 dias, nota máxima é 4. Se foi há mais de 6 meses, nota máxima é 3. Se foi há mais de 1 ano, nota máxima é 2.

IMPORTANTE: Use os dados reais acima. Não invente dados positivos se os dados mostram problemas.

Retorne APENAS este JSON:
{
  "nota": número de 1 a 10,
  "seguidores": número,
  "frequencia": "descrição honesta e precisa da frequência baseada nos dados reais",
  "analise_bio": "análise da bio",
  "analise_conteudo": "análise da qualidade das legendas e conteúdo",
  "pontos_positivos": ["ponto 1", "ponto 2"],
  "pontos_negativos": ["ponto 1", "ponto 2"],
  "resumo": "frase curta e honesta sobre o perfil"
}`
          }]
        }]
      })
    });

    const geminiData = await geminiRes.json();
    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find(p => p.text && !p.thought);
    const text = textPart?.text || '';

    if (!text) return res.json({ erro: 'Gemini não retornou análise', dados: geminiData });

    const resultado = JSON.parse(text.replace(/```json|```/g, '').trim());
    resultado.seguidores = perfil.seguidores;
    resultado.frequencia_calculada = frequenciaTexto;
    resultado.dias_desde_ultimo_post = diasDesdeUltimoPost;
    res.json(resultado);

  } catch(e) {
    res.json({ erro: e.message });
  }
});

app.get('/screenshot', async (req, res) => {
  try {
    const { site } = req.query;
    if (!site) return res.json({ url: null });

    const runRes = await fetch(`https://api.apify.com/v2/acts/apify~screenshot-url/runs?token=${APIFY_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [{ url: site }], waitUntil: 'load', delay: 500 })
    });
    const runData = await runRes.json();
    const runId = runData.data?.id;
    const kvStoreId = runData.data?.defaultKeyValueStoreId;
    if (!runId) return res.json({ url: null });

    let status = 'RUNNING';
    let tentativas = 0;
    while (status === 'RUNNING' && tentativas < 20) {
      await new Promise(r => setTimeout(r, 2000));
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`);
      const statusData = await statusRes.json();
      status = statusData.data?.status || 'FAILED';
      tentativas++;
    }
    if (status !== 'SUCCEEDED') return res.json({ url: null });

    const keysRes = await fetch(`https://api.apify.com/v2/key-value-stores/${kvStoreId}/keys?token=${APIFY_KEY}`);
    const keysData = await keysRes.json();
    const keys = keysData.data?.items || [];
    const imgKey = keys.find(k => k.key.startsWith('screenshot_'));
    if (!imgKey) return res.json({ url: null });

    res.json({ url: `https://api.apify.com/v2/key-value-stores/${kvStoreId}/records/${encodeURIComponent(imgKey.key)}?token=${APIFY_KEY}` });
  } catch(e) { res.json({ url: null }); }
});

app.get('/debug-gemini', async (req, res) => {
  try {
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Responda apenas: {"ok": true}' }] }]
      })
    });
    const data = await geminiRes.json();
    res.json(data);
  } catch(e) { res.json({ erro: e.message }); }
});

app.get('/analisar-layout', async (req, res) => {
  try {
    const { site } = req.query;
    if (!site) return res.json({ erro: 'Site não informado' });

    const runRes = await fetch(`https://api.apify.com/v2/acts/apify~screenshot-url/runs?token=${APIFY_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [{ url: site }], waitUntil: 'load', delay: 1000 })
    });
    const runData = await runRes.json();
    const runId = runData.data?.id;
    const kvStoreId = runData.data?.defaultKeyValueStoreId;
    if (!runId) return res.json({ erro: 'Erro ao iniciar screenshot' });

    let status = 'RUNNING';
    let tentativas = 0;
    while (status === 'RUNNING' && tentativas < 40) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`);
      const statusData = await statusRes.json();
      status = statusData.data?.status || 'FAILED';
      tentativas++;
    }
    if (status !== 'SUCCEEDED') return res.json({ erro: 'Screenshot falhou', status });

    const keysRes = await fetch(`https://api.apify.com/v2/key-value-stores/${kvStoreId}/keys?token=${APIFY_KEY}`);
    const keysData = await keysRes.json();
    const keys = keysData.data?.items || [];
    const imgKey = keys.find(k => k.key.startsWith('screenshot_'));
    if (!imgKey) return res.json({ erro: 'Screenshot não encontrado' });

    const screenshotRes = await fetch(`https://api.apify.com/v2/key-value-stores/${kvStoreId}/records/${encodeURIComponent(imgKey.key)}?token=${APIFY_KEY}`);
    const screenshotBuffer = await screenshotRes.buffer();
    const screenshotBase64 = screenshotBuffer.toString('base64');

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: { temperature: 0 },
        contents: [{
          parts: [
            { inline_data: { mime_type: 'image/png', data: screenshotBase64 } },
            {
              text: `Você é um avaliador RIGOROSO de presença digital para uma agência de marketing brasileira. Sua função é identificar empresas que precisam melhorar seu site — então a nota precisa refletir a REALIDADE com precisão.

REGRAS DE PONTUAÇÃO OBRIGATÓRIAS:
- Nota 1-2: Site quebrado, sem conteúdo, inacessível ou completamente amador
- Nota 3-4: Site muito ruim — desatualizado, identidade visual inexistente ou fragmentada, imagens genéricas, layout confuso, passa desconfiança
- Nota 5: Site mediano — funcional mas sem nenhum diferencial, visual genérico, "mais um entre muitos"
- Nota 6: Site razoável — tem alguns elementos bons mas com problemas claros que afastam clientes
- Nota 7-8: Site bom — moderno, organizado, transmite credibilidade, poucas melhorias necessárias
- Nota 9-10: Site excelente — referência no segmento, design profissional impecável (MUITO raro)

REGRA CRÍTICA DE COERÊNCIA: A nota DEVE ser coerente com os problemas descritos. Se você identificar:
- Imagens genéricas de banco → desconta pelo menos 1.5 pontos
- Identidade visual fragmentada ou inconsistente → desconta pelo menos 1.5 pontos
- Layout datado → desconta pelo menos 1 ponto
- Banner/pop-up cobrindo conteúdo → desconta 0.5 ponto
- "Na média do mercado" → nota máxima é 5
- Múltiplos problemas sérios → nota máxima é 4

NÃO seja generoso. A maioria dos sites de pequenas e médias empresas brasileiras merece entre 3 e 5. Notas 6 ou acima são para sites realmente bons.

Analise a imagem focando em:
- Primeira impressão em 3 segundos
- Autenticidade das imagens (stock photos genéricas = penalização severa)
- Modernidade e coesão do layout
- Identidade visual e consistência de marca
- Profissionalismo para o segmento

Use linguagem respeitosa e construtiva. Mas seja honesto e rigoroso na nota.

Retorne APENAS um JSON válido sem markdown:
{
  "nota": número de 1 a 10,
  "transmite_confianca": true ou false,
  "resumo": "frase curta descrevendo a primeira impressão",
  "analise_nota": "parágrafo explicando a nota",
  "comparacao_mercado": "como esse site se compara com outros do segmento",
  "principal_impacto": "o principal elemento que mais afasta um potencial cliente",
  "pontos_positivos": ["ponto 1", "ponto 2"],
  "pontos_negativos": ["ponto 1", "ponto 2"],
  "nota_seo": número de 1 a 10
}`
            }
          ]
        }]
      })
    });

    const geminiData = await geminiRes.json();
    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find(p => p.text && !p.thought);
    const text = textPart?.text || '';

    if (!text) return res.json({ erro: 'Gemini não retornou texto', dados: geminiData });

    try {
      const resultado = JSON.parse(text.replace(/```json|```/g, '').trim());
      resultado.screenshot_url = `https://api.apify.com/v2/key-value-stores/${kvStoreId}/records/${encodeURIComponent(imgKey.key)}?token=${APIFY_KEY}`;
      res.json(resultado);
    } catch(e) {
      res.json({ erro: 'Erro ao parsear', texto: text });
    }

  } catch(e) {
    res.json({ erro: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
