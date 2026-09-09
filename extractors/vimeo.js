const axios = require('axios');
const generic = require('./generic');
const { buildResult } = require('../utils/downloader');

async function vimeoConfig(url) {
  const idMatch = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (!idMatch) throw new Error('no vimeo id');
  const res = await axios.get(`https://player.vimeo.com/video/${idMatch[1]}/config`, { timeout: 12000 });
  const cfg = res.data;
  const files = cfg?.request?.files?.progressive || [];
  const sorted = files.sort((a, b) => (b.height || 0) - (a.height || 0));
  if (!sorted[0]?.url) throw new Error('no vimeo file');
  const video = cfg.video || {};
  return {
    ...buildResult(
      {
        title: video.title,
        uploader: video.owner?.name,
        thumbnail: video.thumbs?.base || video.thumbnail_url,
        duration: video.duration,
        ext: 'mp4',
      },
      { url: sorted[0].url, ext: 'mp4', height: sorted[0].height },
      'vimeo',
      'best',
    ),
    videoUrl: sorted[0].url,
    needsMerge: false,
  };
}

module.exports = async function extract(url, opts = {}) {
  try {
    return await vimeoConfig(url);
  } catch {
    return generic(url, { ...opts, platform: 'vimeo' });
  }
};
