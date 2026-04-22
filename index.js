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
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: 'image/png',
                data: screenshotBase64
              }
            },
            {
              text: `Você é um avaliador rigoroso de presença digital para uma agência de marketing brasileira. Seu trabalho é identificar empresas que precisam de ajuda com seu site — então sua nota precisa refletir a REALIDADE, não ser gentil.

Regras de pontuação que você DEVE seguir:
- Nota 1-3: Site muito ruim, desatualizado, sem identidade visual, imagens quebradas, layout amador ou sem conteúdo real
- Nota 4-5: Site mediano, funcional mas genérico, visual datado, sem diferencial
- Nota 6-7: Site razoável, layout ok, mas com problemas claros que afastam clientes
- Nota 8-9: Site bom, moderno, profissional, transmite credibilidade
- Nota 10: Site excelente, referência no segmento (raríssimo)

IMPORTANTE: Seja criterioso. A maioria dos sites de pequenas e médias empresas brasileiras merece entre 3 e 6. Reserve notas altas apenas para sites realmente profissionais e modernos.

Analise a imagem deste site focando em:
- Primeira impressão visual (impacto em 3 segundos)
- Qualidade e autenticidade das imagens (fotos de stock genéricas = penalização)
- Modernidade e organização do layout
- Identidade visual e consistência de marca
- Profissionalismo geral para o segmento que atua
- Elementos que geram ou destroem confiança

Use linguagem respeitosa e construtiva — como se estivesse explicando para o dono da empresa o que precisa melhorar, sem ofender. Mas seja honesto na nota.

Retorne APENAS um JSON válido sem markdown:
{
  "nota": número de 1 a 10,
  "transmite_confianca": true ou false,
  "resumo": "frase curta descrevendo a primeira impressão de quem visita o site",
  "analise_nota": "parágrafo explicando a nota com base na experiência visual — layout, imagens, cores, organização, profissionalismo. Linguagem simples e respeitosa, como se falasse com o dono",
  "comparacao_mercado": "como esse site se compara visualmente com outros do mesmo segmento",
  "principal_impacto": "o principal elemento visual que mais afasta ou desanima um potencial cliente",
  "pontos_positivos": ["ponto visual positivo 1", "ponto visual positivo 2"],
  "pontos_negativos": ["ponto visual negativo 1", "ponto visual negativo 2"],
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
