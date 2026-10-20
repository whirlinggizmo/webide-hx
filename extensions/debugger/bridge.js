// On the IDE's page: the bridge between the page and the extension's worker (background.js).
// The page and this script talk by window.postMessage, {webideDebugger: ...}; this script
// and the worker by a port. Only the page's own messages are taken (not a frame's, as the
// app's runner is), and the worker only ever debugs the tab this page is in.
let port = null;
function connect() {
  port = chrome.runtime.connect({ name: "webide-hx" });
  port.onMessage.addListener((m) => window.postMessage(Object.assign({ webideDebugger: m.event ? "event" : "reply" }, m), location.origin));
  // the worker went (the extension reloaded, say): the page hears it's detached
  port.onDisconnect.addListener(() => { port = null; window.postMessage({ webideDebugger: "event", event: "detached", params: { reason: "extension" } }, location.origin); });
}
window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin || !e.data || typeof e.data.webideDebugger !== "string") return;
  const m = e.data;
  if (m.webideDebugger === "hello") window.postMessage({ webideDebugger: "here", version: chrome.runtime.getManifest().version }, location.origin);
  else if (m.webideDebugger === "cmd") {
    if (!port) connect();
    port.postMessage({ id: m.id, cmd: m.cmd, sessionId: m.sessionId, tabId: m.tabId, prefix: m.prefix, method: m.method, params: m.params });
  }
});
// said at once too, for a page that asked before this script was there
window.postMessage({ webideDebugger: "here", version: chrome.runtime.getManifest().version }, location.origin);
