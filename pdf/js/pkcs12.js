// PKCS#12 (.p12/.pfx) import/export for Digital IDs, plus passphrase encryption of private keys
// at rest. Supports PBES2 (PBKDF2-HMAC-SHA1/224/256/384/512 + AES-128/192/256-CBC or 3DES-CBC) and
// the legacy PKCS#12 PBE schemes (SHA1 + 3-key/2-key 3DES, SHA1 + RC2-40/RC2-128), MAC verification
// with the PKCS#12 key-derivation function. Export writes PBES2/AES-256 + HMAC-SHA256 (OpenSSL 3 style).
import * as A from './asn1.js';
import { concat, randomBytes, sha256, aesCbcDecrypt, aesCbcEncrypt, enc, hex } from './crypto.js';

/* ---------- SHA-1 (sync, for the PKCS#12 KDF) ---------- */
export function sha1(data) {
  const n = data.length, padLen = ((n + 9 + 63) >> 6) << 6; const buf = new Uint8Array(padLen); buf.set(data); buf[n] = 0x80;
  const dv = new DataView(buf.buffer); dv.setUint32(padLen - 4, (n * 8) >>> 0); dv.setUint32(padLen - 8, Math.floor(n * 8 / 4294967296));
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0; const w = new Uint32Array(80);
  const rol = (x, k) => (x << k) | (x >>> (32 - k));
  for (let o = 0; o < padLen; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5A827999 : i < 40 ? 0x6ED9EBA1 : i < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
      const t = (rol(a, 5) + f + e + k + w[i]) | 0; e = d; d = c; c = rol(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const out = new Uint8Array(20); const ov = new DataView(out.buffer); [h0, h1, h2, h3, h4].forEach((v, i) => ov.setUint32(i * 4, v >>> 0)); return out;
}

/* ---------- DES / 3DES ---------- */
const IP = [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7];
const FP = [40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25];
const E = [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1];
const PP = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25];
const PC1 = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4];
const PC2 = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32];
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const SB = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11]
];
const toBits = b => { const out = new Uint8Array(b.length * 8); for (let i = 0; i < out.length; i++) out[i] = (b[i >> 3] >> (7 - (i & 7))) & 1; return out; };
const fromBits = bits => { const out = new Uint8Array(bits.length >> 3); for (let i = 0; i < bits.length; i++) out[i >> 3] |= bits[i] << (7 - (i & 7)); return out; };
const perm = (bits, table) => table.map(p => bits[p - 1]);
function desSubkeys(key) {
  const k = perm(toBits(key), PC1); let C = k.slice(0, 28), D = k.slice(28); const out = [];
  for (const s of SHIFTS) { C = C.slice(s).concat(C.slice(0, s)); D = D.slice(s).concat(D.slice(0, s)); out.push(perm(C.concat(D), PC2)); }
  return out;
}
function desBlock(subkeys, block, decrypt) {
  const b = perm(toBits(block), IP); let L = b.slice(0, 32), R = b.slice(32);
  for (let r = 0; r < 16; r++) {
    const K = subkeys[decrypt ? 15 - r : r]; const x = perm(R, E).map((v, i) => v ^ K[i]); const f = [];
    for (let s = 0; s < 8; s++) { const o = s * 6; const row = (x[o] << 1) | x[o + 5], col = (x[o + 1] << 3) | (x[o + 2] << 2) | (x[o + 3] << 1) | x[o + 4]; const v = SB[s][row * 16 + col]; f.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1); }
    const pf = perm(f, PP); const nR = L.map((v, i) => v ^ pf[i]); L = R; R = nR;
  }
  return fromBits(perm(R.concat(L), FP));
}
export function desEncryptBlock(key, block) { return desBlock(desSubkeys(key), block, false); }
function des3Cbc(key, iv, data, decrypt) {
  const k1 = desSubkeys(key.subarray(0, 8)), k2 = desSubkeys(key.subarray(8, 16)), k3 = desSubkeys(key.length >= 24 ? key.subarray(16, 24) : key.subarray(0, 8));
  const out = new Uint8Array(data.length - (data.length % 8)); let prev = iv;
  for (let o = 0; o < out.length; o += 8) {
    const blk = data.subarray(o, o + 8);
    if (decrypt) { const d = desBlock(k1, desBlock(k2, desBlock(k3, blk, true), false), true); for (let i = 0; i < 8; i++) out[o + i] = d[i] ^ prev[i]; prev = blk; }
    else { const x = blk.map((v, i) => v ^ prev[i]); const e = desBlock(k3, desBlock(k2, desBlock(k1, x, false), true), false); out.set(e, o); prev = e; }
  }
  return out;
}
export function des3CbcDecrypt(key, iv, data) { return unpad(des3Cbc(key, iv, data, true), 8); }
export function des3CbcEncrypt(key, iv, data) { const p = 8 - (data.length % 8); const b = new Uint8Array(data.length + p); b.set(data); b.fill(p, data.length); return des3Cbc(key, iv, b, false); }
function unpad(out, bs) { const p = out[out.length - 1]; if (!out.length || p < 1 || p > bs || out.subarray(out.length - p).some(x => x !== p)) throw new BadPassword(); return out.subarray(0, out.length - p); }

