'use strict';
/* Lumen Vector — Envelope Distort ▸ Make with Warp (live). Arc, Arc Lower/Upper, Arch, Bulge, Flag, Wave, Rise,
   Fisheye, Inflate, Squeeze, Twist with bend + horizontal/vertical distortion, like Illustrator's warp presets.
   A warp is a group with data.kind 'warp', data.warp = { style, bend, dh, dv, vertical, sig }, applyMatrix = false:
     role 'warpSrc' — the original artwork (hidden; Release gives it back unchanged)
     role 'warpOut' — the distorted result (text converted to outlines, curves subdivided then mapped) — rebuilt
                      whenever the source or the options change (checked on commit). */
(function () {
  const WP = LV.warp = {};
  WP.STYLES = { arc: 'Arc', arcLower: 'Arc Lower', arcUpper: 'Arc Upper', arch: 'Arch', bulge: 'Bulge', flag: 'Flag', wave: 'Wave', rise: 'Rise', fisheye: 'Fisheye', inflate: 'Inflate', squeeze: 'Squeeze', twist: 'Twist' };
  WP.defaults = { style: 'arc', bend: 50, dh: 0, dv: 0, vertical: false };
  const n = (v, lo, hi, d) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  WP.sanitize = o => { o = o && typeof o === 'object' ? o : {}; return { style: WP.STYLES[o.style] ? o.style : 'arc', bend: n(o.bend, -100, 100, 50), dh: n(o.dh, -100, 100, 0), dv: n(o.dv, -100, 100, 0), vertical: !!o.vertical }; };
  WP.src = g => g.children.find(c => c.data.role === 'warpSrc') || null;
  WP.out = g => g.children.find(c => c.data.role === 'warpOut') || null;
  const isWarp = it => LV.kind(it) === 'warp';

  /* ---------- the mapping ---------- */
  // returns f(x, y) -> [x', y'] for artwork with bounds b
  WP.mapper = (b, o) => {
    const vert = o.vertical, bend = o.bend / 100, dh = o.dh / 100, dv = o.dv / 100;
    // work in a frame where the warp runs horizontally: X along the "length", Y across it
    const cx = b.center.x, cy = b.center.y, W = Math.max(1e-6, vert ? b.height : b.width), H = Math.max(1e-6, vert ? b.width : b.height);
    const toF = (x, y) => vert ? [y - cy, -(x - cx)] : [x - cx, y - cy];
    const fromF = (X, Y) => vert ? [cx - Y, cy + X] : [cx + X, cy + Y];
    const style = o.style, PI = Math.PI;
    const core = (X, Y) => {
      const u = X / (W / 2), v = Y / (H / 2), t = (v + 1) / 2, q = 1 - u * u;
      switch (style) {
        case 'arc': { // bend the whole thing round an arc whose length equals the width
          const th = bend * PI; if (Math.abs(th) < 1e-6) return [X, Y];
          const R = W / th, phi = X / R, r = R - Y;
          return [r * Math.sin(phi), R - r * Math.cos(phi)];
        }
        case 'arcLower': return [X, Y + bend * q * t * H * 0.6];
        case 'arcUpper': return [X, Y - bend * q * (1 - t) * H * 0.6];
        case 'arch': return [X, Y - bend * q * W * 0.18];
        case 'bulge': return [X, Y * (1 + bend * q * 0.8)];
        case 'flag': return [X, Y - bend * Math.sin(PI * u) * H * 0.35];
        case 'wave': return [X, Y - bend * Math.sin(2 * PI * (u + 1) / 2 * 1.5) * H * 0.3 * (0.6 + 0.4 * t)];
        case 'rise': return [X, Y - bend * (Math.pow((u + 1) / 2, 2) - 0.5) * H * 1.2];
        case 'fisheye': { const r2 = u * u + v * v, s = r2 < 1 ? 1 + bend * (1 - r2) * 0.7 : 1; return [X * s, Y * s]; }
        case 'inflate': return [X * (1 + bend * 0.35 * (1 - Math.min(1, v * v))), Y * (1 + bend * 0.5 * q)];
        case 'squeeze': return [X * (1 - bend * 0.4 * (1 - Math.min(1, v * v))), Y * (1 + bend * 0.3 * q)];
        case 'twist': {
          const Rr = Math.max(W, H) / 2, r = Math.hypot(X, Y) / Rr; if (r >= 1) return [X, Y];
          const a = bend * PI * 0.75 * (1 - r) * (1 - r), c = Math.cos(a), s = Math.sin(a); return [X * c - Y * s, X * s + Y * c];
        }
      }
      return [X, Y];
    };
    return (x, y) => {
      const [X, Y] = toF(x, y); let [X2, Y2] = core(X, Y);
      const u = X / (W / 2), v = Y / (H / 2);
      if (dh) Y2 *= 1 + dh * u * 0.5;   // perspective along the length
      if (dv) X2 *= 1 + dv * v * 0.5;   // perspective across
      return fromF(X2, Y2);
    };
  };

  /* ---------- applying it to paths ---------- */
  const MAX_SEGS = 60000;
  function warpPath(p, f, maxLen, budget) {
    // lines become cubic curves so they can bend; long curves are split so the mapping stays accurate
    p.curves.forEach(c => { if (c.handle1.isZero() && c.handle2.isZero()) { const d = c.point2.subtract(c.point1).divide(3); c.handle1 = d; c.handle2 = d.negate(); } });
    for (let i = p.curves.length - 1; i >= 0; i--) {
      const c = p.curves[i], k = Math.min(64, Math.ceil(c.length / maxLen));
      for (let j = k; j > 1 && budget.n < MAX_SEGS; j--) { c.divideAtTime((j - 1) / j); budget.n++; }
    }
    const e = maxLen * 1e-3;
    p.segments.forEach(s => {
      const pt = s.point, [x, y] = f(pt.x, pt.y);
      const [ax, ay] = f(pt.x + e, pt.y), [bx, by] = f(pt.x - e, pt.y), [cx2, cy2] = f(pt.x, pt.y + e), [dx, dy] = f(pt.x, pt.y - e);
      const J = [(ax - bx) / (2 * e), (ay - by) / (2 * e), (cx2 - dx) / (2 * e), (cy2 - dy) / (2 * e)]; // columns: d/dx, d/dy
      const map = h => new P.Point(J[0] * h.x + J[2] * h.y, J[1] * h.x + J[3] * h.y);
      const hi = s.handleIn, ho = s.handleOut;
      s.point = new P.Point(x, y); s.handleIn = map(hi); s.handleOut = map(ho);
    });
    if (p.fillColor && p.fillColor.type === 'gradient') { const c = p.fillColor, o = c.origin, d = c.destination; const [ox, oy] = f(o.x, o.y), [qx, qy] = f(d.x, d.y); c.origin = [ox, oy]; c.destination = [qx, qy]; }
  }
  const SPECIAL = ['symbol', 'trace', 'blend', 'repeat', 'warp'];
  function flattenSpecial(it) { // expand live objects inside a detached copy so everything shares one coordinate space
    (it.children || []).slice().forEach(c => { let x = c; if (SPECIAL.includes(LV.kind(c))) x = LV.expandSpecial(c); if (x && x.applyMatrix === false && !(x instanceof P.PointText) && !LV.isTextLike(x)) x.applyMatrix = true; if (x) flattenSpecial(x); });
  }
  WP.build = (src, o) => {
    const out = src.clone({ insert: false }); out.visible = true; out.data = { role: 'warpOut' };
    const clean = it => { if (it.data) { delete it.data.uid; delete it.data.next; delete it.data.prev; delete it.data.live; } (it.children || []).forEach(clean); };
    flattenSpecial(out);
    const texts = []; const walk = it => { if (LV.isTextLike(it)) texts.push(it); else (it.children || []).slice().forEach(walk); }; walk(out);
    texts.forEach(t => { const fx = t.data && t.data.fx, o2 = LV.outlineText(t); if (fx && o2 && o2 !== t) o2.data.fx = fx; }); // keep live effects of outlined type
    clean(out); out.data.role = 'warpOut';
    const b = src.bounds; if (!(b.width > 0 && b.height > 0)) return out;
    const f = WP.mapper(b, o), maxLen = Math.max(0.5, Math.max(b.width, b.height) / 48), budget = { n: 0 };
    out.getItems({ class: P.Path }).forEach(p => warpPath(p, f, maxLen, budget));
    return out;
  };
  const sigOf = (g, o) => { const s = WP.src(g); return JSON.stringify([o, s && s.exportJSON({ asString: false, precision: 3 })]); };
  WP.regen = (g, force) => {
    const s = WP.src(g); if (!s) return false;
    const o = WP.sanitize(g.data.warp), sig = sigOf(g, o), old = WP.out(g);
    if (!force && old && g.data.warp && g.data.warp.sig === sig) return false;
    if (old) old.remove();
    s.visible = true; const out = WP.build(s, o); s.visible = false;
    out.insertAbove(s); g.data.warp = { ...o, sig }; return true;
  };
  WP.regenAll = () => P.project.getItems({ match: it => it.data && it.data.kind === 'warp' }).forEach(g => { try { WP.regen(g); } catch (e) { console.warn('warp', e); } });

  /* ---------- commands ---------- */
  WP.make = (opts, items = LV.sortZ(LV.sel)) => {
    items = items.filter(it => it.parent && !it.locked);
    if (!items.length) { LV.toast('Select the artwork or text to warp'); return null; }
    if (items.some(it => it instanceof P.Raster || (it.getItems && it.getItems({ class: P.Raster }).length))) LV.toast('Images inside a warp are not distorted');
    const o = WP.sanitize(opts || WP.last || WP.defaults);
    const g = new P.Group({ insert: false }); g.applyMatrix = false; g.data = { kind: 'warp', warp: o }; g.name = 'Warp: ' + WP.STYLES[o.style];
    g.insertAbove(items[items.length - 1]);
    const src = new P.Group({ insert: false, data: { role: 'warpSrc' } }); src.name = 'Envelope contents';
    items.forEach(it => src.addChild(it)); g.addChild(src); src.visible = false;
    WP.regen(g, true); LV.uidOf(g); LV.setSel([g]); return g;
  };
  const sel = () => LV.sel.filter(isWarp);
  WP.release = () => {
    const ws = sel(); if (!ws.length) return LV.toast('Select a warped object (envelope)');
    const out = [];
    ws.forEach(g => { WP.out(g)?.remove(); g.applyMatrix = true; const s = WP.src(g); const kids = s ? s.removeChildren() : []; g.parent.insertChildren(g.index, kids); out.push(...kids); g.remove(); });
    LV.setSel(out); LV.commit('Release Envelope');
  };
  WP.expandOne = g => {
    WP.regen(g); const o = WP.out(g); WP.src(g)?.remove(); g.applyMatrix = true;
    if (o) { const kids = o.removeChildren(); g.insertChildren(o.index, kids); o.remove(); }
    delete g.data.kind; delete g.data.warp; g.name = 'Warped'; g.children.forEach(c => LV.reUid(c)); return g;
  };
  WP.expand = () => { const ws = sel(); if (!ws.length) return LV.toast('Select a warped object (envelope)'); LV.setSel(ws.map(WP.expandOne)); LV.commit('Expand Envelope'); };
  WP.setOptions = (g, part, label = 'Warp Options') => {
    const o = WP.sanitize({ ...WP.sanitize(g.data.warp), ...part }); g.data.warp = o; g.name = 'Warp: ' + WP.STYLES[o.style];
    WP.regen(g, true); WP.last = o; if (label) LV.commit(label); else LV.redraw();
  };
  const fields = o => [{ key: 'style', label: 'Style', type: 'select', value: o.style, options: Object.entries(WP.STYLES) }, { key: 'vertical', label: 'Vertical', type: 'checkbox', value: o.vertical },
    { key: 'bend', label: 'Bend (%)', type: 'range', min: -100, max: 100, value: o.bend }, { key: 'dh', label: 'Horizontal distortion (%)', type: 'range', min: -100, max: 100, value: o.dh }, { key: 'dv', label: 'Vertical distortion (%)', type: 'range', min: -100, max: 100, value: o.dv }];
  // Object ▸ Envelope Distort ▸ Make with Warp… (or Warp Options… when a warp is selected)
  WP.dialog = () => {
    const existing = sel()[0];
    if (existing) {
      const before = JSON.stringify(existing.data.warp);
      return Aero.dialog({ title: 'Warp Options', instruction: 'Changes preview live on the canvas.', fields: fields(WP.sanitize(existing.data.warp)), onChange: v => WP.setOptions(existing, v, null), onOK: v => WP.setOptions(existing, v), onCancel: () => { existing.data.warp = JSON.parse(before); WP.regen(existing, true); LV.redraw(); } });
    }
    const items = LV.sortZ(LV.sel); if (!items.length) return LV.toast('Select the artwork or text to warp');
    const snap = LV.snapshot(); let g = WP.make(WP.last || WP.defaults, items); if (!g) return;
    Aero.dialog({
      title: 'Warp Options', instruction: 'Envelope Distort ▸ Make with Warp — preview is live; the original stays editable (Release).', fields: fields(WP.sanitize(g.data.warp)),
      onChange: v => WP.setOptions(g, v, null),
      onOK: v => { WP.setOptions(g, v, null); LV.commit('Make with Warp'); },
      onCancel: () => { LV.restore(snap, { keepSel: false }); LV.setSel(items.map(it => P.project.getItem({ match: x => x.data && x.data.uid === it.data.uid })).filter(Boolean)); }
    });
  };

  /* ---------- Properties panel section ---------- */
  let secEl = null, secSig = '';
  const esc = Aero.esc;
  function section() {
    if (!secEl) {
      const host = document.getElementById('pObj'); if (!host) return;
      secEl = Aero.el('div', 'pgroup'); secEl.id = 'pWarp'; secEl.hidden = true; host.after(secEl);
      secEl.addEventListener('input', e => { const k = e.target.dataset.w; if (k && e.target.type === 'range') e.target.nextElementSibling.textContent = e.target.value; });
      secEl.addEventListener('change', e => {
        const g = LV.sel[0], k = e.target.dataset.w; if (!g || !isWarp(g) || !k) return;
        const v = e.target.type === 'checkbox' ? e.target.checked : e.target.tagName === 'SELECT' ? e.target.value : parseFloat(e.target.value);
        if (typeof v === 'number' && !isFinite(v)) return;
        WP.setOptions(g, { [k]: v });
      });
      secEl.addEventListener('click', e => { const b = e.target.closest('button[data-wa]'); if (!b) return; ({ expand: WP.expand, release: WP.release })[b.dataset.wa](); });
    }
    const g = LV.sel.length === 1 && isWarp(LV.sel[0]) ? LV.sel[0] : null;
    secEl.hidden = !g; if (!g) { secSig = ''; secEl.innerHTML = ''; return; }
    const o = WP.sanitize(g.data.warp), sig = JSON.stringify(o); if (sig === secSig) return; secSig = sig;
    const rng = (k, label, title) => `<div class="prow"><span class="lbl" title="${esc(title)}">${label}</span><input type="range" min="-100" max="100" data-w="${k}" value="${o[k]}"><span class="dim n3">${o[k]}</span></div>`;
    secEl.innerHTML = `<div class="psub">Envelope Warp<span class="dim" style="font-weight:400;margin-left:5px">live</span></div>
      <div class="prow"><span class="lbl">Style</span><select data-w="style" style="flex:1">${Object.entries(WP.STYLES).map(([k, t]) => `<option value="${k}" ${k === o.style ? 'selected' : ''}>${t}</option>`).join('')}</select><label class="small" title="Warp along the vertical axis"><input type="checkbox" data-w="vertical" ${o.vertical ? 'checked' : ''}>Vertical</label></div>
      ${rng('bend', 'Bend', 'Bend amount (%)')}${rng('dh', 'Dist. H', 'Horizontal distortion (%)')}${rng('dv', 'Dist. V', 'Vertical distortion (%)')}
      <div class="brow wrap"><button class="aero-btn small" data-wa="expand" title="Object ▸ Envelope Distort ▸ Expand">Expand</button><button class="aero-btn small" data-wa="release" title="Get the original artwork back (Object ▸ Envelope Distort ▸ Release)">Release</button></div>`;
  }
  (LV.panelHooks = LV.panelHooks || []).push(section);
  // live repeats and warps are rebuilt (innermost first) whenever their source or options changed
  const depth = it => { let d = 0; for (let p = it.parent; p; p = p.parent) d++; return d; };
  LV.regenLive = () => P.project.getItems({ match: it => it.data && (it.data.kind === 'repeat' || it.data.kind === 'warp') }).sort((a, b) => depth(b) - depth(a))
    .forEach(g => { try { (g.data.kind === 'repeat' ? LV.repeat : WP).regen(g); } catch (e) { console.warn(g.data.kind, e); } });
  LV.on('precommit', LV.regenLive);
})();
