'use strict';
/* Lumen Cut — media bin: import, analysis (duration, thumbnails, filmstrip, decoded audio + peaks), bin UI, relink. */
(function () {
  LC.rt = { media: new Map() };   // runtime data per media id: {blob, url, status, audio, peaks, thumb, strip, img}
  const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv|ogv)$/i, AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i, IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
  LC.kindOf = (name, type = '') => {
    if (/\.lcut$/i.test(name)) return 'project';
    if (type.startsWith('video/') || VIDEO_EXT.test(name)) return 'video';
    if (type.startsWith('audio/') || AUDIO_EXT.test(name)) return 'audio';
    if (type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image';
    return null;
  };
  const once = (el, ev, ms = 20000) => new Promise((res, rej) => {
    const t = setTimeout(() => { cleanup(); rej(new Error('timeout ' + ev)); }, ms);
    const ok = () => { cleanup(); res(); }, bad = () => { cleanup(); rej(new Error('Cannot decode this file')); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); };
    el.addEventListener(ev, ok); el.addEventListener('error', bad);
  });
  LC.once = once;

  let decodeCtx = null;
  async function decodeAudio(blob) {
    decodeCtx = decodeCtx || new OfflineAudioContext(2, 1, 48000);
    const ab = await blob.arrayBuffer();
    return decodeCtx.decodeAudioData(ab);
  }
  function peaksOf(buf) {
    const per = buf.sampleRate / 100, n = Math.ceil(buf.length / per), out = new Float32Array(n);
    const chans = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
    for (let i = 0; i < n; i++) {
      let m = 0; const a = Math.floor(i * per), b = Math.min(buf.length, Math.floor((i + 1) * per));
      for (const d of chans) for (let j = a; j < b; j += 2) { const v = d[j] < 0 ? -d[j] : d[j]; if (v > m) m = v; }
      out[i] = m;
    }
    return out;
  }
  const thumbCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function drawFit(ctx, src, sw, sh, W, H, bg = '#000') {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const s = Math.min(W / sw, H / sh), w = sw * s, h = sh * s; ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
  }
  function waveThumb(peaks, W, H) {
    const c = thumbCanvas(W, H), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2c6e3a'); g.addColorStop(1, '#174a24'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#8ef08a';
    if (peaks) for (let i = 0; i < W; i++) { const a = Math.floor(i / W * peaks.length), b = Math.max(a + 1, Math.floor((i + 1) / W * peaks.length)); let m = 0; for (let j = a; j < b; j++) m = Math.max(m, peaks[j]); const hh = Math.max(1, m * H * .9); x.fillRect(i, (H - hh) / 2, 1, hh); }
    return c;
  }

  /* Analyse one media item: fills metadata on `m` and runtime data in LC.rt */
  LC.analyze = async (m) => {
    const rt = LC.rt.media.get(m.id); rt.status = 'loading';
    try {
      if (m.kind === 'image') {
        rt.img = await createImageBitmap(rt.blob); m.w = rt.img.width; m.h = rt.img.height; m.duration = 0;
        const c = thumbCanvas(192, 108); drawFit(c.getContext('2d'), rt.img, m.w, m.h, 192, 108, '#20262c'); rt.thumb = c;
      } else if (m.kind === 'audio') {
        rt.audio = await decodeAudio(rt.blob); m.duration = rt.audio.duration; m.hasAudio = true; rt.peaks = peaksOf(rt.audio);
        rt.thumb = waveThumb(rt.peaks, 192, 108);
      } else {
        const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = rt.url;
        await once(v, 'loadedmetadata');
        let d = v.duration;
        if (!isFinite(d)) { v.currentTime = 1e7; await once(v, 'seeked'); d = v.duration; if (!isFinite(d)) d = v.currentTime; v.currentTime = 0; }
        m.duration = d; m.w = v.videoWidth; m.h = v.videoHeight;
        if (!m.w) throw new Error('No video stream');
        const seek = async t => { v.currentTime = Math.min(Math.max(0, t), Math.max(0, d - .05)); await once(v, 'seeked'); };
        await seek(Math.min(d * .2, 1.2));
        const th = thumbCanvas(192, 108); drawFit(th.getContext('2d'), v, m.w, m.h, 192, 108); rt.thumb = th;
        LC.bin?.render();
        // filmstrip for the timeline
        const n = Math.max(4, Math.min(16, Math.ceil(d / 1.5))), sh = 64, sw = Math.round(sh * m.w / m.h);
        rt.strip = [];
        for (let i = 0; i < n; i++) { const t = (i + .5) * d / n; await seek(t); const c = thumbCanvas(sw, sh); c.getContext('2d').drawImage(v, 0, 0, sw, sh); rt.strip.push({ t, c }); }
        v.removeAttribute('src'); v.load();
        try { rt.audio = await decodeAudio(rt.blob); rt.peaks = peaksOf(rt.audio); m.hasAudio = rt.audio.duration > 0; } catch (e) { m.hasAudio = false; }
      }
      rt.status = 'ok';
    } catch (e) {
      rt.status = 'error'; rt.error = e.message;
      Aero.toast(`Could not read ${m.name}: ${e.message}`, 4000);
    }
    LC.bin?.render(); LC.tl?.draw(); LC.requestRender?.();
  };

  LC.addMediaBlob = (blob, name, path = null, extra = {}) => {
    const kind = LC.kindOf(name, blob.type); if (!kind || kind === 'project') return null;
    const m = Object.assign({ id: 'm' + Aero.uid(), name, kind, duration: kind === 'image' ? 0 : 0, w: 0, h: 0, hasAudio: false, size: blob.size, path, type: blob.type }, extra);
    LC.project.media.push(m);
    LC.rt.media.set(m.id, { blob, url: URL.createObjectURL(blob), status: 'loading' });
    return m;
  };
  /* Import a list of {name, blob, path}. Analyses sequentially (decoding many large files at once wastes memory). */
  LC.importBlobs = async (items) => {
    const added = [];
    for (const it of items) {
      const k = LC.kindOf(it.name, it.blob.type);
      if (!k) { Aero.toast('Unsupported file: ' + it.name); continue; }
      if (k === 'project') continue;
      added.push(LC.addMediaBlob(it.blob, it.name, it.path || null));
    }
    if (!added.length) return [];
    LC.bin.render();
    Aero.busy(`Importing ${added.length} file${added.length > 1 ? 's' : ''}…`);
    try { for (const m of added) await LC.analyze(m); } finally { Aero.busy(); }
    const ok = added.filter(m => LC.rt.media.get(m.id).status === 'ok');
    added.filter(m => !ok.includes(m)).forEach(m => { LC.project.media = LC.project.media.filter(x => x !== m); });
    LC.bin.sel = new Set(ok.map(m => m.id));
    LC.bin.render();
    if (ok.length) { LC.commit(`Import ${ok.length === 1 ? ok[0].name : ok.length + ' files'}`); Aero.toast(`Imported ${ok.length} item${ok.length > 1 ? 's' : ''}`); }
    return ok;
  };
  LC.importDialog = () => new Promise(res => {
    const i = Aero.el('input'); i.type = 'file'; i.multiple = true; i.accept = 'video/*,audio/*,image/*,.mov,.mkv,.m4a,.wav,.ogg,.mp3'; i.style.display = 'none';
    i.onchange = async () => { const files = [...i.files]; i.remove(); res(await LC.importBlobs(files.map(f => ({ name: f.name, blob: f, path: Aero.native?.pathForFile?.(f) || null })))); };
    i.addEventListener('cancel', () => { i.remove(); res([]); });
    document.body.appendChild(i); i.click();
  });

  /* ---------- bin UI ---------- */
  const bin = LC.bin = { sel: new Set(), view: 'grid', filter: '' };
  const icons = {
    video: '<svg viewBox="0 0 16 16"><rect x="1.5" y="3.5" width="9" height="9" rx="1.5" fill="#3a7fd0" stroke="#1d4f8a"/><path d="M10.5 7 14.5 4.5v7L10.5 9z" fill="#3a7fd0" stroke="#1d4f8a" stroke-linejoin="round"/></svg>',
    audio: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3.5v11L5 10H2z" fill="#3fae4a" stroke="#1e6a28" stroke-linejoin="round"/><path d="M11 5.5q2 2.5 0 5M12.8 3.8q3.4 4.2 0 8.4" fill="none" stroke="#1e6a28" stroke-width="1.3" stroke-linecap="round"/></svg>',
    image: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="#fff" stroke="#8a5a0a"/><path d="M2.5 12.5 6.5 7l3 4 2-2 2.5 3.5z" fill="#e3a21a"/><circle cx="11" cy="5.5" r="1.4" fill="#e3a21a"/></svg>'
  };
  bin.icons = icons;
  bin.render = () => {
    const box = Aero.$('#binlist'); if (!box || !LC.project) return;
    const P = LC.project, f = bin.filter.toLowerCase();
    box.className = 'aero-list binlist ' + bin.view; box.innerHTML = '';
    const items = P.media.filter(m => !f || m.name.toLowerCase().includes(f));
    Aero.$('#bincount').textContent = P.media.length + (P.media.length === 1 ? ' item' : ' items');
    if (!P.media.length) {
      box.innerHTML = `<div class="binempty"><div class="bigico">${icons.video}</div><b>Import media to start</b><span>Drop video, audio or image files here,<br>or use File → Import Media (Ctrl+I).</span><button class="aero-btn" id="binimp">Import…</button><button class="aero-btn" id="binsample">Open Sample</button></div>`;
      Aero.$('#binimp').onclick = () => LC.importDialog(); Aero.$('#binsample').onclick = () => LC.openSample();
      return;
    }
    const used = new Set(P.clips.map(c => c.media));
    for (const m of items) {
      const rt = LC.rt.media.get(m.id) || {}, off = rt.status === 'offline' || rt.status === 'error';
      const d = Aero.el('div', 'aero-item binitem' + (bin.sel.has(m.id) ? ' sel' : '') + (off ? ' offline' : ''));
      d.draggable = !off; d.dataset.id = m.id;
      const meta = m.kind === 'image' ? `${m.w}×${m.h}` : m.kind === 'video' ? `${LC.fmtDur(m.duration)} · ${m.w}×${m.h}` : `${LC.fmtDur(m.duration)} · audio`;
      d.innerHTML = `<div class="bthumb"></div><div class="bmeta"><div class="bname">${icons[m.kind]}<span></span></div><div class="dim">${off ? 'Media offline' : rt.status === 'loading' ? 'Analysing…' : meta}</div></div>` + (used.has(m.id) ? '<i class="used" title="Used in sequence"></i>' : '');
      d.querySelector('.bname span').textContent = m.name; d.title = m.name;
      const th = d.querySelector('.bthumb');
      if (rt.thumb) { const c = rt.thumb.cloneNode(); c.getContext('2d').drawImage(rt.thumb, 0, 0); th.appendChild(c); }
      if (m.kind === 'video' || m.kind === 'audio') th.insertAdjacentHTML('beforeend', `<span class="bdur">${LC.tc(m.duration)}</span>`);
      d.onclick = e => { if (e.ctrlKey || e.shiftKey) { bin.sel.has(m.id) ? bin.sel.delete(m.id) : bin.sel.add(m.id); } else bin.sel = new Set([m.id]); bin.render(); };
      d.ondblclick = () => { if (off) LC.relinkDialog([m]); else LC.editToTimeline('overwrite'); };
      d.ondragstart = e => { if (!bin.sel.has(m.id)) { bin.sel = new Set([m.id]); bin.render(); } LC.drag = { kind: 'media', ids: [...bin.sel] }; e.dataTransfer.setData('text/x-lcut', 'media'); e.dataTransfer.effectAllowed = 'copy'; };
      d.ondragend = () => { LC.drag = null; LC.tl.dropGhost = null; LC.tl.draw(); };
      box.appendChild(d);
    }
  };
  bin.removeSelected = async () => {
    const ids = [...bin.sel]; if (!ids.length) return Aero.toast('Select media in the Project panel first');
    const P = LC.project, uses = P.clips.filter(c => ids.includes(c.media));
    if (uses.length && !(await Aero.confirm('Remove media', `${uses.length} clip${uses.length > 1 ? 's use' : ' uses'} this media. Remove the media and its clips from the sequence?`, 'Remove'))) return;
    LC.removeClips(uses.map(c => c.id)); P.media = P.media.filter(m => !ids.includes(m.id)); bin.sel.clear();
    LC.commit('Remove media'); LC.refresh();
  };

  /* ---------- relink ---------- */
  LC.attachBlob = async (m, blob, path) => {
    const old = LC.rt.media.get(m.id); if (old?.url) URL.revokeObjectURL(old.url);
    LC.rt.media.set(m.id, { blob, url: URL.createObjectURL(blob), status: 'loading' });
    if (path) m.path = path; m.size = blob.size;
    LC.vpool?.drop(m.id);
    await LC.analyze(m);
  };
  LC.missingMedia = () => LC.project.media.filter(m => { const s = LC.rt.media.get(m.id)?.status; return !s || s === 'offline'; });
  LC.relinkDialog = (list = LC.missingMedia()) => new Promise(resolve => {
    if (!list.length) { Aero.toast('All media is online'); return resolve(); }
    const rows = list.map(m => `<div class="rlrow" data-id="${m.id}"><span class="rlico">${icons[m.kind]}</span><span class="grow"><b></b><br><span class="dim rlpath"></span></span><span class="rlst">Missing</span><button class="aero-btn small" data-loc="${m.id}">Locate…</button></div>`).join('');
    const dlg = Aero.dialog({ title: 'Relink Media', instruction: `${list.length} media file${list.length > 1 ? 's are' : ' is'} offline`, ok: 'Done', noCancel: true, width: 600,
      html: `<p class="dnote">Projects reference media by file name. Locate each file, or pick a folder and Lumen Cut will match files by name. Clips of unlinked media show “Media Offline”.</p><div class="rllist">${rows}</div><div style="margin-top:8px"><button class="aero-btn" id="rlfolder">Search Folder…</button></div>`,
      onOK: () => { LC.bin.render(); LC.tl.draw(); LC.requestRender(); resolve(); } });
    const box = dlg.el;
    list.forEach(m => { const r = box.querySelector(`[data-id="${m.id}"]`); r.querySelector('b').textContent = m.name; r.querySelector('.rlpath').textContent = m.path || `${m.kind}${m.duration ? ' · ' + LC.fmtDur(m.duration) : ''}`; });
    const mark = (m) => { const r = box.querySelector(`[data-id="${m.id}"] .rlst`); const st = LC.rt.media.get(m.id)?.status; r.textContent = st === 'ok' ? 'Linked ✓' : st === 'error' ? 'Unreadable' : 'Missing'; r.className = 'rlst ' + (st === 'ok' ? 'ok' : ''); };
    const pick = (multiple, dir) => new Promise(res => { const i = Aero.el('input'); i.type = 'file'; i.multiple = multiple; if (dir) i.webkitdirectory = true; i.style.display = 'none'; i.onchange = () => { const f = [...i.files]; i.remove(); res(f); }; i.addEventListener('cancel', () => { i.remove(); res([]); }); document.body.appendChild(i); i.click(); });
    box.addEventListener('click', async e => {
      const id = e.target.dataset?.loc; if (!id) return;
      const m = list.find(x => x.id === id); const [f] = await pick(false); if (!f) return;
      if (f.name !== m.name && !(await Aero.confirm('Different file name', `“${f.name}” does not match “${m.name}”. Link it anyway?`, 'Link'))) return;
      await LC.attachBlob(m, f, Aero.native?.pathForFile?.(f) || null); mark(m);
    });
    box.querySelector('#rlfolder').onclick = async () => {
      const files = await pick(true, true); let n = 0;
      for (const m of list) { if (LC.rt.media.get(m.id)?.status === 'ok') continue; const f = files.find(x => x.name === m.name); if (f) { await LC.attachBlob(m, f, Aero.native?.pathForFile?.(f) || null); mark(m); n++; } }
      Aero.toast(n ? `Relinked ${n} file${n > 1 ? 's' : ''}` : 'No matching file names in that folder');
    };
  });
})();
