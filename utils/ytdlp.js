const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const YTDlpWrap = require('yt-dlp-wrap').default;

const binDir = path.join(__dirname, '..', 'bin');
const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const binPath = path.join(binDir, binaryName);
const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpegPath = path.join(binDir, ffmpegName);

let instance = null;
let ready = null;

function ffmpegAsset() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === 'win32') return 'ffmpeg-win32-x64.gz';
  if (plat === 'darwin' && arch === 'arm64') return 'ffmpeg-darwin-arm64.gz';
  if (plat === 'darwin') return 'ffmpeg-darwin-x64.gz';
  if (arch === 'arm64') return 'ffmpeg-linux-arm64.gz';
  return 'ffmpeg-linux-x64.gz';
}

async function ensureFfmpeg() {
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

async function ensureBinary() {
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
      instance = new YTDlpWrap(binPath);
      return instance;
    })();
  }
  return ready;
}

function extraArgs() {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--geo-bypass',
    '--concurrent-fragments',
    '16',
    '--retries',
    '2',
    '--fragment-retries',
    '2',
    '--socket-timeout',
    '20',
    '--extractor-args',
    'youtube:player_client=android,tv,web',
  ];
  if (fs.existsSync(ffmpegPath)) {
    args.push('--ffmpeg-location', ffmpegPath);
  }
  if (process.env.YTDLP_COOKIES && fs.existsSync(process.env.YTDLP_COOKIES)) {
    args.push('--cookies', process.env.YTDLP_COOKIES);
  }
  const cacheDir = path.join(binDir, 'cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  args.push('--cache-dir', cacheDir);
  return args;
}

async function execJson(url) {
  const ytdlp = await getYtdlp();
  const raw = await ytdlp.execPromise(
    [
      url,
      '--dump-single-json',
      '--skip-download',
      '--no-check-formats',
      ...extraArgs(),
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const text = String(raw).trim();
  const start = text.indexOf('{');
  const json = start >= 0 ? text.slice(start) : text;
  return JSON.parse(json);
}

function formatArgs(quality = 'best') {
  const q = String(quality || 'best').toLowerCase();
  if (q === 'fast') {
    return ['-f', '18/22/b[ext=mp4]/b'];
  }
  if (q === 'sd' || q === 'worst') {
    return ['-f', '18/b[height<=480]/worst'];
  }
  if (q === 'hd') {
    return ['-f', '22/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/18/b', '--merge-output-format', 'mp4'];
  }
  return ['-f', '22/18/b[ext=mp4]/b/bv*[height<=1080]+ba/best', '--merge-output-format', 'mp4'];
}

module.exports = {
  getYtdlp,
  ensureBinary,
  ensureFfmpeg,
  execJson,
  extraArgs,
  formatArgs,
  binPath,
  ffmpegPath,
};
