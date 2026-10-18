'use strict';
/* Lumen Type — Font Info: names, version, style, vertical metrics, embedding. */
(function () {
  const A = window.LT, TM = window.TM, $ = id => document.getElementById(id);
  const SECTIONS = [
    ['Names', [
      ['familyName', 'Family name', 'text'], ['styleName', 'Style name', 'text', 'Regular, Italic, Bold, Bold Italic, Light, SemiBold Italic…'],
      ['versionMajor', 'Version major', 'int'], ['versionMinor', 'Version minor', 'int'],
      ['copyright', 'Copyright', 'text'], ['trademark', 'Trademark', 'text'],
      ['designer', 'Designer', 'text'], ['designerURL', 'Designer URL', 'text'],
      ['manufacturer', 'Manufacturer', 'text'], ['manufacturerURL', 'Manufacturer URL', 'text'],
      ['license', 'License description', 'area'], ['licenseURL', 'License URL', 'text'], ['description', 'Description', 'area'],
      ['vendorID', 'Vendor ID (4 chars)', 'text']]],
    ['Style', [
      ['weightClass', 'Weight class', 'select', [[100, '100 Thin'], [200, '200 ExtraLight'], [300, '300 Light'], [400, '400 Regular'], [500, '500 Medium'], [600, '600 SemiBold'], [700, '700 Bold'], [800, '800 ExtraBold'], [900, '900 Black']]],
      ['widthClass', 'Width class', 'select', [[1, '1 Ultra-condensed'], [2, '2 Extra-condensed'], [3, '3 Condensed'], [4, '4 Semi-condensed'], [5, '5 Normal'], [6, '6 Semi-expanded'], [7, '7 Expanded'], [8, '8 Extra-expanded'], [9, '9 Ultra-expanded']]],
      ['italicAngle', 'Italic angle (° , negative leans right)', 'num']]],
    ['Vertical metrics', [
      ['unitsPerEm', 'Units per em', 'int'], ['ascender', 'Ascender', 'int'], ['capHeight', 'Cap height', 'int'], ['xHeight', 'x-height', 'int'], ['descender', 'Descender (negative)', 'int'], ['lineGap', 'Line gap', 'int'],
      ['winAscent', 'Win ascent (blank = auto)', 'opt'], ['winDescent', 'Win descent (blank = auto)', 'opt'], ['useTypoMetrics', 'Use typo metrics (fsSelection bit 7)', 'check'],
      ['underlinePosition', 'Underline position', 'int'], ['underlineThickness', 'Underline thickness', 'int']]],
    ['Embedding', [['fsType', 'Embedding permissions', 'select', [[0, 'Installable (no restrictions)'], [8, 'Editable'], [4, 'Preview & Print'], [2, 'Restricted license']]]]],
  ];
  function field([k, label, type, extra], v) {
    const id = 'fi_' + k;
    if (type === 'area') return `<label for="${id}">${label}</label><textarea id="${id}" data-k="${k}" rows="2">${Aero.esc(v ?? '')}</textarea>`;
    if (type === 'select') return `<label for="${id}">${label}</label><select id="${id}" data-k="${k}" data-t="int">${extra.map(([a, b]) => `<option value="${a}"${+v === a ? ' selected' : ''}>${b}</option>`).join('')}${extra.some(([a]) => a === +v) ? '' : `<option value="${v}" selected>${v}</option>`}</select>`;
    if (type === 'check') return `<label for="${id}">${label}</label><input type="checkbox" id="${id}" data-k="${k}" data-t="check"${v ? ' checked' : ''}>`;
    const t = type === 'text' ? 'text' : 'number';
    return `<label for="${id}">${label}</label><input type="${t}" id="${id}" data-k="${k}" data-t="${type}" value="${Aero.esc(v ?? '')}"${extra ? ` placeholder="${Aero.esc(extra)}"` : ''}${type === 'opt' ? ` placeholder="auto"` : ''}>`;
  }
  function build() {
    if (A.view !== 'info' || !A.font) return;
    const I = A.font.info;
    const box = $('infoForm'); const scroll = box.scrollTop;
    box.innerHTML = SECTIONS.map(([title, fs]) => `<section class="isec" id="sec_${title.replace(/\s/g, '')}"><h3>${title}</h3><div class="igrid">${fs.map(f => field(f, I[f[0]])).join('')}</div>${title === 'Vertical metrics' ? `<div class="ibtns"><button class="aero-btn small" id="fiMeasure">Measure x-height &amp; cap height from x / H</button><button class="aero-btn small" id="fiScale">Scale font to new UPM…</button></div>` : ''}</section>`).join('') +
      `<section class="isec"><h3>Resulting names</h3><div id="fiNames">${namesHTML()}</div></section>`;
    box.scrollTop = scroll;
    $('fiMeasure').onclick = measure; $('fiScale').onclick = scaleDialog;
  }
  function namesHTML() {
    const I = A.font.info, st = window.SFNT.styleInfo(I);
    return `<table class="inames"><tr><td>Family (ID 1)</td><td>${Aero.esc(st.fam1)}</td></tr><tr><td>Subfamily (ID 2)</td><td>${Aero.esc(st.sub2)}</td></tr>${st.ribbi ? '' : `<tr><td>Typographic family / style (ID 16/17)</td><td>${Aero.esc(st.fam)} / ${Aero.esc(st.style)}</td></tr>`}<tr><td>Full name (ID 4)</td><td>${Aero.esc(st.full)}</td></tr><tr><td>PostScript name (ID 6)</td><td>${Aero.esc(st.ps)}</td></tr><tr><td>Version (ID 5)</td><td>Version ${Math.round(I.versionMajor)}.${String(Math.round(I.versionMinor)).padStart(3, '0')}</td></tr><tr><td>Glyphs / kerning</td><td>${A.font.order.length} glyphs · ${TM.kernPairs(A.font).length} kerning entries · ${Object.keys(A.font.groups).length} groups</td></tr></table>`;
  }
  A.buildInfo = build;
  function commit(el) {
    const k = el.dataset.k, t = el.dataset.t; let v;
    if (t === 'check') v = el.checked;
    else if (t === 'int' || t === 'num' || t === 'opt') { if (el.value.trim() === '' && t === 'opt') v = null; else { v = +el.value; if (!isFinite(v)) { el.value = A.font.info[k] ?? ''; return; } if (t !== 'num') v = Math.round(v); } }
    else v = el.value;
    if (k === 'vendorID') v = String(v).replace(/[^\x20-\x7E]/g, '').slice(0, 4);
    if (k === 'unitsPerEm') v = Math.max(16, Math.min(16384, v));
    if (k === 'familyName' && !String(v).trim()) { el.value = A.font.info.familyName; return; }
    if (A.font.info[k] === v) return;
    A.change('Font Info: ' + k, d => { d.info()[k] = v; });
  }
  function measure() {
    const F = A.font, cmap = TM.cmapOf(F), top = cp => { const n = cmap.get(cp); const b = n && TM.glyphBounds(F, F.glyphs[n]); return b ? Math.round(b.yMax) : null; };
    const x = top(0x78), H = top(0x48);
    if (x == null && H == null) return A.toast('Draw “x” and “H” first');
    A.change('Measure Metrics', d => { const i = d.info(); if (x != null) i.xHeight = x; if (H != null) i.capHeight = H; });
    A.toast(`x-height ${x ?? '—'} · cap height ${H ?? '—'}`);
  }
  function scaleDialog() {
    Aero.dialog({ title: 'Scale Font', instruction: 'Scales every outline, component offset, advance width, kerning value and vertical metric.', fields: [{ key: 'upm', label: 'New units per em', type: 'number', value: A.font.info.unitsPerEm === 1000 ? 2048 : 1000, min: 16, max: 16384 }],
      onOK: v => {
        const nu = Math.round(v.upm); if (!(nu >= 16 && nu <= 16384)) return;
        const f = nu / A.font.info.unitsPerEm;
        A.change('Scale to ' + nu + ' UPM', d => {
          const i = d.info(); i.unitsPerEm = nu; ['ascender', 'descender', 'xHeight', 'capHeight', 'lineGap', 'underlinePosition', 'underlineThickness', 'winAscent', 'winDescent'].forEach(k => { if (i[k] != null) i[k] = Math.round(i[k] * f); });
          d.font.order.forEach(n => { const g = d.glyph(n); g.contours.forEach(c => c.points.forEach(p => { p.x = Math.round(p.x * f); p.y = Math.round(p.y * f); })); g.components.forEach(c => { c.m[4] = Math.round(c.m[4] * f); c.m[5] = Math.round(c.m[5] * f); }); g.advance = Math.round(g.advance * f); });
          const k = d.kerning(); Object.keys(k).forEach(l => { k[l] = Object.fromEntries(Object.entries(k[l]).map(([r, x]) => [r, Math.round(x * f)])); });
        });
      } });
  }
  A.initInfo = () => {
    const box = $('infoForm');
    box.addEventListener('change', e => { if (e.target.dataset.k) commit(e.target); });
    A.on('view', v => { if (v === 'info') { build(); $('leftTitle').textContent = 'Font Info'; $('leftCount').textContent = ''; $('leftList').innerHTML = [...SECTIONS.map(s => s[0]), 'Resulting names'].map((s, i) => `<div class="aero-item" data-sec="${i}"><span class="grow">${s}</span></div>`).join(''); $('leftBar').innerHTML = ''; } });
    $('leftList').addEventListener('click', e => { if (A.view !== 'info') return; const it = e.target.closest('[data-sec]'); if (!it) return; const s = box.querySelectorAll('.isec')[+it.dataset.sec]; if (s) box.scrollTop = s.offsetTop - 6; });
    A.on('change', () => { if (A.view !== 'info') return; if (!box.contains(document.activeElement)) build(); else if ($('fiNames')) $('fiNames').innerHTML = namesHTML(); });
  };
})();
