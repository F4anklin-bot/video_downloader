const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

const LISTS = [
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
  'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=5000&country=all',
];

let cached = null;
let cachedAt = 0;
let searching = null;
const TTL_MS = 12 * 60 * 1000;
const SEARCH_BUDGET_MS = 45000;

async function fetchPool(limit = 100) {
  const set = new Set();
  await Promise.all(
    LISTS.map(async (url) => {
      try {
        const { data } = await axios.get(url, { timeout: 8000, responseType: 'text', validateStatus: () => true });
        String(data || '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l))
          .forEach((l) => set.add(l));
      } catch {
        /* ignore list */
      }
    }),
  );
  return [...set].sort(() => Math.random() - 0.5).slice(0, limit);
}

async function probeYoutube(proxy) {
  const agent = new SocksProxyAgent(`socks5h://${proxy}`);
  const body = {
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.65.10',
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        androidSdkVersion: 32,
        osName: 'Android',
        osVersion: '12L',
        hl: 'en',
        gl: 'US',
      },
    },
    videoId: 'jNQXAC9IVRw',
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const res = await axios.post('https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false', body, {
    timeout: 5000,
    httpAgent: agent,
    httpsAgent: agent,
    proxy: false,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
      'X-YouTube-Client-Name': '28',
      'X-YouTube-Client-Version': '1.65.10',
    },
    validateStatus: () => true,
  });
  const status = res.data?.playabilityStatus?.status;
  const formats = [
    ...(res.data?.streamingData?.formats || []),
    ...(res.data?.streamingData?.adaptiveFormats || []),
  ].filter((f) => f.url);
  if (status === 'OK' && formats.length) return `socks5h://${proxy}`;
  return null;
}

async function searchOnce() {
  const started = Date.now();
  const pool = await fetchPool(120);
  if (!pool.length) return null;

  const concurrency = 30;
  for (let i = 0; i < pool.length; i += concurrency) {
    if (Date.now() - started > SEARCH_BUDGET_MS) break;
    const batch = pool.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((p) => probeYoutube(p).catch(() => null)));
    const hit = results.find(Boolean);
    if (hit) {
      cached = hit;
      cachedAt = Date.now();
      return hit;
    }
  }
  return null;
}

async function findFreeSocks() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (searching) return searching;
  searching = searchOnce()
    .catch(() => null)
    .finally(() => {
      searching = null;
    });
  return searching;
}

function clearProxyCache() {
  cached = null;
  cachedAt = 0;
}

/** Warm cache in background after boot (non-blocking). */
function warmSocksFarm() {
  setTimeout(() => {
    findFreeSocks().catch(() => {});
  }, 2000);
}

module.exports = { findFreeSocks, clearProxyCache, warmSocksFarm };
