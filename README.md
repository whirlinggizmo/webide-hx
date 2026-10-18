# haxe-in-browser

The Haxe compiler, running in a web page. `web/haxe.js` is Haxe 4.3.7 compiled from
its OCaml bytecode with js_of_ocaml; `stubs.js` stands in for the C libraries it links.
A page hands it source files and arguments in a Web Worker and reads the JavaScript it
produces back out. Macros work: eval, the macro interpreter, is pure OCaml and comes
along, so a build macro like hotreload-hx's runs inside the page too.

Started 2026-10-18 as a probe for a browser playground with hot reload: an editor, the
compiler and the running program all in one page, nothing installed.

## Run it

    python3 web/serve.py
    # open http://127.0.0.1:8765/

The page compiles a hello world (and runs it), compiles it again, then compiles the
parity program from hotreload-hx's tests with the hotreload build macro, printing each
exit code, time and output size. Without a browser:

    node tests/browserlike.js

runs the same bundle in node as a page would.

For another device on the LAN, serve HTTPS: `play.html`'s service worker needs a secure
page, and only `localhost` counts as one over plain HTTP.

    python3 web/serve.py --tls cert.pem key.pem      # or TLS_CERT and TLS_KEY in the environment

That listens on every interface, on port 8443, and prints the LAN address. The
certificate has to name that address and be trusted by the device (a local development
CA, as mkcert makes). `web/haxe.js` and `web/std/` are generated (ignored
by git); `python3 build.py --hotreload ../../github/whirlinggizmo/hotreload-hx` makes
them, see below.

## What was measured

Both browsers on the development box, in a Web Worker, standard library fetched on
demand, 2026-10-18:

| build | Brave 155 | Firefox | native Haxe | std files fetched |
|---|---|---|---|---|
| hello world (one class) | 0.64s | 0.66s (1.07s cold) | 0.05s | 72 |
| parity program + hotreload build macro | 1.82s | 1.89s | 0.20s | 152 |

With the library embedded in the bundle instead (`--embed-std`) the compiles are about
0.1 to 0.3 s faster and the bundle is 7.8 MB instead of 3.8 MB. Output is byte-identical
to native Haxe's in both cases. Every compile is a cold start of the compiler (no
compilation server), and macro code is an interpreter running inside an interpreter, so
the gap is widest there.

## How it's built

`build.py` does all of this into `build/`:

1. **mbedtls 2.28** is built from source, because Haxe's ssl binding needs its headers
   to compile at all, even though nothing here uses it.
