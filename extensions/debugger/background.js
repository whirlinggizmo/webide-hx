// The extension's worker: drives chrome.debugger for the IDE's page, through bridge.js. It
// attaches to the page's own tab, with the frames of other processes (the app's runner) as
// child sessions; and, when the page asks, to the tabs that page opened (the app in a window
// or a tab of its own) whose address is the runner's, and no others. The page enables the
// debugger on the runners only, so the IDE itself is never stopped. Commands go to a session
// of the IDE's tab, or to one of those tabs; every event comes back to the page with its
// session and its tab (none: the IDE's own).
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "webide-hx" || !port.sender || !port.sender.tab || port.sender.id !== chrome.runtime.id) return;
  const tabId = port.sender.tab.id, tab = { tabId };
  let attached = false;
  const others = new Set(); // the runner tabs this page opened, attached
  const post = (m) => { try { port.postMessage(m); } catch (e) {} };
  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId && !others.has(source.tabId)) return;
    if (method === "Target.attachedToTarget") {
      const child = { tabId: source.tabId, sessionId: params.sessionId };
      chrome.debugger.sendCommand(child, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
      chrome.debugger.sendCommand(child, "Runtime.runIfWaitingForDebugger").catch(() => {});
    }
    post({ event: method, params, sessionId: source.sessionId || null, tabId: source.tabId === tabId ? null : source.tabId });
  };
  const onDetach = (source, reason) => {
    if (source.tabId === tabId) { attached = false; post({ event: "detached", params: { reason } }); }
    else if (others.delete(source.tabId)) post({ event: "tabDetached", params: { tabId: source.tabId, reason } });
  };
  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener(onDetach);
  // the tabs this page opened that show the runner (`prefix`, its address), attached
  async function attachTabs(prefix) {
    const found = [];
    for (const t of await chrome.debugger.getTargets()) {
      if (t.type !== "page" || !t.tabId || t.tabId === tabId || !prefix || !t.url.startsWith(prefix)) continue;
      const opened = await chrome.tabs.get(t.tabId).then((x) => x.openerTabId === tabId, () => false);
      if (!opened) continue;
      if (!others.has(t.tabId)) { await chrome.debugger.attach({ tabId: t.tabId }, "1.3"); others.add(t.tabId); }
      found.push({ tabId: t.tabId, url: t.url });
    }
    return found;
  }
  port.onMessage.addListener(async (m) => {
    try {
      let result = null;
      if (m.cmd === "attach") {
        if (!attached) { await chrome.debugger.attach(tab, "1.3"); attached = true; }
        result = await chrome.debugger.sendCommand(tab, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      } else if (m.cmd === "attachTabs") {
        result = await attachTabs(m.prefix);
      } else if (m.cmd === "detach") {
        for (const id of [...others]) { others.delete(id); await chrome.debugger.detach({ tabId: id }).catch(() => {}); }
        if (attached) { attached = false; await chrome.debugger.detach(tab); }
      } else if (m.cmd === "send") {
        if (m.tabId) {
          if (!others.has(m.tabId)) throw new Error("not a runner tab of this page's");
          result = await chrome.debugger.sendCommand(m.sessionId ? { tabId: m.tabId, sessionId: m.sessionId } : { tabId: m.tabId }, m.method, m.params || {});
        } else {
          if (!m.sessionId) throw new Error("commands go to a session (the app's), not the IDE's page");
          result = await chrome.debugger.sendCommand({ tabId, sessionId: m.sessionId }, m.method, m.params || {});
        }
      } else throw new Error("unknown command " + m.cmd);
      post({ id: m.id, result });
    } catch (e) { post({ id: m.id, error: String(e && e.message || e) }); }
  });
  port.onDisconnect.addListener(() => {
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
    for (const id of others) chrome.debugger.detach({ tabId: id }).catch(() => {});
    if (attached) chrome.debugger.detach(tab).catch(() => {});
  });
});
