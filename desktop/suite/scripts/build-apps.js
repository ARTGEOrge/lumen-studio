// Builds one Windows installer per app (e.g. "Lumen Vector"), each opening its app directly.
// usage: node scripts/build-apps.js [id ...]   (default: every app except photo, which has its own repo)
const fs = require('fs'), path = require('path');
const { build, Platform } = require('electron-builder');
const ROOT = path.resolve(__dirname, '..'), SITE = path.resolve(ROOT, '..', 'lumen-studio');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const APPS = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps.json'), 'utf8'));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : APPS.map(a => a.id).filter(id => id !== 'photo');
const SKIP = /(^|[\\/])(node_modules|tools|_template|tests)([\\/]|$)|screenshot\.(png|jpg)$|\.map$/;
const copy = (src, dst) => {
  if (SKIP.test(src)) return;
  if (fs.statSync(src).isDirectory()) { fs.mkdirSync(dst, { recursive: true }); for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dst, f)); }
  else fs.copyFileSync(src, dst);
};
const single = path.join(ROOT, 'single.json'), appsDir = path.join(ROOT, 'apps');

(async () => {
  try {
    for (const id of ids) {
      const meta = APPS.find(a => a.id === id); if (!meta) throw new Error('unknown app ' + id);
      const name = meta.name, slug = name.replace(/\s+/g, '');
      // stage: kit + this app only
      fs.rmSync(appsDir, { recursive: true, force: true }); fs.mkdirSync(appsDir);
      copy(path.join(SITE, 'kit'), path.join(appsDir, 'kit')); copy(path.join(SITE, id), path.join(appsDir, id));
      fs.writeFileSync(single, JSON.stringify({ id }));
      fs.mkdirSync(path.join(ROOT, 'build', 'icons'), { recursive: true });
      const icon = path.join(ROOT, 'build', 'icons', id + '.png'); fs.copyFileSync(path.join(SITE, 'kit', 'icons', id + '.png'), icon);
      const config = {
        ...pkg.build,
        appId: 'com.lumenstudio.' + id, productName: name,
        extraMetadata: { name: 'lumen-' + id, productName: name, description: `${name} - ${meta.desc}` },
        files: ['main.js', 'preload.js', 'apps.json', 'single.json', 'apps/**/*', 'build/icons/' + id + '.png', 'package.json'],
        directories: { output: path.join('dist-apps', id), buildResources: 'build' },
        win: { icon: 'build/icons/' + id + '.ico', target: [{ target: 'nsis', arch: ['x64'] }] },
        nsis: { ...pkg.build.nsis, shortcutName: name, artifactName: `${slug}-Setup-${pkg.version}.exe` },
        npmRebuild: false,       // no native modules; skips a memory-hungry child process
        compression: 'normal',   // maximum needs more RAM than small PCs have
        fileAssociations: meta.ext.filter(e => !['pdf', 'svg', 'psd'].includes(e)).map(e => ({ ext: e, name: `${name} file`, role: 'Editor' }))
      };
      console.log(`\n=== ${name} ===`);
      const t0 = Date.now();
      const out = await build({ targets: Platform.WINDOWS.createTarget(), config });
      const exe = out.find(f => f.endsWith('.exe'));
      console.log(`built ${path.basename(exe)} ${(fs.statSync(exe).size / 1048576).toFixed(1)} MiB in ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  } finally {
    // leave the project ready for the full suite build again
    fs.rmSync(single, { force: true });
    require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'sync.js')], { stdio: 'inherit' });
  }
})().catch(e => { console.error('BUILD FAILED', e); process.exitCode = 1; });
