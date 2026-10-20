// Checks the app in a floating window (App > Floating window: picture-in-picture, Chromium's),
// in a Chromium-based browser with the IDE open:
//     brave --headless=new --remote-debugging-port=9333 --user-data-dir=TMP URL/
//     node tests/floating.js 9333
// or the all-in-one extension's IDE (--load-extension=build/extension-ide, its
// chrome-extension://<id>/index.html open). The window needs a click, so the test clicks
// through the DevTools protocol (with a user gesture), which the page's own test can't.
// The floating window's runner is a frame of that window, not of the page: it says what it
// says to that window, which hands it on. Checks: the app runs there and the pane's stops; an
// edit hot-reloads it there; back in the page, it runs there again. Exits 1 if a step fails.
var port = process.argv[2] || "9333";
var ws, nextId = 1, waiting = new Map();
function send(method, params) {
  return new Promise(function (resolve) { var id = nextId++; waiting.set(id, resolve); ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
}
async function ev(expr) {
  var r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function until(expr, ms) {
  for (var t = 0; t < ms; t += 200) { var v = await ev(expr); if (v) return v; await sleep(200); }
  return null;
}
var fails = 0;
function step(name, ok, detail) {
  if (!ok) fails++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  " + JSON.stringify(detail) : ""));
}
// the log of the floating window's runner, and of the pane's
var floatLog = "((program.frame && runners.get(program.frame.contentWindow)) || { log: '' }).log";
var paneLog = "(runners.get($('run').contentWindow) || { log: '' }).log";

(async function () {
  var targets = await (await fetch("http://127.0.0.1:" + port + "/json")).json();
  var page = targets.find(function (t) { return t.type === "page" && (/^https?:\/\/[^?#]*\/(index\.html)?(\?.*)?$/.test(t.url) || /^chrome-extension:\/\/[a-p]{32}\/index\.html/.test(t.url)); });
  if (!page) { console.log("no IDE page among the targets"); process.exit(1); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = function (e) { var m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result || m); waiting.delete(m.id); } };
  await new Promise(function (r) { ws.onopen = r; });
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  step("the app runs in the page", await until("typeof lastTicks === 'function' && lastTicks(frameLog(), 'Hello')", 60000));
  if (!(await ev("'documentPictureInPicture' in window"))) { console.log("  (no picture-in-picture in this browser)"); process.exit(1); }

  await ev("$('app-floating').click(); true");
  var runs = await until("program.kind === 'pip' && (() => { const t = lastTicks(" + floatLog + ", 'Hello'); return t && t.ticks >= 8 ? t : null; })()", 20000);
  step("App > Floating window: the app runs there", runs, runs);
  var pane = await ev(paneLog);
  await sleep(1500);
  step("and not in the page meanwhile", (await ev(paneLog)) === pane);

  await ev("(async () => { show('src/Hello.hx'); files['src/Hello.hx'] = files['src/Hello.hx'].replace(\"'$greeting, $name! (ticks\", \"'$greeting again, $name! (ticks\"); await save(); })()");
  var again = await until("lastTicks(" + floatLog + ", 'Hello again')", 20000);
  step("an edit hot-reloads it there", again, again);

  await ev("$('app-embedded').click(); true");
  var back = await until("!program.kind && lastTicks(" + paneLog + ", 'Hello again')", 20000);
  step("App > Embedded: back in the page, running", back, back);
  ws.close();
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log("  ERROR " + (e && e.stack || e)); process.exit(1); });
