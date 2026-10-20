// Checks debugging in DevTools against the running IDE (web/index.html), over the DevTools protocol
// (Chromium-based browsers: Brave, Chrome). For the first bundle and then a reloaded one:
// gets the bundle's source map as DevTools does (inline, or over the network past the
// page's service worker), sets a breakpoint where
// the map puts a line of Hello.hx, waits for it to hit, and checks the pause maps back to
// that line, with the program's state readable there; then, stopped at one, an edit saved:
// built at once, and taken by the app once it goes on. The app runs on another site than the
// IDE (runner.html), so in a frame of its own process: reached, as DevTools reaches it, by
// attaching to that frame's target (each with a session of its own).
//     brave-browser --headless=new --remote-debugging-port=9333 --user-data-dir=TMP URL/
//     node tests/devtools.js 9333
// Prints each step; exits 1 if one fails.
var port = process.argv[2] || "9333";
var LINE_TEXT = "ticks++;";

function vlq(str) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = [], value = 0, shift = 0;
  for (var i = 0; i < str.length; i++) {
    var d = chars.indexOf(str[i]);
    value += (d & 31) << shift;
    if (d & 32) { shift += 5; continue; }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0; shift = 0;
  }
  return out;
}
// every mapping: {gl, gc, src, sl, sc}, lines and columns from 0
function decode(map) {
  var out = [], src = 0, sl = 0, sc = 0;
  map.mappings.split(";").forEach(function (line, gl) {
    var gc = 0;
    line.split(",").forEach(function (seg) {
      if (!seg) return;
      var v = vlq(seg);
      gc += v[0];
      if (v.length >= 4) { src += v[1]; sl += v[2]; sc += v[3]; out.push({ gl: gl, gc: gc, src: src, sl: sl, sc: sc }); }
    });
  });
  return out;
}

var ws, nextId = 1, waiting = new Map(), listeners = [];
function send(method, params, sessionId) {
  return new Promise(function (resolve, reject) {
    var id = nextId++;
    waiting.set(id, { resolve: resolve, reject: reject });
    ws.send(JSON.stringify(Object.assign({ id: id, method: method, params: params || {} }, sessionId ? { sessionId: sessionId } : {})));
  });
}
function on(method, f) { listeners.push({ method: method, f: f }); }
function next(method, test, ms) {
  return new Promise(function (resolve) {
    var done = false;
    var l = { method: method, f: function (p, s) { if (!done && (!test || test(p, s))) { done = true; resolve(p); } } };
    listeners.push(l);
    setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms || 15000);
  });
}
async function evaluate(expr) {
  var r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}

var failures = 0;
function step(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  " + JSON.stringify(detail) : ""));
}

var scripts = new Map(); // scriptId -> {url, sourceMapURL, session}

