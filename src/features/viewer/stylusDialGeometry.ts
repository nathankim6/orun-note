import { DEFAULT_REPRESENTATIVE_COLORS } from '../../data/representativeColors';
/** Coordinates are local to the full-size viewer overlay, not the PDF or its zoom transform. */
export type DialPoint = { x: number; y: number };
export type DialBounds = { width: number; height: number; top?: number; bottom?: number; left?: number; right?: number };
const finite = (n: number, fallback: number) => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), n));
export const STYLUS_DIAL_ANGLE = -38;
const angle = Math.abs(STYLUS_DIAL_ANGLE) * Math.PI / 180;
const cs = Math.cos(angle), sn = Math.sin(angle);
export function dialVisualBounds(p: { left: number; top: number; width: number; height: number }) {
  const width = p.width * cs + p.height * sn, height = p.width * sn + p.height * cs;
  return { left: p.left + (p.width - width) / 2, top: p.top + (p.height - height) / 2, width, height };
}
export function placeStylusDial(anchor: DialPoint, bounds: DialBounds) {
  const margin = 8;
  const left = Math.max(0, finite(bounds.left ?? 0, 0)) + margin;
  const top = Math.max(0, finite(bounds.top ?? 0, 0)) + margin;
  const right = Math.max(left, finite(bounds.width, 320) - Math.max(0, bounds.right ?? 0) - margin);
  const bottom = Math.max(top, finite(bounds.height, 640) - Math.max(0, bounds.bottom ?? 0) - margin);
  const ratio = 176 / 296;
  // Fit the ROTATED silhouette, not just its pre-transform frame.
  const width = Math.min(296, (right - left) / (cs + ratio * sn), (bottom - top) / (sn + ratio * cs));
  const height = width * ratio;
  const visualWidth = width * cs + height * sn, visualHeight = width * sn + height * cs;
  const ax = finite(anchor.x, (left + right) / 2), ay = finite(anchor.y, (top + bottom) / 2);
  const above = ay - visualHeight - 24;
  const vy = clamp(above >= top ? above : ay + 24 + visualHeight <= bottom ? ay + 24 : ay - visualHeight / 2, top, bottom - visualHeight);
  const vx = clamp(ax - visualWidth / 2, left, right - visualWidth);
  return { left: vx + (visualWidth - width) / 2, top: vy + (visualHeight - height) / 2, width, height };
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

/** Project a screen-space pointer onto the rotated slider's local horizontal axis. */
export function rotatedSliderX(x: number, y: number, cx: number, cy: number, width: number, degrees: number) {
  const a = degrees * Math.PI / 180;
  return width / 2 + (x - cx) * Math.cos(a) + (y - cy) * Math.sin(a);
}
