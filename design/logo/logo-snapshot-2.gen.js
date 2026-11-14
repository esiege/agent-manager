// "Lego" logo: AGENT and MANAGER interlock.
//  - letters in a row are packed a uniform seam apart
//  - the row boundary is stepped: a block of MANAGER letters rises into a notch in AGENT (like a stud),
//    and AGENT's letter seams are nudged sideways so the steps land exactly on MANAGER's seams
const opentype = require('opentype.js'), fs = require('fs');
const P = Object.assign({sans:'bowlby-one-latin-400-normal.woff', script:'lobster-latin-400-normal.woff', word:'Delux',
  seam:8, S2:72, border:16, tooth:12, aFill:0.85, tFlare:0.9, fill:14, dS:74, dGap:10, dRot:-6, dHalo:16, blue:'#2563eb',
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
function minDist(a,b,dx){let m=1e9;for(const p of a)for(const q of b){const d=(q[0]+dx-p[0])**2+(q[1]-p[1])**2;if(d<m)m=d;}return Math.sqrt(m);}
// Reshape letters so they fill their box and meet their neighbours along straight sides.
//  A: sides pulled out toward vertical (aFill 1 = fully upright sides)
//  T: stem flares out toward the bottom to fill the space under the arms
function shape(ch,p){const pts=sample(p),b=p.getBoundingBox(),cx=(b.x1+b.x2)/2,h=b.y2-b.y1;
  const widthAt=y=>{const row=pts.filter(q=>Math.abs(q[1]-y)<1.5).map(q=>q[0]);return Math.max(...row)-Math.min(...row);};
  let f=null;
  if(ch==='A'&&P.aFill){const ratio=widthAt(b.y1+h*0.06)/widthAt(b.y2-1);   // width near the apex / width at the feet
    const k=Math.max(0,(1-ratio)/0.94)*P.aFill;f=(x,y)=>cx+(x-cx)/(1-k*(b.y2-y)/h);}
  if(ch==='T'&&P.tFlare){let yj=b.y1;while(yj<b.y2&&widthAt(yj)>0.7*(b.x2-b.x1))yj+=1;   // where the arms end
    f=(x,y)=>y<=yj+0.5?x:cx+(x-cx)*(1+P.tFlare*(y-yj)/(b.y2-yj));}
  if(f)for(const c of p.commands){if('x' in c)c.x=f(c.x,c.y);if('x1' in c)c.x1=f(c.x1,c.y1);if('x2' in c)c.x2=f(c.x2,c.y2);}}
function pack(str,size,seam){const gs=[...str].map(ch=>{const g=sans.charToGlyph(ch),base=g.getPath(0,0,size);shape(ch,base);const pts=sample(base);return {base,pts,adv:g.advanceWidth*size/sans.unitsPerEm,lo:Math.min(...pts.map(p=>p[0])),hi:Math.max(...pts.map(p=>p[0]))};});
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
  return {d:p.toPathData(2),hull:outer(p)};});

const cap=-sans.charToGlyph('E').getPath(0,0,1).getBoundingBox().y1;
const m=pack('MANAGER',P.S2,P.seam), a=pack('AGENT',P.S2,P.seam);
const tw=m.width,k=tw/a.width,capA=P.S2*k*cap,capM=P.S2*cap;
// zones: which step-zone each letter is in
const zoneOf=(i,steps)=>steps.filter(s=>i>s).length;
// sideways remap so AGENT's stepped seams sit on MANAGER's
const from=[0,...P.aStep.map(s=>a.seams[s]*k),tw], mFrom=[0,...P.mStep.map(s=>m.seams[s]),tw], to=from.map((f,j)=>(f+mFrom[j])/2);   // both rows meet halfway
const mk=fr=>x=>{let j=0;while(j<fr.length-2&&x>fr[j+1])j++;return to[j]+(x-fr[j])*(to[j+1]-to[j])/(fr[j+1]-fr[j]);};const remap=mk(from),remapM=mk(mFrom);
console.error('A seams',a.seams.map(x=>r(x*k/tw)).join(' '),'| M seams',m.seams.map(x=>r(x/tw)).join(' '));console.error('AGENT zone stretch:',from.slice(1).map((f,j)=>r((to[j+1]-to[j])/(f-from[j]))).join(' '));
const edge=z=>capA+(P.up[z]?-P.tooth:P.tooth);       // AGENT's bottom edge in zone z
const y2=capA+P.tooth+P.seam+capM;                    // MANAGER baseline
const A=place(a,k,(x,y,i)=>[remap(x),(y+capA)*edge(zoneOf(i,P.aStep))/capA]);
const M=place(m,1,(x,y,i)=>{const top=edge(zoneOf(i,P.mStep))+P.seam;return [remapM(x),top+(y+capM)/capM*(y2-top)];});
// script word, parked below the block for now
const dw=script.getAdvanceWidth(P.word,P.dS),yb=y2+P.border/2+P.dGap+P.dS*0.78,C=tw/2;
const del=script.getPath(P.word,C-dw/2,yb,P.dS).toPathData(2);
const rot=`rotate(${P.dRot} ${r(C)} ${r(yb-18)})`;
const pad=P.border/2+6,H=r(yb+P.dS*0.3+2*pad),VW=r(tw+2*pad);
const grp=(arr,word)=>arr.map((o,i)=>`    <path id="${word}-${i+1}" d="${o.d}"/>`).join('\n');
fs.writeFileSync(process.argv[2],`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${VW} ${H}" fill="currentColor" role="img" aria-label="Agent Manager Delux">
  <title>Agent Manager Delux</title>
  <g id="backing" fill="#333" stroke="#333" stroke-width="${P.border}" stroke-linejoin="round">
    <path d="M${P.fill} ${P.fill}H${r(tw-P.fill)}V${r(y2-P.fill)}H${P.fill}Z"/>
${[...A,...M].map(o=>`    <path d="${o.hull}"/>`).join(' ')}
  </g>
  <g id="wordmark">
${grp(A,'agent')}
${grp(M,'manager')}
  </g>
  <path id="delux-outline" fill="#333" stroke="#333" stroke-width="${P.dHalo}" stroke-linejoin="round" transform="${rot}" d="${del}"/>
  <path id="delux" fill="${P.blue}" transform="${rot}" d="${del}"/>
</svg>
`);
