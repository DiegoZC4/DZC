/* The full-song studio prefers a real, explicitly chosen input, never loopback. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MeleteFullPracticeInput=api;})(globalThis,function(){
 'use strict';
 const samson=d=>/samson|g[ -]?track/i.test(d.label||'');
 const virtual=d=>/blackhole|loopback|soundflower/i.test(d.label||'');
 const inputs=devices=>devices.filter(d=>d.kind==='audioinput'&&d.deviceId&&!['default','communications'].includes(d.deviceId));
 function preferred(devices,device='',explicit=false,allowOther=false){
  const list=inputs(devices);
  if(explicit)return device? devices.find(d=>d.kind==='audioinput'&&d.deviceId===device)||null : {deviceId:'',label:'System default'};
  return list.find(samson)||(allowOther&&list.find(d=>d.label&&!virtual(d)))||
   (allowOther&&devices.find(d=>d.kind==='audioinput'&&d.deviceId==='default'&&d.label&&!virtual(d)))||null;
 }
 async function acquire(media,constraints,{device='',explicit=false,allowOther=false,selected=()=>{}}={}){
  if(!media?.getUserMedia)throw Error('Microphone access requires HTTPS or localhost.');
  let devices=await media.enumerateDevices(),choice=preferred(devices,device,explicit,allowOther),probe=null;
  try{
   // A permission-only probe reveals device labels. It is never connected to
   // the recorder, detector, meter or speakers and is always stopped.
   if(!choice&&!explicit&&!devices.some(d=>d.kind==='audioinput'&&d.label)){
    probe=await media.getUserMedia({...constraints,audio:{...constraints.audio,deviceId:undefined}});
    devices=await media.enumerateDevices();choice=preferred(devices,device,explicit,allowOther);
   }
   if(!choice)throw Error(explicit||allowOther?'No available microphone. Choose a connected input.':'Samson / G-Track is not connected. Check its USB connection or choose another input.');
  }finally{probe?.getTracks().forEach(t=>t.stop());}
  const audio={...constraints.audio};delete audio.deviceId;
  if(choice.deviceId)audio.deviceId={exact:choice.deviceId};
  const stream=await media.getUserMedia({...constraints,audio,video:false});
  const track=stream.getAudioTracks()[0];
  if(!track||!explicit&&virtual(track)){
   stream.getTracks().forEach(t=>t.stop());throw Error('Virtual loopback input was blocked. Choose Samson or another microphone.');
  }
  selected(choice.deviceId||'',track.label||choice.label);
  return stream;
 }
 return {samson,virtual,inputs,preferred,acquire};
});
