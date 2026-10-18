// Lumen Spice — SPICE netlist reader (Berkeley SPICE / LTspice / ngspice dialect subset) and flattener.
// parse(text) → deck { title, elements, models, subckts, params, analyses, options, ic, warnings }
// flatten(deck) → { elements, models, options, ic } ready for SpiceEngine.run
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const Ex = isNode ? require('./expr.js') : root.SpiceExpr;
  const Models = isNode ? require('./models.js') : root.SpiceModels;

  const OPAMP_SUBCKTS = new Set(['lumen_opamp', 'lumen_opamp3', 'opamp', 'universalopamp', 'universalopamp2']);

  // split a card into tokens: words, ( ) , = and {expressions} / 'expressions' as single tokens
  function tokens(line) {
    const out = []; let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '{') { let d = 0, j = i; for (; j < line.length; j++) { if (line[j] === '{') d++; else if (line[j] === '}' && --d === 0) break; } out.push(line.slice(i, j + 1)); i = j + 1; continue; }
      if (c === "'") { const j = line.indexOf("'", i + 1); const e = j < 0 ? line.length : j; out.push('{' + line.slice(i + 1, e) + '}'); i = e + 1; continue; }
      if ('(),='.includes(c)) { out.push(c); i++; continue; }
      let j = i; while (j < line.length && !/[\s(),={}]/.test(line[j])) j++;
      out.push(line.slice(i, j)); i = j;
    }
    return out;
  }
  // pull "key = value" pairs out of a token list; returns [positional tokens, {key: rawValue}]
  function splitParams(tk) {
    const pos = [], kv = {};
    for (let i = 0; i < tk.length; i++) {
      if (tk[i + 1] === '=' && i + 2 < tk.length) { kv[tk[i].toLowerCase()] = tk[i + 2]; i += 2; continue; }
      if (tk[i] === ',' ) continue;
      pos.push(tk[i]);
    }
    return [pos, kv];
  }

  function cards(text) {
    const raw = String(text).replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    raw.forEach((l, i) => {
      // inline comments: LTspice ';', ngspice '$ ' and '//'
      let s = l.replace(/;.*$/, '').replace(/\s\$\s.*$/, '').replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(s)) s = '';
      if (/^\s*\+/.test(s) && lines.length) { lines[lines.length - 1].text += ' ' + s.replace(/^\s*\+/, ''); return; }
      lines.push({ text: s.trim(), line: i + 1 });
    });
    return lines;
  }

  function parse(text) {
    const L = cards(text), deck = { title: '', elements: [], models: {}, subckts: {}, params: [], analyses: [], options: {}, ic: {}, warnings: [], includes: [] };
    const first = String(text).replace(/\r/g, '').split('\n')[0] || '';
    let start = 0;
    if (!/^\s*\./.test(first)) { deck.title = first.replace(/^\s*\*\s?/, '').trim(); start = 1; }
    let sub = null;   // current subckt being collected
    for (let k = start; k < L.length; k++) {
      const { text: s, line } = L[k]; if (!s) continue;
      const tk = tokens(s); if (!tk.length) continue;
      const head = tk[0].toLowerCase();
      const warn = msg => deck.warnings.push(`line ${line}: ${msg}`);
      if (head === '.subckt') {
        if (sub) { warn('nested .subckt definitions are not supported'); continue; }
        const [pos, kv] = splitParams(tk.slice(1).filter(t => t.toLowerCase() !== 'params:'));
        sub = { name: pos[0], pins: pos.slice(1).map(p => p.toLowerCase()), params: kv, lines: [], models: {} };
        continue;
      }
      if (head === '.ends') { if (sub) { deck.subckts[sub.name.toLowerCase()] = sub; sub = null; } continue; }
      if (sub) { if (head === '.model') parseModel(tk, sub.models, warn); else if (head === '.param' || head === '.params') Object.assign(sub.params, splitParams(tk.slice(1))[1]); else if (head[0] === '.') warn(`${head} inside .subckt ${sub.name} is ignored`); else sub.lines.push({ tk, line }); continue; }
      if (head[0] === '.') { directive(head, tk, deck, warn, s); continue; }
      deck.elements.push({ tk, line });
    }
    if (sub) deck.warnings.push(`.subckt ${sub.name} has no .ends`);
    return deck;
  }

  function parseModel(tk, into, warn) {
    // .model NAME TYPE(k=v ...)   or  .model NAME TYPE k=v ...
    const name = (tk[1] || '').toLowerCase(); let type = (tk[2] || '').toLowerCase();
    const rest = tk.slice(3).filter(t => t !== '(' && t !== ')');
    const [, kv] = splitParams(rest);
    const map = { d: 'd', npn: 'npn', pnp: 'pnp', nmos: 'nmos', pmos: 'pmos', sw: 'sw', vswitch: 'sw', vdmos: 'nmos' };
    if (type === 'vdmos' && (kv.pchan !== undefined || rest.some(t => t.toLowerCase() === 'pchan'))) type = 'pmos';
    if (!map[type]) { warn(`model type ${type.toUpperCase()} is not supported (model ${name})`); return; }
    const params = {};
    Object.entries(kv).forEach(([k, v]) => { const n = Ex.value(v); if (!Number.isNaN(n)) params[k] = n; });
    if ((map[type] === 'nmos' || map[type] === 'pmos') && params.level > 1) warn(`MOSFET model ${name} is level ${params.level}; simulated as level 1`);
    if (type === 'vdmos') { params.vto = params.vto ?? 0; params.kp = params.kp ?? 1; if (params.cgs === undefined && params.cgdmax) params.cgd = params.cgdmax; }
    into[name] = { type: map[type === 'vdmos' ? (rest.some(t => t.toLowerCase() === 'pchan') ? 'pmos' : 'nmos') : type], params, raw: tk.join(' ') };
  }

  function directive(head, tk, deck, warn) {
    const args = tk.slice(1);
    const num = v => Ex.value(v, n => paramLookup(deck, n));
    switch (head) {
      case '.model': parseModel(tk, deck.models, warn); return;
      case '.param': case '.params': {
        const [, kv] = splitParams(args); Object.entries(kv).forEach(([k, v]) => deck.params.push([k, v])); return;
      }
      case '.op': deck.analyses.push({ type: 'op' }); return;
      case '.tran': {
        const [pos] = splitParams(args); const words = pos.map(p => p.toLowerCase());
        const nums = pos.filter(p => !/^(uic|startup|steady|nodiscard)$/i.test(p)).map(num);
        let a;
        if (nums.length === 1) a = { type: 'tran', tstep: 0, tstop: nums[0] };
        else a = { type: 'tran', tstep: nums[0], tstop: nums[1], tstart: nums[2] || 0, tmax: nums[3] || 0 };
        a.uic = words.includes('uic') || words.includes('startup');
        deck.analyses.push(a); return;
      }
      case '.ac': {
        const type = (args[0] || 'dec').toLowerCase();
        deck.analyses.push({ type: 'ac', sweep: type, n: num(args[1]), fstart: num(args[2]), fstop: num(args[3]) });
        return;
      }
      case '.dc': {
        if (args.length > 4) warn('.dc: only the first sweep source is used (nested sweeps are not supported)');
        deck.analyses.push({ type: 'dc', src: args[0], start: num(args[1]), stop: num(args[2]), step: num(args[3]) });
        return;
      }
      case '.ic': {
        // .ic V(node)=value ...
        for (let i = 0; i < args.length; i++) if (/^v$/i.test(args[i]) && args[i + 1] === '(' && args[i + 3] === ')' && args[i + 4] === '=') { deck.ic[args[i + 2].toLowerCase()] = num(args[i + 5]); i += 5; }
        return;
      }
      case '.options': case '.option': case '.opt': {
        const [pos, kv] = splitParams(args);
        Object.entries(kv).forEach(([k, v]) => { if (k === 'method') deck.options.method = String(v).toLowerCase(); else { const n = Ex.value(v); if (!Number.isNaN(n)) deck.options[k] = n; } });
        pos.forEach(p => { if (/^(trap|euler|gear)$/i.test(p)) deck.options.method = p.toLowerCase(); });
        return;
      }
      case '.end': case '.backanno': case '.save': case '.probe': case '.print': case '.plot': case '.nodeset': case '.width': case '.control': case '.endc': return;
      case '.temp': warn('.temp is ignored; all devices are simulated at 27 °C'); return;
      case '.include': case '.inc': case '.lib': deck.includes.push(args.join(' ')); if (!/opamp\.sub/i.test(args.join(' '))) warn(`${head} ${args.join(' ')} is not loaded (paste its contents into the netlist instead)`); return;
      case '.meas': case '.measure': warn('.meas is ignored — use the cursors and measurements in the waveform viewer'); return;
      case '.step': warn('.step is not supported yet; run each value separately'); return;
      case '.four': warn('.four is ignored'); return;
      case '.global': return;
      case '.func': warn('.func is not supported'); return;
      default: warn(`unknown directive ${head}`);
    }
  }
  function paramLookup(deck, name) {
    const n = name.toLowerCase(); let v;
    for (const [k, e] of deck.params) if (k === n) v = e;
    if (v === undefined) return undefined;
    return Ex.value(v, m => m.toLowerCase() === n ? undefined : paramLookup(deck, m));
  }

  // ---------- source specifications ----------
  function parseSource(tk, env, warn) {
    const w = { dc: 0, dcSet: false, acMag: 0, acPhase: 0, fn: null, args: [] };
    const extra = {};
    const num = v => Ex.value(v, env);
    for (let i = 0; i < tk.length; i++) {
      const t = tk[i], lt = t.toLowerCase();
      if (lt === 'dc') { w.dc = num(tk[++i]); w.dcSet = true; continue; }
      if (lt === 'ac') { w.acMag = num(tk[++i]); if (i + 1 < tk.length && !Number.isNaN(Ex.parseNum(tk[i + 1])) ) w.acPhase = num(tk[++i]); continue; }
      if (/^(pulse|sin|sine|pwl|exp|sffm)$/.test(lt)) {
        const fn = lt === 'sine' ? 'sin' : lt; const args = [];
        if (tk[i + 1] === '(') { let j = i + 2; for (; j < tk.length && tk[j] !== ')'; j++) if (tk[j] !== ',') args.push(tk[j]); i = j; }
        else { let j = i + 1; for (; j < tk.length && (!Number.isNaN(Ex.parseNum(tk[j])) || /^\{/.test(tk[j])); j++) args.push(tk[j]); i = j - 1; }
        w.fn = fn;
        if (fn === 'pwl' && args.some(a => /^file$/i.test(a))) throw new Error('PWL file= sources are not supported');
        w.args = args.map(num);
        continue;
      }
      if (tk[i + 1] === '=') { extra[lt] = tk[i + 2]; i += 2; continue; }
      if (lt === 'r' || lt === 'repeat') { w.repeat = true; continue; }
      const n = Ex.parseNum(t);
      if (!Number.isNaN(n) || /^\{/.test(t)) { w.dc = num(t); w.dcSet = true; continue; }
      warn(`ignored "${t}" in source`);
    }
    if (extra.r !== undefined) w.repeat = true;
    return [w, extra];
  }

  // ---------- flattening ----------
  function flatten(deck) {
    const out = { elements: [], models: {}, options: { ...deck.options }, ic: { ...deck.ic }, warnings: deck.warnings.slice() };
    Object.entries(Models.LIB).forEach(([k, m]) => { out.models[k] = { type: m.type, params: { ...m.params } }; });
    Object.entries(deck.models).forEach(([k, m]) => { out.models[k] = m; });
    const globalEnv = name => paramLookup(deck, name);
    const names = new Set();
    let depth = 0;

    function expand(cardsList, nodeMap, prefix, env, localModels) {
      const modelName = m => {
        const k = String(m).toLowerCase();
        if (localModels && localModels[k]) { const full = (prefix + k).toLowerCase(); out.models[full] = localModels[k]; return full; }
        return k;
      };
      const node = n => {
        const k = String(n).toLowerCase();
        if (k === '0' || k === 'gnd') return '0';
        if (nodeMap && nodeMap.has(k)) return nodeMap.get(k);
        return prefix ? prefix + k : k;
      };
      const isModel = m => m != null && (!!(localModels && localModels[String(m).toLowerCase()]) || !!out.models[String(m).toLowerCase()]);
      for (const { tk, line } of cardsList) {
        const warn = msg => out.warnings.push(`line ${line}: ${msg}`);
        const rawName = tk[0], kind = rawName[0].toUpperCase(), name = prefix ? prefix + rawName : rawName;
        const num = v => { const r = Ex.value(v, env); if (Number.isNaN(r)) throw new Error(`line ${line}: bad value "${v}" in ${rawName}`); return r; };
        if (names.has(name.toLowerCase())) throw new Error(`line ${line}: duplicate element name ${name}`);
        names.add(name.toLowerCase());
        const need = (n, what) => { if (tk.length < n) throw new Error(`line ${line}: ${rawName} needs ${what}`); };
        const add = e => out.elements.push({ params: {}, ...e, name, line });
        try {
          switch (kind) {
            case 'R': case 'C': case 'L': {
              need(4, 'two nodes and a value');
              const [pos, kv] = splitParams(tk.slice(3));
              let raw = pos[0]; if (raw === undefined) raw = kv[kind.toLowerCase()] ?? kv.r ?? kv.c ?? kv.l ?? kv.value;
              const value = num(raw); const params = {};
              if (kv.ic !== undefined) params.ic = num(kv.ic);
              let a = node(tk[1]); const b = node(tk[2]);
              if ((kind === 'C' || kind === 'L') && kv.rser !== undefined && num(kv.rser) > 0) {
                const mid = name.toLowerCase() + '#s'; out.elements.push({ kind: 'R', name: name + '#Rser', nodes: [a, mid], value: num(kv.rser), params: {}, line }); a = mid;
              }
              add({ kind, nodes: [a, b], value, params });
              break;
            }
            case 'V': case 'I': {
              need(3, 'two nodes');
              const [w, extra] = parseSource(tk.slice(3), env, warn);
              let a = node(tk[1]); const b = node(tk[2]);
              if (kind === 'V' && extra.rser !== undefined && num(extra.rser) > 0) {
                const mid = name.toLowerCase() + '#s'; out.elements.push({ kind: 'R', name: name + '#Rser', nodes: [a, mid], value: num(extra.rser), params: {}, line }); a = mid;
              }
              add({ kind, nodes: [a, b], wave: w });
              break;
            }
            case 'E': case 'G': {
              need(6, 'four nodes and a gain');
              const [pos, kv] = splitParams(tk.slice(5));
              if (/^(poly|value|table|laplace)$/i.test(tk[5]) || kv.value || kv.laplace) throw new Error(`${rawName}: behavioural (VALUE/POLY/TABLE/LAPLACE) controlled sources are not supported`);
              add({ kind, nodes: [tk[1], tk[2], tk[3], tk[4]].map(node), value: num(pos[0] ?? kv.gain ?? 1) });
              break;
            }
            case 'F': case 'H': {
              need(5, 'two nodes, a controlling source and a gain');
              const ctl = tk[3]; const lctl = ctl.toLowerCase();
              const local = cardsList.some(c => c.tk[0].toLowerCase() === lctl);
              add({ kind, nodes: [node(tk[1]), node(tk[2])], ctl: local && prefix ? prefix + ctl : ctl, value: num(tk[4]) });
              break;
            }
            case 'D': {
              need(4, 'two nodes and a model');
              const [pos, kv] = splitParams(tk.slice(3));
              const params = {}; if (pos[1] !== undefined && !/^off$/i.test(pos[1])) params.area = num(pos[1]); if (kv.area) params.area = num(kv.area);
              if (pos.some(p => /^off$/i.test(p))) params.off = 1;
              add({ kind, nodes: [node(tk[1]), node(tk[2])], model: modelName(pos[0]), params });
              break;
            }
            case 'Q': {
              need(5, 'three nodes and a model');
              let nn = 3; if (tk.length > 5 && !isModel(tk[4]) && isModel(tk[5])) nn = 4;
              const [pos, kv] = splitParams(tk.slice(1 + nn));
              const params = {}; if (pos[1] !== undefined && !/^off$/i.test(pos[1])) params.area = num(pos[1]); if (kv.area) params.area = num(kv.area);
              if (pos.some(p => /^off$/i.test(p))) params.off = 1;
              add({ kind, nodes: tk.slice(1, 4).map(node), model: modelName(pos[0]), params });
              break;
            }
            case 'M': {
              need(5, 'nodes and a model');
              let nn = 4; if (!isModel(tk[5]) && isModel(tk[4])) nn = 3;
              const [pos, kv] = splitParams(tk.slice(1 + nn));
              const params = {}; ['w', 'l', 'm'].forEach(k => { if (kv[k] !== undefined) params[k] = num(kv[k]); });
              const nodes = tk.slice(1, 1 + nn).map(node); if (nn === 3) nodes.push(nodes[2]);
              add({ kind, nodes, model: modelName(pos[0]), params });
              break;
            }
            case 'S': {
              need(6, 'four nodes and a model');
              const [pos] = splitParams(tk.slice(5));
              add({ kind, nodes: [tk[1], tk[2], tk[3], tk[4]].map(node), model: modelName(pos[0]) });
              break;
            }
            case 'X': {
              // X1 n1 n2 ... SUBNAME [params:] k=v ...
              const body = tk.slice(1).filter(t => t.toLowerCase() !== 'params:');
              let end = body.length; for (let i = 0; i < body.length; i++) if (body[i + 1] === '=') { end = i; break; }
              const pos = body.slice(0, end), [, kv] = splitParams(body.slice(end));
              const subName = pos[pos.length - 1], lname = String(subName).toLowerCase(), pins = pos.slice(0, -1).map(node);
              const sc = deck.subckts[lname];
              if (OPAMP_SUBCKTS.has(lname) && (!sc || lname.startsWith('lumen_opamp'))) {
                const params = {}; Object.entries(kv).forEach(([k, v]) => { params[k] = num(v); });
                if (sc) Object.entries(sc.params).forEach(([k, v]) => { if (params[k] === undefined) { const n = Ex.value(v, globalEnv); if (!Number.isNaN(n)) params[k] = n; } });
                if (pins.length < 3) throw new Error(`${rawName}: an op-amp needs at least in+, in- and out`);
                if (lname.startsWith('universalopamp') && pins.length >= 5) pins.splice(0, 5, pins[0], pins[1], pins[4], pins[2], pins[3]);
                if (pins.length < 5 || lname === 'lumen_opamp3' || lname === 'opamp') params.rails = 0;
                add({ kind: 'O', nodes: pins.slice(0, 5), params });
                break;
              }
              if (!sc) throw new Error(`${rawName}: subcircuit ${subName} is not defined`);
              if (sc.pins.length !== pins.length) throw new Error(`${rawName}: ${subName} has ${sc.pins.length} pins, ${pins.length} given`);
              if (++depth > 20) throw new Error('subcircuits nested too deeply (recursive?)');
              const map = new Map(sc.pins.map((p, i) => [p, pins[i]]));
              const local = {}; Object.entries(sc.params).forEach(([k, v]) => { local[k] = v; });
              const vals = {}; Object.entries(kv).forEach(([k, v]) => { vals[k] = num(v); });
              const subEnv = n => { const k = n.toLowerCase(); if (vals[k] !== undefined) return vals[k]; if (local[k] !== undefined) return Ex.value(local[k], subEnv2); return env(n); };
              const subEnv2 = n => { const k = n.toLowerCase(); if (vals[k] !== undefined) return vals[k]; return env(n); };
              names.delete(name.toLowerCase());
              expand(sc.lines, map, name + '.', subEnv, sc.models);
              depth--;
              break;
            }
            case 'K': {
              need(4, 'two inductors and a coupling factor');
              const inds = tk.slice(1, -1).map(n => { const local = cardsList.some(c => c.tk[0].toLowerCase() === n.toLowerCase()); return local && prefix ? prefix + n : n; });
              add({ kind: 'K', nodes: [], inds, value: num(tk[tk.length - 1]) });
              break;
            }
            case 'B': throw new Error(`${rawName}: behavioural sources (B) are not supported yet`);
            case 'J': throw new Error(`${rawName}: JFETs are not supported yet`);
            case 'T': case 'O': case 'U': case 'Z': throw new Error(`${rawName}: ${kind} elements are not supported`);
            default: throw new Error(`unknown element ${rawName}`);
          }
        } catch (e) { if (/^line \d+/.test(e.message)) throw e; throw new Error(`line ${line}: ${e.message}`); }
      }
    }
    expand(deck.elements, null, '', globalEnv, null);
    if (!out.elements.length) throw new Error('The netlist has no elements');
    return out;
  }

  const analysisOf = deck => deck.analyses[0] || null;

  // ---------- writing ----------
  const F = v => Ex.fmtSpice(v);
  function analysisCard(a) {
    if (!a) return '';
    switch (a.type) {
      case 'op': return '.op';
      case 'tran': return (a.tstep || a.tstart || a.tmax ? `.tran ${F(a.tstep || 0)} ${F(a.tstop)}${a.tstart || a.tmax ? ' ' + F(a.tstart || 0) : ''}${a.tmax ? ' ' + F(a.tmax) : ''}` : `.tran ${F(a.tstop)}`) + (a.uic ? ' uic' : '');
      case 'ac': return `.ac ${a.sweep || 'dec'} ${Math.round(a.n)} ${F(a.fstart)} ${F(a.fstop)}`;
      case 'dc': return `.dc ${a.src} ${F(a.start)} ${F(a.stop)} ${F(a.step)}`;
    }
    return '';
  }
  function waveText(w) {
    const parts = [];
    if (w.fn) parts.push(`${w.fn.toUpperCase()}(${w.args.map(F).join(' ')})${w.fn === 'pwl' && w.repeat ? ' r=0' : ''}`);
    if (!w.fn || w.dcSet) parts.unshift(w.fn ? `DC ${F(w.dc)}` : F(w.dc));
    if (w.acMag) parts.push(`AC ${F(w.acMag)}${w.acPhase ? ' ' + F(w.acPhase) : ''}`);
    return parts.join(' ');
  }
  function modelCard(name, m) {
    const t = { d: 'D', npn: 'NPN', pnp: 'PNP', nmos: 'NMOS', pmos: 'PMOS', sw: 'SW' }[m.type];
    return `.model ${name} ${t}(${Object.entries(m.params).map(([k, v]) => `${k.toUpperCase()}=${F(v)}`).join(' ')})`;
  }
  // the op-amp macro model as plain SPICE (for other simulators); rails clamp through diodes
  const OPAMP_SUBCKT = [
    '* Lumen Spice op-amp macro model: single pole at GBW/Avol, output clamped Vdrop inside the rails',
    '.subckt LUMEN_OPAMP inp inn out vp vn params: Avol=1Meg GBW=10Meg Slew=10Meg Vdrop=0.1',
    'Rin inp inn 100Meg',
    'G1 0 x inp inn 1m',
    'R1 x 0 {Avol/1m}',
    'C1 x 0 {1m/(6.2832*GBW)}',
    'Ehi hi 0 vp 0 1',
    'Vhi hi hc {Vdrop}',
    'Elo lo 0 vn 0 1',
    'Vlo lc lo {Vdrop}',
    'D1 x hc DCLAMP',
    'D2 lc x DCLAMP',
    'Eout out 0 x 0 1',
    '.model DCLAMP D(IS=1e-15 N=0.05)',
    '.ends LUMEN_OPAMP',
    '.subckt LUMEN_OPAMP3 inp inn out params: Avol=1Meg GBW=10Meg Slew=10Meg',
    'Rin inp inn 100Meg',
    'G1 0 x inp inn 1m',
    'R1 x 0 {Avol/1m}',
    'C1 x 0 {1m/(6.2832*GBW)}',
    'Eout out 0 x 0 1',
    '.ends LUMEN_OPAMP3',
  ].join('\n');

  const api = { tokens, cards, parse, flatten, parseSource, analysisOf, analysisCard, waveText, modelCard, OPAMP_SUBCKT, paramLookup, splitParams };
  if (isNode) module.exports = api; else root.SpiceNetlist = api;
})(typeof self !== 'undefined' ? self : this);
