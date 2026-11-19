import { createContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { pageImagePath, wordsPath, zoomImagePath, type DerivedInfo, type DerivedTier } from './derivedPagesCore';
export type { DerivedInfo, DerivedTier } from './derivedPagesCore';
export { pageImagePath, wordsPath, zoomImagePath } from './derivedPagesCore';

/** The viewer provides the open document's derived set; PdfPage / words consult it before any native render. */
export const DerivedPagesContext = createContext<DerivedInfo | null>(null);

// Known-present files (absolute file:// URIs). Filled by the download manager and by existence checks; a miss is
// re-checked on disk because the download may have completed since.
const present = new Set<string>();
const checking = new Map<string, Promise<boolean>>();
const fileListeners = new Map<string, Set<() => void>>();
const notifyFile = (path: string) => { const set = fileListeners.get(path); if (set) for (const fn of [...set]) fn(); };
/** Runs `fn` when `path` becomes known-present (download finished or found on disk). Returns the unsubscribe. */
export function onPresent(path: string, fn: () => void): () => void {
  let set = fileListeners.get(path); if (!set) { set = new Set(); fileListeners.set(path, set); } set.add(fn);
  return () => { set!.delete(fn); if (!set!.size) fileListeners.delete(path); };
}
export function markPresent(path: string) { const fresh = !present.has(path); present.add(path); if (fresh) notifyFile(path); }
export function isPresentSync(path: string | null) { return !!path && present.has(path); }
export async function exists(path: string | null): Promise<boolean> {
  if (!path || Platform.OS === 'web') return false;
  if (present.has(path)) return true;
  let p = checking.get(path);
  if (!p) {
    p = FileSystem.getInfoAsync(path).then((i) => { const ok = !!i.exists && (i as any).size > 0; if (ok) markPresent(path); return ok; }).catch(() => false).finally(() => checking.delete(path));
    checking.set(path, p);
  }
  return p;
}
/** file:// URI of the pre-rendered page image for a tier, or null when it is not on disk (yet). */
export async function pageImage(info: DerivedInfo | null | undefined, index: number, tier: DerivedTier): Promise<string | null> {
  const p = pageImagePath(info, index, tier); return (await exists(p)) ? p : null;
}
export async function pageWords(info: DerivedInfo | null | undefined, index: number): Promise<unknown[] | null> {
  const p = wordsPath(info, index); if (!(await exists(p))) return null;
  try { const j = JSON.parse(await FileSystem.readAsStringAsync(p!)); return Array.isArray(j) ? j : null; } catch { return null; }
}

// Document URI → derived set, so modules without React context (prefetch, words cache) can look it up.
const byUri = new Map<string, DerivedInfo>();
export function registerUri(uri: string | null, info: DerivedInfo | null) { if (!uri) return; if (info) byUri.set(uri, info); else byUri.delete(uri); }
export const forUri = (uri: string | null) => (uri ? byUri.get(uri) ?? null : null);

// ---------- reactive file state for page components ----------
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
// Directories the download manager is filling right now. A page whose file is missing there waits for it for a
// moment instead of starting a device PDF render that the arriving file would replace.
const activeDirs = new Map<string, number>(); const dirListeners = new Set<() => void>();
export function setDownloadActive(dir: string, on: boolean) {
  const n = (activeDirs.get(dir) ?? 0) + (on ? 1 : -1); if (n > 0) activeDirs.set(dir, n); else activeDirs.delete(dir);
  for (const fn of [...dirListeners]) fn();
}
export const isDownloadActive = (dir: string) => activeDirs.has(dir);
// ---------- diagnostics: states and counts only ----------
const downloadNotes = new Map<string, string>(); // dir → last state of the download manager ("downloading 12/396", "error status=403 0/396")
export function setDownloadNote(dir: string, note: string) { downloadNotes.set(dir, note); }
let engineFallbacks = 0;
/**
 * A textbook page with a known server set is being drawn by the device PDF engine after all. Returns the report line
 * for the 1st and the 25th such page of an app session (null otherwise): this fallback was invisible while every
 * student's download was refused by the server.
 */
export function noteEngineFallback(path: string): string | null {
  engineFallbacks++; if (engineFallbacks !== 1 && engineFallbacks !== 25) return null;
  const dir = dirOf(path);
  return `derived page drawn by device engine count=${engineFallbacks} reason=${isDownloadActive(dir) ? 'wait-timeout' : 'no-download-running'} download=${downloadNotes.get(dir) ?? 'never-started'}`;
}
export type DerivedFileState = 'present' | 'pending' | 'absent';
/** How long a page waits for a file the download manager is expected to deliver before using the device renderer. */
export const DERIVED_WAIT_MS = 8000;
/** Pure decision behind `useDerivedFile` (unit-tested). */
export function derivedFileState(o: { path: string | null; present: boolean; checked: boolean; downloading: boolean; timedOut: boolean; /** this mount already answered 'absent' once */ fellBack?: boolean }): DerivedFileState {
  if (!o.path) return 'absent';
  if (o.present) return 'present';
  if (!o.checked) return 'pending';                       // the disk has not answered yet (a few ms)
  // Sticky: a page that went to the device renderer stays there until its file is really on disk. A download (or a
  // retry) that starts later must not swap the drawn page for a spinner.
  if (o.fellBack) return 'absent';
  return o.downloading && !o.timedOut ? 'pending' : 'absent';
}
/**
 * State of one derived file, re-rendering the caller when it changes. After an app restart nothing is known to be on
 * disk, so the first answer is 'pending' until one stat returns: a page must never start a device PDF render (seconds
 * and hundreds of MB on textbooks) only because the in-memory index was still empty.
 */
export function useDerivedFile(path: string | null, waitMs = DERIVED_WAIT_MS): DerivedFileState {
  const [, bump] = useState(0);
  const st = useRef({ path, checked: false, timedOut: false, fellBack: false });
  if (st.current.path !== path) st.current = { path, checked: false, timedOut: false, fellBack: false };
  useEffect(() => {
    if (!path || present.has(path)) return;
    let alive = true; const cur = st.current; const again = () => { if (alive) bump((n) => n + 1); };
    const offFile = onPresent(path, again); dirListeners.add(again);
    void exists(path).then(() => { cur.checked = true; again(); });
    const timer = setTimeout(() => { cur.timedOut = true; again(); }, waitMs);
    return () => { alive = false; offFile(); dirListeners.delete(again); clearTimeout(timer); };
  }, [path, waitMs]);
  const state = derivedFileState({ path, present: !!path && present.has(path), checked: st.current.checked, downloading: !!path && isDownloadActive(dirOf(path)), timedOut: st.current.timedOut, fellBack: st.current.fellBack });
  if (state === 'absent' && path && st.current.checked) st.current.fellBack = true;
  return state;
}

// ---------- zoom tier (on demand) ----------
type ZoomRequester = (dir: string, index: number) => void;
let zoomRequester: ZoomRequester | null = null;
/** The download manager registers itself here (the viewer must not import the library layer). */
export function setZoomRequester(fn: ZoomRequester | null) { zoomRequester = fn; }
const zoomOff = new Set<string>();                 // dirs whose server set has no zoom tier (probed once per session)
const zoomRetryAt = new Map<string, number>();     // path → earliest next attempt after a failed download
export function markZoomUnavailable(dir: string) { zoomOff.add(dir); for (const fn of [...dirListeners]) fn(); }
export function noteZoomFailure(path: string, retryMs = 30000) { zoomRetryAt.set(path, Date.now() + retryMs); for (const fn of [...dirListeners]) fn(); }
export const zoomRecentlyFailed = (path: string) => (zoomRetryAt.get(path) ?? 0) > Date.now();
/** iOS only for now: Android magnifies through its own tile renderer and has stricter bitmap limits. */
export const zoomTierPlatform = () => Platform.OS === 'ios';
export const zoomAvailable = (info: DerivedInfo | null | undefined) => zoomTierPlatform() && !!info && !!info.dir && !zoomOff.has(info.dir);
let zoomHabit = false;
/** The reader magnified a textbook page in this app session. */
export const noteZoomUse = () => { zoomHabit = true; };
export const zoomHabitual = () => zoomHabit;
/** Asks for the zoom image of one page (no-op when unavailable, already present, or recently failed). */
export function requestZoomPage(info: DerivedInfo | null | undefined, index: number) {
  const path = zoomImagePath(info, index); if (!path || !zoomAvailable(info) || present.has(path)) return;
  if (zoomRecentlyFailed(path)) return;
  zoomRequester?.(info!.dir, index);
}
