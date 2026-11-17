const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');

// Loads a TS module with the native/JSX deps mocked, the same way scripts/test-app-updates.js does.
function load(file, mocks = {}, extra = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText,
    { exports, require: (n) => (n in mocks ? mocks[n] : require(n)), console, Date, Promise, setTimeout, clearTimeout, ...extra },
  );
  return exports;
}

/* ---------- app.config.js: OTA switches on only with a linked Expo project ---------- */
const configPath = require.resolve('../app.config.js');
function appConfig(env = {}, base = {}) {
  const saved = { EXPO_PROJECT_ID: process.env.EXPO_PROJECT_ID, EXPO_UPDATES_CHANNEL: process.env.EXPO_UPDATES_CHANNEL, EXPO_UPDATES_URL: process.env.EXPO_UPDATES_URL };
  for (const k of Object.keys(saved)) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[configPath];
  const warn = console.warn; console.warn = () => {};
  try {
    const fn = require('../app.config.js');
    return fn({ config: { version: '1.6.19', android: { package: 'com.paperly.study' }, extra: {}, ...base } });
  } finally {
    console.warn = warn;
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    delete require.cache[configPath];
  }
}
const PROJECT_ID = '5f0e7c1a-9b2d-4c33-8a1e-2d4f6b7c8d90';

let c = appConfig();
assert.equal(c.updates.enabled, false, 'no Expo project: OTA must stay off');
assert.equal(c.updates.url, undefined, 'no Expo project: no update URL must be written');
assert.equal(c.runtimeVersion.policy, 'appVersion');
assert.equal(c.android.versionCode, 10619, 'versionCode derivation must not regress');
assert.equal(c.extra.eas, undefined);

c = appConfig({ EXPO_PROJECT_ID: PROJECT_ID });
assert.equal(c.updates.enabled, true);
assert.equal(c.updates.url, `https://u.expo.dev/${PROJECT_ID}`);
assert.equal(c.updates.checkAutomatically, 'ON_LOAD');
assert.equal(c.updates.fallbackToCacheTimeout, 0, 'launch must never wait for an update');
assert.deepEqual(c.updates.requestHeaders, { 'expo-channel-name': 'production' });
assert.equal(c.extra.eas.projectId, PROJECT_ID);
assert.equal(c.runtimeVersion.policy, 'appVersion');

c = appConfig({ EXPO_PROJECT_ID: PROJECT_ID, EXPO_UPDATES_CHANNEL: 'preview' });
assert.deepEqual(c.updates.requestHeaders, { 'expo-channel-name': 'preview' });

// `eas update:configure` writes extra.eas.projectId into app.json; that alone must be enough.
c = appConfig({}, { extra: { eas: { projectId: PROJECT_ID } }, android: { versionCode: 1 } });
assert.equal(c.updates.url, `https://u.expo.dev/${PROJECT_ID}`);
assert.equal(c.extra.eas.projectId, PROJECT_ID);

// A self-hosted implementation of the same protocol can be pointed at directly.
c = appConfig({ EXPO_UPDATES_URL: 'https://updates.example.test/manifest' });
assert.equal(c.updates.url, 'https://updates.example.test/manifest');
assert.equal(c.updates.enabled, true);

/* ---------- resume policy and hook ---------- */
let clock = 0;
let fetchImpl = async () => ({ isNew: true });
let fetches = 0;
const React = { effects: [], cleanups: [], useEffect: (fn) => React.effects.push(fn) };
const listeners = [];
const native = {
  isEnabled: true,
  reloads: 0,
  fetchUpdateAsync: () => { fetches++; return fetchImpl(); },
  reloadAsync: async () => { native.reloads++; },
};
const mocks = {
  react: React,
  'react-native': {
    AppState: { addEventListener: (event, fn) => { listeners.push({ event, fn }); return { remove: () => { listeners.length = 0; } }; } },
    Platform: { OS: 'ios' },
  },
  'expo-updates': native,
};
const ota = load('src/lib/otaUpdates.ts', mocks, { Date: { now: () => clock } });
const { shouldFetchOnResume, fetchPatchQuietly, useOtaUpdateResumeCheck, OTA_RESUME_INTERVAL_MS } = ota;

