// On a static website the WAV and trace share a single local IndexedDB record.
function browserClipStorage() {
  let opened;
  function database() {
    if (!opened) opened=new Promise((resolve,reject)=>{
      const req=indexedDB.open('vowel-lab-clips',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('clips',{keyPath:'id'});
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    }).catch(error=>{opened=null;throw error;});
    return opened;
  }
  async function run(mode,action) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('clips',mode), request=action(tx.objectStore('clips'));
      tx.oncomplete=()=>resolve(request.result);
      tx.onabort=()=>reject(tx.error || request.error || Error('Clip storage is unavailable.'));
    });
  }
  function wav(pcm,rate,count) {
    const header=new ArrayBuffer(58), v=new DataView(header);
    const tag=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
    const u32=(i,n)=>v.setUint32(i,n,true),u16=(i,n)=>v.setUint16(i,n,true);
    tag(0,'RIFF');u32(4,50+pcm.size);tag(8,'WAVEfmt ');u32(16,18);u16(20,3);u16(22,1);
    u32(24,rate);u32(28,rate*4);u16(32,4);u16(34,32);u16(36,0);
    tag(38,'fact');u32(42,4);u32(46,count);tag(50,'data');u32(54,pcm.size);
    return new Blob([header,pcm],{type:'audio/wav'});
  }
  return {
    async ids(){return (await run('readonly',s=>s.getAllKeys())).reverse();},
    get(id){return run('readonly',s=>s.get(id));},
    async save(id,body,traceBytes){
      const info=JSON.parse(await body.slice(0,traceBytes).text()),pcm=body.slice(traceBytes);
      if(pcm.size!==info.sampleCount*4)throw Error('Audio length does not match the trace.');
      const trace=new Blob([JSON.stringify({...info,schema:1,id,audioFile:'audio.wav'})],{type:'application/json'});
      await run('readwrite',s=>s.add({id,trace,wav:wav(pcm,info.sampleRate,info.sampleCount)}));
      return {id,seconds:info.sampleCount/info.sampleRate};
    }
  };
}
