/* Release gate: never publish a candidate until BOTH native simulations passed on this exact commit. */
function validateNativeQa(run,{sha,repository,jobs}){
 if(!run||run.status!=='completed'||run.conclusion!=='success')throw Error('Native smoke run must have completed successfully.');
 if(run.head_sha!==sha)throw Error('Native smoke run does not verify this exact commit.');
 if(run.path!=='.github/workflows/native-smoke.yml')throw Error('Wrong native smoke workflow.');
 if(run.repository?.full_name!==repository||run.head_repository?.full_name!==repository)throw Error('Native smoke must run in this repository, not a fork.');
 if(run.event!=='workflow_dispatch')throw Error('Unexpected native smoke trigger.');
 for(const platform of ['android','ios']) { const job=jobs?.find(j=>j.name===platform); if(!job||job.status!=='completed'||job.conclusion!=='success')throw Error(platform+' native simulation must pass.'); }
 return true;
}
function validateAndroidBuild(run,{sha,repository}) {
 if(!run||run.status!=='completed'||run.conclusion!=='success'||run.head_sha!==sha||run.path!=='.github/workflows/android-apk.yml'||run.repository?.full_name!==repository||run.head_repository?.full_name!==repository)throw Error('APK build must pass in this repository on this exact commit.');
 return true;
}
module.exports={validateNativeQa,validateAndroidBuild};
if(require.main===module)(async()=>{const id=process.env.QA_RUN||'',repository=process.env.GITHUB_REPOSITORY,sha=process.env.GITHUB_SHA,token=process.env.GH_TOKEN;if(!/^\d+$/.test(id)||!repository||!sha||!token)throw Error('QA_RUN and GitHub job identity are required.');const r=await fetch(`https://api.github.com/repos/${repository}/actions/runs/${id}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}});if(!r.ok)throw Error('Unable to verify native smoke run: HTTP '+r.status);const run=await r.json();const jr=await fetch(`https://api.github.com/repos/${repository}/actions/runs/${id}/jobs?per_page=100`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}});if(!jr.ok)throw Error('Unable to verify platform jobs: HTTP '+jr.status);const jb=await jr.json();validateNativeQa(run,{sha,repository,jobs:jb.jobs});if(process.env.APK_RUN){if(!/^\d+$/.test(process.env.APK_RUN))throw Error('Invalid APK_RUN');const ar=await fetch(`https://api.github.com/repos/${repository}/actions/runs/${process.env.APK_RUN}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}});if(!ar.ok)throw Error('Cannot verify signed APK build: HTTP '+ar.status);validateAndroidBuild(await ar.json(),{sha,repository});}console.log('Verified Android+iOS native smoke success on exact commit:',sha,'run',id);})().catch(e=>{console.error(e.message);process.exitCode=1});
