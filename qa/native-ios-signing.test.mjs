import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guardEnv, entitlementsXml, validateApp, parseAdhoc, commandFailure, validateIdentity, extractPlistXml, BUNDLE_ID, APP_IDENTIFIER } from '../scripts/native-ios-signing.mjs';
const info = { CFBundleIdentifier: BUNDLE_ID, CFBundleSupportedPlatforms: ['iPhoneSimulator'] };
const ents = { 'application-identifier': APP_IDENTIFIER, 'keychain-access-groups': [APP_IDENTIFIER], 'get-task-allow': true };
const ci = { CI: 'true', GITHUB_ACTIONS: 'true', PAPERLY_IOS_QA_SIGNING: '1', NATIVE_SMOKE_QA: '1' };
test('guard is strict CI/QA only', () => {
  assert(guardEnv(ci, 'darwin'));
  for (const bad of [{}, { CI: 'true' }, { ...ci, GITHUB_ACTIONS: '' }, { CI: 'true', GITHUB_ACTIONS: 'true' }, { ...ci, CONFIGURATION: 'production' }]) assert.throws(() => guardEnv(bad, 'darwin'));
  assert.throws(() => guardEnv(ci, 'linux'));
});
test('entitlements are explicit, synthetic and match', () => {
  const x = entitlementsXml();
  assert(x.includes(`<string>${APP_IDENTIFIER}</string>`)); assert(x.includes('get-task-allow')); assert(APP_IDENTIFIER.startsWith('QAPAPERLY0.com.paperly.study'));
  assert.equal((x.match(new RegExp(APP_IDENTIFIER.replace(/\./g, '\\.'), 'g')) || []).length, 2);
});
test('validation fails closed', () => {
  assert(validateApp(info, ents));
  const bad = [
    [{ ...info, CFBundleIdentifier: 'com.other' }, ents], [{ ...info, CFBundleSupportedPlatforms: ['iPhoneOS'] }, ents], [info, null], [info, {}],
    [info, { ...ents, 'application-identifier': 'ABCDE12345.com.paperly.study' }],
    [info, { ...ents, 'keychain-access-groups': [] }], [info, { ...ents, 'keychain-access-groups': [APP_IDENTIFIER, 'x'] }],
    [info, { ...ents, 'keychain-access-groups': ['OTHER.com.paperly.study'] }], [info, { ...ents, 'get-task-allow': false }],
  ];
  for (const [i, e] of bad) assert.throws(() => validateApp(i, e));
});
test('adhoc detection rejects authority-signed apps', () => {
  assert(parseAdhoc('Signature=adhoc\nTeamIdentifier=not set'));
  assert.throws(() => parseAdhoc('Authority=Apple Development: x\nTeamIdentifier=ABC'));
  assert.throws(() => parseAdhoc('Identifier=x'));
});
test('smoke script wires signing only after build and before install, with no security/keychain mutation', () => {
  const s = fs.readFileSync('scripts/native-ios-smoke.sh', 'utf8');
  const b = s.indexOf('CODE_SIGNING_ALLOWED=YES'), matrix = s.indexOf('native-ios-launch-probe.mjs');
  assert(b > 0 && b < matrix && matrix < s.indexOf('xcodebuild -project'));
  assert(s.includes('iphonesimulator') && s.includes('GITHUB_ACTIONS'));
  assert(!/\bsecurity\s+(disable|create|import|unlock|set-)/.test(s));
  assert(!/Release-iphoneos|AppStore/.test(s));
});

test('actual workflow CI=1 is accepted but false QA flags and device SDKs reject', () => {
  assert(guardEnv({...ci, CI:'1'}, 'darwin'));
  assert(guardEnv({...ci, CONFIGURATION:'Release'}, 'darwin'));
  for (const e of [{...ci, NATIVE_SMOKE_QA:'0'}, {...ci, PAPERLY_IOS_QA_SIGNING:'0'}, {...ci, SDK_NAME:'iphoneos26.2'}, {...ci, PLATFORM_NAME:'iphoneos'}]) assert.throws(()=>guardEnv(e,'darwin'));
  const wf=fs.readFileSync('.github/workflows/native-smoke.yml','utf8');assert(wf.includes("CI: '1'"));assert(wf.includes("NATIVE_SMOKE_QA: '1'"));
});
test('codesign XML stays valid with stderr diagnostics before or after stdout plist', () => {
  const xml='<?xml version="1.0"?><plist version="1.0"><dict/></plist>';
  assert.equal(extractPlistXml('Executable=private-canary\n'+xml+'\nwarning private-canary'),xml);
  assert.equal(extractPlistXml(xml+'\nExecutable=private-canary'),xml);
  assert.throws(()=>extractPlistXml('private-canary'));assert.throws(()=>extractPlistXml(xml+"<plist></plist>"));
});
test('bundle identity is checked before any signing mutation', () => {
  assert(validateIdentity(info));assert.throws(()=>validateIdentity({...info,CFBundleSupportedPlatforms:['iPhoneOS']}));
  const s=fs.readFileSync('scripts/native-ios-signing.mjs','utf8').split('export function signApp')[1].split('export function verifyApp')[0];
  assert(s.indexOf('validateIdentity')<s.indexOf("run('codesign'"));
});

