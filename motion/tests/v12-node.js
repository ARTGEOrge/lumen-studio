// Node-only test (no browser): v1.2 expression links, expression controls, markers in expressions, sandbox.
// Run: node C:/code/lumen-studio/motion/tests/v12-node.js
global.window = global; global.Aero = { esc: s => s };
require('../js/expr.js'); require('../js/model.js');
const LM = global.LM, F = LM.factory, R = {};
const ok = (k, c, info) => { R[k] = c ? 'ok' : 'FAIL ' + JSON.stringify(info); };
const near = (a, b, e = 1e-6) => Array.isArray(a) ? a.every((x, i) => Math.abs(x - b[i]) < e) : Math.abs(a - b) < e;

const c = F.comp({ w: 400, h: 200, fps: 10, duration: 4 });
const ctl = F.nul(c); ctl.name = 'Controls'; ctl.tr.anchor.v = [0, 0];
const sl = F.effect('slider'); sl.p.slider.v = 42; ctl.effects.push(sl);
const sl2 = F.effect('slider'); sl2.name = 'Speed'; sl2.p.slider.k = [{ t: 0, v: 0, i: 'linear', o: 'linear' }, { t: 2, v: 20, i: 'linear', o: 'linear' }]; ctl.effects.push(sl2);
const pc = F.effect('pointCtl'); pc.p.point.v = [10, 20]; ctl.effects.push(pc);
const ang = F.effect('angleCtl'); ang.p.angle.v = 90; ctl.effects.push(ang);
ctl.tr.position.k = [{ t: 0, v: [0, 0], i: 'linear', o: 'linear' }, { t: 2, v: [100, 50], i: 'linear', o: 'linear' }];
ctl.markers = [{ id: 'a', t: 0.5, name: 'beat', dur: 0, label: 1 }];
const box = F.solid(c, '#ff0000', 'Box', 20, 20);
const kid = F.solid(c, '#00ff00', 'Kid', 20, 20); kid.parent = ctl.id; kid.tr.position.v = [5, 5]; kid.tr.anchor.v = [0, 0];
c.layers.push(ctl, box, kid);
c.markers = [{ id: 'm1', t: 1, name: 'Intro', dur: .5, label: 1 }, { id: 'm2', t: 3, name: 'Outro', dur: 0, label: 2 }];
LM.link(c);
const X = (p, src) => { p.x = src; p.xe = true; LM.trusted.add(src); };
const rot = box.tr.rotation, op = box.tr.opacity, pos = box.tr.position;

