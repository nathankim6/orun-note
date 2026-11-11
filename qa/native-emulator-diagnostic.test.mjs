import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { COMMANDS, commandStatus, commandObservation, runEmulatorDiagnostic } from '../scripts/native-emulator-diagnostic.mjs';
const canary='PRIVATE_STUDENT_ACCOUNT_TOKEN_URI_CANARY';
const ok=stdout=>({status:0,stdout:Buffer.from(stdout),stderr:Buffer.alloc(0)});
function sample(args) {
  if(args[1]==='getprop')return ok(args[2]==='sys.boot_completed'?'1':'stopped');
  if(args[1]==='pidof')return ok('98765');
  if(args[1]==='dumpsys')return ok('mCurrentFocus=Window{abc u0 com.android.launcher3/.Launcher '+canary+'}');
  if(args[1]==='wm')return ok(args[2]==='size'?'Physical size: 1280x800':'Physical density: 160');
  if(args[1]==='uiautomator')return ok('UI hierarchy dumped to: /private/'+canary);
  return ok('<hierarchy><node package="private.'+canary+'" text="'+canary+'" resource-id="'+canary+'"/></hierarchy>');
}
test('records boot/window/display before one cold dump and emits no native validation result',()=>{
  let clock=0;const rows=[],calls=[];
  const result=runEmulatorDiagnostic({apiLevel:36,now:()=>clock,write:r=>rows.push(r),query:(args,budget)=>{calls.push({args,budget});clock+=10;return sample(args);}});
  assert.deepEqual(COMMANDS.map(x=>x.command),['boot','bootanim','system_ui_pid','window','wm_size','wm_density','uia_dump','uia_xml']);
  const evidence=rows.filter(r=>r.event==='emulator_diagnostic_command');assert.equal(evidence.length,8);
  assert.deepEqual(evidence.map(r=>r.command),COMMANDS.map(x=>x.command));assert.equal(result.ok,8);
  assert(calls.some(c=>JSON.stringify(c.args)===JSON.stringify(['shell','dumpsys','window'])));
  assert.equal(calls[6].budget,30000);assert(evidence.slice(0,6).every(r=>r.status==='ok'));
  assert.equal(evidence[0].boot,'complete');assert.equal(evidence[1].bootanim,'stopped');assert.equal(evidence[2].systemUiAlive,true);
  assert.equal(evidence[3].focus,'launcher');assert.equal(evidence[4].width,1280);assert.equal(evidence[5].density,160);
  assert(rows.filter(r=>r.notNativeValidation===1).length===2);assert(!rows.some(r=>r.event==='suite_result'||r.result==='pass'));
  const text=JSON.stringify(rows);assert(!text.includes(canary));assert(!text.includes('98765'));assert(!text.includes('/private/'));assert(!text.includes('com.android.launcher3'));
});
test('command outcomes retain numeric evidence but never serialize errors/messages/partial content',()=>{
  assert.equal(commandStatus(ok('')),'ok');assert.equal(commandStatus({status:null,error:{code:'ETIMEDOUT',message:canary}}),'timeout');
  assert.equal(commandStatus({status:null,error:{code:'ENOBUFS',message:canary}}),'buffer');assert.equal(commandStatus({status:1}),'nonzero');
  let tick=0;const rows=[];let index=0;
  const failures=[{status:null,error:{code:'ETIMEDOUT',message:canary},stdout:Buffer.from(canary),stderr:Buffer.from(canary)},{status:7,stdout:Buffer.from(canary),stderr:Buffer.from(canary)},{status:null,error:{code:'ENOBUFS'},stdout:Buffer.from(canary)}];
  runEmulatorDiagnostic({apiLevel:35,now:()=>tick,write:r=>rows.push(r),query:()=>{tick+=25;return failures[index++]??ok('');}});
  const evidence=rows.filter(r=>r.event==='emulator_diagnostic_command');assert.deepEqual(evidence.slice(0,3).map(r=>r.status),['timeout','nonzero','buffer']);
  assert.equal(evidence[0].stdoutBytes,Buffer.byteLength(canary));assert.equal(evidence[0].elapsedMs,25);assert.equal(evidence[1].exitCode,7);
  assert.equal(evidence[0].boot,undefined);assert(!JSON.stringify(rows).includes(canary));
});
test('deadline does not replace earlier valid evidence or run later commands',()=>{
  let tick=0,queries=0;const rows=[];
  runEmulatorDiagnostic({apiLevel:36,now:()=>tick,write:r=>rows.push(r),query:()=>{queries++;tick=120000;return ok('1');}});
  assert.equal(queries,1);const evidence=rows.filter(r=>r.event==='emulator_diagnostic_command');assert.equal(evidence[0].boot,'complete');assert.equal(evidence[0].status,'ok');
  assert(evidence.slice(1).every(r=>r.status==='deadline'&&r.budgetMs===0));assert.equal(rows.at(-1).deadline,7);assert.equal(rows.at(-1).notNativeValidation,1);
});
test('all command budgets remain inside the shared 120s collection deadline',()=>{
  let tick=0;const rows=[];
  runEmulatorDiagnostic({apiLevel:36,now:()=>tick,write:r=>rows.push(r),query:(args,budget)=>{assert(budget<=120000-tick);tick+=budget;return sample(args);}});
  assert.equal(tick,90000);assert.equal(rows.at(-1).elapsedMs,90000);assert.equal(rows.at(-1).ok,8);
});
test('boot animation, focus and display observations use fixed enums/numeric fields only',()=>{
  for(const state of ['stopped','running',''])assert.equal(commandObservation('bootanim',state).bootanim,state||'empty');
  assert.equal(commandObservation('bootanim',canary).bootanim,'other');assert.equal(commandObservation('boot',canary).boot,'other');
  assert.equal(commandObservation('system_ui_pid',canary).systemUiAlive,false);
  assert.deepEqual(commandObservation('window','mCurrentFocus=null'),{focus:'missing',focusSource:'current_window'});
  assert.equal(commandObservation('window','mCurrentFocus=Window{x u0 private.'+canary+'/.Dialog}').focus,'unknown');
  assert.equal(commandObservation('window','mFocusedWindow=Window{x u0 com.google.android.permissioncontroller/.GrantPermissionsActivity}').focus,'permission');
  assert.deepEqual(commandObservation('wm_size','Physical size: 2560x1600\nOverride size: 1280x800'),{sizeState:'known',width:1280,height:800});
  assert.deepEqual(commandObservation('wm_density','Physical density: 320\nOverride density: 160'),{densityState:'known',density:160});
  assert.equal(commandObservation('wm_size','Physical size: '+canary).sizeState,'unknown');assert.equal(commandObservation('wm_density','Physical density: 99999').densityState,'unknown');
});
test('fresh XML distinguishes app/SystemUI ANR; a failed dump never labels stale XML healthy',()=>{
  const xml=title=>'<hierarchy><node package="android" resource-id="android:id/aerr_wait"/><node package="android" text="'+title+'"/><node package="private.'+canary+'" text="'+canary+'"/></hierarchy>';
  assert.equal(commandObservation('uia_xml',xml('System UI isn’t responding')).dialog,'system_ui_anr');
  assert.equal(commandObservation('uia_xml',xml('Paperly isn’t responding')).dialog,'app_anr');
  assert.equal(commandObservation('uia_xml',xml('System UI isn’t responding '+canary)).dialog,'app_anr');
  assert.deepEqual(commandObservation('uia_xml',xml('System UI isn’t responding'),false),{xmlState:'not_fresh'});
  assert(!JSON.stringify(commandObservation('uia_xml',xml(canary))).includes(canary));
  const rows=[];runEmulatorDiagnostic({write:r=>rows.push(r),now:()=>0,query:args=>args[1]==='uiautomator'?{status:1,stderr:Buffer.from(canary)}:args[1]==='cat'?ok(xml('System UI isn’t responding')):sample(args)});
  assert.equal(rows.find(r=>r.command==='uia_xml').xmlState,'not_fresh');
});
test('workflow is standalone manual API35/36 matrix with sanitized JSONL only, not a release gate',()=>{
  const source=fs.readFileSync('.github/workflows/android-emulator-diagnostic.yml','utf8');
  assert(source.includes('workflow_dispatch: {}'));assert(!/^\s+(?:push|pull_request|schedule):/m.test(source));
  assert(source.includes('api: [35, 36]'));assert(source.includes('fail-fast: false'));assert(source.includes('cores: 4'));assert(source.includes('ram-size: 4096M'));
  assert(source.includes('native-configure-avd.mjs'));assert(source.includes('-gpu swiftshader -feature -Vulkan'));assert(source.includes('retention-days: 3'));
  assert(!/\b(?:npm ci|expo prebuild|gradlew|adb install|am start|workflow run)\b/.test(source));assert(!source.includes('download-artifact'));
  assert(source.includes('path: qa/output/emulator-diagnostic-api${{ matrix.api }}.jsonl'));assert(!/path:.*(?:\*|png|xml|raw)/.test(source));
  const {validateNativeQa}=createRequire(import.meta.url)('../scripts/verify-native-qa.js');
  const options={sha:'exact',repository:'owner/repo',jobs:[{name:'android',status:'completed',conclusion:'success'},{name:'ios',status:'completed',conclusion:'success'}]};
  assert.throws(()=>validateNativeQa({status:'completed',conclusion:'success',head_sha:'exact',path:'.github/workflows/android-emulator-diagnostic.yml',repository:{full_name:'owner/repo'},head_repository:{full_name:'owner/repo'},event:'workflow_dispatch'},options),/Wrong native smoke workflow/);
});
test('CLI captures both adb streams in memory and never prints raw errors',()=>{
  const source=fs.readFileSync('scripts/native-emulator-diagnostic.mjs','utf8');
  assert(source.includes("stdio:['ignore','pipe','pipe']"));assert(source.includes('maxBuffer:2*1024*1024'));assert(!source.includes('console.error'));
  const rows=[];runEmulatorDiagnostic({write:r=>rows.push(r),now:()=>0,query:()=>{throw Error(canary);}});
  assert(rows.filter(r=>r.event==='emulator_diagnostic_command').every(r=>r.status==='nonzero'));assert(!JSON.stringify(rows).includes(canary));
});
