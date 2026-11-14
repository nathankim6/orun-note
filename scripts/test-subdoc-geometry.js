// node scripts/test-subdoc-geometry.js — 서브교재 window resize math from any edge / corner (pure JS, no device claims)
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
function load(file) { const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const exports = {}; vm.runInNewContext(source, { exports, require, console, Math }); return exports; }
const geo = load('src/features/viewer/subDocGeometry.ts'); const resizeRect = (...a) => ({ ...geo.resizeRect(...a) }); // plain copy: vm objects have another prototype
const L = { minW: 280, minH: 260, maxW: 1200, maxH: 800, minY: 50 };
const r = { x: 400, y: 200, w: 400, h: 300 };
// right / bottom grow; opposite edges stay
assert.deepEqual(resizeRect(r, { right: true }, 50, 999, L), { x: 400, y: 200, w: 450, h: 300 });
assert.deepEqual(resizeRect(r, { bottom: true }, 999, -40, L), { x: 400, y: 200, w: 400, h: 260 });
// left / top: x / y move, right / bottom edges anchored
const l = resizeRect(r, { left: true }, -60, 0, L); assert.deepEqual(l, { x: 340, y: 200, w: 460, h: 300 }); assert.equal(l.x + l.w, r.x + r.w);
const t = resizeRect(r, { top: true }, 0, 30, L); assert.deepEqual(t, { x: 400, y: 230, w: 400, h: 270 }); assert.equal(t.y + t.h, r.y + r.h);
// corners combine
assert.deepEqual(resizeRect(r, { left: true, top: true }, -20, -30, L), { x: 380, y: 170, w: 420, h: 330 });
assert.deepEqual(resizeRect(r, { right: true, bottom: true }, 20, 30, L), { x: 400, y: 200, w: 420, h: 330 });
// min size: left drag past the min stops at min (right edge still anchored)
const lm = resizeRect(r, { left: true }, 500, 0, L); assert.equal(lm.w, 280); assert.equal(lm.x + lm.w, 800);
const tm = resizeRect(r, { top: true }, 0, 500, L); assert.equal(tm.h, 260); assert.equal(tm.y + tm.h, 500);
// screen edges: left stops at 0, top at the safe-area inset, right / bottom at max
assert.equal(resizeRect(r, { left: true }, -1000, 0, L).x, 0);
assert.equal(resizeRect(r, { top: true }, 0, -1000, L).y, 50);
assert.deepEqual(resizeRect(r, { right: true, bottom: true }, 5000, 5000, L), { x: 400, y: 200, w: 800, h: 600 });
// a right drag below the min keeps min
assert.equal(resizeRect(r, { right: true }, -1000, 0, L).w, 280);
console.log('PASS: subdoc resize from right/bottom/left/top edges and corners, anchoring, min/max and screen clamps');
