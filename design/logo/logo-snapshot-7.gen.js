// "Lego" logo: AGENT and MANAGER interlock.
//  - letters in a row are packed a uniform seam apart
//  - the row boundary is stepped: a block of MANAGER letters rises into a notch in AGENT (like a stud),
//    and AGENT's letter seams are nudged sideways so the steps land exactly on MANAGER's seams
const opentype = require('opentype.js'), fs = require('fs');
const P = Object.assign({sans:'bowlby-one-latin-400-normal.woff', script:'lobster-latin-400-normal.woff', word:'Delux',
  seam:8, S2:72, border:16, tooth:19, aFill:0.85, tStem:1.7, gSquare:0.9, gBlock:1, gSlit:0.1, gStem:0.72, gT:[0.3,0.27,0.27], gR:[1,1], aH:1, blend:0.5, fill:14, dS:74, dGap:10, dRot:-6, dHalo:16, blue:'#2563eb',
  aStep:[0,1,2,3], mStep:[0,2,3,5],          // step after AGENT letter aStep[n] lines up with step after MANAGER letter mStep[n]
  up:[1,0,1,0,1]}, JSON.parse(process.argv[3]||'{}'));   // per zone: 1 = MANAGER rises / AGENT shortens
const sans = opentype.loadSync(P.sans), script = opentype.loadSync(P.script);
const r = n => +n.toFixed(2);

function sample(path){const pts=[];let sx=0,sy=0,px=0,py=0;
  const line=(x0,y0,x1,y1)=>{const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)));for(let i=1;i<=n;i++)pts.push([x0+(x1-x0)*i/n,y0+(y1-y0)*i/n]);};
  for(const c of path.commands){
    if(c.type==='M'){sx=px=c.x;sy=py=c.y;pts.push([px,py]);}
    else if(c.type==='L'){line(px,py,c.x,c.y);px=c.x;py=c.y;}
    else if(c.type==='Q'){let lx=px,ly=py;for(let i=1;i<=12;i++){const t=i/12,u=1-t;const x=u*u*px+2*u*t*c.x1+t*t*c.x,y=u*u*py+2*u*t*c.y1+t*t*c.y;line(lx,ly,x,y);lx=x;ly=y;}px=c.x;py=c.y;}
    else if(c.type==='C'){let lx=px,ly=py;for(let i=1;i<=12;i++){const t=i/12,u=1-t;const x=u*u*u*px+3*u*u*t*c.x1+3*u*t*t*c.x2+t*t*t*c.x,y=u*u*u*py+3*u*u*t*c.y1+3*u*t*t*c.y2+t*t*t*c.y;line(lx,ly,x,y);lx=x;ly=y;}px=c.x;py=c.y;}
    else if(c.type==='Z'){line(px,py,sx,sy);px=sx;py=sy;}
  }return pts;}
function flat(path){const out=[];let cur=null;for(const c of path.commands){if(c.type==="M"){cur={commands:[]};out.push(cur);}cur.commands.push(c);}return out.map(sample);}
function minDist(a,b,dx){let m=1e9;for(const p of a)for(const q of b){const d=(q[0]+dx-p[0])**2+(q[1]-p[1])**2;if(d<m)m=d;}return Math.sqrt(m);}
const EM=(()=>{const p=sans.charToGlyph("E").getPath(0,0,1000),pts=sample(p),b=p.getBoundingBox(),H=b.y2-b.y1;
  const xs=b.x1+(b.x2-b.x1)*0.72,ys=[...new Set(pts.filter(q=>Math.abs(q[0]-xs)<1.5).map(q=>Math.round(q[1])))].sort((a,c)=>a-c).filter((y,i,A)=>!i||y-A[i-1]>8);
  const ym=(ys[1]+ys[2])/2,row=pts.filter(q=>Math.abs(q[1]-ym)<1.5).map(q=>q[0]);
  return {top:(ys[1]-ys[0])/H,slit:((ys[2]-ys[1])+(ys[4]-ys[3]))/2/H,bottom:(ys[5]-ys[4])/H,stem:(Math.max(...row)-Math.min(...row))/H,n:ys.length};})();
