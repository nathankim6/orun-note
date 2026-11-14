// Exercise the real touch callback: dismissing options must not consume the first pen point.
const fs = require('fs'), ts = require('typescript'), vm = require('vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('src/features/viewer/InkCanvas.tsx','utf8');
const body = source.slice(source.indexOf('  H.current = {'), source.indexOf('  const jsDown ='));
const calls = [], ctx = { H:{current:{}}, enabledRef:{current:true}, rejected:{current:false}, activeId:{current:null}, activeType:{current:null}, pressureRef:{current:null}, tiltRef:{current:null}, lastPe:{current:null}, beginAt:e=>calls.push(e) };
vm.runInNewContext(ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
ctx.H.current.down(10,20,100,200,1,.6,.2);
assert.equal(calls.length,1); assert.equal(calls[0].x,10); assert.equal(calls[0].stylusData.pressure,.6);
ctx.enabledRef.current=false; ctx.H.current.down(11,21,101,201,1,.5,.1); assert.equal(calls.length,1);
const viewer=fs.readFileSync('app/viewer/[docId].tsx','utf8');
assert(viewer.includes('enabled={inkEnabled}')); assert(!viewer.includes('panelShown')); assert(!source.includes('toolCard.open'));
assert(viewer.includes('if (panelOpen.current) setDismissKey((k) => k + 1)'));
assert(viewer.includes('return false; }}>'),'page capture must not claim the gesture');
console.log('PASS: first pen down reaches beginAt, disabled canvas still rejects, option dismissal does not block drawing');
