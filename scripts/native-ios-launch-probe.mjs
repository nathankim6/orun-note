// Direct platform probes, before XCTest. No raw command output is persisted or printed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardEnv, BUNDLE_ID, extractPlistXml, validateIdentity, signApp, verifyApp, SIGNING_VARIANTS } from './native-ios-signing.mjs';
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
export const EXIT_CLASSES = ['dyld_library_not_loaded','dyld_symbol_not_found','code_signature_invalid','rct_fatal_exception','unhandled_js_exception','hermes_error','keychain_error','sigabrt','sigsegv','other'];
const EXIT_PATTERNS = [/library not loaded|dyld.*missing.*library/i,/symbol not found|missing symbol/i,/code signature.*(?:invalid|not valid)|invalid.*code signature|code object is not signed|codesigning|signature.*rejected/i,/RCTFatalException/i,/Unhandled JS Exception/i,/hermes.*(?:error|exception|fatal)/i,/keychain.*(?:error|fail)|errSec[A-Z]/i,/SIGABRT|EXC_CRASH/i,/SIGSEGV|EXC_BAD_ACCESS/i];
const safeBase = value => { const base=path.basename(String(value||'')); return /^[A-Za-z0-9_.+-]{1,120}$/.test(base)?base:'other'; };
export function exitSummary(text) {
  text=String(text||'');
  const classes=EXIT_PATTERNS.flatMap((p,i)=>p.test(text)?[EXIT_CLASSES[i]]:[]);
  const missing=text.match(/Library not loaded:\s*([^\r\n]+)/i);
  return {classes:classes.length?classes:['other'],missingLibrary:missing?safeBase(missing[1].trim().replace(/^['"]|['"]$/g,'')):null};
}
export function frameworkSummary(name,result) {
  return {framework:safeBase(name),signed:result.status===0,adhoc:result.status===0&&/(?:^Signature=adhoc$|flags=0x[0-9a-f]+\([^)]*adhoc)/m.test(String(result.stdout||'')+'\n'+String(result.stderr||''))};
}
function safeSymbol(value) {
  const s=String(value||'');
  // Reject paths, addresses, messages and arbitrary punctuation, rather than laundering raw text.
  if(!/^[A-Za-z_+\-][A-Za-z0-9_:+\-.$<>(), *&~\[\]]{0,511}$/.test(s)||/0x[0-9a-f]+/i.test(s))return 'other';
  return s.slice(0,80);
}
export function crashSummary(raw) {
  const newline=raw.indexOf('\n');
  let header={},body;
  try {header=JSON.parse(raw.slice(0,newline));body=JSON.parse(raw.slice(newline+1));} catch {body=JSON.parse(raw);}
  const text=JSON.stringify(body), exception=body.exception||{},termination=body.termination||{};
  const fault=Number.isInteger(body.faultingThread)?body.threads?.[body.faultingThread]:body.threads?.find(t=>t.triggered);
  const names=['Error','TypeError','ReferenceError','SyntaxError','RangeError','URIError','EvalError','AggregateError','InternalError','InvariantViolation'];
  const marker=text.match(/(?:RCTFatalException|Unhandled JS Exception)[^A-Za-z]{0,24}([A-Za-z]+)(?=:|\\n|[^A-Za-z])/);
  return {exceptionType:/^EXC_[A-Z_]{1,40}$/.test(exception.type||'')?exception.type:null,
    signal:['SIGABRT','SIGSEGV','SIGKILL','SIGBUS','SIGILL','SIGTRAP','SIGTERM'].includes(exception.signal)?exception.signal:null,
    terminationNamespace:['DYLD','CODESIGNING','SIGNAL','FRONTBOARD','RUNNINGBOARD','SPRINGBOARD','LIBSYSTEM','TCC','WATCHDOG'].includes(termination.namespace)?termination.namespace:'other',
    terminationCode:Number.isSafeInteger(termination.code)?termination.code:null,
    terminationReason:exitSummary(Object.values(termination).filter(x=>typeof x==='string').join('\n')),
    frames:(fault?.frames||[]).slice(0,8).map(f=>({imageName:safeBase(body.usedImages?.[f.imageIndex]?.name||body.usedImages?.[f.imageIndex]?.path),symbol:safeSymbol(f.symbol)})),
    rctFatalException:/RCTFatalException/.test(text),unhandledJsException:/Unhandled JS Exception/.test(text),jsErrorName:marker&&names.includes(marker[1])?marker[1]:null};
}
export function newestCrash(directory,since,udid) {
  try {
    const reports=fs.readdirSync(directory).filter(n=>n.endsWith('.ips')).map(n=>({file:path.join(directory,n),mtime:fs.statSync(path.join(directory,n)).mtimeMs})).filter(x=>x.mtime>=since).sort((a,b)=>b.mtime-a.mtime);
    for(const report of reports) {
      if(fs.statSync(report.file).size>8*1024*1024)continue;
      const raw=fs.readFileSync(report.file,'utf8');let body,header;
      try {const i=raw.indexOf('\n');header=JSON.parse(raw.slice(0,i));body=JSON.parse(raw.slice(i+1));}catch{continue;}
      if((body.bundleInfo?.CFBundleIdentifier!==BUNDLE_ID&&header.bundleID!==BUNDLE_ID)||!String(body.procPath||'').includes('/'+udid+'/'))continue;
      return {found:true,...crashSummary(raw)};
    }
    return {found:false};
  }catch{return {found:false,collectionError:true};}
}
function installedSigning(app) {
  const frameworks=path.join(app,'Frameworks');
  return {deepStrict:classify(execute('codesign',['--verify','--deep','--strict',app])),frameworks:fs.existsSync(frameworks)?fs.readdirSync(frameworks).filter(n=>n.endsWith('.framework')).sort().map(n=>frameworkSummary(n,execute('codesign',['-dvv',path.join(frameworks,n)]))):[]};
}
export function resignCandidate(app,work,variant='V4') {
  guardEnv();
  const info=JSON.parse(execute('plutil',['-convert','json','-o','-',path.join(app,'Info.plist')]).stdout);validateIdentity(info);
  if(!infoSummary(info,app).executableMatches)throw Error('candidate_invalid_executable');
  const frameworks=path.join(app,'Frameworks');
  const targets=fs.existsSync(frameworks)?fs.readdirSync(frameworks).filter(n=>n.endsWith('.framework')).sort().map(n=>path.join(frameworks,n)):[];
  targets.push(path.join(app,info.CFBundleExecutable));
  for(const target of targets) {const r=execute('codesign',['--force','--sign','-','--timestamp=none',target],undefined,60000);if(r.status!==0||r.error)throw Error('candidate_signing_failed');}
  signApp(app,work,variant);verifyApp(app,variant);
  const verify=execute('codesign',['--verify','--deep','--strict',app]);if(verify.status!==0||verify.error)throw Error('candidate_deep_verify_failed');
}
function execute(cmd,args,input,timeout=15000) {return spawnSync(cmd,args,{input,encoding:'utf8',timeout,killSignal:'SIGKILL',maxBuffer:1024*1024});}
function plist(input) {const r=execute('plutil',['-convert','json','-o','-','-'],input); if(r.status!==0) throw Error('plist_unreadable'); return JSON.parse(r.stdout);}
export function probe(udid,app,variant='V4') {
  guardEnv();
  const out={schema:2,notReleaseEvidence:true};
  const list=execute('xcrun',['simctl','list','devices','-j']);
  try { const devices=Object.values(JSON.parse(list.stdout).devices).flat(); out.selectedDeviceBooted=devices.some(d=>d.udid===udid&&d.state==='Booted'); } catch {out.selectedDeviceBooted=false;}
  const info=execute('plutil',['-convert','json','-o','-',path.join(app,'Info.plist')]);
  try {out.info=infoSummary(JSON.parse(info.stdout),app);} catch {out.info={unreadable:true};}
  const signing=execute('codesign',['-dvv','--entitlements',':-',app]);
  out.signing=classify(signing);
  try {out.entitlements=keySummary(plist(extractPlistXml(signing.stdout+'\n'+signing.stderr)));} catch {out.entitlements=variant==='V1'&&signing.status===0&&!/<plist|bplist|<key>/.test(signing.stdout+'\n'+signing.stderr)?keySummary({}):{unreadable:true};}
  out.provisioning={present:fs.existsSync(path.join(app,'embedded.mobileprovision'))};
  if(out.provisioning.present) {
    const profile=execute('security',['cms','-D','-i',path.join(app,'embedded.mobileprovision')]);
    try {out.provisioning.entitlements=keySummary(plist(profile.stdout).Entitlements);} catch {out.provisioning.unreadable=true;}
  }
  const container=execute('xcrun',['simctl','get_app_container',udid,BUNDLE_ID,'app']);
  out.container={...classify(container),exists:container.status===0&&fs.existsSync(container.stdout.trim())};
  if(out.container.exists) {
    verifyApp(container.stdout.trim(),variant);
    out.installedSigning=installedSigning(container.stdout.trim());
    out.installedVariantVerified=true;
  }
  const startedAt=Date.now();
  // Console may stay attached to a healthy app: timeout alone is NOT launch failure.
  const launched=execute('xcrun',['simctl','launch','--console-pty',udid,BUNDLE_ID],undefined,20000);
  out.launch={...classify(launched),console:exitSummary(String(launched.stdout||'')+'\n'+String(launched.stderr||''))};
  spawnSync('sleep',['3']);
  out.crash=newestCrash(path.join(os.homedir(),'Library/Logs/DiagnosticReports'),startedAt,udid);
  // Restore a cold launch for the existing XCTest suite, without uninstalling or changing data.
  out.terminate=classify(execute('xcrun',['simctl','terminate',udid,BUNDLE_ID]));
  return out;
}
export function launchedSuccessfully(out) {
  return out.installedVariantVerified===true && out.installedSigning?.deepStrict.exitCode===0 && !out.installedSigning.deepStrict.timedOut && out.crash?.found===false && !out.crash.collectionError && (out.launch?.exitCode===0 || out.launch?.timedOut===true) && out.terminate?.exitCode===0 && !out.terminate.timedOut && out.launch.domains.length===0;
}
export function runMatrix(udid,app,destination) {
  guardEnv();
  const result={schema:3,notReleaseEvidence:true,variants:[],selectedVariant:null};
  const save=()=>fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  const clean=()=>({terminate:classify(execute('xcrun',['simctl','terminate',udid,BUNDLE_ID])),uninstall:classify(execute('xcrun',['simctl','uninstall',udid,BUNDLE_ID]))});
  try {
    result.initialCleanup=clean();
    for(const variant of SIGNING_VARIANTS) {
      const row={variant,stage:'sign',launched:false};result.variants.push(row);save();
      try {
        resignCandidate(app,path.dirname(destination),variant);row.signatureVerified=true;
        row.stage='install';const install=execute('xcrun',['simctl','install',udid,app],undefined,60000);row.install=classify(install);
        if(install.status!==0||install.error)throw Error('install_failed');
        row.stage='probe';row.probe=probe(udid,app,variant);row.launched=launchedSuccessfully(row.probe);
        if(row.launched&&!result.selectedVariant)result.selectedVariant=variant;
        row.stage='complete';
      } catch {row.failed=true;} finally {row.cleanup=clean();save();}
      if(row.cleanup.uninstall.exitCode!==0)throw Error('variant_cleanup_failed');
    }
    if(!result.selectedVariant)throw Error('no_launching_variant');
    resignCandidate(app,path.dirname(destination),result.selectedVariant);
    const install=execute('xcrun',['simctl','install',udid,app],undefined,60000);result.selectedInstall=classify(install);
    if(install.status!==0||install.error)throw Error('selected_install_failed');
    const container=execute('xcrun',['simctl','get_app_container',udid,BUNDLE_ID,'app']);
    if(container.status!==0||container.error||!fs.existsSync(container.stdout.trim()))throw Error('selected_container_missing');
    verifyApp(container.stdout.trim(),result.selectedVariant);result.selectedInstalledVerified=true;save();
    console.log('ios_signing_matrix_collected');
  } catch {result.failed=true;save();throw Error('ios_signing_matrix_failed');}
  return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {runMatrix(...process.argv.slice(2));}catch {console.error('ios_signing_matrix_failed');process.exitCode=1;}
}
