const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
/**
 * iOS "zoom looks soft" regression gate.
 *
 * Root cause 1 (compositing): a rounded clip around the page subtree (borderRadius + overflow:'hidden') makes iOS
 * composite that subtree through an offscreen buffer at the page's own resolution; the zoom transform then magnifies
 * that 1x buffer, so the page stays soft at any zoom however sharp the tile inside it is. Android clips while
 * replaying the draw list, so only iOS was affected. The page container must therefore drop the rounded clip and the
 * iOS shadow while the document is magnified, and keep them at 1x.
 *
 * Root cause 2 (fallback): the sharp layer used to be gated on the base page bitmap's ready event and one failed tile
 * disabled it for the rest of the visit, leaving the page on the soft raster. The tile must mount on its own and be
 * retried a bounded number of times, and a failed tile must fall back to the detail raster, never to the reading one.
 */
const read = (p) => fs.readFileSync(p, 'utf8');
const doc = read('src/features/viewer/DocumentView.tsx');
const page = read('src/features/viewer/PdfPage.tsx');

// 1. The magnified page container is iOS-specific and drops the rounded clip + shadow that force the offscreen pass.
assert(doc.includes("const IS_IOS = Platform.OS === 'ios';"), 'DocumentView must know the platform');
assert(doc.includes('IS_IOS && magnified && styles.pageZoomed'), 'the flat page style must be iOS-only and zoom-only');
assert(/useAnimatedReaction\(\(\) => z\.value > 1\.001, \(on, prev\) => \{ if \(on !== prev\) runOnJS\(setMagnified\)\(on\); \}/.test(doc), 'magnified state must follow the live zoom');
const flat = doc.slice(doc.indexOf('pageZoomed:'), doc.indexOf('pageZoomed:') + 320);
assert(/borderRadius: 0/.test(flat) && /overflow: 'visible'/.test(flat), 'the magnified page must not clip');
assert(/shadowOpacity: 0/.test(flat) && /shadowRadius: 0/.test(flat), 'the magnified page must not ask for an iOS shadow');
assert(/elevation: 0/.test(flat), 'the magnified page must not keep the raised Android layer either');
const base = doc.slice(doc.indexOf('page: { position'), doc.indexOf('page: { position') + 200);
assert(/overflow: 'hidden'/.test(base) && /borderRadius: 3/.test(base), 'at 1x the rounded page card must stay');

// 2. The sharp tile no longer depends on the base bitmap and is retried instead of being dropped for good.
assert(!/ready === page && tile/.test(page), 'the zoom tile must not wait for the base page bitmap');
assert(/function useTileFailure\(\)/.test(page) && /TILE_RETRIES = 3/.test(page), 'tile failures need a bounded retry clock');
assert(/setTimeout\(\(\) => \{ setFailed\(null\); setAttempt\(n => n \+ 1\); \}, TILE_RETRY_MS\)/.test(page), 'a failed tile must be requested again after the retry delay');
assert(/const \[attempt, setAttempt\] = useState\(0\)/.test(page), 'the retry counter drives a fresh request');
// both page paths retry, and the image path widens to the detail raster while the tile is failed
const native = page.slice(page.indexOf('function NativePdfPage'), page.indexOf('function ImagePdfPage'));
const image = page.slice(page.indexOf('function ImagePdfPage'), page.indexOf('export function clearImageCache'));
for (const [name, body] of [['native', native], ['image', image]]) {
  assert(body.includes('useTileFailure()'), name + ' path must own a tile failure clock');
  assert(/retry=\{tileFailure\.attempt\}/.test(body), name + ' path must re-request with the retry counter');
  assert(/tileFailure\.failed !== tileRequest/.test(body), name + ' path must re-enable the tile after a retry');
}
assert(/allowed && \(!tileFirst \|\| tileFailure\.failed === tileRequest\)/.test(page), 'a failed tile must expose the detail raster');
assert(/\[uri, index, tile\?\.pxW, tile\?\.x, tile\?\.y, tile\?\.w, tile\?\.h, allowed, token, retry, sourceKey, needed\]\);/.test(page), 'TileLayer must re-request when the retry counter (or its pixel source) changes');

