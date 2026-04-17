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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
