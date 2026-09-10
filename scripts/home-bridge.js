#!/usr/bin/env node
/**
 * Free home bridge — run on your PC (where YouTube already works).
 *
 *   npm run bridge
 *   cloudflared tunnel --url http://127.0.0.1:3921
 *
 * On Render set:
 *   HOME_BRIDGE_URL=https://xxxx.trycloudflare.com
 *   HOME_BRIDGE_SECRET=same-secret-as-local (optional but recommended)
 */
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

// Extract without HOME_BRIDGE recursion
process.env.HOME_BRIDGE_URL = '';

const extractYoutube = require('../extractors/youtube');

const PORT = Number(process.env.HOME_BRIDGE_PORT) || 3921;
const SECRET = String(process.env.HOME_BRIDGE_SECRET || '').trim();
const app = express();
app.use(express.json({ limit: '32kb' }));

function auth(req, res, next) {
  if (!SECRET) return next();
  const h = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const q = String(req.query.token || '');
  if (h === SECRET || q === SECRET) return next();
  return res.status(401).json({ success: false, message: 'unauthorized' });
}

const cache = new Map();
const TTL = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.at > TTL) cache.delete(k);
  }
}, 60000).unref?.();

app.get('/health', (_req, res) => {
  res.json({ ok: true, role: 'home-bridge' });
});

app.post('/extract', auth, async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!url) return res.status(400).json({ success: false, message: 'url required' });
    const result = await extractYoutube(url, { quality: req.body?.quality || 'best', _noBridge: true });
    if (!result?.videoUrl) {
      return res.status(422).json({ success: false, message: 'extraction failed' });
    }
    const id = crypto.randomBytes(12).toString('hex');
    cache.set(id, {
      at: Date.now(),
      videoUrl: result.videoUrl,
      headers: result.httpHeaders || {},
      filename: result.filename || 'video.mp4',
    });
    const base = `${req.protocol}://${req.get('host')}`;
    const tokenQ = SECRET ? `?token=${encodeURIComponent(SECRET)}` : '';
    res.json({
      ...result,
      videoUrl: `${base}/stream/${id}${tokenQ}`,
      bridge: true,
    });
  } catch (err) {
    res.status(422).json({ success: false, message: err.message || 'failed' });
  }
});

app.get('/stream/:id', auth, async (req, res) => {
  const entry = cache.get(req.params.id);
  if (!entry) return res.status(404).end('gone');
  try {
    const upstream = await axios.get(entry.videoUrl, {
      responseType: 'stream',
      timeout: 120000,
      headers: {
        ...(entry.headers || {}),
        'User-Agent': entry.headers?.['User-Agent'] || 'Mozilla/5.0',
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    res.status(upstream.status);
    for (const [k, v] of Object.entries(upstream.headers || {})) {
      if (/^(content-type|content-length|content-range|accept-ranges)$/i.test(k)) {
        res.setHeader(k, v);
      }
    }
    res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
    upstream.data.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).end(err.message || 'proxy failed');
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Home bridge on http://127.0.0.1:${PORT}`);
  console.log(`Expose free with: cloudflared tunnel --url http://127.0.0.1:${PORT}`);
});
