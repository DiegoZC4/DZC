/* Wrapped pitchbars use written quarters for spacing and the recording clock for transport. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;else root.MeleteFullPracticePitchRows=api;
})(globalThis,function(){
 'use strict';
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function lastAt(items,value,key){
  let a=0,b=items.length;
  while(a<b){const m=(a+b)>>>1;if(key(items[m])<=value)a=m+1;else b=m;}
  return items[Math.max(0,a-1)];
 }
 function interpolate(points,x,col){
  const stop=points.at(-1);if(x>=stop[col])return stop[1-col];
  let a=0,b=points.length-1;
  while(b-a>1){const m=(a+b)>>>1;if(points[m][col]<=x)a=m;else b=m;}
  const p=points[a],z=points[b],f=clamp((x-p[col])/(z[col]-p[col]),0,1);
  return p[1-col]+f*(z[1-col]-p[1-col]);
 }
 function pitchRange(notes,tonic,minor){
  if(!notes.length)return null;
  const low=Math.min(...notes.map(n=>n.pitch)),high=Math.max(...notes.map(n=>n.pitch)),mid=(low+high)/2;
  const degrees=[0,7,minor?3:4],candidates=[];
  for(let p=low-6;p<=high+6;p++){
   const degree=((p-tonic)%12+12)%12,priority=degrees.indexOf(degree);
   if(priority!==-1)candidates.push({p,degree,priority,distance:Math.max(low-p,p-high,0)});
  }
  candidates.sort((a,b)=>a.distance-b.distance||a.priority-b.priority||Math.abs(a.p-mid)-Math.abs(b.p-mid)||a.p-b.p);
  const ref=candidates[0].p,lo=Math.min(low,ref),hi=Math.max(high,ref);
  return {lo,hi,ref,guides:candidates.filter(n=>n.p>=lo&&n.p<=hi)};
 }
 function layout(data,notes,{width,stretch,scale,shift,chordName,measure}){
  const left=37,right=5,room=Math.max(80,width-left-right),step=clamp(7*scale/100,3,20);
  const clock=data.scoreClock||data.bars.reduce((a,b)=>{
   const [n,d]=b.meter.split('/').map(Number);a.push([b.end,a.at(-1)[1]+n*4/d]);return a;
  },[[data.bars[0].start,0]]);
  const quarter=t=>interpolate(clock,t,0),seconds=q=>interpolate(clock,q,1);
  const bars=data.bars.map(b=>({...b,q:quarter(b.start),z:quarter(b.end)}));
  const written=notes.map(n=>({n,pitch:n.pitch,q:quarter(n.start),z:quarter(n.end)}));
  const lyrics=written.filter(w=>w.n.lyric).map(({n,q})=>{
   const first=n.lyric.search(/[\p{L}\p{N}]/u),prefix=n.lyric.slice(0,Math.max(0,first));
   const before=measure(prefix,'lyric')+measure(n.lyric[Math.max(0,first)],'lyric')/2;
   return {n,q,before,after:measure(n.lyric,'lyric')-before};
  });
  const chords=data.chords.map(([t,raw])=>{
   const text=chordName(raw,shift,data.key);
   return {q:quarter(t),t,raw,text,before:-2,after:2+measure(text,'chord')};
  });
  const base=16*stretch/100/Math.min(...written.map(w=>w.z-w.q)),spacing=[];
  for(const lane of [lyrics,chords])for(let i=1;i<lane.length;i++){
   const a=lane[i-1],b=lane[i];
   spacing.push({q:a.q,z:b.q,ppq:(a.after+b.before+5)/(b.q-a.q)});
  }
  // One written-time ruler per system. Neither a word on another line nor the
  // recorded rubato should stretch these measures.
  const labels=[...lyrics,...chords],within=(e,q,z)=>e.q>=q&&e.q<z;
  function scaleFor(q,z){
   let ppq=base;for(const gap of spacing)if(gap.q>=q&&gap.z<z)ppq=Math.max(ppq,gap.ppq);
   return ppq;
  }
  function extent(q,z){
   const ppq=scaleFor(q,z);
   let size=(z-q)*ppq;
   for(const e of labels)if(within(e,q,z))size=Math.max(size,(e.q-q)*ppq+e.after);
   return size;
  }
  const rows=[];let row,top=0;
  function segment(bar,q,z){
   if(!row||extent(row.q,z)>room+.001){row={q,z,segments:[]};rows.push(row);}
   row.z=z;row.segments.push({bar,q,z});
  }
  for(const bar of bars){
   let q=bar.q;
   while(extent(q,bar.z)>room+.001){
    // Only a measure that cannot fit by itself may break internally, preferably on a beat.
    const limit=q+room/base;
    let cut=Math.min(bar.z,Math.floor(limit+1e-8));
    while(cut>q&&extent(q,cut)>room+.001)cut--;
    if(cut<=q){
     // At extreme stretch a beat can exceed the viewport. Do not include the
     // next attack if its word would extend past the right edge.
     cut=Math.min(bar.z,limit);
     for(const e of labels)if(e.q>q&&e.q<cut&&extent(q,cut)>room+.001)cut=Math.min(cut,e.q);
    }
    segment(bar,q,cut);q=cut;
   }
   if(q<bar.z)segment(bar,q,bar.z);
  }
  for(const r of rows){
   r.start=seconds(r.q);r.end=seconds(r.z);r.notes=written.filter(w=>w.z>r.q&&w.q<r.z);
   r.lyrics=lyrics.filter(e=>within(e,r.q,r.z));r.chords=chords.filter(e=>within(e,r.q,r.z));
   r.carried=r.chords[0]?.q===r.q?null:chords.findLast(c=>c.q<r.q);
   r.range=pitchRange(r.notes,data.tonic+shift,/m$/.test(data.key));
   r.top=top;r.pitchTop=top+43;
   r.pitchBottom=r.pitchTop+(r.range?(r.range.hi-r.range.lo)*step:0);
   r.base=r.pitchBottom+21;r.bottom=r.range?r.pitchBottom+(r.lyrics.length?30:14):top+42;
   r.ppq=scaleFor(r.q,r.z);r.x=q=>left+(q-r.q)*r.ppq;
   r.y=p=>r.pitchTop+(r.range.hi-p)*step;
   top=r.bottom+8;
  }
  return {rows,left,step,height:top,width,quarter,seconds,
   atTime:t=>lastAt(rows,t,r=>r.start),atY:y=>lastAt(rows,y,r=>r.top),
   timeAt:(r,x)=>seconds(clamp(r.q+(x-left)/r.ppq,r.q,r.z))};
 }
 return {layout,pitchRange};
});
