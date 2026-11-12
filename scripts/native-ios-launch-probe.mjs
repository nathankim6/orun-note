// Direct platform probes, before XCTest. No raw command output is persisted or printed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardEnv, BUNDLE_ID, extractPlistXml } from './native-ios-signing.mjs';
const DOMAINS = ['FBSOpenApplicationServiceErrorDomain','FBSOpenApplicationErrorDomain','FBProcessExit','RBSRequestErrorDomain','RBSServiceErrorDomain','NSPOSIXErrorDomain','NSOSStatusErrorDomain','IXUserPresentableErrorDomain','MIInstallerErrorDomain'];
const KEYS = ['application-identifier','com.apple.developer.team-identifier','get-task-allow','keychain-access-groups','com.apple.developer.applesignin','com.apple.security.application-groups','aps-environment'];
export function classify(result) {
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const domains = [];
  for (const domain of DOMAINS) {
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:Error Domain=|domain[=:]\\s*|\\b)${escaped}["']?[,;\\s]+(?:Code|code)[=:]\\s*(-?\\d{1,8})\\b`, 'g');
    for (const match of text.matchAll(re)) { const row = {domain, code:Number(match[1])}; if(!domains.some(x=>x.domain===row.domain&&x.code===row.code)&&domains.length<16) domains.push(row); }
  }
  const reasons = [];
  for (const [reason, pattern] of [
    ['not_installed',/not installed|application.*(?:not found|unknown)/i],
    ['sandbox',/sandbox/i], ['entitlement',/entitlement/i], ['signature',/signature|code.?sign/i],
    ['unable_to_boot',/unable to boot|not booted|current state.*shutdown/i],
    ['request_denied',/request.*denied|permission denied|not authorized|operation not permitted/i],
    ['invalid_executable',/executable.*(?:missing|invalid|not found)|no such file/i],
    ['service_unavailable',/service.*unavailable|connection.*invalid/i],
    ['security',/reason:\s*Security|security policy|not trusted/i],
    ['launch_constraint',/launch constraint/i], ['architecture',/architecture|incompatible cpu/i],
    ['dynamic_linker',/dyld|library not loaded/i], ['invalid_argument',/invalid argument/i],
    ['process_exited',/process.*exited|failed to start|failed to launch/i]
  ]) if(pattern.test(text)) reasons.push(reason);
  return {exitCode:Number.isInteger(result.status)?result.status:null,timedOut:result.error?.code==='ETIMEDOUT',signal:['SIGKILL','SIGTERM','SIGABRT','SIGSEGV'].includes(result.signal)?result.signal:null,domains,reasons};
}
export function keySummary(value) {
  const object = value && typeof value==='object' && !Array.isArray(value) ? value : {};
  return {keys:KEYS.filter(k=>Object.hasOwn(object,k)),unlistedKeyCount:Object.keys(object).filter(k=>!KEYS.includes(k)).length};
}
export function infoSummary(info, app, exists=fs.existsSync) {
  const executable = info?.CFBundleExecutable;
  return {keys:['UIRequiredDeviceCapabilities','LSRequiresIPhoneOS','CFBundleExecutable'].filter(k=>Object.hasOwn(info||{},k)),bundleIdentifierMatches:info?.CFBundleIdentifier===BUNDLE_ID,executableMatches:typeof executable==='string'&&path.basename(executable)===executable&&exists(path.join(app,executable))};
}
function execute(cmd,args,input,timeout=15000) {return spawnSync(cmd,args,{input,encoding:'utf8',timeout,killSignal:'SIGKILL',maxBuffer:1024*1024});}
function plist(input) {const r=execute('plutil',['-convert','json','-o','-','-'],input); if(r.status!==0) throw Error('plist_unreadable'); return JSON.parse(r.stdout);}
export function probe(udid,app) {
  guardEnv();
  const out={schema:1,notReleaseEvidence:true};
  const list=execute('xcrun',['simctl','list','devices','-j']);
  try { const devices=Object.values(JSON.parse(list.stdout).devices).flat(); out.selectedDeviceBooted=devices.some(d=>d.udid===udid&&d.state==='Booted'); } catch {out.selectedDeviceBooted=false;}
  const info=execute('plutil',['-convert','json','-o','-',path.join(app,'Info.plist')]);
  try {out.info=infoSummary(JSON.parse(info.stdout),app);} catch {out.info={unreadable:true};}
  const signing=execute('codesign',['-dvv','--entitlements',':-',app]);
  out.signing=classify(signing);
  try {out.entitlements=keySummary(plist(extractPlistXml(signing.stdout+'\n'+signing.stderr)));} catch {out.entitlements={unreadable:true};}
  out.provisioning={present:fs.existsSync(path.join(app,'embedded.mobileprovision'))};
  if(out.provisioning.present) {
    const profile=execute('security',['cms','-D','-i',path.join(app,'embedded.mobileprovision')]);
    try {out.provisioning.entitlements=keySummary(plist(profile.stdout).Entitlements);} catch {out.provisioning.unreadable=true;}
  }
  const container=execute('xcrun',['simctl','get_app_container',udid,BUNDLE_ID,'app']);
  out.container={...classify(container),exists:container.status===0&&fs.existsSync(container.stdout.trim())};
  // Console may stay attached to a healthy app: timeout alone is NOT launch failure.
  out.launch=classify(execute('xcrun',['simctl','launch','--console-pty',udid,BUNDLE_ID],undefined,20000));
  // Restore a cold launch for the existing XCTest suite, without uninstalling or changing data.
  out.terminate=classify(execute('xcrun',['simctl','terminate',udid,BUNDLE_ID]));
  return out;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const [udid,app,destination]=process.argv.slice(2);
  try {const result=probe(udid,app);fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('ios_direct_launch_probe_collected');}
  catch {console.error('ios_direct_launch_probe_failed');process.exitCode=1;}
}
