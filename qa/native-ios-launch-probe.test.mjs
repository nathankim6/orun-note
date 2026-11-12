import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classify,keySummary,infoSummary} from '../scripts/native-ios-launch-probe.mjs';
test('direct denial reports only closed domains codes and reasons',()=>{
 const result=classify({status:1,stderr:'Error Domain=FBSOpenApplicationServiceErrorDomain Code=1 "request denied /Users/private/account"\n(domain=NSPOSIXErrorDomain, code=13) signature entitlement sandbox'});
 assert.deepEqual(result.domains,[{domain:'FBSOpenApplicationServiceErrorDomain',code:1},{domain:'NSPOSIXErrorDomain',code:13}]);
 assert.ok(result.reasons.includes('request_denied')); assert.ok(!JSON.stringify(result).includes('private'));
 assert.deepEqual(classify({status:1,stderr:'Error Domain=PRIVATE Code=3 private@email.test'}).domains,[]);
});
test('timeout is reported without claiming failure or success',()=>{
 assert.equal(classify({status:null,error:{code:'ETIMEDOUT'},signal:'SIGKILL'}).timedOut,true);
 assert.deepEqual(classify({status:null,error:{code:'ETIMEDOUT'}}).reasons,[]);
});
test('keys never expose values or unknown names',()=>{
 const x=keySummary({'keychain-access-groups':['secret'],'com.apple.developer.applesignin':['secret'],'account-private':'secret'});
 assert.deepEqual(x,{keys:['keychain-access-groups','com.apple.developer.applesignin'],unlistedKeyCount:1});
 assert.equal(infoSummary({CFBundleExecutable:'../secret'},'/app',()=>true).executableMatches,false);
 assert.deepEqual(infoSummary({CFBundleExecutable:'Paperly',CFBundleIdentifier:'com.paperly.study',LSRequiresIPhoneOS:true},'/app',()=>true),{keys:['LSRequiresIPhoneOS','CFBundleExecutable'],bundleIdentifierMatches:true,executableMatches:true});
});
test('probe runs after install before XCTest using same exact simulator',()=>{
 const s=fs.readFileSync('scripts/native-ios-smoke.sh','utf8');
 assert.ok(s.indexOf('CODE_SIGNING_ALLOWED=NO build')<s.indexOf('node scripts/native-ios-launch-probe.mjs'));
 assert.ok(s.indexOf('node scripts/native-ios-launch-probe.mjs')<s.indexOf('xcodebuild -project'));
 assert.match(s,/native-ios-launch-probe\.mjs "\$UDID" "\$APP"/);
 assert.match(s,/xcodebuild -project[^\n]*-destination "id=\$UDID"/);
 assert.match(fs.readFileSync('qa/ios/NativeSmokeTests.swift','utf8'),/XCUIApplication\(bundleIdentifier: "com.paperly.study"\)/);
});

