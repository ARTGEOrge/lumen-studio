// Lumen Draft — command line engine (prompts, coordinate entry, keywords) and the drafting commands.
(function () {
  'use strict';
  const G = window.LDGeom, M = window.LDModel;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const CANCEL = { cancel: true };

  window.LDCmd = function (A, V, ui) {
    const E = { pending: null, last: null };
    let cmdName = '', runTok = 0;

    /* ---------- number formatting ---------- */
    const f4 = v => (Math.abs(v) < 5e-9 ? 0 : v).toFixed(A.prec ?? 4);
    const fa = r => (G.normA(r) * R2D).toFixed(Math.max(0, (A.prec ?? 4) - 2)).replace(/\.?0+$/, '') + '°';
    const fpt = p => `${f4(p[0])},${f4(p[1])}`;
    E.f4 = f4; E.fa = fa;

    /* ---------- keywords ---------- */
    function kwList(prompt) { const m = prompt.match(/\[([^\]]+)\]/); return m ? m[1].split('/').map(s => s.trim()).filter(Boolean) : []; }
    function kwShort(k) { const caps = k.replace(/[^A-Z]/g, ''); return caps && caps !== k.toUpperCase() ? caps : k[0].toUpperCase(); }
    function matchKw(text, kws) {
      const t = text.trim().toUpperCase(); if (!t) return null;
      for (const k of kws) if (k.toUpperCase() === t || kwShort(k) === t) return k;
      for (const k of kws) if (k.toUpperCase().startsWith(t) && t.length >= 2) return k;
      return null;
    }

    /* ---------- coordinate parsing ---------- */
    const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
    const reXY = new RegExp(`^([@#]?)\\s*(${NUM})\\s*,\\s*(${NUM})(?:\\s*,\\s*${NUM})?$`), rePol = new RegExp(`^([@#]?)\\s*(${NUM})\\s*<\\s*(${NUM})$`), reN = new RegExp(`^${NUM}$`);
    function evalNum(t) { t = t.trim(); if (reN.test(t)) return parseFloat(t); const m = t.match(new RegExp(`^(${NUM})\\s*([*/])\\s*(${NUM})$`)); if (m) return m[2] === '*' ? +m[1] * +m[3] : +m[1] / +m[3]; return null; }
    E.parsePoint = (t, base) => {
      t = t.trim(); let m;
      if (t === '@') return (A.lastPt || [0, 0]).slice();
      if ((m = t.match(reXY))) { const x = +m[2], y = +m[3]; if (m[1] === '@') { const b = A.lastPt || [0, 0]; return [b[0] + x, b[1] + y]; } return [x, y]; }
      if ((m = t.match(rePol))) { const d = +m[2], a = +m[3] * D2R; const b = m[1] === '@' ? (A.lastPt || [0, 0]) : [0, 0]; return [b[0] + d * Math.cos(a), b[1] + d * Math.sin(a)]; }
      const n = evalNum(t);
      if (n != null && base) {   // direct distance entry along the (constrained) cursor direction
        const c = A.cursor && A.cursor.pt || [base[0] + 1, base[1]]; let dx = c[0] - base[0], dy = c[1] - base[1]; const l = Math.hypot(dx, dy);
        if (l < 1e-12) { dx = 1; dy = 0; } else { dx /= l; dy /= l; }
        return [base[0] + dx * n, base[1] + dy * n];
      }
      return null;
    };

    /* ---------- requests ---------- */
    // kind: point | dist | angle | num | int | string | kw | sel | ent
    function request(kind, prompt, opts = {}) {
      return new Promise((resolve, reject) => {
        const kws = opts.kws || kwList(prompt);
        E.pending = { kind, prompt, opts, kws, resolve, reject };
        A.wantsPick = kind === 'sel' || kind === 'ent';
        ui.setPrompt(prompt + (opts.def != null ? ` <${opts.defText ?? (typeof opts.def === 'number' ? f4(opts.def) : opts.def)}>` : '') + ':', kws);
        A.base = opts.base || null;
        ui.mouseMoved();
      });
    }
    function settle(val) {
      const p = E.pending; if (!p) return;
      E.pending = null; A.preview = null; A.rubber = null; A.base = null; A.wantsPick = false; A.track = null; A.trackTip = null; A.dynTip = null;
      if (p.opts.rect) A.winSel = null;
      V.overlay();
      p.resolve(val);
    }
    E.cancel = () => {
      if (E.pending) { const p = E.pending; E.pending = null; A.preview = null; A.rubber = null; A.base = null; A.wantsPick = false; A.winSel = null; A.track = null; A.trackTip = null; A.dynTip = null; V.overlay(); p.reject(CANCEL); return true; }
      return false;
    };
    // typed input from the command line
    E.input = (text) => {
      const p = E.pending;
      if (!p) {   // start a command
        const t = text.trim();
        if (!t) { if (E.last) E.run(E.last); return; }
        const pt = E.parsePoint(t, null);
        if (pt) { ui.echo('Point or option keyword required.'); return; }
        E.run(t); return;
      }
      ui.echoInput(text);
      const kw = matchKw(text, p.kws);
      if (kw && p.kind !== 'string') return settle({ kw });
      const t = text.trim();
      if (!t && p.kind !== 'string') return settle(p.opts.def != null ? { value: p.opts.def, def: true } : { none: true });
      switch (p.kind) {
        case 'point': { const q = E.parsePoint(t, p.opts.base); if (!q) return ui.echo('Point or option keyword required.'); A.lastPt = q; return settle({ pt: q }); }
        case 'dist': case 'num': case 'int': {
          const n = evalNum(t); if (n != null) { if (p.kind === 'int' && (!Number.isInteger(n) || n < (p.opts.min ?? 1))) return ui.echo('Requires an integer' + (p.opts.min != null ? ' ≥ ' + p.opts.min : '') + '.'); if (p.opts.positive && n <= 0) return ui.echo('Value must be positive and nonzero.'); return settle({ value: n }); }
          const q = p.kind === 'dist' && p.opts.base ? E.parsePoint(t, p.opts.base) : null; if (q) return settle({ value: G.dist(p.opts.base, q), pt: q });
          return ui.echo(p.kind === 'dist' ? 'Requires a distance or a point.' : 'Requires a number.');
        }
        case 'angle': {
          const n = evalNum(t); if (n != null) return settle({ value: n * D2R });
          const q = p.opts.base ? E.parsePoint(t, p.opts.base) : null; if (q) return settle({ value: G.ang(q[0] - p.opts.base[0], q[1] - p.opts.base[1]), pt: q });
          return ui.echo('Requires an angle or a point.');
        }
        case 'string': return settle({ value: text });
        case 'kw': return ui.echo('Invalid option keyword.');
        case 'sel': {
          const u = t.toUpperCase();
          if (u === 'ALL') { const ids = A.doc.ents.filter(V.selectable).map(e => e.id); ids.forEach(id => p.opts.set.add(id)); ui.echo(`${ids.length} found`); return refreshSel(); }
          if (u === 'L') { const e = [...A.doc.ents].reverse().find(V.selectable); if (e) { p.opts.set.add(e.id); ui.echo('1 found'); } return refreshSel(); }
          if (u === 'P') { (A.prevSel || []).forEach(id => { if (A.doc.ents.some(e => e.id === id)) p.opts.set.add(id); }); ui.echo(`${(A.prevSel || []).length} found`); return refreshSel(); }
          if (u === 'R') { p.opts.remove = true; ui.setPrompt('Remove objects:', []); return; }
          if (u === 'A') { p.opts.remove = false; ui.setPrompt('Select objects:', []); return; }
          return ui.echo('Expects a point or Window/Last/ALL/Previous/Remove/Add');
        }
        case 'ent': return ui.echo('Select an object.');
      }
    };
    function refreshSel() { const p = E.pending; if (p && p.kind === 'sel') { A.selSet = new Set(p.opts.set); V.draw(); ui.setPrompt((p.opts.remove ? 'Remove objects' : 'Select objects') + ':', []); } }
    // pointer: a resolved point (already snapped / constrained) clicked in model space
    E.click = (pt, ev, screen) => {
      const p = E.pending; if (!p) return false;
      switch (p.kind) {
        case 'point': A.lastPt = pt; settle({ pt }); return true;
        case 'dist': settle({ value: G.dist(p.opts.base || pt, pt), pt }); return true;
        case 'angle': settle({ value: p.opts.base ? G.ang(pt[0] - p.opts.base[0], pt[1] - p.opts.base[1]) : 0, pt }); return true;
        case 'ent': {
          const e = V.pick(screen[0], screen[1], p.opts.filter); if (!e) { ui.echo('No object found' + (p.opts.filter ? ' (or wrong type).' : '.')); return true; }
          settle({ ent: e, pt: V.s2w(screen[0], screen[1]), shift: ev.shiftKey }); return true;
        }
        case 'sel': {
          const e = V.pick(screen[0], screen[1]);
          if (e) { if (p.opts.remove || ev.shiftKey) p.opts.set.delete(e.id); else p.opts.set.add(e.id); ui.echo(`1 ${p.opts.remove || ev.shiftKey ? 'removed' : 'found'}, ${p.opts.set.size} total`); refreshSel(); return true; }
          return false;   // let the app start a selection window
        }
      }
      return true;
    };
    E.windowDone = (ids) => { const p = E.pending; if (!p || p.kind !== 'sel') return; ids.forEach(id => p.opts.remove ? p.opts.set.delete(id) : p.opts.set.add(id)); ui.echo(`${ids.length} ${p.opts.remove ? 'removed' : 'found'}, ${p.opts.set.size} total`); refreshSel(); };
    E.enter = () => { if (E.pending) E.input(''); else if (E.last) E.run(E.last); };

    /* ---------- context API for commands ---------- */
    const C = {
      point: (prompt, opts) => request('point', prompt, opts),
      dist: (prompt, opts) => request('dist', prompt, opts),
      angle: (prompt, opts) => request('angle', prompt, opts),
      num: (prompt, opts) => request('num', prompt, opts),
      int: (prompt, opts) => request('int', prompt, opts),
      str: (prompt, opts) => request('string', prompt, opts),
      kw: (prompt, opts) => request('kw', prompt, opts),
      ent: (prompt, opts) => request('ent', prompt, opts),
      async sel(prompt = 'Select objects', opts = {}) {
        if (A.pickfirst && A.selSet.size) { const ids = [...A.selSet].filter(id => A.doc.ents.some(e => e.id === id && V.selectable(e))); A.pickfirst = false; if (ids.length) { A.prevSel = ids; A.selSet = new Set(); V.draw(); return ids.map(id => A.doc.ents.find(e => e.id === id)); } }
        A.pickfirst = false;
        const set = new Set(); A.selSet = set; V.draw();
        for (;;) {
          const r = await request('sel', prompt, { set, ...opts });
          if (r.none || r.kw) break;
        }
        A.selSet = new Set(); V.draw();
        if (!set.size) throw CANCEL;
        A.prevSel = [...set];
        return A.doc.ents.filter(e => set.has(e.id));
      },
      msg: s => ui.echo(s),
      props() { const o = { layer: A.doc.cur }; if (A.curColor != null && A.curColor !== 256) o.color = A.curColor; if (A.curLt && A.curLt !== 'BYLAYER') o.lt = A.curLt; if (A.curLw != null && A.curLw !== -1) o.lw = A.curLw; return o; },
      add(e, keepProps) { const n = keepProps ? { ...e } : { ...C.props(), ...e }; n.id = A.doc.nextId++; A.doc.ents.push(n); C.changed(); return n; },
      replace(old, news) {
        const i = A.doc.ents.indexOf(old); if (i < 0) return [];
        const made = news.filter(Boolean).map(x => ({ ...x, id: A.doc.nextId++ }));
        A.doc.ents.splice(i, 1, ...made); C.changed(); return made;
      },
      update(old, neu) { const i = A.doc.ents.indexOf(old); if (i < 0) return null; const n = { ...neu, id: old.id }; A.doc.ents[i] = n; C.changed(); return n; },
      remove(ents) { const s = new Set(ents.map(e => e.id)); A.doc.ents = A.doc.ents.filter(e => !s.has(e.id)); C.changed(); },
      changed() { A.cmdChanged = true; V.invalidate(); V.draw(); },
      others(e) { return A.doc.ents.filter(o => o !== e && M.isVisible(A.doc, o)); },
      byId: id => A.doc.ents.find(e => e.id === id),
    };
    E.C = C;

    /* ---------- running ---------- */
    const REG = {}, ALIAS = {};
    const def = (name, aliases, desc, fn, flags = {}) => { REG[name] = { name, desc, fn, ...flags, aliases }; ALIAS[name] = name; aliases.forEach(a => ALIAS[a] = name); };
    E.REG = REG; E.ALIAS = ALIAS;
    E.resolve = t => ALIAS[String(t).trim().toUpperCase().replace(/^[_.\-']+/, '')];
    E.running = () => !!cmdName;
    E.run = async (text) => {
      const name = E.resolve(text);
      if (!name) { ui.echo(`Unknown command "${String(text).trim().toUpperCase()}". Press F1 for the command list.`); return; }
      const cmd = REG[name];
      if (cmdName) { E.cancel(); await new Promise(r => setTimeout(r, 0)); }
      const myTok = ++runTok;
      if (A.space !== 'model' && !cmd.anySpace) { ui.setSpace('model'); }
      cmdName = name; E.last = cmd.noRepeat ? E.last : name; A.busy = true; A.cmdChanged = false;
      A.pickfirst = !!cmd.pickfirst && A.selSet.size > 0;
      if (!cmd.pickfirst && A.selSet.size && !cmd.keepSel) { A.selSet = new Set(); V.draw(); ui.refreshPanels(); }
      ui.echoCmd(name); ui.cmdState(name);
      try { await cmd.fn(C); }
      catch (err) { if (err === CANCEL) ui.echo('*Cancel*'); else { console.error(err); ui.echo('Error: ' + (err.message || err)); } }
      finally {
        if (A.cmdChanged) ui.commit(cmd.label || name);
        A.cmdChanged = false;
        if (myTok === runTok) {
          if (E.pending) { E.pending = null; }
          A.preview = null; A.rubber = null; A.base = null; A.wantsPick = false; A.winSel = null; A.track = null; A.trackTip = null; A.dynTip = null;
          cmdName = ''; A.busy = false; A.pickfirst = false;
          ui.setPrompt('Command:', []); ui.cmdState(''); V.draw(); V.overlay();
        }
      }
    };

    /* ---------- helpers ---------- */
    const curve = e => ['line', 'arc', 'circle', 'pline'].includes(e.type);
    const lineAt = (a, b) => ({ type: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    const rectPts = (a, b) => [[a[0], a[1], 0], [b[0], a[1], 0], [b[0], b[1], 0], [a[0], b[1], 0]];
    const xf = (ents, T) => ents.map(e => G.transform(e, T));
    const previewOf = (ents, T) => ents.slice(0, 400).map(e => G.transform(e, T));
    function circle3(a, b, c) {
      const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (Math.abs(d) < 1e-12) return null;
      const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
      const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
      return { cx: x, cy: y, r: Math.hypot(a[0] - x, a[1] - y) };
    }
    function arc3(a, b, c) {
      const k = circle3(a, b, c); if (!k) return null;
      const aa = G.ang(a[0] - k.cx, a[1] - k.cy), ab = G.ang(b[0] - k.cx, b[1] - k.cy), ac = G.ang(c[0] - k.cx, c[1] - k.cy);
      return G.ccw(aa, ab) < G.ccw(aa, ac) ? { type: 'arc', ...k, a1: G.normA(aa), a2: G.normA(ac) } : { type: 'arc', ...k, a1: G.normA(ac), a2: G.normA(aa) };
    }
    E.arc3 = arc3; E.circle3 = circle3;
    function cutsFor(e) {
      const pe = G.primsOf(e), out = [], bb = V.bbOf(e);
      for (const o of C.others(e)) {
        if (o.type === 'text' || o.type === 'mtext' || o.type === 'point') continue;
        const ob = V.bbOf(o); if (!G.bbOverlap(bb, ob, 1e-6)) continue;
        for (const q of V.primsOf(o)) for (const p of pe) out.push(...G.interPrims(p, q));
      }
      if (e.type === 'pline') for (let i = 0; i < pe.length; i++) for (let j = i + 2; j < pe.length; j++) { if (e.closed && i === 0 && j === pe.length - 1) continue; out.push(...G.interPrims(pe[i], pe[j])); }
      return G.uniqPts(out);
    }
    function boundsFor(e) { const out = []; for (const o of C.others(e)) if (o.type !== 'text' && o.type !== 'mtext' && o.type !== 'point') out.push(...V.primsOf(o)); return out; }

    /* ======================= DRAW ======================= */
    def('LINE', ['L'], 'Draws straight line segments', async () => {
      let r = await C.point('Specify first point'); const first = r.pt; let prev = first; const made = [];
      for (;;) {
        const opts = made.length >= 2 ? '[Close/Undo]' : '[Undo]';
        r = await C.point(`Specify next point or ${opts}`, { base: prev, preview: q => [lineAt(prev, q)] });
        if (r.none) break;
        if (r.kw === 'Undo') { if (made.length) { const e = made.pop(); C.remove([e]); prev = [e.x1, e.y1]; A.lastPt = prev; } else C.msg('All segments already undone.'); continue; }
        if (r.kw === 'Close') { made.push(C.add(lineAt(prev, first))); A.lastPt = first; break; }
        made.push(C.add(lineAt(prev, r.pt))); prev = r.pt;
      }
    });
    def('PLINE', ['PL'], 'Draws a polyline of line and arc segments', async () => {
      let r = await C.point('Specify start point'); const pts = [[r.pt[0], r.pt[1], 0]]; let arcMode = false, width = A.plWidth || 0, dir = null;
      C.msg(`Current line-width is ${f4(width)}`);
      const tangentBulge = (p, q, d) => { if (!d) return 0; const cx = q[0] - p[0], cy = q[1] - p[1], l = Math.hypot(cx, cy); if (l < 1e-12) return 0; const phi = Math.atan2(G.cross(d[0], d[1], cx, cy), d[0] * cx + d[1] * cy); return Math.tan(phi / 2); };
      const endDir = () => {
        const n = pts.length; if (n < 2) return dir;
        const p = pts[n - 2], q = pts[n - 1], b = p[2] || 0;
        if (!b) { const l = G.dist(p, q); return l ? [(q[0] - p[0]) / l, (q[1] - p[1]) / l] : dir; }
        const a = G.bulgeArc(p, q, b), ea = a.a0 + a.th, s = Math.sign(a.th); return [-Math.sin(ea) * s, Math.cos(ea) * s];
      };
      const make = (closed) => ({ type: 'pline', pts: pts.map(p => p.slice()), closed, ...(width > 0 ? { w: width } : {}) });
      for (;;) {
        const last = pts[pts.length - 1], d0 = endDir();
        const prompt = arcMode ? 'Specify endpoint of arc or [Close/Line/Undo/Width]' : `Specify next point or [Arc${pts.length > 2 ? '/Close' : ''}/Undo/Width]`;
        const prev = q => { const tmp = pts.map(p => p.slice()); if (arcMode) tmp[tmp.length - 1][2] = tangentBulge(last, q, d0 || [1, 0]); tmp.push([q[0], q[1], 0]); return [{ type: 'pline', pts: tmp, closed: false, ...(width > 0 ? { w: width } : {}) }]; };
        r = await C.point(prompt, { base: last, preview: prev, noRubber: arcMode });
        if (r.none) break;
        if (r.kw === 'Arc') { arcMode = true; continue; }
        if (r.kw === 'Line') { arcMode = false; continue; }
        if (r.kw === 'Width') { const w = await C.dist('Specify width', { def: width, base: last }); width = Math.max(0, w.value); A.plWidth = width; continue; }
        if (r.kw === 'Undo') { if (pts.length > 1) { pts.pop(); pts[pts.length - 1][2] = 0; } continue; }
        if (r.kw === 'Close') { if (arcMode) pts[pts.length - 1][2] = tangentBulge(last, pts[0], d0 || [1, 0]); C.add(make(true)); return; }
        if (arcMode) last[2] = tangentBulge(last, r.pt, d0 || [1, 0]);
        if (!dir && !arcMode) dir = null;
        pts.push([r.pt[0], r.pt[1], 0]);
      }
      if (pts.length >= 2) C.add(make(false));
    });
    def('CIRCLE', ['C'], 'Draws a circle', async () => {
      let r = await C.point('Specify center point for circle or [3P/2P/Ttr]');
      if (r.kw === '3P') {
        const a = (await C.point('Specify first point on circle')).pt, b = (await C.point('Specify second point on circle', { base: a })).pt;
        const c = await C.point('Specify third point on circle', { base: b, preview: q => { const k = circle3(a, b, q); return k ? [{ type: 'circle', ...k }] : []; } });
        const k = circle3(a, b, c.pt); if (!k) throw new Error('Points are collinear'); C.add({ type: 'circle', ...k }); return;
      }
      if (r.kw === '2P') {
        const a = (await C.point('Specify first end point of circle\'s diameter')).pt;
        const b = await C.point('Specify second end point of circle\'s diameter', { base: a, preview: q => [{ type: 'circle', cx: (a[0] + q[0]) / 2, cy: (a[1] + q[1]) / 2, r: Math.max(1e-9, G.dist(a, q) / 2) }] });
        C.add({ type: 'circle', cx: (a[0] + b.pt[0]) / 2, cy: (a[1] + b.pt[1]) / 2, r: G.dist(a, b.pt) / 2 }); return;
      }
      if (r.kw === 'Ttr') {
        const t1 = await C.ent('Specify point on object for first tangent of circle', { filter: e => ['line', 'circle', 'arc'].includes(e.type) });
        const t2 = await C.ent('Specify point on object for second tangent of circle', { filter: e => ['line', 'circle', 'arc'].includes(e.type) });
        const rad = (await C.dist('Specify radius of circle', { def: A.lastR || 10, positive: true })).value;
        const k = E.ttr(t1.ent, t1.pt, t2.ent, t2.pt, rad); if (!k) throw new Error('Circle does not exist'); A.lastR = rad; C.add({ type: 'circle', ...k }); return;
      }
      const c = r.pt;
      const rr = await C.dist('Specify radius of circle or [Diameter]', { base: c, def: A.lastR, preview: q => [{ type: 'circle', cx: c[0], cy: c[1], r: Math.max(1e-9, G.dist(c, q)) }] });
      let rad = rr.value;
      if (rr.kw === 'Diameter') { const d = await C.dist('Specify diameter of circle', { base: c, def: (A.lastR || 5) * 2, preview: q => [{ type: 'circle', cx: c[0], cy: c[1], r: Math.max(1e-9, G.dist(c, q) / 2) }] }); rad = d.value / 2; }
      if (!(rad > 0)) throw new Error('Radius must be positive');
      A.lastR = rad; C.add({ type: 'circle', cx: c[0], cy: c[1], r: rad });
    });
    E.ttr = (e1, p1, e2, p2, r) => {
      const offs = (e, p) => {
        if (e.type === 'line') { const out = []; for (const s of [1, -1]) { const dx = e.x2 - e.x1, dy = e.y2 - e.y1, l = Math.hypot(dx, dy), nx = -dy / l * r * s, ny = dx / l * r * s; out.push(G.L(e.x1 + nx, e.y1 + ny, e.x2 + nx, e.y2 + ny)); } return out; }
        return [G.A(e.cx, e.cy, e.r + r, 0, G.TAU), ...(e.r > r ? [G.A(e.cx, e.cy, e.r - r, 0, G.TAU)] : []), ...(r > e.r ? [G.A(e.cx, e.cy, r - e.r, 0, G.TAU)] : [])];
      };
      let best = null, bd = Infinity;
      for (const a of offs(e1, p1)) for (const b of offs(e2, p2)) for (const q of G.interPrims(a, b, true, true)) { const d = G.dist(q, p1) + G.dist(q, p2); if (d < bd) { bd = d; best = q; } }
      return best ? { cx: best[0], cy: best[1], r } : null;
    };
    def('ARC', ['A'], 'Draws an arc (3 points or centre, start, end)', async () => {
      let r = await C.point('Specify start point of arc or [Center]');
      if (r.kw === 'Center') {
        const c = (await C.point('Specify center point of arc')).pt, s = (await C.point('Specify start point of arc', { base: c })).pt, rad = G.dist(c, s), a1 = G.ang(s[0] - c[0], s[1] - c[1]);
        const e = await C.point('Specify end point of arc (CCW) or [Angle]', { base: c, preview: q => [{ type: 'arc', cx: c[0], cy: c[1], r: rad, a1, a2: G.ang(q[0] - c[0], q[1] - c[1]) }] });
        let a2;
        if (e.kw === 'Angle') { const an = await C.angle('Specify included angle', { def: 90 * D2R, defText: '90' }); a2 = a1 + an.value; } else a2 = G.ang(e.pt[0] - c[0], e.pt[1] - c[1]);
        C.add({ type: 'arc', cx: c[0], cy: c[1], r: rad, a1: G.normA(a1), a2: G.normA(a2) }); return;
      }
      const a = r.pt, b = (await C.point('Specify second point of arc', { base: a })).pt;
      const c = await C.point('Specify end point of arc', { base: b, preview: q => { const k = arc3(a, b, q); return k ? [k] : []; } });
      const k = arc3(a, b, c.pt); if (!k) throw new Error('Points are collinear'); C.add(k);
    });
    def('RECTANG', ['REC', 'RECTANGLE'], 'Draws a rectangular polyline', async () => {
      const a = (await C.point('Specify first corner point')).pt;
      let r = await C.point('Specify other corner point or [Dimensions]', { base: a, noRubber: true, preview: q => [{ type: 'pline', pts: rectPts(a, q), closed: true }] });
      if (r.kw === 'Dimensions') {
        const w = (await C.dist('Specify length for rectangles', { def: A.recW || 10, base: a, positive: true })).value, h = (await C.dist('Specify width for rectangles', { def: A.recH || 10, base: a, positive: true })).value;
        A.recW = w; A.recH = h;
        r = await C.point('Specify other corner point (side)', { base: a, noRubber: true, preview: q => [{ type: 'pline', pts: rectPts(a, [a[0] + Math.sign(q[0] - a[0] || 1) * w, a[1] + Math.sign(q[1] - a[1] || 1) * h]), closed: true }] });
        r.pt = [a[0] + Math.sign(r.pt[0] - a[0] || 1) * w, a[1] + Math.sign(r.pt[1] - a[1] || 1) * h];
      }
      if (Math.abs(r.pt[0] - a[0]) < 1e-12 || Math.abs(r.pt[1] - a[1]) < 1e-12) throw new Error('Rectangle has zero size');
      C.add({ type: 'pline', pts: rectPts(a, r.pt), closed: true });
    });
    def('POLYGON', ['POL'], 'Draws a regular polygon', async () => {
      const n = (await C.int('Enter number of sides', { def: A.polyN || 6, min: 3 })).value; A.polyN = n;
      const c = (await C.point('Specify center of polygon')).pt;
      const k = await C.kw('Enter an option [Inscribed in circle/Circumscribed about circle]', { def: 'Inscribed in circle', defText: 'I', kws: ['Inscribed in circle', 'Circumscribed about circle'] });
      const ins = (k.kw || k.value) !== 'Circumscribed about circle';
      const mk = q => { const r = G.dist(c, q), a0 = G.ang(q[0] - c[0], q[1] - c[1]) - (ins ? 0 : Math.PI / n), R = ins ? r : r / Math.cos(Math.PI / n), pts = []; for (let i = 0; i < n; i++) { const a = a0 + i * 2 * Math.PI / n; pts.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a), 0]); } return { type: 'pline', pts, closed: true }; };
      const r = await C.point('Specify radius of circle', { base: c, preview: q => [mk(q)] });
      C.add(mk(r.pt));
    });
    def('POINT', ['PO'], 'Places point objects', async () => { for (;;) { const r = await C.point('Specify a point'); if (r.none) break; C.add({ type: 'point', x: r.pt[0], y: r.pt[1] }); } });

    /* ======================= MODIFY ======================= */
    def('ERASE', ['E', 'DELETE'], 'Erases objects', async () => { const ents = await C.sel(); C.remove(ents); C.msg(`${ents.length} erased`); }, { pickfirst: true });
    def('MOVE', ['M'], 'Moves objects', async () => {
      const ents = await C.sel();
      const b = await C.point('Specify base point or [Displacement]', { def: 'Displacement', defText: 'Displacement' });
      let d;
      if (b.kw || b.def) { const r = await C.point('Specify displacement', { def: '0,0' }); const q = r.pt || [0, 0]; d = q; }
      else {
        const r = await C.point('Specify second point or <use first point as displacement>', { base: b.pt, preview: q => previewOf(ents, G.Tmove(q[0] - b.pt[0], q[1] - b.pt[1])) });
        d = r.none ? b.pt : [r.pt[0] - b.pt[0], r.pt[1] - b.pt[1]];
      }
      const T = G.Tmove(d[0], d[1]); ents.forEach(e => C.update(e, G.transform(e, T)));
    }, { pickfirst: true });
    def('COPY', ['CO', 'CP'], 'Copies objects', async () => {
      const ents = await C.sel();
      const b = await C.point('Specify base point'); let n = 0;
      for (;;) {
        const r = await C.point('Specify second point or [Undo] <exit>', { base: b.pt, preview: q => previewOf(ents, G.Tmove(q[0] - b.pt[0], q[1] - b.pt[1])) });
        if (r.none) break; if (r.kw === 'Undo') { if (n) { A.doc.ents.splice(A.doc.ents.length - ents.length, ents.length); n--; C.changed(); } continue; }
        const T = G.Tmove(r.pt[0] - b.pt[0], r.pt[1] - b.pt[1]); ents.forEach(e => C.add(G.transform(e, T), true)); n++;
      }
    }, { pickfirst: true });
    def('ROTATE', ['RO'], 'Rotates objects about a base point', async () => {
      const ents = await C.sel(); const b = (await C.point('Specify base point')).pt; let copy = false;
      let r;
      for (;;) {
        r = await C.angle(`Specify rotation angle or [Copy/Reference]`, { base: b, def: A.lastRot ?? 0, defText: f4((A.lastRot ?? 0) * R2D), preview: q => previewOf(ents, G.Trot(b[0], b[1], G.ang(q[0] - b[0], q[1] - b[1]))) });
        if (r.kw === 'Copy') { copy = true; C.msg('Rotating a copy of the selected objects.'); continue; }
        if (r.kw === 'Reference') {
          const ra = await C.angle('Specify the reference angle', { def: 0, defText: '0', base: b }); const na = await C.angle('Specify the new angle', { base: b, preview: q => previewOf(ents, G.Trot(b[0], b[1], G.ang(q[0] - b[0], q[1] - b[1]) - ra.value)) });
          r = { value: na.value - ra.value };
        }
        break;
      }
      A.lastRot = r.value; const T = G.Trot(b[0], b[1], r.value);
      ents.forEach(e => copy ? C.add(G.transform(e, T), true) : C.update(e, G.transform(e, T)));
    }, { pickfirst: true });
    def('SCALE', ['SC'], 'Enlarges or reduces objects', async () => {
      const ents = await C.sel(); const b = (await C.point('Specify base point')).pt; let copy = false, r;
      for (;;) {
        r = await C.dist('Specify scale factor or [Copy/Reference]', { base: b, def: A.lastScale ?? 1, positive: true, preview: q => { const k = G.dist(b, q); return k > 1e-9 ? previewOf(ents, G.Tscale(b[0], b[1], k)) : []; } });
        if (r.kw === 'Copy') { copy = true; continue; }
        if (r.kw === 'Reference') { const a = await C.dist('Specify reference length', { def: 1, base: b, positive: true }); const n2 = await C.dist('Specify new length', { base: b, positive: true }); r = { value: n2.value / a.value }; }
        break;
      }
      if (!(r.value > 0)) throw new Error('Scale factor must be positive');
      A.lastScale = r.value; const T = G.Tscale(b[0], b[1], r.value);
      ents.forEach(e => copy ? C.add(G.transform(e, T), true) : C.update(e, G.transform(e, T)));
    }, { pickfirst: true });
    def('MIRROR', ['MI'], 'Creates a mirrored copy of objects', async () => {
      const ents = await C.sel(); const a = (await C.point('Specify first point of mirror line')).pt;
      const b = (await C.point('Specify second point of mirror line', { base: a, preview: q => G.dist(a, q) > 1e-9 ? previewOf(ents, G.Tmirror(a[0], a[1], q[0], q[1])) : [] })).pt;
      if (G.dist(a, b) < 1e-12) throw new Error('Mirror line has zero length');
      const k = await C.kw('Erase source objects? [Yes/No]', { def: 'No', defText: 'N' });
      const T = G.Tmirror(a[0], a[1], b[0], b[1]);
      if ((k.kw || k.value) === 'Yes') ents.forEach(e => C.update(e, G.transform(e, T))); else ents.forEach(e => C.add(G.transform(e, T), true));
    }, { pickfirst: true });
    def('OFFSET', ['O'], 'Creates parallel lines, concentric circles and parallel polylines', async () => {
      let r = await C.dist('Specify offset distance or [Through]', { def: A.offDist != null ? A.offDist : 'Through', defText: A.offDist != null ? f4(A.offDist) : 'Through', positive: true });
      const through = r.kw === 'Through' || r.value === 'Through'; if (!through) A.offDist = r.value; else A.offDist = null;
      const made = [];
      for (;;) {
        const s = await C.ent('Select object to offset or [Undo] <exit>', { filter: curve });
        if (s.none) break; if (s.kw === 'Undo') { const e = made.pop(); if (e) C.remove([e]); continue; }
        const e = s.ent;
        const side = await C.point(through ? 'Specify through point' : 'Specify point on side to offset', { preview: q => { const o = through ? G.offsetThrough(e, q) : G.offset(e, A.offDist, q); return o ? [o] : []; } });
        if (side.none) continue;
        const o = through ? G.offsetThrough(e, side.pt) : G.offset(e, A.offDist, side.pt);
        if (!o) { C.msg('Cannot offset that object by that distance.'); continue; }
        made.push(C.add({ ...o }, true));
      }
    });
    def('TRIM', ['TR'], 'Trims objects to meet the edges of other objects', async () => {
      C.msg('Current settings: Quick mode — all objects act as cutting edges. Shift-select to extend.');
      const undo = [];
      for (;;) {
        const s = await C.ent('Select object to trim or shift-select to extend or [Undo]', { filter: curve, preview: null });
        if (s.none) break; if (s.kw === 'Undo') { const u = undo.pop(); if (u) { A.doc.ents = u; C.changed(); } else C.msg('Nothing to undo.'); continue; }
        const e = s.ent; undo.push(A.doc.ents.slice());
        if (s.shift) { const x = G.extend(e, boundsFor(e), s.pt); if (!x) { C.msg('Object does not intersect an edge.'); undo.pop(); } else C.update(e, x); continue; }
        const res = G.trimAt(e, cutsFor(e), s.pt);
        if (res == null) { C.msg('Cannot trim: the object needs two cutting edges.'); undo.pop(); continue; }
        C.replace(e, res);
      }
    });
    def('EXTEND', ['EX'], 'Extends objects to meet the edges of other objects', async () => {
      C.msg('Current settings: Quick mode — all objects act as boundary edges. Shift-select to trim.');
      const undo = [];
      for (;;) {
        const s = await C.ent('Select object to extend or shift-select to trim or [Undo]', { filter: curve });
        if (s.none) break; if (s.kw === 'Undo') { const u = undo.pop(); if (u) { A.doc.ents = u; C.changed(); } continue; }
        const e = s.ent; undo.push(A.doc.ents.slice());
        if (s.shift) { const res = G.trimAt(e, cutsFor(e), s.pt); if (res == null) undo.pop(); else C.replace(e, res); continue; }
        const x = G.extend(e, boundsFor(e), s.pt);
        if (!x) { C.msg('Object does not intersect an edge.'); undo.pop(); continue; }
        C.update(e, x);
      }
    });
    async function corner(kind) {
      const isF = kind === 'fillet';
      for (;;) {
        C.msg(isF ? `Current settings: Radius = ${f4(A.filletR)}` : `Current chamfer Dist1 = ${f4(A.chamD1)}, Dist2 = ${f4(A.chamD2)}`);
        const s1 = await C.ent(`Select first object or [Undo/Polyline/${isF ? 'Radius' : 'Distance'}]`, { filter: e => e.type === 'line' || e.type === 'pline' });
        if (s1.kw === 'Radius') { A.filletR = Math.max(0, (await C.dist('Specify fillet radius', { def: A.filletR })).value); continue; }
        if (s1.kw === 'Distance') { A.chamD1 = Math.max(0, (await C.dist('Specify first chamfer distance', { def: A.chamD1 })).value); A.chamD2 = Math.max(0, (await C.dist('Specify second chamfer distance', { def: A.chamD1 })).value); continue; }
        if (s1.kw === 'Undo') { C.msg('Nothing to undo in this command — use U after it.'); continue; }
        if (s1.none) return;
        if (s1.kw === 'Polyline' || s1.ent.type === 'pline') {
          const pl = s1.ent && s1.ent.type === 'pline' ? s1.ent : (await C.ent('Select 2D polyline', { filter: e => e.type === 'pline' })).ent;
          const r = isF ? G.cornerPline(pl, A.filletR) : G.cornerPline(pl, A.chamD1, true, A.chamD2);
          if (isF && A.filletR <= 0) { C.msg('Set a radius greater than 0 first.'); continue; }
          C.update(pl, r.ent); C.msg(`${r.count} lines were ${isF ? 'filleted' : 'chamfered'}`); return;
        }
        const l1 = s1.ent;
        const prevF = q => {
          const o = V.pick(...V.w2s(q[0], q[1]), e => e.type === 'line' && e !== l1); if (!o) return [];
          const r = isF ? G.filletLines(l1, s1.pt, o, q, A.filletR) : G.chamferLines(l1, s1.pt, o, q, A.chamD1, A.chamD2);
          return r.error ? [] : [r.a, r.b, r.arc || r.line].filter(Boolean);
        };
        const s2 = await C.ent('Select second object', { filter: e => e.type === 'line' && e !== l1, previewPick: prevF });
        const l2 = s2.ent; if (!l2) return;
        const r = isF ? G.filletLines(l1, s1.pt, l2, s2.pt, A.filletR) : G.chamferLines(l1, s1.pt, l2, s2.pt, A.chamD1, A.chamD2);
        if (r.error) throw new Error(r.error);
        if (r.a) C.update(l1, r.a); else C.remove([l1]);
        if (r.b) C.update(l2, r.b); else C.remove([l2]);
        if (r.arc || r.line) C.add({ ...(r.arc || r.line) }, true);
        return;
      }
    }
    def('FILLET', ['F'], 'Rounds the corner between two lines (or all corners of a polyline)', () => corner('fillet'));
    def('CHAMFER', ['CHA'], 'Bevels the corner between two lines (or all corners of a polyline)', () => corner('chamfer'));
    def('ARRAY', ['AR'], 'Creates rectangular or polar copies', async () => {
      const ents = await C.sel();
      const t = await C.kw('Enter array type [Rectangular/Polar]', { def: 'Rectangular', defText: 'R' }); const type = t.kw || t.value;
      if (type === 'Polar') {
        const c = (await C.point('Specify center point of array')).pt;
        const n = (await C.int('Enter number of items', { def: A.arrN || 6, min: 2 })).value; A.arrN = n;
        const fill = (await C.num('Specify the angle to fill (+=ccw, -=cw)', { def: 360 })).value;
        const rot = await C.kw('Rotate arrayed objects? [Yes/No]', { def: 'Yes', defText: 'Y' }); const doRot = (rot.kw || rot.value) === 'Yes';
        const step = Math.abs(fill) >= 360 ? 2 * Math.PI / n : fill * D2R / (n - 1);
        for (let i = 1; i < n; i++) {
          const a = step * i, T = doRot ? G.Trot(c[0], c[1], a) : null;
          ents.forEach(e => { if (doRot) return C.add(G.transform(e, T), true); const b = V.bbOf(e), m = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], q = G.Tpt(G.Trot(c[0], c[1], a), m[0], m[1]); C.add(G.transform(e, G.Tmove(q[0] - m[0], q[1] - m[1])), true); });
        }
        C.msg(`${n} items around ${fpt(c)}`); return;
      }
      const bb = M.extents(A.doc, ents) || [0, 0, 10, 10];
      const rows = (await C.int('Enter the number of rows', { def: A.arrR || 3, min: 1 })).value, cols = (await C.int('Enter the number of columns', { def: A.arrC || 4, min: 1 })).value; A.arrR = rows; A.arrC = cols;
      const dy = rows > 1 ? (await C.dist('Specify the distance between rows', { def: +((bb[3] - bb[1]) * 1.5 || 10).toFixed(4) })).value : 0;
      const dx = cols > 1 ? (await C.dist('Specify the distance between columns', { def: +((bb[2] - bb[0]) * 1.5 || 10).toFixed(4) })).value : 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { if (!r && !c) continue; const T = G.Tmove(c * dx, r * dy); ents.forEach(e => C.add(G.transform(e, T), true)); }
      C.msg(`${rows} × ${cols} array created`);
    }, { pickfirst: true });
    def('EXPLODE', ['X'], 'Breaks a compound object into its components', async () => {
      const ents = await C.sel(); let n = 0;
      for (const e of ents) { const parts = M.explode(A.doc, e); if (!parts) continue; C.replace(e, parts.map(p => ({ ...p, layer: p.layer || e.layer }))); n++; }
      C.msg(n ? `${n} object${n > 1 ? 's' : ''} exploded` : 'Nothing could be exploded.');
    }, { pickfirst: true });
    def('JOIN', ['J'], 'Joins lines, arcs and open polylines end to end into polylines', async () => {
      const ents = (await C.sel()).filter(e => e.type === 'line' || e.type === 'arc' || (e.type === 'pline' && !e.closed));
      const chains = ents.map(e => ({ src: e, pts: e.type === 'line' ? [[e.x1, e.y1, 0], [e.x2, e.y2, 0]] : e.type === 'arc' ? (() => { const s = G.pointAt(e, 0), sw = G.arcSweep(e.a1, e.a2), q = G.pointAt(e, sw); return [[s[0], s[1], G.bulgeOf(sw)], [q[0], q[1], 0]]; })() : e.pts.map(p => [p[0], p[1], p[2] || 0]) }));
      const rev = pts => { const n = pts.length, out = []; for (let i = n - 1; i >= 0; i--) out.push([pts[i][0], pts[i][1], i > 0 ? -(pts[i - 1][2] || 0) : 0]); return out; };
      const tol = 1e-6, same = (a, b) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
      const results = [];
      while (chains.length) {
        const c = chains.shift(), used = [c.src]; let pts = c.pts, grew = true;
        while (grew) {
          grew = false;
          for (let i = 0; i < chains.length; i++) {
            const o = chains[i], s = o.pts[0], e = o.pts[o.pts.length - 1], head = pts[0], tail = pts[pts.length - 1];
            let add = null;
            if (same(tail, s)) { pts = pts.slice(0, -1).concat([[tail[0], tail[1], o.pts[0][2]]], o.pts.slice(1)); add = o; }
            else if (same(tail, e)) { const r = rev(o.pts); pts = pts.slice(0, -1).concat([[tail[0], tail[1], r[0][2]]], r.slice(1)); add = o; }
            else if (same(head, e)) { pts = o.pts.slice(0, -1).concat(pts); add = o; }
            else if (same(head, s)) { pts = rev(o.pts).slice(0, -1).concat(pts); add = o; }
            if (add) { chains.splice(i, 1); used.push(add.src); grew = true; break; }
          }
        }
        if (used.length > 1) { const closed = pts.length > 3 && same(pts[0], pts[pts.length - 1]); if (closed) pts.pop(); results.push({ used, pl: { ...G.strip(used[0]), type: 'pline', pts, closed } }); }
      }
      let n = 0; for (const r of results) { C.replace(r.used[0], [r.pl]); C.remove(r.used.slice(1)); n += r.used.length; }
      C.msg(n ? `${n} objects joined into ${results.length} polyline${results.length > 1 ? 's' : ''}` : 'No objects share endpoints — nothing joined.');
    }, { pickfirst: true });
    def('BREAK', ['BR'], 'Breaks an object between two points', async () => {
      const s = await C.ent('Select object', { filter: curve });
      let p1 = s.pt; const nn = q => { let best = q, bd = Infinity; for (const p of G.primsOf(s.ent)) { const n2 = G.primNearest(p, q[0], q[1]); if (n2.d < bd) { bd = n2.d; best = [n2.x, n2.y]; } } return best; };
      let r = await C.point('Specify second break point or [First point]');
      if (r.kw === 'First point') { p1 = (await C.point('Specify first break point')).pt; r = await C.point('Specify second break point'); }
      const res = G.breakAt(s.ent, nn(p1), nn(r.pt || p1)); if (!res) throw new Error('Cannot break this object');
      C.replace(s.ent, res);
    });
    def('MATCHPROP', ['MA', 'PAINTER'], 'Copies layer, colour, linetype and lineweight from one object to others', async () => {
      const src = (await C.ent('Select source object')).ent;
      C.msg('Current active settings: Color Layer Ltype Lineweight Hatch Text');
      for (;;) {
        const d = await C.ent('Select destination object(s)'); if (d.none) break;
        const n = { ...d.ent, layer: src.layer }; for (const k of ['color', 'lt', 'lw', 'lts']) { if (src[k] === undefined) delete n[k]; else n[k] = src[k]; }
        if (src.type === 'hatch' && n.type === 'hatch') { n.pat = src.pat; n.sc = src.sc; n.ang = src.ang; }
        if ((src.type === 'text' || src.type === 'mtext') && (n.type === 'text' || n.type === 'mtext')) n.h = src.h;
        C.update(d.ent, n);
      }
    });

    /* ======================= ANNOTATE ======================= */
    def('HATCH', ['H', 'BH', 'BHATCH'], 'Fills an enclosed area with a hatch pattern', async () => {
      const hs = A.hatch; let n = 0;
      for (;;) {
        C.msg(`Pattern ${hs.pat} · scale ${f4(hs.sc)} · angle ${fa(hs.ang)}`);
        const r = await C.point('Pick internal point or [Select objects/Pattern/Scale/Angle/seTtings/Undo]');
        if (r.none) break;
        if (r.kw === 'seTtings') { await ui.hatchDialog(); continue; }
        if (r.kw === 'Pattern') { const p = await C.str(`Enter a pattern name (${Object.keys(M.PATTERNS).join(', ')})`, { def: hs.pat }); const v = String(p.value || '').trim().toUpperCase(); if (M.PATTERNS[v]) hs.pat = v; else if (v) C.msg('Unknown pattern.'); continue; }
        if (r.kw === 'Scale') { hs.sc = (await C.num('Specify a scale for the pattern', { def: hs.sc, positive: true })).value; continue; }
        if (r.kw === 'Angle') { hs.ang = (await C.angle('Specify an angle for the pattern', { def: hs.ang, defText: f4(hs.ang * R2D) })).value; continue; }
        if (r.kw === 'Undo') { const last = A.doc.ents[A.doc.ents.length - 1]; if (n && last && last.type === 'hatch') { C.remove([last]); n--; } continue; }
        let loops = null;
        if (r.kw === 'Select objects') {
          const ents = await C.sel('Select closed objects'); loops = [];
          for (const e of ents) { if (e.type === 'circle') loops.push({ pts: [[e.cx - e.r, e.cy, 1], [e.cx + e.r, e.cy, 1]] }); else if (e.type === 'pline' && (e.closed || G.dist(e.pts[0], e.pts[e.pts.length - 1]) < 1e-9)) loops.push({ pts: e.pts.map(p => [p[0], p[1], p[2] || 0]) }); }
          if (!loops.length) { C.msg('No closed polylines or circles selected.'); continue; }
        } else {
          const prims = [];
          for (const e of A.doc.ents) { if (!M.isVisible(A.doc, e) || ['text', 'mtext', 'dim', 'hatch', 'point', 'solid'].includes(e.type)) continue; prims.push(...V.primsOf(e)); }
          loops = G.findBoundary(prims, r.pt[0], r.pt[1]);
          if (!loops) { C.msg('Valid hatch boundary not found — the area must be fully enclosed.'); continue; }
        }
        C.add({ type: 'hatch', pat: hs.pat, sc: hs.sc, ang: hs.ang, loops }); n++;
        C.msg(`Hatch created (${loops.length} boundar${loops.length > 1 ? 'ies' : 'y'}).`);
      }
    });
    const JUST = { Left: [0, 0], Center: [1, 0], Right: [2, 0], Middle: [1, 2], TL: [0, 3], TC: [1, 3], TR: [2, 3], ML: [0, 2], MC: [1, 2], MR: [2, 2], BL: [0, 1], BC: [1, 1], BR: [2, 1] };
    def('TEXT', ['DT', 'DTEXT'], 'Creates single-line text', async () => {
      let just = [0, 0], r;
      for (;;) { r = await C.point('Specify start point of text or [Justify]'); if (r.kw !== 'Justify') break; const j = await C.kw('Enter an option [Left/Center/Right/Middle/TL/TC/TR/ML/MC/MR/BL/BC/BR]', { def: 'Left', defText: 'L' }); just = JUST[j.kw || j.value] || [0, 0]; }
      const p = r.pt;
      const h = (await C.dist('Specify height', { base: p, def: A.doc.textH, positive: true })).value; A.doc.textH = h;
      const rot = (await C.angle('Specify rotation angle of text', { base: p, def: A.textRot || 0, defText: f4((A.textRot || 0) * R2D) })).value; A.textRot = rot;
      let at = p.slice();
      for (;;) {
        const s = await C.str('Enter text (Enter on an empty line to finish)', { preview: null, textAt: at });
        const txt = (s.value || '').replace(/\s+$/, ''); if (!txt) break;
        C.add({ type: 'text', x: at[0], y: at[1], h, rot, s: txt, align: just[0], valign: just[1] });
        at = [at[0] + Math.sin(rot) * h * 1.667, at[1] - Math.cos(rot) * h * 1.667];
      }
    });
    def('MTEXT', ['MT', 'T'], 'Creates a multiline text paragraph', async () => {
      const a = (await C.point('Specify first corner')).pt;
      const b = (await C.point('Specify opposite corner', { base: a, noRubber: true, preview: q => [{ type: 'pline', pts: rectPts(a, q), closed: true, lt: 'DASHED' }] })).pt;
      const tl = [Math.min(a[0], b[0]), Math.max(a[1], b[1])], w = Math.abs(b[0] - a[0]);
      const v = await ui.textDialog({ s: '', h: A.doc.textH, title: 'Multiline Text' });
      if (!v || !v.s.trim()) throw CANCEL;
      A.doc.textH = v.h; C.add({ type: 'mtext', x: tl[0], y: tl[1], h: v.h, w, rot: 0, attach: 1, s: v.s });
    });
    def('TEXTEDIT', ['ED', 'DDEDIT'], 'Edits text, multiline text or a dimension text override', async () => {
      for (;;) {
        const s = await C.ent('Select an annotation object or [Undo]', { filter: e => e.type === 'text' || e.type === 'mtext' || e.type === 'dim' });
        if (s.none) break; if (s.kw) continue;
        const e = s.ent;
        if (e.type === 'dim') { const v = await Aero.prompt('Dimension text', 'Text override (<> = measured value, empty = measured)', e.txt ?? ''); if (v != null) C.update(e, { ...e, txt: v === '' ? null : v }); continue; }
        const v = await ui.textDialog({ s: e.s, h: e.h, title: e.type === 'mtext' ? 'Edit Multiline Text' : 'Edit Text', single: e.type === 'text' });
        if (v) C.update(e, { ...e, s: e.type === 'text' ? v.s.split('\n')[0] : v.s, h: v.h });
      }
    });
    // dimensions
    const dimLoc = async (mk, extra = '') => {
      let txt = null, fixed = null, r;
      for (;;) {
        r = await C.point(`Specify dimension line location or [Text${extra}]`, { preview: q => [mk(q, fixed, txt)] });
        if (r.kw === 'Text') { const t = await C.str('Enter dimension text (<> = measured)', { def: '<>' }); txt = t.value === '<>' || t.value === '' ? null : t.value; continue; }
        if (r.kw === 'Horizontal') { fixed = 0; continue; } if (r.kw === 'Vertical') { fixed = Math.PI / 2; continue; }
        if (r.kw === 'Rotated') { fixed = (await C.angle('Specify angle of dimension line', { def: 0, defText: '0' })).value; continue; }
        break;
      }
      return mk(r.pt, fixed, txt);
    };
    const autoAng = (p1, p2, q) => {
      const x0 = Math.min(p1[0], p2[0]), x1 = Math.max(p1[0], p2[0]), y0 = Math.min(p1[1], p2[1]), y1 = Math.max(p1[1], p2[1]);
      const inX = q[0] >= x0 && q[0] <= x1, inY = q[1] >= y0 && q[1] <= y1;
      if (inX && !inY) return 0; if (inY && !inX) return Math.PI / 2;
      const ox = Math.max(x0 - q[0], q[0] - x1, 0), oy = Math.max(y0 - q[1], q[1] - y1, 0);
      return oy >= ox ? 0 : Math.PI / 2;
    };
    async function extOrigins() {
      let r = await C.point('Specify first extension line origin or <select object>');
      if (r.none) { const s = await C.ent('Select object to dimension', { filter: e => e.type === 'line' || e.type === 'arc' || e.type === 'circle' }); const e = s.ent; if (e.type === 'line') return [[e.x1, e.y1], [e.x2, e.y2]]; if (e.type === 'arc') { const sw = G.arcSweep(e.a1, e.a2); return [G.pointAt(e, 0), G.pointAt(e, sw)]; } return [[e.cx - e.r, e.cy], [e.cx + e.r, e.cy]]; }
      const p1 = r.pt, p2 = (await C.point('Specify second extension line origin', { base: p1 })).pt; return [p1, p2];
    }
    const dimE = o => ({ type: 'dim', ...o });
    def('DIMLINEAR', ['DLI', 'DIM', 'DIMLIN'], 'Creates a horizontal, vertical or rotated linear dimension', async () => {
      const [p1, p2] = await extOrigins();
      const d = await dimLoc((q, fixed, txt) => dimE({ dt: 'lin', p1, p2, p: q, ang: fixed != null ? fixed : autoAng(p1, p2, q), ...(txt != null ? { txt } : {}) }), '/Horizontal/Vertical/Rotated');
      C.add(d); C.msg('Dimension text = ' + M.dimText(d, A.doc.dimstyle));
    });
    def('DIMALIGNED', ['DAL', 'DIMALI'], 'Creates a dimension aligned with the measured points', async () => {
      const [p1, p2] = await extOrigins(); if (G.dist(p1, p2) < 1e-12) throw new Error('Points coincide');
      const d = await dimLoc((q, f, txt) => dimE({ dt: 'ali', p1, p2, p: q, ...(txt != null ? { txt } : {}) }));
      C.add(d); C.msg('Dimension text = ' + M.dimText(d, A.doc.dimstyle));
    });
    async function radial(dt) {
      const s = await C.ent('Select arc or circle', { filter: e => e.type === 'arc' || e.type === 'circle' }); const e = s.ent, c = [e.cx, e.cy];
      const on = q => { const l = G.dist(c, q) || 1; return [c[0] + (q[0] - c[0]) / l * e.r, c[1] + (q[1] - c[1]) / l * e.r]; };
      const d = await dimLoc((q, f, txt) => dimE({ dt, c, p1: on(q), p: q, ...(txt != null ? { txt } : {}) }));
      C.add(d); C.msg('Dimension text = ' + M.dimText(d, A.doc.dimstyle));
    }
    def('DIMRADIUS', ['DRA', 'DIMRAD'], 'Creates a radius dimension for a circle or an arc', () => radial('rad'));
    def('DIMDIAMETER', ['DDI', 'DIMDIA'], 'Creates a diameter dimension for a circle or an arc', () => radial('dia'));
    def('DIMANGULAR', ['DAN', 'DIMANG'], 'Creates an angular dimension', async () => {
      const s = await C.ent('Select arc, line, or <specify vertex>', { filter: e => e.type === 'arc' || e.type === 'line' });
      let c, p1, p2;
      if (s.none) { c = (await C.point('Specify angle vertex')).pt; p1 = (await C.point('Specify first angle endpoint', { base: c })).pt; p2 = (await C.point('Specify second angle endpoint', { base: c })).pt; }
      else if (s.ent.type === 'arc') { const e = s.ent; c = [e.cx, e.cy]; p1 = G.pointAt(e, 0); p2 = G.pointAt(e, G.arcSweep(e.a1, e.a2)); }
      else {
        const l1 = s.ent, s2 = await C.ent('Select second line', { filter: e => e.type === 'line' && e !== l1 }), l2 = s2.ent;
        const x = G.interPrims(G.L(l1.x1, l1.y1, l1.x2, l1.y2), G.L(l2.x1, l2.y1, l2.x2, l2.y2), true, true)[0]; if (!x) throw new Error('Lines are parallel');
        const far = (l, pk) => { const a = [l.x1, l.y1], b = [l.x2, l.y2]; const pa = (pk[0] - x[0]) * (a[0] - x[0]) + (pk[1] - x[1]) * (a[1] - x[1]); return G.dist(a, x) > 1e-9 && pa > 0 ? a : G.dist(b, x) > 1e-9 && (pk[0] - x[0]) * (b[0] - x[0]) + (pk[1] - x[1]) * (b[1] - x[1]) > 0 ? b : G.dist(a, x) > G.dist(b, x) ? a : b; };
        c = x; p1 = far(l1, s.pt); p2 = far(l2, s2.pt);
      }
      const d = await dimLoc((q, f, txt) => dimE({ dt: 'ang', c, p1, p2, p: q, ...(txt != null ? { txt } : {}) }));
      C.add(d); C.msg('Dimension text = ' + M.dimText(d, A.doc.dimstyle));
    });
    def('DIMSTYLE', ['D', 'DST'], 'Edits the dimension style', async () => { await ui.dimStyleDialog(); }, { anySpace: true });

    /* ======================= BLOCKS ======================= */
    def('BLOCK', ['B'], 'Creates a block definition from selected objects', async () => {
      let name = await Aero.prompt('Block definition', 'Block name', 'BLOCK' + (Object.keys(A.doc.blocks).filter(k => !k.startsWith('*')).length + 1));
      if (name == null) throw CANCEL; name = name.trim().replace(/[<>\/\\":;?*|=,`]/g, '');
      if (!name || name.startsWith('*')) throw new Error('Invalid block name');
      if (A.doc.blocks[name] && !(await Aero.confirm('Redefine block', `Block "${name}" already exists. Redefine it?`, 'Redefine'))) throw CANCEL;
      const bp = (await C.point('Specify insertion base point')).pt;
      const ents = await C.sel();
      A.doc.blocks[name] = { base: bp, ents: ents.map(e => { const o = { ...e }; delete o.id; return o; }) };
      C.remove(ents); C.add({ type: 'insert', name, x: bp[0], y: bp[1], sx: 1, sy: 1, rot: 0, layer: A.doc.cur }, false);
      C.msg(`Block "${name}" defined with ${ents.length} objects.`); ui.refreshPanels();
    }, { pickfirst: true });
    def('INSERT', ['I', 'DDINSERT'], 'Inserts a block', async () => {
      const names = Object.keys(A.doc.blocks).filter(k => !k.startsWith('*'));
      if (!names.length) throw new Error('This drawing has no blocks — create one with BLOCK');
      const v = await ui.insertDialog(names); if (!v) throw CANCEL;
      const mk = q => ({ type: 'insert', name: v.name, x: q[0], y: q[1], sx: v.sx, sy: v.sy, rot: v.rot * D2R });
      for (;;) {
        const r = await C.point('Specify insertion point <exit>', { preview: q => [mk(q)] });
        if (r.none) break; C.add(mk(r.pt)); if (!v.repeat) break;
      }
    });
    def('PASTECLIP', ['PASTE'], 'Pastes objects copied with Ctrl+C', async () => {
      const clip = A.clip; if (!clip || !clip.ents.length) throw new Error('Clipboard is empty — select objects and press Ctrl+C');
      const mk = q => clip.ents.map(e => G.transform(e, G.Tmove(q[0] - clip.base[0], q[1] - clip.base[1])));
      const r = await C.point('Specify insertion point', { preview: q => mk(q).slice(0, 400) });
      mk(r.pt).forEach(e => C.add(e, true));
    }, { noRepeat: true });

    /* ======================= INQUIRY ======================= */
    def('DIST', ['DI'], 'Measures the distance and angle between two points', async () => {
      const a = (await C.point('Specify first point')).pt, b = (await C.point('Specify second point', { base: a })).pt;
      const d = G.dist(a, b), msg = `Distance = ${f4(d)},  Angle in XY Plane = ${fa(G.ang(b[0] - a[0], b[1] - a[1]))},  Delta X = ${f4(b[0] - a[0])},  Delta Y = ${f4(b[1] - a[1])}`;
      C.msg(msg); ui.status(msg); A.lastMeasure = { d, a, b };
    }, { anySpace: false, keepSel: true });
    def('MEASUREGEOM', ['MEA'], 'Quick distance measurement (same as DIST)', async () => REG.DIST.fn(C));
    def('AREA', ['AA'], 'Calculates area and perimeter of points or an object', async () => {
      const r = await C.point('Specify first corner point or [Object]');
      let area, per;
      if (r.kw === 'Object') {
        const e = (await C.ent('Select objects', { filter: e => ['circle', 'pline', 'hatch', 'arc', 'line'].includes(e.type) })).ent;
        if (e.type === 'circle') { area = Math.PI * e.r * e.r; per = 2 * Math.PI * e.r; }
        else if (e.type === 'pline') { area = Math.abs(G.loopArea(e.pts)); per = G.entLength(e); }
        else if (e.type === 'hatch') { area = e.loops.reduce((s, l, i) => s + (i ? -1 : 1) * Math.abs(G.loopArea(l.pts)), 0); per = e.loops.reduce((s, l) => s + G.loopLength(l.pts), 0); }
        else { area = 0; per = G.entLength(e); }
      } else {
        const pts = [r.pt];
        for (;;) { const q = await C.point('Specify next point or <total>', { base: pts[pts.length - 1], preview: q => [{ type: 'pline', pts: [...pts, q].map(p => [p[0], p[1], 0]), closed: true }] }); if (q.none) break; pts.push(q.pt); }
        area = Math.abs(G.loopArea(pts)); per = G.loopLength(pts.map(p => [p[0], p[1], 0]));
      }
      const msg = `Area = ${f4(area)},  Perimeter = ${f4(per)}`; C.msg(msg); ui.status(msg); A.lastArea = area;
    }, { keepSel: true });
    def('ID', [], 'Displays the coordinates of a point', async () => { const r = await C.point('Specify point'); const m = `X = ${f4(r.pt[0])}     Y = ${f4(r.pt[1])}`; C.msg(m); ui.status(m); }, { keepSel: true });
    def('LIST', ['LI', 'LS'], 'Lists the properties of selected objects', async () => {
      const ents = await C.sel();
      for (const e of ents.slice(0, 30)) C.msg(ui.describe(e));
      if (ents.length > 30) C.msg(`… and ${ents.length - 30} more`);
    }, { pickfirst: true });
    async function placeAlong(e, positions) { positions.forEach(s => { const p = G.pointAtLength(e, s); if (p) C.add({ type: 'point', x: p[0], y: p[1] }); }); }
    def('MEASURE', ['ME'], 'Places points at measured intervals along an object', async () => {
      const e = (await C.ent('Select object to measure', { filter: curve })).ent, L = G.entLength(e);
      const seg = (await C.dist('Specify length of segment', { positive: true, def: A.measLen })).value; A.measLen = seg;
      const pos = []; for (let s = seg; s < L - 1e-9; s += seg) pos.push(s);
      await placeAlong(e, pos); C.msg(`${pos.length} points placed every ${f4(seg)} (object length ${f4(L)})`);
    });
    def('DIVIDE', ['DIV'], 'Places evenly spaced points along an object', async () => {
      const e = (await C.ent('Select object to divide', { filter: curve })).ent, L = G.entLength(e);
      const n = (await C.int('Enter the number of segments', { def: A.divN || 4, min: 2 })).value; A.divN = n;
      const closed = e.type === 'circle' || (e.type === 'pline' && e.closed), pos = [];
      for (let i = closed ? 0 : 1; i < n; i++) pos.push(L * i / n);
      await placeAlong(e, pos); C.msg(`${pos.length} points placed`);
    });

    /* ======================= VIEW / SETTINGS ======================= */
    def('ZOOM', ['Z'], 'Zooms the view', async () => {
      const r = await C.point('Specify corner of window, enter a scale factor (nX), or [All/Extents/Window/Previous]', { kws: ['All', 'Extents', 'Window', 'Previous'], noRubber: true });
      if (r.kw === 'All' || r.kw === 'Extents' || r.none) return V.zoomExtents();
      if (r.kw === 'Previous') { if (A.prevView) Object.assign(A.space === 'layout' ? V.layout : V.model, A.prevView); V.draw(); return; }
      let a = r.pt;
      if (r.kw === 'Window') a = (await C.point('Specify first corner', { noRubber: true })).pt;
      const b = (await C.point('Specify opposite corner', { base: a, noRubber: true, rect: true, preview: q => [{ type: 'pline', pts: rectPts(a, q), closed: true, color: 4 }] })).pt;
      A.prevView = { ...(A.space === 'layout' ? V.layout : V.model) };
      V.zoomBox([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], 0.01);
    }, { transparent: true, anySpace: true, keepSel: true });
    E.zoomFactor = t => { const m = String(t).trim().match(/^([\d.]+)\s*[xX]?$/); if (m && +m[1] > 0) { V.zoomScale(+m[1]); return true; } return false; };
    def('PAN', ['P'], 'Moves the view by a displacement', async () => {
      const a = (await C.point('Specify base point of displacement')).pt, b = (await C.point('Specify second point', { base: a })).pt;
      const v = A.space === 'layout' ? V.layout : V.model; v.cx -= b[0] - a[0]; v.cy -= b[1] - a[1]; V.draw();
    }, { transparent: true, keepSel: true });
    def('REGEN', ['RE', 'REDRAW', 'R'], 'Regenerates the drawing', async () => { V.invalidate(); V.draw(); C.msg(`Regenerated ${A.doc.ents.length} objects in ${(V.lastDrawMs || 0).toFixed(1)} ms.`); }, { anySpace: true, keepSel: true });
    def('U', ['UNDO'], 'Undoes the last command', async () => ui.undo(), { noRepeat: false, anySpace: true });
    def('REDO', ['MREDO'], 'Redoes the last undone command', async () => ui.redo(), { anySpace: true });
    def('LAYER', ['LA', 'LAYERS'], 'Opens the layer properties manager', async () => ui.layerDialog(), { anySpace: true });
    def('PROPERTIES', ['PR', 'CH', 'PROPS'], 'Shows the properties palette for the selection', async () => ui.showProps(), { anySpace: true, keepSel: true, pickfirst: true });
    def('OSNAP', ['OS', 'DSETTINGS', 'DS'], 'Drafting settings: object snaps, polar tracking, grid and snap', async () => ui.draftingDialog(), { anySpace: true, keepSel: true });
    def('UNITS', ['UN'], 'Sets drawing units and precision', async () => ui.unitsDialog(), { anySpace: true });
    def('LTSCALE', ['LTS'], 'Sets the global linetype scale factor', async () => { const r = await C.num('Enter new linetype scale factor', { def: A.doc.ltscale, positive: true }); A.doc.ltscale = r.value; C.changed(); }, { anySpace: true });
    def('PAGESETUP', ['PAGE', 'LAYOUT'], 'Paper size, plot scale and title block', async () => ui.pageDialog(), { anySpace: true });
    def('PLOT', ['PRINT', 'EXPORT'], 'Exports the layout or model space to PDF or SVG at scale', async () => ui.exportDialog(), { anySpace: true });
    def('SELECTALL', ['ALL'], 'Selects every object', async () => ui.selectAll(), { anySpace: true });
    def('COPYCLIP', ['COPYC'], 'Copies selected objects to the clipboard', async () => { const ents = await C.sel(); ui.copyClip(ents); }, { pickfirst: true, noRepeat: true, keepSel: true });

    return E;
  };
})();
