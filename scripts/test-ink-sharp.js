// node scripts/test-ink-sharp.js — iOS crisp ink (docs/ios-zoom-sharpness.md): while magnified, finished opaque ink is
// re-drawn at screen resolution in a viewport-space layer (InkSharp), and the input canvas under the zoom transform
// leaves exactly that window to it. Pure JS; proves the window / ownership rules, not device pixels.
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
function load(file, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const exports = {}; vm.runInNewContext(source, { exports, require: n => n in mocks ? mocks[n] : require(n), console, Map, Set, Promise, Date, JSON, Math, Number, Array, Object, Error, String, RegExp, WeakMap, setTimeout, clearTimeout }); return exports;
}
const any = new Proxy(function () {}, { get: (t, k) => (k === '__esModule' ? true : any), apply: () => any, construct: () => any });
const ink = load('src/features/viewer/InkCanvas.tsx', new Proxy({}, { has: () => true, get: () => any }));
const W = ink.inkSharpWindow; assert.equal(typeof W, 'function');
const sharp = load('src/features/viewer/InkSharp.tsx', { react: { __esModule: true, default: { createElement: () => null } }, 'react-native': { PixelRatio: { get: () => 2 }, View: 'View' }, './InkCanvas': { InkCanvas: 'InkCanvas' }, './SharpFrame': { SharpFrame: 'SharpFrame' } });

// 1. the window in page units is the same whether it is computed by the input canvas (drawn at density rs, scaled by
//    the zoom transform) or by InkSharp (drawn at the resting zoom), so a stroke the input canvas leaves out is drawn
//    by InkSharp, never by neither
const area = (bounds, s, width, height) => { const x0 = Math.max(0, Math.floor(bounds.x0 * s)), y0 = Math.max(0, Math.floor(bounds.y0 * s)), x1 = Math.min(width, Math.ceil(bounds.x1 * s)), y1 = Math.min(height, Math.ceil(bounds.y1 * s)); return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null; };
let rnd = 7; const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
let compared = 0;
for (let n = 0; n < 4000; n++) {
  const box = { w: 600 + r() * 600, s: 1 + r() }; box.h = box.w * (1.2 + r() * 0.3); const pageW = box.w / box.s, pageH = box.h / box.s;
  const z = 1.03 + r() * 4, rs = z > 2.5 ? 4 : z > 1.2 ? 2 : 1, dpr = r() < 0.5 ? 2 : 3;
  const nw = Math.min(1, 1 / z * (0.6 + r() * 0.5)), nh = Math.min(1, nw * (0.8 + r() * 0.6)); const region = { nx: r() * (1 - nw), ny: r() * (1 - nh), nw, nh };
  const bx0 = r() * pageW * 0.8, by0 = r() * pageH * 0.8; const bounds = { x0: bx0, y0: by0, x1: bx0 + 5 + r() * pageW * 0.5, y1: by0 + 5 + r() * pageH * 0.5 };
  const sIn = box.s * rs, wIn = box.w * rs, hIn = box.h * rs; const input = W(region, area(bounds, sIn, wIn, hIn), wIn, hIn, dpr * (z / rs));
  const sSh = box.s * z, wSh = box.w * z, hSh = box.h * z; const crisp = W(region, area(bounds, sSh, wSh, hSh), wSh, hSh, dpr);
  // the input canvas leaves out only ink 2 px inside its window; where InkSharp has no window that inset must be empty
  if (input && !crisp) { assert(input.w <= 4 || input.h <= 4, 'a window only the input canvas has is a sliver'); continue; }
  if (!input || !crisp) continue; compared++;
  const inset = { x0: (input.x + 2) / sIn, y0: (input.y + 2) / sIn, x1: (input.x + input.w - 2) / sIn, y1: (input.y + input.h - 2) / sIn };
  if (inset.x1 > inset.x0 && inset.y1 > inset.y0) assert(inset.x0 >= crisp.x / sSh - 1e-9 && inset.y0 >= crisp.y / sSh - 1e-9 && inset.x1 <= (crisp.x + crisp.w) / sSh + 1e-9 && inset.y1 <= (crisp.y + crisp.h) / sSh + 1e-9, 'whatever the input canvas leaves out lies inside the InkSharp window');
  for (const k of ['x', 'y']) assert(Math.abs(input[k] / sIn - crisp[k] / sSh) <= 1.01 / Math.min(sIn, sSh), `window ${k} agrees in page units`);
  for (const k of ['w', 'h']) assert(Math.abs(input[k] / sIn - crisp[k] / sSh) <= 2.02 / Math.min(sIn, sSh), `window ${k} agrees in page units`);
}
assert(compared > 1500, 'enough windows compared: ' + compared);
// the pixel budget picks a smaller pad, never no window
const big = W({ nx: 0, ny: 0, nw: 1, nh: 1 }, { x: 0, y: 0, w: 4000, h: 5000 }, 4000, 5000, 3); assert(big && big.w <= 4000);
assert.equal(W(null, { x: 0, y: 0, w: 10, h: 10 }, 100, 100, 2), null); assert.equal(W({ nx: 0, ny: 0, nw: 1, nh: 1 }, null, 100, 100, 2), null);

