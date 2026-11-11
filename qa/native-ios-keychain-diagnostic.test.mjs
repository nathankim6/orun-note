import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { sanitizeProbeRows, makeIdentity, entitlements, signingFlags, executeProbeCommand, coldEnumeration } from '../scripts/native-ios-keychain-diagnostic.mjs';
const canary='PRIVATE_KEY_DATA_ACCOUNT_TOKEN_PATH_CANARY';
test('probe output is fixed enums/numbers and unknown status never exposes OSStatus or key bytes',()=>{
  const rows=sanitizeProbeRows([
    {operation:'lookup',status:'item_not_found',account:canary,path:canary},
    {operation:'add',status:'missing_entitlement',rawStatus:-34018,key:canary,message:canary},
    {operation:'verify',status:'success',matchesSynthetic:1,byteCount:32,data:canary},
    {operation:'delete',status:'unknown',rawStatus:-99999,message:canary},
    {operation:canary,status:canary},{operation:'lookup',status:-25308},
  ],'baseline');
  assert.equal(rows.length,4);assert(rows.every(r=>r.notNativeValidation===1));
  const text=JSON.stringify(rows);for(const privateText of [canary,'-34018','-25308','-99999','"data"','"key"','"path"'])assert(!text.includes(privateText));
  assert.equal(rows[2].byteCount,32);assert.equal(rows[2].matchesSynthetic,1);
  assert.deepEqual(sanitizeProbeRows([{operation:'verify',status:'success',matchesSynthetic:canary,byteCount:999999}],'entitled'),[{event:'simulator_keychain_probe',variant:'entitled',operation:'verify',status:'success',notNativeValidation:1}]);
  assert.deepEqual(sanitizeProbeRows(rows,canary),[]);
});
test('unique probe bundle/account cannot reference production identity and entitlements are synthetic',()=>{
  const one=makeIdentity('a'.repeat(32)),two=makeIdentity('b'.repeat(32));assert.notEqual(one.baseline,two.baseline);assert.notEqual(one.baseline,one.entitled);
  assert.throws(()=>makeIdentity(canary));assert.throws(()=>entitlements('com.paperly.study'));
  const xml=entitlements(one.entitled);assert(xml.includes('<key>application-identifier</key>'));assert(xml.includes('<key>keychain-access-groups</key>'));assert(xml.includes('QADIAG0001.'+one.entitled));
  assert(!xml.includes('get-task-allow'));assert(!xml.includes('com.paperly.study.pdfkey'));
});
test('Swift mirrors inspected master-key query/add attributes with explicitly isolated namespaces',()=>{
  const swift=fs.readFileSync('scripts/native-ios-keychain-probe.swift','utf8');const native=fs.readFileSync('modules/pdf-renderer/ios/PdfRendererModule.swift','utf8');
  for(const attribute of ['kSecClassGenericPassword','kSecAttrAccount','kSecReturnData','kSecMatchLimitOne','kSecValueData','kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly']){assert(swift.includes(attribute));assert(native.includes(attribute));}
  assert(!swift.includes('kSecAttrService'));assert(swift.includes('scope + ".pdfkey"'));
  assert(!swift.includes('com.paperly.study.pdfkey'));assert(!swift.includes('kSecAttrAccessGroup'));
  assert(swift.includes('Data(repeating: 0x5A, count: 32)'));
  assert(swift.includes('SecItemDelete(identity as CFDictionary)'));assert(!swift.includes('SecItemDelete(query'));
  assert(swift.includes('default: return "unknown"'));assert(!swift.includes('print('));assert(!swift.includes('SecCopyErrorMessageString'));
  assert(swift.indexOf('SecItemDelete(identity as CFDictionary)')<swift.indexOf('return rows'));
});
test('baseline has no explicit app entitlement while second variant signs exactly synthetic entitlement keys',()=>{
  assert.deepEqual(signingFlags('linker signature no entitlement data'),{applicationIdentifier:0,keychainAccessGroups:0});
  assert.deepEqual(signingFlags(entitlements(makeIdentity('a'.repeat(32)).entitled)),{applicationIdentifier:1,keychainAccessGroups:1});
  const source=fs.readFileSync('scripts/native-ios-keychain-diagnostic.mjs','utf8');
  assert(source.includes("'-Xlinker','-adhoc_codesign'"));assert(source.includes("if(current==='entitled'){stage='sign'"));
  assert(source.includes("command('sign_probe','codesign',['--force','--sign','-'"));assert(source.includes("baseline_entitlements_unexpected"));assert(source.includes('entitlements_missing'));
  assert(source.includes("'-apple-ios16.0-simulator'"));assert(!source.includes("'iphoneos'"));
});
test('driver creates/deletes only its own CI simulator, never accesses host keychain, and reports startup failures safely',()=>{
  const source=fs.readFileSync('scripts/native-ios-keychain-diagnostic.mjs','utf8');
  assert(source.includes("process.env.GITHUB_ACTIONS!=='true'||process.env.IOS_SYNTHETIC_KEYCHAIN_DIAGNOSTIC!=='1'"));
  assert(source.indexOf("status:'environment_not_ci'")<source.indexOf("command('sdk_path','xcrun',['--sdk'"));
  assert(source.includes("['simctl','create','SyntheticKeychain-'+seed"));assert(source.includes("['simctl','delete',simulator]"));assert(source.includes("['simctl','shutdown',simulator]"));
  assert(!source.includes("command('security'"));assert(!source.includes("'erase','all'"));assert(!source.includes("'delete','all'"));
  assert(source.includes("stage='install'"));assert(source.includes("stage='launch'"));assert(source.includes("'install_failed','launch_failed'"));
  assert(source.includes("stdio:['ignore','pipe','pipe']"));assert(!source.includes('console.error'));assert(source.includes('Date.now()+300000'));
});
test('workflow is manual macOS15/Xcode26.2 no-RN experiment and cannot satisfy native release gate',()=>{
  const source=fs.readFileSync('.github/workflows/ios-keychain-diagnostic.yml','utf8');
  assert(source.includes('workflow_dispatch: {}'));assert(!/^\s+(?:push|pull_request|schedule):/m.test(source));assert(source.includes('runs-on: macos-15'));assert(source.includes("xcode-version: '26.2'"));
  assert(!source.includes('npm ci'));assert(!source.includes('expo prebuild'));assert(!source.includes('pod install'));assert(!source.includes('secrets.'));assert(!source.includes('upload-app'));assert(!source.includes('download-artifact'));
  assert(source.includes('path: qa/output/ios-keychain-diagnostic.jsonl'));assert(source.includes('retention-days: 3'));assert(!/path:.*(?:\*|\.app|\.ipa|\.png|\.raw)/.test(source));
  const {validateNativeQa}=createRequire(import.meta.url)('../scripts/verify-native-qa.js');
  assert.throws(()=>validateNativeQa({status:'completed',conclusion:'success',head_sha:'exact',path:'.github/workflows/ios-keychain-diagnostic.yml',repository:{full_name:'own/repo'},head_repository:{full_name:'own/repo'},event:'workflow_dispatch'},{sha:'exact',repository:'own/repo',jobs:[{name:'android',status:'completed',conclusion:'success'},{name:'ios',status:'completed',conclusion:'success'}]}),/Wrong native smoke workflow/);
});

