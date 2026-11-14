const opentype = require('opentype.js'), fs = require('fs');
const sans = opentype.loadSync('bowlby-one-latin-400-normal.woff');
const script = opentype.loadSync('lobster-latin-400-normal.woff');
const r = n => +n.toFixed(2);
function width(font,str,size,tr=0){let w=0;const g=font.stringToGlyphs(str);g.forEach((x,i)=>{w+=x.advanceWidth*size/font.unitsPerEm+tr;if(i<g.length-1)w+=font.getKerningValue(x,g[i+1])*size/font.unitsPerEm+(({AG:-0.07,NT:-0.015,GE:-0.02})[str[i]+str[i+1]]||0)*size;});return w-tr;}
function text(font,str,size,x,y,tr=0){let d='',cx=x;const g=font.stringToGlyphs(str);g.forEach((x_,i)=>{d+=x_.getPath(cx,y,size).toPathData(2);cx+=x_.advanceWidth*size/font.unitsPerEm+tr;if(i<g.length-1)cx+=font.getKerningValue(x_,g[i+1])*size/font.unitsPerEm+(({AG:-0.07,NT:-0.015,GE:-0.02})[str[i]+str[i+1]]||0)*size;});return d;}
const cap=-sans.charToGlyph("E").getPath(0,0,1).getBoundingBox().y1, S2=72, tr=3;
const tw=width(sans,'MANAGER',S2,tr);
const S1=S2*tw/width(sans,'AGENT',S2,tr);            // fit AGENT to MANAGER's width
const tr1=tr*S1/S2, y1=S1*cap, y2=y1+14+S2*cap, C=tw/2;
const l1=text(sans,'AGENT',S1,0,y1,tr1), l2=text(sans,'MANAGER',S2,0,y2,tr);
const S=74,dw=width(script,'Delux',S),yb=y2+48;
const del=text(script,'Delux',S,C-dw/2,yb);
const rot=`rotate(-6 ${r(C)} ${r(yb-18)})`;
const H=r(yb+32),VW=r(tw+24);
fs.writeFileSync(process.argv[2],`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 ${VW} ${H}" fill="currentColor" role="img" aria-label="Agent Manager Delux">
  <title>Agent Manager Delux</title>
  <defs>
    <mask id="knockout" maskUnits="userSpaceOnUse" x="-12" y="-12" width="${VW}" height="${H}">
      <rect x="-12" y="-12" width="${VW}" height="${H}" fill="#fff"/>
      <path d="${del}" transform="${rot}" fill="#000" stroke="#000" stroke-width="13" stroke-linejoin="round"/>
    </mask>
  </defs>
  <path id="outline" fill="#333" stroke="#333" stroke-width="16" stroke-linejoin="round" d="${l1}${l2}"/>
  <path id="delux-outline" fill="#333" stroke="#333" stroke-width="13" stroke-linejoin="round" transform="${rot}" d="${del}"/>
  <g id="wordmark" mask="url(#knockout)" stroke="currentColor" stroke-width="1" stroke-linejoin="round">
    <path id="agent" d="${l1}"/>
    <path id="manager" d="${l2}"/>
  </g>
  <path id="delux" fill="#2563eb" stroke="#2563eb" stroke-width="2" stroke-linejoin="round" transform="${rot}" d="${del}"/>
</svg>
`);
