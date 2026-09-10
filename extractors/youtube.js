const https = require('https');
const axios = require('axios');
const generic = require('./generic');
const { extractFromInfo } = generic;
const { resolveProxy } = require('../utils/ytdlp');

const VR_VERSION = '1.65.10';
const VR_UA = `com.google.android.apps.youtube.vr.oculus/${VR_VERSION} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip`;
const ipv4Agent = process.platform === 'win32' ? undefined : new https.Agent({ family: 4, keepAlive: false });

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

const PIPED = [
  'https://pipedapi.adminforge.de',
  'https://pipedapi.reallyaweso.me',
  'https://api.piped.private.coffee',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.kavin.rocks',
];

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
  const clients = [
    {
      clientName: 'ANDROID_VR',
      clientVersion: VR_VERSION,
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12L',
      ua: VR_UA,
      name: '28',
    },
    {
      clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      clientVersion: '2.0',
      clientScreen: 'EMBED',
      ua: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
      name: '85',
    },
  ];
  let lastErr;
  for (const c of clients) {
    try {
      const { ua, name, ...client } = c;
      const body = {
        context: { client: { ...client, hl: 'en', gl: 'US', utcOffsetMinutes: 0 } },
        videoId: id,
        contentCheckOk: true,
        racyCheckOk: true,
        ...(c.clientName.includes('EMBED')
          ? { thirdParty: { embedUrl: 'https://www.youtube.com' } }
          : {}),
      };
      const res = await axios.post(
        'https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false',
        body,
        axOpts({
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': ua,
            'X-YouTube-Client-Name': name,
            'X-YouTube-Client-Version': client.clientVersion,
          },
          validateStatus: (s) => s >= 200 && s < 500,
        }),
      );
      if (res.status >= 400) {
        lastErr = new Error(`innertube ${res.status}`);
        continue;
      }
      return infoFromPlayer(id, res.data);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('innertube failed');
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
    const streams = [...(data.videoStreams || [])];
    const formats = preferMuxed(
      mapFormats(
        streams.map((s) => ({
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

module.exports = async function extract(url, opts = {}) {
  const quality = opts.quality || 'best';
  const id = videoIdFromUrl(url);
  const hasProxy = Boolean(resolveProxy());

  // With WARP/proxy, yt-dlp is the most reliable path on cloud IPs.
  if (hasProxy) {
    try {
      return await generic(url, { ...opts, platform: 'youtube' });
    } catch {
      /* fall through to other methods */
    }
  }

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

  return generic(url, { ...opts, platform: 'youtube' });
};