/* ---------- RC2 (RFC 2268) ---------- */
const PITABLE = new Uint8Array([217, 120, 249, 196, 25, 221, 181, 237, 40, 233, 253, 121, 74, 160, 216, 157, 198, 126, 55, 131, 43, 118, 83, 142, 98, 76, 100, 136, 68, 139, 251, 162, 23, 154, 89, 245, 135, 179, 79, 19, 97, 69, 109, 141, 9, 129, 125, 50, 189, 143, 64, 235, 134, 183, 123, 11, 240, 149, 33, 34, 92, 107, 78, 130, 84, 214, 101, 147, 206, 96, 178, 28, 115, 86, 192, 20, 167, 140, 241, 220, 18, 117, 202, 31, 59, 190, 228, 209, 66, 61, 212, 48, 163, 60, 182, 38, 111, 191, 14, 218, 70, 105, 7, 87, 39, 242, 29, 155, 188, 148, 67, 3, 248, 17, 199, 246, 144, 239, 62, 231, 6, 195, 213, 47, 200, 102, 30, 215, 8, 232, 234, 222, 128, 82, 238, 247, 132, 170, 114, 172, 53, 77, 106, 42, 150, 26, 210, 113, 90, 21, 73, 116, 75, 159, 208, 94, 4, 24, 164, 236, 194, 224, 65, 110, 15, 81, 203, 204, 36, 145, 175, 80, 161, 244, 112, 57, 153, 124, 58, 133, 35, 184, 180, 122, 252, 2, 54, 91, 37, 85, 151, 49, 45, 93, 250, 152, 227, 138, 146, 174, 5, 223, 41, 16, 103, 108, 186, 201, 211, 0, 230, 207, 225, 158, 168, 44, 99, 22, 1, 63, 88, 226, 137, 169, 13, 56, 52, 27, 171, 51, 255, 176, 187, 72, 12, 95, 185, 177, 205, 46, 197, 243, 219, 71, 229, 165, 156, 119, 10, 166, 32, 104, 254, 127, 193, 173]);
function rc2Key(key, bits) {
  const L = new Uint8Array(128); L.set(key); const T = key.length, T8 = (bits + 7) >> 3, TM = 255 % (1 << (8 + bits - 8 * T8));
  for (let i = T; i < 128; i++) L[i] = PITABLE[(L[i - 1] + L[i - T]) & 255];
  L[128 - T8] = PITABLE[L[128 - T8] & TM];
  for (let i = 127 - T8; i >= 0; i--) L[i] = PITABLE[L[i + 1] ^ L[i + T8]];
  const K = new Uint16Array(64); for (let i = 0; i < 64; i++) K[i] = L[2 * i] | (L[2 * i + 1] << 8); return K;
}
const S4 = [1, 2, 3, 5];
export function rc2Block(K, blk, decrypt) {
  const R = [blk[0] | blk[1] << 8, blk[2] | blk[3] << 8, blk[4] | blk[5] << 8, blk[6] | blk[7] << 8];
  if (!decrypt) {
    let j = 0;
    const mix = () => { for (let i = 0; i < 4; i++) { R[i] = (R[i] + K[j++] + (R[(i + 3) & 3] & R[(i + 2) & 3]) + (~R[(i + 3) & 3] & R[(i + 1) & 3])) & 0xFFFF; R[i] = ((R[i] << S4[i]) | (R[i] >> (16 - S4[i]))) & 0xFFFF; } };
    const mash = () => { for (let i = 0; i < 4; i++) R[i] = (R[i] + K[R[(i + 3) & 3] & 63]) & 0xFFFF; };
    for (let r = 0; r < 5; r++) mix(); mash(); for (let r = 0; r < 6; r++) mix(); mash(); for (let r = 0; r < 5; r++) mix();
  } else {
    let j = 63;
    const rmix = () => { for (let i = 3; i >= 0; i--) { R[i] = ((R[i] >> S4[i]) | (R[i] << (16 - S4[i]))) & 0xFFFF; R[i] = (R[i] - K[j--] - (R[(i + 3) & 3] & R[(i + 2) & 3]) - (~R[(i + 3) & 3] & R[(i + 1) & 3])) & 0xFFFF; } };
    const rmash = () => { for (let i = 3; i >= 0; i--) R[i] = (R[i] - K[R[(i + 3) & 3] & 63]) & 0xFFFF; };
    for (let r = 0; r < 5; r++) rmix(); rmash(); for (let r = 0; r < 6; r++) rmix(); rmash(); for (let r = 0; r < 5; r++) rmix();
  }
  return new Uint8Array([R[0] & 255, R[0] >> 8, R[1] & 255, R[1] >> 8, R[2] & 255, R[2] >> 8, R[3] & 255, R[3] >> 8]);
}
export function rc2KeySchedule(key, bits) { return rc2Key(key, bits); }
function rc2CbcDecrypt(key, bits, iv, data) {
  const K = rc2Key(key, bits); const out = new Uint8Array(data.length - (data.length % 8)); let prev = iv;
  for (let o = 0; o < out.length; o += 8) { const blk = data.subarray(o, o + 8); const d = rc2Block(K, blk, true); for (let i = 0; i < 8; i++) out[o + i] = d[i] ^ prev[i]; prev = blk; }
  return unpad(out, 8);
}

