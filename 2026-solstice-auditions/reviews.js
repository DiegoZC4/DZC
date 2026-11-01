/* Submitted takes use the same playback snapshots and detector frames as local takes. */
(function(root) {
  'use strict';
  const P=typeof module==='object'&&module.exports?require('../template/take_pitch.js'):root.MeleteTakePitch;
  function photo(value){
    try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password
      &&(url.hostname==='googleusercontent.com'||url.hostname.endsWith('.googleusercontent.com'))?url.href:null;}catch{return null;}
  }
  function wire(take){
    if(!P.readContour(take))throw new Error('Wait for this take\'s pitch analysis before submitting.');
    const c=take.pitchContour;
    return {reference:take.pitchReference,version:c.version,analysisVersion:c.analysisVersion,
      pitches:Array.from(c.pitches,n=>Number.isNaN(n)?null:n)};
  }
  function take(row){
    const m=row.metadata;
    return {id:`submitted:${row.owner}:${row.song}:${row.revision}`,remote:row,number:row.name,
      name:row.name,email:row.email,picture:photo(m.picture),createdAt:row.updated*1000,
      songVersion:m.songVersion,rate:m.rate,transpose:m.transpose??m.octave,octave:m.octave,
      sampleRate:m.sampleRate,frames:Math.round(m.seconds*m.sampleRate),complete:true,
      pitchScore:{...m.stats}};
  }
  function attach(take,saved){
    const ref=saved?.reference,t=ref?.timing;
    const anchors=a=>Array.isArray(a)&&a.length>=2&&a.every((p,i)=>Array.isArray(p)&&p.length===2
      &&p.every(Number.isFinite)&&(!i||(p[0]>a[i-1][0]&&p[1]>a[i-1][1])));
    if(!P.validReference(ref)||ref.fingerprint!==take.songVersion||ref.rate!==take.rate
      ||!['guide','recording'].includes(t?.kind)||!anchors(t.anchors)
      ||(t.beatAnchors&&!anchors(t.beatAnchors))||!Number.isFinite(t.origin)
      ||!Array.isArray(t.countInBeats)||t.countInBeats.some(b=>!Number.isFinite(b.seconds)||!Number.isFinite(b.label)))
      throw new Error('This submitted take has invalid timing data.');
    take.pitchReference=ref;
    take.pitchContour={version:saved.version,analysisVersion:saved.analysisVersion,
      sampleRate:take.sampleRate,audioFrames:take.frames,reference:JSON.stringify(ref),
      pitches:new Float64Array(saved.pitches.map(n=>n===null?NaN:n))};
    return P.readContour(take);
  }
  function within(take){const s=take.pitchScore;return Number.isFinite(s?.within50Percent)?s.within50Percent:
    s?.trackedSeconds>0?s.within50CentsSeconds/s.trackedSeconds*100:null;}
  function visible(takes,user,all,song){
    if(!user)return [];
    return takes.filter(t=>t.remote?.song===song&&((user.admin&&all)||t.remote.owner===user.id));
  }
  function compare(a,b,order){
    const value=t=>({number:t.remote?t.name:t.number,tracked:t.pitchScore?.coverage,
      mean:t.pitchScore?.meanAbsCents,median:t.pitchScore?.medianAbsCents,within:within(t)})[order.column];
    const x=value(a),y=value(b),missing=v=>v===undefined||v===null||typeof v==='number'&&!Number.isFinite(v);
    if(missing(x)!==missing(y))return missing(x)?1:-1;
    const result=missing(x)?0:typeof x==='string'||typeof y==='string'?String(x).localeCompare(String(y),undefined,{numeric:true}):x-y;
    return result*(order.direction==='descending'?-1:1)||(a.createdAt||0)-(b.createdAt||0);
  }
  const api={photo,wire,take,attach,within,visible,compare};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MeleteAuditionReviews=api;
})(typeof globalThis!=='undefined'?globalThis:this);
