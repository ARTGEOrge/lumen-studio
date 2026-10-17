'use strict';
/* Lumen Proto — file I/O: .lproto save/open, SVG/PNG/JPEG import, PNG/JPG/SVG/PDF export, ZIP batch export,
   standalone interactive HTML prototype export. */
(function () {
  const LP = window.LP, ED = window.ED, A = window.ACT, M = LP.M;
  const IO = window.IO = {};
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  const ext = n => (String(n).match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  const b64 = bytes => { let s = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  IO.toDataURL = f => `data:${MIME[ext(f.name)] || f.type || 'image/png'};base64,${b64(f.data)}`;
  const safeName = s => String(s || 'export').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';

  /* ---------------- project files ---------------- */
  function usedImages(doc) {
    const ids = new Set();
    const scan = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(scan); if (o.type === 'image' && o.img) ids.add(o.img); for (const k in o) if (k !== 'images') scan(o[k]); };
    scan(doc);
    const out = {}; ids.forEach(id => { if (doc.images[id]) out[id] = doc.images[id]; });
    return out;
  }
  IO.serialize = () => JSON.stringify(Object.assign({}, ED.doc, { images: usedImages(ED.doc), format: 'lproto', version: LP.FORMAT_VERSION }), (k, v) => k[0] === '_' ? undefined : v);
  IO.save = async (as) => {
    const name = safeName(ED.doc.name || 'Untitled') + '.lproto';
    const p = await Aero.saveFile({ name, data: IO.serialize(), filters: [{ name: 'Lumen Proto', extensions: ['lproto'] }], path: as ? null : ED.filePath });
    if (!p) return false;
    if (Aero.isDesktop) ED.filePath = p;
    Aero.setDoc(Aero.baseName(p), false); Aero.toast('Saved ' + Aero.baseName(p) + '.lproto');
    return true;
  };
  // validate/sanitize an untrusted .lproto document
  IO.parseDoc = (text) => {
    const d = JSON.parse(text);
    if (!d || typeof d !== 'object' || d.format !== 'lproto' || !Array.isArray(d.children)) throw new Error('Not a Lumen Proto file');
    const doc = Object.assign(LP.newDoc(), { name: String(d.name || 'Untitled').slice(0, 200), bg: typeof d.bg === 'string' ? d.bg : '#e8ecf1' });
    doc.children = d.children;
    const num = (v, def, lo = -1e6, hi = 1e6) => { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; };
    doc.colorStyles = (Array.isArray(d.colorStyles) ? d.colorStyles : []).filter(s => s && typeof s.id === 'string').map(s => { const o = { id: s.id, name: String(s.name || 'Color').slice(0, 100), color: LP.toHex(String(s.color || '#000')), a: num(s.a, 1, 0, 1) }; if (plain(s.dark) && s.dark.color != null) o.modes = { dark: { color: LP.toHex(String(s.dark.color)), a: num(s.dark.a, 1, 0, 1) } }; if (plain(s.modes)) { o.modes = o.modes || {}; for (const k in s.modes) { const v = s.modes[k]; if (/^[\w-]{1,40}$/.test(k) && plain(v) && v.color != null) o.modes[k] = { color: LP.toHex(String(v.color)), a: num(v.a, 1, 0, 1) }; } } if (s.lib) o.lib = String(s.lib).slice(0, 100); return o; });
    if (typeof d.uid === 'string' && /^[\w-]{4,64}$/.test(d.uid)) doc.uid = d.uid;
    doc.version = LP.FORMAT_VERSION;
    doc.vars = IO.cleanVars(d.vars);
    doc.modes = IO.cleanModes(d.modes);
    doc.colorStyles.forEach(cs => { if (cs.modes) for (const k in cs.modes) if (!doc.modes.some(m => m.id === k)) delete cs.modes[k]; });
    doc.comments = IO.cleanComments(d.comments);
    doc.effectStyles = LP.cleanEffectStyles(d.effectStyles);
    if (d.guides != null) { const g = LP.cleanGuides(d.guides); if (g.length) doc.guides = g; }
    doc.textStyles = (Array.isArray(d.textStyles) ? d.textStyles : []).filter(s => s && typeof s.id === 'string').map(s => ({ id: s.id, name: String(s.name || 'Text').slice(0, 100), font: String(s.font || 'Inter').replace(/["\;{}<>]/g, '').slice(0, 60), size: num(s.size, 16, 1, 1000), weight: num(s.weight, 400, 100, 900), italic: !!s.italic, lh: num(s.lh, 0, 0, 2000), ls: num(s.ls, 0, -100, 100), ...(s.lib ? { lib: String(s.lib).slice(0, 100) } : {}) }));
    doc.images = {};
    for (const k in (d.images || {})) { const v = d.images[k]; if (typeof v === 'string' && /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v)) doc.images[k] = v; }
    // structural sanity: unique string ids, numeric geometry
    const seen = new Set();
    const fix = n => {
      if (!n || typeof n !== 'object') return false;
      if (typeof n.id !== 'string' || seen.has(n.id) || n.id.includes('/')) n.id = LP.newId(); seen.add(n.id);
      ['x', 'y', 'w', 'h', 'r', 'opacity'].forEach(k => { if (typeof n[k] !== 'number' || !isFinite(n[k])) n[k] = k === 'opacity' ? 1 : k === 'w' || k === 'h' ? 100 : 0; });
      if (!['frame', 'group', 'rect', 'ellipse', 'path', 'text', 'icon', 'instance', 'bool'].includes(n.type)) return false;
      if (n.type === 'path' && n.d != null && (typeof n.d !== 'string' || !PATH_RE.test(n.d))) n.d = '';
      if (n.bd != null && (typeof n.bd !== 'string' || !PATH_RE.test(n.bd))) n.bd = '';
      sanitizeNode(n);
      if (n.children) { if (!Array.isArray(n.children)) n.children = []; n.children = n.children.filter(fix); }
      return true;
    };
    doc.children = doc.children.filter(fix);
    LP.syncEffectStyles(doc);
    return doc;
  };
  // coerce every field of an untrusted node into the shape the app expects
  const PATH_RE = /^[\sMmLlHhVvCcSsQqTtAaZz0-9.,eE+-]*$/;
  const STR_KEYS = ['name', 'text', 'font', 'icon', 'componentId', 'blend', 'align', 'valign', 'auto', 'deco', 'tcase', 'sizeH', 'sizeV', 'flowStart', 'color', 'rule', 'textStyleId', 'op', 'scroll', 'cmode', 'bindText', 'maskType'];
  const ARR_KEYS = ['fills', 'strokes', 'shadows', 'pts', 'proto', 'exports', 'grids', 'radius', 'runs', 'cont'];
  const ENUMS = { op: ['union', 'subtract', 'intersect', 'exclude'], scroll: ['v', 'h', 'both'] };
  const str = v => typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : null;
  const plain = o => o && typeof o === 'object' && !Array.isArray(o);
  const cleanObj = o => { if (!plain(o)) return null; const r = {}; for (const k in o) { const v = o[k]; if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; if (typeof v === 'number') r[k] = isFinite(v) ? v : 0; else if (typeof v === 'boolean' || v === null) r[k] = v; else if (typeof v === 'string') r[k] = v; else if (Array.isArray(v)) r[k] = v.map(x => typeof x === 'object' ? cleanObj(x) : (typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') ? x : null).filter(x => x !== null); else if (plain(v)) r[k] = cleanObj(v); } return r; };
  function sanitizeNode(n) {
    STR_KEYS.forEach(k => { if (n[k] != null) { const v = str(n[k]); if (v == null) delete n[k]; else n[k] = v; } });
    ARR_KEYS.forEach(k => { if (n[k] != null) n[k] = Array.isArray(n[k]) ? n[k].map(x => k === 'radius' ? (Number(x) || 0) : cleanObj(x)).filter(x => x !== null) : []; });
    ['cons', 'layout', 'blur', 'component', 'showIf'].forEach(k => { if (n[k] != null) n[k] = cleanObj(n[k]); });
    for (const k in ENUMS) if (n[k] != null && !ENUMS[k].includes(n[k])) delete n[k];
    if (n.mask != null) n.mask = !!n.mask;
    if (n.cmode != null && !/^[\w-]{1,40}$/.test(n.cmode)) delete n.cmode;
    if (n.guides != null) { const g = LP.cleanGuides(n.guides); if (g.length && n.type === 'frame') n.guides = g; else delete n.guides; }
    if (n.fxStyle != null && (typeof n.fxStyle !== 'string' || !/^[\w-]{1,64}$/.test(n.fxStyle))) delete n.fxStyle;
    if (n.blur != null) { n.blur = LP.cleanBlur(n.blur); if (!n.blur) delete n.blur; }
    Object.values(n.overrides || {}).forEach(o => { if (o && typeof o === 'object' && o.fxStyle != null && (typeof o.fxStyle !== 'string' || !/^[\w-]{1,64}$/.test(o.fxStyle))) delete o.fxStyle; });
    if (n.maskType != null &&!['alpha', 'luminance', 'vector'].includes(n.maskType)) delete n.maskType;
    ['minW', 'maxW', 'minH', 'maxH', 'viewportW'].forEach(k => { if (n[k] != null) { const v = Number(n[k]); if (isFinite(v) && v > 0) n[k] = Math.min(1e5, v); else delete n[k]; } });
    if (n.runs) n.runs = IO.cleanRuns(n.runs);
    if (!n.runs) delete n.runs;
    if (n.cont) n.cont = n.cont.filter(c => c && Array.isArray(c.pts)).map(c => ({ pts: c.pts.filter(q => q && typeof q === 'object').map(q => { const o = {}; ['x', 'y', 'ox', 'oy', 'ix', 'iy'].forEach(k => { if (q[k] != null && isFinite(Number(q[k]))) o[k] = Number(q[k]); }); o.x = o.x || 0; o.y = o.y || 0; return o; }), closed: !!c.closed }));
    if (n.overrides != null) { const o = {}; if (plain(n.overrides)) for (const k in n.overrides) { const v = cleanObj(n.overrides[k]); if (v && k !== '__proto__') o[k] = v; } n.overrides = o; }
    if (n.type === 'text') { n.text = n.text ?? ''; n.size = Number(n.size) || 16; n.weight = Number(n.weight) || 400; n.lh = Number(n.lh) || 0; n.ls = Number(n.ls) || 0; if (n.font != null) n.font = n.font.replace(/["\;{}<>]/g, '').slice(0, 60); }
    const cc = p => { if (p && p.color != null) p.color = str(p.color) || '#000000'; (p?.stops || []).forEach(cc); };
    ['fills', 'strokes', 'shadows'].forEach(k => (n[k] || []).forEach(cc));
    Object.values(n.overrides || {}).forEach(o => ['fills', 'strokes', 'shadows'].forEach(k => { if (o[k] != null && !Array.isArray(o[k])) delete o[k]; (o[k] || []).forEach(cc); }));
    Object.values(n.overrides || {}).forEach(o => { if (o.runs != null) { o.runs = Array.isArray(o.runs) ? IO.cleanRuns(o.runs) : null; if (!o.runs) delete o.runs; } });
    ['bw', 'bh', 'viewportH', 'sw'].forEach(k => { if (n[k] != null && !isFinite(Number(n[k]))) delete n[k]; else if (n[k] != null) n[k] = Number(n[k]); });
  }
  const RUN_ENUM = { deco: ['none', 'underline', 'strike'] };
  // mixed-style text runs from a file: only known keys with the right types
  IO.cleanRuns = runs => {
    if (!Array.isArray(runs)) return null;
    const out = runs.filter(r => r && typeof r === 'object').slice(0, 5000).map(r => {
      const o = { n: Math.max(0, Math.min(1e7, Math.floor(Number(r.n) || 0))) };
      if (typeof r.font === 'string') o.font = r.font.replace(/["\\;{}<>]/g, '').slice(0, 60);
      ['size', 'weight', 'ls', 'lh', 'a'].forEach(k => { if (r[k] != null && isFinite(Number(r[k]))) o[k] = Number(r[k]); });
      if (o.size != null) o.size = Math.max(1, Math.min(1000, o.size)); if (o.weight != null) o.weight = Math.max(100, Math.min(900, o.weight)); if (o.a != null) o.a = Math.max(0, Math.min(1, o.a));
      if (r.italic != null) o.italic = !!r.italic;
      if (r.deco != null && RUN_ENUM.deco.includes(r.deco)) o.deco = r.deco;
      if (typeof r.color === 'string') o.color = LP.toHex(r.color);
      ['cs', 'ts'].forEach(k => { if (typeof r[k] === 'string') o[k] = r[k].slice(0, 80); });
      return o;
    }).filter(r => r.n > 0);
    return out.length ? out : null;
  };
  IO.cleanModes = ms => { const out = []; (Array.isArray(ms) ? ms : []).forEach(m => { if (m && typeof m.id === 'string' && /^[\w-]{1,40}$/.test(m.id) && !out.some(x => x.id === m.id)) out.push({ id: m.id, name: String(m.name || m.id).slice(0, 60) }); }); return out.length ? out.slice(0, 32) : LP.DEFAULT_MODES(); };
  IO.cleanVars = vars => (Array.isArray(vars) ? vars : []).filter(v => v && typeof v.id === 'string' && ['bool', 'num', 'str'].includes(v.type)).slice(0, 500)
    .map(v => ({ id: v.id.slice(0, 64), name: String(v.name || 'variable').slice(0, 80), type: v.type, value: LP.coerceVar(v.type, typeof v.value === 'object' ? '' : v.value) }));
  IO.cleanComments = cs => (Array.isArray(cs) ? cs : []).filter(c => c && typeof c === 'object').slice(0, 5000).map(c => ({
    id: typeof c.id === 'string' ? c.id.slice(0, 64) : LP.newId(), ab: typeof c.ab === 'string' ? c.ab.slice(0, 64) : null,
    x: Number(c.x) || 0, y: Number(c.y) || 0, author: String(c.author || 'Anonymous').slice(0, 80), text: String(c.text || '').slice(0, 5000),
    ts: Number(c.ts) || 0, resolved: !!c.resolved,
    replies: (Array.isArray(c.replies) ? c.replies : []).filter(r => r && typeof r === 'object').slice(0, 500).map(r => ({ author: String(r.author || 'Anonymous').slice(0, 80), text: String(r.text || '').slice(0, 5000), ts: Number(r.ts) || 0 }))
  }));
  IO.loadText = (text, name, path) => {
    const doc = IO.parseDoc(text);
    if (name) doc.name = Aero.baseName(name);
    ED.filePath = path || null;
    ED.setDoc(doc, doc.name);
    LP.imagesReady(doc).then(() => ED.redraw());
    setTimeout(() => ED.zoomFit(), 0);
  };
  IO.open = async () => {
    const files = await Aero.openFile({ accept: '.lproto,.lplib,.json,.svg,.png,.jpg,.jpeg,.gif,.webp', filters: [{ name: 'Lumen Proto, libraries & images', extensions: ['lproto', 'lplib', 'svg', 'png', 'jpg', 'jpeg'] }] });
    if (files[0]) IO.handleFiles(files);
  };
  IO.handleFiles = async (files, at) => {
    for (const f of files) {
      const e = ext(f.name);
      try {
        if (e === 'lplib') { IO.importLibrary(new TextDecoder().decode(f.data), f.name); continue; }
        if (e === 'json') { const t = new TextDecoder().decode(f.data); if (/"format"\s*:\s*"lproto-comments"/.test(t.slice(0, 200))) { IO.importReviewComments(t); continue; } }
        if (e === 'lproto' || e === 'json') { if (Aero.dirty && !(await Aero.confirm('Open file', 'Discard unsaved changes to the current document?'))) return; IO.loadText(new TextDecoder().decode(f.data), f.name, f.path); }
        else if (e === 'svg') IO.importSVG(new TextDecoder().decode(f.data), f.name, at);
        else if (MIME[e]) await IO.importImage(f, at);
        else Aero.toast('Unsupported file: ' + f.name);
      } catch (err) { console.warn(err); Aero.alert('Could not open file', `${f.name}: ${err.message}`); }
    }
  };
  IO.importImage = (f, at) => new Promise((res, rej) => {
    const url = IO.toDataURL(f); const im = new Image();
    im.onload = () => { A.addImage(url, im.naturalWidth, im.naturalHeight, at, Aero.baseName(f.name)); res(); };
    im.onerror = () => rej(new Error('Not a valid image')); im.src = url;
  });

  /* ---------------- SVG import ---------------- */
  const cnv = document.createElement('canvas').getContext('2d');
  const normColor = c => { if (!c || c === 'none' || c === 'transparent') return null; cnv.fillStyle = '#000'; cnv.fillStyle = c; return cnv.fillStyle; };
  function parseTransform(s) {
    let m = M.id(); if (!s) return m;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let r;
    while ((r = re.exec(s))) {
      const a = r[2].split(/[\s,]+/).filter(Boolean).map(parseFloat); let t;
      switch (r[1]) {
        case 'matrix': t = a.slice(0, 6); break;
        case 'translate': t = M.tr(a[0] || 0, a[1] || 0); break;
        case 'scale': t = [a[0], 0, 0, a[1] ?? a[0], 0, 0]; break;
        case 'rotate': { const rr = M.rot((a[0] || 0) * Math.PI / 180); t = a.length > 2 ? M.mul(M.tr(a[1], a[2]), M.mul(rr, M.tr(-a[1], -a[2]))) : rr; break; }
        case 'skewX': t = [1, 0, Math.tan(a[0] * Math.PI / 180), 1, 0, 0]; break;
        case 'skewY': t = [1, Math.tan(a[0] * Math.PI / 180), 0, 1, 0, 0]; break;
      }
      m = M.mul(m, t);
    }
    return m;
  }
  const parsePath = LP.parsePath, segsToD = LP.segsToD, segsTransform = LP.segsTransform;
  IO.parsePath = parsePath;
  IO.transformD = (d, m) => LP.transformD(d, m);
  function segBounds(segs) { const xs = [], ys = []; segs.forEach(s => s.p && s.p.forEach((v, i) => (i % 2 ? ys : xs).push(v))); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }

  IO.importSVG = (text, name, at) => {
    const g = IO.svgToNodes(text, name);
    if (!g) { Aero.alert('SVG import', 'No drawable content found.'); return; }
    const r = ED.stage.getBoundingClientRect(); const c = at || ED.s2w(r.width / 2, r.height / 2);
    const par = ED.frameAt(c.x, c.y, new Set()) || ED.doc;
    ED.childArr(par).push(g); ED.update(); ED.placeCenter(g, par, c.x, c.y);
    ED.sel = [g.id]; ED.commit('Import SVG');
  };
  IO.svgToNodes = (text, name) => {
    const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = xml.documentElement; if (!svg || svg.nodeName.toLowerCase() !== 'svg' || xml.querySelector('parsererror')) throw new Error('Invalid SVG');
    const defs = {}; svg.querySelectorAll('[id]').forEach(e => defs[e.getAttribute('id')] = e);
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
    let root = M.id();
    const W = parseFloat(svg.getAttribute('width')), H = parseFloat(svg.getAttribute('height'));
    if (vb.length === 4 && vb.every(isFinite)) { const sx = W ? W / vb[2] : 1, sy = H ? H / vb[3] : sx; root = M.mul([sx, 0, 0, sy, 0, 0], M.tr(-vb[0], -vb[1])); }
    const style = (el, inh) => {
      const st = Object.assign({}, inh);
      ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'display', 'visibility'].forEach(k => { const v = el.getAttribute(k); if (v != null) st[k] = v; });
      (el.getAttribute('style') || '').split(';').forEach(d => { const [k, v] = d.split(':').map(s => s && s.trim()); if (k && v) st[k] = v; });
      if (el.getAttribute('opacity') == null && !(el.getAttribute('style') || '').includes('opacity')) st.opacity = undefined; else st.opacity = st.opacity;
      return st;
    };
    const paint = (val, op) => {
      if (!val || val === 'none') return null;
      const m = String(val).match(/url\(#([^)]+)\)/);
      if (m) {
        const g = defs[m[1]]; if (!g) return null;
        const stops = [...g.querySelectorAll('stop')].map(s => { const ss = style(s, {}); const c = normColor(ss['stop-color'] || s.getAttribute('stop-color') || '#000'); return { p: Math.max(0, Math.min(1, parseFloat(s.getAttribute('offset')) / (String(s.getAttribute('offset')).includes('%') ? 100 : 1) || 0)), color: LP.toHex(c), a: parseFloat(ss['stop-opacity'] ?? s.getAttribute('stop-opacity') ?? 1) * LP.parseColor(c)[3] }; });
        if (g.nodeName === 'radialGradient') return { type: 'radial', stops, a: op, on: true };
        const x1 = parseFloat(g.getAttribute('x1') || 0), y1 = parseFloat(g.getAttribute('y1') || 0), x2 = parseFloat(g.getAttribute('x2') ?? 1), y2 = parseFloat(g.getAttribute('y2') || 0);
        return { type: 'linear', angle: Math.round(Math.atan2(x2 - x1, -(y2 - y1)) * 180 / Math.PI), stops, a: op, on: true };
      }
      const c = normColor(val); if (!c) return null;
      return { type: 'solid', color: LP.toHex(c), a: +(LP.parseColor(c)[3] * op).toFixed(3), on: true };
    };
    const nodes = [];
    const walk = (el, m, inh, out) => {
      const tag = el.nodeName.toLowerCase();
      if (['defs', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'pattern', 'symbol', 'style', 'script', 'title', 'desc', 'metadata', 'foreignobject'].includes(tag)) return;
      const st = style(el, Object.assign({}, inh, { opacity: undefined }));
      if (st.display === 'none' || st.visibility === 'hidden') return;
      const mm = M.mul(m, parseTransform(el.getAttribute('transform')));
      const op = parseFloat(st.opacity ?? 1);
      if (tag === 'g' || tag === 'svg' && el !== svg || tag === 'a') {
        const kids = []; [...el.children].forEach(c => walk(c, mm, st, kids));
        if (!kids.length) return;
        if (kids.length === 1 && op === 1) { out.push(kids[0]); return; }
        const g = LP.node('group', { name: el.getAttribute('id') || 'Group', children: kids, opacity: op });
        normalizeGroup(g); out.push(g); return;
      }
      if (tag === 'use') { const ref = (el.getAttribute('href') || el.getAttribute('xlink:href') || '').slice(1); const t = defs[ref]; if (t && !t.contains(el)) walk(t, M.mul(mm, M.tr(parseFloat(el.getAttribute('x') || 0), parseFloat(el.getAttribute('y') || 0))), st, out); return; }
      if (tag === 'text') {
        const fs = parseFloat(st['font-size']) || 16, sc = M.scale(mm);
        const txt = el.textContent.replace(/\s+/g, ' ').trim(); if (!txt) return;
        const fx = parseFloat(el.getAttribute('x') || el.querySelector('tspan')?.getAttribute('x') || 0), fy = parseFloat(el.getAttribute('y') || el.querySelector('tspan')?.getAttribute('y') || 0);
        const p = M.ap(mm, fx, fy);
        const f = paint(st.fill ?? '#000', parseFloat(st['fill-opacity'] ?? 1));
        const fam = (st['font-family'] || 'Inter').split(',')[0].replace(/['"]/g, '').trim();
        const n = LP.node('text', { name: txt.slice(0, 30), text: txt, size: Math.round(fs * sc * 100) / 100, font: LP.FONTS.includes(fam) ? fam : 'Inter', weight: st['font-weight'] === 'bold' ? 700 : parseInt(st['font-weight']) || 400, x: p.x, y: p.y - fs * sc * .93, fills: f ? [f] : [], opacity: op });
        out.push(n); return;
      }
      if (tag === 'image') {
        const href = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
        if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(href)) return;
        const x = parseFloat(el.getAttribute('x') || 0), y = parseFloat(el.getAttribute('y') || 0), w = parseFloat(el.getAttribute('width') || 0), h = parseFloat(el.getAttribute('height') || 0);
        const id = LP.newId(); ED.doc.images[id] = href;
        const p = M.ap(mm, x, y), sc = M.scale(mm);
        out.push(LP.node('rect', { name: 'Image', x: p.x, y: p.y, w: w * sc, h: h * sc, fills: [{ type: 'image', img: id, mode: 'fill', a: 1, on: true }], opacity: op })); return;
      }
      let segs = null;
      const g = k => parseFloat(el.getAttribute(k) || 0);
      if (tag === 'path') segs = parsePath(el.getAttribute('d') || '');
      else if (tag === 'rect') {
        const x = g('x'), y = g('y'), w = g('width'), h = g('height'); let rx = el.hasAttribute('rx') ? g('rx') : g('ry'); rx = Math.min(rx, w / 2, h / 2);
        if (!rx && Math.abs(mm[1]) < 1e-9 && Math.abs(mm[2]) < 1e-9) { // axis aligned → real rectangle
          const p = M.ap(mm, x, y), q = M.ap(mm, x + w, y + h);
          const n = LP.node('rect', { name: el.getAttribute('id') || 'Rectangle', x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y), opacity: op });
          applyPaint(n, st); out.push(n); return;
        }
        const k = .5523;
        segs = rx ? parsePath(`M${x + rx} ${y}H${x + w - rx}C${x + w - rx + rx * k} ${y} ${x + w} ${y + rx - rx * k} ${x + w} ${y + rx}V${y + h - rx}C${x + w} ${y + h - rx + rx * k} ${x + w - rx + rx * k} ${y + h} ${x + w - rx} ${y + h}H${x + rx}C${x + rx - rx * k} ${y + h} ${x} ${y + h - rx + rx * k} ${x} ${y + h - rx}V${y + rx}C${x} ${y + rx - rx * k} ${x + rx - rx * k} ${y} ${x + rx} ${y}Z`) : parsePath(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
      }
      else if (tag === 'circle' || tag === 'ellipse') {
        const cx = g('cx'), cy = g('cy'), rx = tag === 'circle' ? g('r') : g('rx'), ry = tag === 'circle' ? g('r') : g('ry');
        if (Math.abs(mm[1]) < 1e-9 && Math.abs(mm[2]) < 1e-9) { const p = M.ap(mm, cx - rx, cy - ry), q = M.ap(mm, cx + rx, cy + ry); const n = LP.node('ellipse', { name: el.getAttribute('id') || 'Ellipse', x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y), opacity: op }); applyPaint(n, st); out.push(n); return; }
        segs = parsePath(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`);
      }
      else if (tag === 'line') segs = parsePath(`M${g('x1')} ${g('y1')}L${g('x2')} ${g('y2')}`);
      else if (tag === 'polyline' || tag === 'polygon') { const pts = (el.getAttribute('points') || '').trim(); if (pts) segs = parsePath('M' + pts + (tag === 'polygon' ? 'Z' : '')); }
      if (!segs || !segs.length) return;
      segs = segsTransform(segs, mm);
      const b = segBounds(segs); if (!isFinite(b.x)) return;
      const n = LP.node('path', { name: el.getAttribute('id') || (tag === 'path' ? 'Path' : tag[0].toUpperCase() + tag.slice(1)), x: b.x, y: b.y, w: Math.max(b.w, .01), h: Math.max(b.h, .01), bw: Math.max(b.w, .01), bh: Math.max(b.h, .01), d: segsToD(segs, b.x, b.y), closed: segs.some(s => s.c === 'Z'), pts: [], rule: st['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero', opacity: op });
      applyPaint(n, st, M.scale(mm));
      out.push(n);
    };
    const applyPaint = (n, st, sc = 1) => {
      const f = paint(st.fill === undefined ? '#000' : st.fill, parseFloat(st['fill-opacity'] ?? 1));
      n.fills = f ? [f] : [];
      const s = paint(st.stroke, parseFloat(st['stroke-opacity'] ?? 1));
      n.strokes = s && s.type === 'solid' ? [{ color: s.color, a: s.a, w: (parseFloat(st['stroke-width'] ?? 1) || 1) * sc, align: 'center', on: true, cap: st['stroke-linecap'] || 'butt', join: st['stroke-linejoin'] || 'miter' }] : [];
    };
    const normalizeGroup = g => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      g.children.forEach(k => { x0 = Math.min(x0, k.x); y0 = Math.min(y0, k.y); x1 = Math.max(x1, k.x + k.w); y1 = Math.max(y1, k.y + k.h); });
      g.children.forEach(k => { k.x -= x0; k.y -= y0; });
      Object.assign(g, { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) });
    };
    const top = []; [...svg.children].forEach(c => walk(c, root, {}, top));
    if (!top.length) return null;
    if (top.length === 1 && top[0].type === 'group') { top[0].name = Aero.baseName(name || 'SVG'); return top[0]; }
    const g = LP.node('group', { name: Aero.baseName(name || 'SVG'), children: top });
    normalizeGroup(g);
    return g;
  };

  /* ---------------- SVG export ---------------- */
  const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  IO.toSVG = (node) => {
    const scene = ED.scene, defs = []; let uid = 0;
    const id = p => p + (++uid);
    const b = LP.aabb(node);
    const rrPath = (w, h, r, g = 0) => { const x = -g, y = -g, W = w + 2 * g, H = h + 2 * g; const rr = LP.clampR(r.map(q => q > 0 ? q + g : 0), W, H); const [a, bb, c, d] = rr; return `M${x + a} ${y}H${x + W - bb}${bb ? `A${bb} ${bb} 0 0 1 ${x + W} ${y + bb}` : ''}V${y + H - c}${c ? `A${c} ${c} 0 0 1 ${x + W - c} ${y + H}` : ''}H${x + d}${d ? `A${d} ${d} 0 0 1 ${x} ${y + H - d}` : ''}V${y + a}${a ? `A${a} ${a} 0 0 1 ${x + a} ${y}` : ''}Z`; };
    const ptsD = (v, w, h) => {
      if (v.d) { const sx = v.bw ? w / v.bw : 1, sy = v.bh ? h / v.bh : 1; return segsToD(segsTransform(parsePath(v.d), [sx, 0, 0, sy, 0, 0]), 0, 0); }
      return LP.contoursD(LP.contoursOf(v), v.bw ? w / v.bw : 1, v.bh ? h / v.bh : 1);
    };
    const shapeD = (v, w, h, grow = 0) => { const t = v.mainType || v.type; if (t === 'ellipse') return `M${-grow} ${h / 2}A${w / 2 + grow} ${h / 2 + grow} 0 1 0 ${w + grow} ${h / 2}A${w / 2 + grow} ${h / 2 + grow} 0 1 0 ${-grow} ${h / 2}Z`; if (t === 'path') return ptsD(v, w, h); if (t === 'bool') return v.bd || ''; if (t === 'group') return ''; return rrPath(w, h, v.radius || [0, 0, 0, 0], grow); };
    const paintAttr = (f, w, h) => {
      if (f.type === 'solid') { const c = LP.fillColor(f, ED.doc); const p = LP.parseColor(c.color); return `fill="${LP.toHex(c.color)}"${c.a * p[3] < 1 ? ` fill-opacity="${+(c.a * p[3]).toFixed(3)}"` : ''}`; }
      const gid = id('g');
      const stops = (f.stops || []).slice().sort((a, c) => a.p - c.p).map(s => `<stop offset="${s.p}" stop-color="${LP.toHex(s.color)}"${(s.a ?? 1) * (f.a ?? 1) < 1 ? ` stop-opacity="${+((s.a ?? 1) * (f.a ?? 1)).toFixed(3)}"` : ''}/>`).join('');
      if (f.type === 'linear') { const g = LP.gradPoints(f.angle, w, h); defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${g[0]}" y1="${g[1]}" x2="${g[2]}" y2="${g[3]}">${stops}</linearGradient>`); }
      else defs.push(`<radialGradient id="${gid}" cx="${f.cx ?? .5}" cy="${f.cy ?? .5}" r=".5" gradientTransform="translate(${f.cx ?? .5} ${f.cy ?? .5}) scale(1.414) translate(${-(f.cx ?? .5)} ${-(f.cy ?? .5)})">${stops}</radialGradient>`);
      return `fill="url(#${gid})"`;
    };
    ED.doc._mode = LP.modeOf(scene, node);
    const xf = n => `translate(${+(n.x - (n === node ? b.x : 0)).toFixed(3)} ${+(n.y - (n === node ? b.y : 0)).toFixed(3)})${n.r ? ` rotate(${n.r} ${n.w / 2} ${n.h / 2})` : ''}`;
    // children in order; a mask sibling clips everything above it
    const emitKids = kids => {
      let out = '', open = 0;
      kids.forEach(k => {
        if (k.mask) {
          if (!scene.isVis(k)) return;
          const kv = scene.view(k), kt = kv.mainType || k.type, cid = id('m');
          const kind = LP.maskKind(scene, k);
          if (kind !== 'vector') { // alpha / luminance mask: the mask layer is rendered inside <mask>
            defs.push(`<mask id="${cid}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" style="mask-type:${kind}">${emit(k)}</mask>`);
            out += `<g mask="url(#${cid})">`; open++; return;
          }
          const md =kt === 'group' ? scene.kids(k).map(c => `<path transform="${xf(c)}" d="${shapeD(scene.view(c), c.w, c.h)}"/>`).join('') : `<path d="${shapeD(kv, k.w, k.h)}"${kv.rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/>`;
          defs.push(`<clipPath id="${cid}"><g transform="${xf(k)}">${md}</g></clipPath>`);
          out += `<g clip-path="url(#${cid})">`; open++; return;
        }
        out += emit(k);
      });
      return out + '</g>'.repeat(open);
    };
    const emit = (n) => {
      const v = scene.view(n); if (!scene.isVis(n)) return '';
      const t = v.mainType || n.type, w = n.w, h = n.h;
      const tr = xf(n);
      const attrs = [`transform="${tr}"`];
      if ((v.opacity ?? 1) < 1) attrs.push(`opacity="${v.opacity}"`);
      if (v.blend && v.blend !== 'normal') attrs.push(`style="mix-blend-mode:${v.blend}"`);
      // filters (drop shadows + layer blur)
      const drops = (v.shadows || []).filter(s => s.on !== false && !s.inner);
      const lb = v.blur && v.blur.on !== false && v.blur.type === 'layer' && v.blur.r > 0;
      if (drops.length || lb) {
        const fid = id('f'); let fx = '', merge = '';
        drops.forEach((s, i) => { fx += `<feGaussianBlur in="SourceAlpha" stdDeviation="${(s.blur || 0) / 2}"/><feOffset dx="${s.x}" dy="${s.y}" result="o${i}"/><feFlood flood-color="${LP.toHex(s.color)}" flood-opacity="${s.a}"/><feComposite in2="o${i}" operator="in" result="s${i}"/>`; merge += `<feMergeNode in="s${i}"/>`; });
        if (drops.length) fx += `<feMerge>${merge}<feMergeNode in="SourceGraphic"/></feMerge>`;
        if (lb) fx += `<feGaussianBlur stdDeviation="${v.blur.r}"/>`;
        defs.push(`<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${fx}</filter>`);
        attrs.push(`filter="url(#${fid})"`);
      }
      let body = '';
      const nm = ` data-name="${xmlEsc(n.name)}"`;
      if (t === 'text') {
        const T = LP.textProps(v, ED.doc);
        const ctx = document.createElement('canvas').getContext('2d');
        const L = LP.textLines(ctx, scene, n);
        const f = (v.fills || []).find(x => x.on !== false);
        const fa = f ? paintAttr(f, w, h) : 'fill="#000"';
        if (L.rich) {
          const deco = d => d === 'underline' ? ' text-decoration="underline"' : d === 'strike' ? ' text-decoration="line-through"' : '';
          body = `<text ${fa} xml:space="preserve">${L.lines.map(l => { let x = l.x; return l.pieces.map(p => { const st = p.st, cx = x; x += p.w; return `<tspan x="${+cx.toFixed(2)}" y="${+l.y.toFixed(2)}" font-family="${xmlEsc(st.font)}, sans-serif" font-size="${st.size}" font-weight="${st.weight}"${st.italic ? ' font-style="italic"' : ''}${st.ls ? ` letter-spacing="${st.ls}"` : ''}${deco(st.deco)}${st.color ? ` fill="${LP.toHex(st.color)}"${(st.a ?? 1) < 1 ? ` fill-opacity="${st.a}"` : ''}` : ''}>${xmlEsc(p.t)}</tspan>`; }).join(''); }).join('')}</text>`;
        } else body = `<text font-family="${xmlEsc(T.font)}, sans-serif" font-size="${T.size}" font-weight="${T.weight}"${T.italic ? ' font-style="italic"' : ''}${T.ls ? ` letter-spacing="${T.ls}"` : ''}${v.deco === 'underline' ? ' text-decoration="underline"' : v.deco === 'strike' ? ' text-decoration="line-through"' : ''} ${fa} xml:space="preserve">${L.lines.map(l => `<tspan x="${+l.x.toFixed(2)}" y="${+l.y.toFixed(2)}">${xmlEsc(LP.caseText(l.t, v.tcase))}</tspan>`).join('')}</text>`;
      } else if (t === 'icon') {
        body = `<path transform="scale(${w / 24} ${h / 24})" d="${(window.LP_ICONS[v.icon] || '')}" fill="none" stroke="${LP.toHex(v.color || '#000')}" stroke-width="${v.sw || 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
      } else {
        const d = shapeD(v, w, h);
        if (t !== 'group') (v.fills || []).filter(f => f.on !== false).forEach(f => {
          if (f.type === 'image') {
            const src = ED.doc.images[f.img]; if (!src) return;
            const cid = id('c'); defs.push(`<clipPath id="${cid}"><path d="${d}"/></clipPath>`);
            body += `<image href="${src}" width="${w}" height="${h}" preserveAspectRatio="${f.mode === 'fit' ? 'xMidYMid meet' : 'xMidYMid slice'}" clip-path="url(#${cid})"${(f.a ?? 1) < 1 ? ` opacity="${f.a}"` : ''}/>`;
          } else body += `<path d="${d}" ${paintAttr(f, w, h)}${v.rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}/>`;
        });
        const kids = t === 'bool' ? [] : scene.kids(n);
        if (kids.length) {
          let inner = emitKids(kids);
          if (v.clip && t !== 'group') { const cid = id('c'); defs.push(`<clipPath id="${cid}"><path d="${d}"/></clipPath>`); inner = `<g clip-path="url(#${cid})">${inner}</g>`; }
          body += inner;
        }
        if (t !== 'group') (v.strokes || []).filter(s => s.on !== false && s.w > 0).forEach(s => {
          const c = LP.fillColor(s, ED.doc), open = t === 'path' && (v.d ? !v.closed : !LP.contoursOf(v).every(q => q.closed));
          const al = open || t === 'path' || t === 'bool' ? 'center' : s.align || 'inside';
          const g = al === 'inside' ? -s.w / 2 : al === 'outside' ? s.w / 2 : 0;
          body += `<path d="${g ? shapeD(v, w, h, g) : d}" fill="none" stroke="${LP.toHex(c.color)}"${c.a < 1 ? ` stroke-opacity="${c.a}"` : ''} stroke-width="${s.w}"${s.dash ? ` stroke-dasharray="${s.dash.join(' ')}"` : ''}${s.cap ? ` stroke-linecap="${s.cap}"` : ''}${s.join ? ` stroke-linejoin="${s.join}"` : ''}/>`;
        });
      }
      return `<g${nm} ${attrs.join(' ')}>${body}</g>`;
    };
    const content = emit(node);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${+b.w.toFixed(2)}" height="${+b.h.toFixed(2)}" viewBox="0 0 ${+b.w.toFixed(2)} ${+b.h.toFixed(2)}">\n<defs>${defs.join('')}</defs>\n${content}\n</svg>\n`;
  };

  /* ---------------- raster / PDF ---------------- */
  const canvasBlob = (c, type = 'image/png', q = .92) => new Promise(r => c.toBlob(b => r(b), type, q));
  IO.renderNode = (n, scale = 1, bg) => LP.renderNodeCanvas(ED.scene, n, scale, { bg });
  IO.pngBytes = async (n, scale = 1) => new Uint8Array(await (await canvasBlob(IO.renderNode(n, scale))).arrayBuffer());
  IO.pdfBytes = (nodes, scale = 2) => {
    const enc = new TextEncoder(); const parts = []; const offs = []; let len = 0;
    const push = b => { if (typeof b === 'string') b = enc.encode(b); parts.push(b); len += b.length; };
    const obj = (i, body) => { offs[i] = len; push(`${i} 0 obj\n`); body.forEach(push); push('\nendobj\n'); };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const pageIds = nodes.map((_, i) => 3 + i * 3);
    obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    obj(2, [`<< /Type /Pages /Kids [${pageIds.map(i => i + ' 0 R').join(' ')}] /Count ${nodes.length} >>`]);
    nodes.forEach((n, i) => {
      const c = IO.renderNode(n, scale, '#ffffff'); const W = c.width, H = c.height;
      const px = c.getContext('2d').getImageData(0, 0, W, H).data;
      const rgb = new Uint8Array(W * H * 3); for (let j = 0, k = 0; j < px.length; j += 4) { rgb[k++] = px[j]; rgb[k++] = px[j + 1]; rgb[k++] = px[j + 2]; }
      const z = window.fflate.zlibSync(rgb, { level: 6 });
      const pw = +(W / scale * .75).toFixed(2), ph = +(H / scale * .75).toFixed(2);
      const pid = pageIds[i];
      obj(pid, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${pid + 2} 0 R >> >> /Contents ${pid + 1} 0 R >>`]);
      const cs = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
      obj(pid + 1, [`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`]);
      obj(pid + 2, [`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, z, '\nendstream']);
    });
    const n = 3 + nodes.length * 3;
    const xref = len;
    let x = `xref\n0 ${n}\n0000000000 65535 f \n`; for (let i = 1; i < n; i++) x += String(offs[i] || 0).padStart(10, '0') + ' 00000 n \n';
    push(x); push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out;
  };
  async function fileFor(n, e) {
    const base = safeName(n.name) + (e.scale !== 1 ? `@${e.scale}x` : '');
    if (e.fmt === 'svg') return { name: safeName(n.name) + '.svg', data: new TextEncoder().encode(IO.toSVG(n)) };
    if (e.fmt === 'pdf') return { name: safeName(n.name) + '.pdf', data: await IO.pdfBytes([n], Math.max(1, e.scale)) };
    if (e.fmt === 'jpg') return { name: base + '.jpg', data: new Uint8Array(await (await canvasBlob(IO.renderNode(n, e.scale, '#ffffff'), 'image/jpeg', .92)).arrayBuffer()) };
    return { name: base + '.png', data: await IO.pngBytes(n, e.scale) };
  }
  IO.fileFor = fileFor;
  async function deliver(files, zipName) {
    if (!files.length) return;
    if (files.length === 1) { await Aero.saveFile({ name: files[0].name, data: files[0].data }); return; }
    const seen = {}; const entries = {};
    files.forEach(f => { let nm = f.name; while (entries[nm]) { seen[f.name] = (seen[f.name] || 1) + 1; nm = f.name.replace(/(\.[^.]+)$/, ` (${seen[f.name]})$1`); } entries[nm] = f.data; });
    const zip = window.fflate.zipSync(entries, { level: 0 });
    await Aero.saveFile({ name: zipName, data: zip, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
  }
  IO.exportNodes = async (ns) => {
    ns = ns.filter(Boolean); if (!ns.length) { Aero.toast('Select layers to export'); return; }
    Aero.busy('Exporting…');
    try {
      const files = [];
      for (const n of ns) for (const e of (n.exports?.length ? n.exports : [{ scale: 1, fmt: 'png' }])) files.push(await fileFor(n, e));
      Aero.busy(); await deliver(files, safeName(ED.doc.name) + ' assets.zip');
    } finally { Aero.busy(); }
  };
  IO.batchExport = async () => {
    const marked = Object.values(ED.scene.byId).filter(n => n !== ED.doc && n.exports?.length && !ED.isClone(n));
    if (!marked.length) { Aero.alert('Batch export', 'No layers are marked for export. Select a layer and click + in the Export section.'); return; }
    Aero.busy('Exporting ' + marked.length + ' layers…');
    try { const files = []; for (const n of marked) for (const e of n.exports) files.push(await fileFor(n, e)); Aero.busy(); const entries = {}; files.forEach(f => { let nm = f.name, i = 2; while (entries[nm]) nm = f.name.replace(/(\.[^.]+)$/, ` (${i++})$1`); entries[nm] = f.data; }); await Aero.saveFile({ name: safeName(ED.doc.name) + ' assets.zip', data: window.fflate.zipSync(entries, { level: 0 }) }); Aero.toast(`Exported ${files.length} files`); }
    finally { Aero.busy(); }
  };
  IO.exportArtboards = async (fmt, scale = 1) => {
    let ns = [...new Set(ED.selNodes().map(n => ED.scene.top(n)).filter(n => n && n.type === 'frame'))];
    if (!ns.length) ns = LP.artboards(ED.doc);
    if (!ns.length) { Aero.toast('Nothing to export'); return; }
    if (fmt === 'pdf') { Aero.busy('Building PDF…'); try { const b = await IO.pdfBytes(ns, Math.max(1, scale)); Aero.busy(); await Aero.saveFile({ name: safeName(ED.doc.name) + '.pdf', data: b, filters: [{ name: 'PDF', extensions: ['pdf'] }] }); } finally { Aero.busy(); } return; }
    Aero.busy('Exporting…');
    try { const files = []; for (const n of ns) files.push(await fileFor(n, { scale, fmt })); Aero.busy(); await deliver(files, safeName(ED.doc.name) + ` ${fmt.toUpperCase()}.zip`); } finally { Aero.busy(); }
  };


  /* ---------------- design system libraries (.lplib): share styles + components between files ---------------- */
  IO.libraryData = () => {
    const comps = Object.values(ED.scene.byId).filter(n => n.component && !ED.isClone(n));
    const lib = { format: 'lproto-lib', version: 2, name: ED.doc.name || 'Library', uid: ED.doc.uid, modes: LP.modesOf(ED.doc), colorStyles: ED.doc.colorStyles, textStyles: ED.doc.textStyles, effectStyles: ED.doc.effectStyles || [], components: comps, images: {} };
    lib.images = usedImages(Object.assign({}, lib, { images: ED.doc.images }));
    return JSON.stringify(lib, (k, v) => k[0] === '_' ? undefined : v);
  };
  IO.exportLibrary = async () => {
    const comps = Object.values(ED.scene.byId).filter(n => n.component && !ED.isClone(n));
    if (!comps.length && !ED.doc.colorStyles.length && !ED.doc.textStyles.length && !(ED.doc.effectStyles || []).length) { Aero.alert('Export library', 'This document has no components or styles to publish.'); return; }
    await Aero.saveFile({ name: safeName(ED.doc.name) + '.lplib', data: IO.libraryData(), filters: [{ name: 'Lumen Proto library', extensions: ['lplib'] }] });
    Aero.toast(`Library exported: ${comps.length} components, ${ED.doc.colorStyles.length} colors, ${ED.doc.textStyles.length} text styles, ${(ED.doc.effectStyles || []).length} effect styles`);
  };
  IO.importLibraryFile = async () => {
    const f = await Aero.openFile({ accept: '.lplib,.lproto', filters: [{ name: 'Lumen Proto library or file', extensions: ['lplib', 'lproto'] }] });
    if (f[0]) IO.importLibrary(new TextDecoder().decode(f[0].data), f[0].name);
  };
  // merge a library (or another .lproto's components and styles) into the open document; same ids update in place
  IO.importLibrary = (text, fname) => {
    const raw = JSON.parse(text);
    if (!raw || (raw.format !== 'lproto-lib' && raw.format !== 'lproto')) throw new Error('Not a Lumen Proto library');
    let comps = raw.format === 'lproto-lib' ? raw.components : [];
    if (raw.format === 'lproto') { const all = []; const walk = n => { if (!n || typeof n !== 'object') return; if (n.component) { all.push(n); return; } (Array.isArray(n.children) ? n.children : []).forEach(walk); }; (raw.children || []).forEach(walk); comps = all; }
    const clean = IO.parseDoc(JSON.stringify({ format: 'lproto', name: raw.name, children: Array.isArray(comps) ? comps : [], colorStyles: raw.colorStyles, textStyles: raw.textStyles, effectStyles: raw.effectStyles, images: raw.images, modes: raw.modes || (raw.colorStyles || []).some(s => s && s.dark) ? raw.modes : null }));
    ED.doc.modes = LP.modesOf(ED.doc).slice(); clean.modes.forEach(m => { if (!ED.doc.modes.some(x => x.id === m.id)) ED.doc.modes.push(m); });
    const libName = String(raw.name || Aero.baseName(fname || 'Library')).slice(0, 100);
    let nc = 0, uc = 0, ns = 0, us = 0;
    clean.colorStyles.forEach(s => { s.lib = libName; const e = ED.doc.colorStyles.find(x => x.id === s.id); if (e) { Object.assign(e, s); us++; } else { ED.doc.colorStyles.push(s); ns++; } });
    clean.textStyles.forEach(s => { s.lib = libName; const e = ED.doc.textStyles.find(x => x.id === s.id); if (e) { Object.assign(e, s); us++; } else { ED.doc.textStyles.push(s); ns++; } });
    ED.doc.effectStyles = ED.doc.effectStyles || []; let nf = 0, uf = 0; clean.effectStyles.forEach(s => { s.lib = libName; const e = ED.doc.effectStyles.find(x => x.id === s.id); if (e) { Object.assign(e, s); uf++; } else { ED.doc.effectStyles.push(s); nf++; } });
    Object.assign(ED.doc.images, clean.images);
    // components: ids that clash with non-component layers get fresh ids (references remapped)
    const remap = {};
    const exists = id => ED.scene.byId[id];
    clean.children.forEach(c => { LP.walk(c, n => { const e = exists(n.id); if (e && !(n === c && e.component)) { const nid = LP.newId(); remap[n.id] = nid; } }); });
    clean.children.forEach(c => LP.walk(c, n => { if (remap[n.id] && !(n === c && exists(c.id)?.component)) n.id = remap[n.id]; if (n.componentId && remap[n.componentId]) n.componentId = remap[n.componentId]; (n.proto || []).forEach(p => { if (remap[p.target]) p.target = remap[p.target]; }); }));
    const placed = [];
    let y0 = ED.doc.children.length ? Math.max(...ED.doc.children.map(k => k.y + k.h)) + 200 : 0, x = ED.doc.children.length ? Math.min(...ED.doc.children.map(k => k.x)) : 0;
    clean.children.forEach(c => {
      c.component = Object.assign({}, c.component, { lib: libName });
      const e = exists(c.id);
      if (e && e.component) { const par = ED.parent(e), arr = ED.childArr(par); c.x = e.x; c.y = e.y; arr.splice(arr.indexOf(e), 1, c); uc++; }
      else { c.x = x; c.y = y0; x += c.w + 48; ED.doc.children.push(c); placed.push(c); nc++; }
    });
    LP.syncEffectStyles(ED.doc);
    ED.commit('Import library ' + libName);
    LP.imagesReady(ED.doc).then(() => ED.redraw());
    window.PANELS?.renderAssets?.();
    Aero.toast(`Library "${libName}": ${nc} new / ${uc} updated components, ${ns} new / ${us} updated styles${nf + uf ? `, ${nf} new / ${uf} updated effect styles` : ""}`);
    return { nc, uc, ns, us, nf, uf, placed };
  };

  /* ---------------- review comments from the HTML viewer ---------------- */
  // merge a viewer's exported comments file: new comments (deduped by id), replies (deduped), resolved state
  IO.importReviewComments = text => {
    const raw = JSON.parse(text);
    if (!raw || raw.format !== 'lproto-comments') throw new Error('Not a Lumen Proto comments file');
    const list = ED.doc.comments = ED.doc.comments || [];
    let added = 0, replies = 0, states = 0;
    const rkey = r => r.author + '|' + r.ts + '|' + r.text;
    IO.cleanComments(raw.added).forEach(c => {
      const e = list.find(x => x.id === c.id);
      if (!e) { list.push(c); added++; return; }
      c.replies.forEach(r => { if (!e.replies.some(q => rkey(q) === rkey(r))) { e.replies.push(r); replies++; } });
    });
    if (raw.replies && typeof raw.replies === 'object' && !Array.isArray(raw.replies)) for (const id in raw.replies) {
      const e = list.find(x => x.id === id); if (!e) continue;
      IO.cleanComments([{ id, replies: raw.replies[id] }])[0].replies.forEach(r => { if (!e.replies.some(q => rkey(q) === rkey(r))) { e.replies.push(r); replies++; } });
      e.replies.sort((a, b) => a.ts - b.ts);
    }
    if (raw.state && typeof raw.state === 'object' && !Array.isArray(raw.state)) for (const id in raw.state) { const e = list.find(x => x.id === id); if (e && e.resolved !== !!raw.state[id]) { e.resolved = !!raw.state[id]; states++; } }
    ED.commit('Import review comments');
    window.COMMENTS?.renderList?.();
    Aero.toast(`Review comments: ${added} new, ${replies} replies, ${states} status changes`);
    return { added, replies, states };
  };
  IO.importReviewFile = async () => { const f = await Aero.openFile({ accept: '.json', filters: [{ name: 'Comments (JSON)', extensions: ['json'] }] }); if (f[0]) try { IO.importReviewComments(new TextDecoder().decode(f[0].data)); } catch (e) { Aero.alert('Import comments', e.message); } };

  /* ---------------- standalone HTML prototype ---------------- */
  IO.buildHTML = async (startId) => {
    const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error('Missing ' + u); return r; };
    const srcs = await Promise.all(['js/icons.js', 'js/core.js', 'js/render.js', 'js/player.js', 'js/review.js'].map(async u => (await get(u)).text()));
    const font = b64(await (await get('vendor/inter.woff2')).arrayBuffer());
    const data = IO.serialize().replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const title = xmlEsc(ED.doc.name || 'Prototype');
    const safeJs = s => s.replace(/<\/script/gi, '<\\/script');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — prototype</title>
<style>
@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2")}
html,body{margin:0;height:100%;background:#1b1f26;overflow:hidden;font:13px "Inter","Segoe UI",system-ui,sans-serif;color:#dfe6ee}
#stage{position:absolute;inset:0 0 40px 0}
#bar{position:absolute;left:0;right:0;bottom:0;height:40px;display:flex;align-items:center;gap:10px;padding:0 14px;background:#12151a;border-top:1px solid #2a313b}
#bar b{font-weight:600;color:#fff}#bar .sp{flex:1}#bar span{opacity:.75}
#bar button,#bar select{background:#262d37;color:#e6edf5;border:1px solid #3a4452;border-radius:6px;padding:4px 10px;font:inherit;cursor:pointer}
#bar button:hover{background:#303946}
#bar button.on{background:#7b3fe4;border-color:#9a6cf0}
#bar label{display:flex;align-items:center;gap:4px;opacity:.85}
</style></head><body>
<div id="stage"></div>
<div id="bar"><b>${title}</b><span id="where"></span><span class="sp"></span><select id="flows" title="Flow"></select><label title="Show resolved comments"><input type="checkbox" id="showres">resolved</label><button id="cmt" title="Add a comment: click this, then click on the screen (stored in this browser)">💬 Comment</button><button id="cexp" title="Save the comments you added as a file to send to the designer (File › Import review comments in Lumen Proto)">⇩ Comments</button><button id="restart" title="Restart (R)">⟲ Restart</button><span>Made with Lumen Proto</span></div>
<script type="application/json" id="doc">${data}</script>
<script>${safeJs(srcs[0])}</script>
<script>${safeJs(srcs[1])}</script>
<script>${safeJs(srcs[2])}</script>
<script>${safeJs(srcs[3])}</script>
<script>${safeJs(srcs[4])}</script>
<script>
(function(){
  var doc = JSON.parse(document.getElementById('doc').textContent);
  var where = document.getElementById('where'), flows = document.getElementById('flows');
  var starts = LP.flowStarts(doc);
  if (starts.length < 2) flows.style.display = 'none';
  starts.forEach(function(f){ var o = document.createElement('option'); o.value = f.id; o.textContent = f.flowStart; flows.appendChild(o); });
  var player, review, cmt = document.getElementById('cmt'), showres = document.getElementById('showres');
  function start(id){ if (player) { player.destroy(); document.querySelectorAll('.lpr-layer').forEach(function(e){ e.remove(); }); } player = window.prototypePlayer = new LP.Player(document.getElementById('stage'), doc, { start: id, onNavigate: function(i){ var n = player.scene.get(i); where.textContent = n ? '· ' + n.name : ''; } }); var n = player.cur; where.textContent = n ? '· ' + n.name : ''; review = window.prototypeReview = LPReview.attach(player, doc, document.getElementById('stage'), cmt); review.setShowResolved(showres.checked); player.canvas.focus(); }
  showres.onchange = function(){ review && review.setShowResolved(showres.checked); };
  document.getElementById('cexp').onclick = function(){ review && review.download(); };
  var first = ${JSON.stringify(startId || '')} || (starts[0] && starts[0].id) || null;
  if (first) flows.value = first;
  flows.onchange = function(){ start(flows.value); };
  document.getElementById('restart').onclick = function(){ player.restart(); player.canvas.focus(); };
  (document.fonts && document.fonts.load ? document.fonts.load('16px "Inter"') : Promise.resolve()).then(function(){ return LP.imagesReady(doc); }).then(function(){ start(first); }, function(){ start(first); });
})();
</script>
</body></html>`;
  };
  IO.exportHTML = async () => {
    if (!LP.artboards(ED.doc).length) { Aero.toast('Add an artboard first'); return; }
    Aero.busy('Building interactive HTML…');
    try { const html = await IO.buildHTML(); Aero.busy(); await Aero.saveFile({ name: safeName(ED.doc.name) + ' prototype.html', data: html, filters: [{ name: 'HTML', extensions: ['html'] }] }); Aero.toast('Exported a self-contained, offline HTML prototype'); }
    catch (e) { Aero.busy(); Aero.alert('Export failed', e.message); }
  };
})();
