const https = require('https');
const axios = require('axios');
const generic = require('./generic');
const { extractFromInfo } = generic;
const { resolveProxy } = require('../utils/ytdlp');
const { findFreeSocks } = require('../utils/socksFarm');

const VR_VERSION = '1.65.10';
const VR_UA = `com.google.android.apps.youtube.vr.oculus/${VR_VERSION} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip`;
const ipv4Agent = process.platform === 'win32' ? undefined : new https.Agent({ family: 4, keepAlive: false });

const INVIDIOUS = [
  'https://invidious.jing.rocks',
  'https://invidious.private.coffee',
  'https://yt.artemislena.eu',
  'https://invidious.flokinet.to',
  'https://iv.ggtyler.dev',
  'https://invidious.protokolla.fi',
  'https://invidious.perennialte.ch',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
];

const PIPED = [
  'https://pipedapi.adminforge.de',
  'https://pipedapi.reallyaweso.me',
  'https://api.piped.private.coffee',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.kavin.rocks',
];

function proxyAgent() {
  const proxy = resolveProxy();
  if (!proxy) return null;
  try {
    const { SocksProxyAgent } = require('socks-proxy-agent');
    const { HttpsProxyAgent } = require('https-proxy-agent');
    if (/^socks/i.test(proxy)) return new SocksProxyAgent(proxy);
    return new HttpsProxyAgent(proxy);
  } catch {
    return null;
  }
}

function axOpts(extra = {}) {
  const agent = proxyAgent() || ipv4Agent;
  return {
    timeout: 12000,
    ...(agent ? { httpsAgent: agent, httpAgent: agent, proxy: false } : {}),
    ...extra,
  };
}

function videoIdFromUrl(url) {
  const u = String(url || '');
  return (
    u.match(/[?&]v=([\w-]{6,})/)?.[1] ||
    u.match(/youtu\.be\/([\w-]{6,})/)?.[1] ||
    u.match(/youtube\.com\/shorts\/([\w-]{6,})/)?.[1] ||
    u.match(/youtube\.com\/embed\/([\w-]{6,})/)?.[1] ||
    u.match(/youtube\.com\/live\/([\w-]{6,})/)?.[1] ||
    null
  );
}

function mimeBits(mime = '') {
  const m = String(mime);
  const video = m.includes('video');
  const audio = m.includes('audio');
  return {
    ext: m.includes('webm') ? 'webm' : 'mp4',
    vcodec: video ? 'avc1' : 'none',
    acodec: audio || /mp4a|opus/i.test(m) ? 'aac' : video ? 'none' : 'aac',
  };
}

function mapFormats(raw, ua) {
  return (raw || [])
    .filter((f) => f && f.url && !String(f.url).includes('.m3u8'))
    .map((f) => {
      const bits = mimeBits(f.mimeType || f.type || '');
      const height =
        Number(f.height) ||
        Number(String(f.qualityLabel || f.quality || '').replace(/[^\d]/g, '')) ||
        0;
      const videoOnly = Boolean(f.videoOnly) || bits.acodec === 'none';
      const audioOnly = Boolean(f.audioOnly) || bits.vcodec === 'none';
      return {
        url: f.url,
        ext: bits.ext,
        width: f.width,
        height,
        filesize: Number(f.contentLength || f.clen) || 0,
        acodec: videoOnly ? 'none' : bits.acodec,
        vcodec: audioOnly ? 'none' : bits.vcodec,
        protocol: 'https',
        format_id: String(f.itag || f.quality || ''),
        http_headers: { 'User-Agent': ua, Referer: 'https://www.youtube.com/' },
      };
    })
    .filter((f) => f.vcodec !== 'none');
}

function preferMuxed(formats) {
  const muxed = formats.filter((f) => f.acodec && f.acodec !== 'none');
  return muxed.length ? muxed : formats;
}

function infoFromPlayer(id, data) {
  const status = String(data?.playabilityStatus?.status || '');
  if (status && status !== 'OK') {
    throw new Error(data.playabilityStatus.reason || status);
  }
  const sd = data.streamingData || {};
  const formats = preferMuxed(
    mapFormats([...(sd.formats || []), ...(sd.adaptiveFormats || [])], VR_UA),
  );
  if (!formats.length) throw new Error('no innertube formats');
  const details = data.videoDetails || {};
  const thumb =
    details.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  return {
    id,
    title: details.title || 'YouTube',
    uploader: details.author || 'youtube',
    channel: details.author,
    thumbnail: thumb,
    duration: Number(details.lengthSeconds) || 0,
    ext: 'mp4',
    webpage_url: `https://www.youtube.com/watch?v=${id}`,
    formats,
  };
}

async function innertubePlayer(id) {
  const body = {
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: VR_VERSION,
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        androidSdkVersion: 32,
        osName: 'Android',
        osVersion: '12L',
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
      },
    },
    videoId: id,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const res = await axios.post(
    'https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false',
    body,
    axOpts({
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': VR_UA,
        'X-YouTube-Client-Name': '28',
        'X-YouTube-Client-Version': VR_VERSION,
      },
      validateStatus: (s) => s >= 200 && s < 500,
    }),
  );
  if (res.status >= 400) throw new Error(`innertube ${res.status}`);
  return infoFromPlayer(id, res.data);
}

