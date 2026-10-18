// Lumen Stats — sample datasets. Classic datasets (public domain / R datasets package) double as test fixtures.
(function (root) {
  'use strict';
  const MTCARS = `model,mpg,cyl,disp,hp,drat,wt,qsec,vs,am,gear,carb
Mazda RX4,21,6,160,110,3.9,2.62,16.46,0,1,4,4
Mazda RX4 Wag,21,6,160,110,3.9,2.875,17.02,0,1,4,4
Datsun 710,22.8,4,108,93,3.85,2.32,18.61,1,1,4,1
Hornet 4 Drive,21.4,6,258,110,3.08,3.215,19.44,1,0,3,1
Hornet Sportabout,18.7,8,360,175,3.15,3.44,17.02,0,0,3,2
Valiant,18.1,6,225,105,2.76,3.46,20.22,1,0,3,1
Duster 360,14.3,8,360,245,3.21,3.57,15.84,0,0,3,4
Merc 240D,24.4,4,146.7,62,3.69,3.19,20,1,0,4,2
Merc 230,22.8,4,140.8,95,3.92,3.15,22.9,1,0,4,2
Merc 280,19.2,6,167.6,123,3.92,3.44,18.3,1,0,4,4
Merc 280C,17.8,6,167.6,123,3.92,3.44,18.9,1,0,4,4
Merc 450SE,16.4,8,275.8,180,3.07,4.07,17.4,0,0,3,3
Merc 450SL,17.3,8,275.8,180,3.07,3.73,17.6,0,0,3,3
Merc 450SLC,15.2,8,275.8,180,3.07,3.78,18,0,0,3,3
Cadillac Fleetwood,10.4,8,472,205,2.93,5.25,17.98,0,0,3,4
Lincoln Continental,10.4,8,460,215,3,5.424,17.82,0,0,3,4
Chrysler Imperial,14.7,8,440,230,3.23,5.345,17.42,0,0,3,4
Fiat 128,32.4,4,78.7,66,4.08,2.2,19.47,1,1,4,1
Honda Civic,30.4,4,75.7,52,4.93,1.615,18.52,1,1,4,2
Toyota Corolla,33.9,4,71.1,65,4.22,1.835,19.9,1,1,4,1
Toyota Corona,21.5,4,120.1,97,3.7,2.465,20.01,1,0,3,1
Dodge Challenger,15.5,8,318,150,2.76,3.52,16.87,0,0,3,2
AMC Javelin,15.2,8,304,150,3.15,3.435,17.3,0,0,3,2
Camaro Z28,13.3,8,350,245,3.73,3.84,15.41,0,0,3,4
Pontiac Firebird,19.2,8,400,175,3.08,3.845,17.05,0,0,3,2
Fiat X1-9,27.3,4,79,66,4.08,1.935,18.9,1,1,4,1
Porsche 914-2,26,4,120.3,91,4.43,2.14,16.7,0,1,5,2
Lotus Europa,30.4,4,95.1,113,3.77,1.513,16.9,1,1,5,2
Ford Pantera L,15.8,8,351,264,4.22,3.17,14.5,0,1,5,4
Ferrari Dino,19.7,6,145,175,3.62,2.77,15.5,0,1,5,6
Maserati Bora,15,8,301,335,3.54,3.57,14.6,0,1,5,8
Volvo 142E,21.4,4,121,109,4.11,2.78,18.6,1,1,4,2`;
  const PLANT = { ctrl: [4.17, 5.58, 5.18, 6.11, 4.50, 4.61, 5.17, 4.53, 5.33, 5.14], trt1: [4.81, 4.17, 4.41, 3.59, 5.87, 3.83, 6.03, 4.89, 4.32, 4.69], trt2: [6.31, 5.12, 5.54, 5.50, 5.37, 5.29, 4.92, 6.15, 5.80, 5.26] };
  const SLEEP = { drug1: [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0], drug2: [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4] };
  const TOOTH = { // len by supplement (VC, OJ) and dose (0.5, 1, 2), 10 guinea pigs per cell
    'VC 0.5': [4.2, 11.5, 7.3, 5.8, 6.4, 10, 11.2, 11.2, 5.2, 7], 'VC 1': [16.5, 16.5, 15.2, 17.3, 22.5, 17.3, 13.6, 14.5, 18.8, 15.5], 'VC 2': [23.6, 18.5, 33.9, 25.5, 26.4, 32.5, 26.7, 21.5, 23.3, 29.5],
    'OJ 0.5': [15.2, 21.5, 17.6, 9.7, 14.5, 10, 8.2, 9.4, 16.5, 9.7], 'OJ 1': [19.7, 23.3, 23.6, 26.4, 20, 25.2, 25.8, 21.2, 14.5, 27.3], 'OJ 2': [25.5, 26.4, 22.4, 24.5, 24.8, 30.9, 26.4, 27.3, 29.4, 23] };

  function mtcars() {
    const lines = MTCARS.split('\n').slice(1).map(l => l.split(','));
    const names = MTCARS.split('\n')[0].split(',');
    const col = j => lines.map(l => j === 0 ? l[0] : +l[j]);
    const o = {}; names.forEach((n, j) => o[n] = col(j)); return o;
  }

  // ---- dataset builders in the app's document format ----
  const V = (name, type, extra = {}) => ({ name, type, label: '', decimals: type === 'numeric' ? 2 : 0, values: {}, missing: [], measure: type === 'string' ? 'nominal' : type === 'categorical' ? 'nominal' : 'scale', width: 90, ...extra });
  function doc(vars, cols, name) { return { name, vars, cols, n: cols[0].length }; }

  function mtcarsDoc() {
    const m = mtcars();
    const vars = [V('model', 'string', { label: 'Car model', width: 140 }), V('mpg', 'numeric', { label: 'Miles per US gallon', decimals: 1 }), V('cyl', 'categorical', { label: 'Number of cylinders', measure: 'ordinal', values: { 4: '4 cyl', 6: '6 cyl', 8: '8 cyl' } }),
      V('disp', 'numeric', { label: 'Displacement (cu.in.)', decimals: 1 }), V('hp', 'numeric', { label: 'Gross horsepower', decimals: 0 }), V('drat', 'numeric', { label: 'Rear axle ratio' }),
      V('wt', 'numeric', { label: 'Weight (1000 lbs)', decimals: 3 }), V('qsec', 'numeric', { label: '1/4 mile time (s)' }),
      V('vs', 'categorical', { label: 'Engine', values: { 0: 'V-shaped', 1: 'Straight' } }), V('am', 'categorical', { label: 'Transmission', values: { 0: 'Automatic', 1: 'Manual' } }),
      V('gear', 'numeric', { label: 'Forward gears', decimals: 0, measure: 'ordinal' }), V('carb', 'numeric', { label: 'Carburetors', decimals: 0, measure: 'ordinal' })];
    return doc(vars, vars.map(v => m[v.name]), 'mtcars (Motor Trend 1974)');
  }
  function plantDoc() {
    const g = [], w = []; Object.keys(PLANT).forEach((k, i) => PLANT[k].forEach(v => { g.push(i + 1); w.push(v); }));
    const vars = [V('weight', 'numeric', { label: 'Dried plant weight (g)' }), V('group', 'categorical', { values: { 1: 'Control', 2: 'Treatment 1', 3: 'Treatment 2' } })];
    return doc(vars, [w, g], 'PlantGrowth');
  }
  function sleepDoc() {
    const vars = [V('patient', 'numeric', { decimals: 0 }), V('drug1', 'numeric', { label: 'Extra sleep, drug 1 (h)', decimals: 1 }), V('drug2', 'numeric', { label: 'Extra sleep, drug 2 (h)', decimals: 1 })];
    return doc(vars, [SLEEP.drug1.map((_, i) => i + 1), SLEEP.drug1.slice(), SLEEP.drug2.slice()], 'Student’s sleep data');
  }
  function toothDoc() {
    const len = [], supp = [], dose = [];
    Object.entries(TOOTH).forEach(([k, arr]) => { const [s, d] = k.split(' '); arr.forEach(v => { len.push(v); supp.push(s === 'VC' ? 1 : 2); dose.push(+d); }); });
    const vars = [V('len', 'numeric', { label: 'Tooth length', decimals: 1 }), V('supp', 'categorical', { label: 'Supplement', values: { 1: 'Ascorbic acid (VC)', 2: 'Orange juice (OJ)' } }), V('dose', 'categorical', { label: 'Dose (mg/day)', measure: 'ordinal', decimals: 1, values: { 0.5: '0.5 mg', 1: '1 mg', 2: '2 mg' } })];
    return doc(vars, [len, supp, dose], 'ToothGrowth');
  }

  // seeded generator for the demo study
  function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function demoDoc() {
    const R = rng(20261017), N = () => { let u = 0, v = 0; while (!u) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const n = 150, cols = { id: [], group: [], sex: [], age: [], bmi: [], sbp0: [], sbp12: [], change: [], adherence: [], satisfaction: [], responder: [], visit: [], site: [] };
    const sites = ['Leeds', 'Oslo', 'Porto', 'Graz'];
    const start = Date.UTC(2026, 0, 5) / 864e5;
    for (let i = 0; i < n; i++) {
      const g = i % 3 + 1, sex = R() < 0.52 ? 2 : 1, age = Math.round(38 + 12 * N() + (sex === 2 ? 1.5 : 0));
      const bmi = +(26.5 + 3.8 * N() + 0.04 * (age - 45)).toFixed(1);
      const sbp0 = Math.round(148 + 9 * N() + 0.25 * (age - 45) + 0.6 * (bmi - 26));
      const effect = g === 1 ? -3 : g === 2 ? -9 : -14, adh = Math.max(35, Math.min(100, Math.round(82 + 11 * N())));
      const sbp12 = Math.round(sbp0 + effect * (adh / 85) + 7.5 * N());
      const ch = sbp12 - sbp0;
      let sat = Math.max(1, Math.min(5, Math.round(3 + (-ch - 7) / 8 + 0.8 * N())));
      const lp = -0.4 + (-ch - 8) * 0.18 + (adh - 80) * 0.04;
      const resp = R() < 1 / (1 + Math.exp(-lp)) ? 1 : 0;
      cols.id.push(1001 + i); cols.group.push(g); cols.sex.push(sex); cols.age.push(age); cols.bmi.push(bmi); cols.sbp0.push(sbp0); cols.sbp12.push(sbp12);
      cols.change.push(ch); cols.adherence.push(adh); cols.satisfaction.push(sat); cols.responder.push(resp);
      cols.visit.push(start + Math.floor(R() * 120)); cols.site.push(sites[Math.floor(R() * 4)]);
    }
    // a little realism: some missing values and a user-missing code
    [7, 33, 61, 98, 120].forEach(i => cols.sbp12[i] = null); [7, 33, 61, 98, 120].forEach(i => cols.change[i] = null);
    [12, 45, 77, 140].forEach(i => cols.satisfaction[i] = 9); [20, 90].forEach(i => cols.bmi[i] = null);
    const vars = [V('id', 'numeric', { label: 'Participant ID', decimals: 0, measure: 'nominal' }),
      V('group', 'categorical', { label: 'Treatment arm', values: { 1: 'Placebo', 2: 'Low dose', 3: 'High dose' } }),
      V('sex', 'categorical', { label: 'Sex', values: { 1: 'Male', 2: 'Female' } }),
      V('age', 'numeric', { label: 'Age (years)', decimals: 0 }), V('bmi', 'numeric', { label: 'Body-mass index (kg/m²)', decimals: 1 }),
      V('sbp0', 'numeric', { label: 'Systolic BP at baseline (mmHg)', decimals: 0 }), V('sbp12', 'numeric', { label: 'Systolic BP at week 12 (mmHg)', decimals: 0 }),
      V('change', 'numeric', { label: 'Change in systolic BP (mmHg)', decimals: 0 }), V('adherence', 'numeric', { label: 'Pill adherence (%)', decimals: 0 }),
      V('satisfaction', 'categorical', { label: 'Satisfaction with treatment', measure: 'ordinal', values: { 1: 'Very dissatisfied', 2: 'Dissatisfied', 3: 'Neutral', 4: 'Satisfied', 5: 'Very satisfied', 9: 'No answer' }, missing: [9] }),
      V('responder', 'categorical', { label: 'BP controlled at week 12', values: { 0: 'No', 1: 'Yes' } }),
      V('visit', 'date', { label: 'Week-12 visit date', width: 96 }), V('site', 'string', { label: 'Clinic site' })];
    return doc(vars, vars.map(v => cols[v.name]), 'Blood pressure trial (demo)');
  }

  const api = { MTCARS, PLANT, SLEEP, TOOTH, mtcars, mtcarsDoc, plantDoc, sleepDoc, toothDoc, demoDoc, rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LSamples = api;
})(typeof self !== 'undefined' ? self : this);
