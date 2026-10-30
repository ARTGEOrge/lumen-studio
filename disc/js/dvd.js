// Lumen Disc — DVD-Video authoring.
// The encoder (ffmpeg's "dvd" muxer) writes an MPEG-2 program stream with an
// empty navigation pack at the start of every VOBU. VobScanner reads that
// stream as it is produced; author() then fills every navigation pack and
// writes the VIDEO_TS.IFO / VTS_01_0.IFO tables that a DVD player needs.
// Works the same in the browser and in Node (tests).

export const SECTOR = 2048;
export const STANDARDS = {
  ntsc: { name: 'NTSC', frame: 3003, flag: 0xC0, size: [720, 480], rate: '30000/1001' },
  pal: { name: 'PAL', frame: 3600, flag: 0x40, size: [720, 576], rate: '25' },
};
// The largest VOB file on commercial discs; ImgBurn and friends expect files
// no larger than 1 GiB.
export const VOB_MAX_SECTORS = 524272;
const END_OF_CELL = 0x3fffffff;
// Search-pointer distances in half seconds, in DSI order (furthest first).
const SRI_STEPS = [240, 120, 60, 20, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

const PIC_I = 1, PIC_P = 2;

const readPts = (b, o) =>
  ((b[o] >> 1) & 7) * 0x40000000 + (b[o + 1] << 22) + ((b[o + 2] >> 1) << 15) + (b[o + 3] << 7) + (b[o + 4] >> 1);

const readScr = (b, o) =>
  ((b[o] >> 3) & 7) * 0x40000000 + ((b[o] & 3) << 28) + (b[o + 1] << 20) + (((b[o + 2] >> 3) & 0x1f) << 15) +
  ((b[o + 2] & 3) << 13) + (b[o + 3] << 5) + ((b[o + 4] >> 3) & 0x1f);

// ---------------------------------------------------------------- scanning

export class VobScanner {
  constructor() {
    this.sector = 0;          // index of the next whole pack
    this.part = new Uint8Array(SECTOR); this.partLen = 0;
    this.vobus = [];
    this.cur = null;          // VOBU being read
    this.win = 0xffffffff;    // last four bytes of video elementary stream
    this.pic = null;          // picture being read
    this.hdr = 0;             // picture-header bytes still wanted (tr / type)
    this.pts = null;          // PTS of the current PES, until a picture takes it
  }

  // Accepts the stream in chunks of any size.
  feed(bytes) {
    let i = 0;
    if (this.partLen) {
      const n = Math.min(SECTOR - this.partLen, bytes.length);
      this.part.set(bytes.subarray(0, n), this.partLen); this.partLen += n; i = n;
      if (this.partLen < SECTOR) return;
      this.pack(this.part); this.partLen = 0;
    }
    for (; i + SECTOR <= bytes.length; i += SECTOR) this.pack(bytes.subarray(i, i + SECTOR));
    if (i < bytes.length) { this.part.set(bytes.subarray(i)); this.partLen = bytes.length - i; }
  }

  pack(p) {
    const sector = this.sector++;
    if (p[0] !== 0 || p[1] !== 0 || p[2] !== 1 || p[3] !== 0xba) throw new Error('Not a DVD stream (sector ' + sector + ')');
    let o = 14 + (p[13] & 7);
    while (o + 6 <= SECTOR && p[o] === 0 && p[o + 1] === 0 && p[o + 2] === 1) {
      const id = p[o + 3], body = o + 6, end = body + ((p[o + 4] << 8) | p[o + 5]);
      if (id === 0xbb) { o = end; continue; }
      if (id === 0xbf && p[body] === 0) this.startVobu(p, sector);
      else if (id === 0xe0 && this.cur) {
        const hlen = p[body + 2];
        this.pts = (p[body + 1] & 0x80) ? readPts(p, body + 3) : null;
        this.video(p, body + 3 + hlen, Math.min(end, SECTOR), sector);
        this.pts = null;
      } else if (id === 0xbd && this.cur && this.cur.audio < 0) this.cur.audio = sector;
      o = end;
    }
  }

  startVobu(p, sector) {
    this.closePicture(sector - 1);
    if (this.cur) this.cur.last = sector - 1;
    this.cur = { sector, last: sector, scr: readScr(p, 4), nav: new Uint8Array(p), audio: -1, pics: [] };
    this.vobus.push(this.cur);
  }

  closePicture(sector) {
    if (this.pic) { this.pic.end = sector; this.pic = null; }
  }

  video(p, o, end, sector) {
    let w = this.win;
    for (; o < end; o++) {
      const b = p[o];
      if (this.hdr) {
        const pic = this.pic;
        if (this.hdr === 2) pic.tr = b << 2;
        else { pic.tr |= b >> 6; pic.type = (b >> 3) & 7; }
        this.hdr--;
      }
      w = ((w << 8) | b) >>> 0;
      if ((w >>> 8) !== 1) continue;
      if (b === 0x00) {                       // picture start
        this.closePicture(sector);
        this.pic = { tr: 0, type: 0, pts: this.pts, end: sector };
        this.pts = null;
        this.cur.pics.push(this.pic);
        this.hdr = 2;
      } else if (b === 0xb3 || b === 0xb8 || b === 0xb7) this.closePicture(sector);
    }
    this.win = w;
  }

  // Call after the last chunk. Returns the VOBU list.
  finish() {
    this.closePicture(this.sector - 1);
    if (this.cur) this.cur.last = this.sector - 1;
    return this.vobus;
  }
}

// ---------------------------------------------------------------- helpers

const bcd = (v) => ((v / 10 | 0) << 4) | (v % 10);

export function dvdTime(ticks, std) {
  let s = Math.floor(ticks / 90000);
  const f = Math.min(Math.floor((ticks - s * 90000) / std.frame), 39);
  const h = Math.min(Math.floor(s / 3600), 99), m = Math.floor(s / 60) % 60;
  s %= 60;
  return ((bcd(h) << 24) | (bcd(m) << 16) | (bcd(s) << 8) | std.flag | bcd(f)) >>> 0;
}

class Bytes {
  constructor(n) { this.b = new Uint8Array(n); this.v = new DataView(this.b.buffer); }
  u8(o, x) { this.b[o] = x; return this; }
  u16(o, x) { this.v.setUint16(o, x); return this; }
  u32(o, x) { this.v.setUint32(o, x >>> 0); return this; }
  str(o, s) { for (let i = 0; i < s.length; i++) this.b[o + i] = s.charCodeAt(i) & 0x7f; return this; }
}

const sectorsOf = (n) => Math.ceil(n / SECTOR);

// Lays tables out one after another, each starting on a sector boundary.
// Returns the start sector of each table and the joined bytes.
function layout(tables) {
  const at = []; let s = 0;
  for (const t of tables) { at.push(s); s += sectorsOf(t.length); }
  const out = new Uint8Array(s * SECTOR);
  tables.forEach((t, i) => out.set(t, at[i] * SECTOR));
  return { at, bytes: out, sectors: s };
}

function videoAttr(std, aspect) {
  // MPEG-2, NTSC/PAL, 4:3 (display format "not specified") or 16:9 (letterbox only), 720 wide.
  const b0 = 0x40 | (std === STANDARDS.pal ? 0x10 : 0) | (aspect === '16:9' ? 0x0c | 0x02 : 0x03);
  return b0 << 8;
}
const AC3_STEREO = [0x00, 0x01, 0, 0, 0, 0, 0, 0];

// A program chain: optional pre-commands, programs (chapters) and cells.
function pgc({ pre = [], cells = [], programs = [], time = 0, audio = false }) {
  const cmdLen = pre.length ? 8 + pre.length * 8 : 0;
  const pmLen = programs.length ? programs.length + (programs.length & 1) : 0;
  const len = 0xec + cmdLen + pmLen + cells.length * 24 + cells.length * 4;
  const t = new Bytes(len);
  t.u8(2, programs.length).u8(3, cells.length).u32(4, time);
  if (audio) t.u16(0x0c, 0x8000);
  let o = 0xec;
  if (cmdLen) {
    t.u16(0xe4, o).u16(o, pre.length).u32(o + 2, 0).u16(o + 6, cmdLen - 1);
    pre.forEach((c, i) => t.b.set(c, o + 8 + i * 8));
    o += cmdLen;
  }
  if (programs.length) {
    t.u16(0xe6, o); programs.forEach((c, i) => t.u8(o + i, c)); o += pmLen;
  }
  if (cells.length) {
    t.u16(0xe8, o);
    cells.forEach((c, i) => {
      const q = o + i * 24;
      t.u8(q, c.flags).u32(q + 4, c.time).u32(q + 8, c.first).u32(q + 16, c.lastVobu).u32(q + 20, c.last);
    });
    o += cells.length * 24;
    t.u16(0xea, o);
    cells.forEach((c, i) => t.u16(o + i * 4, 1).u8(o + i * 4 + 3, i + 1));
  }
  return t.b;
}

// ---------------------------------------------------------------- authoring

// vobus: from VobScanner.finish(). chapters: start times in seconds.
// Returns the patched navigation packs and both IFO files.
export function author(vobus, { standard = 'ntsc', aspect = '16:9', chapters = [0], provider = 'LUMEN DISC' } = {}) {
  const std = STANDARDS[standard];
  if (!vobus.length) throw new Error('No video in the stream');
  const n = vobus.length;

  // Presentation times of every VOBU.
  const sPtm = new Array(n), ePtm = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = vobus[i], key = v.pics.find((p) => p.type === PIC_I && p.pts != null);
    let s = key ? key.pts - key.tr * std.frame : (i ? ePtm[i - 1] : 0);
    if (i && Math.abs(s - ePtm[i - 1]) < std.frame / 2) s = ePtm[i - 1];
    sPtm[i] = s; ePtm[i] = s + Math.max(v.pics.length, 1) * std.frame;
  }
  const t0 = sPtm[0], rel = sPtm.map((s) => s - t0);
  const total = ePtm[n - 1] - t0;
  const sec = vobus.map((v) => v.sector);
  const vobSectors = vobus[n - 1].last + 1;

  // Cells: one per chapter, starting at the first VOBU at or after its time.
  const starts = [0];
  for (const c of [...chapters].sort((a, b) => a - b)) {
    const t = c * 90000 - std.frame / 2;
    const i = rel.findIndex((r) => r >= t);
    if (i > starts[starts.length - 1] && starts.length < 99) starts.push(i);
  }
  const cells = starts.map((a, k) => {
    const b = (k + 1 < starts.length ? starts[k + 1] : n) - 1;
    return { a, b, first: sec[a], lastVobu: sec[b], last: vobus[b].last, time: dvdTime(ePtm[b] - sPtm[a], std), flags: k ? 0x08 : 0x02 };
  });

  // Fill the navigation packs.
  const navs = [];
  cells.forEach((cell, ci) => {
    for (let i = cell.a; i <= cell.b; i++) {
      const v = vobus[i], p = new Uint8Array(v.nav), d = new DataView(p.buffer);
      const eltm = dvdTime(sPtm[i] - sPtm[cell.a], std);
      const ptr = (j) => (j < cell.a || j > cell.b) ? END_OF_CELL : ((Math.abs(sec[j] - sec[i]) | 0x80000000) >>> 0);
      // PCI
      const P = 0x2d;
      d.setUint32(P, sec[i]);
      d.setUint32(P + 0x0c, sPtm[i] >>> 0); d.setUint32(P + 0x10, ePtm[i] >>> 0);
      d.setUint32(P + 0x18, eltm);
      // DSI
      const D = 0x407;
      d.setUint32(D, v.scr >>> 0);
      d.setUint32(D + 0x04, sec[i]);
      d.setUint32(D + 0x08, v.last - v.sector);
      const refs = v.pics.filter((q) => q.type === PIC_I || q.type === PIC_P).slice(0, 3);
      refs.forEach((q, k) => d.setUint32(D + 0x0c + k * 4, Math.min(Math.max(q.end, v.sector), v.last) - v.sector));
      d.setUint16(D + 0x18, 1); d.setUint8(D + 0x1b, ci + 1);
      d.setUint32(D + 0x1c, eltm);
      d.setUint32(D + 0x2c, sPtm[0] >>> 0); d.setUint32(D + 0x30, ePtm[n - 1] >>> 0);
      // Search pointers (VOBU_SRI): next video, 19 forward steps (120 s down
      // to 0.5 s), next VOBU, previous VOBU, 19 backward steps (0.5 s up to
      // 120 s), previous video.
      const R = D + 0xea;
      d.setUint32(R, ptr(i + 1));
      SRI_STEPS.forEach((h, k) => {
        const want = rel[i] + h * 45000;
        let j = i + 1; while (j <= cell.b && rel[j] < want) j++;
        d.setUint32(R + 4 + k * 4, ptr(j));
        const back = rel[i] - h * 45000;
        let q = i - 1; while (q >= cell.a && rel[q] > back) q--;
        d.setUint32(R + 0x58 + (18 - k) * 4, ptr(q));
      });
      d.setUint32(R + 0x50, ptr(i + 1));
      d.setUint32(R + 0x54, ptr(i - 1));
      d.setUint32(R + 0xa4, ptr(i - 1));
      // Audio sync: first audio pack of this VOBU.
      if (v.audio >= 0 && v.audio <= v.last) d.setUint16(D + 0x192, v.audio - v.sector);
      navs.push({ sector: v.sector, bytes: p });
    }
  });

  const vts = buildVts({ std, aspect, cells, vobus, sec, rel, total, vobSectors });
  const vmg = buildVmg({ std, aspect, chapters: cells.length, vtsSectors: vts.sectors * 2 + vobSectors, provider });
  return { navs, vmg, vts: vts.bytes, vobSectors, duration: total / 90000, chapters: cells.length, vobus: n };
}

