'use strict';
/* Lumen Slides — "Open Sample": a complete launch deck that exercises every feature
   (theme, layouts, bullets, shapes, pictures, table, chart, groups, transitions, animations, notes). */
const Sample = (() => {
  const M = Model;
  // procedural aurora landscape (no external assets)
  function auroraImage(w, h, seed = 7) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const sky = x.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#050b24'); sky.addColorStop(0.55, '#16245a'); sky.addColorStop(1, '#2c2a6b'); x.fillStyle = sky; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 420; i++) { const r = rnd() * 1.4 + 0.2; x.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.65})`; x.beginPath(); x.arc(rnd() * w, rnd() * h * 0.62, r, 0, Math.PI * 2); x.fill(); }
    x.globalCompositeOperation = 'lighter'; x.filter = 'blur(18px)';
    const bands = [['rgba(52,211,153,0.55)', 0.30], ['rgba(56,189,248,0.42)', 0.22], ['rgba(167,139,250,0.35)', 0.38]];
    for (const [col, yy] of bands) { x.strokeStyle = col; x.lineWidth = h * 0.09; x.beginPath(); x.moveTo(-50, h * (yy + 0.1)); x.bezierCurveTo(w * 0.3, h * (yy - 0.12), w * 0.55, h * (yy + 0.2), w + 50, h * (yy - 0.05)); x.stroke(); }
    x.filter = 'none'; x.globalCompositeOperation = 'source-over';
    const ridge = (y0, amp, col, k) => { x.fillStyle = col; x.beginPath(); x.moveTo(0, h); x.lineTo(0, y0); for (let i = 0; i <= 40; i++) { const px = i / 40 * w; x.lineTo(px, y0 - Math.abs(Math.sin(i * k + seed)) * amp - rnd() * amp * 0.25); } x.lineTo(w, h); x.closePath(); x.fill(); };
    ridge(h * 0.70, h * 0.16, '#141b3f', 0.55); ridge(h * 0.78, h * 0.10, '#0b1130', 0.9);
    const lake = x.createLinearGradient(0, h * 0.8, 0, h); lake.addColorStop(0, '#1b2a63'); lake.addColorStop(1, '#070b20'); x.fillStyle = lake; x.fillRect(0, h * 0.83, w, h * 0.17);
    x.fillStyle = 'rgba(52,211,153,0.18)'; x.fillRect(0, h * 0.86, w, 3); x.fillStyle = 'rgba(56,189,248,0.12)'; x.fillRect(w * 0.1, h * 0.9, w * 0.7, 2);
    return c.toDataURL('image/jpeg', 0.9);
  }
  function deviceImage(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const bg = x.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#e9f0ff'); bg.addColorStop(1, '#c9d6ff'); x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.save(); x.translate(w / 2, h / 2); x.rotate(-0.12);
    x.shadowColor = 'rgba(20,30,80,.35)'; x.shadowBlur = 40; x.shadowOffsetY = 18;
    const dw = w * 0.36, dh = h * 0.78; x.fillStyle = '#10162e'; x.beginPath(); x.roundRect(-dw / 2, -dh / 2, dw, dh, dw * 0.12); x.fill(); x.shadowColor = 'transparent';
    const sc = x.createLinearGradient(0, -dh / 2, 0, dh / 2); sc.addColorStop(0, '#38bdf8'); sc.addColorStop(0.5, '#a78bfa'); sc.addColorStop(1, '#34d399');
    x.fillStyle = sc; x.beginPath(); x.roundRect(-dw / 2 + 10, -dh / 2 + 10, dw - 20, dh - 20, dw * 0.09); x.fill();
    x.fillStyle = 'rgba(255,255,255,.85)'; x.font = `700 ${Math.round(dw * 0.16)}px Montserrat, sans-serif`; x.textAlign = 'center'; x.fillText('9:41', 0, -dh * 0.22);
    for (let i = 0; i < 3; i++) { x.fillStyle = 'rgba(255,255,255,.28)'; x.beginPath(); x.roundRect(-dw / 2 + 26, -dh * 0.05 + i * dh * 0.16, dw - 52, dh * 0.12, 12); x.fill(); }
    x.restore();
    return c.toDataURL('image/jpeg', 0.9);
  }
  const P = (t, o = {}) => ({ runs: [{ t, ...(o.r || {}) }], ...(o.p || {}) });
  const runs = (list, p = {}) => ({ runs: list.map(r => typeof r === 'string' ? { t: r } : r), ...p });
  function anim(target, fx, o = {}) { return { id: M.uid(), target, cls: o.cls || 'entr', fx, dir: o.dir || 'b', dur: o.dur || 0.5, delay: o.delay || 0, trig: o.trig || 'click' }; }
  async function build() {
    await Fonts.ready;
    const d = M.newDoc({ theme: 'aurora', empty: true });
    const assets = {};
    const add = (id, data, w, h, name) => { assets[id] = { mime: 'image/jpeg', data, w, h, name }; return id; };
    add('aurora', auroraImage(1600, 1000), 1600, 1000, 'aurora.jpg');
    add('device', deviceImage(1200, 900), 1200, 900, 'device.jpg');
    const L = name => d.layouts.find(l => l.name === name).id;
    const slide = (layout, fill, extra = {}) => { const s = M.newSlide(d, L(layout)); fill(s.objects); Object.assign(s, extra); d.slides.push(s); return s; };
    const ph = (objs, type, idx) => objs.find(o => o.ph && o.ph.type === type && (idx == null || o.ph.idx === idx));

    // 1 — title
    const s1 = slide('Title Slide', o => {
      ph(o, 'ctrTitle').text = M.textBody([runs([{ t: 'Lumen ' }, { t: 'Aurora', color: 'accent1' }])]);
      ph(o, 'subTitle').text = M.textBody([P('Product launch plan · Autumn 2026')]);
    }, { transition: { type: 'fade', dur: 1 }, notes: 'Welcome everyone. Today: why Aurora, who it is for, and how we launch it in three phases.\nKeep this under one minute.' });
    const badge = M.shape('roundRect', 540, 90, 200, 40, { fill: { color: 'accent2', alpha: 0.25 }, line: { color: 'accent2', w: 1.5 }, text: M.textBody([P('NEW · v2.0', { r: { b: true, size: 14, color: 'lt1' } })]) }); badge.adj = 0.5;
    s1.objects.push(badge);
    s1.anims = [anim(badge.id, 'zoom', { trig: 'after', delay: 0.3, dur: 0.6 })];

    // 2 — agenda
    const s2 = slide('Title and Content', o => {
      ph(o, 'title').text = M.textBody([P('Agenda')]);
      ph(o, 'body').text = M.textBody([P('Why the market is ready'), P('What Aurora does differently'), P('Three-phase launch roadmap'), P('Beta in October, public release in November', { p: { lvl: 1 } }), P('Pricing and packaging'), P('Next steps & owners')]);
    }, { transition: { type: 'push', dir: 'l', dur: 0.6 }, notes: 'Walk through the agenda quickly. Emphasise that pricing is still open for feedback.' });
    s2.anims = [anim(ph(s2.objects, 'body').id, 'float', { dur: 0.6 })];

    // 3 — why now (two content: bullets + picture)
    const s3 = slide('Two Content', o => {
      ph(o, 'title').text = M.textBody([P('Why now?')]);
      ph(o, 'body', 1).text = M.textBody([runs([{ t: 'Remote teams ', b: true }, 'present 3× more often than in 2020']), runs([{ t: 'Decks are shared, ', b: true }, 'not just shown: they must work offline']), runs([{ t: 'Privacy ', b: true }, 'rules push teams away from cloud-only tools']), P('Our users already ask for it', { r: { color: 'accent1', i: true } })]);
    }, { transition: { type: 'wipe', dir: 'l', dur: 0.7 }, notes: 'The picture is a placeholder for the campaign key visual.' });
    const bodyR = ph(s3.objects, 'body', 2); const ii = s3.objects.indexOf(bodyR);
    const img3 = M.image('aurora', bodyR.x, bodyR.y + 20, bodyR.w, bodyR.h - 40); img3.crop = { l: 0.12, r: 0.12, t: 0, b: 0 }; img3.geom = 'roundRect'; img3.shadow = true; img3.ph = { ...bodyR.ph };
    s3.objects.splice(ii, 1, img3);
    s3.anims = [anim(img3.id, 'fade', { trig: 'with', dur: 0.8 })];

    // 4 — numbers: chart + stat cards
    const s4 = slide('Title Only', o => { ph(o, 'title').text = M.textBody([P('The opportunity in numbers')]); }, { transition: { type: 'cover', dir: 'u', dur: 0.6 }, notes: 'Source: internal survey of 1,240 customers, June 2026.\nPause on the 68 % figure.' });
    const ch = M.chart('col', 80, 176, 700, 470, { title: 'Monthly active presenters (k)', cats: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: '2025', vals: [42, 51, 58, 66] }, { name: '2026', vals: [61, 74, 92, 118] }] });
    ch.labels = false;
    const stat = (y, big, small, col) => { const g = M.shape('roundRect', 830, y, 370, 140, { fill: { color: col, alpha: 0.16 }, line: { color: col, w: 1.5 }, text: M.textBody([P(big, { r: { size: 40, b: true, color: col, font: '+mj' } }), P(small, { r: { size: 15, color: 'tx1' } })], { anchor: 'ctr' }) }); g.adj = 0.1; return g; };
    const st1 = stat(176, '68 %', 'want offline-first editing', 'accent1'), st2 = stat(341, '3.4 M', 'decks exported to PDF per month', 'accent2'), st3 = stat(506, '+93 %', 'growth in presenters year on year', 'accent3');
    s4.objects.push(ch, st1, st2, st3);
    s4.anims = [anim(ch.id, 'wipe', { dir: 'l', trig: 'with', dur: 0.8 }), anim(st1.id, 'fly', { dir: 'r' }), anim(st2.id, 'fly', { dir: 'r', trig: 'after' }), anim(st3.id, 'fly', { dir: 'r', trig: 'after' })];

    // 5 — roadmap: chevrons, connector, group
    const s5 = slide('Title Only', o => { ph(o, 'title').text = M.textBody([P('Launch roadmap')]); }, { transition: { type: 'zoom', dur: 0.7 }, notes: 'Each phase has an owner and an exit criterion. Beta exit = 200 active teams.' });
    const steps = [['Beta', 'Oct', 'accent1'], ['Launch', 'Nov', 'accent2'], ['Scale', 'Q1', 'accent3']];
    const chev = steps.map(([t, m, c], i) => M.shape(i ? 'chevron' : 'homePlate', 90 + i * 370, 250, 380, 130, { fill: { color: c }, text: M.textBody([P(t, { r: { size: 28, b: true, color: 'dk1', font: '+mj' } }), P(m, { r: { size: 16, color: 'dk1' } })], { anchor: 'ctr' }) }));
    const grp = { id: M.uid(), type: 'group', rot: 0, name: 'Phases', children: chev, ...M.groupBounds(chev) };
    const notesTxt = [['200 teams onboarded', 'Feedback loop every week'], ['Public release, press kit', 'Template gallery'], ['Partners & education', 'Enterprise deployment']];
    const cards = notesTxt.map(([a, b], i) => M.shape('rect', 110 + i * 370, 420, 330, 150, { fill: { color: 'bg2', alpha: 0.5 }, line: { color: steps[i][2], w: 1.5, dash: 'dash' }, text: M.textBody([P('• ' + a, { r: { size: 17 } }), P('• ' + b, { r: { size: 17 } })], { anchor: 't' }) }));
    cards.forEach(c => { c.text.paras.forEach(p => p.align = 'l'); c.text.def = { color: 'tx1' }; });
    const arrow = M.shape('line', 0, 0, 0, 0); Editor.setLine(arrow, [110, 620], [1170, 620]); arrow.line = { color: 'tx1:-25', w: 2.5, tail: 'arrow', dash: 'dash' };
    const now = M.textBox(110, 630, 300, 40, 'Today'); now.text.paras[0].runs[0].color = 'tx1:-25'; now.text.paras[0].runs[0].size = 14;
    s5.objects.push(grp, ...cards, arrow, now);
    s5.anims = [anim(grp.id, 'wipe', { dir: 'l', dur: 0.9 }), ...cards.map((c, i) => anim(c.id, 'fade', { trig: i ? 'after' : 'click' })), anim(arrow.id, 'wipe', { dir: 'l', trig: 'with', delay: 0.2 })];

    // 6 — pricing table
    const s6 = slide('Title Only', o => { ph(o, 'title').text = M.textBody([P('Pricing & packaging')]); }, { transition: { type: 'fade', dur: 0.7 }, notes: 'Free stays free forever. Team pricing is per editor, presenters are free.' });
    const tbl = M.table(110, 190, 1060, 5, 4, [['', 'Free', 'Team', 'Enterprise'], ['Editors', 'Unlimited', 'Per seat', 'Per seat'], ['PowerPoint import/export', '✓', '✓', '✓'], ['Shared templates', '—', '✓', '✓'], ['Price / editor / month', '€0', '€6', 'Talk to us']]);
    tbl.style.color = 'accent5'; tbl.rows.forEach(r => r.h = 64);
    tbl.rows.forEach((r, ri) => r.cells.forEach((c, ci) => { c.text.paras.forEach(p => { p.align = ci ? 'c' : 'l'; p.runs.forEach(x => { x.size = 20; if (ri === 0 || ci === 0) x.b = true; if (ri && ri % 2 === 0) x.color = 'dk1'; else if (ri) x.color = 'dk1'; }); }); c.text.anchor = 'ctr'; }));
    tbl.h = tbl.rows.reduce((a, r) => a + r.h, 0);
    const hl = M.shape('roundRect', 640, 160, 270, 26, { fill: { color: 'accent4' }, text: M.textBody([P('MOST POPULAR', { r: { size: 12, b: true, color: 'dk1' } })]) }); hl.adj = 0.5;
    s6.objects.push(tbl, hl);
    s6.anims = [anim(hl.id, 'pulse', { cls: 'emph', dur: 0.8 })];

    // 7 — picture with caption
    const s7 = slide('Picture with Caption', o => {
      ph(o, 'title').text = M.textBody([P('Designed for the stage')]);
      ph(o, 'body', 2).text = M.textBody([P('Presenter view with notes, timer and the next build. A second window for the projector — or one screen, split.'), P(''), P('Works offline. Opens and saves PowerPoint files.', { r: { color: 'accent1', b: true } })]);
    }, { transition: { type: 'split', dir: 'v', dur: 0.7 }, notes: 'Demo the presenter view live here (Alt+F5).' });
    const picPh = ph(s7.objects, 'pic'); const i7 = s7.objects.indexOf(picPh);
    const img7 = M.image('device', picPh.x, picPh.y, picPh.w, picPh.h); img7.ph = { ...picPh.ph }; const ia = 1200 / 900, fa = img7.w / img7.h; img7.crop = ia > fa ? { l: (1 - fa / ia) / 2, r: (1 - fa / ia) / 2, t: 0, b: 0 } : { t: (1 - ia / fa) / 2, b: (1 - ia / fa) / 2, l: 0, r: 0 };
    s7.objects.splice(i7, 1, img7);

    // 8 — closing
    const s8 = slide('Big Statement', o => { ph(o, 'title').text = M.textBody([P('Thank you'), P('Questions? aurora@lumen.example', { r: { size: 24, b: false, color: 'tx1:-25', font: '+mn' } })]); }, { transition: { type: 'fade', dur: 1.2 }, notes: 'Open the floor for questions. Share the deck as PDF afterwards (File → Export → PDF).' });
    const star = M.shape('star5', 600, 92, 80, 80, { fill: { grad: [[0, 'accent4'], [1, 'accent1']], ang: 45 } });
    s8.objects.push(star);
    s8.anims = [anim(star.id, 'spin', { cls: 'emph', trig: 'after', dur: 1.2 })];

    d.footer = { num: true, text: 'Lumen Aurora · Confidential', date: false, skipTitle: true };
    return { doc: d, assets };
  }
  return { build, auroraImage };
})();