2. **Haxe** is cloned from the `4.3-js_of_ocaml` branch of
   [robknopf/haxe](https://github.com/robknopf/haxe/tree/4.3-js_of_ocaml): 4.3.7 plus
   these commits, each its own:
   - the compilation server formats a module's skip reason only when printing it, in
     linear time ([haxe#13058](https://github.com/HaxeFoundation/haxe/pull/13058), in
     Haxe 5): the resident compiler below is that server;
   - eval's Unicode case tables as array literals
     ([haxe#13067](https://github.com/HaxeFoundation/haxe/pull/13067), in Haxe 5). As
     list literals, js_of_ocaml emits a 1027-deep expression that a Web Worker's parser
     can't take;
   - the server's resident mode (`HAXE_RESIDENT=1`, below);
   - `src/dune` builds `haxe.bc` beside the native `haxe`, linked with
     `-no-check-prims` since the C stubs are replaced by `stubs.js`.
   The branch also carries the fork's Windows build workflow. It still builds a native
   compiler, and Haxe's interpreter unit tests pass on it (10,899 assertions, with the
   utest commit 4.3.7's CI pins). Once a clone exists, each build fetches the branch again.
3. **dune** builds `haxe.bc`, 41 MB of bytecode.
4. **js_of_ocaml** compiles it to `web/haxe.js` (3.8 MB) with `stubs.js` linked in.
   The JS-relevant standard library (the root classes plus `haxe/`, `js/`, `sys/` and
   `eval/`, 1297 files) is copied to `web/std/` with a `manifest.json` listing it; the
   bundle fetches a file the first time the compiler opens it (below). `--embed-std`
   embeds it in the bundle instead (7.8 MB, no server needed for it). `--embed SRC:DEST`
   embeds other files; `--hotreload DIR` embeds hotreload-hx at `/lib/hotreload` for the
   page's parity test.

wasm_of_ocaml compiles the same bytecode in 13 seconds, but it doesn't take JavaScript
primitives directly: each one needs a WebAssembly text shim importing the JS function.
That's the same `stubs.js` behind a second layer, not done yet.

## stubs.js: the C libraries, in JavaScript

Haxe links a dozen C libraries. js_of_ocaml gives a missing primitive a dummy that
throws when called, which tells you exactly which ones a plain JS build reaches:

- **threads, mutexes, conditions**: no-ops. The compiler is single-threaded here;
  `Thread.create` throws (only the process-spawning path uses it).
- **pcre2**: on JS `RegExp`, over latin1 byte strings so offsets are byte offsets as
  PCRE2 reports them. Caseless, multiline and dotall flags; no named groups, callouts or
  the DFA matcher. Semantics are RegExp's, close to PCRE's but not identical. Compiled at
  startup by the pcre2 library's own default regexp, and by EReg in macros.
- **sha1**: thirty lines of JS (a worker has no synchronous digest).
- **integers** (ctypes' unsigned types): UInt32 as a number, UInt64 as a BigInt.
- **extc** (Haxe's own): paths resolved in pure JS, `sys_time` on `Date`, file times 0.
- **ctypes, libuv, mbedtls**: silent dummies returning 0 or empty tables. Only eval's
  sockets, timers, processes and SSL reach them. A macro that opens a socket gets nothing.
- **zlib, Unix sockets, processes**: left as js_of_ocaml's throwing dummies; nothing on
  a JS build calls them.

`hx_expose`, called from the first primitives the compiler hits, publishes
`globalThis.hx_read_file(path)` so the page can read the output. Every run of the bundle
is a new runtime with its own filesystem, so a page must not hold on to it across runs:
a Worker per compile is the design.

## The standard library on demand

`/haxe/std/` in the bundle's filesystem is a device of its own (`hx_std_device` in
`stubs.js`). It reads `manifest.json` once, so directory listings and existence checks
need no network, and fetches a file's bytes the first time the compiler opens it with a
synchronous `XMLHttpRequest`, which a Web Worker may use. The browser's HTTP cache makes
the second compile cheaper. The page turns it on by setting
`globalThis.HX_STD = {url: ".../std/"}` before loading the bundle; the node test gives it a
`read` function over `web/std/` instead. Without `HX_STD` the device isn't mounted and the
bundle expects the library embedded (`--embed-std`).

## A resident compiler

`play.html` doesn't start the compiler for each build. Its worker
(`web/resident-worker.js`) starts the bundle once as Haxe's compilation server,
`--wait stdio` with `HAXE_RESIDENT=1`, which the branch turns into a registered callback
instead of a blocking loop. Each build is one request (`hx_request(hxml)`), after
`hx_write_file` puts the changed sources in place with a new modification time. What
didn't change stays parsed and typed, so a reload build takes about 0.1 s instead of 2.5.
`node tests/resident.js` drives it the same way.

## The editor

`play.html` edits with CodeMirror 6, bundled from `editor/` into `web/vendor/codemirror.js`
by `build.py` (node and npm needed for that step; versions are pinned in
`editor/package-lock.json`). Ctrl-S builds. The compiler's errors and warnings appear on
their lines, and each tab counts its errors.

## Debugging

`play.html` builds with `-debug -D source-map-content`, so each bundle has a source map
with the `.hx` text in it. The service worker puts the map inside its bundle, as a
`data:` URL: DevTools loads a source map over the network itself, past the page's
service worker, so a map served only from the service worker would fail to load. Open DevTools on the page, find
`Hello.hx` among the sources, and set breakpoints; they keep working across reloads.
`node tests/devtools.js PORT` checks this against a Chromium-based browser started with
`--remote-debugging-port=PORT` on `play.html`.

Text crosses between the page and the compiler as UTF-8: the compiler's filesystem holds
bytes, so `resident-worker.js` encodes sources and decodes output, and the standard
library's on-demand fetch keeps bytes as bytes.

## The page's contract with the bundle

- sources go in before the runtime starts: `globalThis.jsoo_fs_tmp = [{name, content}]`
- arguments and environment come from a node-like object:
  `globalThis.process = {argv: ["node", "haxe", ...args], env: {HAXE_STD_PATH: "/haxe/std"}, cwd: () => "/static", exit: code => {...}}`.
  No `versions` field, so the runtime stays in browser mode (pseudo filesystem,
  cwd `/static`).
- stdout and stderr arrive on `console.log` and `console.error`; the worker captures them.

## Setup

Nothing beyond the system packages: `build.py` installs opam (one static binary),
OCaml 4.14, Haxe's OCaml dependencies and js_of_ocaml under `build/opam` the first time
it runs, about ten minutes and 1.5 GB. From the system it needs git, cmake, make, a C
compiler, `libpcre2-dev` and `zlib1g-dev`, bubblewrap for opam's build sandbox
(without it, sandboxing is turned off), and node with npm for the editor's bundle. It runs opam with a PATH of its own, because
a directory named `install` on the user's PATH (`~/.bun` has one) makes `make install`
fail inside opam builds.

Haxe 4.3's `dune < 3.16` constraint didn't matter; dune 3.24 builds it. For the wasm
route later, binaryen (>= 119) and `wasm_of_ocaml-compiler` would be added.

## Next

`ROADMAP.md` has the pieces in order with their status: a resident compiler, the
in-page hot reload loop, the editor, a language server, wasm, hosting.
