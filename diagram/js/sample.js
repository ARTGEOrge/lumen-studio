'use strict';
/* Lumen Diagram — "Open Sample": a multi-page demo (flowchart with swimlanes, org chart, network, UML class,
   UML sequence, BPMN and a floor plan). */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const M = isNode ? require('./model.js') : root.DiaModel;
  const L = isNode ? require('./layout.js') : root.DiaLayout;

  function builder(name, bg) {
    const page = M.newPage(name); if (bg) page.bg = bg;
    const layer = page.layers[0].id;
    const sh = (shape, x, y, w, h, text, style, parent) => { const c = M.makeShape(shape, x, y, { w, h, text, style, layer, parent: parent ? parent.id : null }); page.cells.push(c); return c; };
    const ed = (a, b, text, style, o = {}) => { const e = M.makeEdge({ id: a.id, port: o.sp || null }, { id: b.id, port: o.tp || null }, { text, style, layer, labelT: o.t, pts: o.pts }); page.cells.push(e); return e; };
    return { page, sh, ed, layer };
  }

  function flowPage() {
    const { page, sh, ed } = builder('Order process');
    sh('heading', 40, -64, 520, 34, 'Order fulfilment — cross-functional flow', { align: 'left', fontSize: 20, fontColor: '#1e395b' });
    const lane = (y, name, fill, stroke) => sh('lane', 40, y, 1080, 170, name, { fill, stroke, header: 34, bodyFill: '#ffffff', fontColor: '#1e395b', fontSize: 13 });
    const L1 = lane(0, 'Customer', '#dae8fc', '#6c8ebf'), L2 = lane(170, 'Sales', '#d5e8d4', '#82b366'), L3 = lane(340, 'Warehouse', '#ffe6cc', '#d79b00');
    const blue = { fill: '#dae8fc', stroke: '#6c8ebf', fill2: '#f4f8fe' }, green = { fill: '#d5e8d4', stroke: '#82b366', fill2: '#f3faf2' }, orange = { fill: '#ffe6cc', stroke: '#d79b00', fill2: '#fff8f0' };
    const c1 = sh('terminator', 110, 55, 150, 56, 'Customer places order', { ...blue, shadow: true }, L1);
    const c2 = sh('process', 640, 55, 140, 60, 'Pay invoice', { ...blue, shadow: true, rounded: true }, L1);
    const c3 = sh('terminator', 950, 55, 140, 56, 'Order received', { ...blue, shadow: true }, L1);
    const s1 = sh('process', 120, 225, 130, 60, 'Check order details', { ...green, shadow: true, rounded: true }, L2);
    const s2 = sh('decision', 330, 210, 120, 90, 'In stock?', { ...green, shadow: true }, L2);
    const s3 = sh('document', 640, 222, 140, 66, 'Send invoice', { ...green, shadow: true }, L2);
    const w1 = sh('process', 320, 395, 140, 60, 'Back-order stock', { ...orange, shadow: true, rounded: true }, L3);
    const w4 = sh('database', 140, 385, 76, 82, 'Inventory', { ...orange, shadow: true }, L3);
    const w2 = sh('process', 700, 395, 140, 60, 'Pick & pack', { ...orange, shadow: true, rounded: true }, L3);
    const w3 = sh('process', 920, 395, 140, 60, 'Ship order', { ...orange, shadow: true, rounded: true }, L3);
    ed(c1, s1); ed(s1, s2);
    ed(s2, s3, 'Yes', { fontColor: '#2d6a2d', bold: true });
    ed(s2, w1, 'No', { fontColor: '#a33', bold: true });
    ed(w1, s2, 'restocked', { dash: 'dash', route: 'curved', endArrow: 'open' }, { sp: [1, 0.5], tp: [1, 0.5] });
    ed(w1, w4, '', { dash: 'dot', endArrow: 'none', startArrow: 'none' });
    ed(s3, c2); ed(c2, w2, 'paid'); ed(w2, w3); ed(w3, c3, 'delivered');
    sh('note', 880, 200, 190, 74, 'Invoices are due within 14 days of the order date.', { fontSize: 11, align: 'left' }, L2);
    return page;
  }

  function orgPage() {
    const { page, sh, ed } = builder('Org chart');
    const acc = { exec: '#1e395b', eng: '#2f6db5', sales: '#2e8b57', ops: '#c0702a' };
    const card = (t, a) => sh('orgCard', 0, 0, 180, 64, t, { accent: a, stroke: a });
    const person = (t, a) => sh('orgPerson', 0, 0, 176, 58, t, { accent: a, stroke: '#a9bcd3' });
    const r = { route: 'orthogonal', endArrow: 'none', rounded: false, stroke: '#7a8ea8' };
    const ceo = card('Maya Chen\nChief Executive Officer', acc.exec);
    const vE = card('Arjun Patel\nVP Engineering', acc.eng), vS = card('Lena Fischer\nVP Sales', acc.sales), vO = card('Tom Okafor\nVP Operations', acc.ops);
    [vE, vS, vO].forEach(v => ed(ceo, v, '', r, { sp: [0.5, 1], tp: [0.5, 0] }));
    const kids = [[vE, acc.eng, ['Sofia Rossi\nPlatform Lead', 'Kenji Watanabe\nMobile Lead', 'Priya Nair\nQA Lead']], [vS, acc.sales, ['Diego Alvarez\nEMEA Sales', 'Hannah Berg\nAmericas Sales']], [vO, acc.ops, ['Omar Haddad\nFinance', 'Grace Liu\nPeople & Culture']]];
    for (const [v, a, names] of kids) names.forEach(n => ed(v, person(n, a), '', r, { sp: [0.5, 1], tp: [0.5, 0] }));
    L.tree(page, { dir: 'TB', gapX: 22, gapY: 54, x: 40, y: 40 });
    // keep fixed top/bottom ports after layout (tree() clears them)
    page.cells.forEach(c => { if (c.kind === 'edge') { c.src.port = [0.5, 1]; c.tgt.port = [0.5, 0]; } });
    sh('heading', 40, -20, 400, 34, 'Northwind Labs — leadership', { align: 'left', fontSize: 20, fontColor: '#1e395b' });
    return page;
  }

  function networkPage() {
    const { page, sh, ed } = builder('Network');
    sh('heading', 40, -60, 400, 34, 'Office network', { align: 'left', fontSize: 20, fontColor: '#1e395b' });
    const dmz = sh('container', 300, 0, 300, 190, 'DMZ', { fill: '#fff6ec', stroke: '#d79b00', fontColor: '#8a5a00' });
    const lan = sh('container', 40, 270, 820, 230, 'Office LAN — 10.0.1.0/24', { fill: '#eef5fd', stroke: '#6c8ebf', fontColor: '#1e395b' });
    const inet = sh('internet', 70, 40, 110, 70, 'Internet');
    const fw = sh('firewall', 70, 160, 70, 56, 'Firewall');
    const web = sh('server', 340, 60, 50, 70, 'Web server', null, dmz), mail = sh('server', 440, 60, 50, 70, 'Mail server', null, dmz), lb = sh('loadBalancer', 510, 78, 64, 38, 'Load balancer', null, dmz);
    const rt = sh('router', 220, 168, 70, 50, 'Core router');
    const sw = sh('switch', 380, 310, 96, 38, 'Switch 48-port', null, lan);
    const pcs = [['desktop', 'Design PC', 90], ['desktop', 'Dev PC', 200], ['laptop', 'Laptop', 310]].map(([s, t, x]) => sh(s, x, 400, s === 'laptop' ? 76 : 70, s === 'laptop' ? 52 : 62, t, null, lan));
    const nas = sh('netDatabase', 480, 400, 54, 64, 'File server', null, lan), pr = sh('printer', 600, 405, 64, 54, 'Printer', null, lan), ap = sh('wireless', 720, 300, 60, 50, 'Wi-Fi AP', null, lan);
    const ph = sh('mobile', 760, 410, 34, 60, 'Phone', null, lan);
    const link = { route: 'straight', endArrow: 'none', sw: 2, stroke: '#5b6b7c' }, wifi = { route: 'straight', endArrow: 'none', dash: 'dash', sw: 1.5, stroke: '#3b7dd8' };
    ed(inet, fw, '', link); ed(fw, rt, '', link); ed(rt, web, '', { ...link, route: 'orthogonal' }); ed(rt, sw, '', { ...link, route: 'orthogonal' });
    ed(web, lb, '', link); ed(mail, lb, '', { ...link, route: 'orthogonal' });
    pcs.forEach(p => ed(sw, p, '', { ...link, route: 'orthogonal' })); ed(sw, nas, '', { ...link, route: 'orthogonal' }); ed(sw, pr, '', { ...link, route: 'orthogonal' }); ed(sw, ap, '', link);
    ed(ap, ph, '', wifi);
    return page;
  }

  function classPage() {
    const { page, sh, ed } = builder('Class model');
    const C = (x, y, w, t) => { const c = sh('umlClass', x, y, w, 10, t); const R = isNode ? require('./render.js') : root.DiaRender; c.h = Math.ceil(R.classSections(c, { fontSize: 12 }).total); return c; };
    const cust = C(40, 40, 190, 'Customer\n--\n- id: UUID\n- name: String\n- email: String\n--\n+ placeOrder(cart): Order');
    const order = C(340, 40, 210, 'Order\n--\n- number: String\n- placed: DateTime\n- status: OrderStatus\n--\n+ total(): Money\n+ cancel(): void');
    const line = C(660, 40, 180, 'OrderLine\n--\n- quantity: int\n- price: Money\n--\n+ subtotal(): Money');
    const prod = C(660, 260, 180, 'Product\n--\n- sku: String\n- title: String\n- price: Money');
    const pay = C(340, 300, 210, '«interface»\nPayment\n--\n+ authorize(amount): bool\n+ refund(): void');
    const card = C(220, 500, 190, 'CardPayment\n--\n- last4: String\n--\n+ authorize(amount): bool');
    const inv = C(480, 500, 190, 'InvoicePayment\n--\n- dueDate: Date\n--\n+ authorize(amount): bool');
    const st = sh('umlEnum', 40, 300, 170, 116, '«enumeration»\nOrderStatus\n--\nNEW\nPAID\nSHIPPED\nCANCELLED');
    ed(cust, order, '1     places     *', { route: 'orthogonal', endArrow: 'open' });
    ed(order, line, '', { route: 'orthogonal', startArrow: 'diamond', endArrow: 'none', arrowSize: 12 });
    ed(line, prod, '*  refers to  1', { route: 'orthogonal', endArrow: 'open' });
    ed(order, pay, 'paid by', { route: 'orthogonal', endArrow: 'open' });
    ed(card, pay, '', { route: 'orthogonal', endArrow: 'blockOpen', dash: 'dash', arrowSize: 12 });
    ed(inv, pay, '', { route: 'orthogonal', endArrow: 'blockOpen', dash: 'dash', arrowSize: 12 });
    ed(order, st, '', { route: 'orthogonal', endArrow: 'open', dash: 'dash' });
    return page;
  }

  function sequencePage() {
    const { page, sh, ed } = builder('Sequence');
    const H = 400, ll = [['actorLifeline', 'Shopper'], ['lifeline', ':Web app'], ['lifeline', ':Order API'], ['lifeline', ':Database']].map(([s, t], i) => sh(s, 40 + i * 200, 0, 120, H, t, s === 'lifeline' ? { fill: '#dae8fc', stroke: '#6c8ebf' } : null));
    const act = (i, y0, y1) => sh('activation', 40 + i * 200 + 53, y0, 14, y1 - y0, '', { fill: '#f4f7fb', stroke: '#6c8ebf' });
    act(1, 100, 340); act(2, 150, 300); act(3, 190, 240);
    const msg = (a, b, y, t, ret) => ed(ll[a], ll[b], t, ret ? { route: 'straight', endArrow: 'open', dash: 'dash' } : { route: 'straight', endArrow: 'block' }, { sp: [0.5, y / H], tp: [0.5, y / H] });
    msg(0, 1, 105, 'submit order'); msg(1, 2, 155, 'POST /orders'); msg(2, 3, 195, 'INSERT order');
    msg(3, 2, 235, 'id', true); msg(2, 1, 295, '201 Created', true); msg(1, 0, 335, 'confirmation page', true);
    const f = sh('fragment', 225, 130, 480, 190, 'alt', { stroke: '#7a8796' });
    sh('text', 300, 168, 130, 20, '[stock available]', { fontSize: 11, italic: true, align: 'left', fontColor: '#4a5568' }, f);
    return page;
  }

  function bpmnPage() {
    const { page, sh, ed } = builder('Expense approval');
    const pool = sh('pool', 40, 0, 900, 360, 'Expense approval', { fill: '#eef3f9', stroke: '#5a7090', header: 32 });
    const lane = (y, t) => sh('lane', 72, y, 868, 120, t, { fill: '#f6f9fc', stroke: '#5a7090', header: 28, bold: false }, pool);
    const e1 = lane(0, 'Employee'), m1 = lane(120, 'Manager'), f1 = lane(240, 'Finance');
    const st = sh('bpmnStart', 130, 40, 40, 40, 'Expense incurred', null, e1);
    const t1 = sh('bpmnTask', 220, 25, 120, 70, 'Submit expense claim', null, e1);
    const g = sh('bpmnExclusive', 400, 155, 50, 50, 'Over €500?', null, m1);
    const t2 = sh('bpmnTask', 510, 145, 120, 70, 'Review claim', null, m1);
    const g2 = sh('bpmnExclusive', 680, 155, 50, 50, 'Approved?', null, m1);
    const t3 = sh('bpmnTask', 510, 265, 120, 70, 'Reimburse employee', null, f1);
    const en = sh('bpmnEnd', 860, 280, 40, 40, 'Paid', null, f1);
    const rej = sh('bpmnEnd', 860, 40, 40, 40, 'Rejected', null, e1);
    const tm = sh('bpmnTimer', 360, 40, 40, 40, '3 days', null, e1);
    const flow = { route: 'orthogonal', endArrow: 'block' };
    ed(st, t1, '', flow); ed(t1, g, '', flow); ed(g, t2, 'yes', flow); ed(g, t3, 'no', flow); ed(t2, g2, '', flow); ed(g2, t3, 'yes', flow); ed(g2, rej, 'no', flow); ed(t3, en, '', flow);
    ed(t1, tm, '', { route: 'straight', dash: 'dot', endArrow: 'none' });
    return page;
  }

  function floorPage() {
    const { page, sh } = builder('Floor plan', '#ffffff');
    sh('heading', 0, -56, 400, 34, 'Two-room apartment — 62 m²', { align: 'left', fontSize: 20, fontColor: '#1e395b' });
    sh('room', 10, 10, 380, 300, 'Living room\n32 m²'); sh('room', 400, 10, 240, 190, 'Bedroom\n16 m²', { align: 'right', valign: 'bottom' }); sh('room', 400, 210, 240, 100, 'Bath\n7 m²', { valign: 'bottom', align: 'right' }); sh('room', 10, 320, 630, 110, 'Kitchen & hall\n7 m²', { valign: 'bottom' });
    const wall = (x, y, w, h) => sh('wall', x, y, w, h, '');
    wall(0, 0, 650, 10); wall(0, 430, 650, 10); wall(0, 0, 10, 440); wall(640, 0, 10, 440);
    wall(390, 10, 10, 300); wall(400, 200, 240, 10); wall(10, 310, 310, 10); wall(400, 310, 240, 10); wall(390, 310, 10, 10);
    sh('window', 80, 0, 180, 10, ''); sh('window', 460, 0, 120, 10, ''); sh('window', 640, 240, 10, 50, '', null).rot = 0;
    const d1 = sh('door', 320, 310, 70, 70, ''); d1.flipV = true;
    sh('door', 400, 128, 62, 62, '');
    sh('door', 400, 258, 48, 48, '');
    sh('door', 540, 350, 80, 80, '');
    sh('sofa', 40, 210, 200, 80, ''); sh('roundTable', 270, 60, 80, 80, ''); sh('chair', 245, 82, 36, 36, '').rot = 270; sh('chair', 340, 82, 36, 36, '').rot = 90; sh('chair', 292, 30, 36, 36, ''); sh('plant', 30, 30, 44, 44, '');
    sh('bed', 528, 24, 96, 130, ''); sh('table', 420, 22, 70, 40, '');
    sh('bathtub', 482, 213, 150, 58, ''); sh('toilet', 420, 212, 36, 46, ''); sh('sink', 236, 340, 56, 44, '');
    sh('table', 40, 340, 190, 44, 'Counter', { fill: '#e9e2d5' });
    return page;
  }

  function sampleDoc() {
    const doc = M.newDoc(); doc.pages = [flowPage(), orgPage(), networkPage(), classPage(), sequencePage(), bpmnPage(), floorPage()];
    return doc;
  }
  const api = { sampleDoc, flowPage, orgPage, networkPage, classPage, sequencePage, bpmnPage, floorPage };
  if (isNode) module.exports = api; else root.DiaSample = api;
})(typeof self !== 'undefined' ? self : this);