console.error("E metrics",JSON.stringify(EM));
// N's left stem width, as a fraction of cap height
let NSTEM_R=0;const NSTEM=(()=>{const p=sans.charToGlyph("N").getPath(0,0,1000),pts=sample(p),b=p.getBoundingBox(),H=b.y2-b.y1,y=b.y2-H*0.12;
  const xs=[...new Set(pts.filter(q=>Math.abs(q[1]-y)<1.5).map(q=>Math.round(q[0])))].sort((a,c)=>a-c).filter((x,i,A)=>!i||x-A[i-1]>8);const yt=b.y1+H*0.12,xr=[...new Set(pts.filter(q=>Math.abs(q[1]-yt)<1.5).map(q=>Math.round(q[0])))].sort((a,c)=>a-c).filter((x,i,A)=>!i||x-A[i-1]>8);NSTEM_R=(xr[xr.length-1]-xr[xr.length-2])/H;return (xs[1]-xs[0])/H;})();
console.error("N stem",NSTEM,NSTEM_R);
// Reshape letters so they fill their box and meet their neighbours along straight sides.
//  A: sides pulled out toward vertical (aFill 1 = fully upright sides)
//  T: stem flares out toward the bottom to fill the space under the arms
function shape(ch,p,adj=1){const pts=sample(p),b=p.getBoundingBox(),cx=(b.x1+b.x2)/2,h=b.y2-b.y1;
  const widthAt=y=>{const row=pts.filter(q=>Math.abs(q[1]-y)<1.5).map(q=>q[0]);return Math.max(...row)-Math.min(...row);};
  let f=null;
  if(ch==='A'&&P.aFill){const ratio=widthAt(b.y1+h*0.06)/widthAt(b.y2-1);   // width near the apex / width at the feet
    const k=Math.max(0,(1-ratio)/0.94)*P.aFill;f=(x,y)=>cx+(x-cx)/(1-k*(b.y2-y)/h);}
  if(ch==='T'&&P.tStem>1){let yj=b.y1;while(yj<b.y2&&widthAt(yj)>0.7*(b.x2-b.x1))yj+=1;   // where the arms end
    const half=widthAt(b.y2-2)/2+2;f=(x,y)=>(y>=yj-3&&Math.abs(x-cx)<=half)?cx+(x-cx)*((P.tTop??P.tStem)+(P.tStem-(P.tTop??P.tStem))*Math.max(0,Math.min(1,(y-yj)/(b.y2-yj)))):x;}   // thicker stem, straight sides
  if(ch==='G'&&P.gBlock){   // redraw G as a block letter in the font's weight: heavy strokes, thin slots, soft corners
    const gu=sans.charToGlyph('G').getPath(0,0,1).getBoundingBox(),eu=sans.charToGlyph('E').getPath(0,0,1).getBoundingBox(),sc=h/(gu.y2-gu.y1);
    const B={x1:b.x1,x2:b.x2,y1:eu.y1*sc,y2:eu.y2*sc},H=B.y2-B.y1;   // same height as the flat letters (no round-letter overshoot)
    const w=B.x2-B.x1,g=H*EM.slit,tx=H*NSTEM*adj,txr=H*NSTEM_R*adj,tt=H*EM.top,tbm=H*EM.bottom,yb=B.y1+tt+g,tb=H-tt-tbm-2*g,xc=B.x1+tx+g;
    const pts=[[B.x1,B.y1],[B.x2,B.y1],[B.x2,B.y1+tt],[B.x1+tx,B.y1+tt],[B.x1+tx,B.y2-tbm],[B.x2-txr,B.y2-tbm],[B.x2-txr,yb+tb],[xc,yb+tb],[xc,yb],[B.x2,yb],[B.x2,B.y2],[B.x1,B.y2]];
    const cmds=[],n=pts.length;for(let i=0;i<n;i++){const q=pts[i],pr=pts[(i+n-1)%n],nx=pts[(i+1)%n],l1=Math.hypot(q[0]-pr[0],q[1]-pr[1]),l2=Math.hypot(nx[0]-q[0],nx[1]-q[1]),d=Math.min(P.gR[[3,4,5].includes(i)?1:0],l1/2,l2/2);
      const s1=[q[0]+(pr[0]-q[0])*d/l1,q[1]+(pr[1]-q[1])*d/l1],s2=[q[0]+(nx[0]-q[0])*d/l2,q[1]+(nx[1]-q[1])*d/l2];
      cmds.push({type:i?'L':'M',x:s1[0],y:s1[1]},{type:'Q',x1:q[0],y1:q[1],x:s2[0],y:s2[1]});}
    p.commands=[...cmds,{type:'Z'}];return;}
  if(ch==='G'&&P.gSquare){const cy=(b.y1+b.y2)/2,rx=(b.x2-b.x1)/2,ry=h/2;   // push the round bowl out toward a square
    const sq=(x,y)=>{const u=(x-cx)/rx,v=(y-cy)/ry,m=Math.max(Math.abs(u),Math.abs(v));if(m<1e-6)return [x,y];const d=Math.hypot(u,v),w=Math.max(0,Math.min(1,(d-0.72)/0.28)),k=1+P.gSquare*w*(d/m-1),cl=t=>Math.max(-1,Math.min(1,t));return [cx+cl(u*k)*rx,cy+cl(v*k)*ry];};
    for(const c of p.commands)for(const suf of ['','1','2'])if('x'+suf in c){const q=sq(c['x'+suf],c['y'+suf]);c['x'+suf]=q[0];c['y'+suf]=q[1];}}
  if(f)for(const c of p.commands){if('x' in c)c.x=f(c.x,c.y);if('x1' in c)c.x1=f(c.x1,c.y1);if('x2' in c)c.x2=f(c.x2,c.y2);}}
