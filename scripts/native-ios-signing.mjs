// CI-only ad-hoc signing for the simulator QA app. Synthetic team prefix; no Apple certs/profiles/keychain changes.
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
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, app, work] = process.argv.slice(2);
  try {
    if (cmd === 'sign') signApp(app, work || '.');
    else if (cmd === 'verify') verifyApp(app);
    else throw Error('usage');
    console.log(`ios_qa_signing_${cmd}_ok`);
  } catch (e) { console.error(`ios_qa_signing_failed:${e.message}`); process.exit(1); }
}
