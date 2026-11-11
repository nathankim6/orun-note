const assert=require('node:assert/strict'),{validateNativeQa}=require('./verify-native-qa');const options={sha:'abc123',repository:'nathankim6/orun-note',jobs:[{name:'android',status:'completed',conclusion:'success'},{name:'ios',status:'completed',conclusion:'success'}]},ok={status:'completed',conclusion:'success',head_sha:'abc123',path:'.github/workflows/native-smoke.yml',repository:{full_name:options.repository},head_repository:{full_name:options.repository},event:'workflow_dispatch'};assert(validateNativeQa(ok,options));for(const patch of [{status:'in_progress'},{conclusion:'failure'},{conclusion:'cancelled'},{head_sha:'old'},{path:'.github/workflows/ios.yml'},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'fork/repo'}},{event:'pull_request'}])assert.throws(()=>validateNativeQa({...ok,...patch},options));for(const jobs of [[],options.jobs.slice(0,1),options.jobs.map(j=>({...j,conclusion:'skipped'}))])assert.throws(()=>validateNativeQa(ok,{...options,jobs}));console.log('PASS: native QA exact-commit/repository/workflow/success release gate');
// A diagnostic single-platform run can conclude success overall with its sibling
// skipped. It must never satisfy the two-platform release requirement.
for (const skippedName of ['android','ios']) {
  const jobs=options.jobs.map(job=>job.name===skippedName?{...job,conclusion:'skipped'}:job);
  assert.throws(()=>validateNativeQa(ok,{...options,jobs}));
}
console.log('PASS: one-success/one-skipped platform diagnostic cannot release');
