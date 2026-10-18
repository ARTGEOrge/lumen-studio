// Lumen Stress — result exports: nodal CSV, legacy VTK (ParaView) and a one-page PNG report.
(function (root, factory) { const m = factory(); if (typeof module === 'object' && module.exports) module.exports = m; else root.StressReport = m; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const f = v => Number.isFinite(v) ? (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-4 && v !== 0) ? v.toExponential(6) : +v.toPrecision(8)) : '';
  const MODEL = { stress: 'Plane stress', strain: 'Plane strain', axi: 'Axisymmetric' };

  function csv(doc, mesh, res) {
    const dim = mesh.kind === 'H8' ? 3 : 2, nn = mesh.nodes.length / dim, P = mesh.nodes, L = [];
    if (res.modes) {
      L.push('# Lumen Stress modal results — ' + doc.name, 'mode,frequency_Hz');
      res.modes.forEach((m, i) => L.push(`${i + 1},${f(m.f)}`)); L.push('');
      const hdr = ['node', 'x_mm', 'y_mm'].concat(dim === 3 ? ['z_mm'] : []); res.modes.forEach((m, i) => ['x', 'y', 'z'].slice(0, dim).forEach(c => hdr.push(`mode${i + 1}_u${c}`)));
      L.push(hdr.join(','));
      for (let n = 0; n < nn; n++) { const r = [n + 1]; for (let c = 0; c < dim; c++) r.push(f(P[n * dim + c])); res.modes.forEach(m => { for (let c = 0; c < dim; c++) r.push(f(m.u[n * dim + c])); }); L.push(r.join(',')); }
      return L.join('\n') + '\n';
    }
    const s2 = doc.study.model === 'axi' ? ['sr_MPa', 'sz_MPa', 'trz_MPa', 'shoop_MPa'] : ['sx_MPa', 'sy_MPa', 'txy_MPa', 'sz_MPa'];
    const hdr = dim === 3 ? ['node', 'x_mm', 'y_mm', 'z_mm', 'ux_mm', 'uy_mm', 'uz_mm', 'u_mm', 'sx_MPa', 'sy_MPa', 'sz_MPa', 'txy_MPa', 'tyz_MPa', 'tzx_MPa'] : ['node', 'x_mm', 'y_mm', 'ux_mm', 'uy_mm', 'u_mm', ...s2];
    L.push('# Lumen Stress static results — ' + doc.name + ' — nodal averaged stresses, units mm · N · MPa');
    L.push(hdr.concat(['von_mises_MPa', 's1_MPa', 's2_MPa', 's3_MPa', 'max_shear_MPa', 'safety_factor']).join(','));
    for (let n = 0; n < nn; n++) {
      const r = [n + 1]; for (let c = 0; c < dim; c++) r.push(f(P[n * dim + c])); for (let c = 0; c < dim; c++) r.push(f(res.u[n * dim + c])); r.push(f(res.umag[n]));
      for (let c = 0; c < res.ns; c++) r.push(f(res.stress[n * res.ns + c]));
      r.push(f(res.vm[n]), f(res.s1[n]), f(res.s2[n]), f(res.s3[n]), f(res.tau[n]), f(res.sf[n])); L.push(r.join(','));
    }
    return L.join('\n') + '\n';
  }

  function vtk(doc, mesh, res) {
    const is3 = mesh.kind === 'H8', dim = is3 ? 3 : 2, npe = is3 ? 8 : 6, nn = mesh.nodes.length / dim, ne = mesh.elems.length / npe, P = mesh.nodes, L = [];
    L.push('# vtk DataFile Version 3.0', ('Lumen Stress ' + doc.name).replace(/[\r\n]/g, ' ').slice(0, 250), 'ASCII', 'DATASET UNSTRUCTURED_GRID', `POINTS ${nn} double`);
    for (let n = 0; n < nn; n++) L.push(is3 ? `${f(P[n * 3])} ${f(P[n * 3 + 1])} ${f(P[n * 3 + 2])}` : `${f(P[n * 2])} ${f(P[n * 2 + 1])} 0`);
    L.push(`CELLS ${ne} ${ne * (npe + 1)}`);
    for (let e = 0; e < ne; e++) L.push(npe + ' ' + Array.from(mesh.elems.subarray(e * npe, e * npe + npe)).join(' '));
    L.push(`CELL_TYPES ${ne}`); const ct = is3 ? '12' : '22'; for (let e = 0; e < ne; e++) L.push(ct);
    L.push(`POINT_DATA ${nn}`);
    const vec = (name, u) => { L.push(`VECTORS ${name} double`); for (let n = 0; n < nn; n++) L.push(is3 ? `${f(u[n * 3])} ${f(u[n * 3 + 1])} ${f(u[n * 3 + 2])}` : `${f(u[n * 2])} ${f(u[n * 2 + 1])} 0`); };
    const sca = (name, a, comps = 1, c = 0) => { L.push(`SCALARS ${name} double 1`, 'LOOKUP_TABLE default'); for (let n = 0; n < nn; n++) L.push(String(f(a[n * comps + c]))); };
    if (res.modes) { res.modes.forEach((m, i) => vec(`mode_${i + 1}_${m.f.toFixed(2)}Hz`, m.u)); return L.join('\n') + '\n'; }
    vec('displacement_mm', res.u); sca('von_mises_MPa', res.vm); sca('max_principal_MPa', res.s1); sca('min_principal_MPa', res.s3); sca('safety_factor', res.sf);
    const names = is3 ? ['sxx', 'syy', 'szz', 'sxy', 'syz', 'szx'] : (doc.study.model === 'axi' ? ['srr', 'szz', 'srz', 'shoop'] : ['sxx', 'syy', 'sxy', 'szz']);
    names.forEach((nm, c) => sca(nm + '_MPa', res.stress, res.ns, c));
    return L.join('\n') + '\n';
  }

  // one-page report: images [{title, canvas}], rows of [label, value]
  function reportCanvas(doc, images, sections, opts = {}) {
    const W = 1600, pad = 36, imgW = W - 2 * pad - 520, imgH = Math.round(imgW * 0.58), H = Math.max(1100, pad * 2 + 90 + images.length * (imgH + 44));
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    const gr = x.createLinearGradient(0, 0, 0, 70); gr.addColorStop(0, '#2c5f93'); gr.addColorStop(1, '#173a63'); x.fillStyle = gr; x.fillRect(0, 0, W, 70);
    x.fillStyle = '#fff'; x.font = '600 26px "Segoe UI", Arial, sans-serif'; x.fillText('Lumen Stress — ' + doc.name, pad, 44);
    x.font = '14px "Segoe UI", Arial, sans-serif'; x.textAlign = 'right'; x.fillText(opts.date || new Date().toLocaleString(), W - pad, 44); x.textAlign = 'left';
    let y = 100;
    images.forEach(im => {
      x.fillStyle = '#1b3a5c'; x.font = '600 17px "Segoe UI", Arial, sans-serif'; x.fillText(im.title, pad, y); y += 10;
      const s = Math.min(imgW / im.canvas.width, imgH / im.canvas.height), w = im.canvas.width * s, h = im.canvas.height * s;
      x.fillStyle = '#eef3f8'; x.fillRect(pad, y, imgW, imgH); x.drawImage(im.canvas, pad + (imgW - w) / 2, y + (imgH - h) / 2, w, h);
      x.strokeStyle = '#b8c7d8'; x.strokeRect(pad + 0.5, y + 0.5, imgW, imgH); y += imgH + 34;
    });
    let ty = 100; const tx = W - pad - 490;
    sections.forEach(([title, rows]) => {
      x.fillStyle = '#1b3a5c'; x.font = '600 17px "Segoe UI", Arial, sans-serif'; x.fillText(title, tx, ty); ty += 8;
      x.strokeStyle = '#c9d6e4'; x.beginPath(); x.moveTo(tx, ty); x.lineTo(tx + 490, ty); x.stroke(); ty += 20;
      rows.forEach(([k, v]) => {
        x.font = '14px "Segoe UI", Arial, sans-serif'; x.fillStyle = '#4a5b6d'; x.fillText(String(k), tx, ty);
        x.fillStyle = '#10243a'; x.font = '600 14px "Segoe UI", Arial, sans-serif'; const lines = wrap(x, String(v), 250); lines.forEach((l, i) => x.fillText(l, tx + 230, ty + i * 18)); ty += 18 * Math.max(1, lines.length) + 3;
      });
      ty += 16;
    });
    x.fillStyle = '#7b8a99'; x.font = '12px "Segoe UI", Arial, sans-serif';
    wrap(x, opts.footer || 'Linear elastic, small-deflection analysis. Verify critical results with hand calculations or an independent tool.', W - 2 * pad).forEach((l, i) => x.fillText(l, pad, H - 26 + i * 15 - (opts.footer ? 15 : 0)));
    return c;
  }
  function wrap(x, s, w) { const out = []; let cur = ''; for (const word of s.split(' ')) { const t = cur ? cur + ' ' + word : word; if (x.measureText(t).width > w && cur) { out.push(cur); cur = word; } else cur = t; } if (cur) out.push(cur); return out; }

  return { csv, vtk, reportCanvas, MODEL };
});
