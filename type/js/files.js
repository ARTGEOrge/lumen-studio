'use strict';
/* Lumen Type — files: .ltype projects, font import (TTF/OTF/WOFF/WOFF2/UFO zip), export (TTF/OTF/WOFF/WOFF2/UFO), sample. */
(function () {
  const A = window.LT, TM = window.TM, FIO = window.FIO, SF = window.SFNT;
  const inflate = d => window.fflate.unzlibSync(d), deflate = d => window.fflate.zlibSync(d, { level: 9 });

  // ---------- WOFF2 via worker ----------
  const workers = {}; let wid = 0;
  function woff2(op, bytes) {
    return new Promise((res, rej) => {
      let w = workers[op];
      if (!w) { try { w = workers[op] = new Worker('js/woff2-worker.js'); w.pend = new Map(); w.onmessage = e => { const p = w.pend.get(e.data.id); if (!p) return; w.pend.delete(e.data.id); e.data.ok ? p.res(e.data.data) : p.rej(new Error(e.data.error)); }; w.onerror = e => { w.pend.forEach(p => p.rej(new Error(e.message || 'WOFF2 worker failed'))); w.pend.clear(); delete workers[op]; }; } catch (e) { rej(e); return; } }
      const id = ++wid; w.pend.set(id, { res, rej });
      const copy = bytes.slice(); w.postMessage({ id, op, data: copy.buffer }, [copy.buffer]);
    });
  }
  A.woff2 = woff2;

  A.confirmDiscard = async () => !Aero.dirty || Aero.confirm('Unsaved changes', 'Discard the changes to the current font?', 'Discard');
  const base = n => Aero.baseName(n || 'Untitled');

  // ---------- open ----------
  async function parseFile(f) {
    const kind = FIO.sniff(f.data), ext = (f.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
    if (kind === 'json' || ext === 'ltype') {
      const d = JSON.parse(new TextDecoder().decode(f.data));
      if (d.format !== 'lumen-type') throw new Error('Not a Lumen Type project');
      return { font: TM.sanitizeFont(d), name: base(f.name) + '.ltype', path: f.path };
    }
    if (kind === 'zip') {
      const files = window.fflate.unzipSync(new Uint8Array(f.data), { filter: e => /\.(plist|glif|fea)$/i.test(e.name) && e.originalSize < 50e6 });
      return { font: TM.sanitizeFont(FIO.importUFO(files)), name: base(f.name).replace(/\.ufo$/i, '') + '.ltype' };
    }
    let buf = f.data;
    if (kind === 'woff2') { const out = await woff2('decompress', new Uint8Array(buf)); buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength); }
    else if (kind === 'ttc') throw new Error('Font collections (.ttc) are not supported — extract one font first');
    else if (!['ttf', 'otf', 'woff'].includes(kind)) throw new Error('Unrecognised file: ' + f.name);
    const font = TM.sanitizeFont(FIO.importOpenType(buf, window.opentype, inflate));
    return { font, name: base(f.name) + '.ltype' };
  }
  A.openFiles = async (files) => {
    const f = files[0]; if (!f) return;
    if (!(await A.confirmDiscard())) return;
    Aero.busy('Opening ' + f.name + '…');
    try {
      await new Promise(r => setTimeout(r, 30));
      const r = await parseFile(f);
      A.hideWelcome && A.hideWelcome();
      A.setFont(r.font, r.name, r.path || null);
      A.setView('font');
      A.toast(`Opened ${f.name}: ${r.font.order.length} glyphs, ${TM.kernPairs(r.font).length} kerning entries`);
    } catch (e) { console.warn(e); Aero.alert('Could not open file', String(e.message || e)); }
    finally { Aero.busy(); }
  };
  A.openDialog = async () => {
    const files = await Aero.openFile({ accept: '.ltype,.ttf,.otf,.woff,.woff2,.zip,.json', filters: [{ name: 'Fonts & projects', extensions: ['ltype', 'ttf', 'otf', 'woff', 'woff2', 'zip'] }, { name: 'All files', extensions: ['*'] }] });
    if (files.length) A.openFiles(files);
  };

  // ---------- save ----------
  A.save = async (as) => {
    if (!A.font) return;
    if (A.isLive()) A.liveEnd();
    const data = JSON.stringify(TM.toProject(A.font));
    const name = /\.ltype$/i.test(A.docName) ? A.docName : base(A.docName) + '.ltype';
    const p = await Aero.saveFile({ name, data, filters: [{ name: 'Lumen Type project', extensions: ['ltype'] }], path: as ? null : A.filePath });
    if (!p) return false;
    if (Aero.isDesktop || typeof p === 'string' && /[\\/]/.test(p)) A.filePath = p;
    A.docName = base(p) + '.ltype'; Aero.setDoc(A.docName, false); A.toast('Saved ' + A.docName);
    return true;
  };

  // ---------- export ----------
  A.compile = async (fmt, opts = {}) => {
    const o = { correctDirection: opts.correctDirection !== false, decompose: !!opts.decompose, legacyKern: opts.legacyKern !== false };
    if (opts.removeOverlap) o.overlap = g => window.Overlap.removeOverlap(g, window.paper);
    const flavor = /otf|cff/.test(fmt) ? 'otf' : 'ttf';
    const sfnt = flavor === 'otf' ? SF.buildOTF(A.font, window.opentype, o) : SF.buildTTF(A.font, o);
    if (fmt === 'ttf' || fmt === 'otf') return { bytes: sfnt, ext: flavor };
    if (fmt === 'woff-ttf' || fmt === 'woff-otf') return { bytes: SF.buildWOFF(sfnt, deflate), ext: 'woff' };
    if (fmt === 'woff2-ttf' || fmt === 'woff2-otf') return { bytes: await woff2('compress', sfnt), ext: 'woff2' };
    throw new Error('Unknown format ' + fmt);
  };
  const FORMATS = [['ttf', 'TrueType (.ttf) — quadratic outlines'], ['otf', 'OpenType CFF (.otf) — cubic outlines'], ['woff-ttf', 'WOFF (.woff, TrueType inside)'], ['woff-otf', 'WOFF (.woff, CFF inside)'], ['woff2-ttf', 'WOFF2 (.woff2, TrueType inside)'], ['woff2-otf', 'WOFF2 (.woff2, CFF inside)']];
  let lastFmt = 'ttf';
  A.exportDialog = (fmt) => {
    if (!A.font) return;
    const problems = check();
    Aero.dialog({ title: 'Export Font', instruction: problems.length ? `Checks: ${problems.join(' · ')}` : 'All glyphs are ready to export.', width: 470, fields: [
      { key: 'fmt', label: 'Format', type: 'select', value: fmt || lastFmt, options: FORMATS },
      { key: 'removeOverlap', label: 'Remove overlaps', type: 'checkbox', value: false },
      { key: 'correctDirection', label: 'Correct contour directions', type: 'checkbox', value: true },
      { key: 'decompose', label: 'Decompose components (TrueType)', type: 'checkbox', value: false },
      { key: 'legacyKern', label: 'Also write legacy “kern” table (if small)', type: 'checkbox', value: true }],
      onOK: async v => {
        lastFmt = v.fmt;
        Aero.busy('Compiling font…');
        try {
          await new Promise(r => setTimeout(r, 30));
          const r = await A.compile(v.fmt, v);
          const name = SF.styleInfo(A.font.info).ps + '.' + r.ext;
          Aero.busy();
          const p = await Aero.saveFile({ name, data: r.bytes, filters: [{ name: r.ext.toUpperCase() + ' font', extensions: [r.ext] }] });
          if (p) A.toast(`Exported ${name} (${(r.bytes.length / 1024).toFixed(1)} KB)`);
        } catch (e) { console.warn(e); Aero.busy(); Aero.alert('Export failed', String(e.message || e)); }
      } });
  };
  function check() {
    const F = A.font, out = [], cmap = new Map();
    let open = 0, dup = 0, miss = 0;
    F.order.forEach(n => { const g = F.glyphs[n]; if (g.contours.some(c => c.open)) open++; g.unicodes.forEach(u => { if (cmap.has(u)) dup++; cmap.set(u, n); }); if (g.components.some(c => !F.glyphs[c.base])) miss++; });
    if (open) out.push(`${open} glyph(s) with open contours (closed on export)`);
    if (dup) out.push(`${dup} duplicate code point(s)`);
    if (miss) out.push(`${miss} glyph(s) with missing components (skipped)`);
    if (!cmap.has(32)) out.push('no space glyph');
    return out;
  }
  A.exportUFO = async () => {
    if (!A.font) return;
    try {
      const files = FIO.exportUFO(A.font), zip = window.fflate.zipSync(files, { level: 6 });
      const name = SF.styleInfo(A.font.info).ps + '.ufo.zip';
      const p = await Aero.saveFile({ name, data: zip, filters: [{ name: 'Zipped UFO', extensions: ['zip'] }] });
      if (p) A.toast('Exported ' + name);
    } catch (e) { Aero.alert('Export failed', String(e.message || e)); }
  };
  // load the compiled font into the page (FontFace) to proof it with the browser's own font engine
  A.testInstall = async () => {
    try {
      const r = await A.compile('ttf', {}), fam = 'LumenTypeProof' + Date.now();
      const ff = new FontFace(fam, r.bytes); await ff.load(); document.fonts.add(ff);
      const text = A.previewText() || 'Hamburgefonstiv';
      Aero.dialog({ title: 'Browser Proof', noCancel: true, width: 640, instruction: 'The exported TrueType font, loaded by the browser’s own font engine (validated by OpenType Sanitizer):', html: `<div class="proof" contenteditable="true" spellcheck="false" style="font-family:'${fam}';font-size:44px;line-height:1.25;padding:10px 4px;outline:none;font-kerning:normal">${Aero.esc(text)}</div><div class="proof" style="font-family:'${fam}';font-size:18px">${Aero.esc('The quick brown fox jumps over the lazy dog 0123456789')}</div>` });
    } catch (e) { Aero.alert('The browser rejected the font', String(e.message || e)); }
  };

  // ---------- new ----------
  const BASIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;!?\'"-()&/@#%*+=';
  A.newDialog = () => Aero.dialog({ title: 'New Font', fields: [
    { key: 'fam', label: 'Family name', type: 'text', value: 'My Font' }, { key: 'style', label: 'Style', type: 'text', value: 'Regular' },
    { key: 'upm', label: 'Units per em', type: 'select', value: '1000', options: [['1000', '1000 (PostScript / CFF)'], ['2048', '2048 (TrueType)'], ['1024', '1024']] },
    { key: 'basic', label: 'Add empty glyphs for A–Z, a–z, 0–9 & punctuation', type: 'checkbox', value: true }],
    onOK: async v => {
      if (!(await A.confirmDiscard())) return;
      const upm = +v.upm, k = upm / 1000;
      const f = TM.newFont({ familyName: String(v.fam || 'Untitled').trim() || 'Untitled', styleName: String(v.style || 'Regular').trim() || 'Regular', unitsPerEm: upm, ascender: Math.round(800 * k), descender: Math.round(-200 * k), xHeight: Math.round(500 * k), capHeight: Math.round(700 * k), lineGap: Math.round(200 * k), underlinePosition: Math.round(-100 * k), underlineThickness: Math.round(50 * k) });
      if (v.basic) for (const ch of BASIC) { const cp = ch.codePointAt(0), n = TM.glyphNameFor(cp); if (!f.glyphs[n]) { f.glyphs[n] = TM.newGlyph(n, [cp], Math.round(upm * (/[A-Z]/.test(ch) ? 0.62 : /[a-z0-9]/.test(ch) ? 0.52 : 0.3))); f.order.push(n); } }
      A.hideWelcome && A.hideWelcome();
      A.setFont(f, f.info.familyName + '.ltype'); A.setView('font');
    } });

  // ---------- sample ----------
  A.openSample = async () => {
    try {
      const r = await fetch('sample/montserrat-400.woff'); if (!r.ok) throw new Error('sample font missing');
      const buf = await r.arrayBuffer();
      const font = TM.sanitizeFont(FIO.importOpenType(buf, window.opentype, inflate));
      Object.assign(font.info, { designer: 'Julieta Ulanovsky (Montserrat Project)', designerURL: 'https://github.com/JulietaUla/Montserrat', description: 'Sample document for Lumen Type: the Latin subset of Montserrat Regular (SIL Open Font License 1.1).', license: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.' });
      // demo touches: marks on figures & composites, a note
      font.order.forEach(n => { const g = font.glyphs[n], u = g.unicodes[0]; if (u >= 0x30 && u <= 0x39) g.mark = 6; else if (g.components.length) g.mark = 4; });
      if (font.glyphs.a) font.glyphs.a.note = 'Double-storey a. Try the pen (P) and drag the right sidebearing line.';
      A.hideWelcome && A.hideWelcome();
      A.setFont(font, 'Montserrat Sample.ltype');
      A.setView('font');
      const pv = document.getElementById('pvText'); if (pv && !pv.value.trim()) pv.value = 'Hamburgefonstiv';
    } catch (e) { Aero.alert('Could not open the sample', String(e.message || e)); }
  };
})();
