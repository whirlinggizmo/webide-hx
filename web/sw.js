// The DevServer's part, in a service worker. It controls the frame the program runs in
// (the run/ scope), so every request the program makes comes here:
//   run/            the program's page: a log, and the bundle
//   run/<bundle>    the latest build (any ?v=), stamped with its number as the DevServer does
//   run/<bundle>.map?v=N  build N's source map (a -debug build), which the bundle names
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
  maps: new Map(),       // build number -> its source map (each bundle names its own)
  assets: new Map(),     // path under run/ -> {text, type}
  assetVersion: 0,
  assetChanges: [],      // {version, urls}
  waiting: [],           // held polls: {ready(), answer()}
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
    let js = m.js;
    if (m.map) {
      // the bundle names its own build's map, so a reloaded one never gets a newer map
      state.maps.set(m.version, m.map);
      js = js.replace(/\n\/\/# sourceMappingURL=[^\n]*\s*$/, "") + "\n//# sourceMappingURL=" + state.name + ".map?v=" + m.version + "\n";
    }
    state.js = "globalThis.__hotreload_built = " + m.version + "; " + js;
    wake();
  } else if (m.type === "assets") {
    const urls = [];
    for (const [path, text] of Object.entries(m.files)) {
      state.assets.set(path, { text, type: typeOf(path) });
      urls.push(scopePath() + path);
    }
    if (m.changed) {
      state.assetVersion++;
      state.assetChanges.push({ version: state.assetVersion, urls });
      wake();
    }
  } else if (m.type === "reset") {
    state.version = 0; state.js = null; state.assets.clear(); state.maps.clear();
    state.assetVersion = 0; state.assetChanges = [];
  }
  if (port) port.postMessage({ ok: true, version: state.version, assetVersion: state.assetVersion });
});

function scopePath() { return new URL(self.registration.scope).pathname; } // "/run/"

function typeOf(path) {
  const ext = path.split(".").pop();
  return { js: "text/javascript", json: "application/json", html: "text/html", css: "text/css", txt: "text/plain",
           png: "image/png", svg: "image/svg+xml" }[ext] || "application/octet-stream";
}

function respond(body, type, status) {
  return new Response(body, { status: status || 200, headers: { "Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store" } });
}

function hold(ready, answer) {
  return new Promise((resolve) => {
    if (ready()) { resolve(answer()); return; }
    const entry = { ready, answer: () => resolve(answer()) };
    state.waiting.push(entry);
    setTimeout(() => {
      const i = state.waiting.indexOf(entry);
      if (i >= 0) { state.waiting.splice(i, 1); resolve(answer()); }
    }, HOLD_MS);
  });
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
    e.respondWith(hold(() => n === null || state.version > n, answer));
    return;
  }
  if (path === "/__hotreload_assets") {
    const n = since(url);
    const answer = () => respond(JSON.stringify({
      version: state.assetVersion,
      urls: n === null || n < 0 ? [] : [...new Set(state.assetChanges.filter((c) => c.version > n).flatMap((c) => c.urls))],
    }), "application/json");
    e.respondWith(hold(() => n === null || n < 0 || state.assetVersion > n, answer));
    return;
  }
  if (!path.startsWith(scope)) return;
  const rest = path.slice(scope.length);
  if (rest === "" || rest === "index.html") {
    e.respondWith(respond(
      '<!doctype html><html><head><meta charset="utf-8"><title>running</title>' +
      '<style>body{margin:0;font:13px/1.4 ui-monospace,monospace;background:#fff;color:#111}' +
      '@media (prefers-color-scheme: dark){body{background:#111;color:#ddd}}pre{margin:8px}</style></head>' +
      '<body><pre id="log"></pre><script src="' + state.name + '"></script></body></html>', "text/html"));
    return;
  }
  if (rest === state.name + ".map") {
    const map = state.maps.get(parseInt(url.searchParams.get("v"), 10) || state.version);
    e.respondWith(map ? respond(map, "application/json") : respond("no map", "text/plain", 404));
    return;
  }
  if (rest === state.name) {
    e.respondWith(state.js === null ? respond("// no build yet", "text/javascript", 404) : respond(state.js, "text/javascript"));
    return;
  }
  const asset = state.assets.get(rest);
  e.respondWith(asset ? respond(asset.text, asset.type) : respond("not found: " + rest, "text/plain", 404));
});
