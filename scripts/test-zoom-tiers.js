// node scripts/test-zoom-tiers.js — textbook pages on server rasters (reading → detail → on-demand zoom image) and when
// the device PDF engine is still asked for a vector tile (docs/ios-zoom-sharpness.md, docs/derived-pages.md).
// Pure JS with a mocked file system. It proves the selection/ordering/download rules, not device pixels.
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
const eq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
function load(file, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const exports = {}; vm.runInNewContext(source, { exports, require: n => n in mocks ? mocks[n] : require(n), console, Map, Set, Promise, Date, JSON, Math, Number, Array, Object, Error, String, RegExp, setTimeout, clearTimeout }); return exports;
}
const core = load('src/features/viewer/derivedPagesCore.ts');
const info = { version: 1, pages: 14, widths: [1200, 2000], words: true, dir: 'file:///docs/derived/m/v1/' };

// ---- naming: the zoom tier is addressed by convention and is never part of the manifest widths ----
assert.equal(core.ZOOM_WIDTH, 3600); assert.equal(core.zoomName(7), 'p7-3600.jpg');
assert.equal(core.zoomImagePath(info, 7), 'file:///docs/derived/m/v1/p7-3600.jpg'); assert.equal(core.zoomImagePath(info, 14), null); assert.equal(core.zoomImagePath(null, 0), null);
assert(!core.derivedFileNames({ pages: 3, widths: [1200, 2000], words: true }).some(n => n.includes('3600')), 'the complete set every app version downloads has no zoom files');
assert.equal(core.tierWidth(info, 'detail'), 2000, 'detail stays the largest LISTED width');
assert.equal(core.zoomMarked('pypdfium2 5.15.2 (pdfium) z3600'), true); assert.equal(core.zoomMarked('pypdfium2 5.15.2 (pdfium)'), false); assert.equal(core.zoomMarked(undefined), false); assert.equal(core.zoomMarked('xz36000'), false);

// ---- which raster is enough ----
// iPad 11" portrait: page 806 pt wide at 2x = 1612 device px at zoom 1.
const ipad = z => Math.round(806 * 2 * z);
assert.equal(core.zoomTierWanted(ipad(1), 2000), false, 'zoom 1: the 2000 px detail raster covers the page');
assert.equal(core.zoomTierWanted(ipad(1.35), 2000), false, 'within the sharpness margin');
assert.equal(core.zoomTierWanted(ipad(1.5), 2000), true); assert.equal(core.zoomTierWanted(ipad(2.5), 2000), true); assert.equal(core.zoomTierWanted(0, 2000), false);
assert.equal(core.vectorTileWanted(ipad(2.5), 3600), false, '250 %: the 3600 px zoom image is enough, no device engine');
assert.equal(core.vectorTileWanted(ipad(2.9), 3600), false); assert.equal(core.vectorTileWanted(ipad(3.5), 3600), true, 'deep zoom still gets a vector tile');
// iPhone (390 pt page at 3x): the zoom image covers every magnification up to 400 %
assert.equal(core.vectorTileWanted(390 * 3 * 4, 3600), false);

// ---- full-resolution layout: the image keeps all its pixels under an ancestor zoom transform ----
eq(core.fullResImageStyle(1200, 806, 1140, 2), { position: 'absolute', left: 0, top: 0, width: 806, height: 1140 }, 'fewer pixels than the box: plain layout');
const big = core.fullResImageStyle(3600, 1612, 2280, 2);
assert.equal(big.width, 1800); assert(Math.abs(big.height - 1800 * 2280 / 1612) < 1e-9); assert(Math.abs(big.transform[0].scale - 1612 / 1800) < 1e-12); assert.equal(big.transformOrigin, 'top left');
assert(Math.abs(big.width * big.transform[0].scale - 1612) < 1e-9, 'lands exactly on the page box');
eq(core.fullResImageStyle(2000, 0, 0, 2), { position: 'absolute', left: 0, top: 0, width: 0, height: 0 });

