# Brief for the v1.2 feature round

Same rules as `tools/UPGRADE.md` (read it, plus `tools/BRIEF.md` and `kit/README.md`). On top of that:

- Add **3–5 genuinely useful new features** to your one app — things a real user of the professional tool it
  replaces would miss today. Study the app first (menus, existing features, tests) so you don't duplicate anything.
  Prefer depth and correctness over count. Suggested ideas are in your task; you may swap them for better ones.
- Up to ~15 apps are being upgraded at the same time on a 6 GB PC. Prefer Node-only tests for logic; keep headless
  Electron runs (`tools/shot`, run with `C:/code/lumen-photo/node_modules/electron/dist/electron.exe .` from
  `tools/shot`) short, one at a time, and retry after a pause on out-of-memory.
- Do **not** commit, push, build installers, deploy or edit `index.html` — the coordinating session does that.
- Write files with LF line endings (if you use Python on Windows, open with `newline=''`).
- Final report: start with a one-line-per-feature list (≤ 12 words each, suitable for the website's feature list),
  then skipped items, libraries, test evidence and limitations, as in `UPGRADE.md`.
