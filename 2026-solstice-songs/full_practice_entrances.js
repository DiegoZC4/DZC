/* Shared band directions and a separate, recording-bound personal annotation layer. */
(function(root){
'use strict';
const names={bass:'Bass',drums:'Drums',piano:'Piano',guitar:'Guitar','guitar-diego':'Diego on guitar','guitar-mark':'Mark on guitar',violin:'Violin'};
const columns=['guitar-diego','violin','piano','guitar-mark','bass','drums'];
function instrumentIcon(doc,part){
 const i=doc.createElement('span');i.className='entrance-icon';i.setAttribute('aria-hidden','true');i.dataset.part=part;
 i.style.setProperty('--entrance-art','url("vendor/entrance-icons/'+(part.startsWith('guitar-')?'guitar':part)+'.svg")');return i;
}
// Resolve each performed pass before folding. A playing direction is not necessarily
// a new entrance; an explicit off can also hand a player to a different instrument.
function playingChart(sheet){
 const plan=sheet.band;if(!plan)return null;
 const used=new Set([...(plan.initial||[]),...plan.prelude.flatMap(c=>c.parts),...plan.cues.flatMap(c=>[...c.parts,...(c.off||[])])]);
 const parts=columns.filter(p=>used.has(p)),bounds=[],byMeasure=new Map(),omissions=new Set(sheet.songbook?.skipSections);
 let at=0,den=4,skip=false;
 for(const b of sheet.bars){
  if(b.meter)den=+b.meter.split('/')[1];
  if(b.sections?.length||b.label)skip=!!b.sections?.length&&b.sections.every(i=>omissions.has(i));
  const start=at,first=b.pickupAt??0,unit=4/den;at+=(b.beats-first)*unit;
  const bar={start,end:at,first,unit,skip,directions:[],entrances:[]};bounds.push(bar);byMeasure.set(b.number,bar);
 }
 const initial=new Set(plan.initial),changes=new Map(parts.map(p=>[p,[]]));
 for(const c of plan.cues){
  const b=byMeasure.get(c.measure),t=b.start+(c.beat-1-b.first)*b.unit;
  b.directions.push(c);
  for(const p of new Set([...c.parts,...(c.off||[])])){
   const list=changes.get(p),on=!c.off?.includes(p);
   if(on!==(list.at(-1)?.on??initial.has(p))){
    list.push({t,on,measure:c.measure,beat:c.beat});
    if(on)b.entrances.push({part:p,measure:c.measure,beat:c.beat,text:c.text});
   }
  }
 }
 function pass(indices){
  const start=bounds[indices[0]].start,end=bounds[indices.at(-1)].end;
  if(indices.every(i=>bounds[i].skip))return parts.map(part=>({part,state:'out',spans:[],detail:'Skip this section live'}));
  return parts.map(p=>{
   const list=changes.get(p),inside=list.filter(e=>e.t>start&&e.t<end);
   let on=list.findLast(e=>e.t<=start)?.on??initial.has(p),from=start;const spans=[];
   for(const e of inside){if(on)spans.push([(from-start)/(end-start),(e.t-start)/(end-start)]);from=e.t;on=e.on;}
   if(on)spans.push([(from-start)/(end-start),1]);
   const state=!spans.length?'out':inside.length?'partial':'in';
   const detail=state==='partial'?[(spans[0][0]===0?'Play from the start':'Start out'),...inside.map(e=>(e.on?'in':'out')+' at m'+e.measure+' beat '+e.beat)].join('; '):state==='in'?'Play throughout':'Stay out';
   return {part:p,state,spans,detail};
  });
 }
 return {parts,pass,isSkipped:i=>bounds[i].skip,entrances:i=>bounds[i].skip?[]:bounds[i].entrances,
  directions:indices=>indices.flatMap(i=>bounds[i].skip?[]:bounds[i].directions)};
}
function barEntrances(doc,chart,choices){
 const frag=doc.createDocumentFragment();
 for(const {i,pass} of choices){
  const entries=chart.entrances(i);if(!entries.length)continue;
  const lane=doc.createElement('span');lane.className='lead-band-in';lane.dataset.measure=entries[0].measure;
  const label=pass.display||pass.label||'',tag=label.replace(/^Verse (\d+)$/i,'V$1').replace(/^Chorus (\d+)$/i,'Ch$1').replace(/^Bridge$/i,'Br');
  if(choices.length>1){const s=doc.createElement('small');s.textContent=tag;lane.append(s);}
  for(const e of entries){
   const name=names[e.part]+' in, m'+e.measure+' beat '+e.beat+(label?' ('+label+')':'')+': '+e.text;
   const mark=doc.createElement('span');mark.className='lead-band-entry';mark.dataset.beat=e.beat;
   mark.setAttribute('role','img');mark.setAttribute('aria-label',name);mark.title=name;
   mark.append(instrumentIcon(doc,e.part));if(e.beat!==1)mark.append(doc.createTextNode(String(e.beat)));lane.append(mark);
  }
  frag.append(lane);
 }
 return frag;
}
function passGrid(doc,chart,rows,title){
 const element=(tag,cls,text)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
 const table=element('table','lead-pass-grid');table.setAttribute('aria-label',title+' instrumentation');
 const header=table.createTHead().insertRow();header.append(element('th'));
 for(const p of chart.parts){const th=element('th');th.scope='col';th.title=names[p];th.setAttribute('aria-label',names[p]);th.append(instrumentIcon(doc,p));header.append(th);}
 const tbody=table.createTBody();
 const states=rows.map(r=>chart.pass(r.indices));
 const ongoing=cell=>cell?.state==='partial'&&cell.spans.length===1&&cell.spans[0][0]>0&&cell.spans[0][1]===1;
 const adjacent=k=>k>=0&&k+1<rows.length&&rows[k].indices.at(-1)+1===rows[k+1].indices[0];
 for(const [ri,{label,short,indices}] of rows.entries()){
  const tr=tbody.insertRow(),th=element('th'),b=element('button','lead-pass-label',short);th.scope='row';
  b.type='button';b.title=label+' instrumentation';b.setAttribute('aria-label',b.title);b.setAttribute('aria-haspopup','dialog');th.append(b);tr.append(th);
  const cells=states[ri];
  for(const [pi,c] of cells.entries()){const td=tr.insertCell();td.dataset.part=c.part;td.dataset.state=c.state;
   td.title=names[c.part]+': '+c.detail;td.setAttribute('aria-label',td.title);
   if(c.state==='out')continue;
   // Between consecutive passes, one check above the next row means “already in”.
   if(ongoing(c)&&adjacent(ri)&&states[ri+1]?.[pi].state==='in')continue;
   const check=element('span','lead-check','✓'),prev=states[ri-1]?.[pi];
   if(ongoing(prev)&&adjacent(ri-1)&&c.state==='in'){
    check.style.setProperty('--jog',String(Math.max(-.70,Math.min(-.22,prev.spans[0][0]-1))));
    check.title=names[c.part]+': '+rows[ri-1].label+': '+prev.detail;
    check.onclick=e=>{e.stopPropagation();tbody.rows[ri-1].querySelector('button').click();};
   }else if(c.state==='partial'){
    check.style.setProperty('--jog',String((c.spans[0][0]||-.5)*.35));
    check.title=td.title;
   }
   td.append(check);
  }
  tr.onclick=e=>{
   e.stopPropagation();
   const dialog=element('dialog','lead-pass-detail'),h=element('h3','',label),close=element('button','','×'),dl=element('dl');
   dialog.setAttribute('aria-label',label+' instrumentation');close.type='button';close.setAttribute('aria-label','Close');close.onclick=()=>dialog.close();
   for(const c of cells)dl.append(element('dt','',names[c.part]),element('dd','',c.detail));
   dialog.append(h,close,dl);
   const cues=chart.directions(indices);
   if(cues.length){
    const list=element('ol','lead-pass-cues');list.setAttribute('aria-label','Playing directions');
    for(const c of cues){
     const li=element('li');li.dataset.measure=c.measure;li.dataset.beat=c.beat;
     li.append(element('b','','m'+c.measure+' beat '+c.beat),element('span','',c.parts.map(p=>names[p]).join(' + ')+': '+c.text));
     list.append(li);
    }
    dialog.append(list);
   }
   (table.closest('dialog[open]')||doc.body).append(dialog);
   dialog.onclose=()=>{dialog.remove();b.focus({preventScroll:true});};dialog.showModal();
  };
 }
 return table;
}
function bind({body,position,fit}){
 const doc=body.ownerDocument,$=id=>doc.getElementById(id),dialog=$('entranceEditor'),button=$('leadAnnotate');
 const measure=$('entranceMeasure'),beat=$('entranceBeat'),choices=$('entranceChoices'),status=$('entranceStatus');
 let sheet,key,storeKey,bars=new Map(),cues=new Map(),selected=null;
 const first=b=>b.pickupAt??0;
 const valid=(bar,n)=>Number.isFinite(n)&&n>=first(bar)&&n<bar.beats&&(n===first(bar)||Number.isInteger(2*n));
 const address=(m,b)=>m+':'+b,order=Object.keys(names);
 const icon=part=>instrumentIcon(doc,part);
 function printed(m){
  const cell=body.querySelector('.lead-bar[data-measures~="'+m+'"]');
  const index=cell.dataset.measures.split(' ').indexOf(String(m));
  return {lane:cell.querySelector('.lead-entrance-items'),pass:cell.dataset.passes?JSON.parse(cell.dataset.passes)[index]:''};
 }
 function bandPlan(plan){
  if(!plan)return;
  const group=doc.createDocumentFragment(),roster=doc.createElement('dl');
  roster.className='lead-players';roster.setAttribute('aria-label','Band assignments');
  for(const [name,role] of plan.players){
   if((name==='Buck'&&role==='Bass')||(name==='Zach'&&role==='Drums'))continue;
   const pair=doc.createElement('div'),who=doc.createElement('dt'),what=doc.createElement('dd');
   who.textContent=name;what.textContent=role;
   pair.append(who,what);roster.append(pair);
  }
  group.append(roster);
  if(plan.prelude.length){
   const list=doc.createElement('ol');list.className='lead-prelude';list.setAttribute('aria-label','Before the written music');
   for(const row of plan.prelude){
    const li=doc.createElement('li'),details=doc.createElement('details'),summary=doc.createElement('summary'),phase=doc.createElement('strong');
    phase.textContent=row.phase;summary.append(phase);summary.title=row.text;details.append(summary,doc.createTextNode(row.text));li.append(details);list.append(li);
   }
   group.append(list);
  }
  body.querySelector('.lead-overview').after(group);
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
   const pen=button.querySelector('svg')?.cloneNode(true);
   if(pen){pen.removeAttribute('id');pen.setAttribute('aria-hidden','true');b.append(pen);}else b.append('✎');
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
  const el=e.target.closest('.lead-bar');if(!el||!sheet||e.target.closest('.lead-entrance,.lead-pass-grid'))return;
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
 function redraw(){bandPlan(sheet.band);if(cues.size)paint();}
 return {clear,redraw,mount(data,recording){
  clear();if(!data.bars?.length)return;
  sheet=data;key=recording;storeKey='melete.band.entrances.v1:'+key+':'+sheet.sourceVersion;
  bars=new Map(sheet.bars.map(b=>[b.number,b]));measure.replaceChildren(...sheet.bars.map(b=>new Option(String(b.number),String(b.number))));
  try{const s=localStorage.getItem(storeKey);if(s)cues=read(JSON.parse(s));}catch{status.value='Could not read the saved cues.';}
  redraw();button.disabled=false;
 }};
}
const api={bind,playingChart,passGrid,barEntrances};root.MeleteFullPracticeEntrances=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
