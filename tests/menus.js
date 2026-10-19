// Checks play.html's header menus (File, Project) in a Chromium-based browser, over the
// DevTools protocol: by keyboard (arrows, Home, Escape) and pointer (click, moving across,
// a click elsewhere), items and their dialogs (New file, Rename, Delete; Enter, Escape, a
// name refused), Project > Build, every Edit item on the editor, Preferences (applied
// at once, to every file, kept for the next visit, Defaults), and items turned off when
// they can't apply.
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
  async function key(k, code) { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: code || k, text: k === "Enter" ? "\r" : undefined, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Escape: 27, End: 35, Enter: 13, Home: 36 }[k] }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: code || k }); await sleep(80); }
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
  step("Home: the first item, Build", await ev(focused) === "build-item", await ev(focused));
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
  // an item and its dialog: File > New file…; a name that won't do is refused in the
  // dialog, which stays open; Enter picks OK
  var typeInto = async function (text) { await ev("$('dialog-input').select()"); await send("Input.insertText", { text: text }); await sleep(80); };
  await click(await box("#file-menu"));
  await click(await box("#new"));
  step("File > New file… opens the dialog, the menu closed, on the name after the folder", await ev("$('dialog').open") && await ev(openList) === ""
       && await ev("document.activeElement.id === 'dialog-input' && $('dialog-input').selectionStart === $('dialog-input').value.length"), await ev("$('dialog-input').value"));
  await typeInto("out/x.hx");
  await key("Enter");
  step("a name that won't do: the dialog says why and stays open", await ev("$('dialog').open") && /wouldn't be part/.test(await ev("$('dialog-error').textContent")),
       await ev("$('dialog-error').textContent"));
  await typeInto("src/Menu.hx");
  await key("Enter");
  await sleep(1500);
  step("Enter creates it", await ev("'src/Menu.hx' in files") && !(await ev("$('dialog').open")));
  // Rename: the base name selected; Escape cancels
  await click(await box("#file-menu"));
  await click(await box("#rename"));
  step("File > Rename… selects the name without its extension", await ev("$('dialog-input').value.slice($('dialog-input').selectionStart, $('dialog-input').selectionEnd)") === "Menu",
       await ev("[$('dialog-input').selectionStart, $('dialog-input').selectionEnd]"));
  await key("Escape");
  step("Escape cancels: closed, nothing renamed", !(await ev("$('dialog').open")) && await ev("'src/Menu.hx' in files"));
  // Delete: asks, on Cancel; then deletes on Delete
  await click(await box("#file-menu"));
  await click(await box("#delete"));
  step("File > Delete… asks first, with Cancel focused", await ev("$('dialog').open && $('dialog-title').textContent === 'Delete src/Menu.hx?' && document.activeElement.id === 'dialog-cancel'"),
       await ev("$('dialog-title').textContent"));
  await shot("delete");
  await click(await box("#dialog-ok"));
  await sleep(1500);
  step("and Delete deletes it", !(await ev("'src/Menu.hx' in files")));
  // Project > Build
  await click(await box("#project-menu"));
  step("Project's first item is Build, then a separator", await ev("(() => { const l = $('project-items'); const first = l.querySelector('[role=menuitem]:not([hidden])'); return first.id === 'build-item' && first.nextElementSibling.tagName === 'HR'; })()"));
  await click(await box("#build-item"));
  await sleep(1500);
  step("and builds", /^build \d+/.test(await ev("$('status').textContent")), await ev("$('status').textContent"));
  // ---- Edit: each item on the editor
  await send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(function () {});
  var edit = async function (id) { await click(await box("#edit-menu")); await click(await box("#" + id)); await sleep(150); };
  var doc = "view.state.doc.toString()";
  await ev("show('src/Hello.hx'); view.focus(); view.dispatch({ selection: { anchor: 0 } })");
  var before = await ev(doc);
  await send("Input.insertText", { text: "// typed\n" }); await sleep(100);
  await edit("undo");
  step("Edit > Undo takes back the typing", await ev(doc) === before);
  await edit("redo");
  step("Edit > Redo puts it back", (await ev(doc)).startsWith("// typed\n"));
  await edit("undo");
  await ev("view.dispatch({ selection: { anchor: 0, head: 5 } })"); // "using"
  await edit("cut");
  step("Edit > Cut takes the selection", (await ev(doc)).startsWith(" Lambda;"), (await ev(doc)).slice(0, 12));
  await edit("paste");
  step("Edit > Paste puts it back", await ev(doc) === before, (await ev(doc)).slice(0, 12));
  await edit("select-all");
  step("Edit > Select all", await ev("view.state.selection.main.from === 0 && view.state.selection.main.to === view.state.doc.length"));
  await ev("view.dispatch({ selection: { anchor: 0 } })");
  await edit("comment");
  step("Edit > Toggle comment comments the line", (await ev(doc)).startsWith("//"), (await ev(doc)).slice(0, 12));
  await edit("comment");
  step("and again uncomments it", await ev(doc) === before);
  await edit("indent");
  step("Edit > Indent", (await ev(doc)).startsWith("\tusing"));
  await edit("outdent");
  step("Edit > Outdent", await ev(doc) === before);
  await edit("find");
  step("Edit > Find… opens the search panel, focused", await ev("!!view.dom.querySelector('.cm-search') && document.activeElement.name === 'search'"));
  await ev("view.focus()"); await key("Escape");
  await edit("goto-line");
  step("Edit > Go to line… asks for a line", await ev("!!view.dom.querySelector('.cm-panel input') && document.activeElement.tagName === 'INPUT'"));
  await key("Escape");
  // ---- Preferences: applied at once, kept for the next visit, Defaults
  await edit("preferences");
  step("Edit > Preferences… opens", await ev("$('prefs').open"));
  var setPref = async function (k, v) { await ev("(() => { const el = $('pref-" + k + "'); if (el.type === 'checkbox') el.checked = " + JSON.stringify(v) + "; else el.value = " + JSON.stringify(String(v)) + "; el.dispatchEvent(new Event('change')); })()"); };
  await setPref("fontSize", 18); await setPref("wrap", true); await setPref("lineNumbers", false); await setPref("theme", "dark"); await setPref("indent", "spaces");
  await shot("prefs");
  var applied = "JSON.stringify({ font: getComputedStyle(view.contentDOM).fontSize, wrap: view.contentDOM.classList.contains('cm-lineWrapping'), numbers: !!view.dom.querySelector('.cm-lineNumbers'), theme: document.documentElement.dataset.theme || 'system', frame: $('run').contentDocument.documentElement.dataset.theme || 'system', dark: getComputedStyle(view.dom).backgroundColor})";
  var a1 = JSON.parse(await ev(applied));
  step("they apply at once: font, wrapping, line numbers, theme (the program's frame too)", a1.font === "18px" && a1.wrap && !a1.numbers && a1.theme === "dark" && a1.frame === "dark", a1);
  await ev("$('prefs-done').click()");
  step("Done closes them", !(await ev("$('prefs').open")));
  await ev("show('src/Main.hx')");
  var a2 = JSON.parse(await ev(applied));
  step("and every file has them", a2.font === "18px" && a2.wrap && !a2.numbers, a2);
  await send("Page.reload");
  for (var w = 0; w < 60 && !/^build 1/.test(await ev("typeof $ === 'function' && $('status').textContent") || ""); w++) await sleep(250);
  var a3 = JSON.parse(await ev(applied));
  step("kept for the next visit", a3.font === "18px" && a3.wrap && !a3.numbers && a3.theme === "dark", a3);
  await ev("$('preferences').click()");
  await ev("$('prefs-defaults').click()");
  var a4 = JSON.parse(await ev(applied));
  step("Defaults puts them back", a4.font === "13px" && !a4.wrap && a4.numbers && a4.theme === "system", a4);
  await ev("$('prefs-done').click()");
  await ev("current = null; refreshMenus()");
  step("Rename and Delete are off with no file shown", await ev("$('rename').disabled && $('delete').disabled"));
  console.log(fails ? fails + " failed" : "all ok");
  process.exit(fails ? 1 : 0);
})();
