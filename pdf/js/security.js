// PDF Standard Security Handler (ISO 32000-2 §7.6.4): open/decrypt RC4-40/128, AES-128 and
// AES-256 (R2–R6) files with a user or owner password, and encrypt on save with AES-256 (R6) or
// AES-128 (R4) plus user/owner passwords and permission flags. Built on pdf-lib's object model.
import { md5, rc4, aesCbcEncrypt, aesCbcDecrypt, aesEcbEncrypt, sha256, digest, concat, randomBytes, enc, hex } from './crypto.js';
const L = window.PDFLib;
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFString, PDFHexString, PDFRawStream, PDFStream, PDFBool } = L;

const PAD = new Uint8Array([0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08, 0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]);
const ENDOBJ = [101, 110, 100, 111, 98, 106];
export class PasswordError extends Error { constructor(m) { super(m || 'Incorrect password'); this.name = 'PasswordError'; } }
export class UnsupportedSecurity extends Error { constructor(m) { super(m); this.name = 'UnsupportedSecurity'; } }

export const PERM_BITS = { print: 3, modify: 4, copy: 5, annotate: 6, fill: 9, accessibility: 10, assemble: 11, printHigh: 12 };
export const PERM_LABEL = { print: 'Printing', printHigh: 'High-quality printing', modify: 'Changing the document', copy: 'Copying text and images', annotate: 'Commenting', fill: 'Filling in form fields', accessibility: 'Text access for screen readers', assemble: 'Assembling pages (insert, rotate, delete)' };
export function permsFromP(P) { const o = {}; for (const [k, b] of Object.entries(PERM_BITS)) o[k] = !!(P & (1 << (b - 1))); return o; }
export function pFromPerms(perms) { let P = 0xFFFFF0C0 | 0; for (const [k, b] of Object.entries(PERM_BITS)) if (perms[k]) P |= 1 << (b - 1); return P | 0; }
const le32 = v => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
const padPw = pw => { const b = (pw instanceof Uint8Array ? pw : latin1(pw)).subarray(0, 32); const out = new Uint8Array(32); out.set(b); out.set(PAD.subarray(0, 32 - b.length), b.length); return out; };
const latin1 = s => { const out = []; for (const ch of String(s)) { const c = ch.codePointAt(0); out.push(c < 256 ? c : 63); } return new Uint8Array(out); };
const utf8pw = s => enc.encode(String(s).normalize('NFKC')).subarray(0, 127);
const eq = (a, b, n = a.length) => { if (a.length < n || b.length < n) return false; for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false; return true; };
const bytesOf = o => (o instanceof PDFString || o instanceof PDFHexString) ? o.asBytes() : null;

