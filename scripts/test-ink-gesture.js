// Pure callback tests. Native UIKit/Android arbitration still requires a device.
const fs=require('fs'), vm=require('vm'), ts=require('typescript'), assert=require('node:assert/strict');
const text=fs.readFileSync('src/features/viewer/InkCanvas.tsx','utf8');
const body=text.slice(text.indexOf('  const pan = useMemo('),text.indexOf('  const longPress ='))+'\n globalThis.result = pan;';
const PEN_BUTTON_BITS=Function('return '+/const PEN_BUTTON_BITS = ([^;]+);/.exec(text)[1])(); assert.equal(PEN_BUTTON_BITS,102,'stylus buttons (32,64) and the generic secondary/tertiary bits (2,4); never the tip bit (1)');
function create(OS){
 const callbacks={}, events=[], transitions=[]; let kind;
 const gesture=new Proxy({}, {get:(_,key)=>(...args)=>{ if(key.startsWith('on'))callbacks[key]=args[0]; return gesture; }});
 const ctx={ PEN_BUTTON_BITS, Platform:{OS}, PointerType:{TOUCH:0,STYLUS:1,MOUSE:2}, Gesture:{Manual:()=>{kind='manual';return gesture}, Pan:()=>{kind='pan';return gesture}}, useMemo:fn=>fn(), enabled:true, handMode:{value:false}, penId:{value:-1}, pressSV:{value:-1}, tiltSV:{value:-1}, penSession:{value:{}}, Date,
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
g.callbacks.onTouchesCancelled({},g.sm);assert.equal(g.events.at(-1)[0],'finish','a cancelled pen stroke is kept, never deleted');assert.equal(g.transitions.at(-1),'fail');assert.equal(g.ctx.penId.value,-1);
g=create('android');assert.equal(g.kind,'pan');g.callbacks.onTouchesDown(event([t(1)],[t(1)]),g.sm);assert.equal(g.events.length,0);g.callbacks.onTouchesDown(event([t(2,1)],[t(1),t(2,1)],1),g.sm);assert.deepEqual(g.transitions,['activate']);g.callbacks.onTouchesUp(event([t(2,1)],[t(1)],1),g.sm);assert.deepEqual(g.transitions,['activate']);
// A barrel button reported through the generic secondary bit (some pens, web) must not ink either; a tip-only contact (bit 1) still writes.
g=create('android');g.callbacks.onTouchesDown(event([{...t(8,1),buttons:2}],[{...t(8,1),buttons:2}],1),g.sm);assert.equal(g.events.length,0);assert.deepEqual(g.transitions,['fail']);
g=create('android');g.callbacks.onTouchesDown(event([{...t(8,1),buttons:1}],[{...t(8,1),buttons:1}],1),g.sm);assert.equal(g.events[0][0],'down');
console.log('PASS: finger-only passthrough, mixed-contact Pencil identification, palm lift, pen lift, repeated strokes, cancellation, Android Pan lifecycle');

// A held S Pen button never deposits ink, including a stationary button change mid-stroke.
g=create('android'); const barrel={...t(8,1),buttons:32};g.callbacks.onTouchesDown(event([barrel],[barrel],1),g.sm);assert.equal(g.events.length,0);assert.deepEqual(g.transitions,['fail']);
g=create('android');g.callbacks.onTouchesDown(event([t(9,1)],[t(9,1)],1),g.sm);g.callbacks.onTouchesMove(event([],[{...t(9,1),buttons:32}],1),g.sm);assert.equal(g.events.at(-1)[0],'finish','a button press mid-stroke ends the stroke, keeps it');assert.equal(g.ctx.penId.value,-1);g.callbacks.onTouchesUp(event([t(9,1)],[],1),g.sm);assert(!g.events.some(e=>e[0]==='up'));
console.log('PASS: barrel-button contact rejects dot and mid-stroke button ends the stroke and keeps it');
// 2026-11-26 field report "필기 도중 방금 쓴 획이 날아감": no cancellation path deletes the stroke being written
{ const src = fs.readFileSync('src/features/viewer/InkCanvas.tsx', 'utf8'); const pan = src.slice(src.indexOf('const pan = useMemo('), src.indexOf('const longPress = useMemo('));
  assert(!/runOnJS\(jsAbort\)/.test(pan), 'no gesture path aborts (deletes) a pen stroke');
  assert(/onStylusShortcutCancel\(\(\) => \{ H\.current\.finish\(\); \}\)/.test(src), 'a pen shortcut ends the stroke, keeps it');
  assert(/if \(e\.numberOfTouches === 0\) \{ penId\.value = -1;[^\n]*runOnJS\(jsFinish\)\(\)/.test(pan), 'a lost pen-up still ends the stroke');
  const st = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/features/viewer/stylusShortcutState.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: st, Set });
  const W = st.exports ? st.exports.shortcutWhileWriting : st.shortcutWhileWriting;
  assert.equal(W({ writing: true, at: 0 }, 5000), true); assert.equal(W({ writing: false, at: 4500 }, 5000), true, 'between the strokes of a word');
  assert.equal(W({ writing: false, at: 3000 }, 5000), false, 'a deliberate squeeze after a pause still opens the dial'); assert.equal(W({ writing: false, at: 0 }, 5000), false);
  const viewer = fs.readFileSync('app/viewer/[docId].tsx', 'utf8'); assert(/if \(shortcutWhileWriting\(penSession\.value, Date\.now\(\)\)\) \{ ignoredShortcuts\+\+; return; \}/.test(viewer));
  console.log('PASS: strokes are never deleted by cancellation, pen shortcuts or a lost pen-up; shortcuts while writing are ignored'); }
