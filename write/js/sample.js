'use strict';
/* Lumen Write — the Open Sample document: a four-page renovation proposal that exercises styles, a table
   of contents, lists, a table, pictures with text wrap, footnotes, comments and tracked changes. */
const Sample = (() => {
  const T = (text, f) => ({ t: 'text', text, ...(f || {}) });
  const P = (style, ...runs) => ({ t: 'p', style, runs: runs.map(r => typeof r === 'string' ? T(r) : r) });
  const LI = (kind, level, ...runs) => ({ ...P('Normal', ...runs), list: { kind, level } });
  async function png(w, h, draw) {
    const c = new OffscreenCanvas(w, h); const g = c.getContext('2d'); draw(g, w, h);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  }
  async function chart() {
    return png(1200, 560, (g, W, H) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
      const data = [['Jan', 6.1], ['Feb', 5.8], ['Mar', 7.4], ['Apr', 8.2], ['May', 9.6], ['Jun', 11.8], ['Jul', 13.2], ['Aug', 12.7], ['Sep', 10.1], ['Oct', 8.9], ['Nov', 7.2], ['Dec', 6.6]];
      const x0 = 90, y0 = 470, cw = W - 130, chh = 380;
      g.font = '600 30px Montserrat, sans-serif'; g.fillStyle = '#16324f'; g.fillText('Monthly visitors, 2025 (thousands)', x0, 52);
      g.strokeStyle = '#d6dee8'; g.lineWidth = 2; g.font = '22px "Liberation Sans", sans-serif'; g.fillStyle = '#5b6b7c';
      for (let v = 0; v <= 14; v += 2) { const y = y0 - v / 14 * chh; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + cw, y); g.stroke(); g.fillText(String(v), x0 - 40, y + 8); }
      const bw = cw / data.length;
      data.forEach(([m, v], i) => {
        const x = x0 + i * bw + bw * 0.18, w = bw * 0.64, h = v / 14 * chh;
        const gr = g.createLinearGradient(0, y0 - h, 0, y0); gr.addColorStop(0, i >= 5 && i <= 7 ? '#f0a43a' : '#4f8fd6'); gr.addColorStop(1, i >= 5 && i <= 7 ? '#d9771a' : '#1f5faf');
        g.fillStyle = gr; g.beginPath(); g.roundRect(x, y0 - h, w, h, [8, 8, 0, 0]); g.fill();
        g.fillStyle = '#334455'; g.fillText(m, x + w / 2 - 20, y0 + 34);
      });
      g.fillStyle = '#d9771a'; g.fillRect(x0 + cw - 330, 34, 22, 22); g.fillStyle = '#5b6b7c'; g.fillText('Summer reading season', x0 + cw - 298, 54);
    });
  }
  async function facade() {
    return png(520, 600, (g, W, H) => {
      const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#cfe6fb'); sky.addColorStop(1, '#f7fbff'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
      g.fillStyle = '#e9c46a'; g.beginPath(); g.arc(410, 110, 46, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9db8a0'; g.beginPath(); g.ellipse(80, 520, 120, 60, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(470, 530, 110, 50, 0, 0, Math.PI * 2); g.fill();
      // building
      g.fillStyle = '#b5543c'; g.fillRect(70, 230, 380, 300);
      g.fillStyle = '#8f3b28'; g.beginPath(); g.moveTo(50, 236); g.lineTo(260, 140); g.lineTo(470, 236); g.closePath(); g.fill();
      g.fillStyle = '#2f4858';
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { g.fillStyle = '#dff1ff'; g.fillRect(100 + c * 85, 265 + r * 95, 55, 65); g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.strokeRect(100 + c * 85, 265 + r * 95, 55, 65); }
      g.fillStyle = '#3d2b1f'; g.fillRect(225, 440, 70, 90); g.fillStyle = '#f2d16b'; g.beginPath(); g.arc(282, 488, 5, 0, 7); g.fill();
      // new glass wing
      g.fillStyle = 'rgba(120,200,235,.75)'; g.fillRect(330, 360, 150, 170); g.strokeStyle = '#ffffff'; g.lineWidth = 3; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(330 + i * 50, 360); g.lineTo(330 + i * 50, 530); g.stroke(); }
      g.fillStyle = '#5a6b78'; g.fillRect(320, 350, 170, 12);
      g.fillStyle = '#6b8f71'; g.fillRect(0, 530, W, 70);
      g.font = '600 26px Montserrat, sans-serif'; g.fillStyle = '#16324f'; g.fillText('Riverside Library', 140, 590 - 18);
    });
  }
  async function build() {
    const d = Model.newDoc();
    d.meta = { title: 'Riverside Library Renovation', author: 'Maya Chen' };
    d.header = { l: 'Riverside Library Renovation', c: '', r: 'Proposal · Draft 3' };
    d.footer = { l: 'City of Brookhaven · Facilities', c: '', r: 'Page {page} of {pages}' };
    d.hfFirst = true;
    d.assets.chart = { mime: 'image/png', data: await chart() };
    d.assets.facade = { mime: 'image/png', data: await facade() };
    d.notes = {
      n1: 'Visitor counts from the turnstile sensors at both entrances, averaged over 2023–2025.',
      n2: 'Brookhaven Climate Action Plan (2024), section 3.2: municipal buildings must cut operational emissions 50% by 2032.',
      n3: 'Quotes are indicative and include a 12% contingency; final figures follow the tender in February.',
    };
    d.comments = {
      c1: { author: 'Jonas Berg', date: '2026-10-09T09:12:00Z', text: 'Can we cite the board minutes here? The trustees asked for it.' },
      c2: { author: 'Maya Chen', date: '2026-10-10T14:40:00Z', text: 'Numbers updated after the October site visit — please double-check the HVAC line.' },
    };
    const ins = { au: 'Jonas Berg', dt: '2026-10-11T10:05:00Z' }, del = { au: 'Jonas Berg', dt: '2026-10-11T10:05:00Z' };
    d.blocks = [
      P('Title', 'Riverside Library Renovation'),
      P('Subtitle', 'A proposal to modernise the 1962 building into a low-carbon community hub'),
      P('Normal', T('Prepared for the Brookhaven Library Board by the Facilities Team · ', { color: '#5b6b7c' }), T('October 2026', { color: '#5b6b7c', b: true })),
      { t: 'toc' },
      P('Heading1', 'Executive summary'),
      P('Normal', 'Riverside Library is the busiest public building in Brookhaven. It welcomed more than ', T('112,000 visitors', { b: true }), ' last year', { t: 'fn', id: 'n1' }, ', yet it still runs on the heating plant, single glazing and wiring it opened with in 1962. This proposal sets out a phased renovation that keeps the library open throughout, ', T('halves energy use', { i: true }), ' and adds the flexible space residents have asked for in every survey since 2019.'),
      P('Normal', 'The work is split into three phases over eighteen months. The total budget is ', T('$4.86 million', { b: true }), ', of which ', T('$1.2 million', { cm: ['c1'] }), T(' is already committed by the state library fund', { cm: ['c1'] }), '. We ask the Board to approve phase one at its November meeting so that design work can begin in January.'),
      { ...P('Quote', '“The library is the one place in town where nobody asks you to buy anything. We want it to feel like that place again.”'), runs: [T('“The library is the one place in town where nobody asks you to buy anything. We want it to feel like that place again.”'), T(' — resident, 2025 survey', { i: false, color: '#5b6b7c', size: 10 })] },
      P('Heading1', 'Background'),
      { ...P('Normal'), runs: [{ t: 'img', asset: 'facade', w: 150, h: 173, wrap: 'right', alt: 'Sketch of the library with the new glass reading wing' }, T('The building was designed by the city architect’s office as a single-storey brick hall with a mezzanine stack. A 1988 extension added the children’s room but also the flat roof that has leaked every winter since. Today the library offers 41 public computers, six study rooms and a maker space squeezed into a former storage room.')] },
      P('Normal', 'Three things have changed since the last refurbishment. First, demand has shifted from lending to ', T('staying', { i: true }), ': people come to work, study and meet, and average visits have grown from 25 minutes to over an hour. Second, the city has committed to cutting emissions from its own buildings', { t: 'fn', id: 'n2' }, '. Third, the roof and heating plant are now at the end of their lives, so the money will be spent whether or not we improve the building.'),
      P('Heading2', 'What visitors told us'),
      P('Normal', 'We ran workshops with 340 residents and collected 1,150 survey responses. The requests that came up most often were:'),
      LI('ul', 0, T('More quiet study space', { b: true }), ' — the study rooms are booked solid from 3 pm to closing.'),
      LI('ul', 0, T('A comfortable temperature', { b: true }), ' — the reading room swings between 15 °C in January and 29 °C in July.'),
      LI('ul', 1, 'Older visitors in particular avoid the building on hot afternoons.'),
      LI('ul', 0, T('Longer opening hours', { b: true }), ' on weekends, and a space that can be booked for community events.'),
      LI('ul', 0, T('Step-free access', { b: true }), ' to the mezzanine and the garden.'),
      { ...P('Normal'), align: 'center', runs: [{ t: 'img', asset: 'chart', w: 400, h: 187, wrap: 'inline', alt: 'Bar chart of monthly visitors in 2025' }] },
      P('Caption', 'Figure 1. Monthly visitors in 2025. Summer peaks coincide with the hottest weeks of the year.'),
      P('Heading1', 'Proposed works'),
      P('Normal', 'The design keeps the original hall — its timber ceiling and clerestory windows are the building’s best features — and concentrates new work where it does the most good.'),
      P('Heading2', 'Phase one: envelope and plant'),
      P('Normal', 'Replace the flat roof with an insulated green roof, fit secondary glazing behind the original steel windows, and swap the gas boilers for two air-source heat pumps. ', T('Solar panels on the 1988 extension will supply roughly a fifth of the building’s electricity.', { ins })),
      P('Heading2', 'Phase two: interior'),
      P('Normal', 'Rebuild the mezzanine with a lift, add eight bookable study rooms, and convert the old staff kitchen into a ', T('small', { del }), T(' café counter run by the Friends of the Library.', {})),
      P('Heading2', 'Phase three: the garden room'),
      P('Normal', 'A glass reading wing opens the children’s library onto the garden. It can be closed off from the main hall and booked in the evenings for community events, talks and classes.'),
      P('Heading1', 'Budget and timeline'),
      P('Normal', 'The cost estimate below was prepared with the city’s quantity surveyor', { t: 'fn', id: 'n3' }, '. It assumes the library stays open, with temporary closures of individual rooms only.'),
      { t: 'table', widths: [46, 18, 18, 18], rows: [
        { h: true, cells: ['Item', 'Phase', 'Start', 'Cost'].map(x => ({ blocks: [P('Normal', x)] })) },
        { cells: [{ blocks: [P('Normal', 'Green roof and insulation')] }, { blocks: [P('Normal', '1')] }, { blocks: [P('Normal', 'Mar 2027')] }, { blocks: [{ ...P('Normal', '$1,140,000'), align: 'right' }] }] },
        { cells: [{ blocks: [P('Normal', T('Heat pumps and ventilation', { cm: ['c2'] }))] }, { blocks: [P('Normal', '1')] }, { blocks: [P('Normal', 'Apr 2027')] }, { blocks: [{ ...P('Normal', '$980,000'), align: 'right' }] }] },
        { cells: [{ blocks: [P('Normal', 'Secondary glazing')] }, { blocks: [P('Normal', '1')] }, { blocks: [P('Normal', 'May 2027')] }, { blocks: [{ ...P('Normal', '$410,000'), align: 'right' }] }] },
        { cells: [{ blocks: [P('Normal', 'Mezzanine, lift and study rooms')] }, { blocks: [P('Normal', '2')] }, { blocks: [P('Normal', 'Oct 2027')] }, { blocks: [{ ...P('Normal', '$1,320,000'), align: 'right' }] }] },
        { cells: [{ blocks: [P('Normal', 'Garden reading wing')] }, { blocks: [P('Normal', '3')] }, { blocks: [P('Normal', 'Mar 2028')] }, { blocks: [{ ...P('Normal', '$1,010,000'), align: 'right' }] }] },
        { cells: [{ cs: 3, bg: '#f3f6fa', blocks: [P('Normal', T('Total', { b: true }))] }, { bg: '#f3f6fa', blocks: [{ ...P('Normal', T('$4,860,000', { b: true })), align: 'right' }] }] },
      ] },
      P('Heading2', 'Key milestones'),
      LI('ol', 0, 'Board approval of phase one — November 2026'),
      LI('ol', 0, 'Design development and planning consent — January to February 2027'),
      LI('ol', 1, 'Public exhibition of the design at the library'),
      LI('ol', 1, 'Tender for the roof and plant contract'),
      LI('ol', 0, 'Phase one works complete — September 2027'),
      LI('ol', 0, 'Garden room opens — summer 2028'),
      P('Heading1', 'Risks'),
      P('Normal', 'The main risks are the condition of the 1962 roof structure, which we will survey before tender, and the lead time for heat pumps, currently twelve weeks. Phasing lets us adjust the later phases if costs move: phase three can be deferred by a year without affecting the rest of the programme.'),
      P('Heading1', 'Recommendation'),
      P('Normal', 'We recommend that the Board ', T('approves phase one', { b: true }), ' at a cost of $2.53 million and authorises the Facilities Team to begin design development and apply for the remaining state and federal grants.'),
      P('Code', 'Board resolution 2026-11-04  ·  Vote: approve / defer / reject'),
    ];
    return d;
  }
  async function open() {
    if (!(await IO.confirmDiscard())) return;
    Aero.busy('Building the sample…');
    try { const d = await build(); await App.setDocument(d, 'Riverside Library Proposal', null); }
    finally { Aero.busy(); }
  }
  return { build, open };
})();
