// runs web/haxe.js in node as a page would: a fake process object, sources in the pseudo filesystem.
//     node tests/browserlike.js
var fs = require("fs");
var src = fs.readFileSync(__dirname + "/../web/src/Hello.hx", "utf8");
globalThis.jsoo_fs_tmp = [{ name: "/static/Hello.hx", content: src }];
var code = null;
var fake = { argv: ["node", "haxe", "-cp", "/static", "--main", "Hello", "--js", "/static/out/hello.js"], env: { HAXE_STD_PATH: "/haxe/std" }, cwd: function () { return "/static"; }, exit: function (c) { code = c; throw { hx_exit: c }; } };
Object.defineProperty(globalThis, "process", { value: fake, configurable: true, writable: true });
var t0 = Date.now();
try { require(__dirname + "/../web/haxe.js"); } catch (e) { if (e.hx_exit === undefined) { console.error("exception:", e && e.stack ? e.stack.split("\n").slice(0, 15).join("\n") : e); } }
console.error("exit", code, "in", Date.now() - t0, "ms");
try { var out = globalThis.hx_read_file("/static/out/hello.js"); console.error("output", out.length, "bytes"); new Function("console", out)({ log: function (s) { console.error("  ran:", s); } }); } catch (e) { console.error("no output:", e.message); }
