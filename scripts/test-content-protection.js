const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { exports, require: name => { if (name in mocks) return mocks[name]; throw Error('Unexpected module ' + name); }, console });
  return exports;
}
const policy = load('src/lib/capturePolicy.ts');
for (const role of [null, undefined, 'student', 'ADMIN', 'teacher', {}, '']) for (const hydrated of [true, false, undefined]) assert.equal(policy.captureProtectionRequired(role, hydrated), true);
assert.equal(policy.captureProtectionRequired('admin', true), false);
for (const hydrated of [false, undefined, 1, 'true']) assert.equal(policy.captureProtectionRequired('admin', hydrated), true);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness(os) {
  const cells = [], stateListeners = new Set(), screenshots = new Set(), calls = [];
  const native = { blocked: false, prevent: async () => {}, allow: async () => {} };
  let index = 0, scheduled = [], dirty = false, value, required, unmounted = false;
  const react = {
    useState(initial) { const i = index++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], next => { const n = typeof next === 'function' ? next(cells[i]) : next; if (!Object.is(n, cells[i])) { cells[i] = n; dirty = true; } }]; },
    useRef(initial) { const i = index++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useEffect(fn, deps) { const i = index++, old = cells[i]; if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) scheduled.push({ i, fn, deps, old }); },
  };
  const capture = {
    preventScreenCaptureAsync: async key => { assert.equal(key, 'paperly'); calls.push('prevent'); await native.prevent(); native.blocked = true; },
    allowScreenCaptureAsync: async key => { assert.equal(key, 'paperly'); calls.push('allow'); await native.allow(); native.blocked = false; },
    enableAppSwitcherProtectionAsync: async intensity => { assert.equal(intensity, 0.6); calls.push('switcher-on'); },
    disableAppSwitcherProtectionAsync: async () => { calls.push('switcher-off'); },
    addScreenshotListener: fn => { screenshots.add(fn); return { remove: () => screenshots.delete(fn) }; },
  };
  const rn = { Platform: { OS: os }, AppState: { currentState: 'active', addEventListener: (_name, fn) => { stateListeners.add(fn); return { remove: () => stateListeners.delete(fn) }; } } };
  const hook = load('src/lib/security.ts', { react, 'react-native': rn, 'expo-screen-capture': capture, './capturePolicy': policy }).useContentProtection;
  function render(next = required) { assert(!unmounted); required = next; index = 0; scheduled = []; dirty = false; value = hook(next); const run = scheduled; scheduled = []; for (const e of run) { e.old?.cleanup?.(); cells[e.i] = { deps: e.deps, cleanup: e.fn() }; } return value; }
  async function flush() { for (let i = 0; i < 40; i++) { await Promise.resolve(); if (dirty && !unmounted) render(); } return value; }
  return { render, flush, calls, native, screenshots, get value() { return value; }, state(s) { for (const f of stateListeners) f(s); }, unmount() { for (const c of cells) c?.cleanup?.(); unmounted = true; }, listenerCount: () => stateListeners.size };
}
(async () => {
  const waiting = deferred(), order = [];
  const queue = policy.createProtectionQueue({ prevent: async () => { order.push('prevent'); if (order.length === 1) await waiting.promise; }, allow: async () => { order.push('allow'); }, enableSwitcher: async () => {}, disableSwitcher: async () => {} });
  const a = queue.capture(true), b = queue.capture(false), c = queue.capture(true); await Promise.resolve(); assert.deepEqual(order, ['prevent']); waiting.resolve(); await Promise.all([a, b, c]); assert.deepEqual(order, ['prevent', 'allow', 'prevent']);
  for (const os of ['android', 'ios']) {
    const h = harness(os);
    assert.equal(h.render(true).protectionPending, true); await h.flush(); assert.equal(h.native.blocked, true); assert.equal(h.value.protectionPending, false); assert.equal(h.screenshots.size, 1);
    const oldScreenshot = [...h.screenshots][0]; oldScreenshot(); await h.flush(); assert.equal(h.value.attempts, 1);
    h.render(false); await h.flush(); assert.equal(h.native.blocked, false); assert.equal(h.screenshots.size, 0); assert.equal(h.value.attempts, 0); oldScreenshot(); await h.flush(); assert.equal(h.value.attempts, 0);
    h.state('inactive'); await h.flush(); assert.equal(h.value.hidden, true); h.state('active'); await h.flush(); assert.equal(h.value.hidden, false);
    const delayedAllow = deferred(); h.native.allow = () => delayedAllow.promise;
    assert.equal(h.render(true).protectionPending, true); await h.flush(); assert.equal(h.native.blocked, true);
    h.render(false); await h.flush(); assert.equal(h.native.blocked, true); // allow still in flight
    assert.equal(h.render(true).protectionPending, true); await h.flush(); assert.equal(h.value.protectionPending, true); delayedAllow.resolve(); await h.flush(); assert.equal(h.native.blocked, true); assert.equal(h.value.protectionPending, false);
    h.unmount(); await h.flush(); assert.equal(h.native.blocked, false); assert.equal(h.screenshots.size, 0); assert.equal(h.listenerCount(), 0);
    const fail = harness(os); fail.native.prevent = async () => { throw Error('synthetic failure'); }; fail.render(true); await fail.flush(); assert.equal(fail.value.protectionPending, true); assert.equal(fail.native.blocked, false); fail.render(false); await fail.flush(); assert.equal(fail.value.protectionPending, false); fail.unmount(); await fail.flush();
    const late = harness(os), d = deferred(); late.native.prevent = () => d.promise; late.render(true); await late.flush(); late.unmount(); d.resolve(); await late.flush(); assert.equal(late.native.blocked, false); assert.equal(late.screenshots.size, 0);
  }
  const web = harness('web'); web.render(true); await web.flush(); assert.equal(web.value.protectionPending, false); assert.deepEqual(web.calls, []); web.unmount();
  const root = fs.readFileSync('app/_layout.tsx', 'utf8'); assert(root.includes('captureProtectionRequired(role, hydrated)')); assert(root.includes('useContentProtection(captureProtected)')); assert(root.includes('(hidden || protectionPending)')); assert(root.includes('captureProtected && attempts > 0'));
  console.log('PASS: Android/iOS admin capture allowed, student/unknown protected, hydration/logout policy, serialized native role races, fail-closed overlay, listener/unmount cleanup, inactive privacy and web no-op. JS mocks only; device recording unverified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
