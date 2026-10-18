'use strict';
/* Lumen Type — application state, undoable changes, events, views. */
(function () {
  const TM = window.TM;
  const $ = id => document.getElementById(id);
  const A = window.LT = {
    font: null, view: 'font', cur: null, sel: [], anchor: null,
    filter: { kind: 'all', block: null, q: '' },
    prefs: { cell: 76, fill: false, penMode: 'cubic', coords: true, metrics: true, preview: true, kern: true, boxes: false, tool: 'select' },
    docName: 'Untitled', filePath: null, ls: {},
  };
  const PREF_KEY = 'lumen-type-prefs';
  try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); if (p && typeof p === 'object') Object.keys(A.prefs).forEach(k => { if (typeof p[k] === typeof A.prefs[k]) A.prefs[k] = p[k]; }); } catch (e) { }
  A.savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(A.prefs)); } catch (e) { } };

  // ---------- events ----------
  A.on = (ev, fn) => { (A.ls[ev] = A.ls[ev] || []).push(fn); };
  A.emit = (ev, arg) => { (A.ls[ev] || []).forEach(fn => { try { fn(arg); } catch (e) { console.error(e); } }); };

  // ---------- history ----------
  A.hist = new Aero.History({ max: 250, onChange: () => A.emit('history') });
  const shallow = f => ({ info: f.info, order: f.order, glyphs: Object.assign({}, f.glyphs), groups: f.groups, kerning: f.kerning });
  function api(d) {
    const tg = new Set(), done = {};
    const o = {
      font: d, touched: tg,
      glyph(n) { if (!d.glyphs[n]) return null; if (!tg.has(n)) { d.glyphs[n] = TM.cloneGlyph(d.glyphs[n]); tg.add(n); } return d.glyphs[n]; },
      info() { if (!done.i) { d.info = Object.assign({}, d.info); done.i = 1; } return d.info; },
      order() { if (!done.o) { d.order = d.order.slice(); done.o = 1; } return d.order; },
      groups() { if (!done.g) { d.groups = Object.assign({}, d.groups); done.g = 1; } return d.groups; },
      kerning() { if (!done.k) { d.kerning = Object.assign({}, d.kerning); done.k = 1; } return d.kerning; },
      setKern(l, r, v) {
        const k = o.kerning();
        if (v == null) { if (k[l]) { k[l] = Object.assign({}, k[l]); delete k[l][r]; if (!Object.keys(k[l]).length) delete k[l]; } return; }
        k[l] = Object.assign({}, k[l] || {}); k[l][r] = Math.round(v);
      },
      setGroup(name, members) { const g = o.groups(); if (members == null) delete g[name]; else g[name] = members.slice(); },
      addGlyph(g, at) { d.glyphs[g.name] = g; tg.add(g.name); const ord = o.order(); if (at == null || at < 0 || at > ord.length) ord.push(g.name); else ord.splice(at, 0, g.name); return g; },
      removeGlyph(n) {
        if (!d.glyphs[n]) return;
        delete d.glyphs[n]; o.order().splice(d.order.indexOf(n), 1);
        // components referring to it are decomposed first by the caller; drop dangling ones
        d.order.forEach(m => { if (d.glyphs[m].components.some(c => c.base === n)) { const g = o.glyph(m); g.components = g.components.filter(c => c.base !== n); } });
        const gr = d.groups; if (Object.values(gr).some(v => v.includes(n))) { const G = o.groups(); Object.keys(G).forEach(k => { if (G[k].includes(n)) G[k] = G[k].filter(x => x !== n); }); }
        const K = d.kerning; if (K[n] || Object.values(K).some(r => n in r)) { const k = o.kerning(); delete k[n]; Object.keys(k).forEach(l => { if (n in k[l]) { k[l] = Object.assign({}, k[l]); delete k[l][n]; if (!Object.keys(k[l]).length) delete k[l]; } }); }
      },
      renameGlyph(old, nu) {
        if (!d.glyphs[old] || d.glyphs[nu] || !TM.validName(nu)) return false;
        const g = o.glyph(old); g.name = nu; delete d.glyphs[old]; d.glyphs[nu] = g; tg.delete(old); tg.add(nu);
        const ord = o.order(); ord[ord.indexOf(old)] = nu;
        d.order.forEach(m => { if (d.glyphs[m].components.some(c => c.base === old)) o.glyph(m).components.forEach(c => { if (c.base === old) c.base = nu; }); });
        if (Object.values(d.groups).some(v => v.includes(old))) { const G = o.groups(); Object.keys(G).forEach(k => { if (G[k].includes(old)) G[k] = G[k].map(x => x === old ? nu : x); }); }
        const k = o.kerning();
        if (k[old]) { k[nu] = k[old]; delete k[old]; }
        Object.keys(k).forEach(l => { if (old in k[l]) { k[l] = Object.assign({}, k[l]); k[l][nu] = k[l][old]; delete k[l][old]; } });
        return true;
      },
    };
    return o;
  }
  let live = null;
  // run fn(api) as one undoable step
  A.change = (label, fn) => {
    if (live) A.liveEnd(live.label || 'Edit');
    const o = api(shallow(A.font));
    const r = fn(o);
    if (r === false) return false;
    A.font = o.font; A.hist.push(label, A.font);
    A.emit('change', { glyphs: o.touched });
    return true;
  };
  // live (drag) edits: render from the draft, commit once at the end
  A.liveStart = (label) => { if (live) return live; live = api(shallow(A.font)); live.label = label; A.font = live.font; return live; };
  A.liveEnd = (label) => {
    if (!live) return; const o = live; live = null;
    if (label === false) { A.font = A.hist.current; A.emit('change', {}); return; }
    A.hist.push(label || o.label || 'Edit', A.font); A.emit('change', { glyphs: o.touched });
  };
  A.isLive = () => !!live;
  A.undo = () => { if (live) A.liveEnd(false); const s = A.hist.undo(); if (s) { A.font = s; A.emit('change', { undo: true }); } };
  A.redo = () => { if (live) A.liveEnd(false); const s = A.hist.redo(); if (s) { A.font = s; A.emit('change', { undo: true }); } };
  A.setFont = (font, name, path) => {
    live = null; A.font = font; A.hist.reset('Open', font);
    A.docName = name || 'Untitled'; A.filePath = path || null; Aero.setDoc(A.docName, false);
    A.sel = []; A.anchor = null;
    A.cur = font.order.find(n => font.glyphs[n].unicodes.includes(0x61)) || font.order.find(n => n !== '.notdef' && n !== 'space') || font.order[0];
    A.filter = { kind: 'all', block: null, q: '' };
    A.emit('font'); A.emit('change', { all: true });
  };
  A.glyph = n => A.font && A.font.glyphs[n];

  // ---------- views ----------
  A.setView = v => {
    if (!A.font) return;
    if (live) A.liveEnd(live.label);
    A.view = v;
    document.querySelectorAll('#viewTabs .aero-tab').forEach(t => t.classList.toggle('on', t.dataset.v === v));
    ['font', 'glyph', 'kern', 'info'].forEach(k => { $('v' + k[0].toUpperCase() + k.slice(1)).hidden = k !== v; });
    document.body.dataset.view = v;
    A.emit('view', v);
  };
  A.openGlyph = n => { if (!A.glyph(n)) return; A.cur = n; A.setView('glyph'); A.emit('cur'); };
  A.setCur = n => { if (!A.glyph(n)) return; A.cur = n; A.emit('cur'); };
  A.status = (i, s) => { const e = $('st' + i); if (e) e.textContent = s; };
  A.toast = m => Aero.toast(m);

  // glyph creation helpers
  A.newGlyphFor = (font, cp, name) => {
    const g = TM.newGlyph(name || TM.glyphNameFor(cp), cp != null ? [cp] : [], Math.round(font.info.unitsPerEm * 0.5));
    return g;
  };
  A.adjacent = (dir) => {
    const list = A.visibleNames ? A.visibleNames() : A.font.order;
    let i = list.indexOf(A.cur); if (i < 0) { i = A.font.order.indexOf(A.cur); const o = A.font.order; return o[(i + dir + o.length) % o.length]; }
    return list[(i + dir + list.length) % list.length];
  };
  A.MARKS = [null, '#f26d6d', '#f5a04a', '#f2d64b', '#8ad15a', '#4fc7a8', '#5ab8f0', '#6c8cf2', '#b07ef0', '#ef7ec8', '#a0a8b3', '#6b4f3a'];
})();
