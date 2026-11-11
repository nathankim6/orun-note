import { execFileSync } from 'node:child_process';
import { extractCrashDiagnostics } from './native-diagnostics.mjs';
const pkg = 'com.paperly.study', start = Date.now();
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 18000, maxBuffer: 16 * 1024 * 1024 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const emit = (event, values = {}) => console.log('QA_JSON ' + JSON.stringify({ event, ...values }));
const decode = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
let nodes = [], lastLogcat = '', nodesReadAt = 0, currentStep = 'startup';
const knownPids = new Set();
let lastTelemetry = [], lastUINodes = [], lastXMLState = 'unavailable';
function parseXML(xml) {
  const parsed = [...xml.matchAll(/<node\b[^>]*>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)])));
  const node = parsed.find(n => n['resource-id'] === 'qa-telemetry' || n['resource-id']?.endsWith(':id/qa-telemetry'));
  try { const data = node && JSON.parse(node['content-desc']); if (Array.isArray(data) && data.length <= 180) lastTelemetry = data; } catch { /* Keep last valid telemetry. */ }
  lastUINodes = parsed; lastXMLState = 'fresh';
  return parsed;
}
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
  if (report.crash) {
    // The fatal category is authoritative, but preserve the latest callback code
    // and boot/list events before throwing. No health recursion or test bypass.
    try { adb('shell', 'uiautomator', 'dump', '/data/local/tmp/qa.xml'); parseXML(adb('shell', 'cat', '/data/local/tmp/qa.xml')); } catch { /* Retain previous telemetry if UI died. */ }
    throw new Error('native_or_js_error');
  }
  adb('shell', 'uiautomator', 'dump', '/data/local/tmp/qa.xml');
  const xml = adb('shell', 'cat', '/data/local/tmp/qa.xml');
  nodes = parseXML(xml); // Cache telemetry before UI-error checks can throw.
  if (xml.includes('review-videos-boundary-error')) throw new Error('js_error');
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
  throw new Error(label.startsWith('qa-ready') || label.startsWith('qa-state-playing') ? 'network_or_player_timeout' : 'ui_timeout');
}
async function tap(label) {
  const cached = Date.now() - nodesReadAt <= 500 ? find(label) : undefined;
  const n = cached ?? await wait(label); const b = n.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!b) throw new Error('invalid_bounds');
  nodesReadAt = 0; // Every action invalidates the snapshot; next wait confirms fresh state.
  adb('shell', 'input', 'tap', String(Math.round((+b[1] + +b[3]) / 2)), String(Math.round((+b[2] + +b[4]) / 2)));
}
function collect() {
  // A failure is already authoritative. Do not call read()/healthy() again: that
  // would discard telemetry whenever the same fatal log is still in logcat.
  try {
    adb('shell', 'uiautomator', 'dump', '/data/local/tmp/qa.xml');
    parseXML(adb('shell', 'cat', '/data/local/tmp/qa.xml'));
  } catch { lastXMLState = lastUINodes.length ? 'cached' : 'unavailable'; /* Retain telemetry and XML summary. */ }
  for (const row of lastTelemetry) console.log('QA_JSON ' + JSON.stringify(row));
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
  collect(); captureSurface(); const reason = /^[a-z_]+$/.test(error.message) ? error.message : 'driver_failure';
  emit('suite_result', { platform: 'android', result: 'fail', reason }); process.exitCode = 1;
}

