// A resident compiler: the bundle runs once, as Haxe's compilation server (--wait stdio,
// HAXE_RESIDENT=1; a commit on the fork branch build.py uses), and each build is a request to it, so what didn't
// change stays parsed and typed between builds.
//
// The page sends:
//   {type: "build", id, files: {path: text}, args: [...], output}
//       files: those that changed since the last build (all of them the first time);
//       a file sent as null was removed
//   {type: "warm", id, args}    a build whose output is thrown away: the cache for a set
//                               of defines (a reload's) is made before it's needed
// and gets back {id, code, ms, stdout, stderr, output}: code 0 or 1, the compiler's
// messages in stderr, the output file's text.
// While a build runs, the worker also posts {type: "progress", files}: how many library
// files the compiler has read so far in this build (each by synchronous XHR from std/).
var started = false, startMs = 0;

var libraryFiles = 0;
var xhrOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
  if (/\/std\/./.test(url) && !/\/manifest\.json$/.test(url)) postMessage({ type: "progress", files: ++libraryFiles });
  return xhrOpen.apply(this, arguments);
};

// the compiler's filesystem holds bytes, one per char (latin1); the page has text: UTF-8 between
var encoder = new TextEncoder(), decoder = new TextDecoder();
function toBytes(text) {
  var b = encoder.encode(text), out = "";
  for (var i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return out;
}
function fromBytes(bytes) {
  var b = new Uint8Array(bytes.length);
  for (var i = 0; i < bytes.length; i++) b[i] = bytes.charCodeAt(i);
  return decoder.decode(b);
}

// the standard library, all of it in one download (std.json.gz: path -> the file's bytes as
// a latin1 string), so the compiler's reads cost no round trips; null if it can't be had,
// and the compiler fetches files one by one from std/ instead
async function loadStd() {
  try {
    var r = await fetch(new URL("std.json.gz", location.href));
    if (!r.ok) return null;
    var bytes = new Uint8Array(await r.arrayBuffer());
    // gzip's own bytes, unless a server already undid it (Content-Encoding)
    var text = bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function start(files, std) {
  var t0 = performance.now();
  globalThis.jsoo_fs_tmp = Object.keys(files).map(function (k) { return { name: k, content: toBytes(files[k]) }; });
  globalThis.process = {
    argv: ["node", "haxe", "--wait", "stdio"],
    env: { HAXE_STD_PATH: "/haxe/std", HAXE_RESIDENT: "1" },
    cwd: function () { return "/static"; },
    exit: function (c) { throw { hx_exit: c }; },
  };
  globalThis.HX_STD = std
    ? { manifest: Object.keys(std), read: function (path) {
        postMessage({ type: "progress", files: ++libraryFiles });
        return Object.prototype.hasOwnProperty.call(std, path) ? std[path] : null;
      } }
    : { url: new URL("std/", location.href).href };
  try { importScripts("haxe.js"); } catch (e) { if (!(e && e.hx_exit !== undefined)) throw e; }
  if (!globalThis.hx_request) throw new Error("the bundle has no resident compiler (rebuild it with the current patches)");
  started = true;
  startMs = performance.now() - t0;
}

// ---- the wasm compiler (resident-worker.js?wasm): haxe-wasm.js, by wasm_of_ocaml, about
// three times as fast. Its runtime does files through node's fs, so the worker passes for
// node: a process (the arguments, the environment, the working directory) and a require
// that gives hxfs.js's filesystem, in memory, and fetches the .wasm. The compiler exits
// once its request handler is registered, which is when it's ready
var WASM = /[?&]wasm\b/.test(location.search);
function syncText(url) {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.overrideMimeType("text/plain; charset=x-user-defined"); // bytes, as latin1 chars
  xhr.send(null);
  if (xhr.status !== 200) return null;
  return xhr.responseText.replace(/[-]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) & 0xff); });
}
async function startWasm(files, std) {
  var t0 = performance.now();
  importScripts("hxfs.js");
  // what the JS bundle embeds (hotreload-hx, at /lib/hotreload), as bytes already; then the project's
  var embedded = await fetch(new URL("haxe-wasm.files.json", location.href)).then(function (r) { return r.ok ? r.json() : {}; }, function () { return {}; });
  var bytes = Object.assign({}, embedded);
  for (var k in files) bytes[k] = toBytes(files[k]);
  var stdUrl = new URL("std/", location.href).href;
  var read = std
    ? function (path) { return Object.prototype.hasOwnProperty.call(std, path) ? std[path] : null; }
    : function (path) { return syncText(stdUrl + path); };
  var cwd = "/static";
  globalThis.hx_fs = hxfs.create({ files: bytes, cwd: function () { return cwd; }, std: {
    manifest: std ? Object.keys(std) : JSON.parse(syncText(stdUrl + "manifest.json")),
    read: function (path) { postMessage({ type: "progress", files: ++libraryFiles }); return read(path); },
  } });
  var exited;
  var ready = new Promise(function (resolve, reject) {
    exited = resolve;
    self.addEventListener("unhandledrejection", function (e) { reject(e.reason); });
  });
  globalThis.process = {
    versions: { node: "worker" }, platform: "linux",
    argv: ["node", "haxe", "--wait", "stdio"], env: { HAXE_STD_PATH: "/haxe/std", HAXE_RESIDENT: "1" },
    cwd: function () { return cwd; },
    chdir: function (dir) {
      var to = hxfs.normal(dir.charAt(0) === "/" ? dir : cwd + "/" + dir);
      if (!globalThis.hx_fs.statSync(to).isDirectory()) throw Object.assign(new Error("ENOTDIR: not a directory, chdir '" + dir + "'"), { code: "ENOTDIR", errno: -20, syscall: "chdir" });
      cwd = to;
    },
    exit: function (code) { exited(code); },
  };
  var base = new URL("./", location.href).href;
  globalThis.require = function (m) {
    switch (m) {
      case "node:fs": return globalThis.hx_fs;
      case "node:fs/promises": return { readFile: function (f) {
        return fetch(f).then(function (r) { if (!r.ok) throw new Error(f + ": " + r.status); return r.arrayBuffer(); });
      } };
      case "node:path": return { dirname: function (p) { return p.replace(/[^\/]*$/, ""); }, join: function (a, b) { return a + b; } };
      case "node:tty": return { isatty: function () { return false; } };
      case "node:os": return { tmpdir: function () { return "/tmp"; } };
    }
    throw new Error("the wasm compiler asked for " + m + ", which a worker doesn't have");
  };
  globalThis.require.main = { filename: base + "haxe-wasm.js" };
  importScripts("haxe-wasm.js");
  var code = await ready, said = globalThis.hx_fs.takeOutput();
  var why = " (it exited with " + code + (said.stderr || said.stdout ? ": " + (said.stderr || said.stdout).trim() : "") + ")";
  if (!globalThis.hx_request) throw new Error("the wasm compiler has no resident request: rebuild it (python3 build.py --wasm)" + why);
  var request = globalThis.hx_request;
  globalThis.hx_request = function (hxml) {
    try { return request(hxml); } catch (e) { throw new Error(e.message + why); }
  };
  globalThis.hx_read_file = function (name) { return globalThis.hx_fs.read(name); };
  globalThis.hx_write_file = function (name, text) { globalThis.hx_fs.write(name, text); };
  globalThis.hx_remove_file = function (name) { globalThis.hx_fs.remove(name); };
  started = true;
  startMs = performance.now() - t0;
}

