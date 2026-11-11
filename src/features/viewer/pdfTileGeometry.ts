/** Shared Android/iOS region contract. Limits mirror Android's detail-service admission checks. */
export const PDF_MAX_PAGE_WIDTH = 16384, PDF_MAX_TILE_AXIS = 4096, PDF_MAX_TILE_PIXELS = 12_000_000;
export type PageTile = { pxW: number; x: number; y: number; w: number; h: number; nx: number; ny: number; nw: number; nh: number };
/** Crop bounds are in displayed page coordinates, before DPR. Scale the entire coordinate space,
 * never just the crop: this preserves coverage and placement at every native limit. */
export function boundedPageTile(pageW: number, pageH: number, left: number, top: number, right: number, bottom: number, dpr: number): PageTile | undefined {
  if (![pageW, pageH, left, top, right, bottom, dpr].every(Number.isFinite) || pageW <= 0 || pageH <= 0 || dpr <= 0) return;
  left = Math.max(0, left); top = Math.max(0, top); right = Math.min(pageW, right); bottom = Math.min(pageH, bottom);
  if (right <= left || bottom <= top) return;
  const cw = (right - left) * dpr, ch = (bottom - top) * dpr;
  const factor = Math.min(1, PDF_MAX_PAGE_WIDTH / (pageW * dpr), PDF_MAX_TILE_AXIS / cw, PDF_MAX_TILE_AXIS / ch, Math.sqrt(PDF_MAX_TILE_PIXELS / (cw * ch)));
  let pxW = Math.max(1, Math.floor(pageW * dpr * factor));
  for (;;) {
    // Match native fullHeight = round(native page aspect * requested width).
    const pxH = Math.max(1, Math.round(pxW * pageH / pageW));
    const x = Math.min(pxW - 1, Math.floor(left / pageW * pxW)), y = Math.min(pxH - 1, Math.floor(top / pageH * pxH));
    const w = Math.min(pxW, Math.ceil(right / pageW * pxW)) - x, h = Math.min(pxH, Math.ceil(bottom / pageH * pxH)) - y;
    if (w <= PDF_MAX_TILE_AXIS && h <= PDF_MAX_TILE_AXIS && w * h <= PDF_MAX_TILE_PIXELS) return { pxW, x, y, w, h, nx: x / pxW, ny: y / pxH, nw: w / pxW, nh: h / pxH };
    pxW = Math.max(1, Math.min(pxW - 1, Math.floor(pxW * Math.min(PDF_MAX_TILE_AXIS / w, PDF_MAX_TILE_AXIS / h, Math.sqrt(PDF_MAX_TILE_PIXELS / (w * h))))));
  }
}
export function viewportPageTile(o: { pageW: number; pageH: number; zoom: number; screenX: number; screenY: number; viewportW: number; viewportH: number; dpr: number }) {
  const { pageW, pageH, zoom, screenX, screenY, viewportW, viewportH, dpr } = o;
  if (!(zoom > 0 && viewportW > 0 && viewportH > 0)) return;
  return boundedPageTile(pageW * zoom, pageH * zoom, Math.max(0, -screenX), Math.max(0, -screenY), Math.min(pageW * zoom, viewportW - screenX), Math.min(pageH * zoom, viewportH - screenY), dpr);
}
export const pageTileKey = (tile?: PageTile) => tile ? [tile.pxW, tile.x, tile.y, tile.w, tile.h].join('|') : '';
