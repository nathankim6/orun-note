import { DOCS_FN, SUPABASE_ANON_KEY } from './config';
import { getAccessToken } from './supabase';
export type Material = { id: string; title: string; file_name: string; storage_path: string; size: number; pages: number; ready: boolean; created_at: string; cover_path?: string | null; cover_url?: string | null };
export type HwStudent = { id: string; name: string; code: string; code_active: boolean; grade_id: string | null; grade_name: string; school_id: string | null; school_name: string };
export type Roster = { schools: { id: string; name: string }[]; grades: { id: string; name: string; school_id: string }[]; students: HwStudent[]; links: { student_id: string; email: string; linked_at: string; last_seen_at: string | null }[]; requests: EmailRequest[]; assignments: Assignment[] };
export type Assignment = { id: string; material_id: string; target_type: 'all' | 'school' | 'grade' | 'student'; target_id: string | null };
export type EmailRequest = { id: string; student_id: string; student_code: string; student_name: string; old_email: string; new_email: string; status: string; created_at: string };
export type Me = { role: 'admin'; email?: string; label: string } | { role: 'student'; email: string; label: string; student: HwStudent; materials: Material[] } | { role: 'none'; email?: string; reason?: string; pendingRequest: { id: string; student_name: string; created_at: string } | null };
export type HwSession = { code: string; name: string; isAdmin: boolean; role: string; accessCodeId: string; studentId?: string; schoolName?: string; gradeName?: string };
export class ApiError extends Error { status: number; constructor(m: string, status: number) { super(m); this.status = status; } }

/** Credential = admin code (if set) and/or the Google session token. */
export async function callDocs<T = any>(action: string, adminCode: string | null, payload: Record<string, unknown> = {}): Promise<T> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
  const token = adminCode ? null : await getAccessToken();
  let res: Response;
  try { res = await fetch(DOCS_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, body: JSON.stringify({ action, ...(adminCode ? { code: adminCode } : {}), ...(token ? { token } : {}), ...payload }), signal: ctrl.signal }); }
  catch (e: any) { throw new ApiError(e?.name === 'AbortError' ? '서버 응답이 없습니다. 네트워크를 확인해 주세요.' : '네트워크 연결을 확인해 주세요.', 0); }
  finally { clearTimeout(t); }
  let data: any = null; try { data = await res.json(); } catch {}
  if (!res.ok || !data?.ok) throw new ApiError(data?.error ?? `요청 실패 (${res.status})`, res.status);
  return data as T;
}
export const api = {
  me: (adminCode: string | null) => callDocs<Me & { ok: true }>('auth.me', adminCode),
  link: (studentCode: string) => callDocs<{ role: 'student' | 'pending'; student?: HwStudent; label?: string; materials?: Material[]; message?: string }>('auth.link', null, { studentCode }),
  list: (c: string | null) => callDocs<{ materials: Material[]; student?: HwStudent }>('list', c),
  download: (c: string | null, materialId: string) => callDocs<{ url: string; title: string; fileName: string }>('download', c, { materialId }),
  roster: (c: string | null) => callDocs<Roster>('roster', c),
  assignToggle: (c: string | null, materialId: string, type: Assignment['target_type'], id: string | null, on: boolean) => callDocs('assign.toggle', c, { materialId, type, id, on }),
  decide: (c: string | null, id: string, approve: boolean) => callDocs('requests.decide', c, { id, approve }),
  unlink: (c: string | null, studentId: string) => callDocs('links.unlink', c, { studentId }),
  admins: { list: (c: string | null) => callDocs<{ admins: { email: string; label: string }[] }>('admins.list', c), add: (c: string | null, email: string, label: string) => callDocs('admins.add', c, { email, label }), remove: (c: string | null, email: string) => callDocs('admins.remove', c, { email }) },
  materials: { uploadUrl: (c: string | null, title: string, fileName: string) => callDocs<{ materialId: string; path: string; uploadUrl: string; token: string }>('materials.uploadUrl', c, { title, fileName }), complete: (c: string | null, materialId: string, size: number, pages: number) => callDocs<{ material: Material }>('materials.complete', c, { materialId, size, pages }), rename: (c: string | null, id: string, title: string) => callDocs('materials.rename', c, { id, title }), coverUploadUrl: (c: string | null, materialId: string, ext: string) => callDocs<{ path: string; uploadUrl: string; token: string }>('materials.coverUploadUrl', c, { materialId, ext }), coverClear: (c: string | null, id: string) => callDocs('materials.coverClear', c, { id }), delete: (c: string | null, id: string) => callDocs('materials.delete', c, { id }) },
  homeworkSession: (c: string | null) => callDocs<{ session: HwSession | null }>('homework.session', c),
  stats: (c: string | null) => callDocs<{ linked: number; materials: number; pending: number; log: { code: string; action: string; ok: boolean; at: string }[] }>('stats', c),
};
