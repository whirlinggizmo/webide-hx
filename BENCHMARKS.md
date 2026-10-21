# Benchmarks

Sizes and times for webide-hx: what a visit downloads, how long the compiler takes to start
and build, the wasm compiler against `haxe.js` against native Haxe. All on the development
machine (Intel i9-13900HX, Linux), Brave 155, Firefox 158, node 24.19, Haxe 4.3.7.

## Downloads

Measured 2026-10-21. A visit downloads one compiler, not both. nginx gzips both
(`hosting/nginx.conf.template`); `std.json.gz` is gzipped already.

| file | size | gzipped |
|---|---|---|
| `haxe-wasm.assets/*.wasm` (the wasm compiler) | 5.12 MB | 1.34 MB |
| `haxe-wasm.js`, `haxe-wasm.files.json`, `hxfs.js` (its loader, embedded files, filesystem) | 0.19 MB | 0.04 MB |
| `haxe.js` (the JS compiler) | 3.76 MB | 1.10 MB |
| `std.json.gz` (the standard library, 1297 files) | | 0.51 MB |
| `vendor/codemirror.js` (the editor) | 0.41 MB | 0.13 MB |
| `vendor/fs.js` (ZenFS, fflate) | 0.33 MB | 0.10 MB |
| `index.html` (the IDE) | 0.29 MB | 0.08 MB |

With wasm, a first visit is about 2.2 MB over the wire; with `haxe.js`, about 1.9 MB.
`haxe.js` built with `--embed-std` (the library inside, no `std/` needed) is 7.8 MB.

## Builds in the page

Measured 2026-10-21 with `tests/page.py BROWSER --compiler wasm|js`: the example project
(hotreload-hx's hello, with its build macro), the compiler in a Web Worker. "Start" is the
compiler's own start before its first build; the first build reads the standard library
and types everything; reload builds are the test's five edits, each a hot reload's build
on the resident compiler.

| | start | first build | reload builds |
|---|---|---|---|
| Brave, wasm | 64-71 ms | 0.56-0.62 s | 32-37 ms |
| Brave, haxe.js | 96-101 ms | 1.65-1.76 s | 73-83 ms |
| Firefox, wasm | 129-161 ms | 4.06-4.24 s | 166-378 ms |
| Firefox, haxe.js | 229-245 ms | 2.07-2.17 s | 113-165 ms |

Three runs each. In Brave the wasm compiler is about three times as fast as `haxe.js`;
in Firefox, about half as fast. So the page uses it only in Chromium (Chrome, Edge,
Brave); Safari is unmeasured.

## Cold compiles in node

Measured 2026-10-21: one compile from a cold start (no compilation server), the median of
five, `Main.hx` a one-line class. Output is byte for byte the same from all three.

| | hello | with `--macro include('js.html')` |
|---|---|---|
| native Haxe | 0.04 s | 0.33 s |
| wasm compiler | 0.22 s | 0.64 s |
| `haxe.js` | 0.51 s | 1.97 s |

## Earlier measurements

Each with `haxe.js`, before the wasm compiler; kept for the decisions they made.

- **A compile per Worker, standard library fetched file by file** (2026-10-18), before the
  resident compiler:

  | build | Brave | Firefox | native Haxe | std files fetched |
  |---|---|---|---|---|
  | hello world (one class) | 0.64 s | 0.66 s (1.07 s cold) | 0.05 s | 72 |
  | parity program + hotreload build macro | 1.82 s | 1.89 s | 0.20 s | 152 |

  The library embedded in the bundle instead (`--embed-std`): 0.1-0.3 s faster, a 7.8 MB
  bundle instead of 3.8 MB.
- **Where a cold hot-reload build of hello goes** (2026-10-18, node, 2.4 s): startup 0.1 s,
  macros 0.84 s, parsing 0.75 s (696 files), typing 0.53 s, the rest 0.26 s. Almost all of
  it redoes unchanged modules, which the resident compiler keeps.
- **The resident compiler** (2026-10-18): reload builds 69-82 ms in Brave, 93-116 ms in
  Firefox, from about 2.5-3 s with a compile per build.
- **The standard library in one download** (2026-10-19): the first build on
  dev.whirlinggizmo.com went from about 23 s (a request per file) to about 3 s.
- **Memory over a long session** (2026-10-19, `node --expose-gc tests/memory.js`): 600 edits,
  each an errors-as-you-type check, a reload build and a hover, took the heap from 271 to
  281 MB (about 17 KB an edit), at a steady ~200 ms a cycle. The runtime starts large:
  about 270 MB of heap, a 780 MB process.
- **Display requests** (2026-10-19): completion, hover and go to definition, 10-40 ms each.
- **A folder from disk** (2026-10-19): with 300 extra files under `out/`, opened and built in
  0.33 s in Brave, 0.65 s in Firefox; reading it again before a folder-wide move or delete,
  about 0.3 s.

## Measuring again

    python3 tests/page.py brave --compiler wasm      # prints the compiler, its first build, the reloads
    python3 tests/page.py firefox --compiler js
    node --expose-gc tests/memory.js

Sizes: `web/` after `python3 build.py --wasm --hotreload ../hotreload-hx`.