function buildVts({ std, aspect, cells, sec, rel, total, vobSectors }) {
  const va = videoAttr(std, aspect);
  const nc = cells.length;

  const ptt = new Bytes(0x0c + nc * 4);
  ptt.u16(0, 1).u32(4, ptt.b.length - 1).u32(8, 0x0c);
  for (let i = 0; i < nc; i++) ptt.u16(0x0c + i * 4, 1).u16(0x0e + i * 4, i + 1);

  const chain = pgc({ cells, programs: cells.map((c, i) => i + 1), time: dvdTime(total, std), audio: true });
  const pgcit = new Bytes(0x10 + chain.length);
  pgcit.u16(0, 1).u32(4, pgcit.b.length - 1).u8(8, 0x81).u32(0x0c, 0x10);
  pgcit.b.set(chain, 0x10);

  // Time map: one entry per time unit, so there are never more than 2048.
  const secs = total / 90000, tmu = Math.max(1, Math.ceil(secs / 2047));
  const entries = Math.floor(secs / tmu);
  const tmap = new Bytes(0x0c + 4 + entries * 4);
  tmap.u16(0, 1).u32(4, tmap.b.length - 1).u32(8, 0x0c).u8(0x0c, tmu).u16(0x0e, entries);
  for (let k = 1, j = 0; k <= entries; k++) {
    const t = k * tmu * 90000;
    while (j + 1 < rel.length && rel[j + 1] <= t) j++;
    tmap.u32(0x0c + k * 4, sec[j]);
  }

  const cadt = new Bytes(8 + nc * 12);
  cadt.u16(0, 1).u32(4, cadt.b.length - 1);
  cells.forEach((c, i) => cadt.u16(8 + i * 12, 1).u8(10 + i * 12, i + 1).u32(12 + i * 12, c.first).u32(16 + i * 12, c.last));

  const admap = new Bytes(4 + sec.length * 4);
  admap.u32(0, admap.b.length - 1);
  sec.forEach((s, i) => admap.u32(4 + i * 4, s));

  const mat = new Bytes(SECTOR);
  const L = layout([mat.b, ptt.b, pgcit.b, tmap.b, cadt.b, admap.b]);
  const ifo = L.sectors;
  mat.str(0, 'DVDVIDEO-VTS')
    .u32(0x0c, ifo * 2 + vobSectors - 1).u32(0x1c, ifo - 1).u8(0x21, 0x11)
    .u32(0x80, 0x3ff)
    .u32(0xc4, ifo).u32(0xc8, L.at[1]).u32(0xcc, L.at[2]).u32(0xd4, L.at[3])
    .u32(0xe0, L.at[4]).u32(0xe4, L.at[5])
    .u16(0x100, va)
    .u16(0x200, va).u8(0x203, 1);
  mat.b.set(AC3_STEREO, 0x204);
  return layout([mat.b, ptt.b, pgcit.b, tmap.b, cadt.b, admap.b]);
}

