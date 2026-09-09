const axios = require('axios');
const generic = require('./generic');
const { buildResult } = require('../utils/downloader');

function videoId(url) {
  const m = String(url).match(/(?:dailymotion\.com\/video\/|dai\.ly\/)([a-zA-Z0-9]+)/);
  return m?.[1] || null;
}

async function dmApi(url) {
  const id = videoId(url);
  if (!id) throw new Error('no dm id');
  const res = await axios.get(`https://www.dailymotion.com/player/metadata/video/${id}`, { timeout: 12000 });
  const data = res.data;
  const qualities = data?.qualities || {};
  const auto = qualities.auto?.[0]?.url;
  if (!auto && !Object.keys(qualities).length) throw new Error('no dm media');
  return {
    ...buildResult(
      {
        title: data.title,
        uploader: data.owner?.username || data.owner?.screenname,
        thumbnail: data.poster_url || data.thumbnails?.['480'],
        duration: data.duration,
        ext: 'mp4',
      },
      { url: auto || '', ext: 'mp4' },
      'dailymotion',
      'best',
    ),
    videoUrl: auto || null,
    needsMerge: true,
  };
}

module.exports = async function extract(url, opts = {}) {
  try {
    const result = await dmApi(url);
    if (result.needsMerge) return generic(url, { ...opts, platform: 'dailymotion' });
    return result;
  } catch {
    return generic(url, { ...opts, platform: 'dailymotion' });
  }
};
