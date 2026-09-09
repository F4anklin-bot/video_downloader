const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Safari/537.36',
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function browserHeaders(url = '', extra = {}) {
  let origin = 'https://www.google.com';
  try {
    origin = new URL(url).origin;
  } catch {
    /* ignore */
  }
  return {
    'User-Agent': pickUserAgent(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    Referer: origin + '/',
    Origin: origin,
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
    ...extra,
  };
}

function mediaHeaders(url = '', extra = {}) {
  return {
    ...browserHeaders(url, {
      Accept: '*/*',
      ...extra,
    }),
  };
}

module.exports = { USER_AGENTS, pickUserAgent, browserHeaders, mediaHeaders };
