# Roadmap

The goal: a Haxe development environment in a web page, nothing installed. An editor,
the compiler, and the running program side by side, with hotreload-hx swapping the
program's code on each save while it keeps its state. The compiler is the piece that
was uncertain; it's done. The rest is ordered by what unblocks what.

Status marks: `[x]` done, `[ ]` not started, `[~]` in progress. Dates are when the mark
changed.

## 1. The compiler in a page

- [x] Haxe 4.3.7 as OCaml bytecode, js_of_ocaml over it, C libraries stubbed in JS
      (`stubs.js`). 2026-10-18.
- [x] Macros: eval runs in the page; hotreload-hx's build macro produces the same bundle
      as native Haxe. 2026-10-18.
- [x] Runs in a Web Worker in Firefox and Chromium (Brave). Needed the case-table patch
      (then `patches/`, now the fork branch). 2026-10-18.
- [x] Reproducible from nothing: `build.py` installs opam, OCaml, the libraries, mbedtls
      and Haxe under `build/`. 2026-10-18.
- [x] The case-table change is upstream: HaxeFoundation/haxe#13067, merged into
      `development` by Simn (4413a0b94), so Haxe 5 has it. The 4.3.7 build here still
      carries it as a commit on the fork branch, since the 4.3 line is frozen. 2026-10-18.
- [x] Standard library on demand: `web/std/` + `manifest.json`, fetched by synchronous
      XHR from the worker the first time the compiler opens a file (72 files for hello
      world, 152 for the parity program). Bundle 7.8 MB → 3.8 MB; compiles 0.1–0.3 s
      slower than embedded, less once the HTTP cache is warm. No shared memory or
      special headers needed after all. 2026-10-18.

## 2. A resident compiler

- [x] Measured a cold hot-reload build of hello (2.4 s in node): startup 0.1 s, macros
      0.84, parsing 0.75 (696 files), typing 0.53, the rest 0.26. Almost all of it is
      redoing unchanged modules. 2026-10-18.
- [x] Haxe's compilation server, driven one request at a time: with `HAXE_RESIDENT=1`,
      `--wait stdio` registers its loop body as an OCaml callback and returns instead of
      blocking (a commit on the fork branch, server.ml). `stubs.js` adds `hx_request`, `hx_write_file`
      (with a modification time that only rises), and `Unix.stat` for the in-memory
      filesystem. `web/resident-worker.js` keeps one runtime alive; `play.html` uses it and
      warms the reload build's cache at start. Reload builds: 69–82 ms in Brave, 93–116 ms
      in Firefox, from ~2.5–3 s. `node tests/resident.js` checks edits, a broken edit
      and its fix. 2026-10-18.
- [ ] Memory over a long session: the server's cache grows; watch it, and use the
      server's own GC task if it matters.
- [x] Built from `4.3-js_of_ocaml` on Rob's fork instead of the 4.3.7 tag and a patch:
      the server skip-reason fix (haxe#13058), the case tables (haxe#13067), resident
      mode and the bytecode build, one commit each, on 4.3.7. The branch still builds a
      native compiler and passes the interpreter unit tests. 2026-10-18.

## 3. Hot reload in the page

What hotreload-hx's JS client needs from a server is small: the current bundle, and a
way to learn a new one exists. Nothing here needs a resident compiler.

- [x] Working in Brave, 2026-10-18: `web/play.html` + `web/sw.js` (a service worker plays the
      DevServer) edit, build and hot-reload hotreload-hx's examples/hello; `?test` checks it.
      Firefox passes too (reload builds ~3 s there, ~2.5 s in Brave).
- [x] An in-page stand-in for the DevServer: after a compile, hand the swap the new
      bundle as a blob URL and signal it. Look at what `hotreload.Reloader` on JS polls
      (`/__hotreload`) and give it the same answers from the page.
- [ ] Run the program in an iframe next to the compiler, from the bundle the worker
      produced; the swap happens inside that iframe.
- [ ] Demonstrate it: edit a file, compile, swap, and watch state survive, with the
      parity program first (its report line says what was kept) and hotreload-hx's
      `examples/hello` second.
- [ ] Assets: the DevServer also watches an assets directory and tells the program
      about changed files. In the page the editor is the only source of changes, so
      this is a message, not a watcher.

## 4. The editor

- [x] Debugging in the browser's DevTools: builds use `-debug -D source-map-content` (the
      sources live only in the in-memory filesystem, so the map carries them); the
      service worker puts each build's map inside its bundle as a `data:` URL, since
      DevTools loads maps past the service worker (a served map was a 404 to it; Rob
      saw "Source map failed to load"). `node tests/devtools.js PORT` checks it in Brave over the
      DevTools protocol: a breakpoint on a Hello.hx line hits at that line, with state
      readable, in the first bundle and in a reloaded one. Firefox: not checked (no
      such protocol headless); try it by hand. No debug adapter. 2026-10-18.
