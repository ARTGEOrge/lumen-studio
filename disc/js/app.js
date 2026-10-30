// Lumen Disc — turn videos into a DVD-Video folder (VIDEO_TS + AUDIO_TS).
import { VobScanner, author, vobFiles, STANDARDS, SECTOR, VOB_MAX_SECTORS } from './dvd.js';
import { zipBlob } from './zip.js';
import { parseProbe, fitFrame, buildArgs, inputName, SAMPLE, AUDIO_K } from './plan.js';

const $ = (id) => document.getElementById(id);
const CAPACITY = { dvd5: 4.7e9, dvd9: 8.5e9 };
const USABLE = 0.975;               // room for the file system and a safety margin
const MUX = 1.035, MAX_K = 8000, MIN_K = 1500;
const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|mpe?g|ts|mts|m2ts|wmv|flv|3gp|ogv)$/i;

const pool = new Map();             // every clip ever added, so undo can bring one back
let clips = [];
let selId = null;
let settings = defaults();
let busy = false;

function defaults() {
  const ntsc = /-(US|CA|MX|JP|KR|TW|PH|PR|GU)\b/i.test(navigator.language || '') || /^(en|es)$/.test(navigator.language || '');
  return { std: ntsc ? 'ntsc' : 'pal', aspect: 'auto', disc: 'dvd5', quality: 'fit', chapters: 'clip', title: 'MY DVD' };
}

// ------------------------------------------------------------ history

const hist = new Aero.History({ max: 100 });
const snapshot = () => ({ ids: clips.map((c) => c.id), settings: { ...settings }, sel: selId });
function commit(label) { hist.push(label, snapshot()); render(); }
function restore(state) {
  if (!state) return;
  clips = state.ids.map((id) => pool.get(id)).filter(Boolean);
  settings = { ...state.settings }; selId = state.sel;
  render();
}
const undo = () => { if (!busy) restore(hist.undo()); };
const redo = () => { if (!busy) restore(hist.redo()); };

// ------------------------------------------------------------ encoder worker

let worker = null, onMsg = null, queue = Promise.resolve();
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./encoder.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => onMsg?.(e.data);
    worker.onerror = (e) => onMsg?.({ type: 'error', message: e.message || 'The encoder failed to start' });
  }
  return worker;
}
function stopWorker() { worker?.terminate(); worker = null; }
// One job at a time: probes and encodes share the worker.
function job(fn) { const p = queue.then(fn); queue = p.catch(() => {}); return p; }


function probe(list) {
  return job(() => new Promise((resolve, reject) => {
    onMsg = (m) => {
      if (m.type === 'probe') { onMsg = null; resolve(m.logs); }
      else if (m.type === 'error') { onMsg = null; reject(new Error(m.message)); }
    };
    getWorker().postMessage({ type: 'probe', id: 1, files: list.map((c) => ({ name: inputName(c), data: c.blob })) });
  }));
}

// ------------------------------------------------------------ adding videos

