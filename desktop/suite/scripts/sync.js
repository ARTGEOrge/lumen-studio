// Copies the web apps from C:/code/lumen-studio into ./apps for packaging (kit + each app + launcher).
const fs = require('fs'), path = require('path');
const SITE = process.env.LUMEN_SITE ? path.resolve(process.env.LUMEN_SITE) : path.resolve(__dirname, '..', '..', 'lumen-studio'), OUT = path.resolve(__dirname, '..', 'apps');
const apps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps.json'), 'utf8'));
const SKIP = /(^|[\\/])(node_modules|tools|_template|tests)([\\/]|$)|screenshot\.(png|jpg)$|\.map$/;
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const copy = (src, dst) => {
  if (SKIP.test(src)) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dst, f)); }
  else fs.copyFileSync(src, dst);
};
copy(path.join(SITE, 'kit'), path.join(OUT, 'kit'));
let n = 0;
for (const a of apps) { const src = path.join(SITE, a.id); if (fs.existsSync(path.join(src, 'index.html'))) { copy(src, path.join(OUT, a.id)); n++; } else console.warn('missing app:', a.id); }
copy(path.join(__dirname, '..', 'launcher'), path.join(OUT, 'launcher'));
fs.copyFileSync(path.join(__dirname, '..', 'apps.json'), path.join(OUT, 'apps.json'));
const size = d => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`synced ${n} apps, ${(size(OUT) / 1048576).toFixed(1)} MB`);
