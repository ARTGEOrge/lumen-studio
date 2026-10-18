'use strict';
/* Lumen Slides — PowerPoint (.pptx / .potx / .thmx) reader → Lumen Slides document. Pure JS (fflate + XML + Model).
   PPTXReader.read(u8) → {doc, assets, warnings}. Treats the file as untrusted data: nothing in it is executed,
   images are only accepted as raster/SVG data URLs, and the result is passed through Model.sanitize. */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Model = isNode ? require('./model.js') : root.Model;
  const X = isNode ? require('./xml.js') : root.XML;
  const getFflate = () => isNode ? require('../vendor/fflate.js') : root.fflate;
  const EMU = 9525, px = v => (+v || 0) / EMU;
  const { kid, kids, path: xpath, attr, num, text: xtext, all } = X;
  const PRST_CLR = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', darkGray: '#a9a9a9', lightGray: '#d3d3d3', navy: '#000080', purple: '#800080' };
  const CLR_TAGS = ['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr', 'a:scrgbClr', 'a:hslClr'];

  function read(u8, opts = {}) {
    const { unzipSync, strFromU8 } = getFflate();
    let files;
    try { files = unzipSync(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8)); } catch (e) { throw new Error('Not a valid PowerPoint file (zip could not be read)'); }
    const warnings = new Set();
    const lc = new Map(Object.keys(files).map(k => [k.toLowerCase(), k]));
    const getBytes = p => { const k = lc.get(String(p).replace(/^\//, '').toLowerCase()); return k ? files[k] : null; };
    const xmlCache = new Map();
    const xml = p => { if (!p) return null; if (xmlCache.has(p)) return xmlCache.get(p); const b = getBytes(p); let r = null; if (b) { try { r = X.parse(strFromU8(b)); } catch (e) { warnings.add('Damaged part skipped: ' + p); } } xmlCache.set(p, r); return r; };
    const resolve = (base, t) => {
      if (/^[a-z]+:/i.test(t)) return null;
      const parts = (t[0] === '/' ? t.slice(1) : base.slice(0, base.lastIndexOf('/') + 1) + t).split('/'); const out = [];
      for (const s of parts) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(decodeURIComponent(s)); }
      return out.join('/');
    };
    const relsCache = new Map();
    function rels(p) {
      if (relsCache.has(p)) return relsCache.get(p);
      const dir = p.slice(0, p.lastIndexOf('/') + 1), name = p.slice(p.lastIndexOf('/') + 1);
      const r = xml(dir + '_rels/' + name + '.rels'), m = {};
      for (const e of kids(r, 'Relationship')) { const ext = attr(e, 'TargetMode') === 'External'; m[attr(e, 'Id')] = { type: String(attr(e, 'Type', '')).split('/').pop(), target: ext ? null : resolve(p, attr(e, 'Target', '')) }; }
      relsCache.set(p, m); return m;
    }
    const relOfType = (p, type) => Object.values(rels(p)).find(r => r.type === type);
    // main part
    const rootRel = relOfType('', 'officeDocument') || (() => { const r = xml('_rels/.rels'); const e = kids(r, 'Relationship').find(x => /officeDocument$/.test(attr(x, 'Type', ''))); return e ? { target: resolve('', attr(e, 'Target')) } : null; })();
    let presPath = rootRel && rootRel.target || 'ppt/presentation.xml';
    if (!/presentation$/.test((xml(presPath) || {}).n || '')) { // .thmx: officeDocument → themeManager → presentation
      const r2 = relOfType(presPath, 'officeDocument'); if (r2 && r2.target) presPath = r2.target;
      else { const k = Object.keys(files).find(p => /(^|\/)presentation\.xml$/i.test(p)); if (k) presPath = k; }
    }
    const pres = xml(presPath); if (!pres || !/presentation$/.test(pres.n)) throw new Error('Not a PowerPoint presentation');
    const pRels = rels(presPath);
    const sz = kid(pres, 'p:sldSz');
    const W = Math.round(px(num(sz, 'cx', 12192000)) * 100) / 100, H = Math.round(px(num(sz, 'cy', 6858000)) * 100) / 100;
    // masters
    const masterIds = kids(kid(pres, 'p:sldMasterIdLst'), 'p:sldMasterId').map(e => pRels[attr(e, 'r:id')]).filter(Boolean).map(r => r.target);
    if (!masterIds.length) { const r = Object.values(pRels).find(r => r.type === 'slideMaster'); if (r) masterIds.push(r.target); }
    const masterPath = masterIds[0];
    if (masterIds.length > 1) warnings.add('Only the first slide master is kept; other masters were merged');
    const master = xml(masterPath);
    if (!master) throw new Error('The presentation has no slide master');
    const themeRel = relOfType(masterPath, 'theme') || Object.values(pRels).find(r => r.type === 'theme');
    const themeX = themeRel && xml(themeRel.target);
    const theme = parseTheme(themeX);
    const clrMap = kid(master, 'p:clrMap');
    if (clrMap) { theme.map = {}; for (const k of ['tx1', 'bg1', 'tx2', 'bg2']) { const v = attr(clrMap, k); if (v && v !== { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }[k]) theme.map[k] = v; } }

    /* ---- media ---- */
    const assets = {}; const mediaIds = new Map(); let mediaN = 0;
    const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };
    function media(partPath, rid) {
      const r = rels(partPath)[rid]; if (!r || !r.target) return null;
      if (mediaIds.has(r.target)) return mediaIds.get(r.target);
      const ext = r.target.split('.').pop().toLowerCase(), mime = MIME[ext];
      const b = getBytes(r.target);
      if (!b || !mime) { warnings.add(`Unsupported image format skipped (${ext})`); mediaIds.set(r.target, null); return null; }
      const id = 'img' + (++mediaN);
      assets[id] = { mime, data: `data:${mime};base64,` + b64(b), w: 0, h: 0, name: r.target.split('/').pop() };
      mediaIds.set(r.target, id); return id;
    }

    /* ---- colours / fills ---- */
    function readClr(e, cx) {
      if (!e) return null;
      let base = null, scheme = null;
      switch (e.n) {
        case 'a:srgbClr': base = '#' + String(attr(e, 'val', '000000')).toLowerCase(); break;
        case 'a:schemeClr': { const v = attr(e, 'val', 'tx1'); if (v === 'phClr') { const pc = cx && cx.phClr || 'accent1'; if (pc[0] === '#') base = pc; else scheme = pc; } else scheme = v; break; }
        case 'a:sysClr': base = '#' + String(attr(e, 'lastClr', attr(e, 'val') === 'window' ? 'FFFFFF' : '000000')).toLowerCase(); break;
        case 'a:prstClr': base = PRST_CLR[attr(e, 'val')] || '#000000'; break;
        case 'a:scrgbClr': base = Model.rgb2hex(num(e, 'r', 0) / 100000 * 255, num(e, 'g', 0) / 100000 * 255, num(e, 'b', 0) / 100000 * 255); break;
        case 'a:hslClr': base = Model.rgb2hex(...Model.hsl2rgb(num(e, 'hue', 0) / 21600000, num(e, 'sat', 0) / 100000, num(e, 'lum', 0) / 100000)); break;
        default: return null;
      }
      let alpha, mod = 1, off = 0, other = [];
      for (const m of kids(e)) {
        const v = num(m, 'val', 100000) / 100000;
        if (m.n === 'a:alpha') alpha = v; else if (m.n === 'a:lumMod') mod = v; else if (m.n === 'a:lumOff') off = v; else if (m.n === 'a:tint' || m.n === 'a:shade') other.push([m.n, v]);
      }
      if (scheme && scheme.indexOf(':') > 0) { base = Model.color(scheme, theme); scheme = null; }
      if (scheme && !other.length) {
        if (off > 0 && Math.abs(mod + off - 1) < 0.02) return { c: `${scheme}:+${Math.round(off * 100)}`, alpha };
        if (off === 0 && mod < 1) return { c: `${scheme}:-${Math.round((1 - mod) * 100)}`, alpha };
        if (off === 0 && mod === 1) return { c: scheme, alpha };
      }
      let hex = base || Model.color(scheme, theme);
      if (mod !== 1 || off) hex = Model.lum(hex, mod, off);
      for (const [n, v] of other) { const [r, g, b] = Model.hex2rgb(hex); hex = n === 'a:tint' ? Model.rgb2hex(r * v + 255 * (1 - v), g * v + 255 * (1 - v), b * v + 255 * (1 - v)) : Model.rgb2hex(r * v, g * v, b * v); }
      return { c: hex, alpha };
    }
    const clrIn = (parent, cx) => { if (!parent) return null; for (const t of CLR_TAGS) { const e = kid(parent, t); if (e) return readClr(e, cx); } return null; };
    function readFill(parent, cx, partPath) {
      if (!parent) return undefined;
      for (const e of kids(parent)) {
        if (e.n === 'a:noFill') return null;
        if (e.n === 'a:solidFill') { const c = clrIn(e, cx); return c ? { color: c.c, alpha: c.alpha } : null; }
        if (e.n === 'a:gradFill') {
          const gs = kids(kid(e, 'a:gsLst'), 'a:gs').map(g => { const c = clrIn(g, cx); return [num(g, 'pos', 0) / 100000, c ? c.c : '#000000', c && c.alpha]; }).sort((a, b) => a[0] - b[0]);
          if (!gs.length) return null; if (gs.length === 1) return { color: gs[0][1] };
          const lin = kid(e, 'a:lin'); const alpha = gs.every(g => g[2] != null) ? gs.reduce((a, g) => a + g[2], 0) / gs.length : undefined;
          return { grad: gs.map(g => [g[0], g[1]]), ang: lin ? num(lin, 'ang', 0) / 60000 : 90, alpha };
        }
        if (e.n === 'a:blipFill') { const b = kid(e, 'a:blip'); const id = b && partPath ? media(partPath, attr(b, 'r:embed')) : null; return id ? { img: id } : { color: '#c8d0da' }; }
        if (e.n === 'a:pattFill') { const c = clrIn(kid(e, 'a:fgClr'), cx); return c ? { color: c.c, alpha: c.alpha } : null; }
        if (e.n === 'a:grpFill') return cx && cx.grpFill !== undefined ? cx.grpFill : null;
      }
      return undefined;
    }
    const DASH = { dash: 'dash', sysDash: 'dash', dot: 'dot', sysDot: 'dot', dashDot: 'dashDot', sysDashDot: 'dashDot', lgDash: 'lgDash', lgDashDot: 'dashDot', lgDashDotDot: 'dashDot', sysDashDotDot: 'dashDot' };
    function readLine(ln, cx) {
      if (!ln) return undefined;
      const f = readFill(ln, cx);
      if (f === null) return null;
      const o = { w: ln.a.w != null ? Math.max(0.25, px(num(ln, 'w', 9525))) : undefined };
      if (f && f.color) { o.color = f.color; if (f.alpha != null) o.alpha = f.alpha; } else if (f && f.grad) o.color = f.grad[0][1];
      const d = attr(kid(ln, 'a:prstDash'), 'val'); if (d && DASH[d]) o.dash = DASH[d];
      const he = attr(kid(ln, 'a:headEnd'), 'type'), te = attr(kid(ln, 'a:tailEnd'), 'type');
      if (he && he !== 'none') o.head = 'arrow'; if (te && te !== 'none') o.tail = 'arrow';
      return o;
    }
    // theme style matrix references (p:style)
    function styleRefs(st, cx) {
      if (!st) return {};
      const out = {};
      const fr = kid(st, 'a:fillRef'), lr = kid(st, 'a:lnRef'), fo = kid(st, 'a:fontRef');
      if (fr) { const idx = num(fr, 'idx', 0), c = clrIn(fr, cx); if (idx > 0 && c) { const fs = theme.fills[Math.min(idx, 3) - 1]; out.fill = fs ? readFill({ c: [fs] }, { ...cx, phClr: c.c }) || { color: c.c } : { color: c.c }; } else if (idx === 0) out.fill = null; }
      if (lr) { const idx = num(lr, 'idx', 0), c = clrIn(lr, cx); if (idx > 0 && c) out.line = { w: theme.lineW[Math.min(idx, 3) - 1] || 1, color: c.c }; else if (idx === 0) out.line = null; }
      if (fo) { const c = clrIn(fo, cx); if (c) out.fontColor = c.c; const f = attr(fo, 'idx'); if (f === 'major') out.font = '+mj'; }
      return out;
    }

    /* ---- text ---- */
    const fontName = t => !t ? undefined : /^\+mj/.test(t) ? '+mj' : /^\+mn/.test(t) ? '+mn' : t;
    function readRPr(rp, cx) {
      if (!rp) return {};
      const o = {};
      if (rp.a.sz != null) o.size = num(rp, 'sz', 1800) / 100;
      if (rp.a.b != null) o.b = rp.a.b === '1' || rp.a.b === 'true';
      if (rp.a.i != null) o.i = rp.a.i === '1' || rp.a.i === 'true';
      if (rp.a.u != null) o.u = rp.a.u !== 'none';
      if (rp.a.strike != null) o.s = rp.a.strike !== 'noStrike';
      if (rp.a.baseline != null && num(rp, 'baseline', 0)) o.sup = num(rp, 'baseline', 0) / 1000;
      const f = readFill(rp, cx); if (f && f.color) o.color = f.color; else if (f && f.grad) o.color = f.grad[0][1];
      const lat = kid(rp, 'a:latin'); if (lat && attr(lat, 'typeface')) o.font = fontName(attr(lat, 'typeface'));
      return o;
    }
    function readPPr(pp, cx) {
      const o = {}; if (!pp) return o;
      if (pp.a.algn) o.align = { l: 'l', ctr: 'c', r: 'r', just: 'j', dist: 'j', justLow: 'j', thaiDist: 'j' }[pp.a.algn] || 'l';
      if (pp.a.marL != null) o.marL = px(num(pp, 'marL', 0)); if (pp.a.indent != null) o.indent = px(num(pp, 'indent', 0));
      const ls = xpath(pp, 'a:lnSpc', 'a:spcPct'); if (ls) o.lnSp = num(ls, 'val', 100000) / 100000;
      const lsp = xpath(pp, 'a:lnSpc', 'a:spcPts'); if (lsp) o.lnPts = num(lsp, 'val', 0) / 100;
      const sb = xpath(pp, 'a:spcBef', 'a:spcPts'); if (sb) o.spB = num(sb, 'val', 0) / 100;
      const sbp = xpath(pp, 'a:spcBef', 'a:spcPct'); if (sbp) o.spBPct = num(sbp, 'val', 0) / 100000;
      const sa = xpath(pp, 'a:spcAft', 'a:spcPts'); if (sa) o.spA = num(sa, 'val', 0) / 100;
      if (kid(pp, 'a:buNone')) o.bullet = 'none';
      else if (kid(pp, 'a:buChar')) { let ch = attr(kid(pp, 'a:buChar'), 'char', '•'); const bf = attr(kid(pp, 'a:buFont'), 'typeface', ''); if (/wingdings|symbol/i.test(bf)) ch = { '§': '■', 'Ø': '➢', 'ü': '✓', 'q': '❑', 'v': '❖', 'n': '■', 'l': '●', '': '•' }[ch] || '•'; o.bullet = ch.slice(0, 2); }
      else if (kid(pp, 'a:buAutoNum')) { const b = kid(pp, 'a:buAutoNum'); const t = attr(b, 'type', 'arabicPeriod'); o.bullet = { num: Model.NUMFMT.includes(t) ? t : 'arabicPeriod', start: num(b, 'startAt', 1) }; }
      const d = kid(pp, 'a:defRPr'); if (d) o.rpr = readRPr(d, cx);
      return o;
    }
    function readLvls(lst, cx) {
      const out = [];
      if (!lst) return out;
      for (let i = 0; i < 9; i++) { const e = kid(lst, `a:lvl${i + 1}pPr`); out[i] = e ? readPPr(e, cx) : {}; }
      return out;
    }
    const mergeLvl = (a, b) => { if (!b) return a; const o = { ...a, ...b }; o.rpr = { ...(a.rpr || {}), ...(b.rpr || {}) }; return o; };
    const mergeChain = chain => { const out = []; for (let i = 0; i < 9; i++) { let l = { rpr: {} }; for (const c of chain) if (c && c[i]) l = mergeLvl(l, c[i]); out[i] = l; } return out; };
    function readBodyPr(bp) {
      const o = {}; if (!bp) return o;
      const ins = ['lIns', 'tIns', 'rIns', 'bIns'];
      if (ins.some(k => bp.a[k] != null)) o.ins = ins.map((k, i) => bp.a[k] != null ? px(num(bp, k, 0)) : [9.6, 4.8, 9.6, 4.8][i]);
      if (bp.a.anchor) o.anchor = { t: 't', ctr: 'ctr', b: 'b', just: 't', dist: 't' }[bp.a.anchor] || 't';
      if (bp.a.wrap === 'none') o.wrap = false;
      if (bp.a.vert === 'vert' || bp.a.vert === 'eaVert') o.vert = 'vert'; else if (bp.a.vert === 'vert270') o.vert = 'vert270';
      const na = kid(bp, 'a:normAutofit'); if (na) { o.autofit = 'shrink'; if (na.a.fontScale) o.scale = num(na, 'fontScale', 100000) / 100000; }
      if (kid(bp, 'a:spAutoFit')) o.autofit = 'grow'; if (kid(bp, 'a:noAutofit')) o.autofit = 'none';
      return o;
    }
    // paragraph & runs with explicit props only (raw)
    function readParas(txBody, cx) {
      return kids(txBody, 'a:p').map(p => {
        const pp = readPPr(kid(p, 'a:pPr'), cx); const lvl = num(kid(p, 'a:pPr'), 'lvl', 0) | 0;
        const runs = [];
        for (const e of kids(p)) {
          if (e.n === 'a:r') runs.push({ t: xtext(kid(e, 'a:t')), ...readRPr(kid(e, 'a:rPr'), cx) });
          else if (e.n === 'a:br') runs.push({ t: '', br: true, ...readRPr(kid(e, 'a:rPr'), cx) });
          else if (e.n === 'a:fld') { const t = attr(e, 'type', ''); const r = { t: xtext(kid(e, 'a:t')), ...readRPr(kid(e, 'a:rPr'), cx) }; if (t === 'slidenum') { r.fld = 'slidenum'; } else if (/^datetime/.test(t)) r.fld = 'date'; runs.push(r); }
        }
        const end = readRPr(kid(p, 'a:endParaRPr'), cx);
        return { lvl, pp, runs, end };
      });
    }
    // Resolve effective PowerPoint values via the inheritance chain and keep only what differs from Lumen's own inheritance.
    function buildText(txBody, chainLvls, bodyChain, cx, mine) {
      const raw = readParas(txBody, cx);
      const bp = { ...bodyChain, ...readBodyPr(kid(txBody, 'a:bodyPr')) };
      const tb = { paras: [] };
      if (bp.anchor) tb.anchor = bp.anchor; if (bp.ins) tb.ins = bp.ins; if (bp.wrap === false) tb.wrap = false; if (bp.vert) tb.vert = bp.vert;
      if (bp.autofit) tb.autofit = bp.autofit; if (bp.scale) tb.scale = bp.scale;
      const base = mine();
      for (const rp of raw) {
        const lvl = Math.min(8, rp.lvl), ch = mergeLvl(chainLvls[lvl] || { rpr: {} }, rp.pp);
        const myLv = base.lv[Math.min(lvl, base.lv.length - 1)] || base.lv[0];
        const p = { runs: [] }; if (lvl) p.lvl = lvl;
        // bullet
        const effB = ch.bullet != null ? ch.bullet : 'none';
        let myB = myLv.bullet != null ? myLv.bullet : 'none'; if (base.bullet != null) myB = base.bullet;
        if (JSON.stringify(effB) !== JSON.stringify(myB)) p.bullet = effB;
        const on = effB !== 'none';
        const effAlign = ch.align || 'l'; if (effAlign !== (base.align || 'l')) p.align = effAlign;
        const myMarL = lvl * 48 + (on ? 36 : 0), myInd = on ? -36 : 0;
        const effMarL = ch.marL != null ? ch.marL : 0, effInd = ch.indent != null ? ch.indent : 0;
        if (Math.abs(effMarL - myMarL) > 1 || Math.abs(effInd - myInd) > 1) { p.marL = Math.round(effMarL * 10) / 10; p.indent = Math.round(effInd * 10) / 10; }
        const runSize = r => r.size != null ? r.size : ch.rpr.size != null ? ch.rpr.size : 18;
        let effLn = ch.lnSp != null ? ch.lnSp : 1;
        if (ch.lnPts != null) { const s = runSize(rp.runs[0] || rp.end || {}); effLn = Math.max(0.3, ch.lnPts / (s * 1.2)); }
        if (Math.abs(effLn - (base.lnSp || 1)) > 0.005) p.lnSp = Math.round(effLn * 1000) / 1000;
        const effSpB = ch.spB != null ? ch.spB : ch.spBPct != null ? ch.spBPct * runSize(rp.runs[0] || {}) * 1.2 : 0;
        if (Math.abs(effSpB - (base.spB || 0)) > 0.1) p.spB = Math.round(effSpB * 10) / 10;
        if (ch.spA) p.spA = ch.spA;
        const effR = r => ({ size: r.size != null ? r.size : ch.rpr.size != null ? ch.rpr.size : 18, b: r.b != null ? r.b : !!ch.rpr.b, i: r.i != null ? r.i : !!ch.rpr.i, u: r.u != null ? r.u : !!ch.rpr.u, s: r.s, color: r.color || ch.rpr.color || cx.fontColor || 'tx1', font: r.font || ch.rpr.font || cx.font || '+mn' });
        for (const r of rp.runs) {
          const e = effR(r), o = { t: r.t || '' };
          if (r.br) o.br = true; if (r.fld) o.fld = r.fld;
          if (Math.abs(e.size - myLv.size) > 0.01) o.size = e.size;
          if (e.b !== !!base.b) o.b = e.b; if (e.i !== !!base.i) o.i = e.i; if (e.u !== !!base.u) o.u = e.u; if (e.s) o.s = true;
          if (e.color !== (base.color || 'tx1')) o.color = e.color;
          if (e.font !== (base.font || '+mn') && Model.font(e.font, theme) !== Model.font(base.font || '+mn', theme)) o.font = e.font;
          if (r.sup) o.sup = r.sup;
          p.runs.push(o);
        }
        const es = effR(rp.end || {}).size; if (Math.abs(es - myLv.size) > 0.01) p.endSize = es;
        tb.paras.push(p);
      }
      if (!tb.paras.length) tb.paras.push({ runs: [] });
      return tb;
    }

    /* ---- geometry ---- */
    function readXfrm(x) {
      if (!x) return null;
      const off = kid(x, 'a:off'), ext = kid(x, 'a:ext'), cho = kid(x, 'a:chOff'), che = kid(x, 'a:chExt');
      return { x: num(off, 'x', 0), y: num(off, 'y', 0), w: num(ext, 'cx', 0), h: num(ext, 'cy', 0), rot: num(x, 'rot', 0) / 60000, flipH: attr(x, 'flipH') === '1' || attr(x, 'flipH') === 'true', flipV: attr(x, 'flipV') === '1' || attr(x, 'flipV') === 'true',
        chx: cho ? num(cho, 'x', 0) : null, chy: cho ? num(cho, 'y', 0) : null, chw: che ? num(che, 'cx', 0) : null, chh: che ? num(che, 'cy', 0) : null };
    }
    const IDT = { sx: 1, sy: 1, ox: 0, oy: 0 };
    const apply = (T, xf) => ({ x: px(xf.x * T.sx + T.ox), y: px(xf.y * T.sy + T.oy), w: px(xf.w * T.sx), h: px(xf.h * T.sy) });
    function custGeom(cg) {
      const out = [];
      for (const p of kids(kid(cg, 'a:pathLst'), 'a:path')) {
        const sp = { w: num(p, 'w', 0), h: num(p, 'h', 0), fill: attr(p, 'fill') !== 'none', stroke: attr(p, 'stroke') !== '0' && attr(p, 'stroke') !== 'false', cmds: [] };
        let cx = 0, cy = 0, sx = 0, sy = 0;
        const pt = e => [num(e, 'x', 0), num(e, 'y', 0)];
        for (const c of kids(p)) {
          const pts = kids(c, 'a:pt').map(pt);
          if (c.n === 'a:moveTo' && pts[0]) { sp.cmds.push(['M', ...pts[0]]); [cx, cy] = pts[0]; [sx, sy] = pts[0]; }
          else if (c.n === 'a:lnTo' && pts[0]) { sp.cmds.push(['L', ...pts[0]]); [cx, cy] = pts[0]; }
          else if (c.n === 'a:cubicBezTo' && pts.length === 3) { sp.cmds.push(['C', ...pts[0], ...pts[1], ...pts[2]]); [cx, cy] = pts[2]; }
          else if (c.n === 'a:quadBezTo' && pts.length === 2) { sp.cmds.push(['Q', ...pts[0], ...pts[1]]); [cx, cy] = pts[1]; }
          else if (c.n === 'a:arcTo') {
            const wR = num(c, 'wR', 0), hR = num(c, 'hR', 0), st = num(c, 'stAng', 0) / 60000 * Math.PI / 180, sw = num(c, 'swAng', 0) / 60000 * Math.PI / 180;
            const ecx = cx - wR * Math.cos(st), ecy = cy - hR * Math.sin(st);
            const n = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2)));
            for (let k = 0; k < n; k++) {
              const a0 = st + sw * k / n, a1 = st + sw * (k + 1) / n, kk = 4 / 3 * Math.tan((a1 - a0) / 4);
              const p0 = [ecx + wR * Math.cos(a0), ecy + hR * Math.sin(a0)], p3 = [ecx + wR * Math.cos(a1), ecy + hR * Math.sin(a1)];
              const p1 = [p0[0] - kk * wR * Math.sin(a0), p0[1] + kk * hR * Math.cos(a0)], p2 = [p3[0] + kk * wR * Math.sin(a1), p3[1] - kk * hR * Math.cos(a1)];
              sp.cmds.push(['C', ...p1, ...p2, ...p3]);
            }
            cx = ecx + wR * Math.cos(st + sw); cy = ecy + hR * Math.sin(st + sw);
          }
          else if (c.n === 'a:close') { sp.cmds.push(['Z']); cx = sx; cy = sy; }
        }
        out.push(sp);
      }
      return out;
    }

    /* ---- inheritance sources ---- */
    const defaultTS = readLvls(kid(pres, 'p:defaultTextStyle'), {});
    const txS = kid(master, 'p:txStyles');
    const mTitle = readLvls(kid(txS, 'p:titleStyle'), {}), mBody = readLvls(kid(txS, 'p:bodyStyle'), {}), mOther = readLvls(kid(txS, 'p:otherStyle'), {});
    const phKey = ph => ({ type: attr(ph, 'type', 'body') === 'obj' ? 'body' : attr(ph, 'type', 'body'), idx: num(ph, 'idx', 0) | 0 });
    const catOf = t => t === 'title' || t === 'ctrTitle' ? 'title' : t === 'dt' || t === 'ftr' || t === 'sldNum' ? 'other' : t === 'sldImg' || t === 'hdr' ? 'none' : 'body';
    function phList(spTree) { // {type, idx, sp, xfrm, lst, bodyPr}
      const out = [];
      for (const sp of all(spTree, 'p:sp').concat(all(spTree, 'p:pic'))) {
        const ph = xpath(sp, sp.n === 'p:pic' ? 'p:nvPicPr' : 'p:nvSpPr', 'p:nvPr', 'p:ph'); if (!ph) continue;
        const k = phKey(ph); const tx = kid(sp, 'p:txBody');
        out.push({ ...k, sp, xfrm: readXfrm(xpath(sp, 'p:spPr', 'a:xfrm')), lst: readLvls(kid(tx, 'a:lstStyle'), {}), bodyPr: readBodyPr(kid(tx, 'a:bodyPr')) });
      }
      return out;
    }
    const findPh = (list, k) => list.find(p => p.idx === k.idx && p.type === k.type && k.idx) || list.find(p => k.idx && p.idx === k.idx && catOf(p.type) === catOf(k.type)) || list.find(p => p.type === k.type) || list.find(p => catOf(p.type) === catOf(k.type) && catOf(k.type) === 'title') || (catOf(k.type) === 'body' ? list.find(p => p.type === 'body') : null);
    const masterTree = xpath(master, 'p:cSld', 'p:spTree');
    const mPhs = phList(masterTree);
    const mcx = { part: masterPath };
    // Lumen master styles from txStyles + master placeholder list styles
    const lvlToStyle = (L, extra) => { const l = L[0] || { rpr: {} }; const r = l.rpr || {}; const o = { font: r.font || '+mn', color: r.color || 'tx1', b: !!r.b, i: !!r.i, align: l.align || 'l' }; if (r.size != null) o.size = r.size; if (l.lnSp != null) o.lnSp = l.lnSp; if (l.spB != null) o.spB = l.spB; return { ...o, ...extra }; };
    const mPhOf = t => mPhs.find(p => p.type === t);
    const titleCh = mergeChain([mTitle, mPhOf('title') && mPhOf('title').lst]);
    const bodyCh = mergeChain([mBody, mPhOf('body') && mPhOf('body').lst]);
    const otherCh = mergeChain([mOther]);
    const styles = Model.defaultStyles();
    styles.title = lvlToStyle(titleCh, { anchor: (mPhOf('title') && mPhOf('title').bodyPr.anchor) || 'ctr' }); if (styles.title.size == null) styles.title.size = 44;
    if (styles.title.lnSp == null) styles.title.lnSp = 1;
    styles.body = lvlToStyle(bodyCh, { anchor: (mPhOf('body') && mPhOf('body').bodyPr.anchor) || 't' });
    styles.body.lv = bodyCh.slice(0, 9).map((l, i) => ({ size: l.rpr.size != null ? l.rpr.size : [28, 24, 20, 18, 18, 18, 18, 18, 18][i], bullet: l.bullet != null ? l.bullet : 'none' }));
    delete styles.body.size; if (styles.body.lnSp == null) styles.body.lnSp = 1; if (styles.body.spB == null) styles.body.spB = 0;
    styles.other = lvlToStyle(otherCh.some(l => Object.keys(l.rpr).length) ? otherCh : mergeChain([defaultTS]), {}); if (styles.other.size == null) styles.other.size = 18;
    if (styles.other.lnSp == null) styles.other.lnSp = 1;

    const doc = { app: 'lumen-slides', version: 1, w: W, h: H, theme, master: { bg: null, objects: [], styles, ph: [] }, layouts: [], slides: [], footer: { num: false, text: '', date: false, skipTitle: true } };
    doc.master.bg = readBg(kid(master, 'p:cSld'), mcx, masterPath) || { color: 'bg1' };
    // master placeholders
    for (const p of mPhs) {
      if (!['title', 'body', 'dt', 'ftr', 'sldNum'].includes(p.type) || !p.xfrm) continue;
      const g = apply(IDT, p.xfrm);
      const o = { id: Model.uid(), type: 'shape', geom: 'rect', fill: null, line: null, rot: 0, ...g, ph: { type: p.type, idx: p.idx }, text: { paras: [{ runs: [] }] } };
      if (catOf(p.type) === 'other') { const l = mergeChain([mOther, p.lst])[0]; o.text.def = { size: l.rpr.size || 12, color: l.rpr.color || 'tx1', align: l.align || 'l' }; }
      doc.master.ph.push(o);
    }
    for (const t of ['title', 'body']) if (!doc.master.ph.find(p => p.ph.type === t)) doc.master.ph.push(Model.defaultMaster(W, H).ph.find(p => p.ph.type === t));
    doc.master.objects = readTree(masterTree, mcx, masterPath, IDT, null).filter(o => !o.ph);

    /* ---- layouts ---- */
    const layoutInfo = new Map(); // path → {lay, phs}
    const layoutPaths = [];
    for (const mp of masterIds) for (const e of kids(kid(xml(mp), 'p:sldLayoutIdLst'), 'p:sldLayoutId')) { const r = rels(mp)[attr(e, 'r:id')]; if (r && r.target && !layoutPaths.includes(r.target)) layoutPaths.push(r.target); }
    function loadLayout(lp) {
      if (layoutInfo.has(lp)) return layoutInfo.get(lp);
      const L = xml(lp); if (!L) return null;
      const tree = xpath(L, 'p:cSld', 'p:spTree'), phs = phList(tree);
      const lay = { id: Model.uid(), name: attr(kid(L, 'p:cSld'), 'name', 'Layout'), kind: attr(L, 'type', 'cust'), bg: readBg(kid(L, 'p:cSld'), { part: lp }, lp), hideMaster: attr(L, 'showMasterSp') === '0', objects: [] };
      for (const p of phs) {
        if (catOf(p.type) === 'none' || catOf(p.type) === 'other') continue;
        const mp = findPh(mPhs, p); const xf = p.xfrm || (mp && mp.xfrm); if (!xf) continue;
        const o = { id: Model.uid(), type: 'shape', geom: 'rect', fill: null, line: null, rot: 0, ...apply(IDT, xf), ph: { type: p.type, idx: p.idx }, text: { paras: [{ runs: [] }] } };
        const l0 = p.lst[0] || { rpr: {} }, def = {};
        if (l0.rpr && l0.rpr.size != null) def.size = l0.rpr.size; if (l0.rpr && l0.rpr.color) def.color = l0.rpr.color; if (l0.rpr && l0.rpr.b != null) def.b = l0.rpr.b;
        if (l0.align) def.align = l0.align; if (l0.bullet === 'none') def.bullet = 'none'; if (p.bodyPr.anchor) def.anchor = p.bodyPr.anchor;
        if (Object.keys(def).length) o.text.def = def;
        lay.objects.push(o);
      }
      lay.objects.push(...readTree(tree, { part: lp }, lp, IDT, null).filter(o => !o.ph));
      const info = { lay, phs, path: lp };
      layoutInfo.set(lp, info); doc.layouts.push(lay); return info;
    }
    for (const lp of layoutPaths) loadLayout(lp);

    /* ---- shape tree ---- */
    let ctxSlide = null, ctxLayout = null;
    function readTree(tree, cx, part, T, phCtx) {
      const out = [];
      for (const e of kids(tree)) {
        try { const o = readShape(e, cx, part, T, phCtx); if (o) out.push(o); } catch (err) { warnings.add('A shape could not be read: ' + err.message); }
      }
      return out;
    }
    function nvOf(e) { const nv = kids(e).find(k => /^p:nv/.test(k.n)); return { nv, c: kid(nv, 'p:cNvPr'), ph: xpath(nv, 'p:nvPr', 'p:ph') }; }
    function readShape(e, cx, part, T, phCtx) {
      const { c: cnv, ph } = nvOf(e);
      const name = attr(cnv, 'name', ''), hidden = attr(cnv, 'hidden') === '1';
      const base = () => ({ id: Model.uid(), name: name || undefined, hidden: hidden || undefined });
      if (e.n === 'mc:AlternateContent') { const ch = kid(e, 'mc:Choice'), fb = kid(e, 'mc:Fallback'); const pick = fb || ch; const r = pick ? readTree(pick, cx, part, T, phCtx) : []; return r.length === 1 ? r[0] : r.length ? groupOf(r) : null; }
      if (e.n === 'p:grpSp') {
        const xf = readXfrm(xpath(e, 'p:grpSpPr', 'a:xfrm')); if (!xf) return null;
        const sx = xf.chw ? xf.w / xf.chw : 1, sy = xf.chh ? xf.h / xf.chh : 1;
        // child → parent EMU, then parent transform
        const T2 = { sx: T.sx * sx, sy: T.sy * sy, ox: T.ox + T.sx * (xf.x - (xf.chx || 0) * sx), oy: T.oy + T.sy * (xf.y - (xf.chy || 0) * sy) };
        const gf = readFill(kid(e, 'p:grpSpPr'), cx, part);
        const children = readTree(e, { ...cx, grpFill: gf }, part, T2, phCtx);
        if (!children.length) return null;
        const g = { ...base(), type: 'group', ...apply(T, xf), rot: xf.rot || 0, children };
        return g;
      }
      if (e.n === 'p:sp' || e.n === 'p:cxnSp') {
        const spPr = kid(e, 'p:spPr'), tx = kid(e, 'p:txBody');
        const st = styleRefs(kid(e, 'p:style'), cx);
        let xf = readXfrm(kid(spPr, 'a:xfrm')), k = ph ? phKey(ph) : null;
        let geo = null, phInfo = null, lphInfo = null, mphInfo = null;
        if (k) {
          if (phCtx && phCtx.layoutPhs) lphInfo = findPh(phCtx.layoutPhs, k);
          mphInfo = findPh(mPhs, k);
          if (catOf(k.type) === 'none') return null;
        }
        if (xf) geo = apply(T, xf); else if (lphInfo && lphInfo.xfrm) geo = apply(IDT, lphInfo.xfrm); else if (mphInfo && mphInfo.xfrm) geo = apply(IDT, mphInfo.xfrm);
        if (!geo) return null;
        const o = { ...base(), type: 'shape', ...geo, rot: xf ? xf.rot : 0 };
        if (xf && xf.flipH) o.flipH = true; if (xf && xf.flipV) o.flipV = true;
        const pg = kid(spPr, 'a:prstGeom'), cg = kid(spPr, 'a:custGeom');
        if (cg) { o.geom = 'cust'; o.path = custGeom(cg); if (!o.path.length) o.geom = 'rect'; }
        else { o.geom = pg ? attr(pg, 'prst', 'rect') : 'rect'; if (e.n === 'p:cxnSp' && /connector/i.test(o.geom)) o.geom = 'line'; }
        if (o.geom === 'roundRect') { const gd = kids(kid(pg, 'a:avLst'), 'a:gd').find(g => attr(g, 'name') === 'adj'); if (gd) { const m = /val\s+(-?\d+)/.exec(attr(gd, 'fmla', '')); if (m) o.adj = +m[1] / 100000; } }
        if (!Model.GEOMS.find(g => g[0] === o.geom) && o.geom !== 'cust') o.geom = /line|connector/i.test(o.geom) ? 'line' : /ellipse|oval|circle|pie|chord/i.test(o.geom) ? 'ellipse' : /round/i.test(o.geom) ? 'roundRect' : /arrow/i.test(o.geom) ? 'rightArrow' : /star/i.test(o.geom) ? 'star5' : 'rect';
        const f = readFill(spPr, cx, part); o.fill = f !== undefined ? f : st.fill !== undefined ? st.fill : null;
        if (o.fill && o.fill.img) { // picture fill → image object
          const img = { ...o, type: 'image', asset: o.fill.img, fill: undefined }; delete img.text; delete img.path; img.geom = o.geom !== 'rect' ? o.geom : undefined;
          return img;
        }
        let ln = readLine(kid(spPr, 'a:ln'), cx);
        if (ln === undefined) ln = st.line !== undefined ? st.line : null; else if (ln && !ln.color) ln.color = st.line ? st.line.color : 'tx1';
        if (ln && ln.w == null) ln.w = st.line && st.line.w || 1;
        o.line = ln;
        if (o.geom === 'line') o.fill = null;
        if (kid(kid(spPr, 'a:effectLst'), 'a:outerShdw')) o.shadow = true;
        if (attr(xpath(e, 'p:nvSpPr', 'p:cNvSpPr'), 'txBox') === '1') o.tb = true;
        if (k) {
          o.ph = { type: k.type, idx: k.idx };
          if (xf && lphInfo && lphInfo.xfrm) { const lg = apply(IDT, lphInfo.xfrm); if (Math.abs(lg.x - o.x) > 0.5 || Math.abs(lg.y - o.y) > 0.5 || Math.abs(lg.w - o.w) > 0.5 || Math.abs(lg.h - o.h) > 0.5) o.ownGeo = true; }
          else if (xf && phCtx && phCtx.slide) o.ownGeo = true;
        }
        if (tx) {
          const cat = k ? catOf(k.type) : null;
          const chain = cat === 'title' ? [mTitle, mphInfo && mphInfo.lst, lphInfo && lphInfo.lst] : cat === 'body' ? [mBody, mphInfo && mphInfo.lst, lphInfo && lphInfo.lst] : cat === 'other' ? [mOther, mphInfo && mphInfo.lst, lphInfo && lphInfo.lst] : [defaultTS.length ? defaultTS : mOther];
          chain.push(readLvls(kid(tx, 'a:lstStyle'), cx));
          const bodyChain = { ...(mphInfo ? mphInfo.bodyPr : {}), ...(lphInfo ? lphInfo.bodyPr : {}) };
          if (!k) { bodyChain.anchor = 't'; }
          const tcx = { ...cx, fontColor: st.fontColor, font: st.font };
          o.text = buildText(tx, mergeChain(chain), bodyChain, tcx, () => Model.baseStyle(doc, phCtx && phCtx.slide ? { slide: phCtx.slide } : phCtx && phCtx.layout ? { layout: phCtx.layout } : { master: true }, o));
          if (!k && !o.text.anchor) o.text.anchor = 't';
          if (o.text.autofit === 'shrink' && !k) o.text.autofit = 'shrink';
          if (k && !o.text.autofit && cat === 'body') { /* Lumen default for body placeholders is shrink */ }
          if (!k && !o.text.autofit) o.text.autofit = 'none';
          if (Render_isEmpty(o.text) && !k && !o.fill && !o.line) return null;
        }
        if (k && !o.text && catOf(k.type) !== 'none') o.text = { paras: [{ runs: [] }] };
        return o;
      }
      if (e.n === 'p:pic') {
        const spPr = kid(e, 'p:spPr'), xf = readXfrm(kid(spPr, 'a:xfrm')); let k = ph ? phKey(ph) : null;
        let geo = xf ? apply(T, xf) : null;
        if (!geo && k && phCtx && phCtx.layoutPhs) { const l = findPh(phCtx.layoutPhs, k); if (l && l.xfrm) geo = apply(IDT, l.xfrm); }
        if (!geo) return null;
        const blip = xpath(e, 'p:blipFill', 'a:blip'); const id = blip ? media(part, attr(blip, 'r:embed')) : null;
        const o = { ...base(), type: 'image', ...geo, rot: xf ? xf.rot : 0, asset: id || '', line: readLine(kid(spPr, 'a:ln'), cx) || null };
        if (xf && xf.flipH) o.flipH = true; if (xf && xf.flipV) o.flipV = true;
        const sr = xpath(e, 'p:blipFill', 'a:srcRect'); if (sr && ['l', 't', 'r', 'b'].some(s => sr.a[s])) o.crop = { l: num(sr, 'l', 0) / 100000, t: num(sr, 't', 0) / 100000, r: num(sr, 'r', 0) / 100000, b: num(sr, 'b', 0) / 100000 };
        const pg = kid(spPr, 'a:prstGeom'); if (pg && attr(pg, 'prst') !== 'rect' && Model.GEOMS.find(g => g[0] === attr(pg, 'prst'))) o.geom = attr(pg, 'prst');
        if (kid(kid(spPr, 'a:effectLst'), 'a:outerShdw')) o.shadow = true;
        if (k) o.ph = { type: k.type, idx: k.idx };
        if (!id) { return { ...base(), type: 'shape', geom: 'rect', ...geo, rot: 0, fill: { color: '#d5dce5' }, line: { color: '#9aa7b6', w: 1, dash: 'dash' }, text: { paras: [{ runs: [{ t: 'Picture (unsupported format)', color: '#556270', size: 12 }], align: 'c' }], anchor: 'ctr' } }; }
        return o;
      }
      if (e.n === 'p:graphicFrame') {
        const xf = readXfrm(kid(e, 'p:xfrm')); if (!xf) return null;
        const geo = apply(T, xf), gd = xpath(e, 'a:graphic', 'a:graphicData'), uri = attr(gd, 'uri', '');
        if (/table$/.test(uri)) return readTable(kid(gd, 'a:tbl'), geo, cx, base());
        if (/chart$/.test(uri)) { const ch = kid(gd, 'c:chart'); const r = ch && rels(part)[attr(ch, 'r:id')]; const c = r && r.target ? readChart(xml(r.target), geo, base()) : null; if (c) return c; warnings.add('A chart could not be read'); return null; }
        const fb = all(e, 'mc:Fallback')[0]; if (fb) { const r = readTree(fb, cx, part, T, phCtx); if (r.length) return r.length === 1 ? r[0] : groupOf(r); }
        warnings.add('Unsupported embedded object skipped (SmartArt / OLE / media)');
        return null;
      }
      return null;
    }
    function readTable(tbl, geo, cx, b) {
      if (!tbl) return null;
      const tp = kid(tbl, 'a:tblPr');
      const cols = kids(kid(tbl, 'a:tblGrid'), 'a:gridCol').map(g => px(num(g, 'w', 914400)));
      if (!cols.length) return null;
      const styled = !!xtext(kid(tp, 'a:tableStyleId')) || tp && kid(tp, 'a:tableStyleId');
      const style = { first: attr(tp, 'firstRow') === '1', band: attr(tp, 'bandRow') === '1', color: 'accent1', none: !styled };
      let anyFill = false;
      const rows = kids(tbl, 'a:tr').map(tr => ({ h: px(num(tr, 'h', 370840)), cells: cols.map((_, ci) => {
        const tc = kids(tr, 'a:tc')[ci];
        if (!tc) return { text: { paras: [{ runs: [] }] } };
        const tcPr = kid(tc, 'a:tcPr');
        const pseudo = { type: 'table' };
        const text = buildText(kid(tc, 'a:txBody') || { n: 'a:txBody', a: {}, c: [] }, mergeChain([defaultTS]), {}, { ...cx }, () => Model.baseStyle(doc, {}, pseudo));
        delete text.autofit;
        const ins = ['marL', 'marT', 'marR', 'marB']; if (tcPr && ins.some(k => tcPr.a[k] != null)) text.ins = [px(num(tcPr, 'marL', 91440)), px(num(tcPr, 'marT', 45720)), px(num(tcPr, 'marR', 91440)), px(num(tcPr, 'marB', 45720))];
        if (tcPr && tcPr.a.anchor) text.anchor = { t: 't', ctr: 'ctr', b: 'b' }[tcPr.a.anchor] || 't'; else delete text.anchor;
        const cell = { text };
        const f = readFill(tcPr, cx); if (f) { cell.fill = f; anyFill = true; } else if (f === null && styled) cell.fill = null;
        if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') cell.text = { paras: [{ runs: [] }] };
        return cell;
      }) }));
      if (anyFill && !styled) style.none = false;
      const sumW = cols.reduce((a, c) => a + c, 0) || 1;
      return { ...b, type: 'table', x: geo.x, y: geo.y, w: geo.w || sumW, h: rows.reduce((a, r) => a + r.h, 0), rot: 0, cols: cols.map(c => c * (geo.w ? geo.w / sumW : 1)), rows, style };
    }
    function readChart(cs, geo, b) {
      if (!cs) return null;
      const chart = kid(cs, 'c:chart'), pa = kid(chart, 'c:plotArea'); if (!pa) return null;
      const TYPES = ['c:barChart', 'c:bar3DChart', 'c:lineChart', 'c:line3DChart', 'c:pieChart', 'c:pie3DChart', 'c:doughnutChart', 'c:areaChart', 'c:area3DChart', 'c:scatterChart'];
      const ct = kids(pa).find(k => TYPES.includes(k.n)); if (!ct) return null;
      let kind = 'col';
      if (/bar/.test(ct.n)) { kind = attr(kid(ct, 'c:barDir'), 'val') === 'bar' ? 'bar' : 'col'; if (/stacked/i.test(attr(kid(ct, 'c:grouping'), 'val', '')) && kind === 'col') kind = 'stacked'; }
      else if (/line|scatter/.test(ct.n)) kind = 'line'; else if (/pie/.test(ct.n)) kind = 'pie'; else if (/doughnut/.test(ct.n)) kind = 'doughnut'; else if (/area/.test(ct.n)) kind = 'area';
      const cache = el => { if (!el) return []; const c = all(el, 'c:strCache')[0] || all(el, 'c:numCache')[0] || all(el, 'c:strLit')[0] || all(el, 'c:numLit')[0] || all(el, 'c:lvl')[0]; if (!c) { const v = kid(el, 'c:v'); return v ? [xtext(v)] : []; } const n = num(kid(c, 'c:ptCount'), 'val', 0); const out = Array(n).fill(''); for (const p of kids(c, 'c:pt')) { const i = num(p, 'idx', 0); if (i < 10000) out[i] = xtext(kid(p, 'c:v')); } return out; };
      const sers = kids(ct, 'c:ser');
      let cats = [];
      const series = sers.map((s, i) => {
        const nm = cache(kid(s, 'c:tx'))[0] || `Series ${i + 1}`; const c = cache(kid(s, 'c:cat') || kid(s, 'c:xVal')); if (c.length > cats.length) cats = c;
        const vals = cache(kid(s, 'c:val') || kid(s, 'c:yVal')).map(v => parseFloat(v) || 0);
        const f = readFill(kid(s, 'c:spPr'), {}); const lf = readLine(xpath(s, 'c:spPr', 'a:ln'), {});
        const color = f && f.color ? f.color : kind === 'line' && lf && lf.color ? lf.color : undefined;
        return { name: nm, vals, color };
      });
      if (!cats.length) cats = (series[0] ? series[0].vals : []).map((_, i) => String(i + 1));
      series.forEach(s => { s.vals = cats.map((_, i) => s.vals[i] || 0); });
      const t = kid(chart, 'c:title');
      let title = t ? all(t, 'a:t').map(xtext).join('') : '';
      if (t && !title && series.length === 1) title = series[0].name;
      const dl = all(ct, 'c:dLbls')[0];
      const labels = !!dl && (attr(kid(dl, 'c:showVal'), 'val') === '1' || attr(kid(dl, 'c:showPercent'), 'val') === '1');
      return { ...b, type: 'chart', ...geo, rot: 0, kind, title, legend: !!kid(chart, 'c:legend'), labels, cats, series };
    }
    function readBg(cSld, cx, part) {
      const bg = kid(cSld, 'p:bg'); if (!bg) return null;
      const pr = kid(bg, 'p:bgPr');
      if (pr) { const f = readFill(pr, cx, part); return f ? (f.img ? { img: f.img } : f.grad ? { grad: f.grad, ang: f.ang } : { color: f.color }) : null; }
      const ref = kid(bg, 'p:bgRef');
      if (ref) {
        const idx = num(ref, 'idx', 0), c = clrIn(ref, cx); if (!c) return null;
        const st = idx >= 1001 ? theme.bgFills[idx - 1001] : theme.fills[idx - 1];
        if (st) { const f = readFill({ c: [st] }, { ...cx, phClr: c.c }, themeRel && themeRel.target); if (f && (f.color || f.grad)) return f.grad ? { grad: f.grad, ang: f.ang } : { color: f.color }; if (f && f.img) return { img: f.img }; }
        return { color: c.c };
      }
      return null;
    }

    /* ---- slides ---- */
    const slidePaths = kids(kid(pres, 'p:sldIdLst'), 'p:sldId').map(e => pRels[attr(e, 'r:id')]).filter(r => r && r.target).map(r => r.target);
    for (const sp of slidePaths) {
      const S = xml(sp); if (!S) continue;
      const lr = relOfType(sp, 'slideLayout');
      const info = lr && lr.target ? loadLayout(lr.target) : null;
      const slide = { id: Model.uid(), layout: info ? info.lay.id : (doc.layouts[0] && doc.layouts[0].id), bg: null, objects: [], notes: '', transition: { type: 'none', dur: 0.7 }, anims: [], hidden: attr(S, 'show') === '0' };
      ctxSlide = slide;
      const scx = { part: sp };
      slide.bg = readBg(kid(S, 'p:cSld'), scx, sp);
      const tree = xpath(S, 'p:cSld', 'p:spTree');
      const spidMap = new Map();
      const objs = [];
      for (const e of kids(tree)) {
        let o = null;
        try { o = readShape(e, scx, sp, IDT, { slide, layoutPhs: info ? info.phs : [] }); } catch (err) { warnings.add('A shape could not be read: ' + err.message); }
        if (!o) continue;
        const cid = attr(nvOf(e).c, 'id'); if (cid) spidMap.set(cid, o.id);
        if (o.ph && ['dt', 'ftr', 'sldNum'].includes(o.ph.type)) {
          if (o.ph.type === 'sldNum') doc.footer.num = true; else if (o.ph.type === 'dt') doc.footer.date = true;
          else { const t = Model.plainText(o.text).trim(); if (t) doc.footer.text = t; }
          continue;
        }
        objs.push(o);
      }
      // spids of shapes nested in groups
      for (const e of all(tree, 'p:cNvPr')) { const id = attr(e, 'id'); if (id && !spidMap.has(id)) { /* nested */ } }
      slide.objects = objs;
      // notes
      const nr = relOfType(sp, 'notesSlide');
      if (nr && nr.target) {
        const N = xml(nr.target);
        const body = N && all(N, 'p:sp').find(s => { const p = xpath(s, 'p:nvSpPr', 'p:nvPr', 'p:ph'); return p && attr(p, 'type') === 'body'; });
        if (body) slide.notes = kids(kid(body, 'p:txBody'), 'a:p').map(p => kids(p).filter(k => k.n === 'a:r' || k.n === 'a:fld' || k.n === 'a:br').map(k => k.n === 'a:br' ? '\n' : xtext(kid(k, 'a:t'))).join('')).join('\n').replace(/\s+$/, '');
      }
      // transition
      let tr = kid(S, 'p:transition');
      for (const ac of kids(S, 'mc:AlternateContent')) { const ch = kid(ac, 'mc:Choice'); const t2 = ch && kid(ch, 'p:transition') || xpath(ac, 'mc:Fallback', 'p:transition'); if (t2) tr = t2; }
      if (tr) slide.transition = readTransition(tr);
      // timing
      const tm = kid(S, 'p:timing'); if (tm) { try { slide.anims = readTiming(tm, spidMap); } catch (e) { warnings.add('Some animations could not be read'); } }
      doc.slides.push(slide);
    }
    if (!doc.layouts.length) doc.layouts = Model.defaultLayouts(W);
    const clean = Model.sanitize(doc);
    // keep only assets that survived
    return { doc: clean, assets: Model.sanitizeAssets(assets), warnings: [...warnings] };

    function readTransition(tr) {
      const spd = attr(tr, 'spd', 'med'), d14 = num(tr, 'p14:dur', NaN);
      const t = { type: 'fade', dur: Number.isFinite(d14) ? d14 / 1000 : spd === 'fast' ? 0.5 : spd === 'slow' ? 1 : 0.75 };
      if (tr.a.advTm != null) t.after = num(tr, 'advTm', 0) / 1000; if (attr(tr, 'advClick') === '0') t.noClick = true;
      const c = kids(tr)[0];
      if (!c) { t.type = 'none'; return t; }
      const nm = c.n.replace(/^p\d*:/, ''), dir = attr(c, 'dir');
      const MAP = { fade: 'fade', push: 'push', wipe: 'wipe', cover: 'cover', pull: 'uncover', zoom: 'zoom', split: 'split', cut: 'none', dissolve: 'fade', flash: 'flash', randomBar: 'wipe', blinds: 'wipe', checker: 'fade', circle: 'zoom', diamond: 'zoom', plus: 'zoom', wedge: 'wipe', wheel: 'wipe', strips: 'wipe', newsflash: 'zoom', reveal: 'fade', ripple: 'fade', vortex: 'zoom', morph: 'fade' };
      t.type = MAP[nm] || 'fade';
      if (nm === 'fade' && attr(c, 'thruBlk') === '1') t.type = 'flash';
      if (['l', 'r', 'u', 'd'].includes(dir)) t.dir = dir;
      if (nm === 'split') t.dir = attr(c, 'orient') === 'horz' ? 'h' : 'v';
      return t;
    }
    function readTiming(tm, spidMap) {
      const anims = [];
      const main = all(tm, 'p:cTn').find(c => attr(c, 'nodeType') === 'mainSeq'); if (!main) return anims;
      const FX = { entr: { 1: 'appear', 2: 'fly', 10: 'fade', 16: 'split', 22: 'wipe', 23: 'grow', 53: 'zoom', 42: 'float', 47: 'float', 55: 'zoom', 21: 'wipe', 3: 'wipe', 9: 'fade' }, emph: { 6: 'grow', 8: 'spin', 26: 'pulse', 32: 'teeter', 35: 'pulse' } };
      const DIR = { 4: 'b', 8: 'l', 2: 'r', 1: 't' };
      for (const eff of all(main, 'p:cTn').filter(c => c.a.presetClass)) {
        const cls = attr(eff, 'presetClass'); if (!['entr', 'exit', 'emph'].includes(cls)) continue;
        const tg = all(eff, 'p:spTgt')[0]; const target = tg && spidMap.get(attr(tg, 'spid')); if (!target) continue;
        const pid = num(eff, 'presetID', 10), sub = num(eff, 'presetSubtype', 0);
        const fx = cls === 'emph' ? FX.emph[pid] || 'pulse' : FX.entr[pid] || 'fade';
        const durs = all(eff, 'p:cTn').map(c => num(c, 'dur', NaN)).filter(v => Number.isFinite(v) && v > 1);
        const dur = durs.length ? Math.max(...durs) / 1000 : 0.5;
        const node = attr(eff, 'nodeType', 'clickEffect');
        const delay = num(xpath(eff, 'p:stCondLst', 'p:cond'), 'delay', 0);
        anims.push({ id: Model.uid(), target, cls, fx, dir: DIR[sub] || 'b', dur: fx === 'appear' ? 0.5 : dur, delay: Number.isFinite(delay) ? delay / 1000 : 0, trig: node === 'withEffect' ? 'with' : node === 'afterEffect' ? 'after' : 'click' });
      }
      return anims;
    }
  }

  const groupOf = list => { const b = Model.groupBounds(list); return { id: Model.uid(), type: 'group', ...b, rot: 0, children: list }; };
  const Render_isEmpty = tb => tb.paras.every(p => p.runs.every(r => !r.t && !r.fld));
  function parseTheme(t) {
    const base = Model.makeTheme('office');
    const out = { id: 'imported', name: 'Imported', colors: { ...base.colors }, fonts: { ...base.fonts }, map: {}, fills: [], bgFills: [], lineW: [0.67, 1.33, 2] };
    if (!t) return out;
    out.name = attr(t, 'name', 'Imported') || 'Imported';
    const cs = xpath(t, 'a:themeElements', 'a:clrScheme');
    for (const k of Model.SCHEME) {
      const e = kid(cs, 'a:' + k); if (!e) continue;
      const s = kid(e, 'a:srgbClr'), sy = kid(e, 'a:sysClr');
      if (s) out.colors[k] = '#' + String(attr(s, 'val', '000000')).toLowerCase(); else if (sy) out.colors[k] = '#' + String(attr(sy, 'lastClr', k === 'lt1' ? 'FFFFFF' : '000000')).toLowerCase();
    }
    const fs = xpath(t, 'a:themeElements', 'a:fontScheme');
    const mj = attr(xpath(fs, 'a:majorFont', 'a:latin'), 'typeface'), mn = attr(xpath(fs, 'a:minorFont', 'a:latin'), 'typeface');
    if (mj) out.fonts.major = mj; if (mn) out.fonts.minor = mn;
    const fm = xpath(t, 'a:themeElements', 'a:fmtScheme');
    out.fills = kids(kid(fm, 'a:fillStyleLst')); out.bgFills = kids(kid(fm, 'a:bgFillStyleLst'));
    const lw = kids(kid(fm, 'a:lnStyleLst')).map(l => px(num(l, 'w', 9525))); if (lw.length) out.lineW = lw;
    return out;
  }
  function b64(u8) {
    if (isNode) return Buffer.from(u8).toString('base64');
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // .thmx / .pptx theme import: colours + fonts only
  function readTheme(u8) {
    const { unzipSync, strFromU8 } = getFflate(); const files = unzipSync(new Uint8Array(u8));
    const k = Object.keys(files).find(p => /theme\/theme\d*\.xml$/i.test(p) && !/notes/i.test(p)); if (!k) throw new Error('No theme found in this file');
    const t = parseTheme(X.parse(strFromU8(files[k])));
    return { name: t.name, colors: t.colors, fonts: t.fonts };
  }
  const PPTXReader = { read, readTheme };
  if (isNode) module.exports = PPTXReader; else root.PPTXReader = PPTXReader;
})(typeof self !== 'undefined' ? self : this);
