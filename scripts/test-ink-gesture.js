// Pure callback tests. Native UIKit/Android arbitration still requires a device.
const fs=require('fs'), vm=require('vm'), ts=require('typescript'), assert=require('node:assert/strict');
const text=fs.readFileSync('src/features/viewer/InkCanvas.tsx','utf8');
const body=text.slice(text.indexOf('  const pan = useMemo('),text.indexOf('  const longPress ='))+'\n globalThis.result = pan;';
function create(OS){
 const callbacks={}, events=[], transitions=[]; let kind;
 const gesture=new Proxy({}, {get:(_,key)=>(...args)=>{ if(key.startsWith('on'))callbacks[key]=args[0]; return gesture; }});
 const ctx={ Platform:{OS}, PointerType:{TOUCH:0,STYLUS:1,MOUSE:2}, Gesture:{Manual:()=>{kind='manual';return gesture}, Pan:()=>{kind='pan';return gesture}}, useMemo:fn=>fn(), enabled:true, handMode:{value:false}, penId:{value:-1}, pressSV:{value:-1}, tiltSV:{value:-1}, penSession:{value:{}}, Date,
 runOnJS:fn=>fn, jsDown:(...a)=>events.push(['down',...a]),jsMove:(...a)=>events.push(['move',...a]),jsUp:(...a)=>events.push(['up',...a]),jsFinish:()=>events.push(['finish']),jsAbort:()=>events.push(['abort']) };
 vm.runInNewContext(ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 const sm={begin:()=>transitions.push('begin'),activate:()=>transitions.push('activate'),end:()=>transitions.push('end'),fail:()=>transitions.push('fail')};
 return {callbacks,events,transitions,ctx,sm,kind};
}
const t=(id,pointerType=0)=>({id,pointerType,x:id*10,y:50,absoluteX:id*10,absoluteY:50});
const event=(changedTouches,allTouches,pointerType=0)=>({changedTouches,allTouches,numberOfTouches:allTouches.length,pointerType});
let g=create('ios'); assert.equal(g.kind,'manual');
g.callbacks.onTouchesDown(event([t(1)],[t(1)]),g.sm); assert.equal(g.events.length,0); assert.equal(g.transitions.length,0);
g.callbacks.onTouchesDown(event([t(2)],[t(1),t(2)]),g.sm); assert.equal(g.events.length,0);
g.callbacks.onTouchesUp(event([t(1)],[]),g.sm); assert.deepEqual(g.transitions,['fail']);
g=create('ios');
// Mixed Pencil and palm batch must capture the Pencil ID even when palm is last and aggregate type is stylus.
g.callbacks.onTouchesDown(event([t(3,1),t(4)],[t(3,1),t(4)],1),g.sm); assert.equal(g.ctx.penId.value,3); assert.deepEqual(g.transitions,['begin','activate']);
g.callbacks.onTouchesUp(event([t(4)],[t(3,1)]),g.sm); assert.equal(g.events.length,1);
g.callbacks.onTouchesMove(event([],[t(3,1)]),g.sm); assert.equal(g.events[1][0],'move');
g.callbacks.onTouchesUp(event([t(3,1)],[t(4)]),g.sm); assert.equal(g.ctx.penId.value,-1);assert.equal(g.ctx.penSession.value.writing,false);assert.deepEqual(g.transitions,['begin','activate','end']);assert.equal(g.events[2][0],'up');
// Repeated strokes: no delayed end/finalize may close the next stroke.
g.callbacks.onFinalize({},true);g.callbacks.onTouchesDown(event([t(5,1)],[t(5,1)],1),g.sm);assert.equal(g.ctx.penId.value,5);
g.callbacks.onTouchesCancelled({},g.sm);assert.equal(g.events.at(-1)[0],'abort');assert.equal(g.transitions.at(-1),'fail');assert.equal(g.ctx.penId.value,-1);
g=create('android');assert.equal(g.kind,'pan');g.callbacks.onTouchesDown(event([t(1)],[t(1)]),g.sm);assert.equal(g.events.length,0);g.callbacks.onTouchesDown(event([t(2,1)],[t(1),t(2,1)],1),g.sm);assert.deepEqual(g.transitions,['activate']);g.callbacks.onTouchesUp(event([t(2,1)],[t(1)],1),g.sm);assert.deepEqual(g.transitions,['activate']);
console.log('PASS: finger-only passthrough, mixed-contact Pencil identification, palm lift, pen lift, repeated strokes, cancellation, Android Pan lifecycle');