// ---- pruning zoom files ----
const many = Array.from({ length: 60 }, (_, i) => ({ name: `p${i}-3600.jpg`, mtime: i }));
eq(core.zoomFilesToPrune(many.slice(0, 56)), [], 'under the limit nothing is removed');
const gone = core.zoomFilesToPrune([...many, { name: 'p1-2000.jpg', mtime: -5 }, { name: 'p1-1200.jpg', mtime: -9 }]);
assert.equal(gone.length, 20); eq(gone.slice(0, 2), ['p0-3600.jpg', 'p1-3600.jpg']); assert(!gone.some(n => !n.endsWith('-3600.jpg')), 'reading/detail files are never pruned');

// ---- file state: nothing is assumed absent before the disk answered ----
const disk = new Map(); const log = [];
const FS = { documentDirectory: 'file:///docs/', getInfoAsync: async (p) => disk.has(p) ? { exists: true, size: 100, modificationTime: disk.get(p) } : { exists: false }, makeDirectoryAsync: async () => {}, deleteAsync: async (p) => { disk.delete(p); },
  moveAsync: async ({ from, to }) => { disk.set(to, disk.get(from)); disk.delete(from); }, readAsStringAsync: async (p) => disk.get(p), readDirectoryAsync: async (dir) => [...disk.keys()].filter(k => k.startsWith(dir)).map(k => k.slice(dir.length)),
  downloadAsync: async (url, dest) => { log.push(url); if (url.includes('fail')) return { status: 500 }; disk.set(dest, 1000 + log.length); return { status: 200 }; } };
const reactMock = { createContext: () => ({}), useEffect: () => {}, useRef: v => ({ current: v }), useState: v => [v, () => {}] };
const mkPages = (os = 'ios') => load('src/features/viewer/derivedPages.ts', { react: reactMock, 'react-native': { Platform: { OS: os } }, 'expo-file-system/legacy': FS, './derivedPagesCore': core });
const pages = mkPages();
const S = pages.derivedFileState;
assert.equal(S({ path: null, present: false, checked: false, downloading: false, timedOut: false }), 'absent');
assert.equal(S({ path: 'p', present: false, checked: false, downloading: false, timedOut: false }), 'pending', 'after a restart the disk is asked first');
assert.equal(S({ path: 'p', present: true, checked: false, downloading: false, timedOut: false }), 'present');
assert.equal(S({ path: 'p', present: false, checked: true, downloading: true, timedOut: false }), 'pending', 'the download manager is delivering it');
assert.equal(S({ path: 'p', present: false, checked: true, downloading: true, timedOut: true }), 'absent', 'bounded wait');
assert.equal(S({ path: 'p', present: false, checked: true, downloading: false, timedOut: false }), 'absent');
// listeners fire once when a file becomes present; directory activity is counted
let fired = 0; const off = pages.onPresent('file:///x/p0-1200.jpg', () => fired++); pages.markPresent('file:///x/p0-1200.jpg'); pages.markPresent('file:///x/p0-1200.jpg'); assert.equal(fired, 1); off();
pages.setDownloadActive('file:///x/', true); pages.setDownloadActive('file:///x/', true); assert.equal(pages.isDownloadActive('file:///x/'), true); pages.setDownloadActive('file:///x/', false); assert.equal(pages.isDownloadActive('file:///x/'), true); pages.setDownloadActive('file:///x/', false); assert.equal(pages.isDownloadActive('file:///x/'), false);
// platform switch
assert.equal(pages.zoomAvailable(info), true); assert.equal(mkPages('android').zoomAvailable(info), false, 'Android keeps its own tile renderer'); assert.equal(pages.zoomAvailable(null), false);

