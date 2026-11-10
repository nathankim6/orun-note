import { DOCS_FN, SUPABASE_ANON_KEY } from './config';
import { UpdateChannel, PublishedUpdate, validateUpdate } from './updatePolicy';
/** Public, sign-in independent and short-lived: connectivity failures are NOT an update requirement. */
export async function fetchPublishedUpdate(channel: UpdateChannel): Promise<PublishedUpdate | null> {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(DOCS_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY }, body: JSON.stringify({ action: 'app.update', channel }), signal: ctrl.signal });
    const data = await r.json();
    if (!r.ok || data?.ok !== true || data.channel !== channel || !Object.prototype.hasOwnProperty.call(data, 'release')) throw new Error('update unavailable');
    if (data.release === null) return null;
    const release = validateUpdate(channel, data.release);
    if (!release) throw new Error('invalid update policy');
    return release;
  } finally { clearTimeout(timer); }
}
