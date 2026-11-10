import fs from 'node:fs';
const [input, output, platform] = process.argv.slice(2);
const text = fs.existsSync(input) ? fs.readFileSync(input, 'utf8') : '';
const events = new Set(['boot', 'js_error', 'list_open', 'list_close', 'player_ready', 'player_playing', 'player_paused', 'player_unavailable', 'pdf_completion', 'pdf_timing', 'pdf_result', 'cycle_complete', 'suite_result']);
const strings = new Set(['android', 'ios', 'pass', 'fail', 'inconclusive', 'detail', 'reading', 'tile', 'unknown', 'process_crash', 'native_or_js_error', 'js_error', 'network_or_player_unavailable', 'network_or_player_timeout', 'ui_timeout', 'pdf_failure', 'pdf_inconclusive', 'pdf_timeout', 'suite_deadline', 'invalid_bounds', 'driver_failure']);
const numeric = new Set(['cycle', 'trial', 'elapsedMs', 'requestMs', 'page', 'width', 'openMs', 'drawMs', 'encodeMs', 'writeMs', 'totalMs', 'cycles', 'playbackCycles', 'trials']);
const rows = [];
for (const line of text.split('\n')) {
  const at = line.indexOf('QA_JSON '); if (at < 0) continue;
  try {
    const row = JSON.parse(line.slice(at + 8)); if (!events.has(row.event)) continue;
    const clean = { event: row.event };
    for (const [k,v] of Object.entries(row)) {
      if (numeric.has(k) && typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
      if (['platform', 'lane', 'result', 'reason'].includes(k) && strings.has(v)) clean[k] = v;
      if (k === 'fatal' && typeof v === 'boolean') clean[k] = v;
    }
    rows.push(clean);
  } catch { /* Discard non-JSON and all arbitrary strings. */ }
}
const crash = /FATAL EXCEPTION|Fatal signal \d|EXC_BAD_ACCESS|EXC_CRASH|Terminating app due to uncaught exception|libc\+\+abi:.*terminating|JavascriptException|Unhandled JS Exception|ReactNativeJS.*(?:TypeError|ReferenceError|SyntaxError|Error:)/i.test(text);
if (crash) rows.push({ event: 'suite_result', platform, result: 'fail', reason: 'native_or_js_error' });
const passed = rows.some(r => r.event === 'suite_result' && r.result === 'pass') && !crash && !rows.some(r => r.event === 'js_error' || r.event === 'player_unavailable' || (r.event === 'suite_result' && r.result === 'fail'));
if (!passed) rows.push({ event: 'suite_result', platform, result: 'fail', reason: 'driver_failure' });
fs.mkdirSync(output.substring(0, output.lastIndexOf('/')), { recursive: true });
fs.writeFileSync(output, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
if (!passed) process.exitCode = 1;