// ---- tier selection and the vector-tile decision ----
assert.equal(pages.zoomHabitual(), false); pages.noteZoomUse(); assert.equal(pages.zoomHabitual(), true);
const D = load('src/features/viewer/DerivedPage.tsx', { react: { ...reactMock, useContext: () => false, createElement: () => null }, 'react-native': { View: 'View', Image: 'Image', PixelRatio: { get: () => 2 } }, './pageQuality': { PageQualityContext: {} }, './derivedPages': pages, './derivedPagesCore': core, '../../../modules/pdf-renderer': { PdfRenderer: { hasCropImage: () => true, hasRenderRegion: () => true, cropImage: async () => 'crop' } } });
const base = { reading: 'r', readingPx: 1200, detail: 'd', detailPx: 2000 };
eq(D.derivedTiers({ ...base, detailOn: false, zoom: 'z', zoomOn: false }).map(t => t.key), ['reading'], 'a moving / off-screen page shows the reading raster only');
eq(D.derivedTiers({ ...base, detailOn: true, zoom: null, zoomOn: true }).map(t => t.key), ['reading', 'detail'], 'zoom image not on disk yet: detail stays');
eq(D.derivedTiers({ ...base, detailOn: true, zoom: 'z', zoomOn: true }).map(t => [t.key, t.px]), [['reading', 1200], ['detail', 2000], ['zoom', 3600]], 'lower tiers stay underneath');
eq(D.derivedTiers({ ...base, detail: null, detailOn: true, zoom: 'z', zoomOn: true }).map(t => t.key), ['reading', 'zoom']);
eq(D.derivedTiers({ reading: 'r', readingPx: 1500, detail: 'r', detailPx: 1500, detailOn: true, zoom: null, zoomOn: false }).map(t => t.key), ['reading'], 'single-width set: no duplicate layer');
// tablets: the detail raster is the first image (no soft-then-sharp page); phones keep the light reading raster
assert.equal(D.detailFirst(1612, 1200), true, 'iPad 11 portrait page box'); assert.equal(D.detailFirst(2048, 1200), true); assert.equal(D.detailFirst(1170, 1200), false, 'iPhone'); assert.equal(D.detailFirst(1340, 1200), false, 'inside the sharpness margin'); assert.equal(D.detailFirst(0, 1200), false);
// ---- iOS screen-space sharp layer: what it shows for a textbook page ----
const plan = o => { const p = D.derivedSharpPlan({ detailPx: 2000, detailOnDisk: true, canCrop: true, canVector: true, ...o }); return p.kind + (p.tier ? ':' + p.tier : ''); };
// 11" iPad: the page box is 1612 px, so the paper layer shows the detail raster decoded to 1612 px
assert.equal(plan({ neededPx: ipad(1), paperPx: 1612, zoomState: 'present' }), 'none', 'un-magnified: the page layer is enough');
assert.equal(plan({ neededPx: ipad(1.1), paperPx: 1612, zoomState: 'present' }), 'none');
assert.equal(plan({ neededPx: ipad(1.3), paperPx: 1612, zoomState: 'coming' }), 'crop:detail', 'while the zoom image downloads the detail raster is cropped, never the PDF engine started');
assert.equal(plan({ neededPx: ipad(2.2), paperPx: 1612, zoomState: 'coming' }), 'crop:detail');
assert.equal(plan({ neededPx: ipad(2.2), paperPx: 1612, zoomState: 'present' }), 'crop:zoom');
assert.equal(plan({ neededPx: ipad(2.9), paperPx: 1612, zoomState: 'present' }), 'crop:zoom');
assert.equal(plan({ neededPx: ipad(3.6), paperPx: 1612, zoomState: 'present' }), 'vector', 'deep zoom: beyond every raster');
assert.equal(plan({ neededPx: ipad(3.6), paperPx: 1612, zoomState: 'coming' }), 'vector');
// no zoom tier (offline / old material): detail while it is enough, then the engine as before
assert.equal(plan({ neededPx: ipad(1.3), paperPx: 1612, zoomState: 'none' }), 'crop:detail');
assert.equal(plan({ neededPx: ipad(2.2), paperPx: 1612, zoomState: 'none' }), 'vector');
// 13" iPad: the box (2008 px) already shows the whole detail raster, so there is nothing to crop from it
assert.equal(plan({ neededPx: 2008 * 1.5, paperPx: 2000, zoomState: 'none' }), 'vector'); assert.equal(plan({ neededPx: 2008 * 1.5, paperPx: 2000, zoomState: 'coming' }), 'none', 'wait for the zoom image');
assert.equal(plan({ neededPx: 2008 * 1.5, paperPx: 2000, zoomState: 'present' }), 'crop:zoom');
// a binary without the crop function (JS patched over the air): the engine, as before
assert.equal(plan({ neededPx: ipad(2.2), paperPx: 1612, zoomState: 'present', canCrop: false }), 'vector'); assert.equal(plan({ neededPx: ipad(2.2), paperPx: 1612, zoomState: 'present', canCrop: false, canVector: false }), 'none');
assert.equal(plan({ neededPx: 0, paperPx: 1612, zoomState: 'present' }), 'none');

