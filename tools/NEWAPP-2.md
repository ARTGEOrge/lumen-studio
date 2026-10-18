# Brief for the second wave of new Lumen apps

Read `tools/BRIEF.md` (all its rules apply) and `kit/README.md`, and study a finished app close to yours
(e.g. `photo/`, `layout/`, `plan/`, `pcb/`, `lab/`) before you start. Changes to the BRIEF.md rules:

- **No downloads of any kind.** The user said no: do not run `npm install`, `pip install`, curl/wget or any other fetch.
  You may only use libraries that are **already on this PC** — copy the browser build (and its licence file) into
  `<app>/vendor/`. Available now:
  - `convert/vendor/`: `xlsx.full.min.js` (SheetJS, Apache-2.0: reads/writes .xlsx/.xls/.ods/.csv), `mammoth.browser.min.js`
    (BSD-2, .docx → HTML), `fflate.js` (MIT, zip/deflate), `fontkit.umd.min.js` (MIT), `marked.umd.js`, `turndown`,
    `purify.min.js` (DOMPurify), `gifenc`, `lamejs` (LGPL – unmodified separate file only), `mp4-muxer`, `webm-muxer`,
    `three-convert.min.js` (three.js subset, MIT), `js-yaml`, `qrcode`.
  - `layout/vendor/`: `pdf-lib.min.js` (MIT), `fontkit`, fonts. `cad/vendor/three-cad.min.js`. `flow/vendor/omggif.js`.
  - `tools/deps/*/node_modules/` (already installed, copy only): `jszip`, `opentype.js`, `jspdf`, `paper`, `pdfjs-dist`,
    `pako`, `fflate`, `lucide-static` icons, `@fontsource*` / `inter-ui` / `dejavu-fonts-ttf` fonts, `svgpath`, `svg-pathdata`, etc.
  - Browser built-ins are fine too: `CompressionStream`/`DecompressionStream('deflate-raw')` for zip, Web Audio, WebGL2, WebGPU.
  If you need something not on the PC, write it yourself or leave the feature out and say so.
- Only edit your own folder `<app>/` (tests may go in `<app>/tests/` or `tools/deps/<app>/`). Do **not** create the app icon
  (`kit/icons/<app>.png`), edit `index.html`, `kit/`, `tools/make-icons.js`, the desktop suite, or anything shared —
  the coordinator does that. Until an icon exists, reference `../kit/icons/<app>.png` anyway (a 404 there is expected).
- Up to 12 apps are being built at once on a 6 GB PC: prefer Node-only tests for logic; run headless Electron
  (`tools/shot`, run with `C:/code/lumen-photo/node_modules/electron/dist/electron.exe .` from `tools/shot`) one short run at a
  time; retry after a pause on out-of-memory. Never leave processes running.
- Do not commit, push, build installers or deploy. LF line endings.
- Be honest about scope: a focused, solid app that does the core job well beats a long list of shallow features.
- Final report as in BRIEF.md, starting with: a one-sentence tagline, then 6–8 website feature bullets (≤ 8 words each),
  then a "formats" line ("Opens … · Exports …").
