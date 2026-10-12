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
    } else if (k === 'areatext') { const h = it.data.next || it.data.prev ? LV.threadHead(it) : it; applyToNode(LV.textNode(h), s); LV.reflow(h); }
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
  // wrap into lines; every line remembers where it starts in `text` (needed to flow the rest into a threaded frame)
  LV.wrapLines = (text, width, font, tr) => {
    const out = []; text = String(text); let pos = 0;
    text.split('\n').forEach(par => {
      const words = par.split(/(\s+)/); let line = '', ls = pos, tok = pos;
      for (const w of words) {
        if (!w) continue;
        const ws = tok; tok += w.length;
        const test = line + w;
        if (!line || LV.measure(font, tr, test.trimEnd()) <= width) { line = test; continue; }
        out.push({ str: line.trimEnd(), start: ls });
        if (/^\s+$/.test(w)) { line = ''; ls = tok; } else { line = w; ls = ws; }
        while (LV.measure(font, tr, line) > width && line.length > 1) { // break very long words
          let n = line.length - 1; while (n > 1 && LV.measure(font, tr, line.slice(0, n)) > width) n--;
          out.push({ str: line.slice(0, n), start: ls }); line = line.slice(n); ls += n;
        }
      }
      out.push({ str: line.trimEnd(), start: ls });
      pos += par.length + 1;
    });
    return out;
  };
  LV.wrapText = (text, width, font, tr) => LV.wrapLines(text, width, font, tr).map(l => l.str);
  LV.areaGeom = g => {
    const s = g.children.find(c => c.data.role === 'frame').segments, o = s[0].point, xv = s[1].point.subtract(o), yv = s[3].point.subtract(o);
    return { o, W: xv.length, H: yv.length, ang: xv.angle };
  };
  const firstBaseline = (t) => { const m = LV.fontMetrics(t._style.getFontStyle()); return (t.leading - (m.a + m.d)) / 2 + m.a; };
  // lay out `text` in one frame; returns the text that does not fit
  const reflowOne = (g, text) => {
    const t = g.children.find(c => c.data.role === 'text'); if (!t) return '';
    const { o, W, H, ang } = LV.areaGeom(g), tr = (t.data.tracking || 0) / 1000 * t.fontSize;
    const lines = LV.wrapLines(text, W, t._style.getFontStyle(), tr);
    const fb = firstBaseline(t), max = Math.max(1, Math.floor((H - fb) / t.leading) + 1);
    g.data.overflow = lines.length > max;
    t.content = (LV.textEditing && LV.textEditing.item === g ? lines : lines.slice(0, max)).map(l => l.str).join('\n');
    const x = t.justification === 'center' ? W / 2 : t.justification === 'right' ? W : 0;
    t.matrix = new P.Matrix().translate(o).rotate(ang).translate(x, fb);
    return lines.length > max ? text.slice(lines[max].start) : '';
  };
  /* ---------- threaded area text: data.next / data.prev hold the uids of the linked frames;
     the head frame's data.text is the whole story, the others show what overflows from the previous frame ---------- */
  const isArea = it => it && LV.kind(it) === 'areatext' && it.parent;
  const byUid = uid => uid ? P.project.getItem({ match: it => it.data && it.data.uid === uid && it.data.kind === 'areatext' }) : null;
  LV.threadNext = g => { const n = byUid(g.data.next); if (n && n !== g && n.data.prev === g.data.uid) return n; if (g.data.next) delete g.data.next; return null; };
  LV.threadPrev = g => { const p = byUid(g.data.prev); if (p && p !== g && p.data.next === g.data.uid) return p; if (g.data.prev) delete g.data.prev; return null; };
  LV.threadHead = g => { const seen = new Set([g]); let h = g, p; while ((p = LV.threadPrev(h)) && !seen.has(p)) { seen.add(p); h = p; } return h; };
  LV.threadChain = g => { const h = LV.threadHead(g), out = [h], seen = new Set(out); let n = h; while ((n = LV.threadNext(n)) && !seen.has(n)) { seen.add(n); out.push(n); } return out; };
  LV.isThreaded = g => isArea(g) && !!(LV.threadNext(g) || LV.threadPrev(g));
  LV.reflow = g => {
    if (!g.data.next && !g.data.prev) { reflowOne(g, g.data.text || ''); return; }
    const chain = LV.threadChain(g), head = chain[0], ht = LV.textNode(head);
    let text = head.data.text || '';
    chain.forEach((f, i) => {
      if (i) { const t = LV.textNode(f); if (t && ht) { t.fontFamily = ht.fontFamily; t.fontWeight = ht.fontWeight; t.fontSize = ht.fontSize; t.leading = ht.leading; t.justification = ht.justification; t.data.tracking = ht.data.tracking; t.fillColor = ht.fillColor; t.strokeColor = ht.strokeColor; t.strokeWidth = ht.strokeWidth; } }
      const rest = reflowOne(f, text);
      if (i) f.data.text = text.slice(0, text.length - rest.length);
      if (i < chain.length - 1) f.data.overflow = false;
      text = rest;
    });
  };
  LV.threadLink = (a, b) => { // append frame b after frame a (b may be a closed path: it becomes a text frame)
    if (!isArea(a) || a === b) return null;
    if (!isArea(b)) {
      if (!LV.isPathItem(b)) return null;
      const r = b.bounds, f = LV.newAreaText(r, '', LV.textStyleOf(a)); f.name = 'Area Type'; f.insertAbove(b); b.remove(); LV.uidOf(f); b = f;
    } else LV.threadUnlink([b], { keep: true });
    const after = LV.threadNext(a), extra = !b.data.prev && (b.data.text || '').trim() ? b.data.text : '';
    b.data.prev = LV.uidOf(a); a.data.next = LV.uidOf(b);
    if (after) { b.data.next = after.data.uid; after.data.prev = b.data.uid; }
    if (extra) { const h = LV.threadHead(a); h.data.text = (h.data.text || '') + '\n' + extra; }
    LV.reflow(a); return b;
  };
  // take frames out of their threads; the story keeps flowing through the remaining frames
  LV.threadUnlink = (frames, { keep = false } = {}) => {
    frames.filter(isArea).forEach(f => {
      const p = LV.threadPrev(f), n = LV.threadNext(f); if (!p && !n) return;
      if (!p && n) n.data.text = f.data.text || ''; // head leaves: the next frame becomes the head
      if (p && n) { p.data.next = n.data.uid; n.data.prev = p.data.uid; } else if (p) delete p.data.next; else delete n.data.prev;
      delete f.data.next; delete f.data.prev; if (!keep) f.data.text = '';
      reflowOne(f, f.data.text || ''); LV.reflow(p || n);
    });
  };
  LV.threadRemove = frames => { // break all links; every frame keeps the text it currently shows
    const chains = new Map(); frames.filter(isArea).forEach(f => { const c = LV.threadChain(f); if (c.length > 1) chains.set(c[0], c); });
    let n = 0;
    chains.forEach(chain => {
      let text = chain[0].data.text || '';
      const parts = chain.map((f, i) => { if (i === chain.length - 1) return text; const rest = reflowOne(f, text), part = text.slice(0, text.length - rest.length).replace(/\s+$/, ''); text = rest.replace(/^\n/, ''); return part; });
      chain.forEach((f, i) => { f.data.text = parts[i]; delete f.data.next; delete f.data.prev; reflowOne(f, parts[i]); n++; });
    });
    return n;
  };

  /* ---------- threading commands (menus / Properties panel) ---------- */
  LV.threadCreateSel = () => { // link the selected frames / closed shapes in stacking order (first must be area type)
    const items = LV.sortZ(LV.sel).filter(it => isArea(it) || (LV.isPathItem(it) && it.closed !== false));
    const head = items.find(isArea);
    if (!head || items.length < 2) return LV.toast('Select an area type frame plus another frame or closed shape');
    let cur = LV.threadChain(head).pop(), out = [head];
    items.filter(it => it !== head && !LV.threadChain(head).includes(it)).forEach(it => { const b = LV.threadLink(cur, it); if (b) { cur = b; out.push(b); } });
    LV.setSel(out); LV.commit('Create Thread');
  };
  LV.threadNewFrame = () => {
    const g = LV.sel.find(isArea); if (!g) return LV.toast('Select an area type frame');
    const last = LV.threadChain(g).pop(), b = last.bounds, geo = LV.areaGeom(last);
    const f = LV.newAreaText(new P.Rectangle(b.right + 24, b.top, geo.W, geo.H), '', LV.textStyleOf(last)); f.name = 'Area Type'; f.insertAbove(last); LV.uidOf(f);
    LV.threadLink(last, f); LV.setSel([f]); LV.commit('Thread Text');
  };
  LV.threadReleaseSel = () => { const fs = LV.sel.filter(it => isArea(it) && LV.isThreaded(it)); if (!fs.length) return LV.toast('Select a threaded text frame'); LV.threadUnlink(fs); LV.commit('Release Threaded Frame'); };
  LV.threadRemoveSel = () => { const n = LV.threadRemove(LV.sel); if (!n) return LV.toast('Select threaded text'); LV.commit('Remove Threading'); };

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
    let hidden = [];
    if (k === 'areatext' && (item.data.next || item.data.prev)) { // threaded: edit the whole story in the first frame
      const chain = LV.threadChain(item); item = chain[0];
      hidden = chain.slice(1).map(f => LV.textNode(f)).filter(Boolean); hidden.forEach(t => t.visible = false);
    }
    const t = LV.textNode(item);
    LV.textEditing = { item, t, k, before: k === 'text' ? item.content : item.data.text, hidden };
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
    (e.hidden || []).forEach(t => t.visible = true);
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
