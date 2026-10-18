'use strict';
/* Lumen Beats — Standard MIDI File (.mid) reader / writer and project ⇄ MIDI mapping. Pure JS (Node-testable).
   Reader: formats 0/1/2, running status, note-on velocity 0 = note-off, sysex/meta skipping, SMPTE division.
   Writer: format 1, one tempo/meta track + one track per channel; drums on MIDI channel 10 with the GM drum map. */
(function (root) {
  const Core = root.Core || (typeof require === 'function' ? require('./core.js') : null);
  const GM = { kick: 36, rim: 37, snare: 38, clap: 39, hat: 42, tom: 45, ohat: 46, crash: 49, cow: 56 };
  const GM_IN = { 35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 40: 'snare', 39: 'clap', 42: 'hat', 44: 'hat', 46: 'ohat', 41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom',
    49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash', 51: 'crash', 53: 'cow', 56: 'cow', 54: 'hat', 69: 'hat', 70: 'hat', 75: 'rim', 76: 'rim', 77: 'rim' };
  const KIND_NAMES = { kick: 'Kick', rim: 'Rimshot', snare: 'Snare', clap: 'Clap', hat: 'Closed hat', tom: 'Tom', ohat: 'Open hat', crash: 'Crash', cow: 'Cowbell' };

  /* ---------------- reader ---------------- */
  function parse(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let pos = 0;
    const need = n => { if (pos + n > u.length) throw new Error('Truncated MIDI file'); };
    const u32 = () => { need(4); const v = (u[pos] << 24 | u[pos + 1] << 16 | u[pos + 2] << 8 | u[pos + 3]) >>> 0; pos += 4; return v; };
    const u16 = () => { need(2); const v = u[pos] << 8 | u[pos + 1]; pos += 2; return v; };
    const str4 = () => { need(4); const s = String.fromCharCode(u[pos], u[pos + 1], u[pos + 2], u[pos + 3]); pos += 4; return s; };
    // RIFF-wrapped MIDI (.rmi)
    if (u.length > 20 && String.fromCharCode(u[0], u[1], u[2], u[3]) === 'RIFF') { const i = indexOf(u, 'MThd'); if (i < 0) throw new Error('Not a MIDI file'); pos = i; }
    if (str4() !== 'MThd') throw new Error('Not a MIDI file (missing MThd)');
    const hlen = u32(); const format = u16(), ntrks = u16(), div = u16(); pos += Math.max(0, hlen - 6);
    let ppq = div;
    if (div & 0x8000) { const fps = 256 - (div >> 8), tpf = div & 0xff; ppq = Math.max(1, Math.round(fps * tpf / 2)); } // SMPTE: assume 120 bpm
    if (!ppq) throw new Error('Bad MIDI time division');
    const out = { format, ppq, tempos: [], sigs: [], tracks: [] };
    for (let ti = 0; ti < ntrks && pos + 8 <= u.length; ti++) {
      const id = str4(), len = u32(); const end = Math.min(u.length, pos + len);
      if (id !== 'MTrk') { pos = end; ti--; if (pos >= u.length) break; continue; }
      const tr = { name: '', notes: [], programs: {}, end: 0, drum: null }; const open = new Map(); let t = 0, status = 0;
      const vlq = () => { let v = 0; for (let k = 0; k < 4; k++) { if (pos >= end) throw new Error('Truncated MIDI track'); const b = u[pos++]; v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v; } return v; };
      while (pos < end) {
        t += vlq(); if (pos >= end) break;
        let b = u[pos];
        if (b & 0x80) { pos++; if (b < 0xf0) status = b; } else { if (!status) throw new Error('Running status without status byte'); b = status; }
        if (b === 0xff) { const type = u[pos++], l = vlq(); const d = u.subarray(pos, Math.min(end, pos + l)); pos += l;
          if (type === 0x51 && d.length >= 3) out.tempos.push({ t, bpm: 60e6 / ((d[0] << 16) | (d[1] << 8) | d[2]) });
          else if (type === 0x58 && d.length >= 2) out.sigs.push({ t, num: d[0], den: 1 << d[1] });
          else if ((type === 0x03) && !tr.name) tr.name = utf8(d);
          else if (type === 0x01) { const mm = /^lumen-beats drum=(\w+) base=(\d+)$/.exec(utf8(d)); if (mm && GM[mm[1]]) tr.drum = { kind: mm[1], base: +mm[2] }; }
          else if (type === 0x2f) break;
          continue; }
        if (b === 0xf0 || b === 0xf7) { const l = vlq(); pos += l; continue; }
        const hi = b & 0xf0, ch = b & 0x0f;
        const d1 = hi === 0xc0 || hi === 0xd0 ? 1 : 2; if (pos + d1 > end) break;
        const a = u[pos], c = d1 === 2 ? u[pos + 1] : 0; pos += d1;
        if (hi === 0x90 && c > 0) { const k = ch * 128 + a; if (!open.has(k)) open.set(k, []); open.get(k).push({ t, v: c }); }
        else if (hi === 0x80 || (hi === 0x90 && c === 0)) { const q = open.get(ch * 128 + a); if (q && q.length) { const on = q.shift(); if (tr.notes.length < 200000) tr.notes.push({ t: on.t, d: Math.max(1, t - on.t), p: a, v: on.v, ch }); } }
        else if (hi === 0xc0) { if (!(ch in tr.programs)) tr.programs[ch] = a; }
      }
      tr.end = t;
      for (const [k, q] of open) for (const on of q) tr.notes.push({ t: on.t, d: Math.max(1, t - on.t), p: k % 128, v: on.v, ch: k >> 7 });
      tr.notes.sort((x, y) => x.t - y.t || x.p - y.p);
      out.tracks.push(tr); pos = end;
    }
    return out;
  }
  function indexOf(u, s) { outer: for (let i = 0; i + s.length <= u.length; i++) { for (let j = 0; j < s.length; j++) if (u[i + j] !== s.charCodeAt(j)) continue outer; return i; } return -1; }
  function utf8(d) { try { return new TextDecoder().decode(d).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80); } catch (e) { return String.fromCharCode(...d).slice(0, 80); } }

  /* ---------------- writer ---------------- */
  // song: {ppq, bpm, sigNum, sigDen, name, tracks:[{name, ch, program, notes:[{t,d,p,v}]}]}
  function write(song) {
    const chunks = [];
    const vlq = (arr, v) => { v = Math.max(0, Math.round(v)); const b = [v & 0x7f]; while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80); arr.push(...b); };
    const text = (arr, type, s) => { const b = new TextEncoder().encode(String(s)); arr.push(0, 0xff, type); vlq(arr, b.length); arr.push(...b); };
    const track = body => { const n = body.length; chunks.push([0x4d, 0x54, 0x72, 0x6b, n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255], body); };
    const hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (song.tracks.length + 1) >> 8, (song.tracks.length + 1) & 255, song.ppq >> 8, song.ppq & 255];
    // tempo track
    const t0 = []; text(t0, 0x03, song.name || 'Lumen Beats');
    const us = Math.round(60e6 / song.bpm); t0.push(0, 0xff, 0x51, 3, us >> 16 & 255, us >> 8 & 255, us & 255);
    t0.push(0, 0xff, 0x58, 4, song.sigNum, Math.round(Math.log2(song.sigDen)), 24, 8);
    t0.push(0, 0xff, 0x2f, 0); track(t0);
    for (const tr of song.tracks) {
      const b = []; text(b, 0x03, tr.name || 'Track'); const ch = tr.ch & 15;
      if (tr.kind) text(b, 0x01, `lumen-beats drum=${tr.kind} base=${GM[tr.kind] || 36}`);  // exact drum round-trip in Lumen Beats
      if (tr.program != null && ch !== 9) b.push(0, 0xc0 | ch, tr.program & 127);
      const ev = [];
      for (const n of tr.notes) { const t = Math.round(n.t), d = Math.max(1, Math.round(n.d)); ev.push([t, 1, n.p, n.v], [t + d, 0, n.p, 0]); }
      ev.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);   // note-offs before note-ons at the same tick
      let last = 0;
      for (const [t, on, p, v] of ev) { vlq(b, t - last); last = t; b.push(on ? 0x90 | ch : 0x80 | ch, p & 127, on ? Core.clamp(v, 1, 127) : 64); }
      b.push(0, 0xff, 0x2f, 0); track(b);
    }
    const n = hdr.length + chunks.reduce((a, c) => a + c.length, 0), outU = new Uint8Array(n); let k = 0;
    outU.set(hdr, k); k += hdr.length; for (const c of chunks) { outU.set(c, k); k += c.length; }
    return outU;
  }

  /* ---------------- project ⇄ MIDI ---------------- */
  const PROGRAM = { sub: 81, fm: 4, sampler: 0 };
  // mode 'song' (playlist arrangement) or 'pattern' (one pattern)
  function fromProject(prj, mode = 'song', patId) {
    const end = mode === 'song' ? Core.songEnd(prj) : Core.patLen(prj, Core.findPat(prj, patId));
    const ev = Core.collectEvents(prj, mode, 0, end, patId);
    const tracks = []; let nextCh = 0;
    for (const c of prj.channels) {
      const notes = ev.filter(e => e.ch === c.id); if (!notes.length) continue;
      const drum = c.type === 'drum';
      const ch = drum ? 9 : (nextCh === 9 ? ++nextCh : nextCh) % 16; if (!drum) nextCh++;
      const base = drum ? GM[c.params.kind] || 36 : 0;
      tracks.push({ name: c.name, ch, kind: drum ? c.params.kind : null, program: PROGRAM[c.type], notes: notes.map(n => ({ t: n.t, d: n.d, p: drum ? Core.clamp(base + n.p - 60, 0, 127) : n.p, v: n.v })) });
    }
    return write({ ppq: Core.PPQ, bpm: prj.bpm, sigNum: prj.sigNum, sigDen: prj.sigDen, name: prj.name, tracks });
  }
  // → {bpm, sigNum, sigDen, len, parts:[{name, type, params, notes}]} in project ticks (PPQ 96)
  function toParts(midi) {
    const sc = Core.PPQ / midi.ppq, R = t => Math.round(t * sc);
    const bpm = midi.tempos.length ? Core.clamp(Math.round(midi.tempos[0].bpm * 100) / 100, 20, 400) : 120;
    const sig = midi.sigs[0] || { num: 4, den: 4 };
    const parts = []; let len = 0;
    midi.tracks.forEach((tr, ti) => {
      const byCh = new Map(); for (const n of tr.notes) { if (!byCh.has(n.ch)) byCh.set(n.ch, []); byCh.get(n.ch).push(n); }
      for (const [ch, notes] of byCh) {
        if (ch === 9) {
          const byKind = new Map();
          for (const n of notes) { const kind = tr.drum ? tr.drum.kind : GM_IN[n.p] || 'rim'; if (!byKind.has(kind)) byKind.set(kind, []); byKind.get(kind).push({ t: R(n.t), d: Math.max(1, R(n.d)), p: Core.clamp(60 + n.p - (tr.drum ? tr.drum.base : GM[kind] || n.p), 0, 127), v: n.v }); }
          if (tr.drum && byKind.size === 1 && tr.name) { parts.push({ name: tr.name, type: 'drum', params: { kind: tr.drum.kind, choke: tr.drum.kind === 'hat' || tr.drum.kind === 'ohat' ? 1 : 0 }, notes: byKind.get(tr.drum.kind) }); continue; }
          for (const [kind, ns] of byKind) parts.push({ name: KIND_NAMES[kind], type: 'drum', params: { kind, choke: kind === 'hat' || kind === 'ohat' ? 1 : 0 }, notes: ns });
        } else {
          const prog = tr.programs[ch] ?? -1;
          const type = (prog >= 0 && prog < 8) || (prog >= 8 && prog < 16) ? 'fm' : 'sub';
          const name = (tr.name || ('Track ' + (ti + 1))) + (byCh.size > 1 ? ' ch' + (ch + 1) : '');
          const params = prog >= 32 && prog < 40 ? { o1o: -1, o2o: -1, cut: 900, aS: 0.8 } : prog >= 88 && prog < 96 ? { aA: 0.4, aR: 1.2, cut: 3000 } : {};
          parts.push({ name: name.slice(0, 40), type, params, notes: notes.map(n => ({ t: R(n.t), d: Math.max(1, R(n.d)), p: n.p, v: n.v })) });
        }
      }
    });
    for (const p of parts) for (const n of p.notes) len = Math.max(len, n.t + n.d);
    return { bpm, sigNum: Core.clamp(sig.num, 1, 16), sigDen: [2, 4, 8, 16].includes(sig.den) ? sig.den : 4, len, parts };
  }
  // A complete new project from a MIDI file: one channel + insert per part, one pattern, one playlist clip.
  function toProject(midi, name) {
    const x = toParts(midi), prj = Core.newProject();
    prj.name = name || 'MIDI import'; prj.bpm = x.bpm; prj.sigNum = x.sigNum; prj.sigDen = x.sigDen; prj.scale = 'chromatic';
    prj.channels = []; prj.mixer.inserts = [];
    const pat = Core.newPattern(prj.name.slice(0, 40)); prj.patterns = [pat];
    x.parts.slice(0, 120).forEach((p, i) => {
      const col = Core.COLORS[i % 8], ins = Core.newInsert(p.name, { color: col }); prj.mixer.inserts.push(ins);
      const c = Core.newChannel(p.type, { name: p.name, color: col, out: ins.id, params: p.params }); prj.channels.push(c);
      pat.notes[c.id] = Core.sortNotes(p.notes);
    });
    const bt = Core.barTicks(prj); pat.bars = Math.max(1, Math.ceil(x.len / bt));
    prj.playlist.clips = [{ id: Core.uid(), pat: pat.id, track: prj.playlist.tracks[0].id, start: 0, len: pat.bars * bt }];
    return prj;
  }

  const Midi = { parse, write, fromProject, toParts, toProject, GM, GM_IN };
  root.Midi = Midi;
  if (typeof module !== 'undefined' && module.exports) module.exports = Midi;
})(typeof window !== 'undefined' ? window : globalThis);
