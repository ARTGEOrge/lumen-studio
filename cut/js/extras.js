'use strict';
/* Lumen Cut — editing extras: frame holds, picture-in-picture presets, adjustment layers, bezier easing dialog,
   scene-cut detection (WebCodecs decode + colour-histogram differences) and auto-reframe to vertical/square
   (per-clip saliency tracking → position keyframes). */
(function () {
  const tl = LC.tl;
  const unlocked = c => !LC.track(c.track).lock;
  LC.prefs = { get sceneOnImport() { try { return localStorage.getItem('lumen-cut-scene-import') === '1'; } catch (e) { return false; } },
    set sceneOnImport(v) { try { localStorage.setItem('lumen-cut-scene-import', v ? '1' : '0'); } catch (e) { } } };

  /* clip under the playhead: selected first, then topmost */
  function clipAtPlayhead(pred) {
    const t = LC.playhead, inside = c => t >= c.start - 1e-6 && t < c.start + c.dur - 1e-6 && pred(c) && unlocked(c);
    const sel = tl.selected().filter(inside); if (sel.length) return sel[0];
    for (const tr of LC.videoTracks().slice().reverse()) { const c = LC.clipsOn(tr.id).find(inside); if (c) return c; }
    return null;
  }
  /* after splitting linked clips at t, give the right-hand halves their own shared link id */
  function relink(t) {
    const fresh = new Map();
    for (const c of LC.project.clips) if (Math.abs(c.start - t) < 1e-6 && c.link && LC.project.clips.some(o => o.link === c.link && o.start < t - 1e-6)) { if (!fresh.has(c.link)) fresh.set(c.link, 'l' + Aero.uid()); c.link = fresh.get(c.link); }
  }

  /* ---------- frame hold ---------- */
  LC.frameHold = (segment, segDur = 2) => {
    LC.stop();
    const t = LC.fr(LC.playhead), c = clipAtPlayhead(c => c.type === 'video');
    if (!c) return Aero.toast('Put the playhead over a video clip'), null;
    const m = LC.mediaOf(c), hold = Math.max(0, Math.min(LC.srcTime(c, t), (m?.duration || 0) - 1 / LC.fps()));
    let made;
    if (!segment) {
      made = t > c.start + .5 / LC.fps() ? LC.splitClip(c, t) : c;
      if (!made) return Aero.toast('Nothing to hold'), null;
      if (made !== c) relink(t);
      made.hold = hold; made.link = null; if (made.kf) delete made.kf.speed;
      LC.commit('Add Frame Hold');
    } else {
      for (const tr of LC.project.tracks) { if (tr.lock) continue; LC.clipsOn(tr.id).filter(x => x.start < t - 1e-6 && x.start + x.dur > t + 1e-6).forEach(x => LC.splitClip(x, t)); }
      relink(t);
      for (const tr of LC.project.tracks) if (!tr.lock) LC.rippleShift(tr.id, t, segDur);
      made = LC.makeClip({ track: c.track, type: 'video', media: c.media, start: t, in: hold, dur: segDur, name: LC.clipName(c), props: JSON.parse(JSON.stringify(c.props)), hold });
      ['key', 'curves', 'lut'].forEach(k => { if (c[k]) made[k] = JSON.parse(JSON.stringify(c[k])); });
      LC.project.clips.push(made);
      LC.commit('Insert Frame Hold Segment');
    }
    LC.cleanTransitions(); tl.select([made.id]); LC.refresh();
    return made;
  };

  /* ---------- picture in picture ---------- */
  LC.pip = (where, c = tl.primary()) => {
    if (!c || !LC.isVisual(c) || c.type === 'adjust') return Aero.toast('Select a video, image or title clip');
    const S = LC.project.settings, m = LC.mediaOf(c), sw = c.type === 'title' ? S.w : (m?.w || S.w), sh = c.type === 'title' ? S.h : (m?.h || S.h);
    const fit = Math.min(S.w / sw, S.h / sh), cover = Math.max(S.w / sw, S.h / sh);
    if (c.kf) { delete c.kf.pos; delete c.kf.scale; }
    if (where === 'full') { c.props.scale = 100; c.props.pos = [.5, .5]; }
    else if (where === 'fill') { c.props.scale = +(100 * cover / fit).toFixed(2); c.props.pos = [.5, .5]; }
    else {
      const sc = .33, w = sw * fit * sc, h = sh * fit * sc, mg = Math.min(S.w, S.h) * .045;
      const x = where === 'center' ? S.w / 2 : where.endsWith('l') ? mg + w / 2 : S.w - mg - w / 2;
      const y = where === 'center' ? S.h / 2 : where.startsWith('t') ? mg + h / 2 : S.h - mg - h / 2;
      c.props.scale = sc * 100; c.props.pos = [+(x / S.w).toFixed(4), +(y / S.h).toFixed(4)];
    }
    LC.commit(where === 'full' ? 'Reset position' : where === 'fill' ? 'Fill frame' : 'Picture-in-Picture'); LC.refresh();
  };

  /* ---------- adjustment layer ---------- */
  LC.addAdjustment = ({ track, start, dur } = {}) => {
    const P = LC.project, V = LC.videoTracks();
    if (start == null && P.inPoint != null && P.outPoint != null && P.outPoint > P.inPoint) { start = P.inPoint; dur = dur ?? P.outPoint - P.inPoint; }
    start = LC.fr(start ?? LC.playhead); dur = LC.fr(dur ?? 5);
    const free = t => !t.lock && !LC.clipsOn(t.id).some(c => c.start < start + dur - 1e-6 && c.start + c.dur > start + 1e-6);
    let tr = track && LC.track(track);
    if (!tr) { tr = V.slice().reverse().find(free); if (!tr || V.indexOf(tr) < V.length - 1 && !free(V[V.length - 1])) { if (V.length < 12) { LC.addTrackSilent('video'); tr = LC.videoTracks().slice(-1)[0]; } else tr = V.slice().reverse().find(t => !t.lock) || V[V.length - 1]; } }
    LC.overwriteRange(tr.id, start, start + dur);
    const c = LC.makeClip({ track: tr.id, type: 'adjust', start, dur, name: 'Adjustment Layer' });
    P.clips.push(c); LC.cleanTransitions();
    tl.select([c.id]); LC.commit('New adjustment layer'); LC.refresh();
    return c;
  };
  LC.addTrackSilent = kind => {
    const list = kind === 'video' ? LC.videoTracks() : LC.audioTracks(), t = LC.makeTrack(kind, list.length + 1), P = LC.project;
    if (kind === 'video') P.tracks.splice(P.tracks.indexOf(list[list.length - 1]) + 1, 0, t); else P.tracks.push(t);
    return t;
  };

  /* ---------- bezier easing dialog ---------- */
  LC.bezierDialog = (bz = [.42, 0, .58, 1], cb) => {
    const draw = v => {
      const can = document.getElementById('bzcan'); if (!can) return; const x = can.getContext('2d'), W = can.width, H = can.height, pad = 14;
      const X = q => pad + q * (W - 2 * pad), Y = q => H - pad - q * (H - 2 * pad);
      x.clearRect(0, 0, W, H); x.fillStyle = '#1e2730'; x.fillRect(0, 0, W, H);
      x.strokeStyle = 'rgba(255,255,255,.2)'; x.strokeRect(X(0), Y(1), X(1) - X(0), Y(0) - Y(1));
      x.strokeStyle = '#6aa8f0'; x.beginPath(); x.moveTo(X(0), Y(0)); x.lineTo(X(v.x1), Y(v.y1)); x.moveTo(X(1), Y(1)); x.lineTo(X(v.x2), Y(v.y2)); x.stroke();
      x.strokeStyle = '#ffcf33'; x.lineWidth = 2; x.beginPath(); for (let i = 0; i <= 60; i++) { const f = i / 60; const y = LC.bezier(Math.min(1, Math.max(0, v.x1)), v.y1, Math.min(1, Math.max(0, v.x2)), v.y2, f); i ? x.lineTo(X(f), Y(y)) : x.moveTo(X(f), Y(y)); } x.stroke(); x.lineWidth = 1;
      [[v.x1, v.y1], [v.x2, v.y2]].forEach(([a, b]) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(X(a), Y(b), 4, 0, 7); x.fill(); });
    };
    Aero.dialog({ title: 'Bezier Interpolation', instruction: 'Cubic bezier for the segment that starts at this keyframe', width: 420,
      fields: [{ key: 'x1', label: 'Out handle X', type: 'number', value: bz[0], min: 0, max: 1, step: .01 }, { key: 'y1', label: 'Out handle Y', type: 'number', value: bz[1], min: -1, max: 2, step: .01 },
        { key: 'x2', label: 'In handle X', type: 'number', value: bz[2], min: 0, max: 1, step: .01 }, { key: 'y2', label: 'In handle Y', type: 'number', value: bz[3], min: -1, max: 2, step: .01 }],
      html: '<canvas id="bzcan" width="380" height="170" style="width:100%;margin-top:6px;border-radius:3px"></canvas><p class="dnote">Like CSS cubic-bezier(): 0.42, 0, 0.58, 1 is ease-in-out; Y outside 0–1 overshoots.</p>',
      onChange: v => draw(v),
      onOK: v => cb([Math.min(1, Math.max(0, v.x1)), Math.min(2, Math.max(-1, v.y1)), Math.min(1, Math.max(0, v.x2)), Math.min(2, Math.max(-1, v.y2))]) });
    setTimeout(() => draw({ x1: bz[0], y1: bz[1], x2: bz[2], y2: bz[3] }), 0);
  };

  /* ---------- scene-cut detection ---------- */
  const HB = 16;
  function histOf(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data, hs = new Float32Array(HB * 3), n = w * h;
    for (let i = 0; i < d.length; i += 4) { hs[d[i] >> 4]++; hs[HB + (d[i + 1] >> 4)]++; hs[2 * HB + (d[i + 2] >> 4)]++; }
    for (let i = 0; i < hs.length; i++) hs[i] /= n; return hs;
  }
  const hdiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / 6; };   // 0..1
  async function framesWebCodecs(m, onFrame, onp) {
    const rt = LC.rt.media.get(m.id), d = await LC.demux(rt.blob);
    const cfg = { codec: d.codec, codedWidth: d.width, codedHeight: d.height }; if (d.description) cfg.description = d.description;
    if (!(await VideoDecoder.isConfigSupported(cfg)).supported) throw new Error('decoder unsupported');
    let err = null, last = performance.now();
    const dec = new VideoDecoder({ output: f => { try { onFrame(f, f.timestamp / 1e6); } finally { f.close(); } last = performance.now(); }, error: e => err = e });
    dec.configure(cfg);
    const S = d.samples;
    for (let i = 0; i < S.length; i++) {
      if (err) throw err;
      const s = S[i]; dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.ts), duration: Math.round(s.dur), data: new Uint8Array(d.buf, s.offset, s.size) }));
      while (dec.decodeQueueSize > 12) { await new Promise(r => setTimeout(r, 4)); if (performance.now() - last > 5000) throw new Error('decoder stalled'); }
      if (i % 30 === 0) { onp?.(i / S.length); await new Promise(r => setTimeout(r, 0)); }
    }
    const ok = await Promise.race([dec.flush().then(() => true), new Promise(r => setTimeout(() => r(false), 8000))]);
    dec.close(); if (!ok) throw new Error('decoder stalled'); if (err) throw err;
  }
  async function framesSeek(m, onFrame, onp) {
    const rt = LC.rt.media.get(m.id), v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = rt.url;
    await LC.once(v, 'loadeddata');
    const step = 1 / 8, n = Math.floor(m.duration / step);
    for (let i = 0; i <= n; i++) { v.currentTime = Math.min(m.duration - .01, i * step); await LC.once(v, 'seeked'); onFrame(v, i * step); if (i % 10 === 0) onp?.(i / n); }
    v.removeAttribute('src'); v.load();
  }
  /* returns sorted cut times (source seconds) and stores them on m.scenes */
  LC.detectScenes = async (m, onp) => {
    if (m.kind !== 'video') return [];
    const can = new OffscreenCanvas(64, 36), ctx = can.getContext('2d', { willReadFrequently: true });
    const samples = []; let prev = null;
    const onFrame = (src, t) => { ctx.drawImage(src, 0, 0, 64, 36); const h = histOf(ctx, 64, 36); samples.push({ t, d: prev ? hdiff(prev, h) : 0 }); prev = h; };
    try { await framesWebCodecs(m, onFrame, onp); }
    catch (e) { console.info('Lumen Cut: scene detection falling back to seeking —', e.message); samples.length = 0; prev = null; await framesSeek(m, onFrame, onp); }
    samples.sort((a, b) => a.t - b.t);
    // recompute differences in presentation order (decode order may differ with B-frames)
    const cuts = [];
    for (let i = 1; i < samples.length; i++) {
      const d = samples[i].d, win = samples.slice(Math.max(1, i - 8), i + 9).filter((_, k, a) => a[k] !== samples[i]).map(s => s.d).sort((a, b) => a - b);
      const med = win.length ? win[win.length >> 1] : 0;
      if (d > .28 && d > med * 3 + .08 && (!cuts.length || samples[i].t - cuts[cuts.length - 1] > .4)) cuts.push(+samples[i].t.toFixed(4));
    }
    m.scenes = cuts; return cuts;
  };
  LC.detectScenesCmd = async () => {
    let ids = [...LC.bin.sel]; if (!ids.length) ids = [...new Set(tl.selected().filter(c => c.type === 'video').map(c => c.media))];
    const list = ids.map(id => LC.project.media.find(m => m.id === id)).filter(m => m && m.kind === 'video' && LC.rt.media.get(m.id)?.status === 'ok');
    if (!list.length) return Aero.toast('Select video media in the Project panel (or a video clip)');
    let total = 0;
    try { for (const m of list) { Aero.busy(`Detecting scene cuts in ${m.name}…`); total += (await LC.detectScenes(m, f => Aero.busy(`Detecting scene cuts in ${m.name}… ${Math.round(f * 100)}%`))).length; } }
    finally { Aero.busy(); }
    LC.commit('Detect scene cuts'); LC.refresh(); LC.src?.draw();
    Aero.toast(`Found ${total} scene cut${total === 1 ? '' : 's'}${total ? ' — Clip → Split at Scene Cuts to cut the sequence' : ''}`, 3500);
    return total;
  };
  LC.splitAtScenes = () => {
    const sel = tl.selected().filter(c => c.type === 'video' && unlocked(c) && c.hold == null);
    if (!sel.length) return Aero.toast('Select video clips whose media has detected scene cuts');
    let n = 0;
    for (const c of sel) {
      const m = LC.mediaOf(c); if (!m?.scenes?.length) continue;
      if (LC.ramped(c)) { Aero.toast('Skipped a speed-ramped clip'); continue; }
      const times = m.scenes.map(s => LC.fr(c.start + (s - c.in) / c.props.speed)).filter(t => t > c.start + 1e-3 && t < c.start + c.dur - 1e-3).sort((a, b) => b - a);
      for (const t of times) {
        const group = [LC.clip(c.id) && c, ...LC.linked(c)].filter(x => x && x.start < t && x.start + x.dur > t);
        let any = false; for (const x of group) if (LC.splitClip(x, t)) any = true;
        if (any) { relink(t); n++; }
      }
    }
    if (!n) return Aero.toast('No scene cuts inside the selected clips (run Detect Scene Cuts first)');
    LC.cleanTransitions(); LC.commit(`Split at ${n} scene cut${n > 1 ? 's' : ''}`); LC.refresh(); Aero.toast(`Split at ${n} scene cut${n > 1 ? 's' : ''}`);
  };

  /* ---------- auto reframe ---------- */
  // horizontal centre of interest (0..1 in source width) from edges + motion
  function interest(ctx, w, h, prevLum) {
    const d = ctx.getImageData(0, 0, w, h).data, lum = new Float32Array(w * h), col = new Float32Array(w), row = new Float32Array(h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) lum[p] = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x, gx = lum[p + 1] - lum[p - 1], gy = lum[p + w] - lum[p - w];
      let e = Math.sqrt(gx * gx + gy * gy); if (prevLum) e += 2 * Math.abs(lum[p] - prevLum[p]);
      col[x] += e; row[y] += e;
    }
    let s = 0, sx = 0; const mean = col.reduce((a, b) => a + b, 0) / w;
    for (let x = 0; x < w; x++) { const v = Math.max(0, col[x] - mean * .6); s += v; sx += v * (x + .5); }
    let s2 = 0, sy = 0; const meanY = row.reduce((a, b) => a + b, 0) / h;
    for (let y = 0; y < h; y++) { const v = Math.max(0, row[y] - meanY * .6); s2 += v; sy += v * (y + .5); }
    return { cx: s > 0 ? sx / s / w : .5, cy: s2 > 0 ? sy / s2 / h : .5, lum };
  }
  LC.AUTO_REFRAME = [['vertical', 'Vertical 9:16 (1080×1920)', 1080, 1920], ['square', 'Square 1:1 (1080×1080)', 1080, 1080], ['portrait', 'Portrait 4:5 (1080×1350)', 1080, 1350]];
  LC.autoReframe = async (presetId = 'vertical', onp = () => { }, opts = {}) => {
    const zoom = Math.min(200, Math.max(100, opts.zoom || 100)) / 100;      // extra zoom leaves room to follow the subject on both axes
    const P = LC.project, S = P.settings, pr = LC.AUTO_REFRAME.find(p => p[0] === presetId); if (!pr) throw new Error('Unknown preset');
    const oW = S.w, oH = S.h, W = pr[2], H = pr[3];
    const clips = P.clips.filter(c => (c.type === 'video' || c.type === 'image') && !LC.track(c.track).lock);
    const can = new OffscreenCanvas(96, 54), ctx = can.getContext('2d', { willReadFrequently: true });
    let i = 0;
    for (const c of clips) {
      onp(`Analysing clip ${++i} of ${clips.length}…`);
      const m = LC.mediaOf(c), rt = m && LC.rt.media.get(m.id); if (!m || rt?.status !== 'ok') continue;
      const sw = m.w || oW, sh = m.h || oH, fitO = Math.min(oW / sw, oH / sh), fitN = Math.min(W / sw, H / sh), coverN = Math.max(W / sw, H / sh);
      const animated = LC.isAnimated(c, 'pos') || LC.isAnimated(c, 'scale');
      const full = !animated && c.props.scale >= 95 && Math.abs(c.props.pos[0] - .5) < .02 && Math.abs(c.props.pos[1] - .5) < .02;
      if (!full) {          // overlays / PiP: keep their size relative to the frame height
        const k = (fitO * oH) / (fitN * H) * (H / oH);
        c.props.scale = +(c.props.scale * k).toFixed(2);
        if (c.kf?.scale) c.kf.scale.forEach(q => q.v = +(q.v * k).toFixed(2));
        continue;
      }
      const scale = 100 * coverN / fitN * (c.props.scale / 100) * zoom, dw = sw * fitN * scale / 100, dh = sh * fitN * scale / 100;
      c.props.scale = +scale.toFixed(2);
      if (dw <= W + 1 && dh <= H + 1) { c.props.pos = [.5, .5]; continue; }
      const lo = (W - dw / 2) / W, hi = (dw / 2) / W, loY = (H - dh / 2) / H, hiY = (dh / 2) / H;
      // sample the clip's content every ~0.5 s
      const pts = []; let prev = null;
      if (c.type === 'image') { ctx.drawImage(rt.img, 0, 0, 96, 54); const r = interest(ctx, 96, 54, null); pts.push({ t: 0, cx: r.cx, cy: r.cy }); }
      else {
        let srcObj = null;
        try { const d = await LC.demux(rt.blob); srcObj = await LC.DecodedSource.create(d); } catch (e) { srcObj = new LC.SeekSource(rt.url); }
        try {
          const n = Math.max(2, Math.min(240, Math.ceil(c.dur / .5) + 1));
          for (let k = 0; k < n; k++) {
            const tl0 = c.dur * k / (n - 1), st = Math.min(Math.max(0, LC.srcTime(c, c.start + tl0)), m.duration - .02);
            let f; try { f = await srcObj.frameAt(st); } catch (e) { if (!(srcObj instanceof LC.SeekSource)) { srcObj.close(); srcObj = new LC.SeekSource(rt.url); f = await srcObj.frameAt(st); } else throw e; }
            if (!f) continue; ctx.drawImage(f, 0, 0, 96, 54);
            const r = interest(ctx, 96, 54, prev); prev = r.lum; pts.push({ t: tl0, cx: r.cx, cy: r.cy });
          }
        } finally { srcObj.close(); }
      }
      if (!pts.length) { c.props.pos = [.5, .5]; continue; }
      // smooth (centred moving average) and convert to positions
      const sm = pts.map((p, k) => { const w = pts.slice(Math.max(0, k - 2), k + 3); return { t: p.t, cx: w.reduce((a, b) => a + b.cx, 0) / w.length, cy: w.reduce((a, b) => a + b.cy, 0) / w.length }; });
      const toPos = (cx, cy) => [+Math.min(hi, Math.max(lo, (W / 2 + (.5 - cx) * dw) / W)).toFixed(4), dh > H + 1 ? +Math.min(hiY, Math.max(loY, (H / 2 + (.5 - cy) * dh) / H)).toFixed(4) : .5];
      const far = (a, b) => Math.abs(a[0] - b[0]) > .012 || Math.abs(a[1] - b[1]) > .012;
      const keys = []; for (const p of sm) { const v = toPos(p.cx, p.cy); if (!keys.length || far(v, keys[keys.length - 1].v) || p === sm[sm.length - 1]) keys.push({ t: p.t, v, e: 'ease' }); }
      if (c.kf) delete c.kf.pos;
      if (keys.length <= 1 || keys.every(k => !far(k.v, keys[0].v))) c.props.pos = keys[0].v.slice();
      else { c.kf = c.kf || {}; c.kf.pos = keys; c.props.pos = keys[0].v.slice(); }
    }
    // titles: keep them inside the narrower frame
    const narrower = W / H < oW / oH, k = (W / oW) * 1.15;   // keep text at the same fraction of the (narrower) frame width
    for (const c of P.clips) if (c.type === 'title' && narrower) {
      c.title.size = Math.max(8, Math.round(c.title.size * k));
      if (c.title.x < .2 || c.title.x > .8) c.title.x = c.title.align === 'left' ? .07 : c.title.align === 'right' ? .93 : .5;
    }
    P.settings = { ...S, w: W, h: H, preset: presetId };
    return clips.length;
  };
  LC.autoReframeDialog = () => {
    if (!LC.project.clips.length) return Aero.alert('Auto Reframe', 'The sequence is empty.');
    Aero.dialog({ title: 'Auto Reframe Sequence', instruction: 'Change the frame to a new aspect ratio and keep the action in view', width: 460,
      fields: [{ key: 'preset', label: 'Target', type: 'select', value: 'vertical', options: LC.AUTO_REFRAME.map(p => [p[0], p[1]]) },
        { key: 'zoom', label: 'Extra zoom (%)', type: 'number', value: 100, min: 100, max: 200, step: 5 }],
      html: '<p class="dnote">Full-frame clips are scaled to fill the new frame and get position keyframes that follow the area of interest (edges and motion), smoothed over time — horizontally, and vertically when extra zoom leaves room. Overlays keep their relative size; titles are resized. Undo restores the original sequence.</p>',
      onOK: async v => {
        LC.stop(); Aero.busy('Auto reframing…');
        try { const n = await LC.autoReframe(v.preset, msg => Aero.busy(msg), { zoom: v.zoom }); LC.commit('Auto Reframe'); LC.mon.layout(); LC.refresh(); Aero.toast(`Reframed ${n} clip${n === 1 ? '' : 's'} to ${LC.project.settings.w}×${LC.project.settings.h}`); }
        catch (e) { console.error(e); Aero.alert('Auto Reframe', e.message); }
        finally { Aero.busy(); }
      } });
  };
})();