async function addFiles(files) {
  if (busy) return;
  const vids = [...files].filter((f) => /^video\//.test(f.type) || VIDEO_EXT.test(f.name));
  if (!vids.length) { Aero.toast('Those are not video files'); return; }
  const added = vids.map((f) => ({ id: Aero.uid(), name: f.name, blob: f, pending: true }));
  added.forEach((c) => pool.set(c.id, c));
  clips.push(...added);
  render();
  setStatus(`Reading ${added.length} video${added.length > 1 ? 's' : ''}…`);
  let info = {};
  try { info = parseProbe(await probe(added)); } catch (e) { Aero.alert('Could not read the videos', e.message); }
  const bad = [];
  for (const c of added) {
    const p = info[inputName(c)];
    c.pending = false;
    if (!p || !p.video) { bad.push(c.name); continue; }
    const v = p.video, w = v.rot ? v.h : v.w, h = v.rot ? v.w : v.h;
    Object.assign(c, { dur: p.dur, w, h, dar: (w * v.sar) / h, audio: p.audio, codec: v.codec, fps: v.fps });
    if (!c.dur) bad.push(c.name);
    else thumbnail(c);
  }
  clips = clips.filter((c) => !bad.includes(c.name) || !added.includes(c));
  if (bad.length) Aero.alert('Some files were skipped', `These have no video Lumen Disc can read: ${bad.join(', ')}`);
  const ok = added.length - bad.length;
  if (ok) { if (!selId) selId = added.find((c) => clips.includes(c))?.id; commit(ok === 1 ? 'Add ' + added.find((c) => clips.includes(c)).name : `Add ${ok} videos`); }
  else render();
  setStatus('Ready');
}

function addSample() {
  if (busy) return;
  const c = { id: Aero.uid(), name: 'Sample — colour bars and tone', sample: true, dur: SAMPLE.dur, w: SAMPLE.w, h: SAMPLE.h, dar: SAMPLE.w / SAMPLE.h, audio: true, codec: 'test pattern', fps: 30 };
  c.thumb = sampleThumb();
  pool.set(c.id, c); clips.push(c); selId = c.id;
  commit('Add sample video');
}

function sampleThumb() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 144;
  const g = cv.getContext('2d');
  ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 256 / 7, 0, 256 / 7 + 1, 104); });
  const grd = g.createLinearGradient(0, 0, 256, 0); grd.addColorStop(0, '#000'); grd.addColorStop(1, '#fff');
  g.fillStyle = grd; g.fillRect(0, 104, 256, 40);
  return cv.toDataURL('image/jpeg', 0.8);
}

function thumbnail(c) {
  const v = document.createElement('video'), url = URL.createObjectURL(c.blob);
  const done = () => { URL.revokeObjectURL(url); v.removeAttribute('src'); };
  v.muted = true; v.preload = 'auto'; v.src = url;
  v.onloadeddata = () => { v.currentTime = Math.min(2, (v.duration || 3) / 3); };
  v.onseeked = () => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 144;
    const g = cv.getContext('2d'), a = v.videoWidth / v.videoHeight || 16 / 9;
    const w = a > 16 / 9 ? 256 : 144 * a, h = a > 16 / 9 ? 256 / a : 144;
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 144);
    g.drawImage(v, (256 - w) / 2, (144 - h) / 2, w, h);
    c.thumb = cv.toDataURL('image/jpeg', 0.75);
    done(); render();
  };
  v.onerror = done;
}

function pickFiles() {
  if (busy) return;
  const p = $('picker'); p.value = '';
  p.onchange = () => { if (p.files.length) addFiles(p.files); };
  p.click();
}

// ------------------------------------------------------------ editing

const selIndex = () => clips.findIndex((c) => c.id === selId);
function removeSel() {
  const i = selIndex(); if (i < 0 || busy) return;
  const [c] = clips.splice(i, 1);
  selId = clips[Math.min(i, clips.length - 1)]?.id || null;
  commit('Remove ' + c.name);
}
function move(d) {
  const i = selIndex(), j = i + d; if (i < 0 || j < 0 || j >= clips.length || busy) return;
  [clips[i], clips[j]] = [clips[j], clips[i]];
  commit('Move ' + clips[j].name);
}
async function newDisc() {
  if (busy) return;
  if (clips.length && !await Aero.confirm('New disc', 'Remove all videos and start a new disc?')) return;
  clips = []; selId = null; settings = defaults();
  hist.reset('New disc', snapshot()); Aero.setDoc(settings.title, false); render();
}
function set(key, value, label) {
  if (settings[key] === value || busy) return;
  settings[key] = value; commit(label);
}

// ------------------------------------------------------------ the plan

