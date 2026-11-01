import { Point, ShapeKind, Stroke, Tool } from '@/data/types';

export const PEN_COLORS = ['#1B1B1F', '#D64545', '#3B6FD6', '#2E9E5B', '#7C5CBF'];
export const HIGHLIGHTER_COLORS = ['#F5C542', '#FF8FA3', '#7FD3FF', '#9BE58A', '#C9A6FF'];
export const WIDTHS = [1, 2, 4, 8, 12];
export type ToolConfig = { tool: Tool; color: string; width: number; shape: ShapeKind; opacity: number };
export const toolDefaults = (tool: Tool, base: ToolConfig): Partial<ToolConfig> => {
  switch (tool) {
    case 'highlighter': return { width: Math.max(base.width, 8) * 1.6, opacity: 0.35, color: HIGHLIGHTER_COLORS.includes(base.color) ? base.color : HIGHLIGHTER_COLORS[0] };
    case 'pencil': return { opacity: 0.75 };
    case 'brush': return { opacity: 0.9 };
    case 'fountain': return { opacity: 1 };
    default: return { opacity: 1 };
  }
};

export function pathFromPoints(points: Point[], s: number, smooth = true): string {
  if (points.length === 0) return '';
  if (points.length === 1) { const p = points[0]; return `M ${p.x * s} ${p.y * s} l 0.1 0`; }
  let d = `M ${points[0].x * s} ${points[0].y * s}`;
  if (!smooth || points.length < 3) { for (let i = 1; i < points.length; i++) d += ` L ${points[i].x * s} ${points[i].y * s}`; return d; }
  for (let i = 1; i < points.length - 1; i++) { const mx = ((points[i].x + points[i + 1].x) / 2) * s; const my = ((points[i].y + points[i + 1].y) / 2) * s; d += ` Q ${points[i].x * s} ${points[i].y * s} ${mx} ${my}`; }
  const last = points[points.length - 1]; d += ` L ${last.x * s} ${last.y * s}`; return d;
}

export function shapePath(kind: ShapeKind, a: Point, b: Point, s: number): string {
  const x1 = a.x * s, y1 = a.y * s, x2 = b.x * s, y2 = b.y * s; const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2; const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
  switch (kind) {
    case 'line': return `M ${x1} ${y1} L ${x2} ${y2}`;
    case 'rectangle': return `M ${x1} ${y1} H ${x2} V ${y2} H ${x1} Z`;
    case 'ellipse': return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
    case 'triangle': return `M ${cx} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`;
    case 'diamond': return `M ${cx} ${y1} L ${x2} ${cy} L ${cx} ${y2} L ${x1} ${cy} Z`;
    case 'arrow': { const ang = Math.atan2(y2 - y1, x2 - x1); const len = 12 * Math.max(1, s * 0.8); const a1 = ang + Math.PI * 0.8, a2 = ang - Math.PI * 0.8; return `M ${x1} ${y1} L ${x2} ${y2} M ${x2} ${y2} L ${x2 + Math.cos(a1) * len} ${y2 + Math.sin(a1) * len} M ${x2} ${y2} L ${x2 + Math.cos(a2) * len} ${y2 + Math.sin(a2) * len}`; }
  }
}

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function distToSegment(p: Point, a: Point, b: Point) { const dx = b.x - a.x, dy = b.y - a.y; const l2 = dx * dx + dy * dy; if (l2 === 0) return dist(p, a); let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); }
export function strokeHitsPoint(st: Stroke, p: Point, radius: number) { const r = radius + st.width / 2; if (st.shape) { const [a, b] = [st.points[0], st.points[1] ?? st.points[0]]; const bx = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }; if (st.shape === 'line' || st.shape === 'arrow') return distToSegment(p, a, b) <= r; const inside = p.x >= bx.x - r && p.x <= bx.x + bx.w + r && p.y >= bx.y - r && p.y <= bx.y + bx.h + r; const inner = p.x > bx.x + r && p.x < bx.x + bx.w - r && p.y > bx.y + r && p.y < bx.y + bx.h - r; return inside && !inner; } if (st.points.length === 1) return dist(p, st.points[0]) <= r; for (let i = 1; i < st.points.length; i++) if (distToSegment(p, st.points[i - 1], st.points[i]) <= r) return true; return false; }
export function strokesHit(strokes: Stroke[], p: Point, radius: number, prev?: Point) { const samples: Point[] = [p]; if (prev) { const n = Math.ceil(dist(prev, p) / Math.max(2, radius)); for (let i = 1; i < n; i++) samples.push({ x: prev.x + ((p.x - prev.x) * i) / n, y: prev.y + ((p.y - prev.y) * i) / n }); } return strokes.filter((st) => samples.some((q) => strokeHitsPoint(st, q, radius))).map((st) => st.id); }
export function eraseVector(strokes: Stroke[], p: Point, radius: number, mk: () => string): Stroke[] {
  const out: Stroke[] = [];
  for (const st of strokes) {
    if (st.shape || st.tool === 'text') { if (!strokeHitsPoint(st, p, radius)) out.push(st); continue; }
    let cur: Point[] = []; let changed = false;
    const flush = () => { if (cur.length >= 2) out.push({ ...st, id: changed ? mk() : st.id, points: cur }); cur = []; };
    for (const q of st.points) { if (dist(p, q) <= radius + st.width / 2) { changed = true; flush(); } else cur.push(q); }
    if (!changed) out.push(st); else flush();
  }
  return out;
}
export function pointInPolygon(p: Point, poly: Point[]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y; const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-9) + xi; if (intersect) inside = !inside; } return inside; }
export function snapLine(points: Point[]): Point[] | null { if (points.length < 8) return null; const a = points[0], b = points[points.length - 1]; const L = dist(a, b); if (L < 40) return null; const maxDev = Math.max(...points.map((p) => Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / L)); return maxDev < Math.max(3, L * 0.03) ? [a, b] : null; }
export function boundsOf(points: Point[]) { const xs = points.map((p) => p.x), ys = points.map((p) => p.y); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
