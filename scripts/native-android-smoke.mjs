import { execFileSync } from 'node:child_process';
import { extractCrashDiagnostics } from './native-diagnostics.mjs';
const pkg = 'com.paperly.study', start = Date.now();
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 18000, maxBuffer: 16 * 1024 * 1024 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const emit = (event, values = {}) => console.log('QA_JSON ' + JSON.stringify({ event, ...values }));
const decode = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
let nodes = [], lastLogcat = '', nodesReadAt = 0, currentStep = 'startup';
const knownPids = new Set();
function crashLogs(force = false) {
  try { lastLogcat = adb('logcat', '-d', '-v', 'threadtime', '-t', '8000'); } catch { /* Preserve last successful read. */ }
  return extractCrashDiagnostics(lastLogcat, { platform: 'android', pids: [...knownPids], force });
}
async function waitForInitialPid() {
  // am start -W is deterministic, but PID visibility can still lag launch return.
  // This grace applies only before the first observed PID, never during health checks.
  const deadline = Date.now() + 15000;
  do {
    let live = '';
    try { live = adb('shell', 'pidof', pkg).trim(); } catch { /* Not yet observable, or a true startup crash. */ }
    for (const pid of live.split(/\s+/).filter(Boolean)) knownPids.add(pid);
    const report = crashLogs(!live);
    if (report.crash) throw new Error('process_crash');
    if (live) return;
    if (Date.now() >= deadline) throw new Error('startup_timeout');
    await sleep(200);
  } while (Date.now() < deadline);
  throw new Error('startup_timeout');
}
function read() {
  nodesReadAt = 0; // Failed reads must never leave actionable cached nodes.
  if (Date.now() - start > 720000) throw new Error('suite_deadline');
  let live = '';
  try { live = adb('shell', 'pidof', pkg).trim(); } catch { /* Snapshot crash buffer below, before throwing. */ }
  for (const pid of live.split(/\s+/).filter(Boolean)) knownPids.add(pid);
  const report = crashLogs(!live);
  if (!live) throw new Error('process_crash');
  if (report.crash) throw new Error('native_or_js_error');
  adb('shell', 'uiautomator', 'dump', '/data/local/tmp/qa.xml');
  const xml = adb('shell', 'cat', '/data/local/tmp/qa.xml');
  if (xml.includes('review-videos-boundary-error')) throw new Error('js_error');
  nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)])));
  if (nodes.some(n => [n.text, n['content-desc']].some(s => s?.includes('qa-js-error')))) throw new Error('js_error');
  nodesReadAt = Date.now(); // Timestamp after dump, parsing and UI error checks.
  return nodes;
}
const find = label => nodes.find(n => n['content-desc'] === label || n.text === label || n['resource-id'] === label || n['resource-id']?.endsWith(':id/' + label));
async function wait(label, seconds = 25, contains = false) {
  const until = Date.now() + seconds * 1000;
  do {
    read();
    if (nodes.some(n => n['content-desc']?.includes('qa-unavailable-'))) throw new Error('network_or_player_unavailable');
    const node = contains ? nodes.find(n => n.text?.includes(label) || n['content-desc']?.includes(label)) : find(label);
    if (node) return node;
    await sleep(300);
  } while (Date.now() < until);
  throw new Error(label.startsWith('qa-ready') || label.startsWith('qa-playing') ? 'network_or_player_timeout' : 'ui_timeout');
}
async function tap(label) {
  const cached = Date.now() - nodesReadAt <= 500 ? find(label) : undefined;
  const n = cached ?? await wait(label); const b = n.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!b) throw new Error('invalid_bounds');
  nodesReadAt = 0; // Every action invalidates the snapshot; next wait confirms fresh state.
  adb('shell', 'input', 'tap', String(Math.round((+b[1] + +b[3]) / 2)), String(Math.round((+b[2] + +b[4]) / 2)));
}
function collect() {
  try {
    read(); const node = find('qa-telemetry');
    const data = node && JSON.parse(node['content-desc']);
    if (Array.isArray(data)) for (const row of data) console.log('QA_JSON ' + JSON.stringify(row));
  } catch { /* Driver failure below remains authoritative. */ }
}
try {
  adb('logcat', '-c'); adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'am', 'start', '-W', '-n', `${pkg}/.MainActivity`);
  await waitForInitialPid();
  currentStep = 'root'; await wait('open-review-videos', 60);
  for (let cycle = 1; cycle <= 20; cycle++) {
    currentStep = 'list_open'; await tap('open-review-videos');
    currentStep = 'wait_list'; await wait('QA Video 1 재생');
    if (cycle <= 3) {
      currentStep = 'player_open'; await tap('QA Video 1 재생');
      currentStep = 'wait_ready'; await wait(`qa-ready-${cycle}`, 65, true);
      read();
      if (find('컨트롤 표시') && !find('일시정지')) await tap('컨트롤 표시');
      read(); if (find('일시정지')) { currentStep = 'pause'; await tap('일시정지'); await wait(`qa-state-paused-${cycle}`, 20, true); }
      currentStep = 'play'; await tap('재생');
      await wait(`qa-state-playing-${cycle}`, 45, true);
      read(); if (!find('일시정지')) await tap('컨트롤 표시');
      currentStep = 'pause'; await tap('일시정지'); await wait(`qa-state-paused-${cycle}`, 20, true);
      currentStep = 'player_close'; await tap('닫기'); await wait('QA Video 1 재생');
    }
    currentStep = 'list_close'; await tap('닫기'); await wait('open-review-videos'); emit('cycle_complete', { cycle });
  }
  currentStep = 'pdf'; await tap('run-pdf-smoke');
  const until = Date.now() + 300000;
  do {
    read(); if (find('qa-pdf-pass')) break;
    if (find('qa-pdf-fail')) throw new Error('pdf_failure');
    if (find('qa-pdf-inconclusive')) throw new Error('pdf_inconclusive');
    await sleep(500);
  } while (Date.now() < until);
  if (!find('qa-pdf-pass')) throw new Error('pdf_timeout');
  collect(); emit('suite_result', { platform: 'android', result: 'pass', cycles: 20, playbackCycles: 3 });
} catch (error) {
  emit('driver_failure_step', { step: currentStep });
  // Failure-only symbol extraction runs before accessibility collection can fail again.
  const report = crashLogs(true);
  for (const row of report.diagnostics) console.log('QA_JSON ' + JSON.stringify(row));
  collect(); const reason = /^[a-z_]+$/.test(error.message) ? error.message : 'driver_failure';
  emit('suite_result', { platform: 'android', result: 'fail', reason }); process.exitCode = 1;
}
