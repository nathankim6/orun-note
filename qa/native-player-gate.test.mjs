import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { androidPassRows } from './native-pass-fixture.mjs';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'native-player-gate-'));
test.after(() => fs.rmSync(work, { recursive: true, force: true }));
function gate(rows, platform = 'android') {
  const input = path.join(work, 'input.raw'), output = path.join(work, 'output.jsonl');
  fs.writeFileSync(input, rows.map(row => 'QA_JSON ' + JSON.stringify(row)).join('\n'));
  const result = spawnSync(process.execPath, ['scripts/native-sanitize.mjs', input, output, platform], { encoding: 'utf8' });
  return { status: result.status, rows: fs.readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse) };
}
test('Android ready alone passes without falsely emitting progress', () => {
  const result = gate(androidPassRows()); assert.equal(result.status, 0);
  assert(!result.rows.some(r => ['player_progress', 'player_environment_limited'].includes(r.event)));
});
for (const code of [150, 101, 100, 5]) test(`provider ${code} passes with sanitized environment limitation, never playback`, () => {
  const input = androidPassRows(code).map(r => ({ ...r, message: 'PRIVATE_CANARY', url: 'PRIVATE_CANARY' }));
  const result = gate(input); assert.equal(result.status, 0);
  assert.deepEqual(result.rows.filter(r => r.event === 'player_environment_limited'), [1, 2, 3].map(cycle => ({ event: 'player_environment_limited', cycle, errorCode: code })));
  assert(!JSON.stringify(result.rows).includes('PRIVATE_CANARY')); assert(!result.rows.some(r => r.event === 'player_progress'));
});
for (const code of [2, 152, 153, '150', 'load', 'http', 'process', 'timeout', 'network', undefined, 999]) test(`unapproved code ${code} still fails, even after ready`, () => {
  const result = gate([...androidPassRows(), { event: 'player_unavailable', cycle: 1, errorCode: code }]);
  assert.equal(result.status, 1); assert(!result.rows.some(r => r.event === 'player_environment_limited'));
});
for (const failure of [
  { event: 'js_error', fatal: false },
  { event: 'pdf_failure', trial: 1, stage: 'region', reason: 'operation_failed' },
  { event: 'pdf_failure', trial: 1, stage: 'image_load', reason: 'image_load_failed' },
  { event: 'pdf_raster', trial: 2, raster: 1, status: 0 },
  { event: 'suite_result', result: 'fail', reason: 'process_crash' },
]) test(`provider exemption cannot bypass ${failure.event}/${failure.stage ?? failure.reason ?? ''}`, () => {
  assert.equal(gate([...androidPassRows(150), failure]).status, 1);
});
for (const event of ['boot', 'list_open', 'list_close', 'cycle_complete', 'pdf_result', 'pdf_raster', 'player_unavailable']) test(`missing ${event} cannot pass`, () => {
  assert.equal(gate(androidPassRows(150).filter(r => r.event !== event)).status, 1);
});
test('a forged environment-limited marker cannot replace a provider response', () => {
  const rows = androidPassRows(150).filter(r => r.event !== 'player_unavailable');
  rows.push({ event: 'player_environment_limited', cycle: 1, errorCode: 150 });
  assert.equal(gate(rows).status, 1);
});
// Owner decision (2026-11-12): the same provider-refusal rule applies to the iOS simulator; other codes still fail there.
test('iOS accepts provider refusals 150 in the first three visits with the environment marker', () => {
  const result = gate(androidPassRows(150).map(r => r.platform === 'android' ? { ...r, platform: 'ios' } : r), 'ios');
  assert.equal(result.status, 0); assert(result.rows.some(r => r.event === 'player_environment_limited'));
});
test('iOS still rejects unapproved player codes', () => { assert.equal(gate([...androidPassRows().map(r => r.platform === 'android' ? { ...r, platform: 'ios' } : r), { event: 'player_unavailable', cycle: 1, errorCode: 153 }], 'ios').status, 1); });

test('even one missing list-open or cycle completion fails', () => {
  for (const event of ['list_open', 'list_close', 'cycle_complete']) {
    assert.equal(gate(androidPassRows(150).filter(r => !(r.event === event && r.cycle === 7))).status, 1);
  }
});
test('actual Android wait accepts provider terminal only for the current cycle and preserves health errors', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = fs.readFileSync('scripts/native-android-smoke.mjs', 'utf8');
  const body = source.slice(source.indexOf('async function wait('), source.indexOf('\nasync function tap('));
  for (const code of [150, 101, 100, 5, 2, 'network', 'process']) {
    const emitted = [], node = { 'content-desc': `qa-unavailable-1 qa-errorcode-${code}` };
    const context = { nodes: [node], cycleNumber: 1, environmentLimitedCycles: new Set(), read: () => {}, emit: (event, values) => emitted.push({ event, ...values }), fail: reason => new Error(reason), find: () => undefined, sleep: async () => {} };
    runInNewContext(body + '\nglobalThis.wait = wait;', context);
    if ([150, 101, 100, 5].includes(code)) {
      assert.equal(await context.wait('qa-ready-1', 1, true), node);
      assert.deepEqual(emitted.find(r => r.event === 'player_environment_limited'), { event: 'player_environment_limited', cycle: 1, errorCode: code });
      // Cumulative refusal flags must never satisfy a missing list/close target.
      await assert.rejects(context.wait('open-review-videos', 0), /ui_timeout/);
      context.cycleNumber = 2;
      await assert.rejects(context.wait('qa-ready-2', 0, true), /network_or_player_timeout/);
      context.cycleNumber = 1;
      context.read = () => { throw Error('js_error'); };
      await assert.rejects(context.wait('qa-ready-1', 1, true), /js_error/);
    } else {
      await assert.rejects(context.wait('qa-ready-1', 1, true), /network_or_player_unavailable/);
      assert(!emitted.some(r => r.event === 'player_environment_limited'));
    }
  }
});
