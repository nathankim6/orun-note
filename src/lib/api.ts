import { DOCS_FN, SUPABASE_ANON_KEY } from './config';
export type Material = { id: string; title: string; file_name: string; storage_path: string; size: number; pages: number; ready: boolean; created_at: string };
export type AccessCode = { id: string; code: string; label: string; active: boolean; created_at: string; last_used_at: string | null };
export class ApiError extends Error { status: number; constructor(m: string, status: number) { super(m); this.status = status; } }

export async function callDocs<T = any>(action: string, code: string, payload: Record<string, unknown> = {}): Promise<T> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  try { res = await fetch(DOCS_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, body: JSON.stringify({ action, code, ...payload }), signal: ctrl.signal }); }
  catch (e: any) { throw new ApiError(e?.name === 'AbortError' ? '서버 응답이 없습니다. 네트워크를 확인해 주세요.' : '네트워크 연결을 확인해 주세요.', 0); }
  finally { clearTimeout(t); }
  let data: any = null; try { data = await res.json(); } catch {}
  if (!res.ok || !data?.ok) throw new ApiError(data?.error ?? `요청 실패 (${res.status})`, res.status);
  return data as T;
}
export const api = {
  verify: (code: string) => callDocs<{ role: 'admin' | 'user'; label: string }>('verify', code),
  list: (code: string) => callDocs<{ materials: Material[] }>('list', code),
  download: (code: string, materialId: string) => callDocs<{ url: string; title: string; fileName: string }>('download', code, { materialId }),
  codes: { list: (code: string) => callDocs<{ codes: AccessCode[]; links: { code_id: string; material_id: string }[] }>('codes.list', code), create: (code: string, label: string, newCode?: string) => callDocs<{ code: AccessCode }>('codes.create', code, { label, newCode }), update: (code: string, id: string, patch: { active?: boolean; label?: string }) => callDocs<{ code: AccessCode }>('codes.update', code, { id, ...patch }), delete: (code: string, id: string) => callDocs('codes.delete', code, { id }) },
  assign: (code: string, codeId: string, materialId: string, assigned: boolean) => callDocs('assign', code, { codeId, materialId, assigned }),
  assignBulk: (code: string, codeId: string, materialIds: string[]) => callDocs('assign.bulk', code, { codeId, materialIds }),
  materials: { uploadUrl: (code: string, title: string, fileName: string) => callDocs<{ materialId: string; path: string; uploadUrl: string; token: string }>('materials.uploadUrl', code, { title, fileName }), complete: (code: string, materialId: string, size: number, pages: number) => callDocs<{ material: Material }>('materials.complete', code, { materialId, size, pages }), rename: (code: string, id: string, title: string) => callDocs('materials.rename', code, { id, title }), delete: (code: string, id: string) => callDocs('materials.delete', code, { id }) },
  stats: (code: string) => callDocs<{ codes: number; materials: number; log: { code: string; action: string; ok: boolean; at: string }[] }>('stats', code),
};
