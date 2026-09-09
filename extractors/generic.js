const axios = require('axios');
const { execJson } = require('../utils/ytdlp');
const { pickFormat, buildResult, withRetry } = require('../utils/downloader');
const { mapYtdlpError } = require('../utils/errors');

module.exports = async function extract(url, { quality = 'best', platform = 'generic' } = {}) {
  try {
    const info = await withRetry(() => execJson(url), 1);
    if (info._type === 'playlist' && Array.isArray(info.entries) && info.entries[0]) {
      return extractFromInfo(info.entries[0], quality, platform);
    }
    return extractFromInfo(info, quality, platform);
  } catch (err) {
    throw mapYtdlpError(err);
  }
};

function extractFromInfo(info, quality, platform) {
  const format = pickFormat(info, quality);
  const result = buildResult(info, format, platform, quality);
  result.formats = summarizeFormats(info);
  return result;
}

function summarizeFormats(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const heights = [...new Set(formats.map((f) => f.height).filter(Boolean))].sort((a, b) => b - a);
  return heights.slice(0, 6).map((h) => ({
    id: `${h}p`,
    label: h >= 1080 ? `${h}p HD` : `${h}p`,
    height: h,
  }));
}

async function probe(url) {
  try {
    const res = await axios.head(url, { timeout: 8000, maxRedirects: 5, validateStatus: () => true });
    return res.status < 400;
  } catch {
    return false;
  }
}

module.exports.extractFromInfo = extractFromInfo;
module.exports.probe = probe;