/* ---------- key derivation ---------- */
function keyR4(pw, E) {
  const n = E.R === 2 ? 5 : (E.Length || 40) / 8;
  let h = md5(concat(padPw(pw), E.O.subarray(0, 32), le32(E.P), E.id0, E.R >= 4 && !E.encMeta ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0)));
  if (E.R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n));
  return h.subarray(0, n);
}
function uValue(key, E) {
  if (E.R === 2) return rc4(key, PAD);
  let x = rc4(key, md5(concat(PAD, E.id0)));
  for (let i = 1; i <= 19; i++) x = rc4(key.map(b => b ^ i), x);
  return concat(x, new Uint8Array(16));
}
function ownerRc4Key(ownerPw, E) {
  const n = E.R === 2 ? 5 : (E.Length || 40) / 8; let h = md5(padPw(ownerPw));
  if (E.R >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  return h.subarray(0, n);
}
async function hash2B(pw, salt, udata, R) {
  let K = sha256(concat(pw, salt, udata)); if (R === 5) return K;
  for (let i = 0; ; ) {
    const unit = concat(pw, K, udata); const K1 = new Uint8Array(unit.length * 64); for (let j = 0; j < 64; j++) K1.set(unit, j * unit.length);
    const E = aesCbcEncrypt(K.subarray(0, 16), K.subarray(16, 32), K1, false);
    let sum = 0; for (let j = 0; j < 16; j++) sum += E[j];
    const m = sum % 3; K = m === 0 ? sha256(E) : await digest(m === 1 ? 'SHA-384' : 'SHA-512', E);
    i++; if (i >= 64 && E[E.length - 1] <= i - 32) break;
  }
  return K.subarray(0, 32);
}
// Returns {key, owner} or null
async function authenticate(E, password) {
  if (E.R >= 5) {
    const pw = utf8pw(password); const U = E.U, O = E.O;
    if (eq(await hash2B(pw, O.subarray(32, 40), U.subarray(0, 48), E.R), O, 32)) {
      const k = await hash2B(pw, O.subarray(40, 48), U.subarray(0, 48), E.R); return { key: aesCbcDecrypt(k, new Uint8Array(16), E.OE, false), owner: true };
    }
    if (eq(await hash2B(pw, U.subarray(32, 40), new Uint8Array(0), E.R), U, 32)) {
      const k = await hash2B(pw, U.subarray(40, 48), new Uint8Array(0), E.R); return { key: aesCbcDecrypt(k, new Uint8Array(16), E.UE, false), owner: false };
    }
    return null;
  }
  const check = pwBytes => { const key = keyR4(pwBytes, E); const u = uValue(key, E); return eq(u, E.U, E.R === 2 ? 32 : 16) ? key : null; };
  // owner password -> recover user password
  const ok = ownerRc4Key(password, E); let x = E.O.subarray(0, 32);
  if (E.R === 2) x = rc4(ok, x); else for (let i = 19; i >= 0; i--) x = rc4(ok.map(b => b ^ i), x);
  let key = check(x); if (key) return { key, owner: true };
  key = check(latin1(password)); if (key) return { key, owner: false };
  return null;
}

/* ---------- parsing (defers encrypted object streams) ---------- */
async function parseRaw(bytes) {
  const parser = L.PDFParser.forBytesWithOptions(bytes, 500, false, false);
  const deferred = [], seq = new Map(); let n = 0;
  const orig = L.PDFParser.prototype.parseIndirectObject;
  parser.parseIndirectObject = async function () {
    const start = this.bytes.offset();
    const ref = this.parseIndirectObjectHeader(); this.skipWhitespaceAndComments();
    const obj = this.parseObject();
    if (obj instanceof PDFRawStream && obj.dict.lookup(PDFName.of('Type')) === PDFName.of('ObjStm')) {
      this.skipWhitespaceAndComments(); this.matchKeyword(ENDOBJ); deferred.push({ ref, stream: obj, seq: n++ }); return ref;
    }
    this.bytes.moveTo(start); const r = await orig.call(this); seq.set(r.tag, n++); return r;
  };
  const context = await parser.parseDocument();
  return { context, deferred, seq };
}
function readEncrypt(ctx) {
  const t = ctx.trailerInfo; if (!t.Encrypt) return null;
  const d = t.Encrypt instanceof PDFRef ? ctx.lookup(t.Encrypt) : t.Encrypt;
  if (!(d instanceof PDFDict)) throw new UnsupportedSecurity('Damaged encryption dictionary');
  const g = k => d.lookup(PDFName.of(k));
  const filter = g('Filter')?.decodeText?.();
  if (filter !== 'Standard') throw new UnsupportedSecurity(filter === 'Adobe.PubSec' ? 'This PDF is encrypted with a certificate (public-key security), which Lumen PDF cannot open for editing.' : `Unsupported security handler “${filter}”.`);
  const idArr = t.ID instanceof PDFArray ? t.ID : (t.ID instanceof PDFRef ? ctx.lookup(t.ID) : null);
  const E = { V: g('V')?.asNumber?.() || 0, R: g('R')?.asNumber?.() || 2, Length: g('Length')?.asNumber?.() || 40, P: (g('P')?.asNumber?.() || 0) | 0, O: bytesOf(g('O')) || new Uint8Array(32), U: bytesOf(g('U')) || new Uint8Array(32), OE: bytesOf(g('OE')), UE: bytesOf(g('UE')), Perms: bytesOf(g('Perms')), encMeta: g('EncryptMetadata') !== PDFBool.False, id0: (idArr && bytesOf(ctx.lookup(idArr.get(0)) || idArr.get(0))) || new Uint8Array(0), stm: 'RC4', str: 'RC4' };
  if (E.V >= 4) {
    const cf = g('CF'); const meth = name => { if (!name || name === 'Identity') return 'Identity'; const c = cf instanceof PDFDict ? cf.lookup(PDFName.of(name)) : null; const m = c?.lookup?.(PDFName.of('CFM'))?.decodeText?.() || 'None'; const len = c?.lookup?.(PDFName.of('Length'))?.asNumber?.(); if (m === 'V2' && len) E.Length = len <= 32 ? len * 8 : len; return m === 'AESV2' ? 'AESV2' : m === 'AESV3' ? 'AESV3' : m === 'V2' ? 'RC4' : 'Identity'; };
    E.stm = meth(g('StmF')?.decodeText?.()); E.str = meth(g('StrF')?.decodeText?.());
    if (E.V === 4 && (E.stm === 'AESV2' || E.str === 'AESV2')) E.Length = 128;
  } else if (E.V === 1) E.Length = 40;
  if (![2, 3, 4, 5, 6].includes(E.R)) throw new UnsupportedSecurity(`Unsupported encryption revision R${E.R}.`);
  E.method = E.R >= 5 ? 'AES-256' : E.stm === 'AESV2' ? 'AES-128' : `RC4-${E.Length}`;
  E.ref = t.Encrypt instanceof PDFRef ? t.Encrypt : null;
  return E;
}
function objKey(fileKey, E, num, gen, aes) {
  if (E.R >= 5) return fileKey;
  const k = md5(concat(fileKey, new Uint8Array([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]), aes ? enc.encode('sAlT') : new Uint8Array(0)));
  return k.subarray(0, Math.min(fileKey.length + 5, 16));
}
function cryptData(data, method, key, encrypt) {
  if (method === 'Identity') return data;
  if (method === 'RC4') return rc4(key, data);
  if (encrypt) { const iv = randomBytes(16); return concat(iv, aesCbcEncrypt(key, iv, data, true)); }
  if (data.length < 16) return new Uint8Array(0);
  return aesCbcDecrypt(key, data.subarray(0, 16), data.subarray(16), true);
}
// Apply fn to every string and stream of every indirect object (except the encryption dictionary)
function transformAll(ctx, E, fileKey, encrypt, skipTags = new Set()) {
  const strKeyFor = (num, gen) => objKey(fileKey, E, num, gen, E.str !== 'RC4');
  const stmKeyFor = (num, gen) => objKey(fileKey, E, num, gen, E.stm !== 'RC4');
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (E.ref && ref.tag === E.ref.tag) continue; if (skipTags.has(ref.tag)) continue;
    let sk = null; const sKey = () => (sk ||= strKeyFor(ref.objectNumber, ref.generationNumber));
    const isSig = d => d instanceof PDFDict && (d.lookup(PDFName.of('Type')) === PDFName.of('Sig') || d.lookup(PDFName.of('Type')) === PDFName.of('DocTimeStamp')) && d.get(PDFName.of('ByteRange'));
    const walk = (o, parentSig, key) => {
      if (o instanceof PDFString || o instanceof PDFHexString) { if (parentSig && key === 'Contents') return o; return PDFHexString.of(hex(cryptData(o.asBytes(), E.str, sKey(), encrypt))); }
      if (o instanceof PDFArray) { for (let i = 0; i < o.size(); i++) o.set(i, walk(o.get(i), false)); return o; }
      if (o instanceof PDFDict && !(o instanceof PDFStream)) { const sig = isSig(o); for (const [k, v] of o.entries()) o.set(k, walk(v, sig, k.decodeText())); return o; }
      return o;
    };
    if (obj instanceof PDFStream) {
      walk(obj.dict, false);
      const type = obj.dict.lookup(PDFName.of('Type'));
      if (type === PDFName.of('XRef')) continue;
      if (type === PDFName.of('Metadata') && !E.encMeta) continue;
      const contents = obj instanceof PDFRawStream ? obj.contents : (obj.getContents ? obj.getContents() : null); if (!contents) continue;
      const out = cryptData(contents, E.stm, stmKeyFor(ref.objectNumber, ref.generationNumber), encrypt);
      ctx.assign(ref, PDFRawStream.of(obj.dict, out));
    } else walk(obj, false);
  }
}

