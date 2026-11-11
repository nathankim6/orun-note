import fs from 'node:fs';
import { DIAGNOSTIC_EVENTS, sanitizeDiagnostic, extractCrashDiagnostics } from './native-diagnostics.mjs';
const [input, output, platform] = process.argv.slice(2);
const text = fs.existsSync(input) ? fs.readFileSync(input, 'utf8') : '';
const events = new Set(['boot', 'js_error', 'list_open', 'list_close', 'player_ready', 'player_playing', 'player_paused', 'player_unavailable', 'pdf_completion', 'pdf_timing', 'pdf_result', 'cycle_complete', 'suite_result', 'driver_failure_step']);
const strings = new Set(['android', 'ios', 'pass', 'fail', 'inconclusive', 'detail', 'reading', 'tile', 'unknown', 'process_crash', 'startup_timeout', 'app_background', 'not_hittable', 'native_or_js_error', 'js_error', 'network_or_player_unavailable', 'network_or_player_timeout', 'ui_timeout', 'pdf_failure', 'pdf_inconclusive', 'pdf_timeout', 'suite_deadline', 'invalid_bounds', 'driver_failure']);
const failureSteps = new Set(['startup', 'root', 'list_open', 'wait_list', 'player_open', 'wait_ready', 'play', 'pause', 'player_close', 'list_close', 'pdf']);
const numeric = new Set(['cycle', 'trial', 'elapsedMs', 'requestMs', 'page', 'width', 'openMs', 'drawMs', 'encodeMs', 'writeMs', 'totalMs', 'cycles', 'playbackCycles', 'trials']);
const rows = [], diagnostics = [];
const diagnosticCounts = new Map();
for (const line of text.split('\n')) {
  const at = line.indexOf('QA_JSON '); if (at < 0) continue;
  try {
    const row = JSON.parse(line.slice(at + 8));
    if (DIAGNOSTIC_EVENTS.has(row.event)) {
      const clean = sanitizeDiagnostic(row), count = diagnosticCounts.get(row.event) ?? 0;
      const limit = ['crash_java_frame', 'crash_js_frame'].includes(row.event) ? 32 : row.event === 'crash_native_frame' ? 16 : 8;
      if (clean && count < limit) { diagnostics.push(clean); diagnosticCounts.set(row.event, count + 1); }
      continue;
    }
    if (!events.has(row.event)) continue;
    const clean = { event: row.event };
    for (const [k,v] of Object.entries(row)) {
      if (numeric.has(k) && typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
      if (['platform', 'lane', 'result', 'reason'].includes(k) && strings.has(v)) clean[k] = v;
      if (row.event === 'driver_failure_step' && k === 'step' && failureSteps.has(v)) clean.step = v;
      if (row.event === 'player_unavailable' && k === 'errorCode' && ((typeof v === 'number' && [2, 5, 100, 101, 150, 152, 153].includes(v)) || (typeof v === 'string' && ['load', 'http', 'process', 'timeout', 'network'].includes(v)))) clean.errorCode = v;
      if (row.event === 'js_error' && k === 'jsException' && ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError', 'InternalError'].includes(v)) clean.jsException = v;
      if (k === 'fatal' && typeof v === 'boolean') clean[k] = v;
    }
    rows.push(clean);
  } catch { /* Discard non-JSON and all arbitrary strings. */ }
}
const report = extractCrashDiagnostics(text, { platform });
const crash = report.crash;
if (crash) rows.push({ event: 'suite_result', platform, result: 'fail', reason: 'native_or_js_error' });
const passed = rows.some(r => r.event === 'suite_result' && r.result === 'pass') && !crash && !rows.some(r => r.event === 'js_error' || r.event === 'player_unavailable' || (r.event === 'suite_result' && r.result === 'fail'));
if (!passed && !rows.some(r => r.event === 'suite_result' && r.result === 'fail')) {
  const reason = rows.some(r => r.event === 'js_error') ? 'js_error' : rows.some(r => r.event === 'player_unavailable') ? 'network_or_player_unavailable' : 'driver_failure';
  rows.push({ event: 'suite_result', platform, result: 'fail', reason });
}
// Diagnostics are retained only on a failing suite. Each field is validated again
// here even when it came from the driver; arbitrary QA_JSON cannot bypass this.
if (!passed) {
  const seen = new Set();
  const finalCounts = new Map();
  for (const row of [...diagnostics, ...report.diagnostics]) {
    const key = JSON.stringify(row), count = finalCounts.get(row.event) ?? 0;
    const limit = row.event === 'crash_java_frame' ? 32 : row.event === 'crash_native_frame' ? 16 : 8;
    if (!seen.has(key) && count < limit) { rows.push(row); seen.add(key); finalCounts.set(row.event, count + 1); }
  }
}
fs.mkdirSync(output.substring(0, output.lastIndexOf('/')), { recursive: true });
fs.writeFileSync(output, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
if (!passed) process.exitCode = 1;
