'use strict';
/* Lumen Proto — dev handoff code generation (CSS, SwiftUI, Jetpack Compose). */
(function () {
  const LP = window.LP, ED = window.ED;
  const r2 = v => Math.round(v * 100) / 100;
  const px = v => r2(v) + 'px';
  const doc = () => ED.doc;
  const fillCss = f => {
    if (f.type === 'solid') { const c = LP.fillColor(f, doc()); return LP.rgba(c.color, c.a); }
    const stops = (f.stops || []).slice().sort((a, b) => a.p - b.p).map(s => `${LP.rgba(s.color, (s.a ?? 1) * (f.a ?? 1))} ${Math.round(s.p * 100)}%`).join(', ');
    if (f.type === 'linear') return `linear-gradient(${r2(f.angle ?? 180)}deg, ${stops})`;
    if (f.type === 'radial') return `radial-gradient(farthest-side at ${Math.round((f.cx ?? .5) * 100)}% ${Math.round((f.cy ?? .5) * 100)}%, ${stops})`;
    if (f.type === 'image') return `url(image.png) center / ${f.mode === 'fit' ? 'contain' : f.mode === 'tile' ? 'auto' : 'cover'} ${f.mode === 'tile' ? 'repeat' : 'no-repeat'}`;
    return '';
  };
  const styleName = f => { const s = f.style && doc().colorStyles.find(x => x.id === f.style); return s ? s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : null; };
  function css(n, v) {
    const L = [];
    const t = v.mainType || n.type;
    L.push(`/* ${n.name} */`);
    if (ED.parent(n) && ED.parent(n) !== ED.doc) { L.push('position: absolute;', `left: ${px(n.x)};`, `top: ${px(n.y)};`); }
    L.push(`width: ${px(n.w)};`, `height: ${px(n.h)};`);
    if (n.r) L.push(`transform: rotate(${r2(n.r)}deg);`);
    const fills = (v.fills || []).filter(f => f.on !== false);
    if (t === 'text') {
      const T = LP.textProps(v, doc());
      const f = fills[0];
      if (f) { const nm = styleName(f); L.push(`color: ${nm ? `var(--${nm}, ${fillCss(f)})` : fillCss(f)};`); }
      L.push(`font-family: "${T.font}", sans-serif;`, `font-size: ${px(T.size)};`, `font-weight: ${T.weight};`);
      if (T.italic) L.push('font-style: italic;');
      L.push(`line-height: ${T.lh > 0 ? px(T.lh) : 'normal'};`);
      if (T.ls) L.push(`letter-spacing: ${px(T.ls)};`);
      if (v.align && v.align !== 'left') L.push(`text-align: ${v.align};`);
      if (v.tcase === 'upper') L.push('text-transform: uppercase;'); if (v.tcase === 'lower') L.push('text-transform: lowercase;');
      if (v.deco === 'underline') L.push('text-decoration: underline;'); if (v.deco === 'strike') L.push('text-decoration: line-through;');
    } else if (t === 'icon') {
      L.push(`color: ${LP.rgba(v.color)};`, `/* Lucide icon "${v.icon}", stroke-width ${v.sw || 2} */`);
    } else if (fills.length) {
      if (fills.length === 1 && fills[0].type === 'solid') { const nm = styleName(fills[0]); L.push(`background: ${nm ? `var(--${nm}, ${fillCss(fills[0])})` : fillCss(fills[0])};`); }
      else L.push(`background: ${fills.slice().reverse().map(fillCss).join(', ')};`);
    }
    if (t === 'ellipse') L.push('border-radius: 50%;');
    else if (v.radius && v.radius.some(x => x)) { const r = v.radius; L.push(`border-radius: ${r.every(x => x === r[0]) ? px(r[0]) : r.map(px).join(' ')};`); }
    const strokes = (v.strokes || []).filter(s => s.on !== false && s.w > 0);
    const shadows = [];
    strokes.forEach((s, i) => {
      const c = LP.fillColor(s, doc()), col = LP.rgba(c.color, c.a);
      if (i === 0 && (s.align || 'inside') === 'inside' && t !== 'text') { L.push(`border: ${px(s.w)} ${s.dash ? 'dashed' : 'solid'} ${col};`, 'box-sizing: border-box;'); }
      else if (s.align === 'outside') shadows.push(`0 0 0 ${px(s.w)} ${col}`);
      else if (t === 'text') L.push(`-webkit-text-stroke: ${px(s.w)} ${col};`);
      else L.push(`outline: ${px(s.w)} solid ${col};`, `outline-offset: ${px(-s.w / 2)};`);
    });
    (v.shadows || []).filter(s => s.on !== false).forEach(s => shadows.push(`${s.inner ? 'inset ' : ''}${px(s.x)} ${px(s.y)} ${px(s.blur)}${s.spread ? ' ' + px(s.spread) : ''} ${LP.rgba(s.color, s.a)}`));
    if (shadows.length) L.push(t === 'text' ? `text-shadow: ${(v.shadows || []).filter(s => s.on !== false && !s.inner).map(s => `${px(s.x)} ${px(s.y)} ${px(s.blur)} ${LP.rgba(s.color, s.a)}`).join(', ')};` : `box-shadow: ${shadows.join(', ')};`);
    if ((v.opacity ?? 1) < 1) L.push(`opacity: ${r2(v.opacity)};`);
    if (v.blend && v.blend !== 'normal') L.push(`mix-blend-mode: ${v.blend};`);
    if (v.blur && v.blur.on !== false) L.push(v.blur.type === 'bg' ? `backdrop-filter: blur(${px(v.blur.r)});` : `filter: blur(${px(v.blur.r)});`);
    if (v.layout) {
      const Lt = v.layout, p = Lt.pad || [0, 0, 0, 0];
      L.push('display: flex;', `flex-direction: ${Lt.mode === 'h' ? 'row' : 'column'};`);
      if (Lt.justify === 'between') L.push('justify-content: space-between;'); else if (Lt.gap) L.push(`gap: ${px(Lt.gap)};`);
      if (Lt.justify === 'center') L.push('justify-content: center;'); if (Lt.justify === 'end') L.push('justify-content: flex-end;');
      L.push(`align-items: ${Lt.align === 'center' ? 'center' : Lt.align === 'end' ? 'flex-end' : 'flex-start'};`);
      if (p.some(x => x)) L.push(`padding: ${p.every(x => x === p[0]) ? px(p[0]) : p.map(px).join(' ')};`);
      if (n.sizeH === 'hug') L.push('width: fit-content;'); if (n.sizeV === 'hug') L.push('height: fit-content;');
    }
    if (v.clip && (t === 'frame') && ED.kids(n).length) L.push('overflow: hidden;');
    const par = ED.parent(n), pv = par && par !== ED.doc ? ED.scene.view(par) : null;
    if (pv?.layout) { if ((pv.layout.mode === 'h' ? n.sizeH : n.sizeV) === 'fill') L.push('flex: 1 1 0;'); if ((pv.layout.mode === 'h' ? n.sizeV : n.sizeH) === 'fill') L.push('align-self: stretch;'); }
    let out = L.join('\n');
    if (t === 'text') out += `\n\n/* content */\n/* ${String(v.text).replace(/\*\//g, '* /').slice(0, 300)} */`;
    return out;
  }
  const rgb = (c, a = 1) => { const p = LP.parseColor(c); return { r: r2(p[0] / 255), g: r2(p[1] / 255), b: r2(p[2] / 255), a: r2(p[3] * a) }; };
  const swiftColor = (c, a) => { const q = rgb(c, a); return `Color(red: ${q.r}, green: ${q.g}, blue: ${q.b}${q.a < 1 ? `, opacity: ${q.a}` : ''})`; };
  const swiftWeight = w => ({ 100: '.ultraLight', 200: '.thin', 300: '.light', 400: '.regular', 500: '.medium', 600: '.semibold', 700: '.bold', 800: '.heavy', 900: '.black' })[Math.round(w / 100) * 100] || '.regular';
  function swift(n, v) {
    const t = v.mainType || n.type, L = [];
    const fill = (v.fills || []).find(f => f.on !== false);
    const fc = fill && fill.type === 'solid' ? LP.fillColor(fill, doc()) : null;
    if (t === 'text') {
      const T = LP.textProps(v, doc());
      L.push(`Text(${JSON.stringify(String(v.text))})`, `    .font(.custom("${T.font}", size: ${T.size}).weight(${swiftWeight(T.weight)}))`);
      if (fc) L.push(`    .foregroundColor(${swiftColor(fc.color, fc.a)})`);
      if (T.lh > 0) L.push(`    .lineSpacing(${r2(T.lh - T.size * 1.2)})`);
      if (T.ls) L.push(`    .kerning(${T.ls})`);
      if (v.align === 'center') L.push('    .multilineTextAlignment(.center)'); if (v.align === 'right') L.push('    .multilineTextAlignment(.trailing)');
    } else if (t === 'icon') { L.push(`Image(systemName: "${v.icon}") // Lucide "${v.icon}"`, `    .foregroundColor(${swiftColor(v.color)})`, `    .frame(width: ${r2(n.w)}, height: ${r2(n.h)})`); return L.join('\n'); }
    else {
      const shape = t === 'ellipse' ? 'Ellipse()' : `RoundedRectangle(cornerRadius: ${r2((v.radius || [0])[0])})`;
      if (v.layout) {
        const Lt = v.layout; L.push(`${Lt.mode === 'h' ? 'HStack' : 'VStack'}(alignment: .${Lt.mode === 'h' ? (Lt.align === 'center' ? 'center' : Lt.align === 'end' ? 'bottom' : 'top') : (Lt.align === 'center' ? 'center' : Lt.align === 'end' ? 'trailing' : 'leading')}, spacing: ${r2(Lt.gap || 0)}) {`, `    // ${ED.kids(n).length} children`, '}');
        const p = Lt.pad || [0, 0, 0, 0]; L.push(`.padding(EdgeInsets(top: ${p[0]}, leading: ${p[3]}, bottom: ${p[2]}, trailing: ${p[1]}))`);
        if (fc) L.push(`.background(${shape}.fill(${swiftColor(fc.color, fc.a)}))`);
      } else {
        L.push(shape);
        if (fill?.type === 'solid') L.push(`    .fill(${swiftColor(fc.color, fc.a)})`);
        else if (fill?.type === 'linear') L.push(`    .fill(LinearGradient(colors: [${fill.stops.map(s => swiftColor(s.color, s.a)).join(', ')}], startPoint: .top, endPoint: .bottom))`);
        L.push(`    .frame(width: ${r2(n.w)}, height: ${r2(n.h)})`);
      }
    }
    (v.strokes || []).filter(s => s.on !== false).slice(0, 1).forEach(s => { const c = LP.fillColor(s, doc()); L.push(`    .overlay(${t === 'ellipse' ? 'Ellipse()' : `RoundedRectangle(cornerRadius: ${r2((v.radius || [0])[0])})`}.stroke(${swiftColor(c.color, c.a)}, lineWidth: ${s.w}))`); });
    (v.shadows || []).filter(s => s.on !== false && !s.inner).forEach(s => L.push(`    .shadow(color: ${swiftColor(s.color, s.a)}, radius: ${r2(s.blur / 2)}, x: ${s.x}, y: ${s.y})`));
    if ((v.opacity ?? 1) < 1) L.push(`    .opacity(${r2(v.opacity)})`);
    if (v.blur?.type === 'bg') L.push('    .background(.ultraThinMaterial)');
    if (n.r) L.push(`    .rotationEffect(.degrees(${r2(n.r)}))`);
    return L.join('\n');
  }
  const kColor = (c, a = 1) => { const p = LP.parseColor(c); const h2 = x => Math.round(x).toString(16).padStart(2, '0').toUpperCase(); return `Color(0x${h2(p[3] * a * 255)}${h2(p[0])}${h2(p[1])}${h2(p[2])})`; };
  const kWeight = w => ({ 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Normal', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' })[Math.round(w / 100) * 100] || 'Normal';
  function android(n, v) {
    const t = v.mainType || n.type, L = [];
    const fill = (v.fills || []).find(f => f.on !== false && f.type === 'solid');
    const fc = fill ? LP.fillColor(fill, doc()) : null;
    if (t === 'text') {
      const T = LP.textProps(v, doc());
      L.push('Text(', `    text = ${JSON.stringify(String(v.text))},`, `    fontSize = ${T.size}.sp,`, `    fontWeight = FontWeight.${kWeight(T.weight)},`);
      if (fc) L.push(`    color = ${kColor(fc.color, fc.a)},`);
      if (T.lh > 0) L.push(`    lineHeight = ${r2(T.lh)}.sp,`); if (T.ls) L.push(`    letterSpacing = ${r2(T.ls)}.sp,`);
      if (v.align && v.align !== 'left') L.push(`    textAlign = TextAlign.${v.align === 'center' ? 'Center' : v.align === 'right' ? 'End' : 'Justify'},`);
      L.push(')'); return L.join('\n');
    }
    if (t === 'icon') return `Icon(\n    painter = painterResource(R.drawable.ic_${v.icon.replace(/-/g, '_')}),\n    contentDescription = ${JSON.stringify(n.name)},\n    tint = ${kColor(v.color)},\n    modifier = Modifier.size(${r2(n.w)}.dp)\n)`;
    const r = v.radius || [0, 0, 0, 0];
    const shape = t === 'ellipse' ? 'CircleShape' : r.every(x => x === r[0]) ? `RoundedCornerShape(${r2(r[0])}.dp)` : `RoundedCornerShape(${r.map(x => r2(x) + '.dp').join(', ')})`;
    const mods = [`.size(${r2(n.w)}.dp, ${r2(n.h)}.dp)`];
    (v.shadows || []).filter(s => s.on !== false && !s.inner).slice(0, 1).forEach(s => mods.push(`.shadow(${r2(s.blur / 2)}.dp, ${shape})`));
    if (fc) mods.push(`.background(${kColor(fc.color, fc.a)}, ${shape})`);
    (v.strokes || []).filter(s => s.on !== false).slice(0, 1).forEach(s => { const c = LP.fillColor(s, doc()); mods.push(`.border(${r2(s.w)}.dp, ${kColor(c.color, c.a)}, ${shape})`); });
    if ((v.opacity ?? 1) < 1) mods.push(`.alpha(${r2(v.opacity)}f)`);
    if (n.r) mods.push(`.rotate(${r2(n.r)}f)`);
    if (v.layout) {
      const Lt = v.layout, p = Lt.pad || [0, 0, 0, 0]; mods.push(`.padding(start = ${p[3]}.dp, top = ${p[0]}.dp, end = ${p[1]}.dp, bottom = ${p[2]}.dp)`);
      const H = Lt.mode === 'h';
      L.push(`${H ? 'Row' : 'Column'}(`, `    modifier = Modifier\n        ${mods.join('\n        ')},`, `    ${H ? 'horizontalArrangement' : 'verticalArrangement'} = ${Lt.justify === 'between' ? 'Arrangement.SpaceBetween' : `Arrangement.spacedBy(${r2(Lt.gap || 0)}.dp)`},`, `    ${H ? 'verticalAlignment = Alignment.' + (Lt.align === 'center' ? 'CenterVertically' : Lt.align === 'end' ? 'Bottom' : 'Top') : 'horizontalAlignment = Alignment.' + (Lt.align === 'center' ? 'CenterHorizontally' : Lt.align === 'end' ? 'End' : 'Start')}`, ') {', `    // ${ED.kids(n).length} children`, '}');
    } else L.push('Box(', `    modifier = Modifier\n        ${mods.join('\n        ')}`, ')');
    return L.join('\n');
  }
  window.CODEGEN = { css, swift, android };
})();