function plan() {
  const std = STANDARDS[settings.std];
  const dur = clips.reduce((s, c) => s + (c.dur || 0), 0);
  const wide = clips.filter((c) => c.dar > 1.55).reduce((s, c) => s + c.dur, 0);
  const aspect = settings.aspect !== 'auto' ? settings.aspect : (!dur || wide >= dur / 2 ? '16:9' : '4:3');
  const cap = CAPACITY[settings.disc] * USABLE;
  const fit = dur ? Math.floor((cap * 8) / dur / 1000 / MUX - AUDIO_K) : MAX_K;
  const videoK = settings.quality === 'fit' ? Math.min(fit, MAX_K) : +settings.quality;
  const bytes = (dur * (videoK + AUDIO_K) * 1000 / 8) * MUX;
  const starts = []; let t = 0; for (const c of clips) { starts.push(t); t += c.dur || 0; }
  let chapters = [0];
  if (settings.chapters === 'clip') chapters = starts;
  else if (settings.chapters !== 'none') { const step = +settings.chapters * 60; for (let x = step; x < dur - 5; x += step) chapters.push(x); }
  return { std, dur, aspect, videoK, bytes, fits: bytes <= CAPACITY[settings.disc] * USABLE && videoK >= MIN_K, starts, chapters: chapters.slice(0, 99), cap: CAPACITY[settings.disc] };
}

// ------------------------------------------------------------ output

