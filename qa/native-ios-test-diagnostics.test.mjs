import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyIosTestDiagnostics, classifyReason, IOS_TEST_REASONS, IOS_TEST_STAGES, sanitizeIosDriverStatus } from '../scripts/native-ios-test-diagnostics.mjs';
const canary = 'PRIVATE_IOS_LOG_TOKEN_PATH_URL_ASSERTION_CANARY';

test('schema uses only fixed public fields and never returns raw log content', () => {
  const row = classifyIosTestDiagnostics({ text: `error: ${canary} /private/${canary} https://example.invalid/${canary}`, stage: canary, exitCode: 70 });
  assert.deepEqual(row, { event: 'ios_driver_status', stage: 'xctest', reason: 'unknown', appValidated: false, exitCode: 70, driverFailure: true });
  const encoded = JSON.stringify(row); for (const secret of [canary, 'private', 'example.invalid', 'assertion', 'path']) assert(!encoded.toLowerCase().includes(secret.toLowerCase()));
  assert.deepEqual(IOS_TEST_STAGES, ['launch_probe', 'xctest']);
  assert.deepEqual(IOS_TEST_REASONS, ['missing_scheme', 'missing_destination', 'invalid_option', 'compile_failure', 'link_failure', 'runner_launch_failure', 'target_launch_failure', 'signing_failure', 'simulator_failure', 'assertion_failure', 'unknown']);
});

test('classifies representative Apple tool failures with a closed reason allowlist', () => {
  const cases = [
    ['xcodebuild: error: The scheme "UITests" does not contain a scheme', 'missing_scheme'],
    ['xcodebuild: error: Unable to find a destination matching the provided destination specifier', 'missing_destination'],
    ['xcodebuild: error: unrecognized option -quiet', 'invalid_option'], ['CompileC /tmp/a.o normal arm64 error: use of undeclared identifier', 'compile_failure'],
    ['ld: framework not found WidgetKit', 'link_failure'], ['CodeSign /tmp/App.app requires a development team', 'signing_failure'],
    ['CoreSimulatorService failed: simulator is not booted', 'simulator_failure'], ['The test runner failed to launch within 30 seconds', 'runner_launch_failure'],
    ['The tested application failed to launch', 'target_launch_failure'], ['XCTAssertEqual failed: (1) is not equal to (2)', 'assertion_failure'],
  ];
  for (const [text, reason] of cases) assert.equal(classifyReason(text), reason);
  assert.equal(classifyReason(canary), 'unknown');
});

test('tail retains late failure after a large compile log and clean signing lines stay unknown', () => {
  assert.equal(classifyReason('CompileC /tmp/App.o\nCodeSign /tmp/App.app\nProvisioning profile "Team Profile"\n** BUILD SUCCEEDED **'), 'unknown');
  assert.equal(classifyReason('x'.repeat(1024 * 1024 + 64) + '\nld: framework not found LateFramework'), 'link_failure');
});

test('known NSError domain and code are emitted only as recognized pairs', () => {
  assert.deepEqual(classifyIosTestDiagnostics({ text: 'Error Domain=CoreSimulatorErrorDomain Code=405', stage: 'launch_probe', exitCode: 1 }), { event: 'ios_driver_status', stage: 'launch_probe', reason: 'unknown', appValidated: false, exitCode: 1, driverFailure: true, errorDomain: 'CoreSimulatorErrorDomain', errorCode: 405 });
  for (const text of [`Error Domain=${canary} Code=405`, 'Error Domain=CoreSimulatorErrorDomain Code=99999', 'Error Domain=NSPOSIXErrorDomain Code=-1']) { const row = classifyIosTestDiagnostics({ text }); assert(!('errorDomain' in row)); assert(!('errorCode' in row)); }
});

test('sanitizer rejects malformed injected rows and forces bounded schema', () => {
  const row = sanitizeIosDriverStatus({ event: canary, stage: canary, reason: canary, appValidated: true, exitCode: 65, driverFailure: false, testsRun: 2, testsFailed: 1, errorDomain: 'CoreSimulatorErrorDomain', errorCode: 405, path: canary, message: canary });
  assert.deepEqual(row, { event: 'ios_driver_status', stage: 'xctest', reason: 'unknown', appValidated: false, exitCode: 65, driverFailure: true, testsRun: 2, testsFailed: 1, errorDomain: 'CoreSimulatorErrorDomain', errorCode: 405 });
  assert.deepEqual(sanitizeIosDriverStatus({ stage: 'xctest', reason: 'invalid_option', exitCode: 999, testsRun: 4, testsFailed: 5, errorDomain: 'CoreSimulatorErrorDomain', errorCode: 999 }), { event: 'ios_driver_status', stage: 'xctest', reason: 'invalid_option', appValidated: false });
});

test('counts are bounded and exit zero is never app validation', () => {
  assert.deepEqual(classifyIosTestDiagnostics({ text: 'Executed 12 tests, with 2 failures', stage: 'xctest', exitCode: 65 }), { event: 'ios_driver_status', stage: 'xctest', reason: 'unknown', appValidated: false, exitCode: 65, driverFailure: true, testsRun: 12, testsFailed: 2 });
  assert(!('testsRun' in classifyIosTestDiagnostics({ text: 'Executed 999999 tests, with 0 failures' })));
  const row = classifyIosTestDiagnostics({ text: '** TEST SUCCEEDED **\nExecuted 1 test, with 0 failures', stage: 'xctest', exitCode: 0 });
  assert.equal(row.driverFailure, false); assert.equal(row.appValidated, false); assert.equal(row.reason, 'unknown');
});

test('CLI emits exactly one bounded QA_JSON-compatible object', () => {
  const file = path.join(os.tmpdir(), `ios-diagnostic-${process.pid}.log`); fs.writeFileSync(file, `The test runner failed to launch ${canary}`);
  try { const result = spawnSync(process.execPath, ['scripts/native-ios-test-diagnostics.mjs', file, 'launch_probe', '65'], { encoding: 'utf8' }); assert.equal(result.status, 0); assert.equal(result.stderr, ''); const lines = result.stdout.trim().split('\n'); assert.equal(lines.length, 1); assert(lines[0].startsWith('QA_JSON ')); const row = JSON.parse(lines[0].slice('QA_JSON '.length)); assert.deepEqual(row, { event: 'ios_driver_status', stage: 'launch_probe', reason: 'runner_launch_failure', appValidated: false, exitCode: 65, driverFailure: true }); assert(!result.stdout.includes(canary)); } finally { fs.rmSync(file, { force: true }); }
});

test('XCTest launch failures before an app marker retain tool direction',()=>{assert.equal(classifyIosTestDiagnostics({text:'Failed to launch com.paperly.study: private-canary',stage:'xctest',exitCode:65}).reason,'target_launch_failure');assert.equal(classifyIosTestDiagnostics({text:'Failed to establish communication with the test runner. private-canary',stage:'xctest',exitCode:65}).reason,'runner_launch_failure');});
