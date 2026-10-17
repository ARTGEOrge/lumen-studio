# Lumen Studio

Ten free creative apps in a Windows Vista "Aero" style — plus Lumen Convert, a page of in-browser file converters.
Everything runs locally in the browser (or in the Windows desktop app); nothing is uploaded.

**Live site:** https://lumen-studio-silk.vercel.app · **Downloads:** [Releases](https://github.com/ARTGEOrge/lumen-studio/releases)

| App | In the spirit of | Folder |
|---|---|---|
| Lumen Photo | Photoshop | `photo/` |
| Lumen Vector | Illustrator | `vector/` |
| Lumen Darkroom | Lightroom | `darkroom/` |
| Lumen Paint | Fresco | `paint/` |
| Lumen Cut | Premiere Pro | `cut/` |
| Lumen Motion | After Effects | `motion/` |
| Lumen Sound | Audition | `sound/` |
| Lumen Layout | InDesign | `layout/` |
| Lumen Proto | XD | `proto/` |
| Lumen PDF | Acrobat | `pdf/` |
| Lumen Plan (engineering) | Primavera P6 | `plan/` |
| Lumen Convert (web page, not an app) | — | `convert/` |

## Layout
- Each app is a static folder (no build step) using the shared UI kit in `kit/` (`kit/README.md` documents it).
- Third-party libraries are vendored next to each app in `*/vendor/` with their license files.
- `desktop/suite` — Electron shell that packages every app (with a launcher) or a single app into a Windows installer.
- `desktop/photo` — Electron shell for the standalone Lumen Photo build.
- `tools/` — headless test runner (`tools/shot`), icon generator, and the build briefs.

## Run locally
Serve this folder with cross-origin isolation headers (needed for threaded WASM), e.g.
`node desktop/photo/scripts/serve.js 5180 .` then open http://localhost:5180/.

## Engineering apps
Newer apps for engineers, on the same kit. Each has Node tests in `<app>/tests/` (`node plan/tests/cpm.test.js`, `node plan/tests/io.test.js`).
They ship as their own installers, versioned separately: `APP_VERSION=1.0.0 node scripts/build-apps.js plan` in `C:\code\lumen-suite`,
released under tags like `plan-v1.0.0`. Planned next: Lab (MATLAB), PCB (Altium), CAD (CATIA), Flow (Fluent).

Adobe and its product names are trademarks of Adobe Inc. Lumen Studio is not affiliated with Adobe.
