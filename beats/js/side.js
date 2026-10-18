'use strict';
/* Lumen Beats — right side panel: instrument editor (selected channel) and effects editor (selected mixer strip). */
(function () {
  const C = Core, $ = s => document.querySelector(s), esc = Aero.esc;
  const pInst = $('#side-inst'), pFx = $('#side-fx');
  const head = (title, color) => Aero.el('div', 'aero-ph', `<span class="phi" style="background:${color}"></span>${esc(title)}`);
  const grp = t => Aero.el('div', 'side-grp', esc(t));

  function renderInst() {
    const prj = App.prj, ch = App.ch; pInst.innerHTML = '';
    if (!ch) { pInst.appendChild(Aero.el('div', 'aero-pane dim', 'No channel selected.')); return; }
    const spec = C.INST[ch.type];
    pInst.appendChild(head(ch.name, `linear-gradient(#fff8,${ch.color})`));
    const box = Aero.el('div', 'aero-pane side-box'); pInst.appendChild(box);
    box.appendChild(Aero.el('div', 'side-type dim', esc(spec.name)));
    // routing
    const route = Aero.el('div', 'prow sel', `<label>Mixer insert</label><select>${['<option value="">Master</option>', ...prj.mixer.inserts.map((i, k) => `<option value="${i.id}" ${ch.out === i.id ? 'selected' : ''}>${k + 1} · ${esc(i.name)}</option>`)].join('')}</select>`);
    route.querySelector('select').onchange = e => { ch.out = e.target.value || null; App.commit('Route channel', ['rack', 'side', 'mixer']); };
    box.appendChild(route);
    box.appendChild(App.paramRow(C.VOL, ch.vol, v => { ch.vol = v; App.live([]); }, v => { ch.vol = v; App.commit('Channel volume', ['rack']); }, () => App.addAutomation(`ch:${ch.id}:vol`)));
    box.appendChild(App.paramRow(C.PAN, ch.pan, v => { ch.pan = v; App.live([]); }, v => { ch.pan = v; App.commit('Channel pan', ['rack']); }, () => App.addAutomation(`ch:${ch.id}:pan`)));
    if (App.PRESETS[ch.type]) {
      const pr = Aero.el('div', 'prow sel', `<label>Preset</label><select><option value="">Choose…</option>${Object.keys(App.PRESETS[ch.type]).map(k => `<option>${esc(k)}</option>`).join('')}</select>`);
      pr.querySelector('select').onchange = e => { const p = App.PRESETS[ch.type][e.target.value]; if (!p) return; ch.params = C.cleanParams(spec.params, { ...C.specDefaults(spec.params), ...p }); App.commit('Preset ' + e.target.value, ['side']); Engine.noteOn(ch.id, ch.type === 'fm' ? 60 : 48, 100, 0.4); };
      box.appendChild(pr);
    }
    if (ch.type === 'sampler') {
      const s = App.samples[ch.sample], buf = Engine.buffers.get(ch.sample);
      const sb = Aero.el('div', 'smp-box', `<div class="smp-name">${s ? esc(s.name) : '<span class="dim">No sample loaded</span>'}</div><canvas class="smp-wave"></canvas>
        <div class="smp-info dim">${buf ? `${buf.duration.toFixed(2)} s · ${buf.sampleRate} Hz · ${buf.numberOfChannels === 1 ? 'mono' : 'stereo'}` : 'Import a WAV or MP3 file'}</div><button class="aero-btn small">Load sample…</button>`);
      sb.querySelector('button').onclick = () => App.importSample(ch);
      box.appendChild(sb);
      if (buf) requestAnimationFrame(() => drawWave(sb.querySelector('canvas'), buf, ch.params));
    }
    let g = null;
    for (const s of spec.params) {
      if (s.grp !== g) { g = s.grp; box.appendChild(grp(g)); }
      const auto = s.auto === false || s.opts || s.bool ? null : () => App.addAutomation(`ch:${ch.id}:p:${s.k}`);
      box.appendChild(App.paramRow(s, ch.params[s.k], v => { ch.params[s.k] = v; App.live([]); }, v => { ch.params[s.k] = v; App.commit(s.label, ['side', 'rack']); if (s.opts || s.bool) Engine.noteOn(ch.id, ch.type === 'sampler' ? ch.params.root : 60, 100, 0.3); }, auto));
    }
    const t = Aero.el('div', 'side-foot');
    t.innerHTML = `<button class="aero-btn small" id="si-test">▶ Test note</button><span class="dim">“A” = add an automation lane</span>`;
    t.querySelector('#si-test').onclick = () => Engine.noteOn(ch.id, ch.type === 'sampler' ? ch.params.root : ch.type === 'drum' ? 60 : 57, 105, 0.5);
    box.appendChild(t);
  }
  function drawWave(cv, buf, P) {
    const [g, w, h] = App.fitCanvas(cv), d = buf.getChannelData(0), n = d.length;
    g.fillStyle = '#152230'; g.fillRect(0, 0, w, h); g.fillStyle = '#7cc4ff';
    for (let x = 0; x < w; x++) { let lo = 0, hi = 0; const a = Math.floor(x / w * n), b = Math.floor((x + 1) / w * n); for (let i = a; i < b; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; } g.fillRect(x, h / 2 - hi * h / 2, 1, Math.max(1, (hi - lo) * h / 2)); }
    g.fillStyle = '#ffd34a'; g.fillRect(P.start * w, 0, 1.5, h);
  }

  function renderFx() {
    const prj = App.prj; pFx.innerHTML = '';
    const id = App.sel.ins || 'master', master = id === 'master', strip = master ? prj.mixer.master : C.findIns(prj, id);
    if (!strip) { pFx.appendChild(Aero.el('div', 'aero-pane dim', 'Select a mixer strip.')); return; }
    pFx.appendChild(head((master ? 'Master' : strip.name) + ' · Effects', 'linear-gradient(#e0d0ff,#7a5ad0)'));
    const list = Aero.el('div', 'aero-list fx-list'); pFx.appendChild(list);
    strip.fx.forEach((f, i) => {
      const it = Aero.el('div', 'aero-item' + (f.id === App.sel.fx ? ' sel' : ''), `<input type="checkbox" ${f.on ? 'checked' : ''} title="Enable / bypass"><i class="fxdot" style="background:${C.FX[f.type].color}"></i><span class="grow">${i + 1}. ${esc(C.FX[f.type].name)}</span>`);
      it.onclick = e => { if (e.target.type === 'checkbox') return; App.sel.fx = f.id; renderFx(); App.refresh(['mixer']); };
      it.querySelector('input').onchange = e => { f.on = e.target.checked; App.commit(f.on ? 'Enable effect' : 'Bypass effect', ['mixer', 'side']); };
      list.appendChild(it);
    });
    if (!strip.fx.length) list.appendChild(Aero.el('div', 'dim fx-empty', 'No effects. Add EQ, compressor, filter, delay, reverb, distortion or chorus.'));
    const bar = Aero.el('div', 'aero-iconbar', `<select class="fx-add"><option value="">+ Add effect…</option>${Object.entries(C.FX).map(([k, d]) => `<option value="${k}">${esc(d.name)}</option>`).join('')}</select>
      <span style="flex:1"></span><button class="aero-iconbtn" data-a="up" title="Move up"><svg viewBox="0 0 16 16"><path d="M8 3 3 9h3v4h4V9h3z" fill="url(#gBlue)" stroke="#174a85" stroke-width=".8"/></svg></button>
      <button class="aero-iconbtn" data-a="down" title="Move down"><svg viewBox="0 0 16 16"><path d="M8 13 3 7h3V3h4v4h3z" fill="url(#gBlue)" stroke="#174a85" stroke-width=".8"/></svg></button>
      <button class="aero-iconbtn" data-a="del" title="Remove effect"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.3" fill="url(#gRed)" stroke="#8a1a10"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg></button>`);
    bar.querySelector('.fx-add').onchange = e => { const t = e.target.value; if (!t) return; const fx = C.newFx(t); strip.fx.push(fx); App.sel.fx = fx.id; App.commit('Add ' + C.FX[t].name, ['mixer', 'side']); };
    bar.querySelectorAll('button').forEach(b => b.onclick = () => {
      const i = strip.fx.findIndex(f => f.id === App.sel.fx); if (i < 0) return; const a = b.dataset.a;
      if (a === 'del') { strip.fx.splice(i, 1); prj.automation = prj.automation.filter(l => !l.target.includes(':' + App.sel.fx + ':')); App.sel.fx = strip.fx[Math.min(i, strip.fx.length - 1)]?.id || null; App.commit('Remove effect', ['mixer', 'side', 'pl']); return; }
      const j = a === 'up' ? i - 1 : i + 1; if (j < 0 || j >= strip.fx.length) return; const [f] = strip.fx.splice(i, 1); strip.fx.splice(j, 0, f); App.commit('Reorder effects', ['mixer', 'side']);
    });
    pFx.appendChild(bar);
    const f = strip.fx.find(x => x.id === App.sel.fx);
    if (f) {
      const box = Aero.el('div', 'aero-pane side-box'); pFx.appendChild(box);
      box.appendChild(grp(C.FX[f.type].name + (f.on ? '' : ' (bypassed)')));
      for (const s of C.FX[f.type].params) {
        const auto = s.auto === false || s.opts || s.bool ? null : () => App.addAutomation(`fx:${id}:${f.id}:${s.k}`);
        box.appendChild(App.paramRow(s, f.p[s.k], v => { f.p[s.k] = v; App.live([]); }, v => { f.p[s.k] = v; App.commit(C.FX[f.type].name + ': ' + s.label, ['side']); }, auto));
      }
    }
    if (!master) {
      const box = Aero.el('div', 'aero-pane side-box'); pFx.appendChild(box);
      box.appendChild(grp('Sends (post-fader)'));
      strip.sends.forEach((x, i) => {
        const to = C.findIns(prj, x.to); if (!to) return;
        const row = App.paramRow({ ...C.SEND, label: '→ ' + to.name }, x.amt, v => { x.amt = v; App.live([]); }, v => { x.amt = v; App.commit('Send level', ['mixer']); }, () => App.addAutomation(`ins:${id}:send:${x.to}`));
        const del = Aero.el('button', 'abtn del', '×'); del.title = 'Remove send'; del.onclick = () => { strip.sends.splice(i, 1); App.commit('Remove send', ['mixer', 'side']); }; row.appendChild(del);
        box.appendChild(row);
      });
      const cands = prj.mixer.inserts.filter(i => i.id !== id && !strip.sends.some(s => s.to === i.id) && !reaches(prj, i.id, id));
      const add = Aero.el('div', 'prow sel', `<label>Add send</label><select><option value="">to insert…</option>${cands.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select>`);
      add.querySelector('select').onchange = e => { if (!e.target.value) return; strip.sends.push({ to: e.target.value, amt: -6 }); App.commit('Add send', ['mixer', 'side']); };
      box.appendChild(add);
      box.appendChild(App.paramRow(C.VOL, strip.vol, v => { strip.vol = v; App.live([]); }, v => { strip.vol = v; App.commit('Insert volume', ['mixer']); }, () => App.addAutomation(`ins:${id}:vol`)));
      box.appendChild(App.paramRow(C.PAN, strip.pan, v => { strip.pan = v; App.live([]); }, v => { strip.pan = v; App.commit('Insert pan', ['mixer']); }, () => App.addAutomation(`ins:${id}:pan`)));
      const fed = prj.channels.filter(c => c.out === id);
      box.appendChild(Aero.el('div', 'dim side-note', fed.length ? 'Channels routed here: ' + esc(fed.map(c => c.name).join(', ')) : 'No channels are routed to this insert (use it as a send bus, or route a channel in the Channel Rack).'));
    } else {
      const box = Aero.el('div', 'aero-pane side-box'); pFx.appendChild(box);
      box.appendChild(App.paramRow(C.VOL, strip.vol, v => { strip.vol = v; App.live([]); }, v => { strip.vol = v; App.commit('Master volume', ['mixer']); }, () => App.addAutomation('master:vol')));
    }
  }
  function reaches(prj, from, target, seen = new Set()) { if (from === target) return true; if (seen.has(from)) return false; seen.add(from); const i = C.findIns(prj, from); return !!i && i.sends.some(s => reaches(prj, s.to, target, seen)); }
  function render() { renderInst(); renderFx(); }
  App.views.side = { render };
})();
