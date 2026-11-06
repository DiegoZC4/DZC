/* Shared by the worker and deterministic Node tests. No audio quantization. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RehearsalAnalysis = api;
})(typeof self !== 'undefined' ? self : globalThis, () => {
  'use strict';
  const MIN_GAP = .2;
  const DRIFT = Object.freeze({windowSeconds:90,knotSeconds:5,maxCentsPerMinute:10,minEvidenceSeconds:10});
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function validateAnchors(values, original, duration) {
    return Array.isArray(values) && values.length === original.length && values.every((x,i) =>
      Number.isFinite(x) && x >= 0 && x <= duration && (!i || x-values[i-1] >= MIN_GAP-1e-6));
  }
  function moveAnchor(values, index, value, duration) {
    const result = values.slice();
    result[index] = clamp(value, index ? result[index-1]+MIN_GAP : 0,
      index < result.length-1 ? result[index+1]-MIN_GAP : duration);
    return result;
  }
  function mapper(original, edited) {
    return t => {
      if (t <= original[0]) return t + edited[0]-original[0];
      const last = original.length-1;
      if (t >= original[last]) return t + edited[last]-original[last];
      let lo=0, hi=last;
      while (hi-lo>1) { const mid=(lo+hi)>>1; if (original[mid]<=t) lo=mid; else hi=mid; }
      const fraction = (t-original[lo])/(original[hi]-original[lo]);
      return edited[lo]+fraction*(edited[hi]-edited[lo]);
    };
  }
  function chordRuns(notes, map) {
    const events = new Map();
    for (const n of notes) {
      for (const [time, delta] of [[n.onset,1],[n.offset,-1]]) {
        const key = Math.round(map(time)*1e6)/1e6;
        if (!events.has(key)) events.set(key, []);
        events.get(key).push([n.pitch,delta]);
      }
    }
    const times = [...events.keys()].sort((a,b)=>a-b), active = new Map(), runs=[];
    for (let i=0;i<times.length-1;i++) {
      for (const [pitch,delta] of events.get(times[i])) active.set(pitch,(active.get(pitch)||0)+delta);
      const pitches = [...active].filter(([,count])=>count>0).map(([p])=>p).sort((a,b)=>a-b);
      const key = pitches.join(',');
      const prior = runs.at(-1);
      if (prior && prior.key===key) prior.end=times[i+1];
      else runs.push({start:times[i],end:times[i+1],pitches,key});
    }
    return runs;
  }
  // A half-cent lookup avoids millions of exp() calls while preserving the
  // original +/-80-cent search and sigma=16-cent chord-specific cost.
  function penaltyLookup(pitches) {
    const expected=[];
    for (const p of pitches) for(let h=1;h<=16;h++) {
      const f=440*2**((p-69)/12)*h;
      if(f>=65 && f<=3100) expected.push(p*100+1200*Math.log2(h));
    }
    expected.sort((a,b)=>a-b);
    const low=3000, step=.5, values=new Float32Array(16001);
    let j=0;
    for(let i=0;i<values.length;i++) {
      const c=low+i*step;
      while(j+1<expected.length && Math.abs(expected[j+1]-c)<=Math.abs(expected[j]-c)) j++;
      const d=c-expected[j];
      values[i]=1-Math.exp(-d*d/512);
    }
    return {low,step,values};
  }
  function costAtShift(data, offset, count, lookup, shift, denominator) {
    let sum=0, den=denominator??0;
    for(let p=0;p<count;p++) {
      const w=data[offset+1+count+p];
      if(w<=0) continue;
      if(denominator===undefined) den+=w;
      const position=(data[offset+1+p]-shift-lookup.low)/lookup.step;
      const ix=Math.floor(position), fraction=position-ix;
      sum += w * (ix<0 || ix+1>=lookup.values.length ? 1 :
        lookup.values[ix]*(1-fraction)+lookup.values[ix+1]*fraction);
    }
    return den>0 ? sum/den : NaN;
  }
  function frameCost(data, offset, count, lookup, energyFloor) {
    let den=0, nonzero=0;
    for(let p=0;p<count;p++) { const w=data[offset+1+count+p]; den+=w; if(w>0) nonzero++; }
    if(nonzero<3 || den<=energyFloor) return null;
    const costs=new Float32Array(161);
    let best=Infinity, bestIndex=0;
    for(let s=0;s<161;s++) {
      costs[s]=costAtShift(data,offset,count,lookup,s-80,den);
      if(costs[s]<best) { best=costs[s]; bestIndex=s; }
    }
    let alternative=Infinity;
    for(let s=0;s<161;s++) if(Math.abs(s-bestIndex)>16) alternative=Math.min(alternative,costs[s]);
    return {offset:bestIndex-80,residual:best,fixed:costs[80],
      uncertain:bestIndex===0 || bestIndex===160 || alternative-best<.012};
  }
  function slowTuningDrift(times, observations, flags, stepSeconds) {
    const result=new Float32Array(times.length); result.fill(NaN);
    if(!times.length) return result;
    const knots=[], halfWindow=DRIFT.windowSeconds/2, last=times.at(-1);
    let left=0, right=0;
    for(let t=times[0];;t=Math.min(last,t+DRIFT.knotSeconds)) {
      while(left<times.length && times[left]<t-halfWindow) left++;
      while(right<times.length && times[right]<=t+halfWindow) right++;
      const histogram=new Uint32Array(161); let count=0;
      for(let i=left;i<right;i++) if(flags[i]===0 && Number.isFinite(observations[i])) {
        histogram[clamp(Math.round(observations[i])+80,0,160)]++; count++;
      }
      let value=NaN;
      if(count*stepSeconds>=DRIFT.minEvidenceSeconds) {
        let accumulated=0;
        for(let s=0;s<histogram.length;s++) {
          accumulated+=histogram[s];
          if(accumulated>count/2) { value=s-80; break; }
        }
      }
      knots.push({time:t,value});
      if(t>=last) break;
    }
    // Project the robust knot estimates onto bounded adjacent slopes (Dykstra).
    // Keeping each edge's correction avoids a one-way filter's start/end bias.
    const rate=DRIFT.maxCentsPerMinute/60;
    const values=knots.map(k=>k.value), corrections=new Float64Array(knots.length);
    for(let iteration=0;iteration<4096;iteration++) {
      let change=0;
      for(let i=0;i<knots.length-1;i++) {
        if(!Number.isFinite(values[i]) || !Number.isFinite(values[i+1])) continue;
        const a=values[i]+corrections[i], b=values[i+1]-corrections[i];
        const limit=rate*(knots[i+1].time-knots[i].time);
        const adjust=(b-a-clamp(b-a,-limit,limit))/2;
        change=Math.max(change,Math.abs(a+adjust-values[i]),Math.abs(b-adjust-values[i+1]));
        values[i]=a+adjust; values[i+1]=b-adjust; corrections[i]=-adjust;
      }
      if(change<1e-8) break;
    }
    // Enforce the bound even if the finite iteration budget was exhausted.
    for(let i=1;i<knots.length;i++) if(Number.isFinite(values[i-1]) && Number.isFinite(values[i])) {
      const limit=rate*(knots[i].time-knots[i-1].time);
      values[i]=clamp(values[i],values[i-1]-limit,values[i-1]+limit);
    }
    for(let i=0;i<knots.length;i++) knots[i].value=values[i];
    let k=0;
    for(let i=0;i<times.length;i++) {
      while(k+1<knots.length && knots[k+1].time<=times[i]) k++;
      const a=knots[k], b=knots[k+1]||a;
      if(!Number.isFinite(a.value) || !Number.isFinite(b.value)) continue;
      const fraction=b.time>a.time ? (times[i]-a.time)/(b.time-a.time) : 0;
      result[i]=a.value+fraction*(b.value-a.value);
    }
    return result;
  }
  function analyze(manifest, data, anchors) {
    const original=[...manifest.measures.map(m=>m.start),manifest.measures.at(-1).end];
    if(!validateAnchors(anchors,original,manifest.duration)) throw Error('Invalid alignment boundaries');
    const runs=chordRuns(manifest.notes,mapper(original,anchors));
    const {frames,stride,count,energyFloor,stepSeconds}=manifest.peaks;
    const times=new Float32Array(frames), rawDrift=new Float32Array(frames), mismatch=new Float32Array(frames);
    const flags=new Uint8Array(frames), fixed=new Float32Array(frames);
    const bestMismatch=new Float32Array(frames);
    rawDrift.fill(NaN); mismatch.fill(NaN); fixed.fill(NaN); bestMismatch.fill(NaN);
    const lookups=new Map(); let r=0;
    for(let i=0;i<frames;i++) {
      const offset=i*stride, t=data[offset]; times[i]=t;
      while(r+1<runs.length && runs[r].end<=t) r++;
      const run=runs[r];
      if(!run || t<run.start || t>=run.end || run.pitches.length<2) { flags[i]=1; continue; }
      if(!lookups.has(run.key)) lookups.set(run.key,penaltyLookup(run.pitches));
      const result=frameCost(data,offset,count,lookups.get(run.key),energyFloor);
      if(!result) { flags[i]=2; continue; }
      rawDrift[i]=result.offset; bestMismatch[i]=result.residual; fixed[i]=result.fixed;
      if(t-run.start<.2 || run.end-t<.1) flags[i]|=4;
      if(result.uncertain) flags[i]|=8;
    }
    const drift=slowTuningDrift(times,rawDrift,flags,stepSeconds);
    r=0;
    for(let i=0;i<frames;i++) {
      if(!Number.isFinite(fixed[i])) { drift[i]=NaN; continue; }
      while(r+1<runs.length && runs[r].end<=times[i]) r++;
      if(Number.isFinite(drift[i])) mismatch[i]=costAtShift(data,i*stride,count,lookups.get(runs[r].key),drift[i]);
      else { flags[i]|=16; mismatch[i]=fixed[i]; }
    }
    return {times,drift,mismatch:mismatch.slice(),fixed,
      flags,rawDrift,rawMismatch:mismatch,bestMismatch};
  }
  return {MIN_GAP,DRIFT,clamp,validateAnchors,moveAnchor,mapper,chordRuns,penaltyLookup,costAtShift,frameCost,slowTuningDrift,analyze};
});