import os from 'node:os';
import path from 'node:path';
import {exitSummary,crashSummary,frameworkSummary,newestCrash,EXIT_CLASSES} from '../scripts/native-ios-launch-probe.mjs';
test('console emits closed classifications and missing library basename only',()=>{
 const value=exitSummary('dyld: Library not loaded: /Users/secret/build/Frameworks/hermes.framework/hermes\nSymbol not found: sensitive_symbol\ncode signature invalid\nRCTFatalException: TypeError: secret message\nUnhandled JS Exception\nhermes error\nkeychain failure\nSIGABRT SIGSEGV');
 assert.equal(value.missingLibrary,'hermes'); assert.equal(value.classes.length,9);
 assert.ok(value.classes.every(x=>EXIT_CLASSES.includes(x)));assert.ok(!JSON.stringify(value).includes('secret'));
 assert.deepEqual(exitSummary('private@email.test'),{classes:['other'],missingLibrary:null});
});
const crashFixture=()=>({bundleInfo:{CFBundleIdentifier:'com.paperly.study'},procPath:'/Users/private/Devices/DEVICE/data/Containers/Bundle/Application/id/Paperly.app/Paperly',exception:{type:'EXC_CRASH',signal:'SIGABRT'},termination:{namespace:'DYLD',code:1,indicator:'Library not loaded: /Users/private/hermes.framework/hermes'},faultingThread:0,threads:[{frames:Array.from({length:10},()=>({imageIndex:0,symbol:'abort',imageOffset:1234}))}],usedImages:[{name:'/Users/private/libsystem_kernel.dylib',path:'/Users/private/secret'}],asi:{message:'RCTFatalException: TypeError: private@email.test'}});
const ips=x=>JSON.stringify({bundleID:'com.paperly.study'})+'\n'+JSON.stringify(x);
test('IPS summary has bounded frames, safe names, classified reason and no raw messages',()=>{
 const x=crashSummary(ips(crashFixture()));assert.equal(x.frames.length,8);assert.equal(x.frames[0].imageName,'libsystem_kernel.dylib');assert.equal(x.exceptionType,'EXC_CRASH');assert.equal(x.jsErrorName,'TypeError');assert.equal(x.rctFatalException,true);assert.equal(x.terminationReason.missingLibrary,'hermes');assert.ok(!/private|Users|imageOffset|1234|email/.test(JSON.stringify(x)));
 const f=crashFixture();f.threads[0].frames=[{imageIndex:0,symbol:'/Users/private/secret'},{imageIndex:0,symbol:'a'.repeat(100)}];f.termination.namespace='private';f.exception.type='private';f.asi.message='Unhandled JS Exception: CustomPrivateName: sensitive';
 const y=crashSummary(ips(f));assert.equal(y.frames[0].symbol,'other');assert.equal(y.frames[1].symbol.length,80);assert.equal(y.terminationNamespace,'other');assert.equal(y.exceptionType,null);assert.equal(y.jsErrorName,null);assert.equal(y.unhandledJsException,true);
});
test('newest crash matches app, simulator and time; never attributes stale crash',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ios-crash-test-'));
 try {fs.writeFileSync(path.join(dir,'app.ips'),ips(crashFixture()));assert.equal(newestCrash(dir,Date.now()-5000,'DEVICE').found,true);assert.equal(newestCrash(dir,Date.now()+5000,'DEVICE').found,false);assert.equal(newestCrash(dir,0,'OTHER').found,false);
 const f=crashFixture();f.bundleInfo.CFBundleIdentifier='other.app';fs.writeFileSync(path.join(dir,'other.ips'),JSON.stringify({bundleID:'other.app'})+'\n'+JSON.stringify(f));assert.equal(newestCrash(dir,0,'DEVICE').exceptionType,'EXC_CRASH');}finally{fs.rmSync(dir,{recursive:true});}
});
test('framework signature summary does not export details',()=>{
 assert.deepEqual(frameworkSummary('/private/hermes.framework',{status:1,stderr:'code object is not signed at all /private'}),{framework:'hermes.framework',signed:false,adhoc:false});
 assert.deepEqual(frameworkSummary('React.framework',{status:0,stderr:'Executable=/private\nSignature=adhoc\n'}),{framework:'React.framework',signed:true,adhoc:true});
});
import {launchedSuccessfully} from '../scripts/native-ios-launch-probe.mjs';
test('matrix signs installs probes cleans all four and restores selected with installed verification',()=>{
 const source=fs.readFileSync('scripts/native-ios-launch-probe.mjs','utf8');
 assert(source.includes('for(const variant of SIGNING_VARIANTS)'));
 assert(source.includes('signApp(app,work,variant);verifyApp(app,variant)'));
 assert(source.includes("['--verify','--deep','--strict',app]"));
 assert(source.includes('row.cleanup=clean();save()'));
 assert(source.includes('if(row.launched&&!result.selectedVariant)result.selectedVariant=variant'));
 assert(source.includes('verifyApp(container.stdout.trim(),result.selectedVariant);result.selectedInstalledVerified=true'));
});
test('launch acceptance requires verified live app and no crash; timeout alone never passes',()=>{
 const healthy={installedVariantVerified:true,installedSigning:{deepStrict:{exitCode:0,timedOut:false}},crash:{found:false},launch:{exitCode:null,timedOut:true,domains:[]},terminate:{exitCode:0,timedOut:false}};
 assert(launchedSuccessfully(healthy));
 for(const delta of [{installedVariantVerified:false},{crash:{found:true}},{crash:{found:false,collectionError:true}},{terminate:{exitCode:3}},{launch:{exitCode:1,domains:[]}},{launch:{timedOut:true,domains:[{domain:'NSPOSIXErrorDomain',code:1}]}}])assert(!launchedSuccessfully({...healthy,...delta}));
});
