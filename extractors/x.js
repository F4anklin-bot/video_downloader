const axios = require('axios');
const generic = require('./generic');
const { browserHeaders } = require('../utils/headers');
const { buildResult } = require('../utils/downloader');

function tweetId(url) {
  const m = String(url).match(/(?:status|statuses)\/(\d+)/i);
  return m?.[1] || null;
}

async function syndication(url) {
  const id = tweetId(url);
  if (!id) throw new Error('no tweet id');
  const res = await axios.get('https://cdn.syndication.twimg.com/tweet-result', {
    params: { id, lang: 'fr', token: '0' },
    headers: browserHeaders('https://x.com/'),
    timeout: 12000,
  });
  const tweet = res.data;
  const variants = tweet?.video?.variants || tweet?.mediaDetails?.find((m) => m.type === 'video' || m.type === 'animated_gif')?.video_info?.variants || [];
  const mp4s = variants.filter((v) => (v.content_type || v.type) === 'video/mp4' && v.url).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (!mp4s.length) throw new Error('no x video');
  const chosen = mp4s[0];
  const author = tweet.user?.screen_name || tweet.user?.name || 'x';
  const built = buildResult(
    {
      title: (tweet.text || 'Post X').slice(0, 80),
      uploader: author,
      thumbnail: tweet.mediaDetails?.[0]?.media_url_https || '',
      timestamp: tweet.created_at ? Date.parse(tweet.created_at) / 1000 : undefined,
      ext: 'mp4',
    },
    { url: chosen.url, ext: 'mp4' },
    'x',
    'best',
  );
  return {
    ...built,
    videoUrl: chosen.url,
    httpHeaders: browserHeaders('https://x.com/'),
    needsMerge: false,
  };
}

module.exports = async function extract(url, opts = {}) {
  try {
    return await syndication(url);
  } catch {
    return generic(url, { ...opts, platform: 'x' });
  }
};
