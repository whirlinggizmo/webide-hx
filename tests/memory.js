// The resident compiler's memory over a long session, in node: started as the page's worker
// starts it (as tests/resident.js does), then N edits to web/example's Hello.hx, each costing
// what an edit costs the page (an errors-as-you-type check, the reload build, a hover), and
// the heap and the process's size every 50. Flat is good: the server's cache doesn't grow.
//     node --expose-gc tests/memory.js [N]       (N edits, 600 by default)
var fs = require("fs"), path = require("path"), argvN = process.argv[2];
var web = path.join(__dirname, "..", "web");
var files = [];
(function walk(d, rel) {
  for (var e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + "/");
    else files.push({ name: "/static/" + rel + e.name, content: fs.readFileSync(path.join(d, e.name), "latin1") });
  }
})(path.join(web, "example"), "");
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

// a long session: each cycle is what one edit costs the page (an errors-as-you-type check,
// the reload build, a hover), every edit different; memory sampled every 50 cycles
var N = +(argvN || 600);
var base = ["-cp /lib/hotreload/src", "/lib/hotreload/extraParams.hxml", "-cp /static/src", "--main Main", "-D hotreload", "--js /static/out/hello.js"];
var hello = fs.readFileSync(path.join(web, "example", "src", "Hello.hx"), "latin1");
function req(extra) { return globalThis.hx_request(base.concat(extra).join("\n")); }
var mu = () => { if (global.gc) global.gc(); var m = require("process").memoryUsage(); return { heap: Math.round(m.heapUsed / 1048576), rss: Math.round(m.rss / 1048576) }; };
req([]); req(["-D hotreload_reload"]);
console.log("cycle 0", JSON.stringify(mu()));
var t = performance.now();
for (var i = 1; i <= N; i++) {
  var text = hello.replace("ticks % 4", "ticks % " + (2 + (i % 7))).replace("hello: reloaded", "hello: reloaded " + i);
  globalThis.hx_write_file("/static/src/Hello.hx", text);
  req(["-D hotreload_reload", "--no-output"]);
  req(["-D hotreload_reload"]);
  var off = text.indexOf("ticks++;") + 2;
  req(["-D hotreload_reload", "--no-output", "--display", JSON.stringify({ jsonrpc: "2.0", id: i, method: "display/hover", params: { file: "/static/src/Hello.hx", offset: off, contents: text } })]);
  if (i % 50 === 0) console.log("cycle " + i, JSON.stringify(mu()), Math.round((performance.now() - t) / 50) + " ms/cycle"), t = performance.now();
}
