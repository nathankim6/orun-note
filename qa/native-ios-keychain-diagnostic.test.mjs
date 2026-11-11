import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { sanitizeProbeRows, makeIdentity, entitlements, signingFlags, executeProbeCommand, coldEnumeration, REQUIRED_RUNTIME, selectCompatibleSimulator, selectPreconfiguredSimulator, classifyCreateError } from '../scripts/native-ios-keychain-diagnostic.mjs';
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
  assert(source.includes("stdio:['ignore','pipe','pipe']"));assert(!source.includes('console.error'));assert(source.includes('Date.now()+480000'));
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


test('simulator selection pins exact iOS26.2 and configured iPad, never last/old iPad',()=>{
  const preferred='com.apple.CoreSimulator.SimDeviceType.iPad-Synthetic-Preferred';
  const old='com.apple.CoreSimulator.SimDeviceType.iPad-Synthetic-Old';
  const runtime={identifier:REQUIRED_RUNTIME,version:'26.2',isAvailable:true,supportedDeviceTypes:[{identifier:preferred}]};
  const type={identifier:preferred,name:'iPad Synthetic Preferred',productFamily:'iPad',minRuntimeVersionString:'18.0.0',maxRuntimeVersion:4294967295};
  const obsolete={identifier:old,name:'iPad Synthetic Old',productFamily:'iPad',maxRuntimeVersionString:'18.0.0'};
  const selected=selectCompatibleSimulator({runtimes:[runtime]},{devicetypes:[type,obsolete]},preferred);
  assert.equal(selected.type.identifier,preferred);assert.equal(selected.runtime.identifier,REQUIRED_RUNTIME);
  assert.throws(()=>selectCompatibleSimulator({runtimes:[runtime]},{devicetypes:[obsolete]},preferred),/compatible_device_unavailable/);
  assert.throws(()=>selectCompatibleSimulator({runtimes:[runtime]},{devicetypes:[obsolete]},old),/compatible_device_unavailable/);
  for(const candidate of [{...runtime,isAvailable:false},{...runtime,isAvailable:'true'},{...runtime,version:'26.1'},{...runtime,identifier:'untrusted.iOS-26-2'}])assert.throws(()=>selectCompatibleSimulator({runtimes:[candidate]},{devicetypes:[type]},preferred),/runtime_unavailable/);
  for(const candidate of [{...type,minRuntimeVersionString:'27.0.0'},{...type,maxRuntimeVersion:18*65536},{...type,minRuntimeVersion:NaN},{...type,productFamily:'iPhone'},{...type,name:'iPhone Synthetic'}])assert.throws(()=>selectCompatibleSimulator({runtimes:[runtime]},{devicetypes:[candidate]},preferred),/compatible_device_unavailable/);
  assert.throws(()=>selectCompatibleSimulator({runtimes:[{...runtime,supportedDeviceTypes:[old]}]},{devicetypes:[type]},preferred),/compatible_device_unavailable/);
  assert.throws(()=>selectCompatibleSimulator({runtimes:[runtime]},{devicetypes:[type]},canary),/compatible_device_unavailable/);
});
test('creation failures expose only strict category and enum/numeric command evidence',()=>{
  const examples=[['Device type is not supported by this runtime','incompatible_device_runtime'],['Invalid device type','device_type_unavailable'],['Invalid runtime','runtime_unavailable'],['CoreSimulatorService connection unavailable','simulator_service_unavailable'],['Permission denied','permission_denied'],[canary,'unknown']];
  for(const [message,category]of examples){
    assert.equal(classifyCreateError({stdout:Buffer.from(canary),stderr:Buffer.from(message)}),category);
    const rows=[];assert.throws(()=>executeProbeCommand({label:'sim_create',variant:'shared',stage:'create',bin:'xcrun',args:[canary],deadline:10000,now:()=>0,emit:row=>rows.push(row),query:()=>({status:147,stdout:Buffer.from(canary),stderr:Buffer.from(message)})}),error=>error.status==='nonzero');
    assert.equal(rows[0].createError,category);assert.equal(rows[0].exitCode,147);assert(!JSON.stringify(rows).includes(canary));assert(!JSON.stringify(rows).includes(message));
  }
});