function buildVmg({ std, aspect, chapters, vtsSectors, provider }) {
  const va = videoAttr(std, aspect);
  const ifoSectors = 3;
  const vmgLast = ifoSectors * 2 - 1;

  const fp = pgc({ pre: [new Uint8Array([0x30, 0x02, 0, 0, 0, 1, 0, 0])] }); // JumpTT 1
  const mat = new Bytes(SECTOR);
  mat.str(0, 'DVDVIDEO-VMG')
    .u32(0x0c, vmgLast).u32(0x1c, ifoSectors - 1).u8(0x21, 0x11)
    .u16(0x26, 1).u16(0x28, 1).u8(0x2a, 1).u16(0x3e, 1)
    .str(0x40, provider.slice(0, 32))
    .u32(0x80, 0x400 + fp.length - 1).u32(0x84, 0x400)
    .u32(0xc4, 1).u32(0xd0, 2)
    .u16(0x100, va);
  mat.b.set(fp, 0x400);

  const tt = new Bytes(8 + 12);
  tt.u16(0, 1).u32(4, tt.b.length - 1)
    .u8(8, 0x00).u8(9, 1).u16(10, chapters).u16(12, 0).u8(14, 1).u8(15, 1).u32(16, vmgLast + 1);

  const atrtLen = 0x0c + 0x308;
  const atrt = new Bytes(atrtLen);
  atrt.u16(0, 1).u32(4, atrtLen - 1).u32(8, 0x0c);
  const e = 0x0c;
  atrt.u32(e, 0x307).u16(e + 0x08, va).u16(e + 0x108, va).u8(e + 0x10b, 1);
  atrt.b.set(AC3_STEREO, e + 0x10c);

  return layout([mat.b, tt.b, atrt.b]).bytes;
}

// Which VOB file each part of the stream goes in.
export function vobFiles(sectors) {
  const files = [];
  for (let s = 0, k = 1; s < sectors; s += VOB_MAX_SECTORS, k++) {
    if (k > 9) throw new Error('Too much video for one DVD title set (over 9 GB)');
    files.push({ name: `VTS_01_${k}.VOB`, start: s, sectors: Math.min(VOB_MAX_SECTORS, sectors - s) });
  }
  return files;
}
