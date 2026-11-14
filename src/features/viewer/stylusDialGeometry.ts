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
  const diameter = Math.min(256, right - left, bottom - top);
  const width = diameter, height = diameter;
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
export function dialColors(current: string, favorites: string[] = [], count = 6) {
  const base = ['#172033', '#DC2626', '#2F6FED', '#22C55E', '#F59E0B', '#8B5CF6'];
  const valid = (c: unknown): c is string => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c);
  const seen = new Set<string>();
  const all = [...favorites, ...base].filter(valid).filter(c => { const k = c.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  // Keep familiar swatches in place when selected. Only an uncommon current ink gets a leading slot.
  if (valid(current) && !seen.has(current.toLowerCase())) all.unshift(current);
  const result = all.slice(0, Math.max(1, count));
  if (valid(current) && !result.some(c => c.toLowerCase() === current.toLowerCase())) result[result.length - 1] = current;
  return result;
}
