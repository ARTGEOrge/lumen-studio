// Mirrors the desktop shell sources (Electron wrappers) into ./desktop so they live in the repo.
// Canonical working copies are C:/code/lumen-suite and C:/code/lumen-photo; run this before committing.
const fs = require('fs'), path = require('path');
const OUT = path.resolve(__dirname, '..', 'desktop');
const SETS = {
  suite: { src: path.resolve(__dirname, '..', '..', 'lumen-suite'), files: ['main.js', 'preload.js', 'apps.json', 'package.json', 'launcher', 'scripts', 'build/icon.png'] },
  photo: { src: path.resolve(__dirname, '..', '..', 'lumen-photo'), files: ['main.js', 'preload.js', 'package.json', 'scripts', 'build/icon.png'] }
};
const copy = (s, d) => { if (fs.statSync(s).isDirectory()) { fs.mkdirSync(d, { recursive: true }); for (const f of fs.readdirSync(s)) copy(path.join(s, f), path.join(d, f)); } else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); } };
fs.rmSync(OUT, { recursive: true, force: true });
for (const [name, set] of Object.entries(SETS)) for (const f of set.files) { const s = path.join(set.src, f); if (fs.existsSync(s)) copy(s, path.join(OUT, name, f)); }
console.log('desktop sources mirrored');
