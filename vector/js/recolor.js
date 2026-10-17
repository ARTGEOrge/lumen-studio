'use strict';
/* Lumen Vector — Edit ▸ Edit Colors: Recolor Artwork (replace each colour of the selection — or the whole document —
   with live preview, plus global hue / saturation / brightness), Invert Colors, Convert to Grayscale.
   Covers fills, strokes, every gradient stop, extra appearance fills/strokes, effect colours, type on a path and the
   sources of blends / repeats / warps (their generated parts are rebuilt on commit). Symbol masters and live tracings
   are left alone (they are regenerated from their own data). */
(function () {
  const RC = LV.recolor = {};
  const SKIP_ROLES = ['blendSteps', 'repeatCopies', 'warpOut', 'guide'];
  const hex6 = c => { const x = new P.Color(c.red, c.green, c.blue); return x.toCSS(true); };
  // gather every colour holder under the given items
  RC.collect = (items) => {
    const recs = [], seen = new Set(); let skipped = 0;
    const style = it => {
      ['fillColor', 'strokeColor'].forEach(attr => { const c = it[attr]; if (c) recs.push({ it, attr, orig: c.clone() }); });
    };
    const fx = it => { const f = it.data && it.data.fx; if (f) recs.push({ it, fx: JSON.parse(JSON.stringify(f)) }); };
    const walk = it => {
      if (!it || seen.has(it)) return; seen.add(it);
      const d = it.data || {}; if (SKIP_ROLES.includes(d.role)) return;
      const k = LV.kind(it);
      if (k === 'symbol' || k === 'trace') { skipped++; return; }
      fx(it);
      if (k === 'pathtext') { const g = it.children.find(c => c.data.role === 'glyphs'); if (g) { style(g); recs.push({ pathtext: it, glyphs: g }); } return; }
      if (it instanceof P.Raster) return;
      if (it instanceof P.Path || it instanceof P.CompoundPath || it instanceof P.PointText) { style(it); if (it instanceof P.CompoundPath) return; }
      (it.children || []).forEach(walk);
    };
    items.forEach(walk);
    return { recs, skipped };
  };
  // list of distinct colours (most used first)
  RC.palette = recs => {
    const m = new Map();
    const add = c => { if (!c) return; const h = hex6(c); m.set(h, (m.get(h) || 0) + 1); };
    const addSpec = s => { if (!s) return; if (LV.isGrad(s)) s.stops.forEach(st => add(new P.Color(st[0]))); else add(new P.Color(s)); };
    recs.forEach(r => {
      if (r.attr) { if (r.orig.type === 'gradient') r.orig.gradient.stops.forEach(s => add(s.color)); else add(r.orig); }
      else if (r.fx) { (r.fx.extra || []).forEach(e => addSpec(e.paint)); LV.fx.KEYS.forEach(k => r.fx[k] && r.fx[k].color && addSpec(r.fx[k].color)); }
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const clamp01 = v => Math.min(1, Math.max(0, v));
  // settings: { over: Map(hex -> hex), hue (deg), sat (-100..100), bri (-100..100), mode: 'none'|'invert'|'gray' }
  RC.mapper = S => {
    const solid = c => {
      const o = S.over && S.over.get(hex6(c));
      let r = o ? new P.Color(o) : new P.Color(c.red, c.green, c.blue);
      if (S.mode === 'invert') r = new P.Color(1 - r.red, 1 - r.green, 1 - r.blue);
      else if (S.mode === 'gray') { const l = 0.299 * r.red + 0.587 * r.green + 0.114 * r.blue; r = new P.Color(l, l, l); }
      if (S.hue || S.sat || S.bri) {
        const h = new P.Color(r.red, r.green, r.blue).convert('hsb');
        if (S.hue) h.hue = ((h.hue + S.hue) % 360 + 360) % 360;
        if (S.sat) h.saturation = clamp01(S.sat > 0 ? h.saturation + (1 - h.saturation) * S.sat / 100 * (h.saturation > 0 ? 1 : 0) : h.saturation * (1 + S.sat / 100));
        if (S.bri) h.brightness = clamp01(S.bri > 0 ? h.brightness + (1 - h.brightness) * S.bri / 100 : h.brightness * (1 + S.bri / 100));
        r = h.convert('rgb');
      }
      r.alpha = c.alpha; return r;
    };
    const color = c => {
      if (!c) return c;
      if (c.type !== 'gradient') return solid(c);
      return new P.Color({ gradient: { stops: c.gradient.stops.map(s => new P.GradientStop(solid(s.color), s.offset)), radial: c.gradient.radial }, origin: c.origin, destination: c.destination, highlight: c.highlight });
    };
    const css = s => LV.css(solid(new P.Color(s)));
    const spec = s => !s ? s : LV.isGrad(s) ? { ...s, stops: s.stops.map(([c, o]) => [css(c), o]) } : css(s);
    return { color, spec };
  };
  RC.apply = (recs, S) => {
    const M = RC.mapper(S);
    recs.forEach(r => {
      if (r.attr) r.it[r.attr] = M.color(r.orig);
      else if (r.fx) { const f = JSON.parse(JSON.stringify(r.fx)); (f.extra || []).forEach(e => { e.paint = M.spec(e.paint); }); LV.fx.KEYS.forEach(k => { if (f[k] && f[k].color) f[k].color = M.spec(f[k].color); }); LV.fx.set(r.it, f); }
    });
    recs.forEach(r => { if (r.pathtext) r.pathtext.data.fill = LV.colorToSpec(r.glyphs.fillColor); });
    LV.redraw();
  };
  const scope = () => {
    const items = LV.sel.length ? LV.sel.slice() : LV.allObjects();
    return { items, label: LV.sel.length ? `${LV.sel.length} selected object${LV.sel.length > 1 ? 's' : ''}` : 'the whole document' };
  };
  RC.quick = (mode) => {
    const { items } = scope(), { recs } = RC.collect(items); if (!recs.length) return LV.toast('No colors to change');
    RC.apply(recs, { mode }); LV.commit(mode === 'invert' ? 'Invert Colors' : 'Convert to Grayscale');
  };
  RC.MAX = 24;
  RC.dialog = () => {
    const { items, label } = scope(), { recs, skipped } = RC.collect(items);
    if (!recs.length) return LV.toast('No colors to recolor in ' + label);
    const pal = RC.palette(recs), shown = pal.slice(0, RC.MAX);
    const fields = [
      ...shown.map(([h, cnt], i) => ({ key: 'c' + i, label: `${h}  (${cnt}×)`, type: 'color', value: h, swatch: h })),
      { key: 'hue', label: 'Hue shift (°)', type: 'range', min: -180, max: 180, value: 0 },
      { key: 'sat', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0 },
      { key: 'bri', label: 'Brightness', type: 'range', min: -100, max: 100, value: 0 },
      { key: 'mode', label: 'Then', type: 'select', value: 'none', options: [['none', 'Keep colors'], ['invert', 'Invert'], ['gray', 'Grayscale']] }
    ];
    const settings = v => { const over = new Map(); shown.forEach(([h], i) => { const n = String(v['c' + i] || h).toLowerCase(); if (n !== h) over.set(h, n); }); return { over, hue: +v.hue || 0, sat: +v.sat || 0, bri: +v.bri || 0, mode: v.mode }; };
    const regen = () => { LV.blend.regenAll(); LV.regenLive(); };
    const restore = () => {
      recs.forEach(r => { if (r.attr) r.it[r.attr] = r.orig.clone(); else if (r.fx) LV.fx.set(r.it, JSON.parse(JSON.stringify(r.fx))); });
      recs.forEach(r => { if (r.pathtext) r.pathtext.data.fill = LV.colorToSpec(r.glyphs.fillColor); });
      regen(); LV.redraw();
    };
    const note = `${pal.length} color${pal.length > 1 ? 's' : ''} in ${label}${pal.length > RC.MAX ? ` — the ${RC.MAX} most used are listed; hue/saturation/brightness change all of them` : ''}.${skipped ? ` ${skipped} symbol instance/tracing${skipped > 1 ? 's' : ''} left unchanged.` : ''} Pick a new color for any swatch; the canvas previews live.`;
    Aero.dialog({
      title: 'Recolor Artwork', instruction: note, width: 470, fields,
      onChange: v => { RC.apply(recs, settings(v)); regen(); },
      onOK: v => { RC.apply(recs, settings(v)); LV.commit('Recolor Artwork'); },
      onCancel: restore
    });
  };
})();