/* ---------- public API ---------- */
export async function inspect(bytes) {
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  return /\/Encrypt\b/.test(tail) || /\/Encrypt\b/.test(head) || new TextDecoder('latin1').decode(bytes).includes('/Encrypt');
}
// Decrypt with a password. Returns {bytes, security} ; throws PasswordError / UnsupportedSecurity
export async function decryptPdf(bytes, password = '') {
  const { context: ctx, deferred, seq } = await parseRaw(bytes);
  const E = readEncrypt(ctx); if (!E) return { bytes, security: null };
  const auth = await authenticate(E, password);
  if (!auth) throw new PasswordError();
  const fileKey = auth.key;
  // decrypt direct objects, then expand (decrypted) object streams
  transformAll(ctx, E, fileKey, false);
  for (const d of deferred.sort((a, b) => a.seq - b.seq)) {
    const plain = cryptData(d.stream.contents, E.stm, objKey(fileKey, E, d.ref.objectNumber, d.ref.generationNumber, E.stm !== 'RC4'), false);
    const later = []; for (const [r, o] of ctx.enumerateIndirectObjects()) if ((seq.get(r.tag) ?? -1) > d.seq) later.push([r, o]);
    try { await L.PDFObjectStreamParser.forStream(PDFRawStream.of(d.stream.dict, plain)).parseIntoContext(); } catch (e) { console.warn('object stream', e); }
    for (const [r, o] of later) ctx.assign(r, o);
  }
  if (E.ref) ctx.delete(E.ref);
  delete ctx.trailerInfo.Encrypt;
  const pdf = new PDFDocument(ctx, false, false);
  const out = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false });
  const P = E.P;
  const security = {
    mode: 'keep', method: E.method, R: E.R, V: E.V, P, perms: permsFromP(P), owner: auth.owner, hasUserPassword: !(await authenticate(E, '')),
    E: { V: E.V, R: E.R, Length: E.Length, P, O: E.O, U: E.U, OE: E.OE, UE: E.UE, Perms: E.Perms, encMeta: E.encMeta, id0: E.id0, stm: E.stm, str: E.str }, fileKey
  };
  return { bytes: out, security };
}

