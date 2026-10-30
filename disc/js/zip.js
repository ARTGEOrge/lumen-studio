// Uncompressed ("stored") zip writer that builds the archive as a Blob, so a
// multi-gigabyte disc can be downloaded without copying it into memory.
// Uses zip64 records once offsets pass 4 GB. Video does not compress, so
// storing is as small as deflating and much faster.

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

export async function crc32(blob, onBytes) {
  let c = 0xffffffff;
  for (let o = 0; o < blob.size; o += 8 << 20) {
    const b = new Uint8Array(await blob.slice(o, o + (8 << 20)).arrayBuffer());
    for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    onBytes?.(b.length);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const BIG = 0xffffffff;

// entries: [{name, blob}] — a name ending in "/" is a folder.
export async function zipBlob(entries, onBytes) {
  const parts = [], central = [];
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let offset = 0;
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const dir = e.name.endsWith('/');
    const size = dir ? 0 : e.blob.size;
    const crc = dir ? 0 : await crc32(e.blob, onBytes);
    const z64 = size >= BIG || offset >= BIG;

    const lh = new DataView(new ArrayBuffer(30 + name.length + (z64 ? 20 : 0)));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, z64 ? 45 : 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, z64 ? BIG : size, true); lh.setUint32(22, z64 ? BIG : size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, z64 ? 20 : 0, true);
    new Uint8Array(lh.buffer).set(name, 30);
    if (z64) {
      const x = 30 + name.length;
      lh.setUint16(x, 1, true); lh.setUint16(x + 2, 16, true);
      lh.setBigUint64(x + 4, BigInt(size), true); lh.setBigUint64(x + 12, BigInt(size), true);
    }
    parts.push(lh.buffer); if (!dir) parts.push(e.blob);

    const ch = new DataView(new ArrayBuffer(46 + name.length + (z64 ? 28 : 0)));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 45, true); ch.setUint16(6, z64 ? 45 : 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, z64 ? BIG : size, true); ch.setUint32(24, z64 ? BIG : size, true);
    ch.setUint16(28, name.length, true); ch.setUint16(30, z64 ? 28 : 0, true);
    ch.setUint32(38, dir ? 0x10 : 0, true); ch.setUint32(42, z64 ? BIG : offset, true);
    new Uint8Array(ch.buffer).set(name, 46);
    if (z64) {
      const x = 46 + name.length;
      ch.setUint16(x, 1, true); ch.setUint16(x + 2, 24, true);
      ch.setBigUint64(x + 4, BigInt(size), true); ch.setBigUint64(x + 12, BigInt(size), true);
      ch.setBigUint64(x + 20, BigInt(offset), true);
    }
    central.push(ch.buffer);
    offset += lh.byteLength + size;
  }

  const cdSize = central.reduce((s, b) => s + b.byteLength, 0), cdStart = offset;
  const z64 = cdStart >= BIG || entries.length >= 0xffff;
  const tail = [];
  if (z64) {
    const r = new DataView(new ArrayBuffer(56 + 20));
    r.setUint32(0, 0x06064b50, true); r.setBigUint64(4, 44n, true); r.setUint16(12, 45, true); r.setUint16(14, 45, true);
    r.setBigUint64(24, BigInt(entries.length), true); r.setBigUint64(32, BigInt(entries.length), true);
    r.setBigUint64(40, BigInt(cdSize), true); r.setBigUint64(48, BigInt(cdStart), true);
    r.setUint32(56, 0x07064b50, true); r.setBigUint64(64, BigInt(cdStart + cdSize), true); r.setUint32(72, 1, true);
    tail.push(r.buffer);
  }
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, Math.min(entries.length, 0xffff), true); e.setUint16(10, Math.min(entries.length, 0xffff), true);
  e.setUint32(12, z64 ? BIG : cdSize, true); e.setUint32(16, z64 ? BIG : cdStart, true);
  tail.push(e.buffer);
  return new Blob([...parts, ...central, ...tail], { type: 'application/zip' });
}
