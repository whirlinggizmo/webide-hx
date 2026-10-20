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
      special headers needed after all. 2026-10-18. (Now the fallback: the first build reads
      the whole library from one pack, `web/std.json.gz`; see 6.)

## 2. A resident compiler

- [x] Measured a cold hot-reload build of hello (2.4 s in node): startup 0.1 s, macros
      0.84, parsing 0.75 (696 files), typing 0.53, the rest 0.26. Almost all of it is
      redoing unchanged modules. 2026-10-18.
- [x] Haxe's compilation server, driven one request at a time: with `HAXE_RESIDENT=1`,
      `--wait stdio` registers its loop body as an OCaml callback and returns instead of
      blocking (a commit on the fork branch, server.ml). `stubs.js` adds `hx_request`, `hx_write_file`
      (with a modification time that only rises), and `Unix.stat` for the in-memory
      filesystem. `web/resident-worker.js` keeps one runtime alive; the IDE uses it and
      warms the reload build's cache at start. Reload builds: 69–82 ms in Brave, 93–116 ms
      in Firefox, from ~2.5–3 s. `node tests/resident.js` checks edits, a broken edit
      and its fix. 2026-10-18.
- [x] Memory over a long session, measured (`node --expose-gc tests/memory.js`): 600 edits,
      each an errors-as-you-type check, a reload build and a hover, took the heap from 271
      to 281 MB (about 17 KB an edit) at a steady ~200 ms a cycle. Nothing to do; the
      server's own GC task is there if a bigger project says otherwise. The runtime
      itself is large from the start (~270 MB heap, ~780 MB process in node). 2026-10-19.
- [x] Built from `4.3-js_of_ocaml` on Rob's fork instead of the 4.3.7 tag and a patch:
      the server skip-reason fix (haxe#13058), the case tables (haxe#13067), resident
      mode and the bytecode build, one commit each, on 4.3.7. The branch still builds a
      native compiler and passes the interpreter unit tests. 2026-10-18.

## 3. Hot reload in the page

What hotreload-hx's JS client needs from a server is small: the current bundle, and a
way to learn a new one exists. Nothing here needs a resident compiler.

- [x] Working in Brave, 2026-10-18: `web/index.html` (then play.html) + `web/sw.js` (a service worker plays the
      DevServer) edit, build and hot-reload hotreload-hx's examples/hello; `?test` checks it.
      Firefox passes too (reload builds ~3 s there, ~2.5 s in Brave).
- [x] An in-page stand-in for the DevServer: after a compile, hand the swap the new
      bundle as a blob URL and signal it. Look at what `hotreload.Reloader` on JS polls
      (`/__hotreload`) and give it the same answers from the page.
- [x] The program runs in an iframe next to the editor, from the bundle the worker
      produced, and swaps there (or in a window of its own: see the editor's App menu).
      2026-10-18.
- [x] Demonstrated with hotreload-hx's `examples/hello`: `?test` edits, builds and checks
      that @:hot state carries over and plain statics start over. 2026-10-18.
- [ ] The same with the parity program, in the page (its report line says what was
      kept); index.html only compiles it today.
- [x] Assets: the page tells the service worker, which tells the program
      (`/__hotreload_assets`), as the DevServer's watcher would; added, changed and
      removed ones, and bytes as well as text. 2026-10-18.

## 4. The editor

- [x] Debugging in the browser's DevTools: builds use `-debug -D source-map-content` (the
      sources live only in the in-memory filesystem, so the map carries them); the
      service worker puts each build's map inside its bundle as a `data:` URL, since
      DevTools loads maps past the service worker (a served map was a 404 to it; Rob
      saw "Source map failed to load"). `node tests/devtools.js PORT` checks it in Brave over the
      DevTools protocol: a breakpoint on a Hello.hx line hits at that line, with state
      readable, in the first bundle and in a reloaded one. Firefox: Rob checked by hand
      (2026-10-19): breakpoints work, on the .hx file. No debug adapter. 2026-10-18.
- [x] Maps inline from the compiler: `-D source-map=inline` (merged upstream as
      haxe#13068, 2026-10-19; backported on the fork branch) instead of the service worker rewriting the bundle. Sources
      show under `file://` as `/static/src/...` (the earlier renaming needed the rewrite).
      The branch also fixes Rbuffer under js_of_ocaml (big prints came out as NULs).
      2026-10-18.
- [x] CodeMirror 6 in the IDE: Haxe highlighting (the legacy-modes Haxe mode), a state
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
      example (`web/example/files.json`, from build.py); Reset goes back to it. 2026-10-18.
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
- [x] ZenFS reads a folder on disk once, when it's opened; the page reads it again when it
      sees an outside change (below), and before a folder-wide move or delete (~0.3 s).
      2026-10-19.
- [ ] Fix imports of a moved class in other files (needs the language server's view).
- [x] The program out of the page (the App menu, was View: Embedded, Separate window,
      Floating window, Open in new tab): a window of its own (remembered where it was;
      closing it brings the program back), picture-in-picture (Chromium; Rob tried it in
      Brave, 2026-10-19: works), or a new tab. It works because the program only talks to
      the service worker, which serves every client the same builds. 2026-10-18.
- [x] App > Restart: the app from its start on the latest build, wherever it shows (its
      @:hot state goes too); greyed until something has built. A build that works now
      also starts an app that wasn't running (the project's first build had failed; it
      stayed blank until the project was loaded again). 2026-10-19.
- [ ] Place the program's window on a chosen screen (Window Management API, Chromium;
      a permission prompt).
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
- [x] Open folder (local) (File System Access, so Chromium; always in the Project menu,
      greyed where there's no picker, its tooltip and a click saying why: Brave until
      `chrome://flags/#file-system-access-api` is on, Firefox and Safari not at all):
      the page edits the files on disk, new/rename/delete happen there, and the handle is
      remembered for the next visit (reopened at once if the browser kept the
      permission, else a Reopen button). The test opens a directory of the browser's
      private file system (OPFS), the same kind of handle, so it runs in Firefox too.
      2026-10-18.
- [x] Import zip (replaces the browser's project; a single top folder, as GitHub's zips
      have, is taken off) and Export zip. 2026-10-18.
- [x] The browser's project kept: the page asks for persistent storage (Chromium decides by
      engagement, Firefox asks), and the header's tooltip says whether the browser keeps it
      or may delete it when space runs low. Clear library cache… (in Project > Libraries…) empties the
      library cache only. 2026-10-19.
