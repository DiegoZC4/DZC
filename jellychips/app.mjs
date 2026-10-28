import {PRESETS} from './presets.mjs';
import {cart,verify,plan,svgExport,fingerprint} from './math.mjs';

const $=id=>document.getElementById(id),STORE='jellychip-molds-v1';
const defaults={grid:'square',square:{count:100,side:5},triangle:{count:100,side:10},mass:100,density:1.08,kerf:0,stock:3.175,headroom:.5,trials:3,seconds:12,core:35,margin:2,showGrid:true,theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'};
let state=structuredClone(defaults),cache=new Map(),models=new Map(),worker=null,runId=0,watchdog=null,stopMessage='',searching=false;
const bounds={count:[1,500,1],side:[1,50,.1],mass:[1,10000,1],density:[.8,1.8,.001],kerf:[0,2,.01],stock:[.5,30,.001],headroom:[0,10,.1],trials:[1,20,1],seconds:[1,60,1],core:[0,80,1],margin:[1,4,.1]};
const clean=(v,k)=>{const[min,max,step]=bounds[k];return Number.isFinite(v)&&v>=min&&v<=max?Number((Math.round(v/step)*step).toFixed(6)):null;};
const cacheKey=(grid=state.grid,count=state[grid].count)=>`${grid}:${count}`;
function addCandidate(grid,cells,info={},select=false){
 const model=verify(cells,grid),id=fingerprint(cells),k=cacheKey(grid,cells.length);
 const record={id,cells,info,radius:model.circle.radius},list=cache.get(k)||[];
 if(!list.some(x=>x.id===id))list.push(record);
 list.sort((a,b)=>a.radius-b.radius);cache.set(k,list.slice(0,12));models.set(k+':'+id,model);
 if(select)state[grid].selected=id;
 return record;
}
try{
 const saved=JSON.parse(localStorage.getItem(STORE)||'null');
 if(saved?.version===1){const s=saved.state||{};for(const k of Object.keys(bounds))if(!['count','side'].includes(k)&&clean(s[k],k)!==null)state[k]=clean(s[k],k);
  for(const g of ['square','triangle'])for(const k of ['count','side'])if(clean(s[g]?.[k],k)!==null)state[g][k]=clean(s[g][k],k);
  if(['square','triangle'].includes(s.grid))state.grid=s.grid;if(['light','dark'].includes(s.theme))state.theme=s.theme;
  if(typeof s.showGrid==='boolean')state.showGrid=s.showGrid;
  for(const rec of (saved.candidates||[]).slice(0,80)){try{if(['square','triangle'].includes(rec.grid)&&rec.cells?.length<=500)addCandidate(rec.grid,rec.cells,rec.info);}catch{}}
  for(const g of ['square','triangle'])if(typeof s[g]?.selected==='string')state[g].selected=s[g].selected;
 }
}catch{}
for(const g of ['square','triangle'])addCandidate(g,PRESETS[g].cells,{source:PRESETS[g].source,seed:100});
function persist(){
 try{const candidates=[];for(const[k,list]of [...cache].slice(-10))for(const rec of list.slice(0,8))candidates.push({grid:k.split(':')[0],cells:rec.cells,info:rec.info});localStorage.setItem(STORE,JSON.stringify({version:1,state,candidates}));}
 catch{$('search-status').textContent='Browser storage unavailable; downloads still work.';}
}
function current(){const k=cacheKey(),list=cache.get(k)||[];const rec=list.find(x=>x.id===state[state.grid].selected)||list[0];return rec?{record:rec,model:models.get(k+':'+rec.id),list}:null;}
function settings(){return{side:state[state.grid].side,mass:state.mass,density:state.density,kerf:state.kerf,stock:state.stock,headroom:state.headroom};}
function getValue(k){return ['count','side'].includes(k)?state[state.grid][k]:state[k];}
function setValue(k,v){
 const n=clean(v,k);if(n===null||n===getValue(k))return;
 if(k==='count'){stopSearch(false);state[state.grid].selected=null;stopMessage='';}
 if(['count','side'].includes(k))state[state.grid][k]=n;else state[k]=n;
 render();persist();
}
const controls={};
function numberControl(parent,k,label,unit,decimals,pixels=8){
 const row=document.createElement('div');row.className='number-row';
 const text=document.createElement('span');text.className='number-label';text.textContent=label;
 const wrap=document.createElement('div');wrap.className='number-wrap';
 const button=document.createElement('button');button.type='button';button.className='number';button.setAttribute('aria-label',label);button.title='Drag vertically or click to type';button.setAttribute('role','spinbutton');
 const editor=document.createElement('input');editor.type='number';editor.className='number-editor';editor.hidden=true;editor.setAttribute('aria-label',label+' input');
 const[min,max,step]=bounds[k];editor.min=min;editor.max=max;editor.step=step;editor.inputMode=decimals?'decimal':'numeric';button.setAttribute('aria-valuemin',min);button.setAttribute('aria-valuemax',max);
 const sync=()=>{const v=getValue(k);button.innerHTML=`${v.toFixed(decimals)}<span class="unit">${unit}</span>`;button.dataset.value=v;button.setAttribute('aria-valuenow',v);};
 const open=()=>{editor.hidden=false;editor.value=getValue(k).toFixed(decimals);editor.focus();editor.select();};
 const commit=()=>{if(!editor.checkValidity()||!Number.isFinite(editor.valueAsNumber)){editor.reportValidity();return false;}setValue(k,editor.valueAsNumber);editor.hidden=true;return true;};
 editor.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(commit())button.focus();}else if(e.key==='Escape'){editor.hidden=true;button.focus();}});editor.addEventListener('blur',()=>{if(!editor.hidden)commit();});
 let start=null,moved=false,ignoreClick=false;
 button.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();start={y:e.clientY,x:e.clientX,v:getValue(k),id:e.pointerId};moved=false;button.setPointerCapture(e.pointerId);});
 button.addEventListener('pointermove',e=>{if(!start)return;if(Math.hypot(e.clientY-start.y,e.clientX-start.x)>3)moved=true;const delta=Math.round((start.y-e.clientY)/pixels);const v=Math.min(max,Math.max(min,start.v+delta*step));setValue(k,Number(v.toFixed(6)));});
 button.addEventListener('pointerup',()=>{if(!start)return;button.releasePointerCapture(start.id);start=null;ignoreClick=true;if(!moved)open();setTimeout(()=>ignoreClick=false,0);});
 button.addEventListener('pointercancel',()=>{start=null;});
 button.addEventListener('click',()=>{if(!ignoreClick)open();});
 button.addEventListener('keydown',e=>{let v=null;if(e.key==='ArrowUp'||e.key==='ArrowDown')v=getValue(k)+(e.key==='ArrowUp'?1:-1)*step*(e.shiftKey?10:1);else if(e.key==='Home')v=min;else if(e.key==='End')v=max;if(v!==null){e.preventDefault();setValue(k,Math.min(max,Math.max(min,Number(v.toFixed(6)))));}});
 wrap.append(button,editor);row.append(text,wrap);$(parent).append(row);controls[k]={button,editor,sync};sync();
}
numberControl('primary-controls','count','Chip count','chips',0,5);
numberControl('primary-controls','side','Side length','mm',1,10);
numberControl('primary-controls','mass','Mass / chip','mg',0,5);
numberControl('primary-controls','kerf','Full laser kerf','mm',2,10);
numberControl('material-controls','density','Density · estimate','g/mL',3,7);
numberControl('material-controls','stock','Measured plywood','mm',3,7);
numberControl('material-controls','headroom','Extra mold depth','mm',1,10);
numberControl('advanced-controls','trials','Search attempts','',0,12);
numberControl('advanced-controls','seconds','Time / attempt','s',0,6);
numberControl('advanced-controls','core','Filled central core','%',0,5);
numberControl('advanced-controls','margin','Search margin','sides',1,10);

