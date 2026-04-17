const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const MAPS_KEY = process.env.MAPS_KEY;
const APIFY_KEY = process.env.APIFY_KEY;

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
    const response = await fetch(req.query.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    res.json({ contents: await response.text() });
  } catch(e) { res.json({ contents: '' }); }
});

app.get('/buscar-instagram', async (req, res) => {
  try {
    const { nome } = req.query;
    if (!nome) return res.json({ instagram: null });

    const runRes = await fetch('https://api.apify.com/v2/acts/apify~instagram-search-scraper/runs?token=' + APIFY_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchType: 'user', searchQueries: [nome], resultsLimit: 3 })
    });

    const runData = await runRes.json();
    const runId = runData.data?.id;
    if (!runId) return res.json({ instagram: null });

    let status = 'RUNNING';
    let tentativas = 0;
    while (status === 'RUNNING' && tentativas < 20) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`);
      const statusData = await statusRes.json();
      status = statusData.data?.status || 'FAILED';
      tentativas++;
    }

    if (status !== 'SUCCEEDED') return res.json({ instagram: null });

    const resultRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}`);
    const items = await resultRes.json();
    if (!items || items.length === 0) return res.json({ instagram: null });

    const nomeNormalizado = nome.toLowerCase().replace(/[^a-z0-9]/g, '');
    let melhor = null;
    let melhorScore = 0;

    for (const item of items) {
      const username = (item.username || '').toLowerCase();
      const fullName = (item.fullName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const score = username.includes(nomeNormalizado.slice(0,6)) || fullName.includes(nomeNormalizado.slice(0,6)) ? 2 : 1;
      if (score > melhorScore) { melhor = item; melhorScore = score; }
    }

    res.json({ instagram: melhor ? '@' + melhor.username : null });
  } catch(e) {
    console.error('Instagram error:', e);
    res.json({ instagram: null });
  }
});

app.get('/debug-instagram', async (req, res) => {
  try {
    const { nome } = req.query;

    const runRes = await fetch('https://api.apify.com/v2/acts/apify~instagram-search-scraper/runs?token=' + APIFY_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchType: 'user', searchQueries: [nome], resultsLimit: 5 })
    });

    const runData = await runRes.json();
    const runId = runData.data?.id;

    let status = 'RUNNING';
    let tentativas = 0;
    while (status === 'RUNNING' && tentativas < 20) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`);
      const statusData = await statusRes.json();
      status = statusData.data?.status || 'FAILED';
      tentativas++;
    }

    const resultRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}`);
    const items = await resultRes.json();

    res.json({ runId, status, total: items.length, items: items.map(i => ({ username: i.username, fullName: i.fullName, followersCount: i.followersCount })) });
  } catch(e) { res.json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
