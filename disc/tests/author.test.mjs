// Authors a DVD from a VOB written by ffmpeg's "dvd" muxer and checks the
// result against the rules libdvdread enforces when it opens a disc.
// Usage: node disc/tests/author.test.mjs <stream.vob> [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { VobScanner, author, vobFiles, SECTOR } from '../js/dvd.js';

const [src, out] = process.argv.slice(2);
const data = fs.readFileSync(src);
const scan = new VobScanner();
for (let i = 0; i < data.length; i += 100003) scan.feed(data.subarray(i, i + 100003)); // odd chunks on purpose
const vobus = scan.finish();
const r = author(vobus, { standard: 'ntsc', aspect: '16:9', chapters: [0, 5] });

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const be32 = (b, o) => new DataView(b.buffer, b.byteOffset).getUint32(o);
const be16 = (b, o) => new DataView(b.buffer, b.byteOffset).getUint16(o);

ok(vobus.length > 10, 'VOBUs found: ' + vobus.length);
ok(r.chapters === 2, 'two chapters, got ' + r.chapters);
ok(Math.abs(r.duration - 10) < 0.2, 'duration ~10 s, got ' + r.duration);
vobus.forEach((v, i) => {
  ok(v.pics.length > 0 && v.pics.length <= 18, `VOBU ${i} has ${v.pics.length} pictures`);
  ok(v.pics.some((p) => p.type === 1 && p.pts != null), `VOBU ${i} has a timed I picture`);
});
r.navs.forEach((nv, i) => {
  const p = nv.bytes;
  ok(be32(p, 0x2d) === nv.sector && be32(p, 0x40b) === nv.sector, 'nav lbn ' + i);
  ok(be32(p, 0x2d + 0x10) > be32(p, 0x2d + 0x0c), 'e_ptm > s_ptm ' + i);
  ok(be32(p, 0x40f) === vobus[i].last - vobus[i].sector, 'vobu_ea ' + i);
  ok(be32(p, 0x413) > 0 && be32(p, 0x413) <= be32(p, 0x40f), '1st ref inside VOBU ' + i);
  if (i) ok(be32(p, 0x2d + 0x0c) === be32(r.navs[i - 1].bytes, 0x2d + 0x10), 'continuous ptm ' + i);
});

// libdvdread-style checks on the IFOs.
const vmg = r.vmg, vts = r.vts;
ok(String.fromCharCode(...vmg.subarray(0, 12)) === 'DVDVIDEO-VMG', 'VMG id');
ok(be32(vmg, 0x1c) * 2 <= be32(vmg, 0x0c), 'vmgi_last_sector*2 <= vmg_last_sector');
ok(vmg[0x2a] === 1 && be16(vmg, 0x26) === 1 && be16(vmg, 0x28) === 1, 'volume / side');
ok(be32(vmg, 0x84) < be32(vmg, 0x80) && be32(vmg, 0x80) >= 341, 'first play pgc inside VMGI');
const tt = be32(vmg, 0xc4) * SECTOR;
ok(be16(vmg, tt) === 1 && be16(vmg, tt + 10) === 2 && be32(vmg, tt + 16) === be32(vmg, 0x0c) + 1, 'TT_SRPT');
ok(String.fromCharCode(...vts.subarray(0, 12)) === 'DVDVIDEO-VTS', 'VTS id');
const vtsiLast = be32(vts, 0x1c), vtsLast = be32(vts, 0x0c);
ok(vtsiLast * 2 <= vtsLast && vts.length === (vtsiLast + 1) * SECTOR, 'VTS sizes');
ok(be32(vts, 0xc4) === vtsiLast + 1, 'title VOBS right after the IFO');
ok(vtsLast === (vtsiLast + 1) * 2 + r.vobSectors - 1, 'vts_last_sector covers IFO+VOBs+BUP');
const pgcit = be32(vts, 0xcc) * SECTOR, pg = pgcit + be32(vts, pgcit + 0x0c);
ok(vts[pgcit + 8] === 0x81, 'entry PGC of title 1');
ok(vts[pg + 2] === 2 && vts[pg + 3] === 2, 'PGC programs/cells');
const cp = pg + be16(vts, pg + 0xe8);
ok(be32(vts, cp + 8) === 0 && be32(vts, cp + 24 + 20) === r.vobSectors - 1, 'cells span the VOBs');
const cadt = be32(vts, 0xe0) * SECTOR;
ok((be32(vts, cadt + 4) + 1 - 8) % 12 === 0, 'C_ADT size');
const adm = be32(vts, 0xe4) * SECTOR;
ok((be32(vts, adm) + 1 - 4) / 4 === vobus.length, 'VOBU_ADMAP has every VOBU');

console.log(fails ? fails + ' failures' : 'all checks passed', `(${vobus.length} VOBUs, ${r.chapters} chapters, ${r.duration.toFixed(2)} s)`);

if (out) {
  const vt = path.join(out, 'VIDEO_TS');
  fs.mkdirSync(vt, { recursive: true }); fs.mkdirSync(path.join(out, 'AUDIO_TS'), { recursive: true });
  const patched = Buffer.from(data);
  for (const nv of r.navs) patched.set(nv.bytes, nv.sector * SECTOR);
  fs.writeFileSync(path.join(vt, 'VIDEO_TS.IFO'), r.vmg); fs.writeFileSync(path.join(vt, 'VIDEO_TS.BUP'), r.vmg);
  fs.writeFileSync(path.join(vt, 'VTS_01_0.IFO'), r.vts); fs.writeFileSync(path.join(vt, 'VTS_01_0.BUP'), r.vts);
  for (const f of vobFiles(r.vobSectors)) fs.writeFileSync(path.join(vt, f.name), patched.subarray(f.start * SECTOR, (f.start + f.sectors) * SECTOR));
  console.log('wrote', out);
}
process.exit(fails ? 1 : 0);