test('command failures expose only known categories, never raw messages or paths',()=>{assert.equal(commandFailure({stderr:'private-canary code object is not signed at all'}),'unsigned_nested_code');assert.equal(commandFailure({stderr:'private-canary'}),'command_failed');assert.equal(commandFailure({error:{code:'ETIMEDOUT'},stderr:'private-canary'}),'timeout');});

import {SIGNING_VARIANTS, variantEntitlements, validateVariant} from '../scripts/native-ios-signing.mjs';
test('four exact variants reject extra, missing, changed and unknown entitlements',()=>{
 assert.deepEqual(SIGNING_VARIANTS,['V1','V2','V3','V4']);
 assert.deepEqual(variantEntitlements('V1'),{});
 assert.deepEqual(variantEntitlements('V2'),{'get-task-allow':true});
 assert.deepEqual(variantEntitlements('V3'),{'get-task-allow':true,'keychain-access-groups':[APP_IDENTIFIER]});
 assert.deepEqual(variantEntitlements('V4'),ents);
 for(const v of SIGNING_VARIANTS){const e=variantEntitlements(v);assert(validateVariant(info,e,v));assert.throws(()=>validateVariant(info,{...e,unexpected:true},v));assert.throws(()=>validateVariant({...info,CFBundleSupportedPlatforms:['iPhoneOS']},e,v));}
 assert.throws(()=>variantEntitlements('private-canary'));assert.throws(()=>validateVariant(info,ents,'V1'));assert.throws(()=>validateVariant(info,{},'V2'));
 for(const v of ['V1','V2','V3'])assert(!entitlementsXml(v).includes('application-identifier'));
 assert(!entitlementsXml('V2').includes('keychain-access-groups'));
});
test('PDF keychain does not request access groups; verifier remains deep strict',()=>{
 assert(!fs.readFileSync('modules/pdf-renderer/ios/PdfRendererModule.swift','utf8').includes('kSecAttrAccessGroup'));
 const src=fs.readFileSync('scripts/native-ios-signing.mjs','utf8');
 assert(src.includes("if(variant==='V1') {run('codesign',['--force','--sign','-','--timestamp=none',app]);return;}"));
 assert(src.includes("['--verify', '--deep', '--strict', app]"));assert(src.includes('simulator_profile_refused'));
});

import {sectionXml,validateXcodeEntitlements} from '../scripts/native-ios-signing.mjs';
test('Xcode embedded entitlement verifier rejects absent section and identity mismatch',()=>{
 const xml='<?xml version="1.0"?><plist version="1.0"><dict/></plist>';
 const hex=Buffer.from(xml).toString('hex').match(/.{1,8}/g).join(' ');
 assert.equal(sectionXml('Contents of (__TEXT,__entitlements) section\n0000000100001000 '+hex),xml);
 const nativeWords=Buffer.from(xml).toString('hex').match(/.{1,8}/g).map(w=>w.match(/../g).reverse().join('')).join(' ');
 assert.equal(sectionXml('Contents of (__TEXT,__entitlements) section\n0000000100001000 '+nativeWords),xml);
 assert.throws(()=>sectionXml('no section'));
 const e={'application-identifier':BUNDLE_ID,'keychain-access-groups':[BUNDLE_ID]};
 assert(validateXcodeEntitlements(info,e));
 for(const x of [{},{...e,'application-identifier':APP_IDENTIFIER},{...e,'keychain-access-groups':['$(AppIdentifierPrefix)com.paperly.study']}])assert.throws(()=>validateXcodeEntitlements(info,x));
});
test('normal smoke uses Xcode signing and preserves nested frameworks without manual signing',()=>{
 const s=fs.readFileSync('scripts/native-ios-smoke.sh','utf8');
 for(const setting of ['CODE_SIGNING_ALLOWED=YES','CODE_SIGNING_REQUIRED=NO','CODE_SIGN_IDENTITY="-"','CODE_SIGN_STYLE=Manual','DEVELOPMENT_TEAM=""','PROVISIONING_PROFILE_SPECIFIER=""','CODE_SIGN_ENTITLEMENTS="$QA_ENTITLEMENTS"','otool -s __TEXT __entitlements','verify-xcode'])assert(s.includes(setting));
 assert(!/native-ios-signing\.mjs sign\b/.test(s));
 const entry=fs.readFileSync('scripts/native-ios-launch-probe.mjs','utf8').split("if(process.argv[1]===fileURLToPath(import.meta.url))")[1];
 assert(!entry.includes('runMatrix('));assert(!entry.includes('signApp('));assert(entry.includes('verifyXcodeApp(app)'));
});
