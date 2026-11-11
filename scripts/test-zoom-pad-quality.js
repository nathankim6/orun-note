const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict');
const load=(f,req)=>{const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:req||require,setTimeout,clearTimeout});return m.exports};
const geometry=load('src/features/viewer/pdfTileGeometry.ts');
const Q=load('src/features/viewer/zoomPadQuality.ts',n=>n==='./pdfTileGeometry'?geometry:require(n));
const idle=load('src/features/viewer/idleQuality.ts',n=>n==='./pdfWork'?{PDF_DETAIL_IDLE_MS:800}:require(n));
const ok=t=>{assert(t.pxW<=16384&&t.w<=4096&&t.h<=4096&&t.w*t.h<=12e6);assert(t.x>=0&&t.y>=0&&t.x+t.w<=t.pxW+1e-9);assert(Math.abs(t.nx-t.x/t.pxW)<1e-12)};
// geometry: normal case matches DocumentView sampling
let t=Q.zoomPadTile({pageW:600,pageH:800,k:2,padW:600,padH:200,region:{x:100,y:300,w:300},dpr:2});
assert.deepEqual([t.pxW,t.x,t.y,t.w,t.h],[2400,400,1200,1200,400]);assert.equal(t.nx,400/2400);assert.equal(t.nw,0.5);ok(t);
// clamp near page end; region beyond the page is intersected
t=Q.zoomPadTile({pageW:600,pageH:800,k:2,padW:600,padH:200,region:{x:450,y:760,w:300},dpr:2});ok(t);assert.equal(t.x+t.w,t.pxW);assert(t.y+t.h<=Math.round(t.pxW*800/600));
// extreme zoom: scaled uniformly, normalized region unchanged
const big={pageW:600,pageH:800,k:40,padW:3000,padH:3000,region:{x:100,y:100,w:75},dpr:3};
t=Q.zoomPadTile(big);ok(t);assert(t.pxW<=16384);assert(Math.abs(t.nw-3000/(600*40))<2e-3,'nw '+t.nw);assert(Math.abs(t.nx-100*40/24000)<2e-3);
assert.equal(Q.zoomPadTile({...big,padW:0}),undefined);for(const bad of [NaN,Infinity,-Infinity])assert.equal(Q.zoomPadTile({...big,dpr:bad}),undefined);
// key changes on uri/page/region/layout, not on identical inputs
const base={uri:'a',sourceIndex:0,region:{x:1,y:2,w:3},padW:10,height:100,pageW:5,pageH:6},K=Q.zoomPadQualityKey;
assert.equal(K(base),K({...base,region:{...base.region}}));
for(const c of [{uri:'b'},{sourceIndex:1},{region:{x:2,y:2,w:3}},{region:{x:1,y:3,w:3}},{region:{x:1,y:2,w:4}},{padW:11},{height:101},{pageW:6},{pageH:7}])assert.notEqual(K(base),K({...base,...c}));
// idle gate (real createIdleQualityGate): 800 ms, restart on change, wait for pen
let now=0,q=[],busy=false,ready=[];const timers=[];
const gate=idle.createIdleQualityGate({onReady:r=>ready.push(r),isBusy:()=>busy,setTimer:(f,ms)=>{const x={f,at:now+ms};timers.push(x);return x},clearTimer:x=>{x.dead=true}});
const adv=ms=>{const end=now+ms;for(;;){const n=timers.filter(x=>!x.dead&&!x.done&&x.at<=end).sort((a,b)=>a.at-b.at)[0];if(!n)break;now=n.at;n.done=true;n.f()}now=end};
gate.activity();adv(799);assert.deepEqual(ready,[false]);adv(1);assert.deepEqual(ready,[false,true]);
gate.activity();adv(500);gate.activity();adv(799);assert.equal(ready.at(-1),false);adv(1);assert.equal(ready.at(-1),true);
busy=true;gate.activity();adv(800);assert.equal(ready.at(-1),false);adv(1000);assert.equal(ready.at(-1),false);busy=false;adv(250);assert.equal(ready.at(-1),true);
gate.dispose();
// static wiring
const z=fs.readFileSync('src/features/viewer/ZoomPad.tsx','utf8');
for(const s of ['PageQualityContext.Provider value={detailReady}','createIdleQualityGate','penSession.value','ps.writing','tile={tile}','zoomPadTile(','[qualityKey]'])assert(z.includes(s),s);
assert(z.indexOf('<PageQualityContext.Provider')<z.indexOf('<PdfPage')&&z.indexOf('</PageQualityContext.Provider>')>z.indexOf('<PdfPage'));
assert(z.includes('quality.key === qualityKey && quality.ready'), 'changed source/region must disable detail before effects');
console.log('PASS: zoom pad quality geometry, idle/page-change/pen gating and wiring');
