'use strict';
/* File > Open Sample: a synthetic layered poster that shows off groups, layer styles, text, guides and an
   adjustment layer (everything is generated — no external images). */
function openSample() {
  const W = 1600, H = 1000, rnd = rng(7);
  const sky = mk(W, H), sc = cx(sky), g = sc.createLinearGradient(0, 0, 0, H);
  [[0, '#071433'], [0.38, '#2b2468'], [0.66, '#c24a7a'], [0.84, '#ff9a62'], [1, '#ffd08a']].forEach(([p, c]) => g.addColorStop(p, c));
  sc.fillStyle = g; sc.fillRect(0, 0, W, H);
  const stars = mk(W, H * 0.6), st = cx(stars);
  for (let i = 0; i < 260; i++) { const x = rnd() * W, y = rnd() * H * 0.55, r = rnd() * 1.6 + 0.3; st.globalAlpha = 0.35 + rnd() * 0.65 * (1 - y / (H * 0.6)); st.fillStyle = '#fff'; st.beginPath(); st.arc(x, y, r, 0, 7); st.fill(); }
  const sun = mk(300, 300), su = cx(sun), sg = su.createRadialGradient(150, 130, 10, 150, 150, 140); sg.addColorStop(0, '#fffbe0'); sg.addColorStop(0.6, '#ffd36b'); sg.addColorStop(1, '#ff9f45');
  su.fillStyle = sg; su.beginPath(); su.arc(150, 150, 138, 0, 7); su.fill();
  const ridge = (base, amp, seed, color, light) => {
    const c = mk(W, H), x = cx(c), r = rng(seed);
    x.beginPath(); x.moveTo(0, H);
    let y = base; for (let px = 0; px <= W; px += 20) { y = y + (r() - 0.5) * amp + (base - y) * 0.12; x.lineTo(px, y); }
    x.lineTo(W, H); x.closePath();
    const gr = x.createLinearGradient(0, base - amp * 2, 0, H); gr.addColorStop(0, light); gr.addColorStop(1, color); x.fillStyle = gr; x.fill();
    return c;
  };
  const card = mk(1010, 120), cc = cx(card); cc.fillStyle = '#ffffff'; cc.beginPath(); cc.roundRect(4, 4, 1002, 112, 22); cc.fill();
  const T = (text, size, extra) => ({ ...TEXT_DEFAULT, text, size, color: '#ffffff', bold: true, font: 'Segoe UI', ...extra });
  const specs = [
    { name: 'Sky', canvas: sky },
    { name: 'Stars', canvas: stars, opacity: 0.85, blend: 'screen' },
    { name: 'Sun', canvas: sun, x: 1170, y: 400, style: { outerGlow: { on: true, color: '#ff8a3c', size: 110, spread: 8, opacity: 0.85, blend: 'screen' }, innerGlow: { on: true, color: '#fff8d0', size: 40, opacity: 0.6, blend: 'screen' } } },
    { id: 'g1', name: 'Mountains', type: 'group', canvas: null },
    { name: 'Far ridge', parent: 'g1', canvas: ridge(640, 34, 3, '#3d2a6e', '#6b4a9a'), opacity: 0.9 },
    { name: 'Mid ridge', parent: 'g1', canvas: ridge(740, 40, 11, '#21163f', '#4a2f72'), style: { innerShadow: { on: true, color: '#ffb36b', blend: 'screen', opacity: 0.35, angle: 60, distance: 6, size: 10 } } },
    { name: 'Near ridge', parent: 'g1', canvas: ridge(850, 30, 5, '#0b0716', '#1d1233'), style: { dropShadow: { on: true, opacity: 0.5, angle: 90, distance: 10, size: 30 } } },
    { name: 'Glass card', canvas: card, x: 136, y: 352, style: { fill: 0.12, stroke: { on: true, size: 2, color: '#ffffff', opacity: 0.55, position: 'inside' }, dropShadow: { on: true, opacity: 0.35, distance: 12, size: 28 } } },
    { name: 'Title', type: 'text', text: T('Lumen Photo', 156, { ax: 140, ay: 150, tracking: 2 }), style: { gradientOverlay: { on: true, stops: GRADIENT_PRESETS[6][1](), angle: 90 }, bevel: { on: true, size: 7, depth: 160, technique: 'chisel', soften: 1 }, stroke: { on: true, size: 3, color: '#4a2a00' }, dropShadow: { on: true, opacity: 0.6, distance: 10, size: 18 } } },
    { name: 'Subtitle', type: 'text', text: T('Layer styles · Free Transform · Groups · Actions', 44, { ax: 172, ay: 382, bold: false }), style: { dropShadow: { on: true, opacity: 0.45, distance: 3, size: 6 } } },
    { name: 'Vibrance', type: 'adjust', canvas: null, adjust: { kind: 'Vibrance…', params: { v: 25 } } }
  ];
  startDoc(W, H, specs, 'Open Sample', 'Sample poster');
  doc.layers.forEach(L => { if (L.type === 'adjust' && !L.mask) L.mask = { canvas: newMaskCanvas(L, '#fff'), enabled: true }; if (L.type === 'text') L.name = specs.find(s => s.text && s.text.text === L.text.text)?.name || L.name; });
  doc.guides = [{ o: 'v', p: 140 }, { o: 'h', p: 352 }, { o: 'h', p: 472 }];
  doc.active = doc.layers.findIndex(L => L.name === 'Title');
  resetHistory(); pushHistory('Open Sample', 'all'); window.__lumenDirty = false; updateTitle(); updatePanels(); fit();
}
