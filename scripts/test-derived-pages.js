// node scripts/test-derived-pages.js — pre-rendered page sets (docs/derived-pages.md): naming, ordering, batching,
// image/word selection and the download manager's resume logic. Pure JS with mocked file system; no device claims.
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
const eq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
function load(file, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  // run in this realm's globals so arrays/objects compare structurally with assert
  const exports = {}; vm.runInNewContext(source, { exports, require: n => n in mocks ? mocks[n] : require(n), console, Map, Set, Promise, Date, JSON, Math, Number, Array, Object, Error, String, RegExp }); return exports;
}
const core = load('src/features/viewer/derivedPagesCore.ts');
// naming + file set
assert.equal(core.imageName(0, 1200), 'p0-1200.jpg'); assert.equal(core.wordsName(12), 'p12-words.json');
assert.equal(core.derivedRelDir('abc', 1), 'derived/abc/v1/');
eq(core.derivedFileNames({ pages: 2, widths: [2000, 1200], words: true }), ['p0-1200.jpg', 'p0-2000.jpg', 'p0-words.json', 'p1-1200.jpg', 'p1-2000.jpg', 'p1-words.json']);
eq(core.derivedFileNames({ pages: 1, widths: [1200], words: false }), ['p0-1200.jpg']);
assert.equal(core.tierWidth({ widths: [2000, 1200] }, 'reading'), 1200); assert.equal(core.tierWidth({ widths: [2000, 1200] }, 'detail'), 2000); assert.equal(core.tierWidth({ widths: [1500] }, 'detail'), 1500); assert.equal(core.tierWidth({ widths: [] }, 'reading'), null);
// selection
const info = { version: 1, pages: 14, widths: [1200, 2000], words: true, dir: 'file:///docs/derived/m/v1/' };
assert.equal(core.pageImagePath(info, 3, 'reading'), 'file:///docs/derived/m/v1/p3-1200.jpg');
assert.equal(core.pageImagePath(info, 3, 'detail'), 'file:///docs/derived/m/v1/p3-2000.jpg');
assert.equal(core.pageImagePath(info, 14, 'reading'), null); assert.equal(core.pageImagePath(null, 0, 'reading'), null); assert.equal(core.pageImagePath({ ...info, dir: '' }, 0, 'reading'), null);
assert.equal(core.wordsPath(info, 5), 'file:///docs/derived/m/v1/p5-words.json'); assert.equal(core.wordsPath({ ...info, words: false }, 5), null);
// manifest parsing
eq(core.parseManifest({ version: 1, pages: 14, widths: [1200, 2000], words: true, bytes: 123, engine: 'pdfium', sizes: [[1, 2]] }), { version: 1, pages: 14, widths: [1200, 2000], words: true, bytes: 123, generatedAt: undefined, engine: 'pdfium' });
assert.equal(core.parseManifest({ pages: 0, widths: [1200] }), null); assert.equal(core.parseManifest(null), null); assert.equal(core.parseManifest({ pages: 3, widths: [] }), null);
// ordering: current page first (reading before detail before words), neighbours by distance, then the rest in page order
const names = core.derivedFileNames({ pages: 10, widths: [1200, 2000], words: true });
const ordered = core.orderForPriority(names, 5, 1200, 2);
eq(ordered.slice(0, 9), ['p5-1200.jpg', 'p5-2000.jpg', 'p5-words.json', 'p4-1200.jpg', 'p6-1200.jpg', 'p4-2000.jpg', 'p6-2000.jpg', 'p4-words.json', 'p6-words.json']);
eq(ordered.slice(9, 12), ['p3-1200.jpg', 'p7-1200.jpg', 'p3-2000.jpg']);
assert.equal(ordered[ordered.length - 1], 'p9-words.json'); assert.equal(ordered.length, names.length);
eq(core.orderForPriority(['p1-2000.jpg', 'p0-1200.jpg', 'p0-2000.jpg'], null, 1200), ['p0-1200.jpg', 'p0-2000.jpg', 'p1-2000.jpg']);
// batching under the signed-URL limit
assert.equal(core.URL_BATCH, 250); const batches = core.chunk(Array.from({ length: 501 }, (_, i) => i), 250); eq(batches.map(b => b.length), [250, 250, 1]); eq(core.chunk([], 5), []);

