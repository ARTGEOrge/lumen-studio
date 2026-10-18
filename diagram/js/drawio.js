'use strict';
/* Lumen Diagram — draw.io / diagrams.net (.drawio, mxGraph XML) import and export.
   Import: <mxfile> with plain or deflate-compressed <diagram> pages, bare <mxGraphModel>, and .drawio.svg
   (mxfile in the SVG's content attribute). Maps native drawio shapes, flowchart/BPMN/UML/network/floorplan
   libraries, groups, swimlanes, layers, UML class stacks, edge styles, ports, waypoints, arrows and labels.
   Export: uncompressed mxfile; shapes without a native drawio equivalent are written as exact stencil shapes,
   and every cell carries lumenShape=… so a round trip restores the original shape. */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const X = isNode ? require('./xml.js') : root.DiaXML;
  const M = isNode ? require('./model.js') : root.DiaModel;
  const S = isNode ? require('./shapes.js') : root.DiaShapes;
  const G = isNode ? require('./geom.js') : root.DiaGeom;
  const FF = isNode ? require('../vendor/fflate.js') : root.fflate;

  /* ---------- encoding helpers ---------- */
  function b64dec(s) {
    s = s.replace(/[^A-Za-z0-9+/=]/g, '');
    if (typeof atob === 'function') { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }
  function b64enc(u) {
    if (typeof btoa === 'function') { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
    return Buffer.from(u).toString('base64');
  }
  const latin1 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return s; };
  const utf8 = u => new TextDecoder().decode(u);
  // drawio's Graph.compress / decompress: base64(deflateRaw(encodeURIComponent(text)))
  function decompress(text) {
    const raw = FF.inflateSync(b64dec(text));
    const s = latin1(raw);
    try { return decodeURIComponent(s); } catch (e) { return utf8(raw); }
  }
  function compress(text) { return b64enc(FF.deflateSync(new TextEncoder().encode(encodeURIComponent(text)), { level: 9 })); }

  /* ---------- style strings ---------- */
  function parseStyle(s) {
    const o = { _base: '' };
    String(s || '').split(';').forEach((part, i) => {
      if (!part) return; const k = part.indexOf('=');
      if (k < 0) { if (!o._base) o._base = part; o['_' + part] = true; }
      else o[part.slice(0, k)] = part.slice(k + 1);
    });
    return o;
  }
  const htmlToText = h => {
    let s = String(h).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|tr|h\d)>/gi, '\n').replace(/<(div|p)[^>]*>/gi, m => '\n').replace(/<[^>]*>/g, '');
    s = X.decode(s).replace(/\u00a0/g, ' ');
    return s.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n{3,}/g, '\n\n').trim();
  };
  const textToHtml = t => X.escT(t).replace(/"/g, '&quot;').replace(/\n/g, '<br>');
  const col = v => v && v !== 'default' && v !== 'inherit' && v !== 'swimlane' ? (v === 'none' ? 'none' : /^#[0-9a-f]{3,8}$/i.test(v) || /^[a-z]+$/i.test(v) ? v : null) : null;
  const numv = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };

  /* ---------- shape name mapping (drawio → lumen) ---------- */
  const NATIVE_IN = {
    ellipse: 'ellipse', rhombus: 'diamond', triangle: 'triangle', hexagon: 'hexagon', parallelogram: 'parallelogram', trapezoid: 'trapezoid',
    cylinder: 'cylinder', cylinder2: 'cylinder', cylinder3: 'cylinder', datastore: 'bpmnStore', document: 'document', process: 'predefined', note: 'note', note2: 'note', card: 'card', cloud: 'cloud',
    step: 'chevron', offPageConnector: 'offPage', tape: 'tape', manualInput: 'manualInput', dataStorage: 'storedData', delay: 'delay', display: 'display',
    internalStorage: 'internalStorage', orEllipse: 'or', sumEllipse: 'summingJunction', cross: 'cross', singleArrow: 'arrowRight', doubleArrow: 'arrowDouble', callout: 'callout',
    cube: 'cube', umlActor: 'actor', umlLifeline: 'lifeline', umlFrame: 'fragment', module: 'component', component: 'component', folder: 'package', endState: 'final', doubleEllipse: 'bpmnIntermediate',
    star: 'star', 'mxgraph.basic.star': 'star', 'mxgraph.basic.pentagon': 'pentagon', 'mxgraph.basic.octagon2': 'octagon', 'mxgraph.basic.orthogonal_triangle': 'rightTriangle', 'mxgraph.basic.acute_triangle': 'triangle', 'mxgraph.basic.cross2': 'cross', 'mxgraph.basic.rounded_frame': 'roundRect',
    umlBoundary: 'ellipse', umlEntity: 'ellipse', umlControl: 'ellipse', umlDestroy: 'destroy', line: 'forkBar', 'mxgraph.lean_mapping.manual_info_flow_edge': 'rect',
    'mxgraph.flowchart.terminator': 'terminator', 'mxgraph.flowchart.decision': 'decision', 'mxgraph.flowchart.document': 'document', 'mxgraph.flowchart.database': 'database',
    'mxgraph.flowchart.process': 'process', 'mxgraph.flowchart.start_1': 'ellipse', 'mxgraph.flowchart.start_2': 'circle', 'mxgraph.flowchart.manual_input': 'manualInput', 'mxgraph.flowchart.predefined_process': 'predefined',
    'mxgraph.flowchart.on-page_reference': 'connector', 'mxgraph.flowchart.off-page_reference': 'offPage', 'mxgraph.flowchart.multi-document': 'multiDocument', 'mxgraph.flowchart.preparation': 'preparation',
    'mxgraph.flowchart.data': 'data', 'mxgraph.flowchart.delay': 'delay', 'mxgraph.flowchart.display': 'display', 'mxgraph.flowchart.stored_data': 'storedData', 'mxgraph.flowchart.merge_or_storage': 'merge',
    'mxgraph.flowchart.extract_or_measurement': 'extract', 'mxgraph.flowchart.summing_function': 'summingJunction', 'mxgraph.flowchart.or': 'or', 'mxgraph.flowchart.manual_operation': 'manualOperation',
    'mxgraph.flowchart.card': 'card', 'mxgraph.flowchart.paper_tape': 'tape', 'mxgraph.flowchart.annotation_1': 'annotation', 'mxgraph.flowchart.annotation_2': 'annotation', 'mxgraph.flowchart.internal_storage': 'internalStorage',
    'mxgraph.flowchart.direct_data': 'storedData', 'mxgraph.flowchart.sequential_data': 'connector', 'mxgraph.flowchart.collate': 'merge', 'mxgraph.flowchart.sort': 'diamond', 'mxgraph.flowchart.loop_limit': 'card', 'mxgraph.flowchart.transfer': 'arrowRight',
    'mxgraph.bpmn.data': 'bpmnData', 'mxgraph.bpmn.data2': 'bpmnData',
  };
  const KEYWORDS = [
    [/floorplan\.(wall|wallCorner|wallU)/i, 'wall'], [/floorplan\.doorDouble/i, 'doubleDoor'], [/floorplan\.door/i, 'door'], [/floorplan\.window/i, 'window'], [/floorplan\.stairs/i, 'stairs'],
    [/floorplan\.bed/i, 'bed'], [/floorplan\.sofa|floorplan\.couch/i, 'sofa'], [/floorplan\.table|floorplan\.desk/i, 'table'], [/floorplan\.(chair|office_chair)/i, 'chair'], [/floorplan\.toilet/i, 'toilet'],
    [/floorplan\.sink/i, 'sink'], [/floorplan\.(bathtub|shower)/i, 'bathtub'], [/floorplan\.plant/i, 'plant'], [/floorplan\.room/i, 'room'],
    [/load_?balanc/i, 'loadBalancer'], [/firewall/i, 'firewall'], [/router/i, 'router'], [/switch|hub/i, 'switch'], [/laptop|notebook/i, 'laptop'], [/printer/i, 'printer'],
    [/mobile|phone|tablet/i, 'mobile'], [/wireless|access_point|antenna|radio|wifi/i, 'wireless'], [/database|storage|nas|san\b/i, 'netDatabase'], [/server|mainframe|rack/i, 'server'],
    [/pc\b|desktop|workstation|monitor|terminal|computer/i, 'desktop'], [/cloud|internet/i, 'internet'], [/user|person|people/i, 'user'],
  ];
  function mapShape(st, w, h) {
    if (st.lumenShape && S.has(st.lumenShape)) return { shape: st.lumenShape, exact: true };
    const name = st.shape || st._base || '';
    if (name === 'mxgraph.bpmn.event' || name === 'mxgraph.bpmn.shape') {
      const outline = st.outline || '', sym = st.symbol || '';
      if (/end/.test(outline)) return { shape: 'bpmnEnd' };
      if (sym === 'timer') return { shape: 'bpmnTimer' }; if (sym === 'message') return { shape: 'bpmnMessage' };
      if (/standard|^$/.test(outline) && !/throw|catch|boundInt|eventInt/.test(outline)) return { shape: 'bpmnStart' };
      return { shape: 'bpmnIntermediate' };
    }
    if (/^mxgraph\.bpmn\.gateway/.test(name)) { const t = st.gwType || st.symbol || ''; return { shape: /exclusive|xor/.test(t) ? 'bpmnExclusive' : /parallel/.test(t) ? 'bpmnParallel' : /inclusive|or/.test(t) ? 'bpmnInclusive' : 'bpmnGateway' }; }
    if (name === 'ext' && st.rounded === '1') return { shape: 'bpmnTask' };
    if (NATIVE_IN[name]) return { shape: NATIVE_IN[name] };
    if (/^mxgraph\./.test(name)) { for (const [re, id] of KEYWORDS) if (re.test(name)) return { shape: id }; return { shape: 'rect', approx: true }; }
    if (name === 'label' || name === 'rect' || name === 'rounded' || !name) return { shape: st.rounded === '1' ? 'roundRect' : 'rect' };
    if (name === 'text' || name === 'edgeLabel') return { shape: 'text' };
    if (name === 'image') return { shape: 'image' };
    if (name === 'triangle') return { shape: 'triangle' };
    if (/^stencil\(/.test(name)) return { shape: 'rect', approx: true };
    return { shape: 'rect', approx: !S.has(name) };
  }
  const ARROW_IN = { classic: 'classic', classicThin: 'classic', block: 'block', blockThin: 'block', open: 'open', openThin: 'open', openAsync: 'open', async: 'block', diamond: 'diamond', diamondThin: 'diamond', oval: 'oval', dot: 'oval', circle: 'ovalOpen', circlePlus: 'ovalOpen', ERmany: 'erMany', ERmandOne: 'erMandOne', ERone: 'erMandOne', ERoneToMany: 'erOneMany', ERzeroToMany: 'erZeroMany', ERzeroToOne: 'erMandOne', cross: 'open', dash: 'erMandOne', baseDash: 'erMandOne', box: 'block', halfCircle: 'ovalOpen', doubleBlock: 'block', none: 'none' };
  function arrowIn(type, fill) {
    let a = ARROW_IN[type] || (type ? 'classic' : 'none');
    if (fill === '0') { if (a === 'block' || a === 'classic') a = a === 'classic' ? 'open' : 'blockOpen'; else if (a === 'diamond') a = 'diamondOpen'; else if (a === 'oval') a = 'ovalOpen'; }
    if ((type === 'block' || type === 'classic') && fill === '0') a = type === 'block' ? 'blockOpen' : 'blockOpen';
    return a;
  }
  function fontFamIn(f) { if (!f) return null; if (/times|georgia|serif(?!.*sans)|garamond|book/i.test(f)) return 'serif'; if (/courier|mono|consol/i.test(f)) return 'mono'; return null; }

  function styleIn(st, isEdge) {
    const s = {};
    const fill = col(st.fillColor), stroke = col(st.strokeColor), font = col(st.fontColor);
    if (fill) s.fill = fill; if (stroke) s.stroke = stroke; if (font) s.fontColor = font;
    if (st.gradientColor && col(st.gradientColor) && col(st.gradientColor) !== 'none') s.fill2 = col(st.gradientColor);
    if (st.strokeWidth) s.sw = numv(st.strokeWidth, 1);
    if (st.dashed === '1') s.dash = /^1 [1-4]$/.test(st.dashPattern || '') ? 'dot' : /\d+ \d+ \d+ \d+/.test(st.dashPattern || '') ? 'dashdot' : 'dash';
    if (st.opacity) s.op = Math.max(0, Math.min(1, numv(st.opacity, 100) / 100));
    if (st.shadow === '1') s.shadow = true;
    if (st.fontSize) s.fontSize = numv(st.fontSize, 12);
    const fs = parseInt(st.fontStyle || '0', 10) || 0; if (st.fontStyle != null) { s.bold = !!(fs & 1); s.italic = !!(fs & 2); s.underline = !!(fs & 4); }
    const ff = fontFamIn(st.fontFamily); if (ff) s.font = ff;
    if (!isEdge) {
      if (st.align && /^(left|center|right)$/.test(st.align)) s.align = st.align;
      if (st.verticalAlign && /^(top|middle|bottom)$/.test(st.verticalAlign)) s.valign = st.verticalAlign;
      if (st.whiteSpace !== 'wrap') s.wrap = false;
      if (st.rounded === '1') s.rounded = true;
      if (st.labelBackgroundColor && col(st.labelBackgroundColor) && col(st.labelBackgroundColor) !== 'none') s.textBg = col(st.labelBackgroundColor);
    } else {
      if (st.labelBackgroundColor) { const c = st.labelBackgroundColor === 'default' ? '#ffffff' : col(st.labelBackgroundColor); s.labelBg = c || 'none'; }
      s.rounded = st.rounded === '1';
    }
    return s;
  }

  /* ---------- import ---------- */
  function readGeometry(cellEl) {
    const g = cellEl.children.find(c => c.name === 'mxGeometry');
    const o = { x: 0, y: 0, w: 0, h: 0, rel: false, points: [], sp: null, tp: null, off: null };
    if (!g) return o;
    o.x = numv(g.attrs.x, 0); o.y = numv(g.attrs.y, 0); o.w = numv(g.attrs.width, 0); o.h = numv(g.attrs.height, 0); o.rel = g.attrs.relative === '1';
    for (const c of g.children) {
      if (c.name === 'mxPoint') { const p = { x: numv(c.attrs.x, 0), y: numv(c.attrs.y, 0) }; if (c.attrs.as === 'sourcePoint') o.sp = p; else if (c.attrs.as === 'targetPoint') o.tp = p; else if (c.attrs.as === 'offset') o.off = p; }
      else if (c.name === 'Array' && c.attrs.as === 'points') o.points = c.children.filter(p => p.name === 'mxPoint').map(p => ({ x: numv(p.attrs.x, 0), y: numv(p.attrs.y, 0) }));
    }
    return o;
  }
  function collectCells(modelEl) {
    const rootEl = modelEl.children.find(c => c.name === 'root') || modelEl;
    const out = [];
    const walk = el => {
      for (const c of el.children) {
        if (c.name === 'mxCell') out.push({ el: c, attrs: c.attrs, label: c.attrs.value });
        else if (c.name === 'UserObject' || c.name === 'object') {
          const inner = c.children.find(k => k.name === 'mxCell');
          if (inner) out.push({ el: inner, attrs: { ...inner.attrs, id: c.attrs.id || inner.attrs.id }, label: c.attrs.label ?? inner.attrs.value, tooltip: c.attrs.tooltip });
        }
      }
    };
    walk(rootEl);
    return out;
  }
  function importModel(modelEl, name, report) {
    const page = { id: M.uid('p'), name: name || 'Page', bg: '#ffffff', grid: numv(modelEl.attrs.gridSize, 10), showGrid: modelEl.attrs.grid !== '0', layers: [], cells: [] };
    const bgc = col(modelEl.attrs.background); if (bgc && bgc !== 'none') page.bg = bgc;
    const raw = collectCells(modelEl);
    const byId = new Map(raw.map(r => [r.attrs.id, r]));
    const rootIds = new Set(raw.filter(r => r.attrs.parent == null || r.attrs.parent === '').map(r => r.attrs.id));
    const layerOf = new Map();
    for (const r of raw) if (rootIds.has(r.attrs.parent)) {
      const st = parseStyle(r.attrs.style);
      const L = { id: 'L' + r.attrs.id, name: r.label ? htmlToText(r.label) : (page.layers.length ? 'Layer ' + (page.layers.length + 1) : 'Background'), visible: r.attrs.visible !== '0', locked: st.locked === '1' };
      page.layers.push(L); layerOf.set(r.attrs.id, L.id);
    }
    if (!page.layers.length) { page.layers.push({ id: M.uid('L'), name: 'Background', visible: true, locked: false }); }
    const defLayer = page.layers[0].id;
    // absolute origin of a vertex
    const absCache = new Map();
    const parsed = new Map(raw.map(r => [r.attrs.id, { st: parseStyle(r.attrs.style), g: readGeometry(r.el) }]));
    const abs = id => {
      if (absCache.has(id)) return absCache.get(id);
      const r = byId.get(id); if (!r || layerOf.has(id) || rootIds.has(id)) return { x: 0, y: 0 };
      absCache.set(id, { x: 0, y: 0 });
      const p = parsed.get(id), par = r.attrs.parent;
      const po = par && !layerOf.has(par) && !rootIds.has(par) && byId.get(par) && byId.get(par).attrs.edge !== '1' ? abs(par) : { x: 0, y: 0 };
      const v = { x: po.x + p.g.x, y: po.y + p.g.y }; absCache.set(id, v); return v;
    };
    const layerFor = id => { let k = id, guard = 0; while (k && guard++ < 100) { if (layerOf.has(k)) return layerOf.get(k); const r = byId.get(k); if (!r) break; k = r.attrs.parent; } return defLayer; };
    const idMap = new Map(), remap = new Map(), skipIds = new Set();
    const newId = old => { if (!idMap.has(old)) idMap.set(old, 'd' + String(old).replace(/[^\w-]/g, '').slice(0, 40) + '_' + M.uid('').slice(-4)); return idMap.get(old); };
    // UML class stacks: swimlane with childLayout=stackLayout
    const childrenOf = new Map(); for (const r of raw) { const p = r.attrs.parent; if (!childrenOf.has(p)) childrenOf.set(p, []); childrenOf.get(p).push(r); }
    const edgeLabels = new Map();
    for (const r of raw) {
      const a = r.attrs, id = a.id; if (rootIds.has(id) || layerOf.has(id) || skipIds.has(id)) continue;
      const { st, g } = parsed.get(id);
      const parentRaw = byId.get(a.parent);
      if (a.vertex === '1' && parentRaw && parentRaw.attrs.edge === '1') { // edge label
        if (!edgeLabels.has(a.parent)) edgeLabels.set(a.parent, []);
        edgeLabels.get(a.parent).push({ text: htmlToText(r.label || ''), g, st }); continue;
      }
      const parent = a.parent && !layerOf.has(a.parent) && !rootIds.has(a.parent) ? a.parent : null;
      if (a.vertex === '1') {
        const o = abs(id), text = st.html === '1' ? htmlToText(r.label || '') : X.decode(String(r.label || ''));
        if (st._group || (st._base === 'group')) { page.cells.push({ id: newId(id), kind: 'group', layer: layerFor(id), parent: parent ? newId(parent) : null }); continue; }
        const isClass = (st._swimlane || st.shape === 'swimlane' || st.lumenShape === 'umlClass' || st.lumenShape === 'umlInterface' || st.lumenShape === 'umlEnum') && st.childLayout === 'stackLayout';
        let shape, extra = {};
        if (isClass) {
          const kids = (childrenOf.get(id) || []).filter(k => k.attrs.vertex === '1').sort((p, q) => parsed.get(p.attrs.id).g.y - parsed.get(q.attrs.id).g.y);
          const secs = [[]];
          for (const k of kids) {
            const ks = parsed.get(k.attrs.id).st; skipIds.add(k.attrs.id); remap.set(k.attrs.id, id);
            if (ks._line || ks.shape === 'line') secs.push([]);
            else { const t = ks.html === '1' ? htmlToText(k.label || '') : X.decode(String(k.label || '')); secs[secs.length - 1].push(t); }
          }
          const body = secs.map(s => s.join('\n'));
          shape = st.lumenShape && S.has(st.lumenShape) ? st.lumenShape : 'umlClass';
          extra.text = [text, ...body].join('\n--\n');
        } else {
          const m = mapShape(st, g.w, g.h); shape = m.shape; if (m.approx) report.approximated++;
          if (st._swimlane || st.shape === 'swimlane' || st._base === 'swimlane') shape = st.lumenShape && S.has(st.lumenShape) ? st.lumenShape : st.horizontal === '0' ? 'lane' : 'swimlane';
        }
        const style = styleIn(st, false);
        if (isClass) {   // header boldness/centring is implied by the class shape; body rows decide alignment
          delete style.bold; delete style.valign; delete style.wrap;
          const row = (childrenOf.get(id) || []).map(k => parsed.get(k.attrs.id).st).find(ks => ks._text);
          style.align = row && /^(left|center|right)$/.test(row.align || '') ? row.align : 'left';
          if (row && row.fontSize) style.fontSize = numv(row.fontSize, 12);
        }
        if (S.get(shape).container) {
          if (st.startSize != null) style.header = numv(st.startSize, 30); else if (st._swimlane || st.shape === 'swimlane') style.header = 23;
          const body = col(st.swimlaneFillColor); if (body) style.bodyFill = body; else if (st._swimlane || st._base === 'swimlane') style.bodyFill = style.fill === 'none' ? 'none' : '#ffffff';
          if (st.horizontal === '0' && shape === 'swimlane') shape = 'lane';
        }
        if (st.lumenAccent && col(st.lumenAccent)) style.accent = col(st.lumenAccent);
        if (st.lumenHeader) style.header = numv(st.lumenHeader, 30);
        if (st.lumenBody && col(st.lumenBody)) style.bodyFill = col(st.lumenBody);
        let rot = numv(st.rotation, 0);
        if (shape === 'triangle' && !st.lumenShape) { const dirRot = { north: 0, east: 90, south: 180, west: 270 }; rot += dirRot[st.direction || 'east'] ?? 90; }
        const cell = { id: newId(id), kind: 'shape', shape, x: o.x, y: o.y, w: Math.max(1, g.w), h: Math.max(1, g.h), rot: ((rot % 360) + 360) % 360, flipH: st.flipH === '1', flipV: st.flipV === '1', text: extra.text != null ? extra.text : text, style, layer: layerFor(id), parent: parent ? newId(parent) : null };
        if (shape === 'image' && st.image) { const m2 = /^data:image\/(png|jpeg|jpg|gif|svg\+xml|webp)[,;](?:base64,)?([A-Za-z0-9+/=]+)$/.exec(st.image); if (m2) cell.image = `data:image/${m2[1] === 'jpg' ? 'jpeg' : m2[1]};base64,${m2[2]}`; else report.approximated++; }
        // drawio puts labels of these inside unless verticalLabelPosition says otherwise; our "below" shapes handle it
        page.cells.push(cell);
      } else if (a.edge === '1') {
        const style = styleIn(st, true);
        const es = st.edgeStyle;
        style.route = st.curved === '1' ? 'curved' : (es && es !== 'none' ? 'orthogonal' : 'straight');
        style.startArrow = arrowIn(st.startArrow || 'none', st.startFill);
        style.endArrow = arrowIn(st.endArrow == null ? 'classic' : st.endArrow, st.endFill);
        if (st.endSize || st.startSize) style.arrowSize = Math.round(numv(st.endSize || st.startSize, 6) * 1.6);
        const po = parent ? abs(parent) : { x: 0, y: 0 };
        const end = (ref, p, ex, ey) => {
          const rid = remap.get(ref) || ref, rr = rid && byId.get(rid);
          if (rr && rr.attrs.vertex === '1' && !skipIds.has(rid)) return { id: rid, port: ex != null && ey != null ? [numv(ex, 0.5), numv(ey, 0.5)] : null };
          return p ? { x: p.x + po.x, y: p.y + po.y } : { x: po.x, y: po.y };
        };
        page.cells.push({ id: newId(id), kind: 'edge', _src: end(a.source, g.sp, st.exitX, st.exitY), _tgt: end(a.target, g.tp, st.entryX, st.entryY), pts: g.points.map(p => ({ x: p.x + po.x, y: p.y + po.y })), text: st.html === '1' ? htmlToText(r.label || '') : X.decode(String(r.label || '')), labelT: Math.max(0, Math.min(1, (numv(g.x, 0) + 1) / 2)), labelDx: g.off ? g.off.x : 0, labelDy: (g.off ? g.off.y : 0) + numv(g.y, 0), style, layer: layerFor(id), parent: null, _oid: id });
      }
    }
    // resolve edge ends to new ids, attach labels
    const fixId = e => { if (!e || !e.id) return e; const nid = idMap.get(remap.get(e.id) || e.id); return nid ? { id: nid, port: e.port } : { x: 0, y: 0 }; };
    for (const c of page.cells) if (c.kind === 'edge') {
      c.src = fixId(c._src); c.tgt = fixId(c._tgt);
      const labs = edgeLabels.get(c._oid);
      if (labs && labs.length) {
        const l = labs[0];
        if (!c.text) { c.text = l.text; c.labelT = Math.max(0, Math.min(1, (l.g.x + 1) / 2)); c.labelDx = (l.g.off ? l.g.off.x : 0); c.labelDy = (l.g.off ? l.g.off.y : 0) + (l.g.y || 0); if (l.st.fontSize) c.style.fontSize = numv(l.st.fontSize, 11); }
        else c.text += '\n' + l.text;
        if (labs.length > 1) report.approximated += labs.length - 1;
      }
      delete c._src; delete c._tgt; delete c._oid;
    }
    // parents must exist
    const ids = new Set(page.cells.map(c => c.id));
    for (const c of page.cells) if (c.parent && !ids.has(c.parent)) c.parent = null;
    report.cells += page.cells.length;
    return page;
  }

  function importDrawio(text, opts = {}) {
    const report = { pages: 0, cells: 0, approximated: 0, compressed: 0 };
    let src = String(text);
    let doc = X.parse(src);
    // .drawio.svg / .drawio.png-like: mxfile in a content attribute
    const svg = X.find(doc, 'svg');
    if (svg && svg.attrs.content) doc = X.parse(svg.attrs.content);
    const mxfile = X.find(doc, 'mxfile');
    const models = [];
    if (mxfile) {
      for (const d of mxfile.children.filter(c => c.name === 'diagram')) {
        let model = d.children.find(c => c.name === 'mxGraphModel');
        if (!model && d.text.trim()) {
          const t = d.text.trim();
          const xml = t.startsWith('<') ? t : decompress(t); report.compressed++;
          model = X.find(X.parse(xml), 'mxGraphModel');
        }
        if (model) models.push([model, d.attrs.name]);
      }
    } else {
      const model = X.find(doc, 'mxGraphModel');
      if (model) models.push([model, opts.name || 'Page-1']);
    }
    if (!models.length) throw new Error('No draw.io diagram found in this file');
    const out = M.newDoc(); out.pages = [];
    models.forEach(([m, name], i) => { out.pages.push(importModel(m, name || 'Page-' + (i + 1), report)); report.pages++; });
    return { doc: M.normalize(out), report };
  }

  /* ---------- export ---------- */
  const NATIVE_OUT = {
    rect: '', roundRect: 'rounded=1;', process: '', ellipse: 'ellipse;', circle: 'ellipse;aspect=fixed;', connector: 'ellipse;aspect=fixed;', useCase: 'ellipse;',
    triangle: 'triangle;direction=north;', diamond: 'rhombus;', decision: 'rhombus;', hexagon: 'shape=hexagon;perimeter=hexagonPerimeter2;size=0.25;fixedSize=0;',
    parallelogram: 'shape=parallelogram;perimeter=parallelogramPerimeter;', data: 'shape=parallelogram;perimeter=parallelogramPerimeter;', trapezoid: 'shape=trapezoid;perimeter=trapezoidPerimeter;',
    cylinder: 'shape=cylinder3;boundedLbl=1;size=10;', database: 'shape=cylinder3;boundedLbl=1;size=10;', document: 'shape=document;boundedLbl=1;', predefined: 'shape=process;',
    note: 'shape=note;size=16;', card: 'shape=card;', cloud: 'ellipse;shape=cloud;', chevron: 'shape=step;perimeter=stepPerimeter;', offPage: 'shape=offPageConnector;', tape: 'shape=tape;',
    manualInput: 'shape=manualInput;', storedData: 'shape=dataStorage;', delay: 'shape=delay;', display: 'shape=display;', internalStorage: 'shape=internalStorage;', or: 'shape=orEllipse;perimeter=ellipsePerimeter;',
    summingJunction: 'shape=sumEllipse;perimeter=ellipsePerimeter;', cross: 'shape=cross;', arrowRight: 'shape=singleArrow;', arrowDouble: 'shape=doubleArrow;', callout: 'shape=callout;', cube: 'shape=cube;',
    terminator: 'shape=mxgraph.flowchart.terminator;', multiDocument: 'shape=mxgraph.flowchart.multi-document;', preparation: 'shape=mxgraph.flowchart.preparation;', manualOperation: 'shape=mxgraph.flowchart.manual_operation;',
    merge: 'shape=mxgraph.flowchart.merge_or_storage;', extract: 'shape=mxgraph.flowchart.extract_or_measurement;', annotation: 'shape=mxgraph.flowchart.annotation_1;',
    actor: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;', lifeline: 'shape=umlLifeline;perimeter=lifelinePerimeter;container=1;collapsible=0;size=40;', fragment: 'shape=umlFrame;width=60;height=20;',
    package: 'shape=folder;tabWidth=80;tabHeight=18;tabPosition=left;', text: 'text;', heading: 'text;', state: 'rounded=1;arcSize=25;', umlObject: '', activation: '', forkBar: '', initial: 'ellipse;', final: 'ellipse;shape=endState;',
    bpmnTask: 'rounded=1;', bpmnCall: 'rounded=1;', bpmnStart: 'ellipse;', bpmnEnd: 'ellipse;', bpmnGateway: 'rhombus;', room: '', table: 'rounded=1;', roundTable: 'ellipse;', boundary: '', star: 'shape=mxgraph.basic.star;',
  };
  const ARROW_OUT = { none: ['none', null], classic: ['classic', null], block: ['block', null], blockOpen: ['block', '0'], open: ['open', null], diamond: ['diamond', null], diamondOpen: ['diamond', '0'], oval: ['oval', null], ovalOpen: ['oval', '0'], erMany: ['ERmany', '0'], erMandOne: ['ERmandOne', '0'], erOneMany: ['ERoneToMany', '0'], erZeroMany: ['ERzeroToMany', '0'] };
  const fmt = n => G.f(n);
  // stencil XML for an exact copy of a lumen shape (outline + decorations)
  function stencilFor(c) {
    const d = S.get(c.shape), st = S.styleOf(c), w = c.w, h = c.h;
    const pathXml = dstr => {
      let s = '<path>';
      for (const seg of G.parse(dstr)) {
        const n = seg.n;
        if (seg.c === 'M') s += `<move x="${fmt(n[0])}" y="${fmt(n[1])}"/>`;
        else if (seg.c === 'L') for (let i = 0; i + 1 < n.length; i += 2) s += `<line x="${fmt(n[i])}" y="${fmt(n[i + 1])}"/>`;
        else if (seg.c === 'C') for (let i = 0; i + 5 < n.length; i += 6) s += `<curve x1="${fmt(n[i])}" y1="${fmt(n[i + 1])}" x2="${fmt(n[i + 2])}" y2="${fmt(n[i + 3])}" x3="${fmt(n[i + 4])}" y3="${fmt(n[i + 5])}"/>`;
        else if (seg.c === 'Q') for (let i = 0; i + 3 < n.length; i += 4) s += `<quad x1="${fmt(n[i])}" y1="${fmt(n[i + 1])}" x2="${fmt(n[i + 2])}" y2="${fmt(n[i + 3])}"/>`;
        else if (seg.c === 'Z') s += '<close/>';
      }
      return s + '</path>';
    };
    const ck = k => k === 'S' ? st.stroke : k === 'F' ? st.fill : k === 'W' ? '#ffffff' : k;
    let bgPart = '', fg = '';
    if (d.invisible) { fg += ''; }
    else { bgPart = pathXml(d.path(w, h, c)); fg += d.strokePath ? '<fill/>' : '<fillstroke/>'; if (d.strokePath) fg += pathXml(d.strokePath(w, h, c)) + '<stroke/>'; }
    for (const x of (d.deco ? d.deco(w, h, c) : [])) {
      const fill = x.f ? ck(x.f) : null, stroke = x.s === null ? null : ck(x.s || 'S');
      if (fill && fill !== 'none') fg += `<fillcolor color="${fill}"/>`;
      if (stroke && stroke !== 'none') fg += `<strokecolor color="${stroke}"/>`;
      if (x.sw) fg += `<strokewidth width="${fmt(x.sw)}"/>`;
      if (x.dash) fg += '<dashed dashed="1"/>';
      fg += pathXml(x.d) + (fill && fill !== 'none' && stroke && stroke !== 'none' ? '<fillstroke/>' : fill && fill !== 'none' ? '<fill/>' : '<stroke/>');
      if (x.dash) fg += '<dashed dashed="0"/>';
      if (x.sw) fg += `<strokewidth width="${fmt(st.sw)}"/>`;
    }
    return `<shape name="${c.shape}" w="${fmt(w)}" h="${fmt(h)}" aspect="variable" strokewidth="inherit"><connections/><background>${bgPart}</background><foreground>${fg}</foreground></shape>`;
  }
  function styleOut(c, st, base) {
    let s = base;
    const add = (k, v) => { if (v != null && v !== '') s += `${k}=${v};`; };
    if (c.kind === 'edge') {
      add('edgeStyle', st.route === 'straight' ? 'none' : 'orthogonalEdgeStyle'); if (st.route === 'curved') add('curved', 1);
      add('rounded', st.rounded ? 1 : 0); add('orthogonalLoop', 1); add('jettySize', 'auto'); add('html', 1);
      const [sa, sf] = ARROW_OUT[st.startArrow] || ARROW_OUT.none, [ea, ef] = ARROW_OUT[st.endArrow] || ARROW_OUT.classic;
      add('startArrow', sa); if (sf) add('startFill', sf); add('endArrow', ea); if (ef) add('endFill', ef);
      if (st.arrowSize && st.arrowSize !== 10) { add('endSize', Math.round(st.arrowSize / 1.6)); add('startSize', Math.round(st.arrowSize / 1.6)); }
      if (c.src && c.src.port) { add('exitX', fmt(c.src.port[0])); add('exitY', fmt(c.src.port[1])); add('exitDx', 0); add('exitDy', 0); }
      if (c.tgt && c.tgt.port) { add('entryX', fmt(c.tgt.port[0])); add('entryY', fmt(c.tgt.port[1])); add('entryDx', 0); add('entryDy', 0); }
      if (st.labelBg) add('labelBackgroundColor', st.labelBg);
    } else {
      add('whiteSpace', st.wrap === false ? null : 'wrap'); add('html', 1);
      add('fillColor', st.fill || 'none'); if (st.fill2) add('gradientColor', st.fill2);
      if (st.rounded && c.shape === 'rect') add('rounded', 1);
      add('align', st.align); add('verticalAlign', S.get(c.shape).label === 'below' ? 'top' : st.valign);
      if (S.get(c.shape).label === 'below' && !/verticalLabelPosition/.test(s)) add('verticalLabelPosition', 'bottom');
      if (st.shadow) add('shadow', 1);
      if (c.rot) add('rotation', fmt(c.rot)); if (c.flipH) add('flipH', 1); if (c.flipV) add('flipV', 1);
      if (st.textBg) add('labelBackgroundColor', st.textBg);
      if (st.accent) add('lumenAccent', st.accent);
    }
    add('strokeColor', st.stroke || 'none'); add('strokeWidth', fmt(st.sw ?? 1));
    if (st.dash) { add('dashed', 1); add('dashPattern', st.dash === 'dot' ? '1 2' : st.dash === 'dashdot' ? '8 3 1 3' : st.dash === 'longdash' ? '12 5' : '6 4'); }
    if (st.op != null && st.op < 1) add('opacity', Math.round(st.op * 100));
    add('fontColor', st.fontColor); add('fontSize', fmt(st.fontSize));
    add('fontStyle', (st.bold ? 1 : 0) | (st.italic ? 2 : 0) | (st.underline ? 4 : 0));
    add('fontFamily', st.font === 'serif' ? 'Times New Roman' : st.font === 'mono' ? 'Courier New' : 'Helvetica');
    return s;
  }
  function exportDrawio(doc, o = {}) {
    const mx = { name: 'mxfile', attrs: { host: 'Lumen Diagram', agent: 'Lumen Diagram 1.0', version: '24.0.0', type: 'device' }, children: [] };
    for (const page of doc.pages) {
      const byId = M.index(page);
      const cellsEl = [{ name: 'mxCell', attrs: { id: '0' }, children: [] }];
      for (const L of page.layers) cellsEl.push({ name: 'mxCell', attrs: { id: L.id, value: L.name, style: L.locked ? 'locked=1;' : null, parent: '0', visible: L.visible === false ? '0' : null }, children: [] });
      const layerIds = new Set(page.layers.map(l => l.id));
      const routesBox = new Map();
      // group boxes from children
      const boxOf = c => { if (routesBox.has(c.id)) return routesBox.get(c.id); const b = M.cellBox(page, c, byId) || { x: 0, y: 0, w: 0, h: 0 }; routesBox.set(c.id, b); return b; };
      const origin = id => { const p = id && byId.get(id); if (!p) return { x: 0, y: 0 }; const b = p.kind === 'group' ? boxOf(p) : p; return { x: b.x, y: b.y }; };
      const emitted = new Set();
      const emit = c => {
        if (emitted.has(c.id)) return; emitted.add(c.id);
        if (c.parent && byId.get(c.parent)) emit(byId.get(c.parent));
        const layer = layerIds.has(c.layer) ? c.layer : page.layers[0].id;
        const parentId = c.parent && byId.get(c.parent) && c.kind !== 'edge' ? c.parent : layer;
        const po = parentId === layer ? { x: 0, y: 0 } : origin(c.parent);
        if (c.kind === 'group') {
          const b = boxOf(c);
          cellsEl.push({ name: 'mxCell', attrs: { id: c.id, value: '', style: 'group;', vertex: '1', connectable: '0', parent: parentId }, children: [{ name: 'mxGeometry', attrs: { x: fmt(b.x - po.x), y: fmt(b.y - po.y), width: fmt(b.w), height: fmt(b.h), as: 'geometry' }, children: [] }] });
          return;
        }
        if (c.kind === 'shape') {
          const d = S.get(c.shape), st = S.styleOf(c);
          const geo = { name: 'mxGeometry', attrs: { x: fmt(c.x - po.x), y: fmt(c.y - po.y), width: fmt(c.w), height: fmt(c.h), as: 'geometry' }, children: [] };
          if (d.sections) {
            const L = require_render().classSections(c, st);
            const base = `swimlane;fontStyle=1;align=center;verticalAlign=top;childLayout=stackLayout;horizontal=1;startSize=${fmt(L.hs[0])};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;lumenShape=${c.shape};`;
            const sst = styleOut(c, { ...st, bold: false, align: 'center', valign: 'top' }, base);
            cellsEl.push({ name: 'mxCell', attrs: { id: c.id, value: textToHtml(L.parts[0]), style: sst + 'swimlaneFillColor=' + (st.fill || '#ffffff') + ';', vertex: '1', parent: parentId }, children: [geo] });
            let y = L.hs[0];
            L.parts.slice(1).forEach((p, i) => {
              if (i > 0) { cellsEl.push({ name: 'mxCell', attrs: { id: c.id + '-l' + i, value: '', style: `line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;strokeColor=${st.stroke};`, vertex: '1', parent: c.id }, children: [{ name: 'mxGeometry', attrs: { y: fmt(y), width: fmt(c.w), height: '8', as: 'geometry' }, children: [] }] }); y += 8; }
              const last = i === L.parts.length - 2, hh = last ? Math.max(L.hs[i + 1], c.h - y) : L.hs[i + 1];
              cellsEl.push({ name: 'mxCell', attrs: { id: c.id + '-s' + i, value: textToHtml(p), style: `text;strokeColor=none;fillColor=none;align=left;verticalAlign=top;spacingLeft=4;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=wrap;html=1;fontSize=${fmt(st.fontSize)};fontColor=${st.fontColor};fontFamily=${st.font === 'serif' ? 'Times New Roman' : st.font === 'mono' ? 'Courier New' : 'Helvetica'};`, vertex: '1', parent: c.id }, children: [{ name: 'mxGeometry', attrs: { y: fmt(y), width: fmt(c.w), height: fmt(hh), as: 'geometry' }, children: [] }] });
              y += hh;
            });
            return;
          }
          let base;
          if (d.container) {
            const left = d.container.side === 'left';
            base = st.header ? `swimlane;startSize=${fmt(st.header)};${left ? 'horizontal=0;' : ''}swimlaneFillColor=${st.bodyFill || '#ffffff'};` : `${NATIVE_OUT[c.shape] != null ? NATIVE_OUT[c.shape] : 'rounded=1;arcSize=4;'}container=1;collapsible=0;`;
          } else if (c.shape === 'image') {
            const m = c.image && /^data:image\/([\w+]+);base64,(.*)$/.exec(c.image);
            base = 'shape=image;imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;' + (m ? `image=data:image/${m[1]},${m[2]};` : '');
          } else if (NATIVE_OUT[c.shape] != null && !(c.shape === 'triangle' && c.rot)) base = NATIVE_OUT[c.shape];
          else base = 'shape=stencil(' + compress(stencilFor(c)) + ');';
          base += `lumenShape=${c.shape};`;
          if (d.container && st.header) base += `lumenHeader=${fmt(st.header)};`;
          if (st.bodyFill) base += `lumenBody=${st.bodyFill};`;
          cellsEl.push({ name: 'mxCell', attrs: { id: c.id, value: textToHtml(c.text || ''), style: styleOut(c, st, base), vertex: '1', parent: parentId }, children: [geo] });
          return;
        }
        if (c.kind === 'edge') {
          const st = S.styleOf(c);
          const geo = { name: 'mxGeometry', attrs: { relative: '1', as: 'geometry' }, children: [] };
          if (c.text) { const t = (c.labelT ?? 0.5) * 2 - 1; if (Math.abs(t) > 1e-6) geo.attrs.x = fmt(t); if (c.labelDx || c.labelDy) geo.children.push({ name: 'mxPoint', attrs: { x: fmt(c.labelDx || 0), y: fmt(c.labelDy || 0), as: 'offset' }, children: [] }); }
          const attrs = { id: c.id, value: textToHtml(c.text || ''), style: styleOut(c, st, ''), edge: '1', parent: layer };
          const src = c.src && c.src.id && byId.get(c.src.id), tgt = c.tgt && c.tgt.id && byId.get(c.tgt.id);
          if (src && src.kind === 'shape') attrs.source = src.id; else geo.children.push({ name: 'mxPoint', attrs: { x: fmt(c.src && c.src.x || 0), y: fmt(c.src && c.src.y || 0), as: 'sourcePoint' }, children: [] });
          if (tgt && tgt.kind === 'shape') attrs.target = tgt.id; else geo.children.push({ name: 'mxPoint', attrs: { x: fmt(c.tgt && c.tgt.x || 0), y: fmt(c.tgt && c.tgt.y || 0), as: 'targetPoint' }, children: [] });
          if (c.pts && c.pts.length) geo.children.push({ name: 'Array', attrs: { as: 'points' }, children: c.pts.map(p => ({ name: 'mxPoint', attrs: { x: fmt(p.x), y: fmt(p.y) }, children: [] })) });
          cellsEl.push({ name: 'mxCell', attrs, children: [geo] });
        }
      };
      for (const c of page.cells) emit(c);
      const b = M.pageBounds(page) || { x: 0, y: 0, w: 850, h: 1100 };
      const model = { name: 'mxGraphModel', attrs: { dx: '1000', dy: '600', grid: page.showGrid === false ? '0' : '1', gridSize: String(page.grid || 10), guides: '1', tooltips: '1', connect: '1', arrows: '1', fold: '1', page: '0', pageScale: '1', pageWidth: String(Math.max(850, Math.ceil(b.x + b.w))), pageHeight: String(Math.max(1100, Math.ceil(b.y + b.h))), background: page.bg && page.bg !== '#ffffff' ? page.bg : null, math: '0', shadow: '0' }, children: [{ name: 'root', attrs: {}, children: cellsEl }] };
      const dEl = { name: 'diagram', attrs: { id: page.id, name: page.name }, children: [model] };
      if (o.compressed) { dEl.children = []; dEl.text = compress(X.stringify(model, '', '')); }
      mx.children.push(dEl);
    }
    return X.stringify(mx) + '\n';
  }
  let RenderRef = null;
  const require_render = () => RenderRef || (RenderRef = isNode ? require('./render.js') : root.DiaRender);

  const api = { importDrawio, exportDrawio, compress, decompress, parseStyle, htmlToText, stencilFor, mapShape };
  if (isNode) module.exports = api; else root.DiaDrawio = api;
})(typeof self !== 'undefined' ? self : this);