- [x] A folder changed outside the page (another editor, git): the page looks every 2 s
      (the files' modification times, from the directory handles) and takes what changed:
      the tree, the editor, and the program, which reloads as for an edit in the page.
      A write checks the file's time first: changed underneath while the page had an edit
      waiting, it asks which version to keep (unanswered, neither is lost and the next
      write asks again). Before this, the page could write its stale copy over the newer
      one. The look is skipped, or thrown away, while the page changes the folder itself.
      FileSystemObserver could replace the polling where it exists. 2026-10-19.
- [ ] Opening a folder walks every entry, ignored ones included (ZenFS reads the whole
      tree's handles up front): fine for a project, slow for a huge tree. Measured: 300
      extra files under out/ cost little (folder opened and built in 0.33 s in Brave, 0.65
      s in Firefox).
- [x] The build from the project's hxml (Project > Select hxml…, or a click on the header's
      "hxml:"; build.hxml, else the first
      that builds JS, kept once picked): class paths (code, packages), --main, --js,
      includes, other options passed on; another target, --run, --next/--each, --cwd and
      libraries other than hotreload-hx refused on their line. Class paths go to the
      compiler absolute (/static/...): through a relative one, the resident compiler
      didn't see edits (worth a look in the server's file checks). 2026-10-18.
- [x] Libraries: lix's `haxe_libraries/<name>.hxml` (its @install source, its hxml) or
      `-lib name:version` (the haxelib release, its haxelib.json and extraParams.hxml),
      downloaded once per browser into a shared cache (IndexedDB at /libcache), hashed and
      pinned. haxelib releases: haxelib-files.haxe.org once it allows it (haxelib#693,
      opened), else the site's haxelib/ relay (serve.py locally; `hosting/`'s nginx mirror on a
      server), else Add library zip… (Project > Libraries…). Git: jsDelivr (GitHub), GitLab's archive. The page test builds with
      format 3.7.0 both ways. 2026-10-18.
- [~] Unpinned `-lib name`: the newest version needs haxelib's API (Haxe remoting on
      lib.haxe.org, no CORS). Done in the all-in-one extension (2026-10-20: the newest, said
      in each build's output with how to pin it; dependencies without a version too; Add
      library… with a name alone). On the web it still asks for a version or a lix file; the
      mirror could pass the API through.
