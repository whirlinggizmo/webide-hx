// Checks the IDE's header menus (File, Project) in a Chromium-based browser, over the
// DevTools protocol: by keyboard (arrows, Home, Escape) and pointer (click, moving across,
// a click elsewhere), items and their dialogs (New file, Rename, Delete; Enter, Escape, a
// name refused), folders (New folder, renaming one, a file dragged onto one, deleting one
// with files and an empty one), the tree's context menu (right-click, the menu key, Shift+F10), Project > Select hxml…, Project > Libraries… > Add library…, App (Separate window: it hot-reloads there, Restart starts it over there, and it comes back,
// Embedded, when the window closes), Project > Build, every Edit item on the editor, Preferences (applied
// at once, to every file, kept for the next visit, Defaults), and items turned off when
// they can't apply.
//     brave-browser --headless=new --remote-debugging-port=9333 --user-data-dir=TMP URL/
//     node tests/menus.js 9333 [SCREENSHOT_PREFIX]
// Prints each step; exits 1 if one fails.
var fs = require("fs"), port = process.argv[2] || "9333", prefix = process.argv[3];
(async function () {
  var t = (await (await fetch("http://127.0.0.1:" + port + "/json")).json()).find(function (t) { return t.type === "page" && /^https?:\/\/[^/]+\/(index\.html)?(\?.*)?$/.test(t.url); });
  var ws = new WebSocket(t.webSocketDebuggerUrl), id = 0, wait = new Map();
  ws.onmessage = function (e) { var m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m.result || m); wait.delete(m.id); } };
  await new Promise(function (r) { ws.onopen = r; });
  function send(method, params) { return new Promise(function (r) { var i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); }); }
  async function ev(x) { var r = await send("Runtime.evaluate", { expression: x, returnByValue: true }); return r.result ? r.result.value : undefined; }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function key(k, code) { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: code || k, text: k === "Enter" ? "\r" : undefined, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Escape: 27, End: 35, Enter: 13, Home: 36, ContextMenu: 93 }[k] }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: code || k }); await sleep(80); }
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
  step("ArrowDown moves to New folder", await ev(focused) === "new-folder");
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
  step("Project's first items are Build and Select hxml…, then a separator", await ev("(() => { const l = $('project-items'); const first = l.querySelector('[role=menuitem]:not([hidden])'); return first.id === 'build-item' && first.nextElementSibling.id === 'build-file' && first.nextElementSibling.nextElementSibling.tagName === 'HR'; })()"));
  await click(await box("#build-item"));
  await sleep(1500);
  step("and builds", /^build \d+/.test(await ev("$('status').textContent")), await ev("$('status').textContent"));
  // ---- folders: New folder…, a rename that selects the folder's name, a file dragged
  // onto a folder (its package line follows), Delete folder: asked when it has files, not
  // when it's empty
  await click(await box("#file-menu"));
  await click(await box("#new-folder"));
  await typeInto("src/ui");
  await key("Enter");
  await sleep(300);
  step("File > New folder… makes it, selected in the tree", await ev("dirs.has('src/ui') && !!document.querySelector('#tree [data-dir=\"src/ui\"].on')"));
  await click(await box("#file-menu"));
  await click(await box("#rename"));
  step("Rename with a folder selected renames the folder, its name selected", await ev("$('dialog-title').textContent") === "Rename src/ui"
       && await ev("$('dialog-input').value.slice($('dialog-input').selectionStart, $('dialog-input').selectionEnd)") === "ui");
  await key("Escape");
  await ev("newFile('src/Drag.hx')"); await sleep(1500);
  // a drag, as the browser sends it: dragstart on the file's row, dragover and drop on the folder's
  await ev(`(() => { const dt = new DataTransfer();
    const from = document.querySelector('#tree [data-name="src/Drag.hx"]'), to = document.querySelector('#tree [data-dir="src/ui"]');
    from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    to.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    to.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
  await sleep(1500);
  step("dragging a file onto a folder moves it there, its package line too", await ev("'src/ui/Drag.hx' in files && !('src/Drag.hx' in files) && files['src/ui/Drag.hx'].startsWith('package ui;')"),
       await ev("files['src/ui/Drag.hx'] && files['src/ui/Drag.hx'].split('\\n')[0]"));
  await click(await box('#tree [data-dir="src/ui"]'));
  await click(await box("#file-menu"));
  await click(await box("#delete"));
  await sleep(300);
  step("deleting a folder with files asks, and lists them", await ev("$('dialog').open && $('dialog-title').textContent === 'Delete src/ui/?' && $('dialog-list').textContent.includes('src/ui/Drag.hx')"),
       await ev("[$('dialog-title').textContent, $('dialog-text').textContent]"));
  await shot("folder-delete");
  await click(await box("#dialog-ok"));
  await sleep(1500);
  step("and Delete removes it and them", await ev("!dirs.has('src/ui') && !('src/ui/Drag.hx' in files)"));
  await ev("newFolder('src/empty')"); await sleep(200);
  await click(await box("#file-menu"));
  await click(await box("#delete"));
  await sleep(300);
  step("an empty folder is deleted without asking", await ev("!$('dialog').open && !dirs.has('src/empty')"));

  // ---- the tree's context menu: a right-click on a folder, a file or the empty space offers
  // what File does there, without opening or selecting anything; the menu key opens it too
  var rightClick = async function (p) { for (var ty of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type: ty, x: p.x, y: p.y, button: "right", clickCount: 1 }); await sleep(120); };
  var menuAt = "(() => { const m = $('tree-menu'); if (m.hidden) return null; const r = m.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), items: [...m.querySelectorAll('[role=menuitem]')].filter(i => !i.hidden).map(i => i.id) }; })()";
  await click(await box('#tree [data-name="src/Hello.hx"]'));
  var srcRow = await box('#tree [data-dir="src"]');
  await rightClick(srcRow);
  var at = await ev(menuAt);
  step("a right-click on a folder: its menu where the pointer is, the row outlined, nothing else changed", at && Math.abs(at.x - srcRow.x) <= 2 && Math.abs(at.y - srcRow.y) <= 2
       && at.items.join() === "tm-new,tm-new-folder,tm-rename,tm-delete" && await ev("document.querySelector('#tree [data-dir=\"src\"]').classList.contains('context') && current === 'src/Hello.hx' && selectedDir === null"), at);
  await shot("tree-menu");
  await click(await box("#tm-new"));
  step("New file… there starts inside the folder", await ev("$('dialog').open && $('dialog-input').value === 'src/' && $('tree-menu').hidden && !document.querySelector('#tree .context')"), await ev("$('dialog-input').value"));
  await typeInto("src/Ctx.hx");
  await key("Enter");
  await sleep(1500);
  await click(await box('#tree [data-name="src/Hello.hx"]'));
  await rightClick(await box('#tree [data-name="src/Ctx.hx"]'));
  await click(await box("#tm-delete"));
  await sleep(200);
  step("Delete… on a file asks about that file, not the one shown", await ev("$('dialog').open && $('dialog-title').textContent === 'Delete src/Ctx.hx?'"), await ev("$('dialog-title').textContent"));
  await click(await box("#dialog-ok"));
  await sleep(1500);
  step("and deletes it; the file shown stays", await ev("!('src/Ctx.hx' in files) && current === 'src/Hello.hx'"));
  await rightClick(await box('#tree [data-name="src/Main.hx"]'));
  await click(await box("#tm-rename"));
  step("Rename… on a file renames that file, its base name selected", await ev("$('dialog-title').textContent") === "Rename src/Main.hx"
       && await ev("$('dialog-input').value.slice($('dialog-input').selectionStart, $('dialog-input').selectionEnd)") === "Main");
  await key("Escape");
  await rightClick(await box('#tree [data-name="src/Main.hx"]'));
  await click(await box("#tm-new-folder"));
  step("New folder… on a file starts beside it", await ev("$('dialog-input').value") === "src/", await ev("$('dialog-input').value"));
  await key("Escape");
  var empty = await ev("(() => { const r = $('tree').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - 12 }; })()");
  await rightClick(empty);
  at = await ev(menuAt);
  step("on the tree's empty space: New file… and New folder… only", at && at.items.join() === "tm-new,tm-new-folder", at);
  await click(await box("#tm-new"));
  step("starting at the project's top", await ev("$('dialog').open && $('dialog-input').value === ''"), await ev("$('dialog-input').value"));
  await key("Escape");
  // (the browser's own keyboard context menu comes of a raw key-down)
  var rawKey = async function (k, code, mods) { for (var ty of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type: ty, key: k, code: k, windowsVirtualKeyCode: code, modifiers: mods || 0 }); await sleep(120); };
  await ev("document.querySelector('#tree [data-name=\"src/Main.hx\"]').focus()");
  await rawKey("ContextMenu", 93);
  step("the menu key on a row: the menu, on its first item", await ev(menuAt) && await ev(focused) === "tm-new", [await ev(menuAt), await ev(focused)]);
  await key("ArrowDown");
  await key("End");
  step("the arrows and End move through it", await ev(focused) === "tm-delete", await ev(focused));
  await key("Escape");
  step("Escape closes it, back on the row", await ev("$('tree-menu').hidden && document.activeElement.dataset.name === 'src/Main.hx'"));
  await rawKey("F10", 121, 8);
  step("Shift+F10 opens it too, under the row", await ev(focused) === "tm-new" && await ev("(() => { const m = $('tree-menu').getBoundingClientRect(), r = document.querySelector('#tree [data-name=\"src/Main.hx\"]').getBoundingClientRect(); return Math.abs(m.y - r.bottom) <= 2; })()"), await ev(menuAt));
  await key("Escape");
  await rightClick(srcRow);
  await click(await box("#editor"));
  step("a click elsewhere closes it", await ev("$('tree-menu').hidden && !document.querySelector('#tree .context')"));

  // ---- Project > Open folder (local)…: always there; where the browser can't (headless Brave,
  // without its flag), greyed, and saying how to have it
  step("Open folder (local)… is there, greyed, its tooltip saying how to enable it", await ev("!$('folder').hidden && $('folder').getAttribute('aria-disabled') === 'true' && /chrome:\\/\\/flags\\/#file-system-access-api/.test($('folder').title)"),
       await ev("[$('folder').textContent, $('folder').getAttribute('aria-disabled'), $('folder').title]"));
  await click(await box("#project-menu"));
  await click(await box("#folder"));
  await sleep(300);
  step("and clicking it says so too", await ev("$('dialog').open && /chrome:\\/\\/flags/.test($('dialog-text').textContent)"), await ev("$('dialog-text').textContent"));
  await click(await box("#dialog-ok"));
  await sleep(200);

  // ---- Project > Select hxml…: the hxml files, those the page can't use shown and off
  await click(await box("#project-menu"));
  await click(await box("#build-file"));
  var opts = JSON.parse(await ev("JSON.stringify([...$('dialog-select').options].map(o => [o.value, o.disabled]))"));
  step("Select hxml… lists the hxml files, those it can't build from turned off, and No hxml file", await ev("$('dialog-select').value") === "web-build.hxml"
       && opts.some(function (o) { return o[0] === "web.hxml" && o[1]; }) && opts.some(function (o) { return o[0] === "" && !o[1]; })
       && await ev("[...$('dialog-select').options].some(o => o.value === '' && o.textContent === 'No hxml file: src/ for code, Main as the main class')"), opts);
  await ev("$('dialog-select').value = ''");
  await click(await box("#dialog-ok"));
  await sleep(2500);
  step("choosing No hxml file builds src/ with Main", /hxml: none/.test(await ev("$('where').textContent")) && /^build \d+/.test(await ev("$('status').textContent")),
       [await ev("$('where').textContent"), await ev("$('status').textContent")]);
  await click(await box("#project-menu"));
  await click(await box("#build-file"));
  await ev("$('dialog-select').value = 'web-build.hxml'");
  await click(await box("#dialog-ok"));
  await sleep(2500);
  step("and web-build.hxml again", /web-build\.hxml/.test(await ev("$('where').textContent")));

  // ---- Project > Libraries… > Add library…: not a library, refused in the dialog; a release, its lix
  // file written and -lib in the hxml, built with; then back as it was
  var hxml0 = await ev("files['web-build.hxml']");
  await click(await box("#project-menu"));
  await click(await box("#libraries"));
  await sleep(300);
  await click(await box("#libs-add"));
  await typeInto("format");
  await key("Enter");
  step("Add library…: not a library, the dialog says what is and stays open", await ev("$('dialog').open") && /name:version/.test(await ev("$('dialog-error').textContent")),
       await ev("$('dialog-error').textContent"));
  await typeInto("format:3.7.0");
  await click(await box("#dialog-ok"));
  var added = false;
  for (var w3 = 0; w3 < 60 && !added; w3++) { added = /format 3\.7\.0 added/.test(await ev("$('status').textContent")); if (!added) await sleep(250); }
  step("a release: lix's file written, -lib format in web-build.hxml, built", added && await ev("'haxe_libraries/format.hxml' in files && files['web-build.hxml'].split('\\n').includes('-lib format')"),
       await ev("$('status').textContent"));
  var shown = false;
  for (var w4 = 0; w4 < 25 && !shown; w4++) { shown = await ev("$('libs').open && /format 3\\.7\\.0/.test($('libs-cached').textContent)"); if (!shown) await sleep(200); }
  step("and Libraries… shows again, the library in its cached list", shown);
  await ev("$('libs').close()");
  await ev("(async () => { await deleteFolder('haxe_libraries'); await putFile('web-build.hxml', " + JSON.stringify(hxml0) + "); await build(); })()");
  await sleep(1500);
  step("and back as it was", !(await ev("'haxe_libraries/format.hxml' in files")) && await ev("files['web-build.hxml']") === hxml0);

  // ---- App: the program in a window of its own; it hot-reloads there; closing it brings
  // it back into the page
  await click(await box("#app-menu"));
  await click(await box("#app-window"));
  await sleep(2500);
  var popup = null;
  for (var w = 0; w < 20 && !popup; w++) {
    popup = (await (await fetch("http://127.0.0.1:" + port + "/json")).json()).find(function (t) { return t.type === "page" && /\/(app|runner)\.html/.test(t.url); });
    if (!popup) await sleep(250);
  }
  step("App > Separate window opens it, checked, and the page gives the editor its room", popup && await ev("document.body.classList.contains('program-out') && (runners.get($('run').contentWindow) || {}).url === 'about:blank' && $('app-window').getAttribute('aria-checked') === 'true' && $('app-embedded').getAttribute('aria-checked') === 'false'"),
       popup && popup.url);
  if (popup) {
    // on the hosted site, the window is app.html, of the IDE's own site, which frames the
    // runner: no page of the runner's address (its site's name, near the IDE's, has the browser
    // asking whether the IDE's was meant); in the extension, the runner's page itself
    var ideOrigin = await ev("location.origin");
    step("the window's page is of the IDE's own site (the runner a frame of it), or the extension's", popup.url.startsWith(ideOrigin + "/"), popup.url);
    await ev("(async () => { show('src/Hello.hx'); files['src/Hello.hx'] = files['src/Hello.hx'].replace(\"'$greeting, $name! (ticks\", \"'$greeting out there, $name! (ticks\"); await save(); })()");
    var seen = false;
    for (var w2 = 0; w2 < 40 && !seen; w2++) { seen = /out there/.test(await ev("frameLog()") || ""); if (!seen) await sleep(250); }
    step("an edit hot-reloads the program in its window", seen);
    step("the window's place is kept for next time", !!(await ev("localStorage.getItem('webide-hx-program-window')")));
    // the project changing (a folder opened, a zip imported) starts the program over: in its window
    var before = await ev("(runners.get(program.runnerOf(program.win)) || {}).url");
    await ev("startProgram()");
    await sleep(1500);
    var after = await ev("(runners.get(program.runnerOf(program.win)) || {}).url");
    step("starting the program over starts it in its window", /start=/.test(after) && after !== before && await ev("(runners.get($('run').contentWindow) || {}).url === 'about:blank'"), [before, after]);
    // App > Restart: the same, from the menu
    await click(await box("#app-menu"));
    await click(await box("#app-restart"));
    await sleep(1500);
    var restarted = await ev("(runners.get(program.runnerOf(program.win)) || {}).url");
    step("App > Restart starts it over in its window", /start=/.test(restarted) && restarted !== after && await ev("(runners.get($('run').contentWindow) || {}).url === 'about:blank' && program.kind === 'window'"), [after, restarted]);
  }
  await ev("program.win && program.win.close()");
  await sleep(1500);
  step("closing the window brings the app back, Embedded checked", await ev("!document.body.classList.contains('program-out') && /run\\/\\?start=/.test((runners.get($('run').contentWindow) || {}).url) && program.kind === null && $('app-embedded').getAttribute('aria-checked') === 'true'"),
       await ev("(runners.get($('run').contentWindow) || {}).url"));

  // ---- go to definition by Ctrl+Alt+J: the page gets the key (F12 and Ctrl+B are the browser's)
  await ev("show('src/Hello.hx'); view.focus(); view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('ticks++;') + 2 } })");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "j", code: "KeyJ", windowsVirtualKeyCode: 74, modifiers: 3 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "j", code: "KeyJ", windowsVirtualKeyCode: 74, modifiers: 3 });
  await sleep(1500);
  step("Ctrl+Alt+J goes to the definition", await ev("view.state.doc.lineAt(view.state.selection.main.head).number === view.state.doc.lineAt(view.state.doc.toString().indexOf('static var ticks')).number"),
       await ev("view.state.doc.lineAt(view.state.selection.main.head).number"));

  // ---- go to line by Ctrl+Alt+G, the pair of Ctrl+Alt+J
  await ev("view.focus()");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "g", code: "KeyG", windowsVirtualKeyCode: 71, modifiers: 3 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "g", code: "KeyG", windowsVirtualKeyCode: 71, modifiers: 3 });
  await sleep(300);
  step("Ctrl+Alt+G asks for a line", await ev("!!view.dom.querySelector('.cm-panel input')"));
  await key("Escape");

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
  await sleep(1500); // the program back in its frame, loaded
  // ---- Preferences: applied at once, kept for the next visit, Defaults
  await edit("preferences");
  step("Edit > Preferences… opens", await ev("$('prefs').open"));
  var setPref = async function (k, v) { await ev("(() => { const el = $('pref-" + k + "'); if (el.type === 'checkbox') el.checked = " + JSON.stringify(v) + "; else el.value = " + JSON.stringify(String(v)) + "; el.dispatchEvent(new Event('change')); })()"); };
  await setPref("fontSize", 18); await setPref("wrap", true); await setPref("lineNumbers", false); await setPref("theme", "dark"); await setPref("indent", "spaces");
  await shot("prefs");
  var applied = "JSON.stringify({ font: getComputedStyle(view.contentDOM).fontSize, wrap: view.contentDOM.classList.contains('cm-lineWrapping'), numbers: !!view.dom.querySelector('.cm-lineNumbers'), theme: document.documentElement.dataset.theme || 'system', frame: (runners.get(program.target()) || {}).theme || 'system', dark: getComputedStyle(view.dom).backgroundColor})";
  var a1 = JSON.parse(await ev(applied));
  step("they apply at once: font, wrapping, line numbers, theme (the program's frame too)", a1.font === "18px" && a1.wrap && !a1.numbers && a1.theme === "dark" && a1.frame === "dark", a1);
  await ev("$('prefs-done').click()");
  step("Done closes them", !(await ev("$('prefs').open")));
  await ev("show('src/Main.hx')");
  var a2 = JSON.parse(await ev(applied));
  step("and every file has them", a2.font === "18px" && a2.wrap && !a2.numbers, a2);
  // a reload: the old page marked, so its status (which can say "build 1" too) isn't taken for the new one's
  await ev("window.oldPage = true");
  await send("Page.reload");
  for (var w = 0; w < 80 && !/^build 1/.test(await ev("!window.oldPage && typeof $ === 'function' && $('status').textContent") || ""); w++) await sleep(250);
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
