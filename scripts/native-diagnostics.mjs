// Failure diagnostics contain symbols/enums only. Never emit source lines, messages,
// process IDs, filenames, paths, URLs, register values or full native symbols.
export const CRASH_PATTERN = /FATAL EXCEPTION|Fatal signal \d|signal\s+\d+\s+\(SIG(?:SEGV|ABRT|BUS|ILL|TRAP)\)|Render(?:er)? process.*(?:crash|gone)|EXC_BAD_ACCESS|EXC_CRASH|Terminating app due to uncaught exception|libc\+\+abi:.*terminating|JavascriptException|Unhandled JS Exception|ReactNativeJS.*\b(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|AggregateError|InternalError):/i;
const symbol = /^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)+[A-Za-z_$][A-Za-z0-9_$]*$/;
const method = /^(?:<init>|<clinit>|[A-Za-z_$][A-Za-z0-9_$]*)$/;
const library = /^lib[A-Za-z0-9_+.-]{1,112}\.so$/;
const jsEnums = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError', 'InternalError']);
// Explicit code-function allowlist, not arbitrary JavaScript identifiers.
const jsFunctions = new Set(['other', 'anonymous', 'value', 'render', 'onMessage', 'onStatus', 'status', 'marker', 'toggle', 'load', 'bridgeStatus', 'Player', 'QA', 'ReviewVideosScreen', 'ReviewVideosContent', 'YouTubeStage', 'renderWithHooks', 'updateFunctionComponent', 'beginWork', 'performUnitOfWork', 'workLoopSync', 'renderRootSync', 'performWorkOnRoot', 'performSyncWorkOnRoot', 'flushSyncWorkAcrossRoots_impl', 'commitRoot', 'commitHookEffectListMount', 'commitHookPassiveMountEffects', 'commitPassiveMountOnFiber', 'recursivelyTraversePassiveMountEffects', 'flushPassiveEffects', 'callFunctionReturnFlushedQueue', '__callFunction', '__guard', 'dispatchEvent', 'processMessage']);
const iosEnums = new Set(['EXC_BAD_ACCESS', 'EXC_CRASH', 'EXC_BAD_INSTRUCTION', 'EXC_ARITHMETIC', 'EXC_BREAKPOINT', 'SIGABRT', 'SIGSEGV', 'SIGBUS', 'NS_EXCEPTION', 'CPP_TERMINATE']);
export const DIAGNOSTIC_EVENTS = new Set(['crash_java_exception', 'crash_java_frame', 'crash_native_frame', 'crash_ios_exception', 'crash_js_exception', 'crash_js_frame']);
export function sanitizeDiagnostic(row) {
  if (!row || !DIAGNOSTIC_EVENTS.has(row.event)) return null;
  const out = { event: row.event };
  const validSymbol = value => typeof value === 'string' && value.length <= 192 && symbol.test(value);
  if (row.event === 'crash_java_exception') {
    if (!validSymbol(row.exceptionClass) || !/(?:Exception|Error|Throwable)(?:\$[A-Za-z0-9_$]+)?$/.test(row.exceptionClass)) return null;
    out.exceptionClass = row.exceptionClass;
  } else if (row.event === 'crash_java_frame') {
    if (!validSymbol(row.frameClass) || typeof row.frameMethod !== 'string' || row.frameMethod.length > 96 || !method.test(row.frameMethod)) return null;
    out.frameClass = row.frameClass; out.frameMethod = row.frameMethod;
    if (Number.isInteger(row.sourceLine) && row.sourceLine >= 1 && row.sourceLine <= 10000000) out.sourceLine = row.sourceLine;
  } else if (row.event === 'crash_native_frame') {
    if (typeof row.nativeLibrary !== 'string' || !library.test(row.nativeLibrary) || typeof row.nativePc !== 'string' || !/^0x[0-9a-f]{1,16}$/.test(row.nativePc)) return null;
    out.nativeLibrary = row.nativeLibrary; out.nativePc = row.nativePc;
  } else if (row.event === 'crash_js_exception') {
    if (!jsEnums.has(row.jsException)) return null;
    out.jsException = row.jsException;
  } else if (row.event === 'crash_js_frame') {
    if (!jsFunctions.has(row.frameFunction) || !Number.isInteger(row.bundleLine) || row.bundleLine < 1 || row.bundleLine > 10000000 || !Number.isInteger(row.bundleColumn) || row.bundleColumn < 0 || row.bundleColumn > 10000000) return null;
    out.frameFunction = row.frameFunction; out.bundleLine = row.bundleLine; out.bundleColumn = row.bundleColumn;
  } else {
    if (!iosEnums.has(row.iosException)) return null;
    out.iosException = row.iosException;
  }
  return out;
}
function appProcess(name) { return /^com\.paperly\.study(?::[A-Za-z0-9_.:-]+)?$/.test(name); }
function androidScope(text, pids) {
  const lines = text.split('\n').slice(-8000);
  const known = new Set(pids.map(String));
  // Crash headers recover app/worker PIDs even after pidof can no longer see them.
  for (const line of lines) {
    const process = line.match(/\bProcess: ([A-Za-z0-9_.:-]+), PID: (\d+)\b/);
    if (process && appProcess(process[1])) known.add(process[2]);
    // WebView sandbox launch attributed to this app, including its isolated children.
    const launch = line.match(/\bStart proc (\d+):([^\s/]+).*\bfor\s+\{com\.paperly\.study\//);
    if (launch) known.add(launch[1]);
  }
  const scoped = [];
  let tombstoneOwner = null, tombstoneLines = 0;
  for (const line of lines) {
    const owner = line.match(/>>> ([A-Za-z0-9_.:-]+) <<</);
    const prefix = line.match(/^\s*\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d+\s+(\d+)\s+\d+\s+[VDIWEF]\s+([^:]+):\s?(.*)$/);
    if (owner) {
      tombstoneOwner = appProcess(owner[1]) ? prefix?.[1] ?? 'plain' : null;
      tombstoneLines = 0;
      if (tombstoneOwner) scoped.push(line);
    } else if (prefix && known.has(prefix[1])) scoped.push(prefix[2].trim() + ': ' + prefix[3]);
    else if (tombstoneOwner && ++tombstoneLines <= 160 && (!prefix || prefix[1] === tombstoneOwner)) scoped.push(prefix?.[3] ?? line);
  }
  return scoped.join('\n');
}
export function extractCrashDiagnostics(text, { platform, pids = [], force = false } = {}) {
  // Existing QA_JSON may contain diagnostic class names; don't treat those as raw crash evidence.
  const raw = text.split('\n').filter(line => !line.includes('QA_JSON ')).join('\n');
  const scoped = platform === 'android' ? androidScope(raw, pids) : raw;
  const crash = CRASH_PATTERN.test(scoped);
  if (!crash && !force) return { crash: false, diagnostics: [] };
  const rows = [], seen = new Set(), counts = {};
  const add = row => {
    const clean = sanitizeDiagnostic(row); if (!clean) return;
    const key = JSON.stringify(clean); if (seen.has(key)) return;
    const limit = ['crash_java_frame', 'crash_js_frame'].includes(clean.event) ? 32 : clean.event === 'crash_native_frame' ? 16 : 8;
    if ((counts[clean.event] ?? 0) >= limit) return;
    counts[clean.event] = (counts[clean.event] ?? 0) + 1; seen.add(key); rows.push(clean);
  };
  let jsContext = 0;
  for (const line of scoped.split('\n')) {
    const js = line.match(/\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|AggregateError|InternalError|Error):/);
    if (js && (/ReactNativeJS|JavascriptException|Unhandled JS Exception/.test(line) || platform === 'ios')) {
      add({ event: 'crash_js_exception', jsException: js[1] }); jsContext = 64;
    }
    if (jsContext-- > 0) {
      // Hermes release fn@1:column or V8 fn (address at index.android.bundle:line:col).
      // Never retain the bundle name, file path, URL or arbitrary function text.
      const hermes = line.match(/(?:^|:\s+)([A-Za-z_$][A-Za-z0-9_$]*|<anonymous>)@(\d{1,8}):(\d{1,8})\s*$/);
      const v8 = line.match(/\bat ([A-Za-z_$][A-Za-z0-9_$]*|<anonymous>) \((?:address at )?(?:index(?:\.android|\.ios)?\.bundle|bytecode):(\d{1,8}):(\d{1,8})\)\s*$/);
      const frame = hermes ?? v8;
      if (frame) add({ event: 'crash_js_frame', frameFunction: jsFunctions.has(frame[1]) ? frame[1] : 'other', bundleLine: Number(frame[2]), bundleColumn: Number(frame[3]) });
    }
    const exception = line.match(/(?:^|:\s+|\bCaused by:\s+)((?:[A-Za-z_$][A-Za-z0-9_$]*\.)+[A-Za-z_$][A-Za-z0-9_$]*)(?:\s|:|$)/);
    if (exception) add({ event: 'crash_java_exception', exceptionClass: exception[1] });
    const frame = line.match(/\bat ((?:[A-Za-z_$][A-Za-z0-9_$]*\.)+)(<init>|<clinit>|[A-Za-z_$][A-Za-z0-9_$]*)\((?:[A-Za-z0-9_$.-]+\.(?:java|kt):([0-9]{1,8})|Native Method|Unknown Source)\)/);
    if (frame) add({ event: 'crash_java_frame', frameClass: frame[1].slice(0, -1), frameMethod: frame[2], sourceLine: Number(frame[3]) });
    const native = line.match(/#\d+\s+pc\s+([0-9a-fA-F]{1,16})\s+(\S+)/);
    if (native) {
      const basename = native[2].split('/').pop();
      add({ event: 'crash_native_frame', nativeLibrary: basename, nativePc: '0x' + native[1].toLowerCase() });
    }
    if (platform === 'ios') {
      for (const name of iosEnums) if (/^(?:EXC_|SIG)/.test(name) && new RegExp('\\b' + name + '\\b').test(line)) add({ event: 'crash_ios_exception', iosException: name });
      if (/Terminating app due to uncaught exception/i.test(line)) add({ event: 'crash_ios_exception', iosException: 'NS_EXCEPTION' });
      if (/libc\+\+abi:.*terminating/i.test(line)) add({ event: 'crash_ios_exception', iosException: 'CPP_TERMINATE' });
    }
  }
  return { crash, diagnostics: rows };
}