- [x] Add library… (now in Project > Libraries…): `lix install` in the page. name:version (haxelib) or
      gh://github.com/owner/repo#ref (made a commit by GitHub's API); lix's file for it
      and for each dependency with a version, then -lib in the build's hxml. Dependencies
      without a version are named for the person to add. Tests: the page test (lix's text
      exactly, dependencies, replace only when asked, GitHub, the build) and the menus
      test (the dialog). 2026-10-19.
- [x] The mirror on dev.whirlinggizmo.com, with the page: `hosting/` (one nginx container
      behind Apache). 2026-10-19.

- [x] The app on a site of its own (runner.html): a separate process, so a busy, hung or
      paused app doesn't stop the IDE, and the app can't reach the IDE's storage. Measured
      first: only another registrable domain gets a separate process (another port, a
      subdomain, Origin-Agent-Cluster don't; a sandboxed frame does only in Chromium); a
      runner's service worker works in a cross-site iframe (partitioned) and a window, in
      Brave and Firefox. The IDE hands each runner builds and assets by postMessage; sw.js
      is unchanged. Locally 127.0.0.1 and localhost; on dev run.whirlinggizmos.com once its
      site and certificate are there (hosting/README.md), the IDE's own origin until then.
      Tests: page test (both browsers, both ways), menus, DevTools (the app's frame is its
      own target now), reload. 2026-10-20.

- [x] Files on demand: the runner asks the IDE for a file the first time the app requests
      it (then keeps it; a 404 if there's none; code isn't served), instead of being sent
      every non-code file up front. A change sends only the name. A runner whose app is
      busy or hung doesn't hold up builds (200 ms at most). 2026-10-20.

## 5. Debugging in the IDE

Without an extension, debugging is DevTools': the bundles carry their source maps and the
`.hx` text, so breakpoints, stepping and variables work there on the `.hx` lines, and the app
has its own process, so the IDE goes on while it's stopped. A page can't drive the
debugger, so debugging inside the IDE needs a browser extension (Chromium: `chrome.debugger`).
Two, for two kinds of use:

- [x] Gutter breakpoints that pause in DevTools, by putting `js.Lib.debug();` at the start
      of the line in the compiler's text (2026-10-20). A bridge to DevTools from outside,
      with its limits (only where a statement starts, a rebuild per toggle, one more stop
      after a change while stopped: messages to a stopped app are dropped). Removed when
      the debugger extension landed (2026-10-20): without it, DevTools as it is.
- [x] Probe (2026-10-20): an MV3 extension attaches `chrome.debugger` to the IDE's tab; the
      runner's frame is a child session of its own; the debugger on that session only. A
      breakpoint at a `.hx` line (from the source map), stopped there, the call stack,
      variables, the IDE running meanwhile, step over, a breakpoint removed while stopped
      and no stop after. Headless Brave loads it with --load-extension.
- [x] **The debugger extension** (optional; the IDE stays a web page; 2026-10-20, `extensions/debugger/`,
      `tests/debugger.js`). Small: a content
      script on the IDE's pages bridges the page and the extension's worker, which drives
      `chrome.debugger` on the app's frame only. Permissions: debugger, and the IDE's own
      hosts. Attached only while there are breakpoints or a pause is asked for (Chrome
      shows a banner while it is). In the IDE: real breakpoints from the gutter (no
      rebuild; re-placed after each hot reload from the new map), a Run and Debug panel
      (continue, step over/into/out, the call stack, variables), the stopped line marked in
      the editor. Then: values on hover, watches, pause on exceptions, conditional
      breakpoints and logpoints, a console in the stopped app. The app in a window or a
      tab of its own is debugged too (2026-10-20: the runner tabs the IDE opened are attached;
      the panel comes under the editor); the floating window isn't yet.
- [~] **An all-in-one extension**, an alternative to the web IDE (`extensions/ide/`, `build.py
      --extension`; usable 2026-10-20: the IDE builds there, the app runs (in its pane, a
      window or a tab), hot-reloads, takes changed files and restarts, its runner sharing
      `web/devserver.js` with `sw.js`; libraries straight from their sites; the debugger built
      in; the IDE's own test passes in it, `node tests/extension.js`): the IDE as an extension
      page, with the compiler and the standard library inside it (offline, nothing hosted:
      the bundle uses no eval), the library cache in the extension's storage (never
      evicted), libraries straight from haxelib, GitHub and GitLab (no mirror; the newest
      version for an unpinned `-lib`), and the debugger. Not decided: weighed against the
      debugger extension plus the web IDE (updates without a store's review, narrower
      install permissions, one runner, projects in one place, links). Measured 2026-10-20 in
      Brave, with probe extensions:
      - The app's runner as a sandboxed extension page: its own process (the IDE ticked on
        while it spun), no storage at all (localStorage, IndexedDB refused), no extension
        APIs, no access to its parent. No service worker: refused ("the context is
        sandboxed"). The extension's own worker doesn't answer its requests either, even
        for web-accessible paths. Web workers: from a blob, with a sandbox CSP that allows
        it (`worker-src blob:`); not from a file URL (a shim can fetch it into a blob).
      - The debugger: an extension page attaches `chrome.debugger` to its own tab; the
        sandboxed frame is a session of its own; a breakpoint stops it, a variable is read,
        the IDE page goes on.
      - Plain URLs without a service worker: a shim in the runner page, before the app,
        answers relative URLs from the IDE's files (fetch, XMLHttpRequest, an image's or a
        sound's src) and /__hotreload and /__hotreload_assets as the DevServer does. hello,
        as Haxe 4.3.7 builds it, with hotreload-hx unchanged: ran with its asset, hot
        reloaded (the reloader's import() of a blob URL: it's given `blob:...#`, so its
        `?v=N` lands in the fragment), @:hot state kept, hooks ran, a changed asset reached
        it; XMLHttpRequest text and bytes, an image, a 404, an outside URL to the network.
        Not covered by a shim: CSS url() and stylesheets, `<img>` written as HTML, fonts in
        CSS, a dynamic import() of the app's own modules; such apps would want the web runner.
      Probes: scratchpad sbx-probe, sbx-dbg, sbx-app (2026-10-20).

## 6. Language server (after a resident compiler)

- [x] The direct route instead of porting haxe-language-server: the IDE asks the compiler
      itself, Haxe's display protocol (--display with JSON) through the resident
      compiler, like a build (its options, the editor's unsaved text, its cache):
      completion (CodeMirror's, from display/completion), hover (display/hover), go to
      definition (display/definition; Ctrl-Alt-J beside go to line's Ctrl-Alt-G, Ctrl/Cmd-click; not F12, Ctrl-B or Ctrl-D, which browsers keep). 10-40 ms each. The reply is
      the compiler's message, not its output; offsets are code points (bytes were wrong
      after non-ASCII text). 2026-10-19.
- [x] Signature help while typing a call's arguments (display/signatureHelp), a tooltip
      that follows the call; `)` or Escape closes it. 2026-10-19.
- [x] Errors as you type: a --no-output build 0.8 s after the last keystroke, its errors
      marked as a build's are (no write, no reload). 2026-10-19.
- [x] Go to definition into the standard library or a library: the file opened read-only
      (std/ or the library cache), a bar saying which with a × back, hover and go to
      definition in it. 2026-10-19.
- [x] The standard library in one download for the first build (web/std.json.gz, 0.5 MB,
      read from memory) instead of a request per file: the first build on dev went from
      ~23 s to ~3 s. 2026-10-19.
- [ ] Outline, rename, find references (display/references, display/documentSymbols), the
      same way.
- Not planned: porting `haxe-language-server` (vshaxe) to call the in-page compiler and
  connecting it with `@codemirror/lsp-client`. The direct route above does what the IDE
  needs; the port would matter only for its extras (code actions, formatting).

## 7. WebAssembly (optional, for speed)

- [ ] wasm_of_ocaml compiles the same bytecode in 13 s, but takes no JS primitives
      directly: each of the ~465 `//Provides` in `stubs.js` that is actually reached
      needs a `.wat` import shim. Do it only if the JS build's speed is the problem,
      and measure first; the macro path (an interpreter in an interpreter) is where
      wasm would help most.

## 8. Hosting

- [x] On dev.whirlinggizmo.com/webide-hx/: `hosting/deploy.py` copies `web/` and the
      service (nginx, with the haxelib mirror) to the server. 2026-10-19.
- [x] A Docker image, `ghcr.io/whirlinggizmo/webide-hx` (public): the same site and mirror
      in nginx, built from the repository by GitHub Actions on each push; `docker compose
      up` at the top runs it. 2026-10-19.
- [ ] GitHub Pages, or any static file server: `web/` as it is, with no special headers
      (nothing needs cross-origin isolation). Without the mirror, haxelib releases come
      from Add library zip… until haxelib#693.

## Known gaps, not planned

- Regexes in macros run on JS RegExp, not PCRE2; named groups aren't there.
- Macros that open sockets, run processes or use SSL get nothing (silent dummies).
- hxcpp is out of scope: this is the JS target in the browser.
