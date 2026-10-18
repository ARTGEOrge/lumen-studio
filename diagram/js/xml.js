'use strict';
/* Lumen Diagram — tiny, dependency-free XML parser/serialiser (same code in Node tests and the browser).
   Produces {name, attrs:{}, children:[], text}. No DTDs, no external entities — safe for untrusted files. */
(function (root) {
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decode(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
      return ENT[e.toLowerCase()] ?? m;
    });
  }
  function parse(src) {
    src = String(src);
    const rootEl = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [rootEl]; let i = 0; const n = src.length;
    if (src.charCodeAt(0) === 0xfeff) i = 1;
    while (i < n) {
      const lt = src.indexOf('<', i);
      if (lt < 0) { stack[stack.length - 1].text += decode(src.slice(i)); break; }
      if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt));
      if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
      if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
      if (src[lt + 1] === '?' ) { const e = src.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
      if (src[lt + 1] === '!') { const e = src.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue; }
      if (src[lt + 1] === '/') {
        const e = src.indexOf('>', lt + 2); const name = src.slice(lt + 2, e < 0 ? n : e).trim();
        // pop to the matching element (tolerates small mismatches)
        for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { stack.length = k; break; }
        i = e < 0 ? n : e + 1; continue;
      }
      // start tag
      let j = lt + 1; while (j < n && !/[\s/>]/.test(src[j])) j++;
      const el = { name: src.slice(lt + 1, j), attrs: {}, children: [], text: '' };
      // attributes
      for (;;) {
        while (j < n && /\s/.test(src[j])) j++;
        if (j >= n) break;
        if (src[j] === '>') { j++; stack[stack.length - 1].children.push(el); stack.push(el); break; }
        if (src[j] === '/' && src[j + 1] === '>') { j += 2; stack[stack.length - 1].children.push(el); break; }
        let k = j; while (k < n && !/[\s=/>]/.test(src[k])) k++;
        const an = src.slice(j, k); j = k; while (j < n && /\s/.test(src[j])) j++;
        if (src[j] === '=') {
          j++; while (j < n && /\s/.test(src[j])) j++;
          const qch = src[j];
          if (qch === '"' || qch === "'") { const e = src.indexOf(qch, j + 1); el.attrs[an] = decode(src.slice(j + 1, e < 0 ? n : e)); j = e < 0 ? n : e + 1; }
          else { let e = j; while (e < n && !/[\s>]/.test(src[e])) e++; el.attrs[an] = decode(src.slice(j, e)); j = e; }
        } else if (an) el.attrs[an] = '';
        else j++;
      }
      i = j;
    }
    return rootEl;
  }
  const escA = s => String(s).replace(/[&<>"\n\r\t]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\n': '&#10;', '\r': '&#13;', '\t': '&#9;' })[c]);
  const escT = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  // serialise {name, attrs, children, text}
  function stringify(el, ind = '', step = '  ') {
    const a = Object.entries(el.attrs || {}).filter(([, v]) => v != null).map(([k, v]) => ` ${k}="${escA(v)}"`).join('');
    const kids = el.children || [];
    if (!kids.length && !el.text) return `${ind}<${el.name}${a} />`;
    if (!kids.length) return `${ind}<${el.name}${a}>${escT(el.text)}</${el.name}>`;
    return `${ind}<${el.name}${a}>\n${kids.map(k => stringify(k, ind + step, step)).join('\n')}\n${ind}</${el.name}>`;
  }
  const find = (el, name) => { if (!el) return null; if (el.name === name) return el; for (const c of el.children) { const r = find(c, name); if (r) return r; } return null; };
  const findAll = (el, name, out = []) => { if (!el) return out; if (el.name === name) out.push(el); for (const c of el.children) findAll(c, name, out); return out; };

  const api = { parse, stringify, decode, find, findAll, escA, escT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DiaXML = api;
})(typeof self !== 'undefined' ? self : this);