// ---- the frame: one tile pixel = one screen pixel while the document rests, and it follows the document ----
const F = load('src/features/viewer/SharpFrame.tsx', { react: reactMock, 'react-native': { PixelRatio: { get: () => 2 } }, 'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' }, useAnimatedStyle: fn => fn() } });
const box = { x: 14, y: 14, w: 806, h: 1140 }, at = { z: 2.2, tx: -310.4, ty: -905.3 };
// a tile computed for the viewport at this transform: pxW = page width in device px, window = the visible part
const pxW = Math.floor(806 * 2.2 * 2), tileT = { nx: 300 / pxW, ny: 1200 / pxW / (1140 / 806), nw: 1668 / pxW, nh: 2388 / (pxW * 1140 / 806) };
const r = F.sharpTileRect(box, tileT, { w: 1668, h: 2388 }, at, 2);
assert.equal(r.exact, true); assert.equal(r.width, 834); assert.equal(r.height, 1194, 'laid out at exactly px ÷ dpr'); assert.equal(r.left * 2, Math.round(r.left * 2)); assert.equal(r.top * 2, Math.round(r.top * 2), 'on a device pixel boundary');
assert(Math.abs(r.left - (at.tx + (box.x + tileT.nx * box.w) * at.z)) <= 0.25, 'within half a device pixel of the true position');
const coarse = F.sharpTileRect(box, tileT, { w: 834, h: 1194 }, at, 2); assert.equal(coarse.exact, false); assert(Math.abs(coarse.width - 834) < 1.5, 'a reduced tile keeps the true on-screen size');
const idt = F.sharpMotionTransform(at, at.z, at.tx, at.ty, 834, 1194); assert.equal(idt.scale, 1); assert.equal(Math.abs(idt.translateX), 0); assert.equal(Math.abs(idt.translateY), 0, 'identity while the document rests where the tile was made');
// after a pan + pinch the same content point is still under the same tile point (centre-origin scale as React Native applies it)
const now = { z: 3.1, tx: -520, ty: -1400 }, m = F.sharpMotionTransform(at, now.z, now.tx, now.ty, 834, 1194);
const tilePoint = { x: 200, y: 300 }, content = { x: (tilePoint.x - at.tx) / at.z, y: (tilePoint.y - at.ty) / at.z };
const onScreen = { x: 417 + m.scale * (tilePoint.x - 417) + m.translateX, y: 597 + m.scale * (tilePoint.y - 597) + m.translateY };
assert(Math.abs(onScreen.x - (now.tx + now.z * content.x)) < 1e-9 && Math.abs(onScreen.y - (now.ty + now.z * content.y)) < 1e-9);
const V = D.wantsVectorTile;
assert.equal(V({ neededPx: ipad(1), detailPx: 2000, zoomState: 'none' }), false, 'zoom 1: never the device engine');
assert.equal(V({ neededPx: ipad(2.2), detailPx: 2000, zoomState: 'coming' }), false, 'while the zoom image downloads the engine is not started');
assert.equal(V({ neededPx: ipad(2.2), detailPx: 2000, zoomState: 'present' }), false);
assert.equal(V({ neededPx: ipad(2.2), detailPx: 2000, zoomState: 'none' }), true, 'no zoom tier (Android / offline / old material): vector tile as before');
assert.equal(V({ neededPx: ipad(3.6), detailPx: 2000, zoomState: 'present' }), true, 'beyond the zoom image');
assert.equal(V({ neededPx: 0, detailPx: 2000, zoomState: 'none' }), false);

