'use strict';
/* Lumen Cut — Open Sample. Generates three animated 1080p clips (canvas → VideoEncoder → MP4/WebM), an ocean
   ambience track, a music bed (OfflineAudioContext) and assembles an edited sequence with titles, transitions,
   keyframes and music. Generated media is cached in IndexedDB so later opens are instant. */
(function () {
  const W = 1920, H = 1080, FPS = 30, DUR = 6;
  const KEY = 'sample-v4';

  /* ---------- tiny IndexedDB cache ---------- */
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('lumen-cut', 1); r.onupgradeneeded = () => r.result.createObjectStore('blobs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function cacheGet(k) { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('blobs').objectStore('blobs').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } }
  async function cachePut(k, v) { try { const db = await idb(); await new Promise(res => { const t = db.transaction('blobs', 'readwrite'); t.objectStore('blobs').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) { } }

  /* ---------- seeded random ---------- */
  const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  /* ---------- scene painters (t in seconds) ---------- */
  function aurora() {
    const r = rng(7), stars = [...Array(420)].map(() => [r() * W * 1.2, r() * H * .7, r() * 1.6 + .3, r() * 6.28]);
    const ridge = (seed, base, amp, n) => { const q = rng(seed); const pts = []; let y = base; for (let i = 0; i <= n; i++) { y += (q() - .5) * amp; y = Math.max(base - amp * 2, Math.min(base + amp, y)); pts.push(y); } return pts; };
    const m1 = ridge(3, H * .74, 60, 48), m2 = ridge(11, H * .84, 40, 64);
    const off = new OffscreenCanvas(W / 4, H / 4), ox = off.getContext('2d');
    return (x, t) => {
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#01040d'); g.addColorStop(.55, '#06183a'); g.addColorStop(1, '#0d3350'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      const pan = t * 22;
      for (const [sx, sy, s, ph] of stars) { const a = .45 + .55 * Math.sin(t * 2.4 + ph); x.fillStyle = `rgba(230,240,255,${(a * .9).toFixed(3)})`; x.fillRect(((sx - pan * .3) % (W * 1.2) + W * 1.2) % (W * 1.2) - W * .1, sy, s, s); }
      // aurora curtains rendered at quarter res and blurred up
      ox.clearRect(0, 0, W / 4, H / 4); ox.globalCompositeOperation = 'lighter';
      const bands = [['80,255,170', .95, 0], ['60,210,255', .7, 1.7], ['190,110,255', .5, 3.1]];
      for (const [col, a, k] of bands) {
        for (let xx = 0; xx < W / 4; xx += 2) {
          const X = xx * 4 + pan;
          const y = H / 4 * (.33 + .07 * Math.sin(X * .0024 + t * .5 + k) + .04 * Math.sin(X * .0061 - t * .8 + k * 2));
          const h = H / 4 * (.16 + .1 * Math.sin(X * .004 + t * .9 + k));
          const inten = .5 + .5 * Math.sin(X * .011 + t * 1.7 + k * 3);
          const gg = ox.createLinearGradient(0, y - h, 0, y + 6); gg.addColorStop(0, `rgba(${col},0)`); gg.addColorStop(.75, `rgba(${col},${(a * inten * .55).toFixed(3)})`); gg.addColorStop(1, `rgba(${col},0)`);
          ox.fillStyle = gg; ox.fillRect(xx, y - h, 2.2, h + 6);
        }
      }
      ox.globalCompositeOperation = 'source-over';
      x.save(); x.globalCompositeOperation = 'lighter'; x.filter = 'blur(6px)'; x.drawImage(off, 0, 0, W, H); x.filter = 'none'; x.restore();
      const drawRidge = (pts, color, par) => { x.fillStyle = color; x.beginPath(); x.moveTo(0, H); const step = (W + 200) / (pts.length - 1); pts.forEach((y, i) => x.lineTo(i * step - 100 - (pan * par) % step, y)); x.lineTo(W, H); x.closePath(); x.fill(); };
      drawRidge(m1, '#071426', .25); drawRidge(m2, '#02070f', .5);
      const hz = x.createLinearGradient(0, H * .6, 0, H); hz.addColorStop(0, 'rgba(60,200,180,0)'); hz.addColorStop(1, 'rgba(10,40,60,.35)'); x.fillStyle = hz; x.fillRect(0, H * .6, W, H * .4);
    };
  }
  function ocean() {
    const r = rng(42), glints = [...Array(260)].map(() => [r(), r(), r() * 6.28, r()]);
    const birds = [...Array(5)].map((_, i) => [r() * W * .6, H * (.18 + r() * .15), .7 + r() * .6, r() * 6]);
    return (x, t) => {
      const hy = H * .58;
      const g = x.createLinearGradient(0, 0, 0, hy); g.addColorStop(0, '#2a1a4a'); g.addColorStop(.35, '#a3406a'); g.addColorStop(.7, '#f0844a'); g.addColorStop(1, '#ffd27a'); x.fillStyle = g; x.fillRect(0, 0, W, hy);
      const sy = hy - 120 + t * 14, sx = W * .5;
      const glow = x.createRadialGradient(sx, sy, 10, sx, sy, 520); glow.addColorStop(0, 'rgba(255,240,180,.95)'); glow.addColorStop(.18, 'rgba(255,200,110,.55)'); glow.addColorStop(1, 'rgba(255,140,80,0)'); x.fillStyle = glow; x.fillRect(0, 0, W, hy);
      x.fillStyle = '#fff6d8'; x.beginPath(); x.arc(sx, sy, 92, 0, 7); x.fill();
      // clouds
      x.fillStyle = 'rgba(120,50,90,.35)'; for (let i = 0; i < 6; i++) { const cx = ((i * 380 + t * 18) % (W + 600)) - 300, cy = H * (.12 + (i % 3) * .07); x.beginPath(); x.ellipse(cx, cy, 260, 22, 0, 0, 7); x.ellipse(cx + 120, cy + 10, 200, 16, 0, 0, 7); x.fill(); }
      // sea
      const s = x.createLinearGradient(0, hy, 0, H); s.addColorStop(0, '#d0705a'); s.addColorStop(.12, '#5a3a6a'); s.addColorStop(1, '#0e1a3a'); x.fillStyle = s; x.fillRect(0, hy, W, H - hy);
      if (sy + 92 > hy) { x.save(); x.beginPath(); x.rect(0, 0, W, hy); x.clip(); x.restore(); }
      for (const [gx, gy, ph, w] of glints) {
        const yy = hy + Math.pow(gy, 1.6) * (H - hy), spread = 60 + (yy - hy) * .9, xx = sx + (gx - .5) * spread * 2;
        const a = Math.max(0, Math.sin(t * 3 + ph * 4)) * (1 - gy * .6);
        x.fillStyle = `rgba(255,${200 + Math.round(40 * w)},150,${(a * .85).toFixed(3)})`; x.fillRect(xx, yy, 10 + w * 40 * (1 + gy), 2 + gy * 3);
      }
      x.strokeStyle = 'rgba(255,190,150,.18)'; x.lineWidth = 2;
      for (let k = 0; k < 14; k++) { const yy = hy + Math.pow(k / 14, 1.7) * (H - hy) + 6; x.beginPath(); for (let X = 0; X <= W; X += 24) x.lineTo(X, yy + Math.sin(X * .01 + t * 1.4 + k) * (2 + k * .6)); x.stroke(); }
      x.strokeStyle = 'rgba(30,15,40,.85)'; x.lineWidth = 3; x.lineCap = 'round';
      for (const [bx, by, sc, ph] of birds) { const X = bx + t * 70 * sc, Y = by + Math.sin(t + ph) * 8, f = Math.sin(t * 7 + ph) * 10 * sc; x.beginPath(); x.moveTo(X - 18 * sc, Y - f); x.quadraticCurveTo(X - 8 * sc, Y - 6 * sc, X, Y); x.quadraticCurveTo(X + 8 * sc, Y - 6 * sc, X + 18 * sc, Y - f); x.stroke(); }
    };
  }
  function neon() {
    const r = rng(99), towers = [...Array(40)].map(() => [r() * W, 60 + r() * 260, 30 + r() * 70, r()]);
    return (x, t) => {
      const hy = H * .56;
      const g = x.createLinearGradient(0, 0, 0, hy); g.addColorStop(0, '#0a0420'); g.addColorStop(.6, '#2a0a4a'); g.addColorStop(1, '#6a1060'); x.fillStyle = g; x.fillRect(0, 0, W, hy);
      // sun with stripes
      const sx = W / 2, sy = hy - 70, R = 260;
      x.save(); x.beginPath(); x.arc(sx, sy, R, 0, 7); x.clip();
      const sg = x.createLinearGradient(0, sy - R, 0, sy + R); sg.addColorStop(0, '#ffe36a'); sg.addColorStop(.55, '#ff7a3c'); sg.addColorStop(1, '#ff2a8a'); x.fillStyle = sg; x.fillRect(sx - R, sy - R, R * 2, R * 2);
      x.fillStyle = '#2a0a4a'; for (let i = 0; i < 9; i++) { const yy = sy + 20 + i * 26 + ((t * 20) % 26), hh = 3 + i * 1.6; x.fillRect(sx - R, yy, R * 2, hh); }
      x.restore();
      x.shadowColor = '#ff3ad0'; x.shadowBlur = 60; x.fillStyle = 'rgba(255,60,200,.08)'; x.beginPath(); x.arc(sx, sy, R, 0, 7); x.fill(); x.shadowBlur = 0;
      // skyline
      for (const [tx, th, tw, k] of towers) { const X = ((tx - t * 30 * (.5 + k)) % W + W) % W; x.fillStyle = k > .5 ? '#14062a' : '#1c0836'; x.fillRect(X, hy - th, tw, th); x.fillStyle = 'rgba(80,240,255,.55)'; for (let wy = hy - th + 10; wy < hy - 6; wy += 18) if ((wy + Math.floor(tx)) % 3 === 0) x.fillRect(X + 6, wy, tw - 12, 3); }
      // floor
      const fg = x.createLinearGradient(0, hy, 0, H); fg.addColorStop(0, '#2a0838'); fg.addColorStop(1, '#05010c'); x.fillStyle = fg; x.fillRect(0, hy, W, H - hy);
      x.save(); x.shadowColor = '#3af0ff'; x.shadowBlur = 14; x.strokeStyle = '#3ae8ff'; x.lineWidth = 2;
      const z0 = (t * 1.6) % 1;
      for (let i = 0; i < 22; i++) { const z = i + 1 - z0, yy = hy + (H - hy) * (1 / z) * .9; if (yy > H || yy < hy) continue; x.globalAlpha = Math.min(1, 1.2 - z / 22); x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke(); }
      x.globalAlpha = 1; x.strokeStyle = '#ff4ad8'; x.shadowColor = '#ff4ad8';
      for (let i = -16; i <= 16; i++) { x.beginPath(); x.moveTo(sx + i * 40, hy); x.lineTo(sx + i * 340, H); x.stroke(); }
      x.restore();
      x.fillStyle = 'rgba(255,90,220,.14)'; x.fillRect(0, hy - 2, W, 4);
    };
  }

  /* a friendly robot host filmed on a (slightly uneven, spill-y) green screen — keyed in the sample */
  function host() {
    const r = rng(21), grain = [...Array(900)].map(() => [r() * W, r() * H, r()]);
    return (x, t) => {
      const g = x.createRadialGradient(W * .45, H * .4, 80, W * .5, H * .5, W * .75); g.addColorStop(0, '#22c45a'); g.addColorStop(1, '#0e9a3c'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      for (const [gx, gy, k] of grain) { x.fillStyle = k > .5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.04)'; x.fillRect(gx, gy, 3, 3); }
      const bob = Math.sin(t * 2.2) * 14, cx = W * .5, cy = H * .56 + bob;
      x.fillStyle = 'rgba(0,60,20,.35)'; x.beginPath(); x.ellipse(cx, H * .93, 230 - bob, 34, 0, 0, 7); x.fill();      // floor shadow (keys out mostly)
      x.save(); x.shadowColor = 'rgba(80,255,120,.55)'; x.shadowBlur = 26;                                         // green spill rim
      const body = x.createLinearGradient(cx - 200, 0, cx + 200, 0); body.addColorStop(0, '#9fb0c4'); body.addColorStop(.45, '#f4f8fc'); body.addColorStop(1, '#8a9cb2');
      x.fillStyle = body; x.beginPath(); x.roundRect(cx - 170, cy - 40, 340, 330, 70); x.fill();
      x.beginPath(); x.roundRect(cx - 150, cy - 330, 300, 250, 90); x.fill();                                      // head
      x.restore();
      x.fillStyle = '#16202c'; x.beginPath(); x.roundRect(cx - 118, cy - 290, 236, 150, 60); x.fill();                // visor
      const blink = (t % 3.1) < .12 ? .15 : 1;
      x.fillStyle = '#5ae8ff'; x.shadowColor = '#5ae8ff'; x.shadowBlur = 30;
      [-55, 55].forEach(dx => { x.beginPath(); x.ellipse(cx + dx, cy - 218, 22, 26 * blink, 0, 0, 7); x.fill(); });
      x.beginPath(); x.arc(cx, cy - 180, 34, .15 * Math.PI, .85 * Math.PI); x.lineWidth = 8; x.strokeStyle = '#5ae8ff'; x.stroke();
      x.shadowBlur = 0;
      x.strokeStyle = '#8a9cb2'; x.lineWidth = 10; x.beginPath(); x.moveTo(cx, cy - 330); x.lineTo(cx, cy - 390); x.stroke();      // antenna
      x.fillStyle = '#ff7a3c'; x.shadowColor = '#ff7a3c'; x.shadowBlur = 40 + 20 * Math.sin(t * 6); x.beginPath(); x.arc(cx, cy - 400, 18, 0, 7); x.fill(); x.shadowBlur = 0;
      // waving arm
      x.save(); x.translate(cx + 165, cy + 10); x.rotate(-1.1 + Math.sin(t * 5) * .45); x.fillStyle = '#dfe7ef'; x.beginPath(); x.roundRect(-22, -200, 44, 210, 22); x.fill();
      x.fillStyle = '#f4f8fc'; x.beginPath(); x.arc(0, -205, 34, 0, 7); x.fill(); x.restore();
      x.fillStyle = '#dfe7ef'; x.beginPath(); x.roundRect(cx - 215, cy - 10, 44, 190, 22); x.fill();                  // other arm
      x.fillStyle = '#ff7a3c'; x.beginPath(); x.roundRect(cx - 60, cy + 40, 120, 70, 18); x.fill();                   // chest panel
      x.fillStyle = '#16202c'; for (let i = 0; i < 3; i++) { x.fillRect(cx - 42 + i * 32, cy + 58, 20, 34 * (.4 + .6 * Math.abs(Math.sin(t * 4 + i)))); }
    };
  }
  /* "Teal & Orange" creative look as a .cube (goes through the same parser/validator as imported LUTs) */
  LC.sampleCube = () => LC.makeCube('Teal & Orange', 17, (r, g, b) => {
    const l = .2126 * r + .7152 * g + .0722 * b, k = l - .45;
    let R = r + k * .16 + .02, G = g + k * .03, B = b - k * .2 + .03;
    const L2 = .2126 * R + .7152 * G + .0722 * B; R = L2 + (R - L2) * 1.12; G = L2 + (G - L2) * 1.12; B = L2 + (B - L2) * 1.12;
    return [R, G, B];
  });

  /* ---------- audio generators ---------- */
  async function oceanAudio(dur) {
    const sr = 48000, ctx = new OfflineAudioContext(2, sr * dur, sr);
    const nb = ctx.createBuffer(2, sr * dur, sr); const q = rng(5);
    for (let c = 0; c < 2; c++) { const d = nb.getChannelData(c); let b = 0; for (let i = 0; i < d.length; i++) { b = .985 * b + .015 * (q() * 2 - 1); d[i] = b * 4 + (q() * 2 - 1) * .08; } }
    const src = ctx.createBufferSource(); src.buffer = nb;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); const n = 600, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / n * dur; curve[i] = .18 + .5 * Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 / 3.1)), 2) + .18 * Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 / 1.7 + 1)), 3); }
    g.gain.setValueCurveAtTime(curve, 0, dur);
    src.connect(lp).connect(g).connect(ctx.destination); src.start();
    return ctx.startRendering();
  }
  async function music(dur) {
    const sr = 48000, ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.connect(ctx.destination);
    const master = ctx.createGain(); master.gain.value = .8; master.connect(comp);
    const delay = ctx.createDelay(1); delay.delayTime.value = .375; const fb = ctx.createGain(); fb.gain.value = .32; const dl = ctx.createBiquadFilter(); dl.frequency.value = 2500;
    delay.connect(dl).connect(fb).connect(delay); dl.connect(master);
    const bpm = 96, beat = 60 / bpm, bar = beat * 4;
    const f = n => 440 * Math.pow(2, (n - 69) / 12);
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];   // Am F C G
    const pad = (n, t0, len) => {
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.05, t0 + .6); g.gain.setValueAtTime(.05, t0 + len - .4); g.gain.linearRampToValueAtTime(0, t0 + len + .3);
      const lp = ctx.createBiquadFilter(); lp.frequency.setValueAtTime(700, t0); lp.frequency.linearRampToValueAtTime(1800, t0 + len); lp.connect(g); g.connect(master);
      [-7, 0, 7].forEach((det, i) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f(n); o.detune.value = det; const p = ctx.createStereoPanner(); p.pan.value = (i - 1) * .5; o.connect(p).connect(lp); o.start(t0); o.stop(t0 + len + .4); });
    };
    const pluck = (n, t0, pan) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f(n); const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.11, t0 + .005); g.gain.exponentialRampToValueAtTime(.001, t0 + .28); const p = ctx.createStereoPanner(); p.pan.value = pan; o.connect(g).connect(p); p.connect(master); p.connect(delay); o.start(t0); o.stop(t0 + .3); };
    const bass = (n, t0, len) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f(n - 24); const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.28, t0 + .01); g.gain.exponentialRampToValueAtTime(.02, t0 + len); o.connect(g).connect(master); o.start(t0); o.stop(t0 + len + .02); };
    const kick = t0 => { const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t0); o.frequency.exponentialRampToValueAtTime(42, t0 + .16); const g = ctx.createGain(); g.gain.setValueAtTime(.55, t0); g.gain.exponentialRampToValueAtTime(.001, t0 + .32); o.connect(g).connect(master); o.start(t0); o.stop(t0 + .34); };
    const nb = ctx.createBuffer(1, sr * .1, sr), d = nb.getChannelData(0), q = rng(9); for (let i = 0; i < d.length; i++) d[i] = q() * 2 - 1;
    const hat = (t0, v) => { const s = ctx.createBufferSource(); s.buffer = nb; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; const g = ctx.createGain(); g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(.001, t0 + .06); s.connect(hp).connect(g).connect(master); s.start(t0); };
    const bars = Math.ceil(dur / bar);
    for (let b = 0; b < bars; b++) {
      const ch = chords[b % 4], t0 = b * bar;
      ch.forEach(n => pad(n, t0, bar));
      for (let s = 0; s < 16; s++) { const ts = t0 + s * beat / 4; if (ts >= dur) break; const n = ch[[0, 1, 2, 1][s % 4]] + 12 + (s >= 8 ? 12 * (s % 3 === 0) : 0); if (s % 2 === 0 || b >= 2) pluck(n, ts, (s % 4 - 1.5) * .35); }
      for (let k = 0; k < 8; k++) bass(ch[0], t0 + k * beat / 2, beat / 2 * .9);
      if (b >= 1) for (let k = 0; k < 4; k++) { kick(t0 + k * beat); hat(t0 + k * beat + beat / 2, .05); if (b >= 2) hat(t0 + k * beat + beat * .75, .025); }
    }
    return ctx.startRendering();
  }

  /* ---------- encode a painted clip (+ optional audio) ---------- */
  async function encodeClip(paint, dur, audioBuf, progress) {
    const n = dur * FPS;
    const mp4 = (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: W, height: H, bitrate: 10e6, framerate: FPS })).supported;
    const aac = mp4 && audioBuf && (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 })).supported;
    const useMp4 = mp4 && (!audioBuf || aac);
    const vcfg = useMp4 ? { codec: 'avc1.640028', width: W, height: H, bitrate: 10e6, framerate: FPS, avc: { format: 'avc' } } : { codec: 'vp09.00.41.08', width: W, height: H, bitrate: 8e6, framerate: FPS };
    const target = useMp4 ? new Mp4Muxer.ArrayBufferTarget() : new WebMMuxer.ArrayBufferTarget();
    const audioOpt = audioBuf ? (useMp4 ? { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 } : { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: 48000 }) : undefined;
    const muxer = useMp4 ? new Mp4Muxer.Muxer({ target, fastStart: 'in-memory', video: { codec: 'avc', width: W, height: H, frameRate: FPS }, audio: audioOpt })
      : new WebMMuxer.Muxer({ target, video: { codec: 'V_VP9', width: W, height: H, frameRate: FPS }, audio: audioOpt });
    const vq = [], aq = []; let err = null;
    const venc = new VideoEncoder({ output: (c, m) => vq.push([c, m]), error: e => err = e }); venc.configure(vcfg);
    const can = new OffscreenCanvas(W, H), x = can.getContext('2d');
    for (let i = 0; i < n; i++) {
      paint(x, i / FPS);
      const vf = new VideoFrame(can, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(vf, { keyFrame: i % FPS === 0 }); vf.close();
      if (venc.encodeQueueSize > 6) await new Promise(r => venc.addEventListener('dequeue', r, { once: true }));
      if (i % 10 === 0) { progress?.(i / n); await new Promise(r => setTimeout(r, 0)); }
      if (err) throw err;
    }
    await venc.flush(); venc.close();
    if (audioBuf) {
      const aenc = new AudioEncoder({ output: (c, m) => aq.push([c, m]), error: e => err = e });
      aenc.configure({ codec: useMp4 ? 'mp4a.40.2' : 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 });
      const L = audioBuf.getChannelData(0), R = audioBuf.getChannelData(1);
      for (let i = 0; i < audioBuf.length; i += 4800) { const k = Math.min(4800, audioBuf.length - i), d = new Float32Array(k * 2); d.set(L.subarray(i, i + k)); d.set(R.subarray(i, i + k), k); const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round(i / 48 * 1000), data: d }); aenc.encode(ad); ad.close(); }
      await aenc.flush(); aenc.close();
    }
    if (err) throw err;
    let ai = 0; for (const [c, m] of vq) { while (ai < aq.length && aq[ai][0].timestamp <= c.timestamp) { muxer.addAudioChunk(...aq[ai]); ai++; } muxer.addVideoChunk(c, m); }
    while (ai < aq.length) { muxer.addAudioChunk(...aq[ai]); ai++; }
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: useMp4 ? 'video/mp4' : 'video/webm' }), ext: useMp4 ? 'mp4' : 'webm' };
  }

  async function generate(onp) {
    const out = {};
    const scenes = [['aurora', 'Aurora', aurora, null], ['ocean', 'Ocean Sunset', ocean, 'ocean'], ['neon', 'Neon Drive', neon, null], ['host', 'Robot Host (green screen)', host, null]];
    for (let i = 0; i < scenes.length; i++) {
      const [id, name, mk, aud] = scenes[i];
      const ab = aud ? await oceanAudio(DUR) : null;
      const r = await encodeClip(mk(), DUR, ab, f => onp(`Rendering sample clip ${i + 1} of ${scenes.length} — ${name} (${Math.round(f * 100)}%)`));
      out[id] = { blob: r.blob, name: `${name}.${r.ext}` };
    }
    onp('Composing music…');
    out.music = { blob: LC.audio.toWav(await music(14.5)), name: 'Lumen Theme.wav' };
    try { const lb = await (await fetch('../kit/icons/cut.png')).blob(); out.logo = { blob: lb, name: 'Lumen Cut logo.png' }; } catch (e) { }
    return out;
  }
  LC.sampleMedia = async (onp = () => { }) => {
    let s = await cacheGet(KEY);
    if (!s || !s.aurora || !s.host) { s = await generate(onp); await cachePut(KEY, s); }
    return s;
  };
  /* Rebuild runtime blobs for sample media referenced by a saved project */
  LC.relinkSamples = async () => {
    const need = LC.project.media.filter(m => m.sample && LC.rt.media.get(m.id)?.status !== 'ok'); if (!need.length) return;
    Aero.busy('Preparing sample media…');
    try { const s = await LC.sampleMedia(msg => Aero.busy(msg)); for (const m of need) if (s[m.sample]) { await LC.attachBlob(m, s[m.sample].blob, null); } } finally { Aero.busy(); }
  };

  LC.buildSampleProject = async (onp = () => { }) => {
    const s = await LC.sampleMedia(onp);
    const P = LC.project = LC.newProject('1080p', 30); P.name = 'Lumen Cut Sample';
    LC.rt.media.clear();
    const add = (k) => { const it = s[k]; if (!it) return null; const m = LC.addMediaBlob(it.blob, it.name, null, { sample: k }); return m; };
    const ms = { aurora: add('aurora'), ocean: add('ocean'), neon: add('neon'), host: add('host'), music: add('music'), logo: add('logo') };
    // 4 video tracks, 2 audio tracks
    P.tracks = P.tracks.filter(t => t.name !== 'A3'); P.tracks.splice(3, 0, LC.makeTrack('video', 4));
    P.tracks.forEach(t => t.h = t.kind === 'video' ? 42 : 38);
    onp('Analysing media…');
    for (const m of Object.values(ms)) if (m) await LC.analyze(m);
    const [V1, V2, V3, V4] = LC.videoTracks(), [A1, A2] = LC.audioTracks();
    const look = LC.addLutText(LC.sampleCube(), 'Teal & Orange');
    const clip = o => { const c = LC.makeClip(o); P.clips.push(c); return c; };
    const L = 4.5;
    const a = clip({ track: V1.id, type: 'video', media: ms.aurora.id, start: 0, in: .5, dur: L, name: ms.aurora.name });
    a.props.saturation = 125; a.props.contrast = 8;
    const b = clip({ track: V1.id, type: 'video', media: ms.ocean.id, start: L, in: .5, dur: L, name: ms.ocean.name, link: 'lk1' });
    b.props.temperature = 12;
    const bA = clip({ track: A1.id, type: 'audio', media: ms.ocean.id, start: L, in: .5, dur: L, name: ms.ocean.name, link: 'lk1' });
    bA.props.volume = -3; bA.afx = LC.defaultAfx(); bA.afx.verb = { on: true, mix: 22, size: 2.2 }; bA.afx.eq = { on: true, low: -4, mid: 0, midF: 1000, high: 3 };
    P.transitions.push({ id: 'xa1', track: A1.id, a: null, b: bA.id, type: 'cpower', dur: .8 }, { id: 'xa2', track: A1.id, a: bA.id, b: null, type: 'cpower', dur: .8 });
    b.props.highlights = -25; b.props.shadows = 18; b.props.vibrance = 30; b.props.wH = [.18, .12, 0];
    const c = clip({ track: V1.id, type: 'video', media: ms.neon.id, start: L * 2, in: .5, dur: L, name: ms.neon.name });
    c.kf.scale = [{ t: 0, v: 100, e: 'linear' }, { t: L, v: 118, e: 'linear' }];
    c.kf.speed = [{ t: 0, v: 1, e: 'ease' }, { t: L, v: 1.2, e: 'linear' }];                           // gentle speed ramp
    c.curves = { ...LC.defaultCurves(), rgb: [[0, 0], [.25, .2], [.75, .82], [1, 1]] };
    a.lut = { id: look.id, amt: 70 };
    // green-screen host keyed over the neon drive
    const h = clip({ track: V4.id, type: 'video', media: ms.host.id, start: L * 2 + .3, in: .3, dur: L - .3, name: ms.host.name });
    h.key = { ...LC.defaultKey(), on: true, color: '#18b84e', tol: 30, soft: 16, spill: 75, feather: 1.5, choke: 10 };
    h.props.scale = 56; h.props.pos = [.77, .62]; h.props.contrast = 6;
    h.kf.opacity = [{ t: 0, v: 0, e: 'easeout' }, { t: .6, v: 100, e: 'linear' }, { t: h.dur - .5, v: 100, e: 'linear' }, { t: h.dur, v: 0, e: 'linear' }];
    // adjustment layer: teal & orange look + vignette over the opening
    P.transitions.push({ id: 'x1', track: V1.id, a: a.id, b: b.id, type: 'dissolve', dur: 1 });
    P.transitions.push({ id: 'x2', track: V1.id, a: b.id, b: c.id, type: 'push', dur: .8 });
    P.transitions.push({ id: 'x3', track: V1.id, a: c.id, b: null, type: 'dipblack', dur: 1 });
    const t1 = clip({ track: V2.id, type: 'title', start: .3, dur: 3.6, title: LC.defaultTitle({ text: 'LUMEN CUT', size: 190, font: 'Segoe UI', bold: true, y: .45, animIn: 'slide', animOut: 'fade', animDur: .8, shadowBlur: 40, shadowDist: 0, shadowColor: '#1a6a9a' }) });
    const t2 = clip({ track: V3.id, type: 'title', start: 1.0, dur: 2.9, title: LC.defaultTitle({ text: 'edit anything · free · in your browser', size: 54, bold: false, y: .6, color: '#d8f4ff', animIn: 'fade', animOut: 'fade', animDur: .7, shadowBlur: 10, shadowDist: 2 }) });
    clip({ track: V2.id, type: 'title', start: L + .6, dur: 3.4, title: LC.defaultTitle({ text: 'Golden Hour\nPacific Coast · 6:42 PM', size: 64, bold: true, preset: 'lower', x: .07, y: .8, align: 'left', box: true, boxColor: '#10243a', boxOpacity: 70, boxPad: 30, shadow: false, animIn: 'typewriter', animOut: 'fade', animDur: .5 }) });
    clip({ track: V2.id, type: 'title', start: L * 2 + .7, dur: 3.2, title: LC.defaultTitle({ text: 'NEON DRIVE', size: 150, font: 'Impact', bold: false, italic: true, y: .32, color: '#ffe9ff', stroke: true, strokeColor: '#ff2ad4', strokeWidth: 5, shadow: true, shadowColor: '#ff2ad4', shadowBlur: 50, shadowDist: 0, animIn: 'zoom', animOut: 'fade', animDur: .6 }) });
    if (ms.logo) {
      const lg = clip({ track: V3.id, type: 'image', media: ms.logo.id, start: L, dur: L * 2 - .5, name: ms.logo.name });
      lg.props.pos = [.925, .12]; lg.props.scale = 11; lg.props.blend = 'screen';
      lg.kf.opacity = [{ t: 0, v: 0 }, { t: .8, v: 85 }, { t: lg.dur - .8, v: 85 }, { t: lg.dur, v: 0 }];
    }
    const mu = clip({ track: A2.id, type: 'audio', media: ms.music.id, start: 0, in: 0, dur: L * 3, name: ms.music.name });
    mu.props.fadeIn = 1; mu.props.fadeOut = 2.5; mu.props.volume = -4; mu.afx = LC.defaultAfx(); mu.afx.eq = { on: true, low: 3, mid: -2, midF: 900, high: 2 }; mu.afx.comp = { on: true, thr: -20, ratio: 3, att: 10, rel: 200, gain: 0 };
    A2.kf = { vol: [{ t: L - .6, v: 0, e: 'easeout' }, { t: L + .4, v: -7, e: 'linear' }, { t: L * 2 - .4, v: -7, e: 'easein' }, { t: L * 2 + .4, v: 0, e: 'linear' }] };   // duck the music under the ocean
    const adj = clip({ track: V4.id, type: 'adjust', start: 0, dur: L - .2, name: 'Adjustment Layer' }); adj.props.vignette = -45; adj.props.contrast = 6;
    P.markers.push({ id: 'k1', t: L, name: 'Ocean', color: '#f08a24' }, { id: 'k2', t: L * 2, name: 'Neon', color: '#d43ad0' });
    // the opening titles live in their own nested sequence (double-click it on V2 to open)
    LC.activeSeq().name = 'Main Edit';
    LC.nestClips([t1, t2], 'Intro Titles');
    return P;
  };
})();
