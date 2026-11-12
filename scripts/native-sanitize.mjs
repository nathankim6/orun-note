import fs from 'node:fs';
import { DIAGNOSTIC_EVENTS, sanitizeDiagnostic, sanitizeEvidence, extractCrashDiagnostics } from './native-diagnostics.mjs';
import { sanitizeIosDriverStatus } from './native-ios-test-diagnostics.mjs';
const [input, output, platform] = process.argv.slice(2);
const text = fs.existsSync(input) ? fs.readFileSync(input, 'utf8') : '';
const events = new Set(['boot', 'js_error', 'list_open', 'list_close', 'player_ready', 'player_playing', 'player_progress', 'player_paused', 'player_unavailable', 'pdf_completion', 'pdf_timing', 'pdf_result', 'cycle_complete', 'suite_result', 'driver_failure_step', 'emulator_preflight']);
const strings = new Set(['android', 'ios', 'pass', 'fail', 'inconclusive', 'detail', 'reading', 'tile', 'unknown', 'ready', 'emulator_system_ui_anr', 'emulator_app_anr', 'emulator_app_crash', 'emulator_os_blocked', 'emulator_os_not_ready', 'emulator_display_mismatch', 'emulator_capacity_unsupported', 'emulator_configuration_failed', 'apk_install_failed', 'process_crash', 'startup_timeout', 'app_background', 'not_hittable', 'native_or_js_error', 'native_evidence_uncertain', 'js_error', 'network_or_player_unavailable', 'network_or_player_timeout', 'ui_timeout', 'pdf_failure', 'pdf_inconclusive', 'pdf_timeout', 'suite_deadline', 'invalid_bounds', 'driver_failure']);
const failureSteps = new Set(['startup', 'root', 'list_open', 'wait_list', 'player_open', 'wait_ready', 'ready_controls', 'progress_controls', 'wait_progress', 'play', 'pause', 'player_close', 'list_close', 'pdf']);
const numeric = new Set(['cycle', 'trial', 'elapsedMs', 'requestMs', 'page', 'width', 'openMs', 'drawMs', 'encodeMs', 'writeMs', 'totalMs', 'cycles', 'playbackCycles', 'trials']);
const rows = [], diagnostics = [], surfaces = [], readiness = [], evidenceRows = [], iosDriverStatuses = [], playerContexts = [], playerRequestContexts = [];
function sanitizeSurface(row) {
  const clean = { event: 'driver_surface' };
  const enums = { foreground: ['app','launcher','permission','systemdialog','unknown'], dialog: ['none','gms_crash','app_crash','anr','system_ui_anr','keyguard','debugger','permission','gesture_tutorial','unknown'], xmlSource: ['fresh','cached','unavailable'], uiPackage: ['app','launcher','permission','system','mixed','other','unknown'] };
  for (const [key, values] of Object.entries(enums)) if (values.includes(row[key])) clean[key] = row[key];
  for (const key of ['nodeCount','appNodeCount','qaNodeCount']) if (Number.isInteger(row[key]) && row[key] >= 0 && row[key] <= 10000) clean[key] = row[key];
  const labels = new Set(['root_button','qa_boot','qa_loading','telemetry','list','player','error','pdf','auth_screen','splash']);
  if (Array.isArray(row.uiLabels)) clean.uiLabels = [...new Set(row.uiLabels.filter(value => labels.has(value)))].slice(0, 10);
  return clean;
}
const diagnosticCounts = new Map();
for (const line of text.split('\n')) {
  const at = line.indexOf('QA_JSON '); if (at < 0) continue;
  try {
    const row = JSON.parse(line.slice(at + 8));
    if (row.event === 'player_request_context') {
      if (!['embed', 'player'].includes(row.requestKind)) continue;
      const clean = { event: 'player_request_context', requestKind: row.requestKind };
      for (const key of ['mainFrame','refererPresent','refererAppOriginMatches','originPresent','originAppOriginMatches']) if (typeof row[key] === 'boolean') clean[key] = row[key];
      if (playerRequestContexts.filter(value => value.requestKind === row.requestKind).length < 2) playerRequestContexts.push(clean);
      continue;
    }
    if (row.event === 'player_context') {
      const clean = { event: 'player_context' };
      for (const key of ['topOriginMatches', 'baseOriginMatches', 'frameExists', 'frameOriginMatches', 'frameHasOrigin', 'apiReady', 'secureContext', 'documentReferrerPresent']) if (typeof row[key] === 'boolean') clean[key] = row[key];
      if (['official', 'nocookie', 'other', 'unknown'].includes(row.frameHost)) clean.frameHost = row.frameHost;
      for (const key of ['width', 'height']) if (Number.isInteger(row[key]) && row[key] >= 0 && row[key] <= 10000) clean[key] = row[key];
      if (playerContexts.length < 2) playerContexts.push(clean); continue;
    }
    if (row.event === 'ios_driver_status') { if (iosDriverStatuses.length < 2) iosDriverStatuses.push(sanitizeIosDriverStatus(row)); continue; }
    if (['driver_evidence','driver_milestones','driver_telemetry'].includes(row.event)) { const clean = sanitizeEvidence(row); if (clean && evidenceRows.length < 8) evidenceRows.push(clean); continue; }
    if(row.event==='pdf_raster') {
      if(!Number.isInteger(row.trial)||row.trial<1||row.trial>3||![0,1].includes(row.raster)||![0,1].includes(row.status))continue;
      const clean={event:'pdf_raster',trial:row.trial,raster:row.raster,status:row.status};
      for(const key of ['width','height','expectedWidth','expectedHeight'])if(typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=0&&row[key]<=100000)clean[key]=row[key];
      if([0,1].includes(row.tolerancePx))clean.tolerancePx=row.tolerancePx;
      rows.push(clean);continue;
    }
    if (['pdf_stage','pdf_failure','pdf_result'].includes(row.event)) {
      const validStage=['write_source','import','info','render_detail','render_reading','await_render','region','image_load','timings','cleanup'].includes(row.stage);
      const validTrial=Number.isInteger(row.trial)&&row.trial>=1&&row.trial<=3;
      const validReason=['reading_api_missing','fixture_pages','render_timeout','missing_native_timings','reading_serialized','fixture_dimensions','image_load_failed','raster_dimensions','open_failed', 'page_invalid', 'native_unavailable', 'keychain_failed', 'crypto_failed', 'keychain_entitlement','keychain_locked','operation_failed'].includes(row.reason);
      if(row.event==='pdf_stage'&&(!validStage||!validTrial))continue;
      if(row.event==='pdf_failure'&&(!validStage||!validTrial||!validReason))continue;
      if(row.event==='pdf_result'&&!['pass','fail','inconclusive'].includes(row.result))continue;
      const clean={event:row.event};
      if(validStage)clean.stage=row.stage;if(validTrial)clean.trial=row.trial;if(validReason)clean.reason=row.reason;
      if(row.event==='pdf_failure'&&typeof row.secondary==='boolean')clean.secondary=row.secondary;
      if(row.event==='pdf_result'){clean.result=row.result;if(Number.isInteger(row.trials)&&row.trials>=1&&row.trials<=3)clean.trials=row.trials;}
      rows.push(clean);continue;
    }
    if (row.event === 'emulator_readiness') {
      const clean={event:'emulator_readiness'};
      for(const key of ['bootComplete','bootAnimationStopped','bootAnimationDisabled','systemUiAlive','xmlDumpSucceeded','xmlPresent','focusReady','displayReady'])if(typeof row[key]==='boolean')clean[key]=row[key];
      if(['before_install','before_start'].includes(row.phase))clean.phase=row.phase;
      if(['window','display','activity','none'].includes(row.focusSource))clean.focusSource=row.focusSource;
      if(['app','launcher','blocked','unknown','missing'].includes(row.focusKind))clean.focusKind=row.focusKind;
      if(Array.isArray(row.missing))clean.missing=[...new Set(row.missing.filter(x=>['boot','bootanim','pid','focus','xml','display'].includes(x)))].slice(0,6);
      if(readiness.length<2)readiness.push(clean);continue;
    }
    if (row.event === 'driver_surface') { if (surfaces.length < 2) surfaces.push(sanitizeSurface(row)); continue; }
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
      if (row.event === 'emulator_preflight' && k === 'bootAnimationDisabled' && typeof v === 'boolean') clean.bootAnimationDisabled=v;
      if (row.event === 'emulator_preflight' && k === 'phase' && ['before_install','before_start'].includes(v)) clean.phase = v;
      if (row.event === 'player_progress' && ['timeSeconds','durationSeconds'].includes(k) && typeof v === 'number' && Number.isFinite(v) && v <= 864000 && (k === 'timeSeconds' ? v >= 1 : v > 1)) clean[k] = v;
      if (k === 'fatal' && typeof v === 'boolean') clean[k] = v;
    }
    rows.push(clean);
  } catch { /* Discard non-JSON and all arbitrary strings. */ }
}
// A driver trigger is immutable. Raw later logs remain supplementary evidence,
// not replacement symbols or a different reason for that failure.
const driverTrigger = evidenceRows.find(row => row.event === 'driver_evidence' && row.origin === 'trigger');
const laterReport = extractCrashDiagnostics(text, { platform });
const report = driverTrigger ? { crash: false, diagnostics: [] } : laterReport;
if (driverTrigger && laterReport.crash) evidenceRows.push({ event: 'driver_evidence', origin: 'collection', ...laterReport.evidence });
const crash = laterReport.crash;
if (crash && !driverTrigger) rows.push({ event: 'suite_result', platform, result: 'fail', reason: 'native_or_js_error' });
const iosDriverFailed = iosDriverStatuses.some(row => row.driverFailure === true);
const passed = rows.some(r => r.event === 'suite_result' && r.result === 'pass') && !crash && !iosDriverFailed && !rows.some(r => r.event === 'js_error' || r.event === 'player_unavailable' || r.event === 'pdf_failure' || (r.event === 'pdf_raster' && r.status === 0) || (r.event === 'pdf_result' && r.result !== 'pass') || (r.event === 'suite_result' && r.result === 'fail'));
if (!passed && !rows.some(r => r.event === 'suite_result' && r.result === 'fail')) {
  const reason = rows.some(r => r.event === 'js_error') ? 'js_error' : rows.some(r => r.event === 'player_unavailable') ? 'network_or_player_unavailable' : rows.some(r => r.event === 'pdf_failure' || (r.event === 'pdf_result' && r.result !== 'pass')) ? 'pdf_failure' : 'driver_failure';
  rows.push({ event: 'suite_result', platform, result: 'fail', reason });
}
// Diagnostics are retained only on a failing suite. Each field is validated again
// here even when it came from the driver; arbitrary QA_JSON cannot bypass this.
if (!passed) {
  rows.push(...playerRequestContexts,...playerContexts,...iosDriverStatuses,...surfaces,...readiness,...evidenceRows);
  const seen = new Set();
  const finalCounts = new Map();
  for (const row of [...diagnostics, ...report.diagnostics]) {
    const key = JSON.stringify(row), count = finalCounts.get(row.event) ?? 0;
    const limit = ['crash_java_frame', 'crash_js_frame'].includes(row.event) ? 32 : row.event === 'crash_native_frame' ? 16 : 8;
    if (!seen.has(key) && count < limit) { rows.push(row); seen.add(key); finalCounts.set(row.event, count + 1); }
  }
}
fs.mkdirSync(output.substring(0, output.lastIndexOf('/')), { recursive: true });
fs.writeFileSync(output, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
if (!passed) process.exitCode = 1;
