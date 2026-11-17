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

// ---------- zoom tier (docs/derived-pages.md, "Zoom tier") ----------
/**
 * A third, larger server image per page, fetched on demand for the page the reader magnifies. It is NOT part of
 * `manifest.widths` (older clients download every listed width for every page and treat the largest as their detail
 * image), so it is addressed by convention and probed through `materials.derivedUrls`.
 */
export const ZOOM_WIDTH = 3600;
export const zoomName = (index: number) => imageName(index, ZOOM_WIDTH);
export function zoomImagePath(info: DerivedInfo | null | undefined, index: number): string | null {
  if (!info || !info.dir || index < 0 || index >= info.pages) return null; return info.dir + zoomName(index);
}
/** Marker the generator appends to `manifest.engine` once the zoom tier of a material is uploaded. */
export const zoomMarked = (engine: string | null | undefined) => new RegExp('\\bz' + ZOOM_WIDTH + '\\b').test(String(engine ?? ''));
/**
 * `neededPx` = width of the whole page in device pixels at the current magnification. A raster that is at least ~90 %
 * of that is indistinguishable from a sharper one, so the next tier is only wanted beyond that margin.
 */
export const SHARP_MARGIN = 1.12;
export const tierIsEnough = (rasterPx: number, neededPx: number) => rasterPx > 0 && neededPx <= rasterPx * SHARP_MARGIN;
/** The on-demand zoom image is wanted once the detail raster stops covering the magnified page. */
export const zoomTierWanted = (neededPx: number, detailPx: number) => neededPx > 0 && !tierIsEnough(detailPx, neededPx);
/**
 * A vector tile from the device PDF engine is the last resort: on Chrome-printed textbooks one page costs the engine
 * seconds and hundreds of MB (docs/ios-zoom-sharpness.md), so it is only asked for when the best server raster is
 * clearly exceeded.
 */
export const VECTOR_TILE_MARGIN = 1.3;
export const vectorTileWanted = (neededPx: number, bestRasterPx: number) => neededPx > bestRasterPx * VECTOR_TILE_MARGIN;
/**
 * Lays an image out at its own pixel size (÷ dpr) and scales it down into the page box, so the platform image
 * pipeline (which decodes to the laid-out size) keeps every source pixel when the page is magnified by an ancestor
 * transform. Images with fewer pixels than the box are laid out at the box size as usual.
 */
export function fullResImageStyle(pxW: number, boxW: number, boxH: number, dpr: number) {
  const natural = pxW / Math.max(1, dpr);
  if (!(natural > boxW) || !(boxW > 0) || !(boxH > 0)) return { position: 'absolute', left: 0, top: 0, width: boxW, height: boxH } as const;
  return { position: 'absolute', left: 0, top: 0, width: natural, height: (natural * boxH) / boxW, transform: [{ scale: boxW / natural }], transformOrigin: 'top left' } as const;
}
/** Zoom files kept on disk per material; the oldest are removed beyond `ZOOM_KEEP_MAX` down to `ZOOM_KEEP`. */
export const ZOOM_KEEP = 40, ZOOM_KEEP_MAX = 56;
export function zoomFilesToPrune(files: { name: string; mtime: number }[]): string[] {
  const zoom = files.filter((x) => x.name.endsWith(`-${ZOOM_WIDTH}.jpg`)); if (zoom.length <= ZOOM_KEEP_MAX) return [];
  return zoom.sort((a, b) => a.mtime - b.mtime).slice(0, zoom.length - ZOOM_KEEP).map((x) => x.name);
}
