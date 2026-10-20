// The all-in-one extension's runner: the page the app runs in, a sandboxed page of the
// extension's (its own process; no storage, none of the extension's powers, no access to the
// IDE). A sandboxed page can't have a service worker, so what sw.js does for the web runner
// is done here, in the page, before the app runs: devserver.js answers, and the page's own
// loading (fetch, XMLHttpRequest, an image's or a sound's src) is pointed at it for the app's
// relative URLs, so the app asks for plain URLs as it would of any server. A build is a blob
// URL: the first is the page's script, the next ones the reloader imports (it's told
// `blob:...#`, so the `?v=N` it adds is the fragment). It speaks to the IDE as the web runner
// (runner.html) does: ready, builds and files for devserver.js ("sw"), which app to show
// ("start"), the theme, the app's log; and the test's fetch, follow and spin.
const ide = window.opener || (window.parent !== window ? window.parent : null);
// as in runner.html: a floating window's runner hears the IDE, which opened that window
const fromIde = (w) => !!w && (w === ide || (window.parent !== window && w === window.parent.opener));
const base = new URL(location.href);
const say = (m) => { if (ide) ide.postMessage(m, "*"); };
let started = false, blob = null, blobVersion = -1, theme = null, asks = 0;
const asked = new Map(); // a file asked of the IDE -> its answer
function bundleUrl() {
  if (blobVersion !== server.state.version) {
    if (blob) URL.revokeObjectURL(blob);
    blob = server.state.js === null ? null : URL.createObjectURL(new Blob([server.state.js], { type: "text/javascript" }));
    blobVersion = server.state.version;
  }
  return blob;
}
const server = makeDevServer({
  scope: () => "/",
  ask: (path) => new Promise((resolve) => {
    const id = ++asks;
    const t = setTimeout(() => { asked.delete(id); resolve(undefined); }, 10000);
    asked.set(id, (body) => { clearTimeout(t); resolve(body); });
    say({ type: "need", id, path });
  }),
  took: (version) => say({ type: "took", version }),
  bundleUrl: () => (bundleUrl() || "") + "#",
});
document.getElementById("style").textContent = server.STYLE;

// a URL of the app's own (relative, or this page's address); else null (the network's)
function local(url) {
  const u = new URL(url, base);
  return u.protocol === base.protocol && u.host === base.host ? u : null;
}
const serve = (u) => server.handle(u) || Promise.resolve(new Response("not found", { status: 404 }));
// fetch
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const u = local(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  return u ? serve(u) : realFetch(input, init);
};
// XMLHttpRequest: a local one answered by devserver.js; another, by the real one
const RealXHR = window.XMLHttpRequest;
class ShimXHR extends EventTarget {
  constructor() {
    super();
    Object.assign(this, { readyState: 0, status: 0, statusText: "", responseType: "", response: null, responseText: "", responseURL: "", timeout: 0, withCredentials: false, upload: new EventTarget() });
    for (const t of ["load", "error", "abort", "readystatechange", "loadend", "loadstart", "progress", "timeout"]) this["on" + t] = null;
    this._headers = {};
  }
  open(method, url) { this._u = local(url); this.responseURL = String(url); if (!this._u) { this._real = new RealXHR(); this._real.open(...arguments); } this._state(1); }
  setRequestHeader(k, v) { if (this._real) this._real.setRequestHeader(k, v); }
  overrideMimeType(t) { if (this._real) this._real.overrideMimeType(t); }
  getResponseHeader(k) { return this._real ? this._real.getResponseHeader(k) : (this._headers[k.toLowerCase()] ?? null); }
  getAllResponseHeaders() { return this._real ? this._real.getAllResponseHeaders() : Object.entries(this._headers).map(([k, v]) => k + ": " + v).join("\r\n"); }
  abort() { if (this._real) this._real.abort(); else this._aborted = true; }
  _state(n) { this.readyState = n; this._fire("readystatechange", Event); }
  _fire(type, E = ProgressEvent) { const e = new E(type); if (this["on" + type]) this["on" + type](e); this.dispatchEvent(e); }
  send(body) {
    if (this._real) {
      const r = this._real;
      r.responseType = this.responseType; r.timeout = this.timeout; r.withCredentials = this.withCredentials;
      const copy = () => { for (const k of ["status", "statusText", "response", "responseURL"]) this[k] = r[k]; if (r.responseType === "" || r.responseType === "text") this.responseText = r.responseText; };
      r.onreadystatechange = () => { copy(); this._state(r.readyState); };
      for (const t of ["load", "error", "abort", "loadend", "progress", "timeout"]) r["on" + t] = () => { copy(); this._fire(t); };
      return r.send(body);
    }
    this._fire("loadstart");
    serve(this._u).then(async (res) => {
      if (this._aborted) { this._fire("abort"); this._fire("loadend"); return; }
      this.status = res.status; this.statusText = res.ok ? "OK" : "Not Found";
      this._headers = { "content-type": res.headers.get("Content-Type") || "" };
      const buf = await res.arrayBuffer(), t = this.responseType;
      if (t === "arraybuffer") this.response = buf;
      else if (t === "blob") this.response = new Blob([buf], { type: this._headers["content-type"] });
      else {
        this.responseText = new TextDecoder().decode(buf);
        this.response = t === "json" ? (() => { try { return JSON.parse(this.responseText); } catch (e) { return null; } })() : t === "document" ? new DOMParser().parseFromString(this.responseText, "text/html") : this.responseText;
      }
      this._state(2); this._state(3); this._state(4);
      this._fire("load"); this._fire("loadend");
    }, () => { this._state(4); this._fire("error"); this._fire("loadend"); });
  }
}
for (const k of ["UNSENT", "OPENED", "HEADERS_RECEIVED", "LOADING", "DONE"]) ShimXHR[k] = RealXHR[k];
window.XMLHttpRequest = ShimXHR;
// an image's, a sound's or a video's src (property or attribute): a local one becomes a blob
// URL of the file; reading src gives back what was set
function srcOf(el, set) {
  return (v) => {
    const u = /^(blob|data):/.test(String(v)) ? null : local(v);
    if (!u) return set.call(el, v);
    el._shimSrc = String(v);
    serve(u).then((r) => r.ok ? r.blob() : null).then((b) => set.call(el, b ? URL.createObjectURL(b) : "data:,"));
  };
}
for (const proto of [HTMLImageElement.prototype, HTMLMediaElement.prototype, HTMLSourceElement.prototype]) {
  const d = Object.getOwnPropertyDescriptor(proto, "src");
  Object.defineProperty(proto, "src", { configurable: true, enumerable: d.enumerable,
    get() { return this._shimSrc !== undefined ? this._shimSrc : d.get.call(this); },
    set(v) { srcOf(this, d.set)(v); } });
}
const realSetAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) {
  if (String(name).toLowerCase() === "src" && (this instanceof HTMLImageElement || this instanceof HTMLMediaElement || this instanceof HTMLSourceElement)) { this.src = value; return; }
  return realSetAttribute.call(this, name, value);
};
// a worker from a file of the app's: its text fetched, the worker made from a blob
const RealWorker = window.Worker;
window.Worker = function (url, opts) {
  const u = local(url);
  if (!u) return new RealWorker(url, opts);
  // a worker that's there at once, its script arriving after: messages wait for it
  const queue = [], target = new EventTarget();
  let real = null;
  const w = Object.assign(target, {
    onmessage: null, onerror: null,
    postMessage(m, t) { if (real) real.postMessage(m, t); else queue.push([m, t]); },
    terminate() { if (real) real.terminate(); this._dead = true; },
  });
  serve(u).then((r) => r.text()).then((text) => {
    if (w._dead) return;
    real = new RealWorker(URL.createObjectURL(new Blob([text], { type: "text/javascript" })), opts);
    real.onmessage = (e) => { if (w.onmessage) w.onmessage(e); w.dispatchEvent(new MessageEvent("message", { data: e.data })); };
    real.onerror = (e) => { if (w.onerror) w.onerror(e); };
    for (const [m, t] of queue) real.postMessage(m, t);
  });
  return w;
};

