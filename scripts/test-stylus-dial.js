const assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
const js = ts.transpileModule(fs.readFileSync('src/features/viewer/stylusDialGeometry.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const palette = {exports:{}}; vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/data/representativeColors.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,palette);
const ctx = { exports: {}, require: n => { if (n === '../../data/representativeColors') return palette.exports; throw Error(n); } }; vm.runInNewContext(js, ctx); const {placeStylusDial, dialWidthRange, dialColors, dialVisualBounds, STYLUS_DIAL_ANGLE} = ctx.exports;
for (const width of [240, 320, 375, 768, 1366]) for (const height of [240, 375, 768, 1024]) for (const x of [-100, 0, width / 2, width, width + 100]) for (const y of [-100, 0, height / 2, height, height + 100]) {
  const p = placeStylusDial({x, y}, {width, height, top: 24, bottom: 20});
  const v=dialVisualBounds(p);
  assert(v.left >= 8-1e-6 && v.top >= 32-1e-6, JSON.stringify(v));
  assert(v.left + v.width <= width - 8+1e-6 && v.top + v.height <= height - 28+1e-6, JSON.stringify(v));
  assert(p.width <= 296 && p.height <= 184 && p.width / p.height >= 1.2 && p.width / p.height <= 2 && p.width > 0 && p.height > 0);
}
const nan = placeStylusDial({x: NaN, y: Infinity}, {width: 375, height: 812}); assert(Object.values(nan).every(Number.isFinite));
assert(Math.abs(dialVisualBounds(placeStylusDial({x:500,y:700},{width:1000,height:1000})).top + dialVisualBounds(placeStylusDial({x:500,y:700},{width:1000,height:1000})).height - 676) < 1e-6);
assert(Math.abs(dialVisualBounds(placeStylusDial({x:500,y:30},{width:1000,height:1000})).top - 54) < 1e-6); assert.equal(STYLUS_DIAL_ANGLE,0);
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
assert(!src.includes('opacity: w')); assert(!src.includes('Modal')); assert(src.includes("import { DragSlider } from './Toolbar'")); assert(src.includes('borderTopLeftRadius: w / 2')); assert(src.includes('borderBottomLeftRadius: 8')); assert(src.includes('rotate: `${STYLUS_DIAL_ANGLE}deg`')); assert(src.includes('rotate: `${t.angle}deg`')); assert(src.includes('scaleX: 1.3')); assert(src.includes('size={compact ? .88 : 1.04}'));  assert(!src.includes('widthButton'));
console.log('PASS: 500 edge/phone/tablet/landscape placements, nonfinite anchors, continuous slider ranges, half-disk dome bounds and enlarged artwork, colors, original ToolArt, non-modal outside touch');

assert(!fs.readFileSync('src/features/viewer/StylusDial.tsx','utf8').includes('stylus-dial-current-width'), 'dial must not display numeric thickness');

assert(!src.includes('OrunMark') && !src.includes('stylus-dial-brand'), 'no brand footer');
assert(src.includes('<BlurView') && src.includes('<LinearGradient') && src.includes('dimezisBlurViewSdk31Plus'), 'real blur with older Android fallback');
const viewer=fs.readFileSync('app/viewer/[docId].tsx','utf8');assert(viewer.indexOf('</BlurTargetView>') < viewer.indexOf('<StylusDial blurTarget='), 'blur target excludes overlay to avoid feedback');

for (const degrees of [0,-38,38,-90]) { const a=degrees*Math.PI/180; for(const local of [0,11,73,135,146]) { const dx=local-73; const value=ctx.exports.rotatedSliderX(200+dx*Math.cos(a),300+dx*Math.sin(a),200,300,146,degrees);assert(Math.abs(value-local)<1e-8); } }
assert(src.includes('rotation={STYLUS_DIAL_ANGLE}'), 'slider uses rotated pointer coordinates');
console.log('PASS: screen-space slider projection matches local endpoints at all dial angles');

// The palette itself is never a top-bar item: the pen tool button is its only on-screen trigger.
const toolbar = fs.readFileSync('src/features/viewer/Toolbar.tsx', 'utf8');
assert(!toolbar.includes('펜 다이얼') && !toolbar.includes('aperture-outline'), 'the palette must not be registered as a separate toolbar button');
assert(toolbar.includes("toolBtn('pen', '펜', cfg.tool === 'pen', penPress"), 'the pen tool button summons the palette');
// The long-press guard is one gesture long: it is dropped when that finger lifts, so the next tap opens the palette
// (found on the Android emulator: after using the pen card once, the first tap on the pen did nothing).
assert(/const penPressOut = \(\) => \{ if \(penHeld\.current\) setTimeout\(\(\) => \{ penHeld\.current = false; \}, 0\); \};/.test(toolbar) && toolbar.includes('onPressOut: penPressOut') && toolbar.includes('onPressOut={extra?.onPressOut}'), 'long-press guard released on press-out');
assert(toolbar.includes('measureInWindow') && toolbar.includes('x: x + w / 2, y: y + h }'), 'the palette opens under the pen button it was summoned from');
assert(toolbar.includes('{ slot: penSlot') && toolbar.includes('onLongPress: penLongPress'), 'the pen card stays reachable by long-pressing the pen button');
assert(toolbar.includes('const summon = onStylusDial;') && toolbar.includes('if (readOnly || !summon) return false;'), 'read-only toolbars never summon the palette');
assert(toolbar.includes("if (openPenPalette()) { if (cfg.tool !== 'pen') onCfg({ tool: 'pen' }); return; }") && toolbar.includes("pick('pen');"), 'pen press still selects the pen, and keeps the card path when no palette host exists');
assert(viewer.includes('onStylusDial={(point) => openStylusDial(point)}'), 'the viewer receives the pen button position');
assert(viewer.includes('{dialAnchor && <StylusDial'), 'the palette renders only after a summon');
console.log('PASS: palette is summoned from the pen tool button only, never rendered as a top-bar item');
