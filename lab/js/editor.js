// Lumen Lab — script editor: a textarea over a syntax-highlighted layer, with line numbers,
// %% sections, smart indentation and comment toggling. One instance per open file keeps
// each file's native undo history.
(function () {
  'use strict';
  const KW = new Set(['if', 'elseif', 'else', 'end', 'for', 'parfor', 'while', 'break', 'continue', 'return', 'function', 'switch', 'case', 'otherwise', 'try', 'catch', 'global', 'persistent', 'do', 'until']);
  const OPENERS = /^\s*(if|for|parfor|while|switch|try|function|else|elseif|case|otherwise|catch|do)\b/;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function hlLine(line, st) {
    const t = line.trim();
    if (st.block) { if (t === '%}') st.block = false; return `<span class="c">${esc(line)}</span>`; }
    if (t === '%{') { st.block = true; return `<span class="c">${esc(line)}</span>`; }
    if (/^%%(\s|$)/.test(t)) return `<span class="h">${esc(line)}</span>`;
    let out = '', i = 0, prevValue = false;
    while (i < line.length) {
      const c = line[i];
      if (c === '%' || c === '#' && false) { out += `<span class="c">${esc(line.slice(i))}</span>`; break; }
      if (c === '.' && line.startsWith('...', i)) { out += `<span class="c">${esc(line.slice(i))}</span>`; break; }
      if (c === '"' || (c === "'" && !prevValue)) {
        let j = i + 1; for (; j < line.length; j++) { if (line[j] === c) { if (line[j + 1] === c) { j++; continue; } break; } }
        out += `<span class="s">${esc(line.slice(i, j + 1))}</span>`; i = j + 1; prevValue = true; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i; while (j < line.length && /\w/.test(line[j])) j++;
        const w = line.slice(i, j), afterDot = i > 0 && line[i - 1] === '.';
        out += KW.has(w) && !afterDot ? `<span class="k">${w}</span>` : esc(w);
        prevValue = !KW.has(w) || w === 'end'; i = j; continue;
      }
      if (/[0-9]/.test(c)) { let j = i; while (j < line.length && /[0-9.eEij]/.test(line[j])) j++; out += esc(line.slice(i, j)); i = j; prevValue = true; continue; }
      out += esc(c);
      if (c === ')' || c === ']' || c === '}' || c === "'") prevValue = true; else if (c !== ' ' && c !== '\t' && !(c === '.' && line[i + 1] === "'")) prevValue = false; else if (c === ' ' || c === '\t') prevValue = prevValue && false;
      i++;
    }
    return out;
  }

  function create(host, opts = {}) {
    const root = document.createElement('div'); root.className = 'editor'; root.style.display = 'none';
    root.innerHTML = '<div class="gutter"></div><div class="code-wrap"><div class="hl"><div class="hl-in"></div></div><textarea spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" aria-label="Script editor"></textarea></div>';
    host.appendChild(root);
    const ta = root.querySelector('textarea'), hlIn = root.querySelector('.hl-in'), gutter = root.querySelector('.gutter');
    let errLine = null, raf = 0, lastLines = -1, bps = new Map(), dbgLine = null, prevN = 1;
    const ed = { root, ta };
    const lines = () => ta.value.split('\n');
    function cursorLine() { return ta.value.slice(0, ta.selectionStart).split('\n').length; }
    function sections() { // [{start, end}] 1-based inclusive
      const L = lines(), heads = []; L.forEach((l, i) => { if (/^\s*%%(\s|$)/.test(l)) heads.push(i + 1); });
      if (!heads.length) return [];
      const out = []; if (heads[0] > 1) out.push({ start: 1, end: heads[0] - 1 });
      heads.forEach((h, k) => out.push({ start: h, end: k + 1 < heads.length ? heads[k + 1] - 1 : L.length }));
      return out;
    }
    function render() {
      raf = 0;
      const L = lines(), st = { block: false }, cur = cursorLine(), secs = sections(), sec = secs.find(s => cur >= s.start && cur <= s.end);
      let h = '';
      for (let i = 0; i < L.length; i++) {
        const n = i + 1, cls = ['ln'];
        if (/^\s*%%(\s|$)/.test(L[i]) && i > 0) cls.push('sec');
        if (sec && secs.length > 1 && n >= sec.start && n <= sec.end) cls.push('insec');
        if (n === errLine) cls.push('errl'); if (n === dbgLine) cls.push('dbgl');
        h += `<div class="${cls.join(' ')}">${hlLine(L[i], st) || ' '}</div>`;
      }
      hlIn.innerHTML = h;
      if (L.length !== lastLines || true) {
        let g = ''; for (let i = 1; i <= L.length; i++) { const b = bps.get(i), c = [i === errLine ? 'err' : i === cur ? 'cur' : '']; if (b !== undefined) c.push(b ? 'bp bpc' : 'bp'); if (i === dbgLine) c.push('dbg'); g += `<div class="${c.join(' ')}" data-ln="${i}"${b ? ` title="Stops if ${esc(b).replace(/"/g, '&quot;')}"` : ''}>${i}</div>`; }
        gutter.innerHTML = g + '<div style="height:40px"></div>'; lastLines = L.length;
      }
      sync();
    }
    function sync() { hlIn.style.transform = `translate(${-ta.scrollLeft}px,${-ta.scrollTop}px)`; gutter.scrollTop = ta.scrollTop; }
    const schedule = () => { if (raf) return; raf = 1; let done = false; const go = () => { if (!done) { done = true; render(); } }; requestAnimationFrame(go); setTimeout(go, 50); };
    function insert(text) { ta.focus(); if (!document.execCommand('insertText', false, text)) { const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText(text, s, e, 'end'); ta.dispatchEvent(new Event('input')); } }
    function lineRange() { const v = ta.value, s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1; let e = ta.selectionEnd; if (e > ta.selectionStart && v[e - 1] === '\n') e--; e = v.indexOf('\n', e); if (e < 0) e = v.length; return [s, e]; }
    function mapLines(fn) {
      const [s, e] = lineRange(), block = ta.value.slice(s, e), out = block.split('\n').map(fn).join('\n');
      if (out === block) return;
      ta.setSelectionRange(s, e); insert(out); ta.setSelectionRange(s, s + out.length);
    }
    ed.comment = on => mapLines(l => on ? (l.trim() ? l.replace(/^(\s*)/, '$1% ') : l) : l.replace(/^(\s*)% ?/, '$1'));
    ed.toggleComment = () => { const [s, e] = lineRange(); const ls = ta.value.slice(s, e).split('\n').filter(l => l.trim()); ed.comment(!ls.every(l => /^\s*%/.test(l))); };
    ta.addEventListener('keydown', e => {
      if (opts.onKey && opts.onKey(e) === true) { e.preventDefault(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n') || e.shiftKey) mapLines(l => e.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : '    ' + l);
        else insert('    ');
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const v = ta.value, s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1, line = v.slice(s, ta.selectionStart);
        let ind = line.match(/^\s*/)[0];
        const code = line.replace(/%.*$/, '').trim();
        if (OPENERS.test(line) && !/\bend\s*;?\s*$/.test(code)) ind += '    ';
        insert('\n' + ind);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.key.toLowerCase() === 'r') && !e.shiftKey) { e.preventDefault(); e.key === '/' ? ed.toggleComment() : ed.comment(true); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't' && !e.shiftKey) { e.preventDefault(); ed.comment(false); }
      else if ((e.ctrlKey || e.metaKey) && e.key === ']') { e.preventDefault(); mapLines(l => '    ' + l); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '[') { e.preventDefault(); mapLines(l => l.replace(/^( {1,4}|\t)/, '')); }
    });
    // dedent "end/else/case…" typed on an otherwise blank line
    ta.addEventListener('input', () => {
      const v = ta.value, p = ta.selectionStart, s = v.lastIndexOf('\n', p - 1) + 1, line = v.slice(s, p);
      const m = line.match(/^(\s+)(end|else|elseif|case|otherwise|catch)$/);
      if (m && v[p] !== undefined && v[p] !== '\n') { /* typing in the middle of a line */ }
      else if (m) {
        // find the indentation of the matching opener above
        const above = v.slice(0, s).split('\n'); let depth = 0, target = null;
        for (let i = above.length - 1; i >= 0; i--) { const l = above[i].replace(/%.*$/, ''); if (/^\s*end\b/.test(l)) depth++; else if (OPENERS.test(l) && !/^\s*(else|elseif|case|otherwise|catch)\b/.test(l) && !/\bend\s*;?\s*$/.test(l.trim())) { if (depth === 0) { target = l.match(/^\s*/)[0]; break; } depth--; } }
        if (target !== null && target.length < m[1].length && ['end', 'else', 'elseif', 'catch'].includes(m[2]) || (target !== null && ['case', 'otherwise'].includes(m[2]) && target.length + 4 < m[1].length)) {
          const want = ['case', 'otherwise'].includes(m[2]) ? target + '    ' : target;
          ta.setSelectionRange(s, s + m[1].length); document.execCommand('insertText', false, want); ta.setSelectionRange(s + want.length + m[2].length, s + want.length + m[2].length);
        }
      }
      const n = lines().length; if (n !== prevN) { const d = n - prevN, cur = cursorLine(); prevN = n; if (opts.onLineShift) opts.onLineShift(d > 0 ? cur - d : cur, d); }
      errLine = null; schedule(); opts.onChange && opts.onChange(ta.value);
    });
    ta.addEventListener('scroll', sync);
    // click the line numbers to set or clear a breakpoint
    gutter.addEventListener('mousedown', e => { const d = e.target.closest('[data-ln]'); if (!d || !opts.onGutter) return; e.preventDefault(); opts.onGutter(+d.dataset.ln, e); });
    const caret = () => { schedule(); opts.onCursor && opts.onCursor(cursorLine(), ta.selectionStart - ta.value.lastIndexOf('\n', ta.selectionStart - 1)); };
    ta.addEventListener('keyup', caret); ta.addEventListener('click', caret); ta.addEventListener('focus', caret);
    Object.assign(ed, {
      get: () => ta.value,
      set(text) { prevN = text.split(/\n/).length; const keep = ta.value && document.activeElement === ta ? ta.selectionStart : 0; ta.value = text; errLine = null; ta.setSelectionRange(Math.min(keep, text.length), Math.min(keep, text.length)); if (!keep) ta.scrollTop = 0; render(); },
      show(on) { root.style.display = on ? '' : 'none'; if (on) { render(); } },
      focus() { ta.focus(); },
      setBreakpoints(m) { bps = new Map(m || []); render(); },
      setDebugLine(n) { dbgLine = n || null; render(); if (n) ed.gotoLine(n, true); },
      setError(n) { errLine = n; render(); if (n) ed.gotoLine(n, true); },
      gotoLine(n, keepFocus) { const L = lines(); n = Math.max(1, Math.min(L.length, n)); const pos = L.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0); ta.focus(); ta.setSelectionRange(pos, pos + (keepFocus ? 0 : L[n - 1].length)); const lh = parseFloat(getComputedStyle(ta).lineHeight) || 19; ta.scrollTop = Math.max(0, (n - 4) * lh); sync(); caret(); },
      section() { const cur = cursorLine(), secs = sections(), sec = secs.find(s => cur >= s.start && cur <= s.end) || { start: 1, end: lines().length }; return { ...sec, text: lines().slice(sec.start - 1, sec.end).join('\n'), next: secs[secs.indexOf(sec) + 1] }; },
      selection() { return ta.value.slice(ta.selectionStart, ta.selectionEnd); },
      cursorLine, render, insert,
      find(q, back) { if (!q) return false; const v = ta.value.toLowerCase(), s = q.toLowerCase(); let i = back ? v.lastIndexOf(s, ta.selectionStart - 1) : v.indexOf(s, ta.selectionEnd); if (i < 0) i = back ? v.lastIndexOf(s) : v.indexOf(s); if (i < 0) return false; ta.focus(); ta.setSelectionRange(i, i + q.length); const n = v.slice(0, i).split('\n').length, lh = parseFloat(getComputedStyle(ta).lineHeight) || 19; if (n * lh < ta.scrollTop || n * lh > ta.scrollTop + ta.clientHeight - lh) ta.scrollTop = Math.max(0, (n - 5) * lh); sync(); return true; },
      destroy() { root.remove(); },
    });
    return ed;
  }
  window.LabEditor = { create, hlLine };
})();
