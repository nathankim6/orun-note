// CI-only simulator QA signing. Normal smoke uses Xcode link-time entitlements, never re-signs.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const BUNDLE_ID = 'com.paperly.study';
export const SYNTHETIC_PREFIX = 'QAPAPERLY0';
export const APP_IDENTIFIER = `${SYNTHETIC_PREFIX}.${BUNDLE_ID}`;
export function guardEnv(env = process.env, platform = process.platform) {
  if (platform !== 'darwin') throw Error('signing_not_macos');
  if (!['1', 'true'].includes(env.CI) || env.GITHUB_ACTIONS !== 'true') throw Error('signing_requires_ci');
  if (env.NATIVE_SMOKE_QA !== '1' || env.PAPERLY_IOS_QA_SIGNING !== '1') throw Error('signing_requires_qa');
  if (/^(production|appstore)$/i.test(env.CONFIGURATION || '') || /^iphoneos/i.test(env.SDK_NAME || '') || env.PLATFORM_NAME === 'iphoneos') throw Error('signing_production_refused');
  return true;
}
export const SIGNING_VARIANTS = Object.freeze(['V1','V2','V3','V4']);
export function variantEntitlements(variant='V4') {
  if (!SIGNING_VARIANTS.includes(variant)) throw Error('unknown_signing_variant');
  return variant==='V1'?{}:variant==='V2'?{'get-task-allow':true}:variant==='V3'?{'get-task-allow':true,'keychain-access-groups':[APP_IDENTIFIER]}:{'application-identifier':APP_IDENTIFIER,'keychain-access-groups':[APP_IDENTIFIER],'get-task-allow':true};
}
export function validateVariant(info, ents, variant='V4') {
  validateIdentity(info);
  const expected=variantEntitlements(variant);
  if (!ents || Array.isArray(ents) || JSON.stringify(Object.keys(ents).sort())!==JSON.stringify(Object.keys(expected).sort()) || Object.keys(expected).some(k=>JSON.stringify(ents[k])!==JSON.stringify(expected[k]))) throw Error('variant_entitlements_mismatch');
  return true;
}
export function entitlementsXml(variant='V4') {
  variantEntitlements(variant);
  if(variant!=='V4') return '<?xml version="1.0"?><plist version="1.0"><dict>'+(variant==='V1'?'':'<key>get-task-allow</key><true/>')+(variant==='V3'?'<key>keychain-access-groups</key><array><string>'+APP_IDENTIFIER+'</string></array>':'')+'</dict></plist>';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>application-identifier</key><string>${APP_IDENTIFIER}</string><key>keychain-access-groups</key><array><string>${APP_IDENTIFIER}</string></array><key>get-task-allow</key><true/></dict></plist>\n`;
}
// info: parsed Info.plist; ents: parsed entitlements object (from signed binary).
export function validateIdentity(info) {
  if (!info || info.CFBundleIdentifier !== BUNDLE_ID) throw Error('bundle_id_mismatch');
  const plats = info.CFBundleSupportedPlatforms;
  if (!Array.isArray(plats) || plats.length !== 1 || plats[0] !== 'iPhoneSimulator') throw Error('not_simulator_app');
  return true;
}
export function validateApp(info, ents) {
  validateIdentity(info);
  if (!ents || ents['application-identifier'] !== APP_IDENTIFIER) throw Error('application_identifier_mismatch');
  const g = ents['keychain-access-groups'];
  if (!Array.isArray(g) || g.length !== 1 || g[0] !== APP_IDENTIFIER) throw Error('keychain_groups_mismatch');
  if (ents['get-task-allow'] !== true) throw Error('get_task_allow_missing');
  if (!String(ents['application-identifier']).startsWith(SYNTHETIC_PREFIX + '.')) throw Error('prefix_not_synthetic');
  return true;
}
export function parseAdhoc(codesignDetails) {
  if (!/^Signature=adhoc$/m.test(codesignDetails) && !/flags=0x[0-9a-f]+\([^)]*adhoc/.test(codesignDetails)) throw Error('signature_not_adhoc');
  if (/^Authority=/m.test(codesignDetails)) throw Error('signature_has_authority');
  return true;
}
export function commandFailure(result) {
  if (result?.error?.code === 'ETIMEDOUT') return 'timeout';
  const text = String(result?.stderr || '');
  if (/code object is not signed at all/i.test(text)) return 'unsigned_nested_code';
  if (/sealed resource is missing or invalid/i.test(text)) return 'invalid_resources';
  if (/bundle format (?:unrecognized|is ambiguous)/i.test(text)) return 'invalid_bundle';
  if (/invalid or unsupported format for signature/i.test(text)) return 'signature_format';
  if (/errSecInternalComponent/.test(text)) return 'signing_internal';
  if (/Operation not permitted|Permission denied/i.test(text)) return 'permission';
  return 'command_failed';
}
const output = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw Error(path.basename(cmd) + '_' + commandFailure(r));
  return { stdout: r.stdout || '', stderr: r.stderr || '' };
};
const run = (cmd, args, input) => output(cmd, args, input).stdout;
const details = (cmd, args) => { const r = output(cmd, args); return r.stdout + '\n' + r.stderr; };
export function extractPlistXml(text) {
  const start = text.indexOf('<?xml'), end = text.indexOf('</plist>', start);
  if (start < 0 || end < start || /<plist\b/.test(text.slice(end + 8))) throw Error('entitlements_xml_invalid');
  return text.slice(start, end + 8);
}
const plistJson = (args, input) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', ...args], input));
export function signApp(app, work, variant='V4') {
  guardEnv();
  if (!fs.existsSync(path.join(app, 'Info.plist'))) throw Error('app_missing');
  validateIdentity(plistJson(['--', path.join(app, 'Info.plist')]));
  variantEntitlements(variant);
  if(fs.existsSync(path.join(app,'embedded.mobileprovision'))) throw Error('simulator_profile_refused');
  if(variant==='V1') {run('codesign',['--force','--sign','-','--timestamp=none',app]);return;}
  const file = path.join(work, 'qa-ci.entitlements');
  fs.writeFileSync(file, entitlementsXml(variant));
  run('codesign', ['--force', '--sign', '-', '--timestamp=none', '--entitlements', file, app]);
}
export function verifyApp(app, variant='V4') {
  guardEnv();
  const info = plistJson(['--', path.join(app, 'Info.plist')]);
  variantEntitlements(variant);
  if(fs.existsSync(path.join(app,'embedded.mobileprovision'))) throw Error('simulator_profile_refused');
  const result=output('codesign', ['-d', '--entitlements', ':-', app]);
  const text=result.stdout+'\n'+result.stderr;
  const absent=variant==='V1' && result.stdout.trim()==='' && !/<plist|bplist|<key>/.test(text);
  const ents=absent?{}:plistJson(['-'], extractPlistXml(text));
  validateVariant(info, ents, variant);
  run('codesign', ['--verify', '--deep', '--strict', app]);
  parseAdhoc(details('codesign', ['-dvv', app]));
}
// otool -s prints section bytes as hex words, not host-endian integers.
export function sectionXml(text) {
  const rows=String(text).split('\n').filter(l=>/^\s*[0-9a-f]{8,16}\s+/i.test(l));
  const hex=rows.map(l=>l.trim().split(/\s+/).slice(1).filter(w=>/^(?:[0-9a-f]{2}){1,8}$/i.test(w)).join('')).join('');
  if(!hex)throw Error('embedded_entitlements_missing');
  return extractPlistXml(Buffer.from(hex,'hex').toString('utf8'));
}
export function validateXcodeEntitlements(info, ents) {
  validateIdentity(info);
  if(ents?.['application-identifier']!==BUNDLE_ID)throw Error('embedded_application_identifier_mismatch');
  if(!Array.isArray(ents['keychain-access-groups']) || !ents['keychain-access-groups'].includes(BUNDLE_ID) || ents['keychain-access-groups'].some(x=>typeof x!=='string'||/\$[({]/.test(x)))throw Error('embedded_keychain_groups_mismatch');
  return true;
}
export function prepareXcodeEntitlements(source,destination,stripSiwa=false) {
  guardEnv();
  const ents=plistJson(['--',source]);
  if(stripSiwa)delete ents['com.apple.developer.applesignin'];
  const resolve=v=>typeof v==='string'?v.replace(/\$\(AppIdentifierPrefix\)|\$\{AppIdentifierPrefix\}/g,'').replace(/\$\(CFBundleIdentifier\)|\$\(PRODUCT_BUNDLE_IDENTIFIER\)/g,BUNDLE_ID):Array.isArray(v)?v.map(resolve):v;
  for(const k of Object.keys(ents))ents[k]=resolve(ents[k]);
  ents['application-identifier']=BUNDLE_ID;
  // Preserve existing groups; ensure default SecItemAdd has the app's own group.
  ents['keychain-access-groups']=[...new Set([...(ents['keychain-access-groups']||[]),BUNDLE_ID])];
  fs.writeFileSync(destination,run('plutil',['-convert','xml1','-o','-','-'],JSON.stringify(ents)));
}
export function verifyXcodeApp(app) {
  guardEnv();
  const info=plistJson(['--',path.join(app,'Info.plist')]);validateIdentity(info);
  if(fs.existsSync(path.join(app,'embedded.mobileprovision')))throw Error('simulator_profile_refused');
  if(typeof info.CFBundleExecutable!=='string'||path.basename(info.CFBundleExecutable)!==info.CFBundleExecutable)throw Error('invalid_executable');
  const embedded=plistJson(['-'],sectionXml(run('otool',['-s','__TEXT','__entitlements',path.join(app,info.CFBundleExecutable)])));
  validateXcodeEntitlements(info,embedded);
  // On simulator codesign may report no signature-slot entitlements. Embedded section is authoritative.
  const shown=details('codesign',['-d','--entitlements',':-',app]);
  if(/<plist/.test(shown))validateXcodeEntitlements(info,plistJson(['-'],extractPlistXml(shown)));
  run('codesign',['--verify','--deep','--strict',app]);parseAdhoc(details('codesign',['-dvv',app]));
  return {embeddedEntitlements:true,applicationIdentifierMatches:true,keychainGroupMatches:true,adhoc:true,noAuthority:true};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, app, work, option] = process.argv.slice(2);
  try {
    if(cmd==='prepare-xcode')prepareXcodeEntitlements(app,work,option==='strip-siwa');
    else if(cmd==='verify-xcode')console.log(JSON.stringify(verifyXcodeApp(app)));
    else if(cmd==='sign')throw Error('manual_resigning_disabled');
    else if(cmd==='verify')verifyApp(app);
    else throw Error('usage');
    console.log('ios_qa_signing_'+cmd+'_ok');
  }catch(e){console.error('ios_qa_signing_failed:'+e.message);process.exit(1);}
}