X(rot, 'thisComp.layer("Controls").effect("Slider Control")("Slider") * 2'); ok('slider link', LM.val(rot, 1) === 84, [LM.val(rot, 1), LM.exprError(rot)]);
X(rot, 'thisComp.layer("Controls").effect("Speed")(1)'); ok('renamed effect + param index', near(LM.val(rot, 1), 10), [LM.val(rot, 1), LM.exprError(rot)]);
X(rot, 'thisComp.layer(1).effect(4)("Angle")'); ok('layer & effect by index', LM.val(rot, 1) === 90, [LM.val(rot, 1), LM.exprError(rot)]);
X(pos, 'thisComp.layer("Controls").effect("Point Control")("Point") + [1, 1]'); ok('point control', near(LM.val(pos, 1), [11, 21]), [LM.val(pos, 1), LM.exprError(pos)]);
X(pos, 'thisComp.layer("Controls").transform.position'); ok('transform link', near(LM.val(pos, 1), [50, 25]), [LM.val(pos, 1), LM.exprError(pos)]);
X(pos, 'thisComp.layer("Controls").position.valueAtTime(time - 1)'); ok('valueAtTime on link', near(LM.val(pos, 2), [50, 25]), [LM.val(pos, 2), LM.exprError(pos)]);
X(pos, 'thisComp.layer("Controls").transform.position.velocity'); ok('velocity', near(LM.val(pos, 1), [50, 25], 1e-3), [LM.val(pos, 1), LM.exprError(pos)]);
X(rot, 'thisComp.layer("Controls").transform.position.speed'); ok('speed', near(LM.val(rot, 1), Math.hypot(50, 25), 1e-3), [LM.val(rot, 1), LM.exprError(rot)]);
X(pos, 'var p = thisComp.layer("Controls").position; p.valueAtTime(0) + [7, 7]'); ok('var holds property', near(LM.val(pos, 1), [7, 7]), [LM.val(pos, 1), LM.exprError(pos)]);
X(rot, 'thisComp.layer("Controls").position[0] / 10'); ok('index into linked value', near(LM.val(rot, 1), 5), [LM.val(rot, 1), LM.exprError(rot)]);
X(pos, 'thisComp.layer("Kid").toComp([0, 0])'); ok('toComp through parent', near(LM.val(pos, 1), [55, 30]), [LM.val(pos, 1), LM.exprError(pos)]);
X(pos, 'thisComp.layer("Kid").parent.position'); ok('parent', near(LM.val(pos, 1), [50, 25]), [LM.val(pos, 1), LM.exprError(pos)]);
X(rot, 'thisComp.layer("Controls").fromComp([150, 25])[0]'); ok('fromComp', near(LM.val(rot, 1), 100), [LM.val(rot, 1), LM.exprError(rot)]);
// own layer shorthands
const s1 = F.effect('slider'); s1.p.slider.v = 7; box.effects.push(s1); LM.link(c);
X(op, 'effect("Slider Control")("Slider") * 10'); ok('bare effect()', LM.val(op, 1) === 70, [LM.val(op, 1), LM.exprError(op)]);
X(op, 'transform.rotation.value + 1'); X(rot, '45'); ok('bare transform', LM.val(op, 1) === 46, [LM.val(op, 1), LM.exprError(op)]);
X(op, 'var scale = 3; scale * 2'); ok('var shadows shorthand', LM.val(op, 1) === 6, [LM.val(op, 1), LM.exprError(op)]);
X(op, 'thisLayer.name == "Box" ? 1 : 0'); ok('thisLayer.name', LM.val(op, 1) === 1, [LM.val(op, 1), LM.exprError(op)]);
// markers
X(op, 'thisComp.marker.numKeys * 100 + thisComp.marker.key(2).time'); ok('comp markers', LM.val(op, 1) === 203, [LM.val(op, 1), LM.exprError(op)]);
X(op, 'var m = thisComp.marker.nearestKey(time); m.index * 10 + m.duration'); ok('nearestKey', near(LM.val(op, 1.2), 10.5) && near(LM.val(op, 2.5), 20), [LM.val(op, 1.2), LM.val(op, 2.5), LM.exprError(op)]);
X(op, 'var n = thisComp.marker.nearestKey(time).index; if (thisComp.marker.key(n).time > time) n = n - 1; n == 0 ? 0 : (time - thisComp.marker.key(n).time) * 100'); ok('time since last marker', near(LM.val(op, 1.3), 30) && LM.val(op, .5) === 0 && near(LM.val(op, 3.2), 20), [LM.val(op, 1.3), LM.val(op, .5), LM.val(op, 3.2), LM.exprError(op)]);
X(op, 'thisComp.layer("Controls").marker.key(1).time * 10'); ok('layer markers', near(LM.val(op, 1), 5), [LM.val(op, 1), LM.exprError(op)]);
// errors are reported, property falls back to its own value
op.v = 55;
X(op, 'thisComp.layer("Nope").opacity'); ok('missing layer error', LM.val(op, 1) === 55 && /not found/.test(LM.exprError(op)), [LM.val(op, 1), LM.exprError(op)]);
X(op, 'effect("Nope")(1)'); ok('missing effect error', LM.val(op, 1) === 55 && /not found/.test(LM.exprError(op)), LM.exprError(op));
X(op, 'thisComp.layer("Controls").effect("Slider Control")("Bogus")'); LM.val(op, 1); ok('missing param error', /no parameter/.test(LM.exprError(op)), LM.exprError(op));
X(op, 'thisComp.layer(1)'); ok('non-value result rejected', LM.val(op, 1) === 55 && LM.exprError(op), LM.exprError(op));
// cycles terminate (depth-limited) instead of hanging
const a1 = box.tr.scale, b1 = ctl.tr.scale;
X(a1, 'thisComp.layer("Controls").scale + [1, 1]'); X(b1, 'thisComp.layer("Box").scale + [1, 1]');
const t0 = Date.now(), v = LM.val(a1, 1); ok('reference cycle terminates', Array.isArray(v) && Date.now() - t0 < 500, [v, Date.now() - t0]);
// sandbox: the new reference objects expose nothing from the host
['thisComp.layer(1).constructor', 'thisComp.layer.constructor', 'thisComp.layer("Controls").effect.f', 'thisComp.layer("Controls").transform.position.get', 'thisComp.layer("Controls").transform.position.constructor', 'thisComp.layer("Controls")["constructor"]', 'thisComp.layer("Controls").effect(1).m', 'thisComp.marker.key.f', 'effect.f("x")'].forEach((src, i) => {
  const r = LM.expr.evaluate(src, { value: 0, time: 1, fps: 10, seed: 1, layerIndex: 2, inPoint: 0, outPoint: 4, comp: { width: 400, height: 200, duration: 4, numLayers: 3 }, valueAtTime: () => 0, loop: () => 0, layer: box, compObj: c, depth: 0 });
  ok('sandbox' + i, !!r.err || typeof r.v === 'number', r);
});
// expressions in an untrusted file still do not run
X(op, '12'); LM.trusted.delete('12'); ok('untrusted link blocked', LM.val(op, 1) === 55);
// original API still works without layer context (old callers)
const r0 = LM.expr.evaluate('thisLayer.index + thisComp.width', { value: 0, time: 0, fps: 30, seed: 1, layerIndex: 3, inPoint: 0, outPoint: 1, comp: { width: 10, height: 10, duration: 1, numLayers: 1 }, valueAtTime: () => 0, loop: () => 0 });
ok('legacy ctx', r0.v === 13, r0);
const fails = Object.entries(R).filter(([, v]) => v !== 'ok');
console.log(JSON.stringify(R));
console.log(fails.length ? `FAILED ${fails.length}` : `ALL ${Object.keys(R).length} PASSED`);
process.exitCode = fails.length ? 1 : 0;