/* ---------- PKCS#12 key derivation (RFC 7292 B.2) ---------- */
export class BadPassword extends Error { constructor() { super('Wrong password'); this.name = 'BadPassword'; } }
const bmp = pw => { const out = new Uint8Array(pw.length * 2 + 2); for (let i = 0; i < pw.length; i++) { const c = pw.charCodeAt(i); out[i * 2] = c >> 8; out[i * 2 + 1] = c & 255; } return out; };
export function p12kdf(hashName, pwBytes, salt, iter, id, n) {
  const H = hashName === 'SHA-256' ? sha256 : sha1; const u = hashName === 'SHA-256' ? 32 : 20, v = 64;
  const D = new Uint8Array(v).fill(id);
  const rep = x => { if (!x.length) return new Uint8Array(0); const L = v * Math.ceil(x.length / v); const o = new Uint8Array(L); for (let i = 0; i < L; i++) o[i] = x[i % x.length]; return o; };
  const I = concat(rep(salt), rep(pwBytes)); const out = new Uint8Array(n); let done = 0;
  while (done < n) {
    let Ai = H(concat(D, I)); for (let r = 1; r < iter; r++) Ai = H(Ai);
    out.set(Ai.subarray(0, Math.min(u, n - done)), done); done += u; if (done >= n) break;
    const B = new Uint8Array(v); for (let i = 0; i < v; i++) B[i] = Ai[i % u];
    for (let j = 0; j < I.length; j += v) { let c = 1; for (let k = v - 1; k >= 0; k--) { c += I[j + k] + B[k]; I[j + k] = c & 255; c >>= 8; } }
  }
  return out;
}

