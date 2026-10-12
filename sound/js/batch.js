'use strict';
/* Lumen Sound — batch processing: run a saved chain of steps (effects-rack preset, normalize, LUFS loudness,
   automatic noise reduction, trim / dead-air removal, channel & sample-rate conversion, fades) over many files
   and export the results (one ZIP, or separate files). Also hosts the shared automatic noise-profile and
   dead-air helpers used by the waveform editor. */
window.Batch = (() => {
  const { clamp, el, esc } = Aero;

  /* ---------- shared helpers ---------- */
  // Noise profile learned from the quietest 10 % of STFT frames (no manual "noise only" selection needed).
  function autoNoiseProfile(chs, sr) {
    const N = 2048, hop = 512, H = N / 2, w = DSP.hann(N), len = chs[0].length;
    const fr = new Float64Array(N), re = new Float64Array(H + 1), im = new Float64Array(H + 1);
    const frames = []; for (let pos = 0; pos + N <= Math.max(N, len); pos += hop) frames.push(pos);
    const en = frames.map(pos => { let e = 0; for (const x of chs) for (let i = pos; i < Math.min(len, pos + N); i += 4) e += x[i] * x[i]; return e; });
    const order = frames.map((_, i) => i).sort((a, b) => en[a] - en[b]);
    const pick = order.slice(0, Math.max(6, Math.round(frames.length * 0.1)));
    const mags = chs.map(x => {
      const acc = new Float64Array(H + 1);
      for (const fi of pick) { const pos = frames[fi]; for (let i = 0; i < N; i++) { const k = pos + i; fr[i] = k < len ? x[k] * w[i] : 0; } DSP.rfft(fr, re, im); for (let k = 0; k <= H; k++) acc[k] += Math.hypot(re[k], im[k]); }
      const m = new Float32Array(H + 1); for (let k = 0; k <= H; k++) m[k] = acc[k] / pick.length; return m;
    });
    return { N, sr, mags, seconds: pick.length * hop / sr, auto: true };
  }
  /* Find silent stretches (10 ms RMS below threshold for at least minMs) and shorten each to keepMs.
     Returns {chs, cuts:[[a, b)] removed sample ranges (original coordinates)}. Joins are crossfaded. */
  function deadAir(chs, sr, { threshold = -45, minMs = 700, keepMs = 250 } = {}) {
    const len = chs[0].length, win = Math.max(1, Math.round(sr * 0.01)), nw = Math.ceil(len / win), thr = DSP.dbToLin(threshold);
    const quiet = new Uint8Array(nw);
    for (let k = 0; k < nw; k++) { let m = 0; for (const x of chs) { let s = 0; const a = k * win, b = Math.min(len, a + win); for (let i = a; i < b; i++) s += x[i] * x[i]; m = Math.max(m, Math.sqrt(s / Math.max(1, b - a))); } quiet[k] = m < thr ? 1 : 0; }
    const cuts = [], minW = Math.ceil(minMs / 10), keep = Math.round(sr * keepMs / 1000);
    for (let k = 0; k < nw; k++) {
      if (!quiet[k]) continue; let e = k; while (e + 1 < nw && quiet[e + 1]) e++;
      if (e - k + 1 >= minW) { const a = k * win, b = Math.min(len, (e + 1) * win); if (b - a > keep) { const c0 = a + Math.floor(keep / 2), c1 = b - Math.ceil(keep / 2); if (c1 > c0) cuts.push([c0, c1]); } }
      k = e;
    }
    if (!cuts.length) return { chs: chs.map(c => c.slice()), cuts };
    const removed = cuts.reduce((s, [a, b]) => s + b - a, 0), XF = Math.min(Math.round(sr * 0.005), Math.floor(keep / 2));
    const out = chs.map(x => {
      const o = new Float32Array(len - removed); let w = 0, r = 0;
      for (const [a, b] of cuts) {
        o.set(x.subarray(r, a), w); w += a - r;
        for (let i = 0; i < XF; i++) { const t = (i + 0.5) / XF; if (w - XF + i >= 0 && b - XF + i >= 0) o[w - XF + i] = x[a - XF + i] * (1 - t) + x[b - XF + i] * t; }
        r = b;
      }
      o.set(x.subarray(r), w); return o;
    });
    return { chs: out, cuts };
  }
  const mapThroughCuts = (s, cuts) => { let d = 0; for (const [a, b] of cuts) { if (s >= b) d += b - a; else if (s > a) return a - d; else break; } return s - d; };

  /* ---------- step types ---------- */
  const STEPS = {
    rack: { name: 'Effects rack preset', fields: () => [{ key: 'preset', label: 'Preset', type: 'select', value: 'Podcast Voice', options: Object.keys(Rack.allPresets()).map(n => [n, n]) }],
      describe: p => `Effects rack: ${p.preset}${p.slots ? ' (snapshot)' : ''}`,
      async run(chs, sr, p) { const r = p.slots ? Rack.sanitize({ on: true, slots: p.slots }) : Rack.presetRack(p.preset); if (!r) throw new Error('Unknown rack preset “' + p.preset + '”'); if (chs.length > 2) throw new Error('rack needs mono/stereo'); return { chs: await Rack.render(r, chs, sr), sr }; } },
    normalize: { name: 'Normalize (peak)', fields: () => [{ key: 'peak', label: 'Peak level (dBFS)', type: 'range', min: -30, max: 0, step: 0.1, value: -1 }],
      describe: p => `Normalize peak to ${p.peak} dBFS`,
      run(chs, sr, p) { const pk = DSP.peak(chs), g = pk > 0 ? DSP.dbToLin(p.peak) / pk : 1; return { chs: chs.map(c => c.map(v => v * g)), sr }; } },
    loudness: { name: 'Loudness normalize (LUFS)', fields: () => [{ key: 'target', label: 'Target (LUFS)', type: 'range', min: -36, max: -8, step: 0.5, value: -16 }, { key: 'ceiling', label: 'True-peak ceiling (dBTP)', type: 'range', min: -6, max: 0, step: 0.1, value: -1 }, { key: 'limit', label: 'Limit peaks', type: 'checkbox', value: true }],
      describe: p => `Loudness ${p.target} LUFS${p.limit ? `, ceiling ${p.ceiling} dBTP` : ''}`,
      run(chs, sr, p) {
        const m = DSP.loudness(chs, sr, { truePeak: false }).integrated; if (!Number.isFinite(m)) return { chs, sr };
        let gDb = p.target - m; if (!p.limit) { const g = DSP.dbToLin(gDb); return { chs: chs.map(c => c.map(v => v * g)), sr }; }
        let ceil = p.ceiling - 0.2, out = chs;
        for (let it = 0; it < 8; it++) {
          const g = DSP.dbToLin(gDb); out = DSP.limit(chs.map(c => c.map(v => v * g)), sr, { ceiling: ceil, release: 60, lookahead: 3 });
          const M2 = DSP.loudness(out, sr), dL = p.target - M2.integrated, over = M2.truePeak - p.ceiling;
          if (Math.abs(dL) < 0.1 && over <= 0) break; if (over > 0) ceil -= over + 0.03; if (Number.isFinite(dL)) gDb += dL;
        }
        return { chs: out, sr };
      } },
    denoise: { name: 'Noise reduction (automatic profile)', fields: () => [{ key: 'reduction', label: 'Reduction (dB)', type: 'range', min: 0, max: 40, step: 0.5, value: 14 }, { key: 'sensitivity', label: 'Threshold offset (dB)', type: 'range', min: -6, max: 18, step: 0.5, value: 6 }],
      describe: p => `Noise reduction ${p.reduction} dB (auto profile)`,
      run(chs, sr, p) { const prof = autoNoiseProfile(chs, sr); return { chs: DSP.noiseReduce(chs, sr, prof, { reduction: p.reduction, sensitivity: p.sensitivity, smoothing: 3, attack: 10, release: 100 }), sr }; } },
    trim: { name: 'Trim leading / trailing silence', fields: () => [{ key: 'thr', label: 'Threshold (dBFS)', type: 'range', min: -90, max: -10, step: 1, value: -50 }, { key: 'pad', label: 'Keep padding (ms)', type: 'number', min: 0, max: 2000, step: 10, value: 100 }],
      describe: p => `Trim silence below ${p.thr} dB`,
      run(chs, sr, p) { const thr = DSP.dbToLin(p.thr), n = chs[0].length; let a = 0, b = n; const loud = i => chs.some(c => Math.abs(c[i]) > thr); while (a < n && !loud(a)) a++; while (b > a && !loud(b - 1)) b--; if (a >= b) return { chs, sr }; const pad = Math.round(p.pad / 1000 * sr); a = Math.max(0, a - pad); b = Math.min(n, b + pad); return { chs: chs.map(c => c.slice(a, b)), sr }; } },
    deadair: { name: 'Remove dead air', fields: () => [{ key: 'threshold', label: 'Silence below (dBFS)', type: 'range', min: -80, max: -20, step: 1, value: -45 }, { key: 'minMs', label: 'Longer than (ms)', type: 'number', min: 100, max: 10000, step: 50, value: 700 }, { key: 'keepMs', label: 'Shorten to (ms)', type: 'number', min: 0, max: 3000, step: 10, value: 250 }],
      describe: p => `Remove dead air > ${p.minMs} ms (keep ${p.keepMs} ms)`,
      run(chs, sr, p) { return { chs: deadAir(chs, sr, p).chs, sr }; } },
    channels: { name: 'Convert channels', fields: () => [{ key: 'to', label: 'Convert to', type: 'select', value: 'mono', options: [['mono', 'Mono (mix down)'], ['stereo', 'Stereo']] }],
      describe: p => `Convert to ${p.to}`,
      run(chs, sr, p) {
        if (p.to === 'mono') { if (chs.length === 1) return { chs, sr }; const m = new Float32Array(chs[0].length); chs.forEach(c => { for (let i = 0; i < m.length; i++) m[i] += c[i] / chs.length; }); return { chs: [m], sr }; }
        if (chs.length === 2) return { chs, sr }; if (chs.length === 1) return { chs: [chs[0], chs[0].slice()], sr };
        const L = new Float32Array(chs[0].length), R = new Float32Array(L.length); chs.forEach((c, k) => { const t = k % 2 ? R : L; for (let i = 0; i < L.length; i++) t[i] += c[i] * 2 / chs.length; }); return { chs: [L, R], sr };
      } },
    resample: { name: 'Change sample rate', fields: () => [{ key: 'sr', label: 'Sample rate', type: 'select', value: '44100', options: ['16000', '22050', '32000', '44100', '48000', '96000'].map(v => [v, v + ' Hz']) }],
      describe: p => `Resample to ${p.sr} Hz`,
      run(chs, sr, p) { const to = +p.sr; if (to === sr) return { chs, sr }; return { chs: chs.map(c => DSP.resample(c, to / sr)), sr: to }; } },
    fade: { name: 'Fade in / out', fields: () => [{ key: 'fin', label: 'Fade in (ms)', type: 'number', min: 0, max: 20000, step: 10, value: 20 }, { key: 'fout', label: 'Fade out (ms)', type: 'number', min: 0, max: 20000, step: 10, value: 500 }],
      describe: p => `Fade in ${p.fin} ms / out ${p.fout} ms`,
      run(chs, sr, p) { const n = chs[0].length, a = Math.min(n, Math.round(p.fin / 1000 * sr)), b = Math.min(n, Math.round(p.fout / 1000 * sr)); return { chs: chs.map(c => { const o = c.slice(); for (let i = 0; i < a; i++) o[i] *= DSP.fadeCurve('scurve', i / a); for (let i = 0; i < b; i++) o[n - 1 - i] *= DSP.fadeCurve('scurve', i / b); return o; }), sr }; } }
  };
  const ORDER = ['rack', 'denoise', 'normalize', 'loudness', 'trim', 'deadair', 'fade', 'channels', 'resample'];
  function sanitizeStep(s) {
    if (!s || !STEPS[s.type]) return null; const p = {}, src = s.p && typeof s.p === 'object' ? s.p : {};
    for (const f of STEPS[s.type].fields()) {
      const v = src[f.key];
      if (f.type === 'range' || f.type === 'number') p[f.key] = Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, f.min, f.max) : f.value;
      else if (f.type === 'checkbox') p[f.key] = v == null ? f.value : !!v;
      else p[f.key] = typeof v === 'string' ? v.slice(0, 80) : f.value;
    }
    if (s.type === 'rack' && Array.isArray(src.slots)) p.slots = Rack.toPreset(Rack.sanitize({ slots: src.slots }));
    return { type: s.type, p };
  }
  const defStep = type => sanitizeStep({ type, p: {} });
  async function processFile(chs, sr, steps, onStep) {
    let cur = { chs: chs.map(c => c.slice()), sr };
    for (let i = 0; i < steps.length; i++) { onStep?.(i, steps[i]); await new Promise(r => setTimeout(r, 0)); cur = await STEPS[steps[i].type].run(cur.chs, cur.sr, steps[i].p); }
    return cur;
  }

  /* ---------- saved chains ---------- */
  const BUILTIN = {
    'Podcast: clean + −16 LUFS → MP3': { steps: [{ type: 'denoise', p: { reduction: 12, sensitivity: 6 } }, { type: 'rack', p: { preset: 'Podcast Voice' } }, { type: 'loudness', p: { target: -16, ceiling: -1, limit: true } }], out: { fmt: 'mp3', kbps: 128, suffix: '-podcast', pack: 'zip' } },
    'Loudness −16 LUFS + noise reduction → MP3': { steps: [{ type: 'denoise', p: { reduction: 14, sensitivity: 6 } }, { type: 'loudness', p: { target: -16, ceiling: -1, limit: true } }], out: { fmt: 'mp3', kbps: 192, suffix: '-16LUFS', pack: 'zip' } },
    'Broadcast EBU R128 (−23 LUFS) → WAV 24-bit': { steps: [{ type: 'loudness', p: { target: -23, ceiling: -1, limit: true } }], out: { fmt: 'wav24', kbps: 192, suffix: '-r128', pack: 'zip' } },
    'Voice memo tidy-up → mono MP3': { steps: [{ type: 'trim', p: { thr: -50, pad: 150 } }, { type: 'deadair', p: { threshold: -45, minMs: 900, keepMs: 300 } }, { type: 'channels', p: { to: 'mono' } }, { type: 'loudness', p: { target: -18, ceiling: -1, limit: true } }], out: { fmt: 'mp3', kbps: 96, suffix: '-tidy', pack: 'zip' } },
    'Normalize −1 dBFS → FLAC': { steps: [{ type: 'normalize', p: { peak: -1 } }], out: { fmt: 'flac24', kbps: 192, suffix: '', pack: 'zip' } }
  };
  const LS = 'lumen-sound-batch-chains';
  function userChains() { try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function saveUserChains(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* */ } }
  const sanitizeOut = o => ({ fmt: ['wav16', 'wav24', 'wav32', 'flac16', 'flac24', 'mp3', 'webm'].includes(o?.fmt) ? o.fmt : 'wav24', kbps: [64, 96, 128, 160, 192, 256, 320].includes(+o?.kbps) ? +o.kbps : 192, suffix: String(o?.suffix ?? '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40), pack: o?.pack === 'files' ? 'files' : 'zip' });
  function allChains() { const u = userChains(); const o = { ...BUILTIN }; for (const [k, v] of Object.entries(u)) o[k] = v; return o; }
  function getChain(name) { const c = allChains()[name]; if (!c) return null; return { steps: (c.steps || []).map(sanitizeStep).filter(Boolean), out: sanitizeOut(c.out) }; }

  /* ---------- run ---------- */
  async function run(files, chain, { onProgress } = {}) {
    const results = [], outFiles = {};
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        onProgress?.(`${i + 1}/${files.length}: decoding ${f.name}`);
        const d = f.chs ? { chs: f.chs, sr: f.sr } : await Codecs.decode(f.data, f.name);
        if (!d.chs.length || !d.chs[0].length) throw new Error('no audio');
        const r = await processFile(d.chs, d.sr, chain.steps, (k, s) => onProgress?.(`${i + 1}/${files.length}: ${f.name} — ${STEPS[s.type].describe(s.p)}`));
        onProgress?.(`${i + 1}/${files.length}: encoding ${f.name}`);
        const { bytes, ext } = await App.encodeAudio(r.chs, r.sr, chain.out.fmt, chain.out.kbps);
        let name = Aero.baseName(f.name) + chain.out.suffix + '.' + ext, k = 2; while (outFiles[name]) name = Aero.baseName(f.name) + chain.out.suffix + ` (${k++}).` + ext;
        outFiles[name] = bytes;
        const L = DSP.loudness(r.chs, r.sr, { truePeak: r.chs[0].length * r.chs.length < 2e7 });
        results.push({ name: f.name, out: name, ok: true, dur: r.chs[0].length / r.sr, inDur: d.chs[0].length / d.sr, lufs: L.integrated, tp: L.truePeak, bytes: bytes.length, sr: r.sr, ch: r.chs.length });
      } catch (e) { results.push({ name: f.name, ok: false, error: e.message || String(e) }); }
    }
    return { results, outFiles };
  }

  /* ---------- dialog ---------- */
  const AUDIO_RE = /\.(wav|wave|mp3|ogg|oga|opus|flac|m4a|aac|mp4|webm|aif|aiff)$/i;
  let files = [], steps = [], out = sanitizeOut({}), selStep = 0, chainName = '';
  function loadChainIntoState(name) { const c = getChain(name); if (!c) return; steps = c.steps; out = c.out; selStep = 0; chainName = name; }
  function open(initial) {
    if (initial) files = initial.slice();
    if (!steps.length) loadChainIntoState(Object.keys(BUILTIN)[0]);
    const dlg = Aero.dialog({ title: 'Batch Process', width: 760, ok: 'Run Batch',
      html: `<div class="bt">
        <div class="bt-col"><div class="bt-h">1. Files <span class="dim" data-fc></span></div><div class="aero-list bt-files" data-files></div>
          <div class="bt-btns"><button class="aero-btn small" data-addf>Add Files…</button><button class="aero-btn small" data-addcur>Add Current File</button><button class="aero-btn small" data-remf>Remove</button><button class="aero-btn small" data-clrf>Clear</button></div></div>
        <div class="bt-col"><div class="bt-h">2. Chain</div>
          <div class="bt-row"><select data-chain style="flex:1"></select><button class="aero-btn small" data-savec title="Save chain">Save…</button><button class="aero-btn small" data-delc title="Delete saved chain">Delete</button></div>
          <div class="aero-list bt-steps" data-steps></div>
          <div class="bt-btns"><button class="aero-btn small" data-adds>+ Add Step ▾</button><button class="aero-btn small" data-up>▲</button><button class="aero-btn small" data-down>▼</button><button class="aero-btn small" data-rems>Remove</button></div>
          <div class="bt-edit" data-edit></div></div>
        <div class="bt-out"><div class="bt-h">3. Output</div>
          <label>Format <select data-fmt>${App.FORMATS.map(f => `<option value="${f[0]}">${esc(f[1])}</option>`).join('')}</select></label>
          <label>Bitrate <select data-kbps>${[64, 96, 128, 160, 192, 256, 320].map(v => `<option value="${v}">${v} kbps</option>`).join('')}</select></label>
          <label>Name suffix <input type="text" data-suffix style="width:90px" spellcheck="false"></label>
          <label>Save as <select data-pack><option value="zip">one ZIP archive</option><option value="files">separate files</option></select></label></div></div>`,
      onOK: () => { runFromDialog(); } });
    const q = s => dlg.el.querySelector(s);
    const renderFiles = () => {
      const L = q('[data-files]'); L.innerHTML = ''; q('[data-fc]').textContent = files.length ? `(${files.length})` : '';
      if (!files.length) L.appendChild(el('div', 'dim rk-empty', 'Add audio files (WAV, MP3, FLAC, OGG, M4A…) or drop them on the app first.'));
      files.forEach((f, i) => { const it = el('div', 'aero-item' + (f._sel ? ' sel' : ''), '<span class="grow"></span><span class="dim mono"></span>'); it.querySelector('.grow').textContent = f.name; it.querySelector('.mono').textContent = f.chs ? 'editor' : ((f.data.byteLength / 1048576).toFixed(1) + ' MB'); it.onclick = () => { f._sel = !f._sel; renderFiles(); }; L.appendChild(it); void i; });
    };
    const renderChains = () => { const s = q('[data-chain]'); s.innerHTML = ''; s.add(new Option('(custom chain)', '')); Object.keys(allChains()).forEach(n => s.add(new Option(n, n))); s.value = allChains()[chainName] ? chainName : ''; q('[data-delc]').disabled = !userChains()[chainName]; };
    const renderSteps = () => {
      const L = q('[data-steps]'); L.innerHTML = '';
      if (!steps.length) L.appendChild(el('div', 'dim rk-empty', 'No steps — add one.'));
      steps.forEach((s, i) => { const it = el('div', 'aero-item' + (i === selStep ? ' sel' : ''), `<span class="rk-n">${i + 1}</span><span class="grow"></span>`); it.querySelector('.grow').textContent = STEPS[s.type].describe(s.p); it.onclick = () => { selStep = i; renderSteps(); }; L.appendChild(it); });
      renderEdit();
    };
    const changed = () => { chainName = ''; renderChains(); };
    const renderEdit = () => {
      const box = q('[data-edit]'); box.innerHTML = ''; const s = steps[selStep]; if (!s) return;
      const form = el('div', 'rk-form'); box.appendChild(el('div', 'rk-eh', `<b>${esc(STEPS[s.type].name)}</b>`)); box.appendChild(form);
      for (const f of STEPS[s.type].fields()) {
        const lab = el('label'); lab.textContent = f.label; let inp; const val = el('span', 'rk-v');
        if (f.type === 'select') { inp = el('select'); f.options.forEach(([v, t]) => inp.add(new Option(t, v))); if (s.type === 'rack' && s.p.slots) inp.add(new Option(s.p.preset + ' (snapshot)', s.p.preset)); inp.value = s.p[f.key]; inp.onchange = () => { s.p[f.key] = inp.value; delete s.p.slots; changed(); renderSteps(); }; }
        else if (f.type === 'checkbox') { inp = el('input'); inp.type = 'checkbox'; inp.checked = !!s.p[f.key]; inp.onchange = () => { s.p[f.key] = inp.checked; changed(); renderSteps(); }; }
        else { inp = el('input'); inp.type = f.type === 'range' ? 'range' : 'number'; inp.min = f.min; inp.max = f.max; inp.step = f.step; inp.value = s.p[f.key]; val.textContent = f.type === 'range' ? s.p[f.key] : ''; inp.oninput = () => { s.p[f.key] = clamp(+inp.value, f.min, f.max); val.textContent = f.type === 'range' ? s.p[f.key] : ''; }; inp.onchange = () => { changed(); renderSteps(); }; }
        inp.dataset.k = f.key; form.append(lab, inp, val);
      }
    };
    const renderOut = () => { q('[data-fmt]').value = out.fmt; q('[data-kbps]').value = String(out.kbps); q('[data-suffix]').value = out.suffix; q('[data-pack]').value = out.pack; q('[data-kbps]').disabled = !['mp3', 'webm'].includes(out.fmt); };
    q('[data-fmt]').onchange = e => { out.fmt = e.target.value; changed(); renderOut(); };
    q('[data-kbps]').onchange = e => { out.kbps = +e.target.value; changed(); };
    q('[data-suffix]').onchange = e => { out.suffix = sanitizeOut({ suffix: e.target.value }).suffix; changed(); renderOut(); };
    q('[data-pack]').onchange = e => { out.pack = e.target.value; };
    q('[data-chain]').onchange = e => { if (e.target.value) { loadChainIntoState(e.target.value); renderSteps(); renderOut(); renderChains(); } };
    q('[data-addf]').onclick = async () => { const fs = await Aero.openFile({ accept: 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.opus,.webm,.aif,.aiff', multiple: true, filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'opus', 'webm', 'aac', 'aif', 'aiff'] }] }); fs.filter(f => AUDIO_RE.test(f.name)).forEach(f => files.push(f)); renderFiles(); };
    q('[data-addcur]').onclick = () => { if (!App.doc) return Aero.toast('The waveform editor has no file'); files.push({ name: (App.doc.name || 'Untitled') + '.wav', chs: App.doc.chs, sr: App.doc.sr }); renderFiles(); };
    q('[data-remf]').onclick = () => { files = files.filter(f => !f._sel); renderFiles(); };
    q('[data-clrf]').onclick = () => { files = []; renderFiles(); };
    q('[data-adds]').onclick = e => Rack.popMenu(e.currentTarget, ['Add step', ...ORDER.map(t => ({ label: STEPS[t].name, fn: () => { if (steps.length >= 20) return; const s = defStep(t); if (t === 'rack' && Rack.active(App.rack)) { s.p.preset = 'Current rack'; s.p.slots = Rack.toPreset(App.rack); } steps.splice(selStep + 1, 0, s); selStep = Math.min(steps.length - 1, selStep + 1); if (steps.length === 1) selStep = 0; changed(); renderSteps(); } }))]);
    q('[data-up]').onclick = () => { if (selStep > 0) { [steps[selStep - 1], steps[selStep]] = [steps[selStep], steps[selStep - 1]]; selStep--; changed(); renderSteps(); } };
    q('[data-down]').onclick = () => { if (selStep < steps.length - 1) { [steps[selStep + 1], steps[selStep]] = [steps[selStep], steps[selStep + 1]]; selStep++; changed(); renderSteps(); } };
    q('[data-rems]').onclick = () => { steps.splice(selStep, 1); selStep = Math.max(0, Math.min(selStep, steps.length - 1)); changed(); renderSteps(); };
    q('[data-savec]').onclick = () => {
      // inline name entry (a second modal dialog would share the Escape key with this one)
      const box = q('[data-edit]'); box.innerHTML = `<div class="bt-row"><input type="text" data-cname placeholder="Chain name" style="flex:1" spellcheck="false"><button class="aero-btn small pri" data-csave>Save chain</button></div>`;
      const ci = box.querySelector('[data-cname]'); ci.value = chainName && !BUILTIN[chainName] ? chainName : 'My chain'; ci.focus(); ci.select();
      ci.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.stopPropagation(); ev.preventDefault(); box.querySelector('[data-csave]').click(); } }, true);
      box.querySelector('[data-csave]').onclick = () => {
        const n = ci.value.trim().slice(0, 60); if (!n) return; if (BUILTIN[n]) return Aero.toast('That name is a built-in chain');
        const u = userChains(); u[n] = { steps: steps.map(s => ({ type: s.type, p: { ...s.p } })), out: { ...out } }; saveUserChains(u); chainName = n; renderChains(); renderEdit(); Aero.toast('Saved chain “' + n + '”');
      };
    };
    q('[data-delc]').onclick = () => { const u = userChains(); if (!u[chainName]) return; delete u[chainName]; saveUserChains(u); Aero.toast('Deleted chain “' + chainName + '”'); chainName = ''; renderChains(); };
    renderFiles(); renderChains(); renderSteps(); renderOut();
    return dlg;
  }
  async function runFromDialog() {
    if (!files.length) { Aero.alert('Batch Process', 'Add at least one file.'); return; }
    if (!steps.length) { Aero.alert('Batch Process', 'The chain has no steps.'); return; }
    const chain = { steps: steps.map(s => ({ type: s.type, p: { ...s.p } })), out: { ...out } };
    Aero.busy('Batch processing…'); await App.tick();
    let res;
    try { res = await run(files, chain, { onProgress: m => Aero.busy('Batch ' + m) }); }
    finally { Aero.busy(); }
    const okN = res.results.filter(r => r.ok).length;
    if (okN) {
      if (chain.out.pack === 'zip') { const zip = Codecs.zip(res.outFiles); await Aero.saveFile({ name: 'batch' + (chain.out.suffix || '-output') + '.zip', data: zip, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] }); }
      else for (const [n, b] of Object.entries(res.outFiles)) await Aero.saveFile({ name: n, data: b, filters: [{ name: n.split('.').pop().toUpperCase(), extensions: [n.split('.').pop()] }] });
    }
    Batch.last = res;
    const f = v => Number.isFinite(v) ? v.toFixed(1) : '—';
    Aero.dialog({ title: 'Batch Complete', noCancel: true, width: 640, instruction: `${okN} of ${res.results.length} file${res.results.length === 1 ? '' : 's'} processed${okN ? (chain.out.pack === 'zip' ? ' and saved in one ZIP archive' : ' and saved') : ''}.`,
      html: `<table class="stats"><tr><th>File</th><th>Output</th><th>Length</th><th>LUFS</th><th>True peak</th><th>Size</th></tr>${res.results.map(r => r.ok ? `<tr><td>${esc(r.name)}</td><td>${esc(r.out)}</td><td>${App.fmtT(r.dur)}</td><td>${f(r.lufs)}</td><td>${f(r.tp)} dBTP</td><td>${(r.bytes / 1024).toFixed(0)} KB</td></tr>` : `<tr><td>${esc(r.name)}</td><td colspan="5" style="color:#b0281a">Failed: ${esc(r.error)}</td></tr>`).join('')}</table>` });
    files.forEach(x => delete x._sel);
  }

  return { STEPS, ORDER, BUILTIN, autoNoiseProfile, deadAir, mapThroughCuts, processFile, run, open, getChain, allChains, userChains, saveUserChains, sanitizeStep,
    get files() { return files; }, set files(v) { files = v; }, get steps() { return steps; } };
})();