async function pipedInfo(id) {
  const tryBase = async (base) => {
    const res = await axios.get(
      `${base}/streams/${id}`,
      axOpts({
        headers: { Accept: 'application/json', 'User-Agent': 'franklins/1.0' },
        validateStatus: (s) => s >= 200 && s < 500,
      }),
    );
    if (res.status >= 400 || !res.data?.title) throw new Error(`${base} ${res.status}`);
    const data = res.data;
    const formats = preferMuxed(
      mapFormats(
        (data.videoStreams || []).map((s) => ({
          url: s.url,
          mimeType: s.mimeType || s.format,
          qualityLabel: s.quality,
          height: Number(String(s.quality || '').replace(/[^\d]/g, '')) || 0,
          videoOnly: s.videoOnly,
          itag: s.itag,
        })),
        'franklins/1.0',
      ),
    );
    if (!formats.length) throw new Error(`${base} empty`);
    return {
      id,
      title: data.title,
      uploader: data.uploader || 'youtube',
      thumbnail: data.thumbnailUrl || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: Number(data.duration) || 0,
      ext: 'mp4',
      webpage_url: `https://www.youtube.com/watch?v=${id}`,
      formats,
    };
  };
  return Promise.any(PIPED.map(tryBase));
}

async function invidiousLocal(id) {
  const tryHost = async (host) => {
    const streamUrl = `${host}/latest_version?id=${encodeURIComponent(id)}&itag=18&local=true`;
    const head = await axios.get(streamUrl, {
      timeout: 7000,
      maxRedirects: 3,
      responseType: 'stream',
      validateStatus: () => true,
      headers: { 'User-Agent': 'franklins/1.0', Accept: '*/*' },
    });
    const ctype = String(head.headers['content-type'] || '');
    const len = Number(head.headers['content-length'] || 0);
    if (head.data && typeof head.data.destroy === 'function') head.data.destroy();
    if (head.status >= 400 || /text\/html|json/i.test(ctype)) throw new Error('bad');
    if (!/video|octet|mp4|mpeg/i.test(ctype) && len < 10000) throw new Error('empty');

    let title = 'YouTube';
    let author = 'youtube';
    try {
      const meta = await axios.get(`${host}/api/v1/videos/${id}`, {
        timeout: 5000,
        validateStatus: () => true,
        headers: { Accept: 'application/json' },
      });
      if (meta.data?.title) {
        title = meta.data.title;
        author = meta.data.author || author;
      }
    } catch {
      /* keep defaults */
    }

    return {
      id,
      title,
      uploader: author,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: 0,
      ext: 'mp4',
      webpage_url: `https://www.youtube.com/watch?v=${id}`,
      formats: [
        {
          url: streamUrl,
          ext: 'mp4',
          height: 360,
          acodec: 'aac',
          vcodec: 'avc1',
          protocol: 'https',
          filesize: len || 0,
          http_headers: { 'User-Agent': 'franklins/1.0' },
        },
      ],
    };
  };
  return Promise.any(INVIDIOUS.map(tryHost));
}

async function withTempProxy(proxy, fn) {
  const prev = process.env.YTDLP_PROXY;
  process.env.YTDLP_PROXY = proxy;
  try {
    return await fn();
  } finally {
    if (prev) process.env.YTDLP_PROXY = prev;
    else delete process.env.YTDLP_PROXY;
  }
}

async function homeBridge(url, quality) {
  const base = String(process.env.HOME_BRIDGE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (!base) throw new Error('no home bridge');
  const secret = String(process.env.HOME_BRIDGE_SECRET || '').trim();
  const res = await axios.post(
    `${base}/extract`,
    { url, quality },
    {
      timeout: 90000,
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      validateStatus: () => true,
    },
  );
  if (res.status >= 400 || !res.data?.videoUrl) {
    throw new Error(res.data?.message || `home bridge ${res.status}`);
  }
  return {
    ...res.data,
    httpHeaders: {
      ...(res.data.httpHeaders || {}),
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
  };
}

module.exports = async function extract(url, opts = {}) {
  const quality = opts.quality || 'best';
  const id = videoIdFromUrl(url);

  // 0) Free home PC bridge (Cloudflare Tunnel) — most reliable free option on cloud
  if (!opts._noBridge && process.env.HOME_BRIDGE_URL) {
    try {
      const bridged = await homeBridge(url, quality);
      if (bridged?.videoUrl) return bridged;
    } catch {
      /* fall through to cloud methods */
    }
  }

  // Cookies + yt-dlp first when available (free, works on residential / lucky IPs)
  if (require('../utils/ytdlp').resolveCookies()) {
    try {
      return await generic(url, { ...opts, platform: 'youtube' });
    } catch {
      /* continue */
    }
  }

  // 1) Invidious local=true — free, fast (instance fetches googlevideo for us)
  if (id) {
    try {
      const info = await invidiousLocal(id);
      const result = extractFromInfo(info, quality, 'youtube');
      if (result.videoUrl) return result;
    } catch {
      /* next */
    }
  }

  // 2) Direct innertube / piped (works on residential / lucky cloud IPs)
  if (id) {
    for (const step of [innertubePlayer, pipedInfo]) {
      try {
        const info = await step(id);
        const result = extractFromInfo(info, quality, 'youtube');
        if (result.videoUrl) return result;
      } catch {
        /* next */
      }
    }
  }

  // 3) Existing WARP / env proxy → yt-dlp
  if (resolveProxy()) {
    try {
      return await generic(url, { ...opts, platform: 'youtube' });
    } catch {
      /* next */
    }
  }

  // 4) Free SOCKS5 farm → yt-dlp (slow first hit, then cached) — skip on home bridge
  if (!opts._noBridge) {
    try {
      const free = await findFreeSocks();
      if (free) {
        const result = await withTempProxy(free, () => generic(url, { ...opts, platform: 'youtube' }));
        if (result?.videoUrl) {
          process.env.YTDLP_PROXY = free;
          return result;
        }
      }
    } catch {
      /* next */
    }
  }

  return generic(url, { ...opts, platform: 'youtube' });
};
