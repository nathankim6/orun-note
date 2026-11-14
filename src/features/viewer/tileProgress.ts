import type { PageTile } from './pdfTileGeometry';
/**
 * Documents whose zoom tiles render slowly (heavy vector textbooks: gradients, patterns, transparency) get a quarter-size
 * tile first, so the view sharpens in a fraction of the time, then the full tile replaces it. Decided per file from the
 * first measured tile, never guessed from the platform.
 */
export const SLOW_TILE_MS = 450;
const slowTileDocs = new Set<string>();
export const tileIsSlow = (uri: string) => slowTileDocs.has(uri);
export function noteTileTiming(uri: string, ms: number) { if (ms >= SLOW_TILE_MS) slowTileDocs.add(uri); }
/** The same window at half the page resolution (a quarter of the pixels); layout stays that of the full tile. */
export function halfTile(t: PageTile): PageTile {
  const pxW = Math.max(1, Math.floor(t.pxW / 2));
  return { ...t, pxW, x: Math.floor(t.x / 2), y: Math.floor(t.y / 2), w: Math.max(1, Math.ceil(t.w / 2)), h: Math.max(1, Math.ceil(t.h / 2)) };
}
/**
 * iOS decodes an <Image> to its laid-out size × screen scale. A tile laid out in page space (before the outer zoom
 * transform) would be decoded zoom× too small and look soft. Laying it out at its own pixel size and scaling it down
 * into page space keeps every tile pixel on both platforms.
 */
export function tileImageStyle(t: PageTile, px: { w: number; h: number }, width: number, height: number, dpr: number) {
  const left = t.nx * width, top = t.ny * height, lw = t.nw * width, lh = t.nh * height;
  const pw = px.w / dpr, ph = px.h / dpr; // on-screen points at zoom 1 of the tile's own pixels
  if (!(pw > lw) || !(ph > 0)) return { left, top, width: lw, height: lh } as const;
  return { left, top, width: pw, height: ph, transform: [{ scale: lw / pw }], transformOrigin: 'top left' } as const;
}
