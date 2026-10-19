# webide-hx

A Haxe development environment in a browser tab, with nothing to install: an editor, the
Haxe compiler and the running program side by side, with
[hotreload-hx](https://github.com/whirlinggizmo/hotreload-hx) swapping the program's code
on each save while it keeps its state. Projects live in the browser or in a folder on
disk; libraries come the lix or haxelib way; debugging is the browser's DevTools, by
source map. `web/index.html` is the IDE.

Underneath is the Haxe compiler, running in a web page. `web/haxe.js` is Haxe 4.3.7 compiled from
its OCaml bytecode with js_of_ocaml; `stubs.js` stands in for the C libraries it links.
A page hands it source files and arguments in a Web Worker and reads the JavaScript it
produces back out. Macros work: eval, the macro interpreter, is pure OCaml and comes
along, so a build macro like hotreload-hx's runs inside the page too.

Started 2026-10-18 as a probe for a browser playground with hot reload: an editor, the
compiler and the running program all in one page, nothing installed.

## Run it in Docker

    docker run -p 8080:80 ghcr.io/whirlinggizmo/webide-hx
    # open http://localhost:8080/

The image is the built site in nginx, with the haxelib mirror (so `-lib name:version`
works). `-e WEBIDE_PATH=/ide/` serves it under `/ide/` instead of `/`; `-v
webide-hx-cache:/var/cache/nginx/haxelib` keeps downloaded libraries between containers.
`localhost` needs no https; for other machines, put it behind a web server with https
(`hosting/README.md`).

Or from a checkout, without the published image:

    docker compose up -d
    # open http://localhost:8080/

which builds the image from the Dockerfile the first time (OCaml, Haxe and js_of_ocaml
from source: a few minutes on a fast machine, twenty or so on a small one), keeps fetched
libraries in a volume, and restarts with the machine.

## Run it from source

    python3 tools/serve.py
    # open http://127.0.0.1:8765/ (the IDE)

`/checks/` is the compiler's own check page: it compiles a hello world (and runs it),
compiles it again, then compiles the parity program from hotreload-hx's tests with the
hotreload build macro, printing each exit code, time and output size. Without a browser:

    node tests/browserlike.js

runs the same bundle in node as a page would.

For another device on the LAN, serve HTTPS: the IDE's service worker needs a secure
page, and only `localhost` counts as one over plain HTTP.

    python3 tools/serve.py --tls cert.pem key.pem      # or TLS_CERT and TLS_KEY in the environment

That listens on every interface, on port 8443, and prints the LAN address. The
certificate has to name that address and be trusted by the device (a local development
CA, as mkcert makes). `web/haxe.js` and `web/std/` are generated (ignored
by git); `python3 build.py --hotreload ../hotreload-hx` makes
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

The IDE's worker downloads the whole standard library in one file first, `web/std.json.gz`
(0.5 MB, made by build.py: each file's bytes, gzipped), and gives the compiler its files
from memory (`HX_STD = {read, manifest}`). Fetching them one by one, a round trip each, made
the first build over the internet take about 23 s on dev.whirlinggizmo.com; with the one
download it's about 3 s. Without the file, or where it can't be had, the worker falls back
to fetching `std/` file by file, as below (the compiler check page still does).

`/haxe/std/` in the bundle's filesystem is a device of its own (`hx_std_device` in
`stubs.js`). It reads `manifest.json` once, so directory listings and existence checks
need no network, and fetches a file's bytes the first time the compiler opens it with a
synchronous `XMLHttpRequest`, which a Web Worker may use. The browser's HTTP cache makes
the second compile cheaper. The page turns it on by setting
`globalThis.HX_STD = {url: ".../std/"}` before loading the bundle; the node test gives it a
`read` function over `web/std/` instead. Without `HX_STD` the device isn't mounted and the
bundle expects the library embedded (`--embed-std`).

## A resident compiler

The IDE doesn't start the compiler for each build. Its worker
(`web/resident-worker.js`) starts the bundle once as Haxe's compilation server,
`--wait stdio` with `HAXE_RESIDENT=1`, which the branch turns into a registered callback
instead of a blocking loop. Each build is one request (`hx_request(hxml)`), after
`hx_write_file` puts the changed sources in place with a new modification time. What
didn't change stays parsed and typed, so a reload build takes about 0.1 s instead of 2.5.
`node tests/resident.js` drives it the same way.

## The editor

The IDE edits with CodeMirror 6, bundled from `editor/` into `web/vendor/codemirror.js`
by `build.py` (node and npm needed for that step; versions are pinned in
`editor/package-lock.json`). Ctrl-S builds. The compiler's errors and warnings appear on
their lines, and the file tree counts each file's errors. Files under `src/` ending in
`.hx` are the program; anything else is an asset the program can fetch. A build that
takes more than a moment shows a spinner, its time so far and the library files the
compiler has read, with a bar estimated from the last build of the same kind (the
compiler reports no progress of its own; the worker counts its reads from `std/`).

The header's **File** menu has New file, New folder, Rename and Delete. **Edit** has the editor's
commands with their shortcuts (Undo, Redo, Cut, Copy, Paste, Select all, Find, Replace,
Go to line, Toggle comment, Indent, Outdent) and **Preferences**: the theme (the page's,
the editor's and the program's frame), font size, tab width, tabs or spaces, wrapping,
line numbers, folding, the current line, bracket matching and closing, kept per browser.
**View** puts the running program in a window of its own (Program in a window), which
can go on another screen and is remembered where it was; in a picture-in-picture window
that stays on top (Chromium); or in a new tab. The program needs nothing from the editor
but the service worker, so it hot-reloads wherever it is; a window the page opened also
starts over when the project changes, and closing it brings the program back into the
page. The editor's page has to stay open: it's the compiler.
**Project** has Build, and Build file…: which of the project's hxml files the page builds
from (see below)
(also the button, and Ctrl-S), Open folder, Import zip, Export zip and Reset to the example (menus that work by keyboard too:
arrows, Home, End, Escape). Names, and every delete or replacement, are asked in the page's
own dialog; a name that won't do is refused there, with the reason.

Folders are real: the tree nests them (with guides; an empty one has no arrow), a click
selects one and opens or closes it, and Rename and Delete then work on it. A rename can
move a file or a folder anywhere in the project, and so can dragging it onto a folder in
the tree (or onto the tree's empty space, for the top). A `.hx` file whose package changes
gets its `package` line changed, when it named the old one; files that import it are left
for the build to point out. Deleting a folder asks when anything is in it, listing the
files and counting those the page doesn't show; an empty one goes without asking. The project is kept as it's edited: in the browser, or in a
folder on this computer.

The project's files go through [ZenFS](https://github.com/zen-fs/core), a node-like `fs`,
bundled with [fflate](https://github.com/101arrowz/fflate) (zip) from `editor/fs.js` into
`web/vendor/fs.js`:

- In the browser (IndexedDB) by default, seeded from the example; Project > Reset to the
  example goes back to it.
- **Open folder (local)** works on a folder on this computer through the File System
  Access API ("local", as against the project's own folders). It's in the Project menu in
  every browser; where it can't work it's greyed, and its tooltip, or a click, says how
  to have it: Chrome and Edge have it; Brave turns it off unless
  `chrome://flags/#file-system-access-api` is on (`brave://flags` works too); Firefox and
  Safari don't have it. Edits, new files, renames and
  deletes happen in the folder, so another editor sees them. The page remembers the
  folder and opens it again next time, asking first if the browser wants permission.
  **Close folder** goes back to the browser's project.
- **Import zip** replaces the browser's project with a zip's files; **Export zip** saves
  the project.
- Hidden files, `node_modules`, and `out/`, `bin/`, `build/`, `dump/` at the top aren't
  part of the project, nor files over 8 MB. Files that aren't UTF-8 text (images,
  sounds) are kept and served as bytes, and shown read-only.

### The build file

The page builds from one of the project's hxml files: the one picked in Project > Build
file…, or else `build.hxml`, or else the first at the project's top that builds
JavaScript (then kept, so if it breaks later, its error shows rather than another file
being used). With none, it's `src/` and the class `Main`. The example builds from hello's
`web-build.hxml`. The page reads the hxml, including the hxml files it includes:

- its class paths decide which `.hx` files are code, and their packages;
- its `--main` and `--js` say what to build and where (the program is served by the name
  of the `--js` file);
- every other option goes to the compiler as it is, with the page's own added
  (hotreload-hx, `-D hotreload`, `-debug`, the inline source map);
- what the page can't do is refused, with the reason, on that line of the hxml in the
  editor: another target, `--run`, `--next`/`--each`, `--cwd`, and `-lib` for anything
  but hotreload-hx (the page has no haxelib); `--cmd` and the compilation server's options
  are left out.

`serve.py` relays haxelib releases while it listens on this machine only (`--haxelib-relay
on` when it listens on the network, as with `--tls`), keeping them in `build/haxelib-cache`.

Saving an hxml builds, starting the program over when what's built changed.

### Libraries

`-lib` works for libraries the page can download, kept in the browser's storage and shared
by every project in it (each version downloaded once):

- **lix's way**: with `haxe_libraries/<name>.hxml` in the project, its `# @install:` line says
  where the library comes from and the rest is read as hxml (`${HAXE_LIBCACHE}` is the
  page's library cache). A project set up with lix works as it is, and one set up in the page
  works with lix.
- **haxelib's way**: `-lib name:version`, that release, with its `haxelib.json` (class path,
  dependencies, which need versions too) and `extraParams.hxml`. A `-lib` with neither a
  version nor a lix file is refused, asking for one: the page can't ask haxelib for the
  newest.

Where from:

| Source | How |
|---|---|
| `haxelib:/name#1.2.3`, `-lib name:1.2.3` | haxelib-files.haxe.org, if it ever lets pages read it (HaxeFoundation/haxelib#693); else this site's `haxelib/` relay (`serve.py`, or the mirror in `hosting/`); else a zip you download from lib.haxe.org and add with Project > Add library zip… |
| `gh://github.com/owner/repo#commit` | jsDelivr, file by file: works on any hosting |
| `gitlab://gitlab.com/owner/repo#ref` | GitLab's archive |
| `https://…` | a zip, as it is |

The first download of each is hashed; a later one that differs (the cache cleared, say) is
refused rather than used. hotreload-hx is the page's own and needs none of this. Libraries
that need native code or tools at build time won't work in the page.

`?test` uses stores of its own, and a directory in the browser's private file system
(OPFS) for the folder steps.

## What the compiler knows: completion, hover, definition

The IDE asks the compiler about the code as it's edited, with Haxe's display protocol (the
same JSON requests editors make through haxe-language-server), sent to the resident
compiler like a build, with the editor's unsaved text. It shares the build's cache, so
answers take tens of milliseconds:

- **Completion**: after a `.`, as a name is typed, or on Ctrl-Space: fields, types, locals
  and keywords, each with its type, and its documentation beside the list.
- **Hover**: a name's type and documentation.
- **Go to definition**: Alt+J (Option+J on a Mac; browsers keep F12, Ctrl+B and Ctrl+D for themselves), Ctrl/Cmd-click,
  or Edit > Go to definition: the file at the declaration, centred. One in the standard
  library or a library opens read-only, with a bar saying which (its × goes back), and
  hover and go to definition work in it too.
- **Signature help**: typing `(` or `,` in a call shows the function's parameters above the
  cursor, the one being typed highlighted; `)` or Escape closes it.
- **Errors as you type**: a pause in typing (0.8 s) checks the code (a build with
  `--no-output`: nothing written, the program not reloaded) and marks what it finds.

Positions are counted in characters (code points), as the compiler counts them.

## Debugging

The IDE builds with `-debug -D source-map-inline -D source-map-content`: each bundle
carries its source map inside, as a `data:` URL, with the `.hx` text in it. Inline
matters: DevTools loads a separate map over the network itself, past the page's service
worker, so a `.map` only the service worker knows would fail to load. `-D
source-map-inline` is a commit on the fork branch, proposed upstream for Haxe
([#6414](https://github.com/HaxeFoundation/haxe/issues/6414)). The sources show in
DevTools under `file://` as the compiler's paths (`/static/src/Hello.hx`). Open DevTools on the page, find
`Hello.hx` among the sources, and set breakpoints; they keep working across reloads.
`node tests/devtools.js PORT` checks this against a Chromium-based browser started with
`--remote-debugging-port=PORT` on the IDE (`/`).

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
