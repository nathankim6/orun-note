const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict');
const source=fs.readFileSync('supabase/functions/docs/index.ts','utf8');const block=source.slice(source.indexOf('type UpdateChannel ='),source.indexOf('// ---- identity ----'))+'\nglobalThis.check = publishedUpdate;';
function harness(rows=[],store=null,lookup=null,shared={}){
 const requests=[];
 const supa={from:table=>{let patch=null,channel;const result=()=>{if(table==='app_update_cache'){
   const cached=shared[channel]??{release:null,checked_at:null,refresh_after:'1970-01-01T00:00:00Z'};
   if(patch){shared[channel]={...cached,...patch};return{data:[{channel}],error:null};}
   return{data:cached,error:null};
 }return{data:store,error:null};};
 const q=new Proxy({}, {get:(_obj,key)=>{
   if(key==='then')return(yes,no)=>Promise.resolve(result()).then(yes,no);
   if(key==='maybeSingle')return async()=>result();
   return(...args)=>{if(key==='update')patch=args[0];if(key==='eq'&&args[0]==='channel')channel=args[1];return q;};
 }});return q;}};
 const c={Date,Map,RegExp,AbortSignal,supa,fetch:async url=>{requests.push(url);return{ok:true,json:async()=>url.includes('itunes.apple.com')?{results:lookup?[lookup]:[]}:rows}}};
 vm.runInNewContext(ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);return{check:c.check,requests,shared};
}
const release=(version,extra={})=>({tag_name:'v'+version+'-android',draft:false,prerelease:false,published_at:'2026-01-01T00:00:00Z',assets:[{name:'orun-note-galaxytab-arm64.apk',state:'uploaded',size:100,browser_download_url:'https://github.com/nathankim6/orun-note/releases/download/v'+version+'-android/orun-note-galaxytab-arm64.apk'}],...extra});
(async()=>{let h=harness([release('1.6.9'),release('1.6.10'),release('1.7.0',{prerelease:true}),release('1.8.0',{draft:true}),release('1.9.0',{assets:[]})]);assert.equal((await h.check('android-apk')).version,'1.6.10');assert.equal((await h.check('android-apk')).version,'1.6.10');assert.equal(h.requests.length,1);const anotherWorker=harness([release('9.9.9')],null,null,h.shared);assert.equal((await anotherWorker.check('android-apk')).version,'1.6.10');assert.equal(anotherWorker.requests.length,0);
 h=harness([release('1.9.0')],null,{trackId:6829351204,bundleId:'com.paperly.study',version:'1.6.9',currentVersionReleaseDate:'2026-01-01T00:00:00Z'});const ios=await h.check('ios');assert.equal(ios.version,'1.6.9');assert(ios.url.startsWith('https://apps.apple.com/'));assert.equal(h.requests.length,1);assert(h.requests[0].includes('itunes.apple.com'));assert(!h.requests[0].includes('appstoreconnect'));
 h=harness([release('9.9.9')]);assert.equal(await h.check('android-play'),null);assert.equal(h.requests.length,0);
 h=harness([], {version:'1.6.14',url:'https://play.google.com/store/apps/details?id=com.paperly.study',published_at:'2026-01-01T00:00:00Z'});assert.equal((await h.check('android-play')).version,'1.6.14');
 console.log('PASS: semver release selection, no drafts/prereleases/missing assets, persistent cross-worker cache, iOS public availability independent of APK/TestFlight, Google Play isolation');
})().catch(e=>{console.error(e);process.exitCode=1});
