/* Fixed-clock formant estimates in absolute Hz. Runs in the worker and in offline audio tests. */
((root,factory)=>{
  if (typeof module === 'object' && module.exports) module.exports=factory(require('./analysis.js'));
  else root.VowelTracker=factory(root.VowelLab);
})(globalThis, lab=>{
  'use strict';
  const rate=lab.RATE, order=12, tau=2*Math.PI, stepHz=10;
  const model='lpc-envelope-median-v1';
  const median = xs => { const a=xs.slice().sort((x,y)=>x-y), i=a.length>>1; return a.length%2?a[i]:(a[i-1]+a[i])/2; };
  // Evaluate the fitted all-pole envelope on one fixed grid, then refine its local maxima.
  const basis=Array.from({length:431},(_,i)=>Array.from({length:order+1},(_,k)=>[
    Math.cos(tau*i*stepHz*k/rate),Math.sin(tau*i*stepHz*k/rate)]));
  function formants(wave) {
    const x=new Float64Array(wave.length);
    for(let i=1;i<x.length;i++) x[i]=(wave[i]-.97*wave[i-1])*(.54-.46*Math.cos(tau*i/(x.length-1)));
    const corr=new Float64Array(order+1);
    for(let k=0;k<=order;k++) for(let i=k;i<x.length;i++) corr[k]+=x[i]*x[i-k];
    let a=[1], energy=corr[0]*1.000001;
    for(let k=1;k<=order;k++){
      if(!(energy>1e-14)) return null;
      let residual=corr[k];
      for(let j=1;j<k;j++) residual+=a[j]*corr[k-j];
      const reflection=-residual/energy;
      if(Math.abs(reflection)>=1) return null;
      const next=[1];
      for(let j=1;j<k;j++) next[j]=a[j]+reflection*a[k-j];
      next.push(reflection); a=next; energy*=1-reflection**2;
    }
    const db=basis.map(row=>{
      let re=1,im=0;
      for(let k=1;k<=order;k++){re+=a[k]*row[k][0];im+=a[k]*row[k][1];}
      return -10*Math.log10(re*re+im*im);
    });
    const peaks=[];
    for(let i=15;i<db.length-1;i++){
      if(db[i]<=db[i-1]||db[i]<db[i+1]) continue;
      // A broad envelope shoulder has little evidence for a separate resonance.
      const shoulder=Math.min(db[i]-Math.min(...db.slice(Math.max(0,i-35),i)),
        db[i]-Math.min(...db.slice(i+1,Math.min(db.length,i+36))));
      if(shoulder<1.25) continue;
      const fractional=(db[i-1]-db[i+1])/(2*(db[i-1]-2*db[i]+db[i+1]));
      peaks.push((i+fractional)*stepHz);
    }
    const f1=peaks[0], f2=peaks.find(hz=>hz>f1+130 && hz>=lab.F2[0]);
    return f1>=lab.F1[0] && f1<=lab.F1[1] && f2<=lab.F2[1] ? {f1,f2} : null;
  }

  class Contour {
    constructor(){this.reset();}
    reset(){this.history=[];this.point=null;this.last=null;}
    push(pair,t){
      if(this.last!==null && (t<=this.last || t-this.last>200)) this.reset();
      const dt=this.last===null?0:t-this.last;
      this.last=t;
      this.history=this.history.filter(p=>t-p.t<=120);
      if(pair) this.history.push({...pair,t});
      if(!this.history.length || t-this.history.at(-1).t>65){this.reset();return null;}
      if(!this.point && (this.history.length<3 || t-this.history[0].t<38)) return null;
      const target={f1:median(this.history.map(p=>p.f1)),f2:median(this.history.map(p=>p.f2))};
      // A median rejects isolated pole swaps; the time constant does not depend on frame rate.
      const alpha=-Math.expm1(-dt/80);
      this.point=this.point ? Object.fromEntries(['f1','f2'].map(k=>[k,Math.exp(Math.log(this.point[k])+
        alpha*(Math.log(target[k])-Math.log(this.point[k])))])) : target;
      return {...this.point};
    }
  }

  function spectrum(x){
    let n=1;while(n<x.length)n*=2;
    const re=new Float64Array(n),im=new Float64Array(n);
    let windowPower=0,mean=0;for(const s of x)mean+=s/x.length;
    for(let i=0,j=0;i<n;i++){
      if(i<x.length){const w=.5-.5*Math.cos(tau*i/(x.length-1));re[j]=(x[i]-mean)*w;windowPower+=w*w;}
      let bit=n>>1;while(bit && (j&bit)){j^=bit;bit>>=1;}j^=bit;
    }
    for(let size=2;size<=n;size*=2){
      const c=Math.cos(tau/size),s=-Math.sin(tau/size);
      for(let start=0;start<n;start+=size){
        let cr=1,ci=0;
        for(let j=start;j<start+size/2;j++){
          const b=j+size/2, ar=cr*re[b]-ci*im[b],ai=cr*im[b]+ci*re[b];
          re[b]=re[j]-ar;im[b]=im[j]-ai;re[j]+=ar;im[j]+=ai;
          const next=cr*c-ci*s;ci=ci*c+cr*s;cr=next;
        }
      }
    }
    return {bins:re.slice(0,n/2).map((v,i)=>(v*v+im[i]*im[i])/windowPower),n};
  }
  const thresholdDb=15,meterMaxDb=40;
  class Tracker {
    constructor(){this.contour=new Contour();this.last=null;this.rate=0;this.indicated=null;this.pause=[];this.room=0;}
    process(samples,sampleRate,t){
      if(sampleRate!==this.rate || this.last!==null && (t<=this.last || t-this.last>250)){
        this.contour.reset();this.sample=lab.resampler(sampleRate);this.rate=sampleRate;
        this.last=null;this.indicated=null;this.pause=[];this.room=0;
      }
      const dt=this.last===null?0:t-this.last;this.last=t;
      const wave=this.sample(samples), pitch=wave && lab.fundamental(wave);
      let power=0,clipped=0;for(const x of samples){power+=x*x;if(Math.abs(x)>=.995)clipped++;}
      power/=samples.length;
      const {bins,n}=spectrum(samples), bands=[[],[]], counts=[0,0];
      let total=0,bass=0,upper=0;
      for(let i=1;i<bins.length;i++){
        const hz=i*sampleRate/n,band=Number(hz>=1600),p=bins[i];
        total+=p;if(hz<200)bass+=p;if(hz>220 && hz<5000)upper=Math.max(upper,p);
        counts[band]++;
        if(!pitch || Math.abs(hz-pitch*Math.round(hz/pitch))>=Math.min(pitch/4,2*sampleRate/samples.length)) bands[band].push(p);
      }
      const spectral=bands.reduce((sum,band,i)=>{
        if(!band.length)return sum;
        band.sort((a,b)=>a-b);
        return sum+counts[i]*band[Math.floor(.2*(band.length-1))]/(-Math.log(.8)*(bins.length-1));
      },0);
      const hum=pitch && pitch<180 && bass>.8*total && upper<total*.001;
      const quiet=!pitch || hum || spectral>=power/2;
      this.pause.push({t,level:quiet?power:null});
      while(this.pause.length>1 && this.pause[1].t<=t-400) this.pause.shift();
      if(quiet && this.pause[0].t<=t-400){
        const quietLevels=this.pause.map(p=>p.level).filter(x=>x!==null).sort((a,b)=>a-b);
        if(quietLevels.length>=this.pause.length*.75 && quietLevels[Math.floor(quietLevels.length*.8)]<=2*quietLevels[Math.floor(quietLevels.length*.2)])
          this.room=median(quietLevels);
      }
      const noise=Math.max(10**(-6.8),this.room,spectral,hum?power:0);
      const instant=10*Math.log10(Math.max(1,(power-noise)/noise));
      this.indicated=this.indicated===null || instant<this.indicated ? instant : this.indicated+(instant-this.indicated)*-Math.expm1(-dt/25);
      const db=Math.round(this.indicated*10)/10, snr={db,noiseDbfs:10*Math.log10(noise),thresholdDb,meterMaxDb};
      let state=clipped>samples.length*.02?'clipping':db<thresholdDb?(power<1e-6?'silent':'low_snr'):!pitch?'no_vowel':'tracking';
      let raw=null,result=null;
      if(state==='tracking'){
        raw=formants(wave);result=this.contour.push(raw,t);
        if(!result)state='settling';
        else if(pitch>350)state='limited';
        this.limited=state==='limited';
      }else if(state==='no_vowel'){
        result=this.contour.push(null,t);
        if(result)state=this.limited?'limited':'tracking';
      }else this.contour.reset();
      return {state,result,raw,rms:Math.sqrt(power),snr};
    }
  }
  return {model,Tracker,Contour,formants,thresholdDb,meterMaxDb};
});
