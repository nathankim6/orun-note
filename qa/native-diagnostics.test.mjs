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
  const result = spawnSync(process.execPath, ['scripts/native-android-smoke.mjs'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, QA_TEST_LOG: raw } });
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
  const result = spawnSync(process.execPath, ['scripts/native-android-smoke.mjs'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, QA_RACE_DIR: dir, QA_RACE_MODE: mode } });
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
  assert(!result.commands.some(a => a[1] === 'uiautomator'));
  // Initial readiness, first health check, then failure-only collect. No PID retry loop after readiness.
  assert.equal(result.commands.filter(a => a[1] === 'pidof').length, 3);
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
