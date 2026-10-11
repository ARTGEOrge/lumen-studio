# Brief for every Lumen app builder

You are building one app of **Lumen Studio**, a free suite of creative apps meant to compete with Adobe's.
Lumen Photo (the Photoshop equivalent, in `C:/code/lumen-studio/photo/`) already exists — study it for the
look, quality bar and patterns (it is the reference implementation; do NOT edit it).

## Hard rules
1. Work only inside `C:/code/lumen-studio/<your-app>/` (plus `C:/code/lumen-studio/tools/deps/<your-app>/` for npm installs).
   **Do not edit** `kit/`, `photo/`, other apps, `index.html`, or anything outside. If the kit is missing something,
   implement it locally in your app and mention it in your report.
2. Read `C:/code/lumen-studio/kit/README.md` first and use the kit (`../kit/aero.css`, `../kit/aero.js`, `../kit/icons/<app>.png`).
   The app must look like part of the same Vista-Aero family: glass title/menu bar from the kit, glossy command bar,
   white panes with `.aero-ph` headers and `.aero-item` selection rows, Aero dialogs via `Aero.dialog`, toasts via `Aero.toast`.
3. **No network at runtime**: no CDNs/remote fonts/APIs. Vendor libraries locally:
   `npm install --prefix C:/code/lumen-studio/tools/deps/<app> <pkg>@<exact version>` then copy the needed browser build
   into `<app>/vendor/`. Prefer small, well-known MIT/BSD/Apache libraries. Keep the whole app folder under ~25 MB.
4. Static files only, relative URLs, no build step. Pages are served cross-origin isolated (COOP/COEP).
5. Must work in Chromium (Electron 44 / Chrome). Pointer events + pen pressure where relevant. Keyboard shortcuts through menus.
6. Never open visible windows on the user's desktop, never kill processes you didn't start, never deploy or publish anything,
   never `git push`. Test headlessly with `tools/shot` (see kit README) against `http://localhost:5180/<app>/`
   (the dev server is already running; if it isn't, start it in the background with
   `node C:/code/lumen-photo/scripts/serve.js 5180 C:/code/lumen-studio`).
7. Files the user opens must be treated as untrusted data. If your app runs any user-written code/expressions
   (e.g. motion expressions), code that arrives inside an opened file must not run until the user approves it
   (see how Lumen Photo's formula layers handle this in `photo/js/extras.js`, `checkFormulaTrust`).

## Every app must have
- File: New, Open…, **Open Sample** (builds an attractive demo document so the app can be screenshotted and tried instantly),
  Save / Save As (own project format, JSON-based, file extension given in your spec), Import/Export (formats in your spec).
- Undo/redo for every document change (`Aero.History` or your own), dirty tracking via `Aero.setDoc/setDirty`,
  and `onSave` passed to `Aero.init` so the desktop app can save before closing.
- View: zoom in/out/fit/100% where it makes sense. Help: Keyboard Shortcuts dialog, About dialog.
- Drag-and-drop to open/import files. Sensible empty state (not a blank screen): a document or a welcome panel.
- Solid performance on real-size content, no console errors.

## Quality bar
This must be a genuinely useful, working tool — not a mockup. Prioritise depth on the core workflow over a long list of
half-working features. Every menu item and button you ship must work. Test every feature you claim with a scripted
headless test that checks real results (pixel values, exported file bytes, document state), and look at screenshots of
the app (Read the PNG) to judge the visual design. Fix what you find.

## Final report (your last message)
1. Feature list (what actually works), 2. file formats in/out, 3. libraries vendored (name, version, license, size),
4. test evidence (what you checked, results), 5. known limitations — be honest, 6. path to a screenshot of the
app with its sample document open (1400×860, saved as `C:/code/lumen-studio/<app>/screenshot.png`).
