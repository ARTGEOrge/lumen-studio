'use strict';
/* Lumen Beats — Channel Rack: one row per instrument channel, step sequencer for the selected pattern. */
(function () {
  const C = Core, $ = s => document.querySelector(s), esc = Aero.esc;
  const root = $('#v-rack');
  let lastStep = -1;
  const isMelodic = notes => notes?.some(n => n.t % C.STEP || n.p !== 60 || n.d > C.STEP * 2);
  const stepPitch = ch => ch.type === 'drum' ? 60 : 60;

  function render() {
    if (!App.prj) return; const prj = App.prj, pat = App.pat; if (!pat) return;
    const spb = C.barTicks(prj) / C.STEP, steps = Math.round(pat.bars * spb);
    const width = root.clientWidth || 900, avail = width - 330;
    const sw = Math.max(15, Math.min(30, Math.floor(avail / steps)));
    root.innerHTML = '';
    const head = Aero.el('div', 'rk-head');
    head.innerHTML = `<span class="pat-dot" style="background:${pat.color}"></span><b class="rk-pname" title="Double-click to rename">${esc(pat.name)}</b>
      <label>Length <select id="rk-bars">${[1, 2, 3, 4, 8, 16].map(b => `<option value="${b}" ${b === pat.bars ? 'selected' : ''}>${b} bar${b > 1 ? 's' : ''}</option>`).join('')}</select></label>
      <button class="aero-btn small" id="rk-add">+ Channel</button><button class="aero-btn small" id="rk-clear" title="Remove every note of this pattern">Clear</button>
      <span class="grow"></span><span class="dim">Click steps to toggle · drag to paint · wheel = velocity · double-click a channel for the Piano Roll</span>`;
    root.appendChild(head);
    head.querySelector('#rk-bars').onchange = e => { pat.bars = +e.target.value; App.commit('Pattern length'); };
    head.querySelector('.rk-pname').ondblclick = renamePattern;
    head.querySelector('#rk-add').onclick = e => { const r = e.target.getBoundingClientRect(); App.ctxMenu(r.left, r.bottom, addChannelItems()); };
    head.querySelector('#rk-clear').onclick = () => { pat.notes = {}; App.commit('Clear pattern'); };
    const list = Aero.el('div', 'rk-list'); root.appendChild(list);
    prj.channels.forEach((ch, ci) => {
      const row = Aero.el('div', 'rk-row' + (ch.id === App.sel.ch ? ' sel' : ''));
      const ins = C.findIns(prj, ch.out), insNo = ins ? prj.mixer.inserts.indexOf(ins) + 1 : 'M';
      row.innerHTML = `<button class="led ${ch.mute ? '' : 'on'}" title="Mute (click) · solo (right-click)">${ch.solo ? 'S' : ''}</button>
        <input type="range" class="knob pan" min="-100" max="100" value="${Math.round(ch.pan * 100)}" title="Pan ${C.fmtPan(ch.pan)}">
        <input type="range" class="knob vol" min="-600" max="60" value="${Math.round(ch.vol * 10)}" title="Volume ${C.fmtDb(ch.vol)}">
        <button class="chname" style="--c:${ch.color}" title="${esc(C.INST[ch.type].name)}">${esc(ch.name)}</button>
        <button class="insno" title="Mixer insert (click to route)">${insNo}</button>`;
      const notes = pat.notes[ch.id] || [];
      if (isMelodic(notes)) {
        const cv = Aero.el('canvas', 'rk-mini'); cv.style.width = sw * steps + 'px'; cv.title = 'Melodic part — click to edit in the Piano Roll';
        cv.onclick = () => { selectChannel(ch.id); App.showView('roll'); };
        row.appendChild(cv); requestAnimationFrame(() => drawMini(cv, notes, pat, ch));
      } else {
        const st = Aero.el('div', 'steps'); st.style.gridTemplateColumns = `repeat(${steps}, ${sw}px)`;
        const at = new Map(notes.map(n => [n.t / C.STEP, n]));
        for (let i = 0; i < steps; i++) {
          const n = at.get(i), b = Aero.el('div', 'step' + (Math.floor(i / 4) % 2 ? ' alt' : '') + (n ? ' on' : '') + (i % spb === 0 ? ' bar' : ''));
          b.dataset.i = i; if (n) b.style.setProperty('--v', (n.v / 127).toFixed(3));
          st.appendChild(b);
        }
        row.appendChild(st); bindSteps(st, ch);
      }
      row.querySelector('.led').onclick = () => { ch.mute = !ch.mute; App.commit(ch.mute ? 'Mute channel' : 'Unmute channel', ['rack']); };
      row.querySelector('.led').oncontextmenu = e => { e.preventDefault(); ch.solo = !ch.solo; App.commit(ch.solo ? 'Solo channel' : 'Unsolo channel', ['rack']); };
      const pan = row.querySelector('.pan'), vol = row.querySelector('.vol');
      pan.oninput = () => { ch.pan = +pan.value / 100; pan.title = 'Pan ' + C.fmtPan(ch.pan); App.hover(ch.name + ' pan ' + C.fmtPan(ch.pan)); App.live(['side']); };
      pan.onchange = () => App.commit('Channel pan', ['side']); pan.ondblclick = () => { ch.pan = 0; App.commit('Channel pan'); };
      vol.oninput = () => { ch.vol = +vol.value / 10; vol.title = 'Volume ' + C.fmtDb(ch.vol); App.hover(ch.name + ' volume ' + C.fmtDb(ch.vol)); App.live(['side']); };
      vol.onchange = () => App.commit('Channel volume', ['side']); vol.ondblclick = () => { ch.vol = 0; App.commit('Channel volume'); };
      const nm = row.querySelector('.chname');
      nm.onclick = () => { selectChannel(ch.id); Engine.noteOn(ch.id, ch.type === 'sampler' ? ch.params.root : 60, 100, 0.25); };
      nm.ondblclick = () => { selectChannel(ch.id); App.showView('roll'); };
      nm.oncontextmenu = e => { e.preventDefault(); selectChannel(ch.id); App.ctxMenu(e.clientX, e.clientY, channelMenu(ch, ci)); };
      row.querySelector('.insno').onclick = e => { const r = e.target.getBoundingClientRect(); App.ctxMenu(r.left, r.bottom, routeItems(ch)); };
      list.appendChild(row);
    });
    if (!prj.channels.length) list.appendChild(Aero.el('div', 'rk-empty dim', 'No channels yet — use “+ Channel” to add a synth, drum or sampler.'));
    lastStep = -1;
    $('#ed-info').textContent = `${prj.channels.length} channels · ${pat.name} · ${pat.bars} bar${pat.bars > 1 ? 's' : ''}`;
  }
  function drawMini(cv, notes, pat, ch) {
    const [g, w, h] = App.fitCanvas(cv), L = C.patLen(App.prj, pat);
    g.fillStyle = '#20303f'; g.fillRect(0, 0, w, h);
    if (!notes.length) return;
    let lo = 127, hi = 0; for (const n of notes) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
    lo -= 1; hi += 1; const rh = Math.max(1.5, Math.min(4, (h - 4) / (hi - lo + 1)));
    g.fillStyle = ch.color;
    for (const n of notes) { if (n.t >= L) continue; const x = n.t / L * w, y = h - 2 - (n.p - lo + 1) * ((h - 4) / (hi - lo + 1)); g.fillRect(x, y, Math.max(2, n.d / L * w - 1), rh); }
  }
  function bindSteps(st, ch) {
    let paint = null, last = -1;
    const apply = i => {   // fast drags skip cells: fill everything between the previous and current step
      if (i === last || i < 0) return;
      if (last >= 0 && Math.abs(i - last) > 1) { const dir = Math.sign(i - last); for (let k = last + dir; k !== i; k += dir) { const l = last; last = -2; apply1(k); last = l; } }
      last = i; apply1(i);
    };
    const apply1 = i => {
      const pat = App.pat, arr = pat.notes[ch.id] || (pat.notes[ch.id] = []);
      const t = i * C.STEP, idx = arr.findIndex(n => n.t === t);
      if (paint === 'on' && idx < 0) { arr.push({ t, d: C.STEP, p: stepPitch(ch), v: 100 }); C.sortNotes(arr); Engine.noteOn(ch.id, 60, 100, 0.2); }
      if (paint === 'off' && idx >= 0) arr.splice(idx, 1);
      const el = st.children[i]; el.classList.toggle('on', paint === 'on'); el.style.setProperty('--v', '0.787');
      Engine.setProject(App.prj);
    };
    const idxAt = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.parentNode === st ? +el.dataset.i : -1; };
    st.onpointerdown = e => {
      const i = idxAt(e); if (i < 0) return; e.preventDefault();
      const has = (App.pat.notes[ch.id] || []).some(n => n.t === i * C.STEP);
      paint = e.button === 2 ? 'off' : has ? 'off' : 'on'; last = -1; apply(i);
      App.drag(e, ev => apply(idxAt(ev)), () => { paint = null; App.commit('Edit steps', ['pl', 'roll', 'rack']); });
    };
    st.oncontextmenu = e => e.preventDefault();
    st.onwheel = e => {
      const i = idxAt(e); if (i < 0) return; const n = (App.pat.notes[ch.id] || []).find(x => x.t === i * C.STEP); if (!n) return;
      e.preventDefault(); n.v = C.clamp(n.v + (e.deltaY < 0 ? 8 : -8), 1, 127); st.children[i].style.setProperty('--v', (n.v / 127).toFixed(3));
      App.hover('Velocity ' + n.v); clearTimeout(st._wt); st._wt = setTimeout(() => App.commit('Step velocity', ['roll']), 400); Engine.setProject(App.prj);
    };
  }
  function selectChannel(id) { App.sel.ch = id; App.sel.notes.clear(); App.refresh(['rack', 'roll', 'side']); App.showSide('inst'); }
  function renamePattern() { Aero.prompt('Rename pattern', 'Name', App.pat.name).then(n => { if (n) { App.pat.name = n.slice(0, 40); App.commit('Rename pattern'); } }); }
  function addChannelItems() {
    const add = (type, o) => () => App.addChannel(type, o);
    return ['#Synthesizers', { label: 'Lumen Sub — subtractive synth', fn: add('sub') }, { label: 'Lumen FM — FM synth', fn: add('fm') }, '-', '#Drum voices (synthesized)',
      ...C.INST.drum.params[0].opts.map(([k, n]) => ({ label: n, fn: add('drum', { name: n, params: { kind: k, choke: k === 'hat' || k === 'ohat' ? 1 : 0 } }) })),
      '-', { label: 'Sampler — import WAV / MP3…', fn: () => App.importSample() }];
  }
  function routeItems(ch) {
    const prj = App.prj;
    return ['#Route channel to', { label: 'Master (no insert)', checked: !C.findIns(prj, ch.out), fn: () => { ch.out = null; App.commit('Route channel'); } },
      ...prj.mixer.inserts.map((i, k) => ({ label: `${k + 1} · ${i.name}`, checked: ch.out === i.id, fn: () => { ch.out = i.id; App.commit('Route channel'); } })),
      '-', { label: 'New insert for this channel', fn: () => { const ins = C.newInsert(ch.name, { color: ch.color }); prj.mixer.inserts.push(ins); ch.out = ins.id; App.commit('New insert'); } }];
  }
  function channelMenu(ch, ci) {
    const prj = App.prj;
    return [{ label: 'Rename…', fn: () => Aero.prompt('Rename channel', 'Name', ch.name).then(n => { if (n) { ch.name = n.slice(0, 40); App.commit('Rename channel'); } }) },
      { label: 'Colour…', fn: () => colorDialog(ch) },
      { label: 'Open in Piano Roll', key: 'F7', fn: () => App.showView('roll') },
      ...(ch.type === 'sampler' ? [{ label: 'Replace sample…', fn: () => App.importSample(ch) }] : []),
      '-', { label: 'Duplicate', fn: () => { const c = JSON.parse(JSON.stringify(ch)); c.id = C.uid(); c.name = ch.name + ' 2'; prj.channels.splice(ci + 1, 0, c); App.sel.ch = c.id; App.commit('Duplicate channel'); } },
      { label: 'Move up', disabled: ci === 0, fn: () => { prj.channels.splice(ci, 1); prj.channels.splice(ci - 1, 0, ch); App.commit('Move channel'); } },
      { label: 'Move down', disabled: ci === prj.channels.length - 1, fn: () => { prj.channels.splice(ci, 1); prj.channels.splice(ci + 1, 0, ch); App.commit('Move channel'); } },
      '-', { label: 'Clear notes in this pattern', fn: () => { delete App.pat.notes[ch.id]; App.commit('Clear channel'); } },
      { label: 'Delete channel', fn: () => App.deleteChannel(ch) }];
  }
  function colorDialog(obj) {
    Aero.dialog({ title: 'Colour', fields: [{ key: 'c', label: 'Colour', type: 'color', value: obj.color }], onOK: v => { obj.color = v.c; App.commit('Colour'); } });
  }
  // playhead step highlight (pattern mode)
  function tick(pos) {
    const pat = App.pat; let s = -1;
    if (pos != null && Engine.mode === 'pattern') s = Math.floor((pos % C.patLen(App.prj, pat)) / C.STEP);
    if (s === lastStep) return; lastStep = s;
    root.querySelectorAll('.step.now').forEach(x => x.classList.remove('now'));
    if (s >= 0) root.querySelectorAll(`.steps > .step:nth-child(${s + 1})`).forEach(x => x.classList.add('now'));
  }
  App.views.rack = { render, tick, addChannelItems, colorDialog };
  App.selectChannel = selectChannel;
  new ResizeObserver(() => { if (!root.hidden) render(); }).observe(root);
})();
