importScripts('analysis-core.js?v=slow-drift-2','part-tracker.js?v=parts-1');
let manifest, data, tracking, candidates;
self.onmessage = async ({data:message}) => {
  try {
    if(message.type==='init') {
      manifest=message.manifest;
      const response=await fetch(manifest.peaks.url);
      if(!response.ok) throw Error('Spectral data unavailable');
      data=new Float32Array(await response.arrayBuffer());
      if(data.length!==manifest.peaks.frames*manifest.peaks.stride) throw Error('Incomplete spectral data');
      const infoResponse=await fetch(manifest.tracking || 'data/tracking.json');
      if(!infoResponse.ok)throw Error('Part tracking data unavailable');
      tracking=await infoResponse.json();
      if(tracking.version!==2||tracking.sourceSha256!==manifest.sourceSha256||tracking.scoreSha256!==manifest.scoreSha256||tracking.frames!==manifest.peaks.frames)throw Error('Part tracking source mismatch');
      const candidateResponse=await fetch(tracking.url);
      if(!candidateResponse.ok)throw Error('Harmonic candidates unavailable');
      candidates=new Float32Array(await candidateResponse.arrayBuffer());
      if(candidates.length!==tracking.frames*tracking.stride)throw Error('Incomplete harmonic candidates');
      for(let i=0;i<tracking.frames;i++)if(Math.abs(candidates[i*tracking.stride]-data[i*manifest.peaks.stride])>.001)throw Error('Part tracking time mismatch');
      self.postMessage({type:'ready'});
    } else if(message.type==='analyze') {
      const start=performance.now();
      const result=RehearsalAnalysis.analyze(manifest,data,message.anchors);
      const original=[...manifest.measures.map(m=>m.start),manifest.measures.at(-1).end];
      Object.assign(result,RehearsalParts.track(manifest,tracking,candidates,RehearsalAnalysis.mapper(original,message.anchors),result.drift));
      self.postMessage({type:'result',revision:message.revision,elapsed:performance.now()-start,...result},
        Object.values(result).map(x=>x.buffer));
    }
  } catch(error) { self.postMessage({type:'error',message:error.message}); }
};
