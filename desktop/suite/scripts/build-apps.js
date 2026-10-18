// Builds one installer per app (e.g. "Lumen Vector"), each opening its app directly; id "suite" builds the all-apps suite.
// usage: node scripts/build-apps.js [id ...]   (default: every app except photo, which has its own repo)
// env: APP_VERSION=1.0.0 builds at that version without bumping the suite (e.g. Lumen Plan)
//      TARGET=win|mac|linux (default win): Windows NSIS .exe, macOS universal .dmg, Ubuntu/Debian .deb
//      LUMEN_SITE=<folder with the web apps> (default ../lumen-studio next to this project)
const fs = require('fs'), path = require('path');
const { build, Platform, Arch } = require('electron-builder');
const ROOT = path.resolve(__dirname, '..');
const SITE = process.env.LUMEN_SITE ? path.resolve(process.env.LUMEN_SITE) : path.resolve(ROOT, '..', 'lumen-studio');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const APPS = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps.json'), 'utf8'));
const VER = process.env.APP_VERSION || pkg.version;
const TARGET = process.env.TARGET || 'win';
const HOME = 'https://lumen-studio-silk.vercel.app';   // the .deb format requires a homepage
const ids = process.argv.slice(2).length ? process.argv.slice(2) : APPS.map(a => a.id).filter(id => id !== 'photo');
const SKIP = /(^|[\\/])(node_modules|tools|_template|tests)([\\/]|$)|screenshot\.(png|jpg)$|\.map$/;
const copy = (src, dst) => {
  if (SKIP.test(src)) return;
  if (fs.statSync(src).isDirectory()) { fs.mkdirSync(dst, { recursive: true }); for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dst, f)); }
  else fs.copyFileSync(src, dst);
};
const single = path.join(ROOT, 'single.json'), appsDir = path.join(ROOT, 'apps');
const sync = () => require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'sync.js')], { stdio: 'inherit', env: { ...process.env, LUMEN_SITE: SITE } });

// per-platform target settings; icons: Windows .ico, macOS/Linux a 512 px PNG (build/icons512/<id>.png)
function platformConfig(id, name, slug) {
  const icon512 = `build/icons512/${id}.png`;
  if (TARGET === 'mac') return {
    targets: Platform.MAC.createTarget(['dmg'], Arch.universal),
    cfg: { mac: { icon: icon512, category: 'public.app-category.productivity', identity: '-', hardenedRuntime: false, gatekeeperAssess: false, target: [{ target: 'dmg', arch: ['universal'] }] },
           dmg: { artifactName: `${slug}-${VER}-mac.dmg` } }
  };
  if (TARGET === 'linux') return {
    targets: Platform.LINUX.createTarget(['deb'], Arch.x64),
    cfg: { linux: { icon: icon512, category: 'Office', maintainer: 'Nexus Play', executableName: slug.toLowerCase(), synopsis: name, target: [{ target: 'deb', arch: ['x64'] }] },
           deb: { artifactName: `${slug}-${VER}-linux-amd64.deb` } }
  };
  return {
    targets: Platform.WINDOWS.createTarget(),
    cfg: { win: { icon: id === 'suite' ? 'build/icon.ico' : `build/icons/${id}.ico`, target: [{ target: 'nsis', arch: ['x64'] }] },
           nsis: { ...pkg.build.nsis, shortcutName: name, artifactName: `${slug}-Setup-${VER}.exe` } }
  };
}

(async () => {
  try {
    for (const id of ids) {
      let name, files, extra, meta;
      if (id === 'suite') {
        name = 'Lumen Studio'; sync(); fs.rmSync(single, { force: true });
        files = pkg.build.files.concat(['build/icons512/suite.png']);
        extra = { appId: pkg.build.appId, productName: name, extraMetadata: { version: VER, homepage: HOME }, fileAssociations: pkg.build.fileAssociations };
      } else {
        meta = APPS.find(a => a.id === id); if (!meta) throw new Error('unknown app ' + id);
        name = meta.name;
        // stage: kit + this app only
        fs.rmSync(appsDir, { recursive: true, force: true }); fs.mkdirSync(appsDir);
        copy(path.join(SITE, 'kit'), path.join(appsDir, 'kit')); copy(path.join(SITE, id), path.join(appsDir, id));
        fs.writeFileSync(single, JSON.stringify({ id }));
        fs.mkdirSync(path.join(ROOT, 'build', 'icons'), { recursive: true });
        fs.copyFileSync(path.join(SITE, 'kit', 'icons', id + '.png'), path.join(ROOT, 'build', 'icons', id + '.png'));
        files = ['main.js', 'preload.js', 'apps.json', 'single.json', 'apps/**/*', 'build/icons/' + id + '.png', 'package.json'];
        extra = {
          appId: 'com.lumenstudio.' + id, productName: name,
          extraMetadata: { version: VER, homepage: HOME, name: 'lumen-' + id, productName: name, description: `${name} - ${meta.desc}` },
          fileAssociations: meta.ext.filter(e => !['pdf', 'svg', 'psd'].includes(e)).map(e => ({ ext: e, name: `${name} file`, role: 'Editor' }))
        };
      }
      const slug = name.replace(/\s+/g, '');
      const { targets, cfg } = platformConfig(id, name, slug);
      const config = {
        ...pkg.build, ...extra, ...cfg, files,
        directories: { output: path.join(id === 'suite' ? 'dist' : path.join('dist-apps', id)), buildResources: 'build' },
        npmRebuild: false,       // no native modules; skips a memory-hungry child process
        compression: 'normal'    // maximum needs more RAM than small PCs have
      };
      console.log(`\n=== ${name} (${TARGET}) ===`);
      const t0 = Date.now();
      const out = await build({ targets, config });
      const art = out.find(f => /\.(exe|dmg|deb)$/.test(f));
      console.log(`built ${path.basename(art)} ${(fs.statSync(art).size / 1048576).toFixed(1)} MiB in ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  } finally {
    // leave the project ready for the full suite build again
    fs.rmSync(single, { force: true });
    sync();
  }
})().catch(e => { console.error('BUILD FAILED', e); process.exitCode = 1; });
