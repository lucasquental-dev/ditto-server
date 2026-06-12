const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const MAPS_KEY = process.env.MAPS_KEY;
const APIFY_KEY = process.env.APIFY_KEY;
const GEMINI_KEY = process.env.GEMINI_KEY;

const cacheLayout = {};
const cacheInstagram = {};

async function geminiComRetry(body, tentativas = 4, modelo = 'gemini-3.5-flash') {
  for (let i = 0; i < tentativas; i++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
    const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const code = data && data.error && data.error.code;
    const status = data && data.error && data.error.status;
    if (code === 503 || status === 'UNAVAILABLE' || code === 429) {
      if (i < tentativas - 1) {
        const espera = (i + 1) * 5000;
        console.log('Gemini ' + (code||status) + ' — tentativa ' + (i+1) + '/' + tentativas + ', aguardando ' + (espera/1000) + 's');
        await new Promise(r => setTimeout(r, espera));
        continue;
      }
    }
    return data;
  }
}

function extrairJSON(text) {
  if (!text) return null;
  const mdMatch = text.match(/```(?:json)?([\s\S]*?)```/);
  if (mdMatch) {
    try { return JSON.parse(mdMatch[1].trim()); } catch(e) {}
  }
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace !== -1) {
    let depth = 0;
    let start = -1;
    for (let i = lastBrace; i >= 0; i--) {
      if (text[i] === '}') depth++;
      else if (text[i] === '{') {
        depth--;
        if (depth === 0) { start = i; break; }
      }
    }
    if (start !== -1) {
      try { return JSON.parse(text.substring(start, lastBrace + 1)); } catch(e) {}
    }
  }
  return null;
}

