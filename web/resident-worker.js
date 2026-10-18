// A resident compiler: the bundle runs once, as Haxe's compilation server (--wait stdio,
// HAXE_RESIDENT=1; see patches/), and each build is a request to it, so what didn't
// change stays parsed and typed between builds.
//
// The page sends:
//   {type: "build", id, files: {path: text}, args: [...], output}
//       files: those that changed since the last build (all of them the first time)
//   {type: "warm", id, args}    a build whose output is thrown away: the cache for a set
//                               of defines (a reload's) is made before it's needed
// and gets back {id, code, ms, stdout, stderr, output}: code 0 or 1, the compiler's
// messages in stderr, the output file's text.
var started = false, startMs = 0;

function start(files) {
  var t0 = performance.now();
  globalThis.jsoo_fs_tmp = Object.keys(files).map(function (k) { return { name: k, content: files[k] }; });
  globalThis.process = {
    argv: ["node", "haxe", "--wait", "stdio"],
    env: { HAXE_STD_PATH: "/haxe/std", HAXE_RESIDENT: "1" },
    cwd: function () { return "/static"; },
    exit: function (c) { throw { hx_exit: c }; },
  };
  globalThis.HX_STD = { url: new URL("std/", location.href).href };
  try { importScripts("haxe.js"); } catch (e) { if (!(e && e.hx_exit !== undefined)) throw e; }
  if (!globalThis.hx_request) throw new Error("the bundle has no resident compiler (rebuild it with the current patches)");
  started = true;
  startMs = performance.now() - t0;
}

function request(args) {
  var t0 = performance.now();
  // one argument per line is valid hxml
  var out = globalThis.hx_request(args.join("\n"));
  var stdout = [], stderr = [], failed = false;
  out.split("\n").forEach(function (line) {
    if (line === "\x02") failed = true;
    else if (line.charAt(0) === "\x01") stdout.push(line.slice(1).split("\x01").join("\n"));
    else if (line !== "") stderr.push(line);
  });
  return { code: failed ? 1 : 0, ms: performance.now() - t0, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

onmessage = function (ev) {
  var msg = ev.data, r;
  try {
    if (!started) {
      start(msg.files || {});
    } else {
      for (var name in msg.files || {}) globalThis.hx_write_file(name, msg.files[name]);
    }
    r = request(msg.args);
    r.output = null;
    if (msg.type === "build" && r.code === 0 && msg.output) {
      try { r.output = globalThis.hx_read_file(msg.output); } catch (e) { r.code = 1; r.stderr += "\nno output: " + e.message; }
    }
    if (startMs) { r.startMs = startMs; startMs = 0; }
  } catch (e) {
    r = { code: -1, ms: 0, stdout: "", stderr: "exception: " + (e && e.message ? e.message : String(e)), output: null };
  }
  r.id = msg.id;
  postMessage(r);
};
