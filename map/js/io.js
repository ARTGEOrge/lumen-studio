// Lumen Map — vector format readers and writers: GeoJSON, ESRI Shapefile (.shp/.shx/.dbf/.prj/.cpg, zipped too),
// KML/KMZ, GPX, CSV (lat/lon or WKT columns) and WKT geometries. Everything reads into WGS84 lon/lat GeoJSON features.
// Opened files are untrusted: parsing is defensive (bounds checks, size limits) and nothing in a file is ever executed.
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const P = root.MapProj || (isNode ? require('./proj.js') : null);
  const G = root.MapGeo || (isNode ? require('./geo.js') : null);
  const fflate = () => root.fflate || globalThis.fflate || (isNode ? require('../vendor/fflate.min.js') : null);
  const td = (enc, fatal) => { try { return new TextDecoder(enc, { fatal }); } catch (e) { return new TextDecoder('utf-8'); } };
  const u8 = b => b instanceof Uint8Array ? b : new Uint8Array(b);
  const text = b => typeof b === 'string' ? b : td('utf-8').decode(u8(b)).replace(/^﻿/, '');
  const ext = n => (String(n).match(/\.([^.\\/]+)$/) || [, ''])[1].toLowerCase();
  const base = n => String(n).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

  // ---------- helpers ----------
  function inferFields(features) {
    const seen = new Map();
    features.forEach(f => Object.entries(f.properties || {}).forEach(([k, v]) => {
      let t = seen.get(k); const vt = v == null || v === '' ? null : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string';
      if (!vt) { if (!t) seen.set(k, null); return; }
      if (!t) seen.set(k, vt); else if (t !== vt) seen.set(k, 'string');
    }));
    return [...seen].map(([name, type]) => ({ name, type: type || 'string' }));
  }
  function reprojectFeatures(features, def) {
    if (!def || def.proj === 'longlat' && !def.towgs84 && !def.pm) return features;
    const m = P.make(def);
    return features.map(f => ({ ...f, geometry: f.geometry && G.mapCoords(f.geometry, c => m.inverse(c)) }));
  }
  function looksLonLat(features) {
    for (const f of features.slice(0, 200)) for (const p of G.parts(f.geometry)) for (const c of p) if (!(Math.abs(c[0]) <= 360 && Math.abs(c[1]) <= 90)) return false;
    return true;
  }
  const layer = (name, features, extra = {}) => ({ name, features: features.map((f, i) => ({ id: i + 1, geometry: f.geometry || null, properties: f.properties || {} })), fields: extra.fields || inferFields(features), ...extra });

  // ---------- GeoJSON ----------
  function validGeom(g, depth = 0) {
    if (!g || typeof g !== 'object' || depth > 4) return null;
    const num = c => Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1]) ? c.slice(0, 3).map(Number) : null;
    const arr = (a, f) => Array.isArray(a) ? a.map(f).filter(x => x) : [];
    switch (g.type) {
      case 'Point': { const c = num(g.coordinates); return c ? { type: 'Point', coordinates: c } : null; }
      case 'MultiPoint': return { type: g.type, coordinates: arr(g.coordinates, num) };
      case 'LineString': return { type: g.type, coordinates: arr(g.coordinates, num) };
      case 'MultiLineString': return { type: g.type, coordinates: arr(g.coordinates, l => arr(l, num)) };
      case 'Polygon': return { type: g.type, coordinates: arr(g.coordinates, r => arr(r, num)).filter(r => r.length >= 3) };
      case 'MultiPolygon': return { type: g.type, coordinates: arr(g.coordinates, p => arr(p, r => arr(r, num)).filter(r => r.length >= 3)) };
      case 'GeometryCollection': return { type: g.type, geometries: arr(g.geometries, x => validGeom(x, depth + 1)) };
    }
    return null;
  }
  function readGeoJSON(data, name) {
    const j = typeof data === 'object' && !(data instanceof ArrayBuffer) && !(data instanceof Uint8Array) ? data : JSON.parse(text(data));
    let feats = [];
    if (j.type === 'FeatureCollection') feats = Array.isArray(j.features) ? j.features : [];
    else if (j.type === 'Feature') feats = [j];
    else if (j.type) feats = [{ type: 'Feature', geometry: j, properties: {} }];
    else throw new Error('Not a GeoJSON object');
    feats = feats.filter(f => f && typeof f === 'object').map(f => ({ geometry: validGeom(f.geometry), properties: cleanProps(f.properties, f.id) }));
    let def = null; const cn = j.crs && j.crs.properties && j.crs.properties.name;
    if (cn) { def = P.get(cn); if (!def) throw new Error('Unsupported GeoJSON crs: ' + cn); }
    const out = layer(name, def ? reprojectFeatures(feats, def) : feats, { sourceCrs: def ? def.code : 'EPSG:4326' });
    if (!def && !looksLonLat(feats)) out.needsCrs = true;
    return [out];
  }
  function cleanProps(p, id) {
    const o = {}; if (p && typeof p === 'object') Object.keys(p).slice(0, 500).forEach(k => { const v = p[k]; o[String(k).slice(0, 100)] = v == null ? null : typeof v === 'object' ? JSON.stringify(v).slice(0, 10000) : v; });
    if (id != null && o.id == null) o.id = id; return o;
  }
  function writeGeoJSON(L, opts = {}) {
    const fc = { type: 'FeatureCollection', name: L.name, features: L.features.map(f => ({ type: 'Feature', id: f.id, properties: f.properties, geometry: opts.precision != null ? round(f.geometry, opts.precision) : f.geometry })) };
    return JSON.stringify(fc, null, opts.pretty ? 1 : 0);
  }
  const round = (g, d) => { const k = Math.pow(10, d); return G.mapCoords(g, c => [Math.round(c[0] * k) / k, Math.round(c[1] * k) / k]); };

  // ---------- Shapefile ----------
  function readShp(buf) {
    const b = u8(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 100 || dv.getInt32(0, false) !== 9994) throw new Error('Not an ESRI shapefile (.shp)');
    const fileLen = Math.min(b.length, dv.getInt32(24, false) * 2), shpType = dv.getInt32(32, true), geoms = [];
    let off = 100;
    while (off + 12 <= fileLen) {
      const len = dv.getInt32(off + 4, false) * 2, rec = off + 8; off = rec + len;
      if (len < 4 || off > b.length) break;
      geoms.push(readShape(dv, rec, len));
    }
    return { type: shpType, geoms };
  }
  function readShape(dv, o, len) {
    const st = dv.getInt32(o, true), end = o + len, F = i => dv.getFloat64(i, true), I = i => dv.getInt32(i, true);
    const hasZ = st === 11 || st === 13 || st === 15 || st === 18;
    if (st === 0) return null;
    if (st === 1 || st === 11 || st === 21) return { type: 'Point', coordinates: hasZ && o + 28 <= end ? [F(o + 4), F(o + 12), F(o + 20)] : [F(o + 4), F(o + 12)] };
    if (st === 8 || st === 18 || st === 28) {
      const n = I(o + 36); if (n < 0 || o + 40 + n * 16 > end) throw new Error('Corrupt multipoint record');
      const pts = []; for (let i = 0; i < n; i++) pts.push([F(o + 40 + i * 16), F(o + 48 + i * 16)]);
      if (hasZ) { const z0 = o + 40 + n * 16 + 16; if (z0 + n * 8 <= end) pts.forEach((p, i) => p.push(F(z0 + i * 8))); }
      return { type: 'MultiPoint', coordinates: pts };
    }
    if ([3, 5, 13, 15, 23, 25].includes(st)) {
      const np = I(o + 36), n = I(o + 40), p0 = o + 44 + np * 4;
      if (np < 0 || n < 0 || p0 + n * 16 > end) throw new Error('Corrupt shape record');
      const parts = []; for (let i = 0; i < np; i++) parts.push(I(o + 44 + i * 4)); parts.push(n);
      const pts = []; for (let i = 0; i < n; i++) pts.push([F(p0 + i * 16), F(p0 + 8 + i * 16)]);
      if (hasZ) { const z0 = p0 + n * 16 + 16; if (z0 + n * 8 <= end) pts.forEach((p, i) => p.push(F(z0 + i * 8))); }
      const rings = []; for (let i = 0; i < np; i++) { const r = pts.slice(Math.max(0, parts[i]), Math.min(n, parts[i + 1])); if (r.length) rings.push(r); }
      if (st === 3 || st === 13 || st === 23) return rings.length === 1 ? { type: 'LineString', coordinates: rings[0] } : { type: 'MultiLineString', coordinates: rings };
      return assemblePolygon(rings.filter(r => r.length >= 4));
    }
    return null; // MultiPatch etc.
  }
  // shapefile rings: outer clockwise, holes counter-clockwise → GeoJSON (outer CCW, holes CW)
  function assemblePolygon(rings) {
    if (!rings.length) return null;
    const outers = [], holes = [];
    rings.forEach(r => (G.ringArea(r) < 0 ? outers : holes).push(r));
    if (!outers.length) { outers.push(...holes); holes.length = 0; }
    const polys = outers.map(r => [r.slice().reverse()]);
    holes.forEach(h => {
      let best = -1, ba = Infinity;
      outers.forEach((r, i) => { const a = Math.abs(G.ringArea(r)); if (a < ba && G.pointInRing(h[0], r) || a < ba && G.pointInRing(mid(h), r)) { best = i; ba = a; } });
      if (best >= 0) polys[best].push(h.slice().reverse()); else polys.push([h]);
    });
    return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  }
  const mid = r => [(r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2];
  function readDbf(buf, encoding) {
    const b = u8(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 32) throw new Error('Corrupt .dbf');
    const nrec = dv.getUint32(4, true), hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true), ldid = b[29];
    const fields = []; let o = 32, pos = 1;
    while (o + 32 <= hlen && b[o] !== 0x0d && fields.length < 2048) {
      let nm = ''; for (let i = 0; i < 11 && b[o + i]; i++) nm += String.fromCharCode(b[o + i]);
      fields.push({ name: nm.trim(), type: String.fromCharCode(b[o + 11]), len: b[o + 16], dec: b[o + 17], pos }); pos += b[o + 16]; o += 32;
    }
    let enc = encoding && cpgToEncoding(encoding);
    if (!enc) enc = ldid === 0x57 || ldid === 0x03 ? 'windows-1252' : ldid === 0x01 ? 'ibm437' : ldid === 0x02 ? 'ibm850' : null;
    // undeclared: UTF-8 if every string decodes cleanly, else Windows-1252
    let dec = td(enc || 'utf-8', !enc);
    const rows = [], N = Math.min(nrec, Math.floor((b.length - hlen) / Math.max(1, rlen)));
    const str = (s, e) => { try { return dec.decode(b.subarray(s, e)); } catch (err) { dec = td('windows-1252'); return dec.decode(b.subarray(s, e)); } };
    for (let r = 0; r < N; r++) {
      const ro = hlen + r * rlen; if (b[ro] === 0x2a) { rows.push(null); continue; } // deleted
      const p = {};
      fields.forEach(f => {
        const raw = str(ro + f.pos, ro + f.pos + f.len).replace(/\0+$/, '').trim();
        if (f.type === 'N' || f.type === 'F') p[f.name] = raw === '' || /^\*+$/.test(raw) ? null : +raw;
        else if (f.type === 'L') p[f.name] = /^[YyTt]$/.test(raw) ? true : /^[NnFf]$/.test(raw) ? false : null;
        else if (f.type === 'D') p[f.name] = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw || null;
        else if (f.type === 'I' && f.len === 4) p[f.name] = dv.getInt32(ro + f.pos, true);
        else if (f.type === 'O' && f.len === 8) p[f.name] = dv.getFloat64(ro + f.pos, true);
        else p[f.name] = raw;
      });
      rows.push(p);
    }
    return { fields: fields.map(f => ({ name: f.name, type: 'NFIO'.includes(f.type) ? 'number' : f.type === 'L' ? 'boolean' : f.type === 'D' ? 'date' : 'string' })), rows };
  }
  function cpgToEncoding(s) {
    s = String(s).trim().toLowerCase().replace(/^ansi\s*/, '');
    if (/utf-?8/.test(s)) return 'utf-8'; if (/^(cp)?1252$|windows-1252/.test(s)) return 'windows-1252';
    if (/8859-?1$|latin-?1/.test(s)) return 'iso-8859-1'; if (/^\d{3,4}$/.test(s)) return 'windows-' + s; return s || null;
  }
  // set: {shp, dbf, prj, cpg} buffers/strings for one shapefile
  function readShapefile(set, name) {
    if (!set.shp) throw new Error(`${name}: the .shp file is missing`);
    const { geoms, type } = readShp(set.shp);
    let rows = [], fields = [];
    if (set.dbf) { const d = readDbf(set.dbf, set.cpg ? text(set.cpg) : null); rows = d.rows; fields = d.fields; }
    let def = null, warn = null;
    if (set.prj) { try { def = P.fromWkt(text(set.prj)); if (def.datumWarning) warn = `Datum “${def.datumWarning}” has no TOWGS84 shift in the .prj — treated as WGS 84 (errors of up to ~200 m are possible).`; } catch (e) { warn = 'Could not use the .prj: ' + e.message; } }
    let feats = geoms.map((g, i) => ({ geometry: g, properties: rows[i] || {} })).filter((f, i) => rows[i] !== null || !set.dbf);
    if (def && !(def.proj === 'longlat' && !def.towgs84 && !def.pm)) feats = reprojectFeatures(feats, def);
    const out = layer(name, feats, { fields, sourceCrs: def ? (def.code || def) : 'EPSG:4326', shpType: type });
    if (!def && !looksLonLat(feats)) out.needsCrs = true;
    if (warn) out.warning = warn;
    return [out];
  }
  // ---- writer ----
  function writeShapefile(L, opts = {}) {
    const def = P.get(opts.crs || 'EPSG:4326'), m = P.make(def);
    const kinds = { Point: [], MultiPoint: [], LineString: [], Polygon: [] };
    L.features.forEach(f => { const g = f.geometry; if (!g) return; const t = G.baseType(g.type); (kinds[g.type === 'MultiPoint' ? 'MultiPoint' : t] || []).push(f); });
    const out = {}, nm = (opts.name || L.name || 'layer').replace(/[^\w\-]+/g, '_');
    const groups = Object.entries(kinds).filter(([, a]) => a.length);
    groups.forEach(([k, feats]) => {
      const suffix = groups.length > 1 ? '_' + k.toLowerCase() : '';
      const proj = g => G.mapCoords(g, c => m.forward(c));
      const shpType = { Point: 1, MultiPoint: 8, LineString: 3, Polygon: 5 }[k];
      const recs = feats.map(f => shapeBytes(shpType, proj(f.geometry)));
      const bb = feats.reduce((b, f) => { const x = G.bbox(proj(f.geometry)); return [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])]; }, [Infinity, Infinity, -Infinity, -Infinity]);
      const shpLen = 100 + recs.reduce((s, r) => s + 8 + r.length, 0), shp = new Uint8Array(shpLen), shx = new Uint8Array(100 + 8 * recs.length);
      const hdr = (arr, len) => { const dv = new DataView(arr.buffer); dv.setInt32(0, 9994, false); dv.setInt32(24, len / 2, false); dv.setInt32(28, 1000, true); dv.setInt32(32, shpType, true); bb.forEach((v, i) => dv.setFloat64(36 + i * 8, isFinite(v) ? v : 0, true)); };
      hdr(shp, shpLen); hdr(shx, shx.length);
      const sdv = new DataView(shp.buffer), xdv = new DataView(shx.buffer); let o = 100;
      recs.forEach((r, i) => { xdv.setInt32(100 + i * 8, o / 2, false); xdv.setInt32(104 + i * 8, r.length / 2, false); sdv.setInt32(o, i + 1, false); sdv.setInt32(o + 4, r.length / 2, false); shp.set(r, o + 8); o += 8 + r.length; });
      out[nm + suffix + '.shp'] = shp; out[nm + suffix + '.shx'] = shx;
      out[nm + suffix + '.dbf'] = writeDbf(L.fields || inferFields(feats), feats.map(f => f.properties));
      out[nm + suffix + '.prj'] = new TextEncoder().encode(P.toWkt(def));
      out[nm + suffix + '.cpg'] = new TextEncoder().encode('UTF-8');
    });
    return out;
  }
  function shapeBytes(t, g) {
    if (t === 1) { const b = new Uint8Array(20), dv = new DataView(b.buffer); dv.setInt32(0, 1, true); dv.setFloat64(4, g.coordinates[0], true); dv.setFloat64(12, g.coordinates[1], true); return b; }
    let parts, pts;
    if (t === 8) { pts = g.type === 'Point' ? [g.coordinates] : g.coordinates; const b = new Uint8Array(40 + pts.length * 16), dv = new DataView(b.buffer); dv.setInt32(0, 8, true); box(dv, 4, pts); dv.setInt32(36, pts.length, true); pts.forEach((p, i) => { dv.setFloat64(40 + i * 16, p[0], true); dv.setFloat64(48 + i * 16, p[1], true); }); return b; }
    if (t === 3) parts = G.linesOf(g);
    else parts = G.polygonsOf(g).flatMap(rings => rings.map((r, i) => { const c = closeRing(r); return (G.ringArea(c) < 0) === (i === 0) ? c : c.slice().reverse(); })); // outer CW, holes CCW
    pts = parts.flat();
    const b = new Uint8Array(44 + parts.length * 4 + pts.length * 16), dv = new DataView(b.buffer);
    dv.setInt32(0, t, true); box(dv, 4, pts); dv.setInt32(36, parts.length, true); dv.setInt32(40, pts.length, true);
    let k = 0; parts.forEach((p, i) => { dv.setInt32(44 + i * 4, k, true); k += p.length; });
    const p0 = 44 + parts.length * 4; pts.forEach((p, i) => { dv.setFloat64(p0 + i * 16, p[0], true); dv.setFloat64(p0 + 8 + i * 16, p[1], true); });
    return b;
  }
  const closeRing = r => r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r;
  function box(dv, o, pts) { const b = G.bbox({ type: 'LineString', coordinates: pts }); b.forEach((v, i) => dv.setFloat64(o + i * 8, isFinite(v) ? v : 0, true)); }
  function writeDbf(fields, rows) {
    const enc = new TextEncoder(), used = new Set();
    const defs = fields.map(f => {
      let n = f.name.replace(/[^\w]/g, '_').slice(0, 10) || 'FIELD', k = 1; while (used.has(n.toUpperCase())) n = n.slice(0, 8) + '_' + (k++); used.add(n.toUpperCase());
      const vals = rows.map(r => r[f.name]);
      if (f.type === 'number') {
        const dec = Math.min(8, vals.reduce((m, v) => { if (typeof v !== 'number' || !isFinite(v)) return m; const s = String(v); return Math.max(m, s.includes('e') ? 8 : (s.split('.')[1] || '').length); }, 0));
        return { src: f.name, name: n, type: 'N', len: 19, dec };
      }
      if (f.type === 'boolean') return { src: f.name, name: n, type: 'L', len: 1, dec: 0 };
      const len = Math.min(254, vals.reduce((m, v) => v == null ? m : Math.max(m, enc.encode(String(v)).length), 1));
      return { src: f.name, name: n, type: 'C', len, dec: 0 };
    });
    const hlen = 32 + defs.length * 32 + 1, rlen = 1 + defs.reduce((s, d) => s + d.len, 0), b = new Uint8Array(hlen + rlen * rows.length + 1), dv = new DataView(b.buffer);
    const now = new Date(); b[0] = 3; b[1] = now.getFullYear() - 1900; b[2] = now.getMonth() + 1; b[3] = now.getDate();
    dv.setUint32(4, rows.length, true); dv.setUint16(8, hlen, true); dv.setUint16(10, rlen, true); b[29] = 0;
    defs.forEach((d, i) => { const o = 32 + i * 32; for (let k = 0; k < d.name.length; k++) b[o + k] = d.name.charCodeAt(k); b[o + 11] = d.type.charCodeAt(0); b[o + 16] = d.len; b[o + 17] = d.dec; });
    b[hlen - 1] = 0x0d;
    rows.forEach((r, ri) => {
      let o = hlen + ri * rlen; b[o++] = 0x20;
      defs.forEach(d => {
        const v = r[d.src]; let s;
        if (d.type === 'N') s = typeof v === 'number' && isFinite(v) ? v.toFixed(d.dec).padStart(d.len).slice(-d.len) : ' '.repeat(d.len);
        else if (d.type === 'L') s = v === true ? 'T' : v === false ? 'F' : '?';
        else s = v == null ? '' : String(v);
        let bytes = enc.encode(s); if (bytes.length > d.len) { bytes = bytes.subarray(0, d.len); while (bytes.length && (bytes[bytes.length - 1] & 0xc0) === 0x80) bytes = bytes.subarray(0, bytes.length - 1); if (bytes.length && bytes[bytes.length - 1] >= 0xc0) bytes = bytes.subarray(0, bytes.length - 1); }
        b.fill(0x20, o, o + d.len); b.set(bytes, o); o += d.len;
      });
    });
    b[b.length - 1] = 0x1a;
    return b;
  }

  // ---------- KML / KMZ ----------
  function parseXml(s) {
    if (/<!DOCTYPE|<!ENTITY/i.test(s)) s = s.replace(/<!DOCTYPE[^>]*(\[[\s\S]*?\])?\s*>/gi, ''); // no entity expansion from untrusted files
    const d = new DOMParser().parseFromString(s, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('The XML could not be parsed');
    return d;
  }
  const kids = (el, name) => [...el.childNodes].filter(n => n.nodeType === 1 && (n.localName === name));
  const kid = (el, name) => kids(el, name)[0];
  const desc = (el, name) => [...el.getElementsByTagNameNS('*', name)];
  const kmlCoords = s => String(s || '').trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(c => c.length >= 2 && isFinite(c[0]) && isFinite(c[1])).map(c => c.length > 2 && isFinite(c[2]) && c[2] ? [c[0], c[1], c[2]] : [c[0], c[1]]);
  function kmlGeom(el) {
    switch (el.localName) {
      case 'Point': { const c = kmlCoords(kid(el, 'coordinates')?.textContent); return c[0] ? { type: 'Point', coordinates: c[0] } : null; }
      case 'LineString': case 'LinearRing': return { type: 'LineString', coordinates: kmlCoords(kid(el, 'coordinates')?.textContent) };
      case 'Polygon': {
        const ring = b => b && kid(b, 'LinearRing') ? kmlCoords(kid(kid(b, 'LinearRing'), 'coordinates')?.textContent) : [];
        const outer = ring(kid(el, 'outerBoundaryIs')); if (outer.length < 3) return null;
        return { type: 'Polygon', coordinates: [orientRing(outer, true), ...kids(el, 'innerBoundaryIs').map(ring).filter(r => r.length >= 3).map(r => orientRing(r, false))] };
      }
      case 'Track': { const c = desc(el, 'coord').map(n => n.textContent.trim().split(/\s+/).map(Number)).filter(c => c.length >= 2); return c.length ? { type: 'LineString', coordinates: c.map(x => [x[0], x[1]]) } : null; }
      case 'MultiGeometry': case 'MultiTrack': {
        const gs = [...el.childNodes].filter(n => n.nodeType === 1).map(kmlGeom).filter(Boolean);
        return mergeGeoms(gs);
      }
    }
    return null;
  }
  function mergeGeoms(gs) {
    if (!gs.length) return null; if (gs.length === 1) return gs[0];
    const t = new Set(gs.map(g => G.baseType(g.type)));
    if (t.size === 1) { const bt = [...t][0]; if (bt === 'Point') return { type: 'MultiPoint', coordinates: gs.flatMap(G.pointsOf) }; if (bt === 'LineString') return { type: 'MultiLineString', coordinates: gs.flatMap(G.linesOf) }; if (bt === 'Polygon') return { type: 'MultiPolygon', coordinates: gs.flatMap(G.polygonsOf) }; }
    return { type: 'GeometryCollection', geometries: gs };
  }
  const orientRing = (r, ccw) => (G.ringArea(r) > 0) === ccw ? r : r.slice().reverse();
  function readKML(data, name) {
    let s = data;
    if (typeof s !== 'string') { const b = u8(s); if (b[0] === 0x50 && b[1] === 0x4b) { const z = fflate().unzipSync(b); const k = Object.keys(z).find(n => /\.kml$/i.test(n)); if (!k) throw new Error('No .kml inside the KMZ'); s = text(z[k]); } else s = text(b); }
    const d = parseXml(s), feats = [];
    desc(d, 'Placemark').forEach(pm => {
      const geomEl = [...pm.childNodes].find(n => n.nodeType === 1 && /^(Point|LineString|LinearRing|Polygon|MultiGeometry|Track|MultiTrack)$/.test(n.localName));
      const props = {}; const nm = kid(pm, 'name'); if (nm) props.name = nm.textContent.trim();
      const ds = kid(pm, 'description'); if (ds) props.description = ds.textContent.trim().slice(0, 5000);
      desc(pm, 'Data').forEach(dn => { const v = kid(dn, 'value'); if (dn.getAttribute('name')) props[dn.getAttribute('name')] = typed(v ? v.textContent : ''); });
      desc(pm, 'SimpleData').forEach(dn => { if (dn.getAttribute('name')) props[dn.getAttribute('name')] = typed(dn.textContent); });
      const folder = pm.parentNode && pm.parentNode.localName === 'Folder' && kid(pm.parentNode, 'name'); if (folder) props.folder = folder.textContent.trim();
      feats.push({ geometry: geomEl ? kmlGeom(geomEl) : null, properties: props });
    });
    return splitByType(name, feats.filter(f => f.geometry), 'EPSG:4326');
  }
  const typed = s => { s = String(s).trim(); return s !== '' && /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? +s : s; };
  // layers hold one geometry family; mixed sources are split into Points / Lines / Polygons
  function splitByType(name, feats, crs) {
    const groups = {}; feats.forEach(f => { const t = f.geometry.type === 'GeometryCollection' ? 'Mixed' : G.baseType(f.geometry.type); (groups[t] = groups[t] || []).push(f); });
    const keys = Object.keys(groups); const label = { Point: 'points', LineString: 'lines', Polygon: 'polygons', Mixed: 'mixed' };
    if (!keys.length) return [layer(name, [], { sourceCrs: crs })];
    return keys.map(k => layer(keys.length > 1 ? `${name} (${label[k]})` : name, groups[k], { sourceCrs: crs }));
  }
  function writeKML(L) {
    const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cs = c => c.map(p => p[0] + ',' + p[1]).join(' ');
    const geom = g => {
      switch (g.type) {
        case 'Point': return `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]}</coordinates></Point>`;
        case 'LineString': return `<LineString><coordinates>${cs(g.coordinates)}</coordinates></LineString>`;
        case 'Polygon': return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${cs(closeRing(g.coordinates[0]))}</coordinates></LinearRing></outerBoundaryIs>${g.coordinates.slice(1).map(r => `<innerBoundaryIs><LinearRing><coordinates>${cs(closeRing(r))}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`;
        case 'MultiPoint': return `<MultiGeometry>${g.coordinates.map(c => geom({ type: 'Point', coordinates: c })).join('')}</MultiGeometry>`;
        case 'MultiLineString': return `<MultiGeometry>${g.coordinates.map(c => geom({ type: 'LineString', coordinates: c })).join('')}</MultiGeometry>`;
        case 'MultiPolygon': return `<MultiGeometry>${g.coordinates.map(c => geom({ type: 'Polygon', coordinates: c })).join('')}</MultiGeometry>`;
        case 'GeometryCollection': return `<MultiGeometry>${g.geometries.map(geom).join('')}</MultiGeometry>`;
      }
      return '';
    };
    const nameField = (L.fields || []).find(f => /^name$/i.test(f.name)) || (L.fields || []).find(f => f.type === 'string');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(L.name)}</name>\n` +
      L.features.filter(f => f.geometry).map(f => `<Placemark>${nameField && f.properties[nameField.name] != null ? `<name>${x(f.properties[nameField.name])}</name>` : ''}<ExtendedData>${Object.entries(f.properties).map(([k, v]) => `<Data name="${x(k).replace(/"/g, '&quot;')}"><value>${x(v ?? '')}</value></Data>`).join('')}</ExtendedData>${geom(f.geometry)}</Placemark>`).join('\n') +
      '\n</Document></kml>\n';
  }

  // ---------- GPX ----------
  function readGPX(data, name) {
    const d = parseXml(text(data)), out = [];
    const pt = el => { const c = [+el.getAttribute('lon'), +el.getAttribute('lat')]; return isFinite(c[0]) && isFinite(c[1]) ? c : null; };
    const props = el => { const p = {}; ['name', 'desc', 'type', 'cmt', 'sym', 'ele', 'time'].forEach(k => { const n = kid(el, k); if (n) p[k] = typed(n.textContent); }); return p; };
    const wpts = desc(d, 'wpt').map(w => ({ geometry: pt(w) && { type: 'Point', coordinates: pt(w) }, properties: props(w) })).filter(f => f.geometry);
    const trks = desc(d, 'trk').map(t => { const segs = kids(t, 'trkseg').map(s => kids(s, 'trkpt').map(pt).filter(Boolean)).filter(s => s.length > 1); const p = props(t); return { geometry: segs.length === 1 ? { type: 'LineString', coordinates: segs[0] } : segs.length ? { type: 'MultiLineString', coordinates: segs } : null, properties: p }; }).filter(f => f.geometry);
    const rtes = desc(d, 'rte').map(r => { const c = kids(r, 'rtept').map(pt).filter(Boolean); return { geometry: c.length > 1 ? { type: 'LineString', coordinates: c } : null, properties: props(r) }; }).filter(f => f.geometry);
    if (wpts.length) out.push(layer(name + ' waypoints', wpts, { sourceCrs: 'EPSG:4326' }));
    if (trks.length) out.push(layer(name + ' tracks', trks, { sourceCrs: 'EPSG:4326' }));
    if (rtes.length) out.push(layer(name + ' routes', rtes, { sourceCrs: 'EPSG:4326' }));
    if (!out.length) throw new Error('No waypoints, tracks or routes in the GPX file');
    return out;
  }

  // ---------- CSV ----------
  function parseCSV(s, delim) {
    s = text(s);
    if (!delim) { const head = s.slice(0, 5000).split(/\r?\n/)[0]; const c = (re) => (head.match(re) || []).length; delim = c(/\t/g) > c(/,/g) && c(/\t/g) >= c(/;/g) ? '\t' : c(/;/g) > c(/,/g) ? ';' : ','; }
    const rows = []; let row = [], f = '', q = false, i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; } f += ch; i++; continue; }
      if (ch === '"' && f === '') { q = true; i++; continue; }
      if (ch === delim) { row.push(f); f = ''; i++; continue; }
      if (ch === '\n' || ch === '\r') { row.push(f); f = ''; rows.push(row); row = []; if (ch === '\r' && s[i + 1] === '\n') i++; i++; continue; }
      f += ch; i++;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    const out = rows.filter(r => r.length > 1 || r[0] !== ''); out.delim = delim; return out;
  }
  const LAT = /^(lat|latitude|lat_?dd|y|ycoord|y_coord|point_y|decimallatitude)$/i, LON = /^(lon|lng|long|longitude|lon_?dd|x|xcoord|x_coord|point_x|decimallongitude)$/i, WKTC = /^(wkt|geom|geometry|the_geom|shape|wkt_geom)$/i;
  function csvColumns(header) { return { lat: header.findIndex(h => LAT.test(h.trim())), lon: header.findIndex(h => LON.test(h.trim())), wkt: header.findIndex(h => WKTC.test(h.trim())) }; }
  // opts: {lat, lon, wkt (column indices), crs}
  function readCSV(data, name, opts = {}) {
    const rows = parseCSV(data, opts.delim); if (!rows.length) throw new Error('The CSV file is empty');
    const header = rows[0].map((h, i) => h.trim() || 'field' + (i + 1)), auto = csvColumns(header);
    const c = { lat: opts.lat ?? auto.lat, lon: opts.lon ?? auto.lon, wkt: opts.wkt ?? auto.wkt };
    if (c.wkt < 0 && (c.lat < 0 || c.lon < 0)) { const e = new Error('No latitude/longitude or WKT columns found'); e.needsColumns = true; e.header = header; throw e; }
    const num = v => { v = String(v).trim().replace(/\s/g, ''); if (/^-?\d+,\d+$/.test(v)) v = v.replace(',', '.'); return v === '' ? NaN : +v; };
    const comma = rows.delim !== ','; // decimal commas are only possible with ; or tab
    const isNum = v => /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v) || (comma && /^-?\d+,\d+$/.test(v));
    const types = header.map((h, i) => { if (i === c.lat || i === c.lon || i === c.wkt) return null; const vals = rows.slice(1).map(r => (r[i] ?? '').trim()).filter(v => v !== ''); return vals.length && vals.every(isNum) ? 'number' : 'string'; });
    const feats = rows.slice(1).map(r => {
      const p = {}; header.forEach((h, i) => { if (types[i]) { const v = (r[i] ?? '').trim(); p[h] = types[i] === 'number' ? (v === '' ? null : +v.replace(',', '.')) : v; } });
      let g = null;
      if (c.wkt >= 0 && r[c.wkt]) { try { g = parseWKT(r[c.wkt]); } catch (e) { g = null; } }
      else { const x = num(r[c.lon]), y = num(r[c.lat]); if (isFinite(x) && isFinite(y)) g = { type: 'Point', coordinates: [x, y] }; }
      return { geometry: g, properties: p };
    });
    const def = opts.crs ? P.get(opts.crs) : null;
    const fields = header.map((h, i) => types[i] && { name: h, type: types[i] }).filter(Boolean);
    const out = layer(name, def ? reprojectFeatures(feats, def) : feats, { fields, sourceCrs: def ? def.code : 'EPSG:4326' });
    const skipped = feats.filter(f => !f.geometry).length; if (skipped) out.warning = `${skipped} row${skipped > 1 ? 's' : ''} had no usable coordinates and ${skipped > 1 ? 'were' : 'was'} kept without geometry.`;
    if (!def && !looksLonLat(feats.filter(f => f.geometry))) out.needsCrs = true;
    return [out];
  }
  function writeCSV(L, opts = {}) {
    const def = P.get(opts.crs || 'EPSG:4326'), m = P.make(def), q = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const fields = (L.fields || inferFields(L.features)).map(f => f.name);
    const pointsOnly = L.features.every(f => !f.geometry || f.geometry.type === 'Point'), geo = def.proj === 'longlat';
    const head = pointsOnly ? [geo ? 'longitude' : 'x', geo ? 'latitude' : 'y'] : ['wkt'];
    const lines = [[...head, ...fields].map(q).join(',')];
    L.features.forEach(f => {
      const g = f.geometry && G.mapCoords(f.geometry, c => m.forward(c));
      const gc = pointsOnly ? (g ? [g.coordinates[0], g.coordinates[1]] : ['', '']) : [g ? toWKT(g) : ''];
      lines.push([...gc, ...fields.map(k => f.properties[k])].map(q).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  // ---------- WKT geometry ----------
  function parseWKT(s) {
    s = String(s).trim(); let i = 0;
    const ws = () => { while (/\s/.test(s[i])) i++; };
    const word = () => { ws(); const m = /^[A-Za-z]+/.exec(s.slice(i)); if (!m) return ''; i += m[0].length; return m[0].toUpperCase(); };
    const expect = c => { ws(); if (s[i] !== c) throw new Error('WKT: expected ' + c); i++; };
    const peek = () => { ws(); return s[i]; };
    const coord = () => { ws(); const m = /^([-+\d.eE]+)\s+([-+\d.eE]+)(\s+[-+\d.eE]+)?(\s+[-+\d.eE]+)?/.exec(s.slice(i)); if (!m) throw new Error('WKT: bad coordinate'); i += m[0].length; return [+m[1], +m[2]]; };
    const list = f => { expect('('); const out = [f()]; while (peek() === ',') { i++; out.push(f()); } expect(')'); return out; };
    const ptlist = () => list(() => { if (peek() === '(') { i++; const c = coord(); expect(')'); return c; } return coord(); });
    function geom() {
      let t = word(); const z = word(); if (z && !/^(Z|M|ZM)$/.test(z)) { i -= z.length; }
      if (peek() !== '(') { const e = word(); if (e === 'EMPTY') return null; throw new Error('WKT: ( expected'); }
      switch (t) {
        case 'POINT': { expect('('); const c = coord(); expect(')'); return { type: 'Point', coordinates: c }; }
        case 'MULTIPOINT': return { type: 'MultiPoint', coordinates: ptlist() };
        case 'LINESTRING': return { type: 'LineString', coordinates: ptlist() };
        case 'MULTILINESTRING': return { type: 'MultiLineString', coordinates: list(ptlist) };
        case 'POLYGON': return { type: 'Polygon', coordinates: list(ptlist) };
        case 'MULTIPOLYGON': return { type: 'MultiPolygon', coordinates: list(() => list(ptlist)) };
        case 'GEOMETRYCOLLECTION': return { type: 'GeometryCollection', geometries: list(geom).filter(Boolean) };
      }
      throw new Error('WKT: unknown geometry ' + t);
    }
    const g = geom(); if (g) { ws(); if (i < s.length) throw new Error('WKT: trailing text'); } return g;
  }
  function toWKT(g) {
    const c = p => +p[0].toFixed(9) + ' ' + +p[1].toFixed(9), l = a => '(' + a.map(c).join(', ') + ')', ll = a => '(' + a.map(l).join(', ') + ')';
    switch (g.type) {
      case 'Point': return `POINT (${c(g.coordinates)})`;
      case 'MultiPoint': return `MULTIPOINT ${ll(g.coordinates.map(p => [p]))}`;
      case 'LineString': return `LINESTRING ${l(g.coordinates)}`;
      case 'MultiLineString': return `MULTILINESTRING ${ll(g.coordinates)}`;
      case 'Polygon': return `POLYGON ${ll(g.coordinates.map(closeRing))}`;
      case 'MultiPolygon': return `MULTIPOLYGON (${g.coordinates.map(p => ll(p.map(closeRing))).join(', ')})`;
      case 'GeometryCollection': return `GEOMETRYCOLLECTION (${g.geometries.map(toWKT).join(', ')})`;
    }
    return '';
  }

  // ---------- dispatcher: [{name, data}] -> [{layer, ...}] ----------
  const VECTOR_EXT = ['geojson', 'json', 'shp', 'dbf', 'prj', 'cpg', 'shx', 'zip', 'kml', 'kmz', 'gpx', 'csv', 'tsv', 'txt'];
  function readFiles(files) {
    const layers = [], errors = [], shp = {};
    const take = (fn, nm) => { try { layers.push(...fn()); } catch (e) { errors.push(`${nm}: ${e.message}`); } };
    const handleOne = (name, data) => {
      const e = ext(name), b = base(name);
      if (['shp', 'dbf', 'prj', 'cpg', 'shx'].includes(e)) { const k = b.toLowerCase(); (shp[k] = shp[k] || { name: b })[e] = data; return; }
      if (e === 'geojson' || e === 'json') return take(() => readGeoJSON(data, b), name);
      if (e === 'kml' || e === 'kmz') return take(() => readKML(data, b), name);
      if (e === 'gpx') return take(() => readGPX(data, b), name);
      if (e === 'csv' || e === 'tsv' || e === 'txt') return take(() => readCSV(data, b, { delim: e === 'tsv' ? '\t' : undefined }), name);
      if (e === 'zip') { let z; try { z = fflate().unzipSync(u8(data), { filter: f => f.originalSize < 512 * 1024 * 1024 }); } catch (err) { errors.push(name + ': not a readable zip'); return; } Object.entries(z).forEach(([n, d]) => { if (!/(^|\/)(__MACOSX|\.)/.test(n) && VECTOR_EXT.includes(ext(n)) && ext(n) !== 'zip') handleOne(n, d); }); return; }
      errors.push(`${name}: unsupported file type`);
    };
    files.forEach(f => handleOne(f.name, f.data));
    Object.values(shp).forEach(s => { if (!s.shp) { if (s.dbf && !s.shp) errors.push(`${s.name}: the .shp file is missing (drop .shp, .dbf and .prj together, or a .zip)`); return; } take(() => readShapefile(s, s.name), s.name + '.shp'); });
    return { layers, errors };
  }
  function zip(files) { return fflate().zipSync(files, { level: 6 }); }

  const api = { readFiles, readGeoJSON, writeGeoJSON, readShp, readDbf, readShapefile, writeShapefile, writeDbf, readKML, writeKML, readGPX, parseCSV, readCSV, writeCSV, csvColumns, parseWKT, toWKT, inferFields, reprojectFeatures, assemblePolygon, zip, ext, base };
  if (isNode) module.exports = api; else root.MapIO = api;
})(typeof self !== 'undefined' ? self : this);
