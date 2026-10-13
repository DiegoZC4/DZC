/* Range-aware audio cache. This worker controls only /sequences-audio* pages. */
'use strict';
const CACHE_PROTOCOL = 1;
const CHUNK_BYTES = 256 * 1024;
const CACHE_BUDGET = 64 * 1024 * 1024;
const DB_NAME = 'sequences-audio-chunks-v1';
const inFlight = new Map();
let database;

function assetFor(url) {
  const parsed = new URL(url, self.location.href);
  const size = Number(parsed.searchParams.get('bytes'));
  if (parsed.origin !== self.location.origin
      || !/^\/audio\/lsrg-\d+[-a-z0-9]*\.(m4a|mp3)$/.test(parsed.pathname)
      || !/^[a-f0-9]{16}$/.test(parsed.searchParams.get('sa') || '')
      || !Number.isSafeInteger(size) || size < 1) return null;
  parsed.hash = '';
  return { url: parsed.href, size, type: parsed.pathname.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4' };
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
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('assets', { keyPath: 'url' });
      request.result.createObjectStore('chunks', { keyPath: ['url', 'index'] });
    };
    request.onsuccess = () => resolve(request.result);
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
  const tx = db.transaction(['assets', 'chunks'], mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Audio cache transaction failed'));
  });
  // Attach a handler immediately, even if an earlier request rejects first.
  done.catch(() => {});
  try {
    const value = await work(tx.objectStore('assets'), tx.objectStore('chunks'));
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
  return transaction('readonly', async (assets, chunks) => (await result(chunks.get([asset.url, index])))?.data);
}

async function cacheStatus(asset, touch = false) {
  return transaction(touch ? 'readwrite' : 'readonly', async (assets, chunks) => {
    const meta = await result(assets.get(asset.url));
    if (meta && touch) { meta.used = Date.now(); assets.put(meta); }
    const keys = await result(chunks.getAllKeys(chunkKeys(asset.url)));
    return { url: asset.url, received: meta?.received || 0, total: asset.size,
      chunks: keys.map(key => key[1]), chunkBytes: CHUNK_BYTES, budget: CACHE_BUDGET };
  });
}

async function storeChunk(asset, index, data, validator) {
  if (asset.size > CACHE_BUDGET) throw new Error('This episode exceeds the offline storage limit');
  const evicted = await transaction('readwrite', async (assets, chunks) => {
    const removed = [];
    const all = await result(assets.getAll());
    const old = all.find(item => item.url === asset.url);
    if (old?.validator && validator && old.validator !== validator) {
      throw new Error('Audio changed on the server; reload the page before saving more');
    }
    if (await result(chunks.get([asset.url, index]))) return removed;
    let used = all.reduce((sum, item) => sum + item.received, 0);
    const protectedUrls = new Set([...inFlight.values()].map(entry => entry.url));
    for (const item of all.sort((a, b) => a.used - b.used)) {
      if (used + data.byteLength <= CACHE_BUDGET) break;
      if (item.url === asset.url || protectedUrls.has(item.url)) continue;
      chunks.delete(chunkKeys(item.url));
      assets.delete(item.url);
      used -= item.received;
      removed.push(item.url);
    }
    if (used + data.byteLength > CACHE_BUDGET) throw new Error('Offline cache is busy; finish the other download first');
    chunks.put({ url: asset.url, index, data });
    assets.put({ url: asset.url, size: asset.size, used: Date.now(),
      received: (old?.received || 0) + data.byteLength, validator: validator || old?.validator || '' });
    return removed;
  });
  for (const url of evicted) await notify({ url }, 'evicted');
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
  const asset = event.request.method === 'GET' && assetFor(event.request.url);
  if (asset) event.respondWith(audioResponse(event.request, asset));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'audio-cache-status') return;
  event.waitUntil((async () => {
    try {
      const asset = assetFor(event.data.url);
      if (!asset) throw new Error('Unsupported audio URL');
      event.ports[0]?.postMessage({ protocol: CACHE_PROTOCOL, ...await cacheStatus(asset, Boolean(event.data.touch)) });
    } catch (error) {
      event.ports[0]?.postMessage({ error: error.message });
    }
  })());
});
