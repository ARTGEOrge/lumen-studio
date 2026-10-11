// Draws the app icon (256x256 PNG) procedurally: gradient squircle, lens ring, sun and mountains.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const S = 256, SS = 4, px = new Float32Array(S * S * 4);
const lerp = (a, b, t) => a + (b - a) * t, mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
function shade(x, y) { // returns [r,g,b,a] for a point in 0..256 space
  const r = 56, inX = Math.min(x, S - x), inY = Math.min(y, S - y);
  let inside = true;
  if (inX < r && inY < r) inside = Math.hypot(r - inX, r - inY) <= r;
  if (x < 8 || y < 8 || x > S - 8 || y > S - 8) inside = false; else if (inX - 8 < r - 8 && inY - 8 < r - 8) inside = Math.hypot((r - 8) - (inX - 8), (r - 8) - (inY - 8)) <= r - 8;
  if (!inside) return [0, 0, 0, 0];
  let c = mix([29, 43, 100], [58, 142, 230], (x + y) / (2 * S));
  const cxp = 128, cyp = 124, d = Math.hypot(x - cxp, y - cyp);
  if (d < 78) { // lens interior: sunset scene
    c = mix([255, 190, 120], [120, 60, 160], (y - 46) / 156);
    if (Math.hypot(x - 150, y - 100) < 22) c = [255, 236, 170];
    const m1 = 168 - Math.max(0, 50 - Math.abs(x - 98)) * 1.1, m2 = 178 - Math.max(0, 46 - Math.abs(x - 160)) * 0.9;
    if (y > m2) c = [44, 30, 88]; if (y > m1) c = [30, 22, 64];
  }
  if (d >= 78 && d < 92) c = mix([245, 248, 255], [200, 220, 255], (y - 32) / 184);
  return [...c, 255];
}
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  let acc = [0, 0, 0, 0];
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const c = shade(x + (sx + .5) / SS, y + (sy + .5) / SS); acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3]; }
  const i = (y * S + x) * 4, a = acc[3] / (SS * SS);
  px[i] = acc[3] ? acc[0] / acc[3] : 0; px[i + 1] = acc[3] ? acc[1] / acc[3] : 0; px[i + 2] = acc[3] ? acc[2] / acc[3] : 0; px[i + 3] = a;
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; for (let x = 0; x < S * 4; x++) raw[y * (S * 4 + 1) + 1 + x] = Math.round(px[y * S * 4 + x]); }
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), png); fs.copyFileSync(path.join(__dirname, '..', 'build', 'icon.png'), path.join(__dirname, '..', 'src', 'icon.png'));
console.log('icon written');
