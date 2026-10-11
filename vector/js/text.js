'use strict';
/* Lumen Vector — type: point text, area text, text on a path, in-place editing, convert to outlines. */
(function () {
  const textFill = () => { const f = LV.paint.fill; return (!f || f === '#ffffff' || LV.isGrad(f)) ? '#1d2733' : f; };
  const fontCss = s => `${s.weight} ${s.size}px "${s.family}"`;

  LV.textNode = it => { const k = LV.kind(it); return k === 'text' ? it : k === 'areatext' ? it.children.find(c => c.data.role === 'text') : null; };
  LV.textStyleOf = it => {
    const k = LV.kind(it);
    if (k === 'pathtext') { const d = it.data; return { family: d.family, weight: +d.weight, size: d.size, leading: d.size * 1.2, tracking: d.tracking || 0, align: d.align || 'left' }; }
    const t = LV.textNode(it); if (!t) return null;
    return { family: String(t.fontFamily).replace(/["']/g, ''), weight: parseInt(t.fontWeight) || 400, size: t.fontSize, leading: t.leading, tracking: t.data.tracking || 0, align: t.justification };
  };
  LV.textContent = it => { const k = LV.kind(it); return k === 'text' ? it.content : it.data.text || ''; };
  const applyToNode = (t, s) => {
    t.fontFamily = s.family; t.fontWeight = String(s.weight); t.fontSize = s.size; t.leading = s.leading; t.justification = s.align; t.data.tracking = s.tracking;
  };
  // Set text style (partial) on any text-like object
  LV.setTextStyle = (it, part) => {
    const k = LV.kind(it), cur = LV.textStyleOf(it); if (!cur) return;
    const s = { ...cur, ...part };
    if (part.size && !part.leading && cur.size) s.leading = cur.leading * part.size / cur.size;
    if (part.family && !part.weight) s.weight = LV.nearestWeight(part.family, cur.weight);
    if (k === 'text') {
      // keep the anchor (left/center/right) of point text stable when alignment changes
      if (part.align && part.align !== cur.align) {
        const w = it.internalBounds.width, off = a => a === 'left' ? 0 : a === 'center' ? w / 2 : w;
        const dx = off(s.align) - off(cur.align), m = it.matrix;
        applyToNode(it, s); it.translate(new P.Point(m.a * dx, m.b * dx));
      } else applyToNode(it, s);
    } else if (k === 'areatext') { applyToNode(LV.textNode(it), s); LV.reflow(it); }
    else if (k === 'pathtext') { Object.assign(it.data, { family: s.family, weight: s.weight, size: s.size, tracking: s.tracking, align: s.align }); LV.layoutPathText(it); }
  };

  LV.newPointText = (pt, content = '', style = LV.text) => {
    const t = new P.PointText({ point: pt, content, insert: false });
    applyToNode(t, { ...style, leading: style.size * (style.leading || 1.2) });
    t.fillColor = textFill();
    return t;
  };

  /* ---------- area text ---------- */
  LV.newAreaText = (rect, text = '', style = LV.text) => {
    const frame = new P.Path({ segments: [rect.topLeft, rect.topRight, rect.bottomRight, rect.bottomLeft], closed: true, insert: false, data: { role: 'frame' } });
    const t = new P.PointText({ content: '', insert: false, data: { role: 'text' } });
    applyToNode(t, { ...style, leading: style.size * (style.leading || 1.2) }); t.fillColor = textFill();
    const g = new P.Group({ children: [frame, t], insert: false, data: { kind: 'areatext', text } });
    LV.reflow(g); return g;
  };
  LV.wrapText = (text, width, font, tr) => {
    const out = [];
    String(text).split('\n').forEach(par => {
      const words = par.split(/(\s+)/); let line = '';
      for (const w of words) {
        if (!w) continue;
        const test = line + w;
        if (!line || LV.measure(font, tr, test.trimEnd()) <= width) { line = test; continue; }
        out.push(line.trimEnd()); line = /^\s+$/.test(w) ? '' : w;
        while (LV.measure(font, tr, line) > width && line.length > 1) { // break very long words
          let n = line.length - 1; while (n > 1 && LV.measure(font, tr, line.slice(0, n)) > width) n--;
          out.push(line.slice(0, n)); line = line.slice(n);
        }
      }
      out.push(line.trimEnd());
    });
    return out;
  };
  LV.areaGeom = g => {
    const s = g.children.find(c => c.data.role === 'frame').segments, o = s[0].point, xv = s[1].point.subtract(o), yv = s[3].point.subtract(o);
    return { o, W: xv.length, H: yv.length, ang: xv.angle };
  };
  const firstBaseline = (t) => { const m = LV.fontMetrics(t._style.getFontStyle()); return (t.leading - (m.a + m.d)) / 2 + m.a; };
  LV.reflow = g => {
    const t = g.children.find(c => c.data.role === 'text'); if (!t) return;
    const { o, W, H, ang } = LV.areaGeom(g), tr = (t.data.tracking || 0) / 1000 * t.fontSize;
    const lines = LV.wrapText(g.data.text || '', W, t._style.getFontStyle(), tr);
    const fb = firstBaseline(t), max = Math.max(1, Math.floor((H - fb) / t.leading) + 1);
    g.data.overflow = lines.length > max;
    t.content = (LV.textEditing && LV.textEditing.item === g ? lines : lines.slice(0, max)).join('\n');
    const x = t.justification === 'center' ? W / 2 : t.justification === 'right' ? W : 0;
    t.matrix = new P.Matrix().translate(o).rotate(ang).translate(x, fb);
  };

  /* ---------- text on a path ---------- */
  LV.makePathText = (path, text, style = LV.text) => {
    const guide = path; guide.data.role = 'guide';
    const keepStroke = false; if (!keepStroke) { guide.fillColor = null; guide.strokeColor = null; }
    const g = new P.Group({ insert: false, data: { kind: 'pathtext', text, family: style.family, weight: style.weight, size: style.size, tracking: style.tracking || 0, align: style.align === 'center' ? 'center' : 'left', start: 0, fill: textFill() } });
    guide.parent ? g.insertAbove(guide) : 0; g.addChild(guide);
    LV.layoutPathText(g); return g;
  };
  LV.glyphPathData = (font, text, size, tracking, x0, y0) => {
    const scale = size / font.unitsPerEm, gl = font.stringToGlyphs(text); let x = x0, d = '';
    for (let i = 0; i < gl.length; i++) {
      d += gl[i].getPath(x, y0, size).toPathData(3);
      x += gl[i].advanceWidth * scale + tracking + (gl[i + 1] ? font.getKerningValue(gl[i], gl[i + 1]) * scale : 0);
    }
    return { d, width: x - x0 - (gl.length ? tracking : 0) };
  };
  LV.layoutPathText = g => {
    const d = g.data, guide = g.children.find(c => c.data.role === 'guide'); if (!guide) return;
    g.children.filter(c => c.data.role === 'glyphs').forEach(c => c.remove());
    const font = LV.otGet(d.family, d.weight); if (!font) return;
    const size = d.size, scale = size / font.unitsPerEm, tr = (d.tracking || 0) / 1000 * size, L = guide.length;
    const gl = font.stringToGlyphs(d.text || '');
    const advs = gl.map((x, i) => x.advanceWidth * scale + tr + (gl[i + 1] ? font.getKerningValue(x, gl[i + 1]) * scale : 0));
    const total = advs.reduce((a, b) => a + b, 0);
    let s = (d.start || 0) * L; if (d.align === 'center') s = Math.max(0, (L - total) / 2);
    const children = []; d.overflow = false;
    for (let i = 0; i < gl.length; i++) {
      const mid = s + advs[i] / 2;
      if (mid > L) { d.overflow = true; break; }
      const pd = gl[i].getPath(-gl[i].advanceWidth * scale / 2, 0, size).toPathData(3);
      if (pd) {
        const pt = guide.getPointAt(Math.min(mid, L)), tan = guide.getTangentAt(Math.min(mid, L));
        const cp = new P.CompoundPath({ pathData: pd, insert: false });
        cp.rotate(tan.angle, new P.Point(0, 0)); cp.translate(pt);
        children.push(...cp.removeChildren());
      }
      s += advs[i];
    }
    const glyphs = new P.CompoundPath({ children, insert: false, data: { role: 'glyphs' }, fillRule: 'nonzero' });
    glyphs.fillColor = LV.specToColor(d.fill || '#000000', glyphs.bounds);
    if (d.stroke) { glyphs.strokeColor = LV.specToColor(d.stroke, glyphs.bounds); glyphs.strokeWidth = d.strokeWidth || 1; }
    g.addChild(glyphs);
  };

  /* ---------- convert to outlines ---------- */
  LV.outlinePointText = t => {
    const s = LV.textStyleOf(t), font = LV.otGet(s.family, s.weight), tr = s.tracking / 1000 * s.size;
    let d = '';
    (t.content || '').split(/\r?\n/).forEach((line, i) => {
      const w = LV.glyphPathData(font, line, s.size, tr, 0, 0).width;
      const x0 = s.align === 'center' ? -w / 2 : s.align === 'right' ? -w : 0;
      d += LV.glyphPathData(font, line, s.size, tr, x0, i * s.leading).d;
    });
    const cp = new P.CompoundPath({ pathData: d, insert: false, fillRule: 'nonzero' });
    cp.transform(t.matrix);
    cp.fillColor = t.fillColor; cp.strokeColor = t.strokeColor; cp.strokeWidth = t.strokeWidth;
    return cp;
  };
  // Replace a text-like object with editable outlines (returns the new item)
  LV.outlineText = it => {
    const k = LV.kind(it); let out;
    if (k === 'text') out = LV.outlinePointText(it);
    else if (k === 'areatext') { const t = LV.textNode(it); out = LV.outlinePointText(t); out.transform(it.matrix); }
    else if (k === 'pathtext') { const g = it.children.find(c => c.data.role === 'glyphs'); out = g.clone({ insert: false }); out.data = {}; }
    else return it;
    out.opacity = it.opacity; out.blendMode = it.blendMode; out.name = (LV.textContent(it) || 'Text').slice(0, 24);
    LV.reUid(out); out.insertAbove(it); it.remove(); return out;
  };
  // Outline every text object inside a container (used by PDF export & SVG "outline text")
  LV.outlineAll = root => {
    const found = [];
    const walk = it => { if (LV.isTextLike(it)) found.push(it); else (it.children || []).slice().forEach(walk); };
    walk(root); found.forEach(LV.outlineText);
  };

  /* ---------- in-place editing ---------- */
  LV.textEditing = null;
  const ta = () => document.getElementById('textEdit');
  LV.beginTextEdit = (item, { select = false } = {}) => {
    if (LV.textEditing) LV.endTextEdit();
    const k = LV.kind(item);
    if (k === 'pathtext') return editPathText(item);
    const t = LV.textNode(item);
    LV.textEditing = { item, t, k, before: k === 'text' ? item.content : item.data.text };
    item.visible = false;
    const el = ta(); el.hidden = false;
    el.value = k === 'text' ? item.content : item.data.text || '';
    layoutEditor();
    el.focus(); if (select) el.select(); else el.setSelectionRange(el.value.length, el.value.length);
    LV.setSel([item]); LV.redraw();
  };
  const layoutEditor = () => {
    const e = LV.textEditing; if (!e) return;
    const { item, t, k } = e, el = ta(), s = LV.textStyleOf(item);
    const fb = firstBaseline(t);
    el.style.font = fontCss(s); el.style.lineHeight = s.leading + 'px'; el.style.letterSpacing = (s.tracking / 1000 * s.size) + 'px';
    el.style.textAlign = s.align; const c = t.fillColor; el.style.color = c && c.type !== 'gradient' ? c.toCSS(true) : '#1d2733';
    let m, w, h;
    if (k === 'areatext') {
      const g = LV.areaGeom(item); w = g.W; h = Math.max(g.H, (el.value.split('\n').length) * s.leading);
      m = P.view.matrix.clone().append(new P.Matrix().translate(g.o).rotate(g.ang)); el.style.whiteSpace = 'pre-wrap';
      el.style.height = 'auto'; el.style.width = w + 'px'; h = Math.max(g.H, el.scrollHeight);
    } else {
      const lines = el.value.split('\n'), font = t._style.getFontStyle(), tr = s.tracking / 1000 * s.size;
      w = Math.max(...lines.map(l => LV.measure(font, tr, l))) + s.size * 0.6; h = lines.length * s.leading;
      const off = s.align === 'center' ? -w / 2 : s.align === 'right' ? -w + s.size * 0.6 : 0;
      m = P.view.matrix.clone().append(t.globalMatrix).append(new P.Matrix().translate(off, -fb)); el.style.whiteSpace = 'pre';
    }
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.tx},${m.ty})`;
  };
  LV.layoutTextEditor = layoutEditor;
  const onInput = () => {
    const e = LV.textEditing; if (!e) return;
    if (e.k === 'text') e.item.content = ta().value; else { e.item.data.text = ta().value; LV.reflow(e.item); }
    layoutEditor(); LV.redraw();
  };
  LV.endTextEdit = (cancel) => {
    const e = LV.textEditing; if (!e) return;
    LV.textEditing = null; const el = ta(); el.hidden = true; el.blur();
    const { item, k } = e;
    if (cancel) { if (k === 'text') item.content = e.before; else { item.data.text = e.before; } }
    item.visible = true; if (k === 'areatext') LV.reflow(item);
    const val = k === 'text' ? item.content : item.data.text;
    if (!val || !val.trim()) {
      if (k === 'text') { item.remove(); LV.setSel([]); if (e.before) LV.commit('Delete Text'); LV.redraw(); return; }
    }
    if (e.isNew || val !== e.before) LV.commit(e.isNew ? 'Type' : 'Edit Text');
    LV.redraw(); LV.emit('selection');
  };
  function editPathText(g) {
    const before = g.data.text;
    const apply = v => { g.data.text = v.t; g.data.start = v.s / 100; g.data.align = v.c ? 'center' : 'left'; LV.layoutPathText(g); LV.redraw(); };
    Aero.dialog({
      title: 'Edit Text on Path', fields: [{ key: 't', label: 'Text', type: 'text', value: before }, { key: 's', label: 'Start offset %', type: 'range', min: 0, max: 100, value: Math.round((g.data.start || 0) * 100), fmt: v => v + '%' }, { key: 'c', label: 'Center on path', type: 'checkbox', value: g.data.align === 'center' }],
      onChange: v => apply(v),
      onOK: v => { apply(v); LV.commit('Edit Text on Path'); },
      onCancel: () => { g.data.text = before; LV.layoutPathText(g); LV.redraw(); }
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    const el = ta();
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' || (ev.key === 'Enter' && ev.ctrlKey)) { ev.preventDefault(); ev.stopPropagation(); LV.endTextEdit(); }
      ev.stopPropagation();
    });
    el.addEventListener('pointerdown', ev => ev.stopPropagation());
  });
  LV.on('view', layoutEditor);
})();
