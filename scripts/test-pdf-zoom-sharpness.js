const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:n=>n in mocks?mocks[n]:require(n),console,Date,setTimeout,clearTimeout});return exports;}
const G=load('src/features/viewer/pdfTileGeometry.ts'),S=load('src/features/viewer/renderScheduler.ts'),W=load('src/features/viewer/pdfWork.ts',{'./renderScheduler':S});
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
const defer=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}};
function bounds(t){assert(t);assert(t.pxW<=16384&&t.w<=4096&&t.h<=4096&&t.w*t.h<=12e6);assert(t.x>=0&&t.y>=0&&t.x+t.w<=t.pxW);}
for(const [width,height,dpr] of [[1024,1366,2],[1280,800,2],[412,915,2.625],[1440,2960,4],[3200,3000,3]])for(let zoom=1;zoom<=5;zoom+=.25){
 const pageW=width-28,pageH=pageW*1.414,screenX=-pageW*zoom*.32,screenY=-pageH*zoom*.25;
 const t=G.viewportPageTile({pageW,pageH,zoom,screenX,screenY,viewportW:width,viewportH:height,dpr});bounds(t);
 const left=-screenX/(pageW*zoom),top=-screenY/(pageH*zoom),right=Math.min(1,(width-screenX)/(pageW*zoom)),bottom=Math.min(1,(height-screenY)/(pageH*zoom));
 assert(t.nx<=left+1e-12&&t.ny<=top+1e-12);assert(t.nx+t.nw>=right-1e-12&&t.ny+t.nh>=bottom-1e-12,'must retain full viewport at limits');
 if(pageW*zoom*dpr<16384&&width*dpr<4094&&height*dpr<4094&&width*height*dpr*dpr<11980000)assert(Math.abs(t.pxW-pageW*zoom*dpr)<1.01,'native DPR, not bulk2400 cap');
 assert.equal(W.readingPixels(pageW),Math.min(1200,Math.max(300,Math.ceil(pageW/300)*300)));
}
assert.equal(G.viewportPageTile({pageW:600,pageH:800,zoom:2,screenX:900,screenY:0,viewportW:600,viewportH:800,dpr:2}),undefined);
let slots=[],pos=0,effects=[],allowed=true,pageIndex=0,tile=G.boundedPageTile(1200,1600,0,0,600,400,2),calls=[],failures=[];
const R={useState:init=>{const i=pos++;if(!(i in slots))slots[i]=init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},useRef:init=>{const i=pos++;return slots[i]??(slots[i]={current:init})},useContext:()=>allowed,useEffect:(fn,deps)=>{const i=pos++,old=slots[i];if(!old||deps.some((v,k)=>v!==old.deps[k])){old?.cleanup?.();const entry={deps};slots[i]=entry;effects.push(()=>entry.cleanup=fn())}}};
const jsx=(type,props,key)=>({type,props,key});
const P=load('src/features/viewer/PdfPage.tsx',{'react':R,'./nativePageView':load('src/features/viewer/nativePageView.ts'),'./tileProgress':load('src/features/viewer/tileProgress.ts'),'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Image:'Image',Platform:{OS:'web'},PixelRatio:{get:()=>2}},'../../../modules/pdf-renderer':{PdfRenderer:{hasRenderRegion:()=>true,renderRegion:async(...args)=>{const d=defer();calls.push({args,...d});return d.promise},takeRenderTimings:async()=>[]}},'@/theme':{},'@/lib/diag':{reportError(){}},'./renderScheduler':S,'./pdfWork':W,'./pdfDiagnostics':{createPreparationReporter:()=>()=>{},createImageLoadReporter:()=>({})},'./PdfImageLayers':{},'./pageQuality':{PageQualityContext:{}},'./pdfTileGeometry':G});
const render=()=>{pos=0;const out=P.TileLayer({uri:'doc',index:pageIndex,tile,width:600,height:800,onFailure:k=>failures.push(k)});effects.splice(0).forEach(f=>f());return out.props.children};
(async()=>{
 // Priority idle resolves even while a speculative native job is active, but waits urgent reads.
 const q=S.createRenderScheduler(),g=defer();q.acquire('prefetch',2,()=>g.promise);let idle=false;q.whenIdle(1).then(()=>idle=true);await flush();assert(idle);const read=defer();q.acquire('visible',-1,()=>read.promise);idle=false;q.whenIdle(1).then(()=>idle=true);await flush();assert(!idle);g.resolve('p');await flush();assert(!idle);read.resolve('r');await flush();assert(idle);
 render();await flush();assert.equal(calls.length,1);calls[0].resolve('tileA');await flush();let images=render();assert.equal(images[0].props.style.opacity,0);images[0].props.onLoad();images=render();assert.equal(images[0].props.style.opacity,1);
 // Motion retains the decoded tile, no per-frame region renders.
 allowed=false;tile=G.boundedPageTile(1200,1600,100,100,700,500,2);images=render();await flush();assert.equal(calls.length,1);assert.equal(images[0].props.source.uri,'tileA');allowed=true;render();await flush();calls[1].resolve('tileB');await flush();images=render();assert.equal(images.length,2);const staleB=images[1];assert.equal(images[0].props.style.opacity,1);
 // Decode failure preserves prior sharp tile and reports exact failed crop for full fallback.
 staleB.props.onError();assert.equal(failures[0],G.pageTileKey(tile));images=render();assert.equal(images.length,1);assert.equal(images[0].props.source.uri,'tileA');
 // A -> B -> A rejects first A's late Image callback even with identical URI/index.
 pageIndex=1;render();await flush();pageIndex=0;render();await flush();images=render();assert.equal(images[0].props.source.uri,'tileB');staleB.props.onLoad();assert.equal(render()[0].props.style.opacity,0);calls[2].resolve('pageB');await flush();assert.equal(render()[0].props.style.opacity,0);images=render();images[0].props.onLoad();assert.equal(render()[0].props.style.opacity,1);
 // A loaded -> another page with NO loaded replacement -> A with exact same cached URI.
 const loadedA = render()[0]; pageIndex=2;assert.equal(render().length,0);await flush();assert.equal(calls.length,4);
 pageIndex=0;render();await flush();images=render();assert.equal(images.length,1);assert.equal(images[0].props.source.uri,'tileB');assert.equal(images[0].props.style.opacity,0,'old-session same URI must not suppress fresh Image/onLoad');
 loadedA.props.onLoad();assert.equal(render()[0].props.style.opacity,0);images=render();images[0].props.onLoad();assert.equal(render()[0].props.style.opacity,1);
 calls[3].resolve('unused-page2');await flush();assert.equal(render()[0].props.source.uri,'tileB');
 // A current-session same URI cache hit needs neither a new decode nor a stranded pending state.
 allowed=false;render();allowed=true;render();await flush();images=render();assert.equal(images.length,1);assert.equal(images[0].props.style.opacity,1);assert.equal(slots[2],null,'same decoded URI must clear/no-op pending');assert.equal(calls.length,4);
 console.log('PASS: actual native-DPR geometry iPad/Android zoom1..5, all native bounds and coverage; priority idle; actual TileLayer decode retention, motion, failure and ABA callbacks');
})().catch(e=>{console.error(e);process.exitCode=1});
