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
      start(msg.files || {}, await loadStd());
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
