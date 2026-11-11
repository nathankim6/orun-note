import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { sanitizeProbeRows, makeIdentity, entitlements, signingFlags } from '../scripts/native-ios-keychain-diagnostic.mjs';
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
  assert(source.includes("command('codesign',['--force','--sign','-'"));assert(source.includes("baseline_entitlements_unexpected"));assert(source.includes('entitlements_missing'));
  assert(source.includes("'-apple-ios16.0-simulator'"));assert(!source.includes("'iphoneos'"));
});
test('driver creates/deletes only its own CI simulator, never accesses host keychain, and reports startup failures safely',()=>{
  const source=fs.readFileSync('scripts/native-ios-keychain-diagnostic.mjs','utf8');
  assert(source.includes("process.env.GITHUB_ACTIONS!=='true'||process.env.IOS_SYNTHETIC_KEYCHAIN_DIAGNOSTIC!=='1'"));
  assert(source.indexOf("status:'environment_not_ci'")<source.indexOf("command('xcrun',['--sdk'"));
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
