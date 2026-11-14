const assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
const js = ts.transpileModule(fs.readFileSync('src/features/viewer/stylusDialGeometry.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const palette = {exports:{}}; vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/data/representativeColors.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,palette);
const ctx = { exports: {}, require: n => { if (n === '../../data/representativeColors') return palette.exports; throw Error(n); } }; vm.runInNewContext(js, ctx); const {placeStylusDial, dialWidthRange, dialColors} = ctx.exports;
for (const width of [240, 320, 375, 768, 1366]) for (const height of [240, 375, 768, 1024]) for (const x of [-100, 0, width / 2, width, width + 100]) for (const y of [-100, 0, height / 2, height, height + 100]) {
  const p = placeStylusDial({x, y}, {width, height, top: 24, bottom: 20});
  assert(p.left >= 8 && p.top >= 32, JSON.stringify(p));
  assert(p.left + p.width <= width - 8 && p.top + p.height <= height - 28, JSON.stringify(p));
  assert(p.width <= 296 && p.height <= 200 && p.width / p.height >= 1.2 && p.width / p.height <= 2 && p.width > 0 && p.height > 0);
}
const nan = placeStylusDial({x: NaN, y: Infinity}, {width: 375, height: 812}); assert(Object.values(nan).every(Number.isFinite));
assert.equal(placeStylusDial({x: 500, y: 700}, {width: 1000, height: 1000}).top, 476);
assert.equal(placeStylusDial({x: 500, y: 30}, {width: 1000, height: 1000}).top, 54);
assert.equal(JSON.stringify(dialWidthRange('pen')), JSON.stringify({min:0.5,max:12,step:0.1}));
assert.equal(dialWidthRange('pencil').step, 0.1);
assert.equal(dialWidthRange('highlighter').min, 6); assert.equal(dialWidthRange('highlighter').max, 40);
assert.equal(dialWidthRange('vectorEraser').min, 2); assert.equal(dialWidthRange('vectorEraser').step, 0.5);
const favoriteList = ['#ABCDEF', '#FFFFFF', '#123456', '#333333', '#123456', '#998877'];
assert.deepEqual(Array.from(dialColors('#000000', favoriteList, 3)), favoriteList, 'unlisted current ink never inserts/replaces/reorders/truncates representative colors');
assert.deepEqual(Array.from(dialColors('#FFFFFF', [])), [], 'explicit empty representative colors remain empty');
assert.deepEqual(Array.from(dialColors('#ABCDEF')), ['#000000', '#FDE68A', '#BFDBFE', '#FCA5A5', '#BBF7D0']);
const src = fs.readFileSync('src/features/viewer/StylusDial.tsx', 'utf8');
assert(src.includes("from './ToolArt'")); assert(src.includes('pointerEvents="box-none"'));
assert(!src.includes('opacity: w')); assert(!src.includes('Modal')); assert(src.includes("import { DragSlider } from './Toolbar'")); assert(src.includes('borderTopLeftRadius: c')); assert(src.includes('borderBottomLeftRadius: 0')); assert(src.includes('scaleX: 1.3')); assert(src.includes('size={compact ? 0.86 : 1.02}'));  assert(!src.includes('widthButton'));
console.log('PASS: 500 edge/phone/tablet/landscape placements, nonfinite anchors, continuous slider ranges, half-disk dome bounds and enlarged artwork, colors, original ToolArt, non-modal outside touch');

assert(!fs.readFileSync('src/features/viewer/StylusDial.tsx','utf8').includes('stylus-dial-current-width'), 'dial must not display numeric thickness');

assert(src.includes('stylus-dial-brand') && src.includes('<OrunMark height={16} />'), 'official logo is retained in a separate footer');
