/**
 * Pure helpers for pre-rendered page images ("derived pages", docs/derived-pages.md). No React Native imports, so the
 * naming / ordering / selection rules are unit-tested with plain node.
 */
export type DerivedInfo = { version: number; pages: number; widths: number[]; words: boolean; dir: string };
export type DerivedTier = 'reading' | 'detail';
/** Server manifest (without `sizes`), as stored on `materials.derived` and `Doc.derived`. */
export type DerivedManifest = { version: number; pages: number; widths: number[]; words: boolean; bytes?: number; generatedAt?: string; engine?: string };
export const DERIVED_VERSION = 1;
/** Reading tier = the smallest width, detail tier = the largest. A manifest with one width uses it for both. */
export function tierWidth(info: Pick<DerivedInfo, 'widths'>, tier: DerivedTier): number | null {
  const ws = (info.widths ?? []).filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
  if (!ws.length) return null; return tier === 'reading' ? ws[0] : ws[ws.length - 1];
}
export const imageName = (index: number, width: number) => `p${index}-${width}.jpg`;
export const wordsName = (index: number) => `p${index}-words.json`;
export const MANIFEST_NAME = 'manifest.json';
/** Storage sub-directory for one material + manifest version (relative to the app's documents directory). */
export const derivedRelDir = (materialId: string, version: number) => `derived/${materialId}/v${version}/`;
/** Every file of a complete set, in download order: page by page, reading image → detail image → words. */
export function derivedFileNames(m: Pick<DerivedManifest, 'pages' | 'widths' | 'words'>): string[] {
  const ws = [...new Set((m.widths ?? []).filter((w) => Number.isFinite(w) && w > 0))].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < m.pages; i++) { for (const w of ws) out.push(imageName(i, w)); if (m.words) out.push(wordsName(i)); }
  return out;
}
export const pageOfName = (name: string) => { const m = /^p(\d+)-/.exec(name); return m ? Number(m[1]) : -1; };
/**
 * Download order: pages the reader is looking at first (current ±near, nearest first; reading image, then detail image,
 * then words), afterwards everything else in page order with the same kind order. Stable for equal keys.
 */
export function orderForPriority(names: string[], current: number | null, readingWidth: number | null, near = 3): string[] {
  const kind = (n: string) => /-words\.json$/.test(n) ? 2 : readingWidth != null && n.endsWith(`-${readingWidth}.jpg`) ? 0 : 1;
  const rank = (n: string) => { const p = pageOfName(n); if (current == null) return p * 3 + kind(n); const d = Math.abs(p - current); return d <= near ? d * 3 + kind(n) : 1e6 + p * 3 + kind(n); };
  return names.map((n, i) => ({ n, i, r: rank(n) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.n);
}
export function chunk<T>(list: T[], size: number): T[][] { const out: T[][] = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; }
/** Signed-URL batches must stay under the edge function limit and expire in 900 s, so request them per chunk right before use. */
export const URL_BATCH = 250;
/** Which stored file answers a tier request (null = not derived / tier absent). Existence is the caller's business. */
export function pageImagePath(info: DerivedInfo | null | undefined, index: number, tier: DerivedTier): string | null {
  if (!info || !info.dir || index < 0 || index >= info.pages) return null;
  const w = tierWidth(info, tier); return w ? info.dir + imageName(index, w) : null;
}
export function wordsPath(info: DerivedInfo | null | undefined, index: number): string | null {
  if (!info || !info.dir || !info.words || index < 0 || index >= info.pages) return null; return info.dir + wordsName(index);
}
/** Normalises a server manifest (API / download response) into the client shape; null when unusable. */
export function parseManifest(raw: unknown): DerivedManifest | null {
  const m: any = raw; if (!m || typeof m !== 'object') return null;
  const pages = Number(m.pages), version = Number(m.version ?? 1);
  const widths = Array.isArray(m.widths) ? m.widths.map(Number).filter((w: number) => Number.isFinite(w) && w > 0) : [];
  if (!(pages > 0) || !(version > 0) || !widths.length) return null;
  return { version, pages, widths, words: !!m.words, bytes: Number(m.bytes ?? 0) || undefined, generatedAt: typeof m.generatedAt === 'string' ? m.generatedAt : undefined, engine: typeof m.engine === 'string' ? m.engine : undefined };
}
