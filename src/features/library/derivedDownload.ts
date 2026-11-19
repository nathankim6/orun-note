/**
 * Downloads a material's pre-rendered pages (docs/derived-pages.md) into the app's documents directory and keeps the
 * document's `derived` record up to date. Resumable: every file is checked on disk, so a restart continues where it
 * stopped. The queue is live: each free connection takes the file that matters most for the page being read at that
 * moment (derivedPagesCore.downloadRank), and the page the reader just turned to is fetched at once, outside the
 * pool. A run that fails (offline, server error) is retried on its own with growing pauses.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { api } from '@/lib/api';
import { useDocsStore } from '@/store/docs';
import { useSettingsStore } from '@/store/settings';
import type { Doc } from '@/data/types';
import { chunk, derivedFileNames, derivedRelDir, downloadRank, imageName, MANIFEST_NAME, orderForPriority, parseManifest, tierWidth, zoomName, zoomFilesToPrune, type DerivedInfo, type DerivedManifest } from '@/features/viewer/derivedPagesCore';
import { exists, markPresent, setDownloadActive, setDownloadNote, setZoomRequester, markZoomUnavailable, noteZoomFailure } from '@/features/viewer/derivedPages';

export type DerivedProgress = { done: number; total: number; bytes: number; state: 'checking' | 'downloading' | 'done' | 'deferred' | 'error'; error?: string };
type ProgressState = { byMaterial: Record<string, DerivedProgress>; set: (id: string, p: DerivedProgress | null) => void };
/** Live progress for the library cards (not persisted: resume state is the files themselves). */
export const useDerivedProgress = create<ProgressState>()((set) => ({ byMaterial: {}, set: (id, p) => set((s) => { const n = { ...s.byMaterial }; if (p) n[id] = p; else delete n[id]; return { byMaterial: n }; }) }));

const CONCURRENCY = 6;
/** File names per signed-URL request (server cap 300; the URLs live 900 s). */
export const SIGN_BATCH = 120;
/** A signed URL older than this is requested again instead of used (server lifetime 900 s). */
export const URL_TTL_MS = 12 * 60_000;
/** Attempts per file within one run; a run that leaves files behind fails and is retried as a whole. */
export const FILE_ATTEMPTS = 3;
/** Pauses before a failed run is tried again (offline, server error). Reset by success or by a fresh request. */
export const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];
/** Downloads outside the worker pool for the page the reader just turned to. */
const URGENT_MAX = 2;
// Last credential and local directory per material, so on-demand requests (zoom images) need no viewer plumbing.
const creds = new Map<string, string | null>(); const materialOfDir = new Map<string, string>();
const running = new Map<string, Promise<void>>();
const priority = new Map<string, number | null>();
type Fetcher = (code: string | null, materialId: string, files: string[]) => Promise<{ urls: { path: string; url: string }[] }>;
let fetchImpl: Fetcher = (c, id, files) => api.materials.derivedUrls(c, id, files);
let nowImpl: () => number = () => Date.now();
let timerImpl: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms);
let cancelImpl: (t: unknown) => void = (t) => clearTimeout(t as ReturnType<typeof setTimeout>);
let reportImpl: (line: string) => void = (line) => { try { require('@/lib/diag').reportError('render', line); } catch { /* diagnostics are optional */ } };
/** test seams */ export const _internals = { setFetcher(f: Fetcher) { fetchImpl = f; }, setNow(f: () => number) { nowImpl = f; }, setTimers(set: typeof timerImpl, cancel: typeof cancelImpl) { timerImpl = set; cancelImpl = cancel; }, setReporter(f: (line: string) => void) { reportImpl = f; } };

