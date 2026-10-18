'use strict';
/* Lumen Beats — shared app state + small UI helpers (context menu, drag helper, canvas helpers). */
(function () {
  const C = Core;
  const App = window.App = {
    prj: null, samples: {}, hist: null, file: null,
    sel: { ch: null, pat: null, ins: null, fx: null, notes: new Set(), clips: new Set() },
    tool: 'draw', snap: 'step', view: 'rack', mode: 'pattern', follow: true, ghosts: true, scaleSnap: false, pianoKeys: false, recording: false, kbOct: 4,
    views: {},
    get pat() { return C.findPat(this.prj, this.sel.pat) || this.prj.patterns[0]; },
    get ch() { return C.findCh(this.prj, this.sel.ch) || this.prj.channels[0] || null; },
    snapTicks() {
      const p = this.prj; return ({ bar: C.barTicks(p), beat: C.beatTicks(p), half: 48, third: 32, step: 24, sixth: 16, eighth: 12, none: 1 })[this.snap] || 24;
    },
    // document changed: refresh engine + views. label → new undo step.
    commit(label, parts) { if (label) this.hist.push(label, this.snapshot()); Engine.setProject(this.prj); this.refresh(parts); },
    live(parts) { Engine.setProject(this.prj); this.refresh(parts); },   // live edit (slider drag) without an undo step
    snapshot() { return JSON.stringify(this.prj); },
    restore(s) { if (!s) return; this.prj = JSON.parse(s); this.fixSel(); Engine.setProject(this.prj); this.refresh(); },
    fixSel() {
      const p = this.prj, s = this.sel;
      if (!C.findPat(p, s.pat)) s.pat = p.patterns[0]?.id;
      if (!C.findCh(p, s.ch)) s.ch = p.channels[0]?.id || null;
      if (s.ins !== 'master' && !C.findIns(p, s.ins)) s.ins = p.mixer.inserts[0]?.id || 'master';
      const strip = s.ins === 'master' ? p.mixer.master : C.findIns(p, s.ins);
      if (!strip?.fx.find(f => f.id === s.fx)) s.fx = strip?.fx[0]?.id || null;
      const pat = this.pat; s.notes = new Set([...s.notes].filter(n => pat.notes[s.ch]?.includes(n)));
      s.clips = new Set([...s.clips].filter(c => p.playlist.clips.includes(c)));
      Engine.patId = s.pat;
    },
    refresh(parts) { if (!this.prj) return; for (const [k, v] of Object.entries(this.views)) if (!parts || parts.includes(k)) try { v.render?.(); } catch (e) { console.error(e); } },
    setStatus(id, txt) { const e = document.getElementById(id); if (e) e.textContent = txt; },
    hover(txt) { this.setStatus('st-hover', txt || ''); }
  };

  /* ---------- context menu (Vista look, same as kit dropdowns) ---------- */
  let menuEl = null;
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  function ctxMenu(x, y, items) {
    closeMenu(); Aero.closeMenus();
    const m = Aero.el('div', 'aero-dropdown ctx'); m.style.display = 'block';
    for (const it of items) {
      if (it === '-') { m.appendChild(Aero.el('div', 'aero-msep')); continue; }
      if (typeof it === 'string' && it[0] === '#') { m.appendChild(Aero.el('div', 'aero-mhead', Aero.esc(it.slice(1)))); continue; }
      const mi = Aero.el('div', 'aero-mi' + (it.checked ? ' checked' : '') + (it.disabled ? ' disabled' : ''), `<span>${Aero.esc(it.label)}</span><span class="k">${Aero.esc(it.key || '')}</span>`);
      mi.onclick = e => { e.stopPropagation(); closeMenu(); it.fn?.(); };
      m.appendChild(mi);
    }
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 4) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
    menuEl = m;
  }
  addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  /* ---------- pointer drag helper ---------- */
  function drag(e, move, up) {
    const el = e.currentTarget || e.target; try { el.setPointerCapture?.(e.pointerId); } catch (x) { }
    const mv = ev => move?.(ev), u = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', u); removeEventListener('pointercancel', u); up?.(ev); };
    addEventListener('pointermove', mv); addEventListener('pointerup', u); addEventListener('pointercancel', u);
  }
  /* ---------- canvas helpers ---------- */
  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1, w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return [g, r.width, r.height];
  }
  function rrect(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; const f = v => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k); return `rgb(${f(r)},${f(g)},${f(b)})`; }
  // a labelled slider row for a param spec; onInput(v) live, onCommit(v) on release; auto(): create automation lane
  function paramRow(spec, value, onInput, onCommit, auto) {
    const row = Aero.el('div', 'prow');
    const lab = Aero.el('label', null, Aero.esc(spec.label)); row.appendChild(lab);
    let input, out = Aero.el('span', 'pval');
    if (spec.opts) {
      input = Aero.el('select'); spec.opts.forEach(([v, t]) => input.add(new Option(t, v))); input.value = String(value);
      input.onchange = () => { const s = spec.opts.find(o => String(o[0]) === input.value); onCommit(s ? s[0] : spec.def); };
      row.classList.add('sel'); row.appendChild(input);
    } else if (spec.bool) {
      input = Aero.el('input'); input.type = 'checkbox'; input.checked = !!value; input.onchange = () => onCommit(input.checked);
      row.classList.add('chk'); row.appendChild(input);
    } else {
      input = Aero.el('input'); input.type = 'range'; input.min = 0; input.max = 1000; input.step = 1;
      const toPos = v => Math.round(C.norm(spec, v) * 1000), fromPos = x => C.denorm(spec, x / 1000);
      input.value = toPos(value); out.textContent = (spec.fmt || (v => v.toFixed(2)))(value);
      input.oninput = () => { const v = fromPos(+input.value); out.textContent = (spec.fmt || (x => x.toFixed(2)))(v); onInput(v); };
      input.onchange = () => onCommit(fromPos(+input.value));
      input.ondblclick = () => { input.value = toPos(spec.def); out.textContent = (spec.fmt || (x => x.toFixed(2)))(spec.def); onCommit(spec.def); };
      input.title = 'Double-click to reset';
      row.appendChild(input); row.appendChild(out);
      if (auto) { const a = Aero.el('button', 'abtn', 'A'); a.title = 'Create an automation lane for ' + spec.label; a.onclick = auto; row.appendChild(a); }
    }
    return row;
  }
  const PRESETS = {
    sub: {
      'Init': {},
      'Deep bass': { o1w: 'sawtooth', o1o: -1, o2w: 'square', o2o: -2, o2l: 0.55, o2d: 0, cut: 420, res: 3, fenv: 0.35, fD: 0.22, fS: 0.1, aA: 0.003, aD: 0.4, aS: 0.85, aR: 0.12, gain: 0.7 },
      'Acid bass': { o1w: 'sawtooth', o1o: -1, o2l: 0, cut: 260, res: 14, fenv: 0.65, fA: 0.002, fD: 0.18, fS: 0.05, aS: 0.9, aR: 0.08, glide: 0.06, gain: 0.55 },
      'Supersaw lead': { o1w: 'sawtooth', o2w: 'sawtooth', o2d: 14, o2l: 0.8, cut: 5200, res: 1.2, fenv: 0.2, aA: 0.01, aS: 0.8, aR: 0.3, lw: 'sine', lr: 5.5, la: 0.15, ld: 'pitch', gain: 0.45 },
      'Soft pad': { o1w: 'sawtooth', o2w: 'triangle', o2o: 1, o2d: 9, o2l: 0.6, cut: 1500, res: 0.8, fenv: 0.15, fA: 0.9, fD: 1.5, fS: 0.6, aA: 0.7, aD: 1.2, aS: 0.85, aR: 1.6, lw: 'triangle', lr: 0.35, la: 0.25, ld: 'cutoff', gain: 0.42 },
      'Pluck': { o1w: 'square', o2w: 'sawtooth', o2o: 1, o2l: 0.35, cut: 900, res: 4, fenv: 0.55, fD: 0.16, fS: 0, aD: 0.35, aS: 0, aR: 0.25, gain: 0.55 },
      'Wobble': { o1w: 'sawtooth', o1o: -1, o2w: 'square', o2o: -1, o2d: -8, o2l: 0.7, cut: 500, res: 9, fenv: 0, aS: 1, aR: 0.1, lw: 'sine', lr: 3, la: 0.8, ld: 'cutoff', gain: 0.5 }
    },
    fm: {
      'Init': {},
      'Electric piano': { cr: 1, m1r: 1, m1i: 2.2, m1d: 0.9, m1s: 0.15, m2r: 14, m2i: 0.6, m2d: 0.08, alg: 'par', aA: 0.002, aD: 1.6, aS: 0.25, aR: 0.5 },
      'Bell': { cr: 1, m1r: 3.5, m1i: 4, m1d: 2.5, m1s: 0.1, m2i: 0, aA: 0.001, aD: 3, aS: 0, aR: 2.5, gain: 0.45 },
      'FM bass': { cr: 0.5, m1r: 1, m1i: 3.5, m1d: 0.25, m1s: 0.2, m2i: 0, aA: 0.002, aD: 0.4, aS: 0.7, aR: 0.12, gain: 0.7 },
      'Brass': { cr: 1, m1r: 1, m1i: 3, m1d: 0.4, m1s: 0.7, m2i: 0, aA: 0.06, aD: 0.3, aS: 0.8, aR: 0.25 },
      'Glass': { cr: 2, m1r: 7, m1i: 1.5, m1d: 1.2, m1s: 0.2, m2r: 3, m2i: 1, m2d: 0.6, alg: 'stack', aA: 0.004, aD: 2, aS: 0.2, aR: 1.5, gain: 0.4 }
    }
  };
  Object.assign(App, { ctxMenu, closeMenu, drag, fitCanvas, rrect, shade, paramRow, PRESETS });
})();