// Build security settings for new passwords. opts: {userPassword, ownerPassword, method:'AES-256'|'AES-128', perms}
export async function newSecurity({ userPassword = '', ownerPassword = '', method = 'AES-256', perms = {} }) {
  if (!ownerPassword) ownerPassword = userPassword || hex(randomBytes(16));
  const P = pFromPerms({ ...Object.fromEntries(Object.keys(PERM_BITS).map(k => [k, true])), ...perms });
  const id0 = randomBytes(16);
  let E, fileKey;
  if (method === 'AES-256') {
    fileKey = randomBytes(32);
    const up = utf8pw(userPassword), op = utf8pw(ownerPassword);
    const uvs = randomBytes(8), uks = randomBytes(8);
    const U = concat(await hash2B(up, uvs, new Uint8Array(0), 6), uvs, uks);
    const UE = aesCbcEncrypt(await hash2B(up, uks, new Uint8Array(0), 6), new Uint8Array(16), fileKey, false);
    const ovs = randomBytes(8), oks = randomBytes(8);
    const O = concat(await hash2B(op, ovs, U, 6), ovs, oks);
    const OE = aesCbcEncrypt(await hash2B(op, oks, U, 6), new Uint8Array(16), fileKey, false);
    const permsBlock = concat(le32(P), new Uint8Array([255, 255, 255, 255]), enc.encode('Tadb'), randomBytes(4));
    const Perms = aesEcbEncrypt(fileKey, permsBlock);
    E = { V: 5, R: 6, Length: 256, P, O, U, OE, UE, Perms, encMeta: true, id0, stm: 'AESV3', str: 'AESV3' };
  } else {
    const base = { V: 4, R: 4, Length: 128, P, encMeta: true, id0, stm: 'AESV2', str: 'AESV2' };
    const ok = ownerRc4Key(ownerPassword, base); let O = rc4(ok, padPw(userPassword));
    for (let i = 1; i <= 19; i++) O = rc4(ok.map(b => b ^ i), O);
    base.O = O; fileKey = keyR4(latin1(userPassword), base); base.U = uValue(fileKey, base);
    E = base;
  }
  return { mode: 'new', method, R: E.R, V: E.V, P, perms: permsFromP(P), owner: true, hasUserPassword: !!userPassword, E, fileKey };
}
function encryptDict(ctx, E) {
  const H = b => PDFHexString.of(hex(b));
  const d = { Filter: 'Standard', V: E.V, R: E.R, P: E.P, O: H(E.O), U: H(E.U) };
  if (E.V >= 4) {
    const cfm = E.stm === 'AESV3' ? 'AESV3' : E.stm === 'AESV2' ? 'AESV2' : 'V2';
    d.Length = E.R >= 5 ? 256 : E.Length; d.CF = { StdCF: { AuthEvent: 'DocOpen', CFM: cfm, Length: E.R >= 5 ? 32 : E.Length / 8 } }; d.StmF = 'StdCF'; d.StrF = 'StdCF';
    if (!E.encMeta) d.EncryptMetadata = false;
  } else { d.Length = E.Length; }
  if (E.R >= 5) { d.OE = H(E.OE); d.UE = H(E.UE); d.Perms = H(E.Perms); }
  return ctx.obj(d);
}
// Encrypt plain PDF bytes with security settings (from newSecurity or decryptPdf 'keep')
export async function encryptPdf(bytes, sec) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = pdf.context; const E = { ...sec.E };
  delete ctx.trailerInfo.Encrypt;
  transformAll(ctx, E, sec.fileKey, true);
  const ref = ctx.register(encryptDict(ctx, E)); E.ref = ref;
  ctx.trailerInfo.Encrypt = ref;
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(hex(E.id0)), PDFHexString.of(hex(randomBytes(16)))]);
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
}
export async function checkOwnerPassword(sec, password) {
  const E = { ...sec.E, O: sec.E.O, U: sec.E.U };
  const a = await authenticate(E, password); return !!(a && a.owner);
}
export function describe(sec) {
  if (!sec) return 'Not protected';
  return `${sec.method}${sec.hasUserPassword ? ' · password to open' : ''}${Object.values(sec.perms).every(Boolean) ? '' : ' · restricted'}`;
}