async function checkBundle(label) {
  // the newest bundle the frame loaded, and its map, fetched where the service worker answers
  var bundle = [...scripts.entries()].filter(function (e) { return /\/run\/hello\.js/.test(e[1].url) && e[1].sourceMapURL; }).pop();
  step(label + ": the bundle names a source map", !!bundle, bundle && bundle[1].sourceMapURL.slice(0, 48));
  if (!bundle) return;
  // the map as DevTools gets it: inline (a data: URL), or loaded over the network the way
  // DevTools loads one (Network.loadNetworkResource), which a page's service worker
  // doesn't answer
  var map;
  var ref = bundle[1].sourceMapURL;
  if (ref.startsWith("data:")) {
    var comma = ref.indexOf(",");
    var body = ref.slice(comma + 1);
    map = JSON.parse(/;base64$/.test(ref.slice(0, comma)) ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body));
  } else {
    var tree = (await send("Page.getFrameTree")).frameTree;
    var frame = (tree.childFrames || []).map(function (c) { return c.frame; }).find(function (f) { return /\/run\//.test(f.url); }) || tree.frame;
    var res = (await send("Network.loadNetworkResource", { frameId: frame.id, url: new URL(ref, bundle[1].url).href,
      options: { disableCache: false, includeCredentials: false } })).resource;
    step(label + ": DevTools can load the map", res.success, { url: ref, status: res.httpStatusCode });
    if (!res.success) return;
    var chunks = [], h = res.stream, eof = false;
    while (!eof) { var c = await send("IO.read", { handle: h }); chunks.push(c.base64Encoded ? Buffer.from(c.data, "base64").toString("utf8") : c.data); eof = c.eof; }
    await send("IO.close", { handle: h });
    map = JSON.parse(chunks.join(""));
  }
  var srcIndex = map.sources.findIndex(function (s) { return /Hello\.hx$/.test(s); });
  step(label + ": the map carries Hello.hx's text", srcIndex >= 0 && map.sourcesContent && !!map.sourcesContent[srcIndex], map.sources[srcIndex]);
  if (srcIndex < 0) return;
  var lines = map.sourcesContent[srcIndex].split("\n");
  var hxLine = lines.findIndex(function (l) { return l.indexOf(LINE_TEXT) >= 0; });
  var mappings = decode(map);
  var target = mappings.find(function (m) { return m.src === srcIndex && m.sl === hxLine; });
  step(label + ": Hello.hx:" + (hxLine + 1) + " (" + LINE_TEXT + ") has generated code", !!target, target && { line: target.gl + 1, column: target.gc });
  if (!target) return;
  var sid = bundle[1].session;
  var bp = await send("Debugger.setBreakpoint", { location: { scriptId: bundle[0], lineNumber: target.gl, columnNumber: target.gc } }, sid);
  var paused = await next("Debugger.paused", function (p, s) { return s === sid; }, 10000);
  step(label + ": the breakpoint hits", !!paused);
  if (paused) {
    var loc = paused.callFrames[0].location;
    var back = mappings.filter(function (m) { return m.gl === loc.lineNumber && m.gc <= loc.columnNumber; }).pop();
    step(label + ": the pause is at Hello.hx:" + (hxLine + 1), back && back.src === srcIndex && back.sl === hxLine,
         back && { source: map.sources[back.src], line: back.sl + 1, fn: paused.callFrames[0].functionName });
    var v = await send("Debugger.evaluateOnCallFrame", { callFrameId: paused.callFrames[0].callFrameId, expression: "Hello.ticks", returnByValue: true }, sid);
    step(label + ": state is readable there (Hello.ticks)", v.result && typeof v.result.value === "number", v.result && v.result.value);
  }
  await send("Debugger.removeBreakpoint", { breakpointId: bp.breakpointId }, sid);
  if (paused) await send("Debugger.resume", {}, sid);
}

(async function () {
  var targets = await (await fetch("http://127.0.0.1:" + port + "/json")).json();
  var page = targets.find(function (t) { return t.type === "page" && /^https?:\/\/[^/]+\/(index\.html)?(\?.*)?$/.test(t.url); });
  if (!page) { console.log("no IDE page (/ or /index.html) among the targets"); process.exit(1); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = function (ev) {
    var m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      var w = waiting.get(m.id); waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result);
    } else if (m.method) {
      listeners.forEach(function (l) { if (l.method === m.method) l.f(m.params, m.sessionId); });
    }
  };
  await new Promise(function (r) { ws.onopen = r; });
  on("Debugger.scriptParsed", function (p, s) { scripts.set(p.scriptId, { url: p.url, sourceMapURL: p.sourceMapURL, session: s }); });
  // frames in other processes (the runner, and the app inside it), as they come
  var autoAttach = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };
  on("Target.attachedToTarget", function (p) {
    var s = p.sessionId;
    send("Runtime.enable", {}, s); send("Debugger.enable", {}, s); send("Target.setAutoAttach", autoAttach, s);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Debugger.enable");
  await send("Target.setAutoAttach", autoAttach);
  // the program running: its first bundle loaded
  for (var i = 0; i < 100 && ![...scripts.values()].some(function (s) { return /\/run\/hello\.js/.test(s.url); }); i++)
    await new Promise(function (r) { setTimeout(r, 200); });
  await checkBundle("first bundle");
  // a reload: an edit, built and swapped in by the page
  var before = scripts.size;
  await evaluate("(async () => { show('src/Hello.hx'); files['src/Hello.hx'] = files['src/Hello.hx'].replace('ticks % 4', 'ticks % 2'); const b = await save(); return b.ok; })()");
  for (var j = 0; j < 100 && ![...scripts.values()].some(function (s) { return /\/run\/hello\.js\?v=2/.test(s.url); }); j++)
    await new Promise(function (r) { setTimeout(r, 200); });
  step("the edit reloaded (bundle 2 loaded)", [...scripts.values()].some(function (s) { return /\/run\/hello\.js\?v=2/.test(s.url); }));
  await checkBundle("reloaded bundle");
  // stopped at a breakpoint of DevTools', the person saves an edit: the IDE builds at once (it
  // doesn't wait on the stopped app, and what it sends meanwhile is dropped), and once the
  // app goes on it takes that build
  var bundle = [...scripts.entries()].filter(function (e) { return /\/run\/hello\.js/.test(e[1].url) && e[1].sourceMapURL; }).pop();
  var sid = bundle[1].session, map = JSON.parse(Buffer.from(bundle[1].sourceMapURL.slice(bundle[1].sourceMapURL.indexOf(",") + 1), "base64").toString("utf8"));
  var hx = map.sources.findIndex(function (x) { return /Hello\.hx$/.test(x); }), lines = map.sourcesContent[hx].split("\n");
  var at = decode(map).find(function (m) { return m.src === hx && m.sl === lines.findIndex(function (l) { return l.indexOf(LINE_TEXT) >= 0; }); });
  var bp = await send("Debugger.setBreakpoint", { location: { scriptId: bundle[0], lineNumber: at.gl, columnNumber: at.gc } }, sid);
  var stopped = await next("Debugger.paused", function (p, s) { return s === sid; }, 10000);
  step("stopped at a breakpoint of DevTools'", !!stopped);
  if (stopped) {
    var t0 = Date.now();
    var built = await evaluate("(async () => { show('src/Hello.hx'); files['src/Hello.hx'] = files['src/Hello.hx'].replace('ticks % 2', 'ticks % 3'); const r = await save(); return { ok: r.ok, version }; })()");
    await new Promise(function (r) { setTimeout(r, 3500); }); // stopped a while, as a person would be
    step("an edit saved while it's stopped: the IDE builds at once", built.ok && Date.now() - t0 < 6000, built);
    var tookBefore = await evaluate("appTook");
    step("the stopped app hasn't taken that build yet", tookBefore < built.version, { took: tookBefore, build: built.version });
    await send("Debugger.removeBreakpoint", { breakpointId: bp.breakpointId }, sid);
    await send("Debugger.resume", {}, sid);
    var took = false;
    for (var w = 0; w < 50 && !took; w++) { took = (await evaluate("appTook")) >= built.version; if (!took) await new Promise(function (r) { setTimeout(r, 100); }); }
    step("once it goes on, it takes the build", took);
  }
  ws.close();
  console.log(failures ? failures + " failed" : "all ok");
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.log("error: " + e.message); process.exit(1); });
