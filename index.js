const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const MAPS_KEY = process.env.MAPS_KEY;

app.get('/maps/textsearch', async (req, res) => {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${new URLSearchParams({...req.query, key: MAPS_KEY})}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/maps/details', async (req, res) => {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?${new URLSearchParams({...req.query, key: MAPS_KEY})}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/maps/findplace', async (req, res) => {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${new URLSearchParams({...req.query, key: MAPS_KEY})}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/fetch-html', async (req, res) => {
  try {
    const response = await fetch(req.query.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await response.text();
    res.json({ contents: html });
  } catch(e) { res.json({ contents: '' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
