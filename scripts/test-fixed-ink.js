// Run with node scripts/test-fixed-ink.js. No device claims: these exercise pure ink geometry and persisted settings.
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
function load(file, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; vm.runInNewContext(source, { exports, require: n => n in mocks ? mocks[n] : require(n), console, Date, Map, WeakMap }); return exports;
}
let options;
const { defaultViewerPrefs: d } = load('src/store/settings.ts', {
  zustand: { create: () => x => x }, 'zustand/middleware': { persist: (x, opts) => { options = opts; return x; } }, './persist': { persistOpts: () => ({}) },
});
assert.equal(d.toolPresets.pen.width, 0.5); assert.equal(d.fixedWidth, true);
assert.equal(d.toolPresets.eraser.width, 8); assert.equal(d.toolPresets.vectorEraser.width, 6); assert.equal(options.version, 10);
const old = { viewer: { fixedWidth: false, toolPresets: { pen: { color: 'red', width: 4, opacity: .8 }, eraser: { width: 14 }, vectorEraser: { width: 10 } }, favoritePens: [{tool:'pen', width:3, fixed:false}] } };
const migrated = options.migrate(old, 9).viewer;
assert.equal(migrated.toolPresets.pen.width, .5); assert.equal(migrated.toolPresets.pen.color, 'red'); assert.equal(migrated.toolPresets.pen.opacity, .8);
assert.equal(migrated.toolPresets.eraser.width,8); assert.equal(migrated.toolPresets.vectorEraser.width,6); assert.equal(migrated.favoritePens[0].fixed,true);
const custom = options.migrate({ viewer: { toolPresets: { eraser: {width:23}, vectorEraser:{width:17} } } },9).viewer;
assert.equal(custom.toolPresets.eraser.width,23); assert.equal(custom.toolPresets.vectorEraser.width,17);
assert.equal(options.migrate({viewer:{}},1).viewer.toolPresets.pen.width,.5);
const {penOutline, toolDefaults} = load('src/features/viewer/ink.ts', {'@/data/types':{}});
const low = Array.from({length:20},(_,i)=>({x:i*3,y:10+i*.2,p:.05})); const high=low.map(p=>({...p,p:1}));
assert.equal(penOutline(low,.5),penOutline(high,.5)); assert.equal(penOutline(low,.5,true),penOutline(high,.5,true));
assert.equal(toolDefaults('pen',{}).width,.5); assert.equal(toolDefaults('eraser',{}).width,8); assert.equal(toolDefaults('vectorEraser',{}).width,6);
assert(!fs.readFileSync('src/features/viewer/Toolbar.tsx','utf8').includes('가변 굵기'));
console.log('PASS: defaults, v9/v1 migration, custom eraser preservation, pressure-independent live/stored ink, toolbar removal');
