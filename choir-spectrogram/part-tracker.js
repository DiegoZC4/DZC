/* Whole-phrase Viterbi with coupled part assignments; candidates are audio-only. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RehearsalParts=api;})(typeof self!=='undefined'?self:globalThis,()=>{
  'use strict';
  const CONFIG=Object.freeze({rangeCents:700,options:9,passes:3,sharedCents:30});
  const FLAGS=Object.freeze({missing:1,shared:2,ambiguous:4,weak:8,harmonic:16,edge:32});
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const harmonics=Array.from({length:8},(_,h)=>1200*Math.log2(h+1));
  const bitCount=n=>{let count=0;while(n){n&=n-1;count++;}return count;};
  function targets(manifest,times,map){
    const frames=times.length,parts=manifest.parts.length;
    const pitch=new Float32Array(parts*frames),edge=new Uint8Array(parts*frames);pitch.fill(NaN);
    for(const n of manifest.notes){
      const start=map(n.onset),end=map(n.offset),p=n.part;
      let lo=0,hi=frames;
      while(lo<hi){const mid=(lo+hi)>>1;if(times[mid]<start)lo=mid+1;else hi=mid;}
      for(let i=lo;i<frames&&times[i]<end;i++){
        pitch[p*frames+i]=n.pitch*100;
        if(times[i]-start<.18||end-times[i]<.1)edge[p*frames+i]=1;
      }
    }
    return {pitch,edge};
  }
  function track(manifest,info,data,map,drift){
    const frames=info.frames,parts=manifest.parts.length,times=new Float32Array(frames);
    const candidates=[];
    for(let i=0;i<frames;i++){
      const offset=i*info.stride;times[i]=data[offset];const row=[];
      for(let k=0;k<info.count;k++){
        const a=offset+1+k*info.width;
        if(data[a+1]<.2)continue;
        row.push({pitch:data[a],support:data[a+1],fund:data[a+2],harmonics:data[a+3],spread:data[a+4],mask:data[a+5],id:k});
      }
      candidates.push(row);
    }
    const {pitch:target,edge}=targets(manifest,times,map),options=[];
    const aliases=new Map((info.aliases||[]).map(a=>[a.part,a.source]));
    const aliasAt=(p,i)=>aliases.has(p)&&target[p*frames+i]===target[aliases.get(p)*frames+i];
    const paths=Array.from({length:parts},()=>new Int16Array(frames).fill(-1));
    const chosen=Array.from({length:parts},()=>new Float32Array(frames).fill(NaN));
    const margins=Array.from({length:parts},()=>new Float32Array(frames));
    for(let p=0;p<parts;p++){
      options[p]=[];
      for(let i=0;i<frames;i++){
        const nominal=target[p*frames+i],reference=nominal+(Number.isFinite(drift[i])?drift[i]:0);
        const available=Number.isFinite(nominal)?candidates[i].filter(c=>Math.abs(c.pitch-reference)<=CONFIG.rangeCents).map(c=>({...c,
          base:-Math.log(Math.max(.03,c.support))+.35*(1-c.fund)+.12*Math.min(3,Math.abs(c.pitch-reference)/200)})):[];
        available.sort((a,b)=>a.base-b.base);
        const row=available.slice(0,CONFIG.options);
        row.push({pitch:NaN,support:0,base:Number.isFinite(nominal)?1.5:0,id:-1});options[p].push(row);
      }
    }
    const overlap=Array.from({length:frames},()=>new Map());
    function explainedMask(i,c,d){
      const key=c.id*info.count+d.id,cache=overlap[i];
      if(cache.has(key))return cache.get(key);
      let mask=0;
      for(let h=0;h<8;h++)if(c.mask&(1<<h)){
        const difference=c.pitch+harmonics[h]-d.pitch,k=Math.round(2**(difference/1200))-1;
        // A lower voice's ninth (or higher) partial can masquerade as an
        // upper voice's low partial. The observed c peak already establishes
        // energy here, so do not require d's truncated eight-partial mask.
        if(k>=0&&k<16&&Math.abs(difference-1200*Math.log2(k+1))<35)mask|=1<<h;
      }
      cache.set(key,mask);return mask;
    }
    function ownership(i,p,c){
      let explained=0,shared=false,harmonicRoot=false;const seen=new Set();
      for(let q=0;q<parts;q++)if(q!==p&&!aliasAt(q,i)&&!(aliasAt(p,i)&&aliases.get(p)===q)&&paths[q][i]>=0&&Number.isFinite(chosen[q][i])){
        const d=options[q][i][paths[q][i]];
        if(seen.has(d.id))continue;seen.add(d.id);
        if(Math.abs(c.pitch-d.pitch)<CONFIG.sharedCents){shared=true;continue;}
        const ratio=Math.round(2**((c.pitch-d.pitch)/1200));
        if(ratio>=2&&ratio<=4&&Math.abs(c.pitch-d.pitch-1200*Math.log2(ratio))<25&&Math.abs(target[p*frames+i]-target[q*frames+i]-1200*Math.log2(ratio))<80)harmonicRoot=true;
        explained|=explainedMask(i,c,d);
      }
      const novelMask=c.mask&~explained;
      return {shared,harmonicRoot,novelMask,novel:bitCount(novelMask)};
    }
    const transition=(a,b,delta,dt)=>{
      if(!Number.isFinite(a)||!Number.isFinite(b))return Number.isFinite(a)!==Number.isFinite(b)?.45:0;
      const d=Math.min(Math.abs(b-a),Math.abs(b-a-delta));
      return Math.min(5,.16*(d/Math.max(35,1000*dt))**2);
    };
    function decode(p,coupled){
      const rows=options[p],costs=[],back=[],emissions=[];
      for(let i=0;i<frames;i++){
        const nominal=target[p*frames+i];
        emissions[i]=Float64Array.from(rows[i],c=>{
          let cost=c.base;
          if(coupled&&Number.isFinite(c.pitch)){
            const evidence=ownership(i,p,c);
            if(evidence.shared){
              if(chosen.some((line,q)=>q!==p&&!aliasAt(q,i)&&Math.abs(c.pitch-line[i])<CONFIG.sharedCents&&Math.abs(nominal-target[q*frames+i])>40))cost+=.75;
            }else if(evidence.novel<2)cost+=evidence.harmonicRoot?.2:evidence.novel?(evidence.novelMask&1?.1:.45):1.1;
          }
          return cost;
        });
        const current=new Float64Array(rows[i].length),links=new Int16Array(rows[i].length);
        const delta=i?target[p*frames+i]-target[p*frames+i-1]:0;
        for(let b=0;b<current.length;b++){
          let best=Infinity,prior=0;
          if(!i)best=0;
          else for(let a=0;a<rows[i-1].length;a++){
            const value=costs[i-1][a]+transition(rows[i-1][a].pitch,rows[i][b].pitch,Number.isFinite(delta)?delta:0,times[i]-times[i-1]);
            if(value<best){best=value;prior=a;}
          }
          current[b]=best+emissions[i][b];links[b]=prior;
        }
        const min=Math.min(...current);for(let b=0;b<current.length;b++)current[b]-=min;
        costs.push(current);back.push(links);
      }
      let state=costs.at(-1).indexOf(Math.min(...costs.at(-1)));
      for(let i=frames-1;i>=0;i--){paths[p][i]=state;chosen[p][i]=rows[i][state].pitch;state=back[i][state];}
      let future=new Float64Array(rows.at(-1).length);
      for(let i=frames-1;i>=0;i--){
        const pick=paths[p][i],value=chosen[p][i];
        const selected=costs[i][pick]+future[pick];let alt=Infinity;
        for(let k=0;k<rows[i].length;k++)if(k!==pick&&(!Number.isFinite(rows[i][k].pitch)||Math.abs(rows[i][k].pitch-value)>65))alt=Math.min(alt,costs[i][k]+future[k]);
        margins[p][i]=Math.max(0,alt-selected);
        if(!i)break;
        const previous=new Float64Array(rows[i-1].length),delta=target[p*frames+i]-target[p*frames+i-1];
        for(let a=0;a<previous.length;a++){
          let best=Infinity;
          for(let b=0;b<rows[i].length;b++)best=Math.min(best,emissions[i][b]+future[b]+transition(rows[i-1][a].pitch,rows[i][b].pitch,Number.isFinite(delta)?delta:0,times[i]-times[i-1]));
          previous[a]=best;
        }
        const min=Math.min(...previous);for(let k=0;k<previous.length;k++)previous[k]-=min;
        future=previous;
      }
    }
    for(let pass=0;pass<CONFIG.passes;pass++)for(let k=0;k<parts;k++)decode(pass%2?parts-k-1:k,pass>0);
    const partPitch=new Float32Array(parts*frames),partConfidence=new Float32Array(parts*frames);
    const partFlags=new Uint8Array(parts*frames),partError=new Float32Array(parts*frames);
    partPitch.fill(NaN);partError.fill(NaN);
    for(let p=0;p<parts;p++)for(let i=0;i<frames;i++){
      const ix=p*frames+i,c=options[p][i][paths[p][i]],nominal=target[ix];
      if(!Number.isFinite(c.pitch)||!Number.isFinite(nominal)){partFlags[ix]=FLAGS.missing;continue;}
      let confidence=clamp(c.support*(.35+.65*(1-Math.exp(-margins[p][i]))),0,1),flag=0;
      if(ownership(i,p,c).novel<2){flag|=FLAGS.harmonic;confidence=Math.min(confidence,.4);}
      if(margins[p][i]<.7)flag|=FLAGS.ambiguous;
      if(c.support<.45||c.harmonics<3||c.spread>12){flag|=FLAGS.weak;confidence=Math.min(confidence,.4);}
      for(let q=0;q<parts;q++)if(q!==p&&!aliasAt(q,i)&&!(aliasAt(p,i)&&aliases.get(p)===q)&&Number.isFinite(chosen[q][i])){
        if(Math.abs(c.pitch-chosen[q][i])<CONFIG.sharedCents){flag|=FLAGS.shared;confidence=Math.min(confidence,.25);}
        const difference=c.pitch-chosen[q][i];
        if(difference>800&&[2,3,4].some(h=>Math.abs(difference-1200*Math.log2(h))<22)){
          flag|=FLAGS.harmonic;confidence=Math.min(confidence,.45);
        }
      }
      if(edge[ix]){flag|=FLAGS.edge;confidence=Math.min(confidence,.4);}
      partPitch[ix]=c.pitch;partError[ix]=c.pitch-nominal-(Number.isFinite(drift[i])?drift[i]:0);
      partConfidence[ix]=confidence;partFlags[ix]=flag;
    }
    for(const [p,q] of aliases)for(let i=0;i<frames;i++)if(aliasAt(p,i)){
      const to=p*frames+i,from=q*frames+i;
      for(const array of [partPitch,partError,partConfidence,partFlags])array[to]=array[from];
    }
    return {partPitch,partConfidence,partFlags,partError,partTarget:target};
  }
  return {CONFIG,FLAGS,targets,track};
});
