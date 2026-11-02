import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ImageBox, InkVersion, Stroke, TextBox } from '@/data/types';
import { nowIso, persistOpts, uid } from './persist';

export type PageInk = { strokes: Stroke[]; textBoxes: TextBox[]; images?: ImageBox[]; versions: InkVersion[]; updatedAt: string };
type InkState = {
  pages: Record<string, PageInk>; // key = `${packageId}:${cycle}:${pageId}` or `note:${noteId}:${pageId}`
  get: (k: string) => PageInk; addStroke: (k: string, s: Stroke) => void; removeStrokes: (k: string, ids: string[]) => void; setStrokes: (k: string, strokes: Stroke[]) => void; clear: (k: string) => void;
  addText: (k: string, t: TextBox) => void; updateText: (k: string, id: string, patch: Partial<TextBox>) => void; removeText: (k: string, id: string) => void;
  setImages: (k: string, images: ImageBox[]) => void;
  snapshot: (k: string, label?: string) => void; restore: (k: string, versionId: string) => void; clearPackage: (prefix: string) => void;
};
const empty: PageInk = { strokes: [], textBoxes: [], versions: [], updatedAt: '' };
export const inkKey = (packageId: string, cycle: number, pageId: string) => `${packageId}:${cycle}:${pageId}`;
export const useInkStore = create<InkState>()(persist((set, get) => ({
  pages: {},
  get: (k) => get().pages[k] ?? empty,
  addStroke: (k, s) => set((st) => { const p = st.pages[k] ?? empty; return { pages: { ...st.pages, [k]: { ...p, strokes: [...p.strokes, s], updatedAt: nowIso() } } }; }),
  removeStrokes: (k, ids) => set((st) => { const p = st.pages[k] ?? empty; return { pages: { ...st.pages, [k]: { ...p, strokes: p.strokes.filter((s) => !ids.includes(s.id)), updatedAt: nowIso() } } }; }),
  setStrokes: (k, strokes) => set((st) => { const p = st.pages[k] ?? empty; return { pages: { ...st.pages, [k]: { ...p, strokes, updatedAt: nowIso() } } }; }),
  clear: (k) => set((st) => { const p = st.pages[k] ?? empty; return { pages: { ...st.pages, [k]: { ...p, strokes: [], textBoxes: [], images: [], updatedAt: nowIso() } } }; }),
  addText: (k, t) => set((st) => { const p = st.pages[k] ?? empty; return { pages: { ...st.pages, [k]: { ...p, textBoxes: [...p.textBoxes, t], updatedAt: nowIso() } } }; }),
  updateText: (k, id, patch) => set((st) => { const p = st.pages[k] ?? empty; return { pages: { ...st.pages, [k]: { ...p, textBoxes: p.textBoxes.map((t) => (t.id === id ? { ...t, ...patch } : t)), updatedAt: nowIso() } } }; }),
  removeText: (k, id) => set((st) => { const p = st.pages[k] ?? empty; return { pages: { ...st.pages, [k]: { ...p, textBoxes: p.textBoxes.filter((t) => t.id !== id), updatedAt: nowIso() } } }; }),
  setImages: (k, images) => set((st) => { const p = st.pages[k] ?? empty; return { pages: { ...st.pages, [k]: { ...p, images, updatedAt: nowIso() } } }; }),
  snapshot: (k, label) => set((st) => { const p = st.pages[k]; if (!p || (p.strokes.length === 0 && p.textBoxes.length === 0)) return {}; const last = p.versions[p.versions.length - 1]; if (last && last.strokes.length === p.strokes.length && last.textBoxes.length === p.textBoxes.length) return {}; const v: InkVersion = { id: uid(), createdAt: nowIso(), strokes: p.strokes, textBoxes: p.textBoxes, label: label ?? `${p.strokes.length}획` }; return { pages: { ...st.pages, [k]: { ...p, versions: [...p.versions.slice(-19), v] } } }; }),
  restore: (k, versionId) => set((st) => { const p = st.pages[k]; const v = p?.versions.find((x) => x.id === versionId); if (!p || !v) return {}; return { pages: { ...st.pages, [k]: { ...p, strokes: v.strokes, textBoxes: v.textBoxes, updatedAt: nowIso() } } }; }),
  clearPackage: (prefix) => set((st) => ({ pages: Object.fromEntries(Object.entries(st.pages).filter(([k]) => !k.startsWith(prefix))) })),
}), persistOpts('ink')));
