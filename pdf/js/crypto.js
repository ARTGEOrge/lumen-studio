// Small, dependency-free crypto primitives for the PDF Standard Security Handler:
// MD5, RC4, AES-128/256 (ECB block + CBC with/without PKCS#7 padding), SHA-256 (sync) and
// SHA-384/512 via WebCrypto. Verified against known-answer tests in the test suite.

export const enc = new TextEncoder();
export function concat(...arrs) { let n = 0; for (const a of arrs) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }
export function randomBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
export const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
export const fromHex = h => { const out = new Uint8Array(h.length >> 1); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out; };

/* ---------- MD5 ---------- */
const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = new Int32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
export function md5(data) {
  const n = data.length, padLen = ((n + 8) >> 6) + 1 << 6;
  const buf = new Uint8Array(padLen); buf.set(data); buf[n] = 0x80;
  const bits = n * 8; for (let i = 0; i < 4; i++) buf[padLen - 8 + i] = (bits >>> (8 * i)) & 255; buf[padLen - 4] = Math.floor(n / 536870912) & 255;
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = buf[off + i * 4] | buf[off + i * 4 + 1] << 8 | buf[off + i * 4 + 2] << 16 | buf[off + i * 4 + 3] << 24;
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; } else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      const t = D; D = C; C = B;
      const x = (A + F + MD5_K[i] + M[g]) | 0; B = (B + ((x << MD5_S[i]) | (x >>> (32 - MD5_S[i])))) | 0; A = t;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16); [a0, b0, c0, d0].forEach((v, k) => { for (let i = 0; i < 4; i++) out[k * 4 + i] = (v >>> (8 * i)) & 255; });
  return out;
}

/* ---------- RC4 ---------- */
export function rc4(key, data) {
  const S = new Uint8Array(256); for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + S[i]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; out[k] = data[k] ^ S[(S[i] + S[j]) & 255]; }
  return out;
}

/* ---------- AES ---------- */
const SBOX = new Uint8Array(256), INV = new Uint8Array(256);
(() => {
  let p = 1, q = 1;
  do {
    p = p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0); p &= 255;
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 255; if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 255;
  } while (p !== 1);
  SBOX[0] = 0x63; for (let i = 0; i < 256; i++) INV[SBOX[i]] = i;
})();
const xt = b => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 255;
const gm = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r; };
function expandKey(key) {
  const Nk = key.length / 4, Nr = Nk + 6, W = new Uint8Array(16 * (Nr + 1)); W.set(key);
  let rcon = 1;
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let t = W.slice((i - 1) * 4, i * 4);
    if (i % Nk === 0) { t = new Uint8Array([SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]]); rcon = xt(rcon); }
    else if (Nk > 6 && i % Nk === 4) t = t.map(x => SBOX[x]);
    for (let j = 0; j < 4; j++) W[i * 4 + j] = W[(i - Nk) * 4 + j] ^ t[j];
  }
  return { W, Nr };
}
function encBlock(ks, b) {
  const { W, Nr } = ks; const s = new Uint8Array(16); for (let i = 0; i < 16; i++) s[i] = b[i] ^ W[i];
  const t = new Uint8Array(16);
  for (let r = 1; r <= Nr; r++) {
    for (let i = 0; i < 16; i++) t[i] = SBOX[s[(i + 4 * (i % 4)) % 16]]; // SubBytes + ShiftRows
    if (r < Nr) for (let c = 0; c < 4; c++) { const a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3]; s[c * 4] = xt(a0) ^ xt(a1) ^ a1 ^ a2 ^ a3; s[c * 4 + 1] = a0 ^ xt(a1) ^ xt(a2) ^ a2 ^ a3; s[c * 4 + 2] = a0 ^ a1 ^ xt(a2) ^ xt(a3) ^ a3; s[c * 4 + 3] = xt(a0) ^ a0 ^ a1 ^ a2 ^ xt(a3); }
    else s.set(t);
    for (let i = 0; i < 16; i++) s[i] ^= W[r * 16 + i];
  }
  return s;
}
function decBlock(ks, b) {
  const { W, Nr } = ks; const s = new Uint8Array(16); for (let i = 0; i < 16; i++) s[i] = b[i] ^ W[Nr * 16 + i];
  const t = new Uint8Array(16);
  for (let r = Nr - 1; r >= 0; r--) {
    for (let i = 0; i < 16; i++) t[(i + 4 * (i % 4)) % 16] = INV[s[i]]; // InvShiftRows + InvSubBytes
    for (let i = 0; i < 16; i++) t[i] ^= W[r * 16 + i];
    if (r > 0) for (let c = 0; c < 4; c++) { const a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3]; s[c * 4] = gm(a0, 14) ^ gm(a1, 11) ^ gm(a2, 13) ^ gm(a3, 9); s[c * 4 + 1] = gm(a0, 9) ^ gm(a1, 14) ^ gm(a2, 11) ^ gm(a3, 13); s[c * 4 + 2] = gm(a0, 13) ^ gm(a1, 9) ^ gm(a2, 14) ^ gm(a3, 11); s[c * 4 + 3] = gm(a0, 11) ^ gm(a1, 13) ^ gm(a2, 9) ^ gm(a3, 14); }
    else s.set(t);
  }
  return s;
}
export function aesEcbEncrypt(key, block) { return encBlock(expandKey(key), block); }
export function aesCbcEncrypt(key, iv, data, pad = true) {
  const ks = expandKey(key); let n = data.length; let src = data;
  if (pad) { const p = 16 - (n % 16); src = new Uint8Array(n + p); src.set(data); src.fill(p, n); n += p; }
  else if (n % 16) throw new Error('AES: data not block aligned');
  const out = new Uint8Array(n); let prev = iv;
  for (let o = 0; o < n; o += 16) { const b = new Uint8Array(16); for (let i = 0; i < 16; i++) b[i] = src[o + i] ^ prev[i]; prev = encBlock(ks, b); out.set(prev, o); }
  return out;
}
export function aesCbcDecrypt(key, iv, data, pad = true) {
  const ks = expandKey(key); const n = data.length - (data.length % 16); const out = new Uint8Array(n); let prev = iv;
  for (let o = 0; o < n; o += 16) { const blk = data.subarray(o, o + 16); const d = decBlock(ks, blk); for (let i = 0; i < 16; i++) out[o + i] = d[i] ^ prev[i]; prev = blk; }
  if (!pad || !n) return out;
  const p = out[n - 1]; if (p >= 1 && p <= 16 && out.subarray(n - p).every(x => x === p)) return out.subarray(0, n - p);
  return out; // tolerate bad padding (some writers)
}

/* ---------- SHA-256 (sync) + SHA-2 via WebCrypto ---------- */
const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256(data) {
  const n = data.length, padLen = ((n + 9 + 63) >> 6) << 6; const buf = new Uint8Array(padLen); buf.set(data); buf[n] = 0x80;
  const bits = n * 8; const dv = new DataView(buf.buffer); dv.setUint32(padLen - 4, bits >>> 0); dv.setUint32(padLen - 8, Math.floor(bits / 4294967296));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]); const w = new Uint32Array(64);
  const rotr = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < padLen; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32); const ov = new DataView(out.buffer); H.forEach((v, i) => ov.setUint32(i * 4, v)); return out;
}
export async function digest(alg, data) { return new Uint8Array(await crypto.subtle.digest(alg, data)); }
