import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Doc, Folder } from '@/data/types';
import { nowIso, persistOpts, uid } from './persist';

type DocsState = {
  docs: Record<string, Doc>; folders: Folder[]; openTabs: string[]; activeTab: string | null; toast: string | null;
  add: (d: Omit<Doc, 'id' | 'createdAt' | 'updatedAt' | 'lastPage' | 'bookmarks' | 'cycle' | 'maxCycle' | 'tags'> & Partial<Doc>) => Doc;
  update: (id: string, patch: Partial<Doc>) => void; remove: (id: string) => void; touch: (id: string, page: number) => void; toggleBookmark: (id: string, page: number) => void;
  createFolder: (name: string, color: string) => string; renameFolder: (id: string, name: string) => void; deleteFolder: (id: string) => void; moveToFolder: (ids: string[], folderId?: string) => void;
  startNewCycle: (id: string) => number; switchCycle: (id: string, c: number) => void;
  openTab: (id: string) => void; closeTab: (id: string) => void; setActiveTab: (id: string) => void; showToast: (m: string) => void;
};
let toastTimer: any;
export const COVER_COLORS = ['#0E7C7B', '#3B6FD6', '#E08E2B', '#D64545', '#7C5CBF', '#2E9E5B', '#5B6B7A', '#B23A48', '#8F5A2D'];
export const useDocsStore = create<DocsState>()(persist((set, get) => ({
  docs: {}, folders: [], openTabs: [], activeTab: null, toast: null,
  add: (d) => { const doc: Doc = { id: uid(), createdAt: nowIso(), updatedAt: nowIso(), lastPage: 0, bookmarks: [], cycle: 1, maxCycle: 1, tags: [], ...d } as Doc; set((s) => ({ docs: { ...s.docs, [doc.id]: doc } })); return doc; },
  update: (id, patch) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], ...patch, updatedAt: nowIso() } } } : {})),
  remove: (id) => set((s) => { const docs = { ...s.docs }; delete docs[id]; return { docs, openTabs: s.openTabs.filter((t) => t !== id), activeTab: s.activeTab === id ? null : s.activeTab }; }),
  touch: (id, page) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], lastPage: page, lastOpenedAt: nowIso() } } } : {})),
  toggleBookmark: (id, page) => set((s) => { const d = s.docs[id]; if (!d) return {}; const b = d.bookmarks.includes(page) ? d.bookmarks.filter((x) => x !== page) : [...d.bookmarks, page].sort((a, b) => a - b); return { docs: { ...s.docs, [id]: { ...d, bookmarks: b } } }; }),
  createFolder: (name, color) => { const id = uid(); set((s) => ({ folders: [...s.folders, { id, name, color, createdAt: nowIso() }] })); return id; },
  renameFolder: (id, name) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) })),
  deleteFolder: (id) => set((s) => ({ folders: s.folders.filter((f) => f.id !== id), docs: Object.fromEntries(Object.entries(s.docs).map(([k, v]) => [k, v.folderId === id ? { ...v, folderId: undefined } : v])) })),
  moveToFolder: (ids, folderId) => set((s) => ({ docs: Object.fromEntries(Object.entries(s.docs).map(([k, v]) => [k, ids.includes(k) ? { ...v, folderId } : v])) })),
  startNewCycle: (id) => { const next = (get().docs[id]?.maxCycle ?? 1) + 1; set((s) => ({ docs: { ...s.docs, [id]: { ...s.docs[id], cycle: next, maxCycle: next } } })); return next; },
  switchCycle: (id, cycle) => set((s) => ({ docs: { ...s.docs, [id]: { ...s.docs[id], cycle } } })),
  openTab: (id) => set((s) => ({ openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id], activeTab: id })),
  closeTab: (id) => set((s) => { const openTabs = s.openTabs.filter((x) => x !== id); return { openTabs, activeTab: s.activeTab === id ? openTabs[openTabs.length - 1] ?? null : s.activeTab }; }),
  setActiveTab: (id) => set({ activeTab: id }),
  showToast: (m) => { set({ toast: m }); clearTimeout(toastTimer); toastTimer = setTimeout(() => set({ toast: null }), 2200); },
}), persistOpts<DocsState>('docs', (s) => ({ docs: s.docs, folders: s.folders, openTabs: s.openTabs, activeTab: s.activeTab }))));
