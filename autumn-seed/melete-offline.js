/* Cache only the checked release document and its immutable reference MP3s. */
"use strict";
const BUILD = "a5969abf87b87abdbcbfde6e654b7291ba2577a361f74efbfe952c1f4fa69a4c", SHA = "2ee266553d0e8fc1e39bc35580160f54585eb93eea67cd01f82cfa0a71366845", BYTES = 3589812;
const scope = new URL(self.registration.scope);
const shell = new URL("index.html", scope).href;
const prefix = "melete:offline-player:v1:" + encodeURIComponent(scope.pathname) + ":";
const cacheName = prefix + SHA;
const mediaName = "melete:reference-mp3:v1:" + encodeURIComponent(scope.pathname);
const media = [{"mp3":"9b89a1150a2ac5773d3c03c95e3bbc0d8c26fbc9a4fa6f35c4dba4e4787c3d58","bytes":4020340},{"mp3":"d83d2353666babe14ac9fd8f795006c94b34e679b49d33e47a14684bc4903609","bytes":2289049}];
const mediaURL = ref => new URL("media/" + ref.mp3 + ".mp3", scope).href;
const pendingMedia = new Map();
let installingCopy;

const hashOf = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  byte => byte.toString(16).padStart(2,"0")).join("");
const validRef = r => r && /^[a-f0-9]{64}$/.test(r.mp3) && Number.isSafeInteger(r.bytes) &&
  r.bytes > 0 && r.bytes <= 128*1024*1024;
async function ensureMedia(refs) {
  if (!refs.length) return;
  const cache = await caches.open(mediaName);
  for (const ref of refs) {
    const url = mediaURL(ref);
    if (await cache.match(url)) continue;
    if (!pendingMedia.has(url)) pendingMedia.set(url, (async () => {
      const ctl = new AbortController(), timer = setTimeout(()=>ctl.abort(), 30000);
      try {
        const r = await fetch(url, {credentials:"same-origin",redirect:"error",cache:"no-store",signal:ctl.signal});
        if (r.status!==200) throw Error("Reference recording unavailable");
        const b = await r.arrayBuffer();
        if (b.byteLength!==ref.bytes || await hashOf(b)!==ref.mp3) throw Error("Invalid reference recording");
        await cache.put(url, new Response(b,{headers:{"Content-Type":"audio/mpeg","Content-Length":String(b.byteLength)}}));
      } finally { clearTimeout(timer); }
    })().finally(()=>pendingMedia.delete(url)));
    await pendingMedia.get(url);
  }
}
const complete = async () => Boolean(await saved()) &&
  (await Promise.all(media.map(ref=>caches.match(mediaURL(ref),{cacheName:mediaName})))).every(Boolean);

async function verifiedDocument(digest, size, signal) {
    const response = await fetch(shell, {cache:"no-store", credentials:"same-origin", redirect:"error", signal});
    if (response.status !== 200 || !/^text\/html\b/i.test(response.headers.get("content-type") || ""))
      throw Error("Expected the public Melete player");
    const bytes = await response.clone().arrayBuffer();
    if (bytes.byteLength !== size) throw Error("Incomplete player download");
    if (await hashOf(bytes) !== digest) throw Error("Player revision does not match the release");
    return response;
}
function restoreCopy() {
  if (!installingCopy) installingCopy = (async () => {
    const hit = await saved(), response = hit || await verifiedDocument(SHA,BYTES);
    await ensureMedia(media);
    if (!hit) await (await caches.open(cacheName)).put(shell,response);
  })().finally(() => { installingCopy = null; });
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
    const release=await response.json(), info=release?.hosted || release;
    if (release?.schema!==1 || release.kind!=="melete-player" || info.player!=="index.html" ||
        release.nativeProtocol!==1 || info.sha256===SHA || !/^[0-9a-f]{64}$/.test(info.sha256) ||
        !Number.isSafeInteger(info.bytes) || info.bytes<=0 || info.bytes>128*1024*1024) return;
    const refs=info.media ?? [];
    if (!Array.isArray(refs) || refs.length>1024 || !refs.every(validRef)) return;
    clearTimeout(timer);timer=setTimeout(()=>ctl.abort(),4000);
    const hit=await caches.match(shell,{cacheName:prefix+info.sha256});
    const next=hit || await verifiedDocument(info.sha256,info.bytes,ctl.signal);
    // An install can keep fetching a new recording; navigation with a working
    // copy must not wait out the longer per-MP3 download timeout.
    await new Promise((resolve,reject)=>{
      const abort=()=>reject(Error("Offline update timed out"));
      if (ctl.signal.aborted) { abort(); return; }
      ctl.signal.addEventListener("abort",abort,{once:true});
      ensureMedia(refs).then(resolve,reject).finally(()=>ctl.signal.removeEventListener("abort",abort));
    });
    if (!hit) await (await caches.open(prefix+info.sha256)).put(shell,next.clone());
    return next;
  } finally {clearTimeout(timer);}
}
self.addEventListener("install", event => event.waitUntil(restoreCopy().then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil((async () => {
  // The self-contained document stays alive during a take. Only a subsequent
  // navigation gets the new shell, even when several old tabs remain open.
  if (!await complete()) await restoreCopy();
  for (const key of await caches.keys()) if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  const req = event.request, url = new URL(req.url);
  if (req.method==="GET" && url.origin===scope.origin && !url.search &&
      url.pathname.startsWith(scope.pathname+"media/") &&
      /^[a-f0-9]{64}\.mp3$/.test(url.pathname.slice((scope.pathname+"media/").length))) {
    event.respondWith((async()=>{
      const hit=await caches.match(url.href,{cacheName:mediaName});
      if (hit) return hit;
      const ref=media.find(r=>mediaURL(r)===url.href);
      if (!ref) return fetch(req);
      await ensureMedia([ref]);
      return caches.match(url.href,{cacheName:mediaName});
    })());
    return;
  }
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
      ready = await complete();
      if (!ready && event.data.repair) { await restoreCopy(); ready = await complete(); }
    } catch {}
    event.ports[0].postMessage({build:BUILD, ready, sha256:SHA, navigationManifest:1});
  })());
});
