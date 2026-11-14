import { createContext } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { pageImagePath, wordsPath, type DerivedInfo, type DerivedTier } from './derivedPagesCore';
export type { DerivedInfo, DerivedTier } from './derivedPagesCore';
export { pageImagePath, wordsPath } from './derivedPagesCore';

/** The viewer provides the open document's derived set; PdfPage / words consult it before any native render. */
export const DerivedPagesContext = createContext<DerivedInfo | null>(null);

// Known-present files (absolute file:// URIs). Filled by the download manager and by existence checks; a miss is
// re-checked on disk because the download may have completed since.
const present = new Set<string>();
const checking = new Map<string, Promise<boolean>>();
export function markPresent(path: string) { present.add(path); }
export function isPresentSync(path: string | null) { return !!path && present.has(path); }
export async function exists(path: string | null): Promise<boolean> {
  if (!path || Platform.OS === 'web') return false;
  if (present.has(path)) return true;
  let p = checking.get(path);
  if (!p) {
    p = FileSystem.getInfoAsync(path).then((i) => { const ok = !!i.exists && (i as any).size > 0; if (ok) present.add(path); return ok; }).catch(() => false).finally(() => checking.delete(path));
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