function pack(str,size,seam,adj=[]){const gs=[...str].map((ch,ci)=>{const g=sans.charToGlyph(ch),base=g.getPath(0,0,size);shape(ch,base,adj[ci]);const pts=sample(base);return {base,pts,adv:g.advanceWidth*size/sans.unitsPerEm,lo:Math.min(...pts.map(p=>p[0])),hi:Math.max(...pts.map(p=>p[0]))};});
  const xs=[0];
  for(let i=1;i<gs.length;i++){let x=xs[i-1]+gs[i-1].adv+seam;
    for(;;){const nx=x-0.25;let ok=true;for(let j=Math.max(0,i-2);j<i&&ok;j++)if(minDist(gs[j].pts,gs[i].pts,nx-xs[j])<seam)ok=false;if(!ok)break;x=nx;}
    xs.push(x);}
  const x1=gs[0].lo+xs[0],x2=Math.max(...gs.map((o,i)=>o.hi+xs[i]));
  const seams=gs.slice(0,-1).map((o,i)=>((o.hi+xs[i])+(gs[i+1].lo+xs[i+1]))/2-x1);   // midpoints between neighbours
  return {gs,xs,x1,width:x2-x1,seams};}
function outer(path){const subs=[];let cur=null;for(const c of path.commands){if(c.type==='M'){cur=[];subs.push(cur);}cur.push(c);}
  const area=s=>{let x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;for(const c of s)if('x' in c){x1=Math.min(x1,c.x);x2=Math.max(x2,c.x);y1=Math.min(y1,c.y);y2=Math.max(y2,c.y);}return (x2-x1)*(y2-y1);};
  const p=new opentype.Path();p.commands=subs.sort((a,b)=>area(b)-area(a))[0];return p.toPathData(2);}
