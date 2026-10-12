'use strict';
/* Lumen Cut — Audio Track Mixer: one strip per audio track (pan, fader, live stereo meter, mute/solo,
   volume automation stopwatch + add keyframe) plus the master strip. */
(function () {
  const $ = Aero.$, esc = Aero.esc, A = LC.audio;
  const mixer = LC.mixer = { strips: [] };
  const watch = '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.5" fill="#fff" stroke="currentColor" stroke-width="1.3"/><path d="M8 9V6M6.5 1.8h3M12 4.5l1-1" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>';
  const dia = '<svg viewBox="0 0 10 10"><path d="M5 1 9 5 5 9 1 5z" fill="currentColor" stroke="#334" stroke-width=".8"/></svg>';
  const panTxt = v => Math.abs(v) < .5 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v));
  mixer.visible = () => { const el = $('#mixer'); return !!el && !el.closest('[hidden]') && el.getClientRects().length > 0; };

  mixer.render = () => {
    const box = $('#mixer'); if (!box || !LC.project) return;
    box.innerHTML = ''; mixer.strips = [];
    const solo = LC.project.tracks.some(t => t.kind === 'audio' && t.solo);
    for (const tr of LC.audioTracks()) {
      const auto = !!tr.kf?.vol?.length;
      const s = Aero.el('div', 'mstrip' + (tr.mute || (solo && !tr.solo) ? ' quiet' : ''));
      s.innerHTML = `<div class="mname" title="Track ${esc(tr.name)}"></div>
        <div class="mpan"><input type="range" min="-100" max="100" step="1" title="Pan (double-click centres)"><span class="mpanv"></span></div>
        <div class="mfbox"><canvas class="mmeter"></canvas><span class="mfwrap"><input type="range" class="mfader" min="-60" max="12" step="0.1" title="Track volume (double-click = 0 dB)"></span></div>
        <input type="number" class="mdb" min="-60" max="12" step="0.1" title="Track volume (dB)">
        <div class="mbtns"><button class="tbtn txt${tr.mute ? ' on red' : ''}" data-a="mute" title="Mute">M</button><button class="tbtn txt${tr.solo ? ' on yel' : ''}" data-a="solo" title="Solo">S</button></div>
        <div class="mbtns"><button class="kfw${auto ? ' on' : ''}" data-a="auto" title="Volume automation (keyframes on the timeline)">${watch}</button><button class="mkey" data-a="key" title="Add volume keyframe at playhead" ${auto ? '' : 'disabled'}>${dia}</button></div>`;
      s.querySelector('.mname').textContent = tr.name;
      const pan = s.querySelector('.mpan input'), panv = s.querySelector('.mpanv'), fader = s.querySelector('.mfader'), db = s.querySelector('.mdb');
      pan.value = tr.pan || 0; panv.textContent = panTxt(tr.pan || 0);
      pan.oninput = () => { tr.pan = +pan.value; panv.textContent = panTxt(tr.pan); A.liveTrack(tr); };
      pan.onchange = () => LC.commit('Pan ' + tr.name);
      pan.ondblclick = () => { tr.pan = 0; pan.value = 0; panv.textContent = 'C'; A.liveTrack(tr); LC.commit('Pan ' + tr.name); };
      const setVol = (v, commit) => {
        v = Math.max(-60, Math.min(12, +v)); if (isNaN(v)) return;
        if (tr.kf?.vol?.length) LC.setKey(tr, 'vol', LC.fr(LC.playhead), +v.toFixed(1)); else tr.vol = +v.toFixed(1);
        A.liveTrack(tr); LC.tl.draw();
        if (commit) { LC.commit('Volume ' + tr.name); if (LC.playing && tr.kf?.vol?.length) LC.restartPlayback(); }
      };
      fader.oninput = () => { db.value = (+fader.value).toFixed(1); setVol(fader.value, false); };
      fader.onchange = () => setVol(fader.value, true);
      fader.ondblclick = () => { fader.value = 0; setVol(0, true); };
      db.onchange = () => { fader.value = db.value; setVol(db.value, true); };
      s.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'mute' || a === 'solo') { tr[a] = !tr[a]; LC.commit(`${a === 'mute' ? 'Mute' : 'Solo'} ${tr.name}`); LC.refresh(); if (LC.playing) LC.restartPlayback(); return; }
        if (a === 'auto') {
          if (tr.kf?.vol?.length) { tr.vol = +LC.trackVol(tr, LC.playhead).toFixed(1); delete tr.kf.vol; LC.commit('Remove volume automation'); }
          else { tr.kf = tr.kf || {}; LC.setKey(tr, 'vol', LC.fr(LC.playhead), tr.vol || 0); LC.commit('Volume automation ' + tr.name); Aero.toast('Automation on — drag the yellow line on the timeline, Ctrl+click it to add points'); }
          LC.refresh(); if (LC.playing) LC.restartPlayback(); return;
        }
        if (a === 'key') { LC.setKey(tr, 'vol', LC.fr(LC.playhead), +LC.trackVol(tr, LC.playhead).toFixed(1)); LC.commit('Add volume keyframe'); LC.refresh(); }
      });
      box.appendChild(s);
      mixer.strips.push({ tr, s, fader, db, meter: s.querySelector('.mmeter'), st: { peak: [-90, -90], hold: [-90, -90], holdT: [0, 0] } });
    }
    // master
    const m = Aero.el('div', 'mstrip master');
    m.innerHTML = `<div class="mname">Master</div><div class="mpan"><span class="dim">stereo</span></div>
      <div class="mfbox"><canvas class="mmeter"></canvas><span class="mfwrap"><input type="range" class="mfader" min="-30" max="12" step="0.1" title="Master volume"></span></div>
      <input type="number" class="mdb" min="-60" max="12" step="0.1"><div class="mbtns"></div><div class="mbtns"></div>`;
    const mf = m.querySelector('.mfader'), md = m.querySelector('.mdb');
    mf.oninput = () => { md.value = (+mf.value).toFixed(1); A.setMaster(+mf.value); }; mf.onchange = () => LC.commit('Master volume');
    md.onchange = () => { const v = Math.max(-60, Math.min(12, +md.value)); mf.value = v; A.setMaster(v); LC.commit('Master volume'); };
    mf.ondblclick = () => { mf.value = 0; md.value = '0.0'; A.setMaster(0); LC.commit('Master volume'); };
    box.appendChild(m);
    mixer.strips.push({ master: true, s: m, fader: mf, db: md, meter: m.querySelector('.mmeter'), st: { peak: [-90, -90], hold: [-90, -90], holdT: [0, 0] } });
    if (!LC.audioTracks().length) box.insertAdjacentHTML('afterbegin', '<div class="dim" style="padding:10px">No audio tracks</div>');
    mixer.update(); requestAnimationFrame(() => mixer.tick());
  };
  mixer.update = () => {
    for (const st of mixer.strips) {
      const v = st.master ? (LC.project.master || 0) : LC.trackVol(st.tr, LC.playhead);
      if (document.activeElement !== st.fader) st.fader.value = v;
      if (document.activeElement !== st.db) st.db.value = (+v).toFixed(1);
      st.s.classList.toggle('auto', !st.master && !!st.tr.kf?.vol?.length);
    }
  };
  mixer.tick = () => {
    if (!mixer.visible()) return;
    for (const st of mixer.strips) { const h = st.fader.parentNode.clientHeight; if (h && st.fader._h !== h) { st.fader._h = h; st.fader.style.width = h + 'px'; } }
    for (const st of mixer.strips) A.paintMeter(st.meter, st.master ? A.levels() : A.trackLevels(st.tr.id), st.st, false);
    if (LC.playing) mixer.update();
  };
})();
