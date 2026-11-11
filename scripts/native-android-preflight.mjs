import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function preflightFocus(window, activity = '') {
  const current=window.split('\n').find(s=>/mCurrentFocus=/.test(s));
  const display=window.split('\n').find(s=>/mFocusedWindow=/.test(s));
  // Explicit null/unknown window focus is not permission to trust a stale activity.
  const line=current ?? display ?? activity.split('\n').find(s=>/topResumedActivity=|mResumedActivity:/.test(s)) ?? '';
  const source=current?'window':display?'display':line?'activity':'none';
  const kind=/com\.paperly\.study\//.test(line)?'app':/(?:com\.android\.launcher3|com\.google\.android\.apps\.nexuslauncher|com\.sec\.android\.app\.launcher)\//.test(line)?'launcher':/com\.(?:google\.android|android)\.permissioncontroller\//.test(line)?'blocked':!line || /(?:mCurrentFocus|mFocusedWindow)=null/.test(line)?'missing':'unknown';
  return {source,kind,ready:kind==='app'||kind==='launcher'};
}
export function classifyPreflight(xml, window, activity = '') {
  const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(([node])=>Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v])=>[k,v.replaceAll('&apos;',"'").replaceAll('&#8217;','’').replaceAll('&quot;','"')])));
  const os = nodes.filter(n=>['android','com.android.systemui'].includes(n.package));
  const anr = os.some(n=>['android:id/aerr_wait','android:id/anr_wait'].includes(n['resource-id']));
  const systemTitle = os.some(n=>["System UI isn't responding",'System UI isn’t responding'].includes(n.text) || ["System UI isn't responding",'System UI isn’t responding'].includes(n['content-desc']));
  if (anr && systemTitle) return 'emulator_system_ui_anr';
  if (anr) return 'emulator_app_anr';
  if (os.some(n=>['android:id/aerr_close','android:id/aerr_restart'].includes(n['resource-id']))) return 'emulator_app_crash';
  const focus=preflightFocus(window,activity);
  if (/mShowingLockscreen=true|mKeyguardShowing=true|isStatusBarKeyguard=true/.test(window) || os.some(n=>/:id\/(?:keyguard_status_view|lockscreen_clock_view)$/.test(n['resource-id']??'')) || focus.kind==='blocked' || /Waiting [Ff]or [Dd]ebugger|GestureSandboxActivity|GestureTutorialActivity/.test(window+'\n'+activity) || nodes.some(n=>['com.android.permissioncontroller','com.google.android.permissioncontroller'].includes(n.package)) || os.some(n=>['android:id/alertTitle','android:id/button1'].includes(n['resource-id']))) return 'emulator_os_blocked';
  if (focus.ready && nodes.length) return 'ready';
  return 'waiting';
}
export function preflightMode(env) {
  return {githubActions:env.GITHUB_ACTIONS==='true',configuredNoBootAnimation:env.NATIVE_SMOKE_BOOT_ANIMATION_DISABLED==='1'};
}
export async function preflight(query, emit, pause = ms=>new Promise(r=>setTimeout(r,ms)), now=Date.now, mode={}) {
  const deadline=now()+60000; let stable=0, last={};
  const fail=reason=>{emit(reason,last);return false;};
  const get=(args,budget=6000)=>{const remaining=deadline-now();if(remaining<=0)return {ok:false,value:''};try{return {ok:true,value:query(args,Math.max(1,Math.min(budget,remaining))).trim()};}catch{return {ok:false,value:''};}};
  const qemu=mode.githubActions===true?get(['shell','getprop','ro.kernel.qemu']):{ok:false,value:''};
  const ciEmulator=mode.githubActions===true&&qemu.ok&&qemu.value==='1';
  // Normal wake only: no power toggle, unlock, dismissal or security setting.
  // Included in the existing 60s budget; not evidence that sleep caused null-root.
  if(ciEmulator)get(['shell','input','keyevent','KEYCODE_WAKEUP']);
  while(now()<deadline) {
    const boot=get(['shell','getprop','sys.boot_completed']), animation=get(['shell','getprop','init.svc.bootanim']), pid=get(['shell','pidof','com.android.systemui']);
    // Never accept a stale XML file if a cold UIAutomator dump times out/fails.
    const removed=get(['shell','rm','-f','/data/local/tmp/qa-preflight.xml']);
    const dump=get(['shell','uiautomator','dump','/data/local/tmp/qa-preflight.xml'],12000);
    const xml=removed.ok&&dump.ok?get(['shell','cat','/data/local/tmp/qa-preflight.xml']):{ok:false,value:''};
    const window=get(['shell','dumpsys','window']); // Unscoped dump includes focus; `window windows` can omit it.
    const activity=window.ok&&window.value&&preflightFocus(window.value).source==='none'?get(['shell','dumpsys','activity','activities']):{value:''};
    const focus=preflightFocus(window.value,activity.value);
    const state=classifyPreflight(xml.value,window.value,activity.value);
    const size=get(['shell','wm','size']), density=get(['shell','wm','density']);
    // The last effective override wins; a matching physical size must not hide a bad override.
    const sizeMatch=[...size.value.matchAll(/(?:Override|Physical) size: (\d+x\d+)/g)].at(-1)?.[1];
    const densityMatch=[...density.value.matchAll(/(?:Override|Physical) density: (\d+)/g)].at(-1)?.[1];
    last={bootComplete:boot.value==='1',bootAnimationStopped:animation.ok&&animation.value==='stopped',bootAnimationDisabled:ciEmulator&&mode.configuredNoBootAnimation===true&&animation.ok&&animation.value==='',systemUiAlive:/^\d+(?:\s+\d+)*$/.test(pid.value),xmlDumpSucceeded:removed.ok&&dump.ok,xmlPresent:xml.ok&&/<node\b/.test(xml.value),focusReady:focus.ready,displayReady:sizeMatch==='1280x800'&&densityMatch==='160',focusSource:focus.source,focusKind:focus.kind};
    const criteria={boot:last.bootComplete,bootanim:last.bootAnimationStopped||last.bootAnimationDisabled,pid:last.systemUiAlive,xml:last.xmlDumpSucceeded&&last.xmlPresent,focus:last.focusReady,display:last.displayReady};
    last.missing=Object.entries(criteria).filter(([,ok])=>!ok).map(([key])=>key);
    if(state.startsWith('emulator_'))return fail(state); // Never retry/dismiss observed ANR/dialog.
    if(last.bootComplete&&(last.bootAnimationStopped||last.bootAnimationDisabled)&&last.systemUiAlive&&last.xmlDumpSucceeded&&last.xmlPresent&&state==='ready') {
      if(!last.displayReady)return fail('emulator_display_mismatch');
      if(++stable>=2){emit('ready',last);return true;}
    } else stable=0;
    if(now()<deadline)await pause(Math.min(500,deadline-now()));
  }
  return fail('emulator_os_not_ready');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const phase=process.argv[2]==='before_install'?'before_install':'before_start';
  const ok=await preflight((args,timeout)=>execFileSync('adb',args,{encoding:'utf8',timeout,maxBuffer:2*1024*1024}),(reason,criteria)=>{
    console.log('QA_JSON '+JSON.stringify({event:'emulator_preflight',phase,result:reason==='ready'?'pass':'fail',reason,...(typeof criteria?.bootAnimationDisabled==='boolean'?{bootAnimationDisabled:criteria.bootAnimationDisabled}:{})}));
    if(reason!=='ready'){
      console.log('QA_JSON '+JSON.stringify({event:'emulator_readiness',phase,...criteria}));
      console.log('QA_JSON '+JSON.stringify({event:'suite_result',platform:'android',result:'fail',reason}));
    }
  },undefined,undefined,preflightMode(process.env)); if(!ok)process.exitCode=1;
}
