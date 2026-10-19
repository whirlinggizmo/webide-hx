// Checks that the IDE comes back after the browser reloads it: the project (edits typed
// and saved, a new file) is still there, and the page starts when sw.js has changed in
// between (a new service worker takes over from one holding the program's long polls).
// Serve a copy of web/, since this changes its sw.js:
//     cp -r web /tmp/webcopy && python3 tools/serve.py 8790 --root /tmp/webcopy
//     brave --headless=new --remote-debugging-port=9333 --user-data-dir=TMP http://127.0.0.1:8790/
//     node tests/reload.js 9333 /tmp/webcopy
// Prints each step; exits 1 if one fails.
var fs = require("fs");
var port = process.argv[2] || "9333", web = process.argv[3];
var ws, nextId = 1, waiting = new Map();
function send(method, params) {
  return new Promise(function (resolve) { var id = nextId++; waiting.set(id, resolve); ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
}
async function evaluate(expr) {
  var r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result ? r.result.value : undefined;
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
// the page up: its tree shown and its first build running, or null after `ms`
async function started(ms) {
  for (var t = 0; t < ms; t += 250) {
    var s = await evaluate("typeof $ === 'function' && JSON.stringify({ tree: document.querySelectorAll('#tree button').length, status: $('status').textContent })");
    if (s && /^build 1/.test(JSON.parse(s).status)) return JSON.parse(s);
    await sleep(250);
  }
  return null;
}
var failures = 0;
function step(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  " + JSON.stringify(detail) : ""));
}

(async function () {
  var targets = await (await fetch("http://127.0.0.1:" + port + "/json")).json();
  var page = targets.find(function (t) { return t.type === "page" && /^https?:\/\/[^/]+\/(index\.html)?(\?.*)?$/.test(t.url); });
  if (!page) { console.log("no IDE page (/ or /index.html) among the targets"); process.exit(1); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = function (ev) { var m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result || m); waiting.delete(m.id); } };
  await new Promise(function (r) { ws.onopen = r; });
  step("the page starts", await started(30000));
  // typed into the editor (as a person would), then saved; a new file
  await evaluate("(async () => { show('src/Hello.hx'); const at = view.state.doc.toString().indexOf('ticks % 4'); view.dispatch({ changes: { from: at, to: at + 9, insert: 'ticks % 3' } }); await save(); await newFile('src/Kept.hx'); })()");
  await send("Page.reload");
  var s = await started(30000);
  step("after a reload, the page starts", s, s);
  step("the edit is still there", await evaluate("files['src/Hello.hx'].includes('ticks % 3')"));
  step("and the new file", await evaluate("'src/Kept.hx' in files"));
  // sw.js changes while the program is long-polling the old service worker
  for (var k = 1; k <= 3; k++) {
    fs.appendFileSync(web + "/sw.js", "\n// changed by tests/reload.js " + k + "\n");
    var t0 = Date.now();
    await send("Page.reload");
    var shown = null;
    for (var t = 0; t < 5000 && !shown; t += 100) { shown = await evaluate("document.querySelectorAll('#tree button').length > 0"); if (!shown) await sleep(100); }
    step("sw.js changed, reload " + k + ": the project shows at once", shown);
    s = await started(10000);
    step("sw.js changed, reload " + k + ": the page starts", s, s && { status: s.status, ms: Date.now() - t0 });
  }
  ws.close();
  console.log(failures ? failures + " failed" : "all ok");
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.log("error: " + e.message); process.exit(1); });
