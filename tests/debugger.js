// Checks debugging in the IDE with the webide-hx debugger extension (extension/), in a
// Chromium-based browser started with it loaded:
//     brave --headless=new --remote-debugging-port=9333 --user-data-dir=TMP \
//           --load-extension=extension --disable-extensions-except=extension URL/
//     node tests/debugger.js 9333
// Breakpoints from the gutter stop the app (no DevTools): the stop's call stack, variables
// and line in the editor; the IDE going on meanwhile; step over; a breakpoint removed while
// stopped there (no stop after); a hollow dot where a line has no code; a breakpoint that
// moves with an edit stops at its new line after the hot reload; Pause; and detached
// again when nothing needs it. Prints each step; exits 1 if one fails.
var port = process.argv[2] || "9333";
var ws, nextId = 1, waiting = new Map();
function send(method, params) {
  return new Promise(function (resolve) { var id = nextId++; waiting.set(id, resolve); ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
}
async function ev(expr) {
  var r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function until(expr, ms) {
  for (var t = 0; t < ms; t += 100) { var v = await ev(expr); if (v) return v; await sleep(100); }
  return null;
}
var fails = 0;
function step(name, ok, detail) {
  if (!ok) fails++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  " + JSON.stringify(detail) : ""));
}
// the line of Hello.hx that holds `text`, from 1
var lineOf = function (text) { return "(files['src/Hello.hx'].split('\\n').findIndex((l) => l.includes(" + JSON.stringify(text) + ")) + 1)"; };
var toggle = function (lineExpr) { return ev("(async () => { show('src/Hello.hx'); await toggleBreakpoint(view, view.state.doc.line(" + lineExpr + ").from); return breakLines(view.state).size; })()"); };
var stoppedAt = "dbg.paused && dbg.at && $('dbg-state').textContent === 'Stopped at ' + dbg.at && dbg.at";

(async function () {
  var targets = await (await fetch("http://127.0.0.1:" + port + "/json")).json();
  var page = targets.find(function (t) { return t.type === "page" && /^https?:\/\/[^/]+\/(index\.html)?(\?.*)?$/.test(t.url); });
  if (!page) { console.log("no IDE page among the targets"); process.exit(1); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = function (e) { var m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result || m); waiting.delete(m.id); } };
  await new Promise(function (r) { ws.onopen = r; });
  await until("typeof $ === 'function' && /^build 1/.test($('status').textContent)", 30000);
  await sleep(500);

  step("the extension is found: the gutter, the panel, the breakpoint items", await ev("dbg.present && !!document.querySelector('.cm-breakpoints') && !$('debug').hidden && !$('bp-toggle').hidden"));
  step("not attached while nothing needs it", !(await ev("dbg.attached")));

  // a breakpoint on ticks++: the app stops there, with nothing of DevTools'
  var n = await ev(lineOf("ticks++;"));
  await toggle(n);
  var at = await until(stoppedAt, 10000);
  step("a breakpoint from the gutter stops the app (Hello.hx:" + n + ")", at === "src/Hello.hx:" + n, at);
  step("its dot says it's placed", await ev("breakLines(view.state).get(" + n + ") === 'ok'"));
  step("the call stack, its top frame at that line", await ev("$('dbg-stack').children.length >= 1 && /onTick/.test($('dbg-stack').children[0].textContent) && /Hello\\.hx:" + n + "/.test($('dbg-stack').children[0].textContent)"),
       await ev("[...$('dbg-stack').children].map((li) => li.textContent)"));
  step("the line marked in the editor", await ev("(() => { const el = document.querySelector('.cm-paused'); return !!el && view.state.doc.lineAt(view.posAtDOM(el)).number === " + n + "; })()"));
  step("variables: the frame's scopes", await until("$('dbg-vars').children.length > 0 && $('dbg-vars').textContent", 3000), await ev("$('dbg-vars').textContent.slice(0, 80)"));
  var statics = await ev("(async () => { const cl = [...document.querySelectorAll('#dbg-vars li.scope')].find((x) => x.textContent.startsWith('Closure')); if (!cl.classList.contains('expanded')) cl.click(); await new Promise((r) => setTimeout(r, 400)); const h = [...cl.querySelectorAll(':scope > ul > li')].find((li) => li.textContent.startsWith('Hello:')); h.click(); await new Promise((r) => setTimeout(r, 400)); return [...h.querySelectorAll(':scope > ul > li')].map((li) => li.textContent).filter((t) => /^ticks: \\d+$/.test(t)); })()");
  step("a class's statics in the variables (Closure > Hello > ticks)", statics.length === 1, statics);
  var ticks = await ev("(async () => (await dbgSend('Debugger.evaluateOnCallFrame', { callFrameId: dbg.paused.callFrames[0].callFrameId, expression: 'Hello.ticks', returnByValue: true })).result.value)()");
  step("an expression in the stopped frame (Hello.ticks)", typeof ticks === "number", ticks);
  step("the lists have headers", await ev("$('dbg-stack-h').textContent === 'Call stack' && $('dbg-vars-h').textContent === 'Variables' && !$('dbg-body').hidden"));
  var folded = await ev("(() => { $('dbg-collapse').click(); const hid = $('dbg-body').hidden; $('dbg-collapse').click(); return hid && !$('dbg-body').hidden && JSON.parse(localStorage.getItem('webide-hx-debug-layout')).collapsed === false; })()");
  step("the caret folds the lists away, and back", folded);
  var sized = await ev("(() => { dbgLayout.height = 150; dbgLayout.split = 30; dbgApplyLayout(); const b = $('dbg-body').getBoundingClientRect(), s = $('dbg-stack').parentNode.getBoundingClientRect(); const got = { height: Math.round(b.height), share: Math.round(s.width / b.width * 100) }; dbgLayout.height = null; dbgLayout.split = null; dbgApplyLayout(); return got; })()");
  step("their height and widths can be set (the dragged separators)", sized.height === 150 && Math.abs(sized.share - 30) <= 2, sized);
  var t = await ev("(async () => { const t0 = performance.now(); await new Promise((r) => setTimeout(r, 50)); return Math.round(performance.now() - t0); })()");
  step("the IDE goes on while the app is stopped", t < 500, t + " ms for a 50 ms timer");

  // step over: the next line
  await ev("$('dbg-over').click()");
  var next = await until("dbg.paused && dbg.at !== 'src/Hello.hx:" + n + "' && " + stoppedAt, 5000);
  step("Step over: the next line", next === "src/Hello.hx:" + (n + 1), next);

  // removed while stopped, then Continue: no more stops, and detached (nothing needs it)
  await toggle(n);
  var stops = await ev("(() => { window.__stops = 0; const f = (e) => { if (e.data && e.data.webideDebugger === 'event' && e.data.event === 'Debugger.paused') window.__stops++; }; addEventListener('message', f); return 0; })()");
  await ev("$('dbg-continue').click()");
  await sleep(3000);
  step("a breakpoint removed while stopped: no stop after Continue (3 s)", (await ev("window.__stops")) === 0, await ev("window.__stops"));
  step("and detached, with nothing to debug", await until("!dbg.attached && !dbg.paused", 3000));

  // a line with no code of its own (a blank one): a hollow dot, and nothing stops
  var c = await ev("(files['src/Hello.hx'].split('\\n').findIndex((l) => l.trim() === '') + 1)");
  await toggle(c);
  step("a line with no code (a blank one): a hollow dot", await until("breakLines(view.state).get(" + c + ") === 'bad'", 5000), await ev("[...breakLines(view.state)]"));
  await toggle(c);

  // a breakpoint that moves with an edit: after the hot reload it stops at its new line
  await toggle(n);
  await until("dbg.paused", 10000);
  await ev("$('dbg-continue').click()");
  await ev("(async () => { show('src/Hello.hx'); view.dispatch({ changes: { from: 0, insert: '// a line above\\n' } }); await save(); })()");
  var moved = await ev("[...breakLines(view.state)].map(([l]) => l)");
  step("the breakpoint moved with the edit", moved.length === 1 && moved[0] === n + 1, moved);
  var after = await until("dbg.paused && dbg.scripts.size > 1 && " + stoppedAt, 15000);
  step("after the hot reload, it stops at the new line", after === "src/Hello.hx:" + (n + 1), after);
  await toggle(n + 1);
  await ev("$('dbg-continue').click()");
  await until("!dbg.attached", 3000);

  // Pause with no breakpoints: attaches, stops the app wherever it is, Continue lets it go
  await ev("$('dbg-pause').click()");
  step("Pause stops the app", await until("dbg.paused", 10000), await ev("$('status').textContent"));
  await ev("$('dbg-continue').click()");
  step("Continue: it goes on, and the debugger lets go", await until("!dbg.paused && !dbg.attached", 5000));
  await ev("(async () => { view.dispatch({ changes: { from: 0, to: '// a line above\\n'.length, insert: '' } }); await save(); })()");
  ws.close();
  console.log(fails ? fails + " failed" : "all ok");
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log("error: " + e.message); process.exit(1); });
