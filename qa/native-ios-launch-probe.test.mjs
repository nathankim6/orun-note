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
 assert.ok(s.indexOf('simctl install "$UDID" "$APP"')<s.indexOf('node scripts/native-ios-launch-probe.mjs'));
 assert.ok(s.indexOf('node scripts/native-ios-launch-probe.mjs')<s.indexOf('xcodebuild -project'));
 assert.match(s,/native-ios-launch-probe\.mjs "\$UDID" "\$APP"/);
 assert.match(s,/xcodebuild -project[^\n]*-destination "id=\$UDID"/);
 assert.match(fs.readFileSync('qa/ios/NativeSmokeTests.swift','utf8'),/XCUIApplication\(bundleIdentifier: "com.paperly.study"\)/);
});