function pill(){const capsule=$('shape-pill'),active=capsule.querySelector(`[data-grid="${state.grid}"]`),thumb=capsule.querySelector('.pill-thumb');capsule.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===active)));thumb.style.transform=`translate(${active.offsetLeft}px,${active.offsetTop}px)`;thumb.style.width=active.offsetWidth+'px';thumb.style.height=active.offsetHeight+'px';}
function changeGrid(grid){if(grid===state.grid)return;stopSearch(false);state.grid=grid;stopMessage='';render();persist();}
$('shape-pill').addEventListener('click',()=>changeGrid(state.grid==='square'?'triangle':'square'));
$('shape-pill').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();changeGrid(e.key==='ArrowLeft'?'square':'triangle');}});
new ResizeObserver(pill).observe($('shape-pill'));
$('theme').addEventListener('click',()=>{state.theme=state.theme==='light'?'dark':'light';render();persist();});
$('show-grid').addEventListener('change',()=>{state.showGrid=$('show-grid').checked;render();persist();});
$('candidate').addEventListener('change',()=>{state[state.grid].selected=$('candidate').value;render();persist();});
const ns='http://www.w3.org/2000/svg',el=(name,attrs)=>{const e=document.createElementNS(ns,name);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
function draw(model,p){
 const svg=$('preview');svg.replaceChildren();const s=state[state.grid].side,c=model.circle.center.map(v=>v*s),radius=model.circle.radius*s+Math.max(2,state.kerf*2),w=2*radius,h=w/1.15;
 // Fit the circle with the same scale on both axes inside the wide viewport.
 const hh=2*radius,ww=hh*1.15;svg.setAttribute('viewBox',`${c[0]-ww/2} ${-c[1]-hh/2} ${ww} ${hh}`);
 svg.append(el('circle',{cx:c[0],cy:-c[1],r:model.circle.radius*s,fill:'none',stroke:'var(--line)','stroke-width':1,'stroke-dasharray':'4 4','vector-effect':'non-scaling-stroke'}));
 const path=poly=>poly.map(([x,y],i)=>`${i?'L':'M'}${x},${-y}`).join(' ')+' Z';
 svg.append(el('path',{d:path(p.nominal),fill:'var(--fill)',stroke:'var(--fg)','stroke-width':1.3,'vector-effect':'non-scaling-stroke'}));
 if(state.showGrid)for(const e of model.interior){const[a,b]=[e.p,e.q].map(v=>cart(v,model.type).map(z=>z*s));svg.append(el('line',{x1:a[0],y1:-a[1],x2:b[0],y2:-b[1],stroke:'var(--muted)','stroke-opacity':.35,'stroke-width':.7,'vector-effect':'non-scaling-stroke'}));}
 if(state.kerf>0)svg.append(el('path',{d:path(p.toolpath),fill:'none',stroke:'var(--accent)','stroke-width':1.2,'stroke-dasharray':'3 2','vector-effect':'non-scaling-stroke'}));
}
function render(){
 document.documentElement.dataset.theme=state.theme;$('theme').textContent=state.theme==='light'?'Dark':'Light';$('show-grid').checked=state.showGrid;Object.values(controls).forEach(c=>c.sync());pill();
 const cur=current();$('candidate-row').hidden=!cur||cur.list.length<2;
 if(cur){$('candidate').replaceChildren(...cur.list.map((r,i)=>{const o=document.createElement('option');o.value=r.id;o.textContent=`${i===0?'Smallest':'Alternative '+i} · Ø ${(2*r.radius*state[state.grid].side).toFixed(1)} mm`;o.selected=r.id===cur.record.id;return o;}));}
 $('empty').hidden=!!cur;$('preview').hidden=!cur;$('download').disabled=!cur;$('error').hidden=true;
 if(!cur){$('empty').textContent=`Search for a verified ${state[state.grid].count}-chip layout.`;for(const id of ['height','layers','batch'])$(id).textContent='—';$('dimensions').textContent='';$('copy-count').textContent='';$('depth-note').textContent='';if(!searching)$('search-status').textContent=stopMessage||'No layout saved for this count yet.';return;}
 try{
  const p=plan(cur.model,settings());draw(cur.model,p);
  $('height').innerHTML=`${p.height.toFixed(2)} <small>mm</small>`;$('layers').innerHTML=`${p.layers} <small>× ${state.stock.toFixed(3)}</small>`;$('batch').innerHTML=`${p.batchGrams.toLocaleString(undefined,{maximumFractionDigits:3})} <small>g</small>`;
  $('dimensions').textContent=`${p.nominalBounds.width.toFixed(1)} × ${p.nominalBounds.height.toFixed(1)} mm · enclosing Ø ${p.diameter.toFixed(1)} mm`;
  $('copy-count').textContent=`Cut ${p.layers} identical ${p.layers===1?'copy':'copies'}`;
  $('depth-note').textContent=`Stack: ${p.stack.toFixed(3)} mm. Required depth ≈ ${(p.height+state.headroom).toFixed(2)} mm including ${state.headroom.toFixed(1)} mm headroom. Pour ${p.batchGrams.toLocaleString(undefined,{maximumFractionDigits:3})} g; do not fill to the rim.`;
  $('kerf-note').textContent=state.kerf?`SVG: outer outline only, offset outward ${Number((state.kerf/2).toFixed(4))} mm. Disable any additional kerf compensation in the laser software.`:'SVG: nominal outer outline only. Enter your measured full kerf here, or compensate in the laser software—not both.';
  if(!searching)$('search-status').textContent=stopMessage||`${cur.model.cells.length} cells · connected · no holes · all cut endpoints marked.`;
 }catch(e){$('error').textContent=e.message;$('error').hidden=false;$('download').disabled=true;$('preview').replaceChildren();for(const id of ['height','layers','batch'])$(id).textContent='—';$('dimensions').textContent='';$('copy-count').textContent='';$('depth-note').textContent='';}
}
function stopSearch(message=true){if(worker)worker.terminate();worker=null;searching=false;clearTimeout(watchdog);watchdog=null;$('stop').hidden=true;$('search').disabled=false;runId++;if(message){stopMessage='Stopped. Completed, verified layouts kept.';render();}}
function budgetWatch(seconds){clearTimeout(watchdog);watchdog=setTimeout(()=>{stopSearch(false);stopMessage='Search exceeded its time budget and was stopped. Verified results kept.';render();},(seconds+12)*1000);}
$('stop').addEventListener('click',()=>stopSearch(true));
$('search').addEventListener('click',()=>{
 stopSearch(false);stopMessage='';const id=++runId,grid=state.grid,count=state[grid].count,seed=crypto.getRandomValues(new Uint32Array(1))[0];
 searching=true;$('stop').hidden=false;$('search').disabled=true;$('search-status').textContent='Loading local browser solver…';
 worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});budgetWatch(30);
 worker.onmessage=({data})=>{if(data.id!==id||id!==runId)return;
  if(data.type==='trial'){budgetWatch(data.seconds);$('search-status').textContent=`Searching ${data.trial}/${data.trials} · up to ${data.seconds}s this attempt…`;}
  if(data.type==='result'){
   if(data.cells){try{const rec=addCandidate(grid,data.cells,{seed,trial:data.trial,...data.info});const list=cache.get(cacheKey(grid,count));state[grid].selected=list[0].id;persist();render();$('search-status').textContent=`Attempt ${data.trial}: verified · Ø ${(rec.radius*2*state[grid].side).toFixed(1)} mm`;}catch(e){$('search-status').textContent='Rejected candidate: '+e.message;}}
   else $('search-status').textContent=`Attempt ${data.trial}: no verified candidate (${data.info.status}).`;
  }
  if(data.type==='done'){stopSearch(false);stopMessage=current()?'Search complete. Smallest verified layout selected; alternatives are kept.':'No layout found within the search bounds and time limit. Try more time, a larger margin, or less central core.';render();}
  if(data.type==='error'){stopSearch(false);stopMessage='Search failed: '+data.message;render();}
 };
 worker.onerror=e=>{stopSearch(false);stopMessage='Solver could not run: '+e.message;render();};
 worker.postMessage({id,grid,count,seed,trials:state.trials,seconds:state.seconds,coreFraction:state.core/100,margin:state.margin});
});
$('download').addEventListener('click',async()=>{
 const cur=current();if(!cur)return;
 const name=`jellychips-${state.grid}-${cur.model.cells.length}-side-${state[state.grid].side.toFixed(1)}mm-kerf-${state.kerf.toFixed(2)}mm.svg`;
 let handle;
 if(window.showSaveFilePicker&&isSecureContext){try{handle=await showSaveFilePicker({suggestedName:name,types:[{description:'Laser outline SVG',accept:{'image/svg+xml':['.svg']}}]});}catch(e){if(e.name==='AbortError')return;}}
 try{const source=svgExport(cur.model,settings());if(handle){const stream=await handle.createWritable();await stream.write(source);await stream.close();}else{const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}
 catch(e){$('error').textContent='Export failed: '+e.message;$('error').hidden=false;}
});
render();
// Read-only geometry hook for bounded browser QA; no server or account state.
window.jellychipApp={getState:()=>structuredClone(state),getCurrent:()=>current()?.model,getPlan:()=>current()?plan(current().model,settings()):null,getSvg:()=>current()?svgExport(current().model,settings()):null,isSearching:()=>searching};
