// Runs web/haxe.js in node the way a page does: no real filesystem, sources and the
// standard library through the bundle's in-memory one. For timing and quick checks.
//     node tests/run.js DIR [haxe args...]
// DIR's files appear under /static (the compiler's cwd); the standard library comes from
// web/std. Prints what the compiler printed, then the time it took.
var fs = require("fs"), path = require("path");
var dir = process.argv[2], args = process.argv.slice(3);
if (!dir) { console.error("usage: node tests/run.js DIR [haxe args...]"); process.exit(2); }
var files = [];
(function walk(d, rel) {
  for (var e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + "/");
    else files.push({ name: "/static/" + rel + e.name, content: fs.readFileSync(path.join(d, e.name), "latin1") });
  }
})(dir, "");
globalThis.jsoo_fs_tmp = files;
var stdDir = path.join(__dirname, "..", "web", "std") + "/";
globalThis.HX_STD = { manifest: JSON.parse(fs.readFileSync(stdDir + "manifest.json", "utf8")),
  read: function (p) { try { return fs.readFileSync(stdDir + p, "latin1"); } catch (e) { return null; } } };
var code = null, write = process.stdout.write.bind(process.stdout);
var fake = { argv: ["node", "haxe"].concat(args), env: { HAXE_STD_PATH: "/haxe/std" }, cwd: function () { return "/static"; },
  exit: function (c) { code = c; throw { hx_exit: c }; } };
var t0 = performance.now();
Object.defineProperty(globalThis, "process", { value: fake, configurable: true, writable: true });
try { require(path.join(__dirname, "..", "web", "haxe.js")); if (code === null) code = 0; }
catch (e) { if (e.hx_exit === undefined) { console.error(e); code = -1; } }
console.error("exit " + code + " in " + Math.round(performance.now() - t0) + " ms, " + globalThis.hx_std_loaded() + " std files read");
