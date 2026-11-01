import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOpts, nowIso } from './persist';
import { api, ApiError, Material } from '@/lib/api';

type SessionState = {
  code: string | null; role: 'admin' | 'user' | null; label: string; verifiedAt: string | null; hydrated: boolean; materials: Material[]; materialsAt: string | null; lastError: string | null;
  signIn: (code: string) => Promise<{ ok: boolean; message?: string }>; signOut: () => void; revalidate: () => Promise<void>; refreshMaterials: () => Promise<Material[]>; setHydrated: () => void;
};
export const useSession = create<SessionState>()(persist((set, get) => ({
  code: null, role: null, label: '', verifiedAt: null, hydrated: false, materials: [], materialsAt: null, lastError: null,
  signIn: async (raw) => { const code = raw.replace(/\D/g, ''); if (code.length < 4) return { ok: false, message: '코드를 입력해 주세요' }; try { const r = await api.verify(code); set({ code, role: r.role, label: r.label, verifiedAt: nowIso(), lastError: null }); get().refreshMaterials().catch(() => {}); return { ok: true }; } catch (e: any) { return { ok: false, message: e?.message ?? '확인 실패' }; } },
  signOut: () => set({ code: null, role: null, label: '', verifiedAt: null, materials: [], materialsAt: null }),
  // Re-check the code when online; a revoked/deleted code locks the app, network failures keep the cached session.
  revalidate: async () => { const code = get().code; if (!code) return; try { const r = await api.verify(code); set({ role: r.role, label: r.label, verifiedAt: nowIso(), lastError: null }); } catch (e: any) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { set({ code: null, role: null, label: '', verifiedAt: null, materials: [], lastError: '접속 코드가 더 이상 유효하지 않습니다' }); } } },
  refreshMaterials: async () => { const code = get().code; if (!code) return []; const r = await api.list(code); set({ materials: r.materials, materialsAt: nowIso() }); return r.materials; },
  setHydrated: () => set({ hydrated: true }),
}), { ...persistOpts<SessionState>('session', (s) => ({ code: s.code, role: s.role, label: s.label, verifiedAt: s.verifiedAt, materials: s.materials, materialsAt: s.materialsAt })), onRehydrateStorage: () => (st) => st?.setHydrated() }));
