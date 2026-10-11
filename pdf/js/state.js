// Global app state + tiny event bus
import { prefs } from './util.js';
export const App = {
  docs: [], doc: null,
  tool: 'select', sel: null,
  author: prefs.get('author', 'Lumen User'),
  opts: {
    highlight: { color: '#ffd400', opacity: 0.5 }, underline: { color: '#1f6fd0', opacity: 1 }, strike: { color: '#d42020', opacity: 1 }, squiggly: { color: '#1f9d3a', opacity: 1 },
    note: { color: '#ffd84d', opacity: 1 }, ink: { color: '#1f4fbf', width: 2, opacity: 1 },
    rect: { color: '#d42020', width: 2, fill: null, opacity: 1 }, ellipse: { color: '#d42020', width: 2, fill: null, opacity: 1 },
    line: { color: '#d42020', width: 2, opacity: 1 }, arrow: { color: '#d42020', width: 2, opacity: 1 },
    freetext: { color: '#1a1a1a', size: 12, font: 'Helvetica', fill: '#fffbd6', bw: 1, bcolor: '#c9a400', opacity: 1, align: 'left', bold: false },
    filltext: { color: '#0b1f6b', size: 11, font: 'Helvetica', opacity: 1 },
    edittext: { color: '#000000', size: 12, font: 'Helvetica', bold: false, opacity: 1 },
    stamp: { label: 'APPROVED', color: '#1e8a3c', opacity: 0.9, withSub: true },
    check: { color: '#0b1f6b', width: 1.6, opacity: 1 },
    redact: { dpi: 200 }
  },
  contentMode: false, // shapes drawn as page content instead of annotations
  signature: null, pendingImage: null,
  find: { q: '', matchCase: false, word: false, matches: [], cur: -1, busy: false }
};
const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, e => fn(e.detail));
