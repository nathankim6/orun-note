// node scripts/test-docs-function-access.js — who may call which action of the docs edge function.
// Runs the REAL handler (supabase/functions/docs/index.ts) against in-memory fakes of Supabase / the homework server.
// Regression: `materials.derivedUrls` sat behind the admin-only gate, so every student got 403, no pre-rendered page
// image was ever downloaded and each textbook page was drawn by the device PDF engine (seconds per page).
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
const source = fs.readFileSync('supabase/functions/docs/index.ts', 'utf8');
assert(/^import \{ createClient \} from "npm:@supabase\/supabase-js@2";$/m.test(source), 'the import this harness replaces');
function harness() {
  const calls = { signed: [], signedOne: [], writes: [], log: [] };
  const student = { id: 's1', name: '학생', grade_id: 'g1', access_codes: { code: 'ABCDE', is_active: true }, grades: { id: 'g1', name: '2학년', school_id: 'sc1', schools: { id: 'sc1', name: '학교' } } };
  const users = { 'student-token': { email: 'student@example.com', id: 'u-student' }, 'admin-token': { email: 'admin@example.com', id: 'u-admin' }, 'stranger-token': { email: 'stranger@example.com', id: 'u-x' } };
  const supa = {
    auth: { getUser: async (token) => (users[token] ? { data: { user: users[token] }, error: null } : { data: { user: null }, error: new Error('bad token') }) },
    storage: { from: () => ({
      createSignedUrls: async (paths, ttl) => { calls.signed.push({ paths, ttl }); return { data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.example/' + p })), error: null }; },
      createSignedUrl: async (path, ttl) => { calls.signedOne.push({ path, ttl }); return { data: { signedUrl: 'https://signed.example/' + path }, error: null }; },
      createSignedUploadUrl: async (path) => { calls.writes.push('uploadUrl ' + path); return { data: { signedUrl: 'https://up.example/' + path, token: 't' }, error: null }; },
      remove: async (paths) => { calls.writes.push('remove ' + paths.join(',')); return { data: [], error: null }; }, list: async () => ({ data: [], error: null }),
    }) },
    from: (table) => {
      const filters = {}; let op = 'select';
      const result = () => {
        if (op !== 'select') { calls.writes.push(op + ' ' + table); return { data: table === 'materials' ? { id: 'm' } : null, error: null }; }
        if (table === 'admin_emails') return { data: filters.email === 'admin@example.com' ? { email: filters.email, label: '관리자' } : null, error: null };
        if (table === 'student_links') return { data: filters.email === 'student@example.com' ? { student_id: 's1', email: filters.email } : null, error: null };
        if (table === 'assignments') return { data: [{ material: { id: 'mat-assigned', ready: true, title: 'A', file_name: 'a.pdf' } }, { material: { id: 'mat-not-ready', ready: false } }], error: null };
        if (table === 'materials') return { data: { storage_path: filters.id + '.pdf', title: 'T', file_name: 't.pdf', derived: { version: 1, pages: 3, widths: [1200, 2000], words: true } }, error: null };
        return { data: null, error: null, count: 0 };
      };
      const q = new Proxy({}, { get: (_o, key) => {
        if (key === 'then') return (yes, no) => Promise.resolve(result()).then(yes, no);
        if (key === 'maybeSingle' || key === 'single') return async () => result();
        return (...args) => { if (['insert', 'update', 'upsert', 'delete'].includes(key)) { op = key; if (table === 'access_log' && key === 'insert') { calls.log.push(args[0]); op = 'log'; } } if (key === 'eq') filters[args[0]] = args[1]; return q; };
      } });
      return q;
    },
  };
  let handler = null;
  const env = { ADMIN_CODE: '424242', HW_URL: 'https://hw.example', HW_KEY: 'k', SUPABASE_URL: 'https://x.example', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  const context = { console, Date, Map, Set, Promise, JSON, Math, RegExp, Number, String, Array, Object, Error, AbortSignal, URL, URLSearchParams, Response, Request, Headers, TextEncoder, TextDecoder, setTimeout, clearTimeout, crypto: globalThis.crypto,
    createClient: () => supa, Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch: async (url) => { const u = String(url); if (u.startsWith('https://hw.example/rest/v1/students')) return new Response(JSON.stringify([student]), { status: 200 }); if (u.startsWith('https://hw.example/')) return new Response('[]', { status: 200 }); throw new Error('unexpected fetch ' + u); } };
  vm.runInNewContext(ts.transpileModule(source.replace(/^import \{ createClient \} from "npm:@supabase\/supabase-js@2";$/m, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  assert.equal(typeof handler, 'function', 'the function registers its handler');
  const call = async (body) => { const real = () => calls.writes.filter((w) => !w.startsWith('log ') && w !== 'update student_links'); /* last_seen_at housekeeping of every signed-in student call */ const before = real().length; const res = await handler(new Request('https://x.example/functions/v1/docs', { method: 'POST', body: JSON.stringify(body) })); let json = null; try { json = await res.json(); } catch { /* not json */ } return { status: res.status, json, wrote: real().slice(before) }; };
  return { call, calls };
}
const FILES = ['manifest.json', 'p0-1200.jpg', 'p0-2000.jpg', 'p0-3600.jpg', 'p0-words.json', 'p12-2400.jpg', '../secret.pdf', 'p0-9999.jpg', 'p0-1200.jpg/../../x', 'other.pdf', 'P0-1200.JPG'];
const VALID = ['manifest.json', 'p0-1200.jpg', 'p0-2000.jpg', 'p0-3600.jpg', 'p0-words.json', 'p12-2400.jpg'];
(async () => {
  // ---- a signed-in student: page images of an ASSIGNED material ----
  let h = harness(); let r = await h.call({ action: 'materials.derivedUrls', token: 'student-token', materialId: 'mat-assigned', files: FILES });
  assert.equal(r.status, 200, 'a student receives the page-image URLs of an assigned material (was 403: admin-only gate)');
  assert.deepEqual(r.json.urls.map((u) => u.path), VALID.map((n) => 'derived/mat-assigned/v1/' + n), 'only whitelisted file names, only below this material');
  assert.deepEqual(h.calls.signed, [{ paths: VALID.map((n) => 'derived/mat-assigned/v1/' + n), ttl: 900 }]); assert.deepEqual(r.wrote, [], 'read-only');
  r = await h.call({ action: 'materials.derivedUrls', token: 'student-token', materialId: 'mat-assigned', files: [] }); assert.equal(r.status, 200); assert.deepEqual(r.json.urls, []);
  // ...but never of a material that is not assigned to them (or not ready)
  for (const id of ['mat-other', 'mat-not-ready', '', '../mat-assigned', 'mat-assigned/../../x']) { h = harness(); r = await h.call({ action: 'materials.derivedUrls', token: 'student-token', materialId: id, files: FILES }); assert.equal(r.status, 403, 'unassigned material ' + JSON.stringify(id)); assert.equal(h.calls.signed.length, 0, 'no URL is signed for ' + JSON.stringify(id)); }
  // the textbook itself: unchanged
  h = harness(); r = await h.call({ action: 'download', token: 'student-token', materialId: 'mat-assigned' }); assert.equal(r.status, 200); assert(r.json.derived && r.json.derived.pages === 3, 'download hands the manifest over');
  r = await h.call({ action: 'download', token: 'student-token', materialId: 'mat-other' }); assert.equal(r.status, 403);
  // ---- admin-only actions stay closed to students, and change nothing ----
  for (const action of ['roster', 'assign.toggle', 'materials.uploadUrl', 'materials.complete', 'materials.derivedUploadUrl', 'materials.derivedComplete', 'materials.delete', 'requests.decide', 'stats', 'no.such.action']) {
    h = harness(); r = await h.call({ action, token: 'student-token', materialId: 'mat-assigned', id: 'mat-assigned', files: ['p0-1200.jpg'], manifest: { pages: 3 } });
    assert.equal(r.status, 403, action + ' is admin-only'); assert.deepEqual(r.wrote, [], action + ' wrote nothing'); assert.equal(h.calls.signed.length + h.calls.signedOne.length, 0, action + ' signed nothing');
  }
  // ---- not signed in / not linked: nothing ----
  for (const token of ['', 'garbage', 'stranger-token']) { h = harness(); r = await h.call({ action: 'materials.derivedUrls', token, materialId: 'mat-assigned', files: FILES }); assert.equal(r.status, 401, 'token ' + JSON.stringify(token)); assert.equal(h.calls.signed.length, 0); }
  // ---- admins (code or admin e-mail): any material, as before ----
  for (const who of [{ code: '424242' }, { token: 'admin-token' }]) { h = harness(); r = await h.call({ action: 'materials.derivedUrls', ...who, materialId: 'mat-other', files: FILES }); assert.equal(r.status, 200); assert.equal(r.json.urls.length, VALID.length); }
  // ---- source order: the action is decided before the admin gate ----
  const at = source.indexOf('case "materials.derivedUrls"'), gate = source.indexOf('return fail("관리자 전용 기능입니다", 403)');
  assert(at > 0 && gate > 0 && at < gate && source.indexOf('case "materials.derivedUrls"', at + 1) < 0, 'materials.derivedUrls is handled above the admin-only gate, once');
  console.log('PASS: students get page-image URLs for assigned materials only (whitelisted names, 900 s), admin-only actions stay 403 without side effects, unauthenticated 401, admins unchanged');
})().catch((e) => { console.error(e); process.exitCode = 1; });