function surfaceSummary(inputNodes, activity, window, xmlSource) {
  // Raw XML/dumpsys stay in memory. Output is only fixed enums/bounded counts.
  const bounded = inputNodes.slice(0, 10000);
  const packageKind = name => name === 'com.paperly.study' ? 'app' : ['com.android.launcher3', 'com.google.android.apps.nexuslauncher', 'com.sec.android.app.launcher'].includes(name) ? 'launcher' : ['com.android.permissioncontroller', 'com.google.android.permissioncontroller'].includes(name) ? 'permission' : ['android', 'com.android.systemui', 'com.google.android.gms'].includes(name) ? 'system' : name ? 'other' : 'unknown';
  const kinds = new Set(bounded.map(n => packageKind(n.package)).filter(k => k !== 'unknown'));
  const uiPackage = kinds.size > 1 ? 'mixed' : [...kinds][0] ?? 'unknown';
  const focus = window.split('\n').find(line => /mCurrentFocus=/.test(line) && !/mCurrentFocus=null/.test(line)) ?? activity.split('\n').find(line => /topResumedActivity=|mResumedActivity:/.test(line)) ?? '';
  const focusedPackage = focus.match(/(?:\s|\{)(com\.[A-Za-z0-9_.]+|android)\//)?.[1];
  const focusedKind = packageKind(focusedPackage);
  let foreground = focusedKind === 'system' ? 'systemdialog' : ['app', 'launcher', 'permission'].includes(focusedKind) ? focusedKind : 'unknown';
  const osNodes = bounded.filter(n => ['system', 'permission', 'launcher'].includes(packageKind(n.package)));
  const osId = id => osNodes.some(n => n['resource-id'] === id);
  const osText = expression => osNodes.some(n => expression.test(n.text ?? '') || expression.test(n['content-desc'] ?? ''));
  let dialog = 'none';
  if (osId('android:id/aerr_wait') || osId('android:id/anr_wait')) dialog = 'anr';
  else if (osId('android:id/aerr_close') || osId('android:id/aerr_restart')) dialog = osText(/Google Play services|Google Play 서비스/) ? 'gms_crash' : 'app_crash';
  else if (/mShowingLockscreen=true|mKeyguardShowing=true|isStatusBarKeyguard=true/.test(window) || osNodes.some(n => /:id\/(?:keyguard_status_view|lockscreen_clock_view)$/.test(n['resource-id'] ?? ''))) dialog = 'keyguard';
  else if (/Waiting For Debugger|Waiting for debugger/.test(focus) || osText(/^Waiting [Ff]or [Dd]ebugger$/)) dialog = 'debugger';
  else if (foreground === 'permission' || osNodes.some(n => /:id\/permission_(?:allow|deny)_button$/.test(n['resource-id'] ?? ''))) dialog = 'permission';
  else if (/GestureSandboxActivity|GestureTutorialActivity|GestureNavigationTutorial/.test(focus)) dialog = 'gesture_tutorial';
  else if (foreground === 'systemdialog') dialog = 'unknown';
  if (['gms_crash', 'app_crash', 'anr', 'keyguard', 'debugger'].includes(dialog)) foreground = 'systemdialog';
  const uiLabels = new Set(); let qaNodeCount = 0;
  for (const node of bounded) {
    const values = [node.text ?? '', node['content-desc'] ?? '', node['resource-id'] ?? ''];
    const has = value => values.some(v => v === value || v.endsWith(':id/' + value));
    let qa = false;
    const add = value => { uiLabels.add(value); qa = true; };
    if (has('open-review-videos')) add('root_button');
    if (has('qa-boot')) add('qa_boot');
    if (has('qa-loading')) add('qa_loading');
    if (has('qa-telemetry')) add('telemetry');
    if (values.some(v => /^QA Video [1-4] 재생$/.test(v) || /(?:^|:id\/)review-video-card-qa-video-[1-4]$/.test(v))) add('list');
    if (has('review-video-playback-status') || values.some(v => /(?:^| )qa-(?:ready|playing|paused|state-(?:playing|paused|loading))-(?:[1-9]|1[0-9]|20)(?: |$)/.test(v))) add('player');
    if (has('qa-js-error') || has('review-videos-boundary-error') || values.some(v => /(?:^| )qa-unavailable-(?:[1-9]|1[0-9]|20)(?: |$)/.test(v))) add('error');
    if (has('run-pdf-smoke') || values.some(v => /^qa-pdf-(?:idle|running|pass|fail|inconclusive)$/.test(v))) add('pdf');
    if (values.some(v => ['학생 로그인으로', '관리자이신가요?', '연결하고 시작'].includes(v))) uiLabels.add('auth_screen');
    if (node.class === 'android.window.SplashScreenView' || has('android:id/splashscreen')) uiLabels.add('splash');
    if (qa) qaNodeCount++;
  }
  if (/Splash Screen com\.paperly\.study\b/.test(focus)) uiLabels.add('splash');
  return { event: 'driver_surface', foreground, dialog, xmlSource, uiPackage, nodeCount: bounded.length, appNodeCount: bounded.filter(n => n.package === 'com.paperly.study').length, qaNodeCount, uiLabels: [...uiLabels].slice(0, 12) };
}
function captureSurface() {
  const query = (...args) => { try { return execFileSync('adb', args, { encoding: 'utf8', timeout: 6000, maxBuffer: 2 * 1024 * 1024 }); } catch { return ''; } };
  const activity = query('shell', 'dumpsys', 'activity', 'activities');
  const window = query('shell', 'dumpsys', 'window', 'windows');
  console.log('QA_JSON ' + JSON.stringify(surfaceSummary(lastUINodes, activity, window, lastXMLState)));
}
