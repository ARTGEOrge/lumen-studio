// "Open Sample": builds a realistic 3-page contract with pdf-lib — headings, a fee table, bookmarks,
// links, a fillable acceptance form and signature lines — plus a few review comments.
const L = window.PDFLib;
const { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFHexString, PDFNull } = L;

const NAVY = rgb(0.118, 0.224, 0.357), TEAL = rgb(0.06, 0.47, 0.5), INK = rgb(0.13, 0.15, 0.18), GRAY = rgb(0.42, 0.46, 0.52), LINE = rgb(0.78, 0.82, 0.88);

export async function buildSample() {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), times = await pdf.embedFont(StandardFonts.TimesRoman), timesB = await pdf.embedFont(StandardFonts.TimesRomanBold);
  pdf.setTitle('Master Services Agreement — Northwind Studio', { showInWindowTitleBar: true });
  pdf.setAuthor('Northwind Studio LLC'); pdf.setSubject('Services agreement with fee schedule and client acceptance form');
  pdf.setKeywords(['contract', 'services', 'agreement', 'Northwind']); pdf.setCreator('Lumen PDF sample'); pdf.setProducer('Lumen PDF');
  pdf.setCreationDate(new Date('2026-09-28T10:00:00Z'));
  const W = 612, H = 792, M = 72, CW = W - 2 * M;
  const pages = [pdf.addPage([W, H]), pdf.addPage([W, H]), pdf.addPage([W, H])];
  const marks = {}; // positions for review annotations / links
  const wrap = (text, font, size, width) => {
    const words = text.split(' '); const lines = []; let line = '';
    for (const w of words) { const c = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(c, size) > width && line) { lines.push(line); line = w; } else line = c; }
    if (line) lines.push(line); return lines;
  };
  const para = (page, text, y, { font = times, size = 11, lead = 15.5, x = M, width = CW, color = INK, find = null, justify = true } = {}) => {
    const lines = wrap(text, font, size, width);
    lines.forEach((ln, k) => {
      const last = k === lines.length - 1;
      if (justify && !last) {
        const words = ln.split(' '); const gap = (width - font.widthOfTextAtSize(words.join(''), size)) / Math.max(1, words.length - 1);
        let xx = x; for (const w of words) { page.drawText(w, { x: xx, y, size, font, color }); xx += font.widthOfTextAtSize(w, size) + gap; }
        if (find) { const at = ln.indexOf(find.text); if (at >= 0) { const pre = ln.slice(0, at).split(' '); const preW = font.widthOfTextAtSize(pre.join(''), size) + gap * (pre.length - 1); const fw = find.text.split(' '); marks[find.key] = { page: pages.indexOf(page), x: x + preW, y, w: font.widthOfTextAtSize(fw.join(''), size) + gap * (fw.length - 1), size }; } }
      } else {
        page.drawText(ln, { x, y, size, font, color });
        if (find) { const at = ln.indexOf(find.text); if (at >= 0) marks[find.key] = { page: pages.indexOf(page), x: x + font.widthOfTextAtSize(ln.slice(0, at), size), y, w: font.widthOfTextAtSize(find.text, size), size }; }
      }
      y -= lead;
    });
    return y;
  };
  const heading = (page, text, y, size = 12.5) => { page.drawText(text, { x: M, y, size, font: bold, color: NAVY }); return y - size - 8; };
  const band = (page, sub) => {
    page.drawRectangle({ x: 0, y: H - 46, width: W, height: 46, color: NAVY });
    page.drawRectangle({ x: 0, y: H - 50, width: W, height: 4, color: TEAL });
    page.drawCircle({ x: M + 9, y: H - 23, size: 9, color: rgb(0.36, 0.78, 0.8) });
    page.drawCircle({ x: M + 9, y: H - 23, size: 4.5, color: NAVY });
    page.drawText('NORTHWIND STUDIO', { x: M + 26, y: H - 28, size: 12, font: bold, color: rgb(1, 1, 1) });
    page.drawText(sub, { x: W - M - helv.widthOfTextAtSize(sub, 9), y: H - 27, size: 9, font: helv, color: rgb(0.82, 0.9, 0.97) });
  };
  const footer = (page, n) => {
    page.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.6, color: LINE });
    page.drawText('Northwind Studio LLC · Master Services Agreement NWS-2026-0418 · Confidential', { x: M, y: 36, size: 8, font: helv, color: GRAY });
    const t = `Page ${n} of 3`; page.drawText(t, { x: W - M - helv.widthOfTextAtSize(t, 8), y: 36, size: 8, font: helv, color: GRAY });
  };

  /* ---- page 1 ---- */
  let p = pages[0]; band(p, 'Agreement NWS-2026-0418');
  let y = H - 104;
  p.drawText('Master Services Agreement', { x: M, y, size: 25, font: bold, color: NAVY }); y -= 22;
  p.drawText('Effective October 1, 2026  ·  Portland, Oregon', { x: M, y, size: 10.5, font: helv, color: GRAY }); y -= 16;
  p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: LINE }); y -= 26;
  const tops = {};
  tops.parties = y + 14; y = heading(p, '1.  Parties and Services', y);
  y = para(p, 'This Master Services Agreement (the "Agreement") is entered into between Northwind Studio LLC, 214 Harbor Street, Portland, OR 97204 ("Provider"), and the client identified on the Client Acceptance Form ("Client"). Provider will deliver the brand, design and web development services described in each Statement of Work signed by both parties.', y);
  y -= 6; y = para(p, 'Each Statement of Work will describe the deliverables, milestones, acceptance criteria and the people responsible on both sides. If a Statement of Work conflicts with this Agreement, this Agreement controls unless the Statement of Work expressly says otherwise.', y);
  y -= 12; tops.term = y + 14; y = heading(p, '2.  Term and Termination', y);
  y = para(p, 'This Agreement begins on the Effective Date and continues for twelve (12) months, renewing automatically for successive one-year terms unless either party gives sixty (60) days written notice of non-renewal. Either party may terminate for material breach that is not cured within thirty (30) days of notice.', y, { find: { key: 'term', text: 'twelve (12) months' } });
  y -= 12; tops.fees = y + 14; y = heading(p, '3.  Fees and Payment', y);
  y = para(p, 'Client will pay the fees set out in Schedule A on page 2. Provider invoices monthly in arrears; invoices are due within thirty (30) days. Late amounts accrue interest at 1.5% per month or the maximum rate allowed by law, whichever is lower.', y, { find: { key: 'sched', text: 'Schedule A on page 2' } });
  y -= 12; tops.conf = y + 14; y = heading(p, '4.  Confidentiality', y);
  y = para(p, 'Each party will protect the other party\'s Confidential Information with at least the same care it uses for its own, and will use it only to perform this Agreement. These obligations survive for three (3) years after termination.', y);
  marks.feesNote = { page: 0, x: W - M + 14, y: tops.fees - 2 };
  footer(p, 1);

  /* ---- page 2 ---- */
  p = pages[1]; band(p, 'Schedule A — Fees');
  y = H - 100; tops.sched = y + 14;
  p.drawText('Schedule A — Fees', { x: M, y, size: 18, font: bold, color: NAVY }); y -= 18;
  p.drawText('All amounts in US dollars. Rates valid until December 31, 2026.', { x: M, y, size: 10, font: helv, color: GRAY }); y -= 22;
  const cols = [{ t: 'Item', w: 150 }, { t: 'Description', w: 166 }, { t: 'Qty', w: 34, r: 1 }, { t: 'Rate', w: 52, r: 1 }, { t: 'Amount', w: 66, r: 1 }];
  const rows = [
    ['Discovery workshop', 'Two-day stakeholder workshop', '1', '4,800', '4,800'],
    ['Brand identity system', 'Logo, palette, type, guidelines', '1', '12,500', '12,500'],
    ['Website design', 'Twelve responsive templates', '12', '1,150', '13,800'],
    ['Front-end development', 'Accessible build, CMS theme', '1', '18,400', '18,400'],
    ['Content migration', 'Up to 150 pages', '150', '28', '4,200'],
    ['Project management', 'Monthly, six months', '6', '1,250', '7,500']
  ];
  const rowH = 24; const tableTop = y;
  p.drawRectangle({ x: M, y: y - rowH + 6, width: CW, height: rowH, color: NAVY });
  let x = M; for (const c of cols) { const tw = bold.widthOfTextAtSize(c.t, 9.5); p.drawText(c.t, { x: c.r ? x + c.w - tw - 6 : x + 6, y: y - 10, size: 9.5, font: bold, color: rgb(1, 1, 1) }); x += c.w; }
  y -= rowH;
  rows.forEach((r, k) => {
    if (k % 2 === 0) p.drawRectangle({ x: M, y: y - rowH + 6, width: CW, height: rowH, color: rgb(0.95, 0.97, 0.99) });
    let xx = M; r.forEach((v, j) => { const c = cols[j]; const f = j === 0 ? bold : helv; const tw = f.widthOfTextAtSize(v, 9.5); p.drawText(v, { x: c.r ? xx + c.w - tw - 6 : xx + 6, y: y - 10, size: 9.5, font: f, color: INK }); xx += c.w; });
    y -= rowH;
  });
  p.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.8, color: NAVY });
  const tot = [['Subtotal', '61,200'], ['Discount (5%)', '-3,060'], ['Total', '58,140']];
  tot.forEach(([l, v], k) => {
    const f = k === 2 ? bold : helv, s = k === 2 ? 11 : 9.5;
    p.drawText(l, { x: M + 330, y: y - 10, size: s, font: f, color: k === 2 ? NAVY : INK });
    p.drawText(v, { x: W - M - 6 - f.widthOfTextAtSize(v, s), y: y - 10, size: s, font: f, color: k === 2 ? NAVY : INK });
    if (k === 2) marks.total = { page: 1, x1: M + 322, y1: y - 16, x2: W - M, y2: y + 4 };
    y -= 19;
  });
  p.drawRectangle({ x: M, y: tableTop - rowH * 7 - 57 + 6, width: CW, height: rowH * 7 + 57, borderColor: LINE, borderWidth: 0.8 });
  y -= 26; tops.ip = y + 14; y = heading(p, '5.  Intellectual Property', y);
  y = para(p, 'On full payment, Provider assigns to Client all rights in the final deliverables. Provider keeps ownership of its pre-existing tools, code libraries and know-how, and grants Client a perpetual, royalty-free licence to use them as part of the deliverables.', y);
  y -= 12; y = heading(p, '6.  Warranties', y);
  y = para(p, 'Provider warrants that the services will be performed in a professional manner consistent with industry standards, and that deliverables will materially conform to the applicable Statement of Work for ninety (90) days after acceptance.', y);
  y -= 12; y = heading(p, '7.  Limitation of Liability', y);
  y = para(p, 'Except for breaches of confidentiality, neither party is liable for indirect or consequential damages, and each party\'s total liability is limited to the fees paid in the twelve months before the claim.', y);
  y -= 10; p.drawText('Questions? Visit www.northwind.example or email legal@northwind.example', { x: M, y, size: 9.5, font: helv, color: TEAL });
  marks.url = { page: 1, x: M + helv.widthOfTextAtSize('Questions? Visit ', 9.5), y, w: helv.widthOfTextAtSize('www.northwind.example', 9.5) };
  footer(p, 2);

  /* ---- page 3: acceptance form ---- */
  p = pages[2]; band(p, 'Client Acceptance Form');
  y = H - 100; tops.form = y + 14;
  p.drawText('Client Acceptance Form', { x: M, y, size: 18, font: bold, color: NAVY }); y -= 18;
  y = para(p, 'Please complete the fields below, sign, and return this page to Northwind Studio. Fields can be filled in Lumen PDF or any PDF reader.', y, { font: helv, size: 10, lead: 14, color: GRAY, justify: false });
  y -= 10;
  const form = pdf.getForm();
  const field = (label, name, x, yy, w, opts = {}) => {
    p.drawText(label, { x, y: yy + (opts.h || 18) + 4, size: 8.5, font: bold, color: GRAY });
    const tf = form.createTextField(name); if (opts.multi) tf.enableMultiline();
    tf.addToPage(p, { x, y: yy, width: w, height: opts.h || 18, font: helv, borderColor: rgb(0.62, 0.69, 0.78), backgroundColor: rgb(0.97, 0.98, 1), borderWidth: 0.8 });
    tf.setFontSize(opts.fs || 10.5); if (opts.value) tf.setText(opts.value);
    return tf;
  };
  y -= 28;
  field('FULL NAME', 'client.name', M, y, 220); field('COMPANY', 'client.company', M + 248, y, 220); y -= 46;
  field('EMAIL', 'client.email', M, y, 220); field('PHONE', 'client.phone', M + 248, y, 220); y -= 46;
  field('PROJECT START DATE', 'project.start', M, y, 140, { value: '' });
  p.drawText('PROJECT TIER', { x: M + 248, y: y + 22, size: 8.5, font: bold, color: GRAY });
  const dd = form.createDropdown('project.tier'); dd.addOptions(['Starter', 'Professional', 'Enterprise']); dd.select('Professional');
  dd.addToPage(p, { x: M + 248, y, width: 160, height: 18, font: helv, borderColor: rgb(0.62, 0.69, 0.78), backgroundColor: rgb(0.97, 0.98, 1), borderWidth: 0.8 }); dd.setFontSize(10.5);
  y -= 40;
  p.drawText('PAYMENT SCHEDULE', { x: M, y: y + 4, size: 8.5, font: bold, color: GRAY }); y -= 16;
  const rg = form.createRadioGroup('payment.schedule'); let rx = M;
  for (const o of ['Monthly', 'Quarterly', 'Annually']) { rg.addOptionToPage(o, p, { x: rx, y: y - 2, width: 12, height: 12, borderColor: rgb(0.45, 0.52, 0.62), backgroundColor: rgb(1, 1, 1) }); p.drawText(o, { x: rx + 18, y, size: 10.5, font: helv, color: INK }); rx += 110; }
  rg.select('Monthly');
  y -= 30;
  const cb1 = form.createCheckBox('agree.terms'); cb1.addToPage(p, { x: M, y: y - 2, width: 12, height: 12, borderColor: rgb(0.45, 0.52, 0.62), backgroundColor: rgb(1, 1, 1) });
  p.drawText('I have read and agree to the Master Services Agreement and Schedule A.', { x: M + 20, y, size: 10.5, font: helv, color: INK }); y -= 22;
  const cb2 = form.createCheckBox('agree.updates'); cb2.addToPage(p, { x: M, y: y - 2, width: 12, height: 12, borderColor: rgb(0.45, 0.52, 0.62), backgroundColor: rgb(1, 1, 1) });
  p.drawText('Send me project updates by email.', { x: M + 20, y, size: 10.5, font: helv, color: INK }); y -= 40;
  field('NOTES FOR THE PROJECT TEAM', 'client.notes', M, y - 30, CW, { multi: true, h: 48, fs: 10 }); y -= 92;
  // signature lines
  const sigLine = (x, yy, w, label) => { p.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: 0.9, color: INK }); p.drawText(label, { x, y: yy - 13, size: 8.5, font: helv, color: GRAY }); };
  p.drawText('SIGNATURES', { x: M, y, size: 11, font: bold, color: NAVY }); y -= 52;
  sigLine(M, y, 250, 'Client signature'); sigLine(M + 290, y, 178, 'Date');
  marks.sign = { page: 2, x: M, y };
  y -= 60;
  sigLine(M, y, 250, 'For Northwind Studio — Jordan Ellis, Managing Director'); sigLine(M + 290, y, 178, 'Date');
  p.drawText('Jordan Ellis', { x: M + 8, y: y + 6, size: 22, font: timesB, color: rgb(0.1, 0.2, 0.45) });
  p.drawText('September 28, 2026', { x: M + 296, y: y + 6, size: 11, font: helv, color: INK });
  footer(p, 3);
  form.updateFieldAppearances(helv);

  /* ---- links ---- */
  const ctx = pdf.context;
  const link = (page, rect, extra) => { const ref = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], ...extra })); page.node.addAnnot(ref); };
  if (marks.sched) link(pages[0], [marks.sched.x, marks.sched.y - 3, marks.sched.x + marks.sched.w, marks.sched.y + 10], { Dest: [pages[1].ref, 'XYZ', null, H - 60, null] });
  link(pages[1], [marks.url.x, marks.url.y - 3, marks.url.x + marks.url.w, marks.url.y + 10], { A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://www.example.com/') } });
  // underline the internal link
  if (marks.sched) pages[0].drawLine({ start: { x: marks.sched.x, y: marks.sched.y - 1.5 }, end: { x: marks.sched.x + marks.sched.w, y: marks.sched.y - 1.5 }, thickness: 0.5, color: TEAL });

  /* ---- bookmarks ---- */
  const outline = [['1. Parties and Services', 0, tops.parties], ['2. Term and Termination', 0, tops.term], ['3. Fees and Payment', 0, tops.fees], ['4. Confidentiality', 0, tops.conf], ['Schedule A — Fees', 1, tops.sched, [['5. Intellectual Property', 1, tops.ip]]], ['Client Acceptance Form', 2, tops.form]];
  const outRef = ctx.nextRef();
  const build = (list, parentRef) => {
    const refs = list.map(() => ctx.nextRef());
    list.forEach(([title, pg, top, kids], k) => {
      const d = { Title: PDFHexString.fromText(title), Parent: parentRef, Dest: [pages[pg].ref, 'XYZ', null, Math.round(top), null] };
      if (k > 0) d.Prev = refs[k - 1]; if (k < list.length - 1) d.Next = refs[k + 1];
      if (kids) { const kr = build(kids, refs[k]); d.First = kr[0]; d.Last = kr[kr.length - 1]; d.Count = kr.length; }
      ctx.assign(refs[k], ctx.obj(d));
    });
    return refs;
  };
  const top = build(outline, outRef);
  ctx.assign(outRef, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: top.length }));
  pdf.catalog.set(PDFName.of('Outlines'), outRef);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));

  const bytes = await pdf.save();

  /* ---- review comments (become real PDF annotations on save) ---- */
  const d0 = '2026-10-06T09:12:00Z', d1 = '2026-10-06T15:40:00Z', d2 = '2026-10-07T08:05:00Z';
  const annots = [];
  if (marks.term) { const m = marks.term; annots.push({ pageIndex: 0, type: 'highlight', quads: [[m.x - 1, m.y + m.size * 0.86, m.x + m.w + 1, m.y + m.size * 0.86, m.x - 1, m.y - m.size * 0.24, m.x + m.w + 1, m.y - m.size * 0.24]], color: '#ffd400', opacity: 0.5, author: 'Dana Reyes (Legal)', date: d0, contents: 'Is 12 months right for a first engagement? Consider 6 months with an option to extend.', quote: 'twelve (12) months', replies: [{ id: 'r1', author: 'Jordan Ellis', date: d1, text: 'Client asked for 12 — keeping it; the 60-day non-renewal notice covers the exit.' }] }); }
  annots.push({ pageIndex: 0, type: 'note', x: marks.feesNote.x - 8, y: marks.feesNote.y + 4, color: '#ffd84d', opacity: 1, author: 'Dana Reyes (Legal)', date: d0, contents: 'Confirm the 1.5% late-fee rate with Finance before this goes out.', replies: [] });
  annots.push({ pageIndex: 0, type: 'stamp', rect: [W - M - 118, H - 99, W - M + 24, H - 59], rot: 0, label: 'DRAFT', sub: 'Dana Reyes · Oct 6, 2026', color: '#2862c8', opacity: 0.9, author: 'Dana Reyes (Legal)', date: d0, contents: '', replies: [] });
  if (marks.total) { const t = marks.total; annots.push({ pageIndex: 1, type: 'rect', rect: [t.x1, t.y1, t.x2 + 4, t.y2], color: '#1f9d3a', width: 1.5, fill: null, opacity: 1, author: 'Priya Nair (Finance)', date: d2, contents: 'Total matches the signed proposal (incl. 5% early-commitment discount).', replies: [] }); }
  annots.push({ pageIndex: 2, type: 'arrow', p1: [marks.sign.x + 380, marks.sign.y + 70], p2: [marks.sign.x + 258, marks.sign.y + 14], color: '#d42020', width: 2, opacity: 1, author: 'Jordan Ellis', date: d1, contents: '', replies: [] });
  annots.push({ pageIndex: 2, type: 'freetext', rect: [marks.sign.x + 330, marks.sign.y + 66, marks.sign.x + 468, marks.sign.y + 100], rot: 0, text: 'Please sign and return by October 15.', color: '#7a1010', size: 10, font: 'Helvetica', bold: false, fill: '#fff4d6', bw: 1, bcolor: '#d42020', opacity: 1, align: 'left', author: 'Jordan Ellis', date: d1, contents: '', replies: [] });
  return { bytes, annots };
}
