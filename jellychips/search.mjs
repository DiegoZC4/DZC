import {cart,areaPerCell,random,verify} from './math.mjs';
const sq=(x,y)=>[[x,y],[x+1,y],[x+1,y+1],[x,y+1]];
const tris=(x,y)=>[[[x,y],[x+1,y],[x,y+1]],[[x+1,y],[x+1,y+1],[x,y+1]]];
const key=p=>p.join(','),d2=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;

export function buildProblem(count,grid,center,seed,{margin=2,coreFraction=.35}={}){
 if(!Number.isInteger(count)||count<1||count>500)throw Error('Browser search supports 1–500 cells');
 const rng=random(seed),radius=Math.sqrt(count*areaPerCell(grid)/Math.PI)+margin,extent=Math.ceil(2*radius+3),cells=[];
 for(let x=-extent;x<=extent;x++)for(let y=-extent;y<=extent;y++)for(const p of grid==='square'?[sq(x,y)]:tris(x,y))if(Math.max(...p.map(v=>d2(cart(v,grid),center)))<=radius**2+1e-8)cells.push(p);
 if(cells.length<count)throw Error('Search container is too small');
 const n=cells.length,em=new Map(),vm=new Map();
 cells.forEach((poly,i)=>{for(const p of poly){const id=key(p);if(!vm.has(id))vm.set(id,{p,cells:[]});vm.get(id).cells.push(i);}poly.forEach((p,j)=>{const q=poly[(j+1)%poly.length],id=[key(p),key(q)].sort().join('|');if(!em.has(id))em.set(id,{p,q,owners:[]});em.get(id).owners.push(i);});});
 const edges=[...em.values()],verts=[...vm.values()],vi=new Map(verts.map((v,i)=>[key(v.p),i])),adj=edges.filter(e=>e.owners.length===2).map(e=>e.owners),at=verts.map(()=>[]);
 const ob=n,ot=ob+edges.length,ou=ot+verts.length,of=ou+verts.length,orr=of+2*adj.length,size=orr+1;
 const lo=new Float64Array(size),up=new Float64Array(size).fill(1),binary=[...Array(n).keys(),...verts.map((_,i)=>ot+i)];
 up.fill(Math.max(0,count-1),of,orr);up[orr]=radius**2;
 const distances=cells.map(p=>Math.max(...p.map(v=>d2(cart(v,grid),center))));
 const centroids=cells.map(poly=>d2([0,1].map(j=>poly.reduce((s,p)=>s+cart(p,grid)[j],0)/poly.length),center));
 const root=centroids.indexOf(Math.min(...centroids));lo[root]=1;
 const coreR2=count*areaPerCell(grid)*coreFraction/Math.PI;let core=0;
 distances.forEach((d,i)=>{if(d<coreR2){lo[i]=1;core++;}});
 const levels=[...new Set(distances.map(d=>Math.round(d*1e10)/1e10))].sort((a,b)=>a-b);let gap=1;
 for(let i=1;i<levels.length;i++)if(levels[i]-levels[i-1]>1e-8)gap=Math.min(gap,levels[i]-levels[i-1]);
 const eps=gap/(8*count),cost=centroids.map((d,i)=>[i,eps*(.6*d/radius**2+.4*rng())]);cost.push([orr,1]);
 const format=v=>Number(v.toPrecision(13)).toString();
 const expr=terms=>{const t=terms.filter(([,v])=>v!==0);return t.length?t.map(([i,v])=>`${v<0?'-':'+'} ${format(Math.abs(v))} v${i}`).join(' '):'0 v0';};
 const rows=[];let rowId=0;
 const add=(terms,lower=-Infinity,upper=Infinity)=>{const e=expr(terms);if(lower===upper)rows.push(` c${rowId++}: ${e} = ${format(lower)}`);else{if(Number.isFinite(lower))rows.push(` c${rowId++}: ${e} >= ${format(lower)}`);if(Number.isFinite(upper))rows.push(` c${rowId++}: ${e} <= ${format(upper)}`);}};
 add(cells.map((_,i)=>[i,1]),count,count);
 distances.forEach((d,i)=>add([[i,d],[orr,-1]],-Infinity,0));
 edges.forEach((e,i)=>{at[vi.get(key(e.p))].push(i);at[vi.get(key(e.q))].push(i);const bi=ob+i;if(e.owners.length===1)add([[bi,1],[e.owners[0],-1]],0,0);else{const[a,b]=e.owners;add([[bi,1],[a,-1],[b,1]],0);add([[bi,1],[b,-1],[a,1]],0);add([[bi,1],[a,-1],[b,-1]],-Infinity,0);add([[bi,1],[a,1],[b,1]],-Infinity,2);}});
 verts.forEach((v,i)=>{
  add([...at[i].map(e=>[ob+e,1]),[ot+i,-2]],0,0);
  const directions=new Map();
  for(const ei of at[i]){const e=edges[ei],other=key(e.p)===key(v.p)?e.q:e.p,delta=[other[0]-v.p[0],other[1]-v.p[1]],op=directions.get(key(delta.map(x=>-x)));if(op!==undefined)add([[ob+ei,1],[ob+op,1]],-Infinity,1);directions.set(key(delta),ei);}
  for(const ci of v.cells)add([[ou+i,1],[ci,-1]],0);
  add([[ou+i,1],...v.cells.map(ci=>[ci,-1])],-Infinity,0);
 });
 const euler=2+((grid==='square'?4:3)-2)*count;
 add([...verts.map((_,i)=>[ou+i,2]),...edges.map((_,i)=>[ob+i,-1])],euler,euler);
 const balances=cells.map(()=>[]);
 adj.forEach(([a,b],i)=>{[[a,b],[b,a]].forEach(([src,dst],j)=>{const f=of+2*i+j;add([[f,1],[src,-(count-1)]],-Infinity,0);add([[f,1],[dst,-(count-1)]],-Infinity,0);balances[src].push([f,-1]);balances[dst].push([f,1]);});});
 balances.forEach((b,i)=>i===root?add(b,-(count-1),-(count-1)):add([...b,[i,-1]],0,0));
 const bounds=Array.from({length:size},(_,i)=>` ${format(lo[i])} <= v${i} <= ${format(up[i])}`);
 const lp=`Minimize\n obj: ${expr(cost)}\nSubject To\n${rows.join('\n')}\nBounds\n${bounds.join('\n')}\nBinary\n ${binary.map(i=>'v'+i).join(' ')}\nEnd\n`;
 return {lp,cells,meta:{variables:size,rows:rows.length,coreCells:core,center,seed,margin,coreFraction}};
}
export function solveTrial(highs,{count,grid,center,seed,seconds=12,margin=2,coreFraction=.35}){
 const problem=buildProblem(count,grid,center,seed,{margin,coreFraction}),start=performance.now();
 const r=highs.solve(problem.lp,{time_limit:seconds,output_flag:false,mip_rel_gap:.005,random_seed:(seed>>>0)%2147483647});
 const values=problem.cells.map((_,i)=>r.Columns?.['v'+i]?.Primal);
 const info={...problem.meta,status:r.Status,elapsedSeconds:(performance.now()-start)/1000};
 if(values.some(v=>!Number.isFinite(v)||Math.abs(v-Math.round(v))>1e-5))return {info,model:null};
 const selected=problem.cells.filter((_,i)=>values[i]>.5);
 try{return {info,model:verify(selected,grid,count)};}catch(e){return {info:{...info,rejected:e.message},model:null};}
}
