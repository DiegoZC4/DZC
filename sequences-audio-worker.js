/* Range-aware audio cache. This worker controls only /sequences-audio* pages. */
'use strict';
const CACHE_PROTOCOL = 2;
const CHUNK_BYTES = 256 * 1024;
const CACHE_BUDGET = 64 * 1024 * 1024;
const DB_NAME = 'sequences-audio-chunks-v1';
const SHELL_CACHE = 'sequences-audio-pages-v1';
const SHELL_LIMIT = 16 * 1024 * 1024;
const inFlight = new Map();
const shellRequests = new Map();
let database;

function pageFor(url) {
  const parsed = new URL(url, self.location.href);
  if (parsed.origin !== self.location.origin
      || !/^\/sequences-audio(?:-preview)?\.html$/.test(parsed.pathname)) return null;
  return new URL(parsed.pathname, self.location.href).href;
}

function assetFor(url) {
  const parsed = new URL(url, self.location.href);
  const size = Number(parsed.searchParams.get('bytes'));
  if (parsed.origin !== self.location.origin
      || !/^\/audio\/lsrg-\d+[-a-z0-9]*\.(m4a|mp3)$/.test(parsed.pathname)
      || !/^[a-f0-9]{16}$/.test(parsed.searchParams.get('sa') || '')
      || !Number.isSafeInteger(size) || size < 1) return null;
  parsed.hash = '';
  const page = new URL(parsed.searchParams.get('preview') === '1'
    ? '/sequences-audio-preview.html' : '/sequences-audio.html', self.location.href).href;
  return { url: parsed.href, size, page, type: parsed.pathname.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4' };
}

function parseRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Number(match[2]) : size - 1;
  end = Math.min(end, size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end, partial: true };
}

function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of [['assets', 'url'], ['chunks', ['url', 'index']], ['settings', 'id']]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = null; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Audio cache database is blocked'));
  }).catch(error => { database = null; throw error; });
  return database;
}

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, work) {
  const db = await openDatabase();
  const tx = db.transaction(['assets', 'chunks', 'settings'], mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Audio cache transaction failed'));
  });
  // Attach a handler immediately, even if an earlier request rejects first.
  done.catch(() => {});
  try {
    const value = await work(tx.objectStore('assets'), tx.objectStore('chunks'), tx.objectStore('settings'));
    await done;
    return value;
  } catch (error) {
    try { tx.abort(); } catch {}
    await done.catch(() => {});
    throw error;
  }
}

function chunkKeys(url) {
  return IDBKeyRange.bound([url, 0], [url, Number.MAX_SAFE_INTEGER]);
}

async function storedChunk(asset, index) {
  return transaction('readonly', async (assets, chunks, settings) => {
    const policy = await result(settings.get(asset.page));
    if (policy?.url !== asset.url || policy.disabled) return null;
    return (await result(chunks.get([asset.url, index])))?.data;
  });
}

async function currentPolicy(page) {
  return transaction('readonly', (assets, chunks, settings) => result(settings.get(page)));
}

async function notifyPolicy(policy) {
  for (const client of await self.clients.matchAll({ type: 'window' })) {
    client.postMessage({ type: 'audio-cache-current', policy });
  }
}

// The current week comes only from freshly fetched, generated HTML, never a
// stale tab's claimed date. Check it again inside every write transaction.
function manifestAsset(manifest, page) {
  const asset = assetFor(manifest.audio);
  if (manifest.version !== 1 || !asset || asset.page !== page
      || !/^lsrg-\d+$/.test(manifest.week || '')
      || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.date || '')) throw new Error('Invalid offline page manifest');
  return asset;
}

async function adoptCurrent(manifest, page) {
  const asset = manifestAsset(manifest, page);
  const outcome = await transaction('readwrite', async (assets, chunks, settings) => {
    const previous = await result(settings.get(page));
    if (previous && previous.date > manifest.date) return { policy: previous, changed: false, stale: true };
    const changed = !previous || previous.url !== asset.url || previous.date !== manifest.date;
    const policy = { id: page, week: manifest.week, date: manifest.date, url: asset.url,
      disabled: changed ? false : Boolean(previous.disabled) };
    for (const item of await result(assets.getAll())) {
      if (assetFor(item.url)?.page === page && item.url !== asset.url) {
        chunks.delete(chunkKeys(item.url));
        assets.delete(item.url);
      }
    }
    settings.put(policy);
    return { policy, changed, stale: false };
  });
  if (outcome.changed) await notifyPolicy(outcome.policy);
  return outcome;
}

