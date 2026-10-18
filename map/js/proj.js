// Lumen Map — coordinate reference systems and map projections (no dependencies, runs in Node tests).
// Every CRS is a definition object; make(def) returns { forward([lon,lat]) -> [x,y], inverse([x,y]) -> [lon,lat] }.
// Projections are ellipsoidal (Transverse Mercator uses Krüger/Karney 6th-order series, accurate to ~1 mm within the zone).
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, PI = Math.PI;
  const ELLIPSOIDS = {
    WGS84: [6378137, 1 / 298.257223563], GRS80: [6378137, 1 / 298.257222101], Airy1830: [6377563.396, 1 / 299.3249646],
    Clarke1866: [6378206.4, 1 / 294.978698214], Intl1924: [6378388, 1 / 297], Bessel1841: [6377397.155, 1 / 299.1528128],
    Krassowsky1940: [6378245, 1 / 298.3], Sphere: [6371007.181, 0],
  };
  const sq = x => x * x;

  // ---------- ellipsoid helpers ----------
  function ell(def) { const a = def.a || 6378137, f = def.f != null ? def.f : 1 / 298.257223563, e2 = f * (2 - f); return { a, f, e2, e: Math.sqrt(e2) }; }
  // q(φ) of Snyder (authalic)
  function qf(sinp, e, e2) { if (e < 1e-12) return 2 * sinp; const es = e * sinp; return (1 - e2) * (sinp / (1 - es * es) - (1 / (2 * e)) * Math.log((1 - es) / (1 + es))); }
  // inverse of q -> φ (iterative, Snyder 3-16)
  function phiFromQ(q, e, e2) {
    if (e < 1e-12) return Math.asin(Math.max(-1, Math.min(1, q / 2)));
    const qp = qf(1, e, e2); if (Math.abs(Math.abs(q) - qp) < 1e-12) return q > 0 ? PI / 2 : -PI / 2;
    let phi = Math.asin(Math.max(-1, Math.min(1, q / 2)));
    for (let i = 0; i < 25; i++) {
      const s = Math.sin(phi), c = Math.cos(phi), es = e2 * s * s;
      const dphi = sq(1 - es) / (2 * c) * (q / (1 - e2) - s / (1 - es) + (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)));
      phi += dphi; if (Math.abs(dphi) < 1e-13) break;
    }
    return phi;
  }
  const mF = (phi, e2) => Math.cos(phi) / Math.sqrt(1 - e2 * sq(Math.sin(phi)));
  const tF = (phi, e) => Math.tan(PI / 4 - phi / 2) / Math.pow((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi)), e / 2);
  function phiFromT(t, e) { let phi = PI / 2 - 2 * Math.atan(t); for (let i = 0; i < 30; i++) { const es = e * Math.sin(phi), np = PI / 2 - 2 * Math.atan(t * Math.pow((1 - es) / (1 + es), e / 2)); if (Math.abs(np - phi) < 1e-14) { phi = np; break; } phi = np; } return phi; }
  const wrapLon = l => { while (l > PI) l -= 2 * PI; while (l < -PI) l += 2 * PI; return l; };
  // authalic latitude β from φ and back
  function authalic(e, e2) { const qp = qf(1, e, e2); return { qp, Rq: Math.sqrt(qp / 2), beta: phi => Math.asin(Math.max(-1, Math.min(1, qf(Math.sin(phi), e, e2) / qp))), phi: beta => phiFromQ(qp * Math.sin(beta), e, e2) }; }

  // ---------- projection engines: each returns {fwd(lam,phi)->[x,y] in metres (before false origin), inv(x,y)->[lam,phi]} ----------
  const ENGINES = {
    longlat() { return { fwd: (l, p) => [l * R2D, p * R2D], inv: (x, y) => [x * D2R, y * D2R], deg: true }; },
    eqc(d, E) { const lat1 = (d.lat1 || 0) * D2R, k = E.a * Math.cos(lat1); return { fwd: (l, p) => [k * l, E.a * p], inv: (x, y) => [x / k, y / E.a] }; },
    merc(d, E) {
      let k0 = d.k0 != null ? d.k0 : 1; if (d.lat1) k0 = mF(d.lat1 * D2R, E.e2);
      const a = E.a, e = E.e, MAX = 89.5 * D2R;
      return {
        fwd(l, p) { p = Math.max(-MAX, Math.min(MAX, p)); const s = Math.sin(p); return [a * k0 * l, a * k0 * (e ? Math.atanh(s) - e * Math.atanh(e * s) : Math.atanh(s))]; },
        inv(x, y) { const t = Math.exp(-y / (a * k0)); return [x / (a * k0), e ? phiFromT(t, e) : PI / 2 - 2 * Math.atan(t)]; },
      };
    },
    // Web Mercator: spherical formulas on the WGS84 semi-major axis (EPSG:3857)
    webmerc() {
      const a = 6378137, MAX = 85.0511287798066 * D2R;
      return { fwd: (l, p) => { p = Math.max(-MAX, Math.min(MAX, p)); return [a * l, a * Math.log(Math.tan(PI / 4 + p / 2))]; }, inv: (x, y) => [x / a, PI / 2 - 2 * Math.atan(Math.exp(-y / a))] };
    },
    tmerc(d, E) {
      const n = E.f / (2 - E.f), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n, e = E.e, k0 = d.k0 != null ? d.k0 : 1;
      const A = E.a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
      const al = [0, n / 2 - 2 / 3 * n2 + 5 / 16 * n3 + 41 / 180 * n4 - 127 / 288 * n5 + 7891 / 37800 * n6,
        13 / 48 * n2 - 3 / 5 * n3 + 557 / 1440 * n4 + 281 / 630 * n5 - 1983433 / 1935360 * n6,
        61 / 240 * n3 - 103 / 140 * n4 + 15061 / 26880 * n5 + 167603 / 181440 * n6,
        49561 / 161280 * n4 - 179 / 168 * n5 + 6601661 / 7257600 * n6,
        34729 / 80640 * n5 - 3418889 / 1995840 * n6, 212378941 / 319334400 * n6];
      const be = [0, n / 2 - 2 / 3 * n2 + 37 / 96 * n3 - 1 / 360 * n4 - 81 / 512 * n5 + 96199 / 604800 * n6,
        1 / 48 * n2 + 1 / 15 * n3 - 437 / 1440 * n4 + 46 / 105 * n5 - 1118711 / 3870720 * n6,
        17 / 480 * n3 - 37 / 840 * n4 - 209 / 4480 * n5 + 5569 / 90720 * n6,
        4397 / 161280 * n4 - 11 / 504 * n5 - 830251 / 7257600 * n6, 4583 / 161280 * n5 - 108847 / 3991680 * n6, 20648693 / 638668800 * n6];
      function xieta(l, p) {
        const tau = Math.tan(p), sig = Math.sinh(e * Math.atanh(e * tau / Math.sqrt(1 + tau * tau)));
        const taup = tau * Math.sqrt(1 + sig * sig) - sig * Math.sqrt(1 + tau * tau), cl = Math.cos(l);
        const xip = Math.atan2(taup, cl), etap = Math.asinh(Math.sin(l) / Math.sqrt(taup * taup + cl * cl));
        let xi = xip, eta = etap;
        for (let j = 1; j <= 6; j++) { xi += al[j] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap); eta += al[j] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap); }
        return [xi, eta];
      }
      const lat0 = (d.lat0 || 0) * D2R, y0 = lat0 ? k0 * A * xieta(0, lat0)[0] : 0;
      return {
        fwd(l, p) { if (Math.abs(p) >= PI / 2 - 1e-12) return [0, Math.sign(p) * k0 * A * PI / 2 - y0]; const [xi, eta] = xieta(l, p); return [k0 * A * eta, k0 * A * xi - y0]; },
        inv(x, y) {
          const xi = (y + y0) / (k0 * A), eta = x / (k0 * A);
          let xip = xi, etap = eta;
          for (let j = 1; j <= 6; j++) { xip -= be[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); etap -= be[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
          const sh = Math.sinh(etap), sx = Math.sin(xip), cx = Math.cos(xip);
          const taup = sx / Math.sqrt(sh * sh + cx * cx); let tau = taup;
          for (let i = 0; i < 20; i++) {
            const sig = Math.sinh(e * Math.atanh(e * tau / Math.sqrt(1 + tau * tau)));
            const ti = tau * Math.sqrt(1 + sig * sig) - sig * Math.sqrt(1 + tau * tau);
            const dt = (taup - ti) / Math.sqrt(1 + ti * ti) * (1 + (1 - E.e2) * tau * tau) / ((1 - E.e2) * Math.sqrt(1 + tau * tau));
            tau += dt; if (Math.abs(dt) < 1e-14) break;
          }
          return [Math.atan2(sh, cx), Math.atan(tau)];
        },
        valid: (l) => Math.abs(l) < 45 * D2R,
      };
    },
    // Lambert Azimuthal Equal Area, ellipsoidal (Snyder 24) incl. polar aspects
    laea(d, E) {
      const { a, e, e2 } = E, lat0 = (d.lat0 || 0) * D2R, qp = qf(1, e, e2), Rq = a * Math.sqrt(qp / 2);
      const polar = Math.abs(Math.abs(lat0) - PI / 2) < 1e-10 ? Math.sign(lat0) : 0;
      if (polar) return {
        fwd(l, p) { const q = qf(Math.sin(p), e, e2), rho = a * Math.sqrt(Math.max(0, qp - polar * q)); return [rho * Math.sin(l), -polar * rho * Math.cos(l)]; },
        inv(x, y) { const rho = Math.hypot(x, y), q = polar * (qp - sq(rho / a)); return [Math.atan2(x, -polar * y), phiFromQ(q, e, e2)]; },
      };
      const b1 = Math.asin(qf(Math.sin(lat0), e, e2) / qp), D = a * mF(lat0, e2) / (Rq * Math.cos(b1)), sb1 = Math.sin(b1), cb1 = Math.cos(b1);
      return {
        fwd(l, p) {
          const b = Math.asin(Math.max(-1, Math.min(1, qf(Math.sin(p), e, e2) / qp))), cb = Math.cos(b), sb = Math.sin(b), cl = Math.cos(l);
          const den = 1 + sb1 * sb + cb1 * cb * cl; if (den < 1e-12) return [NaN, NaN];
          const B = Rq * Math.sqrt(2 / den); return [B * D * cb * Math.sin(l), (B / D) * (cb1 * sb - sb1 * cb * cl)];
        },
        inv(x, y) {
          const rho = Math.hypot(x / D, D * y); if (rho < 1e-9) return [0, lat0];
          const ce = 2 * Math.asin(Math.min(1, rho / (2 * Rq))), sc = Math.sin(ce), cc = Math.cos(ce);
          const bp = Math.asin(Math.max(-1, Math.min(1, cc * sb1 + D * y * sc * cb1 / rho)));
          return [Math.atan2(x * sc, D * rho * cb1 * cc - D * D * y * sb1 * sc), phiFromQ(qp * Math.sin(bp), e, e2)];
        },
      };
    },
    // Albers Equal-Area Conic, ellipsoidal (Snyder 14)
    aea(d, E) {
      const { a, e, e2 } = E, p1 = d.lat1 * D2R, p2 = (d.lat2 != null ? d.lat2 : d.lat1) * D2R, p0 = (d.lat0 || 0) * D2R;
      const m1 = mF(p1, e2), m2 = mF(p2, e2), q1 = qf(Math.sin(p1), e, e2), q2 = qf(Math.sin(p2), e, e2), q0 = qf(Math.sin(p0), e, e2);
      const n = Math.abs(p1 - p2) > 1e-10 ? (m1 * m1 - m2 * m2) / (q2 - q1) : Math.sin(p1), C = m1 * m1 + n * q1, rho0 = a * Math.sqrt(C - n * q0) / n;
      return {
        fwd(l, p) { const rho = a * Math.sqrt(Math.max(0, C - n * qf(Math.sin(p), e, e2))) / n, th = n * l; return [rho * Math.sin(th), rho0 - rho * Math.cos(th)]; },
        inv(x, y) {
          let rho = Math.hypot(x, rho0 - y), th = Math.atan2(x, rho0 - y);
          if (n < 0) { rho = -rho; th = Math.atan2(-x, -(rho0 - y)); }
          const q = (C - sq(rho * n / a)) / n; return [th / n, phiFromQ(q, e, e2)];
        },
      };
    },
    // Lambert Conformal Conic 1SP / 2SP, ellipsoidal (Snyder 15)
    lcc(d, E) {
      const { a, e, e2 } = E, p0 = (d.lat0 || 0) * D2R; let n, F, k0 = d.k0 != null ? d.k0 : 1;
      if (d.lat1 != null && d.lat2 != null && Math.abs(d.lat1 - d.lat2) > 1e-10) {
        const p1 = d.lat1 * D2R, p2 = d.lat2 * D2R; n = (Math.log(mF(p1, e2)) - Math.log(mF(p2, e2))) / (Math.log(tF(p1, e)) - Math.log(tF(p2, e)));
        F = mF(p1, e2) / (n * Math.pow(tF(p1, e), n)); k0 = 1;
      } else { const p1 = (d.lat1 != null ? d.lat1 : d.lat0) * D2R; n = Math.sin(p1); F = mF(p1, e2) / (n * Math.pow(tF(p1, e), n)); }
      const rho0 = a * F * k0 * Math.pow(tF(p0, e), n);
      return {
        fwd(l, p) { if (Math.abs(p) > PI / 2 - 1e-10 && Math.sign(p) !== Math.sign(n)) return [NaN, NaN]; const rho = a * F * k0 * Math.pow(tF(p, e), n), th = n * l; return [rho * Math.sin(th), rho0 - rho * Math.cos(th)]; },
        inv(x, y) {
          let rho = Math.sign(n) * Math.hypot(x, rho0 - y); let th = Math.atan2(x, rho0 - y); if (n < 0) th = Math.atan2(-x, -(rho0 - y));
          const t = Math.pow(rho / (a * F * k0), 1 / n); return [th / n, phiFromT(t, e)];
        },
      };
    },
    // Cylindrical Equal Area (e.g. EASE-Grid 2.0 / Behrmann), ellipsoidal
    cea(d, E) {
      const { a, e, e2 } = E, k0 = mF((d.lat1 || 0) * D2R, e2);
      return { fwd: (l, p) => [a * k0 * l, a * qf(Math.sin(p), e, e2) / (2 * k0)], inv: (x, y) => [x / (a * k0), phiFromQ(2 * y * k0 / a, e, e2)] };
    },
    // Mollweide (spherical, R = semi-major axis as in PROJ)
    moll(d, E) {
      const R = E.a, S2 = Math.SQRT2;
      return {
        fwd(l, p) {
          let th = p; const k = PI * Math.sin(p);
          if (Math.abs(Math.abs(p) - PI / 2) < 1e-12) th = p; else for (let i = 0; i < 50; i++) { const dth = -(2 * th + Math.sin(2 * th) - k) / (2 + 2 * Math.cos(2 * th)); th += dth; if (Math.abs(dth) < 1e-13) break; }
          return [2 * S2 / PI * R * l * Math.cos(th), S2 * R * Math.sin(th)];
        },
        inv(x, y) { const th = Math.asin(Math.max(-1, Math.min(1, y / (S2 * R)))); const c = Math.cos(th); return [c < 1e-12 ? 0 : PI * x / (2 * S2 * R * c), Math.asin(Math.max(-1, Math.min(1, (2 * th + Math.sin(2 * th)) / PI)))]; },
        world: true,
      };
    },
    // Equal Earth (Šavrič, Patterson & Jenny 2018), ellipsoidal via authalic latitude as in EPSG:8857
    eqearth(d, E) {
      const { a, e, e2 } = E, au = authalic(e, e2), R = a * au.Rq, A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
      const yOf = th => th * (A1 + A2 * th * th + Math.pow(th, 6) * (A3 + A4 * th * th));
      return {
        fwd(l, p) { const th = Math.asin(M * Math.sin(au.beta(p))), t2 = th * th, t6 = Math.pow(th, 6); return [R * l * Math.cos(th) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))), R * yOf(th)]; },
        inv(x, y) {
          let th = y / (R * A1);
          for (let i = 0; i < 30; i++) { const t2 = th * th, t6 = Math.pow(th, 6), f = yOf(th) - y / R, df = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2), dth = f / df; th -= dth; if (Math.abs(dth) < 1e-14) break; }
          const t2 = th * th, t6 = Math.pow(th, 6);
          return [M * x * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)) / (R * Math.cos(th)), au.phi(Math.asin(Math.max(-1, Math.min(1, Math.sin(th) / M))))];
        },
        world: true,
      };
    },
    // Polar stereographic (variant B: latitude of true scale), ellipsoidal (Snyder 21)
    stere(d, E) {
      const { a, e } = E, south = (d.lat0 || 90) < 0, s = south ? -1 : 1, lts = (d.lat1 != null ? d.lat1 : d.lat0 || 90) * D2R * s;
      let k;
      if (Math.abs(lts - PI / 2) < 1e-10) { const k0 = d.k0 != null ? d.k0 : 1; k = 2 * a * k0 / Math.sqrt(Math.pow(1 + e, 1 + e) * Math.pow(1 - e, 1 - e)); }
      else k = a * mF(lts, E.e2) / tF(lts, e);
      return {
        fwd(l, p) { const rho = k * tF(s * p, e); return [rho * Math.sin(l), -s * rho * Math.cos(l)]; },
        inv(x, y) { const rho = Math.hypot(x, y); return [Math.atan2(x, -s * y), s * phiFromT(rho / k, e)]; },
      };
    },
  };

  // ---------- datum shift (Helmert 3/7 parameter, position-vector convention as in WKT TOWGS84) ----------
  function toEcef(l, p, h, E) { const s = Math.sin(p), N = E.a / Math.sqrt(1 - E.e2 * s * s); return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - E.e2) + h) * s]; }
  function fromEcef(x, y, z, E) {
    const l = Math.atan2(y, x), pr = Math.hypot(x, y); let p = Math.atan2(z, pr * (1 - E.e2)), h = 0;
    for (let i = 0; i < 10; i++) { const s = Math.sin(p), N = E.a / Math.sqrt(1 - E.e2 * s * s); h = pr / Math.cos(p) - N; const np = Math.atan2(z, pr * (1 - E.e2 * N / (N + h))); if (Math.abs(np - p) < 1e-14) { p = np; break; } p = np; }
    return [l, p, h];
  }
  function helmert(v, t, inv) {
    const AS = PI / 180 / 3600; let [tx, ty, tz, rx, ry, rz, ds] = [...t, 0, 0, 0, 0, 0, 0, 0].slice(0, 7); rx *= AS; ry *= AS; rz *= AS; const m = 1 + ds * 1e-6;
    if (!inv) { const [x, y, z] = v; return [tx + m * (x - rz * y + ry * z), ty + m * (rz * x + y - rx * z), tz + m * (-ry * x + rx * y + z)]; }
    const x = (v[0] - tx) / m, y = (v[1] - ty) / m, z = (v[2] - tz) / m; return [x + rz * y - ry * z, -rz * x + y + rx * z, ry * x - rx * y + z];
  }
  const WGS = { a: 6378137, e2: (1 / 298.257223563) * (2 - 1 / 298.257223563) };

  // ---------- make: def -> converter ----------
  function make(def) {
    if (def._made) return def._made;
    const E = ell(def), eng = (ENGINES[def.proj] || ENGINES.longlat)(def, E);
    const lon0 = (def.lon0 || 0) * D2R, pm = (def.pm || 0) * D2R, x0 = def.x0 || 0, y0 = def.y0 || 0, u = def.units || 1, tw = def.towgs84 && def.towgs84.some(v => v) ? def.towgs84 : null;
    const out = {
      def, deg: !!eng.deg, world: !!eng.world || def.proj === 'longlat' || def.proj === 'webmerc' || def.proj === 'eqc' || def.proj === 'cea',
      forward(c) { // WGS84 lon/lat degrees -> CRS
        let l = c[0] * D2R, p = c[1] * D2R;
        if (tw) { const r = fromEcef(...helmert(toEcef(l, p, 0, WGS), tw, true), E); l = r[0]; p = r[1]; }
        l = wrapLon(l - pm - lon0);
        if (eng.deg) { const r = eng.fwd(l + lon0, p); return [r[0], r[1]]; }
        const r = eng.fwd(l, p); return [r[0] / u + x0, r[1] / u + y0];
      },
      inverse(c) { // CRS -> WGS84 lon/lat degrees
        let r;
        if (eng.deg) r = [c[0] * D2R - lon0, c[1] * D2R]; else r = eng.inv((c[0] - x0) * u, (c[1] - y0) * u);
        let l = r[0] + lon0 + pm, p = r[1];
        if (tw) { const g = fromEcef(...helmert(toEcef(l, p, 0, E), tw, false), WGS); l = g[0]; p = g[1]; }
        return [wrapLon(l) * R2D, p * R2D];
      },
      validLon: eng.valid ? (lonDeg) => eng.valid(wrapLon(lonDeg * D2R - lon0)) : () => true,
      lon0: (lon0 + pm) * R2D, isGeographic: !!eng.deg,
    };
    Object.defineProperty(def, '_made', { value: out, enumerable: false, configurable: true });
    return out;
  }

  // ---------- registry ----------
  const E84 = { a: 6378137, f: 1 / 298.257223563 }, EGRS = { a: 6378137, f: 1 / 298.257222101 };
  const REG = {
    'EPSG:4326': { name: 'WGS 84 (geographic)', proj: 'longlat', ...E84 },
    'EPSG:3857': { name: 'WGS 84 / Web Mercator', proj: 'webmerc', ...E84 },
    'EPSG:3395': { name: 'WGS 84 / World Mercator', proj: 'merc', ...E84 },
    'EPSG:4087': { name: 'WGS 84 / World Equidistant Cylindrical', proj: 'eqc', ...E84 },
    'EPSG:8857': { name: 'WGS 84 / Equal Earth Greenwich', proj: 'eqearth', ...E84 },
    'ESRI:54009': { name: 'World Mollweide', proj: 'moll', ...E84 },
    'EPSG:6933': { name: 'WGS 84 / NSIDC EASE-Grid 2.0 Global (equal area)', proj: 'cea', lat1: 30, ...E84 },
    'EPSG:3035': { name: 'ETRS89 / LAEA Europe', proj: 'laea', lat0: 52, lon0: 10, x0: 4321000, y0: 3210000, ...EGRS },
    'EPSG:5070': { name: 'NAD83 / Conus Albers', proj: 'aea', lat0: 23, lon0: -96, lat1: 29.5, lat2: 45.5, ...EGRS },
    'ESRI:102003': { name: 'USA Contiguous Albers Equal Area Conic', proj: 'aea', lat0: 37.5, lon0: -96, lat1: 29.5, lat2: 45.5, ...EGRS },
    'EPSG:3577': { name: 'GDA94 / Australian Albers', proj: 'aea', lat0: 0, lon0: 132, lat1: -18, lat2: -36, ...EGRS },
    'EPSG:2154': { name: 'RGF93 / Lambert-93', proj: 'lcc', lat0: 46.5, lon0: 3, lat1: 49, lat2: 44, x0: 700000, y0: 6600000, ...EGRS },
    'EPSG:3034': { name: 'ETRS89 / LCC Europe', proj: 'lcc', lat0: 52, lon0: 10, lat1: 35, lat2: 65, x0: 4000000, y0: 2800000, ...EGRS },
    'EPSG:27700': { name: 'OSGB36 / British National Grid', proj: 'tmerc', lat0: 49, lon0: -2, k0: 0.9996012717, x0: 400000, y0: -100000, a: 6377563.396, f: 1 / 299.3249646, towgs84: [446.448, -125.157, 542.06, 0.15, 0.247, 0.842, -20.489] },
    'EPSG:3413': { name: 'WGS 84 / NSIDC Sea Ice Polar Stereographic North', proj: 'stere', lat0: 90, lat1: 70, lon0: -45, ...E84 },
    'EPSG:3031': { name: 'WGS 84 / Antarctic Polar Stereographic', proj: 'stere', lat0: -90, lat1: -71, lon0: 0, ...E84 },
  };
  function utm(zone, south, base = 'WGS 84', e = E84) { return { name: `${base} / UTM zone ${zone}${south ? 'S' : 'N'}`, proj: 'tmerc', lon0: -183 + 6 * zone, k0: 0.9996, x0: 500000, y0: south ? 10000000 : 0, ...e, zone, south }; }
  const cache = {};
  function get(code) {
    if (code && typeof code === 'object') return code;
    if (cache[code]) return cache[code];
    const r = get2(code); if (r) cache[code] = r; return r;
  }
  function get2(code) {
    code = String(code || '').toUpperCase().replace(/\s+/g, '').replace(/^EPSG::?/, 'EPSG:').replace(/^URN:OGC:DEF:CRS:EPSG::?/, 'EPSG:').replace(/^CRS84$|^OGC:CRS84$|^URN:OGC:DEF:CRS:OGC:1\.3:CRS84$/, 'EPSG:4326');
    if (code === 'EPSG:900913' || code === 'EPSG:3785' || code === 'EPSG:102100' || code === 'ESRI:102100') code = 'EPSG:3857';
    if (code === 'EPSG:4258' || code === 'EPSG:4269' || code === 'EPSG:4283' || code === 'EPSG:4617') { const d = { ...REG['EPSG:4326'], code, name: 'Geographic (GRS80 datum, treated as WGS 84)' }; return d; }
    if (REG[code]) return Object.assign(REG[code], { code });
    const m = /^EPSG:(\d+)$/.exec(code); if (m) {
      const n = +m[1];
      if (n >= 32601 && n <= 32660) return { ...utm(n - 32600, false), code };
      if (n >= 32701 && n <= 32760) return { ...utm(n - 32700, true), code };
      if (n >= 26901 && n <= 26923) return { ...utm(n - 26900, false, 'NAD83', EGRS), code };
      if (n >= 25828 && n <= 25838) return { ...utm(n - 25800, false, 'ETRS89', EGRS), code };
    }
    return null;
  }
  // list for the CRS picker
  function list() {
    const out = Object.keys(REG).map(k => [k, REG[k].name]);
    for (let z = 1; z <= 60; z++) out.push(['EPSG:' + (32600 + z), `WGS 84 / UTM zone ${z}N`]);
    for (let z = 1; z <= 60; z++) out.push(['EPSG:' + (32700 + z), `WGS 84 / UTM zone ${z}S`]);
    return out;
  }
  const utmZoneFor = (lon, lat) => 'EPSG:' + ((lat < 0 ? 32700 : 32600) + Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1)));
  // Local transverse mercator in metres centred on a longitude (used for buffers and planar measures)
  function localTM(lon0, lat0 = 0) { return make({ proj: 'tmerc', lon0, lat0, k0: 1, ...E84 }); }

  // ---------- WKT (WKT1 OGC/ESRI and the common WKT2 keywords) ----------
  function parseWktTree(s) {
    let i = 0; const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    function node() {
      ws(); let m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i)); if (!m) throw new Error('WKT: keyword expected at ' + i);
      const key = m[0].toUpperCase(); i += m[0].length; ws(); const args = [];
      if (s[i] === '[' || s[i] === '(') {
        const close = s[i] === '[' ? ']' : ')'; i++;
        for (;;) {
          ws();
          if (s[i] === '"') { let j = i + 1, str = ''; for (;;) { if (j >= s.length) throw new Error('WKT: unterminated string'); if (s[j] === '"') { if (s[j + 1] === '"') { str += '"'; j += 2; continue; } break; } str += s[j++]; } args.push(str); i = j + 1; }
          else if (/[-+.\d]/.test(s[i])) { m = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i)); args.push(+m[0]); i += m[0].length; }
          else if (/[A-Za-z]/.test(s[i])) args.push(node());
          else throw new Error('WKT: unexpected "' + s[i] + '"');
          ws(); if (s[i] === ',') { i++; continue; } if (s[i] === close || s[i] === ']' || s[i] === ')') { i++; break; } throw new Error('WKT: expected , or ' + close);
        }
      }
      return { key, args };
    }
    return node();
  }
  const kids = (n, ...keys) => n.args.filter(a => a && a.key && keys.includes(a.key));
  const kid = (n, ...keys) => kids(n, ...keys)[0];
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  function fromWkt(text) {
    const t = parseWktTree(String(text).trim());
    let root = t; if (root.key === 'COMPD_CS' || root.key === 'COMPOUNDCRS') root = kid(root, 'PROJCS', 'PROJCRS', 'GEOGCS', 'GEOGCRS', 'GEODCRS') || root;
    const idOf = n => { const a = kid(n, 'AUTHORITY', 'ID'); return a && /^epsg$/i.test(a.args[0]) ? 'EPSG:' + a.args[1] : a && /^esri$/i.test(a.args[0]) ? 'ESRI:' + a.args[1] : null; };
    const name = root.args[0];
    const geog = /^(PROJCS|PROJCRS|PROJECTEDCRS)$/.test(root.key) ? kid(root, 'GEOGCS', 'BASEGEOGCRS', 'BASEGEODCRS', 'GEOGCRS') : root;
    const datum = geog && kid(geog, 'DATUM', 'GEODETICDATUM', 'TRF'), sph = datum && kid(datum, 'SPHEROID', 'ELLIPSOID');
    const def = { name: String(name || 'Custom CRS'), wkt: String(text) };
    if (sph) { def.a = +sph.args[1]; const rf = +sph.args[2]; def.f = rf ? 1 / rf : 0; }
    else { def.a = 6378137; def.f = 1 / 298.257223563; }
    const tw = datum && kid(datum, 'TOWGS84'); if (tw) def.towgs84 = tw.args.map(Number);
    const pmN = geog && kid(geog, 'PRIMEM'); if (pmN && +pmN.args[1]) def.pm = +pmN.args[1];
    const dname = datum ? norm(datum.args[0]) : '';
    if (!tw && dname && !/wgs84|wgs1984|worldgeodeticsystem1984|nad83|northamericandatum1983|etrs|europeanterrestrialreferencesystem1989|gda94|gda2020|grs1980|rgf93|nzgd2000|sirgas|itrf|d_wgs_1984|jgd2000|jgd2011|hartebeesthoek94/.test(dname)) def.datumWarning = String(datum.args[0]);
    if (geog === root || !/^(PROJCS|PROJCRS|PROJECTEDCRS)$/.test(root.key)) { const id = idOf(root); return Object.assign({ code: id, proj: 'longlat' }, def, { name: def.name }); }
    // projected
    const id = idOf(root);
    const unitN = kid(root, 'UNIT', 'LENGTHUNIT'); def.units = unitN ? +unitN.args[1] || 1 : 1;
    let method = kid(root, 'PROJECTION'), params = {};
    const conv = kid(root, 'CONVERSION');
    if (conv) { method = kid(conv, 'METHOD'); kids(conv, 'PARAMETER').forEach(p => { let v = +p.args[1]; const u = kid(p, 'ANGLEUNIT', 'LENGTHUNIT', 'SCALEUNIT', 'UNIT'); if (u && u.key === 'LENGTHUNIT') v = v * (+u.args[1] || 1) / def.units; params[norm(p.args[0])] = v; }); }
    else kids(root, 'PARAMETER').forEach(p => { params[norm(p.args[0])] = +p.args[1]; });
    const P = (...ks) => { for (const k of ks) if (params[k] != null) return params[k]; return undefined; };
    def.x0 = P('falseeasting', 'eastingatfalseorigin', 'eastingatprojectioncentre') || 0;
    def.y0 = P('falsenorthing', 'northingatfalseorigin', 'northingatprojectioncentre') || 0;
    def.lon0 = P('centralmeridian', 'longitudeofcenter', 'longitudeoforigin', 'longitudeofnaturalorigin', 'longitudeoffalseorigin', 'longitudeofprojectioncentre', 'longitudeofcentre') || 0;
    def.lat0 = P('latitudeoforigin', 'latitudeofcenter', 'latitudeofnaturalorigin', 'latitudeoffalseorigin', 'latitudeofprojectioncentre', 'latitudeofcentre') || 0;
    const k0 = P('scalefactor', 'scalefactoratnaturalorigin', 'scalefactoronprojectioncentre'); if (k0 != null) def.k0 = k0;
    const s1 = P('standardparallel1', 'latitudeof1ststandardparallel', 'latitudeofstandardparallel', 'standardparallel'), s2 = P('standardparallel2', 'latitudeof2ndstandardparallel');
    if (s1 != null) def.lat1 = s1; if (s2 != null) def.lat2 = s2;
    const mname = norm(method ? method.args[0] : '');
    if (/mercatorauxiliarysphere|popularvisualisationpseudomercator|pseudomercator/.test(mname) || (id === 'EPSG:3857')) def.proj = 'webmerc';
    else if (/transversemercator|gausskruger|gausskrueger/.test(mname)) def.proj = 'tmerc';
    else if (/^mercator/.test(mname)) { def.proj = 'merc'; if (/2sp/.test(mname) && def.lat1 == null) def.lat1 = def.lat0; }
    else if (/lambertazimuthalequalarea/.test(mname)) def.proj = 'laea';
    else if (/albers/.test(mname)) def.proj = 'aea';
    else if (/lambertconformalconic/.test(mname)) { def.proj = 'lcc'; if (/1sp/.test(mname)) { delete def.lat2; def.lat1 = def.lat0; } else if (def.lat2 == null && def.lat1 != null) def.lat2 = def.lat1; }
    else if (/mollweide/.test(mname)) def.proj = 'moll';
    else if (/equalearth/.test(mname)) def.proj = 'eqearth';
    else if (/cylindricalequalarea|behrmann|lambertcylindricalequalarea/.test(mname)) { def.proj = 'cea'; if (/behrmann/.test(mname)) def.lat1 = 30; }
    else if (/platecarree|equidistantcylindrical|equirectangular/.test(mname)) def.proj = 'eqc';
    else if (/polarstereographic|stereographicnorthpole|stereographicsouthpole/.test(mname)) { def.proj = 'stere'; if (/southpole/.test(mname) || def.lat1 < 0 || def.lat0 < 0) { def.lat0 = -90; } else def.lat0 = 90; }
    else throw new Error('Unsupported projection method: ' + (method ? method.args[0] : '(none)'));
    if (id) def.code = id;
    if (def.proj === 'tmerc' && def.k0 == null) def.k0 = 1;
    return def;
  }
  // known code → WKT1 (ESRI-style .prj) for export
  function toWkt(def) {
    def = get(def) || def;
    const sphName = Math.abs(def.a - 6378137) < 1e-6 && Math.abs(1 / def.f - 298.257223563) < 1e-6 ? 'WGS_1984' : 'Custom';
    const geog = `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["${sphName}",${def.a},${def.f ? 1 / def.f : 0}]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;
    if (def.proj === 'longlat') return geog;
    const methods = { tmerc: 'Transverse_Mercator', merc: 'Mercator', webmerc: 'Mercator_Auxiliary_Sphere', laea: 'Lambert_Azimuthal_Equal_Area', aea: 'Albers', lcc: 'Lambert_Conformal_Conic', moll: 'Mollweide', eqearth: 'Equal_Earth', cea: 'Cylindrical_Equal_Area', eqc: 'Equidistant_Cylindrical', stere: 'Polar_Stereographic' };
    const p = [['False_Easting', def.x0 || 0], ['False_Northing', def.y0 || 0], ['Central_Meridian', def.lon0 || 0]];
    if (def.k0 != null) p.push(['Scale_Factor', def.k0]);
    if (def.lat1 != null) p.push(['Standard_Parallel_1', def.lat1]); if (def.lat2 != null) p.push(['Standard_Parallel_2', def.lat2]);
    p.push(['Latitude_Of_Origin', def.lat0 || 0]); if (def.proj === 'webmerc') p.push(['Auxiliary_Sphere_Type', 0]);
    return `PROJCS["${String(def.name || 'Custom').replace(/[^\w.\-]+/g, '_')}",${geog},PROJECTION["${methods[def.proj]}"],${p.map(([k, v]) => `PARAMETER["${k}",${v}]`).join(',')},UNIT["Meter",1.0]]`;
  }
  // a CRS is "the same" if forward results agree (cheap check used to skip reprojection)
  function same(a, b) { if (a === b) return true; const A = get(a), B = get(b); if (!A || !B) return false; if (A.code && A.code === B.code) return true; return JSON.stringify(strip(A)) === JSON.stringify(strip(B)); }
  const strip = d => { const o = {}; ['proj', 'a', 'f', 'lat0', 'lon0', 'lat1', 'lat2', 'k0', 'x0', 'y0', 'units', 'pm', 'towgs84'].forEach(k => d[k] != null && (o[k] = d[k])); return o; };
  const label = def => { const d = get(def) || def; return d ? (d.code ? d.code + ' — ' : '') + (d.name || 'Custom') : '?'; };

  const api = { make, get, list, fromWkt, toWkt, parseWktTree, utmZoneFor, localTM, same, label, ELLIPSOIDS, ENGINES, D2R, R2D };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MapProj = api;
})(typeof self !== 'undefined' ? self : this);
