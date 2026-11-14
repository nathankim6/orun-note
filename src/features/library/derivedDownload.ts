/**
 * Downloads a material's pre-rendered pages (docs/derived-pages.md) into the app's documents directory and keeps the
 * document's `derived` record up to date. Resumable: every file is checked on disk, so a restart continues where it
 * stopped. One material downloads at a time; the viewer can re-prioritise the pages around the one being read.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { api } from '@/lib/api';
import { useDocsStore } from '@/store/docs';
import { useSettingsStore } from '@/store/settings';
import type { Doc } from '@/data/types';
import { chunk, derivedFileNames, derivedRelDir, MANIFEST_NAME, orderForPriority, parseManifest, tierWidth, URL_BATCH, type DerivedInfo, type DerivedManifest } from '@/features/viewer/derivedPagesCore';
import { exists, markPresent } from '@/features/viewer/derivedPages';

export type DerivedProgress = { done: number; total: number; bytes: number; state: 'checking' | 'downloading' | 'done' | 'deferred' | 'error'; error?: string };
type ProgressState = { byMaterial: Record<string, DerivedProgress>; set: (id: string, p: DerivedProgress | null) => void };
/** Live progress for the library cards (not persisted: resume state is the files themselves). */
export const useDerivedProgress = create<ProgressState>()((set) => ({ byMaterial: {}, set: (id, p) => set((s) => { const n = { ...s.byMaterial }; if (p) n[id] = p; else delete n[id]; return { byMaterial: n }; }) }));

const CONCURRENCY = 6;
const running = new Map<string, Promise<void>>();
const priority = new Map<string, number | null>();
type Fetcher = (code: string | null, materialId: string, files: string[]) => Promise<{ urls: { path: string; url: string }[] }>;
let fetchImpl: Fetcher = (c, id, files) => api.materials.derivedUrls(c, id, files);
/** test seam */ export const _internals = { setFetcher(f: Fetcher) { fetchImpl = f; } };

const docsDir = () => FileSystem.documentDirectory ?? '';
export const derivedDir = (materialId: string, version: number) => docsDir() + derivedRelDir(materialId, version);
export function infoFor(doc: Pick<Doc, 'materialId' | 'derived'> | null | undefined): DerivedInfo | null {
  if (!doc?.materialId || !doc.derived || Platform.OS === 'web') return null;
  const d = doc.derived; return { version: d.version, pages: d.pages, widths: d.widths, words: d.words, dir: derivedDir(doc.materialId, d.version) };
}
async function onCellularOnly(): Promise<boolean> {
  if (!useSettingsStore.getState().derivedWifiOnly) return false;
  try { const Net = require('expo-network'); const st = await Net.getNetworkStateAsync(); return st?.type === Net.NetworkStateType?.CELLULAR; } catch { return false; }
}
async function download(url: string, dest: string): Promise<number> {
  const tmp = dest + '.part';
  const r = await FileSystem.downloadAsync(url, tmp);
  if (r.status !== 200) { await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {}); throw new Error('HTTP ' + r.status); }
  const info = await FileSystem.getInfoAsync(tmp); const size = info.exists ? (info as any).size ?? 0 : 0;
  if (!(size > 0)) { await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {}); throw new Error('empty'); }
  await FileSystem.moveAsync({ from: tmp, to: dest }); markPresent(dest); return size;
}
/** Fetches (or re-uses) the manifest and records `doc.derived`. Returns null when the server has no derived set. */
async function ensureManifest(code: string | null, doc: Doc): Promise<DerivedManifest | null> {
  if (doc.derived) return doc.derived;
  const r = await fetchImpl(code, doc.materialId!, [MANIFEST_NAME]); const u = r.urls[0]; if (!u) return null;
  const base = docsDir() + `derived/${doc.materialId}/`; await FileSystem.makeDirectoryAsync(base, { intermediates: true }).catch(() => {});
  const tmp = base + `manifest-${Date.now()}.json`;
  const d = await FileSystem.downloadAsync(u.url, tmp); if (d.status !== 200) throw new Error('manifest HTTP ' + d.status);
  const m = parseManifest(JSON.parse(await FileSystem.readAsStringAsync(tmp))); await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
  if (!m) return null;
  useDocsStore.getState().update(doc.id, { derived: m }); return m;
}
/** Pages around `page` download first; safe to call while a download is running (takes effect at the next batch). */
export function prioritise(materialId: string, page: number | null) { priority.set(materialId, page); }
/**
 * Makes sure the document's derived pages are on disk, downloading what is missing. Resolves when complete, deferred
 * (wifi-only on cellular) or failed; never throws. Concurrent calls for the same material share one run.
 */