async function setDownloadEnabled(asset, enabled) {
  const policy = await transaction('readwrite', async (assets, chunks, settings) => {
    const current = await result(settings.get(asset.page));
    if (current?.url !== asset.url) throw new Error('Only the current week can be downloaded');
    current.disabled = !enabled;
    settings.put(current);
    if (!enabled) { chunks.delete(chunkKeys(asset.url)); assets.delete(asset.url); }
    return current;
  });
  await notifyPolicy(policy);
  return cacheStatus(asset);
}

async function cachePage(page) {
  if (!shellRequests.has(page)) {
    const pending = (async () => {
      const response = await fetch(page, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (response.status !== 200 || response.redirected || !/text\/html/i.test(response.headers.get('Content-Type') || '')) {
        throw new Error('Read-along page is unavailable');
      }
      const reader = response.body.getReader(), parts = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > SHELL_LIMIT) throw new Error('Offline page exceeds its storage limit');
          parts.push(value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      const head = new TextDecoder().decode(bytes.subarray(0, 32768));
      if (!/<\/html>/i.test(new TextDecoder().decode(bytes.subarray(-512)))) throw new Error('Incomplete read-along page');
      const match = /<script type="application\/json" id="offline-manifest">([^<]+)<\/script>/.exec(head);
      if (!match) throw new Error('No offline page manifest');
      const manifest = JSON.parse(match[1]);
      manifestAsset(manifest, page);
      const headers = [...response.headers].filter(([name]) => !['content-encoding', 'content-length'].includes(name));
      const saved = new Response(bytes, { headers });
      const cache = await caches.open(SHELL_CACHE);
      const previous = await currentPolicy(page);
      if (previous && previous.date > manifest.date) return (await cache.match(page)) || saved;
      // Save the complete shell before retiring last week's audio. A quota
      // failure must not leave the visitor with neither a page nor their audio.
      try {
        await cache.put(page, saved.clone());
        await adoptCurrent(manifest, page);
      } catch (error) {
        // Storage failure must not replace a good online page with an older
        // cached week. Leave the old policy/download intact and show fresh HTML.
        await notify(manifestAsset(manifest, page), 'storage-error', 'Could not save the offline page');
      }
      return saved;
    })().finally(() => shellRequests.delete(page));
    shellRequests.set(page, pending);
  }
  return (await shellRequests.get(page)).clone();
}

async function pageResponse(page) {
  try { return await cachePage(page); }
  catch (error) {
    const saved = await caches.open(SHELL_CACHE).then(cache => cache.match(page)).catch(() => null);
    if (saved) return saved;
    // Cache denial must not break ordinary online use.
    return fetch(page);
  }
}

async function cacheStatus(asset, touch = false) {
  return transaction(touch ? 'readwrite' : 'readonly', async (assets, chunks, settings) => {
    const policy = await result(settings.get(asset.page));
    const meta = await result(assets.get(asset.url));
    if (meta && touch) { meta.used = Date.now(); assets.put(meta); }
    const keys = await result(chunks.getAllKeys(chunkKeys(asset.url)));
    return { url: asset.url, received: meta?.received || 0, total: asset.size,
      chunks: keys.map(key => key[1]), chunkBytes: CHUNK_BYTES, budget: CACHE_BUDGET,
      eligible: policy?.url === asset.url, policy };
  });
}

async function storeChunk(asset, index, data, validator) {
  if (asset.size > CACHE_BUDGET) throw new Error('This episode exceeds the offline storage limit');
  await transaction('readwrite', async (assets, chunks, settings) => {
    const policy = await result(settings.get(asset.page));
    if (policy?.url !== asset.url || policy.disabled) return;
    const old = await result(assets.get(asset.url));
    if (old?.validator && validator && old.validator !== validator) {
      throw new Error('Audio changed on the server; reload the page before saving more');
    }
    if (await result(chunks.get([asset.url, index]))) return;
    if ((old?.received || 0) + data.byteLength > CACHE_BUDGET) throw new Error('Offline storage limit reached');
    chunks.put({ url: asset.url, index, data });
    assets.put({ url: asset.url, size: asset.size, used: Date.now(),
      received: (old?.received || 0) + data.byteLength, validator: validator || old?.validator || '' });
  });
}

async function notify(asset, event, detail = '') {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) client.postMessage({ type: 'audio-cache-event', url: asset.url, event, detail });
}

