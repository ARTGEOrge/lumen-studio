'use strict';
/* Lumen Layout — "Open Sample": a 4-page magazine (cover, threaded two-page feature with drop cap,
   wrapped image and pull quote, field-notes page with image grid and a table), built with paragraph &
   character styles and a facing master spread with automatic page numbers. Images are painted
   procedurally so the app needs no bundled photos. */
const Sample = (() => {
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
  function grad(ctx, y0, y1, stops) { const g = ctx.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
  function ridge(R, w, base, amp, rough, n = 9) {
    let pts = [base + (R() - .5) * amp, base + (R() - .5) * amp]; let a = amp;
    for (let k = 0; k < n; k++) { const np = []; for (let i = 0; i < pts.length - 1; i++) { np.push(pts[i], (pts[i] + pts[i + 1]) / 2 + (R() - .5) * a); } np.push(pts[pts.length - 1]); pts = np; a *= rough; }
    return pts.map((y, i) => [i / (pts.length - 1) * w, y]);
  }
  function fillRidge(ctx, pts, h, fill) { ctx.beginPath(); ctx.moveTo(0, h); pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(pts[pts.length - 1][0], h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
  function stars(ctx, R, w, h, n, yMax, bright = 1) {
    for (let i = 0; i < n; i++) {
      const x = R() * w, y = Math.pow(R(), 1.3) * yMax, s = Math.pow(R(), 6) * 2.2 + .35;
      const t = R(); ctx.fillStyle = `rgba(${t < .2 ? '255,214,180' : t < .4 ? '190,215,255' : '255,255,255'},${(.35 + R() * .65) * bright})`;
      ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
      if (s > 1.7) { const g = ctx.createRadialGradient(x, y, 0, x, y, s * 5); g.addColorStop(0, 'rgba(220,235,255,.35)'); g.addColorStop(1, 'rgba(220,235,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - s * 5, y - s * 5, s * 10, s * 10); }
    }
  }
  function milkyWay(ctx, R, w, h, x0, y0, x1, y1, width) {
    const steps = 140;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < steps; k++) {
      const t = k / steps, x = x0 + (x1 - x0) * t + (R() - .5) * width * .4, y = y0 + (y1 - y0) * t + (R() - .5) * width * .4;
      const r = width * (.35 + R() * .5) * (0.6 + Math.sin(t * Math.PI) * .6);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const warm = R() < .35; g.addColorStop(0, warm ? 'rgba(255,200,160,.07)' : 'rgba(170,190,255,.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // dense star field along the band
    for (let i = 0; i < 9000; i++) {
      const t = R(), off = (R() + R() + R() - 1.5) * width * .55;
      const nx = -(y1 - y0), ny = x1 - x0, L = Math.hypot(nx, ny);
      const x = x0 + (x1 - x0) * t + nx / L * off, y = y0 + (y1 - y0) * t + ny / L * off;
      ctx.fillStyle = `rgba(255,255,255,${.15 + R() * .5})`; ctx.fillRect(x, y, R() < .9 ? 1 : 1.6, R() < .9 ? 1 : 1.6);
    }
    ctx.restore();
    // dust lanes
    ctx.save(); ctx.globalCompositeOperation = 'multiply';
    for (let k = 0; k < 60; k++) {
      const t = .15 + R() * .7, x = x0 + (x1 - x0) * t + (R() - .5) * width * .25, y = y0 + (y1 - y0) * t + (R() - .5) * width * .25, r = width * (.08 + R() * .18);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(40,30,50,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }
  function grain(ctx, w, h, R, amt = 10) {
    const id = ctx.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const n = (R() - .5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    ctx.putImageData(id, 0, 0);
  }
  function trees(ctx, R, w, baseY, hmin, hmax, color, count) {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = R() * w, th = hmin + R() * (hmax - hmin), tw = th * (.22 + R() * .1), y = baseY + R() * 8;
      ctx.beginPath(); ctx.moveTo(x, y - th);
      for (let k = 1; k <= 5; k++) { const yy = y - th + th * k / 5, ww = tw * k / 5; ctx.lineTo(x + ww, yy); ctx.lineTo(x + ww * .45, yy); }
      ctx.lineTo(x + tw * .1, y + 6); ctx.lineTo(x - tw * .1, y + 6);
      for (let k = 5; k >= 1; k--) { const yy = y - th + th * k / 5, ww = tw * k / 5; ctx.lineTo(x - ww * .45, yy); ctx.lineTo(x - ww, yy); }
      ctx.closePath(); ctx.fill();
    }
  }

  const PAINT = {
    cover(w, h) {
      const [c, ctx] = canvas(w, h), R = rng(7);
      ctx.fillStyle = grad(ctx, 0, h, [[0, '#050a1c'], [.45, '#0d1838'], [.68, '#2a2c5a'], [.8, '#7a4a6a'], [.88, '#e08a5a'], [1, '#f6c27a']]); ctx.fillRect(0, 0, w, h);
      stars(ctx, R, w, h, 2200, h * .8);
      milkyWay(ctx, R, w, h, w * 1.05, h * .02, w * .1, h * .86, w * .32);
      const g = ctx.createRadialGradient(w * .62, h * .86, 0, w * .62, h * .86, w * .7); g.addColorStop(0, 'rgba(255,170,100,.55)'); g.addColorStop(1, 'rgba(255,170,100,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      fillRidge(ctx, ridge(R, w, h * .78, h * .08, .55), h, 'rgba(70,60,95,.9)');
      fillRidge(ctx, ridge(R, w, h * .83, h * .07, .55), h, '#2b2742');
      fillRidge(ctx, ridge(R, w, h * .88, h * .06, .5), h, '#16152a');
      trees(ctx, R, w, h * .955, h * .05, h * .11, '#07070f', 70);
      ctx.fillStyle = '#05050b'; ctx.fillRect(0, h * .96, w, h * .04);
      grain(ctx, w, h, R, 9); return c;
    },
    observatory(w, h) {
      const [c, ctx] = canvas(w, h), R = rng(21);
      ctx.fillStyle = grad(ctx, 0, h, [[0, '#04081a'], [.6, '#0f1d3d'], [.85, '#3a3358'], [1, '#6a4a5a']]); ctx.fillRect(0, 0, w, h);
      // star trails around a pole above the frame
      const px = w * .58, py = -h * .15; ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 1100; i++) {
        const r = Math.sqrt(R()) * w * 1.25 + 8, a0 = R() * Math.PI * 2, len = .25 + R() * .12, t = R();
        ctx.strokeStyle = `rgba(${t < .3 ? '255,200,170' : t < .55 ? '170,200,255' : '235,240,255'},${.12 + R() * .55})`; ctx.lineWidth = R() < .9 ? .8 : 1.6;
        ctx.beginPath(); ctx.arc(px, py, r, a0, a0 + len); ctx.stroke();
      }
      ctx.restore();
      fillRidge(ctx, ridge(R, w, h * .8, h * .06, .5), h, '#1d1a30');
      // hill + dome
      ctx.fillStyle = '#0a0a14'; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * .9); ctx.quadraticCurveTo(w * .3, h * .76, w * .55, h * .78); ctx.quadraticCurveTo(w * .8, h * .8, w, h * .88); ctx.lineTo(w, h); ctx.fill();
      const dx = w * .44, dy = h * .72, dr = w * .075;
      ctx.fillStyle = '#12111d'; ctx.fillRect(dx - dr, dy, dr * 2, h * .06);
      ctx.beginPath(); ctx.arc(dx, dy, dr, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(255,90,60,.85)'; ctx.fillRect(dx - dr * .12, dy - dr * .95, dr * .24, dr * .95);
      const g = ctx.createRadialGradient(dx, dy - dr * .5, 0, dx, dy - dr * .5, dr * 1.6); g.addColorStop(0, 'rgba(255,80,50,.35)'); g.addColorStop(1, 'rgba(255,80,50,0)'); ctx.fillStyle = g; ctx.fillRect(dx - dr * 2, dy - dr * 2, dr * 4, dr * 3);
      grain(ctx, w, h, R, 8); return c;
    },
    aurora(w, h) {
      const [c, ctx] = canvas(w, h), R = rng(5);
      ctx.fillStyle = grad(ctx, 0, h, [[0, '#020812'], [.5, '#06202a'], [.62, '#0b2f33'], [1, '#04131a']]); ctx.fillRect(0, 0, w, h);
      stars(ctx, R, w, h, 900, h * .6);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let band = 0; band < 3; band++) {
        const ph = R() * 6, amp = h * (.05 + R() * .05), base = h * (.22 + band * .08);
        for (let x = 0; x < w; x += 2) {
          const y = base + Math.sin(x / w * 5 + ph) * amp + Math.sin(x / w * 13 + ph * 2) * amp * .3;
          const len = h * (.12 + .1 * Math.sin(x / w * 9 + ph * 3) ** 2);
          const g = ctx.createLinearGradient(0, y - len, 0, y + 8);
          g.addColorStop(0, 'rgba(160,60,200,0)'); g.addColorStop(.55, band === 1 ? 'rgba(170,80,210,.10)' : 'rgba(60,240,150,.10)'); g.addColorStop(.97, 'rgba(120,255,170,.32)'); g.addColorStop(1, 'rgba(120,255,170,0)');
          ctx.fillStyle = g; ctx.fillRect(x, y - len, 2.4, len + 8);
        }
      }
      ctx.restore();
      // lake reflection
      const hor = h * .66;
      ctx.save(); ctx.globalAlpha = .45; ctx.translate(0, hor * 2); ctx.scale(1, -1); ctx.drawImage(c, 0, 0, w, hor, 0, 0, w, hor); ctx.restore();
      ctx.fillStyle = 'rgba(2,10,16,.45)'; ctx.fillRect(0, hor, w, h - hor);
      trees(ctx, R, w, hor + 4, h * .06, h * .16, '#02060a', 90);
      grain(ctx, w, h, R, 8); return c;
    },
    desert(w, h) {
      const [c, ctx] = canvas(w, h), R = rng(33);
      ctx.fillStyle = grad(ctx, 0, h, [[0, '#0a1030'], [.4, '#2c2a5e'], [.62, '#c0607a'], [.72, '#f3a36b'], [1, '#f6c48a']]); ctx.fillRect(0, 0, w, h);
      stars(ctx, R, w, h, 500, h * .45, .8);
      ctx.fillStyle = 'rgba(255,240,210,.95)'; ctx.beginPath(); ctx.arc(w * .78, h * .2, h * .035, 0, 7); ctx.fill();
      const cols = ['#b65a3e', '#8e3f30', '#5e2a26', '#3a1a1c'];
      for (let k = 0; k < 4; k++) {
        const base = h * (.66 + k * .09); ctx.beginPath(); ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 8) ctx.lineTo(x, base + Math.sin(x / w * (3 + k) + k * 2) * h * .04 + Math.sin(x / w * 11 + k) * h * .01);
        ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = cols[k]; ctx.fill();
        ctx.strokeStyle = 'rgba(255,200,150,.25)'; ctx.lineWidth = 2; ctx.stroke();
      }
      grain(ctx, w, h, R, 8); return c;
    },
    coast(w, h) {
      const [c, ctx] = canvas(w, h), R = rng(44);
      ctx.fillStyle = grad(ctx, 0, h * .62, [[0, '#071028'], [.7, '#1b3a6a'], [1, '#6a7aa8']]); ctx.fillRect(0, 0, w, h);
      stars(ctx, R, w, h, 1000, h * .55);
      milkyWay(ctx, R, w, h, w * .3, 0, w * .55, h * .62, w * .22);
      const hor = h * .62; ctx.fillStyle = grad(ctx, hor, h, [[0, '#1a2a4a'], [1, '#050a14']]); ctx.fillRect(0, hor, w, h - hor);
      ctx.strokeStyle = 'rgba(170,200,255,.18)'; for (let i = 0; i < 70; i++) { const y = hor + Math.pow(R(), 1.6) * (h - hor), x = R() * w, L = 20 + R() * 120; ctx.lineWidth = 1 + (y - hor) / h * 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + L, y); ctx.stroke(); }
      ctx.fillStyle = '#04070d'; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * .7); ctx.quadraticCurveTo(w * .12, h * .64, w * .22, h * .78); ctx.lineTo(w * .3, h); ctx.fill();
      // lighthouse
      const lx = w * .12; ctx.fillStyle = '#0b0e16'; ctx.fillRect(lx - 8, h * .52, 16, h * .14);
      const g = ctx.createRadialGradient(lx, h * .52, 0, lx, h * .52, 60); g.addColorStop(0, 'rgba(255,230,160,.9)'); g.addColorStop(1, 'rgba(255,230,160,0)'); ctx.fillStyle = g; ctx.fillRect(lx - 60, h * .52 - 60, 120, 120);
      grain(ctx, w, h, R, 8); return c;
    },
    city(w, h) {
      const [c, ctx] = canvas(w, h), R = rng(66);
      ctx.fillStyle = grad(ctx, 0, h, [[0, '#1a1430'], [.5, '#5a3a4a'], [.8, '#d07a3a'], [1, '#f0a050']]); ctx.fillRect(0, 0, w, h);
      stars(ctx, R, w, h, 60, h * .3, .5);
      let x = 0; while (x < w) {
        const bw = 30 + R() * 90, bh = h * (.15 + R() * .45), y = h - bh;
        ctx.fillStyle = '#120e18'; ctx.fillRect(x, y, bw, bh);
        for (let wy = y + 8; wy < h - 6; wy += 10) for (let wx = x + 5; wx < x + bw - 5; wx += 9) if (R() < .45) { ctx.fillStyle = R() < .8 ? 'rgba(255,200,120,.85)' : 'rgba(180,220,255,.8)'; ctx.fillRect(wx, wy, 4, 5); }
        x += bw + 2;
      }
      grain(ctx, w, h, R, 8); return c;
    },
    tent(w, h) {
      const [c, ctx] = canvas(w, h), R = rng(88);
      ctx.fillStyle = grad(ctx, 0, h, [[0, '#030716'], [.7, '#14234a'], [1, '#2a2a40']]); ctx.fillRect(0, 0, w, h);
      stars(ctx, R, w, h, 1400, h * .8);
      milkyWay(ctx, R, w, h, w * .1, 0, w * .9, h * .7, w * .2);
      fillRidge(ctx, ridge(R, w, h * .78, h * .05, .5), h, '#0d0f1c');
      const tx = w * .55, ty = h * .86;
      ctx.fillStyle = '#ffb860'; ctx.beginPath(); ctx.moveTo(tx - 70, ty); ctx.lineTo(tx, ty - 80); ctx.lineTo(tx + 70, ty); ctx.closePath(); ctx.fill();
      const g = ctx.createRadialGradient(tx, ty - 30, 0, tx, ty - 30, 220); g.addColorStop(0, 'rgba(255,170,80,.45)'); g.addColorStop(1, 'rgba(255,170,80,0)'); ctx.fillStyle = g; ctx.fillRect(tx - 220, ty - 250, 440, 400);
      ctx.fillStyle = '#c06a20'; ctx.beginPath(); ctx.moveTo(tx - 8, ty); ctx.lineTo(tx, ty - 50); ctx.lineTo(tx + 8, ty); ctx.fill();
      ctx.fillStyle = '#05060c'; ctx.fillRect(0, ty, w, h - ty);
      grain(ctx, w, h, R, 8); return c;
    },
  };
  function toJpeg(c) { return c.toDataURL('image/jpeg', 0.86); }

  const ARTICLE = [
    ['bodyFirst', 'On a moonless night in late September, the town of Westcliffe, Colorado, does something that would have seemed reckless a generation ago: it lets the dark in. Streetlights glow amber and low, shielded so that not a single photon escapes upward. Porch lamps switch off at ten. And above the main street, where the hardware store and the diner close early, the Milky Way rises over the Sangre de Cristo range like smoke from a slow fire.'],
    ['body', 'It was not always like this. “Twenty years ago you could read a newspaper in the parking lot at midnight,” says Ruth Keller, who runs the local astronomy club out of a converted grain shed. “Nobody thought of light as pollution. Light was safety. Light was progress.” The change began with a petition, a few dozen signatures, and a slideshow of what the sky over the valley used to look like.'],
    ['sub', 'A resource we forgot we had'],
    ['bodyNoInd', 'Astronomers estimate that eight in ten people in North America can no longer see the Milky Way from where they live. Artificial skyglow has grown by roughly ten percent a year in some regions, a quiet, cumulative loss that rarely makes headlines. Unlike a felled forest or a polluted river, a lost night sky leaves no scar. It simply fades, one floodlight at a time, until nobody remembers it was there.'],
    ['body', 'The consequences reach well beyond stargazing. Migrating birds navigate by the stars and become disoriented by brightly lit towers. Sea turtle hatchlings crawl toward hotel lights instead of the moonlit surf. In people, too much light at night has been linked to disrupted sleep and hormonal rhythms. Darkness, it turns out, is not the absence of something useful. It is an ecosystem service, as real as clean water.'],
    ['body', 'The good news is that light pollution may be the most reversible environmental problem we have. Turn off a light, and the damage stops instantly. Point a fixture downward, and the sky above it begins to recover the same night. There is no cleanup, no half-life, no decades-long wait.'],
    ['sub', 'The certification game'],
    ['bodyNoInd', 'Westcliffe and its neighbor, Silver Cliff, earned recognition as an International Dark Sky Community in 2015.^ Since then more than two hundred places worldwide have followed: national parks and remote islands, but also ordinary towns that decided their night was worth protecting. The criteria are practical rather than romantic. Fixtures must be fully shielded. Color temperatures must stay warm. Public lighting must have a plan, and that plan must be enforced.'],
    ['body', 'For small communities the designation has become an unexpected economic engine. Visitors arrive at dusk, stay the night, and leave after breakfast. Motels advertise telescope rentals. One café near Flagstaff sells a “new moon special” on the darkest weekend of every month, and it sells out. “People drive six hours to see what their grandparents saw every night,” Keller says. “That tells you something.”'],
    ['body', 'Not every switch has been easy. Business owners worried that dimmer streets would invite crime; a few residents simply liked their bright yards. Studies have offered little support for the idea that more light means more safety, and well-aimed lighting often improves visibility by reducing glare. Still, persuasion has mostly happened one conversation at a time, and often under the stars themselves.'],
    ['sub', 'What you can do tonight'],
    ['bodyNoInd', 'The simplest step is to look at your own lights. Is that fixture shining sideways into a neighbor’s bedroom, or up into the sky where it helps no one? A motion sensor, a lower-wattage warm bulb, or a shield that costs less than a pizza can make a measurable difference. Ask whether a light needs to be on at all after midnight.'],
    ['body', 'Then go and find some darkness. Give your eyes twenty minutes to adjust, leave your phone in your pocket, and wait. The faint stars arrive first, then the soft river of the galaxy, then the realization that this view has been waiting there, patiently, the whole time. All it ever needed was for us to turn the lights down.'],
    ['body', 'Scientists are paying attention, too. Satellite surveys now track the spread of artificial light from orbit, and citizen scientists contribute tens of thousands of naked-eye star counts every year. The data are sobering — in many places the number of visible stars is halving in under a decade — but they also show how quickly a determined town can reverse the trend. When Westcliffe swapped its fixtures, its readings on the sky-quality meter improved within a single season.'],
    ['sub', 'Better light, not less safety'],
    ['bodyNoInd', 'None of this means living in the dark. The new generation of fixtures puts light exactly where people walk and park, at a fraction of the energy, and many towns have found the switch pays for itself within a few years. Warm amber LEDs, dimmed after midnight and aimed straight down, read as calm rather than gloomy. The sky, it turns out, is a side benefit of simply lighting well.'],
    ['body', 'Back in Westcliffe, the astronomy club’s Saturday sessions now draw more visitors than the town has motel rooms. Keller hands out red flashlights at the door and asks everyone to switch off their headlights before turning into the lot. “The first thing people do when they look up,” she says, “is go quiet. Then they laugh. I think it’s relief.” ■'],
  ];

  const NOTES = ['Designated by DarkSky International (formerly the International Dark-Sky Association), which certifies parks, reserves and communities.'];
  async function build() {
    const W = 612, H = 792;
    const d = M.newDoc({ units: 'in', w: W, h: H, facing: true, pages: 4, margins: { t: 54, b: 54, i: 54, o: 42 }, cols: 2, gutter: 18, bleed: 9, slug: 0 });
    d.grid = { start: 54, step: 13.5 };
    // a print (CMYK) document: process swatches plus one spot ink for the brand orange
    d.cmyk = true;
    d.swatches = [
      { id: 'paper', name: 'Paper', model: 'cmyk', v: [0, 0, 0, 0] }, { id: 'black', name: 'Black', model: 'cmyk', v: [0, 0, 0, 100] },
      { id: 'ink', name: 'Ink', model: 'cmyk', v: [72, 62, 52, 78] }, { id: 'navy', name: 'Night Navy', model: 'cmyk', v: [92, 78, 48, 62] },
      { id: 'grey', name: 'Slate', model: 'cmyk', v: [45, 30, 20, 38] }, { id: 'acc', name: 'Horizon Orange (PMS 7579 C)', model: 'cmyk', v: [0, 78, 92, 6], spot: true },
      { id: 'sand', name: 'Sand', model: 'cmyk', v: [4, 6, 12, 0] }, { id: 'rule', name: 'Rule Grey', model: 'cmyk', v: [18, 10, 6, 6] },
      { id: 'gold', name: 'C=0 M=20 Y=90 K=0', model: 'cmyk', v: [0, 20, 90, 0] }, { id: 'teal', name: 'C=85 M=10 Y=45 K=0', model: 'cmyk', v: [85, 10, 45, 0] },
    ];
    const ACC = '@acc', NAVY = '@navy', INK = '@ink', GREY = '@grey', WHITE = '@paper';
    d.layers[0].name = 'Text & Graphics';
    d.layers.unshift({ id: 'Lnotes', name: 'Notes', color: '#d9534f', visible: true, locked: false });
    const L1 = d.layers[1].id;
    d.paraStyles = {
      basic: { name: 'Basic Paragraph', font: 'Source Serif 4', size: 10, lead: 13.5, color: INK },
      body: { name: 'Body', basedOn: 'basic', size: 9.5, lead: 13.5, align: 'justify', indF: 12, hyph: true, grid: true, composer: 'paragraph' },
      bodyNoInd: { name: 'Body No Indent', basedOn: 'body', indF: 0 },
      bodyFirst: { name: 'Body First (Drop Cap)', basedOn: 'body', indF: 0, dropL: 3, dropC: 1, next: 'body' },
      sub: { name: 'Subhead', font: 'Montserrat', weight: 700, size: 7.5, lead: 13.5, caps: 'all', track: 140, color: ACC, spB: 6, hyph: false, grid: true, next: 'bodyNoInd' },
      kicker: { name: 'Kicker', font: 'Oswald', weight: 500, size: 10, track: 260, caps: 'all', color: ACC, hyph: false },
      head: { name: 'Headline', font: 'Playfair Display', weight: 900, size: 54, lead: 54, track: -10, color: NAVY, hyph: false },
      head2: { name: 'Headline Small', basedOn: 'head', size: 30, lead: 32 },
      deck: { name: 'Deck', font: 'Source Serif 4', italic: true, size: 13, lead: 17, color: '@navy/80', hyph: false },
      byline: { name: 'Byline', font: 'Montserrat', weight: 600, size: 6.5, track: 160, caps: 'all', color: GREY, hyph: false },
      caption: { name: 'Caption', font: 'Montserrat', size: 6.8, lead: 9, color: GREY, hyph: false },
      capTitle: { name: 'Caption Title', font: 'Montserrat', weight: 700, size: 7, lead: 9, caps: 'all', track: 100, color: NAVY, hyph: false, next: 'caption' },
      pull: { name: 'Pull Quote', font: 'Playfair Display', italic: true, size: 17, lead: 21, color: NAVY, align: 'left', hyph: false },
      pullBy: { name: 'Pull Quote Source', font: 'Montserrat', weight: 600, size: 6.5, track: 160, caps: 'all', color: ACC, spB: 6 },
      folio: { name: 'Folio', font: 'Montserrat', weight: 600, size: 6.5, track: 180, caps: 'all', color: GREY, hyph: false },
      mast: { name: 'Masthead', font: 'Playfair Display', weight: 900, size: 104, lead: 104, track: 40, color: WHITE, align: 'center', hyph: false },
      issue: { name: 'Cover Issue Line', font: 'Montserrat', weight: 600, size: 8, track: 340, caps: 'all', color: WHITE, align: 'center', hyph: false },
      coverHead: { name: 'Cover Headline', font: 'Playfair Display', weight: 900, size: 44, lead: 44, color: WHITE, hyph: false },
      coverDeck: { name: 'Cover Deck', font: 'Source Serif 4', italic: true, size: 14, lead: 18.5, color: '@sand', spB: 8, hyph: false },
      coverLine: { name: 'Cover Line', font: 'Montserrat', weight: 600, size: 7.5, lead: 11, track: 120, caps: 'all', color: WHITE, hyph: false },
      tableNote: { name: 'Table Note', font: 'Source Serif 4', italic: true, size: 8, lead: 11, color: GREY },
      listItem: { name: 'Caption List', basedOn: 'caption', list: 'bullet', lchar: '\u2022', indL: 9, indF: -9, spB: 1.5 },
      footnote: { name: 'Footnote', font: 'Source Serif 4', size: 7, lead: 9, color: GREY },
      inside: { name: 'Cover Contents', font: 'Montserrat', weight: 600, size: 7.5, lead: 12, track: 60, color: WHITE, hyph: false, tabs: [{ x: 118, t: 'r', ld: '.' }] },
    };
    d.charStyles = { em: { name: 'Emphasis', italic: true }, strong: { name: 'Strong', weight: 700 }, drop: { name: 'Drop Cap', font: 'Playfair Display', weight: 900, color: ACC }, accent: { name: 'Accent', color: ACC, weight: 700 } };

    // images
    const imgs = {};
    const mk = (key, w, h, name) => { const c = PAINT[key](w, h); const id = 'G' + key; imgs[id] = { name, mime: 'image/jpeg', data: toJpeg(c), w, h }; return id; };
    const IM = {
      cover: mk('cover', 1400, 1800, 'milky-way-over-the-sangre-de-cristo.jpg'), obs: mk('observatory', 1600, 860, 'observatory-star-trails.jpg'),
      aurora: mk('aurora', 1000, 700, 'aurora-lake.jpg'), desert: mk('desert', 1000, 700, 'desert-dusk.jpg'), coast: mk('coast', 1000, 700, 'coast-lighthouse.jpg'),
      city: mk('city', 1000, 700, 'city-glow.jpg'), tent: mk('tent', 1000, 700, 'camp-under-the-galaxy.jpg'),
    };

    const story = (paras, ps) => {
      const s = M.newStory(d, ps || 'basic'); const notes = [...NOTES];
      const text = [], ca = [];
      const em = M.attrIdx(s, { cs: 'em' }), drop = M.attrIdx(s, { cs: 'drop' }), acc = M.attrIdx(s, { cs: 'accent' });
      s.paras = [];
      paras.forEach(([st, t], k) => {
        let mode = 0; let first = true;
        for (const ch of t) {
          if (ch === '*') { mode = mode === 1 ? 0 : 1; continue; }
          if (ch === '~') { mode = mode === 2 ? 0 : 2; continue; }
          if (ch === '^') { const id = 'N' + M.uid(); s.notes[id] = { text: notes.shift() || '' }; text.push('\uE001'); ca.push(M.attrIdx(s, { fn: id })); first = false; continue; }
          text.push(ch);
          ca.push(st === 'bodyFirst' && first ? drop : mode === 1 ? em : mode === 2 ? acc : 0); first = false;
        }
        if (k < paras.length - 1) { text.push('\n'); ca.push(0); }
        s.paras.push({ ps: st });
      });
      s.text = text.join(''); s.ca = ca; return s;
    };
    const tf = (page, x, y, w, h, paras, extra = {}) => { const s = story(paras); const it = M.newItem('text', x, y, w, h, { story: s.id, layer: L1, cols: 1, gutter: 18, ...extra }); s.frames = [it.id]; page.items.push(it); return it; };
    const img = (page, x, y, w, h, id, extra = {}) => {
      const im = imgs[id]; const s = Math.max(w / im.w, h / im.h);
      const it = M.newItem('image', x, y, w, h, { img: id, cs: s, cx: (w - im.w * s) / 2, cy: (h - im.h * s) / 2, layer: L1, ...extra }); page.items.push(it); return it;
    };
    const rect = (page, x, y, w, h, fill, extra = {}) => { const it = M.newItem('rect', x, y, w, h, { fill, layer: L1, ...extra }); page.items.push(it); return it; };
    const line = (page, x, y, w, color, sw = .5) => { const it = M.newItem('line', x, y, w, 0, { stroke: color, sw, layer: L1 }); page.items.push(it); return it; };

    // master spread A
    const A = d.masters[0]; A.name = 'Feature';
    const [ml, mr] = A.pages;
    line(ml, 42, 42, 516, NAVY, .5); line(mr, 54, 42, 516, NAVY, .5);
    tf(ml, 42, 28, 300, 12, [['folio', 'Horizon  ·  The Dark-Sky Issue']]);
    tf(mr, 270, 28, 300, 12, [['folio', 'Autumn 2026  ·  horizon-magazine.org']]);
    const fl = tf(ml, 42, 748, 200, 14, [['folio', '\uE000']]);
    const fr = tf(mr, 370, 748, 200, 14, [['folio', '\uE000']]);
    S_para(d, fr, { align: 'right' }); S_para(d, ml.items[1], {}); S_para(d, mr.items[1], { align: 'right' });
    rect(ml, 42, 752, 3, 3, ACC); rect(mr, 567, 752, 3, 3, ACC);
    // shift page-number text right of the dot on the left page
    fl.x = 50;
    fr.w = 192;

    const [p1, p2, p3, p4] = d.pages;
    p1.master = null;
    // ---- page 1: cover
    img(p1, -9, -9, 630, 810, IM.cover, { name: 'Cover image' });
    // gradient scrims keep the cover type legible (vector axial shadings with soft masks in the PDF)
    rect(p1, -9, 400, 630, 401, null, { grad: { angle: 90, c0: 'cmyk(85,75,45,85)', o0: 0, c1: 'cmyk(85,75,45,85)', o1: .82 }, name: 'Bottom scrim' });
    rect(p1, -9, -9, 630, 250, null, { grad: { angle: 90, c0: 'cmyk(85,75,45,85)', o0: .55, c1: 'cmyk(85,75,45,85)', o1: 0 }, name: 'Top scrim' });
    tf(p1, 24, 36, 564, 104, [['mast', 'HORIZON']]);
    tf(p1, 24, 138, 564, 14, [['issue', 'The Dark-Sky Issue  ·  Autumn 2026  ·  No. 07']]);
    tf(p1, 48, 556, 380, 170, [['coverHead', 'The Quiet Return of the Night Sky'], ['coverDeck', 'How a handful of small towns switched off the glare — and got the Milky Way back.']]);
    line(p1, 446, 562, 118, WHITE, .6);
    tf(p1, 446, 570, 118, 150, [['coverLine', '~Inside~'], ['inside', 'Chasing darkness\t2'], ['inside', 'Field notes\t4'], ['inside', 'Bortle scale guide\t4'], ['coverLine', 'Why amber is the new white']], { });
    tf(p1, 48, 738, 300, 12, [['coverLine', '$9.95  ·  horizon-magazine.org']]);

    // ---- page 2: feature opener
    tf(p2, 42, 58, 400, 14, [['kicker', 'Feature  ·  Night Skies']]);
    tf(p2, 42, 74, 516, 62, [['head', 'Chasing Darkness']]);
    tf(p2, 42, 140, 440, 40, [['deck', 'Across the West, a quiet movement is switching off the glare. The reward is a sky most of us have never seen.']]);
    tf(p2, 42, 186, 516, 10, [['byline', 'Words by Mara Ellison  ·  Photographs by Theo Vance']]);
    img(p2, 42, 204, 516, 246, IM.obs, { name: 'Observatory' });
    tf(p2, 42, 455, 516, 12, [['caption', '~Long exposure~  The Keller Observatory dome glows red under a 90-minute star trail. Red light preserves night vision and barely scatters into the sky.']]);
    line(p2, 42, 472, 516, '@rule', .5);
    const s0 = story(ARTICLE);
    const fA = M.newItem('text', 42, 484, 516, 254, { story: s0.id, layer: L1, cols: 2, gutter: 18 });
    const fB = M.newItem('text', 54, 54, 516, 684, { story: s0.id, layer: L1, cols: 2, gutter: 18 });
    s0.frames = [fA.id, fB.id]; p2.items.push(fA); p3.items.push(fB);
    // ---- page 3: continuation, wrapped image + pull quote
    const im3 = img(p3, 321, 54, 249, 200, IM.tent, { wrap: 'box', wrapOff: 0, name: 'Camp photo' });
    const cap3 = tf(p3, 321, 258, 249, 22, [['caption', '~Westcliffe, Colorado~  A camp under the galactic core, two hours after dusk.']], { wrap: 'box', wrapOff: 8 });
    const pq = tf(p3, 54, 330, 249, 84, [['pull', '“People drive six hours to see what their grandparents saw every night.”'], ['pullBy', '— Ruth Keller, Westcliffe Astronomy Club']], { wrap: 'box', wrapOff: 10, inset: 0 });
    line(p3, 54, 324, 249, ACC, 1.5); line(p3, 54, 418, 249, ACC, .5);

    // ---- page 4: field notes grid + table
    tf(p4, 42, 58, 400, 14, [['kicker', 'Field Notes']]);
    tf(p4, 42, 74, 516, 40, [['head2', 'Six Places to Find the Milky Way']]);
    tf(p4, 42, 114, 440, 40, [['deck', 'Certified dark-sky places within a day’s drive — and what makes each one special.']]);
    const grid = [[IM.aurora, 'Lake Laberge, Yukon', 'Aurora season peaks in September, with lakeside reflections on still nights.'], [IM.desert, 'Death Valley, California', 'The largest dark-sky park in the U.S.; dunes glow for an hour after sunset.'], [IM.coast, 'Mayo Coast, Ireland', 'Atlantic skies with a lighthouse for scale. Bring a windproof layer.'],
      [IM.obs, 'Westcliffe, Colorado', 'A town that turned its lights amber. Club nights every Saturday.'], [IM.tent, 'Big Bend, Texas', 'Bortle 1 skies and warm nights make it ideal for first-timers.'], [IM.city, 'Tucson, Arizona', 'Proof a city can grow and still keep the sky: strict, enforced lighting codes.']];
    const cw = (516 - 24) / 3;
    grid.forEach(([id, t, c], k) => {
      const col = k % 3, row = Math.floor(k / 3), x = 42 + col * (cw + 12), y = 152 + row * 170;
      img(p4, x, y, cw, 112, id);
      tf(p4, x, y + 118, cw, 46, [['capTitle', t], ['caption', c]]);
    });
    tf(p4, 42, 496, 516, 20, [['sub', 'Quick guide: best months & sky quality']]);
    const tb = M.newTable(42, 518, 4, 7, 516, 18, 1);
    tb.colW = [200, 136, 80, 100]; tb.layer = L1; tb.tsize = 7.5;
    const rows = [['Place', 'Region', 'Bortle', 'Best month'], ['Death Valley National Park', 'California, USA', '1–2', 'November'], ['Big Bend National Park', 'Texas, USA', '1', 'October'], ['Westcliffe & Silver Cliff', 'Colorado, USA', '2', 'September'], ['Lake Laberge', 'Yukon, Canada', '2', 'September'], ['Mayo Dark Sky Park', 'Ireland', '2–3', 'January'], ['Tucson (urban core)', 'Arizona, USA', '6', 'December']];
    rows.forEach((r, i) => r.forEach((t, j) => { tb.cells[i][j] = { t, ...(j === 2 ? { align: 'center' } : {}) }; }));
    tb.hfill = NAVY; tb.hcolor = WHITE; tb.tcolor = INK; tb.zebra = '@sand'; tb.bcolor = '@rule'; tb.bw = .4;
    // the two September rows share a merged "Best month" cell
    Tables.merge(tb, 3, 3, 4, 3); tb.cells[3][3].t = 'September'; tb.cells[3][3].align = 'center';
    p4.items.push(tb);
    tf(p4, 42, 652, 330, 40, [['tableNote', 'The Bortle scale rates night-sky brightness from 1 (an excellent dark site, where the zodiacal light is obvious) to 9 (an inner-city sky). Most suburbs sit at 5 or 6.']]);
    rect(p4, 390, 652, 168, 86, '@sand', { radius: 4 });
    tf(p4, 400, 662, 148, 66, [['capTitle', 'Next issue'], ['listItem', 'Photographing meteors with a phone'], ['listItem', 'The night-blooming garden returns'], ['listItem', 'A field guide to winter constellations']]);
    // a note on the Notes layer (non-printing style hint)
    // ruler guides
    p2.guides.push({ o: 'h', pos: 472 }); p3.guides.push({ o: 'v', pos: 312 });
    return { doc: d, images: imgs };
  }
  function S_para(d, it, props) { const s = d.stories[it.story]; s.paras = s.paras.map(p => ({ ...p, ...props })); }
  return { build, PAINT };
})();
