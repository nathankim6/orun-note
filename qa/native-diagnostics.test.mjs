import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractCrashDiagnostics, sanitizeDiagnostic } from '../scripts/native-diagnostics.mjs';
const canary = 'PRIVATE_CANARY_student_token_url_videoId';
const line = (pid, payload, tag = 'AndroidRuntime') => `11-01 10:00:00.000 ${pid} 900 E ${tag}: ${payload}`;
const javaCrash = [
  line(321, 'FATAL EXCEPTION: main'),
  line(321, `Process: com.paperly.study:pdfdetail, PID: 321 ${canary}`),
  line(321, `java.lang.RuntimeException: ${canary} https://private.test/student.pdf`),
  line(321, `Caused by: java.lang.Error: ${canary}`),
  line(321, '\tat expo.modules.pdfrenderer.PdfRendererModule.onCreate(PdfRendererModule.kt:123)'),
  line(321, '\tat com.paperly.study.Application.<init>(Application.java:44)'),
].join('\n');
fs.mkdirSync(path.resolve('qa/build'), { recursive: true });
const work = fs.mkdtempSync(path.resolve('qa/build/diagnostics-test-'));
function sanitize(text, name = 'sample') {
  const input = path.join(work, name + '.raw'), output = path.join(work, name + '.jsonl');
  fs.writeFileSync(input, text);
  const result = spawnSync(process.execPath, ['scripts/native-sanitize.mjs', input, output, 'android'], { encoding: 'utf8' });
  return { status: result.status, output: fs.readFileSync(output, 'utf8') };
}
test('worker exception class, Java class/method/line survive, no message or process ID survives', () => {
  const report = extractCrashDiagnostics(javaCrash, { platform: 'android' });
  assert.equal(report.crash, true);
  assert(report.diagnostics.some(r => r.exceptionClass === 'java.lang.RuntimeException'));
  assert(report.diagnostics.some(r => r.exceptionClass === 'java.lang.Error'));
  assert.deepEqual(report.diagnostics.find(r => r.frameMethod === 'onCreate'), { event: 'crash_java_frame', frameClass: 'expo.modules.pdfrenderer.PdfRendererModule', frameMethod: 'onCreate', sourceLine: 123 });
  assert(!JSON.stringify(report).includes(canary));
  assert(!JSON.stringify(report).includes('student.pdf'));
});
test('unrelated process fatal does not fail an app smoke result', () => {
  const other = javaCrash.replaceAll('com.paperly.study:pdfdetail', 'com.android.unrelated');
  assert.deepEqual(extractCrashDiagnostics(other, { platform: 'android', pids: ['777'] }), { crash: false, diagnostics: [] });
  const result = sanitize(other + '\nQA_JSON {"event":"suite_result","result":"pass","platform":"android"}', 'unrelated');
  assert.equal(result.status, 0);
  assert(!result.output.includes('crash_java'));
});
test('attributed WebView sandbox and native PDF-worker tombstone are not excluded', () => {
  const webview = line(100, 'Start proc 555:com.google.android.webview:sandboxed_process0/u0i1 for {com.paperly.study/org.chromium.Service}', 'ActivityManager') + '\n' + line(555, 'FATAL EXCEPTION: renderer') + '\n' + line(555, 'java.lang.IllegalStateException: ' + canary);
  assert.equal(extractCrashDiagnostics(webview, { platform: 'android' }).crash, true);
  const tombstone = [line(999, '>>> com.paperly.study:pdfdetail <<<', 'DEBUG'), line(999, 'signal 11 (SIGSEGV), code 1 (SEGV_MAPERR)', 'DEBUG'), line(999, '#00 pc 000000000001a2bc /private/' + canary + '/libpdfrenderer.so (secret)', 'DEBUG')].join('\n');
  const native = extractCrashDiagnostics(tombstone, { platform: 'android' });
  assert.equal(native.crash, true);
  assert.deepEqual(native.diagnostics, [{ event: 'crash_native_frame', nativeLibrary: 'libpdfrenderer.so', nativePc: '0x000000000001a2bc' }]);
});
test('sanitizer strips private fields, rejects malicious symbols, bounds count, only emits on failure', () => {
  const rows = [
    { event: 'suite_result', result: 'fail', platform: 'android', secret: canary },
    { event: 'crash_java_exception', exceptionClass: 'java.lang.RuntimeException', message: canary, url: 'https://private.test', processId: 321 },
    { event: 'crash_java_frame', frameClass: 'expo.modules.pdfrenderer.PdfRendererModule', frameMethod: 'onCreate', sourceLine: 123, path: canary, videoId: canary },
    { event: 'crash_java_frame', frameClass: 'https://private.test/' + canary, frameMethod: 'onCreate', sourceLine: 1 },
    { event: 'crash_java_exception', exceptionClass: '../private/' + canary },
    { event: 'crash_native_frame', nativeLibrary: '/private/' + canary + '/libsecret.so', nativePc: '0x123' },
    { event: 'crash_native_frame', nativeLibrary: 'libc.so', nativePc: '0xabc', path: canary, symbols: canary },
    ...Array.from({ length: 80 }, (_, i) => ({ event: 'crash_java_frame', frameClass: 'expo.modules.SafeClass', frameMethod: 'run', sourceLine: i + 1 })),
  ];
  const result = sanitize(rows.map(r => 'QA_JSON ' + JSON.stringify(r)).join('\n'), 'canary');
  assert.equal(result.status, 1);
  assert(!result.output.includes(canary));
  assert(!/private|https|message|secret|videoId|processId|symbols/.test(result.output));
  assert(result.output.includes('expo.modules.pdfrenderer.PdfRendererModule'));
  const parsed = result.output.trim().split('\n').map(JSON.parse);
  assert.equal(parsed.filter(r => r.event === 'crash_java_frame').length, 32);
  const success = sanitize('QA_JSON ' + JSON.stringify(rows[2]) + '\nQA_JSON {"event":"suite_result","result":"pass","platform":"android"}', 'success');
  assert.equal(success.status, 0); assert(!success.output.includes('crash_java_frame'));
  assert.equal(sanitizeDiagnostic({ event: 'crash_ios_exception', iosException: canary }), null);
  assert.equal(sanitizeDiagnostic({ event: 'crash_native_frame', nativeLibrary: 'libc.so', nativePc: '0x' + 'a'.repeat(17) }), null);
});
test('iOS failure diagnostics are enums only', () => {
  const text = `Exception Type: EXC_BAD_ACCESS (SIGSEGV) ${canary}\nTerminating app due to uncaught exception '${canary}'\nlibc++abi: terminating due to uncaught exception ${canary}`;
  const report = extractCrashDiagnostics(text, { platform: 'ios' });
  assert(report.crash);
  assert.deepEqual(new Set(report.diagnostics.map(r => r.iosException)), new Set(['EXC_BAD_ACCESS', 'SIGSEGV', 'NS_EXCEPTION', 'CPP_TERMINATE']));
  assert(!JSON.stringify(report).includes(canary));
});
test('missing main PID snapshots last logcat and emits sanitized worker frames before failure', () => {
  const bin = path.join(work, 'bin'); fs.mkdirSync(bin);
  const raw = path.join(work, 'fake-logcat.raw'); fs.writeFileSync(raw, javaCrash);
  fs.writeFileSync(path.join(bin, 'adb'), '#!/bin/sh\nif [ "$1" = logcat ] && [ "$2" = -d ]; then cat "$QA_TEST_LOG"; exit 0; fi\nif [ "$1" = shell ] && [ "$2" = pidof ]; then exit 1; fi\nexit 0\n', { mode: 0o755 });
  const result = spawnSync(process.execPath, ['scripts/native-android-smoke.mjs'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, QA_TEST_LOG: raw } });
  assert.equal(result.status, 1);
  assert(result.stdout.includes('process_crash'));
  assert(result.stdout.includes('expo.modules.pdfrenderer.PdfRendererModule'));
  assert(!result.stdout.includes(canary)); assert(!result.stdout.includes('https://'));
  assert.equal(sanitize(result.stdout, 'driver').status, 1);
});
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

