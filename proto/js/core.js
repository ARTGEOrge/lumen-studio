'use strict';
/* Lumen Proto — core document model: matrices, node defaults, instance resolution, text layout, auto layout,
   constraints. Shared by the editor, the in-app preview and the exported HTML prototype (no editor/DOM deps). */
(function () {
  const LP = window.LP = window.LP || {};

  /* ---------------- math ---------------- */
  const M = {
    id: () => [1, 0, 0, 1, 0, 0],
    mul: (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]],
    inv: m => { const d = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; },
    ap: (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }),
    apv: (m, x, y) => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y }),
    tr: (x, y) => [1, 0, 0, 1, x, y],
    rot: a => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; },
    scale: m => Math.hypot(m[0], m[1])
  };
  LP.M = M;
  // local transform of a node in its parent's space: translate(x,y) · rotate about centre
  LP.localMatrix = n => {
    if (!n.r) return M.tr(n.x, n.y);
    const cx = n.w / 2, cy = n.h / 2;
    return M.mul(M.tr(n.x + cx, n.y + cy), M.mul(M.rot(n.r * Math.PI / 180), M.tr(-cx, -cy)));
  };

  /* ---------------- colors ---------------- */
  function parseColor(c) {
    if (!c) return [0, 0, 0, 1];
    if (Array.isArray(c)) return c;
    c = String(c).trim();
    if (c[0] === '#') {
      let h = c.slice(1); if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    const m = c.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p[3] ?? 1]; }
    return [0, 0, 0, 1];
  }
  const hex2 = v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  LP.parseColor = parseColor;
  LP.toHex = c => { const p = parseColor(c); return '#' + hex2(p[0]) + hex2(p[1]) + hex2(p[2]); };
  LP.rgba = (c, a = 1) => { const p = parseColor(c); const al = +(p[3] * a).toFixed(4); return al >= 1 ? '#' + hex2(p[0]) + hex2(p[1]) + hex2(p[2]) : `rgba(${p[0] | 0},${p[1] | 0},${p[2] | 0},${al})`; };
  LP.mixColor = (a, b, t) => { const p = parseColor(a), q = parseColor(b); return `rgba(${p[0] + (q[0] - p[0]) * t | 0},${p[1] + (q[1] - p[1]) * t | 0},${p[2] + (q[2] - p[2]) * t | 0},${p[3] + (q[3] - p[3]) * t})`; };

  /* ---------------- node defaults ---------------- */
  let idc = 0;
  LP.newId = () => Date.now().toString(36).slice(-4) + (idc++).toString(36) + Math.random().toString(36).slice(2, 5);
  LP.FONTS = ['Inter', 'Segoe UI', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Consolas', 'Courier New', 'Calibri', 'Cambria', 'Bahnschrift'];
  LP.fontCss = f => (f === 'Inter' ? '"Inter",' : `"${String(f || 'Inter').replace(/["\\;{}]/g, '')}",`) + ' "Segoe UI", system-ui, sans-serif';
  LP.solid = (color, a = 1) => ({ type: 'solid', color, a, on: true });
  LP.CONTAINERS = { frame: 1, group: 1, instance: 1, bool: 1 };
  LP.TYPE_NAMES = { frame: 'Frame', group: 'Group', rect: 'Rectangle', ellipse: 'Ellipse', path: 'Path', text: 'Text', icon: 'Icon', instance: 'Instance', image: 'Image', bool: 'Boolean' };
  LP.BOOL_OPS = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' };

  LP.node = function (type, p = {}) {
    const n = { id: LP.newId(), type, name: p.name || LP.TYPE_NAMES[type] || type, x: 0, y: 0, w: 100, h: 100, r: 0, opacity: 1, blend: 'normal', visible: true, locked: false };
    switch (type) {
      case 'frame': Object.assign(n, { fills: [LP.solid('#ffffff')], strokes: [], shadows: [], radius: [0, 0, 0, 0], children: [], clip: true, layout: null, sizeH: 'fixed', sizeV: 'fixed', grids: [] }); break;
      case 'group': Object.assign(n, { children: [], fills: [], strokes: [], shadows: [] }); break;
      case 'rect': Object.assign(n, { fills: [LP.solid('#d9d9d9')], strokes: [], shadows: [], radius: [0, 0, 0, 0] }); break;
      case 'ellipse': Object.assign(n, { fills: [LP.solid('#d9d9d9')], strokes: [], shadows: [] }); break;
      case 'path': Object.assign(n, { fills: [], strokes: [{ color: '#1e1e1e', a: 1, w: 2, align: 'center', on: true }], shadows: [], pts: [], closed: false, bw: 100, bh: 100 }); break;
      case 'text': Object.assign(n, { fills: [LP.solid('#1e1e1e')], strokes: [], shadows: [], text: 'Text', font: 'Inter', size: 16, weight: 400, italic: false, lh: 0, ls: 0, align: 'left', valign: 'top', auto: 'width', deco: 'none', tcase: 'none', textStyleId: null, w: 40, h: 19 }); break;
      case 'icon': Object.assign(n, { icon: 'heart', color: '#1e1e1e', sw: 2, w: 24, h: 24, shadows: [] }); break;
      case 'instance': Object.assign(n, { componentId: null, overrides: {}, sizeH: 'fixed', sizeV: 'fixed' }); break;
      case 'bool': Object.assign(n, { op: 'union', children: [], fills: [LP.solid('#d9d9d9')], strokes: [], shadows: [], bd: '' }); break;
    }
    if (type !== 'frame' && type !== 'instance') { n.sizeH = 'fixed'; n.sizeV = 'fixed'; }
    n.cons = { h: 'left', v: 'top' };
    return Object.assign(n, p);
  };

  // deep clone with fresh ids (for duplicate / paste / detach). Returns the clone.
  LP.cloneFresh = function (n, idMap) {
    const c = JSON.parse(JSON.stringify(n));
    const walk = x => { const old = x.id; x.id = LP.newId(); if (idMap) idMap[old] = x.id; (x.children || []).forEach(walk); };
    walk(c);
    // fix interaction targets inside the clone that point at cloned nodes (e.g. scroll-to)
    if (idMap) { const fix = x => { (x.proto || []).forEach(p => { if (idMap[p.target]) p.target = idMap[p.target]; }); (x.children || []).forEach(fix); }; fix(c); }
    return c;
  };

  /* ---------------- styles ---------------- */
  // color of a color style in the active color mode (doc._mode: 'light' | 'dark', set by whoever is drawing)
  // named color modes: doc.modes = [{id, name}] (the first is the default); color styles keep a value per mode in s.modes
  LP.DEFAULT_MODES = () => [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }];
  LP.modesOf = doc => (doc && Array.isArray(doc.modes) && doc.modes.length) ? doc.modes : LP.DEFAULT_MODES();
  LP.defaultMode = doc => LP.modesOf(doc)[0].id;
  LP.nodeMode = (doc, n) => (n && n.cmode && LP.modesOf(doc).some(m => m.id === n.cmode)) ? n.cmode : LP.defaultMode(doc);
  LP.styleColor = (s, doc) => {
    const m = doc && doc._mode;
    if (m && s.modes && s.modes[m] && s.modes[m].color) return { color: s.modes[m].color, a: s.modes[m].a ?? 1 };
    if (m === 'dark' && s.dark && s.dark.color) return { color: s.dark.color, a: s.dark.a ?? 1 }; // 1.1 files
    return { color: s.color, a: s.a ?? 1 };
  };
  LP.fillColor = (f, doc) => { const s = f.style && doc.colorStyles?.find(x => x.id === f.style); return s ? LP.styleColor(s, doc) : { color: f.color, a: f.a ?? 1 }; };
  LP.TEXT_KEYS = ['font', 'size', 'weight', 'italic', 'lh', 'ls'];
  LP.textProps = (n, doc) => {
    const s = n.textStyleId && doc.textStyles?.find(x => x.id === n.textStyleId);
    if (!s) return n;
    const o = Object.create(n); LP.TEXT_KEYS.forEach(k => { if (s[k] !== undefined) o[k] = s[k]; }); return o;
  };

  /* ---------------- mixed-style text runs ----------------
     text.runs = [{n: charCount, font?, size?, weight?, italic?, ls?, lh?, deco?, color?, a?, cs?(color style), ts?(text style)}]
     covering the text in order; keys absent on a run fall back to the layer's own style. */
  LP.RUN_KEYS = ['font', 'size', 'weight', 'italic', 'ls', 'lh', 'deco', 'color', 'a', 'cs', 'ts'];
  LP.RUN_STYLE_KEYS = LP.RUN_KEYS;
  // [{s,e,st}] covering [0,len) exactly (extra runs dropped, last run extended)
  LP.normRuns = (runs, len) => {
    const out = []; let pos = 0;
    if (Array.isArray(runs)) for (const r of runs) {
      if (pos >= len) break; if (!r || typeof r !== 'object') continue;
      const c = Math.max(0, Math.floor(Number(r.n) || 0)); if (!c) continue;
      const e = Math.min(len, pos + c); out.push({ s: pos, e, st: r }); pos = e;
    }
    if (pos < len) { if (out.length) out[out.length - 1].e = len; else out.push({ s: 0, e: len, st: {} }); }
    if (!out.length) out.push({ s: 0, e: 0, st: {} });
    return out;
  };
  LP.runHasStyle = r => !!r && LP.RUN_KEYS.some(k => r[k] !== undefined && r[k] !== null);
  LP.isRich = n => Array.isArray(n.runs) && n.runs.some(LP.runHasStyle);
  // effective style of a run: layer style ← run text style ← run overrides
  LP.runStyle = (base, r, doc) => {
    const o = { font: base.font, size: base.size, weight: base.weight, italic: base.italic, ls: base.ls || 0, lh: base.lh || 0, deco: base.deco || 'none', color: null, a: 1 };
    if (r) {
      const ts = r.ts && doc?.textStyles?.find(x => x.id === r.ts);
      if (ts) LP.TEXT_KEYS.forEach(k => { if (ts[k] !== undefined) o[k] = ts[k]; });
      LP.TEXT_KEYS.forEach(k => { if (r[k] !== undefined && r[k] !== null) o[k] = r[k]; });
      if (r.deco) o.deco = r.deco;
      const cs = r.cs && doc?.colorStyles?.find(x => x.id === r.cs);
      if (cs) { const c = LP.styleColor(cs, doc); o.color = c.color; o.a = c.a; }
      else if (r.color) { o.color = r.color; o.a = r.a ?? 1; }
    }
    return o;
  };
  // set style keys on the char range [s,e) of a text layer's runs (returns new compacted runs)
  LP.applyRunStyle = (n, s, e, patch) => {
    const len = String(n.text ?? '').length;
    s = Math.max(0, Math.min(len, s)); e = Math.max(s, Math.min(len, e));
    const segs = LP.normRuns(n.runs, len).map(g => ({ s: g.s, e: g.e, st: Object.assign({}, g.st) }));
    const out = [];
    segs.forEach(g => {
      const parts = [[g.s, Math.min(g.e, s)], [Math.max(g.s, s), Math.min(g.e, e)], [Math.max(g.s, e), g.e]];
      parts.forEach(([a, b], i) => {
        if (b <= a) return;
        const st = Object.assign({}, g.st);
        if (i === 1) for (const k in patch) { if (patch[k] === undefined || patch[k] === null) delete st[k]; else st[k] = patch[k]; }
        out.push({ s: a, e: b, st });
      });
    });
    return LP.compactRuns(out);
  };
  LP.compactRuns = segs => {
    const out = [];
    segs.forEach(g => {
      const st = {}; LP.RUN_KEYS.forEach(k => { if (g.st[k] !== undefined && g.st[k] !== null) st[k] = g.st[k]; });
      const prev = out[out.length - 1];
      if (prev && JSON.stringify(Object.assign({}, prev, { n: 0 })) === JSON.stringify(Object.assign({}, st, { n: 0 }))) prev.n += g.e - g.s;
      else if (g.e > g.s) out.push(Object.assign({ n: g.e - g.s }, st));
    });
    return out.some(LP.runHasStyle) ? out : null;
  };
  // the style shared by every char of [s,e) for key k, or undefined when mixed
  LP.rangeValue = (n, doc, s, e, k) => {
    const base = LP.textProps(n, doc), len = String(n.text ?? '').length;
    if (e <= s) { s = Math.max(0, s - 1); e = s + 1; }
    let val, first = true;
    LP.normRuns(n.runs, len).forEach(g => {
      if (!(g.e > s && g.s < e)) return;
      const v = LP.runStyle(base, g.st, doc)[k];
      if (first) { val = v; first = false; } else if (JSON.stringify(v) !== JSON.stringify(val)) val = undefined;
    });
    return first ? LP.runStyle(base, null, doc)[k] : val;
  };

  /* ---------------- text layout ---------------- */
  const mctx = document.createElement('canvas').getContext('2d');
  LP.fontString = t => `${t.italic ? 'italic ' : ''}${t.weight || 400} ${t.size}px ${LP.fontCss(t.font)}`;
  LP.lineHeight = t => t.lh > 0 ? t.lh : Math.round(t.size * 1.21);
  LP.caseText = (s, c) => c === 'upper' ? s.toUpperCase() : c === 'lower' ? s.toLowerCase() : s;
  // returns {lines:[{t,w}], w, h}
  LP.layoutText = function (t, maxW) {
    mctx.font = LP.fontString(t);
    try { mctx.letterSpacing = (t.ls || 0) + 'px'; } catch (e) { }
    const meas = s => mctx.measureText(s).width;
    const src = LP.caseText(String(t.text ?? ''), t.tcase);
    const lines = [];
    const wrap = maxW != null && maxW > 0;
    for (const para of src.split('\n')) {
      if (!wrap) { lines.push({ t: para, w: meas(para) }); continue; }
      const words = para.split(/(\s+)/); let cur = '';
      for (const wd of words) {
        if (!wd) continue;
        const test = cur + wd;
        if (meas(test.trimEnd()) <= maxW + 0.5 || !cur.trim()) {
          if (!cur.trim() && meas(wd) > maxW && /\S/.test(wd)) { // very long word: break by chars
            let piece = cur;
            for (const ch of wd) { if (meas(piece + ch) > maxW && piece) { lines.push({ t: piece, w: meas(piece) }); piece = ch; } else piece += ch; }
            cur = piece;
          } else cur = test;
        } else {
          lines.push({ t: cur.trimEnd(), w: meas(cur.trimEnd()) });
          cur = /^\s+$/.test(wd) ? '' : wd;
          if (meas(cur) > maxW) { let piece = ''; for (const ch of cur) { if (meas(piece + ch) > maxW && piece) { lines.push({ t: piece, w: meas(piece) }); piece = ch; } else piece += ch; } cur = piece; }
        }
      }
      lines.push({ t: cur.trimEnd(), w: meas(cur.trimEnd()) });
    }
    const lh = LP.lineHeight(t);
    return { lines, w: Math.max(0, ...lines.map(l => l.w)), h: lines.length * lh, lh };
  };

  // font ascent/descent (cached per font string)
  const fmCache = new Map();
  LP.fontMetrics = t => {
    const f = LP.fontString(t); let r = fmCache.get(f);
    if (!r) { mctx.font = f; const m = mctx.measureText('Hgjy'); r = { asc: m.fontBoundingBoxAscent ?? t.size * .93, desc: m.fontBoundingBoxDescent ?? t.size * .24 }; if (fmCache.size > 300) fmCache.clear(); fmCache.set(f, r); }
    return r;
  };
  // mixed-style layout: lines of styled pieces. t = layer text props (with .text/.runs), doc for styles
  LP.layoutRich = function (t, maxW, doc) {
    const text = String(t.text ?? ''), len = text.length;
    const segs = LP.normRuns(t.runs, len).map(g => { const st = LP.runStyle(t, g.st, doc); return { s: g.s, e: g.e, st, font: LP.fontString(st) }; });
    const segIdx = i => { for (let k = 0; k < segs.length; k++) if (i < segs[k].e) return k; return segs.length - 1; };
    const measPart = (seg, a, b) => { mctx.font = seg.font; try { mctx.letterSpacing = (seg.st.ls || 0) + 'px'; } catch (e) { } return mctx.measureText(LP.caseText(text.slice(a, b), t.tcase)).width; };
    const meas = (a, b) => { let w = 0; if (b <= a) return 0; for (let k = segIdx(a); k < segs.length && segs[k].s < b; k++) { const g = segs[k]; w += measPart(g, Math.max(a, g.s), Math.min(b, g.e)); } return w; };
    const isWs = i => /\s/.test(text[i]);
    const trimEnd = (a, b) => { while (b > a && isWs(b - 1)) b--; return b; };
    const hasInk = (a, b) => { for (let i = a; i < b; i++) if (!isWs(i)) return true; return false; };
    const ranges = [];
    const wrap = maxW != null && maxW > 0;
    let ps = 0;
    const paras = text.split('\n');
    paras.forEach(p => {
      const pe = ps + p.length;
      if (!wrap) ranges.push([ps, pe]);
      else {
        let s = ps, e = ps;
        const charBreak = (a, b) => { let q = a; for (let i = a; i < b; i++) { if (i > q && meas(q, i + 1) > maxW) { ranges.push([q, i]); q = i; } } return q; };
        const re = /\s+|\S+/g; let m;
        while ((m = re.exec(p))) {
          const a = ps + m.index, b = a + m[0].length, ws = /^\s/.test(m[0]);
          if (meas(s, trimEnd(s, b)) <= maxW + 0.5 || !hasInk(s, e)) {
            if (!hasInk(s, e) && !ws && meas(a, b) > maxW) { s = charBreak(s, b); e = b; }
            else e = b;
          } else {
            ranges.push([s, trimEnd(s, e)]);
            if (ws) { s = e = b; }
            else { s = a; e = b; if (meas(a, b) > maxW) s = charBreak(a, b); }
          }
        }
        ranges.push([s, trimEnd(s, e)]);
      }
      ps = pe + 1;
    });
    const lines = ranges.map(([a, b]) => {
      const pieces = [];
      let x = 0;
      if (b > a) for (let k = segIdx(a); k < segs.length && segs[k].s < b; k++) {
        const g = segs[k], s = Math.max(a, g.s), e = Math.min(b, g.e); if (e <= s) continue;
        const w = measPart(g, s, e);
        pieces.push({ s, e, t: LP.caseText(text.slice(s, e), t.tcase), st: g.st, font: g.font, x, w }); x += w;
      }
      const sts = pieces.length ? pieces.map(p => p.st) : [segs[segIdx(Math.max(0, Math.min(a, len - 1)))].st];
      let lh = 0, asc = 0, desc = 0;
      sts.forEach(st => { lh = Math.max(lh, LP.lineHeight(st)); const fm = LP.fontMetrics(st); asc = Math.max(asc, fm.asc); desc = Math.max(desc, fm.desc); });
      return { s: a, e: b, w: x, lh, asc, desc, pieces, t: pieces.map(p => p.t).join('') };
    });
    const h = lines.reduce((s, l) => s + l.lh, 0);
    return { lines, w: Math.max(0, ...lines.map(l => l.w)), h, lh: lines[0]?.lh || LP.lineHeight(t), rich: true };
  };
  // the text actually shown by a text layer (variable binding replaces it)
  LP.shownText = (v, vars) => {
    if (v.bindText && vars && Object.prototype.hasOwnProperty.call(vars, v.bindText)) { const x = vars[v.bindText]; return typeof x === 'number' ? String(Math.round(x * 1000) / 1000) : String(x); }
    return v.text;
  };
  LP.layoutFor = function (t, maxW, doc, vars) {
    const txt = LP.shownText(t, vars);
    if (txt !== t.text) { const o = Object.create(t); o.text = txt; t = o; }
    return LP.isRich(t) ? LP.layoutRich(t, maxW, doc) : LP.layoutText(t, maxW);
  };

  /* ---------------- scene: resolved + laid-out view of a document ---------------- */
  const OWN_INST_KEYS = new Set(['id', 'type', 'name', 'x', 'y', 'w', 'h', 'r', 'visible', 'locked', 'cons', 'sizeH', 'sizeV', 'absolute', 'proto', 'componentId', 'overrides', 'exports', 'flowStart', 'children']);
  LP.OVERRIDABLE = new Set(['text', 'runs', 'bindText', 'showIf', 'fills', 'strokes', 'visible', 'opacity', 'shadows', 'icon', 'color', 'componentId', 'blur', 'textStyleId']);

  class Scene {
    constructor(doc) { this.doc = doc; this.byId = {}; this.parent = {}; this.views = new Map(); this.kidsMap = new Map(); this.text = new Map(); this.done = new Set(); this.busy = new Set(); this.vars = LP.varValues(doc); }
    view(n) { return this.views.get(n) || n; }
    // visible flag + conditional visibility bound to a variable
    isVis(n) { const v = this.view(n); if (v.visible === false) return false; return !v.showIf || LP.evalCond(v.showIf, this.vars, this.doc); }
    kids(n) { return this.kidsMap.get(n) || n.children || []; }
    get(id) { return this.byId[id]; }
    parentOf(n) { return this.byId[this.parent[n.id]] || null; }
    isRoot(n) { return n === this.doc; }
    top(n) { let p = n; while (p && this.parent[p.id] && this.parent[p.id] !== '0') p = this.byId[this.parent[p.id]]; return p; }
    // does id belong to a resolved instance clone?
    static isClone(id) { return String(id).includes('/'); }

    update() {
      this.vars = LP.varValues(this.doc);
      this.byId = { '0': this.doc }; this.parent = {}; this.views.clear(); this.kidsMap.clear(); this.text.clear(); this.done.clear(); this.busy.clear();
      const idx = (n, pid) => { this.byId[n.id] = n; this.parent[n.id] = pid; (n.children || []).forEach(c => idx(c, n.id)); };
      this.doc.children.forEach(c => idx(c, '0'));
      // components first (instances clone them)
      Object.values(this.byId).forEach(n => { if (n.component) this.layout(n); });
      this.doc.children.forEach(c => this.layout(c));
      return this;
    }

    /* ----- instances ----- */
    resolve(inst) {
      const main = this.byId[inst.componentId];
      if (!main || this.busy.has(main.id) || main === inst) { this.kidsMap.set(inst, []); this.views.set(inst, Object.assign({}, inst, { fills: inst.fills || [LP.solid('#ffd6d6')], strokes: inst.strokes || [{ color: '#e03b3b', a: 1, w: 1, align: 'inside', on: true }], radius: [0, 0, 0, 0], children: [], _missing: true })); return; }
      this.busy.add(main.id);
      this.layout(main);
      const mv = this.view(main);
      const view = {};
      for (const k in mv) if (!OWN_INST_KEYS.has(k) && k !== 'component') view[k] = JSON.parse(JSON.stringify(mv[k] ?? null));
      for (const k in inst) if (OWN_INST_KEYS.has(k) || inst[k] !== undefined) view[k] = inst[k];
      view.type = 'instance'; view.mainType = mv.type;
      // interactions: the instance's own first, then the main component's (interactive components)
      const own = inst.proto || [];
      view.proto = own.concat((mv.proto || []).filter(p => !own.some(q => q.trigger === p.trigger)));
      // geometry & per-instance basics always read through to the instance node (parents may move it later)
      ['x', 'y', 'w', 'h', 'r', 'visible', 'opacity', 'blend', 'name', 'locked'].forEach(k => { delete view[k]; Object.defineProperty(view, k, { get: () => inst[k], set: val => { inst[k] = val; }, enumerable: true }); });
      if (!view.radius) view.radius = [0, 0, 0, 0];
      if (view.clip == null) view.clip = mv.type === 'frame';
      const ov = inst.overrides || {};
      // overrides also match by layer-name path, so they survive switching variants
      const byName = {}; for (const k in ov) if (ov[k] && ov[k].__) byName[ov[k].__] = ov[k];
      const kids = this.kids(mv).map(k => this.cloneInto(k, inst.id, '', ov, '', byName));
      this.views.set(inst, view); this.kidsMap.set(inst, kids);
      kids.forEach(k => this.parent[k.id] = inst.id);
      // non-auto-layout instances that were resized: apply constraints relative to main size
      if (!view.layout && (Math.abs(mv.w - inst.w) > .01 || Math.abs(mv.h - inst.h) > .01)) {
        const tmp = { w: mv.w, h: mv.h }; LP.applyConstraintsKids(this, kids, tmp.w, tmp.h, inst.w, inst.h);
      }
      this.busy.delete(main.id);
    }
    cloneInto(src, instId, rel, ov, nrel, byName) {
      const relId = rel ? rel + '/' + src.id.split('/').pop() : src.id.split('/').pop();
      const nameRel = nrel ? nrel + '/' + src.name : src.name;
      const s = this.view(src);
      const c = {};
      for (const k in src) if (k !== 'children') c[k] = (typeof src[k] === 'object' && src[k] !== null) ? JSON.parse(JSON.stringify(src[k])) : src[k];
      c.id = instId + '/' + relId; c._src = src.id; c._rel = relId;
      c._nrel = nameRel;
      const o = ov[relId] || byName[nameRel]; if (o) for (const k in o) if (k !== '__') c[k] = JSON.parse(JSON.stringify(o[k]));
      this.byId[c.id] = c;
      if (src.type === 'instance') {
        // propagate deeper overrides of the outer instance into the nested one
        const pre = relId + '/', sub = {};
        Object.assign(sub, JSON.parse(JSON.stringify(src.overrides || {})));
        const npre = nameRel + '/';
        for (const k in ov) {
          const e = ov[k]; if (!e) continue;
          let key = null;
          if (k.startsWith(pre)) key = k.slice(pre.length);
          else if (e.__ && e.__.startsWith(npre) && !ov[relId + '/' + k]) key = '#' + e.__.slice(npre.length);
          if (key == null) continue;
          const val = Object.assign({}, e); if (e.__) val.__ = e.__.slice(npre.length);
          sub[key] = Object.assign(sub[key] || {}, val);
        }
        c.overrides = sub; delete c.children;
        // nested instance's resolved kids get ids instId/rel/…
        this.done.delete(c.id);
        this.layout(c);
        return c;
      }
      if (src.children || s.children) {
        c.children = this.kids(src).map(k => { const kk = this.cloneInto(k, instId, relId, ov, nameRel, byName); this.parent[kk.id] = c.id; return kk; });
      }
      return c;
    }

    /* ----- layout ----- */
    layout(n) {
      if (this.done.has(n)) return; this.done.add(n);
      if (n.type === 'instance') this.resolve(n);
      const v = this.view(n);
      if (n.type === 'text') { this.measureText(n); return; }
      const kids = this.kids(n);
      kids.forEach(k => this.layout(k));
      if (n.type === 'group') { this.fitGroup(n); return; }
      if (n.type === 'bool') { if (window.paper) { this.fitGroup(n); LP.layoutBool(this, n); } return; }
      if (v.layout) { this.arrange(n); }
    }
    relayout(n) { this.done.delete(n); if (n.type === 'instance') { /* keep resolution, re-arrange only */ this.done.add(n); const v = this.view(n); if (v.layout) this.arrange(n); else this.kids(n).forEach(k => k.type === 'text' && this.measureText(k)); return; } this.layout(n); }
    measureText(n) {
      const t = LP.textProps(n, this.doc);
      const auto = n.auto || 'width';
      const r = LP.layoutFor(t, auto === 'width' ? null : n.w, this.doc, this.vars);
      if (auto === 'width') { n.w = Math.ceil(r.w * 100) / 100 || 1; n.h = r.h; }
      else if (auto === 'height') n.h = r.h;
      this.text.set(n, r);
      return r;
    }
    fitGroup(g) {
      const kids = this.kids(g); if (!kids.length) return;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      kids.forEach(k => { const b = LP.aabb(k); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
      if (Math.abs(x0) > 1e-6 || Math.abs(y0) > 1e-6) { kids.forEach(k => { k.x -= x0; k.y -= y0; }); g.x += x0; g.y += y0; }
      g.w = Math.max(1, x1 - x0); g.h = Math.max(1, y1 - y0);
    }
    // auto layout: hug/fill/fixed, gap, padding, alignment
    arrange(n) {
      const v = this.view(n), L = v.layout; if (!L) return;
      if (L.mode === 'grid') { this.arrangeGrid(n, L); return; }
      if (L.mode === 'h' && L.wrap) { this.arrangeWrap(n, L); return; }
      const H = L.mode === 'h';
      const pad = L.pad || [0, 0, 0, 0];
      const [pS, pE, cS, cE] = H ? [pad[3], pad[1], pad[0], pad[2]] : [pad[0], pad[2], pad[3], pad[1]];
      const MA = H ? 'w' : 'h', CR = H ? 'h' : 'w';
      const sizeMain = n[H ? 'sizeH' : 'sizeV'] || 'fixed', sizeCross = n[H ? 'sizeV' : 'sizeH'] || 'fixed';
      const kids = this.kids(n).filter(k => this.isVis(k) && !k.absolute);
      const kSM = k => k[H ? 'sizeH' : 'sizeV'] || 'fixed', kSC = k => k[H ? 'sizeV' : 'sizeH'] || 'fixed';
      const gap = L.gap || 0;
      const between = L.justify === 'between';
      const cl = LP.clampSize;
      // texts that are told to fill on the wrapping axis become fixed-width wrapping
      kids.forEach(k => { if (k.type === 'text' && (kSM(k) === 'fill' && H || kSC(k) === 'fill' && !H) && k.auto === 'width') k.auto = 'height'; });
      // 1. main axis
      const fillM = sizeMain !== 'hug' ? kids.filter(k => kSM(k) === 'fill') : [];
      const fixedSum = kids.filter(k => !fillM.includes(k)).reduce((s, k) => s + k[MA], 0);
      const gaps = between ? 0 : gap * Math.max(0, kids.length - 1);
      if (sizeMain === 'hug') n[MA] = cl(n, MA, Math.max(1, fixedSum + gaps + pS + pE));
      else if (fillM.length) {
        const each = Math.max(1, (n[MA] - pS - pE - fixedSum - gaps) / fillM.length);
        fillM.forEach(k => { const old = { w: k.w, h: k.h }; k[MA] = cl(k, MA, each); this.afterResize(k, old); });
      }
      // 2. cross axis
      const fillC = sizeCross !== 'hug' ? kids.filter(k => kSC(k) === 'fill') : [];
      fillC.forEach(k => { const old = { w: k.w, h: k.h }; k[CR] = cl(k, CR, Math.max(1, n[CR] - cS - cE)); this.afterResize(k, old); });
      if (sizeCross === 'hug') n[CR] = cl(n, CR, Math.max(1, Math.max(0, ...kids.map(k => k[CR])) + cS + cE));
      // 3. positions
      const used = kids.reduce((s, k) => s + k[MA], 0);
      const free = n[MA] - pS - pE - used;
      let pos = pS, g = gap;
      if (between) g = kids.length > 1 ? Math.max(0, free / (kids.length - 1)) : 0;
      else if (L.justify === 'center') pos += (free - gaps) / 2;
      else if (L.justify === 'end') pos += free - gaps;
      const inner = n[CR] - cS - cE;
      kids.forEach(k => {
        const P = H ? 'x' : 'y', Q = H ? 'y' : 'x';
        k[P] = Math.round(pos * 100) / 100;
        const al = L.align || 'start';
        k[Q] = cS + (al === 'center' ? (inner - k[CR]) / 2 : al === 'end' ? inner - k[CR] : 0);
        k[Q] = Math.round(k[Q] * 100) / 100;
        pos += k[MA] + g;
      });
      if (n.type === 'instance') { /* keep view in sync */ const vv = this.view(n); vv.w = n.w; vv.h = n.h; }
    }
    // horizontal auto layout that wraps onto new rows (row gap = L.gapY)
    arrangeWrap(n, L) {
      const pad = L.pad || [0, 0, 0, 0], [pT, pR, pB, pL] = pad, cl = LP.clampSize;
      const gap = L.gap || 0, gapY = L.gapY ?? gap;
      const kids = this.kids(n).filter(k => this.isVis(k) && !k.absolute);
      kids.forEach(k => { if (k.type === 'text' && k.sizeH === 'fill' && k.auto === 'width') k.auto = 'height'; });
      if ((n.sizeH || 'fixed') === 'hug') n.w = cl(n, 'w', Math.max(1, kids.reduce((s, k) => s + k.w, 0) + gap * Math.max(0, kids.length - 1) + pL + pR));
      const inner = Math.max(1, n.w - pL - pR);
      const rows = []; let row = null;
      kids.forEach(k => { if (!row || (row.w + gap + k.w > inner + .01 && row.items.length)) { row = { items: [], w: -gap, h: 0 }; rows.push(row); } row.items.push(k); row.w += gap + k.w; });
      rows.forEach(r => {
        const fixedH = r.items.filter(k => k.sizeV !== 'fill');
        r.h = Math.max(1, ...(fixedH.length ? fixedH : r.items).map(k => k.h));
        r.items.forEach(k => { if (k.sizeV === 'fill') { const old = { w: k.w, h: k.h }; k.h = cl(k, 'h', r.h); this.afterResize(k, old); } });
      });
      const total = rows.reduce((s, r) => s + r.h, 0) + gapY * Math.max(0, rows.length - 1);
      if ((n.sizeV || 'fixed') === 'hug') n.h = cl(n, 'h', Math.max(1, total + pT + pB));
      let y = pT;
      rows.forEach(r => {
        const free = inner - r.w; let x = pL, g = gap;
        if (L.justify === 'between' && r.items.length > 1) g = gap + Math.max(0, free) / (r.items.length - 1);
        else if (L.justify === 'center') x += free / 2; else if (L.justify === 'end') x += free;
        r.items.forEach(k => {
          k.x = Math.round(x * 100) / 100;
          k.y = Math.round((y + (L.align === 'center' ? (r.h - k.h) / 2 : L.align === 'end' ? r.h - k.h : 0)) * 100) / 100;
          x += k.w + g;
        });
        y += r.h + gapY;
      });
      if (n.type === 'instance') { const vv = this.view(n); vv.w = n.w; vv.h = n.h; }
    }
    // grid auto layout: L.cols columns, column gap L.gap, row gap L.gapY; justify/align place items in their cells
    arrangeGrid(n, L) {
      const pad = L.pad || [0, 0, 0, 0], [pT, pR, pB, pL] = pad, cl = LP.clampSize;
      const cols = Math.max(1, Math.min(64, Math.round(L.cols || 2))), gap = L.gap || 0, gapY = L.gapY ?? gap;
      const kids = this.kids(n).filter(k => this.isVis(k) && !k.absolute);
      kids.forEach(k => { if (k.type === 'text' && k.sizeH === 'fill' && k.auto === 'width') k.auto = 'height'; });
      let colW;
      if ((n.sizeH || 'fixed') === 'hug') {
        const fixedW = kids.filter(k => k.sizeH !== 'fill');
        colW = Math.max(1, ...(fixedW.length ? fixedW : kids).map(k => k.w), 1);
        n.w = cl(n, 'w', cols * colW + gap * (cols - 1) + pL + pR);
        colW = (n.w - pL - pR - gap * (cols - 1)) / cols;
      } else colW = Math.max(1, (n.w - pL - pR - gap * (cols - 1)) / cols);
      kids.forEach(k => { if (k.sizeH === 'fill') { const old = { w: k.w, h: k.h }; k.w = cl(k, 'w', colW); this.afterResize(k, old); } });
      const rows = []; for (let i = 0; i < kids.length; i += cols) rows.push(kids.slice(i, i + cols));
      const rowH = rows.map(r => { const f = r.filter(k => k.sizeV !== 'fill'); return Math.max(1, ...(f.length ? f : r).map(k => k.h)); });
      rows.forEach((r, i) => r.forEach(k => { if (k.sizeV === 'fill') { const old = { w: k.w, h: k.h }; k.h = cl(k, 'h', rowH[i]); this.afterResize(k, old); } }));
      const total = rowH.reduce((s, h) => s + h, 0) + gapY * Math.max(0, rows.length - 1);
      if ((n.sizeV || 'fixed') === 'hug') n.h = cl(n, 'h', Math.max(1, total + pT + pB));
      const fx = { center: .5, end: 1 }[L.justify] || 0, fy = { center: .5, end: 1 }[L.align] || 0;
      let y = pT;
      rows.forEach((r, i) => {
        r.forEach((k, c) => {
          k.x = Math.round((pL + c * (colW + gap) + (colW - k.w) * fx) * 100) / 100;
          k.y = Math.round((y + (rowH[i] - k.h) * fy) * 100) / 100;
        });
        y += rowH[i] + gapY;
      });
      if (n.type === 'instance') { const vv = this.view(n); vv.w = n.w; vv.h = n.h; }
    }
    afterResize(k, old) {
      if (k.type === 'text') { if (k.auto === 'width') k.auto = 'height'; this.measureText(k); return; }
      const v = this.view(k);
      if (v.layout) { this.relayout(k); return; }
      if (k.type === 'group' || !this.kids(k).length) return;
      LP.applyConstraintsKids(this, this.kids(k), old.w, old.h, k.w, k.h);
      this.kids(k).forEach(c => c.type === 'text' && c.auto !== 'width' && this.measureText(c));
    }
  }
  LP.Scene = Scene;

  // min / max width & height (auto layout sizing)
  LP.clampSize = (k, axis, v) => {
    const lo = axis === 'w' ? k.minW : k.minH, hi = axis === 'w' ? k.maxW : k.maxH;
    if (lo > 0) v = Math.max(v, lo); if (hi > 0) v = Math.min(v, hi); return v;
  };

  /* ---------------- variables ----------------
     doc.vars = [{id, name, type:'bool'|'num'|'str', value}]; doc._varVals (runtime) overrides the initial values */
  LP.coerceVar = (type, v) => type === 'bool' ? (v === true || v === 'true' || v === 1 || v === '1') : type === 'num' ? (Number(v) || 0) : String(v ?? '');
  LP.varValues = doc => {
    const out = {};
    (doc && Array.isArray(doc.vars) ? doc.vars : []).forEach(x => { out[x.id] = LP.coerceVar(x.type, x.value); });
    if (doc && doc._varVals) Object.assign(out, doc._varVals);
    return out;
  };
  // condition {v: varId, op: '=='|'!='|'>'|'<'|'>='|'<=', val}
  LP.evalCond = (c, vals, doc) => {
    if (!c || !c.v || !vals || !Object.prototype.hasOwnProperty.call(vals, c.v)) return true;
    const def = (doc?.vars || []).find(x => x.id === c.v), type = def ? def.type : typeof vals[c.v] === 'number' ? 'num' : typeof vals[c.v] === 'boolean' ? 'bool' : 'str';
    const a = vals[c.v], b = LP.coerceVar(type, c.val);
    switch (c.op || '==') {
      case '!=': return a !== b; case '>': return a > b; case '<': return a < b; case '>=': return a >= b; case '<=': return a <= b;
      default: return a === b;
    }
  };

  /* ---------------- path data helpers (shared by import, export, booleans, point editing) ---------------- */
  function arcToCubic(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
    if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
    rx = Math.abs(rx); ry = Math.abs(ry); phi = phi * Math.PI / 180;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
    let lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    let s = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p))); if (fa === fs) s = -s;
    const cxp = s * rx * y1p / ry, cyp = -s * ry * x1p / rx;
    const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry), dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2))), seg = dt / n, k = 4 / 3 * Math.tan(seg / 4), out = [];
    for (let i = 0; i < n; i++) {
      const a1 = t1 + i * seg, a2 = a1 + seg;
      const P = a => [cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp, cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp];
      const D = a => [-rx * Math.sin(a) * cp - ry * Math.cos(a) * sp, -rx * Math.sin(a) * sp + ry * Math.cos(a) * cp];
      const p1 = P(a1), p2 = P(a2), d1 = D(a1), d2 = D(a2);
      out.push([p1[0] + k * d1[0], p1[1] + k * d1[1], p2[0] - k * d2[0], p2[1] - k * d2[1], p2[0], p2[1]]);
    }
    return out;
  }
  // parse SVG path data into absolute segments [{c:'M'|'L'|'C'|'Z', p:[...]}]
  LP.parsePath = function (d) {
    const toks = String(d).match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    const out = []; let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lq = null;
    const num = () => parseFloat(toks[i++]);
    let guard = 0;
    while (i < toks.length && guard++ < 1e6) {
      if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      if (C === 'Z') { out.push({ c: 'Z' }); x = sx; y = sy; lq = null; lcx = x; lcy = y; continue; }
      if (i >= toks.length || /[a-zA-Z]/.test(toks[i])) continue;
      switch (C) {
        case 'M': x = ox + num(); y = oy + num(); sx = x; sy = y; out.push({ c: 'M', p: [x, y] }); cmd = rel ? 'l' : 'L'; break;
        case 'L': x = ox + num(); y = oy + num(); out.push({ c: 'L', p: [x, y] }); break;
        case 'H': x = (rel ? x : 0) + num(); out.push({ c: 'L', p: [x, y] }); break;
        case 'V': y = (rel ? y : 0) + num(); out.push({ c: 'L', p: [x, y] }); break;
        case 'C': { const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]; out.push({ c: 'C', p: a }); lcx = a[2]; lcy = a[3]; x = a[4]; y = a[5]; lq = null; continue; }
        case 'S': { const c1 = out.length && out[out.length - 1].c === 'C' ? [2 * x - lcx, 2 * y - lcy] : [x, y]; const a = [ox + num(), oy + num(), ox + num(), oy + num()]; out.push({ c: 'C', p: [...c1, ...a] }); lcx = a[0]; lcy = a[1]; x = a[2]; y = a[3]; continue; }
        case 'Q': { const q = [ox + num(), oy + num()], e = [ox + num(), oy + num()]; out.push({ c: 'C', p: [x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y), e[0] + 2 / 3 * (q[0] - e[0]), e[1] + 2 / 3 * (q[1] - e[1]), e[0], e[1]] }); lq = q; x = e[0]; y = e[1]; continue; }
        case 'T': { const q = lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y]; const e = [ox + num(), oy + num()]; out.push({ c: 'C', p: [x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y), e[0] + 2 / 3 * (q[0] - e[0]), e[1] + 2 / 3 * (q[1] - e[1]), e[0], e[1]] }); lq = q; x = e[0]; y = e[1]; continue; }
        case 'A': { const rx = num(), ry = num(), rot = num(), la = num(), sw = num(), ex = ox + num(), ey = oy + num(); arcToCubic(x, y, rx, ry, rot, la, sw, ex, ey).forEach(c => out.push({ c: 'C', p: c })); x = ex; y = ey; break; }
        default: i++;
      }
      lq = null; if (C !== 'C' && C !== 'S') { lcx = x; lcy = y; }
    }
    return out.filter(s => !s.p || s.p.every(isFinite));
  };
  LP.segsToD = (segs, ox = 0, oy = 0) => segs.map(s => s.c === 'Z' ? 'Z' : s.c + s.p.map((v, i) => +(v - (i % 2 ? oy : ox)).toFixed(3)).join(' ')).join('');
  LP.segsTransform = (segs, m) => segs.map(s => s.c === 'Z' ? s : { c: s.c, p: s.p.map((v, i, a) => i % 2 ? null : M.ap(m, a[i], a[i + 1])).filter(Boolean).flatMap(q => [q.x, q.y]) });
  LP.segBounds = segs => { const xs = [], ys = []; segs.forEach(s => s.p && s.p.forEach((v, i) => (i % 2 ? ys : xs).push(v))); return xs.length ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } : { x: 0, y: 0, w: 0, h: 0 }; };
  LP.transformD = (d, m) => LP.segsToD(LP.segsTransform(LP.parsePath(d), m));

  // contours of a point-based path: [{pts, closed}] (multi-contour paths use n.cont; legacy single = n.pts/closed)
  LP.contoursOf = v => Array.isArray(v.cont) ? v.cont : [{ pts: v.pts || [], closed: !!v.closed }];
  LP.isPointPath = v => !v.d && (Array.isArray(v.cont) ? v.cont.some(c => c.pts && c.pts.length) : (v.pts || []).length > 0);
  // contours → path data (scaled by sx, sy)
  LP.contoursD = (cs, sx = 1, sy = 1) => {
    const f = n => +n.toFixed(3); let d = '';
    cs.forEach(c => {
      const pts = c.pts || []; if (!pts.length) return;
      d += `M${f(pts[0].x * sx)} ${f(pts[0].y * sy)}`;
      const seg = (a, b) => { if (a.ox == null && b.ix == null) d += `L${f(b.x * sx)} ${f(b.y * sy)}`; else d += `C${f((a.ox ?? a.x) * sx)} ${f((a.oy ?? a.y) * sy)} ${f((b.ix ?? b.x) * sx)} ${f((b.iy ?? b.y) * sy)} ${f(b.x * sx)} ${f(b.y * sy)}`; };
      for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
      if (c.closed && pts.length > 1) { seg(pts[pts.length - 1], pts[0]); d += 'Z'; }
    });
    return d;
  };
  // SVG path data → contours with bezier handles (for point editing of imported paths)
  LP.dToContours = d => {
    const cs = []; let cur = null;
    LP.parsePath(d).forEach(s => {
      if (s.c === 'M') { cur = { pts: [{ x: s.p[0], y: s.p[1] }], closed: false }; cs.push(cur); return; }
      if (!cur) { cur = { pts: [{ x: 0, y: 0 }], closed: false }; cs.push(cur); }
      if (s.c === 'L') cur.pts.push({ x: s.p[0], y: s.p[1] });
      else if (s.c === 'C') { const a = cur.pts[cur.pts.length - 1]; a.ox = s.p[0]; a.oy = s.p[1]; cur.pts.push({ x: s.p[4], y: s.p[5], ix: s.p[2], iy: s.p[3] }); }
      else if (s.c === 'Z') {
        cur.closed = true;
        const p0 = cur.pts[0], pl = cur.pts[cur.pts.length - 1];
        if (cur.pts.length > 1 && Math.hypot(p0.x - pl.x, p0.y - pl.y) < 1e-3) { if (pl.ix != null) { p0.ix = pl.ix; p0.iy = pl.iy; } cur.pts.pop(); }
        const last = cur.pts[cur.pts.length - 1]; cur = { pts: [{ x: p0.x, y: p0.y }], closed: false, _implicit: true }; cs.push(cur); void last;
      }
    });
    return cs.filter(c => !(c._implicit && c.pts.length < 2)).map(c => { delete c._implicit; return c; }).filter(c => c.pts.length > 0);
  };

  // outline of a node as path data in its PARENT space (used by boolean operations)
  LP.outlineD = function (scene, n) {
    const v = scene.view(n), t = v.mainType || n.type, w = n.w, h = n.h;
    let d = '';
    if (t === 'ellipse') { const rx = w / 2, ry = h / 2, k = .5523; d = `M${w} ${ry}C${w} ${ry + ry * k} ${rx + rx * k} ${h} ${rx} ${h}C${rx - rx * k} ${h} 0 ${ry + ry * k} 0 ${ry}C0 ${ry - ry * k} ${rx - rx * k} 0 ${rx} 0C${rx + rx * k} 0 ${w} ${ry - ry * k} ${w} ${ry}Z`; }
    else if (t === 'path') { const sx = v.bw ? w / v.bw : 1, sy = v.bh ? h / v.bh : 1; d = v.d ? LP.transformD(v.d, [sx, 0, 0, sy, 0, 0]) : LP.contoursD(LP.contoursOf(v), sx, sy); }
    else if (t === 'bool') d = v.bd || '';
    else if (t === 'group') { const parts = scene.kids(n).filter(k => scene.isVis(k)).map(k => LP.outlineD(scene, k)).filter(Boolean); d = parts.length > 1 ? (LP.boolCompute(parts, 'union') ?? parts.join('')) : parts[0] || ''; }
    else {
      const r = (v.radius && (t === 'rect' || t === 'frame' || t === 'instance')) ? v.radius.map(q => Math.max(0, Math.min(q || 0, Math.min(w, h) / 2))) : [0, 0, 0, 0];
      const k = .5523, [a, b, c, e] = r;
      d = `M${a} 0H${w - b}` + (b ? `C${w - b + b * k} 0 ${w} ${b - b * k} ${w} ${b}` : '') + `V${h - c}` + (c ? `C${w} ${h - c + c * k} ${w - c + c * k} ${h} ${w - c} ${h}` : '') + `H${e}` + (e ? `C${e - e * k} ${h} 0 ${h - e + e * k} 0 ${h - e}` : '') + `V${a}` + (a ? `C0 ${a - a * k} ${a - a * k} 0 ${a} 0` : '') + 'Z';
    }
    if (!d) return '';
    return LP.transformD(d, LP.localMatrix(n));
  };
  // boolean path computation (paper.js when available; otherwise the stored result is used)
  let paperScope = null; const boolCache = new Map();
  LP.boolCompute = (ds, op) => {
    const P = window.paper; if (!P) return null;
    const key = op + '|' + ds.join('|'); if (boolCache.has(key)) return boolCache.get(key);
    if (!paperScope) { paperScope = new P.PaperScope(); paperScope.setup(new paperScope.Size(1, 1)); }
    const S = paperScope; S.activate();
    let acc = null;
    try {
      ds.forEach(d => {
        if (!d) return;
        const item = new S.CompoundPath({ pathData: d, insert: false }); item.fillRule = 'nonzero';
        if (!acc) { acc = item; return; }
        const o = { insert: false };
        acc = op === 'subtract' ? acc.subtract(item, o) : op === 'intersect' ? acc.intersect(item, o) : op === 'exclude' ? acc.exclude(item, o) : acc.unite(item, o);
      });
    } catch (e) { console.warn('boolean op failed', e); return null; }
    let out = acc ? acc.pathData || '' : '';
    out = out ? LP.segsToD(LP.parsePath(out)) : '';
    if (boolCache.size > 400) boolCache.clear();
    boolCache.set(key, out);
    return out;
  };
  // compute a boolean group's result path (in its own space) and fit its box to the result
  LP.layoutBool = function (scene, n) {
    const kids = scene.kids(n).filter(k => scene.isVis(k));
    const ds = kids.map(k => LP.outlineD(scene, k));
    const d = LP.boolCompute(ds, n.op || 'union');
    if (d == null) return; // no engine: keep stored result
    if (!d) { n.bd = ''; return; }
    const b = LP.segBounds(LP.parsePath(d));
    if (b.w > 0 && b.h > 0 && (Math.abs(b.x) > 1e-3 || Math.abs(b.y) > 1e-3 || Math.abs(b.w - n.w) > 1e-3 || Math.abs(b.h - n.h) > 1e-3)) {
      kids.forEach(k => { k.x -= b.x; k.y -= b.y; });
      scene.kids(n).filter(k => !kids.includes(k)).forEach(k => { k.x -= b.x; k.y -= b.y; });
      n.x += b.x; n.y += b.y; n.w = b.w; n.h = b.h;
      n.bd = LP.transformD(d, M.tr(-b.x, -b.y));
    } else n.bd = d;
  };

  // axis-aligned bounds of a node in its parent's space
  LP.aabb = n => {
    if (!n.r) return { x: n.x, y: n.y, w: n.w, h: n.h };
    const m = LP.localMatrix(n); const ps = [[0, 0], [n.w, 0], [n.w, n.h], [0, n.h]].map(p => M.ap(m, p[0], p[1]));
    const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };

  // constraints: children of a (non auto-layout) container that went from ow×oh to nw×nh
  LP.applyConstraintsKids = function (scene, kids, ow, oh, nw, nh) {
    const dw = nw - ow, dh = nh - oh, sx = ow ? nw / ow : 1, sy = oh ? nh / oh : 1;
    kids.forEach(k => {
      const c = k.cons || { h: 'left', v: 'top' };
      const old = { w: k.w, h: k.h };
      switch (c.h) {
        case 'right': k.x += dw; break;
        case 'lr': k.w = Math.max(1, k.w + dw); break;
        case 'center': k.x += dw / 2; break;
        case 'scale': k.x *= sx; k.w = Math.max(1, k.w * sx); break;
      }
      switch (c.v) {
        case 'bottom': k.y += dh; break;
        case 'tb': k.h = Math.max(1, k.h + dh); break;
        case 'center': k.y += dh / 2; break;
        case 'scale': k.y *= sy; k.h = Math.max(1, k.h * sy); break;
      }
      if (old.w !== k.w || old.h !== k.h) {
        if (k.type === 'text' && k.auto === 'width' && old.w !== k.w) k.auto = 'height';
        if (scene) scene.afterResize(k, old);
        else if (k.children && !k.layout) LP.applyConstraintsKids(null, k.children, old.w, old.h, k.w, k.h);
      }
    });
  };

  /* ---------------- tree helpers on the raw document ---------------- */
  LP.walk = (n, fn, parent = null) => { fn(n, parent); (n.children || []).forEach(c => LP.walk(c, fn, n)); };
  LP.findParent = (root, id) => { let r = null; LP.walk(root, (n, p) => { if (n.id === id) r = p; }); return r; };
  LP.FORMAT_VERSION = 3;
  LP.newDoc = () => ({ format: 'lproto', version: LP.FORMAT_VERSION, id: '0', uid: LP.newId() + LP.newId(), name: 'Untitled', children: [], colorStyles: [], textStyles: [], vars: [], comments: [], modes: LP.DEFAULT_MODES(), images: {}, bg: '#e8ecf1' });

  /* ---------------- easing ---------------- */
  LP.EASE = {
    linear: t => t,
    'ease-in': t => t * t * t,
    'ease-out': t => 1 - Math.pow(1 - t, 3),
    'ease-in-out': t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    snap: t => 1 - Math.pow(1 - t, 5),
    spring: t => 1 - Math.cos(t * 4.6 * Math.PI) * Math.exp(-t * 6.5)
  };
})();