/* ---------- algorithm identifiers ---------- */
const O = {
  pbes2: '1.2.840.113549.1.5.13', pbkdf2: '1.2.840.113549.1.5.12', hmacSha1: '1.2.840.113549.2.7', hmacSha224: '1.2.840.113549.2.8', hmacSha256: '1.2.840.113549.2.9', hmacSha384: '1.2.840.113549.2.10', hmacSha512: '1.2.840.113549.2.11',
  aes128: '2.16.840.1.101.3.4.1.2', aes192: '2.16.840.1.101.3.4.1.22', aes256: '2.16.840.1.101.3.4.1.42', desEde3: '1.2.840.113549.3.7',
  sha3Des3: '1.2.840.113549.1.12.1.3', sha3Des2: '1.2.840.113549.1.12.1.4', shaRc2_128: '1.2.840.113549.1.12.1.5', shaRc2_40: '1.2.840.113549.1.12.1.6',
  data: '1.2.840.113549.1.7.1', encData: '1.2.840.113549.1.7.6', keyBag: '1.2.840.113549.1.12.10.1.1', shroudedKeyBag: '1.2.840.113549.1.12.10.1.2', certBag: '1.2.840.113549.1.12.10.1.3', x509: '1.2.840.113549.1.9.22.1',
  localKeyId: '1.2.840.113549.1.9.21', friendlyName: '1.2.840.113549.1.9.20', sha1: '1.3.14.3.2.26', sha256: '2.16.840.1.101.3.4.2.1'
};
const PRF = { [O.hmacSha1]: 'SHA-1', [O.hmacSha224]: 'SHA-224', [O.hmacSha256]: 'SHA-256', [O.hmacSha384]: 'SHA-384', [O.hmacSha512]: 'SHA-512' };
async function pbkdf2(pwBytes, salt, iter, hash, len) {
  const k = await crypto.subtle.importKey('raw', pwBytes, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash }, k, len * 8));
}
const num = n => { let v = 0; for (const b of n.value) v = v * 256 + b; return v; };
// decrypt content encrypted with a PKCS#5/#12 algorithm identifier node
async function pbeDecrypt(algNode, data, password) {
  const oid = A.oidStr(algNode.kids[0]); const params = algNode.kids[1];
  if (oid === O.pbes2) {
    const kdf = params.kids[0], es = params.kids[1];
    if (A.oidStr(kdf.kids[0]) !== O.pbkdf2) throw new Error('Unsupported key derivation in PBES2');
    const kp = kdf.kids[1]; const salt = A.octets(kp.kids[0]); const iter = num(kp.kids[1]);
    let prf = 'SHA-1'; for (const x of kp.kids.slice(2)) if (x.tag === 0x30) prf = PRF[A.oidStr(x.kids[0])] || null;
    if (!prf || prf === 'SHA-224') throw new Error('Unsupported PBKDF2 hash');
    if (iter > 10000000) throw new Error('Iteration count too large');
    const eo = A.oidStr(es.kids[0]); const iv = A.octets(es.kids[1]); const pw = enc.encode(password);
    if (eo === O.aes128 || eo === O.aes192 || eo === O.aes256) { const key = await pbkdf2(pw, salt, iter, prf, eo === O.aes128 ? 16 : eo === O.aes192 ? 24 : 32); return unpadAes(aesCbcDecrypt(key, iv, data, false)); }
    if (eo === O.desEde3) { const key = await pbkdf2(pw, salt, iter, prf, 24); return des3CbcDecrypt(key, iv, data); }
    throw new Error('Unsupported encryption scheme ' + eo);
  }
  const salt = A.octets(params.kids[0]); const iter = params.kids[1] ? num(params.kids[1]) : 1;
  if (iter > 10000000) throw new Error('Iteration count too large');
  const tries = password ? [bmp(password)] : [bmp(''), new Uint8Array(0)];
  let last;
  for (const pw of tries) {
    try {
      if (oid === O.sha3Des3 || oid === O.sha3Des2) { const key = p12kdf('SHA-1', pw, salt, iter, 1, oid === O.sha3Des3 ? 24 : 16), iv = p12kdf('SHA-1', pw, salt, iter, 2, 8); return des3CbcDecrypt(key, iv, data); }
      if (oid === O.shaRc2_40 || oid === O.shaRc2_128) { const n = oid === O.shaRc2_40 ? 5 : 16; const key = p12kdf('SHA-1', pw, salt, iter, 1, n), iv = p12kdf('SHA-1', pw, salt, iter, 2, 8); return rc2CbcDecrypt(key, n * 8, iv, data); }
      throw new Error('Unsupported PBE algorithm ' + oid);
    } catch (e) { last = e; if (!(e instanceof BadPassword)) throw e; }
  }
  throw last;
}
function unpadAes(out) { const p = out[out.length - 1]; if (!out.length || p < 1 || p > 16 || out.subarray(out.length - p).some(x => x !== p)) throw new BadPassword(); return out.subarray(0, out.length - p); }

