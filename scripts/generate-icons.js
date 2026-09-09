const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

function png(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = paint(x, y, size);
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function inRoundRect(px, py, x, y, w, h, r) {
  const hw = w / 2;
  const hh = h / 2;
  const dx = Math.abs(px - (x + hw)) - hw + r;
  const dy = Math.abs(py - (y + hh)) - hh + r;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r <= 0;
}

function icon(x, y, s) {
  const lime = [212, 240, 79, 255];
  const bg = [8, 8, 10, 255];
  const radius = s * 0.21;
  const inBg = inRoundRect(x, y, 0, 0, s, s, radius);

  const stem = inRoundRect(x, y, s * 0.23, s * 0.18, s * 0.175, s * 0.64, s * 0.06);
  const top = inRoundRect(x, y, s * 0.23, s * 0.18, s * 0.57, s * 0.175, s * 0.06);
  const mid = inRoundRect(x, y, s * 0.23, s * 0.455, s * 0.42, s * 0.16, s * 0.06);

  if (stem || top || mid) {
    if (!inBg) {
      const fade = Math.min(1, Math.max(0, 1 - (Math.hypot(x - s / 2, y - s / 2) - s * 0.48) / (s * 0.03)));
      return [lime[0], lime[1], lime[2], Math.round(255 * fade)];
    }
    return lime;
  }
  if (!inBg) return [8, 8, 10, 0];
  return bg;
}

const sizes = [32, 180, 192, 512];
for (const size of sizes) {
  const name = size === 32 ? 'favicon.png' : size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  fs.writeFileSync(path.join(OUT, name), png(size, icon));
}
console.log('Icônes générées dans public/icons');
