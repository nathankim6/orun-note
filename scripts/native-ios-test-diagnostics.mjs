/** Bounded public diagnostics for xcodebuild/UI-test driver output. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IOS_TEST_STAGES = Object.freeze(['launch_probe', 'xctest']);
export const IOS_TEST_REASONS = Object.freeze([
  'missing_scheme', 'missing_destination', 'invalid_option', 'compile_failure', 'link_failure',
  'runner_launch_failure', 'target_launch_failure', 'signing_failure', 'simulator_failure',
  'assertion_failure', 'unknown',
]);
const STAGES = new Set(IOS_TEST_STAGES), REASONS = new Set(IOS_TEST_REASONS), MAX_TEXT = 1024 * 1024, MAX_TESTS = 100000;
const ERROR_CODES = Object.freeze({
  NSPOSIXErrorDomain: new Set([3, 13, 60, 61, 111]), CoreSimulatorErrorDomain: new Set([4, 405]),
  DTXMessageErrorDomain: new Set([1]), IDETestOperationsObserverErrorDomain: new Set([4]), XCTestErrorDomain: new Set([1]),
});
function safeText(value) { return typeof value === 'string' ? value.slice(-MAX_TEXT) : ''; }
function safeStage(value) { return STAGES.has(value) ? value : 'xctest'; }
function safeExitCode(value) { return Number.isInteger(value) && value >= 0 && value <= 255 ? value : undefined; }
function allowedNSError(domain, code) { return typeof domain === 'string' && Number.isInteger(code) && ERROR_CODES[domain]?.has(code); }
// Only fixed Apple domains plus bounded numeric codes. No NSError descriptions, paths or URLs.
const CHAIN_DOMAINS = new Set(['NSPOSIXErrorDomain', 'CoreSimulatorErrorDomain', 'DTXMessageErrorDomain', 'IDETestOperationsObserverErrorDomain', 'XCTestErrorDomain', 'FBSOpenApplicationServiceErrorDomain', 'FBSOpenApplicationErrorDomain', 'FBProcessExit', 'RBSRequestErrorDomain', 'RBSServiceErrorDomain', 'NSOSStatusErrorDomain', 'NSCocoaErrorDomain', 'NSMachErrorDomain', 'NSLaunchdErrorDomain']);
export function isPublicErrorDomain(domain) { return CHAIN_DOMAINS.has(domain); }
export function sanitizeErrorChain(input) {
  if (!Array.isArray(input)) return [];
  const output = [], seen = new Set();
  for (const row of input.slice(0, 64)) {
    if (!row || !CHAIN_DOMAINS.has(row.domain) || !Number.isInteger(row.code) || Math.abs(row.code) > 65535) continue;
    const key = row.domain + ':' + row.code;
    if (!seen.has(key)) { output.push({ domain: row.domain, code: row.code }); seen.add(key); }
    if (output.length === 8) break;
  }
  return output;
}
export function extractErrorChain(text) {
  const rows = [];
  for (const match of safeText(text).matchAll(/(?:domain\s*=\s*|error\s+domain\s+)([A-Za-z][A-Za-z0-9]{0,63})\s*(?:,?\s*code\s*=\s*|\s+code\s+)(-?\d{1,6})\b/gi)) {
    rows.push({ domain: match[1], code: Number(match[2]) });
    if (rows.length === 64) break;
  }
  return sanitizeErrorChain(rows);
}
function has(text, pattern) { return pattern.test(text); }

export function classifyReason(text) {
  const value = safeText(text);
  if (/failed to (?:launch|activate) (?:the )?(?:application|target app|com\.paperly\.study)\b/i.test(value)) return 'target_launch_failure';
  if (/failed to (?:establish communication with|launch) (?:the )?(?:test runner|xctest runner)|test runner never began/i.test(value)) return 'runner_launch_failure';
  if (has(value, /\bxcodebuild\b[^\n]{0,160}\b(?:invalid|unrecognized|unknown) option\b|\b(?:invalid|unrecognized|unknown) option\b[^\n]{0,160}\bxcodebuild\b/i)) return 'invalid_option';
  if (has(value, /scheme[^\n]{0,120}(?:not found|does not exist|does not contain a scheme|is not currently configured)|unable to find (?:a )?scheme/i)) return 'missing_scheme';
  if (has(value, /(?:unable to find|no matching|failed to find)[^\n]{0,120}destination|destination[^\n]{0,120}(?:not found|not available|is invalid)/i)) return 'missing_destination';
  if (has(value, /\b(?:code ?sign|provisioning profile|signing certificate|development team|errsecinternalcomponent)\b[^\n]{0,160}\b(?:error|failed|failure|required|requires|not found|does not|doesn't|invalid|missing)\b|\b(?:error|failed|failure)\b[^\n]{0,160}\b(?:code ?sign|provisioning profile|signing certificate|development team|errsecinternalcomponent)\b/i)) return 'signing_failure';
  // A linker warning is not a link failure; xcodebuild can continue into a failing XCTest.
  const linkErrors = value.split('\n').filter(line => !/^\s*ld:\s*warning:/i.test(line)).join('\n');
  if (has(linkErrors, /\b(?:linker command failed|undefined symbols for architecture|framework not found)\b|^\s*ld:\s*(?:error:|library not found|symbol\(s\) not found)/im)) return 'link_failure';
  if (has(value, /\b(?:compilec|swiftcompile|swiftc|clang)\b[^\n]{0,160}\berror:|\bcompile failed\b/i)) return 'compile_failure';
  if (has(value, /\b(?:coresimulator|simctl|simulator)\b[^\n]{0,160}\b(?:unavailable|failed|not booted|cannot boot|shutdown|service)\b|unable to boot (?:the )?simulator/i)) return 'simulator_failure';
  if (has(value, /\b(?:test runner|xctest runner|runner)\b[^\n]{0,160}\b(?:failed to launch|could not launch|terminated|crashed)\b/i)) return 'runner_launch_failure';
  if (has(value, /\b(?:application|target app|tested application)\b[^\n]{0,160}\b(?:failed to launch|could not launch|terminated|crashed)\b/i)) return 'target_launch_failure';
  if (has(value, /\b(?:assertion failed|xctassert\w*|failed \([^)]+\)|test case .* failed)\b/i)) return 'assertion_failure';
  return 'unknown';
}
function testCounts(text) {
  const match = /executed\s+(\d{1,6})\s+tests?(?:,?\s+with\s+(\d{1,6})\s+failures?)?/i.exec(safeText(text));
  if (!match) return {}; const testsRun = Number(match[1]), testsFailed = Number(match[2] || 0);
  return testsRun <= MAX_TESTS && testsFailed <= testsRun ? { testsRun, testsFailed } : {};
}
function knownNSError(text) {
  const match = /(?:domain\s*=\s*|error\s+domain\s+)(NSPOSIXErrorDomain|CoreSimulatorErrorDomain|DTXMessageErrorDomain|IDETestOperationsObserverErrorDomain|XCTestErrorDomain)\s*(?:,?\s*code\s*=\s*|\s+code\s+)(-?\d{1,6})\b/i.exec(safeText(text));
  const errorCode = Number(match?.[2]); return match && allowedNSError(match[1], errorCode) ? { errorDomain: match[1], errorCode } : {};
}
/** Sanitizes any row to the fixed public schema. Never preserves caller strings. */
export function sanitizeIosDriverStatus(row) {
  const input = row && typeof row === 'object' ? row : {};
  const output = { event: 'ios_driver_status', stage: safeStage(input.stage), reason: REASONS.has(input.reason) ? input.reason : 'unknown', appValidated: false };
  const exitCode = safeExitCode(input.exitCode);
  if (exitCode !== undefined) { output.exitCode = exitCode; output.driverFailure = exitCode !== 0; }
  if (Number.isInteger(input.testsRun) && Number.isInteger(input.testsFailed) && input.testsRun >= 0 && input.testsRun <= MAX_TESTS && input.testsFailed >= 0 && input.testsFailed <= input.testsRun) Object.assign(output, { testsRun: input.testsRun, testsFailed: input.testsFailed });
  if (allowedNSError(input.errorDomain, input.errorCode)) Object.assign(output, { errorDomain: input.errorDomain, errorCode: input.errorCode });
  if (input.source === 'xcresult') {
    output.source = 'xcresult';
    if (['observed', 'partial', 'unavailable', 'invalid', 'not_ci'].includes(input.collection)) output.collection = input.collection;
    if (Number.isInteger(input.objectsRead) && input.objectsRead >= 0 && input.objectsRead <= 8) output.objectsRead = input.objectsRead;
    if (typeof input.textClipped === 'boolean') output.textClipped = input.textClipped;
    // Counts only: structured TestAssociatedError objects seen, and those whose domain is not public-allowlisted.
    for (const key of ['associatedErrors', 'unlistedErrorDomains']) if (Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= 64) output[key] = input[key];
  }
  const errorChain = sanitizeErrorChain(input.errorChain);
  if (errorChain.length) output.errorChain = errorChain;
  return output;
}
/** Returns a fixed-schema-safe row. appValidated is deliberately always false. */
export function classifyIosTestDiagnostics({ text, stage, exitCode } = {}) {
  return sanitizeIosDriverStatus({ event: 'ios_driver_status', stage, reason: classifyReason(text), exitCode, ...testCounts(text), ...knownNSError(text), errorChain: extractErrorChain(text) });
}
function cli() {
  const [file, stage, rawExitCode] = process.argv.slice(2); let text = '';
  try { if (typeof file === 'string' && fs.existsSync(file)) text = fs.readFileSync(file, 'utf8'); } catch { /* bounded unknown */ }
  const exitCode = /^\d{1,3}$/.test(rawExitCode || '') ? Number(rawExitCode) : undefined;
  console.log('QA_JSON ' + JSON.stringify(classifyIosTestDiagnostics({ text, stage, exitCode })));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();

// Closed schema for synchronous XCTest issues, independent of app startup/telemetry.
export function sanitizeIosLaunchDiagnostic(input) {
  if (!input || typeof input !== 'object') return undefined;
  if (input.event === 'ios_launch_checkpoint') return ['before_launch', 'after_launch'].includes(input.stage) ? { event: 'ios_launch_checkpoint', stage: input.stage, appValidated: false } : undefined;
  if (input.event !== 'ios_xctest_issue') return undefined;
  const reasons = ['app_not_installed', 'launch_denied', 'launch_timeout', 'automation_connection', 'app_exited', 'launch_failed', 'assertion_failure', 'unknown'];
  const row = { event: 'ios_xctest_issue', appValidated: false, driverFailure: input.isFailure !== false, reason: reasons.includes(input.reason) ? input.reason : 'unknown' };
  if (Number.isInteger(input.issueType) && input.issueType >= 0 && input.issueType <= 5) row.issueType = input.issueType;
  if (Number.isInteger(input.sourceLine) && input.sourceLine > 0 && input.sourceLine <= 100000) row.sourceLine = input.sourceLine;
  if (typeof input.associatedErrorPresent === 'boolean') row.associatedErrorPresent = input.associatedErrorPresent;
  const chain = sanitizeErrorChain(input.errorChain); if (chain.length) row.errorChain = chain;
  return row;
}
