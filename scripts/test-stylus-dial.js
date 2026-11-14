const assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
const js = ts.transpileModule(fs.readFileSync('src/features/viewer/stylusDialGeometry.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const ctx = { exports: {} }; vm.runInNewContext(js, ctx); const {placeStylusDial, dialWidthPresets, dialColors} = ctx.exports;
for (const width of [240, 320, 375, 768, 1366]) for (const height of [240, 375, 768, 1024]) for (const x of [-100, 0, width / 2, width, width + 100]) for (const y of [-100, 0, height / 2, height, height + 100]) {
  const p = placeStylusDial({x, y}, {width, height, top: 24, bottom: 20});
  assert(p.left >= 8 && p.top >= 32, JSON.stringify(p));
  assert(p.left + p.width <= width - 8 && p.top + p.height <= height - 28, JSON.stringify(p));
  assert(p.width <= 316 && p.height <= 354 && p.width > 0 && p.height > 0);
}
const nan = placeStylusDial({x: NaN, y: Infinity}, {width: 375, height: 812}); assert(Object.values(nan).every(Number.isFinite));
assert.equal(placeStylusDial({x: 500, y: 700}, {width: 1000, height: 1000}).top, 322);
assert.equal(placeStylusDial({x: 500, y: 30}, {width: 1000, height: 1000}).top, 54);
assert.deepEqual(Array.from(dialWidthPresets('pen')), [0.5, 1, 2]);
assert.deepEqual(Array.from(dialWidthPresets('pencil')), [0.5, 1.2, 3]);
assert.deepEqual(Array.from(dialWidthPresets('highlighter')), [6, 12, 24]);
assert.deepEqual(Array.from(dialWidthPresets('vectorEraser')), [3, 12, 24]);
assert.deepEqual(Array.from(dialColors('#abcdef', ['#ABCDEF', 'garbage', '#FFFFFF'], 3)), ['#ABCDEF', '#FFFFFF', '#172033']);
const src = fs.readFileSync('src/features/viewer/StylusDial.tsx', 'utf8');
assert(src.includes("from './ToolArt'")); assert(src.includes('pointerEvents="box-none"'));
assert(!src.includes('opacity: w')); assert(!src.includes('Modal'));
console.log('PASS: 500 edge/phone/tablet/landscape placements, nonfinite anchors, width presets, colors, original ToolArt, non-modal outside touch');
