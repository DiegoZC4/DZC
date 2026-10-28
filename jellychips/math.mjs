import {analyze, key} from './grid.mjs';

export const EPS=1e-8;
export const areaPerCell=grid=>grid==='square'?1:Math.sqrt(3)/4;
export const cart=(p,grid)=>grid==='square'?[...p]:[p[0]+p[1]/2,p[1]*Math.sqrt(3)/2];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const d2=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;
export function signedArea(p){return p.reduce((s,a,i)=>s+cross(a,p[(i+1)%p.length]),0)/2;}
export function convexHull(points){
 const ps=[...new Map(points.map(p=>[key(p),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 if(ps.length<2)return ps;
 const half=ps=>{const r=[];for(const p of ps){while(r.length>1&&cross(sub(r.at(-1),r.at(-2)),sub(p,r.at(-2)))<=EPS)r.pop();r.push(p);}return r;};
 return [...half(ps).slice(0,-1),...half([...ps].reverse()).slice(0,-1)];
}
export function minimumCircle(points){
 const h=convexHull(points);if(!h.length)throw Error('Empty layout');
 let best=null;
 const consider=(center,support)=>{const r2=d2(center,support[0]);if(best&&r2>=best.r2-EPS)return;if(h.every(p=>d2(center,p)<=r2+EPS))best={center,r2,support};};
 if(h.length===1)best={center:h[0],r2:0,support:h};
 for(let i=0;i<h.length;i++)for(let j=i+1;j<h.length;j++){
  const a=h[i],b=h[j];consider([(a[0]+b[0])/2,(a[1]+b[1])/2],[a,b]);
  for(let k=j+1;k<h.length;k++){
   const c=h[k],u=sub(b,a),v=sub(c,a),det=2*cross(u,v);if(Math.abs(det)<EPS)continue;
   const u2=d2(u,[0,0]),v2=d2(v,[0,0]);
   consider([a[0]+(u2*v[1]-v2*u[1])/det,a[1]+(u[0]*v2-v[0]*u2)/det],[a,b,c]);
  }
 }
 if(!best)throw Error('Circle calculation failed');
 return {center:best.center,radius:Math.sqrt(Math.max(...points.map(p=>d2(p,best.center)))),support:best.support};
}
export function verify(cells,grid,expected=cells.length){
 if(!['square','triangle'].includes(grid)||!Number.isInteger(expected)||expected<1)throw Error('Invalid grid or count');
 const canonical=new Set();
 for(const poly of cells){
  if(poly.length!==(grid==='square'?4:3)||poly.some(p=>p.length!==2||p.some(v=>!Number.isInteger(v))))throw Error('Invalid cell coordinates');
  const ps=poly.map(p=>cart(p,grid));
  if(Math.abs(signedArea(ps)-areaPerCell(grid))>EPS||ps.some((p,i)=>Math.abs(d2(p,ps[(i+1)%ps.length])-1)>EPS))throw Error('Cell is not a counterclockwise unit cell');
  const id=poly.map(key).sort().join('|');if(canonical.has(id))throw Error('Duplicate cell');canonical.add(id);
 }
 const m=analyze(cells,grid),r=m.report;
 if(r.cells!==expected||r.components!==1||r.holes!==0||r.nonmanifold||r.straightVertices||r.strictFailures.length)throw Error('Layout failed exact-count, topology or corner checks');
 // Boundary edges retain the counterclockwise cell orientation.
 const next=new Map(m.boundary.map(e=>[key(e.p),e.q]));
 if(next.size!==m.boundary.length)throw Error('Boundary is not a simple loop');
 const first=m.boundary[0].p,outline=[first];let p=next.get(key(first));
 while(key(p)!==key(first)){outline.push(p);if(outline.length>m.boundary.length)throw Error('Unclosed boundary');p=next.get(key(p));if(!p)throw Error('Broken boundary');}
 if(outline.length!==m.boundary.length)throw Error('Multiple boundary loops');
 const xy=outline.map(p=>cart(p,grid));if(signedArea(xy)<=0)throw Error('Boundary orientation');
 return {...m,outline,circle:minimumCircle(xy)};
}
function onSegment(p,a,b){return Math.abs(cross(sub(p,a),sub(b,a)))<EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;}
export function simplePolygon(poly){
 const n=poly.length;
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  if(j===i+1||(i===0&&j===n-1))continue;
  const a=poly[i],b=poly[(i+1)%n],c=poly[j],d=poly[(j+1)%n];
  const x=cross(sub(b,a),sub(c,a)),y=cross(sub(b,a),sub(d,a)),z=cross(sub(d,c),sub(a,c)),w=cross(sub(d,c),sub(b,c));
  if((x*y<0&&z*w<0)||onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b))return false;
 }return true;
}
export function offsetOutline(poly,outset){
 if(!Number.isFinite(outset)||outset<0)throw Error('Kerf must be nonnegative');
 if(outset===0)return poly.map(p=>[...p]);
 const n=poly.length,normal=(a,b)=>{const e=sub(b,a),l=Math.hypot(...e);return [e[1]/l,-e[0]/l];};
 const out=poly.map((p,i)=>{const a=normal(poly[(i+n-1)%n],p),b=normal(p,poly[(i+1)%n]),den=1+a[0]*b[0]+a[1]*b[1];if(den<EPS)throw Error('Degenerate offset');return [p[0]+outset*(a[0]+b[0])/den,p[1]+outset*(a[1]+b[1])/den];});
 if(!simplePolygon(out)||signedArea(out)<=signedArea(poly))throw Error('Kerf closes a feature; reduce the kerf');
 return out;
}
export function plan(model,{side,mass,density,stock,headroom=0,kerf=0}){
 if(![side,mass,density,stock].every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(headroom)||headroom<0)throw Error('Invalid dimensions');
 if(!Number.isFinite(kerf)||kerf<0||kerf>=side/2)throw Error('Full kerf must be less than half a chip side');
 const footprint=areaPerCell(model.type)*side*side,height=mass/(density*footprint),layers=Math.max(1,Math.ceil((height+headroom)/stock-1e-10));
 const nominal=model.outline.map(p=>cart(p,model.type).map(v=>v*side));
 const toolpath=offsetOutline(nominal,kerf/2),bounds=p=>({width:Math.max(...p.map(v=>v[0]))-Math.min(...p.map(v=>v[0])),height:Math.max(...p.map(v=>v[1]))-Math.min(...p.map(v=>v[1]))});
 return {footprint,height,layers,stack:layers*stock,batchGrams:model.cells.length*mass/1000,nominal,toolpath,nominalBounds:bounds(nominal),cutBounds:bounds(toolpath),diameter:2*model.circle.radius*side};
}
export function svgExport(model,settings){
 const p=plan(model,settings),margin=1,minX=Math.min(...p.toolpath.map(v=>v[0])),maxY=Math.max(...p.toolpath.map(v=>v[1]));
 const path=p.toolpath.map(([x,y],i)=>`${i?'L':'M'}${(x-minX+margin).toFixed(6)},${(maxY-y+margin).toFixed(6)}`).join(' ')+' Z';
 const meta={schema:'jellychip-outline-v1',grid:model.type,count:model.cells.length,...settings,estimatedHeightMM:p.height,masterLayers:p.layers,nominalBoundsMM:p.nominalBounds,cutBoundsMM:p.cutBounds,kerfDefinition:'full cut width; toolpath offset outward by kerf/2; disable duplicate software compensation',note:'One outer cut loop only. Cut the indicated number of identical copies to stack. Height is an estimate; stock thickness is measured separately.'};
 const width=p.cutBounds.width+2*margin,height=p.cutBounds.height+2*margin;
 return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(6)}mm" height="${height.toFixed(6)}mm" viewBox="0 0 ${width.toFixed(6)} ${height.toFixed(6)}">\n<title>${model.cells.length} ${model.type} jellychips, ${settings.side.toFixed(1)} mm sides</title>\n<metadata>${JSON.stringify(meta).replaceAll('&','&amp;').replaceAll('<','&lt;')}</metadata>\n<path d="${path}" fill="none" stroke="#ff0000" stroke-width="0.01"/>\n</svg>\n`;
}
export function fingerprint(cells){const all=cells.flat(),x=Math.min(...all.map(p=>p[0])),y=Math.min(...all.map(p=>p[1]));const text=JSON.stringify(cells.map(poly=>poly.map(p=>[p[0]-x,p[1]-y]).sort((a,b)=>a[0]-b[0]||a[1]-b[1])).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);}
export function random(seed){let t=seed>>>0;return()=>{t+=0x6D2B79F5;let a=Math.imul(t^t>>>15,1|t);a^=a+Math.imul(a^a>>>7,61|a);return ((a^a>>>14)>>>0)/4294967296;};}
