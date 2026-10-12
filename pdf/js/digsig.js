// Certificate-based digital signatures: create a self-signed Digital ID (RSA-2048, X.509 v3),
// sign documents with a detached CMS/PKCS#7 signature (adbe.pkcs7.detached, SHA-256, signed
// attributes incl. ESS signing-certificate-v2) over the PDF ByteRange, and validate signatures
// found in opened PDFs (integrity, cryptographic validity, coverage, signer details).
import { App, emit } from './state.js';
import { buildOutput } from './writer.js';
import { concat, randomBytes, digest, hex, enc } from './crypto.js';
import { parsePfx, buildPfx, sealKey, openKey, BadPassword } from './pkcs12.js';
import * as A from './asn1.js';
import { prefs, esc, f2, normRect, dataUrlToBytes, bytesToDataUrl } from './util.js';
const L = window.PDFLib;
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString, PDFNumber, PDFStream } = L;

const SIG_HEX = 16384; // placeholder size (hex chars) => 8 KB of DER
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/* ---------- Digital ID ---------- */
// Stored Digital ID: {cn, o, email, c, cert, chain[], keyAlg, sealed:{PBKDF2-SHA256 + AES-256-GCM}, created, source}
// The private key is never stored in clear. IDs saved by earlier versions (plain "pkcs8") are migrated.
export function getIdentity() { const id = prefs.get('digitalId', null); return id && id.cert && (id.sealed || id.pkcs8) ? id : null; }
export const needsMigration = id => !!(id && id.pkcs8 && !id.sealed);
function saveIdentity(id) { const { pkcs8, ...rest } = id; void pkcs8; prefs.set('digitalId', rest); return rest; }
export function keyAlgOf(pkcs8) {
  const pk = A.parse(pkcs8); const alg = pk.kids[1]; const oid = A.oidStr(alg.kids[0]);
  if (oid === A.OID.rsa) return { name: 'RSASSA-PKCS1-v1_5' };
  if (oid === A.OID.ecPub) { const c = { '1.2.840.10045.3.1.7': 'P-256', '1.3.132.0.34': 'P-384', '1.3.132.0.35': 'P-521' }[A.oidStr(alg.kids[1])]; if (c) return { name: 'ECDSA', namedCurve: c }; }
  throw new Error('Unsupported private key type (only RSA and ECDSA P-256/384/521 keys can sign).');
}
const importAlg = ka => ka.name === 'ECDSA' ? { name: 'ECDSA', namedCurve: ka.namedCurve } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const signAlg = ka => ka.name === 'ECDSA' ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5';
async function importSigningKey(pkcs8, ka) { return crypto.subtle.importKey('pkcs8', pkcs8, importAlg(ka), false, ['sign']); }
// Unlock the private key with the passphrase -> {key: non-extractable CryptoKey, pkcs8}
export async function unlockIdentity(id, passphrase) {
  if (needsMigration(id)) throw new Error('This Digital ID must be protected with a passphrase first.');
  const pkcs8 = await openKey(id.sealed, passphrase);
  return { key: await importSigningKey(pkcs8, id.keyAlg || keyAlgOf(pkcs8)), pkcs8 };
}
export async function migrateIdentity(passphrase) {
  const id = prefs.get('digitalId', null); if (!needsMigration(id)) return id;
  const pkcs8 = unb64(id.pkcs8);
  const out = saveIdentity({ ...id, chain: id.chain || [], keyAlg: keyAlgOf(pkcs8), sealed: await sealKey(pkcs8, passphrase), source: id.source || 'self' });
  pkcs8.fill(0); return out;
}
export async function changePassphrase(oldPass, newPass) {
  const id = getIdentity(); const { pkcs8 } = await unlockIdentity(id, oldPass);
  const out = saveIdentity({ ...id, sealed: await sealKey(pkcs8, newPass) }); pkcs8.fill(0); return out;
}
export function removeIdentity() { try { localStorage.removeItem('lumenpdf.digitalId'); } catch (e) { prefs.set('digitalId', null); } }
// Import a .p12/.pfx: verify the MAC/password, find the key and its certificate, store sealed.
export async function importP12(bytes, password, passphrase) {
  const { keys, certs } = await parsePfx(bytes, password);
  if (!keys.length) throw new Error('The file contains no private key.');
  if (!certs.length) throw new Error('The file contains no certificate.');
  const probe = enc.encode('lumen-pdf key check');
  for (const k of keys) {
    const ka = keyAlgOf(k.pkcs8); const key = await importSigningKey(k.pkcs8, ka);
    const sig = new Uint8Array(await crypto.subtle.sign(signAlg(ka), key, probe));
    const ordered = [...certs.filter(c => k.localKeyId && c.localKeyId === k.localKeyId), ...certs];
    for (const c of ordered) {
      let info; try { info = certInfo(c.der); } catch (e) { continue; }
      let ok = false;
      try { const pub = await crypto.subtle.importKey('spki', info.spki, ka.name === 'ECDSA' ? { name: 'ECDSA', namedCurve: ka.namedCurve } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']); ok = await crypto.subtle.verify(signAlg(ka), pub, sig, probe); } catch (e) { ok = false; }
      if (!ok) continue;
      const chain = certs.filter(x => x !== c && hex(x.der) !== hex(c.der)).map(x => b64(x.der));
      const subj = info.subj; const now = new Date();
      const id = saveIdentity({ cn: subj.CN || k.name || 'Imported ID', o: subj.O || '', email: subj.E || '', c: subj.C || '', cert: b64(c.der), chain, keyAlg: ka, sealed: await sealKey(k.pkcs8, passphrase), created: new Date().toISOString(), source: 'p12', notAfter: info.notAfter?.toISOString(), issuer: info.iss.CN || info.iss.O || '' });
      k.pkcs8.fill(0);
      return { id, expired: !!(info.notAfter && info.notAfter < now), notYet: !!(info.notBefore && info.notBefore > now), selfSigned: info.selfSigned };
    }
  }
  throw new Error('None of the certificates in the file matches its private key.');
}
export async function exportP12(passphrase, exportPassword) {
  const id = getIdentity(); const { pkcs8 } = await unlockIdentity(id, passphrase);
  try { return await buildPfx({ pkcs8, certs: [unb64(id.cert), ...(id.chain || []).map(unb64)], name: id.cn }, exportPassword); }
  finally { pkcs8.fill(0); }
}
const nameDer = ({ cn, o, email, c }) => A.seq(...[c ? A.set(A.seq(A.oid(A.OID.c), A.printable(c))) : null, o ? A.set(A.seq(A.oid(A.OID.o), A.utf8(o))) : null, A.set(A.seq(A.oid(A.OID.cn), A.utf8(cn))), email ? A.set(A.seq(A.oid(A.OID.email), A.ia5(email))) : null].filter(Boolean));
export async function createIdentity({ cn, o = '', email = '', c = '', years = 5, passphrase }) {
  if (!passphrase) throw new Error('A passphrase is required to protect the Digital ID.');
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey));
  const serial = randomBytes(16); serial[0] &= 0x7f; serial[0] |= 0x10;
  const name = nameDer({ cn, o, email, c }); const now = new Date(Date.now() - 86400000); const until = new Date(Date.now() + years * 365.25 * 86400000);
  const ski = (await digest('SHA-1', A.parse(spki).kids[1].value.subarray(1)));
  const exts = A.seq(
    A.seq(A.oid(A.OID.basicConstraints), A.bool(true), A.octet(A.seq())),
    A.seq(A.oid(A.OID.keyUsage), A.bool(true), A.octet(A.tlv(0x03, new Uint8Array([6, 0xC0])))),
    A.seq(A.oid(A.OID.extKeyUsage), A.octet(A.seq(A.oid(A.OID.emailProtection), A.oid(A.OID.adobeDocSign)))),
    A.seq(A.oid(A.OID.ski), A.octet(A.octet(ski)))
  );
  const algo = A.seq(A.oid(A.OID.sha256Rsa), A.nul());
  const tbs = A.seq(A.explicit(0, A.int(2)), A.int(serial), algo, name, A.seq(A.time(now), A.time(until)), name, spki, A.explicit(3, exts));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, tbs));
  const cert = A.seq(tbs, algo, A.bitstr(sig));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const id = saveIdentity({ cn, o, email, c, cert: b64(cert), chain: [], keyAlg: { name: 'RSASSA-PKCS1-v1_5' }, sealed: await sealKey(pkcs8, passphrase), created: new Date().toISOString(), source: 'self' });
  pkcs8.fill(0); return id;
}
export function certInfo(der) {
  const c = A.parse(der); const tbs = c.kids[0]; let k = 0; if (tbs.kids[0].tag === 0xA0) k = 1;
  const serial = tbs.kids[k], issuer = tbs.kids[k + 2], validity = tbs.kids[k + 3], subject = tbs.kids[k + 4], spki = tbs.kids[k + 5];
  return { serial, issuer, subject, spki: spki.raw, subj: A.nameToObj(subject), iss: A.nameToObj(issuer), notBefore: A.parseTime(validity.kids[0]), notAfter: A.parseTime(validity.kids[1]), selfSigned: hex(issuer.raw) === hex(subject.raw), tbs: tbs.raw, sigAlg: A.oidStr(c.kids[1].kids[0]), sig: c.kids[2].value.subarray(1) };
}

