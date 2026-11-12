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
assert.equal(d.toolPresets.pen.width, 1); assert.equal(d.fixedWidth, true);
assert.equal(d.toolPresets.eraser.width, 6); assert.equal(d.toolPresets.vectorEraser.width, 5); assert.equal(options.version, 12);
assert.equal(d.toolPresets.pencil.width, 1.2); assert.equal(d.toolPresets.pencil.opacity, 0.8); assert.equal(d.pagesPanelOpen, true);
const old = { viewer: { fixedWidth: false, toolPresets: { pen: { color: 'red', width: 4, opacity: .8 }, eraser: { width: 14 }, vectorEraser: { width: 10 } }, favoritePens: [{tool:'pen', width:3, fixed:false}] } };
const migrated = options.migrate(old, 9).viewer;
assert.equal(migrated.toolPresets.pen.width, 1); assert.equal(migrated.toolPresets.pen.color, 'red'); assert.equal(migrated.toolPresets.pen.opacity, .8);
assert.equal(migrated.toolPresets.eraser.width,6); assert.equal(migrated.toolPresets.vectorEraser.width,5); assert.equal(migrated.favoritePens[0].fixed,true);
assert.equal(migrated.toolPresets.pencil.width,1.2); assert.equal(migrated.pagesPanelOpen,true);
const custom = options.migrate({ viewer: { toolPresets: { eraser: {width:23}, vectorEraser:{width:17} } } },9).viewer;
assert.equal(custom.toolPresets.eraser.width,23); assert.equal(custom.toolPresets.vectorEraser.width,17);
assert.equal(options.migrate({viewer:{}},1).viewer.toolPresets.pen.width,1);
const v10defaults=options.migrate({viewer:{toolPresets:{pen:{width:.5,color:'green',opacity:.6},eraser:{width:8},vectorEraser:{width:6}}}},10).viewer;
assert.equal(v10defaults.toolPresets.pen.width,1);assert.equal(v10defaults.toolPresets.pen.color,'green');assert.equal(v10defaults.toolPresets.pen.opacity,.6);assert.equal(v10defaults.toolPresets.eraser.width,6);assert.equal(v10defaults.toolPresets.vectorEraser.width,5);
const v10custom=options.migrate({viewer:{toolPresets:{pen:{width:1.3},eraser:{width:14},vectorEraser:{width:10}}}},10).viewer;
assert.equal(v10custom.toolPresets.pen.width,1.3);assert.equal(v10custom.toolPresets.eraser.width,14);assert.equal(v10custom.toolPresets.vectorEraser.width,10);
assert.equal(options.migrate({viewer:{toolPresets:{pen:{width:.5}}}},11).viewer.toolPresets.pen.width,.5);
// v12: only the previous defaults move (pen .7→1, erasers 10→6 / 8→5); custom widths, pencil preset and panel flag preserved
const v12d=options.migrate({viewer:{toolPresets:{pen:{width:.7,color:'blue',opacity:1},eraser:{width:10},vectorEraser:{width:8}},lastTool:'pencil'}},11).viewer;
assert.equal(v12d.toolPresets.pen.width,1);assert.equal(v12d.toolPresets.pen.color,'blue');assert.equal(v12d.toolPresets.eraser.width,6);assert.equal(v12d.toolPresets.vectorEraser.width,5);assert.equal(v12d.toolPresets.pencil.width,1.2);assert.equal(v12d.lastTool,'pencil');assert.equal(v12d.pagesPanelOpen,true);
const v12c=options.migrate({viewer:{toolPresets:{pen:{width:2.5},eraser:{width:12},vectorEraser:{width:3},pencil:{width:3,color:'#000',opacity:.5}},pagesPanelOpen:false}},11).viewer;
assert.equal(v12c.toolPresets.pen.width,2.5);assert.equal(v12c.toolPresets.eraser.width,12);assert.equal(v12c.toolPresets.vectorEraser.width,3);assert.equal(v12c.toolPresets.pencil.width,3);assert.equal(v12c.pagesPanelOpen,false);
assert.equal(options.migrate({viewer:{toolPresets:{pen:{width:.7}}}},12).viewer.toolPresets.pen.width,.7);
assert(fs.readFileSync('src/features/viewer/Toolbar.tsx','utf8').includes("step={cfg.tool === 'pen' || cfg.tool === 'pencil' ? 0.1 : 0.5}"));
const {penOutline, toolDefaults} = load('src/features/viewer/ink.ts', {'@/data/types':{}});
const low = Array.from({length:20},(_,i)=>({x:i*3,y:10+i*.2,p:.05})); const high=low.map(p=>({...p,p:1}));
assert.equal(penOutline(low,.5),penOutline(high,.5)); assert.equal(penOutline(low,.5,true),penOutline(high,.5,true));
assert.equal(toolDefaults('pen',{}).width,1); assert.equal(toolDefaults('eraser',{}).width,6); assert.equal(toolDefaults('vectorEraser',{}).width,5); assert.equal(toolDefaults('pencil',{}).opacity,.8);
// pencil: pressure changes the outline, pen never does; pencil outline is cached separately from the pen outline of the same points
assert.notEqual(penOutline(low,1,false,'pencil'),penOutline(high,1,false,'pencil')); assert.notEqual(penOutline(low,1,false,'pencil'),penOutline(low,1,false,'pen'));
assert.equal(penOutline(low,1,false,'pen'),penOutline(low,1)); assert(penOutline(low.map(({x,y})=>({x,y})),1,false,'pencil').length>10);
assert(fs.readFileSync('src/features/viewer/Toolbar.tsx','utf8').includes("toolBtn('pencil', '연필'"));
assert(!fs.readFileSync('src/features/viewer/Toolbar.tsx','utf8').includes('가변 굵기'));
// persistence: the hydration flag is never written to disk, is raised after the disk read, and the viewer only saves
// presets / panel state after that read (a pre-hydration write would be replaced by the stored values)
assert.equal(options.partialize({ hydrated: true, theme: 'light' }).hydrated, undefined); assert.equal(options.partialize({ hydrated: true, theme: 'light' }).theme, 'light');
assert.equal(typeof options.onRehydrateStorage, 'function');
const viewerSrc = fs.readFileSync('app/viewer/[docId].tsx', 'utf8');
assert(viewerSrc.includes("useSettingsStore.getState().hydrated && ['pen', 'pencil', 'highlighter', 'eraser', 'vectorEraser', 'shape', 'text'].includes(next.tool)"));
assert(viewerSrc.includes("viewer.pagesPanelOpen ?? true) ? 'pages' : null")); assert(viewerSrc.includes("setViewer({ pagesPanelOpen: !!t })"));
assert(viewerSrc.includes('useEffect(() => { if (settingsHydrated && !hydratedAtMount.current)'));
console.log('PASS: v12 defaults + pencil, persistence guards, v11 modest defaults, v9/v1/v10 migration, custom presets preserved, pressure-independent live/stored ink, toolbar removal');
