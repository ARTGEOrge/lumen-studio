// Lumen Spice — built-in device models (common discrete parts). Values follow the widely published
// manufacturer / SPICE-library models, trimmed to the parameters this engine uses.
(function (root) {
  'use strict';
  const M = (type, desc, params) => ({ type, desc, params });
  const LIB = {
    // diodes
    '1n4148': M('d', 'Small-signal switching diode', { is: 2.52e-9, rs: 0.568, n: 1.752, cjo: 4e-12, m: 0.4, tt: 20e-9, bv: 100, ibv: 100e-6 }),
    '1n914': M('d', 'Small-signal switching diode', { is: 2.52e-9, rs: 0.568, n: 1.752, cjo: 4e-12, m: 0.4, tt: 20e-9, bv: 100, ibv: 100e-6 }),
    '1n4007': M('d', '1 A, 1000 V rectifier', { is: 7.03e-9, rs: 0.0341, n: 1.808, cjo: 10e-12, m: 0.3, tt: 4.3e-6, bv: 1000, ibv: 5e-6 }),
    '1n4001': M('d', '1 A, 50 V rectifier', { is: 7.03e-9, rs: 0.0341, n: 1.808, cjo: 10e-12, m: 0.3, tt: 4.3e-6, bv: 50, ibv: 5e-6 }),
    '1n5819': M('d', '1 A, 40 V Schottky', { is: 31.7e-6, rs: 0.051, n: 1.373, cjo: 110e-12, m: 0.35, vj: 0.35, bv: 40, ibv: 1e-3 }),
    'bat54': M('d', 'Small-signal Schottky', { is: 2e-7, rs: 1.5, n: 1.05, cjo: 10e-12, m: 0.3, vj: 0.35, bv: 30, ibv: 1e-5 }),
    '1n750': M('d', '4.7 V Zener', { is: 880.5e-18, rs: 0.25, n: 1, cjo: 175e-12, m: 0.5516, vj: 0.75, bv: 4.7, ibv: 20.245e-3 }),
    'bzx84c5v1': M('d', '5.1 V Zener', { is: 1e-14, rs: 1, n: 1, cjo: 100e-12, m: 0.4, bv: 5.1, ibv: 5e-3 }),
    'led_red': M('d', 'Red LED (~1.8 V at 10 mA)', { is: 1e-19, n: 1.75, rs: 2, cjo: 30e-12, m: 0.33, bv: 5, ibv: 10e-6 }),
    'led_green': M('d', 'Green LED (~2.1 V at 10 mA)', { is: 1e-22, n: 1.75, rs: 3, cjo: 30e-12, m: 0.33, bv: 5, ibv: 10e-6 }),
    'led_blue': M('d', 'Blue/white LED (~3.0 V at 10 mA)', { is: 1e-27, n: 2.2, rs: 6, cjo: 30e-12, m: 0.33, bv: 5, ibv: 10e-6 }),
    'd': M('d', 'Default diode (IS=1e-14)', {}),
    // BJTs
    '2n3904': M('npn', 'General-purpose NPN', { is: 6.734e-15, vaf: 74.03, bf: 416.4, ne: 1.259, ise: 6.734e-15, ikf: 66.78e-3, br: 0.7371, nc: 2, rc: 1, rb: 10, cjc: 3.638e-12, mjc: 0.3085, vjc: 0.75, fc: 0.5, cje: 4.493e-12, mje: 0.2593, vje: 0.75, tr: 239.5e-9, tf: 301.2e-12 }),
    '2n3906': M('pnp', 'General-purpose PNP', { is: 1.41e-15, vaf: 18.7, bf: 180.7, ne: 1.5, ikf: 80e-3, br: 4.977, nc: 2, rc: 2.5, rb: 10, cjc: 9.728e-12, mjc: 0.5776, vjc: 0.75, fc: 0.5, cje: 8.063e-12, mje: 0.3677, vje: 0.75, tr: 33.42e-9, tf: 179.3e-12 }),
    '2n2222': M('npn', 'General-purpose NPN, 600 mA', { is: 14.34e-15, vaf: 74.03, bf: 255.9, ne: 1.307, ise: 14.34e-15, ikf: 0.2847, br: 6.092, nc: 2, rc: 1, rb: 10, cjc: 7.306e-12, mjc: 0.3416, vjc: 0.75, fc: 0.5, cje: 22.01e-12, mje: 0.377, vje: 0.75, tr: 46.91e-9, tf: 411.1e-12 }),
    'bc547b': M('npn', 'Low-noise NPN (Europe)', { is: 2.39e-14, nf: 1.008, ise: 3.545e-15, ne: 1.541, bf: 294.3, ikf: 0.1357, vaf: 63.2, nr: 1.004, isc: 6.272e-14, nc: 1.243, br: 7.946, ikr: 0.1144, var: 25.9, rb: 1, re: 0.4683, rc: 0.85, cje: 13.58e-12, vje: 0.65, mje: 0.3279, tf: 439.1e-12, cjc: 3.728e-12, vjc: 0.3997, mjc: 0.2955 }),
    'bc557b': M('pnp', 'Low-noise PNP (Europe)', { is: 1.02e-14, nf: 0.9932, ise: 2.894e-16, ne: 1.4, bf: 318.6, ikf: 0.08, vaf: 30, nr: 0.9931, br: 9.3, var: 10, rb: 1, re: 0.5, rc: 0.9, cje: 30e-12, vje: 0.7, mje: 0.33, tf: 0.8e-9, cjc: 9.8e-12, vjc: 0.5, mjc: 0.33 }),
    'npn': M('npn', 'Default NPN (BF=100)', {}),
    'pnp': M('pnp', 'Default PNP (BF=100)', {}),
    // MOSFETs (level 1 fits)
    '2n7000': M('nmos', 'Small-signal N-MOSFET, 60 V', { vto: 2.1, kp: 0.05, lambda: 0.01, cgs: 20e-12, cgd: 5e-12, cbd: 10e-12 }),
    'bs170': M('nmos', 'Small-signal N-MOSFET, 60 V', { vto: 2.0, kp: 0.06, lambda: 0.01, cgs: 24e-12, cgd: 4e-12, cbd: 10e-12 }),
    'irf540': M('nmos', 'Power N-MOSFET, 100 V 28 A', { vto: 3.5, kp: 20, lambda: 0.005, cgs: 1.4e-9, cgd: 150e-12, cbd: 400e-12 }),
    'bs250': M('pmos', 'Small-signal P-MOSFET, 45 V', { vto: -2.5, kp: 0.04, lambda: 0.01, cgs: 60e-12, cgd: 10e-12, cbd: 20e-12 }),
    'irf9540': M('pmos', 'Power P-MOSFET, 100 V 19 A', { vto: -3.5, kp: 10, lambda: 0.005, cgs: 1.4e-9, cgd: 250e-12, cbd: 500e-12 }),
    'nmos': M('nmos', 'CMOS N-channel (KP=120µ, VTO=0.7)', { vto: 0.7, kp: 120e-6, lambda: 0.02, cgso: 3e-10, cgdo: 3e-10 }),
    'pmos': M('pmos', 'CMOS P-channel (KP=40µ, VTO=−0.7)', { vto: -0.7, kp: 40e-6, lambda: 0.03, cgso: 3e-10, cgdo: 3e-10 }),
    // switches
    'sw': M('sw', 'Voltage-controlled switch, on above 0.5 V', { ron: 0.1, roff: 1e9, vt: 0.5, vh: 0.05 }),
  };
  const byType = t => Object.keys(LIB).filter(k => LIB[k].type === t);
  const api = { LIB, byType };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SpiceModels = api;
})(typeof self !== 'undefined' ? self : this);
