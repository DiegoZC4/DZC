/* One paragraph per slide; the same markup is used for the reader and rich copy. */
(function(root){
'use strict';
const audience={mixed:'Sing along on bold lines',all:'Sing along throughout',solo:'Solo throughout',reference:'Section cues'};
const escape=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const md=text=>text.replace(/[\\*_`<>\[\]]/g,'\\$&');
function slideText(slide,format){
 return slide.flatMap(([text,,join])=>text.split('\n').map(line=>{
  if(format==='html')return join?'<strong>'+escape(line)+'</strong>':escape(line);
  if(format==='md')return join?'**'+md(line)+'**':md(line);
  return line;
 })).join(format==='html'?'<br>':format==='md'?'  \n':'\n');
}
function songText(edition,format){
 if(edition.externalLyrics)return format==='md'?'[Official lyrics]('+edition.externalLyrics+')':edition.externalLyrics;
 return edition.slides.map(s=>format==='html'?'<p>'+slideText(s,format)+'</p>':slideText(s,format)).join('\n\n');
}
function setMarkdown(book,choices={}){
 return book.songs.map(s=>{
  const ref=Object.hasOwn(s.editions,choices[s.id])?choices[s.id]:s.default;
  const e=s.editions[ref];
  return '# '+s.title+'\n<!-- '+audience[e.mode]+'. -->\n\n'+songText(e,'md');
 }).join('\n\n')+'\n';
}
function render(body,edition,seek,clockMatches){
 const doc=body.ownerDocument,fragment=doc.createDocumentFragment(),rows=[];
 if(edition.externalLyrics){
  const link=doc.createElement('a');link.href=edition.externalLyrics;link.textContent='Official lyrics';
  link.target='_blank';link.rel='noopener noreferrer';fragment.append(link);
  for(const [title,t] of edition.sections){
   const p=doc.createElement('p'),b=doc.createElement('button');b.type='button';b.className='singer-line';
   b.textContent=Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0')+'  '+title;
   b.disabled=!clockMatches;
   if(clockMatches){b.dataset.time=t;b.onclick=()=>seek(t);rows.push({at:t,el:b});}
   p.append(b);fragment.append(p);
  }
  body.replaceChildren(fragment);body.scrollTop=0;return rows;
 }
 if(clockMatches)for(const at of [0,...edition.gaps])rows.push({at,el:null});
 for(const slide of edition.slides){
  const p=doc.createElement('p');p.className='singer-slide';
  slide.forEach(([text,at,join],i)=>{
   if(i)p.append(doc.createElement('br'));
   const line=doc.createElement('span');line.className='singer-line';
   const ink=join?doc.createElement('strong'):line;
   text.split('\n').forEach((t,j)=>{if(j)ink.append(doc.createElement('br'));ink.append(t);});
   if(join)line.append(ink);
   if(clockMatches&&Number.isFinite(at)){
    line.tabIndex=0;line.setAttribute('role','button');line.dataset.time=at;
    line.title='Jump to this line';
    line.onclick=()=>{if(doc.getSelection()?.isCollapsed!==false)seek(at);};
    line.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();seek(at);}};
    rows.push({at,el:line});
   }
   p.append(line);
  });
  fragment.append(p);
 }
 body.replaceChildren(fragment);body.scrollTop=0;
 return rows.sort((a,b)=>a.at-b.at);
}
async function copyLyrics(edition,doc){
 const html=songText(edition,'html'),plain=songText(edition,'plain'),win=doc.defaultView;
 if(win.ClipboardItem&&win.navigator.clipboard?.write){
  try{
   await win.navigator.clipboard.write([new win.ClipboardItem({
    'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})
   })]);return true;
  }catch{/* Sandboxed or older browsers may only support the synchronous copy event. */}
 }
 let wrote=false;
 const handler=e=>{if(e.clipboardData){e.preventDefault();e.clipboardData.setData('text/html',html);e.clipboardData.setData('text/plain',plain);wrote=true;}};
 doc.addEventListener('copy',handler);
 try{return doc.execCommand('copy')&&wrote;}finally{doc.removeEventListener('copy',handler);}
}
const api={audience,songText,setMarkdown,render,copyLyrics};
root.MeleteFullPracticeSinger=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
