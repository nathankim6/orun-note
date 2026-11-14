// node scripts/test-words.js — tap-to-define word geometry (pure JS, no device claims)
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
function load(file, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; vm.runInNewContext(source, { exports, require: n => n in mocks ? mocks[n] : require(n), console, Map, Promise }); return exports;
}
const { mergeFragments, wordAt, cleanWord } = load('src/features/viewer/words.ts', { '../../../modules/pdf-renderer': { PdfRenderer: {} }, './derivedPages': { forUri: () => null, pageWords: async () => null } });
const h = 0.02, y = 0.5;
const W = (t, x, w) => ({ t, x, y, w, h });
// ligature split "signi" + "ficant" (no gap) is glued; the real next word (space ≈ 0.3h) is not
const merged = mergeFragments([W('signi', 0.10, 0.05), W('ficant', 0.1502, 0.06), W('result', 0.2162, 0.06)]);
assert.equal(merged.length, 2); assert.equal(merged[0].t, 'significant'); assert.equal(merged[0].x, 0.10); assert(Math.abs(merged[0].w - 0.1102) < 1e-9); assert.equal(merged[1].t, 'result');
// kerning overlap (slightly negative gap) is glued too
assert.equal(mergeFragments([W('re', 0.1, 0.02), W('search', 0.1195, 0.05)])[0].t, 'research');
// different lines, punctuation pieces and a changed font size stay separate
assert.equal(mergeFragments([W('a', 0.1, 0.01), { t: 'b', x: 0.1101, y: y + h * 1.2, w: 0.01, h }]).length, 2);
assert.equal(mergeFragments([W('well', 0.1, 0.03), W('-', 0.1301, 0.005), W('known', 0.1352, 0.04)]).length, 3);
assert.equal(mergeFragments([W('Big', 0.1, 0.03), { t: 'small', x: 0.1301, y, w: 0.03, h: h * 0.4 }]).length, 2);
assert.deepEqual(mergeFragments([]), []);
// the tap lands on the glued word
const found = wordAt(merged, 0.17, y + h / 2); assert.equal(found.t, 'significant'); assert.equal(cleanWord('(significant),'), 'significant');
// double-tap zoom is off while the select tool looks words up
assert(fs.readFileSync('app/viewer/[docId].tsx', 'utf8').includes("doubleTapZoom={prefs.doubleTapZoomEnabled && cfg.tool !== 'select'}"));
// pronunciation: the relay is checked first so a missing recording falls back to the device voice at once
const wl = fs.readFileSync('src/features/viewer/WordLookup.tsx', 'utf8'); assert(wl.includes('const head = await fetch(url).catch(() => null);')); assert(wl.includes("return tts();"));
// server: never play the other accent's recording for the requested one
const fn = fs.readFileSync('supabase/functions/docs/index.ts', 'utf8'); assert(!fn.includes('?? syms[0]')); assert(!fn.includes('?? list[0]'));
console.log('PASS: word fragment merge, tap hit on glued word, select-tool double-tap, accent-exact pronunciation fallback');
