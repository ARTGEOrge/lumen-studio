'use strict';
/* Lumen Slides — tiny strict XML parser / serializer helpers (works in the browser and in Node).
   parse(str) → element {n:'p:sp', a:{attr:val}, c:[children], t:'text'} ; throws on malformed input. */
(function (root) {
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function decode(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
      if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ''; }
      return ENT[e] != null ? ENT[e] : m;
    });
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    // strip characters that are not allowed in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');

  function parse(src) {
    if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);
    let i = 0; const n = src.length;
    const doc = { n: '#doc', a: {}, c: [] }; const stack = [doc];
    const err = msg => { throw new Error('XML: ' + msg + ' at ' + i); };
    while (i < n) {
      const lt = src.indexOf('<', i);
      if (lt < 0) { const tail = src.slice(i); if (tail.trim() && stack.length > 1) err('text outside root'); break; }
      if (lt > i) { const cur = stack[stack.length - 1]; const txt = decode(src.slice(i, lt)); if (cur !== doc) cur.c.push(txt); else if (txt.trim()) err('text outside root'); }
      i = lt;
      if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); if (e < 0) err('unterminated comment'); i = e + 3; continue; }
      if (src.startsWith('<![CDATA[', i)) { const e = src.indexOf(']]>', i + 9); if (e < 0) err('unterminated CDATA'); stack[stack.length - 1].c.push(src.slice(i + 9, e)); i = e + 3; continue; }
      if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i + 2); if (e < 0) err('unterminated PI'); i = e + 2; continue; }
      if (src.startsWith('<!', i)) { // DOCTYPE: skip (no entity expansion)
        let depth = 0, j = i + 2; for (; j < n; j++) { const ch = src[j]; if (ch === '[') depth++; else if (ch === ']') depth--; else if (ch === '>' && depth <= 0) break; }
        i = j + 1; continue;
      }
      if (src[i + 1] === '/') {
        const e = src.indexOf('>', i); if (e < 0) err('unterminated end tag');
        const name = src.slice(i + 2, e).trim(); const top = stack.pop();
        if (!top || top.n !== name) err(`mismatched </${name}> (open <${top && top.n}>)`);
        i = e + 1; continue;
      }
      // start tag
      let j = i + 1; while (j < n && !/[\s/>]/.test(src[j])) j++;
      const name = src.slice(i + 1, j); if (!name) err('empty tag name');
      const el = { n: name, a: {}, c: [] };
      for (;;) {
        while (j < n && /\s/.test(src[j])) j++;
        if (j >= n) err('unterminated tag');
        if (src[j] === '>') { j++; stack[stack.length - 1].c.push(el); stack.push(el); break; }
        if (src[j] === '/' && src[j + 1] === '>') { j += 2; stack[stack.length - 1].c.push(el); break; }
        let k = j; while (k < n && !/[\s=/>]/.test(src[k])) k++;
        const an = src.slice(j, k); if (!an) err('bad attribute');
        while (k < n && /\s/.test(src[k])) k++;
        if (src[k] !== '=') err('attribute without value');
        k++; while (k < n && /\s/.test(src[k])) k++;
        const q = src[k]; if (q !== '"' && q !== "'") err('unquoted attribute');
        const e = src.indexOf(q, k + 1); if (e < 0) err('unterminated attribute');
        el.a[an] = decode(src.slice(k + 1, e)); j = e + 1;
      }
      i = j;
    }
    if (stack.length !== 1) err('unclosed <' + stack[stack.length - 1].n + '>');
    const roots = doc.c.filter(x => typeof x === 'object');
    if (roots.length !== 1) err('expected one root element');
    return roots[0];
  }
  // query helpers (names include prefixes, e.g. 'p:sp')
  const kids = (e, name) => e ? e.c.filter(x => typeof x === 'object' && (!name || x.n === name)) : [];
  const kid = (e, name) => { if (!e) return null; for (const x of e.c) if (typeof x === 'object' && x.n === name) return x; return null; };
  const path = (e, ...names) => { for (const nm of names) { e = kid(e, nm); if (!e) return null; } return e; };
  const text = e => { if (!e) return ''; let s = ''; for (const x of e.c) s += typeof x === 'string' ? x : text(x); return s; };
  function all(e, name, out = []) { if (!e) return out; for (const x of e.c) if (typeof x === 'object') { if (x.n === name) out.push(x); all(x, name, out); } return out; }
  const attr = (e, a, d) => e && e.a[a] != null ? e.a[a] : d;
  const num = (e, a, d) => { const v = e && e.a[a]; const f = v == null ? NaN : parseFloat(v); return Number.isFinite(f) ? f : d; };

  const XML = { parse, esc, decode, kids, kid, path, text, all, attr, num };
  if (typeof module !== 'undefined' && module.exports) module.exports = XML; else root.XML = XML;
})(typeof self !== 'undefined' ? self : this);
