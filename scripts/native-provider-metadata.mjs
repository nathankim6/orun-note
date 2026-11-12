// QA-only public watch metadata, not a playback test or native release gate.
// No cookies/auth, embed API requests, changed headers, alternate videos, or retries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function extractPlayerResponse(text) {
  const marker = 'var ytInitialPlayerResponse = ';
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const offset = start + marker.length;
  if (text[offset] !== '{') return null;
  let depth = 0, quoted = false, escape = false;
  for (let i = offset; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(text.slice(offset, i + 1)); } catch { return null; } }
  }
  return null;
}
export function summarizePlayerResponse(value) {
  const p = value?.playabilityStatus;
  if (!p || typeof p !== 'object') return { event: 'public_provider_metadata', result: 'unavailable', reason: 'missing_player_response', nativeValidated: false };
  const output = { event: 'public_provider_metadata', result: 'observed', nativeValidated: false };
  output.status = ['OK','ERROR','UNPLAYABLE','LOGIN_REQUIRED','LIVE_STREAM_OFFLINE','AGE_CHECK_REQUIRED','CONTENT_CHECK_REQUIRED'].includes(p.status) ? p.status : 'other';
  if (typeof p.playableInEmbed === 'boolean') output.playableInEmbed = p.playableInEmbed;
  // Classify public provider text locally, never export arbitrary reason/messages.
  const reason = typeof p.reason === 'string' ? p.reason : '';
  output.reason = /confirm.+not a bot/i.test(reason) ? 'bot_verification' : /embed|other websites/i.test(reason) ? 'embed_restriction' : /\bage\b/i.test(reason) ? 'age_requirement' : /\b(?:country|region)\b/i.test(reason) ? 'region_restriction' : /sign in|log in/i.test(reason) ? 'sign_in_required' : /\b(?:unavailable|removed|private)\b/i.test(reason) ? 'unavailable' : reason ? 'other' : 'none';
  return output;
}
export async function observePublicMetadata(videoId, request = fetch) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw Error('Invalid public fixture');
  try {
    const response = await request('https://www.youtube.com/watch?v=' + encodeURIComponent(videoId), { signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) return { event:'public_provider_metadata',result:'unavailable',reason:'http',httpStatus:response.status,nativeValidated:false };
    let size = 0; const chunks = [];
    for await (const chunk of response.body) { size += chunk.length; if (size > 8 * 1024 * 1024) { return {event:'public_provider_metadata',result:'unavailable',reason:'size_limit',nativeValidated:false}; } chunks.push(Buffer.from(chunk)); }
    return summarizePlayerResponse(extractPlayerResponse(Buffer.concat(chunks).toString('utf8')));
  } catch { return {event:'public_provider_metadata',result:'unavailable',reason:'network',nativeValidated:false}; }
}
export function fixtureId(source) {
  const ids = [...source.matchAll(/videoId:\s*'([A-Za-z0-9_-]{11})'/g)].map(x=>x[1]);
  if (ids.length !== 1) throw Error('Expected unchanged single public fixture');
  return ids[0];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NATIVE_SMOKE_QA !== '1' || process.env.CI !== '1' || process.env.GITHUB_ACTIONS !== 'true') throw Error('QA GitHub CI only');
  const row = await observePublicMetadata(fixtureId(fs.readFileSync('qa/fixtures/videos.ts','utf8')));
  console.log(JSON.stringify(row));
  // Process success means collection completed, never playback or native success.
}
