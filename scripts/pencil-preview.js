const fs=require('fs'),vm=require('vm'),ts=require(require('path').resolve('node_modules/typescript'));
function load(file){const src=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};vm.runInNewContext(src,{exports,require:n=>require(n),console,Math,WeakMap,Map});return exports;}
const ink=load(process.argv[2]);
function word(x0,y0,amp,pmax,tilt){const pts=[];for(let i=0;i<=160;i++){const t=i/160;const x=x0+t*60+Math.sin(t*Math.PI*6)*4;const y=y0+Math.cos(t*Math.PI*6)*amp*(0.6+0.4*Math.sin(t*3));const p=pmax*(0.35+0.65*Math.sin(Math.PI*t));pts.push({x,y,p,t:tilt});}return pts;}
const strokes=[];const rows=[[0.15,0],[0.35,0],[0.7,0],[0.35,1.25]];
rows.forEach((r,i)=>strokes.push({pts:word(10,20+i*22,6,r[0],r[1]),w:1.2}));
strokes.push({pts:Array.from({length:40},(_,k)=>({x:10+70*k/39,y:110+2*k/39,p:.25+.5*k/39})),w:1.2});
// goodnotes-like sine wave, no pressure data, width 2.4
strokes.push({pts:Array.from({length:120},(_,k)=>({x:95+80*k/119,y:40+12*Math.sin(k/119*Math.PI*1.6)})),w:2.4});
const S=6;let body='';
for(const st of strokes){const L=ink.pencilLayers(st.pts,st.w,false);body+=`<path d="${L.core}" fill="#1C1C1E" fill-opacity="${0.8*0.4}"/><path d="${L.streaks}" fill="none" stroke="#1C1C1E" stroke-width="${L.streakW}" stroke-linecap="round" stroke-opacity="${0.8*0.36}"/><path d="${L.light}" fill="#1C1C1E" fill-opacity="${0.8*0.42}"/><path d="${L.dark}" fill="#1C1C1E" fill-opacity="${0.8*0.6}"/>`;}
let pen='';for(let n=1;n<=6;n++){const pts=Array.from({length:n},(_,k)=>({x:100+n*12+k*0.3,y:115}));pen+=`<path d="${ink.penOutline(pts,1,true,'pen')}" fill="#172033"/>`;}
pen+=`<path d="${ink.penOutline(Array.from({length:30},(_,k)=>({x:100+k*0.9,y:105})),1,true,'pen')}" fill="#172033"/>`;
console.log(`<svg xmlns="http://www.w3.org/2000/svg" width="${190*S}" height="${125*S}" style="background:#fbfaf6"><g transform="scale(${S})">${body}${pen}</g></svg>`);
