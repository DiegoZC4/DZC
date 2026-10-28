import loadHighs from './vendor/highs.mjs';
import {solveTrial} from './search.mjs';
import {cart,random} from './math.mjs';

self.onmessage=async({data})=>{
 const {id,grid,count,seed,trials=3,seconds=12,coreFraction=.35,margin=2}=data;
 try{
  postMessage({id,type:'loading'});
  const highs=await loadHighs({locateFile:file=>new URL('./vendor/'+file,import.meta.url).href,print:()=>{},printErr:()=>{}}),rng=random(seed);
  const phases=grid==='square'?[[0,0],[.5,.5],[0,.5]]:[[0,0],[1/3,1/3],[.5,0]];
  // Cycle the starting lattice phase between runs; later trials sample freely.
  const start=Math.floor(rng()*3);
  for(let i=0;i<trials;i++){
   const phase=i<3?phases[(i+start)%3]:[rng(),rng()],center=cart(phase,grid),trialSeed=Math.floor(rng()*4294967296);
   postMessage({id,type:'trial',trial:i+1,trials,seconds});
   const result=solveTrial(highs,{grid,count,seed:trialSeed,center,seconds,coreFraction,margin});
   postMessage({id,type:'result',trial:i+1,info:result.info,cells:result.model?.cells??null});
  }
  postMessage({id,type:'done'});
 }catch(e){postMessage({id,type:'error',message:e.message||String(e)});}
};
