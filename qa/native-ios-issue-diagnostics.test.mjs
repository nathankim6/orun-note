import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const canary='PRIVATE_STUDENT_ACCOUNT_URL_PATH_CANARY';
const work=fs.mkdtempSync(path.join(os.tmpdir(),'ios-issue-test-'));
function sanitize(rows){const input=path.join(work,'input.raw'),out=path.join(work,'out.jsonl');fs.writeFileSync(input,rows.map(r=>'QA_JSON '+JSON.stringify(r)).join('\n'));const r=spawnSync(process.execPath,['scripts/native-sanitize.mjs',input,out,'ios'],{encoding:'utf8'});return {status:r.status,rows:fs.readFileSync(out,'utf8').trim().split('\n').map(JSON.parse)};}
test('pre-app-marker synchronous issue survives sanitization and remains NONPASS',()=>{
 const result=sanitize([{event:'ios_launch_checkpoint',stage:'before_launch',message:canary},{event:'ios_xctest_issue',issueType:4,sourceLine:52,associatedErrorPresent:true,isFailure:true,reason:'launch_denied',errorChain:[{domain:'RBSRequestErrorDomain',code:5}],message:canary}]);
 assert.equal(result.status,1);assert(result.rows.some(r=>r.event==='ios_launch_checkpoint'&&r.stage==='before_launch'));
 const issue=result.rows.find(r=>r.event==='ios_xctest_issue');assert.equal(issue.driverFailure,true);assert.equal(issue.appValidated,false);assert.equal(issue.issueType,4);assert.equal(issue.sourceLine,52);assert.deepEqual(issue.errorChain,[{domain:'RBSRequestErrorDomain',code:5}]);assert(!JSON.stringify(result).includes(canary));
});
test('unknown issue cannot turn a claimed pass green and forged fields are rejected',()=>{
 const result=sanitize([{event:'ios_xctest_issue',issueType:999,sourceLine:999999,associatedErrorPresent:canary,isFailure:true,reason:canary,errorChain:[{domain:canary,code:2}],message:canary},{event:'suite_result',platform:'ios',result:'pass'}]);
 assert.equal(result.status,1);const issue=result.rows.find(r=>r.event==='ios_xctest_issue');assert.equal(issue.reason,'unknown');assert(!('issueType'in issue));assert(!('sourceLine'in issue));assert(!('errorChain'in issue));assert(!JSON.stringify(result).includes(canary));
});
test('diagnostics do not substitute for pass markers and do not alter a real pass',()=>{
 assert.equal(sanitize([{event:'ios_launch_checkpoint',stage:'after_launch'}]).status,1);
 assert.equal(sanitize([{event:'ios_launch_checkpoint',stage:'before_launch'},{event:'ios_launch_checkpoint',stage:'after_launch'},{event:'suite_result',platform:'ios',result:'pass'}]).status,0);
});
test('hook always forwards issue and checkpoint precedes unchanged launch',()=>{
 const swift=fs.readFileSync('qa/ios/NativeSmokeTests.swift','utf8');
 assert.match(swift,/override func record\(_ issue: XCTIssue\)/);assert.match(swift,/defer\s*\{\s*super\.record\(issue\)\s*\}/);
 assert.match(swift,/emit\("ios_launch_checkpoint", \["stage": "before_launch"\]\)\s*app\.launch\(\); defer \{ collect\(\) \}/);
 const shell=fs.readFileSync('scripts/native-ios-smoke.sh','utf8');assert.match(shell,/test > qa\/build\/ios-test\.raw 2>&1/);assert.match(shell,/cat qa\/build\/ios-test\.raw qa\/build\/ios-system\.raw > qa\/build\/ios\.raw/);
});
test('real Swift helper classifies nil-error descriptions and strips all private text', {skip:process.platform!=='darwin'||!['1','true'].includes(process.env.CI)},()=>{
 const exe=path.join(work,'swift-fixture');const cache=path.join(work,'swift-cache');
 const compile=spawnSync('xcrun',['swiftc','-swift-version','5','-module-cache-path',cache,'qa/ios/LaunchIssueDiagnostics.swift','qa/ios-launch-issue-fixture.swift','-o',exe],{encoding:'utf8',timeout:60000});assert.equal(compile.status,0,compile.stderr);
 const run=spawnSync(exe,[],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,JSON.stringify({stderr:run.stderr,signal:run.signal,error:run.error?.code}));assert.equal(run.stdout.trim(),'swift_issue_fixture_pass');
});
test('failure after output cap remains sticky and cannot be hidden by forged pass',()=>{
 const rows=Array.from({length:10},()=>({event:'ios_launch_checkpoint',stage:'before_launch'}));
 rows.push({event:'ios_xctest_issue',isFailure:true,reason:'unknown'},{event:'suite_result',platform:'ios',result:'pass'});
 assert.equal(sanitize(rows).status,1);
});