function launchRaceDriver(mode) {
  const dir = fs.mkdtempSync(path.join(work, 'launch-race-'));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'adb'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), dir = process.env.QA_RACE_DIR;
fs.appendFileSync(path.join(dir, 'commands'), JSON.stringify(args) + '\\n');
if (args[0] === 'shell' && args[1] === 'pidof') {
  const state = path.join(dir, 'pid-count');
  const count = (fs.existsSync(state) ? Number(fs.readFileSync(state, 'utf8')) : 0) + 1;
  fs.writeFileSync(state, String(count));
  if (process.env.QA_RACE_MODE === 'delayed') { if (count < 3) process.exit(1); }
  else if (count > 1) process.exit(1);
  console.log('777');
}
if (args[0] === 'shell' && args[1] === 'cat') console.log('<hierarchy><node text="qa-js-error" content-desc="qa-js-error" bounds="[0,0][1,1]" /></hierarchy>');
`, { mode: 0o755 });
  const result = spawnSync(process.execPath, ['scripts/native-android-smoke.mjs'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, QA_RACE_DIR: dir, QA_RACE_MODE: mode } });
  const commands = fs.readFileSync(path.join(dir, 'commands'), 'utf8').trim().split('\n').map(JSON.parse);
  return { ...result, commands };
}
test('delayed initial PID is awaited after am start -W, not misclassified as a crash', () => {
  const result = launchRaceDriver('delayed');
  assert.equal(result.status, 1); // Deliberately injected UI JS error terminates this unit fixture.
  assert(result.commands.some(a => JSON.stringify(a) === JSON.stringify(['shell', 'am', 'start', '-W', '-n', 'com.paperly.study/.MainActivity'])));
  assert(!result.commands.some(a => a.includes('monkey')));
  assert(result.commands.filter(a => a[1] === 'pidof').length >= 4);
  assert(result.commands.some(a => a[1] === 'uiautomator'));
  assert(result.stdout.includes('"reason":"js_error"'));
  assert(!result.stdout.includes('process_crash'));
  assert(!result.stdout.includes('startup_timeout'));
});
test('PID disappearance after first observation fails immediately without startup retry', () => {
  const result = launchRaceDriver('death');
  assert.equal(result.status, 1);
  assert(result.stdout.includes('"reason":"process_crash"'));
  assert(!result.stdout.includes('startup_timeout'));
  // Only failure-only telemetry capture may dump XML; it never re-enters health/PID checks.
  assert.equal(result.commands.filter(a => a[1] === 'uiautomator').length, 1);
  assert.equal(result.commands.filter(a => a[1] === 'pidof').length, 2);
  assert(result.commands.some(a => a[0] === 'logcat' && a[1] === '-d'));
});

test('tap reuses a <=500ms matching node once, but stale or missing nodes require fresh wait', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = fs.readFileSync('scripts/native-android-smoke.mjs', 'utf8');
  const body = source.match(/async function tap\(label\) \{[\s\S]*?\n\}/)?.[0];
  assert(body);
  async function exercise(age, present) {
    let waited = 0, tapped = 0;
    const node = { bounds: '[10,20][30,40]' };
    const context = { Date: { now: () => 1000 }, nodesReadAt: 1000 - age, find: () => present ? node : undefined, wait: async () => { waited++; return node; }, adb: (...args) => { tapped++; assert.deepEqual(args, ['shell', 'input', 'tap', '20', '30']); }, Math, Error };
    const tap = runInNewContext(body + '\ntap;', context);
    await tap('일시정지');
    assert.equal(tapped, 1); assert.equal(context.nodesReadAt, 0);
    return waited;
  }
  assert.equal(await exercise(500, true), 0);
  assert.equal(await exercise(501, true), 1);
  assert.equal(await exercise(1, false), 1);
});
test('failure step accepts only explicit safe enums and strips arbitrary labels', () => {
  const result = sanitize([
    { event: 'suite_result', platform: 'android', result: 'fail' },
    { event: 'driver_failure_step', step: 'player_close', label: canary },
    { event: 'driver_failure_step', step: canary, label: canary },
  ].map(row => 'QA_JSON ' + JSON.stringify(row)).join('\n'), 'step-enum');
  assert.equal(result.status, 1);
  assert(result.output.includes('"step":"player_close"'));
  assert(!result.output.includes(canary)); assert(!result.output.includes('"label"'));
});

test('JS exception enums and allowlisted bundle frames survive without raw messages/functions/URLs', () => {
  const raw = [
    line(777, 'Process: com.paperly.study, PID: 777'),
    line(777, 'TypeError: ' + canary + ' https://private.test/' + canary, 'ReactNativeJS'),
    line(777, 'renderWithHooks@1:123456', 'ReactNativeJS'),
    line(777, canary + '@1:123457', 'ReactNativeJS'),
    line(777, '    at onMessage (address at index.android.bundle:1:456789)', 'ReactNativeJS'),
    line(777, '    at onMessage (https://private.test/' + canary + ':1:999)', 'ReactNativeJS'),
  ].join('\n');
  const report = extractCrashDiagnostics(raw, { platform: 'android' });
  assert(report.crash);
  assert(report.diagnostics.some(r => r.jsException === 'TypeError'));
  assert(report.diagnostics.some(r => r.frameFunction === 'renderWithHooks' && r.bundleColumn === 123456));
  assert(report.diagnostics.some(r => r.frameFunction === 'other' && r.bundleColumn === 123457));
  assert(report.diagnostics.some(r => r.frameFunction === 'onMessage' && r.bundleColumn === 456789));
  assert(!report.diagnostics.some(r => r.bundleColumn === 999));
  assert(!JSON.stringify(report).includes(canary));
  const result = sanitize(raw, 'js-stack');
  assert.equal(result.status, 1); assert(result.output.includes('TypeError')); assert(result.output.includes('renderWithHooks'));
  assert(!/PRIVATE|https|private\.test/.test(result.output));
  assert.equal(sanitizeDiagnostic({ event: 'crash_js_frame', frameFunction: canary, bundleLine: 1, bundleColumn: 2 }), null);
  assert.equal(sanitizeDiagnostic({ event: 'crash_js_frame', frameFunction: 'onMessage', bundleLine: 1, bundleColumn: 10000001 }), null);
});
test('QA player transport/YouTube error helper and final sanitizer reject private/arbitrary codes', async () => {
  const { createRequire } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const ts = createRequire(import.meta.url)('typescript');
  const compiled = ts.transpileModule(fs.readFileSync('qa/error-codes.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {} }; runInNewContext(compiled, context);
  for (const code of [2, 5, 100, 101, 150, 152, 153, 'load', 'http', 'process', 'timeout', 'network']) assert.equal(context.exports.playerErrorCode(code), code);
  for (const code of [canary, '153', 999, { message: canary }, 'https://private.test']) assert.equal(context.exports.playerErrorCode(code), undefined);
  assert.equal(context.exports.jsExceptionName('ReferenceError'), 'ReferenceError');
  assert.equal(context.exports.jsExceptionName(canary), undefined);
  const result = sanitize([
    { event: 'player_unavailable', cycle: 1, errorCode: 153, message: canary },
    { event: 'player_unavailable', cycle: 2, errorCode: 'http', url: canary },
    { event: 'player_unavailable', cycle: 3, errorCode: canary },
    { event: 'js_error', jsException: 'ReferenceError', message: canary },
  ].map(r => 'QA_JSON ' + JSON.stringify(r)).join('\n'), 'error-codes');
  assert.equal(result.status, 1); assert(result.output.includes('"errorCode":153')); assert(result.output.includes('"errorCode":"http"'));
  assert(result.output.includes('ReferenceError')); assert(!result.output.includes(canary));
});
test('failure collection keeps cached telemetry if XML fails and can capture XML without healthy recheck', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = fs.readFileSync('scripts/native-android-smoke.mjs', 'utf8');
  const parse = source.match(/function parseXML\(xml\) \{[\s\S]*?\n\}/)?.[0];
  const collect = source.match(/function collect\(\) \{[\s\S]*?\n\}/)?.[0];
  assert(parse && collect);
  const rows = [{ event: 'boot' }, { event: 'list_open', cycle: 1 }, { event: 'player_unavailable', cycle: 1, errorCode: 153 }];
  const xml = '<hierarchy><node resource-id="qa-telemetry" content-desc="' + JSON.stringify(rows).replaceAll('"', '&quot;') + '" /></hierarchy>';
  for (const brokenXML of [true, false]) {
    const printed = [];
    const context = { lastUINodes: [], lastXMLState: 'unavailable', lastTelemetry: brokenXML ? rows : [], decode: s => s.replaceAll('&quot;', '"'), console: { log: s => printed.push(s) }, read: () => { throw Error('fatal recheck must not run'); }, adb: (...args) => { if (brokenXML) throw Error('app UI gone'); return args[1] === 'cat' ? xml : ''; } };
    const run = runInNewContext(parse + '\n' + collect + '\ncollect;', context); run();
    assert.equal(printed.length, 3); assert(printed.some(s => s.includes('"errorCode":153')));
  }
});
test('iOS failure helper emits safe reason/step before failing; sanitizer retains them', () => {
  const swift = fs.readFileSync('qa/ios/NativeSmokeTests.swift', 'utf8');
  const fail = swift.match(/  func fail\(_ reason: String\) \{[\s\S]*?\n  \}/)?.[0];
  assert(fail && fail.indexOf('emit("suite_result"') < fail.indexOf('    XCTFail(reason)'));
  assert(swift.includes('fail("network_or_player_unavailable")'));
  assert(!swift.includes('XCTFail("network_or_player_unavailable")'));
  const input = path.join(work, 'ios-reason.raw'), output = path.join(work, 'ios-reason.jsonl');
  fs.writeFileSync(input, 'QA_JSON {"event":"driver_failure_step","step":"wait_ready"}\nQA_JSON {"event":"suite_result","platform":"ios","result":"fail","reason":"network_or_player_unavailable"}\n');
  const result = spawnSync(process.execPath, ['scripts/native-sanitize.mjs', input, output, 'ios']);
  const text = fs.readFileSync(output, 'utf8'); assert.equal(result.status, 1);
  assert(text.includes('"reason":"network_or_player_unavailable"')); assert(text.includes('"step":"wait_ready"'));
});
test('legacy iOS player-unavailable telemetry gets a specific fallback reason without a fake pass', () => {
  const result = sanitize('QA_JSON {"event":"boot"}\nQA_JSON {"event":"player_unavailable","cycle":1,"errorCode":153}', 'legacy-unavailable');
  assert.equal(result.status, 1); assert(result.output.includes('"reason":"network_or_player_unavailable"'));
  assert(!result.output.includes('"reason":"driver_failure"'));
});

test('caught generic console Error is not app-fatal, but specific JS errors and renderer death remain gated', () => {
  const base = line(777, 'Process: com.paperly.study, PID: 777') + '\n';
  const generic = base + line(777, 'Error: caught WebView failure ' + canary, 'ReactNativeJS');
  assert.equal(extractCrashDiagnostics(generic, { platform: 'android' }).crash, false);
  assert(extractCrashDiagnostics(generic, { platform: 'android', force: true }).diagnostics.some(r => r.jsException === 'Error'));
  for (const type of ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError', 'InternalError']) {
    assert.equal(extractCrashDiagnostics(base + line(777, type + ': ' + canary, 'ReactNativeJS'), { platform: 'android' }).crash, true);
  }
  assert.equal(extractCrashDiagnostics(base + line(777, 'Renderer process 555 crash detected', 'chromium'), { platform: 'android' }).crash, true);
  assert.equal(extractCrashDiagnostics(base + line(777, 'com.facebook.react.common.JavascriptException: Error: ' + canary), { platform: 'android' }).crash, true);
  const result = sanitize(generic + '\nQA_JSON {"event":"player_unavailable","cycle":1,"errorCode":"network"}', 'caught-network');
  assert.equal(result.status, 1); assert(result.output.includes('network_or_player_unavailable'));
  assert(result.output.includes('"errorCode":"network"')); assert(!result.output.includes('native_or_js_error')); assert(!result.output.includes(canary));
});
test('authoritative fatal category snapshots latest telemetry before throwing', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = fs.readFileSync('scripts/native-android-smoke.mjs', 'utf8');
  const body = source.match(/function read\(\) \{[\s\S]*?\n\}/)?.[0]; assert(body);
  let captured = false;
  const context = { nodesReadAt: 0, Date, start: Date.now(), pkg: 'com.paperly.study', knownPids: new Set(), crashLogs: () => ({ crash: true }), parseXML: xml => { assert.equal(xml, 'latest-telemetry'); captured = true; }, adb: (...a) => a[1] === 'pidof' ? '777' : a[1] === 'cat' ? 'latest-telemetry' : '', Error };
  const read = runInNewContext(body + '\nread;', context);
  assert.throws(read, /native_or_js_error/); assert(captured);
});

test('surface summary identifies foreground/dialog/QA state without leaking private labels or packages', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = fs.readFileSync('scripts/native-android-smoke.mjs', 'utf8');
  const body = source.match(/function surfaceSummary\(inputNodes, activity, window, xmlSource\) \{[\s\S]*?\n\}/)?.[0]; assert(body);
  const summarize = runInNewContext(body + '\nsurfaceSummary;', {});
  const appNodes = [{ package:'com.paperly.study', text:canary, 'resource-id':canary }, { package:'com.paperly.study', 'content-desc':'open-review-videos' }, { package:'com.paperly.study', text:'qa-boot' }, { package:'com.paperly.study', text:'qa-state-playing-1 qa-ready-1' }];
  const app = summarize(appNodes, '', 'mCurrentFocus=Window{deadbeef u0 com.paperly.study/.MainActivity ' + canary + '}', 'fresh');
  assert.equal(app.foreground,'app'); assert.equal(app.uiPackage,'app'); assert.equal(app.nodeCount,4); assert.equal(app.appNodeCount,4); assert.equal(app.qaNodeCount,3);
  assert(app.uiLabels.includes('root_button')); assert(app.uiLabels.includes('qa_boot')); assert(app.uiLabels.includes('player'));
  assert(!JSON.stringify(app).includes(canary)); assert(!JSON.stringify(app).includes('com.paperly.study'));
  const cases = [
    [[{package:'android','resource-id':'android:id/aerr_close'},{package:'android',text:'Google Play services keeps stopping ' + canary}], '', 'gms_crash'],
    [[{package:'android','resource-id':'android:id/aerr_close'}], '', 'app_crash'],
    [[{package:'android','resource-id':'android:id/aerr_wait'}], '', 'anr'],
    [[], 'mShowingLockscreen=true', 'keyguard'],
    [[{package:'android',text:'Waiting for debugger'}], '', 'debugger'],
    [[], 'mCurrentFocus=Window{x u0 com.google.android.permissioncontroller/.GrantPermissionsActivity}', 'permission'],
    [[], 'mCurrentFocus=Window{x u0 com.google.android.apps.nexuslauncher/com.android.quickstep.interaction.GestureSandboxActivity}', 'gesture_tutorial'],
    [[], 'mCurrentFocus=Window{x u0 com.android.systemui/.UnknownDialog}', 'unknown'],
  ];
  for(const [nodes,window,dialog] of cases) assert.equal(summarize(nodes,'',window,'cached').dialog,dialog);
  assert.equal(summarize([], 'topResumedActivity=ActivityRecord{x u0 com.android.launcher3/.Launcher}', '', 'unavailable').foreground,'launcher');
  assert.equal(summarize([], '', canary, 'unavailable').foreground,'unknown');
});
test('surface sanitizer exports bounded counts/fixed enums only and drops successful-suite surface events', () => {
  const bad = {event:'driver_surface',foreground:canary,dialog:canary,uiPackage:canary,xmlSource:canary,nodeCount:10001,appNodeCount:-1,qaNodeCount:1.5,uiLabels:[canary,'qa_boot','qa_boot'],rawXML:canary,package:canary,path:canary};
  const good = {event:'driver_surface',foreground:'permission',dialog:'permission',uiPackage:'permission',xmlSource:'fresh',nodeCount:20,appNodeCount:0,qaNodeCount:0,uiLabels:['qa_loading'],private:canary};
  const result=sanitize([bad,good,{event:'suite_result',result:'fail',platform:'android',reason:'ui_timeout'}].map(r=>'QA_JSON '+JSON.stringify(r)).join('\n'),'surface-private');
  assert.equal(result.status,1); assert(!result.output.includes(canary)); assert(!result.output.includes('rawXML'));
  assert(result.output.includes('"foreground":"permission"')); assert(result.output.includes('"nodeCount":20'));
  const parsed=result.output.trim().split('\n').map(JSON.parse).filter(r=>r.event==='driver_surface');
  assert.equal(parsed[0].nodeCount,undefined); assert.equal(parsed[0].foreground,undefined); assert.deepEqual(parsed[0].uiLabels,['qa_boot']);
  const passed=sanitize('QA_JSON '+JSON.stringify(good)+'\nQA_JSON {"event":"suite_result","result":"pass","platform":"android"}','surface-success');
  assert.equal(passed.status,0); assert(!passed.output.includes('driver_surface'));
});

test('synthetic screenshot wrapper captures only authorized failed CI emulator runs and preserves failures', () => {
  const scenarios = [
    {name:'approved-failure',driver:1,ci:'true',allow:'1',qemu:'1',image:true,status:1},
    {name:'real-device-blocked',driver:1,ci:'true',allow:'1',qemu:'0',image:false,status:1},
    {name:'flag-disabled',driver:1,ci:'true',allow:'0',qemu:'1',image:false,status:1},
    {name:'not-actions',driver:1,ci:'false',allow:'1',qemu:'1',image:false,status:1},
    {name:'success-no-image',driver:0,ci:'true',allow:'1',qemu:'1',image:false,status:0},
    {name:'sanitizer-failure',driver:0,ci:'true',allow:'1',qemu:'1',image:false,status:1,sanitizerFail:true},
  ];
  for(const scenario of scenarios) {
    const dir=fs.mkdtempSync(path.join(work,'screenshot-'));fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'bin'));
    for(const file of ['native-android-ci.sh','native-sanitize.mjs','native-diagnostics.mjs'])fs.copyFileSync('scripts/'+file,path.join(dir,'scripts',file));
    fs.writeFileSync(path.join(dir,'scripts/native-android-smoke.mjs'), 'const code=Number(process.env.QA_MOCK_DRIVER);console.log("QA_JSON "+JSON.stringify({event:"suite_result",platform:"android",result:code?"fail":"pass",reason:code?"ui_timeout":undefined}));process.exitCode=code;');
    if(scenario.sanitizerFail)fs.writeFileSync(path.join(dir,'scripts/native-sanitize.mjs'),'process.exitCode=1;');
    fs.writeFileSync(path.join(dir,'bin/timeout'),'#!/bin/sh\nshift\nexec "$@"\n',{mode:0o755});
    fs.writeFileSync(path.join(dir,'bin/adb'),'#!/bin/sh\nif [ "$1" = shell ] && [ "$2" = getprop ]; then printf "%s\\n" "$QA_MOCK_QEMU"; exit 0; fi\nif [ "$1" = exec-out ] && [ "$2" = screencap ]; then printf "\\211PNG\\r\\n\\032\\nS"; exit 0; fi\nexit 1\n',{mode:0o755});
    const result=spawnSync('bash',['scripts/native-android-ci.sh'],{cwd:dir,encoding:'utf8',timeout:20000,env:{...process.env,PATH:path.join(dir,'bin')+path.delimiter+process.env.PATH,GITHUB_ACTIONS:scenario.ci,NATIVE_SMOKE_ALLOW_SYNTHETIC_SCREENSHOT:scenario.allow,QA_MOCK_QEMU:scenario.qemu,QA_MOCK_DRIVER:String(scenario.driver)}});
    assert.equal(result.status,scenario.status,scenario.name+': '+result.stderr);
    assert.equal(fs.existsSync(path.join(dir,'qa/output/android-synthetic-qa-failure.png')),scenario.image,scenario.name);
  }
  const workflow=fs.readFileSync('.github/workflows/native-smoke.yml','utf8');
  assert(workflow.includes('force-avd-creation: true'));
  assert(workflow.includes('name: Synthetic-QA-failure-only-Android-screenshot'));
  assert(workflow.includes('retention-days: 1'));
  assert(!workflow.includes('path: qa/output/*'));
});
