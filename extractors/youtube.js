const https = require('https');
const axios = require('axios');
const generic = require('./generic');
const { extractFromInfo } = generic;
const { buildResult } = require('../utils/downloader');

const VR_VERSION = '1.65.10';
const VR_UA = `com.google.android.apps.youtube.vr.oculus/${VR_VERSION} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip`;
const ipv4Agent = process.platform === 'win32' ? undefined : new https.Agent({ family: 4, keepAlive: false });

function axOpts(extra = {}) {
  return {
    timeout: 5000,
    ...(ipv4Agent ? { httpsAgent: ipv4Agent } : {}),
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
  return {
    ext: m.includes('webm') ? 'webm' : 'mp4',
    vcodec: video ? 'avc1' : 'none',
    acodec: /mp4a|opus|audio/i.test(m) || !video ? 'aac' : 'none',
  };
}

function mapFormats(raw, ua) {
  return (raw || [])
    .filter((f) => f && f.url)
    .map((f) => {
      const bits = mimeBits(f.mimeType || f.type || '');
      const height = Number(String(f.qualityLabel || f.quality || '').replace(/[^\d]/g, '')) || f.height || 0;
      return {
        url: f.url,
        ext: bits.ext,
        width: f.width,
        height: f.height || height,
        filesize: Number(f.contentLength || f.clen) || 0,
        acodec: f.videoOnly ? 'none' : bits.acodec,
        vcodec: f.audioOnly ? 'none' : bits.vcodec,
        protocol: String(f.url).includes('.m3u8') ? 'm3u8' : 'https',
        format_id: String(f.itag || f.quality || ''),
        http_headers: { 'User-Agent': ua, Referer: 'https://www.youtube.com/' },
      };
    });
}

function infoFromPlayer(id, data) {
  const status = String(data?.playabilityStatus?.status || '');
  if (status && status !== 'OK') {
    throw new Error(data.playabilityStatus.reason || status);
  }
  const sd = data.streamingData || {};
  const formats = mapFormats([...(sd.formats || []), ...(sd.adaptiveFormats || [])], VR_UA);
  if (!formats.length && sd.hlsManifestUrl) {
    formats.push({
      url: sd.hlsManifestUrl,
      ext: 'mp4',
      protocol: 'm3u8',
      acodec: 'aac',
      vcodec: 'avc1',
      height: 720,
      http_headers: { 'User-Agent': VR_UA, Referer: 'https://www.youtube.com/' },
    });
  }
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
  const res = await axios.post('https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false', body, axOpts({
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': VR_UA,
      'X-YouTube-Client-Name': '28',
      'X-YouTube-Client-Version': VR_VERSION,
    },
    validateStatus: (s) => s >= 200 && s < 500,
  }));
  if (res.status >= 400) throw new Error(`innertube ${res.status}`);
  return infoFromPlayer(id, res.data);
}

async function pipedInfo(id) {
  const tryBase = async (base) => {
    const res = await axios.get(`${base}/streams/${id}`, axOpts({
      headers: { Accept: 'application/json', 'User-Agent': 'franklins/1.0' },
      validateStatus: (s) => s >= 200 && s < 500,
    }));
    if (res.status >= 400 || !res.data?.title) throw new Error(`${base} ${res.status}`);
    const data = res.data;
    const streams = [...(data.videoStreams || []), ...(data.audioStreams || [])];
    const formats = mapFormats(
      streams.map((s) => ({
        url: s.url,
        mimeType: s.mimeType || s.format,
        qualityLabel: s.quality,
        height: Number(String(s.quality || '').replace(/[^\d]/g, '')) || 0,
        videoOnly: s.videoOnly,
        itag: s.itag,
      })),
      'franklins/1.0',
    );
    if (!formats.length && data.hls) {
      formats.push({
        url: data.hls,
        ext: 'mp4',
        protocol: 'm3u8',
        acodec: 'aac',
        vcodec: 'avc1',
        height: 720,
      });
    }
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

async function oembedInfo(id) {
  const { data } = await axios.get('https://noembed.com/embed', {
    params: { url: `https://www.youtube.com/watch?v=${id}` },
    timeout: 6000,
    ...(ipv4Agent ? { httpsAgent: ipv4Agent } : {}),
  });
  if (!data?.title) throw new Error('noembed empty');
  return {
    id,
    title: data.title,
    uploader: data.author_name || 'youtube',
    thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    duration: 0,
    ext: 'mp4',
    webpage_url: `https://www.youtube.com/watch?v=${id}`,
    formats: [],
  };
}

function fromMeta(info, quality) {
  if (info.formats?.length) return extractFromInfo(info, quality, 'youtube');
  const result = buildResult(info, { url: null, ext: 'mp4' }, 'youtube', quality);
  result.formats = [];
  result.needsMerge = true;
  return result;
}

module.exports = async function extract(url, opts = {}) {
  const quality = opts.quality || 'best';
  const id = videoIdFromUrl(url);
  if (!id) return generic(url, { ...opts, platform: 'youtube' });

  const steps = [innertubePlayer, pipedInfo, oembedInfo];
  for (const step of steps) {
    try {
      const info = await step(id);
      return fromMeta(info, quality);
    } catch {
      /* next */
    }
  }

  try {
    return await generic(url, { ...opts, platform: 'youtube' });
  } catch (err) {
    if (err && err.code) throw err;
    throw new Error('YouTube extraction failed');
  }
};
