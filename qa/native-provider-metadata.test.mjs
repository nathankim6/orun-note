import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractPlayerResponse, summarizePlayerResponse, observePublicMetadata, fixtureId } from '../scripts/native-provider-metadata.mjs';
test('public metadata parser uses JSON only, handles quoted braces and strips raw data',()=>{
  const value={playabilityStatus:{status:'UNPLAYABLE',playableInEmbed:false,reason:'Embedding disabled PRIVATE_CANARY } "'},videoDetails:{videoId:'PRIVATE_CANARY'}};
  const parsed=extractPlayerResponse('<script>var ytInitialPlayerResponse = '+JSON.stringify(value)+';</script>');
  assert.deepEqual(parsed,value); const row=summarizePlayerResponse(parsed);
  assert.equal(row.reason,'embed_restriction');assert.equal(row.playableInEmbed,false);assert.equal(row.nativeValidated,false);assert(!JSON.stringify(row).includes('PRIVATE_CANARY'));
  for(const text of ['', 'var ytInitialPlayerResponse = {}oops', 'var ytInitialPlayerResponse = {bad}', 'var ytInitialPlayerResponse = {']) assert.doesNotThrow(()=>extractPlayerResponse(text));
  assert.equal(extractPlayerResponse('var ytInitialPlayerResponse = {bad}'),null);
});
test('provider states and reasons are enum-only, no inferred playback success',()=>{
  assert.equal(summarizePlayerResponse(null).result,'unavailable');
  for(const [reason,expected]of [["Sign in to confirm you're not a bot",'bot_verification'],['Sign in','sign_in_required'],['age restricted','age_requirement'],['country restricted','region_restriction'],['Video unavailable','unavailable'],['PRIVATE_CANARY','other']]){
    const row=summarizePlayerResponse({playabilityStatus:{status:'PRIVATE_CANARY',reason,playableInEmbed:'PRIVATE_CANARY'}});assert.equal(row.reason,expected);assert.equal(row.status,'other');assert(!JSON.stringify(row).includes('PRIVATE_CANARY'));assert.equal(row.playableInEmbed,undefined);
  }
  const row=summarizePlayerResponse({playabilityStatus:{status:'OK',playableInEmbed:true}});assert.equal(row.result,'observed');assert.equal(row.nativeValidated,false);
});
test('one ordinary public request, no cookies/auth/headers/retries or raw network errors',async()=>{
  let calls=0;
  const row=await observePublicMetadata('aqz-KE-bpKQ',async(url,opts)=>{calls++;assert.equal(url,'https://www.youtube.com/watch?v=aqz-KE-bpKQ');assert.equal(opts.headers,undefined);assert.equal(opts.body,undefined);assert.equal(opts.redirect,'error');return new Response('<script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK","playableInEmbed":true}};</script>');});
  assert.equal(calls,1);assert.equal(row.playableInEmbed,true);
  assert.equal((await observePublicMetadata('aqz-KE-bpKQ',async()=>{throw Error('PRIVATE_CANARY')})).reason,'network');
  assert.equal((await observePublicMetadata('aqz-KE-bpKQ',async()=>new Response('',{status:403}))).httpStatus,403);
  await assert.rejects(()=>observePublicMetadata('PRIVATE_CANARY'));
});
test('same fixture and separate diagnostic workflow, no production references',()=>{
  const source=fs.readFileSync('qa/fixtures/videos.ts','utf8');assert.equal(fixtureId(source),'aqz-KE-bpKQ');assert.throws(()=>fixtureId(''));assert.throws(()=>fixtureId(source+source));
  const workflow=fs.readFileSync('.github/workflows/native-provider-diagnostic.yml','utf8');assert(!workflow.includes('secrets.'));assert(!workflow.includes('native-smoke.yml'));assert(workflow.includes('public-metadata-diagnostic:'));
  for(const file of fs.readdirSync('.github/workflows').filter(x=>x!=='native-provider-diagnostic.yml'))assert(!fs.readFileSync('.github/workflows/'+file,'utf8').includes('native-provider-metadata'));
});
