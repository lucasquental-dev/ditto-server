const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const MAPS_KEY = process.env.MAPS_KEY;
const APIFY_KEY = process.env.APIFY_KEY;
const GEMINI_KEY = process.env.GEMINI_KEY;

// Cache em memória (válido enquanto o servidor estiver ativo)
const cacheLayout = {};
const cacheInstagram = {};

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
      // Múltiplos padrões para achar Instagram
      const blacklist = ['p','reel','explore','accounts','sharer','share','stories','about','legal','help','press','api','oauth','challenges','privacy','safety','username'];
      // Padrão 1: link href direto para instagram.com/handle
      const matches = [...html.matchAll(/instagram\.com\/([a-zA-Z0-9_.]{2,30})(?:[/"\s?]|$)/gi)];
      for (const m of matches) {
        const handle = m[1].toLowerCase();
        if (!blacklist.includes(handle) && !handle.startsWith('_') && handle.length > 2) {
          return res.json({ instagram: '@' + m[1] });
        }
      }
      // Padrão 2: atributo data- com handle do instagram
      const m2 = html.match(/data-(?:instagram|ig)[^"']*["']@?([a-zA-Z0-9_.]{2,30})["']/i);
      if (m2 && !blacklist.includes(m2[1].toLowerCase())) {
        return res.json({ instagram: '@' + m2[1] });
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

    if (cacheInstagram[handle]) {
      console.log('Cache hit instagram:', handle);
      return res.json(cacheInstagram[handle]);
    }

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
    let notaFrequenciaMaxima = 10; // teto calculado por código, não pelo Gemini

    if (postsComData.length > 0) {
      const datas = postsComData.map(p => new Date(p.timestamp)).sort((a, b) => b - a);
      const ultimoPost = datas[0];
      const hoje = new Date();
      diasDesdeUltimoPost = Math.floor((hoje - ultimoPost) / (1000 * 60 * 60 * 24));

      // Teto de nota baseado em inatividade — calculado objetivamente
      if (diasDesdeUltimoPost > 365) {
        notaFrequenciaMaxima = 2;
        frequenciaTexto = `Perfil inativo — último post há mais de ${Math.floor(diasDesdeUltimoPost/365)} ano(s)`;
      } else if (diasDesdeUltimoPost > 180) {
        notaFrequenciaMaxima = 3;
        frequenciaTexto = `Perfil quase abandonado — último post há ${diasDesdeUltimoPost} dias`;
      } else if (diasDesdeUltimoPost > 60) {
        notaFrequenciaMaxima = 4;
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
            text: `Você é um avaliador RIGOROSO de presença digital em redes sociais para uma agência de marketing brasileira.

DADOS OBJETIVOS DO PERFIL @${handle}:
- Nome: ${perfil.nome}
- Bio: ${perfil.bio || 'Não preenchida'}
- Seguidores: ${perfil.seguidores}
- Total de posts: ${perfil.totalPosts}
- Conta business: ${perfil.isBusinessAccount ? 'Sim' : 'Não'}
- Frequência calculada pelo sistema: ${frequenciaTexto}
- Dias desde último post: ${diasDesdeUltimoPost !== null ? diasDesdeUltimoPost + ' dias' : 'desconhecido'}
- NOTA MÁXIMA PERMITIDA PELO SISTEMA: ${notaFrequenciaMaxima} (baseada em inatividade — você NÃO pode ultrapassar esse valor)

Últimos posts analisados:
${JSON.stringify(resumoPosts, null, 2)}

ESCALA DE AVALIAÇÃO OBRIGATÓRIA (dentro do teto acima):
- 1-2: Perfil abandonado ou sem conteúdo relevante
- 3-4: Perfil muito fraco — irregular, bio vazia, conteúdo sem estratégia
- 5: Perfil mediano — existe mas sem diferencial claro
- 6: Perfil razoável — frequência ok, conteúdo básico
- 7-8: Perfil bom — frequência regular, conteúdo relevante, bio completa
- 9-10: Perfil excelente — referência no segmento (EXTREMAMENTE raro, use apenas se todos os indicadores forem excepcionais)

REGRA INVIOLÁVEL PARA OS ARRAYS: Cada item de "impacto_negocio", "principais_falhas" e "oportunidades" deve ter NO MÁXIMO 8 palavras. Seja telegráfico. Exemplos corretos: "Perfil inativo há mais de 60 dias", "Bio vazia sem CTA", "Criar calendário editorial mensal". Exemplos ERRADOS: frases longas com explicação.

REGRAS INVIOLÁVEIS:
1. A nota final NÃO pode ser maior que ${notaFrequenciaMaxima} (teto calculado pelo sistema)
2. Bio vazia ou sem CTA desconta 1 ponto
3. Menos de 1.000 seguidores desconta 0.5 ponto
4. Sem conta business desconta 0.5 ponto
5. Legendas sem estratégia ou vazias descontam 1 ponto
6. Seja específico: cite dados reais dos posts, não generalize

Retorne APENAS este JSON válido sem markdown:
{
  "nota": número de 1 a ${notaFrequenciaMaxima},
  "seguidores": número,
  "frequencia": "descrição precisa baseada nos dados reais acima",
  "analise_bio": "análise objetiva da bio em 1 frase",
  "analise_conteudo": "análise objetiva das legendas e conteúdo em 1 frase",
  "resumo": "diagnóstico honesto do perfil em até 100 caracteres",
  "impacto_negocio": [
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras"
  ],
  "principais_falhas": [
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras"
  ],
  "oportunidades": [
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras"
  ],
  "conclusao": "diagnóstico em até 60 palavras sobre o perfil: estado atual, maior problema e impacto no negócio. Tom direto e respeitoso."
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

    const resultado = JSON.parse(text.split(String.fromCharCode(96,96,96)+'json').join('').split(String.fromCharCode(96,96,96)).join('').trim());

    // Garante que o Gemini não ultrapassou o teto calculado pelo sistema
    resultado.nota = Math.min(resultado.nota, notaFrequenciaMaxima);
    resultado.seguidores = perfil.seguidores;
    resultado.frequencia_calculada = frequenciaTexto;
    resultado.dias_desde_ultimo_post = diasDesdeUltimoPost;

    cacheInstagram[handle] = resultado;
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

    if (cacheLayout[site]) {
      console.log('Cache hit layout:', site);
      return res.json(cacheLayout[site]);
    }

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
              text: `Você é um consultor sênior de marketing digital avaliando sites de pequenas e médias empresas brasileiras. Sua função é identificar empresas que precisam de ajuda — então seja honesto e rigoroso.

Analise o screenshot e descreva o que você vê com precisão. A nota deve refletir a realidade do site, não o potencial da empresa.

ESCALA DE REFERÊNCIA:
- 1-2: Site quebrado, inacessível ou completamente amador
- 3-4: Site ruim — visual datado, imagens genéricas, sem identidade, passa desconfiança
- 5: Site mediano — funcional mas sem nenhum diferencial, "mais um entre muitos"
- 6: Site razoável — tem elementos bons mas com problemas claros
- 7-8: Site bom — moderno, organizado, transmite credibilidade
- 9-10: Site excelente — referência no segmento (MUITO raro)

CRITÉRIOS QUE MAIS PESAM:
- Autenticidade das imagens: fotos genéricas de banco de imagens penalizam muito
- Identidade visual: consistência de cores, tipografia e marca
- Modernidade do layout: sites com visual pré-2018 são muito penalizados
- Primeira impressão: o que um cliente sente nos primeiros 3 segundos
- Capacidade de converter: o site faz o visitante querer entrar em contato?

A NOTA DEVE SER COERENTE com os problemas descritos. Se o site tem imagens genéricas + layout datado + sem identidade clara, a nota máxima é 4.

REGRA DOS TÓPICOS: Cada item de "impacto_negocio", "principais_falhas" e "oportunidades" deve ter NO MÁXIMO 8 palavras. Telegráfico e direto.

Retorne APENAS este JSON válido sem markdown:
{
  "nota": número de 1 a 10,
  "nota_seo": número de 1 a 10,
  "transmite_confianca": true ou false,
  "resumo": "primeira impressão honesta em até 100 caracteres",
  "analise_nota": "descreva o que você viu e por que deu essa nota — seja específico com o que está na imagem",
  "impacto_negocio": [
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras"
  ],
  "principais_falhas": [
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras"
  ],
  "oportunidades": [
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras",
    "tópico curto, máx 8 palavras"
  ],
  "conclusao": "em até 60 palavras: o que define esse site hoje, qual o maior problema e o que isso está custando para o negócio em clientes e receita. Sem elogios. Direto."
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
      const resultado = JSON.parse(text.split(String.fromCharCode(96,96,96)+'json').join('').split(String.fromCharCode(96,96,96)).join('').trim());
      resultado.screenshot_url = `https://api.apify.com/v2/key-value-stores/${kvStoreId}/records/${encodeURIComponent(imgKey.key)}?token=${APIFY_KEY}`;
      cacheLayout[site] = resultado;
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