// the app's output, for the IDE; and how it follows the end (devserver.js's page does this
// for the web runner)
const log = document.getElementById("log");
let logTimer = null;
new MutationObserver(() => { if (!logTimer) logTimer = setTimeout(() => { logTimer = null; say({ type: "log", text: log.textContent.slice(-65536) }); }, 50); })
  .observe(log, { childList: true, characterData: true, subtree: true });
(new Function(server.FOLLOW))();

function applyTheme() {
  if (!theme || theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  say({ type: "themed", theme: document.documentElement.dataset.theme || "system" });
}
// the IDE's messages
addEventListener("message", async (e) => {
  if (!fromIde(e.source) || !e.data) return;
  const m = e.data;
  if (m.type === "file" && asked.has(m.id)) { asked.get(m.id)(m.body); asked.delete(m.id); }
  else if (m.type === "sw") say({ type: "sw", id: m.id, data: server.message(m.msg) });
  else if (m.type === "theme") { theme = m.theme; applyTheme(); }
  else if (m.type === "start") {
    // the app from its start, once: a fresh start is a fresh page (the IDE loads this page
    // again, and it says it's ready)
    if (started || m.url === "about:blank" || server.state.js === null) return;
    started = true;
    const s = document.createElement("script");
    s.src = bundleUrl();
    say({ type: "took", version: server.state.version });
    document.body.append(s);
    say({ type: "loaded", url: m.url });
  }
  // for the IDE's test
  else if (m.type === "fetch") {
    try { const r = await window.fetch(m.path); say({ type: "fetched", id: m.id, status: r.status, ok: r.ok, contentType: r.headers.get("Content-Type"), body: new Uint8Array(await r.arrayBuffer()) }); }
    catch (err) { say({ type: "fetched", id: m.id, status: 0, ok: false, error: String(err) }); }
  } else if (m.type === "follow") say({ type: "followed", id: m.id, result: await followTest() });
  else if (m.type === "spin") { const end = performance.now() + m.ms; while (performance.now() < end) {} say({ type: "spun", id: m.id }); }
});
async function followTest() {
  const page = document.scrollingElement;
  const atEnd = () => page.scrollTop + page.clientHeight >= page.scrollHeight - 4;
  const more = (n) => { for (let i = 0; i < n; i++) log.append("a test line " + i + "\n"); };
  const settle = () => new Promise((r) => setTimeout(r, 50));
  more(200); await settle();
  const followed = atEnd();
  page.scrollTop = 0; await settle(); more(20); await settle();
  const stayed = page.scrollTop === 0;
  page.scrollTop = page.scrollHeight; await settle(); more(20); await settle();
  return { followed, stayed, atEnd: atEnd() };
}
say({ type: "ready" });
