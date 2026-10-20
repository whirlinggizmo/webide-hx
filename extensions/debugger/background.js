// The extension's worker: drives chrome.debugger for the IDE's page, through bridge.js. It
// attaches to the page's own tab (no other), with the frames of other processes (the app's
// runner) as child sessions; the page enables the debugger on the app's session only, so
// the IDE itself is never stopped. Commands go to a session; every event comes back to the
// page with its session.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "webide-hx" || !port.sender || !port.sender.tab || port.sender.id !== chrome.runtime.id) return;
  const tabId = port.sender.tab.id, tab = { tabId };
  let attached = false;
  const post = (m) => { try { port.postMessage(m); } catch (e) {} };
  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId) return;
    if (method === "Target.attachedToTarget") {
      const child = { tabId, sessionId: params.sessionId };
      chrome.debugger.sendCommand(child, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
      chrome.debugger.sendCommand(child, "Runtime.runIfWaitingForDebugger").catch(() => {});
    }
    post({ event: method, params, sessionId: source.sessionId || null });
  };
  const onDetach = (source, reason) => {
    if (source.tabId !== tabId) return;
    attached = false;
    post({ event: "detached", params: { reason } });
  };
  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener(onDetach);
  port.onMessage.addListener(async (m) => {
    try {
      let result = null;
      if (m.cmd === "attach") {
        if (!attached) { await chrome.debugger.attach(tab, "1.3"); attached = true; }
        result = await chrome.debugger.sendCommand(tab, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      } else if (m.cmd === "detach") {
        if (attached) { attached = false; await chrome.debugger.detach(tab); }
      } else if (m.cmd === "send") {
        if (!m.sessionId) throw new Error("commands go to a session (the app's), not the IDE's page");
        result = await chrome.debugger.sendCommand({ tabId, sessionId: m.sessionId }, m.method, m.params || {});
      } else throw new Error("unknown command " + m.cmd);
      post({ id: m.id, result });
    } catch (e) { post({ id: m.id, error: String(e && e.message || e) }); }
  });
  port.onDisconnect.addListener(() => {
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
    if (attached) chrome.debugger.detach(tab).catch(() => {});
  });
});