/* ---------- CMS ---------- */
// key: non-extractable CryptoKey from unlockIdentity()
export async function cmsSign(hash, id, key, when = new Date()) {
  const cert = unb64(id.cert); const ci = certInfo(cert); const ka = id.keyAlg || { name: 'RSASSA-PKCS1-v1_5' };
  const certHash = await digest('SHA-256', cert);
  const attrs = [
    A.seq(A.oid(A.OID.contentType), A.set(A.oid(A.OID.data))),
    A.seq(A.oid(A.OID.signingTime), A.set(A.time(when))),
    A.seq(A.oid(A.OID.messageDigest), A.set(A.octet(hash))),
    A.seq(A.oid(A.OID.signingCertV2), A.set(A.seq(A.seq(A.seq(A.octet(certHash))))))
  ];
  const signedSet = A.setSorted(...attrs); // DER SET OF (sorted)
  let signature = new Uint8Array(await crypto.subtle.sign(signAlg(ka), key, signedSet));
  let sigAlgId = A.seq(A.oid(A.OID.rsa), A.nul());
  if (ka.name === 'ECDSA') { const n = signature.length / 2; signature = A.seq(A.int(signature.slice(0, n)), A.int(signature.slice(n))); sigAlgId = A.seq(A.oid(A.OID.ecdsa256)); }
  const signedAttrs = concat(new Uint8Array([0xA0]), signedSet.subarray(1)); // [0] IMPLICIT
  const sha = A.seq(A.oid(A.OID.sha256), A.nul());
  const signer = A.seq(A.int(1), A.seq(ci.issuer.raw, ci.serial.raw), sha, signedAttrs, sigAlgId, A.octet(signature));
  const sd = A.seq(A.int(1), A.set(sha), A.seq(A.oid(A.OID.data)), A.implicitCons(0, cert, ...(id.chain || []).map(unb64)), A.set(signer));
  return A.seq(A.oid(A.OID.signedData), A.explicit(0, sd));
}

