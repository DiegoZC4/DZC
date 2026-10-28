export const key = p => p.join(',');
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
export function squareCells(positions){return positions.map(([i,j])=>[[i,j],[i+1,j],[i+1,j+1],[i,j+1]]);}
export function diamond(r,dx=0,dy=0){const out=[];for(let x=-r;x<=r;x++)for(let y=-r;y<=r;y++)if(Math.abs(x)+Math.abs(y)<=r)out.push([x+dx,y+dy]);return out;}
export function unionPositions(...sets){return [...new Map(sets.flat().map(p=>[key(p),p])).values()];}
export function subtractPositions(a,b){const remove=new Set(b.map(key));return a.filter(p=>!remove.has(key(p)));}
export function hexCluster(r){
 const out=[],corners=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
 for(let q=-r;q<=r;q++)for(let s=-r;s<=r;s++){
  if(Math.max(Math.abs(q),Math.abs(s),Math.abs(q+s))>r)continue;
  const center=[q-s,q+2*s];
  for(let k=0;k<6;k++)out.push([center,...[corners[k],corners[(k+1)%6]].map(p=>[p[0]+center[0],p[1]+center[1]])]);
 }return out;
}
export function analyze(cells,type){
 const edgeMap=new Map(),vertexSet=new Set();
 cells.forEach((cell,ci)=>cell.forEach((p,i)=>{
  vertexSet.add(key(p));const q=cell[(i+1)%cell.length],id=[key(p),key(q)].sort().join('|');
  if(edgeMap.has(id))edgeMap.get(id).owners.push(ci);else edgeMap.set(id,{p,q,owners:[ci]});
 }));
 const edges=[...edgeMap.values()],boundary=edges.filter(e=>e.owners.length===1),interior=edges.filter(e=>e.owners.length===2);
 const neighbors=new Map(),adj=cells.map(()=>[]);
 interior.forEach(e=>{const[a,b]=e.owners;adj[a].push(b);adj[b].push(a);});
 let components=0;const seen=new Set();for(let i=0;i<cells.length;i++){if(seen.has(i))continue;components++;const todo=[i];seen.add(i);while(todo.length){const v=todo.pop();for(const n of adj[v])if(!seen.has(n)){seen.add(n);todo.push(n);}}}
 boundary.forEach(({p,q})=>{for(const[a,b]of[[p,q],[q,p]]){if(!neighbors.has(key(a)))neighbors.set(key(a),[]);neighbors.get(key(a)).push(b);}});
 const corners=new Set(),nonmanifold=[],straight=[];
 neighbors.forEach((ns,id)=>{const p=id.split(',').map(Number);if(ns.length!==2)nonmanifold.push(id);else if(cross(sub(ns[0],p),sub(ns[1],p))!==0)corners.add(id);else straight.push(id);});
 const lineInfo=(p,q)=>{const family=p[1]===q[1]?'h':p[0]===q[0]?'v':'d';if(type==='square'&&family==='d')throw Error('Diagonal square edge');return {family,level:family==='h'?p[1]:family==='v'?p[0]:p[0]+p[1],t:p=>family==='v'?p[1]:p[0]};};
 const groups=new Map();interior.forEach(({p,q})=>{const{family,level,t}=lineInfo(p,q),id=family+':'+level,[a,b]=t(p)<t(q)?[p,q]:[q,p];if(!groups.has(id))groups.set(id,{family,level,t,segments:[]});groups.get(id).segments.push({a,b,t:t(a)});});
 const cuts=[],supportLines=[],strictFailures=[],supportFailures=[];
 groups.forEach(({family,level,t,segments},id)=>{
  segments.sort((a,b)=>a.t-b.t);let run=null;
  for(const seg of segments){if(run&&key(run.b)===key(seg.a))run.b=seg.b;else{if(run)cuts.push(run);run={id,a:seg.a,b:seg.b};}}if(run)cuts.push(run);
  const anchors=[...corners].map(s=>s.split(',').map(Number)).filter(p=>(family==='h'?p[1]:family==='v'?p[0]:p[0]+p[1])===level).sort((a,b)=>t(a)-t(b));
  const min=t(segments[0].a),max=t(segments[segments.length-1].b);
  if(anchors.length<2||t(anchors[0])>min||t(anchors[anchors.length-1])<max)supportFailures.push(id);
  else supportLines.push({id,a:anchors[0],b:anchors[anchors.length-1]});
 });
 for(const cut of cuts)if(!corners.has(key(cut.a))||!corners.has(key(cut.b)))strictFailures.push(cut.id);
 const chi=vertexSet.size-edges.length+cells.length;
 return {type,cells,boundary,interior,corners:[...corners].map(s=>s.split(',').map(Number)),cuts,supportLines,report:{cells:cells.length,components,holes:components-chi,nonmanifold:nonmanifold.length,corners:corners.size,straightVertices:straight.length,strictFailures,supportFailures,cutLines:groups.size,cutSegments:cuts.length}};
}
export function containsCentroid(cell,poly){const p=cell.reduce((a,b)=>[a[0]+b[0]/cell.length,a[1]+b[1]/cell.length],[0,0]);const signs=poly.map((v,i)=>cross(sub(poly[(i+1)%poly.length],v),sub(p,v)));return signs.every(s=>s>=-1e-8)||signs.every(s=>s<=1e-8);}
