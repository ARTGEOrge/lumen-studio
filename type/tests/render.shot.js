// SHOT_JS body (tools/shot, URL http://localhost:5180/type/?sample): compiles the sample in the app to every format,
// loads each with the browser's font engine (Chromium runs OpenType Sanitizer on web fonts) and compares rendered
// pixels and kerned text widths with the original Montserrat WOFF.
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 60 && !(window.LT && LT.font); i++) await wait(100);
const out = { formats: {} };
const orig = await (await fetch('sample/montserrat-400.woff')).arrayBuffer();
const load = async (name, data) => { const ff = new FontFace(name, data); await ff.load(); document.fonts.add(ff); return ff; };
await load('LTOrig', orig);
const text = 'AVATAR Wave To Ty Hamburgefonstiv 0147';
function render(fam) {
  const c = document.createElement('canvas'); c.width = 900; c.height = 70; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 70); x.fillStyle = '#000'; x.font = `40px "${fam}"`; x.fontKerning = 'normal'; x.textBaseline = 'alphabetic'; x.fillText(text, 6, 50);
  const d = x.getImageData(0, 0, 900, 70).data, g = new Uint8Array(900 * 70); for (let i = 0; i < g.length; i++) g[i] = d[i * 4];
  return { g, w: x.measureText(text).width, wAV: x.measureText('AVAVAVAV').width, wNoKern: (() => { x.fontKerning = 'none'; const w = x.measureText('AVAVAVAV').width; x.fontKerning = 'normal'; return w; })() };
}
const ref = render('LTOrig');
let ink = 0; for (const v of ref.g) if (v < 128) ink++;
out.refInk = ink; out.refWidth = +ref.w.toFixed(2); out.refAV = +ref.wAV.toFixed(2); out.refAVnoKern = +ref.wNoKern.toFixed(2);
for (const fmt of ['ttf', 'otf', 'woff-ttf', 'woff-otf', 'woff2-ttf', 'woff2-otf']) {
  try {
    const r = await LT.compile(fmt, {});
    const fam = 'LT_' + fmt.replace(/\W/g, '_');
    await load(fam, r.bytes);
    const m = render(fam);
    let diff = 0, inkM = 0; for (let i = 0; i < m.g.length; i++) { if (Math.abs(m.g[i] - ref.g[i]) > 64) diff++; if (m.g[i] < 128) inkM++; }
    out.formats[fmt] = { bytes: r.bytes.length, ink: inkM, diffPx: diff, width: +m.w.toFixed(2), kernedAV: +m.wAV.toFixed(2), ok: diff < 0.01 * ink && Math.abs(m.w - ref.w) < 0.01 && Math.abs(m.wAV - ref.wAV) < 0.01 };
  } catch (e) { out.formats[fmt] = { error: String(e.message || e) }; }
}
// overlap + direction options also compile to a valid font
try { const r = await LT.compile('ttf', { removeOverlap: true }); await load('LT_ovl', r.bytes); out.overlapOption = r.bytes.length; } catch (e) { out.overlapOption = 'ERR ' + e.message; }
out.allOK = Object.values(out.formats).every(f => f.ok);
return JSON.stringify(out);
