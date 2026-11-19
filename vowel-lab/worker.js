importScripts('analysis.js','live_tracker.js');
let tracker,epoch;
self.onmessage = async ({data}) => {
  try {
    const started=performance.now();
    if(epoch!==data.epoch || !tracker){tracker=new VowelTracker.Tracker();epoch=data.epoch;}
    const result=tracker.process(data.input,data.sampleRate,data.timeMs);
    if(data.clip){
      const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      result.windowSha256=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',data.input)));
      result.windowTail=hex(new Uint8Array(data.input.buffer).slice(-32));
    }
    self.postMessage({...result,analysisMs:performance.now()-started,id:data.id,epoch:data.epoch,timeMs:data.timeMs,clip:data.clip});
  } catch (error) {
    self.postMessage({id: data.id, epoch: data.epoch, timeMs: data.timeMs, result: null, state: 'error', error: error.message});
  }
};