async function fetchChunk(asset, index) {
  const start = index * CHUNK_BYTES;
  const end = Math.min(asset.size - 1, start + CHUNK_BYTES - 1);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(asset.url, { headers: { Range: `bytes=${start}-${end}` },
      cache: 'no-store', signal: controller.signal });
    const range = response.headers.get('Content-Range');
    if (response.status !== 206 || range !== `bytes ${start}-${end}/${asset.size}`) {
      await response.body?.cancel();
      throw new Error(`Invalid audio range response (${response.status})`);
    }
    const type = response.headers.get('Content-Type') || '';
    if (!/^(audio\/|application\/octet-stream)/i.test(type)) {
      await response.body?.cancel();
      throw new Error('Server returned non-audio content');
    }
    const data = await response.arrayBuffer();
    if (data.byteLength !== end - start + 1) throw new Error('Incomplete audio chunk');
    const validator = response.headers.get('ETag') || response.headers.get('Last-Modified') || '';
    try {
      await storeChunk(asset, index, data, validator);
      await notify(asset, 'saved');
    } catch (error) {
      // A full/disabled device cache must not prevent normal online listening.
      await notify(asset, 'storage-error', error.name === 'QuotaExceededError' ? 'Device storage is full' : error.message);
      if (/Audio changed/.test(error.message)) throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function getChunk(asset, index) {
  try {
    const cached = await storedChunk(asset, index);
    if (cached) return cached;
  } catch (error) {
    await notify(asset, 'storage-error', 'Device storage is unavailable');
  }
  const key = `${asset.url}|${index}`;
  if (!inFlight.has(key)) {
    const promise = fetchChunk(asset, index).finally(() => inFlight.delete(key));
    inFlight.set(key, { url: asset.url, promise });
  }
  return inFlight.get(key).promise;
}

async function audioResponse(request, asset) {
  const range = parseRange(request.headers.get('Range'), asset.size);
  if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${asset.size}` } });
  cacheStatus(asset, true).catch(() => {});
  let position = range.start;
  let cancelled = false;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const index = Math.floor(position / CHUNK_BYTES);
        const data = await getChunk(asset, index);
        if (cancelled) return;
        const offset = position - index * CHUNK_BYTES;
        const length = Math.min(data.byteLength - offset, range.end - position + 1);
        controller.enqueue(new Uint8Array(data, offset, length));
        position += length;
        if (position > range.end) controller.close();
      } catch (error) {
        if (!cancelled) {
          await notify(asset, 'network-error', error.name === 'AbortError' ? 'Audio request timed out' : error.message);
          controller.error(error);
        }
      }
    },
    cancel() { cancelled = true; }
  });
  const headers = { 'Content-Type': asset.type, 'Content-Length': String(range.end - range.start + 1),
    'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${asset.size}`;
  return new Response(stream, { status: range.partial ? 206 : 200, headers });
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const page = event.request.method === 'GET' && event.request.mode === 'navigate' && pageFor(event.request.url);
  if (page) { event.respondWith(pageResponse(page)); return; }
  const asset = event.request.method === 'GET' && assetFor(event.request.url);
  if (asset) event.respondWith((async () => {
    const policy = await currentPolicy(asset.page).catch(() => null);
    if (policy?.url !== asset.url || policy.disabled) return fetch(event.request);
    return audioResponse(event.request, asset);
  })());
});
self.addEventListener('message', event => {
  if (!['audio-cache-status', 'audio-cache-page', 'audio-cache-enable', 'audio-cache-clear'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      const page = pageFor(event.source?.url || '');
      if (!page) throw new Error('Unsupported read-along page');
      if (event.data.type === 'audio-cache-page') {
        let policy = await currentPolicy(page);
        const saved = await (await caches.open(SHELL_CACHE)).match(page);
        if (!saved || !policy || policy.url !== event.data.url) {
          // An offline revisit can be an older saved tab. Never throw away its
          // usable page/download just because a fresh network fetch fails.
          try { await cachePage(page); }
          catch (error) { if (!saved || !policy) throw error; }
          policy = await currentPolicy(page);
        }
        event.ports[0]?.postMessage({ protocol: CACHE_PROTOCOL, policy });
        return;
      }
      const asset = assetFor(event.data.url);
      if (!asset || asset.page !== page) throw new Error('Unsupported audio URL');
      const status = event.data.type === 'audio-cache-status'
        ? await cacheStatus(asset, Boolean(event.data.touch))
        : await setDownloadEnabled(asset, event.data.type === 'audio-cache-enable');
      event.ports[0]?.postMessage({ protocol: CACHE_PROTOCOL, ...status });
    } catch (error) {
      event.ports[0]?.postMessage({ error: error.message });
    }
  })());
});
