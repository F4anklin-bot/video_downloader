const axios = require('axios');
const cheerio = require('cheerio');
const generic = require('./generic');
const { browserHeaders } = require('../utils/headers');
const { buildResult } = require('../utils/downloader');

async function scrapeTiktok(url) {
  const res = await axios.get(url, {
    headers: browserHeaders(url),
    timeout: 15000,
    maxRedirects: 5,
  });
  const html = res.data;
  const $ = cheerio.load(html);

  const ld = $('script[type="application/ld+json"]').first().text();
  if (ld) {
    try {
      const json = JSON.parse(ld);
      const video = json['@type'] === 'VideoObject' ? json : (json['@graph'] || []).find((n) => n['@type'] === 'VideoObject');
      if (video?.contentUrl) {
        return {
          platform: 'tiktok',
          videoUrl: video.contentUrl,
          thumbnail: video.thumbnailUrl || '',
          title: video.name || video.description || 'TikTok',
          author: video.author?.name || video.creator?.name || 'tiktok',
          duration: parseDuration(video.duration),
          quality: 'HD',
          filename: '',
          filesize: 0,
          ext: 'mp4',
          httpHeaders: { Referer: 'https://www.tiktok.com/' },
          needsMerge: false,
        };
      }
    } catch {
      /* continue */
    }
  }

  const uni = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (uni?.[1]) {
    try {
      const data = JSON.parse(uni[1]);
      const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
      const video = item?.video;
      const play = video?.playAddr || video?.downloadAddr;
      if (play) {
        return {
          platform: 'tiktok',
          videoUrl: play,
          thumbnail: video.cover || video.originCover || '',
          title: item.desc || 'TikTok',
          author: item.author?.uniqueId || item.author?.nickname || 'tiktok',
          duration: video.duration || 0,
          quality: video.ratio || 'HD',
          filename: '',
          filesize: video.size || 0,
          ext: 'mp4',
          httpHeaders: { Referer: 'https://www.tiktok.com/' },
          needsMerge: false,
        };
      }
    } catch {
      /* continue */
    }
  }

  throw new Error('tiktok scrape miss');
}

function parseDuration(iso) {
  if (!iso) return 0;
  if (typeof iso === 'number') return iso;
  const m = String(iso).match(/PT(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return 0;
  return (parseInt(m[1] || '0', 10) * 60) + parseInt(m[2] || '0', 10);
}

module.exports = async function extract(url, opts = {}) {
  try {
    const result = await scrapeTiktok(url);
    if (!result.filename) {
      const fake = buildResult(
        { title: result.title, uploader: result.author, duration: result.duration, thumbnail: result.thumbnail, timestamp: Date.now() / 1000, ext: 'mp4' },
        { url: result.videoUrl, ext: 'mp4' },
        'tiktok',
        opts.quality,
      );
      return { ...fake, ...result, filename: fake.filename };
    }
    return result;
  } catch {
    return generic(url, { ...opts, platform: 'tiktok' });
  }
};
