# Lumen Aero Kit

Shared shell for every Lumen app (Windows Vista "Aero" look). Each app is a static folder
`/<app>/index.html` that loads `../kit/aero.css` and `../kit/aero.js`, then its own `app.js`/`app.css`.
Apps run in a browser **and** inside the Lumen Studio desktop shell (Electron), so:

- **No network at runtime.** No CDNs, no fonts from Google, no remote APIs. Third-party libraries must be
  copied into the app folder (e.g. `/<app>/vendor/...`) from `node_modules` and loaded with relative paths.
- **Relative URLs only** (`../kit/aero.js`, `vendor/x.js`) — the app is served from `/<app>/`.
- Pages are served **cross-origin isolated** (COOP same-origin + COEP require-corp), so `SharedArrayBuffer`
  and threaded WASM work, but cross-origin resources would be blocked anyway.
- Plain scripts (or ES modules) — no build step.

## Page skeleton

```html
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lumen Vector</title>
<link rel="stylesheet" href="../kit/aero.css"><link rel="stylesheet" href="app.css">
</head><body>
<div class="aero-app">                     <!-- aero.js inserts the glass title bar + menu bar here -->
  <div class="aero-body">                  <!-- add class "no-toolbox" if there is no toolbox -->
    <div class="aero-toolbox" id="tools"></div>          <!-- optional glass tool column -->
    <div class="aero-client">
      <div class="aero-cmdbar" id="cmd"></div>           <!-- glossy Explorer-style options bar -->
      <div class="aero-work" style="grid-template-columns:1fr 280px">
        <div class="aero-stage" id="stage"></div>        <!-- canvas / document area -->
        <div class="aero-side">                          <!-- right panels -->
          <div class="aero-ph"><span class="phi"></span>Layers<span class="right">3</span></div>
          <div class="aero-list" id="layers"></div>
          <div class="aero-iconbar">…</div>
        </div>
      </div>
      <div class="aero-status"><span id="st1"></span><span id="st2"></span></div>
    </div>
  </div>
</div>
<script src="../kit/aero.js"></script><script src="app.js"></script>
</body></html>
```

## API (`window.Aero`)

- `Aero.init({ name, icon:'../kit/icons/<app>.png', menus, onDropFiles(files), dropTarget, dropText, onSave })`
  — builds title bar, menu bar, caption buttons, shortcuts. `onSave` is called when the desktop window closes with unsaved work.
  Files opened from Windows Explorer in the desktop app are delivered to `onOpenFiles(files)` (or `onDropFiles` if no
  `onOpenFiles` is given) — so make sure dropping your own project file opens it as a document.
- `Aero.menus({ File: [['New…','Ctrl+N',fn], '-', '#Section header', {label,key,fn,checked:()=>bool,disabled:()=>bool}], … })`
  — menu `key` strings become keyboard shortcuts automatically (`'Ctrl+Shift+S'`, `'Delete'`, `'F5'`, `'Ctrl+='`; use `'A/B'` for two keys).
- `Aero.shortcut('V', fn)` — extra shortcuts (single keys are ignored while typing in inputs).
- `Aero.toolbox(container, [{id,title,key,icon:'<svg inner markup, 24×24, stroke icons>'}, null /*separator*/], onSelect)` → `{set(id), get()}`.
- `Aero.setDoc(name, dirty)` / `Aero.setDirty(bool)` — window title `name • – App`.
- `Aero.dialog({ title, instruction, fields:[{key,label,type:'range'|'number'|'text'|'textarea'|'select'|'checkbox'|'color'|'hidden',value,min,max,step,options,fmt,mono}], html, ok, onChange(v), onInput(key,v,set), onOK(v), onCancel })`
  — Aero task dialog; `onChange` gives live preview.
- `Aero.confirm(title, msg)`, `Aero.alert(title,msg)`, `Aero.prompt(title,label,value)` → Promises.
- `Aero.toast(msg)` balloon tip; `Aero.busy(msg)` / `Aero.busy()` spinner overlay.
- `Aero.openFile({accept, filters:[{name,extensions}], multiple})` → `[{name, data:ArrayBuffer, path}]`.
- `Aero.saveFile({name, data: Blob|ArrayBuffer|Uint8Array|string, filters, path})` → saved path/name or null.
- `new Aero.History({max, onChange})` with `reset(label,state) push(label,state) undo() redo() go(i) list()`; `Aero.renderHistory(listEl, hist, onPick)`.
- Helpers: `Aero.clamp, uid, fmtTime(sec), esc, el(tag,cls,html), $`.

## CSS building blocks

`.aero-cmdbar` (put `label`, `select`, `.aero-btn`, `.sep`, `.hint`, `.tname` inside) · `.aero-stage` (soft blue backdrop) ·
`.aero-side` (`.left` for a left column) · `.aero-ph` panel header · `.aero-pane` padded area · `.aero-form` 3-col grid ·
`.aero-list` + `.aero-item(.sel)` Vista selection rows · `.aero-iconbar` + `.aero-iconbtn` · `.aero-tabs` + `.aero-tab(.on)` ·
`.aero-btn(.pri/.small)` · `.aero-status > span` · `.aero-pill` floating glass bar · `.dim`, `.mono`.

Colorful toolbar icons: inline SVG using gradients is fine; keep tool icons as 24×24 stroke icons (they get a white glow on glass).

## Testing without a visible window

The dev server (`node C:/code/lumen-photo/scripts/serve.js 5180 C:/code/lumen-studio`) serves this folder at
`http://localhost:5180/` with the isolation headers. To screenshot or run checks headlessly use
`tools/shot` (hidden off-screen Electron window — it never appears on the user's screen):

```bash
cd C:/code/lumen-studio/tools/shot
SHOT_URL=http://localhost:5180/vector/ SHOT_OUT=C:/path/out.png SHOT_W=1400 SHOT_H=860 SHOT_JS=C:/path/test.js \
  C:/code/lumen-photo/node_modules/electron/dist/electron.exe .
```
`SHOT_JS` (optional) is evaluated in the page as an async function body before the capture; whatever it
`return`s is printed (use `JSON.stringify`). Console errors from the page are printed too. Never launch visible
windows and never kill processes you did not start (the user may have Lumen apps open).
