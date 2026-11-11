import { boundedPageTile } from './pdfTileGeometry';
import type { PageTile } from './PdfPage';
// Native renderRegion limits (PdfDetailService.kt PdfDetailProtocol + tile checks).
export const ZP_MAX_PAGE_WIDTH = 16384, ZP_MAX_TILE_AXIS = 4096, ZP_MAX_TILE_PIXELS = 12_000_000;
type Region = { x: number; y: number; w: number };
/**
 * Native tile for the part of the page visible in the pad. Same normalized sampling as DocumentView:
 * pxW = full page width in device px, x/y/w/h = crop in that space, nx/ny/nw/nh = crop / full page size.
 * When native limits would be exceeded the whole tile (pxW and crop) is scaled by one factor, so the
 * normalized region stays the same and the tile is only slightly less sharp.
 */
export function zoomPadTile(o: { pageW: number; pageH: number; k: number; padW: number; padH: number; region: Region; dpr: number }): PageTile | undefined {
  const { pageW, pageH, k, padW, padH, region, dpr } = o;
  if (![pageW, pageH, k, padW, padH, dpr, region.x, region.y, region.w].every(Number.isFinite)) return undefined;
  if (!(pageW > 0 && pageH > 0 && k > 0 && padW > 0 && padH > 0 && dpr > 0)) return undefined;
  return boundedPageTile(pageW * k, pageH * k, region.x * k, region.y * k, region.x * k + padW, region.y * k + padH, dpr);
}
/** Key whose change restarts the 800 ms idle gate (document, page, frame position/size, pad layout). */
export function zoomPadQualityKey(o: { uri: string | null; sourceIndex: number; region: Region; padW: number; height: number; pageW: number; pageH: number }) {
  const r = o.region; return [o.uri, o.sourceIndex, r.x, r.y, r.w, o.padW, o.height, o.pageW, o.pageH].join('|');
}
