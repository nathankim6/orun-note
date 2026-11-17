// Drives the viewer lab on a booted iOS simulator: commands through a file in the app container, screenshots with
// simctl. Synthetic page only. Usage: node scripts/lab-drive-ios.mjs <udid> <appDataContainer> <outDir>
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const [udid, container, out] = process.argv.slice(2); const docs = path.join(container, 'Documents'); fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = () => { try { return JSON.parse(fs.readFileSync(path.join(docs, 'lab-state.json'), 'utf8')); } catch { return null; } };
async function until(test, ms, what) { const end = Date.now() + ms; for (;;) { const s = read(); if (s && test(s)) return s; if (Date.now() > end) { console.log('STATE', JSON.stringify(s)?.slice(0, 1500)); throw Error('timeout: ' + what); } await sleep(200); } }
let id = 0;
async function cmd(c) { id++; const tag = `c${id}`; fs.writeFileSync(path.join(docs, 'lab-cmd.json'), JSON.stringify({ ...c, id: tag })); return until(s => s.ack === tag, 20000, 'ack ' + JSON.stringify(c)); }
function shot(name) { execFileSync('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', path.join(out, name + '.png')], { stdio: 'ignore' }); fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(read())); console.log('shot', name); }
const first = await until(s => s.ready === true, 180000, 'lab ready');
if (first.pdf === false) { console.log('LAB_LOG', (first.log ?? []).join('\n')); throw Error('pdf pipeline unavailable in the lab build'); }
console.log('ready', JSON.stringify({ dpr: first.dpr, window: first.window, viewport: first.viewport }));
if (process.env.GITHUB_SHA && first.build !== process.env.GITHUB_SHA) throw Error('the app is not running this commit: ' + first.build);
const failures = [];
const phase = async (name, fn) => { try { await fn(); console.log('phase ok', name); } catch (e) { failures.push(name + ': ' + String(e?.message ?? e)); console.log('PHASE FAILED', name, String(e?.message ?? e)); try { shot('failed-' + name); } catch { /* keep going */ } } };
const run = async (layered, modes, zooms, times) => {
  await cmd({ cmd: 'layers', on: layered ? '1' : '0' }); const tag = layered ? 'layered' : 'single';
  for (const mode of modes) await phase(tag + '-' + mode, async () => {
    await cmd({ cmd: 'mode', mode }); await sleep(3500); shot(`${tag}-${mode}-z1.0-t3.5`);
    try { for (const z of zooms) { const t0 = Date.now(); await cmd({ cmd: 'zoom', z: String(z) }); for (const t of times) { await sleep(Math.max(0, t0 + t * 1000 - Date.now())); shot(`${tag}-${mode}-z${z.toFixed(1)}-t${t}`); } } }
    finally { await cmd({ cmd: 'zoom', z: '1' }).catch(() => {}); await sleep(1200); }
  });
};
// qa/lab/phases.txt (optional): only the named top-level phases run
const only = fs.existsSync('qa/lab/phases.txt') ? fs.readFileSync('qa/lab/phases.txt', 'utf8').split(/[\s,]+/).filter(Boolean) : [];
const topPhase = phase; const wanted = name => !only.length || only.includes(name);
// 0. The page of a document WITHOUT server pages, un-magnified, on the layered surface: the native page view alone.
if (wanted('native-paper')) await topPhase('native-paper', async () => {
  await cmd({ cmd: 'layers', on: '1' }); const t0 = Date.now(); await cmd({ cmd: 'mode', mode: 'native' });
  for (const t of [1.5, 3.5, 9]) { await sleep(Math.max(0, t0 + t * 1000 - Date.now())); shot(`paper-native-z1.0-t${t}`); }
  await cmd({ cmd: 'timings' }); await sleep(500);
  await cmd({ cmd: 'probe', on: '1' }); await sleep(3000); shot('paper-native-probe'); await cmd({ cmd: 'probe', on: '0' });
  await cmd({ cmd: 'zoom', z: '1.5' }); await sleep(3000); shot('paper-native-z1.5'); await cmd({ cmd: 'zoom', z: '1' }); await sleep(3000); shot('paper-native-back-z1.0');
  await cmd({ cmd: 'page', page: '1' }); await sleep(3000); shot('paper-native-page2'); await cmd({ cmd: 'page', page: '0' }); await sleep(2500); shot('paper-native-page1-again');
  await cmd({ cmd: 'layers', on: '0' }); await cmd({ cmd: 'mode', mode: 'native' }); await sleep(3500); await cmd({ cmd: 'page', page: '1' }); await sleep(600); shot('paper-single-page2-t0.6'); await sleep(2500); shot('paper-single-page2-t3'); await cmd({ cmd: 'page', page: '0' }); await sleep(1500);
  await cmd({ cmd: 'timings' }); await sleep(500); await cmd({ cmd: 'layers', on: '1' });
});
// 1. The production surface (layered) in every mode: the evidence for the fix comes first.
if (wanted('layered')) await phase('layered', () => run(true, ['derived', 'native', 'derived-nozoom'], [1.5, 2.2, 3.6], [1.2, 3, 7]));
// 2. Compositing matrix: one sharp bitmap through different layer structures (what does iOS lose, and where?).
if (wanted('matrix')) await phase('matrix', async () => {
  await cmd({ cmd: 'mode', mode: 'native' }); await sleep(2500); await cmd({ cmd: 'matrix', on: '1' });
  try { await until(st => Array.isArray(st.matrix) && st.matrix.length > 0, 20000, 'matrix'); await sleep(2500); shot('matrix'); }
  finally { await cmd({ cmd: 'matrix', on: '0' }).catch(() => {}); await sleep(600); }
});
// 3. The single-layer surface as the "before" reference.
if (wanted('single')) await phase('single', () => run(false, ['derived', 'native'], [2.2], [7]));
// 4. Ink when magnified (layered surface): thin synthetic strokes across the target.
if (wanted('ink')) await phase('ink', async () => {
  await cmd({ cmd: 'layers', on: '1' }); await cmd({ cmd: 'mode', mode: 'derived' }); await sleep(2500); await cmd({ cmd: 'ink' }); await sleep(800);
  for (const z of [2.2, 3.6]) { await cmd({ cmd: 'zoom', z: String(z) }); await sleep(5000); shot(`ink-z${z.toFixed(1)}`); }
  await cmd({ cmd: 'zoom', z: '1' }); await sleep(800);
});
const last = read(); fs.writeFileSync(path.join(out, 'lab-log.txt'), (last?.log ?? []).join('\n') + '\n');
console.log((last?.log ?? []).filter(l => /renderRegion|cmd|prepare/.test(l)).join('\n'));
if (failures.length) { console.log('FAILURES\n' + failures.join('\n')); process.exit(1); }
