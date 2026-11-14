// 옳은Note API. One function, action-based JSON POST.
// Identity: a Google account (Supabase Auth JWT in `token`) linked to an orunhomework.com student code, or the ADMIN_CODE.
// Students, classes (grades) and schools are read live from the orunhomework.com Supabase project (HW_URL / HW_KEY secrets).
import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_CODE = Deno.env.get("ADMIN_CODE") ?? "";
const HW_URL = Deno.env.get("HW_URL") ?? ""; const HW_KEY = Deno.env.get("HW_KEY") ?? "";
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const BUCKET = "materials";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ ok: false, error: message }, status);
const normStudentCode = (c: unknown) => String(c ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
/** Mac file names arrive decomposed (NFD); store and return composed Hangul (NFC) so search and sorting work. */
const nfc = (v: unknown) => String(v ?? '').normalize('NFC');
const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();

// ---- orunhomework.com (live roster) ----
async function hw(path: string) {
  if (!HW_URL || !HW_KEY) throw new Error("숙제 서버 연동 설정(HW_URL/HW_KEY)이 없습니다");
  const r = await fetch(`${HW_URL}/rest/v1/${path}`, { headers: { apikey: HW_KEY, Authorization: `Bearer ${HW_KEY}` } });
  if (!r.ok) throw new Error(`숙제 서버 응답 오류 ${r.status}`);
  return r.json();
}
type HwStudent = { id: string; name: string; code: string; code_active: boolean; grade_id: string | null; grade_name: string; school_id: string | null; school_name: string };
const STUDENT_SELECT = "id,name,grade_id,access_code_id,access_codes:access_code_id(code,is_active),grades:grade_id(id,name,school_id,schools:school_id(id,name))";
function shapeStudent(s: any): HwStudent { return { id: s.id, name: s.name ?? "", code: s.access_codes?.code ?? "", code_active: !!s.access_codes?.is_active, grade_id: s.grades?.id ?? s.grade_id ?? null, grade_name: s.grades?.name ?? "", school_id: s.grades?.schools?.id ?? s.grades?.school_id ?? null, school_name: s.grades?.schools?.name ?? "" }; }
async function hwStudentByCode(code: string): Promise<HwStudent | null> {
  const codes = await hw(`access_codes?select=id,code,is_active&code=eq.${encodeURIComponent(code)}&limit=1`); if (!codes.length) return null;
  const rows = await hw(`students?select=${encodeURIComponent(STUDENT_SELECT)}&access_code_id=eq.${codes[0].id}&limit=1`); if (!rows.length) return null;
  return shapeStudent(rows[0]);
}
async function hwStudentById(id: string): Promise<HwStudent | null> {
  const rows = await hw(`students?select=${encodeURIComponent(STUDENT_SELECT)}&id=eq.${id}&limit=1`); return rows.length ? shapeStudent(rows[0]) : null;
}
// 보강영상: same rules as orunhomework.com's collectReviewVideos. One video per review_video_group_id, newest first.
// Only the YouTube video id is kept (never a URL); the app plays it inside its own locked player.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
type ReviewVideo = { id: string; title: string; videoId: string; assignedAt: string; passages: { id: string; title: string }[] };
function reviewVideos(rows: any[]): ReviewVideo[] {
  const groups = new Map<string, ReviewVideo>();
  for (const r of rows) {
    const p = r?.homework?.passages; const at = String(r?.homework?.created_at ?? "");
    if (!p?.review_video_group_id || !String(p.review_video_title ?? "").trim() || !YT_ID.test(String(p.review_video_youtube_id ?? ""))) continue;
    const g = groups.get(p.review_video_group_id) ?? { id: p.review_video_group_id, title: String(p.review_video_title).trim(), videoId: p.review_video_youtube_id, assignedAt: at, passages: [] };
    if (at > g.assignedAt) g.assignedAt = at;
    if (!g.passages.some((x) => x.id === p.id)) g.passages.push({ id: p.id, title: String(p.title ?? "") });
    groups.set(g.id, g);
  }
  return [...groups.values()].sort((a, b) => b.assignedAt.localeCompare(a.assignedAt) || a.id.localeCompare(b.id));
}
async function hwRoster() {
  const [schools, grades, students] = await Promise.all([hw("schools?select=id,name&order=name.asc"), hw("grades?select=id,name,school_id&order=name.asc"), hw(`students?select=${encodeURIComponent(STUDENT_SELECT)}&order=name.asc`)]);
  return { schools, grades, students: students.map(shapeStudent) };
}

// ---- dictionary (English → IPA, pronunciation audio, English definitions, Korean meanings) ----
// Sources follow the approach used by open-source lookup popups (Relper, Lexigo, Quick-Dictionary): the Free Dictionary
// API (dictionaryapi.dev) for English definitions, the Naver En-Ko dictionary for Korean meanings/IPA/recordings, MyMemory for phrases.
/** ﬁ→fi, ﬂ→fl, full-width letters → ASCII, drop soft hyphens / zero-width joiners (common in PDF text layers). */
const foldText = (raw: string) => String(raw ?? "").normalize("NFKC").replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "");
async function lookup(raw: string) {
  const q = foldText(raw).replace(/[\u2018\u2019]/g, "'").replace(/[^A-Za-z' -]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
  if (!q) return null;
  const { data: hit } = await supa.from("dict_cache").select("data,created_at").eq("q", q).maybeSingle(); const fresh = hit && Date.now() - new Date(hit.created_at).getTime() < 12 * 3600e3; // Naver audio links are signed and expire
  if (hit && fresh && (hit.data?.korean?.main || !hit.data?.isWord)) return hit.data;
  const isWord = !q.includes(" ");
  const naverEarly = async (w: string): Promise<any> => { const r = await fetch(`https://en.dict.naver.com/api3/enko/search?query=${encodeURIComponent(w)}&m=pc&range=word&page=1&lang=ko&shouldSearchOpen=false`, { headers: { Referer: "https://en.dict.naver.com/", "User-Agent": "Mozilla/5.0" } }).catch(() => null); if (!r || !r.ok) return null; const j = await r.json().catch(() => null); const items = j?.searchResultMap?.searchResultListMap?.WORD?.items ?? []; const plain = (h: string) => String(h ?? "").replace(/<[^>]+>/g, "").trim().toLowerCase(); return items.find((x: any) => plain(x.expEntry) === w) ?? items[0] ?? null; };
  const strip = (h: string) => String(h ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
  const tryDict = async (w: string) => { const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`).catch(() => null); return r && r.ok ? r.json() : null; };
  const lemmas = (w: string) => { const c = [w]; if (w.endsWith("ies")) c.push(w.slice(0, -3) + "y"); if (w.endsWith("es")) c.push(w.slice(0, -2)); if (w.endsWith("s")) c.push(w.slice(0, -1)); if (w.endsWith("ied")) c.push(w.slice(0, -3) + "y"); if (w.endsWith("ed")) { c.push(w.slice(0, -2), w.slice(0, -1)); if (/(.)\1ed$/.test(w)) c.push(w.slice(0, -3)); } if (w.endsWith("ing")) { c.push(w.slice(0, -3), w.slice(0, -3) + "e"); if (/(.)\1ing$/.test(w)) c.push(w.slice(0, -4)); } if (w.endsWith("ly")) c.push(w.slice(0, -2)); if (w.endsWith("er")) c.push(w.slice(0, -2), w.slice(0, -1)); if (w.endsWith("est")) c.push(w.slice(0, -3)); return [...new Set(c)].filter((x) => x.length > 1); };
  let entries: any = null; let headword = q;
  const naverFirst = isWord ? naverEarly(q) : Promise.resolve(null);
  // Fetch all lemma candidates and the Naver entry in parallel (sequential calls made the popup slow).
  if (isWord) { const cands = lemmas(q); const results = await Promise.all(cands.map((w) => tryDict(w))); const i = results.findIndex(Boolean); if (i >= 0) { entries = results[i]; headword = cands[i]; } }
  const posKo: Record<string, string> = { noun: "명사", verb: "동사", adjective: "형용사", adverb: "부사", pronoun: "대명사", preposition: "전치사", conjunction: "접속사", interjection: "감탄사", article: "관사", abbreviation: "약어", prefix: "접두사", suffix: "접미사", "auxiliary verb": "조동사" };
  const phon = { text: "", us: "", uk: "", audioUs: "", audioUk: "" }; const nvAudio = { us: "", uk: "" };
  // Korean meanings + IPA + US/UK recordings from the Naver English-Korean dictionary (public JSON used by its web UI).
  const naver = async (w: string) => { const r = await fetch(`https://en.dict.naver.com/api3/enko/search?query=${encodeURIComponent(w)}&m=pc&range=word&page=1&lang=ko&shouldSearchOpen=false`, { headers: { Referer: "https://en.dict.naver.com/", "User-Agent": "Mozilla/5.0" } }).catch(() => null); if (!r || !r.ok) return null; const j = await r.json().catch(() => null); const items = j?.searchResultMap?.searchResultListMap?.WORD?.items ?? []; return items.find((x: any) => strip(x.expEntry).toLowerCase() === w) ?? items.find((x: any) => strip(x.expEntry).toLowerCase() === headword) ?? items[0] ?? null; };
  const nvPhrase = async () => { const it = await naver(q); return it && strip(it.expEntry).toLowerCase() === q ? it : null; };
  const nv = isWord ? ((await naverFirst) ?? (headword !== q ? await naver(headword) : null)) : await nvPhrase();
  const byPos: { pos: string; terms: string[] }[] = [];
  for (const mc of nv?.meansCollector ?? []) { const terms = (mc.means ?? []).map((m: any) => strip(m.value)).filter(Boolean).slice(0, 4); if (terms.length) byPos.push({ pos: strip(mc.partOfSpeech) || "", terms }); }
  for (const sym of nv?.searchPhoneticSymbolList ?? []) { const code = String(sym.symbolTypeCode ?? ""); const iv = String(sym.symbolValue ?? "").replace(/<sup>\s*[|│｜]\s*<\/sup>/g, "ˈ").replace(/<sub>\s*[|│｜]\s*<\/sub>/g, "ˌ").replace(/<[^>]+>/g, "").trim(); const v = iv ? `/${iv}/` : ""; if (code.includes("US")) { phon.us ||= v; nvAudio.us ||= sym.symbolFile ?? ""; } if (code.includes("GB")) { phon.uk ||= v; nvAudio.uk ||= sym.symbolFile ?? ""; } if (!phon.text && v) phon.text = v; }
  for (const e of entries ?? []) { phon.text ||= e.phonetic ?? ""; for (const p of e.phonetics ?? []) { const a = String(p.audio ?? ""); const t = p.text ?? ""; if (/-us\.mp3$/.test(a)) { phon.audioUs ||= a; phon.us ||= t; } else if (/-uk\.mp3$/.test(a)) { phon.audioUk ||= a; phon.uk ||= t; } else if (a) { phon.audioUs ||= a; } if (!phon.text && t) phon.text = t; } }
  // stable recordings (dictionaryapi.dev) first; signed Naver links only as a fallback
  phon.audioUs ||= nvAudio.us; phon.audioUk ||= nvAudio.uk;
  const meanings: { pos: string; posKo: string; defs: { def: string; ex?: string }[]; synonyms: string[] }[] = [];
  for (const e of entries ?? []) for (const m of e.meanings ?? []) { const ex = meanings.find((x) => x.pos === m.partOfSpeech); const defs = (m.definitions ?? []).slice(0, 3).map((d: any) => ({ def: d.definition, ex: d.example })); if (ex) { ex.defs.push(...defs); ex.defs = ex.defs.slice(0, 4); } else meanings.push({ pos: m.partOfSpeech, posKo: posKo[m.partOfSpeech] ?? m.partOfSpeech, defs, synonyms: (m.synonyms ?? []).slice(0, 5) }); }
  let main = byPos[0]?.terms[0] ?? "";
  if (!main) { const mm = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|ko`).then((r) => r.ok ? r.json() : null).catch(() => null); main = strip(mm?.responseData?.translatedText ?? ""); if (!/[\uAC00-\uD7A3]/.test(main)) main = ""; }
  const data = { q, headword, isWord, phonetic: phon, korean: { main, byPos }, meanings: meanings.slice(0, 4), source: [nv ? "naver" : "", entries ? "dictionaryapi.dev" : "", !nv ? "mymemory" : ""].filter(Boolean).join("+") };
  if (main || meanings.length) supa.from("dict_cache").upsert({ q, data, created_at: new Date().toISOString() }).then(() => {});
  return data;
}

// ---- Published app updates (never compare iOS against Android/APK versions) ----
type UpdateChannel = 'ios' | 'android-apk' | 'android-play' | 'windows' | 'mac';
type PublishedUpdate = { version: string; url: string; publishedAt: string };
const updateMemo = new Map<UpdateChannel, { at: number; release: PublishedUpdate | null }>();
let githubReleaseMemo: { at: number; releases: any[] } | null = null;
const validVersion = (v: unknown): v is string => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
const compareVersion = (a: string, b: string) => { const aa = a.split('.').map(Number), bb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1; } return 0; };
async function updateJson(url: string) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'OrunNote-Release-Check' }, signal: AbortSignal.timeout(4500) });
  if (!r.ok) throw new Error('배포 서버 확인 실패'); return r.json();
}
async function publishedUpdate(channel: UpdateChannel): Promise<PublishedUpdate | null> {
  const now = Date.now(), hit = updateMemo.get(channel); if (hit && now - hit.at < 5 * 60e3) return hit.release;
  const { data: cached, error: cacheError } = await supa.from('app_update_cache').select('release,checked_at,refresh_after').eq('channel', channel).maybeSingle();
  if (cacheError || !cached) throw new Error('업데이트 캐시 확인 실패');
  const checkedAt = Date.parse(cached.checked_at ?? '');
  if (Number.isFinite(checkedAt) && now - checkedAt < 5 * 60e3) {
    updateMemo.set(channel, { at: checkedAt, release: cached.release }); return cached.release;
  }
  const { data: lease, error: leaseError } = await supa.from('app_update_cache').update({ refresh_after: new Date(now + 15_000).toISOString() }).eq('channel', channel).lte('refresh_after', new Date(now).toISOString()).select('channel');
  if (leaseError || !lease?.length) {
    if (Number.isFinite(checkedAt)) return cached.release;
    throw new Error('배포 정보를 확인 중입니다');
  }
  try {
  let release: PublishedUpdate | null = null;
  if (channel === 'ios') {
    // Public App Store availability, NOT TestFlight or an App Store Connect submission.
    const data = await updateJson('https://itunes.apple.com/lookup?id=6829351204&country=kr');
    const app = data.results?.find((a: any) => a.trackId === 6829351204 && a.bundleId === 'com.paperly.study');
    if (app && validVersion(app.version)) release = { version: app.version, url: 'https://apps.apple.com/kr/app/id6829351204', publishedAt: app.currentVersionReleaseDate ?? app.releaseDate };
  } else if (channel === 'android-play') {
    // Google Play has no public version API. A release operator enables this ONLY after public availability is verified.
    const { data, error } = await supa.from('app_update_releases').select('version,url,published_at').eq('channel', channel).eq('enabled', true).lte('published_at', new Date(now).toISOString()).maybeSingle();
    if (error) throw new Error('업데이트 정보 확인 실패');
    if (data && validVersion(data.version) && data.url === 'https://play.google.com/store/apps/details?id=com.paperly.study') release = { version: data.version, url: data.url, publishedAt: data.published_at };
  } else {
    if (!githubReleaseMemo || now - githubReleaseMemo.at >= 5 * 60e3) {
      const rows = await updateJson('https://api.github.com/repos/nathankim6/orun-note/releases?per_page=100');
      if (!Array.isArray(rows)) throw new Error('잘못된 배포 정보'); githubReleaseMemo = { at: now, releases: rows };
    }
    const suffix = channel === 'android-apk' ? 'android' : channel;
    const candidates: PublishedUpdate[] = [];
    for (const r of githubReleaseMemo.releases) {
      if (r.draft || r.prerelease || !r.published_at) continue;
      const m = new RegExp('^v(\\d+\\.\\d+\\.\\d+)-' + suffix + '$').exec(r.tag_name ?? ''); if (!m) continue;
      const name = channel === 'android-apk' ? 'orun-note-galaxytab-arm64.apk' : channel === 'windows' ? 'OrunNote-Setup-' + m[1] + '.exe' : 'OrunNote-' + m[1] + '-mac.dmg';
      const asset = r.assets?.find((a: any) => a.name === name && a.state === 'uploaded' && a.size > 0);
      const prefix = 'https://github.com/nathankim6/orun-note/releases/download/' + r.tag_name + '/';
      if (asset && String(asset.browser_download_url).startsWith(prefix)) candidates.push({ version: m[1], url: asset.browser_download_url, publishedAt: r.published_at });
    }
    candidates.sort((a, b) => compareVersion(b.version, a.version)); release = candidates[0] ?? null;
  }
  await supa.from('app_update_cache').update({ release, checked_at: new Date(now).toISOString(), refresh_after: new Date(now + 5 * 60e3).toISOString() }).eq('channel', channel);
  updateMemo.set(channel, { at: now, release }); return release;
  } catch (error) {
    await supa.from('app_update_cache').update({ refresh_after: new Date(now + 60_000).toISOString() }).eq('channel', channel);
    throw error;
  }
}

// ---- identity ----
type Who = { role: "admin"; email?: string; label: string } | { role: "student"; email: string; student: HwStudent; label: string };
async function emailFromToken(token: string): Promise<{ email: string; uid: string } | null> {
  if (!token) return null; const { data, error } = await supa.auth.getUser(token); if (error || !data.user?.email) return null; return { email: normEmail(data.user.email), uid: data.user.id };
}
async function resolve(body: any): Promise<{ who: Who | null; authed?: { email: string; uid: string } | null; reason?: string }> {
  if (ADMIN_CODE && String(body.code ?? "").replace(/\D/g, "") === ADMIN_CODE) return { who: { role: "admin", label: "관리자" } };
  const authed = await emailFromToken(String(body.token ?? "")); if (!authed) return { who: null, authed: null, reason: "로그인이 필요합니다" };
  const { data: adm } = await supa.from("admin_emails").select("email,label").eq("email", authed.email).maybeSingle(); if (adm) return { who: { role: "admin", email: authed.email, label: adm.label || "관리자" }, authed };
  const { data: link } = await supa.from("student_links").select("*").eq("email", authed.email).maybeSingle(); if (!link) return { who: null, authed, reason: "unlinked" };
  const st = await hwStudentById(link.student_id); if (!st) return { who: null, authed, reason: "학생 정보가 숙제 시스템에서 삭제되었습니다" };
  if (!st.code_active) return { who: null, authed, reason: "학생 코드가 비활성화되었습니다" };
  supa.from("student_links").update({ last_seen_at: new Date().toISOString(), student_name: st.name, student_code: st.code, auth_user_id: authed.uid }).eq("student_id", st.id).then(() => {});
  return { who: { role: "student", email: authed.email, student: st, label: st.name }, authed };
}
// Attach short-lived signed URLs for cover images (admin-uploaded; otherwise the client shows page 1).
async function withCovers(list0: any[]) {
  const list = list0.map((m) => ({ ...m, title: nfc(m.title), file_name: nfc(m.file_name) }));
  const paths = list.map((m) => m.cover_path).filter(Boolean); if (!paths.length) return list;
  const { data } = await supa.storage.from(BUCKET).createSignedUrls(paths, 3600); const map = new Map((data ?? []).map((d: any) => [d.path, d.signedUrl]));
  return list.map((m) => ({ ...m, cover_url: m.cover_path ? map.get(m.cover_path) ?? null : null }));
}
async function materialsFor(st: HwStudent) {
  const ors = [`target_type.eq.all`]; if (st.school_id) ors.push(`and(target_type.eq.school,target_id.eq.${st.school_id})`); if (st.grade_id) ors.push(`and(target_type.eq.grade,target_id.eq.${st.grade_id})`); ors.push(`and(target_type.eq.student,target_id.eq.${st.id})`);
  const { data } = await supa.from("assignments").select("material:materials(*)").or(ors.join(","));
  const seen = new Set<string>(); return (data ?? []).map((r: any) => r.material).filter((m: any) => m && m.ready && !seen.has(m.id) && seen.add(m.id));
}


async function audioFor(raw: string, accent: string): Promise<Response> {
  const q = foldText(raw).replace(/[\u2018\u2019]/g, "'").replace(/[^A-Za-z' -]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
  if (!q) return new Response("bad request", { status: 400, headers: cors });
  const grab = async (u: string, ref?: string) => { const a = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", ...(ref ? { Referer: ref } : {}) } }).catch(() => null); return a && a.ok && /audio|mpeg|octet/.test(a.headers.get("content-type") ?? "") ? a : null; };
  let res: Response | null = null;
  const r = await fetch(`https://en.dict.naver.com/api3/enko/search?query=${encodeURIComponent(q)}&m=pc&range=word&page=1&lang=ko&shouldSearchOpen=false`, { headers: { Referer: "https://en.dict.naver.com/", "User-Agent": "Mozilla/5.0" } }).catch(() => null);
  if (r && r.ok) {
    const j = await r.json().catch(() => null); const items = j?.searchResultMap?.searchResultListMap?.WORD?.items ?? [];
    const it = items.find((x: any) => String(x.expEntry ?? "").replace(/<[^>]+>/g, "").trim().toLowerCase() === q);
    const syms = (it?.searchPhoneticSymbolList ?? []).filter((x: any) => x.symbolFile);
    // Only a recording of the requested accent: Naver often has a British file but no American one, and falling back to
    // syms[0] played the British voice for the "미국" button. Without a match we try dictionaryapi.dev, then 404 so the
    // app uses the device's en-US / en-GB voice instead.
    const pick = syms.find((x: any) => String(x.symbolTypeCode ?? "").includes(accent === "uk" ? "GB" : "US"));
    if (pick) res = await grab(pick.symbolFile, "https://en.dict.naver.com/");
  }
  if (!res) {
    const d = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(q)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const list: string[] = (Array.isArray(d) ? d : []).flatMap((e: any) => e.phonetics ?? []).map((p: any) => String(p.audio ?? "")).filter(Boolean);
    const pick = list.find((u) => u.endsWith(accent === "uk" ? "-uk.mp3" : "-us.mp3"));
    if (pick) res = await grab(pick);
  }
  if (!res) return new Response("no recording", { status: 404, headers: cors });
  return new Response(await res.arrayBuffer(), { status: 200, headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") { const u = new URL(req.url); if (u.searchParams.get("audio")) return audioFor(u.searchParams.get("q") ?? "", u.searchParams.get("accent") ?? "us"); }
  if (req.method !== "POST") return fail("POST only", 405);
  let body: any; try { body = await req.json(); } catch { return fail("invalid json"); }
  const action = String(body.action ?? "");
  if (action === 'app.update') {
    const channel = String(body.channel ?? '');
    if (!['ios', 'android-apk', 'android-play', 'windows', 'mac'].includes(channel)) return fail('invalid update channel');
    try { return json({ ok: true, channel, release: await publishedUpdate(channel as UpdateChannel), checkedAt: new Date().toISOString() }); }
    catch { return fail('업데이트 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', 503); }
  }
  // crash / error diagnostics from the apps (no sign-in needed: a crash can happen before it). Size-capped.
  if (action === "crash.report") {
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 12);
    const meta = { app_version: String(body.app ?? "").slice(0, 20), platform: String(body.platform ?? "").slice(0, 20), device: String(body.device ?? "").slice(0, 80), who: String(body.who ?? "").slice(0, 80) };
    const rows = items.map((it: any) => ({ ...meta, kind: String(it?.kind ?? "js").slice(0, 12), happened_at: Number.isFinite(Number(it?.at)) && Number(it.at) > 0 ? new Date(Number(it.at)).toISOString() : null, detail: String(it?.detail ?? "").slice(0, 24000) })).filter((r: any) => r.detail);
    if (rows.length) { const { error } = await supa.from("crash_reports").insert(rows); if (error) return fail(error.message, 500); }
    return json({ ok: true, saved: rows.length });
  }
  if (action === "dict") { try { const d = await lookup(String(body.q ?? "")); return d ? json({ ok: true, ...d }) : fail("단어를 찾을 수 없어요", 404); } catch (e) { return fail((e as Error).message, 500); } }
  try {
    const r = await resolve(body); const who = r.who;
    supa.from("access_log").insert({ code: (who?.role === "student" ? who.student.code : who?.role === "admin" ? "admin" : (r.authed?.email ?? "-")).slice(0, 40), action, ok: !!who }).then(() => {});

    // ---- 계정 삭제 (App Store 5.1.1(v)): the signed-in Google / Apple user removes their own account ----
    if (action === "auth.delete") {
      if (!r.authed) return fail("로그인이 필요합니다", 401);
      const em = r.authed.email;
      await supa.from("student_links").delete().eq("email", em);
      await supa.from("email_change_requests").delete().eq("old_email", em);
      await supa.from("email_change_requests").delete().eq("new_email", em);
      const { error } = await supa.auth.admin.deleteUser(r.authed.uid);
      if (error) return fail("계정을 삭제하지 못했어요: " + error.message, 500);
      return json({ ok: true });
    }

    // ---- actions available to a signed-in Google user that is not linked yet ----
    if (action === "auth.me") {
      if (!r.authed && !who) return fail(r.reason ?? "로그인이 필요합니다", 401);
      if (!who) { // signed in but not linked (or blocked)
        const { data: pending } = r.authed ? await supa.from("email_change_requests").select("id,status,student_name,created_at").eq("new_email", r.authed.email).eq("status", "pending").maybeSingle() : { data: null };
        return json({ ok: true, role: "none", email: r.authed?.email, reason: r.reason, pendingRequest: pending ?? null });
      }
      if (who.role === "admin") return json({ ok: true, role: "admin", email: who.email, label: who.label });
      return json({ ok: true, role: "student", email: who.email, label: who.label, student: who.student, materials: await materialsFor(who.student) });
    }
    if (action === "auth.link") {
      if (!r.authed) return fail("로그인이 필요합니다", 401);
      if (who && who.role === "student") return json({ ok: true, role: "student", student: who.student, label: who.label, materials: await materialsFor(who.student) });
      const code = normStudentCode(body.studentCode); if (code.length < 3) return fail("학생 코드를 입력하세요");
      const st = await hwStudentByCode(code); if (!st) return fail("학생 코드를 찾을 수 없습니다. 옳은영어 숙제 시스템의 학생 코드를 확인하세요", 404);
      if (!st.code_active) return fail("비활성화된 학생 코드입니다", 403);
      const { data: existing } = await supa.from("student_links").select("*").eq("student_id", st.id).maybeSingle();
      // App Review / demo code: whoever signs in takes it over directly (no approval), so reviewers never get stuck.
      const DEMO = st.code === "E4E6R";
      if (existing && existing.email !== r.authed.email && !DEMO) {
        // Already bound to a different Google account: needs admin approval.
        const { data: dup } = await supa.from("email_change_requests").select("id").eq("student_id", st.id).eq("new_email", r.authed.email).eq("status", "pending").maybeSingle();
        if (!dup) await supa.from("email_change_requests").insert({ student_id: st.id, student_code: st.code, student_name: st.name, old_email: existing.email, new_email: r.authed.email });
        return json({ ok: true, role: "pending", message: `이 학생 코드는 이미 다른 Google 계정(${existing.email.replace(/(.{2}).+(@.+)/, "$1***$2")})에 연결되어 있어요. 관리자 승인 후 이 계정으로 로그인할 수 있습니다.`, student: { name: st.name, grade_name: st.grade_name, school_name: st.school_name } });
      }
      const { error } = await supa.from("student_links").upsert({ student_id: st.id, student_code: st.code, student_name: st.name, email: r.authed.email, auth_user_id: r.authed.uid, last_seen_at: new Date().toISOString() }, { onConflict: "student_id" }); if (error) return fail(error.message.includes("student_links_email_key") ? "이 Google 계정은 이미 다른 학생에 연결되어 있어요" : error.message);
      return json({ ok: true, role: "student", student: st, label: st.name, materials: await materialsFor(st) });
    }
    if (!who) return fail(r.reason === "unlinked" ? "학생 코드 연결이 필요합니다" : (r.reason ?? "로그인이 필요합니다"), 401);

    switch (action) {
      case "verify": return json({ ok: true, role: who.role, label: who.label });
      // 홈워크 tab: the exact login entry orunhomework.com keeps in localStorage ("homework_auth_session") for the linked student code
      case "homework.session": {
        if (who.role !== "student") return json({ ok: true, session: null });
        const codes = await hw(`access_codes?select=id,code,name,is_admin,role,is_active&code=eq.${encodeURIComponent(who.student.code)}&limit=1`);
        const ac = codes[0]; if (!ac || !ac.is_active) return fail("숙제 시스템 학생 코드가 비활성화되었습니다", 403);
        const st = (await hw(`students?select=${encodeURIComponent("id,grade:grade_id(name,school:school_id(name))")}&access_code_id=eq.${ac.id}&limit=1`))[0];
        return json({ ok: true, session: { code: ac.code, name: ac.name, isAdmin: !!ac.is_admin, role: ac.role, accessCodeId: ac.id, studentId: st?.id, schoolName: st?.grade?.school?.name, gradeName: st?.grade?.name } });
      }
      // 보강영상 list: videos linked to the passages of the student's homework (admins see every video group)
      case "videos.list": {
        let rows: any[];
        if (who.role === "student") {
          const sel = encodeURIComponent("homework:homework_id!inner(created_at,passages:passage_id!inner(id,title,review_video_group_id,review_video_title,review_video_youtube_id))");
          rows = await hw(`homework_submissions?select=${sel}&student_id=eq.${encodeURIComponent(who.student.id)}&homework.passages.review_video_youtube_id=not.is.null&order=created_at.desc&limit=3000`);
        } else {
          const ps = await hw(`passages?select=${encodeURIComponent("id,title,created_at,review_video_group_id,review_video_title,review_video_youtube_id")}&review_video_youtube_id=not.is.null&order=created_at.desc&limit=3000`);
          rows = ps.map((p: any) => ({ homework: { created_at: p.created_at, passages: p } }));
        }
        return json({ ok: true, videos: reviewVideos(rows) });
      }
      case "list": {
        if (who.role === "admin") { const { data } = await supa.from("materials").select("*").order("created_at", { ascending: false }); return json({ ok: true, materials: await withCovers(data ?? []) }); }
        return json({ ok: true, materials: await withCovers(await materialsFor(who.student)), student: who.student });
      }
      case "download": {
        const id = String(body.materialId ?? "");
        if (who.role !== "admin") { const allowed = (await materialsFor(who.student)).some((m: any) => m.id === id); if (!allowed) return fail("이 교재에 대한 권한이 없습니다", 403); }
        const { data: m } = await supa.from("materials").select("storage_path,title,file_name,derived").eq("id", id).maybeSingle(); if (!m) return fail("교재를 찾을 수 없습니다", 404);
        const { data: s, error } = await supa.storage.from(BUCKET).createSignedUrl(m.storage_path, 600); if (error || !s) return fail("다운로드 URL 생성 실패: " + (error?.message ?? ""), 500);
        return json({ ok: true, url: s.signedUrl, title: m.title, fileName: m.file_name, derived: m.derived ?? null });
      }
    }
    if (who.role !== "admin") return fail("관리자 전용 기능입니다", 403);
    switch (action) {
      case "roster": { // live from orunhomework + link status + pending requests
        const [roster, { data: links }, { data: reqs }, { data: assigns }] = await Promise.all([hwRoster(), supa.from("student_links").select("student_id,email,linked_at,last_seen_at"), supa.from("email_change_requests").select("*").eq("status", "pending").order("created_at", { ascending: false }), supa.from("assignments").select("id,material_id,target_type,target_id")]);
        return json({ ok: true, ...roster, links: links ?? [], requests: reqs ?? [], assignments: assigns ?? [] });
      }
      case "assign.set": { // replace all targets for a material: targets = [{type, id}]
        const mid = String(body.materialId ?? ""); const targets: { type: string; id: string | null }[] = Array.isArray(body.targets) ? body.targets : [];
        await supa.from("assignments").delete().eq("material_id", mid);
        if (targets.length) { const { error } = await supa.from("assignments").insert(targets.map((t) => ({ material_id: mid, target_type: t.type, target_id: t.type === "all" ? null : t.id }))); if (error) return fail(error.message); }
        const { data } = await supa.from("assignments").select("id,material_id,target_type,target_id").eq("material_id", mid); return json({ ok: true, assignments: data ?? [] });
      }
      case "assign.toggle": { const mid = String(body.materialId ?? ""); const type = String(body.type); const id = type === "all" ? null : String(body.id); const on = !!body.on;
        if (on) { const { error } = await supa.from("assignments").upsert({ material_id: mid, target_type: type, target_id: id }, { onConflict: "material_id,target_type,target_id", ignoreDuplicates: true }); if (error) return fail(error.message); }
        else { let q = supa.from("assignments").delete().eq("material_id", mid).eq("target_type", type); q = id ? q.eq("target_id", id) : q.is("target_id", null); const { error } = await q; if (error) return fail(error.message); }
        return json({ ok: true }); }
      case "requests.decide": { const id = String(body.id); const approve = !!body.approve;
        const { data: rq } = await supa.from("email_change_requests").select("*").eq("id", id).eq("status", "pending").maybeSingle(); if (!rq) return fail("요청을 찾을 수 없습니다", 404);
        if (approve) { const { error } = await supa.from("student_links").update({ email: rq.new_email, auth_user_id: null }).eq("student_id", rq.student_id); if (error) return fail(error.message.includes("student_links_email_key") ? "이 Google 계정은 이미 다른 학생에 연결되어 있어요" : error.message); }
        await supa.from("email_change_requests").update({ status: approve ? "approved" : "rejected", decided_at: new Date().toISOString() }).eq("id", id); return json({ ok: true }); }
      case "links.unlink": { const { error } = await supa.from("student_links").delete().eq("student_id", String(body.studentId)); if (error) return fail(error.message); return json({ ok: true }); }
      case "admins.list": { const { data } = await supa.from("admin_emails").select("*").order("created_at"); return json({ ok: true, admins: data ?? [] }); }
      case "admins.add": { const e = normEmail(body.email); if (!/^[^@]+@[^@]+\.[^@]+$/.test(e)) return fail("이메일 형식이 아닙니다"); const { error } = await supa.from("admin_emails").upsert({ email: e, label: String(body.label ?? "") }); if (error) return fail(error.message); return json({ ok: true }); }
      case "admins.remove": { const { error } = await supa.from("admin_emails").delete().eq("email", normEmail(body.email)); if (error) return fail(error.message); return json({ ok: true }); }
      case "materials.uploadUrl": {
        const title = nfc(body.title).trim() || "제목 없음"; const fileName = nfc(body.fileName ?? "file.pdf");
        const id = crypto.randomUUID(); const path = `${id}.pdf`;
        const { data: s, error } = await supa.storage.from(BUCKET).createSignedUploadUrl(path); if (error || !s) return fail("업로드 URL 생성 실패: " + (error?.message ?? ""), 500);
        const { error: e2 } = await supa.from("materials").insert({ id, title, file_name: fileName, storage_path: path, ready: false }); if (e2) return fail(e2.message);
        return json({ ok: true, materialId: id, path, uploadUrl: s.signedUrl, token: s.token });
      }
      case "materials.complete": { const { data, error } = await supa.from("materials").update({ ready: true, size: Number(body.size ?? 0), pages: Number(body.pages ?? 0) }).eq("id", String(body.materialId)).select().single(); if (error) return fail(error.message); return json({ ok: true, material: data }); }
      case "materials.coverUploadUrl": { const id = String(body.materialId ?? ""); const ext = String(body.ext ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg"; const path = `covers/${id}.${ext}`;
        const { data, error } = await supa.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true }); if (error || !data) return fail("표지 업로드 URL 생성 실패: " + (error?.message ?? ""), 500);
        await supa.from("materials").update({ cover_path: path }).eq("id", id); return json({ ok: true, path, uploadUrl: data.signedUrl, token: data.token }); }
      case "materials.coverClear": { const { data: m } = await supa.from("materials").select("cover_path").eq("id", String(body.id)).maybeSingle(); if (m?.cover_path) await supa.storage.from(BUCKET).remove([m.cover_path]); await supa.from("materials").update({ cover_path: null }).eq("id", String(body.id)); return json({ ok: true }); }
      case "materials.rename": { const { data, error } = await supa.from("materials").update({ title: nfc(body.title) }).eq("id", String(body.id)).select().single(); if (error) return fail(error.message); return json({ ok: true, material: data }); }
      // ---- pre-rendered page images (docs/derived-pages.md) ----
      case "materials.derivedUploadUrl": {
        if (who.role !== "admin") return fail("권한이 없습니다", 403);
        const id = String(body.materialId ?? ""); if (!/^[0-9a-f-]{36}$/.test(id)) return fail("materialId");
        const files = (Array.isArray(body.files) ? body.files : []).map((x: unknown) => String(x)).filter((x: string) => /^(manifest\.json|p\d{1,4}-(1200|2400|3600)\.jpg|p\d{1,4}-words\.json)$/.test(x)).slice(0, 300);
        const uploads: { path: string; url: string; token: string }[] = [];
        for (const name of files) {
          const path = `derived/${id}/v1/${name}`;
          const { data, error } = await supa.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true }); if (error || !data) return fail("업로드 URL 생성 실패: " + (error?.message ?? ""), 500);
          uploads.push({ path, url: data.signedUrl, token: data.token });
        }
        return json({ ok: true, uploads });
      }
      case "materials.derivedComplete": {
        if (who.role !== "admin") return fail("권한이 없습니다", 403);
        const id = String(body.materialId ?? ""); const m = body.manifest ?? {};
        const derived = { version: Number(m.version ?? 1), pages: Number(m.pages ?? 0), widths: Array.isArray(m.widths) ? m.widths.map(Number) : [1200, 2400], words: !!m.words, bytes: Number(m.bytes ?? 0), generatedAt: String(m.generatedAt ?? new Date().toISOString()), engine: String(m.engine ?? "").slice(0, 80) };
        if (!(derived.pages > 0)) return fail("manifest.pages");
        const { data, error } = await supa.from("materials").update({ derived }).eq("id", id).select().single(); if (error) return fail(error.message);
        return json({ ok: true, material: data });
      }
      case "materials.derivedUrls": {
        const id = String(body.materialId ?? "");
        if (who.role !== "admin") { const allowed = (await materialsFor(who.student)).some((m: any) => m.id === id); if (!allowed) return fail("이 교재에 대한 권한이 없습니다", 403); }
        const files = (Array.isArray(body.files) ? body.files : []).map((x: unknown) => String(x)).filter((x: string) => /^(manifest\.json|p\d{1,4}-(1200|2400|3600)\.jpg|p\d{1,4}-words\.json)$/.test(x)).slice(0, 300);
        if (!files.length) return json({ ok: true, urls: [] });
        const paths = files.map((n: string) => `derived/${id}/v1/${n}`);
        const { data, error } = await supa.storage.from(BUCKET).createSignedUrls(paths, 900); if (error || !data) return fail("다운로드 URL 생성 실패: " + (error?.message ?? ""), 500);
        return json({ ok: true, urls: data.filter((d: any) => d.signedUrl && !d.error).map((d: any) => ({ path: d.path, url: d.signedUrl })) });
      }
      case "materials.delete": {
        const { data: m } = await supa.from("materials").select("storage_path,cover_path").eq("id", String(body.id)).maybeSingle();
        if (m) await supa.storage.from(BUCKET).remove([m.storage_path, ...(m.cover_path ? [m.cover_path] : [])]);
        // pre-rendered pages live under derived/{id}/v1/ (up to a few hundred files; list is paged by 1000)
        try { const { data: files } = await supa.storage.from(BUCKET).list(`derived/${String(body.id)}/v1`, { limit: 1000 }); const paths = (files ?? []).map((x: any) => `derived/${String(body.id)}/v1/${x.name}`); if (paths.length) await supa.storage.from(BUCKET).remove(paths); } catch { /* best effort */ }
        const { error } = await supa.from("materials").delete().eq("id", String(body.id)); if (error) return fail(error.message); return json({ ok: true });
      }
      case "stats": { const [{ count: l }, { count: m }, { count: p }, { data: log }] = await Promise.all([supa.from("student_links").select("*", { count: "exact", head: true }), supa.from("materials").select("*", { count: "exact", head: true }), supa.from("email_change_requests").select("*", { count: "exact", head: true }).eq("status", "pending"), supa.from("access_log").select("code,action,ok,at").order("at", { ascending: false }).limit(60)]);
        return json({ ok: true, linked: l ?? 0, materials: m ?? 0, pending: p ?? 0, log: log ?? [] }); }
    }
    return fail("알 수 없는 action: " + action, 404);
  } catch (e) { return fail((e as Error).message ?? "server error", 500); }
});