const gate = (o = {}) => shouldFetchOnResume({ platform: 'ios', enabled: true, busy: false, now: 10_000_000, lastCheck: 0, ...o });
assert.equal(gate(), true);
assert.equal(gate({ platform: 'android' }), true);
assert.equal(gate({ platform: 'web' }), false, 'web/desktop has no OTA runtime');
assert.equal(gate({ platform: 'macos' }), false);
assert.equal(gate({ enabled: false }), false, 'a disabled build must not call the service');
assert.equal(gate({ busy: true }), false, 'one check in flight at a time');
assert.equal(gate({ now: 60_000 }), false, 'a resume before the first interval is skipped');
assert.equal(gate({ lastCheck: 10_000_000 - 5 * 60_000 }), false);
assert.equal(gate({ lastCheck: 10_000_000 - OTA_RESUME_INTERVAL_MS }), true);
assert.equal(gate({ lastCheck: 10_000_000 - 31 * 60_000 }), true);
assert.equal(gate({ lastCheck: 10_000_000 - 31 * 60_000, intervalMs: 60 * 60_000 }), false, 'interval is overridable');

(async () => {
  let calls = 0;
  const fake = (result) => ({ isEnabled: true, fetchUpdateAsync: async () => { calls++; if (result instanceof Error) throw result; return result; } });
  assert.equal(await fetchPatchQuietly({ isEnabled: false, fetchUpdateAsync: async () => { throw Error('must not be called'); } }), 'skipped');
  assert.equal(await fetchPatchQuietly(fake({ isNew: true })), 'downloaded');
  assert.equal(await fetchPatchQuietly(fake({ isNew: false })), 'none');
  assert.equal(await fetchPatchQuietly(fake(new Error('offline'))), 'failed', 'offline must fall back to the running bundle');
  assert.equal(await fetchPatchQuietly({ isEnabled: true, fetchUpdateAsync: async () => { throw Error('bad manifest'); } }), 'failed');
  assert.equal(calls, 3);

  /* ---------- hook: quiet, throttled, never reloads ---------- */
  let pending = null;
  fetchImpl = () => new Promise((resolve) => { pending = { resolve }; });
  useOtaUpdateResumeCheck();
  for (const fn of React.effects.splice(0)) { const cleanup = fn(); if (typeof cleanup === 'function') React.cleanups.push(cleanup); }
  assert.equal(listeners.length, 1, 'one AppState subscription');
  assert.equal(listeners[0].event, 'change');
  const onState = listeners[0].fn;
  assert.equal(fetches, 0, 'launch belongs to the native ON_LOAD check, not this hook');
  onState('background');
  assert.equal(fetches, 0);
  onState('active');
  assert.equal(fetches, 1, 'the first foreground resume checks once');
  onState('active');
  assert.equal(fetches, 1, 'a resume while a download is in flight is ignored');
  pending.resolve({ isNew: true });
  await new Promise((r) => setImmediate(r));
  clock = 5 * 60_000; onState('active');
  assert.equal(fetches, 1, 'throttled inside the interval');
  clock = OTA_RESUME_INTERVAL_MS + 1_000; onState('active');
  assert.equal(fetches, 2, 'checks again once the interval has passed');
  assert.equal(native.reloads, 0, 'a patch is applied on the next launch, never by a mid-session reload');
  pending.resolve({ isNew: true });
  await new Promise((r) => setImmediate(r));

  // A failing or slow service must not break reading.
  fetchImpl = async () => { throw Error('offline'); };
  clock += OTA_RESUME_INTERVAL_MS + 1; onState('active');
  await new Promise((r) => setImmediate(r));
  assert.equal(fetches, 3);

  // Unmount stops every further check.
  React.cleanups.forEach((fn) => fn());
  clock += OTA_RESUME_INTERVAL_MS + 1; onState('active');
  assert.equal(fetches, 3, 'no checks after unmount');

  console.log('PASS: OTA off without a linked Expo project, ON_LOAD with no launch wait, per-channel request header, appVersion runtime version, resume-only throttled checks, fail-open downloads, no mid-session reload, cleanup on unmount');
})().catch((e) => { console.error(e); process.exitCode = 1; });
