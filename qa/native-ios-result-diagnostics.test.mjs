import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectResultDiagnostics, inspectResultObject } from '../scripts/native-ios-result-diagnostics.mjs';
import { sanitizeIosDriverStatus } from '../scripts/native-ios-test-diagnostics.mjs';
const secret = 'PRIVATE_RESULT_CANARY_URL_PATH_DESCRIPTION';

test('reads root and known test refs, exports only closed schema not text or object IDs', () => {
  const objects = {
    root: { actions: { _values: [{ actionResult: { testsRef: { id: { _value: 'private-ref_1' } } } }] } },
    'private-ref_1': { summaryRef: { id: { _value: 'private-ref_2' } }, arbitraryRef: { id: { _value: secret } } },
    'private-ref_2': { message: { _value: 'Failed to launch com.paperly.study: Error Domain=FBSOpenApplicationServiceErrorDomain Code=1 Error Domain=NSPOSIXErrorDomain Code=153 ' + secret } },
  };
  const calls = [];
  const row = collectResultDiagnostics({ bundle: secret, exitCode: 65, readObject: (b, id) => { calls.push(id || 'root'); return JSON.stringify(objects[id || 'root']); } });
  assert.deepEqual(calls, ['root', 'private-ref_1', 'private-ref_2']);
  assert.equal(row.reason, 'target_launch_failure'); assert.equal(row.appValidated, false); assert.equal(row.driverFailure, true);
  assert.equal(row.collection, 'observed'); assert.equal(row.objectsRead, 3);
  assert.deepEqual(row.errorChain, [{domain:'FBSOpenApplicationServiceErrorDomain',code:1},{domain:'NSPOSIXErrorDomain',code:153}]);
  assert(!JSON.stringify(row).includes(secret)); assert(!JSON.stringify(row).includes('private-ref'));
});
test('failed and malformed collection do not imply app validation', () => {
  for (const [reader, collection] of [[()=>{throw Error(secret)}, 'unavailable'], [()=>secret, 'invalid'], [()=> 'x'.repeat(8*1024*1024+1), 'invalid']]) {
    const row = collectResultDiagnostics({exitCode:65,readObject:reader}); assert.equal(row.collection,collection);assert.equal(row.appValidated,false);assert.equal(row.driverFailure,true);assert(!JSON.stringify(row).includes(secret));
  }
});
test('cycles and reference fanout are bounded and invalid references not requested', () => {
  let calls=0;
  const row=collectResultDiagnostics({readObject: (_b,id) => {calls++;return JSON.stringify({testsRef:{id:{_value:'cycle'}},summaryRef:{id:{_value:'bad/path?'+secret}}});}});
  assert.equal(calls,2);assert.equal(row.collection,'partial');assert.equal(row.appValidated,false);
  let sequence=0;const bounded=collectResultDiagnostics({readObject:()=>JSON.stringify({summaryRef:{id:{_value:'ref-'+ ++sequence}}})});assert.equal(bounded.objectsRead,8);assert.equal(bounded.collection,'partial');
});
test('large diagnostic leaves are clipped and private keys are never public fields', () => {
  const result=inspectResultObject({message:'Error '+secret.repeat(100000)});assert.equal(result.clipped,true);assert.equal(result.text,'');
  const clean=sanitizeIosDriverStatus({source:'xcresult',collection:secret,objectsRead:100,textClipped:true,message:secret,appValidated:true});
  assert.deepEqual(clean,{event:'ios_driver_status',stage:'xctest',reason:'unknown',appValidated:false,source:'xcresult',textClipped:true});
});
test('real sanitizer retains result row but never upgrades failed original driver to pass', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ios-result-'));
  try {const input=path.join(dir,'raw'),output=path.join(dir,'clean.jsonl');fs.writeFileSync(input,'QA_JSON '+JSON.stringify({event:'suite_result',platform:'ios',result:'pass'})+'\nQA_JSON '+JSON.stringify({event:'ios_driver_status',stage:'xctest',exitCode:65,reason:'target_launch_failure'})+'\nQA_JSON '+JSON.stringify({event:'ios_driver_status',source:'xcresult',collection:'observed',objectsRead:1,appValidated:true,reason:'unknown',message:secret}));
  const run=spawnSync(process.execPath,['scripts/native-sanitize.mjs',input,output,'ios'],{encoding:'utf8'});assert.equal(run.status,1);const result=fs.readFileSync(output,'utf8');assert(result.includes('"source":"xcresult"'));assert(result.includes('"result":"fail"'));assert(!result.includes(secret));assert(!result.includes('"appValidated":true'));} finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('CLI refuses non CI and original XCTest order and exit remain intact', () => {
  const run=spawnSync(process.execPath,['scripts/native-ios-result-diagnostics.mjs',secret,'65'],{encoding:'utf8',env:{...process.env,CI:'',GITHUB_ACTIONS:'',NATIVE_SMOKE_QA:''}});assert.equal(run.status,1);assert(!run.stdout.includes(secret));assert(run.stdout.includes('not_ci'));
  const shell=fs.readFileSync('scripts/native-ios-smoke.sh','utf8');assert(shell.includes('-resultBundlePath qa/build/ios-result.xcresult'));assert(shell.indexOf('STATUS=$?') < shell.indexOf('node scripts/native-ios-result-diagnostics.mjs'));assert(shell.includes('if [[ "$STATUS" != "0" ]]'));assert(shell.includes('STATUS != 0 || DIAGNOSTIC != 0 || RESULT_DIAGNOSTIC != 0 || SANITIZED != 0'));
});

test('reference-cap truncation is explicitly partial, never complete observation', () => {
  const object=Array.from({length:40},(_,i)=>({testsRef:{id:{_value:'id-'+i}}}));
  const inspected=inspectResultObject(object);assert.equal(inspected.refs.length,32);assert.equal(inspected.clipped,true);
  const row=collectResultDiagnostics({exitCode:65,readObject:(_b,id)=>JSON.stringify(id?{}:object)});assert.equal(row.collection,'partial');assert.equal(row.textClipped,true);assert.equal(row.appValidated,false);
});

// Legacy xcresulttool testsRef IDs use a version prefix, URL-safe base64 and padding.
// Public format evidence: Flutter xcresult_test_data.dart and fastlane-community/trainer#32.
test('follows padded legacy XCResult IDs without exporting identifiers or raw errors', () => {
  const ref = '0~YVEC1htpkY3jLmeu4DB8ah-sJueP7_vUdqA2rL1_R3xT_aftqqEgGUSCHZ0mmpojBSyy4mEL4LX2xyFlfr4pEQ==';
  const summary = '0~' + 'A'.repeat(86) + '==';
  const objects = {
    root: { actions: { _values: [{ actionResult: { testsRef: { id: { _value: ref } } } }] } },
    [ref]: { summaries: { _values: [{ testSummaryRef: { id: { _value: summary } } }] } },
    [summary]: { message: { _value: 'Failed to launch com.paperly.study Error Domain=NSPOSIXErrorDomain Code=153 ' + secret } },
  };
  const calls = [];
  const row = collectResultDiagnostics({ exitCode: 65, readObject: (_b, id) => { calls.push(id || 'root'); return JSON.stringify(objects[id || 'root']); } });
  assert.deepEqual(calls, ['root', ref, summary]);
  assert.equal(row.collection, 'observed'); assert.equal(row.objectsRead, 3);
  assert.equal(row.reason, 'target_launch_failure'); assert.equal(row.appValidated, false);
  assert.deepEqual(row.errorChain, [{ domain: 'NSPOSIXErrorDomain', code: 153 }]);
  for (const privateText of [ref, summary, secret]) assert(!JSON.stringify(row).includes(privateText));
});
test('malformed legacy references remain private and mark incomplete collection', () => {
  for (const id of ['0~bad/path==', '0~bad+value==', '0~bad=tail', '0~bad===', '0~bad\n==', '0~' + 'A'.repeat(257), '--option']) {
    let calls = 0;
    const row = collectResultDiagnostics({ exitCode: 65, readObject: () => { calls++; return JSON.stringify({ testsRef: { id: { _value: id } } }); } });
    assert.equal(calls, 1); assert.equal(row.collection, 'partial'); assert.equal(row.textClipped, true);
    assert.equal(row.appValidated, false); assert(!JSON.stringify(row).includes(id));
  }
});
