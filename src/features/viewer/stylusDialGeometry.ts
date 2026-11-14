import { DEFAULT_REPRESENTATIVE_COLORS } from '../../data/representativeColors';
/** Coordinates are local to the full-size viewer overlay, not the PDF or its zoom transform. */
export type DialPoint = { x: number; y: number };
export type DialBounds = { width: number; height: number; top?: number; bottom?: number; left?: number; right?: number };
const finite = (n: number, fallback: number) => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), n));
export function placeStylusDial(anchor: DialPoint, bounds: DialBounds) {
  const margin = 8;
  const left = Math.max(0, finite(bounds.left ?? 0, 0)) + margin;
  const top = Math.max(0, finite(bounds.top ?? 0, 0)) + margin;
  const right = Math.max(left, finite(bounds.width, 320) - Math.max(0, bounds.right ?? 0) - margin);
  const bottom = Math.max(top, finite(bounds.height, 640) - Math.max(0, bounds.bottom ?? 0) - margin);
  const width = Math.min(296, right - left);
  // A half-disk dome plus a shallow flat-base control strip. Keep narrow-phone controls usable.
  const height = Math.min(200, Math.max(174, width * 176 / 296 + 24), bottom - top);
  const ax = finite(anchor.x, (left + right) / 2), ay = finite(anchor.y, (top + bottom) / 2);
  const above = ay - height - 24;
  const y = above >= top ? above : ay + 24 + height <= bottom ? ay + 24 : clamp(ay - height / 2, top, bottom - height);
  return { left: clamp(ax - width / 2, left, right - width), top: clamp(y, top, bottom - height), width, height };
}
export function dialWidthRange(tool: string) {
  if (tool === 'highlighter') return { min: 6, max: 40, step: 0.5 };
  if (tool === 'eraser' || tool === 'vectorEraser') return { min: 2, max: 40, step: 0.5 };
  return { min: 0.5, max: 12, step: 0.1 };
}
/** Show representative colors exactly as configured, including their original order and duplicates. */
export function dialColors(_current: string, favorites?: string[], _count?: number) {
  // Matches defaultViewerPrefs.favoriteColors; explicit [] intentionally stays empty.
  return [...(favorites ?? DEFAULT_REPRESENTATIVE_COLORS)];
}
