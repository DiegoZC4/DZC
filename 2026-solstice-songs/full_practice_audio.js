/* Full-length multistem adapter using the audition player's Signalsmith processor. */
(function(root){'use strict';
class Deck{
 constructor(context,output=context.destination){this.context=context;this.output=output;this.buffers=[];this.ids=[];this.nodes=[];this.gains=[];this.worklets=[];this.token=0;this.rate=1;this.shift=0;}
 setBuffers(buffers,ids,concertIds=[]){this.clear();this.buffers=buffers;this.ids=ids;this.concertIds=new Set(concertIds);}
 semitones(id){return id==='drums'?0:this.concertIds?.has(id)?this.keyShift:this.shift;}
 async prepare(rate,shift,relative=false,tuningCents=0){if(!(rate>=(relative ? .25 : .5)&&rate<=(relative?4:2)&&Number.isInteger(shift)&&Math.abs(shift)<=(relative?24:12)&&Number.isFinite(tuningCents)&&Math.abs(tuningCents)<=50))throw Error('Invalid speed, transposition or tuning.');this.stop();const key=`${rate}/${shift}/${tuningCents}`;if(this.prepared===key)return;this.closeWorklets();const token=++this.token;this.rate=rate;this.keyShift=shift;this.shift=shift+tuningCents/100;
  if(rate!==1||this.shift!==0){const {default:create}=await import('./vendor/SignalsmithStretch.js');try{for(const buffer of this.buffers){const node=await create(this.context,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[buffer.numberOfChannels]});if(token!==this.token){node.port.close();throw new DOMException('Canceled','AbortError');}this.worklets.push(node);await node.configure({preset:'default'});const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i).slice());await node.addBuffers(channels,channels.map(c=>c.buffer));}}catch(e){this.closeWorklets();throw e;}}
  if(token!==this.token)throw new DOMException('Canceled','AbortError');this.prepared=key;
 }
 start(at,offset,duration,mix,loop=false,loopStart=0){this.stop();this.gains=this.buffers.map((buffer,i)=>{const g=this.context.createGain();g.gain.value=mix[i].on?mix[i].level:0;g.connect(this.output);const n=this.worklets[i]||this.context.createBufferSource();n.connect(g);if(this.worklets[i]){void n.start({active:true,output:at,input:offset,rate:this.rate,semitones:this.semitones(this.ids[i]),formantSemitones:0,formantCompensation:this.ids[i]==='vocals'&&this.shift!==0,formantBaseHz:0,loopStart,loopEnd:loop?duration:0});if(!loop)g.gain.setValueAtTime(0,at+(duration-offset)/this.rate);}else{n.buffer=buffer;n.loop=loop;n.loopStart=loopStart;n.loopEnd=duration;n.start(at,offset);if(!loop)n.stop(at+(duration-offset)/this.rate);this.nodes.push(n);}return g;});}
 mix(values){this.gains.forEach((g,i)=>g.gain.setTargetAtTime(values[i].on?values[i].level:0,this.context.currentTime,.01));}
 stop(){for(const n of this.nodes){try{n.stop();}catch{}n.disconnect();}this.nodes=[];for(const n of this.worklets){void n.stop();n.disconnect();}this.gains.forEach(g=>g.disconnect());this.gains=[];}
 closeWorklets(){this.worklets.forEach(n=>{n.disconnect();n.port.close();});this.worklets=[];this.prepared=null;}
 clear(){this.token++;this.stop();this.closeWorklets();this.buffers=[];}
}
root.MeleteFullPracticeAudio={Deck};
})(globalThis);