// place letter i of a packed word, mapping each point through fn(x,y,i) -> [x,y]
const place=(w,scale,fn)=>w.gs.map((o,i)=>{const p=new opentype.Path();p.commands=o.base.commands.map(c=>{const n={...c};
  for(const [kx,ky] of [['x','y'],['x1','y1'],['x2','y2']])if(kx in n){const q=fn((n[kx]+w.xs[i]-w.x1)*scale,n[ky]*scale,i);n[kx]=q[0];n[ky]=q[1];}return n;});
  const polys=flat(p),ar=q=>{const xs=q.map(v=>v[0]),ys=q.map(v=>v[1]);return (Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys));};
  return {d:p.toPathData(2),hull:outer(p),polys,hullPoly:polys.slice().sort((a,b)=>ar(b)-ar(a))[0]};});

const cap=-sans.charToGlyph('E').getPath(0,0,1).getBoundingBox().y1;
let m=pack('MANAGER',P.S2,P.seam), a=pack('AGENT',P.S2,P.seam);
const tw=m.width,k=tw/a.width,capO=P.S2*k*cap,capA=capO*P.aH,capM=P.S2*cap;
// zones: which step-zone each letter is in
const zoneOf=(i,steps)=>steps.filter(s=>i>s).length;
// sideways remap so AGENT's stepped seams sit on MANAGER's
const from=[0,...P.aStep.map(s=>a.seams[s]*k),tw], mFrom=[0,...P.mStep.map(s=>m.seams[s]),tw], bl=j=>Array.isArray(P.blend)?(P.blend[j-1]??0.5):P.blend,to=from.map((f,j)=>f*(1-bl(j))+mFrom[j]*bl(j));   if(P.eqEnds){const w=(to[1]+tw-to[4])/2;to[1]=w;to[4]=tw-w;console.log("seams",to.map(v=>(v/tw).toFixed(3)).join(" "));} if(P.eqGN){const e=to[3]-to[2],w=(to[4]-to[1]-e)/2;to[2]=to[1]+w;to[3]=to[2]+e;}
const mk=fr=>x=>{let j=0;while(j<fr.length-2&&x>fr[j+1])j++;return to[j]+(x-fr[j])*(to[j+1]-to[j])/(fr[j+1]-fr[j]);};const remap=mk(from),remapM=mk(mFrom);
// second pass: letters get stretched sideways by different amounts, so pre-correct each G's stem to end up as wide as its row's N stem
const zs=fr=>fr.slice(1).map((f,j)=>(to[j+1]-to[j])/(f-fr[j])),aZ=zs(from),mZ=zs(mFrom),adjA=[],adjM=[];
adjA[1]=aZ[zoneOf(3,P.aStep)]/aZ[zoneOf(1,P.aStep)];adjM[4]=mZ[zoneOf(2,P.mStep)]/mZ[zoneOf(4,P.mStep)];
a=pack('AGENT',P.S2,P.seam,adjA);m=pack('MANAGER',P.S2,P.seam,adjM);
console.error('A seams',a.seams.map(x=>r(x*k/tw)).join(' '),'| M seams',m.seams.map(x=>r(x/tw)).join(' '));console.error('MANAGER zone stretch:',mFrom.slice(1).map((f,j)=>r((to[j+1]-to[j])/(f-mFrom[j]))).join(' '));console.error('AGENT zone stretch:',from.slice(1).map((f,j)=>r((to[j+1]-to[j])/(f-from[j]))).join(' '));
const edge=z=>capA+(P.up[z]?-P.tooth:(Array.isArray(P.toothDn)?P.toothDn[z]:(P.toothDn??P.tooth)));       // AGENT's bottom edge in zone z
const y2=capA+P.tooth+P.seam+capM;                    // MANAGER baseline
const A=place(a,k,(x,y,i)=>[remap(x),(y+capO)*edge(zoneOf(i,P.aStep))/capO]);
const M=place(m,1,(x,y,i)=>{const top=edge(zoneOf(i,P.mStep))+P.seam;return [remapM(x),top+(y+capM)/capM*(y2-top)];});
// script word, parked below the block for now
const dw=script.getAdvanceWidth(P.word,P.dS),yb=P.dPos?P.dPos[1]:y2+P.border/2+P.dGap+P.dS*0.78,C=P.dPos?P.dPos[0]:tw/2;
const delP=script.getPath(P.word,C-dw/2,yb,P.dS),del=delP.toPathData(2);
const rot=`rotate(${P.dRot} ${r(C)} ${r(yb-18)})`;
const pad=P.border/2+6;
// view box grows to hold the script word wherever it sits
const th=P.dRot*Math.PI/180,dq=flat(delP).flat().map(([x,y])=>[C+(x-C)*Math.cos(th)-(y-(yb-18))*Math.sin(th),(yb-18)+(x-C)*Math.sin(th)+(y-(yb-18))*Math.cos(th)]),hp=P.dHalo/2+6;
const vx1=Math.min(-pad,Math.min(...dq.map(q=>q[0]))-hp),vx2=Math.max(tw+pad,Math.max(...dq.map(q=>q[0]))+hp),vy2=Math.max(y2+pad,Math.max(...dq.map(q=>q[1]))+hp);
const H=r(vy2+pad),VW=r(vx2-vx1);
// join: fill the pockets between the wordmark backing and the tag halo
let joinD="";{const xs=dq.map(q=>q[0]),xa=Math.max(0,Math.ceil(Math.min(...xs))),xb=Math.min(Math.floor(tw),Math.floor(Math.max(...xs))),top=y2-P.fill,lim=y2+P.border/2+(P.joinMax??22),pr=[];
  for(let x=xa;x<=xb;x++){let m=1e9;for(const q of dq)if(Math.abs(q[0]-x)<=5&&q[1]<m)m=q[1];pr.push([x,m]);}
  let run=[];const out=()=>{if(run.length>1)joinD+="M"+r(run[0][0])+" "+r(top)+"H"+r(run[run.length-1][0])+run.slice().reverse().map(p=>"L"+r(p[0])+" "+r(p[1]+1)).join("")+"Z";run=[];};
  for(const p of pr){if(p[1]>top&&p[1]<lim)run.push(p);else out();}out();}
