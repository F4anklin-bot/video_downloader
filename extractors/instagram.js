const axios = require('axios');
const generic = require('./generic');
const { browserHeaders } = require('../utils/headers');

async function rapidApi(url) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error('no rapidapi');
  const res = await axios.get('https://instagram-downloader-download-instagram-videos-stories.p.rapidapi.com/index', {
    params: { url },
    headers: {
      'X-RapidAPI-Key': key,
      'X-RapidAPI-Host': 'instagram-downloader-download-instagram-videos-stories.p.rapidapi.com',
    },
    timeout: 20000,
  });
  const data = res.data;
  const videoUrl = data?.media || data?.video_url || data?.[0]?.video_url;
  if (!videoUrl) throw new Error('no ig url');
  return {
    platform: 'instagram',
    videoUrl,
    thumbnail: data.thumb || data.thumbnail || '',
    title: data.title || 'Instagram',
    author: (data.username || 'instagram').replace(/^@/, ''),
    duration: 0,
    quality: 'HD',
    filename: '',
    filesize: 0,
    ext: 'mp4',
    httpHeaders: browserHeaders('https://www.instagram.com/'),
    needsMerge: false,
  };
}

module.exports = async function extract(url, opts = {}) {
  if (process.env.RAPIDAPI_KEY) {
    try {
      const result = await rapidApi(url);
      const genericBuild = require('../utils/downloader').buildResult;
      const named = genericBuild(
        { title: result.title, uploader: result.author, thumbnail: result.thumbnail, ext: 'mp4' },
        { url: result.videoUrl, ext: 'mp4' },
        'instagram',
        opts.quality,
      );
      return { ...named, ...result, filename: named.filename };
    } catch {
      /* fallback */
    }
  }
  return generic(url, { ...opts, platform: 'instagram' });
};
