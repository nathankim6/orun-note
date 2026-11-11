import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function classifyPreflight(xml, window) {
  const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(([node])=>Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v])=>[k,v.replaceAll('&apos;',"'").replaceAll('&#8217;','’').replaceAll('&quot;','"')])));
  const os = nodes.filter(n=>['android','com.android.systemui'].includes(n.package));
  const anr = os.some(n=>['android:id/aerr_wait','android:id/anr_wait'].includes(n['resource-id']));
  const systemTitle = os.some(n=>["System UI isn't responding",'System UI isn’t responding'].includes(n.text) || ["System UI isn't responding",'System UI isn’t responding'].includes(n['content-desc']));
  if (anr && systemTitle) return 'emulator_system_ui_anr';
  if (anr) return 'emulator_app_anr';
  if (os.some(n=>['android:id/aerr_close','android:id/aerr_restart'].includes(n['resource-id']))) return 'emulator_app_crash';
  const focus=window.split('\n').find(s=>s.includes('mCurrentFocus=')&&!s.includes('mCurrentFocus=null')) ?? '';
  if (/mShowingLockscreen=true|mKeyguardShowing=true|isStatusBarKeyguard=true/.test(window) || /com\.(?:google\.android|android)\.permissioncontroller\//.test(focus) || /Waiting [Ff]or [Dd]ebugger|GestureSandboxActivity|GestureTutorialActivity/.test(focus)) return 'emulator_os_blocked';
  if (/(?:com\.paperly\.study|com\.android\.launcher3|com\.google\.android\.apps\.nexuslauncher|com\.sec\.android\.app\.launcher)\//.test(focus) && nodes.length) return 'ready';
  return 'waiting';
}
export async function preflight(query, emit, pause = ms=>new Promise(r=>setTimeout(r,ms)), now=Date.now) {
  const deadline=now()+60000; let stable=0;
  while(now()<deadline) {
    const get=(...args)=>{try{return query(args,Math.max(1,Math.min(6000,deadline-now()))).trim();}catch{return '';}};
    const boot=get('shell','getprop','sys.boot_completed'), animation=get('shell','getprop','init.svc.bootanim'), pid=get('shell','pidof','com.android.systemui');
    get('shell','uiautomator','dump','/data/local/tmp/qa-preflight.xml');
    const state=classifyPreflight(get('shell','cat','/data/local/tmp/qa-preflight.xml'),get('shell','dumpsys','window','windows'));
    if(state.startsWith('emulator_')) { emit(state); return false; } // Never retry/dismiss an observed ANR/dialog.
    if(boot==='1' && animation==='stopped' && /^\d+(?:\s+\d+)*$/.test(pid) && state==='ready') {
      const size=get('shell','wm','size'), density=get('shell','wm','density');
      if(!/(?:Override|Physical) size: 1280x800(?:\s|$)/.test(size) || !/(?:Override|Physical) density: 160(?:\s|$)/.test(density)) { emit('emulator_display_mismatch'); return false; }
      if(++stable>=2) { emit('ready'); return true; }
    } else stable=0;
    if(now()<deadline) await pause(Math.min(500,deadline-now()));
  }
  emit('emulator_os_not_ready'); return false;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const phase=process.argv[2]==='before_install'?'before_install':'before_start';
  const ok=await preflight((args,timeout)=>execFileSync('adb',args,{encoding:'utf8',timeout,maxBuffer:2*1024*1024}),reason=>{
    console.log('QA_JSON '+JSON.stringify({event:'emulator_preflight',phase,result:reason==='ready'?'pass':'fail',reason}));
    if(reason!=='ready')console.log('QA_JSON '+JSON.stringify({event:'suite_result',platform:'android',result:'fail',reason}));
  }); if(!ok)process.exitCode=1;
}