function request(args) {
  var t0 = performance.now();
  libraryFiles = 0;
  // one argument per line is valid hxml
  var out = globalThis.hx_request(args.join("\n"));
  var stdout = [], stderr = [], failed = false;
  out.split("\n").forEach(function (line) {
    if (line === "\x02") failed = true;
    else if (line.charAt(0) === "\x01") stdout.push(line.slice(1).split("\x01").join("\n"));
    else if (line !== "") stderr.push(line);
  });
  return { code: failed ? 1 : 0, ms: performance.now() - t0, stdout: fromBytes(stdout.join("\n")), stderr: fromBytes(stderr.join("\n")) };
}

// one message at a time, in order: the first waits for the standard library before the
// compiler starts, and the others wait for it
var queue = Promise.resolve();
onmessage = function (ev) {
  queue = queue.then(function () { return handle(ev.data); });
};
async function handle(msg) {
  var r;
  try {
    if (!started) {
      if (WASM) await startWasm(msg.files || {}, await loadStd());
      else start(msg.files || {}, await loadStd());
    } else {
      for (var name in msg.files || {}) {
        if (msg.files[name] === null) globalThis.hx_remove_file(name);
        else globalThis.hx_write_file(name, toBytes(msg.files[name]));
      }
    }
    r = request(msg.args);
    r.output = null;
    if (msg.type === "build" && r.code === 0 && msg.output) {
      try { r.output = fromBytes(globalThis.hx_read_file(msg.output)); } catch (e) { r.code = 1; r.stderr += "\nno output: " + e.message; }
    }
    if (startMs) { r.startMs = startMs; startMs = 0; }
  } catch (e) {
    r = { code: -1, ms: 0, stdout: "", stderr: "exception: " + (e && e.message ? e.message : String(e)), output: null };
  }
  r.id = msg.id;
  postMessage(r);
}
