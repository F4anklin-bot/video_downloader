const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const YTDlpWrap = require('yt-dlp-wrap').default;

const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const binDir = serverless
  ? path.join(os.tmpdir(), 'franklins-bin')
  : path.join(__dirname, '..', 'bin');
const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const binPath = path.join(binDir, binaryName);
const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpegPath = path.join(binDir, ffmpegName);

let instance = null;
let ready = null;
let cookiesFile = null;
let cookiesResolved = false;

const YT_CLIENTS_PRIMARY = 'tv,web_safari,web_embedded,android_vr';
const YT_CLIENTS_FALLBACK = 'web_embedded,tv,web_safari';
const YT_CLIENTS_WITH_COOKIES = 'web,mweb,tv,web_safari,web_embedded';

function resolveCookies() {
  if (cookiesResolved) return cookiesFile;
  cookiesResolved = true;
  const filePath = process.env.YTDLP_COOKIES;
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    cookiesFile = filePath;
    return cookiesFile;
  }
  let body = process.env.YTDLP_COOKIES_TXT || '';
  if (process.env.YTDLP_COOKIES_B64) {
    try {
      body = Buffer.from(process.env.YTDLP_COOKIES_B64, 'base64').toString('utf8');
    } catch {
      /* keep TXT */
    }
  }
  body = String(body || '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .trim();
  if (body.length > 40 && /youtube\.com/i.test(body)) {
    const dest = path.join(os.tmpdir(), 'franklins-cookies.txt');
    if (!body.includes('# Netscape')) {
      body = `# Netscape HTTP Cookie File\n${body}`;
    }
    fs.writeFileSync(dest, body.endsWith('\n') ? body : `${body}\n`);
    cookiesFile = dest;
    return cookiesFile;
  }
  cookiesFile = null;
  return null;
}

function youtubeClientsFor(kind) {
  if (resolveCookies()) return YT_CLIENTS_WITH_COOKIES;
  return kind === 'fallback' ? YT_CLIENTS_FALLBACK : YT_CLIENTS_PRIMARY;
}

function ffmpegAsset() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === 'win32') return 'ffmpeg-win32-x64.gz';
  if (plat === 'darwin' && arch === 'arm64') return 'ffmpeg-darwin-arm64.gz';
  if (plat === 'darwin') return 'ffmpeg-darwin-x64.gz';
  if (arch === 'arm64') return 'ffmpeg-linux-arm64.gz';
  return 'ffmpeg-linux-x64.gz';
}

