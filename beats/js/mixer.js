'use strict';
/* Lumen Beats — Mixer: master + insert strips with meters, faders, pan, mute/solo, FX slots and sends. */
(function () {
  const C = Core, $ = s => document.querySelector(s), esc = Aero.esc;
  const root = $('#v-mixer');
  const peaks = {};
  function render() {
    const prj = App.prj; root.innerHTML = '';
    const wrap = Aero.el('div', 'mx-wrap');
    const strips = [['master', prj.mixer.master], ...prj.mixer.inserts.map(i => [i.id, i])];
    strips.forEach(([id, s], k) => wrap.appendChild(strip(id, s, k)));
    const add = Aero.el('button', 'aero-btn mx-add', '+ Insert'); add.onclick = () => { const i = C.newInsert('Insert ' + (prj.mixer.inserts.length + 1), { color: C.COLORS[prj.mixer.inserts.length % 8] }); prj.mixer.inserts.push(i); App.sel.ins = i.id; App.commit('Add insert'); };
    wrap.appendChild(add);
    root.appendChild(wrap);
    $('#ed-info').textContent = `${prj.mixer.inserts.length} inserts · click a strip to edit its effects`;
  }
  function strip(id, s, k) {
    const prj = App.prj, master = id === 'master', sel = App.sel.ins === id;
    const el = Aero.el('div', 'mx-strip' + (sel ? ' sel' : '') + (master ? ' master' : ''));
    el.style.setProperty('--c', master ? '#3a8fe0' : s.color);
    const fed = master ? '' : prj.channels.filter(c => c.out === id).map(c => c.name).join(', ');
    el.innerHTML = `<div class="mx-name" title="${esc(master ? 'Master output' : (fed ? 'Fed by: ' + fed : 'No channels routed here') + ' — double-click to rename')}"><span class="no">${master ? 'M' : k}</span>${esc(master ? 'Master' : s.name)}</div>
      <div class="mx-fx"></div>
      <div class="mx-sends"></div>
      <div class="mx-fader"><canvas class="mx-meter" data-id="${id}"></canvas><input type="range" class="vfader" min="-600" max="60" step="1" value="${Math.round(s.vol * 10)}"></div>
      <div class="mx-db">${C.fmtDb(s.vol)}</div>
      ${master ? '<div class="mx-pan"></div>' : `<input type="range" class="mx-panr" min="-100" max="100" value="${Math.round(s.pan * 100)}" title="Pan ${C.fmtPan(s.pan)}">`}
      <div class="mx-ms">${master ? '' : `<button class="mb ${s.mute ? 'on' : ''}" data-a="m" title="Mute">M</button><button class="mb solo ${s.solo ? 'on' : ''}" data-a="s" title="Solo">S</button>`}</div>`;
    el.onpointerdown = () => { if (App.sel.ins !== id) { App.sel.ins = id; App.sel.fx = s.fx[0]?.id || null; root.querySelectorAll('.mx-strip').forEach(x => x.classList.toggle('sel', x === el)); App.refresh(['side']); } App.showSide('fx'); };
    const fxBox = el.querySelector('.mx-fx');
    s.fx.forEach(f => {
      const b = Aero.el('div', 'mx-slot' + (f.on ? '' : ' off') + (App.sel.fx === f.id && sel ? ' cur' : ''), `<i style="background:${C.FX[f.type].color}"></i>${esc(C.FX[f.type].name)}`);
      b.onclick = e => { e.stopPropagation(); App.sel.ins = id; App.sel.fx = f.id; App.refresh(['mixer', 'side']); App.showSide('fx'); };
      fxBox.appendChild(b);
    });
    if (s.fx.length < 8) { const a = Aero.el('div', 'mx-slot empty', '+ effect'); a.onclick = e => { e.stopPropagation(); const r = a.getBoundingClientRect(); App.ctxMenu(r.left, r.bottom, fxMenu(id, s)); }; fxBox.appendChild(a); }
    if (!master) {
      const sb = el.querySelector('.mx-sends');
      s.sends.forEach(x => {
        const to = C.findIns(prj, x.to); if (!to) return;
        const row = Aero.el('div', 'mx-send', `<span title="Send to ${esc(to.name)}">→ ${esc(to.name)}</span><input type="range" min="-600" max="60" value="${Math.round(x.amt * 10)}" title="${C.fmtDb(x.amt)}">`);
        const r = row.querySelector('input');
        r.oninput = () => { x.amt = +r.value / 10; r.title = C.fmtDb(x.amt); App.hover(`${s.name} → ${to.name}: ${C.fmtDb(x.amt)}`); App.live(['side']); };
        r.onchange = () => App.commit('Send level', ['side']);
        sb.appendChild(row);
      });
      el.querySelector('.mx-name').ondblclick = () => Aero.prompt('Rename insert', 'Name', s.name).then(n => { if (n) { s.name = n.slice(0, 40); App.commit('Rename insert'); } });
      el.querySelector('.mx-name').oncontextmenu = e => { e.preventDefault(); App.ctxMenu(e.clientX, e.clientY, insertMenu(s, k - 1)); };
      const pan = el.querySelector('.mx-panr');
      pan.oninput = () => { s.pan = +pan.value / 100; pan.title = 'Pan ' + C.fmtPan(s.pan); App.hover(s.name + ' pan ' + C.fmtPan(s.pan)); App.live(['side']); };
      pan.onchange = () => App.commit('Insert pan'); pan.ondblclick = () => { s.pan = 0; App.commit('Insert pan'); };
      el.querySelectorAll('.mb').forEach(b => b.onclick = e => { e.stopPropagation(); if (b.dataset.a === 'm') s.mute = !s.mute; else s.solo = !s.solo; App.commit(b.dataset.a === 'm' ? 'Mute insert' : 'Solo insert', ['mixer']); });
    }
    const f = el.querySelector('.vfader'), db = el.querySelector('.mx-db');
    f.oninput = () => { s.vol = +f.value / 10; db.textContent = C.fmtDb(s.vol); App.hover((master ? 'Master' : s.name) + ' ' + C.fmtDb(s.vol)); App.live(['side']); };
    f.onchange = () => App.commit(master ? 'Master volume' : 'Insert volume', ['side']);
    f.ondblclick = () => { s.vol = 0; App.commit('Reset volume'); };
    return el;
  }
  function fxMenu(id, s) {
    return ['#Add effect', ...Object.entries(C.FX).map(([t, d]) => ({ label: d.name, fn: () => { const fx = C.newFx(t); s.fx.push(fx); App.sel.ins = id; App.sel.fx = fx.id; App.commit('Add ' + d.name); App.showSide('fx'); } }))];
  }
  function insertMenu(s, i) {
    const prj = App.prj;
    return [{ label: 'Rename…', fn: () => Aero.prompt('Rename insert', 'Name', s.name).then(n => { if (n) { s.name = n.slice(0, 40); App.commit('Rename insert'); } }) },
      { label: 'Colour…', fn: () => App.views.rack.colorDialog(s) },
      { label: 'Move left', disabled: i === 0, fn: () => { prj.mixer.inserts.splice(i, 1); prj.mixer.inserts.splice(i - 1, 0, s); App.commit('Move insert'); } },
      { label: 'Move right', disabled: i === prj.mixer.inserts.length - 1, fn: () => { prj.mixer.inserts.splice(i, 1); prj.mixer.inserts.splice(i + 1, 0, s); App.commit('Move insert'); } },
      '-', { label: 'Delete insert', fn: () => App.deleteInsert(s) }];
  }
  // meters (called every animation frame while visible)
  function tick() {
    if (root.hidden) return;
    const lv = Engine.levels();
    root.querySelectorAll('.mx-meter').forEach(cv => {
      const id = cv.dataset.id, v = lv[id] || [0, 0], pk = peaks[id] || (peaks[id] = [0, 0]);
      const [g, w, h] = App.fitCanvas(cv);
      g.fillStyle = '#0d1620'; g.fillRect(0, 0, w, h);
      const bw = (w - 3) / 2;
      for (let c = 0; c < 2; c++) {
        pk[c] = Math.max(v[c], pk[c] * 0.93);
        const db = pk[c] > 0 ? 20 * Math.log10(pk[c]) : -90, f = C.clamp((db + 60) / 66, 0, 1), y = h - f * h;
        const grd = g.createLinearGradient(0, h, 0, 0); grd.addColorStop(0, '#2fbf4a'); grd.addColorStop(0.75, '#c8e83a'); grd.addColorStop(0.9, '#ffb020'); grd.addColorStop(1, '#ff3a2a');
        g.fillStyle = grd; g.fillRect(1 + c * (bw + 1), y, bw, h - y);
      }
      g.fillStyle = 'rgba(255,255,255,.18)'; for (const d of [0, -6, -12, -24, -48]) g.fillRect(0, h - (d + 60) / 66 * h, w, 1);
    });
  }
  App.views.mixer = { render, tick };
})();
