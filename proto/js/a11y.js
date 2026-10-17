'use strict';
/* Lumen Proto — accessibility: WCAG 2.x text contrast checking.
   The math (luminance, ratio, grading, percentile) is pure and also runs under Node for tests;
   the checker renders what lies beneath a text layer (paint order, the layer itself excluded) and
   measures contrast of the text colour against every background pixel behind it. */
(function (root) {
  const LP = root.LP = root.LP || {};
  const A11Y = LP.A11Y = {};

  // sRGB channel (0..255) → linear
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  A11Y.luminance = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  A11Y.ratio = (l1, l2) => { const a = Math.max(l1, l2), b = Math.min(l1, l2); return (a + 0.05) / (b + 0.05); };
  A11Y.ratioRGB = (p, q) => A11Y.ratio(A11Y.luminance(p[0], p[1], p[2]), A11Y.luminance(q[0], q[1], q[2]));
  // WCAG "large text": at least 18pt (24px), or 14pt (18.66px) bold
  A11Y.isLarge = (sizePx, weight) => sizePx >= 24 || (sizePx >= 18.66 && weight >= 700);
  A11Y.grade = (ratio, large) => {
    const aa = large ? 3 : 4.5, aaa = large ? 4.5 : 7;
    return { aa: ratio >= aa - 1e-9, aaa: ratio >= aaa - 1e-9, need: aa, needAAA: aaa, level: ratio >= aaa - 1e-9 ? 'AAA' : ratio >= aa - 1e-9 ? 'AA' : 'Fail' };
  };
  // composite a colour with alpha a (0..1) over an opaque background
  A11Y.over = (fg, a, bg) => [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a));
  // value at fraction q of a sorted copy
  A11Y.percentile = (arr, q) => { if (!arr.length) return NaN; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
  // contrast of text colour (rgb, alpha) against background pixels (RGBA bytes, alpha ignored → treated opaque)
  A11Y.measure = (fg, alpha, px, stride = 1) => {
    const ratios = []; let sr = 0, sg = 0, sb = 0, cnt = 0;
    for (let i = 0; i < px.length; i += 4 * stride) {
      const bg = [px[i], px[i + 1], px[i + 2]];
      ratios.push(A11Y.ratioRGB(A11Y.over(fg, alpha, bg), bg));
      sr += bg[0]; sg += bg[1]; sb += bg[2]; cnt++;
    }
    if (!cnt) return null;
    return { low: A11Y.percentile(ratios, 0.1), median: A11Y.percentile(ratios, 0.5), min: Math.min(...ratios), bg: [sr / cnt, sg / cnt, sb / cnt].map(Math.round) };
  };
  A11Y.fmt = r => (Math.floor(r * 100) / 100).toFixed(2) + ':1';

  if (!root.document) return; // Node: math only

  /* ---------------- in-app checker ---------------- */
  const toRGB = c => { const p = LP.parseColor(c); return [p[0], p[1], p[2], p[3]]; };
  // text colours used by a text layer: [{rgb, a}] (run colours + the layer fill), null when not a solid colour
  function textColors(n, v, doc) {
    const fill = (v.fills || []).filter(f => f.on !== false && f.type === 'solid').slice(-1)[0];
    if (!fill) return null;
    const fc = LP.fillColor(fill, doc), base = toRGB(fc.color);
    const out = [];
    const add = (rgb, a) => { if (!out.some(o => o.rgb.join() === rgb.slice(0, 3).join() && Math.abs(o.a - a) < 1e-3)) out.push({ rgb: rgb.slice(0, 3), a }); };
    const len = String(LP.shownText(v, ED.scene.vars) ?? '').length;
    if (LP.isRich(v)) LP.normRuns(v.runs, len).forEach(r => { const s = LP.runStyle(LP.textProps(v, doc), r.st, doc); if (s.color) add(toRGB(s.color), s.a ?? 1); else add(base, (fc.a ?? 1) * base[3]); });
    else add(base, (fc.a ?? 1) * base[3]);
    return out;
  }
  // smallest effective font size / its weight across runs
  function textSize(v, doc) {
    const t = LP.textProps(v, doc); let size = t.size, weight = t.weight;
    if (LP.isRich(v)) LP.normRuns(v.runs, String(v.text || '').length).forEach(r => { const s = LP.runStyle(t, r.st, doc); if (s.size < size || (s.size === size && s.weight < weight)) { size = s.size; weight = s.weight; } });
    return { size, weight };
  }
  // opacity of the node times its ancestors (inside its top-level frame)
  function chainOpacity(n) { let o = 1, p = n; while (p && p !== ED.doc) { o *= ED.scene.view(p).opacity ?? 1; p = ED.parent(p); } return o; }

  // check one text node; returns {ratio, median, min, large, grade, fg, bg, size, weight} or {error}
  A11Y.checkNode = n => {
    const doc = ED.doc, v = ED.scene.view(n);
    if ((v.mainType || n.type) !== 'text') return { error: 'Not a text layer' };
    const top = ED.scene.top(n) || n;
    const prevMode = doc._mode; doc._mode = LP.nodeMode(doc, top);
    try {
      const cols = textColors(n, v, doc);
      if (!cols) return { error: 'Text has no solid fill' };
      const b = ED.wbox(n);
      const sc = Math.min(1, 1200 / Math.max(b.w, b.h, 1));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(b.w * sc)); c.height = Math.max(1, Math.round(b.h * sc));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = top === n ? (doc.bg || '#e8ecf1') : '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); // artboards sit on white
      ctx.scale(sc, sc); ctx.translate(-b.x, -b.y);
      if (top !== n) LP.drawNode(ctx, ED.scene, top, { base: c, stopAt: { node: n } });
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      const stride = Math.max(1, Math.floor(c.width * c.height / 40000));
      const op = chainOpacity(n);
      let worst = null;
      cols.forEach(col => { const m = A11Y.measure(col.rgb, Math.max(0, Math.min(1, col.a * op)), px, stride); if (m && (!worst || m.low < worst.low)) worst = Object.assign(m, { fg: col.rgb, a: col.a * op }); });
      if (!worst) return { error: 'Nothing to measure' };
      const { size, weight } = textSize(v, doc), large = A11Y.isLarge(size, weight);
      return { ratio: worst.low, median: worst.median, min: worst.min, varies: worst.median - worst.low > 0.5, large, size, weight, grade: A11Y.grade(worst.low, large), fg: worst.fg, a: worst.a, bg: worst.bg };
    } finally { doc._mode = prevMode ?? LP.defaultMode(doc); }
  };
  // every visible text layer in the document (including text inside instances)
  A11Y.textLayers = () => {
    const out = [];
    const walk = (n, vis) => { ED.kids(n).forEach(k => { const ok = vis && ED.scene.isVis(k) && (ED.scene.view(k).opacity ?? 1) > 0.001; if ((ED.scene.view(k).mainType || k.type) === 'text') { if (ok && String(LP.shownText(ED.scene.view(k), ED.scene.vars) || '').trim()) out.push(k); } else walk(k, ok); }); };
    ED.doc.children.forEach(top => { if (!ED.scene.isVis(top)) return; if (top.type === 'text') out.push(top); else walk(top, true); });
    return out;
  };
  A11Y.checkAll = () => A11Y.textLayers().map(n => Object.assign({ n }, A11Y.checkNode(n))).filter(r => !r.error);

  const hex = rgb => '#' + rgb.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
  A11Y.hex = hex;
  // document-wide report dialog
  A11Y.dialog = () => {
    Aero.busy('Checking text contrast…');
    setTimeout(() => {
      let res;
      try { res = A11Y.checkAll(); } finally { Aero.busy(); }
      const fails = res.filter(r => !r.grade.aa).sort((a, b) => a.ratio - b.ratio);
      const aaOnly = res.filter(r => r.grade.aa && !r.grade.aaa).length;
      const esc = Aero.esc;
      const rows = fails.slice(0, 200).map((r, i) => `<div class="a11y-row" data-i="${i}" title="Click to select and zoom to this layer">
        <span class="a11y-chip" style="background:${hex(r.bg)};color:${hex(r.fg)}">Aa</span>
        <span class="a11y-name">${esc(r.n.name)}<small>${esc((ED.scene.top(r.n) || r.n).name)} · ${Math.round(r.size)}px${r.large ? ' (large)' : ''}</small></span>
        <span class="a11y-ratio">${A11Y.fmt(r.ratio)}<small>needs ${r.grade.need}:1</small></span></div>`).join('');
      const html = `<div class="a11y-sum"><b>${res.length}</b> text layers checked · <b class="${fails.length ? 'bad' : 'good'}">${fails.length}</b> fail WCAG AA · ${aaOnly} pass AA but not AAA</div>` +
        (fails.length ? `<div class="a11y-list">${rows}</div>` : '<div class="a11y-ok">✓ Every visible text layer meets WCAG 2.1 AA contrast.</div>') +
        '<p class="dnote">Contrast is measured against the rendered background behind each layer (the darkest/lightest 10% excluded). Normal text needs 4.5:1, large text (24px+, or 18.66px+ bold) needs 3:1.</p>';
      Aero.dialog({ title: 'Text contrast (WCAG)', noCancel: true, ok: 'Close', html, width: 520 });
      document.querySelectorAll('.a11y-row').forEach(el => el.onclick = () => {
        const r = fails[+el.dataset.i]; document.querySelector('.aero-modal .aero-btns [data-a="o"]')?.click();
        if (ED.mode === 'proto') APP.setMode('design');
        ED.select([r.n.id]); ED.zoomToBox(ED.wbox(r.n), 3);
      });
    }, 30);
  };
})(typeof window !== 'undefined' ? window : globalThis);
