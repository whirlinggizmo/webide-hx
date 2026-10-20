# webide-hx, all-in-one (experimental)

The IDE as a browser extension (Chromium): the same IDE as the web one (`web/`), with the
compiler and the standard library inside the extension, so it works offline and nothing has
to be hosted. Experimental: see ROADMAP.md, "An all-in-one extension", for what's been
measured and what's open.

`python3 build.py --extension` (after a build of `web/`) assembles it in
`build/extension-ide/`: `web/`'s files (not the web runner's), these, and `index.html`'s
script moved to `ide.js` (an extension's pages can't have inline scripts). Load that
directory with Load unpacked (`chrome://extensions`, Developer mode); the toolbar button
opens the IDE.

- `manifest.json`: Manifest V3; `debugger` (the IDE's debugger, built in) and
  `unlimitedStorage` (projects and libraries kept for good).
- `background.js`: the toolbar button opens the IDE's tab.

Done: the IDE opens, edits and builds. To come: the app's runner (a sandboxed page of the
extension's, with a shim in place of the service worker), libraries straight from their
sites, the debugger without the debugger extension, and the page test in it.