function systemFfmpeg() {
  const candidates = process.platform === 'win32'
    ? []
    : ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function ensureFfmpeg() {
  const system = systemFfmpeg();
  if (system) return system;
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  const stat = fs.existsSync(ffmpegPath) ? fs.statSync(ffmpegPath) : null;
  if (stat && stat.size > 1000000) return ffmpegPath;
  if (stat) fs.unlinkSync(ffmpegPath);
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/${ffmpegAsset()}`;
  const gzPath = ffmpegPath + '.gz';
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Échec du téléchargement de ffmpeg');
  fs.writeFileSync(gzPath, Buffer.from(await res.arrayBuffer()));
  fs.writeFileSync(ffmpegPath, zlib.gunzipSync(fs.readFileSync(gzPath)));
  fs.unlinkSync(gzPath);
  if (process.platform !== 'win32') fs.chmodSync(ffmpegPath, 0o755);
  return ffmpegPath;
}

function systemYtdlp() {
  if (process.platform === 'win32') return null;
  return ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'].find((p) => fs.existsSync(p)) || null;
}

function ytdlpBin() {
  return systemYtdlp() || binPath;
}

async function ensureBinary() {
  const system = systemYtdlp();
  if (system) return system;
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  const stat = fs.existsSync(binPath) ? fs.statSync(binPath) : null;
  if (stat && stat.size > 1000000) return binPath;
  if (stat) fs.unlinkSync(binPath);
  const tmp = binPath + '.part';
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  await YTDlpWrap.downloadFromGithub(tmp);
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 1000000) {
    throw new Error('Échec du téléchargement de yt-dlp');
  }
  fs.renameSync(tmp, binPath);
  return binPath;
}

async function getYtdlp() {
  if (instance) return instance;
  if (!ready) {
    ready = (async () => {
      await Promise.all([ensureBinary(), ensureFfmpeg().catch(() => null)]);
      instance = new YTDlpWrap(ytdlpBin());
      return instance;
    })();
  }
  return ready;
}

function extraArgs(kind = 'dl', { youtubeClients } = {}) {
  const info = kind === 'info';
  const clients = youtubeClients || youtubeClientsFor(info ? 'primary' : 'primary');
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--no-check-formats',
    '--force-ipv4',
    '--retries',
    info ? '1' : '2',
    '--fragment-retries',
    info ? '1' : '2',
    '--socket-timeout',
    info ? '15' : '20',
    '--extractor-args',
    `youtube:player_client=${clients};skip=translated_subs`,
  ];
  if (!info) {
    args.push('--concurrent-fragments', '8', '--no-part', '--no-mtime');
  }
  const ffmpeg = systemFfmpeg() || (fs.existsSync(ffmpegPath) ? ffmpegPath : null);
  if (ffmpeg) args.push('--ffmpeg-location', ffmpeg);
  const cookies = resolveCookies();
  if (cookies) args.push('--cookies', cookies);
  const cacheDir = path.join(os.tmpdir(), 'franklins-ytdlp-cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  args.push('--cache-dir', cacheDir);
  return args;
}

function parseJsonBlob(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(raw.slice(start));
  } catch {
    const end = raw.lastIndexOf('}');
    if (end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function runYtdlp(args, { timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpBin(), args, { windowsHide: true });
    const chunks = [];
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('yt-dlp timeout'));
    }, timeoutMs);
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => {
      err += c;
      if (err.length > 200000) err = err.slice(-80000);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks).toString('utf8');
      resolve({ code, out, err });
    });
  });
}

const INFO_PRINT =
  '%(.{id,title,thumbnail,duration,uploader,channel,ext,url,width,height,filesize,filesize_approx,timestamp,http_headers,protocol,acodec,vcodec,format_id,webpage_url,_type,entries})#j';

async function execJson(url, { quality = 'best' } = {}) {
  await getYtdlp();
  const fmt = formatArgs(quality);
  const attempts = [
    [url, '--skip-download', ...fmt, '-O', INFO_PRINT, '--no-progress', ...extraArgs('info')],
    [
      url,
      '--skip-download',
      '-f',
      'b',
      '-O',
      INFO_PRINT,
      '--no-progress',
      ...extraArgs('info', {
        youtubeClients: resolveCookies() ? 'web,mweb,tv' : YT_CLIENTS_FALLBACK,
      }),
    ],
    [
      url,
      '--skip-download',
      '-f',
      'b',
      '-O',
      INFO_PRINT,
      '--no-progress',
      ...extraArgs('info', { youtubeClients: 'default' }),
    ],
  ];
  let lastErr = 'yt-dlp failed';
  for (const [i, args] of attempts.entries()) {
    const { out, err, code } = await runYtdlp(args, { timeoutMs: i === 0 ? 28000 : 35000 });
    const json = parseJsonBlob(out) || parseJsonBlob(err);
    if (json && (json.id || json.title || json.url || json.formats || json.entries)) {
      if (!json.formats && json.url) {
        json.formats = [
          {
            url: json.url,
            ext: json.ext,
            width: json.width,
            height: json.height,
            filesize: json.filesize || json.filesize_approx,
            http_headers: json.http_headers,
            protocol: json.protocol,
            acodec: json.acodec,
            vcodec: json.vcodec,
            format_id: json.format_id,
          },
        ];
      }
      return json;
    }
    lastErr = (err || out || `yt-dlp exit ${code}`).trim().split('\n').filter(Boolean).slice(-3).join(' ') || lastErr;
  }
  throw new Error(lastErr);
}

async function getDirectUrl(url, quality = 'best') {
  await getYtdlp();
  const { out, err } = await runYtdlp(
    [url, '-g', ...formatArgs(quality), ...extraArgs('info')],
    { timeoutMs: 28000 },
  );
  const line = `${out}\n${err}`
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l))
    .pop();
  return line || null;
}

function formatArgs(quality = 'best') {
  const q = String(quality || 'best').toLowerCase();
  if (q === 'fast' || q === 'sd' || q === 'worst') {
    return ['-f', '18/b[height<=480][ext=mp4]/b[height<=480]/b[ext=mp4]/b'];
  }
  return ['-f', '22/18/b[ext=mp4]/best[acodec!=none]/b'];
}

module.exports = {
  getYtdlp,
  ensureBinary,
  ensureFfmpeg,
  execJson,
  extraArgs,
  formatArgs,
  getDirectUrl,
  resolveCookies,
  ytdlpBin,
  binPath,
  ffmpegPath,
};