export function ensureDerived(code: string | null, doc: Doc, opts: { page?: number | null; serverDerived?: unknown } = {}): Promise<void> {
  if (Platform.OS === 'web' || !doc.materialId || doc.kind === 'blank') return Promise.resolve();
  const id = doc.materialId; if (opts.page !== undefined) priority.set(id, opts.page);
  const live = running.get(id); if (live) return live;
  const run = (async () => {
    const progress = useDerivedProgress.getState().set;
    try {
      // a manifest handed over by `download` saves one round trip
      if (!doc.derived && opts.serverDerived) { const m = parseManifest(opts.serverDerived); if (m) { useDocsStore.getState().update(doc.id, { derived: m }); doc = { ...doc, derived: m }; } }
      const m = await ensureManifest(code, doc); if (!m) return;
      const dir = derivedDir(id, m.version); await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const all = derivedFileNames(m); progress(id, { done: 0, total: all.length, bytes: 0, state: 'checking' });
      const missing: string[] = []; let done = 0;
      for (const batch of chunk(all, 24)) { const ok = await Promise.all(batch.map((n) => exists(dir + n))); batch.forEach((n, i) => { if (ok[i]) done++; else missing.push(n); }); }
      if (!missing.length) { progress(id, { done: all.length, total: all.length, bytes: 0, state: 'done' }); return; }
      if (await onCellularOnly()) { progress(id, { done, total: all.length, bytes: 0, state: 'deferred' }); return; }
      let bytes = 0; const reading = tierWidth(m, 'reading');
      let queue = missing;
      while (queue.length) {
        queue = orderForPriority(queue, priority.get(id) ?? doc.lastPage ?? null, reading); // the reader may have moved
        const batch = queue.splice(0, URL_BATCH);
        const { urls } = await fetchImpl(code, id, batch); const byName = new Map(urls.map((u) => [u.path.slice(u.path.lastIndexOf('/') + 1), u.url]));
        let next = 0; const failures: string[] = [];
        const worker = async () => { for (;;) { const n = batch[next++]; if (!n) return; const url = byName.get(n); if (!url) { failures.push(n); continue; }
          try { bytes += await download(url, dir + n); done++; } catch { failures.push(n); }
          if (done % 4 === 0 || next >= batch.length) progress(id, { done, total: all.length, bytes, state: 'downloading' }); } };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
        if (failures.length === batch.length) throw new Error('모든 파일 다운로드 실패');
        if (failures.length) queue.push(...failures); // retried after the rest (fresh URLs)
        if (await onCellularOnly()) { progress(id, { done, total: all.length, bytes, state: 'deferred' }); return; }
      }
      progress(id, { done, total: all.length, bytes, state: 'done' });
    } catch (e: any) {
      useDerivedProgress.getState().set(id, { done: 0, total: 0, bytes: 0, state: 'error', error: String(e?.message ?? e) });
    } finally { running.delete(id); }
  })();
  running.set(id, run); return run;
}
/** Library / app start: fill in derived pages for every material document, one book at a time (most recently opened first). */
export async function ensureAllDerived(code: string | null) {
  if (Platform.OS === 'web') return;
  const docs = Object.values(useDocsStore.getState().docs).filter((d) => d.materialId && d.kind !== 'blank').sort((a, b) => ((b.lastOpenedAt ?? '') > (a.lastOpenedAt ?? '') ? 1 : -1));
  for (const d of docs) { const state = useDerivedProgress.getState().byMaterial[d.materialId!]?.state; if (state === 'done') continue; await ensureDerived(code, d); }
}
/** Deletes the derived files of a removed document (best effort). */
export async function removeDerived(materialId?: string) {
  if (!materialId || Platform.OS === 'web') return; await FileSystem.deleteAsync(docsDir() + `derived/${materialId}/`, { idempotent: true }).catch(() => {});
}