app.get('/maps/textsearch', async (req, res) => {
  try {
    const params = new URLSearchParams({...req.query, key: MAPS_KEY});
    const primeira = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
    const dados1 = await primeira.json();
    let todos = dados1.results || [];

    let nextToken = dados1.next_page_token;
    let pagina = 1;
    while (nextToken && pagina < 3) {
      await new Promise(r => setTimeout(r, 2500));
      const proxRes = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(nextToken)}&key=${MAPS_KEY}`);
      const proxDados = await proxRes.json();
      console.log('Pagina ' + (pagina+1) + ': status=' + proxDados.status + ' n=' + (proxDados.results?.length || 0));
      if (proxDados.results && proxDados.results.length > 0) {
        todos = todos.concat(proxDados.results);
      }
      nextToken = proxDados.next_page_token;
      pagina++;
    }
    console.log('Total:', todos.length);
    res.json({ results: todos, status: dados1.status, next_page_token: dados1.next_page_token });
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

    // CORREÇÃO 1: Se o "site" é na verdade um link do Instagram, retorna direto
    if (site.includes('instagram.com/')) {
      const igMatch = site.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})/i);
      if (igMatch) {
        return res.json({ instagram: '@' + igMatch[1], site_era_instagram: true });
      }
    }

    try {
      const htmlRes = await fetch(site, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000
      });
      const html = await htmlRes.text();
      // CORREÇÃO 2: Blacklist expandida com termos de arquivos internos do Facebook/Meta
      const blacklist = ['p','reel','explore','accounts','sharer','share','stories','about','legal','help','press','api','oauth','challenges','privacy','safety','username','rsrc','static','cdn','embed','undefined','null','www','http','https'];
      const matches = [...html.matchAll(/instagram\.com\/([a-zA-Z0-9_.]{2,30})(?:[/"\s?]|$)/gi)];
      for (const m of matches) {
        const handle = m[1].toLowerCase();
        if (!blacklist.includes(handle) && !handle.startsWith('_') && handle.length > 2 && !handle.includes('.php') && !handle.includes('.js')) {
          return res.json({ instagram: '@' + m[1] });
        }
      }
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
              const perfil = items[0];
              const isPrivado = perfil.isPrivate || perfil.private;
              const totalPosts = perfil.mediaCount || perfil.postsCount || 0;
              const username = perfil.username.toLowerCase();
              const dominioLimpo = domain.toLowerCase().replace(/[^a-z0-9]/g, '');
              const usernameLimpo = username.replace(/[^a-z0-9]/g, '');
              const temRelacao = usernameLimpo.includes(dominioLimpo) ||
                                 dominioLimpo.includes(usernameLimpo) ||
                                 usernameLimpo.substring(0, 4) === dominioLimpo.substring(0, 4);
              if (!isPrivado && totalPosts > 0 && temRelacao) {
                return res.json({ instagram: '@' + perfil.username });
              }
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
    let notaFrequenciaMaxima = 10;
    if (postsComData.length > 0) {
      const datas = postsComData.map(p => new Date(p.timestamp)).sort((a, b) => b - a);
      const ultimoPost = datas[0];
      const hoje = new Date();
      diasDesdeUltimoPost = Math.floor((hoje - ultimoPost) / (1000 * 60 * 60 * 24));
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
    const geminiData = await geminiComRetry({
      generationConfig: { temperature: 0 },
      contents: [{ parts: [{ text: `Você é um consultor experiente de marketing digital avaliando o perfil do Instagram @${handle} para uma agência brasileira.\n\nDADOS DO PERFIL:\n- Nome: ${perfil.nome}\n- Bio: ${perfil.bio || 'Não preenchida'}\n- Seguidores: ${perfil.seguidores}\n- Total de posts: ${perfil.totalPosts}\n- Frequência: ${frequenciaTexto}\n- Dias desde último post: ${diasDesdeUltimoPost !== null ? diasDesdeUltimoPost + ' dias' : 'desconhecido'}\n- NOTA MÁXIMA PERMITIDA (baseada na inatividade do perfil): ${notaFrequenciaMaxima}\n\nÚltimos posts:\n${JSON.stringify(resumoPosts, null, 2)}\n\nAvalie com bom senso e equilíbrio, como um consultor humano faria. Use seu julgamento natural para dar uma nota de 1 a ${notaFrequenciaMaxima} que reflita honestamente a qualidade real do perfil. A nota máxima já considera a inatividade do perfil — respeite esse limite.\n\nA conclusao deve ser honesta e equilibrada: reconheça pontos fortes, aponte o que pode melhorar. Linguagem simples, sem jargão. Máximo 120 palavras.\n\nRetorne APENAS este JSON válido sem markdown:\n{\n  "nota": número de 1 a ${notaFrequenciaMaxima},\n  "seguidores": número,\n  "frequencia": "descrição precisa",\n  "analise_bio": "análise objetiva da bio em 1 frase",\n  "analise_conteudo": "análise objetiva das legendas em 1 frase",\n  "resumo": "diagnóstico honesto em até 100 caracteres",\n  "impacto_negocio": ["máx 8 palavras", "máx 8 palavras", "máx 8 palavras"],\n  "principais_falhas": ["máx 8 palavras", "máx 8 palavras", "máx 8 palavras"],\n  "oportunidades": ["máx 8 palavras", "máx 8 palavras", "máx 8 palavras"],\n  "conclusao": "até 120 palavras: avaliação honesta e equilibrada, linguagem simples e direta."\n}` }] }]
    });
    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find(p => p.text && !p.thought);
    const text = textPart?.text || '';
    if (!text) return res.json({ erro: 'Gemini não retornou análise' });
    const resultado = extrairJSON(text);
    if (!resultado) return res.json({ erro: 'Erro ao parsear' });
    resultado.nota = Math.min(resultado.nota, notaFrequenciaMaxima);
    resultado.seguidores = perfil.seguidores;
    resultado.frequencia_calculada = frequenciaTexto;
    resultado.dias_desde_ultimo_post = diasDesdeUltimoPost;
    cacheInstagram[handle] = resultado;
    res.json(resultado);
  } catch(e) { res.json({ erro: e.message }); }
});

app.get('/debug-gemini', async (req, res) => {
  try {
    const geminiData = await geminiComRetry({
      contents: [{ parts: [{ text: 'Responda apenas: {"ok": true}' }] }]
    });
    res.json(geminiData);
  } catch(e) { res.json({ erro: e.message }); }
});

// CORREÇÃO 3: Novo endpoint para diagnóstico de site quando não existe site
app.get('/analisar-sem-site', async (req, res) => {
  try {
    const { nome } = req.query;
    const resultado = {
      nota: 1,
      nota_seo: 1,
      transmite_confianca: false,
      resumo: 'Empresa sem site próprio — presença digital incompleta.',
      analise_nota: 'Esta empresa ainda não possui um site profissional. No cenário atual, onde a jornada do cliente começa quase sempre por uma busca online, a ausência de um site próprio representa uma lacuna significativa na estratégia de captação de novos clientes.',
      impacto_negocio: ['Clientes não encontram informações antes do contato', 'Credibilidade digital abaixo do potencial do negócio', 'Oportunidades de conversão perdidas diariamente'],
      principais_falhas: ['Ausência de site profissional próprio', 'Sem canal digital de apresentação da marca', 'Jornada do cliente interrompida antes do contato'],
      oportunidades: ['Criar site profissional como prioridade estratégica', 'Estruturar presença digital completa e integrada', 'Captar clientes 24h pelo canal digital'],
      conclusao: 'A empresa ainda não conta com um site profissional — o que representa uma oportunidade real de crescimento. Com um site bem estruturado, é possível apresentar os serviços, construir autoridade na área e estar disponível para novos clientes a qualquer momento, sem depender exclusivamente de indicações ou redes sociais.',
      screenshot_url: null,
      sem_site: true
    };
    res.json(resultado);
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

    let dadosTecnicos = '';
    let siteInacessivel = false;
    try {
      const htmlRes = await fetch(site, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000
      });
      const htmlRaw = await htmlRes.text();
      const metaTitle = (htmlRaw.match(/<title[^>]*>(.*?)<\/title>/i) || ['',''])[1];
      const metaDesc = (htmlRaw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || ['',''])[1];
      const h1s = [...htmlRaw.matchAll(/<h1[^>]*>(.*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g,'').trim()).slice(0,3);
      const h2s = [...htmlRaw.matchAll(/<h2[^>]*>(.*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g,'').trim()).slice(0,5);
      const platform = htmlRaw.includes('builderall') ? 'Builderall (sistema genérico)' :
                       htmlRaw.includes('wix.com') || htmlRaw.includes('wixstatic') ? 'Wix' :
                       htmlRaw.includes('elementor') ? 'WordPress/Elementor' :
                       htmlRaw.includes('wordpress') ? 'WordPress' :
                       htmlRaw.includes('lovable') ? 'Lovable (IA)' :
                       htmlRaw.includes('webflow') ? 'Webflow' :
                       htmlRaw.includes('livance') ? 'Livance (plataforma de agendamento)' :
                       'Site próprio';
      dadosTecnicos = `DADOS TÉCNICOS DO SITE:\n- Título: ${metaTitle || 'Não definido'}\n- Meta description: ${metaDesc || 'Não definida'}\n- H1s: ${h1s.join(' | ') || 'Nenhum encontrado'}\n- H2s: ${h2s.join(' | ') || 'Nenhum encontrado'}`;
    } catch(e) {
      siteInacessivel = true;
    }

    if (siteInacessivel) {
      const resultado = {
        nota: 1,
        nota_seo: 1,
        transmite_confianca: false,
        resumo: 'Site inacessível — fora do ar ou bloqueando acesso.',
        analise_nota: 'Não foi possível acessar o site. Isso é um problema gravíssimo para qualquer negócio.',
        impacto_negocio: ['Zero visibilidade online', 'Perda total de potenciais clientes', 'Danos severos à credibilidade'],
        principais_falhas: ['Site completamente inacessível', 'Impossível avaliar conteúdo ou design', 'Presença digital inexistente'],
        oportunidades: ['Verificar e restaurar o servidor', 'Garantir hospedagem confiável', 'Monitorar disponibilidade do site'],
        conclusao: 'O site está fora do ar ou bloqueando qualquer acesso externo. Isso significa que nenhum cliente potencial consegue encontrá-lo online. É o problema mais grave que um negócio pode ter na presença digital — equivale a não existir na internet.',
        screenshot_url: null
      };
      cacheLayout[site] = resultado;
      return res.json(resultado);
    }

    const prompt = `Você é um Diretor de Arte Sênior e Consultor Estratégico de Negócios Digitais. Sua missão é fazer uma auditoria visual e de conversão do site: ${site}

Acesse o site pelo link acima usando url_context e analise o que você realmente vê — design, identidade visual, hierarquia visual, qualidade das imagens, experiência do visitante, clareza da navegação.

${dadosTecnicos}

Este diagnóstico será usado em uma abordagem de prospecção comercial. O tom deve ser extremamente profissional, respeitoso e construtivo, mas o julgamento das notas deve ser rigoroso, realístico e preciso para diferenciar sites genéricos de sites premium.

DIRETRIZES DE CALIBRAÇÃO DAS NOTAS (Rigor de Mercado):

Nota 1 a 4 (Baixo Impacto / Institucional Genérico):
Sites que usam estruturas padrão/engessadas, páginas de agendamento terceirizadas puras (ex: Livance, Doctoralia) ou templates de blocos sem nenhuma customização. Características: ausência de fotos reais do profissional/equipe, falta de elementos de conversão (depoimentos, FAQ, portfólio autoral) e identidade visual inexistente ou genérica. O site apenas "existe", mas não constrói autoridade.

Nota 5 a 6 (Mediano / Funcional):
Sites estruturados que possuem as informações básicas e funcionam bem, mas o design é previsível. Não há um trabalho forte de diferenciação de marca ou elementos visuais de alto impacto. É o "feijão com arroz" do mercado.

Nota 7 a 8 (Premium / Alta Conversão):
Sites com forte identidade visual própria, excelente escolha tipográfica e de cores, uso de elementos ricos (vídeo ou imagens em alta definição na dobra principal, copy com posicionamento claro, seções de prova social estruturadas). O resultado final transmite exclusividade e alto valor.

Nota 9 a 10 (Excepcional):
Design fora da curva, experiência de usuário impecável e autoridade máxima instantânea.

REGRAS DE AVALIAÇÃO:

1. Independência de Plataforma: Não julgue a ferramenta (WordPress, Elementor, Wix, etc.), julgue a execução e a personalização.

2. Sinceridade com Diplomacia: Nunca use palavras pejorativas. Use termos de negócios e posicionamento. Em vez de "o site não tem identidade visual", use "o layout atual segue uma estrutura mais genérica, o que pode diluir a percepção de exclusividade do serviço no mercado."

3. O Teste da Autoridade: Sites que não mostram quem está por trás do serviço (sem fotos reais do profissional, clínica ou portfólio autoral) perdem o fator de confiança e NÃO DEVEM PASSAR DA NOTA 5 no quesito visual, pois falham na premissa básica de conversão em saúde/serviços premium.

4. Ignorar Animações: Números zerados (0%, R$0, contadores em zero) devem ser IGNORADOS — são animações JavaScript que não carregam no HTML estático.

PESOS DA NOTA PRINCIPAL:
- Experiência visual, impacto de branding e presença de elementos de conversão (fotos reais, prova social, portfólio): peso 70%
- Aspectos técnicos estruturais (SEO, H1, meta description): peso 30%

Retorne APENAS este JSON, sem nenhum texto antes ou depois, sem markdown:
{
  "nota": número 1-10,
  "nota_seo": número 1-10,
  "transmite_confianca": true ou false,
  "resumo": "primeira impressão honesta em até 100 caracteres",
  "analise_nota": "o que o design e conteúdo revelam sobre este site",
  "impacto_negocio": ["máx 8 palavras", "máx 8 palavras", "máx 8 palavras"],
  "principais_falhas": ["máx 8 palavras", "máx 8 palavras", "máx 8 palavras"],
  "oportunidades": ["máx 8 palavras", "máx 8 palavras", "máx 8 palavras"],
  "conclusao": "até 120 palavras, tom profissional e construtivo, focado em oportunidades de melhoria."
}`;

    const geminiData = await geminiComRetry({
      generationConfig: { temperature: 0, maxOutputTokens: 16384 },
      tools: [{ url_context: {} }],
      contents: [{ parts: [{ text: prompt }] }]
    }, 4, 'gemini-3.5-flash');

    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find(p => p.text && !p.thought);
    const text = textPart?.text || '';

    if (!text) return res.json({ erro: 'Gemini não retornou texto', dados: geminiData });

    const resultado = extrairJSON(text);
    if (!resultado) return res.json({ erro: 'Erro ao parsear', texto: text.substring(0, 500) });

    resultado.screenshot_url = null;
    cacheLayout[site] = resultado;
    res.json(resultado);
  } catch(e) { res.json({ erro: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
