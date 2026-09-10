function slug(value, fallback = 'video') {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s.]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 42);
  return clean || fallback;
}

function dateStamp(ts) {
  const d = ts ? new Date(ts * 1000) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function extFrom(info = {}, format = {}) {
  const v = (format.ext || info.ext || 'mp4').toLowerCase();
  if (['mp4', 'webm', 'mkv', 'mov', 'm4a', 'mp3'].includes(v)) return v;
  return 'mp4';
}

function pickFormat(info, quality = 'best') {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const q = String(quality || 'best').toLowerCase();
  const playable = formats.filter((f) => f.url && !String(f.protocol || '').includes('mhtml'));

  const heightOf = (f) => f.height || 0;
  const hasAudio = (f) => f.acodec && f.acodec !== 'none';
  const hasVideo = (f) => f.vcodec && f.vcodec !== 'none';
  const combined = playable.filter((f) => hasVideo(f) && hasAudio(f));

  const pool = combined.length ? combined : playable.filter(hasVideo);
  if (!pool.length) return info.url ? { url: info.url, ext: info.ext, http_headers: info.http_headers, filesize: info.filesize } : null;

  const sorted = [...pool].sort((a, b) => heightOf(b) - heightOf(a) || (b.tbr || 0) - (a.tbr || 0));

  if (q === 'sd') {
    const sd = sorted.filter((f) => heightOf(f) && heightOf(f) <= 480);
    return sd[0] || sorted[sorted.length - 1];
  }
  if (q === 'worst') return sorted[sorted.length - 1];
  const hd = sorted.find((f) => heightOf(f) <= 1080) || sorted[0];
  return hd || sorted[0];
}

function qualityLabel(format, requested) {
  if (format?.height) return `${format.height}p`;
  if (requested === 'sd') return 'SD';
  if (requested === 'hd') return 'HD';
  return 'Auto';
}

function buildResult(info, format, platform, quality) {
  const author = info.uploader || info.channel || info.creator || info.artist || 'unknown';
  const ext = extFrom(info, format || {});
  const filename = `${platform}_${slug(author)}_${dateStamp(info.timestamp)}.${ext}`;
  const videoUrl = format?.url || info.url || null;
  const proto = String(format?.protocol || info.protocol || '');
  const acodec = format?.acodec;
  const hasDashOnly =
    !videoUrl &&
    Array.isArray(info.formats) &&
    info.formats.some((f) => f.url && f.vcodec && f.vcodec !== 'none');
  return {
    platform,
    videoUrl,
    thumbnail: info.thumbnail || (info.thumbnails || []).slice(-1)[0]?.url || '',
    title: info.title || 'Vidéo',
    author,
    duration: Math.round(info.duration || 0),
    quality: qualityLabel(format, quality),
    filename,
    filesize: format?.filesize || format?.filesize_approx || info.filesize || info.filesize_approx || 0,
    width: format?.width || info.width || 0,
    height: format?.height || info.height || 0,
    ext,
    httpHeaders: format?.http_headers || info.http_headers || {},
    protocol: proto,
    needsMerge: !videoUrl || hasDashOnly || acodec === 'none' || /m3u8|dash/i.test(proto),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, retries = 2) {
  let last;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < retries) await sleep(800 * 2 ** i);
    }
  }
  throw last;
}

module.exports = { slug, dateStamp, pickFormat, buildResult, withRetry, sleep };