// ---- download manager: on-demand zoom image ----
let docsState = { docs: { d1: { id: 'd1', materialId: 'm1', kind: 'pdf', lastPage: 0, pages: [], derived: { version: 1, pages: 3, widths: [1200, 2000], words: true } } } };
const docsStore = { getState: () => ({ ...docsState, update: (id, patch) => { docsState.docs[id] = { ...docsState.docs[id], ...patch }; } }) };
let wifiOnly = false, netType = 'WIFI', serverHasZoom = true; const urlCalls = [];
const settingsStore = { getState: () => ({ derivedWifiOnly: wifiOnly }) };
const zustand = { create: () => (init) => { let state; const set = (fn) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) }; }; state = init(set, () => state); const hook = () => state; hook.getState = () => state; return hook; } };
const mkDl = (p) => load('src/features/library/derivedDownload.ts', { 'react-native': { Platform: { OS: 'ios' } }, 'expo-file-system/legacy': FS, zustand,
  '@/lib/api': { api: { materials: { derivedUrls: async (c, id, files) => { urlCalls.push([...files]); return { urls: files.filter(f => serverHasZoom || !f.includes('3600')).map(f => ({ path: `derived/${id}/v1/${f}`, url: `https://x/${id}/${f}` })) }; } } } },
  '@/store/docs': { useDocsStore: docsStore }, '@/store/settings': { useSettingsStore: settingsStore }, '@/features/viewer/derivedPagesCore': core, '@/features/viewer/derivedPages': p,
  'expo-network': { NetworkStateType: { CELLULAR: 'CELLULAR' }, getNetworkStateAsync: async () => ({ type: netType }) } });