// ---- download manager with a fake file system ----
const disk = new Map(); const log = [];
const FS = { documentDirectory: 'file:///docs/', getInfoAsync: async (p) => disk.has(p) ? { exists: true, size: disk.get(p) } : { exists: false }, makeDirectoryAsync: async () => {}, deleteAsync: async (p) => { disk.delete(p); }, moveAsync: async ({ from, to }) => { disk.set(to, disk.get(from)); disk.delete(from); }, readAsStringAsync: async (p) => disk.get(p), downloadAsync: async (url, dest) => { log.push(url); if (url.includes('fail')) return { status: 500 }; disk.set(dest, url.includes('manifest') ? JSON.stringify({ version: 1, pages: 3, widths: [1200, 2000], words: true, bytes: 9 }) : 100); return { status: 200 }; } };
let docsState = { docs: { d1: { id: 'd1', materialId: 'm1', kind: 'pdf', lastPage: 1, pages: [] } } };
const docsStore = { getState: () => ({ ...docsState, update: (id, patch) => { docsState.docs[id] = { ...docsState.docs[id], ...patch }; } }) };
let wifiOnly = false; const settingsStore = { getState: () => ({ derivedWifiOnly: wifiOnly }) };
const zustand = { create: () => (init) => { let state; const set = (fn) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) }; }; state = init(set, () => state); const hook = () => state; hook.getState = () => state; return hook; } };
const pages = load('src/features/viewer/derivedPages.ts', { react: { createContext: () => ({}) }, 'react-native': { Platform: { OS: 'ios' } }, 'expo-file-system/legacy': FS, './derivedPagesCore': core });
let urlCalls = []; let netType = 'WIFI';
const dl = load('src/features/library/derivedDownload.ts', { 'react-native': { Platform: { OS: 'ios' } }, 'expo-file-system/legacy': FS, zustand, '@/lib/api': { api: { materials: { derivedUrls: async (c, id, files) => { urlCalls.push(files.length); return { urls: files.map(f => ({ path: `derived/${id}/v1/${f}`, url: `https://x/${id}/${f}` })) }; } } } }, '@/store/docs': { useDocsStore: docsStore }, '@/store/settings': { useSettingsStore: settingsStore }, '@/features/viewer/derivedPagesCore': core, '@/features/viewer/derivedPages': pages, 'expo-network': { NetworkStateType: { CELLULAR: 'CELLULAR' }, getNetworkStateAsync: async () => ({ type: netType }) } });
(async () => {
  // a page image that is not on disk yet answers null; after download it answers the path (and is cached as present)
  const infoM1 = { version: 1, pages: 3, widths: [1200, 2000], words: true, dir: 'file:///docs/derived/m1/v1/' };
  assert.equal(await pages.pageImage(infoM1, 1, 'reading'), null);
  await dl.ensureDerived(null, docsState.docs.d1, { page: 1 });
  assert.equal(docsState.docs.d1.derived.pages, 3, 'manifest stored on the doc');
  const prog = dl.useDerivedProgress.getState().byMaterial.m1; assert.equal(prog.state, 'done'); assert.equal(prog.done, 9); assert.equal(prog.total, 9);
  assert.equal(urlCalls[0], 1, 'manifest requested alone'); assert.equal(urlCalls[1], 9, 'one URL batch for 9 files');
  // nearest-page-first order for page 1
  const downloaded = log.filter(u => !u.includes('manifest')).map(u => u.split('/').pop());
  eq(downloaded.slice(0, 3), ['p1-1200.jpg', 'p1-2000.jpg', 'p1-words.json']);
  assert.equal(await pages.pageImage(infoM1, 1, 'reading'), 'file:///docs/derived/m1/v1/p1-1200.jpg');
  assert.equal(pages.isPresentSync('file:///docs/derived/m1/v1/p2-2000.jpg'), true);
  eq(await pages.pageWords(infoM1, 0), null, 'a numeric placeholder body is not a word list'); // body "100" (fake) is not an array
  // resume: delete two files, run again → only the missing two are fetched
  disk.delete('file:///docs/derived/m1/v1/p0-1200.jpg'); disk.delete('file:///docs/derived/m1/v1/p2-words.json'); log.length = 0; urlCalls = [];
  // the present-cache must not lie about deleted files for this test: use a fresh module instance
  const pages2 = load('src/features/viewer/derivedPages.ts', { react: { createContext: () => ({}) }, 'react-native': { Platform: { OS: 'ios' } }, 'expo-file-system/legacy': FS, './derivedPagesCore': core });
  const dl2 = load('src/features/library/derivedDownload.ts', { 'react-native': { Platform: { OS: 'ios' } }, 'expo-file-system/legacy': FS, zustand, '@/lib/api': { api: { materials: { derivedUrls: async (c, id, files) => { urlCalls.push(files.length); return { urls: files.map(f => ({ path: `derived/${id}/v1/${f}`, url: `https://x/${id}/${f}` })) }; } } } }, '@/store/docs': { useDocsStore: docsStore }, '@/store/settings': { useSettingsStore: settingsStore }, '@/features/viewer/derivedPagesCore': core, '@/features/viewer/derivedPages': pages2, 'expo-network': { NetworkStateType: { CELLULAR: 'CELLULAR' }, getNetworkStateAsync: async () => ({ type: netType }) } });
  await dl2.ensureDerived(null, docsState.docs.d1);
  eq(urlCalls, [2]); eq(log.map(u => u.split('/').pop()).sort(), ['p0-1200.jpg', 'p2-words.json']);
  assert.equal(dl2.useDerivedProgress.getState().byMaterial.m1.state, 'done');
  // wifi-only on cellular: nothing downloaded, state deferred
  disk.delete('file:///docs/derived/m1/v1/p0-1200.jpg'); wifiOnly = true; netType = 'CELLULAR'; log.length = 0;
  const pages3 = load('src/features/viewer/derivedPages.ts', { react: { createContext: () => ({}) }, 'react-native': { Platform: { OS: 'ios' } }, 'expo-file-system/legacy': FS, './derivedPagesCore': core });
  const dl3 = load('src/features/library/derivedDownload.ts', { 'react-native': { Platform: { OS: 'ios' } }, 'expo-file-system/legacy': FS, zustand, '@/lib/api': { api: { materials: { derivedUrls: async (c, id, files) => ({ urls: files.map(f => ({ path: `derived/${id}/v1/${f}`, url: `https://x/${id}/${f}` })) }) } } }, '@/store/docs': { useDocsStore: docsStore }, '@/store/settings': { useSettingsStore: settingsStore }, '@/features/viewer/derivedPagesCore': core, '@/features/viewer/derivedPages': pages3, 'expo-network': { NetworkStateType: { CELLULAR: 'CELLULAR' }, getNetworkStateAsync: async () => ({ type: netType }) } });
  await dl3.ensureDerived(null, docsState.docs.d1);
  assert.equal(dl3.useDerivedProgress.getState().byMaterial.m1.state, 'deferred'); assert.equal(log.length, 0);
  // web: no-op
  const dlWeb = load('src/features/library/derivedDownload.ts', { 'react-native': { Platform: { OS: 'web' } }, 'expo-file-system/legacy': FS, zustand, '@/lib/api': { api: { materials: {} } }, '@/store/docs': { useDocsStore: docsStore }, '@/store/settings': { useSettingsStore: settingsStore }, '@/features/viewer/derivedPagesCore': core, '@/features/viewer/derivedPages': pages3 });
  await dlWeb.ensureDerived(null, docsState.docs.d1); assert.equal(dlWeb.infoFor(docsState.docs.d1), null);
  // a server set that does not exist yet: manifest URL missing → no derived record, no error state
  docsState.docs.d2 = { id: 'd2', materialId: 'm2', kind: 'pdf', lastPage: 0, pages: [] };
  const dl4 = load('src/features/library/derivedDownload.ts', { 'react-native': { Platform: { OS: 'ios' } }, 'expo-file-system/legacy': FS, zustand, '@/lib/api': { api: { materials: { derivedUrls: async () => ({ urls: [] }) } } }, '@/store/docs': { useDocsStore: docsStore }, '@/store/settings': { useSettingsStore: settingsStore }, '@/features/viewer/derivedPagesCore': core, '@/features/viewer/derivedPages': pages3 });
  await dl4.ensureDerived(null, docsState.docs.d2); assert.equal(docsState.docs.d2.derived, undefined); assert.equal(dl4.useDerivedProgress.getState().byMaterial.m2, undefined);
  // words.ts prefers the derived word file and still merges fragments; falls back to the native text layer otherwise
  let nativeCalls = 0;
  const words = load('src/features/viewer/words.ts', { '../../../modules/pdf-renderer': { PdfRenderer: { getWords: async () => { nativeCalls++; return [{ t: 'native', x: 0, y: 0, w: .1, h: .02 }]; } } }, './derivedPages': { forUri: (u) => u === 'file:///m1.pdf' ? infoM1 : null, pageWords: async (i, idx) => idx === 0 ? [{ t: 'signi', x: .1, y: .5, w: .05, h: .02 }, { t: 'ficant', x: .1502, y: .5, w: .06, h: .02 }] : null } });
  const w0 = await words.loadWords('file:///m1.pdf', 0); assert.equal(w0.length, 1); assert.equal(w0[0].t, 'significant'); assert.equal(nativeCalls, 0);
  const w1 = await words.loadWords('file:///m1.pdf', 1); assert.equal(w1[0].t, 'native'); assert.equal(nativeCalls, 1);
  const w2 = await words.loadWords('file:///other.pdf', 0); assert.equal(w2[0].t, 'native'); assert.equal(nativeCalls, 2);
  console.log('derived pages: ok');
})().catch((e) => { console.error(e); process.exit(1); });
