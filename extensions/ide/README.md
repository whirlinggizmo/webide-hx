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

- `manifest.json`: Manifest V3; `debugger` (the IDE's debugger, built in),
  `unlimitedStorage` (projects and libraries kept for good), and the sites libraries come
  from (haxelib's files and API, GitHub's API, jsDelivr, GitLab), which an extension's page
  can read where a web page can't (no mirror needed). So `-lib name` without a version
  builds with haxelib's newest release (the output says which, and how to pin it), a
  dependency without one gets the newest too, and Add library… takes a name alone (and pins
  the newest in lix's file); haxelib's API is Haxe remoting, read by `hxUnserialize`.
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

Done (Brave, 2026-10-20): the IDE opens, edits and builds; the app runs, hot-reloads (its
@:hot state kept), takes changed files, restarts; libraries come straight from haxelib,
GitHub, jsDelivr and GitLab; the debugger is built in (the IDE drives `chrome.debugger`
itself: the same gutter and panel as with the debugger extension). The IDE's own test
passes in it: `node tests/extension.js` (after `python3 build.py --extension`), and
`tests/debugger.js` against its page. The app in a window or a tab of its own works too
(it hot-reloads and restarts there; closing the window brings it back); the floating window
(picture-in-picture) is unchecked (it can't open in a headless browser). The debugger works
on the app in its pane, a window or a tab, as on the web.
