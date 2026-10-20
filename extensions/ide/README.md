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
- `runner.html`, `shim.js`: the app's runner. A sandboxed page of the extension's: its own
  process, no storage, none of the extension's powers, no access to the IDE. It can't have
  a service worker, so `shim.js` does what `sw.js` does for the web runner, in the page:
  `web/devserver.js` (shared by both) answers, and the page's own loading (fetch,
  XMLHttpRequest, an image's, a sound's or a video's src, a worker's script) is pointed at it
  for the app's relative URLs, which so stay plain. A build is a blob URL (the reloader's
  import gets `blob:...#`, so its `?v=N` is the fragment). Restart is a fresh runner page.
  Not covered: CSS url() and stylesheets, `<img>` written as HTML, fonts in CSS, a dynamic
  import() of the app's own modules.

Done: the IDE opens, edits and builds; the app runs, hot-reloads (its @:hot state kept),
takes changed files, restarts (Brave, 2026-10-20). To come: libraries straight from their
sites, the debugger built in, the app in a window or a tab, the page test in the extension.
