import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchRequestContext, applyRequestContext } from '../scripts/native-android-request-context.mjs';
const original = 'public class RNCWebViewClient extends WebViewClient {\n}';
test('observer is idempotent, capped, provider-only and delegates unchanged', () => {
  const patched = patchRequestContext(original);
  assert.equal(patchRequestContext(patched), patched);
  assert.match(patched, /return super.shouldInterceptRequest\(view, request\);/);
  assert.match(patched, /qaEmbedCount.getAndIncrement\(\) < 2/);
  assert.match(patched, /qaPlayerCount.getAndIncrement\(\) < 2/);
  assert.match(patched, /www.youtube-nocookie.com/);
  assert(!/setRequest|openConnection|evaluateJavascript|getCookies|\.getValue\(\)\s*\)/.test(patched));
  const log = patched.match(/android.util.Log.i\([^\n]+/g); assert.equal(log.length, 1);
  assert(!log[0].includes('headers')); assert(!log[0].includes('uri'));
});
test('vendor drift fails closed', () => {
  assert.throws(() => patchRequestContext('wrong source'));
  assert.throws(() => patchRequestContext(original + 'shouldInterceptRequest('));
});
test('only QA GitHub CI may write vendor source', () => {
  for (const env of [{}, {NATIVE_SMOKE_QA:'1', CI:'1'}, {NATIVE_SMOKE_QA:'0', CI:'1', GITHUB_ACTIONS:'true'}]) assert.throws(() => applyRequestContext('/not-read', env), /QA GitHub CI only/);
});
test('header-map diagnostics are allowlisted, capped, failure-only and never change gate results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-request-context-'));
  try {
    const row = {event:'player_request_context', requestKind:'embed', mainFrame:false, refererPresent:true, refererAppOriginMatches:true, originPresent:false, originAppOriginMatches:false, url:'PRIVATE_CANARY', headers:'PRIVATE_CANARY', token:'PRIVATE_CANARY'};
    const run = result => {
      const input=path.join(dir,'in'), output=path.join(dir,'out');
      fs.writeFileSync(input, [...Array.from({length:10},()=>row), {...row, requestKind:'PRIVATE_CANARY'}, {...row,requestKind:'player',refererPresent:'PRIVATE_CANARY'}, {event:'suite_result',platform:'android',result}].map(value=>'QA_JSON '+JSON.stringify(value)).join('\n'));
      const child=spawnSync(process.execPath,['scripts/native-sanitize.mjs',input,output,'android'],{encoding:'utf8'});
      return {status:child.status, text:fs.readFileSync(output,'utf8')};
    };
    const failed=run('fail'); assert.equal(failed.status,1); assert(!failed.text.includes('PRIVATE_CANARY'));
    const rows=failed.text.trim().split('\n').map(JSON.parse).filter(value=>value.event==='player_request_context');
    assert.equal(rows.length,3); assert.equal(rows.filter(value=>value.requestKind==='embed').length,2); assert.equal(rows[2].refererPresent,undefined);
    const passed=run('pass'); assert.equal(passed.status,0); assert(!passed.text.includes('player_request_context'));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('request observer is isolated from production workflows and actual native gates', () => {
  const workflow=fs.readFileSync('.github/workflows/native-smoke.yml','utf8');
  assert(workflow.includes('android-diagnostic-request-context:'));
  assert(!/^  android:/m.test(workflow));
  assert(workflow.includes('node scripts/native-android-request-context.mjs'));
  const others=fs.readdirSync('.github/workflows').filter(name=>name!=='native-smoke.yml');
  for(const name of others) assert(!fs.readFileSync('.github/workflows/'+name,'utf8').includes('native-android-request-context'));
});