test('fresh simulator type comes only from first available iPad on selected26.2 runtime',()=>{
  const preferred='com.apple.CoreSimulator.SimDeviceType.iPad-Synthetic-Preferred';
  const old='com.apple.CoreSimulator.SimDeviceType.iPad-Synthetic-Old';
  const runtime={identifier:REQUIRED_RUNTIME,version:'26.2',isAvailable:true};
  const types={devicetypes:[{identifier:preferred,name:'iPad Synthetic Preferred',productFamily:'iPad',minRuntimeVersionString:'18.0.0'},{identifier:old,name:'iPad Synthetic Old',maxRuntimeVersionString:'18.0.0'}]};
  const available={isAvailable:true,name:'iPad Synthetic Preferred',deviceTypeIdentifier:preferred,udid:canary};
  const devices={devices:{'com.apple.CoreSimulator.SimRuntime.iOS-18-0':[{isAvailable:true,name:'iPad Synthetic Old',deviceTypeIdentifier:old}], [REQUIRED_RUNTIME]:[{isAvailable:false,name:'iPad Unavailable',deviceTypeIdentifier:old},{isAvailable:true,name:'iPhone Synthetic',deviceTypeIdentifier:old},available]}};
  const result=selectPreconfiguredSimulator({runtimes:[runtime]},types,devices);assert.equal(result.type.identifier,preferred);assert.equal(result.candidateCount,1);
  assert.equal(result.runtime.identifier,REQUIRED_RUNTIME);assert(!JSON.stringify({candidateCount:result.candidateCount}).includes(canary));
  for(const sameRuntime of [undefined,[],[{...available,deviceTypeIdentifier:undefined}],[{...available,deviceTypeIdentifier:canary}],[{...available,isAvailable:false}],[{...available,name:'iPhone Synthetic'}]])assert.throws(()=>selectPreconfiguredSimulator({runtimes:[runtime]},types,{devices:{...devices.devices,[REQUIRED_RUNTIME]:sameRuntime}}),/compatible_device_unavailable/);
  assert.throws(()=>selectPreconfiguredSimulator({runtimes:[runtime]},types,{devices:{...devices.devices,[REQUIRED_RUNTIME]:[{...available,deviceTypeIdentifier:undefined},available]}}),/compatible_device_unavailable/); // no fallback past invalid first preferred candidate
  assert.throws(()=>selectPreconfiguredSimulator({runtimes:[runtime]},{devicetypes:[types.devicetypes[1]]},devices),/compatible_device_unavailable/);
  assert.throws(()=>selectPreconfiguredSimulator({runtimes:[{...runtime,isAvailable:false}]},types,devices),/runtime_unavailable/);
  const source=fs.readFileSync('scripts/native-ios-keychain-diagnostic.mjs','utf8');
  assert(source.includes("command('list_available_devices','xcrun',['simctl','list','devices','available','-j'])"));assert(source.includes("source:'available_same_runtime_device',candidateCount"));assert(!source.includes('.at(-1)'));
  assert(source.includes("['simctl','create','SyntheticKeychain-'+seed,type.identifier,runtime.identifier]"));assert(!source.includes('simulator=preferred.udid'));
});


test('cold probe OS startup has finite180s boot and480s global budgets, without extra retries',()=>{
  const source=fs.readFileSync('scripts/native-ios-keychain-diagnostic.mjs','utf8');
  assert(source.includes('const deadline=Date.now()+480000;'));
  assert(source.includes("command('sim_bootstatus','xcrun',['simctl','bootstatus',simulator,'-b'],180000)"));
  assert.equal((source.match(/command\('sim_bootstatus'/g)||[]).length,1);
  assert(source.includes("command(label,'xcrun',args,10000,true)"));
  const options={label:'sim_bootstatus',variant:'shared',stage:'boot',bin:'xcrun',args:[canary],budget:180000,deadline:480000,now:()=>0};
  const rows=[],calls=[];
  executeProbeCommand({...options,emit:row=>rows.push(row),query:(_bin,_args,config)=>{calls.push(config);return {status:0,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};}});
  assert.equal(calls[0].timeout,180000);assert.equal(rows[0].budgetMs,180000);assert(Number.isFinite(rows[0].budgetMs));
  executeProbeCommand({...options,deadline:45000,emit:()=>{},query:(_bin,_args,config)=>{assert.equal(config.timeout,45000);return {status:0};}});
  let queryCalls=0;
  for(const budget of [Infinity,-Infinity,NaN,0,-1,1.5,480001,'180000'])assert.throws(()=>executeProbeCommand({...options,budget,emit:()=>{},query:()=>{queryCalls++;}}),/command_budget_invalid/);
  for(const deadline of [Infinity,-Infinity,NaN,undefined])assert.throws(()=>executeProbeCommand({...options,deadline,emit:()=>{},query:()=>{queryCalls++;}}),/command_budget_invalid/);
  assert.throws(()=>executeProbeCommand({...options,deadline:0,emit:row=>{assert.equal(row.status,'deadline');assert.equal(row.budgetMs,0);},query:()=>{queryCalls++;}}),error=>error.status==='deadline');assert.equal(queryCalls,0);
  executeProbeCommand({...options,label:'shutdown_probe',stage:'cleanup',cleanup:true,budget:10000,deadline:0,now:()=>480001,emit:()=>{},query:(_bin,_args,config)=>{assert.equal(config.timeout,10000);return {status:0};}});
  executeProbeCommand({...options,label:'delete_probe',stage:'cleanup',cleanup:true,budget:180000,deadline:0,now:()=>480001,emit:()=>{},query:(_bin,_args,config)=>{assert.equal(config.timeout,15000);return {status:0};}});
});
test('only diagnostic workflow probe step changes to10min; job remains12min and native gates stay separate',()=>{
  const diagnostic=fs.readFileSync('.github/workflows/ios-keychain-diagnostic.yml','utf8');
  assert.match(diagnostic,/synthetic-keychain-experiment:\s+ runs-on: macos-15\s+timeout-minutes: 12/);
  assert.match(diagnostic,/name: Compare linker-ad-hoc baseline with explicit synthetic entitlements\s+timeout-minutes: 10\s+run: node scripts\/native-ios-keychain-diagnostic\.mjs/);
  const nativeWorkflow=fs.readFileSync('.github/workflows/native-smoke.yml','utf8'),nativeScript=fs.readFileSync('scripts/native-ios-smoke.sh','utf8');
  assert(!nativeWorkflow.includes('IOS_SYNTHETIC_KEYCHAIN_DIAGNOSTIC'));assert(!nativeScript.includes('native-ios-keychain-diagnostic'));
  assert(!nativeScript.includes('180000'));assert(!nativeScript.includes('480000'));assert(!nativeWorkflow.includes('keychain-probe'));
});
