// The resident compiler in node, as a page's worker would drive it: start the bundle
// once with --wait stdio and HAXE_RESIDENT=1, then send it builds of web/hello,
// editing Hello.hx in between, and time each.
//     node tests/resident.js
var fs = require("fs"), path = require("path");
var web = path.join(__dirname, "..", "web");
var files = [];
(function walk(d, rel) {
  for (var e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + "/");
    else files.push({ name: "/static/" + rel + e.name, content: fs.readFileSync(path.join(d, e.name), "latin1") });
  }
})(path.join(web, "hello"), "");
globalThis.jsoo_fs_tmp = files;
var stdDir = path.join(web, "std") + "/";
globalThis.HX_STD = { manifest: JSON.parse(fs.readFileSync(stdDir + "manifest.json", "utf8")),
  read: function (p) { try { return fs.readFileSync(stdDir + p, "latin1"); } catch (e) { return null; } } };
var fake = { argv: ["node", "haxe", "--wait", "stdio"], env: { HAXE_STD_PATH: "/haxe/std", HAXE_RESIDENT: "1" },
  cwd: function () { return "/static"; }, exit: function (c) { throw { hx_exit: c }; } };
Object.defineProperty(globalThis, "process", { value: fake, configurable: true, writable: true });
var t0 = performance.now();
try { require(path.join(web, "haxe.js")); } catch (e) { if (e.hx_exit === undefined) throw e; }
console.log("started in " + Math.round(performance.now() - t0) + " ms");

function build(extra) {
  var hxml = ["-cp /lib/hotreload/src", "/lib/hotreload/extraParams.hxml", "-cp /static/src", "--main Main",
              "-D hotreload", "--js /static/out/hello.js"].concat(extra || []).join("\n");
  var t = performance.now();
  var out = globalThis.hx_request(hxml);
  var ms = Math.round(performance.now() - t);
  var failed = out.split("\n").some(function (l) { return l === "\x02"; });
  var js = null;
  try { js = globalThis.hx_read_file("/static/out/hello.js"); } catch (e) {}
  var messages = out.split("\n").filter(function (l) { return l && l[0] !== "\x01" && l !== "\x02"; });
  return { ms: ms, failed: failed, js: js, messages: messages };
}
function report(name, r) {
  console.log(name + ": " + (r.failed ? "FAILED" : "ok") + " in " + r.ms + " ms, " + (r.js ? r.js.length : 0) + " bytes" +
    (r.messages.length ? "\n    " + r.messages.slice(0, 4).join("\n    ") : ""));
}
var hello = fs.readFileSync(path.join(web, "hello", "src", "Hello.hx"), "latin1");
var r1 = build(); report("first build", r1);
var r2 = build(["-D hotreload_reload"]); report("again, nothing changed", r2);
globalThis.hx_write_file("/static/src/Hello.hx", hello.replace("'$greeting, $name! (ticks", "'$greeting again, $name! (ticks"));
var r3 = build(["-D hotreload_reload"]); report("after editing Hello.hx", r3);
console.log("  new code in the output: " + (r3.js && r3.js.indexOf(" again, ") >= 0));
globalThis.hx_write_file("/static/src/Hello.hx", hello.replace("ticks++;", "ticks++ oops;"));
var r4 = build(["-D hotreload_reload"]); report("a broken edit", r4);
globalThis.hx_write_file("/static/src/Hello.hx", hello);
var r5 = build(["-D hotreload_reload"]); report("fixed", r5);
console.log("  output back to the original: " + (r5.js === r1.js.replace(/__hotreload_built = \d+; /, "")));
for (var i = 0; i < 3; i++) {
  globalThis.hx_write_file("/static/src/Hello.hx", hello.replace("ticks % 4", "ticks % " + (5 + i)));
  report("edit " + (i + 1), build(["-D hotreload_reload"]));
}
