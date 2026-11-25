/* Only the public player document belongs in this cache. Never cache account or take data. */
"use strict";
const BUILD = "22a8144f574c98909f0e85e52e1c364b4115f3e85516f5f2246165d7eb975a4d", SHA = "b8bb88d3a8dec5dfae8e602358499e8be35b57bb933778e86cc9d08a52924576", BYTES = 11691648;
const scope = new URL(self.registration.scope);
const shell = new URL("index.html", scope).href;
const prefix = "melete:offline-player:v1:" + encodeURIComponent(scope.pathname) + ":";
const cacheName = prefix + SHA;
let installingCopy;

async function verifiedDocument(digest, size, signal) {
    const response = await fetch(shell, {cache:"no-store", credentials:"same-origin", redirect:"error", signal});
    if (response.status !== 200 || !/^text\/html\b/i.test(response.headers.get("content-type") || ""))
      throw Error("Expected the public Melete player");
    const bytes = await response.clone().arrayBuffer();
    if (bytes.byteLength !== size) throw Error("Incomplete player download");
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      byte => byte.toString(16).padStart(2,"0")).join("");
    if (hash !== digest) throw Error("Player revision does not match the release");
    return response;
}
function restoreCopy() {
  if (!installingCopy) installingCopy = verifiedDocument(SHA,BYTES)
    .then(async response=>(await caches.open(cacheName)).put(shell,response))
    .finally(() => { installingCopy = null; });
  return installingCopy;
}
const saved = () => caches.match(shell, {cacheName});
// Check on a real navigation, never by polling or navigating an existing tab.
// Keep a verified response in hand: offline or slow updates cannot strand a rehearsal.
async function freshCopy() {
  const ctl=new AbortController();
  let timer=setTimeout(()=>ctl.abort(),900);
  try {
    const response=await fetch(new URL("release.json",scope),{cache:"no-store",credentials:"same-origin",redirect:"error",signal:ctl.signal});
    if (!response.ok) return;
    const info=await response.json();
    if (info?.schema!==1 || info.kind!=="melete-player" || info.player!=="index.html" ||
        info.nativeProtocol!==1 || info.sha256===SHA || !/^[0-9a-f]{64}$/.test(info.sha256) ||
        !Number.isSafeInteger(info.bytes) || info.bytes<=0 || info.bytes>128*1024*1024) return;
    clearTimeout(timer);timer=setTimeout(()=>ctl.abort(),4000);
    return await caches.match(shell,{cacheName:prefix+info.sha256}) ||
      await verifiedDocument(info.sha256,info.bytes,ctl.signal);
  } finally {clearTimeout(timer);}
}
self.addEventListener("install", event => event.waitUntil(restoreCopy().then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil((async () => {
  // The self-contained document stays alive during a take. Only a subsequent
  // navigation gets the new shell, even when several old tabs remain open.
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
    if (hit) {
      if (self.navigator.onLine !== false) {
        try {const fresh=await freshCopy(); if (fresh) return fresh;} catch {}
      }
      return hit;
    }
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
    event.ports[0].postMessage({build:BUILD, ready, sha256:SHA, navigationManifest:1});
  })());
});
