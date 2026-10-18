# haxe-in-browser

The Haxe compiler, running in a web page. `web/haxe.js` is Haxe 4.3.7 compiled from
its OCaml bytecode with js_of_ocaml; `stubs.js` stands in for the C libraries it links.
A page hands it source files and arguments in a Web Worker and reads the JavaScript it
produces back out. Macros work: eval, the macro interpreter, is pure OCaml and comes
along, so a build macro like hotreload-hx's runs inside the page too.

Started 2026-10-18 as a probe for a browser playground with hot reload: an editor, the
compiler and the running program all in one page, nothing installed.

## Run it

    python3 web/serve.py 8765 web/report.json
    # open http://127.0.0.1:8765/

The page compiles a hello world (and runs it), compiles it again, then compiles the
parity program from hotreload-hx's tests with the hotreload build macro, printing each
exit code, time and output size. Without a browser:

    node tests/browserlike.js

runs the same bundle in node as a page would. `web/haxe.js` is generated (ignored by
git); `python3 build.py` makes it, see below.

## What was measured

Both browsers on the development box, in a Web Worker, 2026-10-18:

| build | Brave 155 | Firefox | native Haxe |
|---|---|---|---|
| hello world (one class) | 0.50s | 0.57s | 0.05s |
| parity program + hotreload build macro | 1.46s | 1.56s | 0.20s |

Output is byte-identical to native Haxe's in both cases. Every compile is a cold start
of the compiler (no compilation server), and macro code is an interpreter running inside
an interpreter, so the gap is widest there.

## How it's built

`build.py` does all of this into `build/`:

1. **mbedtls 2.28** is built from source, because Haxe's ssl binding needs its headers
   to compile at all, even though nothing here uses it.
2. **Haxe 4.3.7** is cloned at its tag and patched (`patches/`):
   - `src/dune`: the executable is built as bytecode (`(modes byte)`), with
     `-no-check-prims` so the link doesn't insist on the C stubs being loadable;
   - `src/macro/eval/bytes/*.ml`: eval's Unicode case tables, written as
     `Array.of_list [1024 elements]`, become array literals. js_of_ocaml emits a list
     literal as nested cons cells, a 1027-deep expression that a Web Worker's parser
     can't take (main threads have the stack for it). As arrays the bundle's deepest
     nesting is 42. Same data; a candidate upstream patch.
3. **dune** builds `haxe.bc`, 41 MB of bytecode.
4. **js_of_ocaml** compiles it to `web/haxe.js` with `stubs.js` linked in and the
   JS-relevant standard library embedded in the pseudo filesystem at `/haxe/std`
   (the root classes plus `haxe/`, `js/`, `sys/` and `eval/`: 6.6 MB of `.hx`, so the
   bundle is 7.8 MB). `--embed SRC:DEST` adds more; `--hotreload DIR` embeds hotreload-hx
   at `/lib/hotreload` for the page's parity test.

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

## The page's contract with the bundle

- sources go in before the runtime starts: `globalThis.jsoo_fs_tmp = [{name, content}]`
- arguments and environment come from a node-like object:
  `globalThis.process = {argv: ["node", "haxe", ...args], env: {HAXE_STD_PATH: "/haxe/std"}, cwd: () => "/static", exit: code => {...}}`.
  No `versions` field, so the runtime stays in browser mode (pseudo filesystem,
  cwd `/static`).
- stdout and stderr arrive on `console.log` and `console.error`; the worker captures them.

## Setup

An opam switch with OCaml 4.14 and Haxe's dependencies. opam itself can be a single
binary in `~/.local/bin` (no root needed); the system packages are `libpcre2-dev`,
`zlib1g-dev`, `cmake` and a C compiler.

    opam init --bare -n --disable-sandboxing
    opam switch create wasm ocaml-base-compiler.4.14.2
    eval $(opam env --switch=wasm --set-switch)
    opam install camlp5.8.03.04 ocamlfind.1.9.1 dune sedlex xml-light extlib ptmap sha camlp-streams conf-libpcre2-8 conf-zlib luv.0.5.13
    opam install js_of_ocaml-compiler js_of_ocaml
    # for the wasm route later: binaryen (>= 119) and
    opam install --assume-depexts wasm_of_ocaml-compiler

Haxe 4.3's `dune < 3.16` constraint didn't matter; dune 3.24 builds it.

Pitfall: if `~/.bun` (not `~/.bun/bin`) is on your PATH, it holds a directory named
`install`, and opam builds fail at `make install` with "install: Permission denied".
Run opam with a PATH that doesn't include it.

## Next

- Load the bundle once and keep the worker warm; the runtime isn't built to compile
  twice in one process, so this means a compilation-server-like restart inside it, or
  accepting ~0.4s of startup per compile.
- Fetch standard library files on demand instead of embedding 6.6 MB.
- A stand-in for hotreload-hx's DevServer in the page (serve the bundle, say when a new
  one exists), which is all the JS reload path needs; then the editor.
- wasm_of_ocaml with wat shims, if speed matters.
