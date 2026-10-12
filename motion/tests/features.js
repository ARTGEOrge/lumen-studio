// Headless test (v1.1): shape groups / repeater / merge paths / gradients, time remapping + freeze + reverse +
// frame blending, new effects (pixel checks), 2.5D layers + camera + depth sorting, project round-trip of all of it.
const R = {}, F = LM.factory, ok = (k, c, info) => R[k] = c ? 'ok' : 'FAIL ' + JSON.stringify(info);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = []; addEventListener('error', e => errors.push(e.message)); const ow = console.warn; console.warn = (...a) => { errors.push(a.join(' ')); ow(...a); };
try {
const c = F.comp({ w: 200, h: 100, fps: 10, duration: 4 }); c.bg = '#000000'; LM.doc.comps.push(c);
const cv = new OffscreenCanvas(200, 100), cx = cv.getContext('2d', { willReadFrequently: true });
const px = (x, y) => Array.from(cx.getImageData(x, y, 1, 1).data);
const lit = (x0 = 0, y0 = 0, x1 = 200, y1 = 100, th = 60) => { const d = cx.getImageData(x0, y0, x1 - x0, y1 - y0).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > th) n++; return n; };
const draw = (t = 0) => { LM.link(c); LM.renderInto(c, t, cv); };
/* ---------- shape groups ---------- */
const sh = F.shape(c, 'rect', { size: [20, 20], fill: '#ff0000', pos: [30, 50] }); c.layers = [sh]; draw();
ok('root shape', px(30, 50).join() === '255,0,0,255');
const g = F.shapeGroup('ellipse', { size: [20, 20], fill: '#00ff00', pos: [100, 0] }); sh.shape.groups.push(g); draw();
ok('group renders at its transform', px(130, 50).join() === '0,255,0,255' && px(30, 50)[0] === 255, [px(130, 50)]);
g.gt.scale.v = [200, 200]; draw(); ok('group scale', px(147, 50)[1] === 255 && px(152, 50)[1] === 0, [px(147, 50), px(152, 50)]); g.gt.scale.v = [100, 100];
g.gt.opacity.v = 50; draw(); ok('group opacity', Math.abs(px(130, 50)[1] - 128) < 4, px(130, 50)); g.gt.opacity.v = 100;
g.on = false; draw(); ok('group hidden', px(130, 50)[1] === 0); g.on = true;
// group repeater: 3 copies 30 px apart, opacity 100 → 20 %
g.rep.on = true; g.rep.copies.v = 3; g.rep.position.v = [30, 0]; g.rep.eo.v = 20; draw();
ok('group repeater', px(130, 50)[1] === 255 && Math.abs(px(160, 50)[1] - 153) < 4 && Math.abs(px(190, 50)[1] - 51) < 4, [px(130, 50), px(160, 50), px(190, 50)]);
g.rep.on = false; sh.shape.groups = [];
// layer repeater with rotation around an anchor: 4 copies 90° apart
sh.shape.rep.on = true; sh.shape.rep.copies.v = 4; sh.shape.rep.position.v = [0, 0]; sh.shape.rep.anchor.v = [30, 0]; sh.shape.rep.rotation.v = 90; sh.tr.position.v = [70, 50]; draw();
ok('layer repeater rotation', px(70, 50)[0] === 255 && px(100, 20)[0] === 255 && px(130, 50)[0] === 255 && px(100, 80)[0] === 255 && px(100, 50)[0] === 0, [px(70, 50), px(100, 20), px(130, 50), px(100, 80)]);
sh.shape.rep.offset.v = .5; draw(); ok('repeater fractional offset', px(70, 50)[0] === 0 && px(79, 29)[0] === 255, [px(70, 50), px(79, 29)]);
sh.shape.rep = F.repeater(); sh.tr.position.v = [30, 50];
ok('bounds include groups', (() => { sh.shape.groups.push(F.shapeGroup('rect', { size: [10, 10], pos: [150, 0] })); const b = LM.layerBounds(sh, 0); sh.shape.groups = []; return b[2] >= 154; })());
// merge paths: big rect minus small rect group
sh.shape.size.v = [60, 60]; const hole = F.shapeGroup('rect', { size: [20, 20] }); sh.shape.groups.push(hole); sh.shape.merge = 'subtract'; draw();
ok('merge subtract', px(30, 50)[0] === 0 && px(10, 50)[0] === 255, [px(30, 50), px(10, 50)]);
sh.shape.merge = 'intersect'; draw(); ok('merge intersect', px(30, 50)[0] === 255 && px(10, 50)[0] === 0);
sh.shape.merge = 'add'; sh.shape.stroke.on = true; sh.shape.stroke.color.v = '#0000ff'; sh.shape.stroke.width.v = 4; draw();
ok('merge add + stroke on outline only', px(0, 50)[2] > 150 && px(30, 50)[0] === 255 && px(30, 50)[2] === 0 && px(40, 50)[2] === 0, [px(0, 50), px(30, 50), px(40, 50)]);
sh.shape.merge = 'off'; sh.shape.groups = []; sh.shape.stroke.on = false;
// gradient fill: black → white left to right
sh.shape.fill.gtype = 'linear'; sh.shape.fill.color.v = '#000000'; sh.shape.fill.c2.v = '#ffffff'; sh.shape.fill.gs.v = [-30, 0]; sh.shape.fill.ge.v = [30, 0]; draw();
ok('linear gradient fill', px(3, 50)[0] < 30 && Math.abs(px(30, 50)[0] - 128) < 20 && px(57, 50)[0] > 225, [px(3, 50), px(30, 50), px(57, 50)]);
sh.shape.fill.gtype = 'radial'; sh.shape.fill.gs.v = [0, 0]; sh.shape.fill.ge.v = [30, 0]; draw(); ok('radial gradient fill', px(30, 50)[0] < 20 && px(55, 50)[0] > 200, [px(30, 50), px(55, 50)]);
sh.shape.fill.gtype = 'solid'; sh.shape.stroke.on = true; sh.shape.stroke.gtype = 'linear'; sh.shape.stroke.color.v = '#ff0000'; sh.shape.stroke.c2.v = '#0000ff'; sh.shape.stroke.gs.v = [-30, 0]; sh.shape.stroke.ge.v = [30, 0]; sh.shape.fill.on = false; draw();
ok('gradient stroke', px(1, 50)[0] > 200 && px(59, 50)[2] > 200, [px(1, 50), px(59, 50)]);
sh.shape.stroke.gtype = 'solid'; sh.shape.stroke.on = false; sh.shape.fill.on = true; sh.shape.fill.color.v = '#ff0000'; sh.shape.size.v = [20, 20];
// hit testing hits a group
LM.doc.active = c.id; sh.shape.groups.push(F.shapeGroup('rect', { size: [20, 20], pos: [100, 0] })); LM.link(c); LM.st.time = 0;
ok('hit test group', LM.viewer.hitLayer(130, 50, c) === sh && LM.viewer.hitLayer(80, 50, c) === null); sh.shape.groups = [];
/* ---------- time remapping & frame blending (precomp: red until 1 s, then blue) ---------- */
const sub = F.comp({ w: 200, h: 100, fps: 10, duration: 4, name: 'Sub' }); LM.doc.comps.push(sub);
const so = F.solid(sub, '#ff0000', 'S', 200, 100); so.solid.color.k = [{ t: 0, v: '#ff0000', i: 'hold', o: 'hold' }, { t: 1, v: '#0000ff', i: 'hold', o: 'hold' }]; sub.layers = [so]; LM.link(sub);
const pl = F.precomp(c, sub); c.layers = [pl]; draw(.5); ok('precomp before remap', px(100, 50)[0] === 255);
LM.toggleTimeRemap([pl]); ok('remap keys identity', pl.tm.on && pl.tm.p.k.length === 2 && pl.tm.p.k[1].v === 4);
draw(1.5); ok('remap identity renders', px(100, 50)[2] === 255);
pl.tm.p.k = [{ t: 0, v: 2, i: 'linear', o: 'linear' }, { t: 4, v: 2, i: 'linear', o: 'linear' }]; draw(.2); ok('remap to source 2 s', px(100, 50)[2] === 255);
LM.st.time = 1.5; LM.st.sel = [pl.id]; LM.doc.active = c.id; pl.tm.on = false; delete pl.tm.p.k; LM.freezeFrame(); const fr = c.layers[0];
LM.link(c); LM.renderInto(c, 3.5, cv); ok('freeze frame', fr.tm.on && fr.tm.p.k.length === 1 && px(100, 50)[2] === 255, [fr.tm.p.k]);
LM.toggleTimeRemap([c.layers[0]]); LM.st.time = .5; LM.freezeFrame(); const fr2 = c.layers[0]; LM.link(c); LM.renderInto(c, 3.5, cv); ok('freeze earlier frame', px(100, 50)[0] === 255);
LM.timeReverse(); const rv = c.layers[0]; LM.link(c); LM.renderInto(c, .2, cv); const rvA = px(100, 50); LM.renderInto(c, 3.8, cv); ok('time-reverse', rvA[2] === 255 && px(100, 50)[0] === 255, [rvA, px(100, 50)]);
// frame blending: half speed at 10 fps → frame 0.5 of the source mixes red & blue
rv.tm.p.k = [{ t: 0, v: 0, i: 'linear', o: 'linear' }, { t: 4, v: 2, i: 'linear', o: 'linear' }]; so.solid.color.k = [{ t: 0, v: '#ff0000', i: 'hold', o: 'hold' }, { t: .1, v: '#0000ff', i: 'hold', o: 'hold' }]; LM.link(sub);
LM.link(c); LM.renderInto(c, .1, cv); const nb = px(100, 50); rv.fb = true; LM.renderInto(c, .1, cv); const yb = px(100, 50);
ok('frame blending', nb[0] === 255 && nb[2] === 0 && Math.abs(yb[0] - 128) < 8 && Math.abs(yb[2] - 128) < 8, [nb, yb]);
c.layers = [];
/* ---------- effects ---------- */
const bg = F.solid(c, '#808080', 'G', 200, 100); c.layers = [bg];
const fxOn = (type, set) => { const fx = F.effect(type); set && set(fx); bg.effects = [fx]; draw(); return fx; };
fxOn('levels', fx => { fx.p.inBlack.v = 64; fx.p.inWhite.v = 192; }); ok('levels', Math.abs(px(100, 50)[0] - 128) <= 2 && (fxOn('levels', fx => { fx.p.gamma.v = 2; }), px(100, 50)[0] > 170), px(100, 50));
fxOn('levels', fx => { fx.p.channel.v = 'r'; fx.p.outWhite.v = 0; }); ok('levels channel', px(100, 50)[0] === 0 && px(100, 50)[1] === 128, px(100, 50));
fxOn('curves', fx => { fx.p.curves.v.rgb = [[0, 0], [.5, .8], [1, 1]]; }); ok('curves', Math.abs(px(100, 50)[0] - 204) <= 3, px(100, 50));
fxOn('curves', fx => { fx.p.curves.v.b = [[0, 1], [1, 0]]; }); ok('curves channel', Math.abs(px(100, 50)[2] - 127) <= 3 && px(100, 50)[0] === 128, px(100, 50));
const lut = LM.curveLUT([[0, 0], [.25, .1], [.75, .9], [1, 1]]); let mono = true; for (let i = 1; i < 256; i++) if (lut[i] < lut[i - 1]) mono = false; ok('curve monotone', mono && lut[0] === 0 && lut[255] === 255);
fxOn('fill', fx => { fx.p.color.v = '#00ff00'; }); ok('fill', px(100, 50).join() === '0,255,0,255');
// stroke along a mask
bg.masks = [F.mask('rect', [[50, 20, 0, 0, 0, 0], [150, 20, 0, 0, 0, 0], [150, 80, 0, 0, 0, 0], [50, 80, 0, 0, 0, 0]])];
fxOn('stroke', fx => { fx.p.color.v = '#ff0000'; fx.p.size.v = 6; }); ok('stroke on mask', px(100, 20)[0] === 255 && px(100, 20)[1] === 0 && px(100, 50)[0] === 128, [px(100, 20), px(100, 50)]);
fxOn('stroke', fx => { fx.p.color.v = '#ff0000'; fx.p.size.v = 6; fx.p.style.v = 'transparent'; fx.p.end.v = 50; }); ok('stroke transparent + end', px(100, 50)[1] === 0 && px(100, 20)[0] === 255 && px(150, 50)[0] === 255 && px(100, 80)[0] === 0, [px(100, 50), px(100, 80)]);
bg.masks = [];
// displacement effects on a striped layer
const st2 = F.shape(c, 'rect', { size: [200, 10], fill: '#ffffff', pos: [100, 50] }); c.layers = [st2];
const before = (draw(), lit(0, 0, 200, 100));
st2.effects = [F.effect('wave')]; st2.effects[0].p.height.v = 15; st2.effects[0].p.width.v = 60; draw();
ok('wave warp', lit(0, 30, 200, 44) > 50 && lit(0, 56, 200, 70) > 50 && Math.abs(lit() - before) < before * .35, [lit(0, 30, 200, 44), lit(0, 56, 200, 70)]);
const w0 = (draw(0), cx.getImageData(0, 0, 200, 100).data.join()); draw(.5); ok('wave animates', cx.getImageData(0, 0, 200, 100).data.join() !== w0);
st2.effects = [F.effect('turb')]; st2.effects[0].p.amount.v = 60; st2.effects[0].p.size.v = 40; draw();
ok('turbulent displace', lit(0, 30, 200, 44) + lit(0, 56, 200, 70) > 50, [lit(0, 30, 200, 44), lit(0, 56, 200, 70)]);
st2.effects = [F.effect('rays')]; st2.effects[0].p.center.v = [0, 60]; st2.effects[0].p.radius.v = 80; draw();
ok('light rays', lit(0, 0, 200, 40, 30) > 200 && px(100, 50).join() === '255,255,255,255', lit(0, 0, 200, 40, 30));
// echo: a square moving right leaves fading copies behind
const mv = F.shape(c, 'rect', { size: [10, 10], fill: '#ffffff', pos: [0, 50] }); mv.tr.position.k = [{ t: 0, v: [0, 50], i: 'linear', o: 'linear' }, { t: 4, v: [200, 50], i: 'linear', o: 'linear' }]; c.layers = [mv];
draw(2); const noEcho = px(85, 50)[0];
const ec = F.effect('echo'); ec.p.time.v = -.2; ec.p.count.v = 3; ec.p.decay.v = .5; mv.effects = [ec]; draw(2);
ok('echo', noEcho === 0 && px(100, 50)[0] === 255 && px(90, 50)[0] > 100 && px(90, 50)[0] < 160 && px(80, 50)[0] > 40 && px(80, 50)[0] < 90, [noEcho, px(90, 50), px(80, 50)]);
mv.effects = []; c.layers = [];
/* ---------- 2.5D ---------- */
const q = F.solid(c, '#ffffff', 'Q', 100, 60); q.tr.position.v = [100, 50]; c.layers = [q];
const width = () => { let x0 = 200, x1 = 0; for (let x = 0; x < 200; x++) if (px(x, 50)[0] > 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); } return x1 - x0 + 1; };
draw(); const w2d = width(); q.threeD = true; draw(); const w3d0 = width();
ok('3D layer at z=0 matches 2D', Math.abs(w2d - 100) <= 1 && Math.abs(w3d0 - 100) <= 2, [w2d, w3d0]);
q.tr.rotY.v = 60; draw(); const wr = width(); ok('Y rotation foreshortens', Math.abs(wr - 50) <= 4, wr);
q.tr.rotY.v = 0; q.tr.posZ.v = LM.space.defaultZoom(c); draw(); const wz = width(); ok('Z position: half size at 2× distance', Math.abs(wz - 50) <= 3, wz);
q.tr.posZ.v = 0; q.tr.rotX.v = 45; draw(); { let t0 = 100, t1 = 0; for (let y = 0; y < 100; y++) if (px(100, y)[0] > 128) { t0 = Math.min(t0, y); t1 = Math.max(t1, y); } ok('X rotation foreshortens', Math.abs((t1 - t0 + 1) - 60 * Math.SQRT1_2) <= 4, t1 - t0 + 1); }
// perspective: rotated plane is a trapezoid (near edge wider than far edge)
q.tr.rotX.v = 0; q.tr.rotY.v = 70; q.tr.posZ.v = -100; draw(); { const colH = x => { let n = 0; for (let y = 0; y < 100; y++) if (px(x, y)[0] > 128) n++; return n; }; let xs = []; for (let x = 0; x < 200; x++) if (colH(x)) xs.push(x); const hl = colH(xs[1]), hr = colH(xs[xs.length - 2]); ok('perspective trapezoid', Math.abs(hl - hr) > 4, [hl, hr]); }
q.tr.rotY.v = 0; q.tr.posZ.v = 0;
// camera: zoom doubles size; moving the camera pans; POI aim
const cam = F.camera(c); c.layers = [cam, q]; draw(); const wc = width(); ok('camera default = no change', Math.abs(wc - 100) <= 2, wc);
cam.cam.zoom.v *= 2; draw(); ok('camera zoom', width() >= 190, width()); cam.cam.zoom.v /= 2;
cam.tr.position.v = [130, 50]; cam.cam.poi.v = [130, 50, 0]; draw(); ok('camera pan', px(15, 50)[0] < 50 && px(25, 50)[0] > 200 && px(125, 50)[0] < 50, [px(15, 50), px(25, 50), px(125, 50)]);
cam.tr.position.v = [100, 50]; cam.cam.poi.v = [100, 50, 0];
cam.tr.posZ.v = -LM.space.defaultZoom(c) * 2; draw(); ok('camera dolly back', Math.abs(width() - 50) <= 3, width());
cam.tr.posZ.v = -LM.space.defaultZoom(c); cam.visible = false; draw(); ok('hidden camera ignored', Math.abs(width() - 100) <= 2); cam.visible = true;
// depth sorting: red layer listed on top but farther away is drawn behind green
const red = F.solid(c, '#ff0000', 'R', 60, 60), grn = F.solid(c, '#00ff00', 'G', 60, 60); red.threeD = grn.threeD = true; red.tr.position.v = [100, 50]; grn.tr.position.v = [100, 50];
red.tr.posZ.v = 50; grn.tr.posZ.v = 0; c.layers = [cam, red, grn]; draw(); ok('depth sort far behind near', px(100, 50)[1] === 255 && px(100, 50)[0] === 0, px(100, 50));
red.tr.posZ.v = -50; draw(); ok('depth sort near in front', px(100, 50)[0] === 255, px(100, 50));
// 2D layer above a 3D run stays on top
const top2d = F.solid(c, '#0000ff', 'B', 20, 20); top2d.tr.position.v = [100, 50]; c.layers = [top2d, cam, red, grn]; draw(); ok('2D layer above 3D run', px(100, 50)[2] === 255);
// parenting a 3D layer to a 3D null
const nul = F.nul(c); nul.threeD = true; nul.tr.anchor.v = [0, 0]; nul.tr.position.v = [0, 0]; nul.tr.posZ.v = LM.space.defaultZoom(c); q.parent = nul.id; q.tr.position.v = [100, 50]; c.layers = [nul, q]; draw(); ok('3D parent null', width() > 30 && width() < 70, width()); q.parent = null;
// 3D layer with an effect & mask renders in layer space
q.tr.rotY.v = 0; q.tr.posZ.v = 0; q.effects = [F.effect('fill')]; q.effects[0].p.color.v = '#00ff00'; c.layers = [q]; draw(); ok('3D layer effect', px(100, 50)[1] === 255 && px(100, 50)[0] === 0);
q.effects = []; q.masks = [F.mask('rect', [[0, 0, 0, 0, 0, 0], [50, 0, 0, 0, 0, 0], [50, 60, 0, 0, 0, 0], [0, 60, 0, 0, 0, 0]])]; draw(); ok('3D layer mask', px(70, 50)[0] === 255 && px(130, 50)[0] === 0, [px(70, 50), px(130, 50)]); q.masks = [];
// motion blur with a moving 3D layer
q.tr.posZ.k = [{ t: 0, v: 0, i: 'linear', o: 'linear' }, { t: 1, v: 600, i: 'linear', o: 'linear' }]; q.mb = true; c.mbOn = true; draw(.5); ok('3D motion blur renders', px(100, 50)[0] > 100); c.mbOn = false; delete q.tr.posZ.k; q.tr.posZ.v = 0; q.mb = false;
/* ---------- save / load round-trip ---------- */
const s2 = F.shape(c, 'star', { fill: '#ff8800' }); const gg = F.shapeGroup('ellipse'); gg.rep.on = true; gg.fill.gtype = 'radial'; s2.shape.groups.push(gg); s2.shape.merge = 'add'; s2.threeD = true; s2.tr.rotY.v = 30;
const pl2 = F.precomp(c, sub); pl2.tm.on = true; pl2.tm.p.k = [{ t: 0, v: 1, i: 'hold', o: 'hold' }]; pl2.fb = true;
const ce = F.effect('curves'); ce.p.curves.v.g = [[0, 0], [.3, .7], [1, 1]]; q.effects = [ce, F.effect('echo'), F.effect('rays')];
c.layers = [F.camera(c), s2, pl2, q]; LM.doc.active = c.id; LM.commit('t');
const json = LM.serialize(), o = JSON.parse(json);
o.comps.find(x => x.id === c.id).layers[1].shape.groups.push({ kind: 'bogus', fill: 'x' }); o.comps.find(x => x.id === c.id).layers[3].effects[0].p.curves.v = { rgb: 'evil' }; o.comps.find(x => x.id === c.id).layers[1].tr.rotX = { v: 'NaN' };
await LM.loadProject(JSON.stringify(o), 'rt.lmot'); await sleep(50); document.querySelectorAll('.aero-modal').forEach(x => x.remove());
const c2 = LM.comp(), [cm2, s3, p3, q3] = c2.layers; R.loaded = c2.layers.map(l => l.type).join();
ok('roundtrip types', cm2.type === 'camera' && s3.type === 'shape' && p3.type === 'precomp' && q3.type === 'solid', c2.layers.map(l => l.type));
ok('roundtrip shape', s3.shape.groups.length === 2 && s3.shape.groups[0].rep.on && s3.shape.groups[0].fill.gtype === 'radial' && s3.shape.groups[1].kind === 'rect' && s3.shape.merge === 'add' && s3.threeD && s3.tr.rotY.v === 30 && s3.tr.rotX.v === 0, [s3.shape.groups.length]);
ok('roundtrip time', p3.tm.on && p3.tm.p.k.length === 1 && p3.fb);
ok('roundtrip effects (curves sanitized)', q3.effects.length === 3 && q3.effects[0].p.curves.v.rgb.length === 2 && q3.effects[1].type === 'echo', q3.effects[0].p.curves.v);
const cvB = new OffscreenCanvas(200, 100); LM.renderInto(c2, .5, cvB); ok('roundtrip renders', true);
// loading a v1 file (no new fields) still works
const v1 = { format: 'lumen-motion', version: 1, comps: [{ id: 'a', name: 'Old', w: 100, h: 100, fps: 30, duration: 2, layers: [{ id: 'l1', type: 'shape', name: 'S', shape: { kind: 'rect', size: { v: [50, 50] }, fill: { on: true, color: { v: '#ff0000' }, opacity: { v: 100 } }, stroke: { on: false, color: { v: '#fff' }, width: { v: 2 }, opacity: { v: 100 } }, trim: { start: { v: 0 }, end: { v: 100 }, offset: { v: 0 } } }, tr: { anchor: { v: [0, 0] }, position: { v: [50, 50] }, scale: { v: [100, 100] }, rotation: { v: 0 }, opacity: { v: 100 } } }] }], active: 'a', assets: [] };
await LM.loadProject(JSON.stringify(v1), 'old.lmot'); await sleep(50);
const oc = new OffscreenCanvas(100, 100); LM.renderInto(LM.comp(), 0, oc); const op = Array.from(oc.getContext('2d').getImageData(50, 50, 1, 1).data);
ok('v1 file loads', LM.comp().layers.length === 1 && LM.comp().layers[0].shape.groups.length === 0 && LM.comp().layers[0].tr.posZ.v === 0 && op.join() === '255,0,0,255', op);
ok('no errors', errors.length === 0, errors.slice(0, 5));
} catch (e) { R.ERROR = e.message + ' | ' + (e.stack || '').split('\n').slice(1, 3).join(' '); }
return JSON.stringify(R);
