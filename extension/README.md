# webide-hx debugger

A browser extension (Chromium: Chrome, Edge, Brave) that lets webide-hx debug its app from
the IDE itself: breakpoints in the editor's gutter (a click, or F9), Continue, Pause, Step
over/into/out (F8, F10, F11, Shift+F11), the call stack and the variables, with the line the
app is stopped at marked in the editor. Without it, debugging is DevTools' (F12), on the same
`.hx` lines.

It uses `chrome.debugger` on the app's own frame only (the app runs on a site of its own, in
a process of its own), so the IDE goes on while the app is stopped. It's attached only while
there are breakpoints or a pause; Chrome shows a "started debugging this browser" bar then.
It works on the IDE's pages only: `127.0.0.1`, `localhost` and `dev.whirlinggizmo.com`.

To install it until it's in the Chrome Web Store: open `chrome://extensions` (or
`brave://extensions`), turn on Developer mode, Load unpacked, and pick this directory. Then
reload the IDE's page.

- `manifest.json`: Manifest V3; the `debugger` permission, and `bridge.js` on the IDE's pages.
- `bridge.js`: on the IDE's page, between the page (`window.postMessage`) and the worker.
- `background.js`: the worker: attaches to the page's tab, and passes commands to the app's
  session and events back.

`tests/debugger.js` checks it in a browser started with `--load-extension`.
