const axios = require('axios');
const generic = require('./generic');
const { extractFromInfo } = generic;

const VR_VERSION = '1.65.10';
const VR_UA = `com.google.android.apps.youtube.vr.oculus/${VR_VERSION} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip`;

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
    acodec: audio || /mp4a|opus|audio/i.test(m) ? 'aac' : video ? 'none' : 'aac',
  };
}

function infoFromPlayer(id, data) {
  const status = String(data?.playabilityStatus?.status || '');
  if (status && status !== 'OK') {
    throw new Error(data.playabilityStatus.reason || status);
  }
  const sd = data.streamingData || {};
  const raw = [...(sd.formats || []), ...(sd.adaptiveFormats || [])];
  const formats = raw
    .filter((f) => f && f.url)
    .map((f) => {
      const bits = mimeBits(f.mimeType);
      return {
        url: f.url,
        ext: bits.ext,
        width: f.width,
        height: f.height,
        filesize: Number(f.contentLength) || 0,
        acodec: bits.acodec,
        vcodec: bits.vcodec,
        protocol: 'https',
        format_id: String(f.itag || ''),
        http_headers: { 'User-Agent': VR_UA, Referer: 'https://www.youtube.com/' },
      };
    });
  if (!formats.length) throw new Error('no innertube formats');
  const details = data.videoDetails || {};
  const thumb =
    details.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  return {
    id,
    title: details.title || 'YouTube',
    uploader: details.author || details.channelId || 'youtube',
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
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': VR_UA,
    'X-YouTube-Client-Name': '28',
    'X-YouTube-Client-Version': VR_VERSION,
  };
  const urls = [
    'https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false',
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const res = await axios.post(url, body, {
        timeout: 8000,
        headers,
        validateStatus: (s) => s >= 200 && s < 500,
      });
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

module.exports = async function extract(url, opts = {}) {
  const quality = opts.quality || 'best';
  const id = videoIdFromUrl(url);
  if (id) {
    try {
      const info = await innertubePlayer(id);
      return extractFromInfo(info, quality, 'youtube');
    } catch {
      /* yt-dlp next */
    }
  }
  return generic(url, { ...opts, platform: 'youtube' });
};
