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
  const sw = pageW * k, sh = pageH * k;
  const ix0 = Math.max(0, region.x * k), iy0 = Math.max(0, region.y * k);
  const ix1 = Math.min(sw, region.x * k + padW), iy1 = Math.min(sh, region.y * k + padH);
  if (ix1 - ix0 < 8 || iy1 - iy0 < 8) return undefined;
  const idealW = sw * dpr, idealH = sh * dpr;
  const cw = (ix1 - ix0) * dpr, ch = (iy1 - iy0) * dpr;
  const f = Math.min(1, ZP_MAX_PAGE_WIDTH / idealW, ZP_MAX_TILE_AXIS / cw, ZP_MAX_TILE_AXIS / ch, Math.sqrt(ZP_MAX_TILE_PIXELS / (cw * ch)));
  const pxW = Math.max(1, Math.floor(idealW * f)), pxH = Math.max(1, Math.round(pxW * pageH / pageW));
  const x = Math.min(pxW - 1, Math.max(0, Math.floor(ix0 * dpr * f))), y = Math.min(pxH - 1, Math.max(0, Math.floor(iy0 * dpr * f)));
  let w = Math.min(pxW - x, Math.ceil(cw * f), ZP_MAX_TILE_AXIS), h = Math.min(pxH - y, Math.ceil(ch * f), ZP_MAX_TILE_AXIS);
  while (w * h > ZP_MAX_TILE_PIXELS) { w = Math.max(1, w - 1); h = Math.max(1, h - 1); }
  return { pxW, x, y, w, h, nx: x / pxW, ny: y / pxH, nw: w / pxW, nh: h / pxH };
}
/** Key whose change restarts the 800 ms idle gate (document, page, frame position/size, pad layout). */
export function zoomPadQualityKey(o: { uri: string | null; sourceIndex: number; region: Region; padW: number; height: number; pageW: number; pageH: number }) {
  const r = o.region; return [o.uri, o.sourceIndex, r.x, r.y, r.w, o.padW, o.height, o.pageW, o.pageH].join('|');
}
