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
  const b = s.indexOf('CODE_SIGNING_ALLOWED=NO build'), sg = s.indexOf('native-ios-signing.mjs sign'), v = s.indexOf('native-ios-signing.mjs verify'), i = s.indexOf('simctl install');
  assert(b > 0 && b < sg && sg < v && v < i);
  assert(s.includes('iphonesimulator') && s.includes('GITHUB_ACTIONS'));
  assert(!/\bsecurity\s+(disable|create|import|unlock|set-)/.test(s));
  assert(!/Release-iphoneos|AppStore|PROVISIONING|DEVELOPMENT_TEAM/.test(s));
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