const safeName = (s) => (s.replace(/[\\/:*?"<>|]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '') || 'DVD').slice(0, 64);
const gb = (b) => (b / 1e9).toFixed(b < 1e10 ? 2 : 1) + ' GB';

// Writes straight into a folder on disk (Chrome, Edge and the desktop app).
class FolderSink {
  static async create(parent, name) {
    const s = new FolderSink();
    s.label = parent.name + '\\' + name;
    s.root = await parent.getDirectoryHandle(name, { create: true });
    s.vts = await s.root.getDirectoryHandle('VIDEO_TS', { create: true });
    await s.root.getDirectoryHandle('AUDIO_TS', { create: true });
    for await (const [n] of s.vts.entries()) if (/^(VIDEO_TS|VTS_\d\d_\d)\.(IFO|BUP|VOB)$/i.test(n)) await s.vts.removeEntry(n);
    s.files = []; s.bytes = 0;
    return s;
  }
  async write(chunk) {
    const per = VOB_MAX_SECTORS * SECTOR;
    for (let o = 0; o < chunk.length;) {
      const k = Math.floor(this.bytes / per), room = per - (this.bytes % per), n = Math.min(room, chunk.length - o);
      if (!this.files[k]) {
        if (k > 8) throw new Error('Too much video for one DVD (over 9 GB)');
        const h = await this.vts.getFileHandle(`VTS_01_${k + 1}.VOB`, { create: true });
        this.files[k] = await h.createWritable();
      }
      await this.files[k].write(chunk.subarray(o, o + n));
      o += n; this.bytes += n;
    }
  }
  async finish(r) {
    for (const nv of r.navs) {
      const k = Math.floor(nv.sector / VOB_MAX_SECTORS);
      await this.files[k].write({ type: 'write', position: (nv.sector % VOB_MAX_SECTORS) * SECTOR, data: nv.bytes });
    }
    for (const w of this.files) await w.close();
    const put = async (n, data) => { const w = await (await this.vts.getFileHandle(n, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put('VIDEO_TS.IFO', r.vmg); await put('VIDEO_TS.BUP', r.vmg);
    await put('VTS_01_0.IFO', r.vts); await put('VTS_01_0.BUP', r.vts);
  }
  async abort() { for (const w of this.files) try { await w.abort(); } catch {} }
}

// Collects the disc and downloads it as a zip (browsers without folder access).
class ZipSink {
  constructor(name) { this.name = name; this.parts = []; this.label = name + '.zip'; }
  async write(chunk) { this.parts.push(new Blob([chunk])); }
  async finish(r, onProgress) {
    const stream = new Blob(this.parts); this.parts = [];
    const entries = [{ name: this.name + '/AUDIO_TS/' }, { name: this.name + '/VIDEO_TS/' },
      { name: this.name + '/VIDEO_TS/VIDEO_TS.IFO', blob: new Blob([r.vmg]) }, { name: this.name + '/VIDEO_TS/VIDEO_TS.BUP', blob: new Blob([r.vmg]) },
      { name: this.name + '/VIDEO_TS/VTS_01_0.IFO', blob: new Blob([r.vts]) }, { name: this.name + '/VIDEO_TS/VTS_01_0.BUP', blob: new Blob([r.vts]) }];
    let ni = 0;
    for (const f of vobFiles(r.vobSectors)) {
      const pieces = [], end = f.start + f.sectors; let at = f.start;
      for (; ni < r.navs.length && r.navs[ni].sector < end; ni++) {
        const s = r.navs[ni].sector;
        pieces.push(stream.slice(at * SECTOR, s * SECTOR), r.navs[ni].bytes); at = s + 1;
      }
      pieces.push(stream.slice(at * SECTOR, end * SECTOR));
      entries.push({ name: this.name + '/VIDEO_TS/' + f.name, blob: new Blob(pieces) });
    }
    let done = 0; const total = stream.size;
    const zip = await zipBlob(entries, (n) => { done += n; onProgress?.(done / total); });
    const a = document.createElement('a'); a.href = URL.createObjectURL(zip); a.download = this.name + '.zip';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  }
  async abort() { this.parts = []; }
}

async function chooseSink(name) {
  if (window.showDirectoryPicker) {
    let parent;
    try { parent = await window.showDirectoryPicker({ id: 'lumen-disc', mode: 'readwrite', startIn: 'desktop' }); }
    catch (e) { if (e.name === 'AbortError') return null; parent = null; }
    if (parent) {
      let exists = false;
      try { await parent.getDirectoryHandle(name); exists = true; } catch {}
      if (exists && !await Aero.confirm('Replace disc folder?', `“${name}” already exists in ${parent.name}. Replace the DVD files in it?`, 'Replace')) return null;
      return FolderSink.create(parent, name);
    }
    Aero.toast('Folder access was blocked, so the disc will download as a zip');
  }
  return new ZipSink(name);
}

// ------------------------------------------------------------ making the disc

let cancelRun = null;

async function makeDvd() {
  if (busy) return;
  if (!clips.length) { Aero.toast('Add some videos first'); return; }
  if (clips.some((c) => c.pending)) { Aero.toast('Still reading the videos…'); return; }
  const p = plan();
  if (!p.fits) {
    await Aero.alert('Too much video for this disc', `${fmtDur(p.dur)} of video does not fit on a ${settings.disc === 'dvd5' ? 'DVD-5' : 'DVD-9'} at this quality. ` +
      (settings.disc === 'dvd5' ? 'Choose DVD-9, a lower quality, or remove some videos.' : 'Choose a lower quality or remove some videos.'));
    return;
  }
  const name = safeName(settings.title);
  let sink;
  try { sink = await chooseSink(name); } catch (e) { Aero.alert('Could not open the folder', e.message); return; }
  if (!sink) return;

  busy = true; render();
  const ui = progressDialog();
  const list = clips.slice(), { args, files, chapters } = buildArgs(list, p);
  const scan = new VobScanner();
  let writing = Promise.resolve(), failed = null, lastLog = '', cancelled = false;
  const t0 = performance.now();
  cancelRun = () => { cancelled = true; stopWorker(); onMsg?.({ type: 'done', ret: -1 }); };

  try {
    ui.stage('Encoding video');
    const ret = await job(() => new Promise((resolve) => {
      onMsg = (m) => {
        if (m.type === 'data') {
          try { scan.feed(m.chunk); } catch (e) { failed = failed || e; }
          writing = writing.then(() => sink.write(m.chunk)).catch((e) => { failed = failed || e; });
        } else if (m.type === 'log') {
          const t = m.line.match(/time=(\d+):(\d+):([\d.]+)/);
          if (t) ui.encoded(+t[1] * 3600 + +t[2] * 60 + +t[3], p.dur, (performance.now() - t0) / 1000);
          else if (/rror|nvalid|failed/i.test(m.line)) lastLog = m.line;
        } else if (m.type === 'done' || m.type === 'error') {
          onMsg = null;
          if (m.type === 'error') lastLog = m.message;
          resolve(m.ret ?? -1);
        }
      };
      getWorker().postMessage({ type: 'encode', files, args });
    }));
    await writing;
    if (cancelled) throw new Error('cancelled');
    if (ret !== 0) throw new Error('The encoder stopped: ' + (lastLog || 'error ' + ret));
    if (failed) throw failed;

    ui.stage('Writing the DVD menus and tables');
    const r = author(scan.finish(), { standard: settings.std, aspect: p.aspect, chapters, provider: 'LUMEN DISC' });
    if (sink instanceof ZipSink) ui.stage('Packing the zip');
    await sink.finish(r, (f) => ui.bar(f));
    ui.close();
    const vobs = vobFiles(r.vobSectors);
    const total = (r.vobSectors + 6 + r.vts.length / SECTOR * 2) * SECTOR;
    Aero.dialog({
      title: 'Your DVD is ready', noCancel: true, width: 470,
      html: `<div class="aero-instr" style="margin-top:0">${Aero.esc(sink.label)}</div>
        <div>${fmtDur(r.duration)} of video · ${r.chapters} chapter${r.chapters > 1 ? 's' : ''} · ${gb(total)}</div>
        <ul class="done-list mono"><li>AUDIO_TS\\ (empty, as DVD-Video expects)</li><li>VIDEO_TS\\VIDEO_TS.IFO, .BUP</li><li>VIDEO_TS\\VTS_01_0.IFO, .BUP</li>
        <li>VIDEO_TS\\${vobs.map((f) => f.name).join(', ')}</li></ul>
        <p class="dim" style="font-size:12px;line-height:1.5">${sink instanceof ZipSink ? 'Unzip it, then burn' : 'Burn'} the <b>${Aero.esc(name)}</b> folder
        with a DVD-Video burner such as ImgBurn or CDBurnerXP. Players start the video straight away; use chapter skip to jump between videos.</p>`,
    });
    setStatus(`Made ${name}: ${fmtDur(r.duration)}, ${r.vobus} VOBUs, ${gb(total)} in ${fmtDur((performance.now() - t0) / 1000)}`);
  } catch (e) {
    ui.close(); await sink.abort();
    if (cancelled) setStatus('Cancelled');
    else { Aero.alert('The DVD could not be made', e.message); setStatus('Failed'); }
  } finally {
    busy = false; cancelRun = null; render();
  }
}

function progressDialog() {
  const d = Aero.dialog({
    title: 'Making DVD', ok: 'Cancel', noCancel: true, width: 440,
    html: `<div class="prog"><div class="stage" id="pstage">Starting the encoder…</div><div class="bar"><div id="pbar"></div></div>
      <div class="row"><span id="pdone"></span><span id="peta"></span></div></div>`,
    onOK: () => cancelRun?.(),
  });
  const bar = (f) => { $('pbar') && ($('pbar').style.width = (Math.min(1, f) * 100).toFixed(1) + '%'); };
  return {
    close: () => d.close(),
    stage: (s) => { $('pstage') && ($('pstage').textContent = s); bar(0); $('pdone') && ($('pdone').textContent = ''); $('peta') && ($('peta').textContent = ''); },
    bar,
    encoded(t, total, spent) {
      bar(t / total);
      $('pdone').textContent = `${fmtDur(t)} of ${fmtDur(total)}`;
      if (t > 2 && spent > 3) $('peta').textContent = `about ${fmtDur((spent / t) * (total - t))} left · ${(t / spent).toFixed(1)}× real time`;
    },
  };
}

// ------------------------------------------------------------ rendering

function fmtDur(s) {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
const setStatus = (s) => { $('st1').textContent = s; };

function render() {
  const p = plan();
  document.querySelector('.aero-app').classList.toggle('has-clips', clips.length > 0);
  $('sstd').value = settings.std; $('sasp').value = settings.aspect; $('sdisc').value = settings.disc;
  $('squal').value = settings.quality; $('schap').value = settings.chapters;
  if (document.activeElement !== $('ititle')) $('ititle').value = settings.title;
  Aero.setDoc(settings.title, hist.index > 0);

  const box = $('clips'); box.innerHTML = '';
  clips.forEach((c, i) => {
    const row = Aero.el('div', 'clip' + (c.id === selId ? ' sel' : '') + (c.pending ? ' busy' : ''));
    row.setAttribute('role', 'option'); row.setAttribute('aria-selected', c.id === selId); row.draggable = !busy;
    row.dataset.id = c.id;
    const f = c.pending ? null : fitFrame(c, p.std, p.aspect);
    const shape = !f ? '' : f.w < p.std.size[0] - 4 ? 'pillarboxed' : f.h < p.std.size[1] - 4 ? 'letterboxed' : 'fills the screen';
    row.innerHTML = `<div class="num">${i + 1}</div>
      <div class="thumb"${c.thumb ? ` style="background-image:url(${c.thumb})"` : ''}><span>${c.pending ? '…' : fmtDur(c.dur)}</span></div>
      <div style="min-width:0"><div class="name"></div>
        <div class="meta">${c.pending ? 'Reading…' : `${c.w}×${c.h} ${Aero.esc(c.codec)}${c.fps ? ' · ' + +c.fps.toFixed(2) + ' fps' : ''} · ${c.audio ? 'with sound' : '<span class="warn">no sound (silent on disc)</span>'}`}</div></div>
      <div class="side">${c.pending ? '' : `Chapter ${p.chapters.indexOf(p.starts[i]) >= 0 ? p.chapters.indexOf(p.starts[i]) + 1 : '–'}<br>${shape}`}</div>`;
    row.querySelector('.name').textContent = c.name;
    row.onclick = () => { selId = c.id; render(); };
    row.ondragstart = (e) => { e.dataTransfer.setData('text/x-lumen-clip', c.id); e.dataTransfer.effectAllowed = 'move'; };
    row.ondragover = (e) => { if (e.dataTransfer.types.includes('text/x-lumen-clip')) { e.preventDefault(); row.classList.add('drop-before'); } };
    row.ondragleave = () => row.classList.remove('drop-before');
    row.ondrop = (e) => {
      const id = e.dataTransfer.getData('text/x-lumen-clip'); row.classList.remove('drop-before');
      if (!id) return; e.preventDefault(); e.stopPropagation();
      const from = clips.findIndex((x) => x.id === id), to = clips.findIndex((x) => x.id === c.id);
      if (from < 0 || from === to) return;
      const [m] = clips.splice(from, 1); clips.splice(to > from ? to - 1 : to, 0, m);
      selId = id; commit('Move ' + m.name);
    };
    box.appendChild(row);
  });

  // side panel
  const used = p.dur ? p.bytes : 0, frac = used / p.cap;
  $('gfill').style.width = Math.min(100, frac * 100).toFixed(1) + '%';
  $('gauge').classList.toggle('over', !p.fits && p.dur > 0);
  $('gused').textContent = gb(used) + (p.dur ? ` (${Math.round(frac * 100)}%)` : '');
  $('gcap').textContent = 'of ' + (settings.disc === 'dvd5' ? '4.7 GB' : '8.5 GB');
  const lowQ = p.videoK < MIN_K;
  $('facts').innerHTML = `<dt>Videos</dt><dd>${clips.length}</dd><dt>Running time</dt><dd>${fmtDur(p.dur)}</dd>
    <dt>Picture</dt><dd>${p.std.size.join('×')} ${p.std.name}, ${p.aspect}</dd>
    <dt>Video bitrate</dt><dd class="${lowQ && p.dur ? 'bad' : ''}">${p.dur ? (p.videoK / 1000).toFixed(1) + ' Mbps' + (lowQ ? ' (too low)' : '') : '–'}</dd>
    <dt>Sound</dt><dd>Dolby Digital stereo, ${AUDIO_K} kbps</dd><dt>Chapters</dt><dd>${p.dur ? p.chapters.length : 0}</dd>`;
  const nVob = Math.max(1, Math.ceil(used / (VOB_MAX_SECTORS * SECTOR)));
  const name = Aero.esc(safeName(settings.title));
  $('tree').innerHTML = `${name}\\\n├─ AUDIO_TS\\   <span class="f">(empty)</span>\n└─ VIDEO_TS\\\n   ├─ VIDEO_TS.IFO / .BUP\n   ├─ VTS_01_0.IFO / .BUP\n` +
    Array.from({ length: nVob }, (_, i) => `   ${i === nVob - 1 ? '└' : '├'}─ VTS_01_${i + 1}.VOB <span class="f">${p.dur ? '≤ 1 GB' : ''}</span>`).join('\n');

  const sel = selIndex();
  $('bdel').disabled = sel < 0 || busy; $('bup').disabled = sel <= 0 || busy; $('bdown').disabled = sel < 0 || sel >= clips.length - 1 || busy;
  $('bmake').disabled = busy || !clips.length;
  ['badd', 'sstd', 'sasp', 'sdisc', 'squal', 'schap', 'ititle'].forEach((id) => { $(id).disabled = busy; });
  $('st2').textContent = clips.length ? `${clips.length} video${clips.length > 1 ? 's' : ''} · ${fmtDur(p.dur)}` : '';
}

// ------------------------------------------------------------ wiring

const STD_LABEL = { ntsc: 'NTSC', pal: 'PAL' }, ASP_LABEL = { auto: 'automatic', '16:9': '16:9', '4:3': '4:3' };
const CH_LABEL = { clip: 'at each video', 5: 'every 5 minutes', 10: 'every 10 minutes', none: 'none' };
$('sstd').onchange = (e) => set('std', e.target.value, 'TV system ' + STD_LABEL[e.target.value]);
$('sasp').onchange = (e) => set('aspect', e.target.value, 'Shape ' + ASP_LABEL[e.target.value]);
$('sdisc').onchange = (e) => set('disc', e.target.value, e.target.value === 'dvd5' ? 'DVD-5' : 'DVD-9');
$('squal').onchange = (e) => set('quality', e.target.value, 'Quality ' + e.target.selectedOptions[0].text);
$('schap').onchange = (e) => set('chapters', e.target.value, 'Chapters ' + CH_LABEL[e.target.value]);
$('ititle').onchange = (e) => set('title', e.target.value.trim().slice(0, 32) || 'MY DVD', 'Rename disc');
$('ititle').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
$('badd').onclick = pickFiles; $('eadd').onclick = pickFiles; $('esample').onclick = addSample;
$('bdel').onclick = removeSel; $('bup').onclick = () => move(-1); $('bdown').onclick = () => move(1);
$('bmake').onclick = makeDvd;

// Files are read straight from disk while encoding, never loaded whole into memory.
const stage = $('stage');
stage.appendChild(Aero.el('div', 'aero-drop', 'Drop videos to add them to the disc'));
stage.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); stage.classList.add('drag-over'); } });
stage.addEventListener('dragleave', (e) => { if (!stage.contains(e.relatedTarget)) stage.classList.remove('drag-over'); });
stage.addEventListener('drop', (e) => { stage.classList.remove('drag-over'); if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

function shortcutsDialog() {
  const keys = [['Ctrl+O', 'Add videos'], ['Ctrl+S', 'Make DVD'], ['Ctrl+N', 'New disc'], ['Delete', 'Remove the selected video'],
    ['Alt+↑ / Alt+↓', 'Move the selected video'], ['↑ / ↓', 'Select the previous / next video'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['F1', 'This list']];
  Aero.dialog({ title: 'Keyboard shortcuts', noCancel: true, html: `<div class="keys">${keys.map(([k, d]) => `<span><kbd>${k}</kbd></span><span>${d}</span>`).join('')}</div>` });
}
function aboutDialog() {
  Aero.dialog({ title: 'About Lumen Disc', noCancel: true, width: 480, html: `<div class="about"><img src="../kit/icons/disc.png" alt=""><div>
    <div class="aero-instr" style="margin:0">Lumen Disc</div><div>MP4 to DVD-Video · part of Lumen Studio</div>
    <p class="dnote">Encodes MPEG-2 video and Dolby Digital (AC-3) sound, then authors the disc itself: navigation packs, VIDEO_TS.IFO and
    VTS_01_0.IFO with chapters, time map and backup copies. Plays straight away on DVD players, no menu.<br>
    Bundled: ffmpeg.wasm core 0.12.10 (FFmpeg, GPL-2.0-or-later; see <a href="vendor/NOTICES.txt" target="_blank">vendor/NOTICES.txt</a>).</p></div></div>` });
}

Aero.init({
  name: 'Lumen Disc', icon: '../kit/icons/disc.png', doc: settings.title,
  menus: {
    File: [['New Disc', 'Ctrl+N', newDisc], ['Add Videos…', 'Ctrl+O', pickFiles], ['Open Sample', '', addSample], '-', ['Make DVD…', 'Ctrl+S', makeDvd]],
    Edit: [['Undo', 'Ctrl+Z', undo], ['Redo', 'Ctrl+Y/Ctrl+Shift+Z', redo], '-',
      { label: 'Remove Video', key: 'Delete', fn: removeSel, disabled: () => selIndex() < 0 },
      { label: 'Move Up', key: 'Alt+ArrowUp', fn: () => move(-1), disabled: () => selIndex() <= 0 },
      { label: 'Move Down', key: 'Alt+ArrowDown', fn: () => move(1), disabled: () => selIndex() < 0 || selIndex() >= clips.length - 1 }],
    Disc: [
      '#TV system',
      ...['ntsc', 'pal'].map((v) => ({ label: STD_LABEL[v], fn: () => set('std', v, 'TV system ' + STD_LABEL[v]), checked: () => settings.std === v })),
      '#Shape',
      ...['auto', '16:9', '4:3'].map((v) => ({ label: v === 'auto' ? 'Automatic' : v, fn: () => set('aspect', v, 'Shape ' + ASP_LABEL[v]), checked: () => settings.aspect === v })),
      '#Disc size',
      { label: 'DVD-5 (4.7 GB)', fn: () => set('disc', 'dvd5', 'DVD-5'), checked: () => settings.disc === 'dvd5' },
      { label: 'DVD-9 (8.5 GB)', fn: () => set('disc', 'dvd9', 'DVD-9'), checked: () => settings.disc === 'dvd9' },
      '-', ['Disc Title…', '', async () => { const t = await Aero.prompt('Disc title', 'Title', settings.title); if (t != null) set('title', t.trim().slice(0, 32) || 'MY DVD', 'Rename disc'); }]],
    Help: [['Keyboard Shortcuts', 'F1', shortcutsDialog], ['About Lumen Disc', '', aboutDialog]],
  },
});
Aero.shortcut('ArrowUp', () => { const i = selIndex(); if (i > 0) { selId = clips[i - 1].id; render(); } });
Aero.shortcut('ArrowDown', () => { const i = selIndex(); if (i < clips.length - 1) { selId = clips[i + 1].id; render(); } });

hist.reset('New disc', snapshot());
render();
window.LumenDisc = { addFiles, addSample, makeDvd, plan, buildArgs, parseProbe, get clips() { return clips; }, settings: () => settings };
