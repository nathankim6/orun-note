// node scripts/test-tile-progress.js — pure logic of progressive zoom tiles and pixel-exact tile layout (no device claims).
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
function load(file) { const src = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const exports = {}; vm.runInNewContext(src, { exports, require, console, Set, Math, Date }); return exports; }
const m = load('src/features/viewer/tileProgress.ts');
// slow flag is per file and only set by a measured slow tile
assert.equal(m.tileIsSlow('a.pdf'), false); m.noteTileTiming('a.pdf', 120); assert.equal(m.tileIsSlow('a.pdf'), false);
m.noteTileTiming('a.pdf', m.SLOW_TILE_MS); assert.equal(m.tileIsSlow('a.pdf'), true); assert.equal(m.tileIsSlow('b.pdf'), false);
// half tile: quarter of the pixels, same normalized placement
const t = { pxW: 5464, x: 1201, y: 1601, w: 2732, h: 2048, nx: 0.2198, ny: 0.207, nw: 0.5, nh: 0.265 };
const h = m.halfTile(t);
assert.equal(h.pxW, 2732); assert.equal(h.x, 600); assert.equal(h.y, 800); assert.equal(h.w, 1366); assert.equal(h.h, 1024);
assert.deepEqual([h.nx, h.ny, h.nw, h.nh], [t.nx, t.ny, t.nw, t.nh]);
assert.ok(h.w * h.h * 4 <= t.w * t.h + 4);
// layout: tile pixels larger than the page-space box → laid out at pixel size, scaled down from the top-left corner
const st = m.tileImageStyle(t, { w: 2732, h: 2048 }, 1000, 1414, 2);
assert.equal(st.width, 1366); assert.equal(st.height, 1024); assert.equal(st.left, t.nx * 1000); assert.equal(st.top, t.ny * 1414);
assert.equal(st.transformOrigin, 'top left'); assert.ok(Math.abs(st.transform[0].scale - (t.nw * 1000) / 1366) < 1e-9);
// on-screen size after the scale equals the page-space box (the outer zoom then enlarges both the same way)
assert.ok(Math.abs(st.width * st.transform[0].scale - t.nw * 1000) < 1e-9);
// a tile no larger than its box keeps plain layout
const small = m.tileImageStyle(t, { w: 500, h: 375 }, 1000, 1414, 2); assert.equal(small.width, t.nw * 1000); assert.equal(small.transform, undefined);
console.log('test-tile-progress: ok');
