import { PdfRenderer, PdfWord } from '../../../modules/pdf-renderer';
// Per-page word boxes (normalized 0..1). Loaded lazily and cached for the session.
const cache = new Map<string, PdfWord[]>(); const pending = new Map<string, Promise<PdfWord[]>>();
const key = (uri: string, i: number) => `${uri}|${i}`;
export function cachedWords(uri: string | null, index: number) { return uri ? cache.get(key(uri, index)) ?? null : null; }
export function loadWords(uri: string | null, index: number): Promise<PdfWord[]> {
  if (!uri || uri === 'blank:') return Promise.resolve([]); const k = key(uri, index);
  if (cache.has(k)) return Promise.resolve(cache.get(k)!); if (pending.has(k)) return pending.get(k)!;
  const p = PdfRenderer.getWords(uri, index).then((w) => { cache.set(k, w); pending.delete(k); return w; }).catch(() => { pending.delete(k); return []; });
  pending.set(k, p); return p;
}
/** Word under a point (page coords → normalized by page size). Slight padding so small words are easy to hit. */
export function wordAt(words: PdfWord[] | null, nx: number, ny: number): PdfWord | null {
  if (!words?.length) return null; let best: PdfWord | null = null; let bestD = Infinity;
  for (const w of words) { const padX = Math.max(0.004, w.h * 0.15), padY = w.h * 0.25; if (nx >= w.x - padX && nx <= w.x + w.w + padX && ny >= w.y - padY && ny <= w.y + w.h + padY) { const cx = w.x + w.w / 2, cy = w.y + w.h / 2; const d = Math.hypot(nx - cx, ny - cy); if (d < bestD) { bestD = d; best = w; } } }
  return best;
}
/** Words between two points in reading order (for drag "block" selection). */
export function wordsBetween(words: PdfWord[] | null, a: { x: number; y: number }, b: { x: number; y: number }): PdfWord[] {
  if (!words?.length) return []; const wa = wordAt(words, a.x, a.y) ?? nearest(words, a); const wb = wordAt(words, b.x, b.y) ?? nearest(words, b); if (!wa || !wb) return [];
  let i = words.indexOf(wa), j = words.indexOf(wb); if (i > j) [i, j] = [j, i]; return words.slice(i, j + 1);
}
function nearest(words: PdfWord[], p: { x: number; y: number }) { let best: PdfWord | null = null, bd = Infinity; for (const w of words) { const dx = Math.max(w.x - p.x, 0, p.x - (w.x + w.w)), dy = Math.max(w.y - p.y, 0, p.y - (w.y + w.h)); const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = w; } } return bd < 0.03 ? best : null; }
/** PDF text layers often use ligatures (ﬁ ﬂ ﬀ) and soft hyphens: fold them so "signiﬁcant" looks up "significant". */
export const foldText = (t: string) => String(t ?? '').normalize('NFKC').replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '');
export const cleanWord = (t: string) => foldText(t).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
