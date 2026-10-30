// End to end: encodes a mixed set of clips with the app's own ffmpeg
// arguments (ffmpeg.wasm under Node), authors the disc and checks it.
// Usage: node disc/tests/encode.test.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { VobScanner, author, vobFiles, STANDARDS, SECTOR } from '../js/dvd.js';
import { buildArgs, parseProbe, inputName } from '../js/plan.js';

const require = createRequire(import.meta.url);
const CORE = path.resolve(import.meta.dirname, '../../tools/deps/disc/node_modules/@ffmpeg/core/dist/umd');
globalThis.self = globalThis; globalThis.location = { href: 'file:///x/' };
const createCore = require(CORE + '/ffmpeg-core.js');
const core = await createCore({ wasmBinary: fs.readFileSync(CORE + '/ffmpeg-core.wasm') });
const logs = []; core.setLogger(({ message }) => logs.push(message));
const run = (...a) => { logs.length = 0; core.exec(...a); const r = core.ret; core.reset(); return r; };

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

// Test inputs: a 16:9 clip with sound and a 4:3 clip without.
core.FS.mkdir('/in');
run('-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '/in/a.mp4');
run('-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=25:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '/in/b.mp4');

const clips = [{ id: 'a', name: 'wide.mp4' }, { id: 'b', name: 'old.mp4' }];
const probeLogs = [];
for (const c of clips) { run('-hide_banner', '-i', '/in/' + c.id + '.mp4'); probeLogs.push('@@FILE ' + inputName(c), ...logs); }
const info = parseProbe(probeLogs);
for (const c of clips) {
  const v = info[inputName(c)].video;
  Object.assign(c, { dur: info[inputName(c)].dur, w: v.w, h: v.h, dar: v.w * v.sar / v.h, audio: info[inputName(c)].audio });
}
ok(clips[0].audio && !clips[1].audio && Math.abs(clips[0].dur - 6) < 0.1 && clips[1].w === 640, 'probe reads size, length and sound');
const list = [{ id: 's', name: 'Sample', sample: true, dur: 20, w: 1280, h: 720, dar: 16 / 9, audio: true }, ...clips];

for (const standard of ['ntsc', 'pal']) {
  const std = STANDARDS[standard];
  const starts = [0, 20, 26];
  const p = { std, aspect: '16:9', videoK: 6000, chapters: starts, dur: 31 };
  const { args, chapters } = buildArgs(list, p);
  ok(chapters.length === 3 && chapters.every((c, i) => Math.abs(c - starts[i]) < 0.04), `${std.name}: planned chapters ${chapters.map((c) => c.toFixed(3)).join(', ')}`);
  // Same output device as the worker: every write is streamed out in order.
  const parts = []; let total = 0, inOrder = true;
  const dev = core.FS.makedev(64, standard === 'ntsc' ? 1 : 2);
  core.FS.registerDevice(dev, {
    open() {}, close() {}, read() { return 0; },
    write(s, buf, off, len, pos) { if (typeof pos === 'number' && pos !== total) inOrder = false; parts.push(Buffer.from(buf.subarray(off, off + len))); total += len; return len; },
    llseek(s, o, w) { return w === 1 ? s.position + o : w === 2 ? total + o : o; },
  });
  try { core.FS.mkdir('/out'); } catch {}
  try { core.FS.unlink('/out/disc.vob'); } catch {}
  core.FS.mkdev('/out/disc.vob', dev);
  args.forEach((a, i) => { if (a.startsWith('/in/')) args[i] = '/in/' + a.slice(4).replace(/\.mp4$/, '.mp4'); });
  const t = Date.now();
  const ret = run(...args);
  ok(ret === 0, `${std.name}: encoder finished (${((Date.now() - t) / 1000).toFixed(1)} s)` + (ret ? ' ' + logs.filter((l) => /rror|nvalid/.test(l)).join(' | ') : ''));
  ok(inOrder, `${std.name}: output written strictly in order`);
  const vob = Buffer.concat(parts);
  const scan = new VobScanner(); scan.feed(vob);
  const vobus = scan.finish();
  const r = author(vobus, { standard, aspect: '16:9', chapters });
  ok(Math.abs(r.duration - 31) < 0.3, `${std.name}: running time ${r.duration.toFixed(2)} s (expect 31)`);
  ok(r.chapters === 3, `${std.name}: 3 chapters`);
  const bFrames = vobus.reduce((s, v) => s + v.pics.filter((q) => q.type === 3).length, 0);
  ok(bFrames > 0, `${std.name}: B-frames present (${bFrames}), so display order is exercised`);
  const maxPics = standard === 'pal' ? 15 : 18;
  ok(vobus.every((v, i) => (v.pics.length <= maxPics || i === vobus.length - 1) && v.pics[0].type === 1 && v.pics.filter((q) => q.type === 1).length === 1), `${std.name}: every VOBU is one GOP of at most ${maxPics} pictures`);
  // Chapter cells start exactly at the clip boundaries (forced key frames).
  const be32 = (b, o) => new DataView(b.buffer, b.byteOffset).getUint32(o);
  const navOf = new Map(r.navs.map((n) => [n.sector, n.bytes]));
  const pgcit = be32(r.vts, 0xcc) * SECTOR, pg = pgcit + be32(r.vts, pgcit + 0x0c);
  const cells = new DataView(r.vts.buffer).getUint16(pg + 0xe8);
  const firstPtm = be32(navOf.get(0), 0x2d + 0x0c);
  chapters.forEach((s, i) => {
    const sec = be32(r.vts, pg + cells + i * 24 + 8), ptm = be32(navOf.get(sec), 0x2d + 0x0c);
    ok(Math.abs((ptm - firstPtm) / 90000 - s) < 0.001, `${std.name}: chapter ${i + 1} starts at ${((ptm - firstPtm) / 90000).toFixed(3)} s (expect ${s.toFixed(3)})`);
  });
  for (let i = 1; i < r.navs.length; i++) {
    if (be32(r.navs[i].bytes, 0x2d + 0x0c) !== be32(r.navs[i - 1].bytes, 0x2d + 0x10)) { ok(false, `${std.name}: VOBU ${i} time gap`); break; }
  }
  // Audio and video stay together: the stream must contain about 31 s of AC-3 (1536 samples per frame).
  let ac3 = 0;
  for (let o = 0; o < vob.length; o += SECTOR) {
    let q = o + 14 + (vob[o + 13] & 7);
    if (vob.readUInt32BE(q) === 0x1bb) q += 6 + vob.readUInt16BE(q + 4);
    if (vob[q + 3] === 0xbd) { const h = q + 9 + vob[q + 8]; if (vob[h] === 0x80) ac3 += vob[h + 1]; }
  }
  ok(Math.abs(ac3 * 0.032 - 31) < 0.6, `${std.name}: ${(ac3 * 0.032).toFixed(2)} s of AC-3 sound (expect 31)`);
  const out = process.argv[2];
  if (out) {
    const dir = path.join(out, standard.toUpperCase()), vt = path.join(dir, 'VIDEO_TS');
    fs.mkdirSync(vt, { recursive: true }); fs.mkdirSync(path.join(dir, 'AUDIO_TS'), { recursive: true });
    for (const n of r.navs) vob.set(n.bytes, n.sector * SECTOR);
    fs.writeFileSync(path.join(vt, 'VIDEO_TS.IFO'), r.vmg); fs.writeFileSync(path.join(vt, 'VIDEO_TS.BUP'), r.vmg);
    fs.writeFileSync(path.join(vt, 'VTS_01_0.IFO'), r.vts); fs.writeFileSync(path.join(vt, 'VTS_01_0.BUP'), r.vts);
    for (const f of vobFiles(r.vobSectors)) fs.writeFileSync(path.join(vt, f.name), vob.subarray(f.start * SECTOR, (f.start + f.sectors) * SECTOR));
  }
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
