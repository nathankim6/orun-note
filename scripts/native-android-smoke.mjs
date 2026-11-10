import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const pkg = 'com.paperly.study', start = Date.now();
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 18000, maxBuffer: 16 * 1024 * 1024 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const emit = (event, values = {}) => console.log('QA_JSON ' + JSON.stringify({ event, ...values }));
const decode = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
let nodes = [];
function read() {
  if (Date.now() - start > 720000) throw new Error('suite_deadline');
  try { if (!adb('shell', 'pidof', pkg).trim()) throw new Error(); } catch { throw new Error('process_crash'); }
  const logs = adb('logcat', '-d', '-t', '4000');
  if (/FATAL EXCEPTION|Fatal signal \d|JavascriptException|Unhandled JS Exception|ReactNativeJS.*(?:TypeError|ReferenceError|SyntaxError|Error:)/i.test(logs)) throw new Error('native_or_js_error');
  adb('shell', 'uiautomator', 'dump', '/data/local/tmp/qa.xml');
  const xml = adb('shell', 'cat', '/data/local/tmp/qa.xml');
  if (xml.includes('review-videos-boundary-error')) throw new Error('js_error');
  nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)])));
  if (nodes.some(n => [n.text, n['content-desc']].some(s => s?.includes('qa-js-error')))) throw new Error('js_error');
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
  const n = await wait(label); const b = n.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!b) throw new Error('invalid_bounds');
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
  adb('shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');
  await wait('open-review-videos', 60);
  for (let cycle = 1; cycle <= 20; cycle++) {
    await tap('open-review-videos'); await wait('QA Video 1 재생');
    if (cycle <= 3) {
      await tap('QA Video 1 재생'); await wait(`qa-ready-${cycle}`, 65, true);
      read();
      if (find('컨트롤 표시') && !find('일시정지')) await tap('컨트롤 표시');
      read(); if (find('일시정지')) { await tap('일시정지'); await wait(`qa-state-paused-${cycle}`, 20, true); }
      await tap('재생');
      await wait(`qa-state-playing-${cycle}`, 45, true);
      read(); if (!find('일시정지')) await tap('컨트롤 표시');
      await tap('일시정지'); await wait(`qa-state-paused-${cycle}`, 20, true);
      await tap('닫기'); await wait('QA Video 1 재생');
    }
    await tap('닫기'); await wait('open-review-videos'); emit('cycle_complete', { cycle });
  }
  await tap('run-pdf-smoke');
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
  collect(); const reason = /^[a-z_]+$/.test(error.message) ? error.message : 'driver_failure';
  emit('suite_result', { platform: 'android', result: 'fail', reason }); process.exitCode = 1;
}
