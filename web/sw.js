// The DevServer's part, in a service worker. It controls the frame the program runs in
// (the run/ scope), so every request the program makes comes here:
//   run/            the program's page: a log, and the bundle
//   run/<bundle>    the latest build (any ?v=), stamped with its number as the DevServer does
//                   (built with -D source-map-inline, it carries its source map inside)
//   run/assets/...  files the page gave it
//   /__hotreload?since=N         held until there's a build newer than N (or 20 s), then
//                                {version, url}: the JS reloader imports url next
//   /__hotreload_assets?since=N  held until assets newer than N changed, then {version, urls}
// The page hands it builds and assets by postMessage, each with a MessageChannel port to
// answer on.

const HOLD_MS = 20000;
const state = {
  name: "main.js",       // the bundle's file name, as the program's page loads it
  version: 0,
  js: null,
  assets: new Map(),     // path under run/ -> {body, type}: body is text, or bytes (a Uint8Array)
  assetVersion: 0,
  assetChanges: [],      // {version, urls}
  waiting: [],           // held polls: {ready(), answer(), clientId, until}
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function wake() {
  state.waiting = state.waiting.filter((w) => {
    if (!w.ready()) return true;
    w.answer();
    return false;
  });
}

self.addEventListener("message", (e) => {
  const m = e.data, port = e.ports[0];
  if (m.type === "build") {
    state.name = m.name || state.name;
    state.version = m.version;
    state.js = "globalThis.__hotreload_built = " + m.version + "; " + m.js;
    wake();
  } else if (m.type === "assets") {
    const urls = [];
    for (const [path, body] of Object.entries(m.files)) {
      if (body === null) state.assets.delete(path);
      else state.assets.set(path, { body, type: typeOf(path) });
      urls.push(scopePath() + path);
    }
    if (m.changed) {
      state.assetVersion++;
      state.assetChanges.push({ version: state.assetVersion, urls });
      wake();
    }
  } else if (m.type === "reset") {
    state.version = 0; state.js = null; state.assets.clear();
    state.assetVersion = 0; state.assetChanges = [];
  }
  if (port) port.postMessage({ ok: true, version: state.version, assetVersion: state.assetVersion });
});

// the program's page: its output follows the end while you're at the end (new lines keep you
// there); scrolled up to read, it leaves you where you are
const FOLLOW = "<script>(function () {" +
  "var page = document.scrollingElement, atEnd = true;" +
  "addEventListener('scroll', function () { atEnd = page.scrollTop + page.clientHeight >= page.scrollHeight - 4; });" +
  "new MutationObserver(function () { if (atEnd) page.scrollTop = page.scrollHeight; })" +
  ".observe(document.body, { childList: true, characterData: true, subtree: true });" +
  "})();</script>";

function scopePath() { return new URL(self.registration.scope).pathname; } // "/run/"

function typeOf(path) {
  const ext = path.split(".").pop();
  return { js: "text/javascript", json: "application/json", html: "text/html", css: "text/css", txt: "text/plain",
           png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
           wav: "audio/wav", ogg: "audio/ogg", mp3: "audio/mpeg", wasm: "application/wasm" }[ext] || "application/octet-stream";
}

function respond(body, type, status) {
  // text is sent as UTF-8; bytes as they are
  const text = typeof body === "string";
  return new Response(body, { status: status || 200, headers: { "Content-Type": type + (text ? "; charset=utf-8" : ""), "Cache-Control": "no-store" } });
}

// a long poll, answered when ready() or after HOLD_MS; sooner when the frame that asked is
// gone (the page reloaded) or a newer service worker is waiting to take over, since this
// worker can't hand over while it still holds requests
function hold(ready, answer, clientId) {
  return new Promise((resolve) => {
    if (ready()) { resolve(answer()); return; }
    const entry = { ready, answer: () => resolve(answer()), clientId, until: Date.now() + HOLD_MS };
    state.waiting.push(entry);
    sweep();
  });
}
let sweeping = null;
function sweep() {
  if (sweeping) return;
  sweeping = setInterval(async () => {
    const replaced = !!self.registration.waiting || !!self.registration.installing;
    for (const entry of [...state.waiting]) {
      const gone = entry.clientId && !(await self.clients.get(entry.clientId));
      if (replaced || gone || Date.now() >= entry.until) {
        const i = state.waiting.indexOf(entry);
        if (i >= 0) { state.waiting.splice(i, 1); entry.answer(); }
      }
    }
    if (state.waiting.length === 0) { clearInterval(sweeping); sweeping = null; }
  }, 250);
}

function since(url) {
  const s = parseInt(url.searchParams.get("since"), 10);
  return isNaN(s) ? null : s;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const scope = scopePath();
  const path = url.pathname;

  if (path === "/__hotreload") {
    const n = since(url);
    const answer = () => respond(JSON.stringify({ version: state.version, url: scope + state.name, file: "", failed: false }), "application/json");
    e.respondWith(hold(() => n === null || state.version > n, answer, e.clientId));
    return;
  }
  if (path === "/__hotreload_assets") {
    const n = since(url);
    const answer = () => respond(JSON.stringify({
      version: state.assetVersion,
      urls: n === null || n < 0 ? [] : [...new Set(state.assetChanges.filter((c) => c.version > n).flatMap((c) => c.urls))],
    }), "application/json");
    e.respondWith(hold(() => n === null || n < 0 || state.assetVersion > n, answer, e.clientId));
    return;
  }
  if (!path.startsWith(scope)) return;
  const rest = path.slice(scope.length);
  if (rest === "" || rest === "index.html") {
    e.respondWith(respond(
      '<!doctype html><html><head><meta charset="utf-8"><title>webide-hx app</title>' +
      '<style>body{margin:0;font:13px/1.4 ui-monospace,monospace;background:#fff;color:#111}' +
      '@media (prefers-color-scheme: dark){:root:not([data-theme=light]) body{background:#111;color:#ddd}}:root[data-theme=dark] body{background:#111;color:#ddd}' +
      'pre{margin:8px;white-space:pre-wrap;overflow-wrap:anywhere}</style></head>' +
      '<body><pre id="log"></pre>' + FOLLOW + '<script src="' + state.name + '"></script></body></html>', "text/html"));
    return;
  }
  if (rest === state.name) {
    e.respondWith(state.js === null ? respond("// no build yet", "text/javascript", 404) : respond(state.js, "text/javascript"));
    return;
  }
  const asset = state.assets.get(rest);
  e.respondWith(asset ? respond(asset.body, asset.type) : respond("not found: " + rest, "text/plain", 404));
});
