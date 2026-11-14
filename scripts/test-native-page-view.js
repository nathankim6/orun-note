// Run with node scripts/test-native-page-view.js. Pure selection/batching logic for the native page surface; no device claims.
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
const src = ts.transpileModule(fs.readFileSync('src/features/viewer/nativePageView.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const m = {}; vm.runInNewContext(src, { exports: m, Map, Set, Math });
// screen resolution, 100px steps, capped
assert.equal(m.nativePagePixels(820, 2), 1700); assert.equal(m.nativePagePixels(800, 2), 1600);
assert.equal(m.nativePagePixels(1400, 3), 2400); assert.equal(m.nativePagePixels(10, 1), 100); assert.equal(m.nativePagePixels(500, 0.5), 500);
// sharper than the old reading tier (≤1200, dp-based) for a typical tablet page
assert.ok(m.nativePagePixels(900, 2.25) > 1200);
// native only on device builds that have the view, and not for thumbnails
assert.equal(m.useNativeSurface(true, 'android', 800), true); assert.equal(m.useNativeSurface(true, 'ios', 800), true);
assert.equal(m.useNativeSurface(false, 'android', 800), false); assert.equal(m.useNativeSurface(true, 'web', 800), false);
assert.equal(m.useNativeSurface(true, 'ios', 120), false);
// warm batching: one ordered, de-duplicated list per document/width per window
const sent = []; const w = m.createWarmBatcher((uri, idx, px) => sent.push([uri, idx.join(','), px]));
w.window(() => { w.add('a', 7, 1600, 2); w.add('a', 6, 1600, 1); w.add('a', 4, 1600, 3); w.add('a', 6, 1600, 4); w.add('b', 1, 800, 1); w.add('a', -1, 1600, 0); });
assert.deepEqual(sent, [['a', '6,7,4', 1600], ['b', '1', 800]]);
sent.length = 0; w.add('a', 9, 1600, 1); assert.deepEqual(sent, [['a', '9', 1600]]);
sent.length = 0; assert.throws(() => w.window(() => { w.add('a', 2, 1600, 1); throw new Error('x'); })); assert.deepEqual(sent, [['a', '2', 1600]]);
// PdfPage wiring: native surface for the base page, blurry preview tier not used on that path, JS image path kept as fallback
const page = fs.readFileSync('src/features/viewer/PdfPage.tsx', 'utf8');
assert.match(page, /function NativePdfPage/); assert.match(page, /return <ImagePdfPage \{\.\.\.props\} \/>/);
const nativeFn = page.slice(page.indexOf('function NativePdfPage'), page.indexOf('function ImagePdfPage'));
assert.doesNotMatch(nativeFn, /previewPixels|usePageImage|renderReading/);
assert.match(nativeFn, /onFailure\(\)/);
// native modules expose the view and never encode/write on its path
for (const f of ['modules/pdf-renderer/android/src/main/java/expo/modules/pdfrenderer/PdfPageView.kt', 'modules/pdf-renderer/ios/PdfPageView.swift']) {
  const s = fs.readFileSync(f, 'utf8'); assert.doesNotMatch(s, /compress\(|jpegData|write\(to:/); assert.match(s, /onPageReady/);
}
const swift = fs.readFileSync('modules/pdf-renderer/ios/PdfRendererModule.swift', 'utf8');
const pb = swift.slice(swift.indexOf('func pageBitmap'), swift.indexOf('public func definition'));
assert.match(pb, /tryBeginOperation/, 'reading-queue caller must not wait on maintenance (deadlock)');
assert.doesNotMatch(pb, /jpegData|write\(to:/);
console.log('native page view: ok');
