// Standalone environment evidence only. No app install/build/login, dismissal,
// security changes, raw logging or native-validation result is produced.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const COMMANDS = [
  {command:'boot',args:['shell','getprop','sys.boot_completed'],budget:8000},
  {command:'bootanim',args:['shell','getprop','init.svc.bootanim'],budget:8000},
  {command:'system_ui_pid',args:['shell','pidof','com.android.systemui'],budget:8000},
  {command:'window',args:['shell','dumpsys','window'],budget:12000},
  {command:'wm_size',args:['shell','wm','size'],budget:8000},
  {command:'wm_density',args:['shell','wm','density'],budget:8000},
  {command:'uia_dump',args:['shell','uiautomator','dump','/data/local/tmp/native-emulator-diagnostic.xml'],budget:30000},
  {command:'uia_xml',args:['shell','cat','/data/local/tmp/native-emulator-diagnostic.xml'],budget:8000},
];
const safeText = value => Buffer.isBuffer(value)?value.toString('utf8'):typeof value==='string'?value:'';
const bytes = value => Math.min(4194304,Buffer.isBuffer(value)?value.length:typeof value==='string'?Buffer.byteLength(value):0);
export function commandStatus(result) {
  if(result?.error?.code==='ETIMEDOUT')return 'timeout';
  if(result?.error?.code==='ENOBUFS')return 'buffer';
  return result?.status===0&&!result?.error?'ok':'nonzero';
}
function focusSummary(text) {
  const current=text.split('\n').find(line=>line.includes('mCurrentFocus='));
  const display=text.split('\n').find(line=>line.includes('mFocusedWindow='));
  const line=current??display??'';
  const focusSource=current?'current_window':display?'focused_window':'none';
  const focus=!line||/(?:mCurrentFocus|mFocusedWindow)=null/.test(line)?'missing':/com\.paperly\.study\//.test(line)?'app':/(?:com\.android\.launcher3|com\.google\.android\.apps\.nexuslauncher|com\.sec\.android\.app\.launcher)\//.test(line)?'launcher':/com\.(?:google\.android|android)\.permissioncontroller\//.test(line)?'permission':/(?:com\.android\.systemui|android)\//.test(line)?'system_dialog':'unknown';
  return {focus,focusSource};
}
function xmlSummary(text, fresh) {
  if(!fresh)return {xmlState:'not_fresh'};
  const nodes=[...text.matchAll(/<node\b[^>]*>/g)].slice(0,10000).map(([node])=>Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v])=>[k,v.replaceAll('&apos;',"'").replaceAll('&#8217;','’')])));
  const os=nodes.filter(n=>['android','com.android.systemui','com.google.android.gms'].includes(n.package));
  const osId=id=>os.some(n=>n['resource-id']===id);
  const anr=osId('android:id/aerr_wait')||osId('android:id/anr_wait');
  const title=os.some(n=>["System UI isn't responding",'System UI isn’t responding'].includes(n.text));
  let dialog='none';
  if(anr)dialog=title?'system_ui_anr':'app_anr';
  else if(osId('android:id/aerr_close')||osId('android:id/aerr_restart'))dialog=os.some(n=>/Google Play services|Google Play 서비스/.test(n.text??''))?'gms_crash':'app_crash';
  else if(nodes.some(n=>['com.android.permissioncontroller','com.google.android.permissioncontroller'].includes(n.package)))dialog='permission';
  else if(os.some(n=>/:id\/(?:keyguard_status_view|lockscreen_clock_view)$/.test(n['resource-id']??'')))dialog='keyguard';
  else if(osId('android:id/alertTitle')||osId('android:id/button1'))dialog='unknown';
  return {xmlState:nodes.length?'nodes':'empty',nodeCount:nodes.length,dialog};
}
export function commandObservation(command, text, fresh=true) {
  const value=text.trim();
  if(command==='boot')return {boot:value==='1'?'complete':value==='0'?'incomplete':!value?'empty':'other'};
  if(command==='bootanim')return {bootanim:['stopped','running'].includes(value)?value:!value?'empty':'other'};
  if(command==='system_ui_pid')return {systemUiAlive:/^\d+(?:\s+\d+)*$/.test(value)};
  if(command==='window')return focusSummary(text);
  if(command==='wm_size') {
    const match=[...text.matchAll(/^(?:Physical|Override) size: (\d{1,5})x(\d{1,5})\s*$/gm)].at(-1);
    return match&&+match[1]>0&&+match[1]<=16384&&+match[2]>0&&+match[2]<=16384?{sizeState:'known',width:+match[1],height:+match[2]}:{sizeState:'unknown'};
  }
  if(command==='wm_density') {
    const match=[...text.matchAll(/^(?:Physical|Override) density: (\d{1,4})\s*$/gm)].at(-1);
    return match&&+match[1]>=40&&+match[1]<=1000?{densityState:'known',density:+match[1]}:{densityState:'unknown'};
  }
  if(command==='uia_xml')return xmlSummary(text,fresh);
  return {};
}
export function runEmulatorDiagnostic({query,write,now=()=>performance.now(),apiLevel=0}) {
  const api=[35,36].includes(apiLevel)?apiLevel:0,start=now(),deadline=start+120000;
  const counts={ok:0,timeout:0,nonzero:0,buffer:0,deadline:0};let fresh=false;
  write({event:'emulator_diagnostic_start',apiLevel:api,notNativeValidation:1});
  for(const spec of COMMANDS) {
    const remaining=deadline-now();
    if(remaining<=0){counts.deadline++;write({event:'emulator_diagnostic_command',command:spec.command,status:'deadline',budgetMs:0,elapsedMs:0,stdoutBytes:0,stderrBytes:0});continue;}
    const budgetMs=Math.max(1,Math.floor(Math.min(spec.budget,remaining))),before=now();let result;
    try{result=query(spec.args,budgetMs);}catch{result={status:null,error:{code:'unknown'}};}
    const status=commandStatus(result),elapsedMs=Math.min(120000,Math.max(0,now()-before));counts[status]++;
    const row={event:'emulator_diagnostic_command',command:spec.command,status,budgetMs,elapsedMs,stdoutBytes:bytes(result?.stdout),stderrBytes:bytes(result?.stderr)};
    if(Number.isInteger(result?.status)&&result.status>=0&&result.status<=255)row.exitCode=result.status;
    if(spec.command==='uia_dump')fresh=status==='ok';
    if(status==='ok')Object.assign(row,commandObservation(spec.command,safeText(result.stdout),fresh));
    write(row); // Preserve every earlier observation; no last-snapshot replacement.
  }
  write({event:'emulator_diagnostic_complete',apiLevel:api,notNativeValidation:1,elapsedMs:Math.min(120000,Math.max(0,now()-start)),...counts});
  return counts; // Diagnostic completion is not OS readiness or app validation.
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runEmulatorDiagnostic({apiLevel:Number(process.env.EMULATOR_DIAGNOSTIC_API_LEVEL),write:row=>console.log(JSON.stringify(row)),query:(args,timeout)=>spawnSync('adb',args,{timeout,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe'],killSignal:'SIGKILL'})});
}