if(P.dump)fs.writeFileSync(P.dump,JSON.stringify({tw,y2,border:P.border,halo:P.dHalo,fill:P.fill,rot:P.dRot,C,yb,letters:[...A,...M].map(o=>o.polys),hulls:[...A,...M].map(o=>o.hullPoly),delux:flat(delP)}));
const grp=(arr,word)=>arr.map((o,i)=>`    <path id="${word}-${i+1}" d="${o.d}"/>`).join('\n');
fs.writeFileSync(process.argv[2],`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(vx1)} ${-pad} ${VW} ${H}" fill="currentColor" role="img" aria-label="Agent Manager Delux">
  <title>Agent Manager Delux</title>
  <g id="backing" fill="#333" stroke="#333" stroke-width="${P.border}" stroke-linejoin="round">
    <path d="M${P.fill} ${P.fill}H${r(tw-P.fill)}V${r(y2-P.fill)}H${P.fill}Z"/>
${[...A,...M].map(o=>`    <path d="${o.hull}"/>`).join(' ')}
${joinD?`    <path id="tag-join" stroke="none" d="${joinD}"/>`:""}
  </g>
  <g id="wordmark">
${grp(A,'agent')}
${grp(M,'manager')}
  </g>
${P.patchFile?`  <path id="cleanup" fill="#333" d="${fs.readFileSync(P.patchFile,"utf8")}"/>
`:""}  <path id="delux-outline" fill="#333" stroke="#333" stroke-width="${P.dHalo}" stroke-linejoin="round" transform="${rot}" d="${del}"/>
  <path id="delux" fill="${P.blue}" transform="${rot}" d="${del}"/>
</svg>
`);
