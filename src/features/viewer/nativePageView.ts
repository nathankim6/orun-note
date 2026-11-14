/**
 * Native page surface selection (pure, testable). The native PdfPageView draws a page bitmap in memory (no JPEG, disk,
 * bridge or decode), so a page that scrolls in appears at screen resolution directly instead of blurry-then-sharp.
 */
export const NATIVE_PAGE_MIN_WIDTH = 300; // dp; thumbnails keep the disk-cached JPEG path (persists across launches)
export const NATIVE_PAGE_MAX_PX = 2400;
/** Pixel width for the native page bitmap: screen resolution, in 100 px steps so neighbours share cache entries. */
export const nativePagePixels = (displayWidth: number, pixelRatio: number) =>
  Math.max(100, Math.min(NATIVE_PAGE_MAX_PX, Math.ceil((displayWidth * Math.max(1, pixelRatio)) / 100) * 100));
export const useNativeSurface = (available: boolean, platform: string, displayWidth: number) =>
  available && platform !== 'web' && displayWidth >= NATIVE_PAGE_MIN_WIDTH;

type WarmItem = { uri: string; index: number; px: number; rank: number };
/** Collects prefetch requests made inside one window and sends one ordered list per document/width. */
export function createWarmBatcher(send: (uri: string, indices: number[], px: number) => void) {
  let batch: WarmItem[] | null = null;
  const flush = (items: WarmItem[]) => {
    const groups = new Map<string, WarmItem[]>();
    for (const it of items) { const k = it.uri + '\n' + it.px; const g = groups.get(k) ?? []; g.push(it); groups.set(k, g); }
    for (const g of groups.values()) {
      const seen = new Set<number>(); const ordered = [...g].sort((a, b) => a.rank - b.rank).filter(it => !seen.has(it.index) && seen.add(it.index));
      send(g[0].uri, ordered.map(it => it.index), g[0].px);
    }
  };
  return {
    window(run: () => void) {
      const prior = batch; batch = [];
      try { run(); } finally { const items = batch; batch = prior; if (items.length) flush(items); }
      return () => {};
    },
    add(uri: string, index: number, px: number, rank: number) {
      if (index < 0) return;
      if (batch) batch.push({ uri, index, px, rank }); else flush([{ uri, index, px, rank }]);
    },
  };
}
