const platforms = require('../config/platforms');

const PATTERNS = [
  { id: 'tiktok', re: /(?:https?:\/\/)?(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\//i },
  { id: 'instagram', re: /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\//i },
  { id: 'x', re: /(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\//i },
  { id: 'snapchat', re: /(?:https?:\/\/)?(?:www\.|story\.|t\.)?snapchat\.com\//i },
  { id: 'youtube', re: /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i },
  { id: 'reddit', re: /(?:https?:\/\/)?(?:www\.|old\.|m\.)?(?:reddit\.com|redd\.it)\//i },
  { id: 'facebook', re: /(?:https?:\/\/)?(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\//i },
  { id: 'vimeo', re: /(?:https?:\/\/)?(?:www\.|player\.)?vimeo\.com\//i },
  { id: 'dailymotion', re: /(?:https?:\/\/)?(?:www\.)?(?:dailymotion\.com|dai\.ly)\//i },
  { id: 'twitch', re: /(?:https?:\/\/)?(?:www\.|clips\.)?twitch\.tv\//i },
];

function extractUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.;]+$/, '') : text.trim();
}

function normalizeUrl(raw) {
  const extracted = extractUrl(raw);
  if (!extracted) return null;
  let withProto = extracted;
  if (!/^https?:\/\//i.test(withProto)) withProto = 'https://' + withProto;
  let parsed;
  try {
    parsed = new URL(withProto);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (!parsed.hostname.includes('.') || parsed.hostname === 'localhost') {
    if (parsed.hostname !== 'localhost') return null;
  }
  [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'si', 'feature', 'ref', 'fbclid', 'igshid', 'igsh', 'tt_from',
    'is_from_webapp', 'sender_device', 'sender_web_id',
    'list', 'index', 'start_radio', 'pp', 'playnext',
  ].forEach((p) => {
    parsed.searchParams.delete(p);
  });
  parsed.hash = '';
  return canonicalize(parsed);
}

function canonicalize(parsed) {
  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = parsed.pathname.replace(/^\//, '').split('/')[0];
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const shorts = parsed.pathname.match(/\/shorts\/([^/]+)/);
    if (shorts) return `https://www.youtube.com/watch?v=${shorts[1]}`;
    const embed = parsed.pathname.match(/\/embed\/([^/]+)/);
    if (embed) return `https://www.youtube.com/watch?v=${embed[1]}`;
    const v = parsed.searchParams.get('v');
    if (v) return `https://www.youtube.com/watch?v=${v}`;
  }
  return parsed.toString();
}

function detectPlatform(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return { platform: null, url: null };
  for (const { id, re } of PATTERNS) {
    if (re.test(normalized)) {
      return { platform: id, url: normalized, meta: platforms[id] };
    }
  }
  return { platform: 'generic', url: normalized, meta: platforms.generic };
}

function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

module.exports = { extractUrl, normalizeUrl, detectPlatform, isValidHttpUrl, PATTERNS };
