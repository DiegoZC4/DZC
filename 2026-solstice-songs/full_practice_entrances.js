/* Shared band directions and a separate, recording-bound personal annotation layer. */
(function(root){
'use strict';
const names={bass:'Bass',drums:'Drums',piano:'Piano',guitar:'Guitar','guitar-diego':'Diego on guitar','guitar-mark':'Mark on guitar',violin:'Violin'};
function bind({body,position,fit}){
 const doc=body.ownerDocument,$=id=>doc.getElementById(id),dialog=$('entranceEditor'),button=$('leadAnnotate');
 const measure=$('entranceMeasure'),beat=$('entranceBeat'),choices=$('entranceChoices'),status=$('entranceStatus');
 let sheet,key,storeKey,bars=new Map(),cues=new Map(),selected=null;
 const first=b=>b.pickupAt??0;
 const valid=(bar,n)=>Number.isFinite(n)&&n>=first(bar)&&n<bar.beats&&(n===first(bar)||Number.isInteger(2*n));
 const address=(m,b)=>m+':'+b,order=Object.keys(names);
 function icon(part){
  const i=doc.createElement('span');i.className='entrance-icon';i.setAttribute('aria-hidden','true');
  i.dataset.part=part;
  const art=part.startsWith('guitar-')?'guitar':part;
  i.style.setProperty('--entrance-art','url("vendor/entrance-icons/'+art+'.svg")');return i;
 }
 function partNames(row){return row.parts.map(p=>names[p]).join(' + ');}
 function printed(m){
  const cell=body.querySelector('.lead-bar[data-measures~="'+m+'"]');
  const index=cell.dataset.measures.split(' ').indexOf(String(m));
  return {lane:cell.querySelector('.lead-entrance-items'),pass:cell.dataset.passes?JSON.parse(cell.dataset.passes)[index]:''};
 }
 function bandPlan(plan){
  if(!plan)return;
  const group=doc.createDocumentFragment(),roster=doc.createElement('dl');
  roster.className='lead-players';roster.setAttribute('aria-label','Band assignments');
  const parts=new Set([...plan.prelude,...plan.cues].flatMap(row=>row.parts));
  for(const [name,role] of plan.players){
   const pair=doc.createElement('div'),who=doc.createElement('dt'),what=doc.createElement('dd');
   who.textContent=name;what.textContent=role;
   const guitar='guitar-'+name.toLowerCase();if(parts.has(guitar))who.prepend(icon(guitar));
   pair.append(who,what);roster.append(pair);
  }
  group.append(roster);
  if(plan.prelude.length){
   const list=doc.createElement('ol');list.className='lead-prelude';list.setAttribute('aria-label','Before the written music');
   for(const row of plan.prelude){
    const li=doc.createElement('li'),phase=doc.createElement('strong'),art=doc.createElement('span');
    phase.textContent=row.phase;art.className='lead-prelude-icons';art.setAttribute('role','img');
    art.setAttribute('aria-label',partNames(row));art.title=partNames(row);
    art.append(...row.parts.map(icon));li.append(phase,art,doc.createTextNode(row.text));list.append(li);
   }
   group.append(list);
  }
  body.querySelector('.lead-overview').after(group);
  for(const row of plan.cues){
   const bar=bars.get(row.measure),start=first(bar),b=doc.createElement('button'),caption=doc.createElement('span');
   b.type='button';b.className='lead-band-cue';b.dataset.beat=row.beat-1;
   b.dataset.fraction=(row.beat-1-start)/(bar.beats-start);
   b.title=partNames(row)+': '+row.text+' (m'+row.measure+', beat '+row.beat+')';
   b.setAttribute('aria-label',b.title);b.setAttribute('aria-expanded','false');
   caption.className='lead-band-caption';
   if(row.beat!==start+1)caption.append(doc.createTextNode(row.beat+' '));
   caption.append(...row.parts.map(icon));
   const note=doc.createTextNode(' '+row.text);caption.append(note);b.append(caption);
   b.onclick=e=>{
    e.stopPropagation();const expand=b.getAttribute('aria-expanded')==='false';
    b.setAttribute('aria-expanded',String(expand));note.textContent=' '+(expand?partNames(row)+': ':'')+row.text;fit();
   };
   const {lane,pass}=printed(row.measure);
   if(pass)caption.prepend(doc.createTextNode(pass+' · '));lane.append(b);
  }
 }
 function items(){
  return [...cues.values()].sort((a,b)=>a.measure-b.measure||a.beat-b.beat);
 }
 function file(){return {version:1,recording:key,sourceVersion:sheet.sourceVersion,cues:items()};}
 function read(data){
  if(data?.version!==1||data.recording!==key||data.sourceVersion!==sheet.sourceVersion||!Array.isArray(data.cues))
   throw Error('Cues do not match this recording.');
  const found=new Map();
  for(const row of data.cues){
   const bar=bars.get(row?.measure);
   if(!bar||!Number.isFinite(row.beat)||!valid(bar,row.beat-1)||!Array.isArray(row.parts)||!row.parts.length||!row.parts.every(p=>order.includes(p)))
    throw Error('Invalid measure, beat or instrument.');
   found.set(address(row.measure,row.beat),{measure:row.measure,beat:row.beat,parts:order.filter(p=>row.parts.includes(p))});
  }
  return found;
 }
 function save(){
  try{if(cues.size)localStorage.setItem(storeKey,JSON.stringify(file()));else localStorage.removeItem(storeKey);status.value='';}
  catch{status.value='Not saved on this device. Download your cues.';}
 }
 function paint(){
  for(const el of body.querySelectorAll('.lead-entrance'))el.remove();
  for(const row of items()){
   const {lane:el,pass}=printed(row.measure);
   const b=doc.createElement('button'),label=row.parts.map(p=>names[p]).join(' + ')+' in';
   const bar=bars.get(row.measure),start=first(bar);
   b.type='button';b.className='lead-entrance';b.dataset.beat=row.beat-1;b.dataset.fraction=(row.beat-1-start)/(bar.beats-start);
   b.title=label+', m'+row.measure+' beat '+row.beat;b.setAttribute('aria-label',b.title);
   if(pass)b.append(doc.createTextNode(pass+' · '));
   if(row.beat!==first(bars.get(row.measure))+1)b.append(doc.createTextNode(row.beat+' '));
   for(const part of row.parts)b.append(icon(part));
   const text=doc.createElement('span');text.className='cue-name';text.textContent=label;b.append(text);
   b.onclick=e=>{e.stopPropagation();selected=[row.measure,row.beat-1];open();};el.append(b);
  }
  fit();
 }
 function fields(){
  const bar=bars.get(selected[0]);measure.value=bar.number;
  const offsets=[first(bar)];for(let n=(Math.floor(first(bar)*2)+1)/2;n<bar.beats;n+=.5)offsets.push(n);
  beat.replaceChildren(...offsets.map(n=>new Option(String(n+1),String(n+1))));beat.value=String(selected[1]+1);
  const row=cues.get(address(bar.number,selected[1]+1));
  for(const b of choices.children)b.setAttribute('aria-pressed',String(!!row?.parts.includes(b.dataset.part)));
  $('entranceExport').disabled=!cues.size;
 }
 function open(){
  if(!sheet)return;
  if(!selected){const t=position(),bar=sheet.bars.find(b=>b.start<=t&&t<b.end)||sheet.bars[0];selected=[bar.number,first(bar)];}
  fields();(doc.fullscreenElement||button.closest('dialog[open]')||doc.body).append(dialog);
  if(!dialog.open)dialog.showModal();measure.focus({preventScroll:true});
 }
 button.onclick=open;measure.onchange=()=>{const b=bars.get(Number(measure.value));selected=[b.number,first(b)];fields();};
 beat.onchange=()=>{selected[1]=Number(beat.value)-1;fields();};
 for(const part of order){
  const b=doc.createElement('button');b.type='button';b.dataset.part=part;b.append(icon(part),doc.createTextNode(names[part]));
  b.onclick=()=>{
   const [m,t]=selected,id=address(m,t+1),parts=new Set(cues.get(id)?.parts);
   if(parts.has(part))parts.delete(part);else parts.add(part);
   if(parts.size)cues.set(id,{measure:m,beat:t+1,parts:order.filter(p=>parts.has(p))});else cues.delete(id);
   save();paint();fields();
  };choices.append(b);
 }
 body.addEventListener('click',e=>{
  const el=e.target.closest('.lead-bar');if(!el||!sheet||e.target.closest('.lead-entrance,.lead-band-cue'))return;
  const bar=bars.get(Number(e.target.closest('[data-performance-measure]')?.dataset.performanceMeasure||el.dataset.currentMeasure)),r=el.getBoundingClientRect(),start=first(bar);
  const anchor=e.target.closest('.lead-words,.lead-chord,.lead-number');
  const exact=anchor?.closest('[data-beat]')?.dataset.beat;
  const raw=exact!=null?Number(exact):anchor||!e.detail?start:start+(bar.beats-start)*(e.clientX-r.left)/r.width;
  selected=[bar.number,Math.min(Math.ceil(bar.beats*2)/2-.5,Math.max(start,Math.round(raw*2)/2))];
 });
 $('entranceClose').onclick=()=>dialog.close();
 dialog.addEventListener('cancel',e=>e.stopPropagation());
 dialog.addEventListener('close',()=>{doc.body.append(dialog);});
 $('entranceExport').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(file(),null,2)],{type:'application/json'})),a=doc.createElement('a');
  a.href=url;a.download=key.replaceAll('/','-')+'-entrances.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
 };
 const input=$('entranceFile');$('entranceImport').onclick=()=>input.click();
 input.onchange=async()=>{
  const f=input.files[0],edition=storeKey;input.value='';if(!f)return;
  try{
   if(f.size>512*1024)throw Error('Cue file is too large.');
   const json=JSON.parse(await f.text());if(edition!==storeKey)return;
   const incoming=read(json);
   for(const [id,row] of incoming){const old=cues.get(id);cues.set(id,{...row,parts:order.filter(p=>row.parts.includes(p)||old?.parts.includes(p))});}
   save();paint();fields();
  }catch(err){status.value=err instanceof SyntaxError?'Invalid cue file.':err.message;}
 };
 function clear(){
  if(dialog.open)dialog.close();sheet=null;key=storeKey=null;bars.clear();cues.clear();selected=null;
  button.disabled=true;status.value='';
 }
 return {clear,mount(data,recording){
  clear();if(!data.bars?.length)return;
  sheet=data;key=recording;storeKey='melete.band.entrances.v1:'+key+':'+sheet.sourceVersion;
  bars=new Map(sheet.bars.map(b=>[b.number,b]));measure.replaceChildren(...sheet.bars.map(b=>new Option(String(b.number),String(b.number))));
  try{const s=localStorage.getItem(storeKey);if(s)cues=read(JSON.parse(s));}catch{status.value='Could not read the saved cues.';}
  bandPlan(sheet.band);button.disabled=false;if(cues.size||sheet.band)paint();
 }};
}
root.MeleteFullPracticeEntrances={bind};
})(globalThis);
