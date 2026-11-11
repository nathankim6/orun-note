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
export const REQUIRED_RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-2';
function runtimeVersion(value) {
  if(typeof value==='number'&&Number.isInteger(value)&&value>=0)return value;
  if(typeof value!=='string'||!/^\d+\.\d+(?:\.\d+)?$/.test(value))return null;
  const [major,minor,patch=0]=value.split('.').map(Number);
  return minor<=255&&patch<=255?major*65536+minor*256+patch:null;
}
/** Never choose an arbitrary available/last iPad; only the explicitly configured type/runtime pair. */
export function selectCompatibleSimulator(runtimeList,typeList,preferredType) {
  const runtime=Array.isArray(runtimeList?.runtimes)?runtimeList.runtimes.find(row=>row?.identifier===REQUIRED_RUNTIME&&row.isAvailable===true&&runtimeVersion(row.version)===runtimeVersion('26.2')):null;
  if(!runtime)throw Error('runtime_unavailable');
  if(typeof preferredType!=='string'||!preferredType.startsWith('com.apple.CoreSimulator.SimDeviceType.iPad'))throw Error('compatible_device_unavailable');
  const type=Array.isArray(typeList?.devicetypes)?typeList.devicetypes.find(row=>row?.identifier===preferredType&&typeof row.name==='string'&&row.name.startsWith('iPad')&&(row.productFamily===undefined||row.productFamily==='iPad')):null;
  if(!type)throw Error('compatible_device_unavailable');
  const version=runtimeVersion(runtime.version);
  for(const [numeric,text,bound]of[['minRuntimeVersion','minRuntimeVersionString','min'],['maxRuntimeVersion','maxRuntimeVersionString','max']]) {
    const raw=type[numeric]??type[text];
    if(raw!==undefined){const limit=runtimeVersion(raw);if(limit===null||(bound==='min'?version<limit:version>limit))throw Error('compatible_device_unavailable');}
  }
  if(Array.isArray(runtime.supportedDeviceTypes)&&!runtime.supportedDeviceTypes.some(row=>row===preferredType||row?.identifier===preferredType))throw Error('compatible_device_unavailable');
  return {runtime,type};
}
/** Mirror native smoke's available-iPad preference, constrained to the exact requested runtime. */
export function selectPreconfiguredSimulator(runtimeList,typeList,deviceList) {
  const runtime=Array.isArray(runtimeList?.runtimes)?runtimeList.runtimes.find(row=>row?.identifier===REQUIRED_RUNTIME&&row.isAvailable===true&&runtimeVersion(row.version)===runtimeVersion('26.2')):null;
  if(!runtime)throw Error('runtime_unavailable');
  const sameRuntime=deviceList?.devices?.[runtime.identifier];
  const candidates=Array.isArray(sameRuntime)?sameRuntime.filter(row=>row?.isAvailable===true&&typeof row.name==='string'&&row.name.startsWith('iPad')):[];
  const preferred=candidates[0];
  if(!preferred||typeof preferred.deviceTypeIdentifier!=='string')throw Error('compatible_device_unavailable');
  const selected=selectCompatibleSimulator(runtimeList,typeList,preferred.deviceTypeIdentifier);
  return {...selected,candidateCount:Math.min(10000,candidates.length)};
}
export function classifyCreateError(result) {
  const safeText=value=>Buffer.isBuffer(value)?value.toString('utf8'):typeof value==='string'?value:'';
  const text=(safeText(result?.stdout)+'\n'+safeText(result?.stderr)).toLowerCase();
  if(/device type.*not supported|not supported.*runtime|incompatible.*runtime|runtime.*incompatible/.test(text))return 'incompatible_device_runtime';
  if(/invalid device type|device type.*not found|unable to find device type/.test(text))return 'device_type_unavailable';
  if(/invalid runtime|runtime.*not found|unable to find runtime/.test(text))return 'runtime_unavailable';
  if(/coresimulatorservice.*(?:unavailable|invalid|connection)|failed to connect to.*coresimulator/.test(text))return 'simulator_service_unavailable';
  if(/permission denied|operation not permitted/.test(text))return 'permission_denied';
  return 'unknown';
}
const COMMAND_LABELS=new Set(['sdk_path','list_runtimes','list_runtimes_cold','list_device_types','list_device_types_cold','list_available_devices','sim_create','sim_boot','sim_bootstatus','compile_probe','sign_probe','inspect_signature','install_probe','launch_probe','app_container','terminate_probe','uninstall_probe','shutdown_probe','delete_probe']);
const COMMAND_STAGES=new Set(['sdk_path','list_runtimes','list_runtimes_cold','list_device_types','list_device_types_cold','list_available_devices','select_device','create','boot','compile','sign','inspect','install','launch','result','cleanup']);
class ProbeCommandFailure extends Error { constructor(message,status){super(message);this.status=status;} }
export function executeProbeCommand({label,variant,stage,bin,args,budget=15000,deadline,cleanup=false,emit,query=spawnSync,now=Date.now}) {
  if(!COMMAND_LABELS.has(label)||!COMMAND_STAGES.has(stage)||!['shared','baseline','entitled'].includes(variant))throw Error('command_identity_invalid');
  if(!Number.isFinite(budget)||!Number.isInteger(budget)||budget<=0||budget>480000||!Number.isFinite(deadline))throw Error('command_budget_invalid');
  const before=now();if(!Number.isFinite(before))throw Error('command_budget_invalid');
  const remaining=cleanup?15000:deadline-before;
  const base={event:'keychain_probe_command',command:label,variant,stage,notNativeValidation:1};
  if(remaining<=0){emit({...base,status:'deadline',budgetMs:0,elapsedMs:0,stdoutBytes:0,stderrBytes:0});throw new ProbeCommandFailure('deadline','deadline');}
  const budgetMs=Math.max(1,Math.min(budget,remaining));let result;
  try{result=query(bin,args,{timeout:budgetMs,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe'],killSignal:'SIGKILL'});}catch{result={status:null,error:{code:'unknown'}};}
  const status=result?.error?.code==='ETIMEDOUT'?'timeout':result?.error?.code==='ENOBUFS'?'buffer':result?.status===0&&!result?.error?'ok':'nonzero';
  const count=value=>Math.min(4194304,Buffer.isBuffer(value)?value.length:typeof value==='string'?Buffer.byteLength(value):0);
  const row={...base,status,budgetMs,elapsedMs:Math.min(300000,Math.max(0,now()-before)),stdoutBytes:count(result?.stdout),stderrBytes:count(result?.stderr)};
  if(Number.isInteger(result?.status)&&result.status>=0&&result.status<=255)row.exitCode=result.status;
  if(label==='sim_create'&&status==='nonzero')row.createError=classifyCreateError(result);
  emit(row); // Immutable metadata BEFORE throwing; never arguments, paths or child output.
  if(status!=='ok')throw new ProbeCommandFailure(stage+'_failed',status);
  return Buffer.isBuffer(result.stdout)?result.stdout.toString('utf8').trim():typeof result.stdout==='string'?result.stdout.trim():'';
}
export function coldEnumeration(run,label) {
  // One explicit 60s cold-start comparison ONLY after an observed 15s timeout.
  try{return run(label,15000);}catch(error){if(error?.status!=='timeout')throw error;return run(label+'_cold',60000);}
}
export async function diagnostic() {
  const output='qa/output/ios-keychain-diagnostic.jsonl';fs.mkdirSync('qa/output',{recursive:true});fs.writeFileSync(output,'');
  const emit=row=>{const text=JSON.stringify({...row,notNativeValidation:1});fs.appendFileSync(output,text+'\n');console.log(text);};
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.IOS_SYNTHETIC_KEYCHAIN_DIAGNOSTIC!=='1') {emit({event:'keychain_probe_driver',variant:'shared',stage:'guard',status:'environment_not_ci'});return false;}
  // Fresh CoreSimulator cold OS boot only; not native-app/PDF/playback validation deadlines.
  const deadline=Date.now()+480000;let simulator,work,stage='sdk',variant='shared';
  const command=(label,bin,args,budget=15000,cleanup=false)=>executeProbeCommand({label,bin,args,budget,cleanup,deadline,emit,variant,stage:cleanup?'cleanup':stage});
  const cleanupCommand=(label,args)=>{try{command(label,'xcrun',args,10000,true);}catch{emit({event:'keychain_probe_driver',variant,stage:'cleanup',status:'cleanup_failed'});}};

  try {
    work=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-keychain-ci-'));
    stage='sdk_path';const sdk=command('sdk_path','xcrun',['--sdk','iphonesimulator','--show-sdk-path']);
    const runtimeList=JSON.parse(coldEnumeration((label,budget)=>{stage=label;return command(label,'xcrun',['simctl','list','runtimes','-j'],budget);},'list_runtimes'));
    const typeList=JSON.parse(coldEnumeration((label,budget)=>{stage=label;return command(label,'xcrun',['simctl','list','devicetypes','-j'],budget);},'list_device_types'));
    stage='list_available_devices';const deviceList=JSON.parse(command('list_available_devices','xcrun',['simctl','list','devices','available','-j']));
    stage='select_device';const {runtime,type,candidateCount}=selectPreconfiguredSimulator(runtimeList,typeList,deviceList);
    emit({event:'keychain_probe_simulator_selection',variant:'shared',stage:'select_device',status:'selected',source:'available_same_runtime_device',candidateCount});
    const seed=randomUUID().replaceAll('-',''),ids=makeIdentity(seed);
    stage='create';simulator=command('sim_create','xcrun',['simctl','create','SyntheticKeychain-'+seed,type.identifier,runtime.identifier]);
    if(!/^[0-9A-Fa-f-]{36}$/.test(simulator)){simulator=undefined;throw Error('create_failed');}
    stage='boot';command('sim_boot','xcrun',['simctl','boot',simulator]);command('sim_bootstatus','xcrun',['simctl','bootstatus',simulator,'-b'],180000);
    stage='compile';const binary=path.join(work,'KeychainProbe');
    command('compile_probe','xcrun',['--sdk','iphonesimulator','swiftc','-parse-as-library','-O','-sdk',sdk,'-target',(process.arch==='arm64'?'arm64':'x86_64')+'-apple-ios16.0-simulator','-framework','UIKit','-framework','Security','-Xlinker','-adhoc_codesign','scripts/native-ios-keychain-probe.swift','-o',binary],90000);
    for(const current of ['baseline','entitled']) {
      variant=current;
      try {
        const app=path.join(work,current+'.app');fs.mkdirSync(app);fs.copyFileSync(binary,path.join(app,'KeychainProbe'));
        fs.writeFileSync(path.join(app,'Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${ids[current]}</string><key>CFBundleExecutable</key><string>KeychainProbe</string><key>CFBundleName</key><string>SyntheticKeychainProbe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0</string><key>MinimumOSVersion</key><string>16.0</string><key>LSRequiresIPhoneOS</key><true/><key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array><key>UILaunchScreen</key><dict/></dict></plist>`);
        if(current==='entitled'){stage='sign';const file=path.join(work,'probe.entitlements');fs.writeFileSync(file,entitlements(ids[current]));command('sign_probe','codesign',['--force','--sign','-','--timestamp=none','--entitlements',file,app]);}
        stage='inspect';const flags=signingFlags(command('inspect_signature','codesign',['-d','--entitlements',':-',path.join(app,'KeychainProbe')]));
        emit({event:'keychain_probe_signing',variant,...flags});
        if(current==='baseline'&&(flags.applicationIdentifier||flags.keychainAccessGroups))throw Error('baseline_entitlements_unexpected');
        if(current==='entitled'&&(!flags.applicationIdentifier||!flags.keychainAccessGroups))throw Error('entitlements_missing');
        stage='install';command('install_probe','xcrun',['simctl','install',simulator,app],25000);
        stage='launch';command('launch_probe','xcrun',['simctl','launch',simulator,ids[current]],15000);
        stage='result';const container=command('app_container','xcrun',['simctl','get_app_container',simulator,ids[current],'data']);const file=path.join(container,'Documents/synthetic-keychain-result.json');const until=Math.min(deadline,Date.now()+20000);
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
        if(simulator){cleanupCommand('terminate_probe',['simctl','terminate',simulator,ids[current]]);cleanupCommand('uninstall_probe',['simctl','uninstall',simulator,ids[current]]);}
      }
    }
    emit({event:'keychain_probe_complete',status:'diagnostic_complete'});return true;
  } catch(error) {
    const known=new Set(['deadline','sdk_failed','sdk_path_failed','list_runtimes_failed','list_runtimes_cold_failed','list_device_types_failed','list_device_types_cold_failed','list_available_devices_failed','runtime_unavailable','compatible_device_unavailable','create_failed','boot_failed','compile_failed','simulator_unavailable']);
    emit({event:'keychain_probe_driver',variant,stage,status:known.has(error?.message)?error.message:'operation_failed'});return false;
  } finally {
    variant='shared';if(simulator){cleanupCommand('shutdown_probe',['simctl','shutdown',simulator]);cleanupCommand('delete_probe',['simctl','delete',simulator]);}
    if(work)fs.rmSync(work,{recursive:true,force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))diagnostic().then(ok=>{if(!ok)process.exitCode=1;}).catch(()=>{console.log(JSON.stringify({event:'keychain_probe_driver',variant:'shared',stage:'result',status:'operation_failed',notNativeValidation:1}));process.exitCode=1;});