/* ---------- parsing ---------- */
async function verifyMac(pfx, authData, password) {
  const mac = pfx.kids[2]; if (!mac) return 'none';
  const di = mac.kids[0]; const halg = A.oidStr(di.kids[0].kids[0]); const digest = A.octets(di.kids[1]);
  const salt = A.octets(mac.kids[1]); const iter = mac.kids[2] ? num(mac.kids[2]) : 1;
  const hash = halg === O.sha256 ? 'SHA-256' : halg === O.sha1 ? 'SHA-1' : null; if (!hash) return 'unsupported';
  const n = hash === 'SHA-256' ? 32 : 20;
  for (const pw of password ? [bmp(password)] : [bmp(''), new Uint8Array(0)]) {
    const key = p12kdf(hash, pw, salt, iter, 3, n);
    const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash }, false, ['sign']);
    const m = new Uint8Array(await crypto.subtle.sign('HMAC', k, authData));
    if (hex(m) === hex(digest)) return 'ok';
  }
  throw new BadPassword();
}
// -> {keys:[{pkcs8, localKeyId}], certs:[{der, localKeyId}], mac}
export async function parsePfx(bytes, password) {
  let pfx; try { pfx = A.parse(bytes); } catch (e) { throw new Error('This is not a PKCS#12 (.p12/.pfx) file.'); }
  if (pfx.tag !== 0x30 || !pfx.kids || pfx.kids.length < 2 || num(pfx.kids[0]) !== 3) throw new Error('This is not a PKCS#12 (.p12/.pfx) file.');
  const ci = pfx.kids[1]; if (A.oidStr(ci.kids[0]) !== O.data) throw new Error('Public-key protected PKCS#12 files are not supported.');
  const authData = A.octets(ci.kids[1].kids[0]);
  const mac = await verifyMac(pfx, authData, password);
  const safe = A.parse(authData); const keys = [], certs = [];
  const attrsOf = bag => { const out = {}; const at = bag.kids[2]; if (at && at.tag === 0x31) for (const a of at.kids) { const t = A.oidStr(a.kids[0]); if (t === O.localKeyId) out.localKeyId = hex(A.octets(a.kids[1].kids[0])); if (t === O.friendlyName) { try { out.name = new TextDecoder('utf-16be').decode(a.kids[1].kids[0].value); } catch (e) { /* ignore */ } } } return out; };
  const handleBags = async contents => {
    for (const bag of A.parse(contents).kids) {
      const t = A.oidStr(bag.kids[0]); const val = bag.kids[1].kids[0]; const at = attrsOf(bag);
      if (t === O.keyBag) keys.push({ pkcs8: val.raw.slice(), ...at });
      else if (t === O.shroudedKeyBag) keys.push({ pkcs8: (await pbeDecrypt(val.kids[0], A.octets(val.kids[1]), password)).slice(), ...at });
      else if (t === O.certBag && A.oidStr(val.kids[0]) === O.x509) certs.push({ der: A.octets(val.kids[1].kids[0]).slice(), ...at });
    }
  };
  for (const c of safe.kids) {
    const ct = A.oidStr(c.kids[0]);
    if (ct === O.data) await handleBags(A.octets(c.kids[1].kids[0]));
    else if (ct === O.encData) { const eci = c.kids[1].kids[0].kids[1]; const encContent = eci.kids[2]; const data = encContent.tag & 0x20 ? A.octets(encContent) : encContent.value; await handleBags(await pbeDecrypt(eci.kids[1], data, password)); }
  }
  return { keys, certs, mac };
}

