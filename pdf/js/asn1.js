// Minimal DER encoder/decoder for X.509 certificates and CMS (PKCS#7) signatures.
import { concat, enc } from './crypto.js';

function lenBytes(n) { if (n < 128) return new Uint8Array([n]); const b = []; while (n > 0) { b.unshift(n & 255); n = Math.floor(n / 256); } return new Uint8Array([0x80 | b.length, ...b]); }
export const tlv = (tag, ...content) => { const c = concat(...content); return concat(new Uint8Array([tag]), lenBytes(c.length), c); };
export const seq = (...c) => tlv(0x30, ...c);
export const set = (...c) => tlv(0x31, ...c);
export const setSorted = (...items) => { items.sort((a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }); return tlv(0x31, ...items); };
export const nul = () => new Uint8Array([5, 0]);
export function int(v) {
  let b;
  if (v instanceof Uint8Array) { b = v; let i = 0; while (i < b.length - 1 && b[i] === 0 && !(b[i + 1] & 0x80)) i++; b = b.subarray(i); }
  else { const a = []; let n = v; do { a.unshift(n & 255); n = Math.floor(n / 256); } while (n > 0); b = new Uint8Array(a); }
  if (b[0] & 0x80) b = concat(new Uint8Array([0]), b);
  return tlv(0x02, b);
}
export function oid(s) {
  const p = s.split('.').map(Number); const out = [40 * p[0] + p[1]];
  for (const n of p.slice(2)) { const b = []; let x = n; b.unshift(x & 127); x = Math.floor(x / 128); while (x > 0) { b.unshift((x & 127) | 128); x = Math.floor(x / 128); } out.push(...b); }
  return tlv(0x06, new Uint8Array(out));
}
export const octet = b => tlv(0x04, b);
export const bitstr = b => tlv(0x03, new Uint8Array([0]), b);
export const utf8 = s => tlv(0x0C, enc.encode(s));
export const printable = s => tlv(0x13, enc.encode(s));
export const ia5 = s => tlv(0x16, enc.encode(s));
export const bool = v => tlv(0x01, new Uint8Array([v ? 0xFF : 0]));
export const explicit = (n, ...c) => tlv(0xA0 | n, ...c);
export const implicitCons = (n, ...c) => tlv(0xA0 | n, ...c);
export function time(d) {
  const p = n => String(n).padStart(2, '0');
  const y = d.getUTCFullYear(); const body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return y >= 2050 ? tlv(0x18, enc.encode(String(y) + body)) : tlv(0x17, enc.encode(String(y).slice(2) + body));
}
export const OID = {
  sha256: '2.16.840.1.101.3.4.2.1', sha384: '2.16.840.1.101.3.4.2.2', sha512: '2.16.840.1.101.3.4.2.3', sha1: '1.3.14.3.2.26',
  rsa: '1.2.840.113549.1.1.1', sha256Rsa: '1.2.840.113549.1.1.11', sha384Rsa: '1.2.840.113549.1.1.12', sha512Rsa: '1.2.840.113549.1.1.13', sha1Rsa: '1.2.840.113549.1.1.5',
  ecdsa256: '1.2.840.10045.4.3.2', ecdsa384: '1.2.840.10045.4.3.3', ecdsa512: '1.2.840.10045.4.3.4', ecPub: '1.2.840.10045.2.1',
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2', contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5', signingCertV2: '1.2.840.113549.1.9.16.2.47',
  cn: '2.5.4.3', o: '2.5.4.10', ou: '2.5.4.11', c: '2.5.4.6', email: '1.2.840.113549.1.9.1',
  basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', extKeyUsage: '2.5.29.37', ski: '2.5.29.14', emailProtection: '1.3.6.1.5.5.7.3.4', adobeDocSign: '1.2.840.113583.1.1.5'
};

/* ---------- decoder ---------- */
export function parse(b, off = 0) {
  if (off + 2 > b.length) throw new Error('ASN.1: truncated data');
  const tag = b[off]; let len = b[off + 1], hl = 2, indef = false;
  if (len === 0x80) { indef = true; len = 0; }
  else if (len & 0x80) { const n = len & 0x7f; if (n > 4) throw new Error('ASN.1: length too large'); len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[off + 2 + i]; hl = 2 + n; }
  const node = { tag, start: off, hstart: off + hl };
  if (indef) {
    if (!(tag & 0x20)) throw new Error('ASN.1: indefinite primitive');
    node.kids = []; let p = node.hstart;
    while (p + 1 < b.length && !(b[p] === 0 && b[p + 1] === 0)) { const k = parse(b, p); node.kids.push(k); p = k.end; }
    node.end = p + 2; node.len = p - node.hstart; node.value = b.subarray(node.hstart, p);
  } else {
    node.end = off + hl + len; node.len = len; if (node.end > b.length) throw new Error('ASN.1: length beyond data');
    node.value = b.subarray(node.hstart, node.end);
    if (tag & 0x20) { node.kids = []; let p = node.hstart; while (p < node.end) { const k = parse(b, p); node.kids.push(k); p = k.end; } }
  }
  node.raw = b.subarray(off, node.end);
  return node;
}
// OCTET STRING contents, joining BER constructed (chunked) encodings
export function octets(node) {
  if (!(node.tag & 0x20)) return node.value;
  const parts = node.kids.map(octets); let n = 0; parts.forEach(p => n += p.length); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
export function oidStr(node) {
  const v = node.value; const out = [Math.floor(v[0] / 40), v[0] % 40]; let n = 0;
  for (let i = 1; i < v.length; i++) { n = n * 128 + (v[i] & 127); if (!(v[i] & 128)) { out.push(n); n = 0; } }
  return out.join('.');
}
export const text = node => new TextDecoder(node.tag === 0x1E ? 'utf-16be' : 'utf-8').decode(node.value);
export function nameToObj(nameNode) {
  const o = {}; const map = { [OID.cn]: 'CN', [OID.o]: 'O', [OID.ou]: 'OU', [OID.c]: 'C', [OID.email]: 'E' };
  for (const rdn of nameNode.kids || []) for (const atv of rdn.kids || []) { const k = map[oidStr(atv.kids[0])]; if (k) o[k] = text(atv.kids[1]); }
  return o;
}
export function parseTime(node) {
  const s = new TextDecoder().decode(node.value);
  const m = node.tag === 0x17 ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z/.exec(s) : /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z/.exec(s);
  if (!m) return null; let y = +m[1]; if (node.tag === 0x17) y += y < 50 ? 2000 : 1900;
  return new Date(Date.UTC(y, +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
}
