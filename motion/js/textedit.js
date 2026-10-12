'use strict';
/* Lumen Motion — on-canvas text editing: click a text layer (Type tool, or double-click with Selection) and type.
   A hidden textarea receives keyboard/IME/clipboard input; the caret and selection are drawn over the viewer. */
(function () {
  const LM = window.LM, st = LM.st, M = LM.M, F = LM.factory;
  const V = LM.viewer;
  const ta = document.createElement('textarea'); ta.id = 'textinput'; ta.spellcheck = false; ta.setAttribute('autocomplete', 'off'); ta.setAttribute('aria-label', 'Text layer editor');
  document.body.appendChild(ta);
  const E = LM.textEdit = {};
  let cur = null, blinkOn = true, blinkT = 0;

  const lineCol = (str, idx) => { const before = str.slice(0, idx), j = before.split('\n').length - 1, ls = before.lastIndexOf('\n') + 1; return [j, [...str.slice(ls, idx)].length]; };
  const idxOf = (str, j, col) => { const lines = str.split('\n'); let i = 0; for (let k = 0; k < j && k < lines.length; k++) i += lines[k].length + 1; return i + [...(lines[j] || '')].slice(0, col).join('').length; };
  function linePositions(lay, j) {
    const lc = lay.chars.filter(c => c.line === j);
    if (!lc.length) return [0];
    return lc.map(c => c.x).concat(lc[lc.length - 1].x + lc[lc.length - 1].w);
  }
  // layer-space point → string index
  function indexAt(L, u, v) {
    const lay = LM.textLayout(L, st.time), asc = lay.size * .78, n = lay.lines.length;
    const j = Math.max(0, Math.min(n - 1, Math.floor((v + asc) / Math.max(1, lay.lead))));
    const xs = linePositions(lay, j); let best = 0, bd = Infinity;
    xs.forEach((x, k) => { const d = Math.abs(x - u); if (d < bd) { bd = d; best = k; } });
    return idxOf(L.text.str, j, best);
  }
  const layerPoint = (L, cx, cy) => V.mapper(L, st.time, LM.comp()).inv(cx, cy) || [1e9, 1e9];
  const restartBlink = () => { blinkOn = true; clearInterval(blinkT); blinkT = setInterval(() => { if (!cur) return clearInterval(blinkT); blinkOn = !blinkOn; LM.draw && LM.draw(); }, 530); };

  E.begin = (L, cx, cy, created) => {
    if (!L || L.type !== 'text') return;
    if (L.locked) return Aero.toast('Layer is locked');
    if (cur) E.finish();
    cur = { L, orig: L.text.str, created: !!created }; st.textEdit = cur;
    if (!st.sel.includes(L.id) || st.sel.length !== 1) LM.select([L.id]);
    ta.value = L.text.str; ta.focus({ preventScroll: true });
    if (cx != null && !created) { const [u, v] = layerPoint(L, cx, cy), i = indexAt(L, u, v); ta.setSelectionRange(i, i); }
    else ta.setSelectionRange(created ? ta.value.length : 0, ta.value.length);
    restartBlink(); LM.status('Typing — Esc or click outside to finish · Enter adds a line'); LM.requestRender();
  };
  E.finish = () => {
    if (!cur) return;
    const { L, orig, created } = cur; cur = null; st.textEdit = null; clearInterval(blinkT);
    if (document.activeElement === ta) ta.blur();
    LM.status('');
    const c = L._c || LM.comp(), s = L.text.str;
    if (!s.trim()) {
      if (created) { c.layers = c.layers.filter(l => l !== L); LM.st.sel = LM.st.sel.filter(id => id !== L.id); LM.linkDoc(LM.doc); LM.st.ver++; LM.emit('structure'); LM.emit('select'); LM.requestRender(); return; }
      L.text.str = orig; LM.touch(); return;
    }
    if (s !== orig || created) {
      if (created || /^Text( \d+)?$/.test(L.name) || L.name === orig.split('\n')[0].slice(0, 24)) L.name = LM.uniqueName(c, s.split('\n')[0].slice(0, 24) || 'Text');
      LM.commit(created ? 'New Text Layer' : 'Edit Text');
    } else LM.requestRender();
  };
  E.active = () => !!cur;
  // Type tool click: edit an existing text layer under the pointer, or start a new one there
  E.toolClick = (cx, cy) => {
    const c = LM.comp(), hit = V.hitLayer(cx, cy, c);
    if (hit && hit.type === 'text') return E.begin(hit, cx, cy);
    const O = st.textOpts, L = F.text(c, '', { font: O.font, size: O.size, fill: O.color, pos: [cx, cy] });
    L.name = 'Text'; L.tr.anchor.v = [0, -O.size * .35]; L.text.align = 'left';
    const i = c.layers.findIndex(l => st.sel.includes(l.id)); c.layers.splice(i >= 0 ? i : 0, 0, L);
    LM.link(c); LM.st.ver++; LM.emit('structure');
    E.begin(L, null, null, true);
  };
  // viewer pointerdown while editing: inside the layer moves the caret; outside finishes editing (returns false so the tool proceeds)
  E.pointerDown = (cx, cy, e) => {
    const L = cur.L, [u, v] = layerPoint(L, cx, cy), b = LM.layerBounds(L, st.time), pad = 12 / V.z;
    if (u >= b[0] - pad && u <= b[2] + pad && v >= b[1] - pad && v <= b[3] + pad) {
      const i = indexAt(L, u, v); if (e.shiftKey) ta.setSelectionRange(Math.min(i, ta.selectionStart), Math.max(i, ta.selectionEnd)); else ta.setSelectionRange(i, i);
      ta.focus({ preventScroll: true }); restartBlink(); LM.draw();
      const move = ev => { const r = document.querySelector('#view').getBoundingClientRect(), [qx, qy] = V.toComp(ev.clientX - r.left, ev.clientY - r.top), [qu, qv] = layerPoint(L, qx, qy), j = indexAt(L, qu, qv); ta.setSelectionRange(Math.min(i, j), Math.max(i, j)); LM.draw(); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
      return true;
    }
    E.finish(); return false;
  };
  // keep the textarea focused when clicking in the viewer
  document.querySelector('#view').addEventListener('mousedown', e => { if (cur) e.preventDefault(); });
  ta.addEventListener('input', () => { if (!cur) return; cur.L.text.str = ta.value; LM.touch(); restartBlink(); });
  ta.addEventListener('keydown', e => {
    if (!cur) return;
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.code === 'NumpadEnter'))) { e.preventDefault(); e.stopPropagation(); E.finish(); return; }
    setTimeout(() => { restartBlink(); LM.draw(); }, 0);
  });
  ta.addEventListener('keyup', () => cur && LM.draw());
  ta.addEventListener('blur', () => setTimeout(() => { if (cur && document.activeElement !== ta) E.finish(); }, 0));
  LM.on('select', () => { if (cur && !st.sel.includes(cur.L.id)) E.finish(); });
  LM.on('compchange', () => E.finish());

  /* ---------- overlay: box, selection, caret ---------- */
  E.drawOverlay = (x, c) => {
    if (!cur) return;
    const L = cur.L; if (!c.layers.includes(L)) { cur = null; st.textEdit = null; return; }
    const t = st.time, mp = V.mapper(L, t, c), lay = LM.textLayout(L, t), asc = lay.size * .78, desc = lay.size * .24;
    const S = (u, v) => { const p = mp.fwd(u, v) || [-1e5, -1e5]; return V.toScreen(p[0], p[1]); };
    const b = lay.bounds, q = [S(b[0] - 6, b[1] - 4), S(b[2] + 6, b[1] - 4), S(b[2] + 6, b[3] + 4), S(b[0] - 6, b[3] + 4)];
    x.save(); x.setLineDash([4, 3]); x.strokeStyle = '#ff7a00'; x.lineWidth = 1; x.beginPath(); q.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.closePath(); x.stroke(); x.setLineDash([]);
    const str = L.text.str, a = Math.min(ta.selectionStart, ta.selectionEnd), z = Math.max(ta.selectionStart, ta.selectionEnd);
    const [j0, c0] = lineCol(str, a), [j1, c1] = lineCol(str, z);
    const quad = (j, xa, xb) => { const y0 = j * lay.lead - asc, y1 = j * lay.lead + desc; return [S(xa, y0), S(xb, y0), S(xb, y1), S(xa, y1)]; };
    if (z > a) {
      x.fillStyle = 'rgba(58,156,255,.38)';
      for (let j = j0; j <= j1; j++) { const xs = linePositions(lay, j), ca = j === j0 ? c0 : 0, cb = j === j1 ? c1 : xs.length - 1; const p = quad(j, xs[Math.min(ca, xs.length - 1)], xs[Math.min(cb, xs.length - 1)] + (j < j1 ? lay.size * .25 : 0)); x.beginPath(); p.forEach((pt, i) => i ? x.lineTo(...pt) : x.moveTo(...pt)); x.closePath(); x.fill(); }
    } else if (blinkOn) {
      const xs = linePositions(lay, j1), cx = xs[Math.min(c1, xs.length - 1)], p = quad(j1, cx, cx);
      x.strokeStyle = '#ff7a00'; x.lineWidth = 2; x.beginPath(); x.moveTo(...p[0]); x.lineTo(...p[3]); x.stroke();
      // keep the IME candidate window near the caret
      const r = document.querySelector('#view').getBoundingClientRect(); ta.style.left = Math.round(r.left + p[3][0]) + 'px'; ta.style.top = Math.round(r.top + p[3][1]) + 'px';
    }
    x.restore();
  };
})();
