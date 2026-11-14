import { androidPassLog } from './native-pass-fixture.mjs';
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
function sanitize(text, name = 'sample', platform = 'android') {
  const input = path.join(work, name + '.raw'), output = path.join(work, name + '.jsonl');
  fs.writeFileSync(input, text);
  const result = spawnSync(process.execPath, ['scripts/native-sanitize.mjs', input, output, platform], { encoding: 'utf8' });
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
  const result = sanitize(other + '\n' + androidPassLog, 'unrelated');
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
  const success = sanitize('QA_JSON ' + JSON.stringify(rows[2]) + '\n' + androidPassLog, 'success');
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
test('iOS driver status is sanitized, capped, failure-only, and cannot be overridden by app pass', () => {
  const raw = [
    { event: 'ios_driver_status', stage: 'xctest', reason: 'runner_launch_failure', appValidated: true, exitCode: 65, driverFailure: false, testsRun: 1, testsFailed: 1, message: canary, path: canary },
    { event: 'ios_driver_status', stage: 'launch_probe', reason: 'invalid_option', exitCode: 2, errorDomain: 'CoreSimulatorErrorDomain', errorCode: 405, secret: canary },
    { event: 'ios_driver_status', stage: 'xctest', reason: canary, exitCode: 1, label: canary },
    { event: 'suite_result', platform: 'ios', result: 'pass' },
  ].map(row => 'QA_JSON ' + JSON.stringify(row)).join('\n');
  const result = sanitize(raw, 'ios-driver-status', 'ios');
  assert.equal(result.status, 1); assert(!result.output.includes(canary));
  const rows = result.output.trim().split('\n').map(JSON.parse), status = rows.filter(row => row.event === 'ios_driver_status');
  assert.equal(status.length, 2); assert.equal(status[0].driverFailure, true); assert.equal(status[0].appValidated, false);
  assert(rows.some(row => row.event === 'suite_result' && row.result === 'fail'));
  const passing = sanitize('QA_JSON ' + JSON.stringify({ event: 'ios_driver_status', stage: 'xctest', reason: 'unknown', exitCode: 0, driverFailure: true }) + '\nQA_JSON {"event":"suite_result","platform":"ios","result":"pass"}', 'ios-driver-success', 'ios');
  assert.equal(passing.status, 0); assert(!passing.output.includes('ios_driver_status'));
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
test('initial PID readiness uses deterministic virtual time for delay, timeout and startup crash', async () => {
  const {runInNewContext}=await import('node:vm');
  const source=fs.readFileSync('scripts/native-android-smoke.mjs','utf8');
  const body=source.match(/async function waitForInitialPid\(\) \{[\s\S]*?\n\}/)?.[0];assert(body);
  assert(body.includes('Date.now() + 15000')); // Runtime grace is not relaxed by this test.
  const exercise=async mode=>{
    let tick=0,probes=0,crashChecks=0;const sleeps=[],knownPids=new Set();
    const context={Date:{now:()=>tick},pkg:'com.paperly.study',knownPids,Error,milestones:{},fail:reason=>new Error(reason),
      adb:(...args)=>{
        assert.deepEqual(args,['shell','pidof','com.paperly.study']);probes++;
        if(mode==='delayed'&&probes===2)throw Error('not visible yet');
        return mode==='delayed'&&probes>=3?'777':'';
      },
      crashLogs:force=>{crashChecks++;assert.equal(force,mode!=='delayed'||probes<3);return {crash:mode==='crash'};},
      sleep:async ms=>{assert.equal(ms,200);sleeps.push(ms);tick+=ms;},
    };
    const wait=runInNewContext(body+'\nwaitForInitialPid;',context);
    if(mode==='delayed')await wait();
    else await assert.rejects(wait,mode==='crash'?/process_crash/:/startup_timeout/);
    return {tick,probes,crashChecks,sleeps,knownPids};
  };
  const delayed=await exercise('delayed');assert.equal(delayed.probes,3);assert.equal(delayed.crashChecks,3);assert.equal(delayed.tick,400);assert.deepEqual(delayed.sleeps,[200,200]);assert.deepEqual([...delayed.knownPids],['777']);
  const missing=await exercise('missing');assert.equal(missing.tick,15000);assert.equal(missing.probes,75);assert.equal(missing.crashChecks,75);assert.equal(missing.knownPids.size,0);
  const crashed=await exercise('crash');assert.equal(crashed.tick,0);assert.equal(crashed.probes,1);assert.equal(crashed.crashChecks,1);assert.equal(crashed.sleeps.length,0);
});
test('PID disappearance after first observation fails immediately without startup retry', () => {
  const result = launchRaceDriver('death');
  assert.equal(result.status, 1);
  assert(result.commands.some(a => JSON.stringify(a) === JSON.stringify(['shell', 'am', 'start', '-W', '-n', 'com.paperly.study/.MainActivity'])));
  assert(!result.commands.some(a => a.includes('monkey')));
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
    const context = { emit:()=>{}, telemetrySource:'unavailable', telemetrySeen: new Map(), telemetryClipped: 0, freshXML:()=>{if(brokenXML)throw Error('gone');return xml;}, lastUINodes: [], lastXMLState: 'unavailable', lastTelemetry: brokenXML ? rows : [], decode: s => s.replaceAll('&quot;', '"'), console: { log: s => printed.push(s) }, read: () => { throw Error('fatal recheck must not run'); }, adb: (...args) => { if (brokenXML) throw Error('app UI gone'); return args[1] === 'cat' ? xml : ''; } };
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
  const context = { fail:reason=>new Error(reason), freshXML:()=> 'latest-telemetry', nodesReadAt: 0, Date, start: Date.now(), pkg: 'com.paperly.study', knownPids: new Set(), crashLogs: () => ({ crash: true }), parseXML: xml => { assert.equal(xml, 'latest-telemetry'); captured = true; }, adb: (...a) => a[1] === 'pidof' ? '777' : a[1] === 'cat' ? 'latest-telemetry' : '', Error };
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
  const passed=sanitize('QA_JSON '+JSON.stringify(good)+'\n' + androidPassLog,'surface-success');
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
    for(const file of ['native-android-ci.sh','native-sanitize.mjs','native-diagnostics.mjs','native-ios-test-diagnostics.mjs'])fs.copyFileSync('scripts/'+file,path.join(dir,'scripts',file));
    fs.writeFileSync(path.join(dir,'scripts/native-android-preflight.mjs'), 'console.log("QA_JSON "+JSON.stringify({event:"emulator_preflight",phase:process.argv[2],result:"pass",reason:"ready"}));');
    fs.writeFileSync(path.join(dir,'scripts/native-android-smoke.mjs'), 'console.log(' + JSON.stringify(androidPassLog) + ');const code=Number(process.env.QA_MOCK_DRIVER);console.log("QA_JSON "+JSON.stringify({event:"suite_result",platform:"android",result:code?"fail":"pass",reason:code?"ui_timeout":undefined}));process.exitCode=code;');
    if(scenario.sanitizerFail)fs.writeFileSync(path.join(dir,'scripts/native-sanitize.mjs'),'process.exitCode=1;');
    fs.writeFileSync(path.join(dir,'bin/timeout'),'#!/bin/sh\nshift\nexec "$@"\n',{mode:0o755});
    fs.writeFileSync(path.join(dir,'bin/adb'),'#!/bin/sh\nif [ "$1" = install ]; then exit 0; fi\nif [ "$1" = shell ] && [ "$2" = getprop ]; then printf "%s\\n" "$QA_MOCK_QEMU"; exit 0; fi\nif [ "$1" = exec-out ] && [ "$2" = screencap ]; then printf "\\211PNG\\r\\n\\032\\nS"; exit 0; fi\nexit 1\n',{mode:0o755});
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

test('emulator configuration lowers physical pixels at DPR1 and refuses insufficient host capacity', async () => {
  const { configureAVD } = await import('../scripts/native-configure-avd.mjs');
  const result=configureAVD('hw.lcd.width=2560\nhw.lcd.height=1600\nhw.lcd.density=320\nuntouched=yes\n',4,8192);
  for(const setting of ['hw.lcd.width=1280','hw.lcd.height=800','hw.lcd.density=160','hw.ramSize=4096','hw.cpu.ncore=4','untouched=yes'])assert(result.includes(setting));
  assert.equal(result.match(/hw.lcd.width=/g).length,1);
  assert.throws(()=>configureAVD('',2,8192),/emulator_capacity_unsupported/);
  assert.throws(()=>configureAVD('',4,4096),/emulator_capacity_unsupported/);
  const workflow=fs.readFileSync('.github/workflows/native-smoke.yml','utf8');
  assert(workflow.includes('cores: 4'));assert(workflow.includes('ram-size: 4096M'));assert(workflow.includes('-gpu swiftshader -feature -Vulkan'));assert(!workflow.includes('swiftshader_indirect'));
});
test('preflight distinguishes exact System UI ANR from app ANR without retrying or disclosing messages', async () => {
  const { classifyPreflight, preflight }=await import('../scripts/native-android-preflight.mjs');
  const xml=title=>'<hierarchy><node package="android" resource-id="android:id/aerr_wait"/><node package="android" text="'+title+'"/></hierarchy>';
  for(const title of ["System UI isn't responding",'System UI isn’t responding'])assert.equal(classifyPreflight(xml(title),''),'emulator_system_ui_anr');
  assert.equal(classifyPreflight(xml('Paperly isn’t responding'),''),'emulator_app_anr');
  assert.equal(classifyPreflight(xml(canary),''),'emulator_app_anr');
  const emitted=[];let snapshots=0;
  const ok=await preflight(args=>{if(args[1]==='cat'){snapshots++;return xml('System UI isn’t responding');}return '';}, reason=>emitted.push(reason),async()=>{throw Error('must not retry ANR');});
  assert.equal(ok,false);assert.equal(snapshots,1);assert.deepEqual(emitted,['emulator_system_ui_anr']);
  const result=sanitize('QA_JSON {"event":"emulator_preflight","phase":"before_install","result":"fail","reason":"emulator_system_ui_anr","headline":"'+canary+'"}\nQA_JSON {"event":"suite_result","platform":"android","result":"fail","reason":"emulator_system_ui_anr"}','systemui-preflight');
  assert.equal(result.status,1);assert(result.output.includes('emulator_system_ui_anr'));assert(!result.output.includes(canary));
});
test('preflight readiness is bounded and requires two stable boot/UI/display observations', async () => {
  const {preflight}=await import('../scripts/native-android-preflight.mjs');let tick=0;const emitted=[];
  const readyQuery=args=>args.includes('sys.boot_completed')?'1':args.includes('init.svc.bootanim')?'stopped':args[1]==='pidof'?'123':args[1]==='cat'?'<hierarchy><node package="com.android.launcher3"/></hierarchy>':args[1]==='dumpsys'?'mCurrentFocus=Window{x u0 com.android.launcher3/.Launcher}':args[1]==='wm'?(args[2]==='size'?'Physical size: 1280x800':'Physical density: 160'):'';
  assert.equal(await preflight(readyQuery,r=>emitted.push(r),async ms=>{tick+=ms;},()=>tick),true);assert.deepEqual(emitted,['ready']);assert(tick>0);
  tick=0;emitted.length=0;
  assert.equal(await preflight(()=>'',r=>emitted.push(r),async ms=>{tick+=ms;},()=>tick),false);assert.equal(tick,60000);assert.deepEqual(emitted,['emulator_os_not_ready']);
});
test('surface enum uses System UI ANR only for the exact known OS headline', async () => {
  const {runInNewContext}=await import('node:vm');const body=fs.readFileSync('scripts/native-android-smoke.mjs','utf8').match(/function surfaceSummary\(inputNodes, activity, window, xmlSource\) \{[\s\S]*?\n\}/)[0];const summarize=runInNewContext(body+'\nsurfaceSummary;',{});
  const nodes=title=>[{package:'android','resource-id':'android:id/aerr_wait'},{package:'android',text:title}];
  assert.equal(summarize(nodes('System UI isn’t responding'),'','','fresh').dialog,'system_ui_anr');
  assert.equal(summarize(nodes('Paperly isn’t responding'),'','','fresh').dialog,'anr');
  assert.equal(summarize(nodes('System UI isn’t responding '+canary),'','','fresh').dialog,'anr');
});

test('QA content-clock marker requires real finite progress and emits once per cycle without private data', async () => {
  const {createRequire}=await import('node:module');const {runInNewContext}=await import('node:vm');const ts=createRequire(import.meta.url)('typescript');
  const source=fs.readFileSync('qa/entry.tsx','utf8');
  const callback=source.match(/const status = React\.useCallback\(([\s\S]*?)\n  \}, \[cycle\]\);/);assert(callback);
  const body=callback[1]+'\n  }';const code=ts.transpileModule('globalThis.status = '+body+';',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const rows=[], flags=[], context={observed:{current:new Set()},cycle:1,marker:(event,values)=>rows.push({event,...values}),setFlags:value=>flags.push(value),playerErrorCode:()=>undefined};
  runInNewContext(code,context);
  const base={ready:true,playing:true,time:0,duration:600,error:null,message:canary,videoId:canary};
  for(const patch of [{time:0},{time:0.9},{playing:false,time:10},{time:NaN},{time:Infinity},{time:2,duration:0},{time:2,duration:1},{time:2,duration:Infinity}])context.status({...base,...patch});
  assert.equal(rows.filter(r=>r.event==='player_progress').length,0);
  context.status({...base,time:1});context.status({...base,time:2});
  assert.equal(rows.filter(r=>r.event==='player_progress').length,1);
  const progress=rows.find(r=>r.event==='player_progress');assert.equal(progress.timeSeconds,1);assert.equal(progress.durationSeconds,600);
  assert(flags.at(-1).includes('qa-progressing-1'));assert(!JSON.stringify(rows).includes(canary));
  context.observed.current.clear();context.cycle=2;context.status({...base,time:3});assert.equal(rows.filter(r=>r.event==='player_progress').length,2);assert(flags.at(-1).includes('qa-progressing-2'));
  const output=sanitize('QA_JSON '+JSON.stringify(progress)+'\nQA_JSON '+JSON.stringify({event:'player_progress',timeSeconds:canary,durationSeconds:canary,url:canary})+'\nQA_JSON {"event":"suite_result","platform":"android","result":"fail","reason":"network_or_player_timeout"}','progress-private');
  assert(output.output.includes('"timeSeconds":1'));assert(output.output.includes('"durationSeconds":600'));assert(!output.output.includes(canary));
});
test('iOS retains progression gate; Android keeps it unless the provider refused the embed (environment-limited)', () => {
  const android=fs.readFileSync('scripts/native-android-smoke.mjs','utf8'),ios=fs.readFileSync('qa/ios/NativeSmokeTests.swift','utf8');
  for(const [source,play,progress,pause] of [
    [ios,'currentStep = "play"; tapID("review-video-play");','wait("qa-progressing-\\(cycle)", 60, contains: true)','currentStep = "pause"; tapID("review-video-pause");'],
  ]) {const p=source.indexOf(play),g=source.indexOf(progress,p),end=source.indexOf(pause,p);assert(p>=0&&g>p&&end>g);assert(source.includes('qa-progressing'));}
  // Android keeps the real play/progress/pause gate when the provider lets the embed play, and only skips it for a
  // provider refusal (150/101/100/5) recorded as player_environment_limited.
  assert(android.includes('await wait(`qa-progressing-${cycle}`'));
  assert(android.includes('if (environmentLimitedCycles.has(cycle)) {'));
  assert(android.includes('player_environment_limited'));
  assert(android.includes('cycle <= 20'));assert(android.includes('cycle <= 3'));assert(ios.includes('1...20'));assert(ios.includes('cycle <= 3'));
  const pdf=fs.readFileSync('qa/pdf-smoke.ts','utf8');assert(pdf.includes('trial <= 3'));
});

test('preflight uses full window focus or safe resumed-activity fallback, never explicit-null/unknown focus', async () => {
  const {preflightFocus,classifyPreflight,preflight}=await import('../scripts/native-android-preflight.mjs');
  const xml='<hierarchy><node package="com.android.launcher3" text="'+canary+'"/></hierarchy>';
  const activity='topResumedActivity=ActivityRecord{abc u0 com.android.launcher3/.Launcher t12}';
  const scoped='WINDOW MANAGER WINDOWS (dumpsys window windows)\nWindow #0 Window{abc u0 com.android.launcher3/.Launcher}';
  assert.deepEqual(preflightFocus(scoped,activity),{source:'activity',kind:'launcher',ready:true});
  assert.equal(classifyPreflight(xml,scoped,activity),'ready');
  assert.equal(classifyPreflight(xml,'mCurrentFocus=null',activity),'waiting');
  assert.equal(classifyPreflight(xml,'mCurrentFocus=Window{abc u0 com.private.'+canary+'/.Dialog}',activity),'waiting');
  assert.equal(classifyPreflight('',scoped,activity),'waiting');
  assert.equal(preflightFocus('mFocusedWindow=Window{abc u0 com.android.launcher3/.Launcher}').source,'display');
  let tick=0;const calls=[],reported=[];
  const query=(args,timeout)=>{calls.push({args,timeout});if(args[1]==='getprop')return args[2]==='sys.boot_completed'?'1':'stopped';if(args[1]==='pidof')return '123';if(args[1]==='cat')return xml;if(args[1]==='dumpsys')return args[2]==='window'?'mCurrentFocus=Window{abc u0 com.android.launcher3/.Launcher}':activity;if(args[1]==='wm')return args[2]==='size'?'Physical size: 1280x800':'Physical density: 160';if(args[1]==='uiautomator'){assert(timeout>6000);tick+=7000;}return '';};
  assert.equal(await preflight(query,(...x)=>reported.push(x),async ms=>{tick+=ms;},()=>tick),true);
  assert(calls.some(c=>JSON.stringify(c.args)===JSON.stringify(['shell','dumpsys','window'])));
  assert(!calls.some(c=>JSON.stringify(c.args)===JSON.stringify(['shell','dumpsys','window','windows'])));
  assert(calls.every(c=>c.timeout<=(c.args[1]==='uiautomator'?12000:6000)));
});
test('failed readiness exports exact missing criteria without trusting stale/no XML or private focus data', async () => {
  const {preflight}=await import('../scripts/native-android-preflight.mjs');
  let tick=0;const reports=[];
  const query=args=>args[1]==='getprop'?(args[2]==='sys.boot_completed'?'1':'stopped'):args[1]==='pidof'?'123':args[1]==='dumpsys'?'mCurrentFocus=Window{abc u0 com.android.launcher3/.Launcher}':args[1]==='wm'?(args[2]==='size'?'Physical size: 1280x800':'Physical density: 160'):'';
  assert.equal(await preflight(query,(...r)=>reports.push(r),async ms=>{tick+=ms;},()=>tick),false);
  assert.equal(tick,60000);const [reason,detail]=reports.at(-1);assert.equal(reason,'emulator_os_not_ready');assert.equal(detail.bootComplete,true);assert.equal(detail.focusReady,true);assert.equal(detail.xmlPresent,false);assert.deepEqual(detail.missing,['xml']);
  const input={event:'emulator_readiness',phase:'before_install',...detail,rawFocus:canary,package:canary,xml:canary};
  const result=sanitize('QA_JSON '+JSON.stringify(input)+'\nQA_JSON {"event":"suite_result","platform":"android","result":"fail","reason":"emulator_os_not_ready"}','readiness-private');
  assert.equal(result.status,1);assert(result.output.includes('"missing":["xml"]'));assert(!result.output.includes(canary));
  const malicious=sanitize('QA_JSON '+JSON.stringify({event:'emulator_readiness',bootComplete:canary,focusSource:canary,focusKind:canary,missing:[canary,'focus']})+'\nQA_JSON {"event":"suite_result","result":"fail","platform":"android"}','readiness-malicious');assert(!malicious.output.includes(canary));
  const passed=sanitize('QA_JSON '+JSON.stringify(input)+'\n' + androidPassLog,'readiness-passed');assert(!passed.output.includes('emulator_readiness'));
});
test('activity fallback never bypasses app ANR or a permission dialog; failed dump cannot accept cached XML', async () => {
  const {classifyPreflight,preflight}=await import('../scripts/native-android-preflight.mjs');const activity='mResumedActivity: ActivityRecord{x u0 com.android.launcher3/.Launcher}';
  assert.equal(classifyPreflight('<node package="android" resource-id="android:id/aerr_wait"/>','',activity),'emulator_app_anr');
  assert.equal(classifyPreflight('<node package="com.android.permissioncontroller"/>','',activity),'emulator_os_blocked');
  assert.equal(classifyPreflight('<node package="com.android.systemui" resource-id="com.android.systemui:id/keyguard_status_view"/>','',activity),'emulator_os_blocked');
  let tick=0,catCalls=0;const reports=[];
  const query=args=>{if(args[1]==='uiautomator')throw Error(canary);if(args[1]==='cat'){catCalls++;return '<node package="com.android.launcher3"/>';}if(args[1]==='getprop')return args[2]==='sys.boot_completed'?'1':'stopped';if(args[1]==='pidof')return '123';if(args[1]==='dumpsys')return 'mCurrentFocus=Window{x u0 com.android.launcher3/.Launcher}';if(args[1]==='wm')return args[2]==='size'?'Physical size: 1280x800':'Physical density: 160';return '';};
  assert.equal(await preflight(query,(...r)=>reports.push(r),async ms=>{tick+=ms;},()=>tick),false);assert.equal(catCalls,0);assert(reports.at(-1)[1].missing.includes('xml'));
});
test('manual platform selection defaults all, isolates concurrency and skips only the unselected diagnostic job', () => {
  const source=fs.readFileSync('.github/workflows/native-smoke.yml','utf8');
  assert(source.includes('default: all'));assert(source.includes('options: [all, android, ios]'));
  assert(source.includes("group: native-smoke-${{ github.ref }}-${{ inputs.platform || 'all' }}"));
  assert(source.includes("if: ${{ inputs.platform == 'all' || inputs.platform == 'android' }}"));assert(source.includes("if: ${{ inputs.platform == 'all' || inputs.platform == 'ios' }}"));
  assert(source.includes('cancel-in-progress: false'));
});

async function mockedPdfSmoke(options={}) {
  const {createRequire}=await import('node:module'),{runInNewContext}=await import('node:vm');const ts=createRequire(import.meta.url)('typescript');
  const code=ts.transpileModule(fs.readFileSync('qa/pdf-smoke.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const events=[],calls=[],budgets=[];let timings=0,clock=0;
  const reject=(stage)=>{calls.push(stage);if(options.fail===stage)throw Error(options.message??canary);};
  const files={cacheDirectory:'file:///private/'+canary+'/',EncodingType:{Base64:'base64'},writeAsStringAsync:async()=>reject('write_source'),deleteAsync:async()=>reject('cleanup')};
  const renderer={
    hasReadingRenderer:()=>options.fail!=='reading_api',
    importFile:async()=>{reject('import');return {uri:'file:///encrypted/'+canary+'.pdfenc'};},
    getInfo:async()=>{reject('info');return {pageCount:options.pages??2,pages:[{width:612,height:792},options.pageSize??{width:612,height:792}]};},
    renderPage:async(...args)=>{reject('render_detail');assert.equal(args[1],0);assert.equal(args[2],2400);if(options.fail==='await_render')return new Promise(()=>{});return 'private-render';},
    renderReading:async(...args)=>{reject('render_reading');assert.equal(args[1],1);assert.equal(args[2],900);if(options.fail==='await_render')return new Promise(()=>{});return 'file:///reading/'+canary;},
    renderRegion:async(...args)=>{reject('region');assert.deepEqual(args.slice(1),[1,2400,300,100,900,600]);clock+=options.regionAdvance??0;return 'file:///region/'+canary;},
    deleteFile:async()=>{calls.push('cleanup_import');if(options.cleanupAlsoFails)throw Error(canary);},
    takeRenderTimings:async()=>{timings++;if(timings%2===1)return [];reject('timings');return options.noTimings?[]:[{lane:'detail',page:0,width:2400,totalMs:100,uri:canary},{lane:'reading',page:1,width:900,totalMs:1,uri:canary}];},
  };
  const context={exports:{},performance:{now:()=>++clock},Date:{now:()=>1},setTimeout:(fn,ms)=>{if(ms!==25)budgets.push(ms);if(ms===25||options.fail==='await_render')queueMicrotask(fn);return 1;},clearTimeout:()=>{},require:name=>name==='react-native'?{Image:{getSize:(uri,success,error)=>{calls.push('image_load');if(options.fail==='image_load'){error(Error(canary));return;}const region=uri.includes('/region/');clock+=options.imageAdvance??0;success(...(region?(options.regionSize??[900,600]):(options.readingSize??[900,1165])));}}}:name==='expo-file-system/legacy'?files:name==='../modules/pdf-renderer'?{PdfRenderer:renderer}:name==='./fixtures/pdf.generated'?{PDF_BASE64:'U1lOVEhFVElD'}:name==='./telemetry'?{marker:(event,values)=>events.push({event,...values})}:(()=>{throw Error('unexpected test import');})()};
  runInNewContext(code,context);
  let summary;
  try{await context.exports.pdfSmoke();}catch(error){summary=context.exports.pdfFailureSummary(error);events.push({event:'pdf_result',result:'fail',...summary});}
  return {events,calls,budgets,summary,api:context.exports};
}
test('PDF diagnostics identify write/import/info/render/await/timings/cleanup failures without native messages', async () => {
  const cases=[['write_source','write_source'],['import','import'],['info','info'],['render_detail','render_detail'],['render_reading','render_reading'],['await_render','await_render'],['region','region'],['image_load','image_load'],['timings','timings'],['cleanup','cleanup']];
  for(const [fail,stage] of cases){
    const result=await mockedPdfSmoke({fail});assert.equal(result.summary.stage,stage);assert.equal(result.summary.trial,1);
    assert.equal(result.summary.reason,fail==='await_render'?'render_timeout':fail==='image_load'?'image_load_failed':'operation_failed');
    assert(result.events.some(r=>r.event==='pdf_stage'&&r.stage===stage&&r.trial===1));
    assert(result.events.some(r=>r.event==='pdf_failure'&&r.stage===stage&&!r.secondary));
    assert(!JSON.stringify(result.events).includes(canary));
    if(['write_source','import','info'].includes(fail))assert(!result.events.some(r=>r.event==='pdf_completion'));
  }
});
test('PDF maps only exact own failures and known keychain categories; unknown status stays private', async () => {
  const entitlement=await mockedPdfSmoke({fail:'import',message:'native crypto: keychain -34018 '+canary});assert.equal(entitlement.summary.reason,'keychain_entitlement');assert.equal(entitlement.summary.stage,'import');
  const locked=await mockedPdfSmoke({fail:'import',message:'keychain (-25308) '+canary});assert.equal(locked.summary.reason,'keychain_locked');
  const unknown=await mockedPdfSmoke({fail:'import',message:'keychain -99999 '+canary});assert.equal(unknown.summary.reason,'operation_failed');
  assert.equal(unknown.api.pdfFailureReason(Error('keychain -340180 '+canary)),'operation_failed');
  assert.equal((await mockedPdfSmoke({pages:1})).summary.reason,'fixture_pages');
  assert.equal((await mockedPdfSmoke({noTimings:true})).summary.reason,'missing_native_timings');
  assert.equal((await mockedPdfSmoke({fail:'reading_api'})).summary.reason,'reading_api_missing');
  const ordered=await mockedPdfSmoke();assert.equal(ordered.summary.reason,'reading_serialized');assert.equal(ordered.summary.trial,3);
  for(const stage of ['write_source','import','info','render_detail','render_reading','await_render','timings','cleanup'])assert(ordered.events.some(r=>r.event==='pdf_stage'&&r.stage===stage));
  assert.equal(ordered.events.filter(r=>r.event==='pdf_completion'&&r.lane==='reading').length,3);
  assert.equal(ordered.events.filter(r=>r.event==='pdf_completion'&&r.lane==='detail').length,3);
});
test('PDF cleanup cannot replace the original failing stage and root preserves only safe summary', async () => {
  const result=await mockedPdfSmoke({fail:'info',cleanupAlsoFails:true,message:'keychain -34018 '+canary});
  assert.equal(result.summary.stage,'info');assert.equal(result.summary.reason,'keychain_entitlement');
  assert(result.events.some(r=>r.event==='pdf_failure'&&r.stage==='cleanup'&&r.secondary===true));
  assert(result.events.some(r=>r.event==='pdf_failure'&&r.stage==='info'&&r.secondary===false));
  assert(!JSON.stringify(result.events).includes(canary));
  const root=fs.readFileSync('qa/entry.tsx','utf8');assert(root.includes("catch (error) { marker('pdf_result', { result: 'fail', ...pdfFailureSummary(error) })"));
});
test('PDF sanitizer validates fixed stage/trial/reason fields and strips private payloads/status numbers', async () => {
  const result=await mockedPdfSmoke({fail:'import',message:'keychain -34018 '+canary});
  const rows=[...result.events,{event:'pdf_stage',stage:canary,trial:4},{event:'pdf_failure',stage:'import',trial:1,reason:canary,message:canary,status:-99999},{event:'pdf_failure',stage:'import',trial:1,reason:'keychain_entitlement',message:canary,uri:canary,status:-34018},{event:'suite_result',result:'pass',platform:'android'}];
  const output=sanitize(rows.map(r=>'QA_JSON '+JSON.stringify(r)).join('\n'),'pdf-stage-private');
  assert.equal(output.status,1);assert(output.output.includes('keychain_entitlement'));assert(output.output.includes('"stage":"import"'));
  assert(!output.output.includes(canary));assert(!output.output.includes('-34018'));assert(!output.output.includes('-99999'));
  assert(!output.output.includes('"trial":4'));assert(!output.output.includes('"message"'));assert(!output.output.includes('"uri"'));
});

test('PDF native region and both decoded rasters are checked on all three trials using actual page aspect', async () => {
  const result=await mockedPdfSmoke();
  assert.equal(result.calls.filter(c=>c==='region').length,3);assert.equal(result.calls.filter(c=>c==='image_load').length,6);
  const rasters=result.events.filter(r=>r.event==='pdf_raster');assert.equal(rasters.length,6);
  for(const raster of rasters){assert.equal(raster.status,1);assert.equal(raster.width,900);for(const [key,value] of Object.entries(raster))if(key!=='event')assert.equal(typeof value,'number');}
  const reading=rasters.find(r=>r.raster===0),region=rasters.find(r=>r.raster===1);
  assert.equal(reading.height,1165);assert(Math.abs(reading.expectedHeight-900*792/612)<0.000001);assert.equal(reading.tolerancePx,1);
  assert.equal(region.height,600);assert.equal(region.expectedHeight,600);assert.equal(region.tolerancePx,0);
  assert.equal((await mockedPdfSmoke({readingSize:[900,1164]})).summary.reason,'reading_serialized'); // Floor/round both within 1px.
  assert.equal((await mockedPdfSmoke({readingSize:[900,1200]})).summary.reason,'raster_dimensions'); // Not a 600x800 page.
  assert.equal((await mockedPdfSmoke({pageSize:{width:600,height:800},readingSize:[900,1200]})).summary.reason,'reading_serialized'); // Metadata drives expectation.
  assert(!JSON.stringify(result.events).includes(canary));
});
test('PDF region/decode failures or wrong dimensions cannot pass and never expose URI/messages', async () => {
  for(const options of [{regionSize:[901,600]},{regionSize:[900,601]},{readingSize:[900,NaN]}]) {
    const result=await mockedPdfSmoke(options);assert.equal(result.summary.stage,'image_load');assert.equal(result.summary.reason,'raster_dimensions');assert(result.events.some(r=>r.event==='pdf_raster'&&r.status===0));assert(!JSON.stringify(result.events).includes(canary));
  }
  const region=await mockedPdfSmoke({fail:'region'});assert.equal(region.summary.stage,'region');assert.equal(region.summary.reason,'operation_failed');assert(!region.calls.includes('image_load'));
  const load=await mockedPdfSmoke({fail:'image_load'});assert.equal(load.summary.reason,'image_load_failed');assert(load.events.some(r=>r.event==='pdf_raster'&&r.status===0));
  const metadata=await mockedPdfSmoke({pageSize:{width:0,height:792}});assert.equal(metadata.summary.stage,'info');assert.equal(metadata.summary.reason,'fixture_dimensions');
});
test('PDF parallel render, region and image decoding share one shrinking 90s budget per trial', async () => {
  const result=await mockedPdfSmoke();assert.equal(result.budgets.length,9);
  for(let i=0;i<result.budgets.length;i+=3){const [parallel,region,decode]=result.budgets.slice(i,i+3);assert(parallel<=90000&&region<parallel&&decode<region&&decode>0);}
  const lateRegion=await mockedPdfSmoke({regionAdvance:90000});assert.equal(lateRegion.summary.reason,'render_timeout');assert.equal(lateRegion.summary.stage,'region');assert(!lateRegion.calls.includes('image_load'));
  const lateDecode=await mockedPdfSmoke({imageAdvance:90000});assert.equal(lateDecode.summary.reason,'render_timeout');assert.equal(lateDecode.summary.stage,'image_load');
  assert(lateDecode.budgets.at(-1)<lateDecode.budgets[0]);assert(!JSON.stringify(lateDecode.events).includes(canary));
});
test('PDF raster sanitizer retains only bounded numeric status/dimensions and rejects failed raster as a pass', () => {
  const rows=[{event:'pdf_raster',trial:1,raster:0,status:1,width:900,height:1165,expectedWidth:900,expectedHeight:900*792/612,tolerancePx:1,uri:canary,message:canary},
    {event:'pdf_raster',trial:1,raster:1,status:0,width:900,height:601,expectedWidth:900,expectedHeight:600,tolerancePx:0,uri:canary},
    {event:'pdf_raster',trial:2,raster:1,status:1,width:canary,height:Infinity,expectedWidth:-1,tolerancePx:100001},
    {event:'pdf_raster',trial:4,raster:0,status:1},{event:'pdf_raster',trial:1,raster:canary,status:1},
    {event:'suite_result',platform:'android',result:'pass'}];
  const result=sanitize(rows.map(row=>'QA_JSON '+JSON.stringify(row)).join('\n'),'raster-private');assert.equal(result.status,1);assert(!result.output.includes(canary));assert(!result.output.includes('"uri"'));assert(!result.output.includes('"message"'));assert(!result.output.includes('"trial":4'));
  const parsed=result.output.trim().split('\n').map(JSON.parse).filter(r=>r.event==='pdf_raster');assert.equal(parsed.length,3);assert.equal(parsed[0].height,1165);assert.equal(parsed[2].width,undefined);assert.equal(parsed[2].height,undefined);
});

async function bootAnimationModeScenario(options={}) {
  const {preflight}=await import('../scripts/native-android-preflight.mjs');let tick=0,probe=0;const reports=[],commands=[];
  const normal='<hierarchy><node package="com.android.launcher3"/></hierarchy>';
  const query=(args,budget)=>{
    commands.push({args,budget});
    if(args[1]==='getprop') {
      if(args[2]==='ro.kernel.qemu'){if(options.qemuThrows)throw Error(canary);return options.qemu??'1';}
      if(args[2]==='sys.boot_completed')return options.boot??'1';
      if(options.animationThrows)throw Error(canary);return options.animation??'';
    }
    if(args[1]==='pidof')return options.pid??'123';
    if(args[1]==='uiautomator'){probe++;if(options.dumpAlwaysFails||options.dumpFailAt===probe)throw Error(canary);return '';}
    if(args[1]==='cat')return options.xml??normal;
    if(args[1]==='dumpsys')return options.focus??'mCurrentFocus=Window{x u0 com.android.launcher3/.Launcher}';
    if(args[1]==='wm')return args[2]==='size'?(options.size??'Physical size: 1280x800'):'Physical density: 160';
    return '';
  };
  const result=await preflight(query,(reason,criteria)=>reports.push({reason,criteria}),async ms=>{tick+=ms;},()=>tick,options.mode);
  return {result,tick,probe,reports,commands};
}
test('empty boot-animation reply is DISABLED only for explicit configured CI-emulator mode',async()=>{
  const {preflightMode}=await import('../scripts/native-android-preflight.mjs');
  const mode=preflightMode({GITHUB_ACTIONS:'true',NATIVE_SMOKE_BOOT_ANIMATION_DISABLED:'1'});
  assert.deepEqual(mode,{githubActions:true,configuredNoBootAnimation:true});
  const accepted=await bootAnimationModeScenario({mode});assert.equal(accepted.result,true);assert.equal(accepted.probe,2);assert.equal(accepted.tick,500);
  assert.equal(accepted.reports.at(-1).criteria.bootAnimationDisabled,true);assert.equal(accepted.reports.at(-1).criteria.bootAnimationStopped,false);
  assert.equal(accepted.commands.filter(c=>c.args[1]==='input').length,1);assert(accepted.commands.some(c=>JSON.stringify(c.args)===JSON.stringify(['shell','input','keyevent','KEYCODE_WAKEUP'])));
  const stopped=await bootAnimationModeScenario({animation:'stopped'});assert.equal(stopped.result,true);assert.equal(stopped.reports.at(-1).criteria.bootAnimationDisabled,false);assert.equal(stopped.reports.at(-1).criteria.bootAnimationStopped,true);assert(!stopped.commands.some(c=>c.args[1]==='input'));
  assert.deepEqual(preflightMode({GITHUB_ACTIONS:'1',NATIVE_SMOKE_BOOT_ANIMATION_DISABLED:'true',private:canary}),{githubActions:false,configuredNoBootAnimation:false});
});
test('default/unconfigured/non-CI/non-qemu/running/failed properties never turn empty animation into ready',async()=>{
  const enabled={githubActions:true,configuredNoBootAnimation:true};
  const cases=[{}, {mode:{}}, {mode:{githubActions:true}}, {mode:{configuredNoBootAnimation:true}}, {mode:{githubActions:'true',configuredNoBootAnimation:true}}, {mode:enabled,qemu:'0'}, {mode:enabled,qemu:''}, {mode:enabled,qemuThrows:true}, {mode:enabled,animation:'running'}, {mode:enabled,animation:'other'}, {mode:enabled,animationThrows:true}];
  for(const options of cases){const result=await bootAnimationModeScenario(options);assert.equal(result.result,false);assert.equal(result.tick,60000);const last=result.reports.at(-1);assert.equal(last.reason,'emulator_os_not_ready');assert.equal(last.criteria.bootAnimationDisabled,false);assert(last.criteria.missing.includes('bootanim'));if(options.mode?.githubActions!==true||options.qemu==='0'||options.qemu===''||options.qemuThrows)assert(!result.commands.some(c=>c.args[1]==='input'));assert(!JSON.stringify(result.reports).includes(canary));}
});
test('disabled-animation mode keeps two fresh XML observations and cannot mask ANR/dialog/boot/PID/focus/display failure',async()=>{
  const mode={githubActions:true,configuredNoBootAnimation:true};
  const recovered=await bootAnimationModeScenario({mode,dumpFailAt:2});assert.equal(recovered.result,true);assert.equal(recovered.probe,4); // Fresh1, failed2 resets, then fresh3+4.
  assert.equal(recovered.commands.filter(c=>c.args[1]==='rm').length,4);assert.equal(recovered.commands.filter(c=>c.args[1]==='cat').length,3);
  const stale=await bootAnimationModeScenario({mode,dumpAlwaysFails:true});assert.equal(stale.result,false);assert(!stale.commands.some(c=>c.args[1]==='cat'));assert(stale.reports.at(-1).criteria.missing.includes('xml'));
  for(const [xml,reason] of [
    ['<node package="android" resource-id="android:id/aerr_wait"/><node package="android" text="System UI isn’t responding"/>','emulator_system_ui_anr'],
    ['<node package="android" resource-id="android:id/aerr_wait"/>','emulator_app_anr'],
    ['<node package="com.android.permissioncontroller"/>','emulator_os_blocked'],
    ['<node package="com.android.systemui" resource-id="com.android.systemui:id/keyguard_status_view"/>','emulator_os_blocked'],
  ]){const r=await bootAnimationModeScenario({mode,xml});assert.equal(r.result,false);assert.equal(r.probe,1);assert.equal(r.reports[0].reason,reason);assert.equal(r.tick,0);}
  for(const options of [{boot:'0'},{pid:''},{focus:'mCurrentFocus=null'},{xml:'<hierarchy></hierarchy>'}]){const r=await bootAnimationModeScenario({mode,...options});assert.equal(r.result,false);assert.equal(r.tick,60000);}
  const display=await bootAnimationModeScenario({mode,size:'Physical size: 1280x800\nOverride size: 1600x2560'});assert.equal(display.result,false);assert.equal(display.reports[0].reason,'emulator_display_mismatch');
});
test('bootAnimationDisabled sanitizer is boolean-only and workflow flag is scoped to actual no-boot-anim launch',()=>{
  const rows=[{event:'emulator_preflight',phase:'before_install',result:'pass',reason:'ready',bootAnimationDisabled:true,property:canary},
    {event:'emulator_readiness',bootAnimationDisabled:false,bootAnimationStopped:false,missing:['bootanim'],private:canary},
    {event:'emulator_preflight',result:'fail',bootAnimationDisabled:canary},
    {event:'emulator_readiness',bootAnimationDisabled:1},
    {event:'suite_result',platform:'android',result:'fail',reason:'emulator_os_not_ready'}];
  const result=sanitize(rows.map(row=>'QA_JSON '+JSON.stringify(row)).join('\n'),'boot-mode-private');assert.equal(result.status,1);assert(!result.output.includes(canary));
  const parsed=result.output.trim().split('\n').map(JSON.parse);assert.equal(parsed.find(r=>r.event==='emulator_preflight').bootAnimationDisabled,true);assert.equal(parsed.find(r=>r.event==='emulator_readiness').bootAnimationDisabled,false);assert(!parsed.some(r=>r.bootAnimationDisabled===1));
  const workflow=fs.readFileSync('.github/workflows/native-smoke.yml','utf8');const block=workflow.match(/      - name: Real Android emulator UI smoke[\s\S]*?(?=      - name: Sanitize Android)/)?.[0];assert(block);
  assert(block.includes("NATIVE_SMOKE_BOOT_ANIMATION_DISABLED: '1'"));assert(block.includes('-no-boot-anim'));assert.equal(workflow.match(/NATIVE_SMOKE_BOOT_ANIMATION_DISABLED:/g)?.length,1);assert(!workflow.slice(workflow.indexOf('  ios:')).includes('NATIVE_SMOKE_BOOT_ANIMATION_DISABLED'));
  const preflight=fs.readFileSync('scripts/native-android-preflight.mjs','utf8');assert(preflight.includes('now()+60000'));assert(!/KEYCODE_(?:MENU|POWER)|dismiss-keyguard|wm dismiss|\['shell','root'\]/.test(preflight));
});


test('temporal PID reuse cannot retroactively turn unrelated Java/native history into an app crash', () => {
  const unrelated = [line(321,'FATAL EXCEPTION: main'),line(321,'Process: com.android.unrelated, PID: 321'),line(321,'java.lang.RuntimeException: '+canary),line(999,'>>> com.android.unrelated <<<','DEBUG'),line(999,'signal 11 (SIGSEGV)','DEBUG'),line(999,'#00 pc 1234 /private/libart.so','DEBUG'),line(321,'Process: com.paperly.study, PID: 321')].join('\n');
  const report=extractCrashDiagnostics(unrelated,{platform:'android',pids:['321']});
  assert.equal(report.crash,false);assert.equal(report.evidence?.attribution ?? 'none','none');assert.deepEqual(report.diagnostics,[]);
  const result=sanitize(unrelated+'\n' + androidPassLog,'temporal');assert.equal(result.status,0);assert(!result.output.includes('crash_native_frame'));
});
test('independent named main, worker and explicit WebView lifetimes preserve genuine fatal gates',()=>{
  for(const name of ['com.paperly.study','com.paperly.study:pdfdetail']) {
    const raw=[line(321,'FATAL EXCEPTION: main'),line(321,'Process: '+name+', PID: 321'),line(321,'java.lang.RuntimeException: '+canary)].join('\n');
    assert.equal(extractCrashDiagnostics(raw,{platform:'android'}).crash,true);
  }
  const start=line(1,'Start proc 555:com.google.android.webview:sandboxed_process0/u0i1 for {com.paperly.study/org.chromium.Service}','ActivityManager');
  assert.equal(extractCrashDiagnostics(start+'\n'+line(555,'Fatal signal 11 (SIGSEGV)','libc'),{platform:'android'}).crash,true);
  const reuse=line(1,'Start proc 555:com.android.unrelated/u0a1 for activity','ActivityManager');
  assert.equal(extractCrashDiagnostics(start+'\n'+reuse+'\n'+line(555,'Fatal signal 11 (SIGSEGV)','libc'),{platform:'android'}).crash,false);
});
test('multiple tombstones sharing a reporter never share ownership or native frames',()=>{
  const raw=[line(999,'>>> com.paperly.study:pdfdetail <<<','DEBUG'),line(999,'signal 11 (SIGSEGV)','DEBUG'),line(999,'#00 pc 1111 /private/libpdf.so','DEBUG'),line(999,'*** *** *** ***','DEBUG'),line(999,'pid: 123, tid: 123, name: unrelated','DEBUG'),line(999,'>>> com.android.unrelated <<<','DEBUG'),line(999,'signal 6 (SIGABRT)','DEBUG'),line(999,'#00 pc 2222 /private/libunrelated.so','DEBUG')].join('\n');
  const report=extractCrashDiagnostics(raw,{platform:'android',pids:['999']});assert.equal(report.crash,true);
  assert(report.diagnostics.some(r=>r.nativeLibrary==='libpdf.so'));assert(!report.diagnostics.some(r=>r.nativeLibrary==='libunrelated.so'));
});
test('fresh XML removes old file and cannot read or advance after failed recreation',async()=>{
  const {runInNewContext}=await import('node:vm');const source=fs.readFileSync('scripts/native-android-smoke.mjs','utf8');const body=source.match(/function freshXML\(\) \{[\s\S]*?\n\}/)[0];
  for(const failure of ['rm','uiautomator','test','invalid',null]){
    const calls=[];const context={nodesReadAt:100,lastXMLState:'fresh',lastUINodes:[{}],lastTelemetry:[{}],telemetrySource:'fresh',Error,adb:(...args)=>{calls.push(args[1]);if(args[1]===failure)throw Error(canary);return args[1]==='cat'?(failure==='invalid'?'<hierarchy/>':'<hierarchy><node text="qa-ready-1" /></hierarchy>'):'';}};
    const read=runInNewContext(body+'\nfreshXML;',context);
    if(failure)assert.throws(read);else assert(read().includes('qa-ready-1'));
    assert.equal(calls[0],'rm');if(['rm','uiautomator','test'].includes(failure))assert(!calls.includes('cat'));
    assert.equal(context.nodesReadAt,0);assert.equal(context.lastXMLState,'cached');assert.equal(context.telemetrySource,'cached');
  }
});
test('exact trigger record is immutable and later snapshot cannot replace trigger diagnostics',async()=>{
  const {runInNewContext}=await import('node:vm');const source=fs.readFileSync('scripts/native-android-smoke.mjs','utf8');
  const failBody=source.match(/function fail\(reason, report = logRecord\?\.report\) \{[\s\S]*?\n\}/)[0];
  const crashBody=source.match(/function crashLogs\(force = false\) \{[\s\S]*?\n\}/)[0];
  let n=0;const first=javaCrash;const second=line(777,'Process: com.paperly.study, PID: 777')+'\n'+line(777,'TypeError: '+canary,'ReactNativeJS');
  const context={logRecord:null,trigger:null,logSequence:0,lastLogcat:'',knownPids:new Set(),Object,Math,Error,extractCrashDiagnostics,adb:()=>++n===1?first:second};
  const run=runInNewContext(crashBody+'\n'+failBody+'\n({crashLogs,fail});',context);
  run.crashLogs();run.fail('native_or_js_error');const trigger=context.trigger;run.crashLogs();run.fail('process_crash');
  assert.equal(context.trigger,trigger);assert.equal(trigger.record.text,first);assert.equal(trigger.record.record,1);assert.equal(context.logRecord.record,2);assert(Object.isFrozen(trigger.report));assert(Object.isFrozen(trigger.report.diagnostics));
  const result=sanitize('QA_JSON {"event":"driver_evidence","origin":"trigger","category":"java","attribution":"explicit","crash":true}\nQA_JSON {"event":"suite_result","result":"fail","reason":"process_crash","platform":"android"}\n'+second,'trigger-later');
  assert(!result.output.includes('crash_js_exception'));assert(result.output.includes('process_crash'));assert(result.output.includes('"origin":"collection"'));
});
test('provenance and milestone export is failure-only, strict enums/booleans/bounded numbers',()=>{
  const rows=[{event:'driver_evidence',origin:'trigger',category:'native',role:'worker',attribution:'explicit',cached:false,record:1,name:canary,pid:321,timestamp:canary,message:canary},{event:'driver_milestones',ready:true,pdfPass:false,cycle:20,root:canary,record:10001},{event:'driver_telemetry',xmlSource:'cached',cached:true,uri:canary}];
  const input=rows.map(r=>'QA_JSON '+JSON.stringify(r)).join('\n');const failure=sanitize(input+'\nQA_JSON {"event":"suite_result","result":"fail"}','evidence-private');assert(!failure.output.includes(canary));assert(!failure.output.includes('321'));assert(!failure.output.includes('10001'));assert(failure.output.includes('"xmlSource":"cached"'));assert(failure.output.includes('"ready":true'));
  const success=sanitize(input+'\n' + androidPassLog,'evidence-pass');assert.equal(success.status,0);assert(!success.output.includes('driver_evidence'));assert(!success.output.includes('driver_milestones'));
});

test('actual driver labels post-ready fatal precisely and keeps later JS evidence separate',()=>{
  const dir=fs.mkdtempSync(path.join(work,'post-ready-')),bin=path.join(dir,'bin');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(dir,'trigger'),javaCrash);
  fs.writeFileSync(path.join(bin,'adb'),`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2),dir=process.env.QA_POST_DIR;
const count=name=>{const f=path.join(dir,name),n=(fs.existsSync(f)?Number(fs.readFileSync(f)):0)+1;fs.writeFileSync(f,String(n));return n;};
if(a[1]==='pidof')console.log('777');
if(a[0]==='logcat'&&a[1]==='-d'){const n=count('logs');if(n===6)console.log(fs.readFileSync(path.join(dir,'trigger'),'utf8'));if(n>6)console.log('11-01 10:00:00.000 777 900 E AndroidRuntime: Process: com.paperly.study, PID: 777\n11-01 10:00:00.001 777 900 E ReactNativeJS: TypeError: private');}
if(a[1]==='uiautomator'){const n=count('dumps');if(n>4)process.exit(1);}
if(a[1]==='cat'){const n=Number(fs.readFileSync(path.join(dir,'dumps'))),labels=n===1?['open-review-videos','run-pdf-smoke']:n===2?['open-review-videos','qa-pdf-pass']:n===3?['QA Video 1 재생']:['qa-ready-1'];console.log('<hierarchy>'+labels.map(text=>'<node text="'+text+'" bounds="[0,0][10,10]" />').join('')+'</hierarchy>');}
`,{mode:0o755});
  // Escape newlines inside the generated JS string literal.
  const executable=path.join(bin,'adb');fs.writeFileSync(executable,fs.readFileSync(executable,'utf8').replace('PID: 777\n11-01','PID: 777\\n11-01'));
  const result=spawnSync(process.execPath,['scripts/native-android-smoke.mjs'],{encoding:'utf8',timeout:20000,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,QA_POST_DIR:dir}});
  assert.equal(result.status,1);assert(result.stdout.includes('"step":"ready_controls"'),result.stdout);assert(result.stdout.includes('"pdfPass":true'));assert(result.stdout.includes('"ready":true'));
  const rows=result.stdout.split('\n').filter(s=>s.startsWith('QA_JSON ')).map(s=>JSON.parse(s.slice(8)));
  assert.equal(rows.find(r=>r.event==='driver_evidence'&&r.origin==='trigger').category,'java');assert.equal(rows.find(r=>r.event==='driver_evidence'&&r.origin==='collection').category,'javascript');const late=rows.filter(r=>r.event==='crash_js_exception');assert(late.length>0);assert(late.every(r=>r.origin==='collection'));assert(!rows.some(r=>r.event==='crash_js_exception'&&r.origin==='trigger'));assert.equal(rows.find(r=>r.event==='driver_evidence'&&r.origin==='trigger').category,'java');
  assert(!result.stdout.includes(canary));assert.equal(sanitize(result.stdout,'post-ready').status,1);
});


test('an earlier app lifetime cannot own a later explicitly unrelated Java fatal on the reused PID',()=>{
 const raw=[line(321,'Process: com.paperly.study, PID: 321'),line(321,'FATAL EXCEPTION: main'),line(321,'Process: com.android.unrelated, PID: 321'),line(321,'java.lang.RuntimeException: '+canary)].join('\n');
 assert.equal(extractCrashDiagnostics(raw,{platform:'android',pids:['321']}).crash,false);
});


test('unowned current-PID fatal remains uncertain and the driver never silently waives it',()=>{
 const report=extractCrashDiagnostics(line(777,'Fatal signal 11 (SIGSEGV)','libc'),{platform:'android',pids:['777']});
 assert.equal(report.crash,false);assert.equal(report.evidence.attribution,'uncertain');assert.equal(report.evidence.category,'uncertain');
 const source=fs.readFileSync('scripts/native-android-smoke.mjs','utf8');assert(source.includes("throw fail('native_evidence_uncertain', report)"));
 const result=sanitize('QA_JSON {"event":"suite_result","result":"fail","reason":"native_evidence_uncertain","platform":"android"}','uncertain');assert.equal(result.status,1);assert(result.output.includes('native_evidence_uncertain'));
});

test('uncertain candidate category/signal is not ownership or a proven crash',()=>{
 const r=extractCrashDiagnostics('01-01 00:00:01.000 42 42 F libc: Fatal signal 6 (SIGABRT) private-canary',{platform:'android',pids:['42']});
 assert.equal(r.crash,false);assert.equal(r.evidence.attribution,'uncertain');assert.equal(r.evidence.candidateCategory,'native');assert.equal(r.evidence.candidateSignal,6);assert(!JSON.stringify(r).includes('private-canary'));
});

test('candidate metadata remains strict and cannot disclose unknown signal/message',async()=>{const {sanitizeEvidence}=await import('../scripts/native-diagnostics.mjs');const r=sanitizeEvidence({event:'driver_evidence',candidateCategory:'native',candidateSignal:6,nativeCause:'jni',message:'private-canary'});assert.equal(r.candidateCategory,'native');assert.equal(r.candidateSignal,6);assert.equal(r.nativeCause,'jni');assert(!JSON.stringify(r).includes('private-canary'));const u=sanitizeEvidence({event:'driver_evidence',candidateCategory:'private-canary',candidateSignal:12345,nativeCause:'private-canary'});assert(!JSON.stringify(u).includes('private-canary'));assert(!('candidateSignal'in u));});

test('post-trigger frame provenance is bounded and cannot replace trigger evidence',async()=>{const {sanitizeDiagnostic}=await import('../scripts/native-diagnostics.mjs');const f=sanitizeDiagnostic({event:'crash_native_frame',nativeLibrary:'libhermes.so',nativePc:'0x123',origin:'collection',record:11,message:'private-canary'});assert.equal(f.origin,'collection');assert.equal(f.record,11);assert(!JSON.stringify(f).includes('private-canary'));const u=sanitizeDiagnostic({...f,origin:'private-canary',record:123456});assert(!('origin'in u));assert(!('record'in u));});

test('APK embedded library frames preserve only basename and PC',()=>{const r=extractCrashDiagnostics('11-01 10:00:00.001 900 900 F DEBUG: Cmdline: com.paperly.study\n11-01 10:00:00.002 900 900 F DEBUG: signal 11 (SIGSEGV)\n11-01 10:00:00.003 900 900 F DEBUG: #00 pc 00000123 /data/private-canary/base.apk!libhermes.so (private-canary)\n11-01 10:00:00.004 900 900 F DEBUG: #01 pc 00000456 /data/private-canary/base.apk!lib/x86_64/libreactnative.so (private-canary)',{platform:'android'});assert.equal(r.crash,true);assert.deepEqual(r.diagnostics.map(x=>x.nativeLibrary),['libhermes.so','libreactnative.so']);assert(!JSON.stringify(r).includes('private-canary'));});

test('native component/operation is an enum, never a full symbol or arbitrary name',()=>{const r=extractCrashDiagnostics('11-01 10:00:00.001 900 900 F DEBUG: Cmdline: com.paperly.study\n11-01 10:00:00.002 900 900 F DEBUG: signal 11 (SIGSEGV)\n11-01 10:00:00.003 900 900 F DEBUG: #00 pc 123 /private-canary/base.apk!libappmodules.so (void facebook::react::RawPropsParser::prepare<RNCWebViewProps>()+10)',{platform:'android'});assert.equal(r.diagnostics[0].nativeComponent,'webview');assert.equal(r.diagnostics[0].nativeOperation,'props_parse');assert(!JSON.stringify(r).includes('private-canary'));assert(!JSON.stringify(r).includes('prepare'));});

test('private logcat can supply public QA error codes without raw content escaping',()=>{const result=sanitize('11-12 03:00:00.000 42 42 I ReactNativeJS: QA_JSON '+JSON.stringify({event:'player_unavailable',cycle:1,errorCode:'process',message:canary})+'\nprivate-log-'+canary,'private-logcat');assert.equal(result.status,1);assert(result.output.includes('"errorCode":"process"'));assert(!result.output.includes(canary));const wrapper=fs.readFileSync('scripts/native-android-ci.sh','utf8');assert(wrapper.includes('adb logcat -d -v threadtime -t 8000 >> qa/build/android.raw'));assert(!wrapper.includes('cat qa/build/android.raw'));const entry=fs.readFileSync('qa/entry.tsx','utf8');assert(entry.includes('qa-errorcode-'));assert(entry.includes('playerErrorCode'));});
