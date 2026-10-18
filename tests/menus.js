// Checks play.html's header menus (File, Project) in a Chromium-based browser, over the
// DevTools protocol: by keyboard (arrows, Home, Escape) and pointer (click, moving across,
// a click elsewhere), an item that runs (File > New file…, its prompt answered), and items
// turned off when they can't apply. It adds src/Menu.hx to the browser's project.
//     brave-browser --headless=new --remote-debugging-port=9333 --user-data-dir=TMP URL/play.html
//     node tests/menus.js 9333 [SCREENSHOT_PREFIX]
// Prints each step; exits 1 if one fails.
var fs = require("fs"), port = process.argv[2] || "9333", prefix = process.argv[3];
(async function () {
  var t = (await (await fetch("http://127.0.0.1:" + port + "/json")).json()).find(function (t) { return t.type === "page" && /play/.test(t.url); });
  var ws = new WebSocket(t.webSocketDebuggerUrl), id = 0, wait = new Map();
  ws.onmessage = function (e) { var m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m.result || m); wait.delete(m.id); } };
  await new Promise(function (r) { ws.onopen = r; });
  function send(method, params) { return new Promise(function (r) { var i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); }); }
  async function ev(x) { var r = await send("Runtime.evaluate", { expression: x, returnByValue: true }); return r.result ? r.result.value : undefined; }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function key(k, code) { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: code || k, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Escape: 27, End: 35, Enter: 13, Home: 36 }[k] }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: code || k }); await sleep(80); }
  var fails = 0;
  function step(name, ok, d) { if (!ok) fails++; console.log((ok ? "  ok   " : "  FAIL ") + name + (d !== undefined ? "  " + JSON.stringify(d) : "")); }
  var focused = "document.activeElement.id", openList = "[...document.querySelectorAll('.items')].filter(l => !l.hidden).map(l => l.id).join(',')";
  async function shot(name) { if (!prefix) return; var p = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1280, height: 260, scale: 1 } }); fs.writeFileSync(prefix + name + ".png", Buffer.from(p.data, "base64")); }
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 600, deviceScaleFactor: 1, mobile: false });
  for (var i = 0; i < 60 && !/warm/.test(await ev("$('status').textContent")); i++) await sleep(250);
  await ev("$('file-menu').focus()");
  await key("ArrowDown");
  step("ArrowDown on File opens it on its first item", await ev(openList) === "file-items" && await ev(focused) === "new", [await ev(openList), await ev(focused)]);
  await key("ArrowDown");
  step("ArrowDown moves to Rename", await ev(focused) === "rename");
  await shot("file");
  await key("Escape");
  step("Escape closes it, back on the button", await ev(openList) === "" && await ev(focused) === "file-menu");
  await ev("$('project-menu').focus()");
  await key("ArrowUp");
  step("ArrowUp on Project opens it on its last item", await ev(openList) === "project-items" && await ev(focused) === "reset", await ev(focused));
  await key("Home");
  step("Home: the first item shown (Open folder is hidden without a picker)", await ev(focused) === "import", await ev(focused));
  await shot("project");
  // the pointer: a click opens, moving to File switches, a click elsewhere closes
  var box = async function (sel) { return await ev("(() => { const r = document.querySelector('" + sel + "').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()"); };
  var click = async function (p) { for (var ty of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type: ty, x: p.x, y: p.y, button: "left", clickCount: 1 }); await sleep(80); };
  await key("Escape");
  await click(await box("#project-menu"));
  step("a click opens Project", await ev(openList) === "project-items");
  var f = await box("#file-menu");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: f.x, y: f.y }); await sleep(80);
  step("moving onto File switches to it", await ev(openList) === "file-items", await ev(openList));
  await click(await box("#editor"));
  step("a click elsewhere closes it", await ev(openList) === "");
  // an item: New file, with the prompt answered
  await send("Page.enable");
  ws.addEventListener("message", function (e) { var m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true, promptText: "src/Menu.hx" }); });
  await click(await box("#file-menu"));
  await click(await box("#new"));
  await sleep(1500);
  step("File > New file… makes the file, and the menu is closed", await ev("'src/Menu.hx' in files") && await ev(openList) === "");
  await ev("current = null; refreshMenus()");
  step("Rename and Delete are off with no file shown", await ev("$('rename').disabled && $('delete').disabled"));
  console.log(fails ? fails + " failed" : "all ok");
  process.exit(fails ? 1 : 0);
})();