// 2. when InkSharp draws, and that the input canvas uses exactly the same condition
const at = (z) => ({ at: { z, tx: -10.3, ty: -40.7 } });
assert.equal(sharp.inkSharpWanted(undefined, 3, false), false); assert.equal(sharp.inkSharpWanted({}, 3, false), false);
assert.equal(sharp.inkSharpWanted(at(1), 3, false), false, 'not magnified: the ink layer is already crisp');
assert.equal(sharp.inkSharpWanted(at(1.5), 0, false), false, 'no ink: nothing to draw');
assert.equal(sharp.inkSharpWanted(at(1.5), 3, true), false, 'selection / drag: steps aside');
assert.equal(sharp.inkSharpWanted(at(1.5), 3, false), true);
for (const z of [1, 1.02, 1.021, 1.5, 3.6]) assert.equal(sharp.inkSharpElsewhere(at(z)), sharp.inkSharpWanted(at(z), 1, false), 'same zoom rule on both sides at ' + z);
assert.equal(sharp.inkSharpElsewhere(undefined), false);
// 3. the page rectangle at the resting transform, origin on a device pixel
const pr = sharp.inkSharpPageRect({ x: 14, y: 30, w: 806, h: 1140 }, { z: 2.2, tx: -310.37, ty: -905.31 }, 2);
assert.equal(pr.width, 806 * 2.2); assert.equal(pr.height, 1140 * 2.2); assert.equal(pr.left * 2, Math.round(pr.left * 2)); assert.equal(pr.top * 2, Math.round(pr.top * 2));
assert(Math.abs(pr.left - (-310.37 + 14 * 2.2)) <= 0.25 && Math.abs(pr.top - (-905.31 + 30 * 2.2)) <= 0.25);

// 4. wiring contracts
const canvas = fs.readFileSync('src/features/viewer/InkCanvas.tsx', 'utf8'), doc = fs.readFileSync('src/features/viewer/DocumentView.tsx', 'utf8'), viewer = fs.readFileSync('app/viewer/[docId].tsx', 'utf8');
assert(/if \(layer === 'sharp'\) \{ if \(st\.opacity < 0\.99\) return true; if \(!win\) return false;/.test(canvas), 'the crisp layer draws opaque ink only, and only what meets its window');
assert(/const sb = layer === 'base' && sharpBox && !interactive && !sharpElsewhere \?/.test(canvas), 'with InkSharp the input canvas keeps drawing every stroke (never invisible in between)');
assert(/\{sharpBox && !sharpElsewhere && <Svg/.test(canvas), 'the input canvas draws no crisp window of its own when InkSharp does');
assert(/const withUi = layer === 'sharp' \|\| !sharpBox \|\| !!sharpElsewhere;/.test(canvas), 'selection chrome stays on the input canvas');
assert(/const sharpBox = dense \? inkSharpWindow\(region \?\? null, inkArea, width, height, dpr \* sharpScale\) : null;/.test(canvas));
assert(doc.indexOf('{layered && renderInkSharp ?') > doc.indexOf('{layered ? <Animated.View'), 'crisp ink lies above the ink layer');
assert(/sharpElsewhere=\{LAYERED_SURFACE\} sharpScale=\{LAYERED_SURFACE \? \(tile\?\.at\?\.z \?\? 1\) \/ rs : 1\}/.test(viewer) && /dense=\{LAYERED_SURFACE \? inkSharpElsewhere\(tile\) : rs > 1\}/.test(viewer), 'viewer: the input canvas and InkSharp share the tile, the zoom rule and the pixel budget');
assert(/renderInkSharp=\{LAYERED_SURFACE \? renderInkSharp : undefined\}/.test(viewer), 'Android / web keep the single-layer ink');
console.log(`PASS: crisp-ink window identical for the input canvas and InkSharp (${compared} random pages/zooms), same zoom rule, steps aside while selecting, opaque ink only, page rectangle on device pixels, wiring`);
