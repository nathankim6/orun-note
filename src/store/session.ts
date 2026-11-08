import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOpts, nowIso } from './persist';
import { api, ApiError, Material, HwStudent } from '@/lib/api';
import { signInWithGoogle, signOutGoogle } from '@/lib/googleAuth';
import { signInWithApple } from '@/lib/appleAuth';
import { supabase } from '@/lib/supabase';

type Role = 'admin' | 'student' | null;
type SessionState = {
  adminCode: string | null;             // set only when the admin signed in with the admin code
  role: Role; label: string; email: string | null; student: HwStudent | null;
  // Google signed in but no student link yet (or waiting for admin approval)
  needsLink: boolean; pendingMessage: string | null;
  verifiedAt: string | null; hydrated: boolean; materials: Material[]; materialsAt: string | null; lastError: string | null; busy: boolean;
  /** credential passed to the API: admin code or null (Google token is read from the Supabase session) */
  cred: () => string | null;
  signInGoogle: () => Promise<{ ok: boolean; message?: string }>;
  signInApple: () => Promise<{ ok: boolean; message?: string }>;
  signInAdminCode: (code: string) => Promise<{ ok: boolean; message?: string }>;
  linkStudent: (studentCode: string) => Promise<{ ok: boolean; message?: string; pending?: boolean }>;
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshMaterials: () => Promise<Material[]>; setHydrated: () => void;
};
export const useSession = create<SessionState>()(persist((set, get) => ({
  adminCode: null, role: null, label: '', email: null, student: null, needsLink: false, pendingMessage: null, verifiedAt: null, hydrated: false, materials: [], materialsAt: null, lastError: null, busy: false,
  cred: () => get().adminCode,
  signInGoogle: async () => { set({ busy: true, lastError: null }); const r = await signInWithGoogle(); if (!r.ok) { set({ busy: false, lastError: r.message ?? null }); return r; } await get().refreshMe(); set({ busy: false }); return { ok: true }; },
  signInApple: async () => { set({ busy: true, lastError: null }); const r = await signInWithApple(); if (!r.ok) { set({ busy: false, lastError: r.message ?? null }); return r; } await get().refreshMe(); set({ busy: false }); return { ok: true }; },
  signInAdminCode: async (raw) => { const code = raw.replace(/\D/g, ''); if (code.length < 4) return { ok: false, message: '관리자 코드를 입력해 주세요' }; try { const r = await api.me(code); if (r.role !== 'admin') return { ok: false, message: '관리자 코드가 아닙니다' }; set({ adminCode: code, role: 'admin', label: r.label, email: null, student: null, needsLink: false, verifiedAt: nowIso(), lastError: null }); return { ok: true }; } catch (e: any) { return { ok: false, message: e?.message ?? '확인 실패' }; } },
  linkStudent: async (studentCode) => { try { const r = await api.link(studentCode); if (r.role === 'pending') { set({ needsLink: true, pendingMessage: r.message ?? '관리자 승인 대기 중' }); return { ok: true, pending: true, message: r.message }; } set({ role: 'student', label: r.label ?? r.student?.name ?? '', student: r.student ?? null, materials: r.materials ?? [], materialsAt: nowIso(), needsLink: false, pendingMessage: null, verifiedAt: nowIso(), lastError: null }); return { ok: true }; } catch (e: any) { return { ok: false, message: e?.message ?? '연결 실패' }; } },
  // Re-read identity from the server. Admin code sessions and Google sessions are handled the same way.
  refreshMe: async () => {
    const { adminCode } = get();
    if (!adminCode) { const { data } = await supabase.auth.getSession(); if (!data.session) { set({ role: null, email: null, student: null, needsLink: false, pendingMessage: null }); return; } set({ email: data.session.user.email ?? null }); }
    try {
      const r = await api.me(adminCode);
      if (r.role === 'admin') set({ role: 'admin', label: r.label, email: r.email ?? get().email, student: null, needsLink: false, pendingMessage: null, verifiedAt: nowIso(), lastError: null });
      else if (r.role === 'student') set({ role: 'student', label: r.label, email: r.email, student: r.student, materials: r.materials, materialsAt: nowIso(), needsLink: false, pendingMessage: null, verifiedAt: nowIso(), lastError: null });
      else set({ role: null, email: r.email ?? get().email, student: null, needsLink: true, pendingMessage: r.pendingRequest ? `'${r.pendingRequest.student_name}' 학생 코드 연결 요청이 관리자 승인을 기다리고 있어요.` : (r.reason && r.reason !== 'unlinked' ? r.reason : null), verifiedAt: nowIso() });
    } catch (e) {
      const ae = e as ApiError; if (ae.status === 401 || ae.status === 403) set({ role: null, student: null, needsLink: !adminCode, adminCode: null, lastError: ae.message }); else set({ lastError: ae.message }); // offline: keep cached role
    }
  },
  signOut: async () => { await signOutGoogle(); set({ adminCode: null, role: null, label: '', email: null, student: null, needsLink: false, pendingMessage: null, verifiedAt: null, materials: [], materialsAt: null }); },
  refreshMaterials: async () => { const r = await api.list(get().adminCode); set({ materials: r.materials, materialsAt: nowIso(), ...(r.student ? { student: r.student } : {}) }); return r.materials; },
  setHydrated: () => set({ hydrated: true }),
}), { ...persistOpts<SessionState>('session2', (s) => ({ adminCode: s.adminCode, role: s.role, label: s.label, email: s.email, student: s.student, verifiedAt: s.verifiedAt, materials: s.materials, materialsAt: s.materialsAt })), onRehydrateStorage: () => (state) => state?.setHydrated() }));