// 3. Behaviour: a failed tile is really requested again when the retry counter is bumped.
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: (n) => (n in mocks ? mocks[n] : require(n)), console, Date, setTimeout, clearTimeout });
  return exports;
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let slots = [], pos = 0, effects = [], allowed = true, calls = [], failures = [];
const R = {
  useState: (init) => { const i = pos++; if (!(i in slots)) slots[i] = init; return [slots[i], (v) => (slots[i] = typeof v === 'function' ? v(slots[i]) : v)]; },
  useRef: (init) => { const i = pos++; return slots[i] ?? (slots[i] = { current: init }); },
  useContext: () => allowed,
  useEffect: (fn, deps) => { const i = pos++, old = slots[i]; if (!old || deps.some((v, k) => v !== old.deps[k])) { old?.cleanup?.(); const entry = { deps }; slots[i] = entry; effects.push(() => (entry.cleanup = fn())); } },
};
const jsx = (type, props, key) => ({ type, props, key });
const G = load('src/features/viewer/pdfTileGeometry.ts'), S = load('src/features/viewer/renderScheduler.ts'), W = load('src/features/viewer/pdfWork.ts', { './renderScheduler': S });
const P = load('src/features/viewer/PdfPage.tsx', {
  'react': R, './derivedPages': { DerivedPagesContext: {}, pageImage: async () => null, forUri: () => null, isPresentSync: () => false, pageImagePath: () => null , useDerivedFile: () => 'absent' }, './DerivedPage': { DerivedPdfPage: 'DerivedPdfPage', useDerivedSharpSource: () => ({ needed: false, source: undefined, vector: false }) }, './SharpFrame': { SharpFrame: 'SharpFrame', sharpTileRect: () => ({ left: 0, top: 0, width: 1, height: 1, exact: true }) },
  './derivedPagesCore': { tierWidth: () => null }, './nativePageView': load('src/features/viewer/nativePageView.ts'),
  './tileProgress': load('src/features/viewer/tileProgress.ts'), 'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { Image: 'Image', Platform: { OS: 'ios' }, PixelRatio: { get: () => 3 } },
  '../../../modules/pdf-renderer': { PdfRenderer: { hasRenderRegion: () => true, renderRegion: async (...args) => { const d = defer(); calls.push({ args, ...d }); return d.promise }, takeRenderTimings: async () => [] } },
  '@/theme': {}, '@/lib/diag': { reportError() {} }, './renderScheduler': S, './pdfWork': W,
  './pdfDiagnostics': { createPreparationReporter: () => () => {}, createImageLoadReporter: () => ({}) },
  './PdfImageLayers': { PdfImageLayers: 'PdfImageLayers' }, './pageQuality': { PageQualityContext: {} }, './pdfTileGeometry': G,
});
function defer() { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve: (v) => resolve(v), reject: (e) => reject(e) }; }
const tile = G.boundedPageTile(1200, 1600, 0, 0, 600, 800, 3);
const render = (retry) => { pos = 0; const out = P.TileLayer({ uri: 'doc', index: 0, tile, width: 600, height: 800, retry, onFailure: (k) => failures.push(k) }); effects.splice(0).forEach((f) => f()); return out.props.children; };
(async () => {
  render(0); await flush();
  assert.equal(calls.length, 1, 'the first attempt must ask the native renderer once');
  calls[0].reject(new Error('PDF_PAGE_INVALID')); await flush();
  assert.deepEqual(failures, [G.pageTileKey(tile)], 'a failed region must report its exact crop');
  // the page component bumps retry after the delay: the same region is requested again
  render(1); await flush();
  assert.equal(calls.length, 2, 'a retried tile must ask the native renderer again');
  assert.deepEqual(calls[1].args, calls[0].args, 'a retry must request the identical region');
  calls[1].resolve('file://tile.jpg'); await flush();
  const images = render(1);
  assert.equal(images[0].props.source.uri, 'file://tile.jpg', 'the retried tile must be shown');
  console.log('PASS: iOS magnified page drops the rounded clip/shadow that force a 1x offscreen composite; zoom tile mounts without the base bitmap, retries a failed region and falls back to the detail raster');
})().catch((e) => { console.error(e); process.exitCode = 1; });
