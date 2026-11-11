// CI-only fresh-simulator experiment, NOT RN/native-app validation. No host
// keychain/security CLI, credentials, provisioning, app data or production signing.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const STATUS=new Set(['success','item_not_found','duplicate_item','missing_entitlement','interaction_not_allowed','parameter','not_available','authentication_failed','unknown','not_attempted']);
export function sanitizeProbeRows(rows,variant) {
  if(!['baseline','entitled'].includes(variant)||!Array.isArray(rows))return [];
  const output=[];
  for(const row of rows.slice(0,8)) {
    if(!row||!['lookup','add','verify','delete'].includes(row.operation)||!STATUS.has(row.status))continue;
    const clean={event:'simulator_keychain_probe',variant,operation:row.operation,status:row.status,notNativeValidation:1};
    if(row.operation==='verify') {if([0,1].includes(row.matchesSynthetic))clean.matchesSynthetic=row.matchesSynthetic;if([0,32].includes(row.byteCount))clean.byteCount=row.byteCount;}
    output.push(clean);
  }
  return output;
}
export function makeIdentity(seed) {
  if(!/^[a-f0-9]{32}$/.test(seed))throw Error('identity_invalid');
  return {baseline:`com.paperly.syntheticprobe.p${seed}.baseline`,entitled:`com.paperly.syntheticprobe.p${seed}.entitled`};
}
export function entitlements(bundle) {
  if(!/^com\.paperly\.syntheticprobe\.p[a-f0-9]{32}\.(?:baseline|entitled)$/.test(bundle))throw Error('identity_invalid');
  const id='QADIAG0001.'+bundle; // Synthetic prefix, not a real developer account.
  return `<?xml version="1.0"?><plist version="1.0"><dict><key>application-identifier</key><string>${id}</string><key>keychain-access-groups</key><array><string>${id}</string></array></dict></plist>`;
}
export function signingFlags(text) {
  return {applicationIdentifier: /<key>application-identifier<\/key>/.test(text)?1:0,keychainAccessGroups:/<key>keychain-access-groups<\/key>/.test(text)?1:0};
}
export async function diagnostic() {
  const output='qa/output/ios-keychain-diagnostic.jsonl';fs.mkdirSync('qa/output',{recursive:true});fs.writeFileSync(output,'');
  const emit=row=>{const text=JSON.stringify({...row,notNativeValidation:1});fs.appendFileSync(output,text+'\n');console.log(text);};
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.IOS_SYNTHETIC_KEYCHAIN_DIAGNOSTIC!=='1') {emit({event:'keychain_probe_driver',variant:'shared',stage:'guard',status:'environment_not_ci'});return false;}
  const deadline=Date.now()+300000;let simulator,work,stage='sdk',variant='shared';
  const command=(bin,args,budget=15000,cleanup=false)=>{
    const remaining=cleanup?15000:deadline-Date.now();if(remaining<=0)throw Error('deadline');
    const result=spawnSync(bin,args,{timeout:Math.max(1,Math.min(budget,remaining)),maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe'],killSignal:'SIGKILL'});
    if(result.error||result.status!==0)throw Error(stage+'_failed');
    return result.stdout?.toString('utf8').trim()??'';
  };
  const cleanupCommand=(args)=>{try{command('xcrun',args,10000,true);}catch{emit({event:'keychain_probe_driver',variant,stage:'cleanup',status:'cleanup_failed'});}};
  try {
    work=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-keychain-ci-'));
    const sdk=command('xcrun',['--sdk','iphonesimulator','--show-sdk-path']);
    const runtime=JSON.parse(command('xcrun',['simctl','list','runtimes','-j'])).runtimes.find(r=>r.isAvailable&&r.identifier.endsWith('iOS-26-2'));
    const type=JSON.parse(command('xcrun',['simctl','list','devicetypes','-j'])).devicetypes.filter(d=>d.name.startsWith('iPad')).at(-1);
    if(!runtime||!type)throw Error('simulator_unavailable');
    const seed=randomUUID().replaceAll('-',''),ids=makeIdentity(seed);
    stage='create';simulator=command('xcrun',['simctl','create','SyntheticKeychain-'+seed,type.identifier,runtime.identifier]);
    if(!/^[0-9A-Fa-f-]{36}$/.test(simulator)){simulator=undefined;throw Error('create_failed');}
    stage='boot';command('xcrun',['simctl','boot',simulator]);command('xcrun',['simctl','bootstatus',simulator,'-b'],60000);
    stage='compile';const binary=path.join(work,'KeychainProbe');
    command('xcrun',['--sdk','iphonesimulator','swiftc','-parse-as-library','-O','-sdk',sdk,'-target',(process.arch==='arm64'?'arm64':'x86_64')+'-apple-ios16.0-simulator','-framework','UIKit','-framework','Security','-Xlinker','-adhoc_codesign','scripts/native-ios-keychain-probe.swift','-o',binary],90000);
    for(const current of ['baseline','entitled']) {
      variant=current;
      try {
        const app=path.join(work,current+'.app');fs.mkdirSync(app);fs.copyFileSync(binary,path.join(app,'KeychainProbe'));
        fs.writeFileSync(path.join(app,'Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${ids[current]}</string><key>CFBundleExecutable</key><string>KeychainProbe</string><key>CFBundleName</key><string>SyntheticKeychainProbe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0</string><key>MinimumOSVersion</key><string>16.0</string><key>LSRequiresIPhoneOS</key><true/><key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array><key>UILaunchScreen</key><dict/></dict></plist>`);
        if(current==='entitled'){stage='sign';const file=path.join(work,'probe.entitlements');fs.writeFileSync(file,entitlements(ids[current]));command('codesign',['--force','--sign','-','--timestamp=none','--entitlements',file,app]);}
        stage='inspect';const flags=signingFlags(command('codesign',['-d','--entitlements',':-',path.join(app,'KeychainProbe')]));
        emit({event:'keychain_probe_signing',variant,...flags});
        if(current==='baseline'&&(flags.applicationIdentifier||flags.keychainAccessGroups))throw Error('baseline_entitlements_unexpected');
        if(current==='entitled'&&(!flags.applicationIdentifier||!flags.keychainAccessGroups))throw Error('entitlements_missing');
        stage='install';command('xcrun',['simctl','install',simulator,app],25000);
        stage='launch';command('xcrun',['simctl','launch',simulator,ids[current]],15000);
        stage='result';const container=command('xcrun',['simctl','get_app_container',simulator,ids[current],'data']);const file=path.join(container,'Documents/synthetic-keychain-result.json');const until=Math.min(deadline,Date.now()+20000);
        while(!fs.existsSync(file)&&Date.now()<until)await new Promise(r=>setTimeout(r,200));
        if(!fs.existsSync(file))throw Error('result_missing');
        const rows=sanitizeProbeRows(JSON.parse(fs.readFileSync(file,'utf8')),current);
        if(rows.length!==4||rows.map(r=>r.operation).join(',')!=='lookup,add,verify,delete')throw Error('result_invalid');
        for(const row of rows)emit(row);
        emit({event:'keychain_probe_driver',variant,stage:'result',status:'collected'});
      } catch(error) {
        const known=new Set(['deadline','sign_failed','inspect_failed','install_failed','launch_failed','result_failed','result_missing','result_invalid','baseline_entitlements_unexpected','entitlements_missing']);
        emit({event:'keychain_probe_driver',variant,stage,status:known.has(error?.message)?error.message:'operation_failed'});
      } finally {
        if(simulator){cleanupCommand(['simctl','terminate',simulator,ids[current]]);cleanupCommand(['simctl','uninstall',simulator,ids[current]]);}
      }
    }
    emit({event:'keychain_probe_complete',status:'diagnostic_complete'});return true;
  } catch(error) {
    const known=new Set(['deadline','sdk_failed','create_failed','boot_failed','compile_failed','simulator_unavailable']);
    emit({event:'keychain_probe_driver',variant,stage,status:known.has(error?.message)?error.message:'operation_failed'});return false;
  } finally {
    variant='shared';if(simulator){cleanupCommand(['simctl','shutdown',simulator]);cleanupCommand(['simctl','delete',simulator]);}
    if(work)fs.rmSync(work,{recursive:true,force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))diagnostic().then(ok=>{if(!ok)process.exitCode=1;}).catch(()=>{console.log(JSON.stringify({event:'keychain_probe_driver',variant:'shared',stage:'result',status:'operation_failed',notNativeValidation:1}));process.exitCode=1;});