- [x] Maps inline from the compiler: `-D source-map-inline` (a fork branch commit, for
      upstream issue #6414) instead of the service worker rewriting the bundle. Sources
      show under `file://` as `/static/src/...` (the earlier renaming needed the rewrite).
      The branch also fixes Rbuffer under js_of_ocaml (big prints came out as NULs).
      Upstream PR for the define: prepared, not opened (Rob's call).
      2026-10-18.
- [x] CodeMirror 6 in play.html: Haxe highlighting (the legacy-modes Haxe mode), a state
      per file (its own undo), Ctrl-S builds, tabs, dark theme following the system.
      Bundled from `editor/` (versions pinned in its lockfile) into
      `web/vendor/codemirror.js` by build.py, so the page needs no CDN. 2026-10-18.
- [x] Compiler errors and warnings as the editor's diagnostics: on their file, line and
      characters, with an error count on each tab; the test checks one lands on `oops`
      at Hello.hx:39 and clears after the fix. 2026-10-18.
- [x] A file tree (folders as headers, error counts), and New, Rename, Delete: a new
      `src/**.hx` gets its package and class; a rename or delete reaches the resident
      compiler's filesystem (`hx_remove_file`) and the service worker's assets, and code
      changes build. The test checks a new class used by the program, a rename the build
      notices, a delete the compiler forgets, assets added and removed. 2026-10-18.
- [x] The project kept in the browser (IndexedDB, as it's typed), seeded from the
      example (`web/hello/files.json`, from build.py); Reset goes back to it. 2026-10-18.
- [x] A build in progress: a spinner, the time so far, the library files read (the worker
      reports each `std/` read as it happens), and a bar against the last build of the
      same kind, kept in localStorage; a sliding bar when there's none. Hidden for builds
      under 150 ms, so reloads don't flicker. 2026-10-18.
- [x] File and Project menus in the header instead of rows of buttons (keyboard: arrows,
      Home, End, Escape; items off when they can't apply). `node tests/menus.js PORT`.
      2026-10-18.
- [x] Project > Build first in its menu; the page's own dialogs instead of the browser's
      prompt and confirm (names checked in place; every delete asks). 2026-10-18.
- [x] Edit menu: CodeMirror's commands with their shortcuts, and Preferences (theme,
      font size, tabs, wrapping, gutters, brackets), kept in localStorage and applied to
      every open file at once. The editor setup is basicSetup's parts, so they can be
      turned off. Vim or Emacs keys would be packages more (not added). 2026-10-18.
- [x] Real folders: New folder, nested tree (guides, collapsing, a selectable folder),
      Rename/move of files and folders by dialog or by dragging in the tree, the package
      line following a .hx file's move, Delete folder (asks when it has anything, counting
      what the page doesn't show; empty ones go without asking). Moves copy everything
      (hidden files too), then delete the old, so a failure leaves both rather than
      neither; ZenFS's own folder rename reads it all into memory, deletes, then writes.
      2026-10-18.
- [ ] ZenFS reads a folder on disk once, when it's opened, and doesn't see changes made
      outside the page after; a folder-wide move or delete reads it again first (~0.3 s).
      The same gap as noticing outside changes above; if it keeps biting, use directory
      handles directly for the folder instead of ZenFS's WebAccess.
- [ ] Fix imports of a moved class in other files (needs the language server's view).
- [ ] A context menu on the tree's files (Rename, Delete).
- [ ] Haxe highlighting from a real grammar (a Lezer one) instead of the legacy stream
      mode, if the stream mode's gaps show (string interpolation, metadata, regexes).
- [x] The project's files through ZenFS (`@zenfs/core` and `@zenfs/dom`, a node-like `fs`
      over swappable backends) instead of a hand-written store: IndexedDB for the
      browser's project, WebAccess for a folder. Bundled with fflate into
      `web/vendor/fs.js` (328 KB, 95 KB gzipped). Files that aren't UTF-8 are kept,
      served and zipped as bytes, shown read-only in the editor. Hidden files,
      node_modules and top-level out/, bin/, build/, dump/ aren't part of the project.
      2026-10-18.
- [x] Open folder (File System Access, so Chromium; hidden where there's no picker,
      which includes Brave until `brave://flags/#file-system-access-api` is on):
      the page edits the files on disk, new/rename/delete happen there, and the handle is
      remembered for the next visit (reopened at once if the browser kept the
      permission, else a Reopen button). The test opens a directory of the browser's
      private file system (OPFS), the same kind of handle, so it runs in Firefox too.
      2026-10-18.
- [x] Import zip (replaces the browser's project; a single top folder, as GitHub's zips
      have, is taken off) and Export zip. 2026-10-18.
- [ ] A folder changed outside the page (another editor, git) isn't noticed until it's
      opened again: poll the files' modification times, or FileSystemObserver where it
      exists.
- [ ] Opening a folder walks every entry, ignored ones included (ZenFS reads the whole
      tree's handles up front): fine for a project, slow for a huge tree. Measured: 300
      extra files under out/ cost little (folder opened and built in 0.33 s in Brave, 0.65
      s in Firefox).
- [ ] The project's layout is fixed (`src/`, main class `Main`): read it from the
      folder's hxml instead.

## 5. Breakpoints in the IDE's own editor (research, only if DevTools isn't enough)

- [ ] Page JavaScript can't drive the browser's debugger, so the IDE can't pause its own
      frame. The routes: a native host speaking the browser's debugging protocol (an
      install again), or instrumenting the compiled code to report lines and pause, where
      pausing is the hard part (the program and the page share a thread). Decide after
      the editor exists.

## 6. Language server (after a resident compiler)

- [ ] Port `haxe-language-server` (vshaxe; Haxe compiled to JS) to call the in-page
      compiler instead of spawning a `haxe` process. The compiler's `--display` protocol
      is the same binary, so the server's side is the only one that changes.
- [ ] Connect it to the editor: `@codemirror/lsp-client`, or Monaco with
      `monaco-languageclient` if the VS Code flavor of the protocol matters.
- [ ] Without a resident compiler, limit it to diagnostics on save; completion on
      keystrokes needs the warm server.

## 7. WebAssembly (optional, for speed)

- [ ] wasm_of_ocaml compiles the same bytecode in 13 s, but takes no JS primitives
      directly: each of the ~465 `//Provides` in `stubs.js` that is actually reached
      needs a `.wat` import shim. Do it only if the JS build's speed is the problem,
      and measure first; the macro path (an interpreter in an interpreter) is where
      wasm would help most.

## 8. Hosting

- [ ] A static page is the point: GitHub Pages or any file server, with the bundle
      cached by the browser. If item 2's option A lands,
      the host must send the cross-origin isolation headers; GitHub Pages can't, so
      note that when choosing. (Std on demand turned out not to need them.)
- [ ] A Docker image is the alternative shape for a team's shared instance, with the
      real `haxe` behind it; same page, different compiler endpoint.

## Known gaps, not planned

- Regexes in macros run on JS RegExp, not PCRE2; named groups aren't there.
- Macros that open sockets, run processes or use SSL get nothing (silent dummies).
- hxcpp is out of scope: this is the JS target in the browser.
