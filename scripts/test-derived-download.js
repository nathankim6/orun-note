// node scripts/test-derived-download.js — the live download queue for pre-rendered pages (docs/derived-pages.md):
// what a connection fetches next when the reader moves, signed-URL lifetime, per-file and whole-run retries, refusal by
// the server, and the page-side waiting rule. Pure JS: fake file system, fake clock / timers, gated transfers.
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
const eq = (a, b, msg = 'equal') => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
function load(file, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; vm.runInNewContext(source, { exports, require: n => { if (n in mocks) return mocks[n]; if (n.startsWith('@/')) throw new Error('unmocked ' + n); return require(n); }, console, Map, Set, Promise, Date, JSON, Math, Number, Array, Object, Error, String, RegExp, setTimeout, clearTimeout }); return exports;
}
const core = load('src/features/viewer/derivedPagesCore.ts');
const tick = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const zustand = { create: () => (init) => { let state; const set = (fn) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) }; }; state = init(set, () => state); const hook = () => state; hook.getState = () => state; return hook; } };
const pageOf = (n) => core.pageOfName(n);
/** One app instance: fresh modules, a disk, a server, a clock, timers and a transfer gate. */
function world({ pages = 30, gate = false, lastPage = 0, known = true } = {}) {
  const w = { disk: new Map(), started: [], gates: [], signCalls: [], timers: [], cancelled: [], reports: [], clock: 1_000_000, signSeq: 0, serverHas: () => true, transferFails: () => false, signError: null, netType: 'WIFI', wifiOnly: false, deleted: [] };
  const FS = { documentDirectory: 'file:///docs/', getInfoAsync: async p => w.disk.has(p) ? { exists: true, size: w.disk.get(p) } : { exists: false }, makeDirectoryAsync: async () => {}, deleteAsync: async p => { w.deleted.push(p); for (const k of [...w.disk.keys()]) if (k === p || k.startsWith(p)) w.disk.delete(k); }, moveAsync: async ({ from, to }) => { w.disk.set(to, w.disk.get(from)); w.disk.delete(from); }, readAsStringAsync: async p => w.disk.get(p), readDirectoryAsync: async () => [],
    downloadAsync: (url, dest) => new Promise(resolve => { const name = url.split('/').pop().split('?')[0], sign = Number((/[?&]s=(\d+)/.exec(url) || [])[1] || 0); const entry = { name, sign, at: w.clock }; w.started.push(entry);
      const finish = () => { if (w.transferFails(name, entry)) resolve({ status: 500 }); else { w.disk.set(dest, 100); resolve({ status: 200 }); } }; if (gate) w.gates.push(finish); else finish(); }) };
  const manifest = { version: 1, pages, widths: [1200, 2000], words: true };
  w.docs = { d1: { id: 'd1', materialId: 'm1', kind: 'pdf', lastPage, pages: [], ...(known ? { derived: manifest } : {}) } };
  const docsStore = { getState: () => ({ docs: w.docs, update: (id, patch) => { w.docs[id] = { ...w.docs[id], ...patch }; } }) };
  w.pages = load('src/features/viewer/derivedPages.ts', { react: { createContext: () => ({}), useEffect: () => {}, useRef: (v) => ({ current: v }), useState: (v) => [v, () => {}] }, 'react-native': { Platform: { OS: 'ios' } }, 'expo-file-system/legacy': FS, './derivedPagesCore': core });
  w.dl = load('src/features/library/derivedDownload.ts', { 'react-native': { Platform: { OS: 'ios' } }, 'expo-file-system/legacy': FS, zustand, '@/lib/api': { api: { materials: {} } }, '@/store/docs': { useDocsStore: docsStore }, '@/store/settings': { useSettingsStore: { getState: () => ({ derivedWifiOnly: w.wifiOnly }) } },
    '@/features/viewer/derivedPagesCore': core, '@/features/viewer/derivedPages': w.pages, 'expo-network': { NetworkStateType: { CELLULAR: 'CELLULAR' }, getNetworkStateAsync: async () => ({ type: w.netType }) } });
  w.dl._internals.setFetcher(async (code, id, files) => { w.signCalls.push([...files]); if (w.signError) throw w.signError; const s = ++w.signSeq; return { urls: files.filter(f => w.serverHas(f)).map(f => ({ path: `derived/${id}/v1/${f}`, url: `https://x/${id}/${f}?s=${s}` })) }; });
  w.dl._internals.setNow(() => w.clock); w.dl._internals.setTimers((fn, ms) => { const t = { fn, ms, id: w.timers.length + 1 }; w.timers.push(t); return t; }, (t) => { w.cancelled.push(t); }); w.dl._internals.setReporter((line) => w.reports.push(line));
  w.dir = 'file:///docs/derived/m1/v1/'; w.state = () => w.dl.useDerivedProgress.getState().byMaterial.m1;
  w.release = async (n = 1) => { for (let i = 0; i < n && w.gates.length; i++) w.gates.shift()(); await tick(); };
  w.releaseAll = async () => { for (let guard = 0; guard < 5000 && (w.gates.length || guard < 3); guard++) { while (w.gates.length) w.gates.shift()(); await tick(8); } };
  w.names = () => w.started.map(s => s.name);
  return w;
}
(async () => {
  // ---- 1. order of a whole book: every page can open (reading image + words) before the far detail images ----
  let w = world({ pages: 30, lastPage: 10 }); await w.dl.ensureDerived(null, w.docs.d1, { page: 10 });
  assert.equal(w.state().state, 'done'); assert.equal(w.started.length, 90); assert.equal(new Set(w.names()).size, 90, 'each file once');
  eq(w.names().slice(0, 3), ['p10-1200.jpg', 'p10-2000.jpg', 'p10-words.json'], 'the page being read first, completely');
  const firstFarDetail = w.names().findIndex(n => n.endsWith('-2000.jpg') && Math.abs(pageOf(n) - 10) > 2), lastBasic = w.names().map(n => !n.endsWith('-2000.jpg')).lastIndexOf(true);
  assert(lastBasic < firstFarDetail, 'reading images + words of all 30 pages before the first far detail image');
  assert(w.signCalls.every(c => c.length <= w.dl.SIGN_BATCH) && w.signCalls.length === 1, 'one signed-URL request covers the 90 files');
  assert.equal(w.pages.isPresentSync(w.dir + 'p29-2000.jpg'), true);

  // ---- 2. the reader jumps while all connections are busy: that page's image starts at once, then its surroundings ----
  w = world({ pages: 60, gate: true }); let run = w.dl.ensureDerived(null, w.docs.d1, { page: 0 });
  assert.equal(w.pages.isDownloadActive(w.dir), true, 'a known set counts as "being filled" before the first await (no device render in the gap)');
  await tick();
  eq(w.names().slice().sort(), ['p0-1200.jpg', 'p0-2000.jpg', 'p0-words.json', 'p1-1200.jpg', 'p1-2000.jpg', 'p1-words.json'].sort(), 'six connections on the page being read and the next one');
  w.dl.prioritise('m1', 40); await tick();
  assert.equal(w.started.length, 7); assert.equal(w.started[6].name, 'p40-1200.jpg', 'the page just turned to is fetched outside the busy pool');
  await w.release(1); assert.equal(w.started[7].name, 'p40-2000.jpg', 'the next free connection continues with that page');
  await w.release(6); const after = w.names().slice(8); assert(after.length >= 5 && after.every(n => Math.abs(pageOf(n) - 40) <= 2), 'then its neighbours: ' + after.join(','));
  w.dl.prioritise('m1', 40); await tick(); assert.equal(w.names().filter(n => n === 'p40-1200.jpg').length, 1, 'no second transfer for a file in flight or done');
  w.dl.prioritise('m1', 12); await tick(); assert.equal(w.started[w.started.length - 1].name, 'p12-1200.jpg', 'and again for the next jump');
  await w.releaseAll(); await run; assert.equal(w.state().state, 'done'); assert.equal(new Set(w.names()).size, 180); assert.equal(w.started.length, 180);
  assert.equal(w.pages.isDownloadActive(w.dir), false, 'activity flag cleared when the run ends');

  // ---- 3. signed URLs are never used near their expiry ----
  w = world({ pages: 20, gate: true }); run = w.dl.ensureDerived(null, w.docs.d1, { page: 0 }); await tick(); await w.release(3);
  const before = w.started.length; w.clock += w.dl.URL_TTL_MS + 1; await w.releaseAll(); await run;
  assert.equal(w.state().state, 'done'); assert(w.signCalls.length >= 2, 'asked again after the lifetime');
  const late = w.started.filter(s => s.at > 1_000_000); assert(late.length > 40 && late.every(s => s.sign >= 2), 'no transfer started after the lifetime uses an old URL'); assert(before >= 6);

  // ---- 4. a transfer that fails: the file is tried again (fresh URL), three times at most; then the run fails and retries itself ----
  w = world({ pages: 6 }); const fails = new Map([['p3-1200.jpg', 2]]); w.transferFails = (n) => { const left = fails.get(n) ?? 0; if (left > 0) { fails.set(n, left - 1); return true; } return false; };
  await w.dl.ensureDerived(null, w.docs.d1); assert.equal(w.state().state, 'done'); assert.equal(w.names().filter(n => n === 'p3-1200.jpg').length, 3);
  assert(new Set(w.started.filter(s => s.name === 'p3-1200.jpg').map(s => s.sign)).size === 3, 'each attempt with a newly signed URL'); eq(w.timers, []); eq(w.reports, []);
  w = world({ pages: 6 }); let broken = true; w.transferFails = (n) => broken && n === 'p4-2000.jpg';
  await w.dl.ensureDerived(null, w.docs.d1); assert.equal(w.state().state, 'error'); assert.equal(w.names().filter(n => n === 'p4-2000.jpg').length, w.dl.FILE_ATTEMPTS);
  assert.equal(w.state().done, 17); assert.equal(w.timers.length, 1); assert.equal(w.timers[0].ms, w.dl.RETRY_DELAYS_MS[0]); assert.match(w.reports[0], /^derived pages download failed status=none files=17\/18 attempt=1$/);
  assert.equal(w.pages.isDownloadActive(w.dir), false, 'between attempts nothing claims to be downloading (pages fall back at once)');
  broken = false; w.timers[0].fn(); await tick(60); assert.equal(w.state().state, 'done'); assert.equal(w.started.filter(s => s.name !== 'p4-2000.jpg').length, 17, 'the retry fetches only what is missing');

  // ---- 5. the server refuses or is unreachable ----
  w = world({ pages: 6 }); w.signError = Object.assign(new Error('이 교재에 대한 권한이 없습니다'), { status: 403 });
  await w.dl.ensureDerived(null, w.docs.d1); assert.equal(w.state().state, 'error'); eq(w.timers, [], '403: not assigned, no retry'); assert.match(w.reports[0], /status=403 files=0\/18/); assert.equal(w.started.length, 0);
  w = world({ pages: 6 }); w.signError = Object.assign(new Error('네트워크 연결을 확인해 주세요.'), { status: 0 });
  await w.dl.ensureDerived(null, w.docs.d1); assert.equal(w.timers.length, 1); assert.equal(w.timers[0].ms, 5000);
  w.timers[0].fn(); await tick(60); assert.equal(w.timers.length, 2); assert.equal(w.timers[1].ms, 15000, 'growing pauses');
  w.timers[1].fn(); await tick(60); assert.equal(w.timers[2].ms, 45000);
  await w.dl.ensureDerived(null, w.docs.d1); eq(w.cancelled.map(t => t.id), [3], 'a fresh request cancels the pending retry'); assert.equal(w.timers[3].ms, 5000, 'and restarts the schedule');
  w.signError = null; w.timers[3].fn(); await tick(80); assert.equal(w.state().state, 'done'); assert.equal(w.started.length, 18);
  w = world({ pages: 3 }); w.signError = Object.assign(new Error('x'), { status: 500 }); await w.dl.ensureDerived(null, w.docs.d1);
  for (let i = 0; i < 12 && w.timers[i]; i++) { w.timers[i].fn(); await tick(40); }
  eq(w.timers.map(t => t.ms), w.dl.RETRY_DELAYS_MS, 'the schedule ends: no endless hammering of a failing server');

  // ---- 6. files the server does not have are skipped, not waited for ----
  w = world({ pages: 5 }); w.serverHas = (f) => !f.endsWith('-words.json'); await w.dl.ensureDerived(null, w.docs.d1);
  assert.equal(w.state().state, 'done'); assert.equal(w.started.length, 10); assert.equal(w.state().done, 10); eq(w.timers, []);

  // ---- 7. wifi-only: stops when the device moves to cellular mid-run ----
  w = world({ pages: 40, gate: true }); w.wifiOnly = true; run = w.dl.ensureDerived(null, w.docs.d1); await tick(); await w.release(20); w.netType = 'CELLULAR'; await w.releaseAll(); await run;
  assert.equal(w.state().state, 'deferred'); assert(w.started.length < 120 && w.started.length >= 24, 'stopped part-way: ' + w.started.length); eq(w.timers, []);

  // ---- 8. removing the book stops its download before the files are deleted ----
  w = world({ pages: 40, gate: true }); run = w.dl.ensureDerived(null, w.docs.d1); await tick(); const rm = w.dl.removeDerived('m1'); await tick(); const inFlight = w.started.length;
  await w.releaseAll(); await rm; await run; assert.equal(w.started.length, inFlight, 'nothing new starts after removal'); assert([...w.disk.keys()].every(k => !k.startsWith('file:///docs/derived/m1/')), 'no file written back after the delete'); assert(w.deleted.includes('file:///docs/derived/m1/'));

  // ---- 9. a set whose manifest is not known yet: fetched first, then the same queue ----
  // (the manifest travels through downloadAsync as well: the fake disk gives that file a JSON body)
  const manifestBody = JSON.stringify({ version: 1, pages: 4, widths: [1200, 2000], words: true });
  const w9 = world({ pages: 4, known: false }); const put = w9.disk.set.bind(w9.disk); w9.disk.set = (k, v) => put(k, /manifest-\d+\.json$/.test(k) ? manifestBody : v);
  assert.equal(w9.pages.isDownloadActive(w9.dir), false); await w9.dl.ensureDerived(null, w9.docs.d1); assert.equal(w9.docs.d1.derived.pages, 4); assert.equal(w9.state().state, 'done'); eq(w9.signCalls[0], ['manifest.json']);

  // ---- 10. page side: waiting rule and the device-engine fallback report ----
  const S = world().pages.derivedFileState, p = 'file:///docs/derived/m1/v1/p3-1200.jpg';
  assert.equal(S({ path: null, present: false, checked: true, downloading: true, timedOut: false }), 'absent');
  assert.equal(S({ path: p, present: false, checked: false, downloading: false, timedOut: false }), 'pending', 'the disk has not answered');
  assert.equal(S({ path: p, present: false, checked: true, downloading: true, timedOut: false }), 'pending', 'the download is about to deliver it');
  assert.equal(S({ path: p, present: false, checked: true, downloading: false, timedOut: false }), 'absent', 'nothing will deliver it: device engine at once');
  assert.equal(S({ path: p, present: false, checked: true, downloading: true, timedOut: true }), 'absent');
  assert.equal(S({ path: p, present: false, checked: true, downloading: true, timedOut: false, fellBack: true }), 'absent', 'a page already drawn by the device is not swapped for a spinner when a (re)try starts');
  assert.equal(S({ path: p, present: true, checked: true, downloading: true, timedOut: true, fellBack: true }), 'present', 'the file itself always wins');
  const P = world().pages; P.setDownloadNote('file:///docs/derived/m1/v1/', 'error status=403 0/396');
  assert.equal(P.noteEngineFallback(p), 'derived page drawn by device engine count=1 reason=no-download-running download=error status=403 0/396');
  for (let i = 2; i < 25; i++) assert.equal(P.noteEngineFallback(p), null); P.setDownloadActive('file:///docs/derived/m1/v1/', true); P.setDownloadNote('file:///docs/derived/m1/v1/', 'downloading 40/396');
  assert.equal(P.noteEngineFallback(p), 'derived page drawn by device engine count=25 reason=wait-timeout download=downloading 40/396'); assert.equal(P.noteEngineFallback(p), null);
  assert.equal(world().pages.noteEngineFallback('file:///docs/derived/zz/v1/p0-1200.jpg'), 'derived page drawn by device engine count=1 reason=no-download-running download=never-started');
  const hookSrc = fs.readFileSync('src/features/viewer/derivedPages.ts', 'utf8'); assert(/if \(state === 'absent' && path && st\.current\.checked\) st\.current\.fellBack = true;/.test(hookSrc), 'useDerivedFile remembers the fallback per mount');
  const pageSrc = fs.readFileSync('src/features/viewer/PdfPage.tsx', 'utf8'); assert(pageSrc.indexOf("const line = noteEngineFallback(readPath)") < pageSrc.indexOf("if (readPath && derivedFile === 'present')"), 'the report hook runs before any early return');
  console.log('PASS: live download order (current page, every page openable, far detail last), urgent fetch on a jump, signed-URL lifetime, per-file and whole-run retries with a bounded schedule, 403 not retried, missing server files skipped, wifi-only stop, removal, manifest bootstrap, sticky page fallback and its report');
})().catch((e) => { console.error(e); process.exit(1); });
