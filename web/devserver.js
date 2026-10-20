// The DevServer's part, without a server: what hotreload-hx's JS client and the app ask of
// the DevServer, answered from what the IDE hands over. Shared by the web runner's service
// worker (sw.js) and the all-in-one extension's runner page (extensions/ide/shim.js), which
// can't have a service worker. For a URL under `scope`:
//   <scope>             the app's page: a log, and the bundle
//   <scope><bundle>     the latest build (any ?v=), stamped with its number as the DevServer does
//                       (built with -D source-map=inline, it carries its source map inside)
//   <scope><file>       a project file, as a static server would serve it: asked of the IDE the
//                       first time the app asks for it, then kept; a 404 if the project has none.
//                       Only what the app asks for leaves the IDE
//   /__hotreload?since=N         held until there's a build newer than N (or 20 s), then
//                                {version, url}: the JS reloader imports url next
//   /__hotreload_assets?since=N  held until a file the app has had changed since N, then {version, urls}
// The IDE's messages (message()): a build, the names of files that changed, a reset.
//
// env: scope() the path the app's URLs are under ("/run/"); ask(path) a file of the IDE's,
// a promise of its text or bytes, null for none, undefined if no answer came; took(version)
// the app fetched a build; bundleUrl() where the reloader is told to import a build (the
// bundle's own URL by default); early(entry) a promise of whether a held poll should be
// answered now, before its time (the service worker's: the page that asked is gone, or a
// newer worker is waiting)
function makeDevServer(env) {
  const HOLD_MS = 20000;
  const state = {
    name: "main.js",       // the bundle's file name, as the app's page loads it
    version: 0,
    js: null,
    assets: new Map(),     // files the app has had: path under the scope -> {body, type}; body is text, or bytes
    assetVersion: 0,
    assetChanges: [],      // {version, urls}
    waiting: [],           // held polls: {ready(), answer(), clientId, until}
  };

  function wake() {
    state.waiting = state.waiting.filter((w) => {
      if (!w.ready()) return true;
      w.answer();
      return false;
    });
  }

  // a message of the IDE's; what it answers
  function message(m) {
    if (m.type === "build") {
      state.name = m.name || state.name;
      state.version = m.version;
      state.js = "globalThis.__hotreload_built = " + m.version + "; " + m.js;
      wake();
    } else if (m.type === "assets") {
      // files that changed (or went): the copies go, and the app hears of those it has had,
      // so it asks again and gets the new ones
      const urls = [];
      for (const path of m.paths) if (state.assets.delete(path)) urls.push(env.scope() + path);
      if (urls.length) {
        state.assetVersion++;
        state.assetChanges.push({ version: state.assetVersion, urls });
        wake();
      }
    } else if (m.type === "cached") {
      return { paths: [...state.assets.keys()].sort() };
    } else if (m.type === "reset") {
      state.version = 0; state.js = null; state.assets.clear();
      state.assetVersion = 0; state.assetChanges = [];
    }
    return { ok: true, version: state.version, assetVersion: state.assetVersion };
  }

  // the app's page: its output follows the end while you're at the end (new lines keep you
  // there); scrolled up to read, it leaves you where you are
  const FOLLOW = "(function () {" +
    "var page = document.scrollingElement, atEnd = true;" +
    "addEventListener('scroll', function () { atEnd = page.scrollTop + page.clientHeight >= page.scrollHeight - 4; });" +
    "new MutationObserver(function () { if (atEnd) page.scrollTop = page.scrollHeight; })" +
    ".observe(document.body, { childList: true, characterData: true, subtree: true });" +
    "})();";
  const STYLE = "body{margin:0;font:13px/1.4 ui-monospace,monospace;background:#fff;color:#111}" +
    "@media (prefers-color-scheme: dark){:root:not([data-theme=light]) body{background:#111;color:#ddd}}:root[data-theme=dark] body{background:#111;color:#ddd}" +
    "pre{margin:8px;white-space:pre-wrap;overflow-wrap:anywhere}";
  const page = () => '<!doctype html><html><head><meta charset="utf-8"><title>webide-hx app</title>' +
    "<style>" + STYLE + "</style></head>" +
    '<body><pre id="log"></pre><script>' + FOLLOW + '</script><script src="' + state.name + '"></script></body></html>';

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

  // a long poll, answered when ready() or after HOLD_MS, or sooner when env.early() says so
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
      for (const entry of [...state.waiting]) {
        if (Date.now() >= entry.until || (env.early && await env.early(entry))) {
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

  // a project file: kept, or asked of the IDE (once at a time)
  const asking = new Map(); // path -> the answer on its way
  async function fileFor(path) {
    if (state.assets.has(path)) return state.assets.get(path);
    if (!asking.has(path)) asking.set(path, (async () => {
      const body = await env.ask(path);
      if (body === null || body === undefined) return null;
      const f = { body, type: typeOf(path) };
      state.assets.set(path, f);
      return f;
    })().finally(() => asking.delete(path)));
    return asking.get(path);
  }

  // a request of the app's (a URL of its own origin): a promise of the response, or null
  // when it isn't one of these (left to the network)
  function handle(url, clientId) {
    const scope = env.scope(), path = url.pathname;
    if (path === "/__hotreload") {
      const n = since(url);
      const answer = () => {
        // a build imported from where its fetch can't be seen (a blob URL): this answer is
        // when the app takes it
        if (env.bundleUrl && env.took && n !== null && state.version > n) env.took(state.version);
        return respond(JSON.stringify({ version: state.version, url: env.bundleUrl ? env.bundleUrl() : scope + state.name, file: "", failed: false }), "application/json");
      };
      return hold(() => n === null || state.version > n, answer, clientId);
    }
    if (path === "/__hotreload_assets") {
      const n = since(url);
      const answer = () => respond(JSON.stringify({
        version: state.assetVersion,
        urls: n === null || n < 0 ? [] : [...new Set(state.assetChanges.filter((c) => c.version > n).flatMap((c) => c.urls))],
      }), "application/json");
      return hold(() => n === null || n < 0 || state.assetVersion > n, answer, clientId);
    }
    if (!path.startsWith(scope)) return null;
    const rest = path.slice(scope.length);
    if (rest === "" || rest === "index.html") return Promise.resolve(respond(page(), "text/html"));
    if (rest === state.name) {
      if (state.js === null) return Promise.resolve(respond("// no build yet", "text/javascript", 404));
      if (env.took) env.took(state.version);
      return Promise.resolve(respond(state.js, "text/javascript"));
    }
    return fileFor(rest).then((f) => f ? respond(f.body, f.type) : respond("not found: " + rest, "text/plain", 404));
  }

  return { state, message, handle, typeOf, FOLLOW, STYLE };
}
