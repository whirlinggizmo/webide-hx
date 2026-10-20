// Runs the IDE's own test (?test) inside the all-in-one extension (build/extension-ide, from
// `python3 build.py --extension`): a headless browser started with it in a throwaway
// profile, the extension's index.html?test opened, its report read over the DevTools
// protocol (there's no server for it to post to), and printed as tests/page.py prints it.
//     node tests/extension.js [BROWSER] [PORT]
// BROWSER: a Chromium-based browser's binary (default /opt/brave.com/brave/brave, not the
// brave-browser wrapper, so the kill reaches it). Exits 1 if a step fails or no report came.
const { spawn } = require("child_process");
const crypto = require("crypto"), fs = require("fs"), os = require("os"), path = require("path");
const browser = process.argv[2] || "/opt/brave.com/brave/brave", port = process.argv[3] || "9341";
const ext = path.resolve(__dirname, "..", "build", "extension-ide");
if (!fs.existsSync(path.join(ext, "manifest.json"))) { console.log("no build/extension-ide: run python3 build.py --extension"); process.exit(1); }
// an unpacked extension's id: from its directory's path
const id = [...crypto.createHash("sha256").update(ext).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "webide-ext-test-"));
  const b = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--window-size=1400,900", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
                            `--load-extension=${ext}`, `--disable-extensions-except=${ext}`, "about:blank"], { stdio: "ignore" });
  let code = 1;
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch (e) { await sleep(250); } }
    await sleep(1500);
    const page = await (await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${id}/index.html?test`, { method: "PUT" })).json();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.onopen = r);
    let n = 0; const waiting = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); } };
    const ev = (x) => new Promise((r) => { const i = ++n; waiting.set(i, (res) => r(res && res.result && res.result.value)); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: x, returnByValue: true } })); });
    let report = null;
    for (let i = 0; i < 720 && !report; i++) {
      const s = await ev("typeof testReport !== 'undefined' && testReport && (testReport.ok !== undefined || testReport.error) ? JSON.stringify(testReport) : null");
      if (s) report = JSON.parse(s); else await sleep(250);
    }
    ws.close();
    if (!report) { console.log("no report (the page didn't finish in 3 minutes)"); return; }
    for (const s of report.steps) console.log((s.ok ? "  ok   " : "  FAIL ") + s.name + (s.detail !== undefined && s.detail !== null ? "  " + JSON.stringify(s.detail).slice(0, 300) : ""));
    if (report.error) console.log("  ERROR " + report.error);
    const ok = report.ok && !report.error;
    console.log((ok ? "  all ok" : "  NOT ok") + ` (${report.ms} ms; reload builds ${JSON.stringify(report.reloadMs)} ms)`);
    code = ok ? 0 : 1;
  } finally {
    b.kill(); await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true });
    process.exit(code);
  }
})();
