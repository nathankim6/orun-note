const assert=require('node:assert/strict'),{validateNativeQa}=require('./verify-native-qa');const options={sha:'abc123',repository:'nathankim6/orun-note',jobs:[{name:'android',status:'completed',conclusion:'success'},{name:'ios',status:'completed',conclusion:'success'}]},ok={status:'completed',conclusion:'success',head_sha:'abc123',path:'.github/workflows/native-smoke.yml',repository:{full_name:options.repository},head_repository:{full_name:options.repository},event:'workflow_dispatch'};assert(validateNativeQa(ok,options));for(const patch of [{status:'in_progress'},{conclusion:'failure'},{conclusion:'cancelled'},{head_sha:'old'},{path:'.github/workflows/ios.yml'},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'fork/repo'}},{event:'pull_request'}])assert.throws(()=>validateNativeQa({...ok,...patch},options));for(const jobs of [[],options.jobs.slice(0,1),options.jobs.map(j=>({...j,conclusion:'skipped'}))])assert.throws(()=>validateNativeQa(ok,{...options,jobs}));console.log('PASS: native QA exact-commit/repository/workflow/success release gate');
// A diagnostic single-platform run can conclude success overall with its sibling
// skipped. It must never satisfy the two-platform release requirement.
for (const skippedName of ['android','ios']) {
  const jobs=options.jobs.map(job=>job.name===skippedName?{...job,conclusion:'skipped'}:job);
  assert.throws(()=>validateNativeQa(ok,{...options,jobs}));
}
console.log('PASS: one-success/one-skipped platform diagnostic cannot release');
// Explicitly acknowledged CI-only iOS playback failure (user-approved 2026-11-16).
const {validateNativeQaAcknowledged,parseQaRun}=require('./verify-native-qa');
assert.deepEqual(parseQaRun('123:ack-youtube-ci-timeout'),{id:'123',acknowledged:true});
assert.deepEqual(parseQaRun('123'),{id:'123',acknowledged:false});
assert.equal(parseQaRun('abc'),null);
assert.equal(parseQaRun('123:other'),null);
const ackRun={...ok,conclusion:'failure'};
const ackJobs=options.jobs.map(job=>job.name==='ios'?{...job,conclusion:'failure'}:job);
assert.equal(validateNativeQaAcknowledged(ackRun,{...options,jobs:ackJobs}).iosConclusion,'failure');
assert.throws(()=>validateNativeQaAcknowledged(ackRun,{...options,jobs:options.jobs.map(job=>({...job,conclusion:'failure'}))}));
assert.throws(()=>validateNativeQaAcknowledged({...ackRun,head_sha:'old'},{...options,jobs:ackJobs}));
const allowed=['scripts/verify-native-qa.js','scripts/test-native-qa-gate.js'];
assert.equal(validateNativeQaAcknowledged({...ackRun,head_sha:'old'},{...options,jobs:ackJobs,allowedFiles:allowed,compare:{status:'ahead',files:allowed.map(filename=>({filename}))}}).exactCommit,false);
assert.throws(()=>validateNativeQaAcknowledged({...ackRun,head_sha:'old'},{...options,jobs:ackJobs,allowedFiles:allowed,compare:{status:'ahead',files:[{filename:'src/features/viewer/PdfPage.tsx'}]}}));
assert.throws(()=>validateNativeQaAcknowledged({...ackRun,head_sha:'old'},{...options,jobs:ackJobs,allowedFiles:allowed,compare:{status:'diverged',files:[{filename:'scripts/verify-native-qa.js'}]}}));
assert.throws(()=>validateNativeQaAcknowledged({...ackRun,event:'pull_request'},{...options,jobs:ackJobs}));
assert.throws(()=>validateNativeQaAcknowledged({...ackRun,status:'in_progress'},{...options,jobs:ackJobs}));
console.log('PASS: acknowledged bypass still requires exact commit, dispatch trigger, android success and a recorded iOS result');
