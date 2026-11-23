/* Only the public player document belongs in this cache. Never cache account or take data. */
"use strict";
const BUILD = "8ae21919bb9bf1b4d87c6ee99d57495cd95cfd99c802a6017beaf47d4404562f", SHA = "26e403274e403f9dd4682c8045ebeeb2db42f44c2f9338b9a6943260d2e07685", BYTES = 11683444;
const scope = new URL(self.registration.scope);
const shell = new URL("index.html", scope).href;
const prefix = "melete:offline-player:v1:" + encodeURIComponent(scope.pathname) + ":";
const cacheName = prefix + SHA;
let installingCopy;

function restoreCopy() {
  if (!installingCopy) installingCopy = (async () => {
    const response = await fetch(shell, {cache:"no-store", credentials:"same-origin", redirect:"error"});
    if (response.status !== 200 || !/^text\/html\b/i.test(response.headers.get("content-type") || ""))
      throw Error("Expected the public Melete player");
    const bytes = await response.clone().arrayBuffer();
    if (bytes.byteLength !== BYTES) throw Error("Incomplete player download");
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      byte => byte.toString(16).padStart(2,"0")).join("");
    if (hash !== SHA) throw Error("Player revision does not match the offline worker");
    await (await caches.open(cacheName)).put(shell, response);
  })().finally(() => { installingCopy = null; });
  return installingCopy;
}
const saved = () => caches.match(shell, {cacheName});
self.addEventListener("install", event => event.waitUntil(restoreCopy()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  // Default waiting lifecycle: do not replace the running singer's session.
  if (!await saved()) await restoreCopy();
  for (const key of await caches.keys()) if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== "GET" || req.mode !== "navigate" || url.origin !== scope.origin ||
      (url.pathname !== scope.pathname && url.pathname !== new URL(shell).pathname)) return;
  event.respondWith((async () => {
    const hit = await saved();
    if (hit) return hit;
    // Storage eviction is possible even with a registered worker. A newer online
    // release may no longer match this worker, so allow it to load without caching it here.
    try { await restoreCopy(); const copy = await saved(); if (copy) return copy; } catch {}
    return fetch(req);
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type !== "melete:offline-check" || !event.ports[0]) return;
  event.waitUntil((async () => {
    let ready = false;
    try {
      ready = Boolean(await saved());
      if (!ready && event.data.repair) { await restoreCopy(); ready = Boolean(await saved()); }
    } catch {}
    event.ports[0].postMessage({build:BUILD, ready});
  })());
});