/* ---------- signing a PDF ---------- */
function appearance(pdf, w, h, font, bold, lines, img) {
  const ctx = pdf.context; let ops = 'q 0.97 0.985 1 rg 0 0 ' + f2(w) + ' ' + f2(h) + ' re f 0.25 0.45 0.75 RG 0.8 w 0.4 0.4 ' + f2(w - 0.8) + ' ' + f2(h - 0.8) + ' re S Q ';
  const res = { Font: { F1: font.ref, F2: bold.ref }, XObject: {} };
  let tx = 6;
  if (img) { const sc = Math.min(w * 0.42 / img.width, (h - 8) / img.height), iw = img.width * sc, ih = img.height * sc; ops += `q ${f2(iw)} 0 0 ${f2(ih)} 4 ${f2((h - ih) / 2)} cm /Im1 Do Q `; res.XObject.Im1 = img.ref; tx = iw + 10; }
  const safe = (fnt, t) => [...t].map(ch => { try { fnt.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
  const widest = Math.max(...lines.map((t, k) => (k === 0 ? bold : font).widthOfTextAtSize(safe(k === 0 ? bold : font, t), k === 0 ? 1.08 : 1)));
  const size = Math.max(3, Math.min(10, (h - 8) / (lines.length * 1.25), (w - tx - 4) / Math.max(1, widest)));
  ops += 'BT 0.1 0.2 0.35 rg ';
  lines.forEach((t, k) => { const fnt = k === 0 ? bold : font; const s = k === 0 ? size * 1.08 : size; const clean = [...t].map(ch => { try { fnt.encodeText(ch); return ch; } catch (e) { return '?'; } }).join(''); ops += `/${k === 0 ? 'F2' : 'F1'} ${f2(s)} Tf 1 0 0 1 ${f2(tx)} ${f2(h - 5 - s - k * size * 1.25)} Tm ${fnt.encodeText(clean)} Tj `; });
  ops += 'ET';
  return ctx.register(ctx.flateStream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: res }));
}
function lookupField(pdf, name) {
  const form = pdf.getForm(); try { const f = form.getField(name); return f; } catch (e) { return null; }
}
// opts: {fieldName (existing empty signature field) | page + rect, reason, location, contact, withImage}
export async function signBytes(bytes, id, opts = {}) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = pdf.context; const when = opts.when || new Date();
  const font = await pdf.embedFont(L.StandardFonts.Helvetica), bold = await pdf.embedFont(L.StandardFonts.HelveticaBold);
  const sigDict = ctx.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 9999999999, 9999999999, 9999999999], Contents: PDFHexString.of('0'.repeat(SIG_HEX)),
    M: PDFString.fromDate(when), Name: PDFHexString.fromText(id.cn),
    ...(opts.reason ? { Reason: PDFHexString.fromText(opts.reason) } : {}), ...(opts.location ? { Location: PDFHexString.fromText(opts.location) } : {}), ...(opts.contact ? { ContactInfo: PDFHexString.fromText(opts.contact) } : {}),
    Prop_Build: { App: { Name: 'Lumen_PDF' } }
  });
  const sigRef = ctx.register(sigDict);
  const form = pdf.getForm();
  const dt = `${when.getFullYear()}.${String(when.getMonth() + 1).padStart(2, '0')}.${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const lines = [`Digitally signed by ${id.cn}`, `Date: ${dt}`, ...(opts.reason ? [`Reason: ${opts.reason}`] : []), ...(opts.location ? [`Location: ${opts.location}`] : [])];
  let img = null; if (opts.image) { const d = dataUrlToBytes(opts.image); if (d) img = /png/.test(d.mime) ? await pdf.embedPng(d.bytes) : await pdf.embedJpg(d.bytes); }
  let widget, fieldDict;
  if (opts.fieldName) {
    const f = lookupField(pdf, opts.fieldName);
    if (!f || !(f instanceof L.PDFSignature)) throw new Error(`“${opts.fieldName}” is not a signature field.`);
    fieldDict = f.acroField.dict; if (fieldDict.lookup(PDFName.of('V'))) throw new Error(`“${opts.fieldName}” is already signed.`);
    const w = f.acroField.getWidgets()[0]; widget = w.dict;
  } else {
    const page = pdf.getPages()[opts.page || 0]; const [x1, y1, x2, y2] = normRect(opts.rect || [72, 72, 252, 122]);
    let n = 1; const names = new Set(form.getFields().map(x => x.getName())); while (names.has('Signature' + n)) n++;
    widget = ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText('Signature' + n), Rect: [x1, y1, x2, y2], F: 132, P: page.ref });
    const ref = ctx.register(widget); page.node.addAnnot(ref); form.acroForm.addField(ref); fieldDict = widget;
  }
  fieldDict.set(PDFName.of('V'), sigRef);
  const r = widget.lookup(PDFName.of('Rect')).asArray().map(x => x.asNumber()); const w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
  widget.set(PDFName.of('AP'), ctx.obj({ N: appearance(pdf, w, h, font, bold, lines, img) }));
  widget.set(PDFName.of('F'), PDFNumber.of(132)); // print + locked
  form.acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  const out = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
  // locate placeholders
  const s = new TextDecoder('latin1').decode(out);
  const ci = s.lastIndexOf('<' + '0'.repeat(SIG_HEX) + '>'); if (ci < 0) throw new Error('Signature placeholder not found');
  const b0 = s.lastIndexOf('/ByteRange', ci); const bi = b0 >= 0 ? s.indexOf('[', b0) : -1;
  const be = s.indexOf(']', bi); if (bi < 0 || be < 0) throw new Error('ByteRange placeholder not found');
  const a = ci, b = ci + SIG_HEX + 2;
  const br = `[0 ${a} ${b} ${out.length - b}]`; const slot = be + 1 - bi; if (br.length > slot) throw new Error('ByteRange too long');
  const patched = out.slice(); const brBytes = enc.encode(br.padEnd(slot, ' ')); patched.set(brBytes, bi);
  const hash = await digest('SHA-256', concat(patched.subarray(0, a), patched.subarray(b)));
  const key = opts.key || (await unlockIdentity(id, opts.passphrase ?? '')).key;
  const cms = await cmsSign(hash, id, key, when);
  if (cms.length * 2 > SIG_HEX) throw new Error('Signature too large');
  patched.set(enc.encode(hex(cms).padEnd(SIG_HEX, '0')), a + 1);
  return patched;
}

/* ---------- validation ---------- */
const HASH = { [A.OID.sha256]: 'SHA-256', [A.OID.sha384]: 'SHA-384', [A.OID.sha512]: 'SHA-512', [A.OID.sha1]: 'SHA-1' };
async function verifyRaw(spkiDer, sigAlgOid, hashName, data, sig) {
  const spki = A.parse(spkiDer); const keyAlg = A.oidStr(spki.kids[0].kids[0]);
  if (keyAlg === A.OID.rsa) { const k = await crypto.subtle.importKey('spki', spkiDer, { name: 'RSASSA-PKCS1-v1_5', hash: hashName }, false, ['verify']); return crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, sig, data); }
  if (keyAlg === A.OID.ecPub) {
    const curveOid = A.oidStr(spki.kids[0].kids[1]); const curve = { '1.2.840.10045.3.1.7': 'P-256', '1.3.132.0.34': 'P-384', '1.3.132.0.35': 'P-521' }[curveOid]; if (!curve) return false;
    const k = await crypto.subtle.importKey('spki', spkiDer, { name: 'ECDSA', namedCurve: curve }, false, ['verify']);
    const n = { 'P-256': 32, 'P-384': 48, 'P-521': 66 }[curve]; const ds = A.parse(sig); const fix = v => { let b = v; while (b.length > n && b[0] === 0) b = b.subarray(1); const o = new Uint8Array(n); o.set(b, n - b.length); return o; };
    return crypto.subtle.verify({ name: 'ECDSA', hash: hashName }, k, concat(fix(ds.kids[0].value), fix(ds.kids[1].value)), data);
  }
  return false;
}
export async function validateSignatures(bytes) {
  if (!new TextDecoder('latin1').decode(bytes).includes('/ByteRange')) return [];
  let pdf; try { pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true }); } catch (e) { return []; }
  const out = []; const ctx = pdf.context;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj instanceof PDFStream) continue;
    const ft = obj.lookup(PDFName.of('FT')); if (ft !== PDFName.of('Sig')) continue;
    const v = obj.lookup(PDFName.of('V')); if (!(v instanceof PDFDict)) continue;
    const res = { field: obj.lookup(PDFName.of('T'))?.decodeText?.() || 'Signature', ok: false, problems: [] };
    try {
      res.name = v.lookup(PDFName.of('Name'))?.decodeText?.() || ''; res.reason = v.lookup(PDFName.of('Reason'))?.decodeText?.() || ''; res.location = v.lookup(PDFName.of('Location'))?.decodeText?.() || '';
      try { res.time = v.lookup(PDFName.of('M'))?.decodeDate?.()?.toISOString(); } catch (e) { /* ignore */ }
      res.subFilter = v.lookup(PDFName.of('SubFilter'))?.decodeText?.() || '';
      const br = v.lookup(PDFName.of('ByteRange')).asArray().map(x => x.asNumber());
      const contents = v.lookup(PDFName.of('Contents')).asBytes();
      const data = []; for (let k = 0; k + 1 < br.length; k += 2) data.push(bytes.subarray(br[k], br[k] + br[k + 1]));
      const signed = concat(...data);
      res.coversAll = br.length === 4 && br[0] === 0 && br[2] + br[3] === bytes.length;
      res.coverage = br[2] + br[3]; res.fileLength = bytes.length;
      if (!/pkcs7\.detached|CAdES\.detached/.test(res.subFilter)) { res.problems.push(`Signature format ${res.subFilter} is not supported for validation`); out.push(res); continue; }
      const ci = A.parse(contents); const sd = ci.kids[1].kids[0];
      let k = 3; const certsNode = sd.kids.find(n => n.tag === 0xA0); const certs = certsNode ? certsNode.kids.map(n => n.raw) : [];
      const signerInfos = sd.kids[sd.kids.length - 1]; const si = signerInfos.kids[0]; void k;
      const sid = si.kids[1]; const digestAlg = A.oidStr(si.kids[2].kids[0]); const hashName = HASH[digestAlg];
      let idx = 3; let signedAttrs = null; if (si.kids[idx].tag === 0xA0) { signedAttrs = si.kids[idx]; idx++; }
      const sigAlg = A.oidStr(si.kids[idx].kids[0]); const sigVal = si.kids[idx + 1].value;
      // signer certificate (IssuerAndSerialNumber)
      let cert = certs[0];
      if (sid.tag === 0x30) for (const c of certs) { const inf = certInfo(c); if (hex(inf.serial.raw) === hex(sid.kids[1].raw) && hex(inf.issuer.raw) === hex(sid.kids[0].raw)) cert = c; }
      if (!cert) throw new Error('No signer certificate in the signature');
      const info = certInfo(cert); res.signer = info.subj; res.issuer = info.iss; res.selfSigned = info.selfSigned; res.notAfter = info.notAfter?.toISOString(); res.notBefore = info.notBefore?.toISOString();
      const docHash = await digest(hashName, signed);
      let toVerify, mdOk = true;
      if (signedAttrs) {
        for (const at of signedAttrs.kids) {
          const t = A.oidStr(at.kids[0]);
          if (t === A.OID.messageDigest) mdOk = hex(at.kids[1].kids[0].value) === hex(docHash);
          if (t === A.OID.signingTime) res.time = A.parseTime(at.kids[1].kids[0])?.toISOString() || res.time;
        }
        toVerify = concat(new Uint8Array([0x31]), signedAttrs.raw.subarray(1));
      } else toVerify = docHash;
      res.intact = mdOk;
      res.cryptoOk = await verifyRaw(info.spki, sigAlg, hashName, toVerify, sigVal);
      if (info.selfSigned) { try { res.certSelfOk = await verifyRaw(info.spki, info.sigAlg, info.sigAlg === A.OID.sha256Rsa ? 'SHA-256' : info.sigAlg === A.OID.sha384Rsa ? 'SHA-384' : info.sigAlg === A.OID.sha512Rsa ? 'SHA-512' : 'SHA-256', info.tbs, info.sig); } catch (e) { res.certSelfOk = false; } }
      const t = res.time ? new Date(res.time) : new Date();
      res.certValidAtTime = (!info.notBefore || t >= info.notBefore) && (!info.notAfter || t <= info.notAfter);
      if (!res.intact) res.problems.push('The document was changed after it was signed');
      if (!res.cryptoOk) res.problems.push('The signature value does not match the signer’s certificate');
      if (!res.coversAll) res.problems.push('The file has content that was added after signing (not covered by this signature)');
      if (!res.certValidAtTime) res.problems.push('The certificate was not valid at signing time');
      res.ok = res.intact && res.cryptoOk;
      res.trust = info.selfSigned ? 'Self-signed certificate — the signer’s identity is not verified by a certificate authority' : `Issued by ${info.iss.CN || info.iss.O || 'an unknown authority'} (trust not checked)`;
    } catch (e) { res.problems.push('Could not read the signature: ' + e.message); }
    out.push(res);
  }
  return out;
}

/* ---------- UI ---------- */
/* ---------- passphrase prompts ---------- */
const MIN_PASS = 8;
function passDialog({ title, instruction, confirm = false, extra = [], ok = 'OK', note = '' }) {
  return new Promise(res => Aero.dialog({
    title, width: 470, instruction, ok,
    fields: [...extra, { key: 'p', label: confirm ? 'New passphrase' : 'Passphrase', type: 'password', value: '' }, ...(confirm ? [{ key: 'p2', label: 'Confirm passphrase', type: 'password', value: '' }] : [])],
    html: note ? `<div class="dnote">${note}</div>` : '',
    onOK: v => {
      if (confirm && (v.p || '').length < MIN_PASS) { Aero.alert(title, `Use a passphrase of at least ${MIN_PASS} characters.`).then(() => res(passDialog({ title, instruction, confirm, extra, ok, note }))); return; }
      if (confirm && v.p !== v.p2) { Aero.alert(title, 'The passphrases don’t match.').then(() => res(passDialog({ title, instruction, confirm, extra, ok, note }))); return; }
      res(v);
    },
    onCancel: () => res(null)
  }));
}
const PROTECT_NOTE = 'The private key is encrypted with this passphrase (PBKDF2-SHA256, 600,000 iterations + AES-256-GCM) before it is stored. You will be asked for it every time you sign. It cannot be recovered if you forget it.';
// Older versions stored the key unprotected: encrypt it now and delete the plain copy.
export async function ensureProtected() {
  const id = prefs.get('digitalId', null); if (!needsMigration(id)) return true;
  const v = await passDialog({ title: 'Protect your Digital ID', instruction: `Your Digital ID “${id.cn}” is stored without protection. Choose a passphrase to encrypt it.`, confirm: true, ok: 'Protect', note: PROTECT_NOTE });
  if (!v) return false;
  Aero.busy('Encrypting the private key…'); try { await migrateIdentity(v.p); } finally { Aero.busy(); }
  Aero.toast('Digital ID encrypted — the unprotected copy was deleted'); return true;
}
async function withUnlock(title, fn, wrongFirst = false) {
  for (let tries = 0; tries < 5; tries++) {
    const v = await passDialog({ title, instruction: tries || wrongFirst ? 'Wrong passphrase — try again:' : `Enter the passphrase for “${getIdentity().cn}”:` });
    if (!v) return null;
    Aero.busy('Unlocking…');
    try { return await fn(v.p); } catch (e) { if (!(e instanceof BadPassword)) { Aero.busy(); Aero.alert(title, e.message); return null; } } finally { Aero.busy(); }
  }
  return null;
}

/* ---------- Digital ID manager ---------- */
export async function digitalIdDialog(after) {
  if (!(await ensureProtected())) return;
  const cur = getIdentity();
  const info = cur ? (() => { const ci = certInfo(unb64(cur.cert)); return `<div class="dnote" style="color:#333;line-height:1.6">Current Digital ID: <b>${esc(cur.cn)}</b>${cur.email ? ' &lt;' + esc(cur.email) + '&gt;' : ''}${cur.o ? ', ' + esc(cur.o) : ''}<br>${cur.source === 'p12' ? 'Imported' : 'Created'} ${new Date(cur.created).toLocaleDateString()} · ${ci.selfSigned ? 'self-signed' : 'issued by ' + esc(ci.iss.CN || ci.iss.O || '?')} · ${cur.keyAlg?.name === 'ECDSA' ? 'ECDSA ' + cur.keyAlg.namedCurve : 'RSA'} · valid until ${ci.notAfter ? ci.notAfter.toLocaleDateString() : '?'}<br>Private key: encrypted with your passphrase</div>
    <div class="dig-btns"><button class="aero-btn small" data-dig="cer">Export Certificate (.cer)…</button><button class="aero-btn small" data-dig="p12">Export as .p12…</button><button class="aero-btn small" data-dig="pass">Change Passphrase…</button><button class="aero-btn small" data-dig="rm">Remove ID…</button></div>`; })() : '';
  const dlg = Aero.dialog({
    title: 'Digital ID', width: 540, instruction: cur ? 'Manage your Digital ID, or create a new self-signed one' : 'Create a self-signed Digital ID, or import one (.p12 / .pfx)',
    fields: [{ key: 'cn', label: 'Name', type: 'text', value: cur?.cn || App.author || '' }, { key: 'o', label: 'Organization', type: 'text', value: cur?.o || '' }, { key: 'email', label: 'Email', type: 'text', value: cur?.email || '' }, { key: 'c', label: 'Country (2 letters)', type: 'text', value: cur?.c || '' }],
    html: info + '<div class="dig-btns"><button class="aero-btn small" data-dig="import">Import .p12 / .pfx…</button></div><div class="dnote">Self-signed IDs prove a document hasn’t changed since signing; recipients must trust your certificate (send them the .cer) to confirm your identity. An ID issued by a certificate authority can be imported from a .p12/.pfx file.</div>',
    ok: cur ? 'Create New ID…' : 'Create ID…',
    onOK: async v => {
      if (!v.cn.trim()) return Aero.alert('Digital ID', 'Enter your name.');
      if (v.c && !/^[A-Za-z]{2}$/.test(v.c)) return Aero.alert('Digital ID', 'The country must be a 2-letter code such as US or DE.');
      if (cur && !(await Aero.confirm('Digital ID', 'Creating a new ID replaces the current one (export it as .p12 first if you want to keep it).', 'Replace'))) return;
      const p = await passDialog({ title: 'Protect your Digital ID', instruction: 'Choose a passphrase for the new Digital ID', confirm: true, ok: 'Create', note: PROTECT_NOTE }); if (!p) return;
      Aero.busy('Generating key pair…');
      try { await createIdentity({ cn: v.cn.trim(), o: v.o.trim(), email: v.email.trim(), c: v.c.toUpperCase(), passphrase: p.p }); } finally { Aero.busy(); }
      Aero.toast('Digital ID created'); after?.();
    }
  });
  dlg.el.addEventListener('click', async e => {
    const a = e.target.closest('[data-dig]')?.dataset.dig; if (!a) return;
    const id = getIdentity();
    if (a === 'cer') Aero.saveFile({ name: id.cn.replace(/[^\w\- ]/g, '') + '.cer', data: unb64(id.cert), filters: [{ name: 'Certificate', extensions: ['cer'] }] });
    else if (a === 'import') { dlg.close(); importDialog(after); }
    else if (a === 'p12') {
      dlg.close();
      const ep = await passDialog({ title: 'Export Digital ID', instruction: 'Choose a password for the exported .p12 file', confirm: true, ok: 'Next', note: 'The .p12 file is encrypted with AES-256 (PBES2/PBKDF2-SHA256) and protected by an HMAC-SHA256 integrity check. Anyone with the file and its password can sign as you.' });
      if (!ep) return;
      const bytes = await withUnlock('Export Digital ID', pass => exportP12(pass, ep.p)); if (!bytes) return;
      await Aero.saveFile({ name: id.cn.replace(/[^\w\- ]/g, '') + '.p12', data: bytes, filters: [{ name: 'PKCS#12 Digital ID', extensions: ['p12', 'pfx'] }] });
    } else if (a === 'pass') {
      dlg.close();
      const np = await passDialog({ title: 'Change passphrase', instruction: 'Choose a new passphrase', confirm: true, ok: 'Next' }); if (!np) return;
      if (await withUnlock('Change passphrase', pass => changePassphrase(pass, np.p))) Aero.toast('Passphrase changed');
    } else if (a === 'rm') {
      dlg.close();
      if (await Aero.confirm('Remove Digital ID', `Delete the Digital ID “${id.cn}” from this computer? Documents you already signed stay valid, but you can no longer sign with this ID unless you exported it as .p12.`, 'Remove')) { removeIdentity(); Aero.toast('Digital ID removed'); }
    }
  });
}
export async function importDialog(after) {
  const f = await Aero.openFile({ accept: '.p12,.pfx,application/x-pkcs12', filters: [{ name: 'PKCS#12 Digital ID', extensions: ['p12', 'pfx'] }] });
  if (!f[0]) return;
  if (getIdentity() && !(await Aero.confirm('Import Digital ID', 'Importing replaces your current Digital ID (export it as .p12 first if you want to keep it).', 'Replace'))) return;
  const bytes = new Uint8Array(f[0].data);
  for (let tries = 0; tries < 5; tries++) {
    const v = await passDialog({ title: 'Import Digital ID', instruction: tries ? 'Wrong password — enter the password of the .p12 file:' : `Password of “${f[0].name}”:`, ok: 'Next' });
    if (!v) return;
    let parsedOk = false;
    try { Aero.busy('Reading Digital ID…'); await parsePfx(bytes, v.p); parsedOk = true; }
    catch (e) { if (!(e instanceof BadPassword)) { Aero.busy(); Aero.alert('Import Digital ID', 'Could not read the file: ' + e.message); return; } }
    finally { Aero.busy(); }
    if (!parsedOk) continue;
    const np = await passDialog({ title: 'Protect your Digital ID', instruction: 'Choose a passphrase to protect the imported ID in Lumen PDF', confirm: true, ok: 'Import', note: PROTECT_NOTE });
    if (!np) return;
    try {
      Aero.busy('Importing…'); const r = await importP12(bytes, v.p, np.p); Aero.busy();
      Aero.toast(`Imported Digital ID “${r.id.cn}”` + (r.expired ? ' — warning: the certificate has expired' : r.notYet ? ' — warning: the certificate is not valid yet' : ''), 5000);
      after?.(); return r;
    } catch (e) { Aero.busy(); Aero.alert('Import Digital ID', e.message); return; }
  }
}

/* ---------- signing UI ---------- */
export async function signDialog({ page = 0, rect = null, fieldName = null } = {}) {
  const d = App.doc; if (!d) return;
  if (d.state.security) { Aero.alert('Sign with Digital ID', 'Remove the password protection first (File › Protect › Remove Security), sign, then protect the signed file if needed.'); return; }
  if (!(await ensureProtected())) return;
  if (!getIdentity()) { digitalIdDialog(() => signDialog({ page, rect, fieldName })); return; }
  if (d.sigs?.some(r => r.ok) && !(await Aero.confirm('Sign with Digital ID', 'This document already has digital signatures. Lumen PDF rewrites the file when signing, so the existing signatures will no longer validate. Continue?', 'Sign Anyway'))) return;
  const empty = [];
  try { const lib = await PDFDocument.load(d.state.bytes, { updateMetadata: false }); for (const f of lib.getForm().getFields()) if (f instanceof L.PDFSignature && !f.acroField.dict.lookup(PDFName.of('V'))) empty.push(f.getName()); } catch (e) { /* no form */ }
  const id = getIdentity();
  const where = [['__new', rect ? 'The area I drew' : 'New box on the current page (bottom right)'], ...empty.map(n => [n, `Signature field “${n}”`])];
  const v = await new Promise(res => Aero.dialog({
    title: 'Sign with Digital ID', width: 500, instruction: `Sign as ${id.cn}`,
    fields: [{ key: 'where', label: 'Place signature in', type: 'select', value: fieldName || (empty[0] && !rect ? empty[0] : '__new'), options: where }, { key: 'reason', label: 'Reason', type: 'text', value: prefs.get('sigReason', 'I approve this document') }, { key: 'location', label: 'Location', type: 'text', value: prefs.get('sigLocation', '') }, { key: 'img', label: 'Include my signature image', type: 'checkbox', value: !!App.signature }, { key: 'pass', label: 'Digital ID passphrase', type: 'password', value: '' }],
    html: '<div class="dnote">The signed copy is saved as a new file and opened in a new tab. Any later change to it invalidates the signature, so sign last.</div>', ok: 'Sign',
    onOK: res, onCancel: () => res(null)
  }));
  if (!v) return;
  prefs.set('sigReason', v.reason); prefs.set('sigLocation', v.location);
  let key = null;
  Aero.busy('Unlocking…'); try { key = (await unlockIdentity(id, v.pass)).key; } catch (e) { key = null; } finally { Aero.busy(); }
  if (!key) { key = await withUnlock('Sign with Digital ID', async p => (await unlockIdentity(id, p)).key, true); if (!key) return; }
  const opts = { key, reason: v.reason, location: v.location, image: v.img && App.signature ? App.signature.dataUrl : null };
  if (v.where === '__new') { const inf = d.info[page]; opts.page = page; opts.rect = rect || [inf.view[2] - 72 - 200, inf.view[1] + 72, inf.view[2] - 72, inf.view[1] + 72 + 54]; } else opts.fieldName = v.where;
  return signCurrent(opts);
}
export async function signCurrent(opts, { save = true } = {}) {
  const d = App.doc; Aero.busy('Signing…');
  try {
    const { bytes } = await buildOutput(d.state);
    const signed = await signBytes(bytes, getIdentity(), opts);
    Aero.busy();
    const name = Aero.baseName(d.name) + ' (signed).pdf';
    if (save) { const p = await Aero.saveFile({ name, data: signed, filters: [{ name: 'PDF document', extensions: ['pdf'] }] }); if (!p) return null; }
    emit('openSigned', { bytes: signed, name });
    return signed;
  } catch (e) { console.warn(e); Aero.alert('Sign with Digital ID', 'Could not sign: ' + (e instanceof BadPassword ? 'wrong passphrase' : e.message)); return null; }
  finally { Aero.busy(); }
}
export function signaturesDialog(results) {
  if (!results?.length) { Aero.alert('Signatures', 'This document has no digital signatures.'); return; }
  const html = results.map(r => `<div class="sigres ${r.ok && r.coversAll ? 'good' : r.ok ? 'warn' : 'bad'}"><div class="sigres-h">${r.ok && r.coversAll ? '✔' : r.ok ? '!' : '✖'} ${esc(r.signer?.CN || r.name || r.field)}</div>
    <div>${r.ok ? (r.coversAll ? 'Signature is valid — the document has not been modified since it was signed.' : 'Signature is valid for the signed revision, but content was added afterwards.') : 'Signature is INVALID.'}</div>
    ${r.problems.length ? `<ul>${r.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    <div class="dim">${r.time ? 'Signed ' + new Date(r.time).toLocaleString() : ''}${r.reason ? ' · Reason: ' + esc(r.reason) : ''}${r.location ? ' · ' + esc(r.location) : ''}</div>
    <div class="dim">${esc(r.trust || '')}${r.signer?.E ? ' · ' + esc(r.signer.E) : ''}${r.signer?.O ? ' · ' + esc(r.signer.O) : ''}</div></div>`).join('');
  Aero.dialog({ title: 'Signatures', noCancel: true, width: 560, html });
}
export { b64, unb64 };
