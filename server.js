require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const NodeCache = require('node-cache');
const { spawn } = require('child_process');

const platforms = require('./config/platforms');
const { detectPlatform, normalizeUrl, isValidHttpUrl } = require('./utils/detector');
const { AppError, ERRORS, mapYtdlpError } = require('./utils/errors');
const { mediaHeaders } = require('./utils/headers');
const { getYtdlp, extraArgs, formatArgs, ensureBinary, ensureFfmpeg, getDirectUrl, ytdlpBin } = require('./utils/ytdlp');

const extractors = {
  tiktok: require('./extractors/tiktok'),
  instagram: require('./extractors/instagram'),
  x: require('./extractors/x'),
  snapchat: require('./extractors/snapchat'),
  youtube: require('./extractors/youtube'),
  reddit: require('./extractors/reddit'),
  facebook: require('./extractors/facebook'),
  vimeo: require('./extractors/vimeo'),
  dailymotion: require('./extractors/dailymotion'),
  twitch: require('./extractors/twitch'),
  generic: require('./extractors/generic'),
};

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES) || 524288000;
const cache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const tmpDir = serverless
  ? path.join(os.tmpdir(), 'franklins-tmp')
  : path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
if (!serverless) {
  for (const file of fs.readdirSync(tmpDir)) {
    try { fs.unlinkSync(path.join(tmpDir, file)); } catch { /* ignore */ }
  }
}

app.set('trust proxy', 1);
app.use(
  compression({
    filter: (req, res) => {
      if (req.path.startsWith('/api/file')) return false;
      return compression.filter(req, res);
    },
  }),
);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'blob:', 'https:'],
        frameSrc: [
          "'self'",
          'https://www.youtube.com',
          'https://www.youtube-nocookie.com',
          'https://player.vimeo.com',
          'https://www.dailymotion.com',
        ],
        connectSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use((req, res, next) => {
  if (req.path === '/sw.js') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self' https: http:; img-src * data: blob:; script-src 'self'",
    );
  }
  next();
});
app.use(cors({ origin: true }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true, limit: '32kb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    const err = ERRORS.RATE_LIMITED();
    res.status(err.status).json({ success: false, code: err.code, message: err.message });
  },
});
app.use('/api/', limiter);

  app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Service-Worker-Allowed', '/');
        return;
      }
      if (/\.(html|css|js)$/i.test(filePath) || filePath.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  }),
);

function cacheKey(url) {
  return url;
}

async function extractMedia(rawUrl, quality = 'best') {
  const detected = detectPlatform(rawUrl);
  if (!detected.url || !isValidHttpUrl(detected.url)) {
    throw ERRORS.INVALID_URL();
  }
  const key = cacheKey(detected.url);
  const cached = cache.get(key);
  if (cached) return cached;

  const extractor = extractors[detected.platform] || extractors.generic;
  const result = await extractor(detected.url, { quality, platform: detected.platform });
  if (!result?.videoUrl && !result?.needsMerge) {
    throw ERRORS.EXTRACTION_FAILED();
  }
  const payload = {
    success: true,
    platform: result.platform || detected.platform,
    videoUrl: result.videoUrl || '',
    thumbnail: result.thumbnail || '',
    title: result.title || 'Vidéo',
    author: result.author || 'inconnu',
    duration: result.duration || 0,
    quality: result.quality || 'Auto',
    filename: result.filename,
    filesize: result.filesize || 0,
    width: result.width || 0,
    height: result.height || 0,
    ext: result.ext || 'mp4',
    formats: result.formats || [],
    needsMerge: Boolean(result.needsMerge),
    httpHeaders: result.httpHeaders || {},
    sourceUrl: detected.url,
  };
  if (payload.videoUrl) cache.set(key, payload);
  return payload;
}

