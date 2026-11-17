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
for (const mode of ['derived', 'native', 'derived-nozoom']) {
  await cmd({ cmd: 'mode', mode }); await sleep(3500); shot(`${mode}-z1.0-t3.5`);
  for (const z of [2.2, 3.6]) {
    const t0 = Date.now(); await cmd({ cmd: 'zoom', z: String(z) });
    for (const t of mode === 'derived' ? [0.8, 2, 5] : [0.8, 2, 5, 10]) { await sleep(Math.max(0, t0 + t * 1000 - Date.now())); shot(`${mode}-z${z.toFixed(1)}-t${t}`); }
  }
  await cmd({ cmd: 'zoom', z: '1' }); await sleep(1200);
}
const last = read(); fs.writeFileSync(path.join(out, 'lab-log.txt'), (last?.log ?? []).join('\n') + '\n');
console.log((last?.log ?? []).filter(l => /renderRegion|cmd|prepare/.test(l)).join('\n'));
