// node scripts/test-qa-fixes-1622.js — fixes from the 2026-11-20 hands-on QA (1.6.22). Pure functions + wiring contracts.
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
const any = new Proxy(function () {}, { get: (t, k) => (k === '__esModule' ? true : any), apply: () => any, construct: () => any });
const src = (f) => fs.readFileSync(f, 'utf8');
const ink = (() => { const e = {}; vm.runInNewContext(ts.transpileModule(src('src/features/viewer/InkCanvas.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, { exports: e, require: () => any, console, Math, Number, Array, Object, Map, Set, WeakMap, Date, JSON, Promise }); return e; })();
// web pointer → canvas units through the canvas' on-screen rectangle (zoom 50 %, 298 %)
assert.deepEqual([...ink.webCanvasPoint(810, 308, { left: 700, top: 200, width: 400, height: 520 }, 800, 1040)], [220, 216]);
assert.deepEqual([...ink.webCanvasPoint(700, 200, { left: 700, top: 200, width: 2384, height: 3099 }, 800, 1040)], [0, 0]);
const viewer = src('app/viewer/[docId].tsx'), canvas = src('src/features/viewer/InkCanvas.tsx'), lib = src('app/(tabs)/index.tsx'), admin = src('app/(tabs)/admin.tsx'), fn = src('supabase/functions/docs/index.ts');
assert(/const \[lx, ly\] = local\(x, y, ax, ay\); H\.current\.down\(lx, ly/.test(canvas) && /ref=\{canvasEl\}/.test(canvas), 'web strokes go through the on-screen rectangle');
// 펜 자동 복귀: shapes and finished text boxes, only when the setting is on
assert(!/&& false &&/.test(viewer), 'no disabled branch left');
assert(/const autoReturnAfter = \(tool: 'shape' \| 'text'\) => !!prefs\.penAutoReturn && cfg\.tool === tool/.test(viewer) && /onTextCommit=\{\(\) => \{ if \(autoReturnAfter\('text'\)\)/.test(viewer) && /onTextCommit\?\.\(\); \}\}/.test(canvas));
// page bar jumps; a new page is shown
assert(/<PageScrubber page=\{pageIndex\} count=\{doc\.pageCount\} onPage=\{goto\}/.test(viewer) && /jumpToNewPage\.current = doc\.pageCount; addBlankPages\(doc, 1\)/.test(viewer));
const scrub = new Function(ts.transpile(viewer.match(/function pageForScrub\([^)]*\) \{[^\n]*\}/)[0]) + '; return pageForScrub;')();
assert.equal(scrub(0, 1000, 110), 0); assert.equal(scrub(999, 1000, 110), 109); assert.equal(scrub(1200, 1000, 3), 2); assert.equal(scrub(-5, 1000, 3), 0); assert.equal(scrub(10, 0, 3), 0);
// library
assert(/'library-outline'/.test(lib) && !/books-outline/.test(lib), 'valid empty-state icon');
assert(/즐겨찾기한 교재가 없어요/.test(lib) && /이 폴더는 비어 있어요/.test(lib));
assert(/\[pending, folder, qn, sort\]\)/.test(lib), 'not-downloaded materials follow the chosen order');
assert(/onDownload=\{\(\) => \(select \? showToast\(/.test(lib), 'select mode never starts a download');
// admin
assert(/let coverFailed = false; if \(upload\.cover\) \{ try \{ await uploadCover/.test(admin), 'a failing cover does not fail (and repeat) the upload');
assert(/!loaded && materials\.length === 0 \? <ActivityIndicator/.test(admin) && /finally \{ setLoading\(false\); setLoaded\(true\); \}/.test(admin), 'loading state instead of "no materials"');
assert(/선명한 페이지 준비됨/.test(admin) && /api\.materials\.deriveNow\(c\)/.test(admin));
assert(/q && bySchool\.length === 0 \? <Empty icon="search" title="검색 결과 없음"/.test(admin));
// server: an upload starts the page-image generator
assert(/case "materials\.complete": \{[^\n]*\n\s*const derive = await dispatchDerive\(\);/.test(fn) && /case "materials\.deriveNow"/.test(fn));
assert(fn.indexOf('case "materials.deriveNow"') > fn.indexOf('return fail("관리자 전용 기능입니다", 403)'), 'admin only');
console.log('PASS: web stroke mapping, 펜 자동 복귀, page bar, library order/select/empty states, admin upload/loading/derive status/search, upload → generator');