function publicInfo(data) {
  return {
    success: true,
    platform: data.platform,
    videoUrl: `/api/file?url=${encodeURIComponent(data.sourceUrl)}&quality=${encodeURIComponent(
      data._quality || 'best',
    )}`,
    previewUrl: `/api/file?url=${encodeURIComponent(data.sourceUrl)}&quality=fast&inline=1`,
    thumbnail: data.thumbnail,
    title: data.title,
    author: data.author,
    duration: data.duration,
    quality: data.quality,
    filename: data.filename,
    filesize: data.filesize,
    width: data.width,
    height: data.height,
    ext: data.ext,
    formats: data.formats,
  };
}

function disposition(filename, inline = false) {
  const safe = String(filename || 'video.mp4').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(safe);
  const kind = inline ? 'inline' : 'attachment';
  return `${kind}; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

function canProxy(data) {
  if (!data.videoUrl) return false;
  if (data.needsMerge) return false;
  const url = String(data.videoUrl);
  const proto = String(data.protocol || '');
  if (proto.includes('m3u8') || proto.includes('dash') || url.includes('.m3u8') || /\/manifest/i.test(url)) {
    return false;
  }
  return /^https?:\/\//i.test(url);
}

async function pipeAxios(data, req, res) {
  const yt = /googlevideo\.com|youtube\.com|youtu\.be/i.test(String(data.videoUrl));
  const headers = {
    Accept: '*/*',
    'Accept-Encoding': 'identity',
    Connection: 'keep-alive',
    ...(yt ? { Referer: 'https://www.youtube.com/', Origin: 'https://www.youtube.com' } : {}),
    ...mediaHeaders(data.videoUrl),
    ...(data.httpHeaders || {}),
    'Accept-Encoding': 'identity',
  };
  const upstream = await axios({
    method: 'get',
    url: data.videoUrl,
    responseType: 'stream',
    headers,
    timeout: 120000,
    maxRedirects: 5,
    maxContentLength: MAX_FILE_BYTES,
    decompress: false,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const length = Number(upstream.headers['content-length'] || data.filesize || 0);
  if (length && length > MAX_FILE_BYTES) throw ERRORS.FILE_TOO_LARGE();

  res.status(200);
  const inline = Boolean(res.locals.inline);
  res.setHeader(
    'Content-Type',
    inline
      ? upstream.headers['content-type'] || `video/${data.ext || 'mp4'}`
      : 'application/octet-stream',
  );
  res.setHeader('Content-Disposition', disposition(data.filename, inline));
  res.setHeader('Cache-Control', 'no-store');
  if (length) res.setHeader('Content-Length', String(length));
  res.setHeader('X-Filename', encodeURIComponent(data.filename));

  await new Promise((resolve, reject) => {
    upstream.data.on('error', reject);
    res.on('close', () => {
      if (!res.writableEnded) upstream.data.destroy();
    });
    upstream.data.pipe(res);
    res.on('finish', resolve);
  });
}

function sendFileHeaders(res, data, size) {
  res.status(200);
  const inline = Boolean(res.locals.inline);
  res.setHeader('Content-Type', inline ? `video/${data.ext || 'mp4'}` : 'application/octet-stream');
  res.setHeader('Content-Disposition', disposition(data.filename, inline));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Filename', encodeURIComponent(data.filename));
  if (size) res.setHeader('Content-Length', String(size));
}

function pipeYtdlpStream(sourceUrl, quality, data, res) {
  return new Promise((resolve, reject) => {
    const args = [sourceUrl, ...formatArgs(quality), '-o', '-', ...extraArgs('dl')];
    const child = spawn(ytdlpBin(), args, { windowsHide: true });
    let started = false;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(err);
    };
    child.stdout.on('data', (chunk) => {
      if (!started) {
        started = true;
        sendFileHeaders(res, data, 0);
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
      }
      if (!res.writableEnded) res.write(chunk);
    });
    child.stdout.on('end', () => {
      if (!started) return fail(new Error('empty stream'));
      if (!res.writableEnded) res.end();
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code && code !== 0 && !started) fail(new Error(`yt-dlp ${code}`));
      else if (started && !res.writableEnded) res.end();
    });
    res.on('close', () => {
      if (!res.writableEnded) child.kill();
    });
  });
}

async function pipeYtdlpFile(sourceUrl, quality, data, res) {
  const ytdlp = await getYtdlp();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outTpl = path.join(tmpDir, `${id}.%(ext)s`);
  const opts = { maxBuffer: 64 * 1024 * 1024 };
  const attempts = [
    [sourceUrl, ...formatArgs(quality), '-o', outTpl, '--no-part', ...extraArgs()],
    [sourceUrl, '-f', '18/22/b', '-o', outTpl, '--no-part', ...extraArgs()],
  ];

  let lastErr;
  for (const args of attempts) {
    try {
      await ytdlp.execPromise(args, opts);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw mapYtdlpError(lastErr);

  const found = fs.readdirSync(tmpDir).find((f) => f.startsWith(id));
  if (!found) throw ERRORS.EXTRACTION_FAILED();
  const filePath = path.join(tmpDir, found);
  const size = fs.statSync(filePath).size;
  if (size > MAX_FILE_BYTES) {
    fs.unlink(filePath, () => {});
    throw ERRORS.FILE_TOO_LARGE();
  }

  sendFileHeaders(res, data, size);
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    res.on('finish', resolve);
  });
  fs.unlink(filePath, () => {});
}

async function pipeYtdlp(sourceUrl, quality, data, req, res) {
  try {
    const direct = await getDirectUrl(sourceUrl, quality);
    if (direct) {
      data.videoUrl = direct;
      data.needsMerge = false;
      await pipeAxios(data, req, res);
      return;
    }
  } catch {
    /* stream / file next */
  }
  try {
    await pipeYtdlpStream(sourceUrl, quality, data, res);
  } catch (err) {
    if (res.headersSent) throw err;
    await pipeYtdlpFile(sourceUrl, quality, data, res);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: "franklin's" });
});

app.get('/api/platforms', (_req, res) => {
  res.json({
    success: true,
    platforms: Object.values(platforms)
      .filter((p) => p.id !== 'generic')
      .map(({ id, name, color }) => ({ id, name, color })),
  });
});

app.post('/api/info', async (req, res, next) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const quality = req.body?.quality || 'best';
    const data = await extractMedia(url, quality);
    data._quality = quality;
    res.json(publicInfo(data));
  } catch (err) {
    next(err);
  }
});

app.post('/api/download', async (req, res, next) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const quality = req.body?.quality || 'best';
    const data = await extractMedia(url, quality);
    data._quality = quality;
    res.json(publicInfo(data));
  } catch (err) {
    next(err);
  }
});

app.get('/api/file', async (req, res, next) => {
  try {
    res.locals.inline = req.query.inline === '1' || req.query.preview === '1';
    const url = normalizeUrl(req.query.url);
    const quality = req.query.quality || 'best';
    let data = await extractMedia(url, quality);
    data._quality = quality;

    if (!canProxy(data) && !data.videoUrl) {
      cache.del(cacheKey(data.sourceUrl || url));
      data = await extractMedia(url, quality);
      data._quality = quality;
    }

    if (canProxy(data)) {
      try {
        await pipeAxios(data, req, res);
        return;
      } catch {
        /* stream via yt-dlp instead */
      }
    }
    await pipeYtdlp(data.sourceUrl, quality, data, req, res);
  } catch (err) {
    if (!res.headersSent) next(err);
    else if (!res.writableEnded) res.end();
  }
});

app.get('/offline', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'offline.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error(err);
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, code: err.code, message: err.message });
  }
  const status = err.status || err.response?.status || 500;
  if (status === 404) {
    const e = ERRORS.VIDEO_REMOVED();
    return res.status(e.status).json({ success: false, code: e.code, message: e.message });
  }
  const e = ERRORS.EXTRACTION_FAILED();
  return res.status(e.status).json({ success: false, code: e.code, message: e.message });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Franklin's prêt sur http://localhost:${PORT}`);
    ensureBinary().catch((err) => {
      console.warn('yt-dlp sera téléchargé au premier usage:', err.message);
    });
    ensureFfmpeg().catch((err) => {
      console.warn('ffmpeg sera téléchargé au premier usage:', err.message);
    });
  });
}
