/* One split-patch bank for the browser keyboard and Logic's DLSMusicDevice. */
(function(root){'use strict';
const asset='vendor/solstice-keys/',logicName='Logic Pro Virtual In';
function bind({route,patch,preview,connect,input,message,saved,save}){
 let book,bookTask,slug,program=0,mode='off',epoch=0,ctx,synth,synthTask,midi,accessTask,source,dest,portEpoch=0;
 let timers=[];
 const info=s=>{message.textContent=s;message.hidden=!s;};
 const noteName=n=>['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][n%12]+(Math.floor(n/12)-1);
 function describe(p){
  if(!p?.zones.length)return 'No keyboard in this arrangement';
  if(p.zones.length===2)return 'Upper sound begins at '+noteName(p.zones[1].lo)+' (MIDI '+p.zones[1].lo+')';
  const z=p.zones[0];return z.lo!=null&&z.hi!=null?noteName(z.lo)+' to '+noteName(z.hi):p.label;
 }
 function send(bytes){
  if(mode==='browser')synth?.sendMessage(bytes);
  else if(mode==='logic'&&dest?.state==='connected')dest.send(bytes);
 }
 function release(){
  timers.forEach(clearTimeout);timers=[];
  send([0xb0,64,0]);send([0xb0,120,0]);
 }
 function apply(){
  release();
  for(const b of [[0xb0,0,0],[0xb0,32,0],[0xc0,program]])send(b);
  const p=book?.patches[program];
  patch.title=describe(p);preview.title='Audition '+(p?.label||'keyboard patch');
  preview.disabled=!p?.zones.length; // A tacit patch must actually be silent.
 }
 function choices(){
  const ids=book?.songs[slug]||[];
  program=ids.includes(saved(slug))?saved(slug):ids[0]??0;
  patch.replaceChildren(...ids.map(id=>new Option(book.patches[id].label,id)));
  patch.value=String(program);patch.disabled=ids.length<2;apply();
 }
 function choose(id){
  slug=id;
  if(book){choices();return;}
  bookTask??=fetch('full-practice-keys.json').then(r=>{if(!r.ok)throw Error('Keyboard patch list unavailable');return r.json();})
   .then(b=>{book=b;choices();}).catch(e=>{bookTask=null;info(e.message);});
 }
 async function browserSound(){
  if(!ctx||ctx.state==='closed')ctx=new AudioContext({latencyHint:'interactive'});
  const resumed=ctx.resume();
  if(!synthTask)synthTask=(async()=>{
   const [mod,,sf]=await Promise.all([import('./vendor/solstice-keys/synth.js'),ctx.audioWorklet.addModule(asset+'processor.js'),
    fetch(asset+'solstice-keys.sf2').then(r=>{if(!r.ok)throw Error('Keyboard sound bank unavailable');return r.arrayBuffer();})]);
   const engine=new mod.WorkletSynthesizer(ctx);
   try{await engine.soundBankManager.addSoundBank(sf,'solstice');await engine.isReady;engine.connect(ctx.destination);synth=engine;}
   catch(e){engine.destroy();throw e;}
  })().catch(e=>{synthTask=null;throw e;});
  await Promise.all([resumed,synthTask]);
 }
 function detach(){
  if(source){source.onmidimessage=null;void source.close().catch(()=>{});source=null;}
 }
 function attach(port){
  if(source===port)return;release();detach();source=port;if(!source)return;
  source.onmidimessage=e=>{
   if(mode!=='browser'||!synth)return;
   const [s,a,b]=e.data,k=s&240;
   if([128,144,160,208,224].includes(k)||(k===176&&[1,7,11,64,66,67,120,123].includes(a)))send([k,...e.data.slice(1)]);
  };
 }
 let lastInput='';
 async function ports(){
  if(!midi)return;
  if(mode==='logic'){
   const port=[...midi.outputs.values()].find(p=>p.name===logicName&&p.state==='connected');
   if(!port){++portEpoch;dest=null;info('Logic MIDI input is offline');return;}
   if(dest===port)return;
   const token=++portEpoch;await port.open();if(token!==portEpoch||mode!=='logic')return;
   dest=port;info('');apply();return;
  }
  if(mode!=='browser')return;
  const available=[...midi.inputs.values()].filter(p=>p.state==='connected'&&!/^(Logic Pro Virtual Out|IAC Driver)/i.test(p.name));
  const selected=available.find(p=>p.id===lastInput)||(!lastInput&&available.length===1?available[0]:null);
  input.replaceChildren(new Option('Choose MIDI input',''),...available.map(p=>new Option(p.name,p.id)));
  input.value=selected?.id||'';input.hidden=!available.length;connect.hidden=!!available.length;
  attach(selected||null);if(selected){lastInput=selected.id;info('');}else if(!available.length)info('No MIDI keyboard connected');
 }
 async function access(){
  if(!navigator.requestMIDIAccess)throw Error('Web MIDI is unavailable in this browser');
  if(!midi){accessTask??=navigator.requestMIDIAccess({sysex:false}).catch(e=>{accessTask=null;throw e;});
   midi=await accessTask;midi.onstatechange=e=>{if(e.port?.state==='disconnected'||e.port?.connection==='closed'||e.port?.state==='connected')void ports().catch(e=>info(e.message));};}
  await ports();
 }
 async function activate(next){
  const token=++epoch;++portEpoch;release();detach();const old=dest;dest=null;if(old)void old.close().catch(()=>{});
  mode=route.value=next;info('');connect.hidden=mode!=='browser';input.hidden=true;
  if(mode!=='browser'&&ctx?.state==='running')void ctx.suspend().catch(()=>{});
  try{
   if(mode==='browser'){info('Loading keyboard...');await browserSound();if(token!==epoch)return;info('');apply();if(midi)await ports();}
   else if(mode==='logic')await access();
  }catch(e){if(token===epoch){info(e.message);if(mode==='logic'){mode=route.value='off';}}}
 }
 route.onchange=()=>void activate(route.value);
 patch.onchange=()=>{program=Number(patch.value);save(slug,program);apply();};
 connect.onclick=()=>{void access().catch(e=>info(e.message));};
 input.onchange=()=>{lastInput=input.value;attach(midi?.inputs.get(lastInput)||null);};
 preview.onclick=async()=>{
  const id=slug,n=program;
  if(mode==='off')await activate('browser');else if(mode==='browser'){try{await browserSound();}catch(e){info(e.message);return;}}
  if(id!==slug||program!==n||mode==='off'||(mode==='logic'&&!dest))return;
  release();const notes=book.patches[n].zones.map((z,i)=>Math.max(z.lo??0,Math.min(z.hi??127,i?76:60)));
  notes.forEach((key,i)=>{timers.push(setTimeout(()=>send([0x90,key,90]),i*420),setTimeout(()=>send([0x80,key,0]),i*420+340));});
 };
 window.addEventListener('pagehide',()=>{void activate('off');});
 return {choose};
}
root.MeleteFullPracticeKeys={bind};
})(globalThis);