/* ---------- building (export) ---------- */
const bmpStr = s => A.tlv(0x1E, bmp(s).subarray(0, s.length * 2));
async function pbes2Encrypt(data, password, iter) {
  const salt = randomBytes(16), iv = randomBytes(16); const key = await pbkdf2(enc.encode(password), salt, iter, 'SHA-256', 32);
  const alg = A.seq(A.oid(O.pbes2), A.seq(A.seq(A.oid(O.pbkdf2), A.seq(A.octet(salt), A.int(iter), A.seq(A.oid(O.hmacSha256), A.nul()))), A.seq(A.oid(O.aes256), A.octet(iv))));
  return { alg, ct: aesCbcEncrypt(key, iv, data, true) };
}
export async function buildPfx({ pkcs8, certs, name = '' }, password, { iter = 100000 } = {}) {
  const localKeyId = sha1(certs[0]);
  const attrs = A.set(A.seq(A.oid(O.localKeyId), A.set(A.octet(localKeyId))), ...(name ? [A.seq(A.oid(O.friendlyName), A.set(bmpStr(name)))] : []));
  const certBags = A.seq(...certs.map((c, k) => A.seq(A.oid(O.certBag), A.explicit(0, A.seq(A.oid(O.x509), A.explicit(0, A.octet(c)))), ...(k === 0 ? [attrs] : []))));
  const ce = await pbes2Encrypt(certBags, password, iter);
  const encData = A.seq(A.oid(O.encData), A.explicit(0, A.seq(A.int(0), A.seq(A.oid(O.data), ce.alg, A.tlv(0x80, ce.ct)))));
  const ke = await pbes2Encrypt(pkcs8, password, iter);
  const keyBags = A.seq(A.seq(A.oid(O.shroudedKeyBag), A.explicit(0, A.seq(ke.alg, A.octet(ke.ct))), attrs));
  const authSafe = A.seq(encData, A.seq(A.oid(O.data), A.explicit(0, A.octet(keyBags))));
  const macSalt = randomBytes(8), macIter = 2048;
  const mk = p12kdf('SHA-256', bmp(password), macSalt, macIter, 3, 32);
  const hk = await crypto.subtle.importKey('raw', mk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hk, authSafe));
  return A.seq(A.int(3), A.seq(A.oid(O.data), A.explicit(0, A.octet(authSafe))), A.seq(A.seq(A.seq(A.oid(O.sha256), A.nul()), A.octet(mac)), A.octet(macSalt), A.int(macIter)));
}

/* ---------- passphrase encryption at rest (PBKDF2-SHA256 + AES-GCM) ---------- */
export const KEY_ITER = 600000;
export async function sealKey(pkcs8, passphrase) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: KEY_ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, pkcs8));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: KEY_ITER, cipher: 'AES-256-GCM', salt: hex(salt), iv: hex(iv), ct: hex(ct) };
}
export async function openKey(sealed, passphrase) {
  const fh = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fh(sealed.salt), iterations: sealed.iter || KEY_ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fh(sealed.iv) }, k, fh(sealed.ct))); }
  catch (e) { throw new BadPassword(); }
}
export { O as P12_OID };
