// node spice/tests/engine.test.js — engine checks against analytic answers.
const assert = require('assert');
const Ex = require('../js/expr.js'), N = require('../js/netlist.js'), E = require('../js/engine.js');
let n = 0, fails = 0;
const t = (name, fn) => { try { fn(); n++; console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e.message); } };
const near = (a, b, tol, what = '') => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} expected ${b}, got ${a} (tol ${tol})`); };
const relNear = (a, b, rel, what = '') => near(a, b, Math.abs(b) * rel, what);
function sim(text, an) {
  const deck = N.parse(text), flat = N.flatten(deck);
  return E.run(flat, an || N.analysisOf(deck));
}
const at = (r, name, x) => {   // linear interpolation of a vector at x
  const v = r.vectors[name]; if (!v) throw new Error('no vector ' + name + ' in ' + Object.keys(r.vectors).join(','));
  const X = r.x; let i = 1; while (i < X.length - 1 && X[i] < x) i++;
  const f = (x - X[i - 1]) / (X[i] - X[i - 1]); return v[i - 1] + (v[i] - v[i - 1]) * f;
};

t('numbers: SPICE suffixes and 4k7 notation', () => {
  assert.strictEqual(Ex.parseNum('1k'), 1000); assert.strictEqual(Ex.parseNum('4k7'), 4700); relNear(Ex.parseNum('10uF'), 1e-5, 1e-12);
  assert.strictEqual(Ex.parseNum('1Meg'), 1e6); relNear(Ex.parseNum('2.2m'), 2.2e-3, 1e-12); relNear(Ex.parseNum('1f'), 1e-15, 1e-9); assert.strictEqual(Ex.parseNum('2R2'), 2.2);
  assert.strictEqual(Ex.parseNum('1e3'), 1000); assert.strictEqual(Ex.evaluate('2*k1+1', n => n === 'k1' ? 3 : undefined), 7);
  assert.strictEqual(Ex.evaluate('sqrt(16)+2^3'), 12); assert.throws(() => Ex.evaluate('constructor'));
});

t('.op: resistor divider and current source', () => {
  const r = sim('divider\nV1 in 0 10\nR1 in out 1k\nR2 out 0 3k\nI1 0 x 2m\nR3 x 0 500\n.op\n');
  near(r.op['V(out)'], 7.5, 1e-6, 'V(out)'); near(r.op['I(V1)'], -2.5e-3, 1e-9, 'I(V1)'); near(r.op['V(x)'], 1, 1e-6, 'V(x)');
});

t('RC step response matches 1-exp(-t/RC)', () => {
  const r = sim('rc\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 5m\n');
  for (const tt of [0.2e-3, 0.5e-3, 1e-3, 2e-3, 4e-3]) near(at(r, 'V(out)', tt), 1 - Math.exp(-tt / 1e-3), 2e-3, 'V(out) @' + tt);
  console.log('      ', r.x.length, 'points,', r.rejected, 'rejected');
});

t('RC step: backward Euler also converges to the analytic curve', () => {
  const r = sim('rc\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.options method=euler\n.tran 5m\n');
  for (const tt of [0.5e-3, 1e-3, 3e-3]) near(at(r, 'V(out)', tt), 1 - Math.exp(-tt / 1e-3), 6e-3, 'V(out) @' + tt);
});

t('series RLC: AC resonance at 1/(2π√LC) with Q = (1/R)√(L/C)', () => {
  // L=10m C=1u → f0 = 1591.55 Hz; R=10 → Q = 10
  const r = sim('rlc\nV1 in 0 AC 1\nR1 in a 10\nL1 a b 10m\nC1 b 0 1u\n.ac dec 400 100 100k\n');
  const I = r.vectors['I(V1)'], f = r.x; let k = 0, best = 0;
  for (let i = 0; i < f.length; i++) { const m = Math.hypot(I.re[i], I.im[i]); if (m > best) { best = m; k = i; } }
  relNear(f[k], 1 / (2 * Math.PI * Math.sqrt(10e-3 * 1e-6)), 0.01, 'f0');
  relNear(best, 0.1, 0.01, '|I| at resonance');
  // capacitor voltage at f0 is Q times the input
  const vc = r.vectors['V(b)']; relNear(Math.hypot(vc.re[k], vc.im[k]), 10, 0.02, '|V(b)| at f0');
});

t('series RLC: transient ringing frequency and decay', () => {
  // underdamped: R=20, L=10m, C=1u → α = R/2L = 1000, ω0 = 10000, ωd = sqrt(ω0²-α²)
  const r = sim('rlc step\nV1 in 0 PULSE(0 1 0 1n)\nR1 in a 20\nL1 a b 10m\nC1 b 0 1u\n.tran 10m\n');
  const a = 1000, w0 = 1e4, wd = Math.sqrt(w0 * w0 - a * a);
  const vc = tt => 1 - Math.exp(-a * tt) * (Math.cos(wd * tt) + a / wd * Math.sin(wd * tt));
  for (const tt of [0.2e-3, 0.5e-3, 1e-3, 2e-3, 5e-3]) near(at(r, 'V(b)', tt), vc(tt), 5e-3, 'V(b) @' + tt);
});

t('RC low-pass: -3 dB at 1/(2πRC) and -45° phase', () => {
  const r = sim('lp\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 159.155n\n.ac dec 100 10 100k\n');
  const v = r.vectors['V(out)'], f = r.x; let k = 0; for (let i = 0; i < f.length; i++) if (Math.abs(Math.log(f[i] / 1000)) < Math.abs(Math.log(f[k] / 1000))) k = i;
  relNear(f[k], 1000, 1e-6, 'grid hits 1 kHz');
  near(20 * Math.log10(Math.hypot(v.re[k], v.im[k])), -3.0103, 0.01, 'dB');
  near(Math.atan2(v.im[k], v.re[k]) * 180 / Math.PI, -45, 0.05, 'phase');
});

t('diode forward drop: V = n·Vt·ln(I/Is + 1) + I·Rs', () => {
  const r = sim('diode\nI1 0 a 1m\nD1 a 0 DX\n.model DX D(IS=1e-14 N=1.5 RS=2)\n.op\n');
  const v = 1.5 * E.VT * Math.log(1e-3 / 1e-14 + 1) + 1e-3 * 2;
  near(r.op['V(a)'], v, 1e-5, 'V(a)');
  const r2 = sim('diode 1n4148\nV1 in 0 5\nR1 in a 1k\nD1 a 0 1N4148\n.op\n');
  assert(r2.op['V(a)'] > 0.6 && r2.op['V(a)'] < 0.75, '1N4148 at ~4.3 mA drops ' + r2.op['V(a)']);
  relNear(r2.op['I(D1)'], (5 - r2.op['V(a)']) / 1000, 1e-6, 'KCL');
});

t('diode: zener breakdown clamps near BV', () => {
  const r = sim('zener\nV1 in 0 12\nR1 in k 1k\nD1 0 k 1N750\n.op\n');
  assert(r.op['V(k)'] > 4.5 && r.op['V(k)'] < 4.9, 'zener voltage ' + r.op['V(k)']);
});

t('BJT bias point: Ebers–Moll solution', () => {
  // NPN, IS=1e-15, BF=100, no Early effect; base driven through RB from 5 V, collector RC to 10 V, emitter grounded
  const r = sim('bias\nVCC vcc 0 10\nVB vb 0 5\nRB vb b 430k\nRC vcc c 2k\nQ1 c b 0 QX\n.model QX NPN(IS=1e-15 BF=100)\n.op\n');
  // solve analytically: Ib = (5 - Vbe)/RB, Ic = BF·Ib, Vbe = Vt ln(Ic/IS + 1)  (forward active, Ir ≈ 0)
  let vbe = 0.7; for (let i = 0; i < 100; i++) { const ib = (5 - vbe) / 430e3; vbe = E.VT * Math.log(100 * ib / 1e-15 + 1); }
  const ib = (5 - vbe) / 430e3, ic = 100 * ib;
  near(r.op['V(b)'], vbe, 1e-5, 'Vbe'); relNear(r.op['Ic(Q1)'], ic, 1e-4, 'Ic'); relNear(r.op['Ib(Q1)'], ib, 1e-4, 'Ib');
  near(r.op['V(c)'], 10 - 2e3 * ic, 1e-3, 'Vc');
});

t('BJT: 2N3904 voltage-divider bias lands in forward active', () => {
  const r = sim('ce\nVCC vcc 0 12\nR1 vcc b 47k\nR2 b 0 10k\nRC vcc c 4.7k\nRE e 0 1k\nQ1 c b e 2N3904\n.op\n');
  const vb = r.op['V(b)'], ve = r.op['V(e)'];
  near(vb - ve, 0.65, 0.07, 'Vbe'); assert(r.op['V(c)'] > ve + 0.3, 'not saturated');
  near(r.op['Ic(Q1)'] + r.op['Ib(Q1)'] + r.op['Ie(Q1)'], 0, 1e-12, 'KCL on transistor');
});

t('PNP mirrors NPN', () => {
  const r = sim('pnp\nVEE vee 0 10\nVB vb 0 5\nRB vb b 430k\nRC c 0 2k\nQ1 c b vee QP\n.model QP PNP(IS=1e-15 BF=100)\n.op\n');
  let veb = 0.7; for (let i = 0; i < 100; i++) { const ib = (5 - veb) / 430e3; veb = E.VT * Math.log(100 * ib / 1e-15 + 1); }
  near(10 - r.op['V(b)'], veb, 1e-5, 'Veb'); relNear(-r.op['Ic(Q1)'] * 2e3, r.op['V(c)'], 1e-6, 'Ic out of collector');
});

t('MOSFET level 1: saturation current β/2·(Vgs−Vt)²·(1+λVds)', () => {
  const r = sim('nmos\nVD d 0 5\nVG g 0 2\nM1 d g 0 0 NX W=10u L=1u\n.model NX NMOS(VTO=0.7 KP=100u LAMBDA=0.02)\n.op\n');
  const beta = 100e-6 * 10, id = beta / 2 * 1.3 * 1.3 * (1 + 0.02 * 5);
  relNear(r.op['Id(M1)'], id, 1e-6, 'Id'); relNear(-r.op['I(VD)'], id, 1e-6, 'I(VD)');
  const r2 = sim('pmos\nVS s 0 5\nVG g 0 3\nM1 0 g s s PX W=10u L=1u\n.model PX PMOS(VTO=-0.7 KP=50u)\n.op\n');
  relNear(-r2.op['Id(M1)'], 50e-6 * 10 / 2 * 1.3 * 1.3, 1e-6, 'PMOS Id (out of drain)');
});

t('CMOS inverter DC sweep switches at mid-rail for matched devices', () => {
  const r = sim('inv\nVDD vdd 0 5\nVIN in 0 0\nMP out in vdd vdd PX W=10u L=1u\nMN out in 0 0 NX W=10u L=1u\n.model NX NMOS(VTO=0.7 KP=100u)\n.model PX PMOS(VTO=-0.7 KP=100u)\n.dc VIN 0 5 0.01\n');
  near(at(r, 'V(out)', 0), 5, 1e-3, 'out high'); near(at(r, 'V(out)', 5), 0, 1e-3, 'out low');
  let k = 0; while (r.vectors['V(out)'][k] > 2.5) k++; near(r.x[k], 2.5, 0.02, 'switching threshold');
});

t('op-amp inverting amplifier gain = −Rf/Rin (finite Avol)', () => {
  const r = sim('inv amp\nV1 in 0 DC 0.1 AC 1\nVP vp 0 15\nVN vn 0 -15\nR1 in m 1k\nR2 m out 10k\nXU1 0 m out vp vn LUMEN_OPAMP Avol=1Meg GBW=10Meg\n.op\n');
  const A = 1e6, g = -10 / (1 + 11 / A);
  relNear(r.op['V(out)'], 0.1 * g, 1e-6, 'V(out)');
  const ac = sim('inv amp\nV1 in 0 DC 0 AC 1\nVP vp 0 15\nVN vn 0 -15\nR1 in m 1k\nR2 m out 10k\nXU1 0 m out vp vn LUMEN_OPAMP Avol=1Meg GBW=10Meg\n.ac dec 10 10 10Meg\n');
  const v = ac.vectors['V(out)']; near(Math.hypot(v.re[0], v.im[0]), 10, 1e-3, '|gain| at 10 Hz');
  // closed-loop bandwidth ≈ GBW/(1+Rf/Rin) = 909 kHz
  let k = 0; while (k < ac.x.length && Math.hypot(v.re[k], v.im[k]) > 10 / Math.SQRT2) k++;
  relNear(ac.x[k], 10e6 / 11, 0.3, '-3 dB bandwidth');
});

t('op-amp: non-inverting gain and rail clipping', () => {
  const r = sim('ni\nV1 in 0 SIN(0 1 1k)\nVP vp 0 5\nVN vn 0 -5\nR1 m 0 1k\nR2 out m 4k\nXU1 in m out vp vn LUMEN_OPAMP\n.tran 2m\n');
  const out = r.vectors['V(out)']; let mx = -1e9, mn = 1e9; out.forEach(v => { mx = Math.max(mx, v); mn = Math.min(mn, v); });
  near(mx, 4.9, 0.08, 'clips at V+ - Vdrop'); near(mn, -4.9, 0.08, 'clips at V- + Vdrop');
  near(at(r, 'V(out)', 0.02e-3), 5 * Math.sin(2 * Math.PI * 1e3 * 0.02e-3), 0.02, 'linear region gain 5');
});

t('controlled sources E G F H', () => {
  const r = sim('ctl\nV1 a 0 2\nR1 a 0 1k\nE1 e 0 a 0 3\nRe e 0 1k\nG1 0 g a 0 1m\nRg g 0 1k\nVs a s 0\nRs s 0 2k\nF1 0 f Vs 2\nRf f 0 1k\nH1 h 0 Vs 1k\nRh h 0 1k\n.op\n');
  near(r.op['V(e)'], 6, 1e-6, 'E'); near(r.op['V(g)'], 2, 1e-6, 'G'); near(r.op['V(f)'], 2, 1e-6, 'F'); near(r.op['V(h)'], 1, 1e-6, 'H');
});

t('subcircuits with parameters flatten correctly', () => {
  const r = sim('sub\n.param RR=1k\n.subckt div a b k params: R=1k\nR1 a m {R}\nR2 m b {R*k2}\n.param k2=1\nE1 k 0 m 0 1\n.ends\nV1 in 0 6\nX1 in 0 out div R={RR*2}\nX2 in 0 out2 div k2=2\n.param k2=2\n.op\n');
  near(r.op['V(out)'], 3, 1e-6, 'X1 (subckt-local k2=1 wins over global)'); near(r.op['V(out2)'], 4, 1e-6, 'X2 instance k2=2'); near(r.op['V(x1.m)'], 3, 1e-6, 'internal node naming');
});

t('switch: voltage-controlled S element', () => {
  const r = sim('sw\nV1 a 0 5\nVC c 0 PULSE(0 1 1m 1u 1u 1m 2m)\nR1 a b 1k\nS1 b 0 c 0 SWX\n.model SWX SW(RON=1 ROFF=1Meg VT=0.5 VH=0.1)\n.tran 4m\n');
  near(at(r, 'V(b)', 0.5e-3), 5 * 1e6 / (1e6 + 1e3), 1e-3, 'off'); near(at(r, 'V(b)', 1.5e-3), 5 * 1 / 1001, 1e-3, 'on');
});

t('sources: PULSE / SIN / PWL / EXP waveforms', () => {
  const ctx = { tstep: 1e-6 };
  const w = (s) => N.parseSource(N.tokens(s), () => undefined, () => { })[0];
  const p = w('PULSE(0 5 1m 1u 1u 2m 5m)'); near(E.waveAt(p, 0.5e-3, ctx), 0, 0); near(E.waveAt(p, 2e-3, ctx), 5, 0); near(E.waveAt(p, 4.5e-3, ctx), 0, 0); near(E.waveAt(p, 7e-3, ctx), 5, 0);
  const s = w('SIN(1 2 1k)'); near(E.waveAt(s, 0.25e-3, ctx), 3, 1e-12);
  const l = w('PWL(0 0 1m 1 2m 1 3m 0)'); near(E.waveAt(l, 0.5e-3, ctx), 0.5, 1e-12); near(E.waveAt(l, 2.5e-3, ctx), 0.5, 1e-12); near(E.waveAt(l, 5e-3, ctx), 0, 0);
  const e = w('EXP(0 1 0 1m 5m 1m)'); near(E.waveAt(e, 1e-3, ctx), 1 - Math.exp(-1), 1e-12);
  const d = w('DC 2 AC 1 90'); near(d.dc, 2, 0); near(d.acMag, 1, 0); near(d.acPhase, 90, 0);
});

t('half-wave rectifier with smoothing capacitor', () => {
  const r = sim('rect\nV1 in 0 SIN(0 10 50)\nD1 in out 1N4007\nC1 out 0 470u\nR1 out 0 1k\n.tran 100m\n');
  const out = r.vectors['V(out)']; let mx = 0; out.forEach(v => mx = Math.max(mx, v));
  near(mx, 9.25, 0.25, 'peak = Vpk − Vf');
  // ripple ≈ Vpk/(f R C) = 9.3/(50·1k·470µ) ≈ 0.4 V
  let mn = 1e9; for (let i = 0; i < r.x.length; i++) if (r.x[i] > 60e-3) mn = Math.min(mn, out[i]);
  near(mx - mn, 0.39, 0.1, 'ripple');
});

t('UIC: LC tank oscillates from an initial capacitor voltage', () => {
  const r = sim('lc\nC1 a 0 1u IC=1\nL1 a 0 1m\n.tran 1u 1m uic\n');
  const w0 = 1 / Math.sqrt(1e-3 * 1e-6);
  for (const tt of [0, 50e-6, 100e-6, 300e-6]) near(at(r, 'V(a)', tt), Math.cos(w0 * tt), 0.02, 'V(a) @' + tt);
});

t('netlist parser: continuation lines, comments, LTspice ; comments', () => {
  const d = N.parse('* title line\nR1 a b\n+ 1k ; inline\n* comment\nV1 a 0 PULSE(0 1\n+ 0 1n 1n 1m 2m)\n.tran 0 1m 0 1u\n.end\n');
  assert.strictEqual(d.elements.length, 2); assert.strictEqual(d.analyses[0].tmax, 1e-6); assert.strictEqual(d.title, 'title line');
});

t('errors: floating subnet and unknown model are reported clearly', () => {
  assert.throws(() => sim('x\nV1 a 0 1\nD1 a 0 NOPE\n.op\n'), /Model "nope" not found/);
  assert.throws(() => sim('x\nV1 a 0 1\nV2 a 0 2\n.op\n'), /Singular/);
});

t('coupled inductors (K): transformer ratio and AC coupling', () => {
  // 1:2 turns ratio → L2 = 4·L1; k ≈ 1 → V(s) ≈ 2·V(p) into a light load
  const r = sim('xfmr\nV1 p 0 SIN(0 1 1k) AC 1 Rser=0.1\nL1 p 0 10m\nL2 s 0 40m\nK1 L1 L2 0.9999\nRL s 0 100k\n.tran 0 3m 0 5u\n');
  let mx = 0; r.vectors['V(s)'].forEach(v => mx = Math.max(mx, Math.abs(v))); near(mx, 2, 0.02, 'secondary peak');
  const ac = sim('xfmr ac\nV1 p 0 AC 1 Rser=1u\nL1 p 0 10m\nL2 s 0 40m\nK1 L1 L2 0.5\nRL s 0 1Meg\n.ac lin 1 1k 1k\n');
  near(Math.hypot(ac.vectors['V(s)'].re[0], ac.vectors['V(s)'].im[0]), 0.5 * 2, 1e-3, 'open-circuit secondary = k·√(L2/L1)');
});

t('LTspice-style netlists: Rser, .backanno, opamp from opamp.sub', () => {
  const r = sim('* C:\\path\\x.asc\nV1 in 0 1 Rser=1\nR1 in m 1k\nR2 m out 2k\nXU1 0 m out opamp Aol=100K GBW=10Meg\n.lib opamp.sub\n.op\n.backanno\n.end\n');
  near(r.op['V(out)'], -2 * 1000 / 1001 / (1 + 3.003 / 1e5), 1e-4, 'inverting gain with source resistance');
});

console.log(`\n${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