test('iOS per-command evidence is emitted before failure with no args/output/paths or unknown messages',()=>{
  const rows=[];let tick=100;
  assert.throws(()=>executeProbeCommand({label:'list_runtimes',variant:'shared',stage:'list_runtimes',bin:'xcrun',args:[canary],budget:15000,deadline:100000,now:()=>tick,emit:r=>rows.push(r),query:()=>{tick+=15000;return {status:null,error:{code:'ETIMEDOUT',message:canary},stdout:Buffer.from(canary),stderr:Buffer.from(canary)};}}),error=>error.status==='timeout');
  assert.equal(rows.length,1);assert.equal(rows[0].command,'list_runtimes');assert.equal(rows[0].status,'timeout');assert.equal(rows[0].elapsedMs,15000);assert.equal(rows[0].budgetMs,15000);assert.equal(rows[0].stdoutBytes,Buffer.byteLength(canary));assert(!JSON.stringify(rows).includes(canary));
  const output=executeProbeCommand({label:'sdk_path',variant:'shared',stage:'sdk_path',bin:'xcrun',args:[],deadline:10000,now:()=>0,emit:r=>rows.push(r),query:()=>({status:0,stdout:Buffer.from('/private/'+canary),stderr:Buffer.alloc(0)})});
  assert.equal(output,'/private/'+canary);assert(!JSON.stringify(rows).includes(canary));
  executeProbeCommand({label:'list_device_types',variant:'shared',stage:'list_device_types',bin:'xcrun',args:[],deadline:10000,now:()=>0,emit:r=>rows.push(r),query:()=>({status:0,stdout:Buffer.alloc(0)})});
  assert.throws(()=>executeProbeCommand({label:canary,variant:'shared',stage:'sdk_path',bin:'xcrun',args:[],deadline:10000,emit:()=>{},query:()=>{throw Error('must not run');}}),/command_identity_invalid/);
});
test('CoreSimulator enumeration gets one 60s cold attempt only after a recorded timeout, never nonzero retry',()=>{
  const calls=[];const output=coldEnumeration((label,budget)=>{calls.push({label,budget});if(calls.length===1)throw Object.assign(Error('safe'),{status:'timeout'});return 'synthetic';},'list_runtimes');
  assert.equal(output,'synthetic');assert.deepEqual(calls,[{label:'list_runtimes',budget:15000},{label:'list_runtimes_cold',budget:60000}]);
  let nonzeroCalls=0;assert.throws(()=>coldEnumeration(()=>{nonzeroCalls++;throw Object.assign(Error('safe'),{status:'nonzero'});},'list_device_types'));assert.equal(nonzeroCalls,1);
  let timeouts=0;assert.throws(()=>coldEnumeration(()=>{timeouts++;throw Object.assign(Error('safe'),{status:'timeout'});},'list_runtimes'));assert.equal(timeouts,2);
});
