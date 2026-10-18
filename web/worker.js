// One compile per worker: the js_of_ocaml program runs once when haxe.js loads.
// The page sends {files: {path: text}, args: [...]}; the worker answers with what the
// compiler printed, its exit code, and the output file's text.
onmessage = function (ev) {
  var msg = ev.data;
  var out = [], err = [], code = null, t0 = performance.now();
  // the sources, into the pseudo filesystem before the runtime starts
  globalThis.jsoo_fs_tmp = Object.keys(msg.files).map(function (k) { return { name: k, content: msg.files[k] }; });
  // argv and env, as the runtime reads them from a node-like process object
  globalThis.process = {
    argv: ["node", "haxe"].concat(msg.args),
    env: { HAXE_STD_PATH: "/haxe/std" },
    cwd: function () { return "/static"; },
    exit: function (c) { code = c; throw { hx_exit: c }; },
  };
  console.log = function () { out.push(Array.prototype.join.call(arguments, " ")); };
  console.error = function () { err.push(Array.prototype.join.call(arguments, " ")); };
  var result = null;
  try {
    importScripts("haxe.js");
    if (code === null) code = 0;
  } catch (e) {
    if (!(e && e.hx_exit !== undefined)) { err.push("exception: " + (e && e.message ? e.message : String(e)) + "\n" + (e && e.stack ? String(e.stack).split("\n").slice(0, 12).join("\n") : "")); if (code === null) code = -1; }
  }
  var ms = performance.now() - t0;
  if (msg.output) {
    try { result = globalThis.hx_read_file(msg.output); } catch (e) { err.push("no output: " + (e && e.message ? e.message : String(e))); }
  }
  postMessage({ stdout: out.join("\n"), stderr: err.join("\n"), code: code, ms: ms, output: result });
};
