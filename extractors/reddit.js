const axios = require('axios');
const generic = require('./generic');
const { browserHeaders } = require('../utils/headers');
const { buildResult } = require('../utils/downloader');

function toJsonUrl(url) {
  const u = new URL(url);
  if (u.hostname.includes('redd.it')) return url;
  if (u.pathname.endsWith('.json')) return u.toString();
  u.pathname = u.pathname.replace(/\/$/, '') + '.json';
  u.searchParams.set('raw_json', '1');
  return u.toString();
}

async function redditJson(url) {
  const res = await axios.get(toJsonUrl(url), {
    headers: { ...browserHeaders(url), Accept: 'application/json' },
    timeout: 12000,
  });
  const post = res.data?.[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error('no reddit post');
  const media = post.secure_media || post.media;
  const redditVideo = media?.reddit_video;
  let videoUrl = redditVideo?.fallback_url || post.url_overridden_by_dest;
  if (post.is_reddit_media_domain && post.preview?.reddit_video_preview?.fallback_url) {
    videoUrl = post.preview.reddit_video_preview.fallback_url;
  }
  if (!videoUrl || !/\.(mp4|gif)/i.test(videoUrl) && !redditVideo) {
    throw new Error('no reddit video');
  }
  const built = buildResult(
    {
      title: post.title,
      uploader: post.author,
      thumbnail: post.thumbnail && post.thumbnail.startsWith('http') ? post.thumbnail : post.preview?.images?.[0]?.source?.url,
      duration: redditVideo?.duration,
      ext: 'mp4',
    },
    { url: videoUrl, ext: 'mp4', filesize: redditVideo?.duration ? undefined : undefined },
    'reddit',
    'best',
  );
  return {
    ...built,
    videoUrl,
    needsMerge: Boolean(redditVideo?.has_audio),
    httpHeaders: browserHeaders('https://www.reddit.com/'),
  };
}

module.exports = async function extract(url, opts = {}) {
  try {
    const result = await redditJson(url);
    if (result.needsMerge) return generic(url, { ...opts, platform: 'reddit' });
    return result;
  } catch {
    return generic(url, { ...opts, platform: 'reddit' });
  }
};
