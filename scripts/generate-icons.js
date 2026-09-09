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

function icon(x, y, s) {
  const cx = s / 2;
  const cy = s / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const bg = [8, 8, 10, 255];
  const lime = [209, 249, 82, 255];
  const ink = [245, 245, 244, 255];

  const ringOuter = s * 0.32;
  const ringInner = s * 0.24;
  const core = s * 0.08;

  if (dist < core) return lime;
  if (dist < ringInner) return bg;
  if (dist < ringOuter) {
    const t = (ringOuter - dist) / (ringOuter - ringInner);
    if (t > 0.12 && t < 0.88) return lime;
    return bg;
  }

  const px = dx / s;
  const py = dy / s;
  if (px > -0.02 && px < 0.14 && Math.abs(py) < 0.11) {
    const inTri = py > (px - 0.12) * 1.6 && py < -(px - 0.12) * 1.6 && px > -0.02;
    if (inTri && dist > ringInner && dist < ringOuter * 0.98) return ink;
  }

  const radius = s * 0.48;
  if (dist > radius) {
    const fade = Math.min(1, (dist - radius) / (s * 0.02));
    return [8, 8, 10, Math.round(255 * (1 - fade))];
  }
  return bg;
}

const sizes = [32, 180, 192, 512];
for (const size of sizes) {
  const name = size === 32 ? 'favicon.png' : size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  fs.writeFileSync(path.join(OUT, name), png(size, icon));
}
console.log('Icônes générées dans public/icons');
