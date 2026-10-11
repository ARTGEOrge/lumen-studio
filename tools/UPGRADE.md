# Brief for upgrading a Lumen app (v1.1)

You are adding major features to an existing, working Lumen app. Read `C:/code/lumen-studio/tools/BRIEF.md`
(original hard rules — they all still apply) and `C:/code/lumen-studio/kit/README.md`, then study the app's
existing code and tests before changing anything.

## Rules
1. **Do not break anything.** Every existing feature must keep working. If the app has a `tests/` folder (or test
   scripts under `C:/code/lumen-studio/tools/deps/<app>/`), run them before you start and again at the end; all must pass.
2. Work only inside your app's folder (and `tools/deps/<app>/` for npm installs / your tests). Never edit `kit/`,
   other apps, `index.html`, or anything else. No network at runtime; vendor any library locally (MIT/BSD/Apache/ISC/OFL
   preferred; LGPL only as an unmodified separate file with its notice). Keep the app folder reasonably small (< ~30 MB).
3. **This PC has only ~6 GB of RAM and other builders are testing at the same time.** Run at most one headless Electron
   test process at a time, keep each run short, and never leave processes running. If a run fails with out-of-memory or
   "GPU state invalid", wait a little and retry before assuming the app is broken.
4. Same quality bar as before: real, working features with scripted headless tests that check real results
   (pixels, file bytes, document state), plus looking at screenshots. Every new menu item/button must work.
   Integrate new features into the existing UI cleanly (menus, panels, shortcuts, Keyboard Shortcuts dialog, undo/redo,
   save/load in the project format — bump the format version if needed and keep loading old files).
5. Opened files are untrusted: validate new fields; nothing from a file may execute as code without user approval.
6. If a feature turns out to be infeasible to do well, skip it and say so — never ship a fake or half-working button.
7. Update `screenshot.png` (1400×860, the kit's `tools/shot` runner now supports that size) only if the new features
   make a better screenshot; keep the sample document attractive and make it show off new features where natural.

## Final report
1. New features that work (concise), 2. anything from your list you skipped and why, 3. new libraries (name, version,
license, size), 4. test evidence (old tests still pass + new checks), 5. known limitations.
