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
      (`patches/`). 2026-10-18.
- [x] Reproducible from nothing: `build.py` installs opam, OCaml, the libraries, mbedtls
      and Haxe under `build/`. 2026-10-18.
- [~] Send the case-table change upstream to Haxe (same arrays, as literals). Harmless;
      makes the stock compiler worker-safe under js_of_ocaml. Branch
      `eval-case-tables-array-literals` on Rob's fork, off upstream `development`;
      built with OCaml 5.3 in the `haxe-build-dev` Docker image; Haxe's unit tests on
      the interpreter pass with it (11,417 assertions), and every BMP code point's
      toUpperCase/toLowerCase matches Haxe 4.3.7's. Opened as HaxeFoundation/haxe#13067.
      2026-10-18.
- [x] Standard library on demand: `web/std/` + `manifest.json`, fetched by synchronous
      XHR from the worker the first time the compiler opens a file (72 files for hello
      world, 152 for the parity program). Bundle 7.8 MB → 3.8 MB; compiles 0.1–0.3 s
      slower than embedded, less once the HTTP cache is warm. No shared memory or
      special headers needed after all. 2026-10-18.

## 2. A resident compiler

Every compile is a cold start today: ~0.4 s before any typing happens, and the typed
standard library is thrown away each time. Native Haxe's compilation server keeps it.
This is the one hard problem left, and three other items wait on it.

- [ ] Measure where the time goes in a cold compile (runtime init, std parsing, typing,
      generation) so the fix targets the right part.
- [ ] Option A: run the compiler's own server loop (`--wait stdio`) inside the worker
      with stdin fed from page messages. js_of_ocaml reads stdin synchronously, so the
      worker has to block for input: `Atomics.wait` on a SharedArrayBuffer again.
- [ ] Option B: a second run of the bundle in the same worker reusing the first run's
      typed modules. Probably not possible without changes inside the compiler; check
      before trying.
- [ ] Option C: accept cold starts and make them cheaper (smaller std slice per project,
      js_of_ocaml optimization level, snapshotting the runtime's heap after init).

## 3. Hot reload in the page

What hotreload-hx's JS client needs from a server is small: the current bundle, and a
way to learn a new one exists. Nothing here needs a resident compiler.

- [x] Working in Brave, 2026-10-18: `web/play.html` + `web/sw.js` (a service worker plays the
      DevServer) edit, build and hot-reload hotreload-hx's examples/hello; `?test` checks it.
      Firefox not yet run.
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

- [ ] CodeMirror 6 with Haxe highlighting, a file tree over the project's files, save
      triggers a compile.
- [ ] Compiler errors from stderr mapped to the editor's diagnostics
      (`File.hx:line: characters a-b : message` is a fixed format).
- [ ] Project persistence: IndexedDB for the browser-only case; the File System Access
      API to work on a real directory where it exists (Chromium), so a normal editor can
      touch the same files.
- [ ] Import/export a project as a zip.

## 5. Language server (after a resident compiler)

- [ ] Port `haxe-language-server` (vshaxe; Haxe compiled to JS) to call the in-page
      compiler instead of spawning a `haxe` process. The compiler's `--display` protocol
      is the same binary, so the server's side is the only one that changes.
- [ ] Connect it to the editor: `@codemirror/lsp-client`, or Monaco with
      `monaco-languageclient` if the VS Code flavor of the protocol matters.
- [ ] Without a resident compiler, limit it to diagnostics on save; completion on
      keystrokes needs the warm server.

## 6. WebAssembly (optional, for speed)

- [ ] wasm_of_ocaml compiles the same bytecode in 13 s, but takes no JS primitives
      directly: each of the ~465 `//Provides` in `stubs.js` that is actually reached
      needs a `.wat` import shim. Do it only if the JS build's speed is the problem,
      and measure first; the macro path (an interpreter in an interpreter) is where
      wasm would help most.

## 7. Hosting

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