const docsDir = () => FileSystem.documentDirectory ?? '';
export const derivedDir = (materialId: string, version: number) => docsDir() + derivedRelDir(materialId, version);
export function infoFor(doc: Pick<Doc, 'materialId' | 'derived'> | null | undefined): DerivedInfo | null {
  if (!doc?.materialId || !doc.derived || Platform.OS === 'web') return null;
  const d = doc.derived; const dir = derivedDir(doc.materialId, d.version); materialOfDir.set(dir, doc.materialId);
  return { version: d.version, pages: d.pages, widths: d.widths, words: d.words, dir };
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

// ---------- one running download ----------
type Job = {
  id: string; code: string | null; dir: string; reading: number | null; startPage: number | null; total: number;
  missing: Set<string>; inflight: Set<string>; /** the server has no such file */ gone: Set<string>; tries: Map<string, number>;
  urls: Map<string, { url: string; at: number }>; signing: Promise<void> | null; extras: Set<Promise<void>>;
  done: number; bytes: number; fetched: number; urgent: number; stop: boolean; deferred: boolean;
};
const jobs = new Map<string, Job>();
const pageOf = (job: Job) => priority.get(job.id) ?? job.startPage;
const usable = (job: Job, n: string) => !job.inflight.has(n) && !job.gone.has(n) && (job.tries.get(n) ?? 0) < FILE_ATTEMPTS;
const fresh = (job: Job, n: string) => { const u = job.urls.get(n); return !!u && nowImpl() - u.at < URL_TTL_MS; };
/** The file that matters most right now (the reader may have moved since the last pick). */
function pick(job: Job): string | null {
  let best: string | null = null, bestRank = Infinity; const page = pageOf(job);
  for (const n of job.missing) { if (!usable(job, n)) continue; const r = downloadRank(n, page, job.reading); if (r < bestRank) { bestRank = r; best = n; } }
  return best;
}
/** A fresh signed URL for `name`; one request signs it together with the files that come next. Null: the server has no such file. */
async function urlFor(job: Job, name: string): Promise<string | null> {
  for (let round = 0; round < 3; round++) {
    if (fresh(job, name)) return job.urls.get(name)!.url;
    if (job.gone.has(name)) return null;
    if (job.signing) { await job.signing.catch(() => {}); continue; } // another connection is asking: wait, then look again
    const rest = orderForPriority([...job.missing].filter((n) => n !== name && !job.gone.has(n) && !fresh(job, n)), pageOf(job), job.reading);
    const want = [name, ...rest].slice(0, SIGN_BATCH); const at = nowImpl();
    job.signing = fetchImpl(job.code, job.id, want).then(({ urls }) => {
      const got = new Set<string>();
      for (const u of urls) { const n = u.path.slice(u.path.lastIndexOf('/') + 1); job.urls.set(n, { url: u.url, at }); got.add(n); }
      for (const n of want) if (!got.has(n)) job.gone.add(n);
    }).finally(() => { job.signing = null; });
    await job.signing;
  }
  return fresh(job, name) ? job.urls.get(name)!.url : null;
}
const noteJob = (job: Job, state: string) => setDownloadNote(job.dir, `${state} ${job.done}/${job.total}`);
/** Downloads one file. A failed transfer counts against the file; a failed signing request throws (the run fails). */
async function fetchOne(job: Job, n: string): Promise<void> {
  job.inflight.add(n);
  try {
    const url = await urlFor(job, n); if (!url) { job.gone.add(n); return; }
    try { job.bytes += await download(url, job.dir + n); job.missing.delete(n); job.done++; }
    catch { job.tries.set(n, (job.tries.get(n) ?? 0) + 1); job.urls.delete(n); } // never reuse the URL of a failed transfer
  } finally {
    job.inflight.delete(n); job.fetched++;
    if (job.fetched % 4 === 0 || !job.missing.size) { useDerivedProgress.getState().set(job.id, { done: job.done, total: job.total, bytes: job.bytes, state: 'downloading' }); noteJob(job, 'downloading'); }
  }
}
async function worker(job: Job): Promise<void> {
  for (;;) {
    if (job.stop) return;
    const n = pick(job); if (!n) return;
    try { await fetchOne(job, n); } catch (e) { job.stop = true; throw e; }
    if (job.fetched % 24 === 0 && (await onCellularOnly())) { job.deferred = true; job.stop = true; return; }
  }
}
/** The reading image of the page the reader is on now must not wait for a free connection. */
function urgent(job: Job, page: number) {
  if (job.reading == null || job.stop || job.urgent >= URGENT_MAX) return;
  const n = imageName(page, job.reading); if (!job.missing.has(n) || !usable(job, n)) return;
  job.urgent++;
  const p: Promise<void> = fetchOne(job, n).catch(() => { /* the pool meets the same error and fails the run */ }).finally(() => { job.urgent--; job.extras.delete(p); });
  job.extras.add(p);
}
/** Pages around `page` download first, starting with the next file any connection takes; its own image at once. */
export function prioritise(materialId: string, page: number | null) {
  priority.set(materialId, page); const job = jobs.get(materialId); if (job && page != null) urgent(job, page);
}
const retries = new Map<string, number>(); const retryTimers = new Map<string, unknown>();
function scheduleRetry(id: string, docId: string) {
  const n = retries.get(id) ?? 0; if (n >= RETRY_DELAYS_MS.length || retryTimers.has(id)) return;
  retries.set(id, n + 1);
  retryTimers.set(id, timerImpl(() => {
    retryTimers.delete(id); const doc = useDocsStore.getState().docs[docId];
    if (doc?.materialId === id) void ensureDerived(creds.get(id) ?? null, doc, { retry: true });
  }, RETRY_DELAYS_MS[n]));
}
/**
 * Makes sure the document's derived pages are on disk, downloading what is missing. Resolves when complete, deferred
 * (wifi-only on cellular) or failed; never throws. Concurrent calls for the same material share one run. A failed run
 * schedules its own retry (RETRY_DELAYS_MS) unless the server refused for good (403 / 404).
 */
export function ensureDerived(code: string | null, doc: Doc, opts: { page?: number | null; serverDerived?: unknown; /** internal: scheduled retry */ retry?: boolean } = {}): Promise<void> {
  if (Platform.OS === 'web' || !doc.materialId || doc.kind === 'blank') return Promise.resolve();
  const id = doc.materialId; if (opts.page !== undefined) priority.set(id, opts.page); creds.set(id, code);
  if (!opts.retry) { retries.delete(id); const t = retryTimers.get(id); if (t !== undefined) { cancelImpl(t); retryTimers.delete(id); } } // a fresh request restarts the schedule
  const live = running.get(id); if (live) return live;
  // A known set: its directory counts as "being filled" BEFORE the first await. A page that mounts in the same frame
  // then waits for its file; without this it saw "no download running" for a moment and started a device PDF render
  // (seconds, hundreds of MB on textbooks) that the arriving file replaced anyway.
  let activeDir: string | null = doc.derived ? derivedDir(id, doc.derived.version) : null;
  if (activeDir) { materialOfDir.set(activeDir, id); setDownloadActive(activeDir, true); setDownloadNote(activeDir, 'checking'); }
  const run = (async () => {
    const progress = useDerivedProgress.getState().set; let job: Job | null = null;
    try {
      // a manifest handed over by `download` saves one round trip
      if (!doc.derived && opts.serverDerived) { const m = parseManifest(opts.serverDerived); if (m) { useDocsStore.getState().update(doc.id, { derived: m }); doc = { ...doc, derived: m }; } }
      const m = await ensureManifest(code, doc); if (!m) return;
      const dir = derivedDir(id, m.version); await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      materialOfDir.set(dir, id);
      if (activeDir !== dir) { if (activeDir) setDownloadActive(activeDir, false); activeDir = dir; setDownloadActive(dir, true); }
      const all = derivedFileNames(m), reading = tierWidth(m, 'reading'); progress(id, { done: 0, total: all.length, bytes: 0, state: 'checking' }); setDownloadNote(dir, 'checking');
      const missing: string[] = []; let done = 0;
      for (const batch of chunk(orderForPriority(all, priority.get(id) ?? doc.lastPage ?? null, reading), 24)) { const ok = await Promise.all(batch.map((n) => exists(dir + n))); batch.forEach((n, i) => { if (ok[i]) done++; else missing.push(n); }); }
      if (!missing.length) { progress(id, { done: all.length, total: all.length, bytes: 0, state: 'done' }); setDownloadNote(dir, `done ${all.length}/${all.length}`); retries.delete(id); return; }
      if (await onCellularOnly()) { progress(id, { done, total: all.length, bytes: 0, state: 'deferred' }); setDownloadNote(dir, `deferred ${done}/${all.length}`); return; }
      job = { id, code, dir, reading, startPage: doc.lastPage ?? null, total: all.length, missing: new Set(missing), inflight: new Set(), gone: new Set(), tries: new Map(), urls: new Map(), signing: null, extras: new Set(), done, bytes: 0, fetched: 0, urgent: 0, stop: false, deferred: false };
      jobs.set(id, job); noteJob(job, 'downloading'); progress(id, { done, total: all.length, bytes: 0, state: 'downloading' });
      const results = await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, () => worker(job!)));
      await Promise.allSettled([...job.extras]);
      const crashed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined; if (crashed) throw crashed.reason;
      if (job.deferred) { progress(id, { done: job.done, total: job.total, bytes: job.bytes, state: 'deferred' }); noteJob(job, 'deferred'); return; }
      const left = [...job.missing].filter((n) => !job!.gone.has(n));
      if (left.length) throw new Error(`${left.length}개 파일을 받지 못했습니다`);
      progress(id, { done: job.done, total: job.total, bytes: job.bytes, state: 'done' }); noteJob(job, 'done'); retries.delete(id);
    } catch (e: any) {
      const status = Number(e?.status ?? 0) || 0, files = `${job?.done ?? 0}/${job?.total ?? 0}`;
      useDerivedProgress.getState().set(id, { done: job?.done ?? 0, total: job?.total ?? 0, bytes: job?.bytes ?? 0, state: 'error', error: String(e?.message ?? e) });
      if (activeDir) setDownloadNote(activeDir, `error status=${status || 'none'} ${files}`);
      // counts and states only: a refused or failing download used to be invisible (every student got 403 for days)
      reportImpl(`derived pages download failed status=${status || 'none'} files=${files} attempt=${(retries.get(id) ?? 0) + 1}`);
      if (status !== 403 && status !== 404) scheduleRetry(id, doc.id); // 403 / 404: not assigned (any more) / removed
    } finally { running.delete(id); jobs.delete(id); if (activeDir) setDownloadActive(activeDir, false); }
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
  if (!materialId || Platform.OS === 'web') return;
  const job = jobs.get(materialId); if (job) job.stop = true; retries.delete(materialId); const t = retryTimers.get(materialId); if (t !== undefined) { cancelImpl(t); retryTimers.delete(materialId); }
  await running.get(materialId)?.catch(() => {}); // files still arriving would be written back after the delete
  await FileSystem.deleteAsync(docsDir() + `derived/${materialId}/`, { idempotent: true }).catch(() => {});
}

// ---------- zoom tier: one larger image per page, fetched when the reader magnifies that page ----------
const zoomRunning = new Map<string, Promise<void>>(); const zoomSeen = new Set<string>();
async function pruneZoom(dir: string) {
  try {
    const names = (await FileSystem.readDirectoryAsync(dir)).filter((n) => n.endsWith('.jpg'));
    const stats = await Promise.all(names.map(async (name) => { const i: any = await FileSystem.getInfoAsync(dir + name); return { name, mtime: Number(i?.modificationTime ?? 0) }; }));
    for (const name of zoomFilesToPrune(stats)) await FileSystem.deleteAsync(dir + name, { idempotent: true }).catch(() => {});
  } catch { /* best effort */ }
}
/** Downloads the zoom image of one page. Never throws; a material without a zoom tier is remembered for the session. */
export function ensureZoomPage(dir: string, index: number): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const id = materialOfDir.get(dir); if (!id) return Promise.resolve();
  const name = zoomName(index), dest = dir + name; const live = zoomRunning.get(dest); if (live) return live;
  const run = (async () => {
    try {
      if (await exists(dest)) { zoomSeen.add(dir); return; }
      if (await onCellularOnly()) { noteZoomFailure(dest, 60000); return; }
      const { urls } = await fetchImpl(creds.get(id) ?? null, id, [name]); const u = urls[0];
      // No URL for the very first page asked: this material has no zoom tier (yet). Later gaps are per page.
      if (!u) { if (zoomSeen.has(dir)) noteZoomFailure(dest, 300000); else markZoomUnavailable(dir); return; }
      await download(u.url, dest); zoomSeen.add(dir); void pruneZoom(dir);
    } catch { noteZoomFailure(dest); } finally { zoomRunning.delete(dest); }
  })();
  zoomRunning.set(dest, run); return run;
}
setZoomRequester((dir, index) => { void ensureZoomPage(dir, index); });
/** test seam */ export const _zoom = { registerDir(dir: string, materialId: string, code: string | null = null) { materialOfDir.set(dir, materialId); creds.set(materialId, code); } };
