'use strict';
/* Lumen Layout — document engine: item index, page/master resolution, text-wrap exclusions and
   cached story layout. Re-created (cheaply) whenever the document changes. */
(function () {
  function bbox(it) {
    if (it.type === 'group') { return groupBox(it); }
    const r = (it.rot || 0) * Math.PI / 180;
    if (!r) return { x: it.x, y: it.y, w: it.w, h: it.h };
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, c = Math.cos(r), s = Math.sin(r);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of [[-it.w / 2, -it.h / 2], [it.w / 2, -it.h / 2], [it.w / 2, it.h / 2], [-it.w / 2, it.h / 2]]) {
      const X = cx + px * c - py * s, Y = cy + px * s + py * c;
      x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function groupBox(g) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of g.children) { const b = bbox(c); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    if (!isFinite(x0)) return { x: g.x || 0, y: g.y || 0, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function syncGroup(g) { const b = groupBox(g); g.x = b.x; g.y = b.y; g.w = b.w; g.h = b.h; g.rot = 0; }

  /* ---------- text wrap shapes ---------- */
  function toPageXY(it, lx, ly) {
    const r = (it.rot || 0) * Math.PI / 180; if (!r) return [it.x + lx, it.y + ly];
    const c = Math.cos(r), s = Math.sin(r), cx = it.x + it.w / 2, cy = it.y + it.h / 2, dx = lx - it.w / 2, dy = ly - it.h / 2;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  }
  function ellipsePts(it, n = 48) { const out = []; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; out.push(toPageXY(it, it.w / 2 + Math.cos(a) * it.w / 2, it.h / 2 + Math.sin(a) * it.h / 2)); } return out; }
  // per-row opaque extent of an image (alpha channel, or non-white pixels for images without alpha)
  function alphaProfile(im) {
    if (im._prof !== undefined) return im._prof;
    const el = im.el; if (!el || !el.complete || !el.naturalWidth) return null;
    let prof = null;
    try {
      const ph = Math.max(8, Math.min(240, Math.round(el.naturalHeight || 240))), pw = Math.max(8, Math.min(480, Math.round(ph * (im.w / im.h))));
      const c = document.createElement('canvas'); c.width = pw; c.height = ph;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(el, 0, 0, pw, ph);
      const d = ctx.getImageData(0, 0, pw, ph).data;
      let alpha = false; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { alpha = true; break; }
      const solid = i => alpha ? d[i + 3] > 127 : (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) < 238;
      const rows = [];
      for (let y = 0; y < ph; y++) { let x0 = -1, x1 = -1; for (let x = 0; x < pw; x++) if (solid((y * pw + x) * 4)) { if (x0 < 0) x0 = x; x1 = x + 1; } if (x0 >= 0) rows.push([y, x0, x1]); }
      prof = rows.length ? { pw, ph, rows, alpha } : null;
    } catch (e) { prof = null; }
    im._prof = prof; return prof;
  }
  function contourPts(it, images) {
    if (it.type !== 'image' || !it.img || !images) return null;
    const im = images[it.img]; if (!im) return null;
    const pr = alphaProfile(im); if (!pr) return null;
    const sx = im.w * it.cs / pr.pw, sy = im.h * it.cs / pr.ph, left = [], right = [];
    for (const [y, x0, x1] of pr.rows) {
      for (const yy of [y, y + 1]) {
        const ly = it.cy + yy * sy; if (ly < 0 || ly > it.h) continue;
        const a = Math.max(0, Math.min(it.w, it.cx + x0 * sx)), b = Math.max(0, Math.min(it.w, it.cx + x1 * sx));
        if (b - a < 0.01) continue;
        left.push(toPageXY(it, a, ly)); right.push(toPageXY(it, b, ly));
      }
    }
    return left.length ? [...left, ...right.reverse()] : null;
  }
  function wrapShape(it, images) {
    const o = Math.max(0, +it.wrapOff || 0), b = bbox(it);
    const box = { x0: b.x - o, y0: b.y - o, x1: b.x + b.w + o, y1: b.y + b.h + o, off: o };
    if (it.wrap === 'jump') return { ...box, jump: true };
    if (it.wrap !== 'shape' && it.wrap !== 'contour') return box;
    let poly = null;
    if (it.wrap === 'contour') poly = contourPts(it, images);
    if (!poly && it.type === 'ellipse') poly = ellipsePts(it);
    if (!poly && it.rot) poly = [[0, 0], [it.w, 0], [it.w, it.h], [0, it.h]].map(([x, y]) => toPageXY(it, x, y));
    if (!poly) return box;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0: x0 - o, y0: y0 - o, x1: x1 + o, y1: y1 + o, off: o, poly };
  }

  class Engine {
    // prev/hint: while typing, stories other than hint.sid are reused from the previous engine and the
    // edited story is composed only up to hint.upto frames (the rest follows in a deferred full pass).
    constructor(doc, prev, hint) {
      if (prev && !prev.lay) prev.ensure();
      this.doc = doc; this.prev = prev || null; this.hint = hint || null; this.partial = false; this.idx = new Map(); this.pageOf = new Map(); this.lay = null; this.mlay = new Map();
      doc.pages.forEach((p, i) => { this.pageOf.set(p.id, { page: p, kind: 'doc', index: i }); M.walkItems(p.items, (it, parent) => this.idx.set(it.id, { item: it, page: p, parent, kind: 'doc', index: i })); });
      doc.masters.forEach(m => m.pages.forEach((p, side) => { this.pageOf.set(p.id, { page: p, kind: 'master', master: m, side }); M.walkItems(p.items, (it, parent) => this.idx.set(it.id, { item: it, page: p, parent, kind: 'master', master: m, side })); }));
      this.layerOrder = new Map(doc.layers.map((l, i) => [l.id, doc.layers.length - 1 - i]));
      this.layerById = new Map(doc.layers.map(l => [l.id, l]));
      // inline objects (tables / graphics anchored in stories)
      this.objIdx = new Map();
      for (const s of Object.values(doc.stories)) for (const [id, o] of Object.entries(s.objs || {})) this.objIdx.set(id, { sid: s.id, obj: o });
    }
    label(i) { if (!this.labels) this.labels = M.pageLabels(this.doc); return this.labels[i] ?? String(i + 1); }
    side(i) { return this.doc.facing ? (i % 2 === 0 ? 1 : 0) : 0; }   // 0 = left page, 1 = right page
    masterOf(page) { return this.doc.masters.find(m => m.id === page.master) || null; }
    masterPage(page, i) { const m = this.masterOf(page); if (!m) return null; return m.pages[Math.min(m.pages.length - 1, this.doc.facing ? this.side(i) : 0)]; }
    // margins for a page: inside/outside resolved to left/right
    marginsFor(kind, idxOrSide) {
      const m = this.doc.margins;
      const left = !this.doc.facing ? true : kind === 'doc' ? this.side(idxOrSide) === 0 : idxOrSide === 0;
      if (!this.doc.facing) return { t: m.t, b: m.b, l: m.i, r: m.o };
      return left ? { t: m.t, b: m.b, l: m.o, r: m.i } : { t: m.t, b: m.b, l: m.i, r: m.o };
    }
    layerVisible(it) { const l = this.layerById.get(it.layer); return !l || l.visible !== false; }
    sortedItems(items) { return items.map((it, i) => [it, i]).sort((a, b) => ((this.layerOrder.get(a[0].layer) ?? 0) - (this.layerOrder.get(b[0].layer) ?? 0)) || a[1] - b[1]).map(x => x[0]); }
    // wrap exclusions (page coords) for a frame on the given page
    exclusions(page, masterPage, selfId, overrides) {
      const out = [];
      const add = (items, skip) => M.walkItems(items, it => {
        if (it.id === selfId || it.type === 'group' || !it.wrap || it.wrap === 'none' || !this.layerVisible(it) || it.hidden) return;
        if (skip && skip.includes(it.id)) return;
        const e = wrapShape(it, Engine.images); if (e) out.push(e);
      });
      if (masterPage) add(masterPage.items, overrides);
      if (page) add(page.items);
      return out;
    }
    // footnote numbering offset: continuous through the document (stories in page order) or per story
    fnBase(sid) {
      const o = this.doc.footnotes || {}, start = Math.max(1, o.start | 0 || 1) - 1;
      if (!o.continuous) return start;
      if (!this._fnBase) {
        this._fnBase = new Map(); const order = [];
        for (const s of Object.values(this.doc.stories)) {
          const f = this.storyFrames(s)[0]; if (!f || f.kind !== 'doc') continue;
          let cnt = 0; for (let k = 0; k < s.text.length; k++) if (s.text.charCodeAt(k) === 0xE001 && s.notes?.[s.attrs[s.ca[k]]?.fn]) cnt++;
          order.push({ id: s.id, key: [f.index, Math.round(f.item.y), f.item.x], cnt });
        }
        order.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
        let n = start; for (const x of order) { this._fnBase.set(x.id, n); n += x.cnt; }
      }
      return this._fnBase.get(sid) ?? start;
    }
    storyFrames(story) { return story.frames.map(id => this.idx.get(id)).filter(x => x && x.item.type === 'text'); }
    ensure() {
      if (this.lay) return;
      this.lay = new Map(); this.storyRes = new Map();
      const d = this.doc;
      const P = this.prev, H = this.hint;
      if (P && !P.lay) P.ensure();
      for (const s of Object.values(d.stories)) {
        const fr = this.storyFrames(s);
        if (!fr.length || fr[0].kind === 'master') continue;
        if (H && P && s.id !== H.sid && P.storyRes.has(s.id)) {
          const res = P.storyRes.get(s.id); this.storyRes.set(s.id, res);
          fr.forEach(f => { const e = P.lay.get(f.item.id); if (e) this.lay.set(f.item.id, e); });
          continue;
        }
        const cut = H && P && s.id === H.sid && H.upto < fr.length ? H.upto : fr.length;
        const infos = fr.slice(0, cut).map(f => {
          const mp = f.kind === 'doc' ? this.masterPage(f.page, f.index) : null;
          return { item: f.item, label: f.kind === 'doc' ? this.label(f.index) : '', excl: f.kind === 'doc' ? this.exclusions(f.page, mp, f.item.id, f.page.overrides) : [], grid: d.grid };
        });
        const res = Layout.layoutStory(d, s, infos, { fnBase: this.fnBase(s.id) });
        if (cut < fr.length) {
          this.partial = true;
          const old = P.storyRes.get(s.id); res.overset = old ? old.overset : res.overset;
          fr.forEach((f, k) => { if (k < cut) this.lay.set(f.item.id, { ...res.frames[k], story: s, index: k, last: k === fr.length - 1, overset: res.overset, res }); else { const e = P.lay.get(f.item.id); if (e) this.lay.set(f.item.id, { ...e, story: s, overset: res.overset }); } });
          this.storyRes.set(s.id, res); continue;
        }
        this.storyRes.set(s.id, res);
        fr.forEach((f, k) => this.lay.set(f.item.id, { ...res.frames[k], story: s, index: k, last: k === fr.length - 1, overset: res.overset, res }));
      }
      this.prev = null;
    }
    // Layout for a frame; label is needed for master frames rendered on a document page
    frameLayout(it, label) {
      const info = this.idx.get(it.id);
      if (info && info.kind === 'master') {
        const key = it.id + '|' + label;
        let r = this.mlay.get(key); if (r) return r;
        const s = this.doc.stories[it.story]; if (!s) return null;
        const fr = this.storyFrames(s);
        const res = Layout.layoutStory(this.doc, s, fr.map(f => ({ item: f.item, label, excl: this.exclusions(f.page, null, f.item.id), grid: this.doc.grid })));
        fr.forEach((f, k) => this.mlay.set(f.item.id + '|' + label, { ...res.frames[k], story: s, index: k, last: k === fr.length - 1, overset: res.overset, res }));
        return this.mlay.get(key);
      }
      this.ensure();
      return this.lay.get(it.id) || null;
    }
  }

  Engine.images = null;
  window.Engine = Engine; window.Geo = { bbox, groupBox, syncGroup, wrapShape, contourPts, alphaProfile, toPageXY };
})();