(async () => {
  const dl = mkDl(pages); const i1 = dl.infoFor(docsState.docs.d1); const dir = i1.dir;
  assert(dl.SIGN_BATCH <= 300 && dl.URL_TTL_MS < 900_000, 'signed-URL requests stay under the server cap and URLs are never used near their 900 s expiry');
  // the base set (what every version downloads) still has exactly 9 files and no zoom image
  await dl.ensureDerived('code', docsState.docs.d1, { page: 1 });
  assert.equal([...disk.keys()].filter(k => k.includes('3600')).length, 0); assert.equal(log.length, 9);
  assert.equal(pages.isDownloadActive(dir), false, 'activity flag cleared when the run ends');
  // a page asks for its zoom image through the registered requester: one URL, one file, once
  log.length = 0; urlCalls.length = 0;
  pages.requestZoomPage(i1, 2); pages.requestZoomPage(i1, 2); await dl.ensureZoomPage(dir, 2);
  eq(urlCalls, [['p2-3600.jpg']], 'requested alone, and concurrent requests share one run'); eq(log.map(u => u.split('/').pop()), ['p2-3600.jpg']);
  assert.equal(pages.isPresentSync(dir + 'p2-3600.jpg'), true);
  pages.requestZoomPage(i1, 2); await dl.ensureZoomPage(dir, 2); assert.equal(log.length, 1, 'already on disk: nothing fetched');
  // wifi-only on cellular: not fetched, remembered as a recent failure so the vector path can take over
  wifiOnly = true; netType = 'CELLULAR'; await dl.ensureZoomPage(dir, 0); assert.equal(log.length, 1); assert.equal(pages.zoomRecentlyFailed(dir + 'p0-3600.jpg'), true); wifiOnly = false; netType = 'WIFI';
  // a failing download is a per-file failure, not "no zoom tier"
  const dlFail = mkDl(pages); dlFail._zoom.registerDir('file:///docs/derived/fail/v1/', 'fail'); await dlFail.ensureZoomPage('file:///docs/derived/fail/v1/', 1);
  assert.equal(pages.zoomRecentlyFailed('file:///docs/derived/fail/v1/p1-3600.jpg'), true); assert.equal(pages.zoomAvailable({ ...info, dir: 'file:///docs/derived/fail/v1/' }), true);
  // a material whose server set has no zoom tier: learned from the first probe, then never asked again
  const pagesB = mkPages(); const dlB = mkDl(pagesB); serverHasZoom = false; urlCalls.length = 0;
  dlB._zoom.registerDir('file:///docs/derived/old/v1/', 'old'); const oldInfo = { ...info, dir: 'file:///docs/derived/old/v1/' };
  assert.equal(pagesB.zoomAvailable(oldInfo), true); await dlB.ensureZoomPage(oldInfo.dir, 0); assert.equal(pagesB.zoomAvailable(oldInfo), false);
  pagesB.requestZoomPage(oldInfo, 1); assert.equal(urlCalls.length, 1, 'no further probes for that material'); serverHasZoom = true;
  // pruning runs after a download once the directory holds more than the limit
  for (let i = 0; i < 60; i++) disk.set(`file:///docs/derived/big/v1/p${i}-3600.jpg`, i); disk.set('file:///docs/derived/big/v1/p0-1200.jpg', 0);
  const dlP = mkDl(mkPages()); dlP._zoom.registerDir('file:///docs/derived/big/v1/', 'big'); await dlP.ensureZoomPage('file:///docs/derived/big/v1/', 70); await new Promise(r => setTimeout(r, 20));
  const left = [...disk.keys()].filter(k => k.startsWith('file:///docs/derived/big/v1/')); assert.equal(left.filter(k => k.endsWith('-3600.jpg')).length, 40); assert(left.includes('file:///docs/derived/big/v1/p0-1200.jpg')); assert(left.includes('file:///docs/derived/big/v1/p70-3600.jpg'), 'the newest file survives');

  // ---- re-prioritisation happens every small batch: a jump to another chapter is served next ----
  disk.clear(); log.length = 0; urlCalls.length = 0;
  docsState.docs.d9 = { id: 'd9', materialId: 'm9', kind: 'pdf', lastPage: 0, pages: [], derived: { version: 1, pages: 120, widths: [1200, 2000], words: true } };
  const pagesC = mkPages(); const dlC = mkDl(pagesC); let jumped = false;
  const origDownload = FS.downloadAsync; FS.downloadAsync = async (url, dest) => { if (!jumped && log.length >= 10) { jumped = true; dlC.prioritise('m9', 100); } return origDownload(url, dest); };
  await dlC.ensureDerived('code', docsState.docs.d9, { page: 0 }); FS.downloadAsync = origDownload;
  const order = log.map(u => u.split('/').pop()); const at = order.indexOf('p100-1200.jpg');
  assert(at > 0 && at <= 36 + 2, `page 100 is fetched right after the running batch (was at ${at} of ${order.length})`);
  assert.equal(order.length, 360);

  // ---- source contracts ----
  const page = fs.readFileSync('src/features/viewer/PdfPage.tsx', 'utf8');
  const raster = page.slice(page.indexOf('function RasterPdfPage'), page.indexOf('function NativePdfPage'));
  assert(/useDerivedFile\(readPath\)/.test(raster) && !/isPresentSync/.test(raster), 'the page decides from the reactive file state, not the in-memory index');
  assert(/derivedFile === 'present'[^]*<DerivedPdfPage/.test(raster) && /derivedFile === 'pending'/.test(raster));
  assert(raster.indexOf("derivedFile === 'pending'") < raster.indexOf('<NativePdfPage'), 'a pending server page never reaches the device renderer');
  const docView = fs.readFileSync('src/features/viewer/DocumentView.tsx', 'utf8'); const slot = docView.slice(docView.indexOf('function PageSlot'), docView.indexOf('const ZoomBadge'));
  assert(!/return <>\{render\(\)\}<\/>/.test(slot) && /rs === 1 \? undefined :/.test(slot), 'one wrapper at every density: no remount when the zoom crosses 120 %');
  assert(/idleMs: DETAIL_IDLE_MS/.test(docView) && /Platform\.OS === 'ios' \? IOS_DETAIL_IDLE_MS : PDF_DETAIL_IDLE_MS/.test(docView));
  // the sub window (서브교재) shows another document: it must carry that document's set, never inherit the main one
  const sub = fs.readFileSync('src/features/viewer/SubDocWindow.tsx', 'utf8');
  assert(/<DerivedPagesContext\.Provider value=\{derived\}><SubDocWindowBody/.test(sub) && /props\.mode === 'show' && props\.docId \? s\.docs\[props\.docId\] : null/.test(sub), 'own provider; none for the document picker');
  // layered surface: paper · viewport-space sharp layer · ink, selected by renderPaper; the single-layer path is untouched
  assert(/\{layered \? renderPaper!\(i, bx, tiles\[i\]\) : <PageSlot box=\{bx\} rs=\{rs\} render=\{\(\) => renderPage\(i, bx, rs, tiles\[i\]\)\} \/>\}/.test(docView), 'without renderPaper the page is drawn exactly as before');
  assert(docView.indexOf('{layered && renderSharp ?') > docView.indexOf('renderPaper!(i, bx, tiles[i])') && docView.indexOf('{layered ? <Animated.View') > docView.indexOf('{layered && renderSharp ?'), 'order: paper, sharp layer, ink');
  assert(/out\[i\] = \{ \.\.\.tile, at: \{ z: zz, tx: x0, ty: y0 \} \}/.test(docView), 'every tile records the transform it was made for');
  const viewer = fs.readFileSync('app/viewer/[docId].tsx', 'utf8');
  assert(/const LAYERED_SURFACE = Platform\.OS === 'ios';/.test(viewer) && /sharp="none"/.test(viewer) && /<PdfSharp uri=\{uri\}/.test(viewer) && /\{!LAYERED_SURFACE && <PdfPage/.test(viewer));
  const pageView = fs.readFileSync('modules/pdf-renderer/ios/PdfPageView.swift', 'utf8'); assert(/minificationFilter = \.linear/.test(pageView) && !/minificationFilter = \.trilinear/.test(pageView), 'no pre-shrunk copies of the page bitmap');
  const swift = fs.readFileSync('modules/pdf-renderer/ios/PdfRendererModule.swift', 'utf8'); assert(/private let maxParsedPages = 2\b/.test(swift), 'interpreted pages are ~385 MB each on textbooks: keep two');
  const gen = fs.readFileSync('scripts/derived/generate.py', 'utf8');
  assert(/^WIDTHS = \[1200, 2000\]$/m.test(gen) && /^ZOOM_WIDTH = 3600$/m.test(gen), 'the manifest widths older apps rely on are unchanged');
  assert(/'widths': WIDTHS/.test(gen) && !/'widths': \[[^\]]*3600/.test(gen)); assert(/raise RuntimeError\(f'upload URLs refused/.test(gen), 'the marker is only written after every file was accepted');
  const fn = fs.readFileSync('supabase/functions/docs/index.ts', 'utf8');
  assert.equal((fn.match(/p\\d\{1,4\}-\(1200\|2000\|2400\|3600\)\\\.jpg/g) ?? []).length, 2, 'the deployed function already accepts and serves 3600 px files (upload + download whitelists)');
  // idle gate honours a custom pause
  const idle = load('src/features/viewer/idleQuality.ts', { './pdfWork': { PDF_DETAIL_IDLE_MS: 800 } }); const timers = [];
  const g = idle.createIdleQualityGate({ idleMs: 350, onReady: () => {}, isBusy: () => false, setTimer: (fn, ms) => { timers.push(ms); return 1; }, clearTimer: () => {} }); g.activity(); eq(timers, [350]);
  const g2 = idle.createIdleQualityGate({ onReady: () => {}, isBusy: () => false, setTimer: (fn, ms) => { timers.push(ms); return 1; }, clearTimer: () => {} }); g2.activity(); eq(timers, [350, 800]);
  console.log('PASS: zoom tier naming/selection, full-resolution layout, pending-before-absent file state, tier stacking, vector-tile last resort, on-demand zoom download (dedupe, wifi-only, failure, no-tier probe, pruning), small re-prioritised batches, stable page wrapper, iOS parsed-page limit, generator/server compatibility');
})().catch(e => { console.error(e); process.exit(1); });
