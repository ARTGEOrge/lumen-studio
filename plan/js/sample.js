// Sample project shown on first run: a small office building, with WBS, logic, resources and costs.
(function (root) {
  const a = (id, name, level, dur, res = [], extra = {}) => ({ id, name, level, dur, pct: 0, resources: res.map(([r, u]) => ({ res: r, units: u })), notes: '', ...extra });
  function sampleProject(start) {
    start = start || '2026-11-02';
    const p = {
      name: 'Riverside Office Building', start, dataDate: null, mustFinish: null,
      calendar: { workweek: [false, true, true, true, true, true, false], holidays: ['2026-11-26', '2026-12-25', '2027-01-01'] },
      resources: [
        { id: 'PM', name: 'Project manager', max: 1, rate: 720 },
        { id: 'CIV', name: 'Civil crew', max: 2, rate: 1600 },
        { id: 'STL', name: 'Steel erectors', max: 1, rate: 2400 },
        { id: 'MEP', name: 'MEP trades', max: 2, rate: 1900 },
        { id: 'FIN', name: 'Finishing crew', max: 2, rate: 1400 },
      ],
      activities: [
        a('WBS-1', 'Pre-construction', 0, 0),
        a('A1000', 'Notice to proceed', 1, 0),
        a('A1010', 'Permits and approvals', 1, 15, [['PM', 0.5]], { cost: 4500 }),
        a('A1020', 'Site survey', 1, 4, [['CIV', 1]]),
        a('A1030', 'Mobilize site', 1, 5, [['CIV', 1], ['PM', 0.5]], { cost: 12000 }),
        a('WBS-2', 'Substructure', 0, 0),
        a('A2000', 'Excavation', 1, 8, [['CIV', 2]], { cost: 18000 }),
        a('A2010', 'Footings', 1, 6, [['CIV', 1]], { cost: 26000 }),
        a('A2020', 'Ground-floor slab', 1, 5, [['CIV', 1]], { cost: 31000 }),
        a('A2030', 'Underground services', 1, 6, [['MEP', 1]], { cost: 15000 }),
        a('WBS-3', 'Superstructure', 0, 0),
        a('A3000', 'Steel frame', 1, 15, [['STL', 1]], { cost: 145000 }),
        a('A3010', 'Floor decks', 1, 10, [['CIV', 1], ['STL', 1]], { cost: 64000 }),
        a('A3020', 'Roof', 1, 8, [['CIV', 1]], { cost: 38000 }),
        a('A3030', 'Building envelope', 1, 18, [['FIN', 1]], { cost: 92000 }),
        a('M3000', 'Building weathertight', 1, 0),
        a('WBS-4', 'Services and fit-out', 0, 0),
        a('A4000', 'MEP rough-in', 1, 20, [['MEP', 2]], { cost: 118000 }),
        a('A4010', 'Drywall and ceilings', 1, 15, [['FIN', 2]], { cost: 54000 }),
        a('A4020', 'MEP final fix', 1, 10, [['MEP', 1]], { cost: 41000 }),
        a('A4030', 'Paint and flooring', 1, 12, [['FIN', 2]], { cost: 47000 }),
        a('A4040', 'Elevator install', 1, 25, [], { cost: 85000 }),
        a('WBS-5', 'Handover', 0, 0),
        a('A5000', 'Commissioning', 1, 8, [['MEP', 1], ['PM', 1]], { cost: 9000 }),
        a('A5010', 'Snagging', 1, 6, [['FIN', 1], ['PM', 0.5]]),
        a('A5020', 'Practical completion', 1, 0),
      ],
      links: [
        ['A1000', 'A1010'], ['A1000', 'A1020'], ['A1010', 'A1030'], ['A1020', 'A1030'], ['A1030', 'A2000'],
        ['A2000', 'A2010'], ['A2010', 'A2020'], ['A2000', 'A2030', 'SS', 4], ['A2030', 'A2020', 'FF', 0],
        ['A2020', 'A3000'], ['A3000', 'A3010', 'SS', 5], ['A3010', 'A3020'], ['A3000', 'A3030', 'SS', 10], ['A3020', 'M3000'], ['A3030', 'M3000'],
        ['M3000', 'A4000'], ['A4000', 'A4010', 'SS', 8], ['A4010', 'A4020'], ['A4020', 'A4030', 'SS', 3], ['A3010', 'A4040'],
        ['A4030', 'A5000'], ['A4040', 'A5000'], ['A5000', 'A5010'], ['A5010', 'A5020'],
      ].map(([from, to, type = 'FS', lag = 0]) => ({ from, to, type, lag })),
      codes: [
        { id: 'RESP', name: 'Responsibility', values: [{ v: 'OWN', d: 'Owner' }, { v: 'GC', d: 'General contractor' }, { v: 'CIV', d: 'Civil subcontractor' }, { v: 'STL', d: 'Steel subcontractor' }, { v: 'MEP', d: 'MEP subcontractor' }, { v: 'FIN', d: 'Finishes subcontractor' }] },
        { id: 'AREA', name: 'Area', values: [{ v: 'SITE', d: 'Site and below grade' }, { v: 'SHELL', d: 'Structure and envelope' }, { v: 'INT', d: 'Interiors and services' }] },
      ],
      baselines: [], activeBaseline: null,
    };
    const codeOf = { A1000: 'OWN SITE', A1010: 'OWN SITE', A1020: 'CIV SITE', A1030: 'GC SITE', A2000: 'CIV SITE', A2010: 'CIV SITE', A2020: 'CIV SITE', A2030: 'MEP SITE',
      A3000: 'STL SHELL', A3010: 'STL SHELL', A3020: 'GC SHELL', A3030: 'FIN SHELL', M3000: 'GC SHELL', A4000: 'MEP INT', A4010: 'FIN INT', A4020: 'MEP INT', A4030: 'FIN INT', A4040: 'GC INT',
      A5000: 'MEP INT', A5010: 'GC INT', A5020: 'OWN INT' };
    p.activities.forEach(a => { if (codeOf[a.id]) { const [r, ar] = codeOf[a.id].split(' '); a.codes = { RESP: r, AREA: ar }; } });
    const steel = p.activities.find(a => a.id === 'A3000');
    steel.pctType = 'physical';
    steel.steps = [{ name: 'Anchor bolts surveyed', weight: 1, pct: 0 }, { name: 'Columns erected', weight: 4, pct: 0 }, { name: 'Beams and bracing', weight: 4, pct: 0 }, { name: 'Bolt-up and plumb', weight: 1, pct: 0 }];
    const env = p.activities.find(a => a.id === 'A3030');
    env.steps = [{ name: 'Curtain wall', weight: 3, pct: 0 }, { name: 'Cladding', weight: 2, pct: 0 }, { name: 'Glazing and seals', weight: 1, pct: 0 }]; env.pctType = 'physical';
    return p;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { sampleProject }; else root.PlanSample = { sampleProject };
})(typeof self !== 'undefined' ? self : this);
