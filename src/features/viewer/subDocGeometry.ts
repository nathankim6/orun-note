/** Pure geometry for the floating 서브교재 window: resizing from any edge or corner (worklet-safe, no imports). */
export type Rect = { x: number; y: number; w: number; h: number };
export type Edges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
export type Limits = { minW: number; minH: number; maxW: number; maxH: number; /** top of the usable area (safe-area inset) */ minY?: number };
/**
 * Resize `rect` by dragging the given edge(s) by (dx, dy). The opposite edge stays anchored: dragging the left or top
 * edge moves x / y and changes the size by the same amount. Sizes are clamped to [min, max]; when a left / top drag
 * would cross the min size or the screen edge the window stops there instead of jumping.
 */
export function resizeRect(rect: Rect, edges: Edges, dx: number, dy: number, L: Limits): Rect {
  'worklet';
  const minY = L.minY ?? 0;
  let { x, y, w, h } = rect;
  if (edges.right) w = Math.max(L.minW, Math.min(rect.w + dx, L.maxW - rect.x));
  else if (edges.left) { const right = rect.x + rect.w; const nx = Math.max(0, Math.min(rect.x + dx, right - L.minW)); x = nx; w = right - nx; }
  if (edges.bottom) h = Math.max(L.minH, Math.min(rect.h + dy, L.maxH - rect.y));
  else if (edges.top) { const bottom = rect.y + rect.h; const ny = Math.max(minY, Math.min(rect.y + dy, bottom - L.minH)); y = ny; h = bottom - ny; }
  return { x, y, w, h };
}
