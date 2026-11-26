/* Local, lossless library backups. No network or account operations. */
((root) => {
  'use strict';
  const names = ['takes', 'chunks', 'comps', 'counters'];
  const request = r => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  const done = tx => new Promise((resolve, reject) => {
    tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || Error('Storage transaction interrupted'));
  });
  async function open() {
    if (!(await indexedDB.databases()).some(db => db.name === 'melete-audio-takes-v1')) throw Error('No library on this origin.');
    const db = await request(indexedDB.open('melete-audio-takes-v1'));
    if (db.version !== 2 || [...db.objectStoreNames].sort().join() !== [...names].sort().join()) {
      db.close(); throw Error('Unexpected library schema; nothing changed.');
    }
    return db;
  }
  async function snapshot(db, {recordingsOnly=false}={}) {
    const tx = db.transaction(names), finish = done(tx), stores = {};
    await Promise.all(names.map(async name => {
      const store = tx.objectStore(name);
      const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
      stores[name] = keys.map((key, i) => [key, values[i]]);
    }));
    await finish;
    if (stores.takes.some(([, t]) => !t.finalized && Date.now() - Math.max(t.createdAt || 0, t.updatedAt || 0) < 180000)) {
      throw Error('A recording is still active. Finish it before transferring.');
    }
    const preferences = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (recordingsOnly ? key.startsWith('melete:take-octaves:') || key === 'melete:cloud:local-only:v1'
        : /^(melete:|choir-practice:)/.test(key)) preferences[key] = localStorage.getItem(key);
    }
    return {stores, preferences};
  }
  function pack({stores, preferences = {}, diagnostic = false}) {
    const buffers = []; let offset = 0;
    function encode(value) {
      if (value === undefined) return {$melete:'undefined'};
      if (typeof value === 'number' && !Number.isFinite(value)) return {$melete:'number', value:String(value)};
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        const marker = {$melete:'binary', type:value.constructor.name, at:offset, bytes:bytes.length};
        buffers.push(bytes); offset += bytes.length; return marker;
      }
      if (value instanceof Date) return {$melete:'date', value:value.toISOString()};
      if (Array.isArray(value)) return value.map(encode);
      if (value && typeof value === 'object') {
        if (Object.getPrototypeOf(value) !== Object.prototype || Object.hasOwn(value, '$melete')) throw Error('Unsupported recording field.');
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encode(entry)]));
      }
      return value;
    }
    const header = new TextEncoder().encode(JSON.stringify({format:1, preferences, ...(diagnostic ? {diagnostic:true} : {}),
      stores:Object.fromEntries(names.map(name => [name, encode(stores[name])]))}));
    const size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, header.length, true);
    return new Blob([size, header, ...buffers], {type:'application/octet-stream'});
  }
  function unpack(bytes) {
    const size = new DataView(bytes).getUint32(0, true), start = 4 + size;
    if (size > 64 * 1024 * 1024 || start > bytes.byteLength) throw Error('Invalid archive header.');
    const data = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 4, size)));
    const types = {Int16Array, Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int32Array, Uint8ClampedArray, DataView};
    function decode(value) {
      if (!value || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(decode);
      if (!Object.hasOwn(value, '$melete')) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
      if (value.$melete === 'undefined') return undefined;
      if (value.$melete === 'date') return new Date(value.value);
      if (value.$melete === 'number') return Number(value.value);
      if (value.$melete !== 'binary' || !Number.isSafeInteger(value.at) || !Number.isSafeInteger(value.bytes)
        || value.at < 0 || value.bytes < 0 || start + value.at + value.bytes > bytes.byteLength) throw Error('Invalid binary recording field.');
      const buffer = bytes.slice(start + value.at, start + value.at + value.bytes);
      if (value.type === 'ArrayBuffer') return buffer;
      if (!Object.hasOwn(types, value.type)) throw Error('Unknown recording type.');
      return new types[value.type](buffer);
    }
    if (data.format !== 1 || names.some(name => !Array.isArray(data.stores?.[name]))) throw Error('Unknown archive format.');
    return {stores:decode(data.stores), preferences:data.preferences || {}, ...(data.diagnostic ? {diagnostic:true} : {})};
  }
  const hash = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map(x => x.toString(16).padStart(2, '0')).join('');
  const keyOf = key => JSON.stringify(key);
  function equal(a, b) {
    if (Object.is(a,b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || a.constructor !== b.constructor) return false;
    if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer) {
      const bytes = v => v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer,v.byteOffset,v.byteLength);
      const x=bytes(a), y=bytes(b);return x.length===y.length && x.every((v,i)=>v===y[i]);
    }
    const keys=Object.keys(a);return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
  }
  function plan(destination, source, sourceHash) {
    if(destination.diagnostic || source.diagnostic) throw Error('Diagnostic metadata is not an audio backup and cannot be merged.');
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw Error('A verified source hash is required.');
    const maps=Object.fromEntries(names.map(n=>[n,new Map(destination.stores[n].map(([k,v])=>[keyOf(k),v]))]));
    const receipt=['library-merge',sourceHash];
    if (maps.counters.has(keyOf(receipt))) return {alreadyMerged:true,adds:{},updates:{},preferences:{}};
    const groups=new Map(), tag=sourceHash.slice(0,16), oldKeys=new Map();
    const group=(song,ref,slot)=>keyOf([song,ref.part,ref.line??null,slot||null]);
    // Namespace incoming ordinary tracks, including base slots, so rehearsal
    // sources can never be reconciled into a personal comp for the same part.
    function slot(song,ref,previous) {
      if (previous?.startsWith('station:')) return previous;
      const key=group(song,ref,previous);
      if (!groups.has(key)) groups.set(key,`import:${tag}:${groups.size+1}`);
      return groups.get(key);
    }
    const comps=source.stores.comps.map(([key,c])=>{
      const d=c.descriptor, nextSlot=slot(c.song,d.reference,d.slot), parts=JSON.parse(key);
      if(parts.length<8 || parts.length>9) throw Error('Unknown track key.');
      const nextKey=JSON.stringify([...parts.slice(0,8),nextSlot]);oldKeys.set(key,nextKey);
      return [nextKey,{...c,key:nextKey,descriptor:{...d,slot:nextSlot},
        ...(c.revisionOf?{revisionOf:c.revisionOf}:{} )}];
    });
    for(const [,c] of comps) if(c.revisionOf && oldKeys.has(c.revisionOf)) c.revisionOf=oldKeys.get(c.revisionOf);
    const takes=source.stores.takes.map(([key,t])=>[key,{...t,
      ...(t.pitchReference?{trackSlot:slot(t.song,t.pitchReference,t.trackSlot)}:{})}]);
    const counters=source.stores.counters.map(([key,value])=>{
      if(Array.isArray(key)&&key[0]==='comp-edit-history') {
        const remap=items=>(items||[]).map(e=>({...e,key:oldKeys.get(e.key)||e.key}));
        return [key,{...value,past:remap(value.past),future:remap(value.future)}];
      }
      return [key,value];
    });
    const adds=Object.fromEntries(names.map(n=>[n,[]])),updates=Object.fromEntries(names.map(n=>[n,[]]));
    for(const [name,rows] of Object.entries({takes,chunks:source.stores.chunks,comps,counters})) for(const [key,value] of rows) {
      const id=keyOf(key), before=maps[name].get(id);
      if(!maps[name].has(id)){adds[name].push([key,value]);continue;}
      if(equal(before,value)&&!(name==='counters'&&Array.isArray(key)&&key[0]==='recording-seconds'))continue;
      if(name!=='counters') throw Error(`Conflicting ${name} record; nothing changed.`);
      let after;
      if(typeof key==='string'&&typeof before==='number'&&typeof value==='number') after=Math.max(before,value);
      else if(Array.isArray(key)&&key[0]==='recording-seconds') after=before+value;
      else if(Array.isArray(key)&&key[0]==='comp-edit-history'&&!before.future.length&&!value.future.length) {
        after={past:[...before.past,...value.past].sort((a,b)=>a.at-b.at),future:[],revision:Math.max(before.revision,value.revision)+1};
      } else throw Error('Conflicting library counter; nothing changed.');
      updates[name].push([key,after,before]);
    }
    const protectedTracks=new Set(JSON.parse(destination.preferences['melete:cloud:local-only:v1']||'[]'));
    for(const [,c] of destination.stores.comps) if(c.segments.length) protectedTracks.add(group(c.song,c.descriptor.reference,c.descriptor.slot));
    const sourcePrivate=new Set(JSON.parse(source.preferences['melete:cloud:local-only:v1']||'[]'));
    for(const [old, next] of groups) if(sourcePrivate.has(old)) {
      const [song,part,line]=JSON.parse(old);protectedTracks.add(group(song,{part,line},next));
    }
    const preferences={'melete:cloud:local-only:v1':JSON.stringify([...protectedTracks])};
    const octaveMap = value => {
      try {
        const entries = JSON.parse(value || '{}');
        return entries && !Array.isArray(entries) && typeof entries === 'object'
          ? Object.fromEntries(Object.entries(entries).filter(([,v]) => [-1,0,1].includes(v))) : {};
      } catch { return {}; }
    };
    const octaveIds = new Map();
    const remember = (song, oldId, nextId) => {
      if (!octaveIds.has(song)) octaveIds.set(song, new Map());
      octaveIds.get(song).set(oldId, nextId);
    };
    for (const [,take] of source.stores.takes) remember(take.song, take.id, take.id);
    for (const [key,comp] of source.stores.comps) remember(comp.song, `comp:${key}`, `comp:${oldKeys.get(key)}`);
    for (const [song,ids] of octaveIds) {
      const key = `melete:take-octaves:${song}`, incoming = octaveMap(source.preferences[key]);
      const imported = Object.fromEntries([...ids].filter(([id]) => Object.hasOwn(incoming,id))
        .map(([id,nextId]) => [nextId,incoming[id]]));
      if (Object.keys(imported).length) preferences[key] = JSON.stringify({...imported, ...octaveMap(destination.preferences[key])});
    }
    // Keep the destination's mix, mic calibration, selection and login settings.
    // Octaves travel as playback metadata only; PCM and pitch evidence stay raw.
    // Source receipt IDs stay on each source; no upload switch is imported.
    adds.counters.push([receipt,{sourceHash,counts:Object.fromEntries(names.map(n=>[n,source.stores[n].length])),version:1}]);
    return {adds,updates,preferences,alreadyMerged:false};
  }
  async function apply(db, destination, changes) {
    if(changes.alreadyMerged)return;
    const tx=db.transaction(names,'readwrite'), finish=done(tx);
    try {
      // Check metadata in the same transaction as the additive writes. A second
      // open player cannot silently change the destination while it is merged.
      for(const name of ['takes','comps','counters']) {
        const store=tx.objectStore(name);
        const keys=await request(store.getAllKeys()), values=await request(store.getAll());
        if(!equal(keys.map((k,i)=>[k,values[i]]),destination.stores[name])) throw Error('Library changed in another tab. Back it up again.');
      }
      if(await request(tx.objectStore('chunks').count())!==destination.stores.chunks.length) throw Error('Audio changed in another tab.');
      for(const name of names) {
        const store=tx.objectStore(name);
        for(const [key,value] of changes.adds[name]) store.keyPath?store.add(value):store.add(value,key);
        for(const [key,value] of changes.updates[name]) store.keyPath?store.put(value):store.put(value,key);
      }
    } catch(error) {tx.abort();await finish.catch(()=>{});throw error;}
    await finish;
  }
  function summary(data) {
    return {counts:Object.fromEntries(names.map(name => [name, data.stores[name].length])),
      takes:data.stores.takes.map(([, t]) => ({id:t.id, song:t.song, number:t.number, singer:t.performer?.name || t.station?.name,
        frames:t.frames, sampleRate:t.sampleRate, slot:t.trackSlot, finalized:t.finalized, repaired:t.pitchRepair?.revision})),
      comps:data.stores.comps.map(([key, c]) => ({key, song:c.song, singer:c.descriptor?.station?.name,
        segments:c.segments?.length, sources:[...new Set((c.segments || []).map(s => s.takeId))]}))};
  }
  const api = {names, open, snapshot, pack, unpack, hash, summary, equal, plan, apply};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeleteLibraryArchive = api;
})(globalThis);
