# Working in this repo

Read `README.md` first: what this is, how it's built, what was measured, what each stub
does. `ROADMAP.md` is the plan and the status of each piece; update its marks when you
finish or start one. This file is the conventions and the traps.

## What it is, in one line

The Haxe compiler compiled to JavaScript (js_of_ocaml) so it runs in a web page, as the
compiler half of a browser playground with hot reload. hotreload-hx
(`~/projects/github/whirlinggizmo/hotreload-hx`) is the other half; this repo is a
consumer of it, not part of it.

## Conventions

- Tooling is Python and CMake. No shell scripts, no Makefiles (Windows has to work).
- The build is self-contained under `build/`: opam, OCaml, the libraries, mbedtls, Haxe.
  Never install opam or OCaml into the user's home for this project, and never run
  `opam` against `~/.opam`. `build.py` sets `OPAMROOT` to `build/opam`; follow it.
- `web/haxe.js`, `web/std/`, `web/hello/` and `web/vendor/` are generated and ignored by
  git; so is `editor/node_modules/`. Change editor dependencies in `editor/package.json`
  and commit the regenerated `package-lock.json`; `editor/entry.js` lists what the page uses. So are `build/` (2 GB)
  and `build-log.txt`.
- Haxe changes are commits on the `4.3-js_of_ocaml` branch of Rob's fork
  (`~/projects/github/robknopf/haxe`), one change per commit; `build.py` clones and
  fetches it. Don't edit `build/haxe` and leave it there. The fork's `development` stays
  identical to upstream; a change worth sending upstream goes on its own branch off
  `development` as a PR, and is backported here as a commit. In that clone, run `git
  submodule update` after every checkout (`extra/haxelib_src` differs between 4.3 and
  development) and stage files by name.
- Commit messages: no attribution lines.

## Testing

- Without a browser: `node tests/browserlike.js` runs the bundle in node as a page would
  (the quickest check that a stub change didn't break startup); `node tests/resident.js`
  drives the resident compiler through edits; `node tests/run.js DIR args...` runs any
  build in the in-memory filesystem (add `--times` for a phase breakdown).
- Debugging: start Brave with `--remote-debugging-port=P` on `play.html` (no `?test`),
  then `node tests/devtools.js P`: breakpoints by source map in the first and a
  reloaded bundle. Node 24's built-in WebSocket; no packages.
- In a browser: `python3 web/serve.py`, open `http://127.0.0.1:8765/`.
  The page compiles hello world (and runs it), compiles it again, then compiles the
  parity program with the hotreload build macro, and POSTs a JSON report the server
  writes to the given file. Headless works: `firefox --headless --new-instance --profile
  TMPDIR URL` or `brave-browser --headless=new --disable-gpu --no-first-run
  --user-data-dir=TMPDIR URL`, each with its own throwaway profile directory, then read
  the report file and kill the browser by PID. Both browsers are on the development box;
  Chromium proper isn't.
- The parity program's expected output is hotreload-hx's native build of the same
  sources: compare byte for byte.

## Traps

- A Web Worker's parser has less stack than the main thread's. A 1024-element OCaml
  list literal becomes a 1027-deep JS expression and kills the worker in both Firefox
  and Chromium before any code runs; the stack trace shows only `importScripts`. The
  case tables in eval were the one case; `python3 -c` a bracket-depth scan over
  `web/haxe.js` if a new one appears (anything over a few hundred).
- Every run of the bundle is a fresh runtime with its own pseudo filesystem. Anything the
  page kept from a previous run (the `hx_read_file` hook, file contents) is stale. One
  Worker per compile.
- js_of_ocaml links a `//Provides:` JS file as primitives; wasm_of_ocaml does not. For
  wasm each JS primitive needs a `.wat` import shim as well.
- `//Always` in `stubs.js` is not honored for a user stub file: code that must run (a
  device, a prototype patch) has to be reached through a `//Requires:` chain from a
  primitive the compiler calls. `hx_expose` is that root; require new pieces from it.
- `hx_expose` runs on every path lookup; it sets up once per runtime (`hx_exposed`).
  State that must survive between calls lives there, not in its closures.
- In node the runtime uses the real filesystem, so `--js out.js` writes a real file
  there; in a page it writes to the in-memory tree at the same path.
- Strings in the compiler's filesystem are bytes, one per char. Text from the page is
  UTF-16: encode to UTF-8 bytes going in, decode coming out (`resident-worker.js`).
  A sync XHR with `x-user-defined` gives bytes over 0x7F as U+F780..U+F7FF; mask them.
- pcre2 is emulated on JS RegExp over latin1 byte strings. Regex differences in macros
  are a known gap, not a bug to chase in the compiler.
- A directory named `install` on PATH (`~/.bun` has one on the development box) makes
  `make install` fail inside opam builds with "install: Permission denied". `build.py`
  runs opam with its own PATH for this reason; keep that.
- `opam init -n` already means `--no-setup`; passing both is an error.
- Don't `pkill -f`/`pgrep -f` a pattern from the tool shell: it matches the shell itself.
  Kill the server and the browser by the PIDs you started.
