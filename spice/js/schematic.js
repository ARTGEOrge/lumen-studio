// Lumen Spice schematic model: connectivity (wires, junctions, labels, ground), SPICE netlist generation,
// netlist → schematic conversion and Lumen PCB (.lpcb) schematic import. No DOM — runs in Node for tests.
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const PL = isNode ? require('./parts.js') : root.SpiceParts;
  const NL = isNode ? require('./netlist.js') : root.SpiceNetlist;
  const Ex = isNode ? require('./expr.js') : root.SpiceExpr;
  const Models = isNode ? require('./models.js') : root.SpiceModels;

  const key = (x, y) => Math.round(x * 100) + ',' + Math.round(y * 100);
  const onSeg = (px, py, w) => {
    const { x1, y1, x2, y2 } = w, cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
    if (Math.abs(cross) > 1e-6) return false;
    return px >= Math.min(x1, x2) - 1e-6 && px <= Math.max(x1, x2) + 1e-6 && py >= Math.min(y1, y2) - 1e-6 && py <= Math.max(y1, y2) + 1e-6;
  };
  class DSU { constructor() { this.p = new Map(); } find(a) { if (!this.p.has(a)) this.p.set(a, a); let r = a; while (this.p.get(r) !== r) r = this.p.get(r); while (this.p.get(a) !== r) { const n = this.p.get(a); this.p.set(a, r); a = n; } return r; } union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); } }
  const cleanName = s => String(s).trim().replace(/[\s(),={}'";]+/g, '_').slice(0, 60);

  function normalize(doc) {
    doc = doc && typeof doc === 'object' ? doc : {};
    const num = (v, d = 0) => Number.isFinite(+v) ? +v : d;
    const str = (v, d = '') => typeof v === 'string' ? v : v == null ? d : String(v);
    doc.parts = (Array.isArray(doc.parts) ? doc.parts : []).filter(p => p && PL.PART[p.type]).slice(0, 5000).map(p => ({
      type: p.type, ref: str(p.ref).slice(0, 40), x: Math.round(num(p.x)), y: Math.round(num(p.y)), rot: ((Math.round(num(p.rot)) % 4) + 4) % 4, mirror: !!p.mirror,
      value: str(p.value, PL.PART[p.type].value).slice(0, 2000), extra: str(p.extra).slice(0, 500),
      ...(p.type === 'SUBX' ? { pinCount: Math.max(1, Math.min(40, Math.round(num(p.pinCount, 2)))), pinNames: Array.isArray(p.pinNames) ? p.pinNames.slice(0, 40).map(s => str(s).slice(0, 20)) : [] } : {}),
    }));
    doc.wires = (Array.isArray(doc.wires) ? doc.wires : []).filter(w => w && typeof w === 'object').slice(0, 20000).map(w => ({ x1: Math.round(num(w.x1)), y1: Math.round(num(w.y1)), x2: Math.round(num(w.x2)), y2: Math.round(num(w.y2)) })).filter(w => w.x1 !== w.x2 || w.y1 !== w.y2);
    doc.labels = (Array.isArray(doc.labels) ? doc.labels : []).filter(l => l && typeof l.name === 'string' && l.name.trim()).slice(0, 5000).map(l => ({ x: Math.round(num(l.x)), y: Math.round(num(l.y)), name: cleanName(l.name) }));
    doc.sim = str(doc.sim, '.tran 10m').slice(0, 500);
    doc.directives = str(doc.directives).slice(0, 200000);
    doc.traces = (Array.isArray(doc.traces) ? doc.traces : []).filter(t => typeof t === 'string').slice(0, 40).map(t => t.slice(0, 200));
    doc.title = str(doc.title).slice(0, 200);
    doc.netlist = typeof doc.netlist === 'string' ? doc.netlist.slice(0, 2e6) : null;
    return doc;
  }

  // ---------- connectivity ----------
  function connectivity(doc) {
    const dsu = new DSU(), names = new Map(), pins = [];
    const wires = doc.wires || [];
    wires.forEach(w => dsu.union(key(w.x1, w.y1), key(w.x2, w.y2)));
    const attach = (x, y, id) => { dsu.union(id, key(x, y)); wires.forEach(w => { if (onSeg(x, y, w)) dsu.union(key(x, y), key(w.x1, w.y1)); }); };
    wires.forEach(w => { attach(w.x1, w.y1, key(w.x1, w.y1)); attach(w.x2, w.y2, key(w.x2, w.y2)); });
    const probes = [];
    (doc.parts || []).forEach((p, pi) => {
      PL.pinsOf(p).forEach(q => {
        const id = 'pin:' + pi + ':' + q.n; attach(q.x, q.y, id);
        if (p.type === 'GND') { dsu.union(id, 'name:0'); names.set('name:0', '0'); }
        else if (p.type === 'PROBE') probes.push(id);
        else pins.push({ id, pi, n: q.n, name: q.name, x: q.x, y: q.y });
      });
    });
    (doc.labels || []).forEach(l => { const r = 'name:' + l.name; attach(l.x, l.y, r); names.set(r, l.name); });
    // net names: ground wins, then labels (alphabetical), then N001… in part order
    const nameOf = new Map(), conflicts = [];
    names.forEach((n, id) => { const r = dsu.find(id); const cur = nameOf.get(r); if (cur === undefined) nameOf.set(r, n); else if (cur !== n) { conflicts.push([cur, n]); if (n === '0' || (cur !== '0' && n < cur)) nameOf.set(r, n); } });
    const pinNet = new Map(), count = new Map(); let k = 1;
    const used = new Set([...nameOf.values()].map(s => s.toLowerCase()));
    pins.forEach(p => { const r = dsu.find(p.id); count.set(r, (count.get(r) || 0) + 1); });
    pins.forEach(p => {
      const r = dsu.find(p.id);
      if (!nameOf.has(r)) { let nm; do { nm = 'N' + String(k++).padStart(3, '0'); } while (used.has(nm.toLowerCase())); nameOf.set(r, nm); }
      pinNet.set(p.pi + ':' + p.n, nameOf.get(r));
    });
    const probeNets = probes.map(id => nameOf.get(dsu.find(id))).filter(Boolean);
    const single = pins.filter(p => count.get(dsu.find(p.id)) === 1 && !names.has(dsu.find(p.id)) && ![...names.keys()].some(n => dsu.find(n) === dsu.find(p.id)));
    // net at a point (for probing / hover)
    const netAt = (x, y) => { const r = dsu.find(key(x, y)); return nameOf.get(r) || null; };
    const netOfWire = w => nameOf.get(dsu.find(key(w.x1, w.y1))) || null;
    const netOfLabel = l => nameOf.get(dsu.find('name:' + l.name)) || null;
    return { pinNet, probeNets, unconnected: single, conflicts, netAt, netOfWire, netOfLabel, dsu };
  }

  // junction dots: points where 3+ wire ends / pins meet, or a wire end lands on another wire's middle
  function junctions(doc) {
    const deg = new Map(), add = (x, y, n = 1) => { const k = key(x, y); deg.set(k, (deg.get(k) || 0) + n); return k; };
    const pts = new Map();
    doc.wires.forEach(w => { pts.set(add(w.x1, w.y1), [w.x1, w.y1]); pts.set(add(w.x2, w.y2), [w.x2, w.y2]); });
    doc.parts.forEach(p => PL.pinsOf(p).forEach(q => { const k = key(q.x, q.y); if (deg.has(k)) deg.set(k, deg.get(k) + 1); }));
    const out = [];
    pts.forEach(([x, y], k) => {
      let d = deg.get(k);
      doc.wires.forEach(w => { if (onSeg(x, y, w) && !(w.x1 === x && w.y1 === y) && !(w.x2 === x && w.y2 === y)) d += 2; });
      if (d >= 3) out.push([x, y]);
    });
    return out;
  }

  // ---------- netlist ----------
  function spiceName(p) {
    const pre = { OPAMP: 'X', SW: 'R_' }[p.type] || '';
    const want = { R: 'R', C: 'C', L: 'L', D: 'D', DZ: 'D', LED: 'D', V: 'V', I: 'I', NPN: 'Q', PNP: 'Q', NMOS: 'M', PMOS: 'M', VSW: 'S', E: 'E', G: 'G', F: 'F', H: 'H', SUBX: 'X' }[p.type];
    let r = cleanName(p.ref || '?');
    if (want && r[0].toUpperCase() !== want) r = want + r;
    return pre + r;
  }
  // signal name the engine reports for a part's current (click-to-plot)
  function currentProbe(p) {
    const n = spiceName(p);
    if (p.type === 'NPN' || p.type === 'PNP') return 'Ic(' + n + ')';
    if (p.type === 'NMOS' || p.type === 'PMOS') return 'Id(' + n + ')';
    if (p.type === 'GND' || p.type === 'PROBE' || p.type === 'SUBX') return null;
    return 'I(' + n + ')';
  }
  function definedModels(text) {
    const set = new Set(); String(text || '').split(/\r?\n/).forEach(l => { const m = /^\s*\.model\s+(\S+)/i.exec(l); if (m) set.add(m[1].toLowerCase()); }); return set;
  }
  function definedSubckts(text) {
    const map = new Map(); String(text || '').split(/\r?\n/).forEach(l => { const m = /^\s*\.subckt\s+(\S+)(.*)$/i.exec(l); if (m) { const pins = m[2].replace(/params:.*$/i, '').trim().split(/\s+/).filter(s => s && !s.includes('=')); map.set(m[1].toLowerCase(), pins); } }); return map;
  }

  function toSpice(doc, opts = {}) {
    const con = connectivity(doc), lines = [], warnings = [];
    const title = (doc.title || 'Lumen Spice schematic').replace(/[\r\n]+/g, ' ');
    lines.push('* ' + title);
    const usedModels = new Set(); let opamp = false;
    const dmodels = definedModels(doc.directives);
    const seen = new Map();
    doc.parts.forEach((p, pi) => {
      const def = PL.defOf(p); if (!def || def.power) return;
      const nm = spiceName(p), lk = nm.toLowerCase();
      if (seen.has(lk)) warnings.push(`Duplicate reference ${p.ref} — rename one of them`); seen.set(lk, pi);
      const net = n => con.pinNet.get(pi + ':' + n) || '0';
      const N = def.pins.map(q => net(q.n));
      const extra = p.extra ? ' ' + p.extra.replace(/[\r\n]+/g, ' ') : '';
      const val = String(p.value || '').replace(/[\r\n]+/g, ' ').trim();
      switch (p.type) {
        case 'R': case 'C': case 'L': lines.push(`${nm} ${N[0]} ${N[1]} ${val || '0'}${extra}`); break;
        case 'V': case 'I': lines.push(`${nm} ${N[0]} ${N[1]} ${val || '0'}${extra}`); break;
        case 'D': case 'DZ': case 'LED': lines.push(`${nm} ${N[0]} ${N[1]} ${val}${extra}`); usedModels.add(val.toLowerCase()); break;
        case 'NPN': case 'PNP': lines.push(`${nm} ${N[0]} ${N[1]} ${N[2]} ${val}${extra}`); usedModels.add(val.toLowerCase()); break;
        case 'NMOS': case 'PMOS': lines.push(`${nm} ${N[0]} ${N[1]} ${N[2]} ${N[2]} ${val}${extra}`); usedModels.add(val.toLowerCase()); break;
        case 'OPAMP': {
          opamp = true;
          const railFree = con.unconnected.some(u => u.pi === pi && u.n === 'V+') && con.unconnected.some(u => u.pi === pi && u.n === 'V-');
          lines.push(railFree ? `${nm} ${N[1]} ${N[0]} ${N[2]} LUMEN_OPAMP3 ${val}${extra}` : `${nm} ${N[1]} ${N[0]} ${N[2]} ${N[3]} ${N[4]} LUMEN_OPAMP ${val}${extra}`);
          break;
        }
        case 'SW': { const closed = /^(closed|on|1|true)$/i.test(val); lines.push(`${nm} ${N[0]} ${N[1]} ${closed ? '10m' : '1G'}`); break; }
        case 'VSW': lines.push(`${nm} ${N[0]} ${N[1]} ${N[2]} ${N[3]} ${val}${extra}`); usedModels.add(val.toLowerCase()); break;
        case 'E': case 'G': lines.push(`${nm} ${N[0]} ${N[1]} ${N[2]} ${N[3]} ${val}`); break;
        case 'F': case 'H': lines.push(`${nm} ${N[0]} ${N[1]} ${val}`); break;
        case 'SUBX': lines.push(`${nm} ${N.join(' ')} ${val}${extra}`); break;
      }
    });
    con.unconnected.forEach(u => { const p = doc.parts[u.pi]; if (p.type === 'OPAMP' && (u.n === 'V+' || u.n === 'V-')) return; warnings.push(`${p.ref} pin ${u.name || u.n} is not connected`); });
    con.conflicts.forEach(([a, b]) => warnings.push(`Net labels ${a} and ${b} are on the same net`));
    // models from the built-in library, so the netlist is self-contained
    const modelCards = [];
    usedModels.forEach(m => {
      if (!m || dmodels.has(m)) return;
      const lib = Models.LIB[m]; if (lib) modelCards.push(NL.modelCard(m.toUpperCase(), lib)); else warnings.push(`Model ${m.toUpperCase()} is not in the library — add a .model directive`);
    });
    if (modelCards.length) lines.push(...modelCards);
    if (doc.directives && doc.directives.trim()) lines.push(...doc.directives.replace(/\r/g, '').split('\n').filter(l => !/^\s*\.(end|tran|ac|dc|op)\b/i.test(l)));
    if (opamp && opts.subckt !== false && !definedSubckts(doc.directives).has('lumen_opamp')) lines.push(NL.OPAMP_SUBCKT);
    if (doc.sim && doc.sim.trim()) lines.push(doc.sim.trim());
    lines.push('.end');
    return { text: lines.join('\n') + '\n', warnings, probeNets: con.probeNets, con };
  }

  // ---------- netlist → schematic ----------
  const KIND_TYPE = { R: 'R', C: 'C', L: 'L', V: 'V', I: 'I', D: 'D', E: 'E', G: 'G', F: 'F', H: 'H', S: 'VSW' };
  // raw directive text worth keeping in the schematic (.model/.param/.subckt…/.options/.ic)
  function extractDirectives(text) {
    const out = []; let inSub = false, last = false;
    String(text).replace(/\r/g, '').split('\n').slice(1).forEach(l => {
      const s = l.trim();
      if (/^\+/.test(s)) { if (last) out.push(l); return; }
      last = false;
      if (/^\.subckt\b/i.test(s)) inSub = true;
      if (inSub || /^\.(model|param|params|options|option|opt|ic|func|global)\b/i.test(s)) { out.push(l); last = true; }
      if (/^\.ends\b/i.test(s)) inSub = false;
    });
    return out.join('\n');
  }
  function fromNetlist(text) {
    const deck = NL.parse(text), doc = { parts: [], wires: [], labels: [], sim: '', directives: extractDirectives(text), traces: [], title: deck.title || 'Imported netlist' };
    const ref = [], skipped = [];
    deck.elements.forEach(({ tk }) => {
      const kind = tk[0][0].toUpperCase(), name = tk[0];
      const rest = tk.slice(1); let type = KIND_TYPE[kind], nodes, value = '', extra = '';
      const join = a => a.join(' ').replace(/ ?\( ?/g, '(').replace(/ \)/g, ')').replace(/ ?= ?/g, '=').replace(/ , /g, ', ');
      if (kind === 'R' || kind === 'C' || kind === 'L' || kind === 'V' || kind === 'I') { nodes = rest.slice(0, 2); value = join(rest.slice(2)); }
      else if (kind === 'D') { nodes = rest.slice(0, 2); value = rest[2]; extra = join(rest.slice(3)); const m = (deck.models[String(value).toLowerCase()] || Models.LIB[String(value).toLowerCase()]); if (m && m.params && m.params.bv && m.params.bv < 50) type = 'DZ'; if (/^led/i.test(value)) type = 'LED'; }
      else if (kind === 'Q') {
        const isM = s => !!(deck.models[String(s).toLowerCase()] || Models.LIB[String(s).toLowerCase()]);
        const nn = rest.length > 4 && !isM(rest[3]) && isM(rest[4]) ? 4 : 3;
        nodes = rest.slice(0, 3); value = rest[nn]; extra = join(rest.slice(nn + 1));
        const m = deck.models[String(value).toLowerCase()] || Models.LIB[String(value).toLowerCase()]; type = m && m.type === 'pnp' ? 'PNP' : 'NPN';
      } else if (kind === 'M') {
        const isM = s => !!(deck.models[String(s).toLowerCase()] || Models.LIB[String(s).toLowerCase()]);
        const nn = !isM(rest[4]) && isM(rest[3]) ? 3 : 4;
        nodes = rest.slice(0, 3); value = rest[nn]; extra = join(rest.slice(nn + 1));
        if (nn === 4 && String(rest[3]).toLowerCase() !== String(rest[2]).toLowerCase()) skipped.push(`${name}: bulk terminal tied to source in the schematic`);
        const m = deck.models[String(value).toLowerCase()] || Models.LIB[String(value).toLowerCase()]; type = m && m.type === 'pmos' ? 'PMOS' : 'NMOS';
      } else if (kind === 'E' || kind === 'G' || kind === 'S') { nodes = rest.slice(0, 4); value = join(rest.slice(4)); }
      else if (kind === 'F' || kind === 'H') { nodes = rest.slice(0, 2); value = join(rest.slice(2)); }
      else if (kind === 'X') {
        const body = rest.filter(t => t.toLowerCase() !== 'params:'); let end = body.length; for (let i = 0; i < body.length; i++) if (body[i + 1] === '=') { end = i; break; }
        const pos = body.slice(0, end), sub = pos[pos.length - 1], params = join(body.slice(end));
        nodes = pos.slice(0, -1);
        if (/^(lumen_opamp3?|opamp|universalopamp2?)$/i.test(sub)) { type = 'OPAMP'; nodes = [nodes[1], nodes[0], nodes[2], nodes[3], nodes[4]]; value = params || PL.PART.OPAMP.value; }
        else { type = 'SUBX'; value = sub; extra = params; const sc = deck.subckts[String(sub).toLowerCase()]; ref.push({ type, name, nodes, value, extra, pinNames: sc ? sc.pins : nodes.map((_, i) => String(i + 1)) }); return; }
      } else if (kind === 'K') { doc.directives += (doc.directives ? '\n' : '') + tk.join(' '); return; }
      else { skipped.push(`${name}: element type ${kind} has no schematic symbol`); return; }
      if (!type) { skipped.push(name); return; }
      ref.push({ type, name, nodes, value, extra });
    });
    // grid placement: each part gets a 1-unit stub on every pin, ending in a net label or a ground symbol
    const cols = Math.max(3, Math.ceil(Math.sqrt(ref.length * 1.6)));
    ref.forEach((e, i) => {
      const cx = (i % cols) * 14, cy = Math.floor(i / cols) * 14;
      const refName = e.type === 'OPAMP' && /^x/i.test(e.name) ? e.name.slice(1) : e.type === 'SUBX' ? e.name : e.name;
      const part = { type: e.type, ref: refName, x: cx, y: cy, rot: 0, mirror: false, value: e.value || '', extra: e.extra || '' };
      if (e.type === 'SUBX') { part.pinCount = e.nodes.length; part.pinNames = e.pinNames; }
      doc.parts.push(part);
      const def = PL.defOf(part);
      def.pins.forEach((q, k) => {
        const n = e.nodes[k]; if (n === undefined) return;
        const p = PL.pinsOf(part)[k];
        const horiz = Math.abs(q.x) >= Math.abs(q.y), dx = horiz ? Math.sign(q.x || 1) : 0, dy = horiz ? 0 : Math.sign(q.y || 1);
        const ex = p.x + dx * 2, ey = p.y + dy * 2;
        doc.wires.push({ x1: p.x, y1: p.y, x2: ex, y2: ey });
        if (/^(0|gnd)$/i.test(n)) doc.parts.push({ type: 'GND', ref: '', x: ex, y: ey, rot: dy < 0 ? 2 : dx > 0 ? 3 : dx < 0 ? 1 : 0, mirror: false, value: '', extra: '' });
        else doc.labels.push({ x: ex, y: ey, name: cleanName(n) });
      });
    });
    const a = deck.analyses[0]; if (a) doc.sim = NL.analysisCard(a); else doc.sim = '.op';
    return { doc: normalize(doc), skipped, warnings: deck.warnings };
  }

  // ---------- Lumen PCB import ----------
  // pin geometry of the Lumen PCB symbols we can simulate (copied from pcb/js/lib.js, grid units)
  const PCB_PINS = {
    R: [['1', -3, 0], ['2', 3, 0]], C: [['1', -2, 0], ['2', 2, 0]], CP: [['1', -2, 0], ['2', 2, 0]], L: [['1', -3, 0], ['2', 3, 0]], F: [['1', -3, 0], ['2', 3, 0]],
    D: [['1', 3, 0], ['2', -3, 0]], LED: [['1', 3, 0], ['2', -3, 0]],
    NPN: [['2', -3, 0], ['3', 2, -3], ['1', 2, 3]], PNP: [['2', -3, 0], ['1', 2, -3], ['3', 2, 3]], NMOS: [['2', -3, 0], ['3', 2, -3], ['1', 2, 3]],
    SW: [['1', -3, 0], ['2', 3, 0]], RV: [['1', -3, 0], ['2', 0, -3], ['3', 3, 0]], GND: [['1', 0, 0]], VCC: [['1', 0, 0]],
  };
  const pcbXform = (p, x, y) => { if (p.mirror) x = -x; for (let k = 0; k < ((p.rot || 0) % 4 + 4) % 4; k++) [x, y] = [-y, x]; return [p.x + x, p.y + y]; };
  function railVolts(name) {
    const s = String(name).toUpperCase().replace(/^\+/, '');
    let m = /^(-?\d+)V(\d+)$/.exec(s); if (m) return parseFloat(m[1] + '.' + m[2]);
    m = /^(-?\d+(?:\.\d+)?)V$/.exec(s); if (m) return parseFloat(m[1]);
    if (/^-/.test(String(name))) { const v = parseFloat(String(name)); if (Number.isFinite(v)) return v; }
    return 5;
  }
  function fromLpcb(json) {
    const file = typeof json === 'string' ? JSON.parse(json) : json;
    const d = file && file.doc ? file.doc : file;
    if (!d || !d.sch || !Array.isArray(d.sch.parts)) throw new Error('Not a Lumen PCB project (no schematic found)');
    const sch = d.sch, dsu = new DSU(), names = new Map();
    const wires = (sch.wires || []).filter(w => w && Array.isArray(w.pts));
    const segs = []; wires.forEach(w => { for (let i = 1; i < w.pts.length; i++) { const a = w.pts[i - 1], b = w.pts[i]; segs.push({ x1: +a[0], y1: +a[1], x2: +b[0], y2: +b[1] }); dsu.union(key(a[0], a[1]), key(b[0], b[1])); } });
    const attach = (x, y, id) => { dsu.union(id, key(x, y)); segs.forEach(s => { if (onSeg(x, y, s)) dsu.union(key(x, y), key(s.x1, s.y1)); }); };
    segs.forEach(s => { attach(s.x1, s.y1, key(s.x1, s.y1)); attach(s.x2, s.y2, key(s.x2, s.y2)); });
    const mapped = [], skipped = [], rails = new Set();
    sch.parts.forEach(p => {
      if (!p || typeof p !== 'object') return;
      const pins = PCB_PINS[p.lib];
      if (!pins) { skipped.push(`${p.ref || '?'} (${p.value || p.lib}) has no simulation model`); return; }
      const pinIds = pins.map(([n, x, y]) => { const [px, py] = pcbXform(p, x, y); const id = 'pin:' + p.ref + '.' + n; attach(px, py, id); return id; });
      if (p.lib === 'GND') { dsu.union(pinIds[0], 'name:0'); names.set('name:0', '0'); return; }
      if (p.lib === 'VCC') { const nm = cleanName(p.value || '+5V'); dsu.union(pinIds[0], 'name:' + nm); names.set('name:' + nm, nm); rails.add(nm); return; }
      mapped.push({ p, pinIds });
    });
    (sch.labels || []).forEach(l => { if (!l || typeof l.name !== 'string') return; const nm = cleanName(l.name); attach(+l.x, +l.y, 'name:' + nm); names.set('name:' + nm, nm); });
    const nameOf = new Map(); names.forEach((n, id) => { const r = dsu.find(id); if (!nameOf.has(r) || n === '0') nameOf.set(r, n); });
    let k = 1; const netOf = id => { const r = dsu.find(id); if (!nameOf.has(r)) nameOf.set(r, 'N' + String(k++).padStart(3, '0')); return nameOf.get(r); };
    // build the schematic: keep the PCB layout (scaled ×1.1), every pin stubbed to a label / ground
    const doc = { parts: [], wires: [], labels: [], sim: '.tran 10m', directives: '', traces: [], title: (d.name || 'Imported from Lumen PCB') };
    const xs = mapped.map(m => m.p.x), ys = mapped.map(m => m.p.y), x0 = Math.min(0, ...xs), y0 = Math.min(0, ...ys);
    const place = (type, ref, x, y, value, nets) => {
      const part = { type, ref, x: Math.round((x - x0) * 1.1), y: Math.round((y - y0) * 1.1), rot: 0, mirror: false, value, extra: '' };
      // avoid stacking on a part already placed there
      while (doc.parts.some(q => Math.abs(q.x - part.x) < 6 && Math.abs(q.y - part.y) < 8)) part.x += 8;
      doc.parts.push(part);
      PL.pinsOf(part).forEach((q, i) => {
        const n = nets[i]; if (n == null) return;
        const def = PL.defOf(part).pins[i], horiz = Math.abs(def.x) >= Math.abs(def.y), dx = horiz ? Math.sign(def.x || 1) : 0, dy = horiz ? 0 : Math.sign(def.y || 1);
        const ex = q.x + dx * 2, ey = q.y + dy * 2; doc.wires.push({ x1: q.x, y1: q.y, x2: ex, y2: ey });
        if (n === '0') doc.parts.push({ type: 'GND', ref: '', x: ex, y: ey, rot: dy < 0 ? 2 : dx > 0 ? 3 : dx < 0 ? 1 : 0, mirror: false, value: '', extra: '' });
        else doc.labels.push({ x: ex, y: ey, name: n });
      });
      return part;
    };
    const val = (p, def) => String(p.value || def);
    const isNum = s => !Number.isNaN(Ex.parseNum(String(s).replace(/Ω|ohm/i, '')));
    mapped.forEach(({ p, pinIds }) => {
      const n = pinIds.map(netOf), nn = Object.fromEntries((PCB_PINS[p.lib]).map(([pn], i) => [pn, n[i]]));
      switch (p.lib) {
        case 'R': place('R', p.ref, p.x, p.y, isNum(p.value) ? val(p, '1k') : '1k', [nn['1'], nn['2']]); break;
        case 'F': place('R', p.ref, p.x, p.y, '0.1', [nn['1'], nn['2']]); break;
        case 'C': case 'CP': place('C', p.ref, p.x, p.y, isNum(p.value) ? val(p, '100n') : '100n', [nn['1'], nn['2']]); break;
        case 'L': place('L', p.ref, p.x, p.y, isNum(p.value) ? val(p, '10u') : '10u', [nn['1'], nn['2']]); break;
        case 'D': place('D', p.ref, p.x, p.y, Models.LIB[String(p.value).toLowerCase()] ? val(p) : '1N4148', [nn['2'], nn['1']]); break;
        case 'LED': { const c = String(p.value || '').toLowerCase(); place('LED', p.ref, p.x, p.y, /green/.test(c) ? 'LED_GREEN' : /blue|white/.test(c) ? 'LED_BLUE' : 'LED_RED', [nn['2'], nn['1']]); break; }
        case 'NPN': place('NPN', p.ref, p.x, p.y, Models.LIB[String(p.value).toLowerCase()]?.type === 'npn' ? val(p) : '2N3904', [nn['3'], nn['2'], nn['1']]); break;
        case 'PNP': place('PNP', p.ref, p.x, p.y, Models.LIB[String(p.value).toLowerCase()]?.type === 'pnp' ? val(p) : '2N3906', [nn['3'], nn['2'], nn['1']]); break;
        case 'NMOS': place('NMOS', p.ref, p.x, p.y, Models.LIB[String(p.value).toLowerCase()]?.type === 'nmos' ? val(p) : '2N7000', [nn['3'], nn['2'], nn['1']]); break;
        case 'SW': place('SW', p.ref, p.x, p.y, 'open', [nn['1'], nn['2']]); break;
        case 'RV': { const r = isNum(p.value) ? Ex.parseNum(p.value) : 10e3; place('R', p.ref + 'a', p.x, p.y, Ex.fmtSpice(r / 2), [nn['1'], nn['2']]); place('R', p.ref + 'b', p.x + 4, p.y, Ex.fmtSpice(r / 2), [nn['2'], nn['3']]); break; }
      }
    });
    // a supply for every power rail
    let vy = 0; const maxX = Math.max(0, ...doc.parts.map(q => q.x)) + 14;
    rails.forEach(r => { place('V', 'V_' + r.replace(/[^\w]/g, ''), (maxX / 1.1) + x0, vy / 1.1 + y0, String(railVolts(r)), [r, '0']); vy += 12; });
    return { doc: normalize(doc), skipped };
  }

  const api = { normalize, connectivity, junctions, toSpice, spiceName, currentProbe, fromNetlist, fromLpcb, extractDirectives, cleanName, key, onSeg, definedSubckts, railVolts };
  if (isNode) module.exports = api; else root.SpiceSchematic = api;
})(typeof self !== 'undefined' ? self : this);
