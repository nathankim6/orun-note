// Deterministic JS-only queue/cache tests. No native timings or device rendering claims.
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/features/viewer/renderScheduler.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exports_, Map, Promise, Error });
const { createRenderScheduler, RenderPriority: P, RenderCancelled } = exports_;
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
(async () => {
  const unhandled = []; process.on('unhandledRejection', e => unhandled.push(e));
  // A running native render is unavoidable; newest visible previews outrank all queued zoom work.
  let q = createRenderScheduler(), g = gate(), order = [];
  const run = name => async () => { order.push(name); return name; };
  q.acquire('busy', P.prefetch, () => { order.push('busy'); return g.promise; });
  const stale = q.acquire('stale-tile', P.tile, run('stale'));
  q.acquire('tile', P.tile, run('tile'));
  q.acquire('full', P.visible, run('full'));
  q.acquire('preview-old', P.preview, run('preview-old'));
  q.acquire('preview-new', P.preview, run('preview-new'));
  stale.release(); stale.release();
  await assert.rejects(stale.promise, RenderCancelled);
  g.resolve('busy'); await flush();
  assert.deepEqual(order, ['busy', 'preview-new', 'preview-old', 'tile', 'full']);
  assert.equal(q.state('stale-tile'), undefined);

  // Shared ownership: promote prefetch, keep it for the remaining subscriber, downgrade when visible leaves.
  q = createRenderScheduler(); g = gate(); order = [];
  q.acquire('busy', 2, () => g.promise);
  let calls = 0;
  const pref = q.acquire('shared', P.prefetch, async () => { calls++; order.push('shared'); return 'shared'; });
  const visible = q.acquire('shared', P.preview, run('DUPLICATE'));
  assert.equal(pref.promise, visible.promise);
  pref.release(); q.acquire('tile', P.tile, run('tile'));
  g.resolve('busy'); await flush(); assert.deepEqual(order, ['shared', 'tile']); assert.equal(calls, 1);
  assert.equal(await visible.promise, 'shared'); visible.release();
  q = createRenderScheduler(); g = gate(); order = [];
  q.acquire('busy', 2, () => g.promise);
  const low = q.acquire('shared', P.prefetch, run('shared'));
  const high = q.acquire('shared', P.preview, run('DUPLICATE')); high.release();
  q.acquire('full', P.visible, run('full')); g.resolve('busy'); await flush();
  assert.deepEqual(order, ['full', 'shared']); low.release();

  // Running requests survive release and can be re-acquired without a duplicate native call.
  q = createRenderScheduler(); g = gate(); calls = 0;
  const running = q.acquire('running', 1, () => { calls++; return g.promise; }); running.release();
  const reused = q.acquire('running', 1, run('DUPLICATE'));
  assert.equal(running.promise, reused.promise); g.resolve('ok'); await flush(); assert.equal(calls, 1);
  assert.equal(q.value('running'), 'ok'); reused.release();

  // Explicit settled status, best lower-res reuse during a full render, disk insert bypasses busy worker, bounded LRU.
  q = createRenderScheduler(2); g = gate();
  q.acquire('full', 1, () => g.promise, { page: 'p', width: 1800 });
  assert.equal(q.value('full'), undefined); assert.equal(q.state('full'), 'running');
  q.remember('low', 'low-file', { page: 'p', width: 600 });
  q.remember('medium', 'medium-file', { page: 'p', width: 900 });
  assert.equal(q.available('p', 1800), 'medium-file');
  assert.equal(q.available('p', 700), 'low-file'); assert.equal(q.available('other', 1800), undefined);
  q.remember('full', 'WRONG', { page: 'p', width: 1800 }); assert.equal(q.state('full'), 'running');
  g.resolve('full-file'); await flush(); assert.equal(q.value('full'), 'full-file');
  assert.equal(q.state('medium'), undefined); // low was touched most recently.
  q.remember('next', 'next'); assert.equal(q.state('low'), undefined);
  q.clear(); assert.equal(q.value('next'), undefined);

  // Every window cleanup removes obsolete queued speculation; at most two speculative leases survive.
  q = createRenderScheduler(64, 2); g = gate(); order = [];
  q.acquire('busy', 1, () => g.promise);
  let close;
  for (let i = 0; i < 100; i++) {
    close?.(); close = q.prefetchWindow(() => {
      q.prefetch('a' + i, 2.01, run('a' + i)); q.prefetch('b' + i, 2.02, run('b' + i));
    });
    if (i) assert.equal(q.state('a' + (i - 1)), undefined);
  }
  q.prefetch('overflow', 2.03, run('overflow'));
  assert.equal(q.state('a99'), undefined);
  close(); assert.equal(q.state('b99'), undefined);
  g.resolve('busy'); await flush(); assert.deepEqual(order, ['overflow']);

  // A speculative window closing cannot cancel a visible subscriber of the same queued page.
  q = createRenderScheduler(); g = gate(); order = [];
  q.acquire('busy', 1, () => g.promise);
  const closeShared = q.prefetchWindow(() => q.prefetch('shared-page', 2, run('shared-page')));
  const sharedVisible = q.acquire('shared-page', 1, run('DUPLICATE'));
  closeShared(); assert.equal(q.state('shared-page'), 'queued');
  assert.throws(() => q.prefetchWindow(() => {
    q.prefetch('failed-window', 2, run('failed-window')); throw new Error('window');
  }), /window/);
  assert.equal(q.state('failed-window'), undefined);
  g.resolve('busy'); await flush(); assert.equal(await sharedVisible.promise, 'shared-page');
  assert.deepEqual(order, ['shared-page']);

  // Cancel/retry same key cannot have an old rejection erase its replacement; sync throws free the worker.
  q = createRenderScheduler(); g = gate(); q.acquire('busy', 1, () => g.promise);
  const old = q.acquire('retry', 1, run('old')); old.release();
  const replacement = q.acquire('retry', 1, async () => 'new');
  g.resolve('busy'); await flush(); assert.equal(await replacement.promise, 'new'); assert.equal(q.value('retry'), 'new');
  const failure = q.acquire('throw', 1, () => { throw new Error('bridge'); });
  const after = q.acquire('after', 1, async () => 'after');
  await assert.rejects(failure.promise, /bridge/); await flush(); assert.equal(await after.promise, 'after');
  assert.equal(q.state('throw'), undefined);
  // Injected monotonic clock separates queue wait from preparation; cache hits/cancellation/failures are silent.
  let clock = 10; const timings = []; q = createRenderScheduler(64, 2, {
    now: () => clock, onComplete: sample => { timings.push(sample); },
  });
  g = gate(); const prepared = gate();
  q.acquire('private-uri|busy', 1, () => g.promise); await flush();
  clock = 20;
  const timed = q.acquire('private-uri|page', 1, () => prepared.promise, { page: 'private-uri', index: 7, width: 1800 });
  const duplicateTimed = q.acquire('private-uri|page', 1, run('DUPLICATE'));
  const cancelledTimed = q.acquire('cancelled', 1, run('cancelled')); cancelledTimed.release();
  q.remember('disk', 'private-file', { page: 'private-uri', index: 8, width: 600 });
  q.acquire('disk', 1, run('DUPLICATE'));
  clock = 1020; g.resolve('busy'); await flush();
  clock = 1820; prepared.resolve('ready'); await flush();
  assert.equal(await timed.promise, 'ready'); assert.equal(await duplicateTimed.promise, 'ready');
  assert.equal(timings.length, 2);
  assert.equal(timings[0].waitMs, 0); assert.equal(timings[0].preparationMs, 1010);
  assert.equal(timings[1].index, 7); assert.equal(timings[1].width, 1800);
  assert.equal(timings[1].waitMs, 1000); assert.equal(timings[1].preparationMs, 800);
  assert.deepEqual(Object.keys(timings[1]).sort(), ['index', 'preparationMs', 'waitMs', 'width']);
  assert(!JSON.stringify(timings).includes('private'));
  const failedTimed = q.acquire('failure', 1, () => Promise.reject(new Error('expected')));
  await assert.rejects(failedTimed.promise, /expected/); await flush(); assert.equal(timings.length, 2);

  // Synchronous throws and rejected async observers cannot stall later jobs or leak rejections.
  let observerCalls = 0; q = createRenderScheduler(64, 2, { now: () => clock, onComplete: () => {
    observerCalls++; if (observerCalls === 1) throw new Error('observer');
    if (observerCalls === 2) return Promise.reject(new Error('async observer'));
  } });
  const observedJobs = [1, 2, 3].map(i => q.acquire('observed' + i, 1, async () => String(i)).promise);
  await flush(); assert.deepEqual(await Promise.all(observedJobs), ['1', '2', '3']); assert.equal(observerCalls, 3);

  // Load the actual PdfPage module wiring with inert UI/native mocks to test per-process diagnostics policy.
  const pageJs = ts.transpileModule(fs.readFileSync('src/features/viewer/PdfPage.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  function diagnostics(OS) {
    let complete; const reports = [];
    const mocks = {
      react: {}, 'react-native': { Platform: { OS } }, '../../../modules/pdf-renderer': { PdfRenderer: {} },
      '@/theme': {}, '@/lib/diag': { reportError: (kind, message) => reports.push({ kind, message }) },
      './renderScheduler': { ...exports_, createRenderScheduler: (_max, _prefetch, options) => {
        complete = options.onComplete; return {};
      } },
    };
    vm.runInNewContext(pageJs, { exports: {}, require: name => {
      if (!(name in mocks)) throw new Error('Unexpected import ' + name); return mocks[name];
    } });
    return { complete, reports };
  }
  const native = diagnostics('android');
  const normal = { index: 0, width: 2400, waitMs: 999, preparationMs: 799 };
  native.complete(normal); native.complete({ waitMs: 9999, preparationMs: 9999 });
  assert.equal(native.reports.length, 0);
  native.complete({ ...normal, waitMs: 1000, uri: 'secret', title: 'secret', student: 'secret' });
  native.complete({ ...normal, index: 1, preparationMs: 800 });
  for (let i = 0; i < 10; i++) native.complete({ ...normal, waitMs: 9999 });
  assert.equal(native.reports.length, 2);
  assert.deepEqual(native.reports, [
    { kind: 'render', message: 'PDF preparation page=0 width=2400 waitMs=1000 preparationMs=799' },
    { kind: 'render', message: 'PDF preparation page=1 width=2400 waitMs=999 preparationMs=800' },
  ]);
  const web = diagnostics('web');
  for (let i = 0; i < 5; i++) web.complete({ ...normal, preparationMs: 9999 });
  assert.equal(web.reports.length, 0);

  await new Promise(resolve => setImmediate(resolve)); assert.equal(unhandled.length, 0);
  console.log('PASS: preview priority, recency, shared dedup/refcounts, cancellation/demotion, running reuse, settled preview cache, bounded LRU/prefetch windows, retry, sync failures, observer timing/safety, native-only private capped diagnostics, no unhandled rejections');
})().catch(e => { console.error(e); process.exitCode = 1; });
