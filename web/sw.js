// The DevServer's part, in a service worker (the web runner's): devserver.js, answering every
// request of the frame the app runs in (the run/ scope) and the reloader's /__hotreload
// polls. The runner page hands it builds, and the names of files that changed, by
// postMessage, each with a MessageChannel port to answer on; a file the app asks for is
// asked of the IDE through the runner page.
importScripts("devserver.js");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// the runner pages this worker serves (each connected to the IDE that opened it)
async function runnerPages() {
  return (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter((c) => new URL(c.url).pathname.endsWith("/runner.html"));
}

const server = makeDevServer({
  scope: () => new URL(self.registration.scope).pathname, // "/run/"
  // a file, asked of the IDE through a runner page (another, if one doesn't answer)
  async ask(path) {
    for (const page of await runnerPages()) {
      const body = await new Promise((resolve) => {
        const ch = new MessageChannel();
        const t = setTimeout(() => resolve(undefined), 10000);
        ch.port1.onmessage = (ev) => { clearTimeout(t); resolve(ev.data.body); };
        page.postMessage({ type: "need", path }, [ch.port2]);
      });
      if (body !== undefined) return body;
    }
    return undefined;
  },
  // news for the IDE: the app took a build (so the IDE can say it reloaded)
  async took(version) {
    for (const page of await runnerPages()) page.postMessage({ type: "took", version });
  },
  // a held poll goes sooner when the frame that asked is gone (the page reloaded) or a newer
  // service worker is waiting to take over, since this worker can't hand over while it
  // still holds requests
  async early(entry) {
    if (self.registration.waiting || self.registration.installing) return true;
    return !!entry.clientId && !(await self.clients.get(entry.clientId));
  },
});

self.addEventListener("message", (e) => {
  const answer = server.message(e.data);
  if (e.ports[0]) e.ports[0].postMessage(answer);
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const r = server.handle(url, e.clientId);
  if (r) e.respondWith(r);
});
