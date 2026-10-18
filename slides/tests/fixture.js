'use strict';
// Builds a document that exercises every object type (used by the Node pptx tests).
const M = require('../js/model.js');
const zlib = require('zlib');
// tiny real PNG (4×4 gradient) built with zlib
function png(w, h) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x * 60; raw[o + 1] = y * 60; raw[o + 2] = 200; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG_BYTES = png(4, 4);
const PNG = 'data:image/png;base64,' + PNG_BYTES.toString('base64');
function build() {
  const d = M.newDoc({ theme: 'lumen' });
  const L = n => d.layouts.find(l => l.name === n).id;
  // 1 title slide
  const s1 = d.slides[0];
  s1.objects[0].text = M.textBody([M.para('Quarterly Review')]);
  s1.objects[1].text = M.textBody([M.para('Lumen Slides & <OOXML> "test"')]);
  s1.transition = { type: 'fade', dur: 1.2 };
  s1.notes = 'Welcome everyone.\nSecond line of notes.';
  // 2 bullets
  const s2 = M.newSlide(d, L('Title and Content'));
  s2.objects[0].text = M.textBody([M.para('Agenda')]);
  s2.objects[1].text = M.textBody([M.para('First point'), { runs: [{ t: 'Bold', b: true }, { t: ' and ' }, { t: 'red italic', i: true, color: '#ff0000' }], lvl: 1 }, { runs: [{ t: 'Numbered' }], bullet: { num: 'arabicPeriod' } }, { runs: [{ t: 'Accent', color: 'accent2:+40', size: 30 }] }]);
  s2.transition = { type: 'push', dir: 'l', dur: 0.5 };
  // 3 shapes, image, group
  const s3 = M.newSlide(d, L('Title Only'));
  s3.objects[0].text = M.textBody([M.para('Shapes')]);
  const r = M.shape('roundRect', 100, 200, 300, 160, { text: M.textBody([M.para('Inside')]) }); r.shadow = true;
  const e = M.shape('ellipse', 450, 200, 200, 200, { fill: { grad: [[0, 'accent1'], [1, '#ffcc00']], ang: 45 }, line: { color: 'tx1', w: 3, dash: 'dash' } });
  const st = M.shape('star5', 700, 200, 160, 160); st.rot = 15;
  const ln = M.shape('line', 100, 420, 400, 100); ln.line = { color: 'accent2', w: 4, tail: 'arrow' };
  const tb = M.textBox(900, 200, 300, 60, 'A text box');
  const im = M.image('a1', 900, 300, 200, 200); im.crop = { l: 0.1, t: 0, r: 0.1, b: 0 };
  const g = { id: M.uid(), type: 'group', children: [M.shape('rect', 600, 450, 100, 100), M.shape('triangle', 720, 450, 100, 100)] };
  Object.assign(g, M.groupBounds(g.children), { rot: 0 });
  s3.objects.push(r, e, st, ln, tb, im, g);
  s3.anims = [{ id: 'a', target: r.id, cls: 'entr', fx: 'fade', dir: 'b', dur: 0.5, delay: 0, trig: 'click' }, { id: 'b', target: e.id, cls: 'entr', fx: 'fly', dir: 'l', dur: 0.6, delay: 0, trig: 'with' }, { id: 'c', target: st.id, cls: 'emph', fx: 'spin', dir: 'b', dur: 1, delay: 0.2, trig: 'after' }, { id: 'd', target: tb.id, cls: 'exit', fx: 'wipe', dir: 'r', dur: 0.4, delay: 0, trig: 'click' }, { id: 'e', target: im.id, cls: 'entr', fx: 'zoom', dir: 'b', dur: 0.5, delay: 0, trig: 'click' }];
  s3.bg = { color: '#f4f0ea' };
  // 4 table + chart
  const s4 = M.newSlide(d, L('Title Only'));
  s4.objects[0].text = M.textBody([M.para('Numbers')]);
  const t = M.table(80, 180, 560, 4, 3, [['Region', 'Q1', 'Q2'], ['North', '12', '15'], ['South', '9', '11'], ['West', '14', '18']]);
  t.rows[2].cells[1].fill = { color: '#ffeeaa' };
  const c = M.chart('col', 680, 170, 520, 380);
  const pie = M.chart('pie', 680, 560, 200, 150, { title: '', cats: ['A', 'B', 'C'], series: [{ name: 'Share', vals: [50, 30, 20] }] }); pie.labels = true;
  s4.objects.push(t, c, pie);
  s4.bg = { grad: [[0, '#ffffff'], [1, 'accent1:+80']], ang: 90 };
  s4.hidden = true;
  d.slides.push(s2, s3, s4);
  d.footer = { num: true, text: 'Confidential', date: false, skipTitle: true };
  return { doc: d, assets: { a1: { mime: 'image/png', data: PNG, w: 4, h: 4 } } };
}
module.exports = { build, PNG, PNG_BYTES };
