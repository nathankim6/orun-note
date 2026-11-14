import { getStroke } from 'perfect-freehand';
import { Point, ShapeKind, Stroke, Tool } from '@/data/types';

export const PEN_COLORS = ['#1B1B1F', '#D64545', '#3B6FD6', '#2E9E5B', '#7C5CBF'];
export const HIGHLIGHTER_COLORS = ['#F5C542', '#FF8FA3', '#7FD3FF', '#9BE58A', '#C9A6FF'];
export const WIDTHS = [1, 2, 4, 8, 12];
export type ToolConfig = { tool: Tool; color: string; width: number; shape: ShapeKind; opacity: number };
export const toolDefaults = (tool: Tool, base: ToolConfig): Partial<ToolConfig> => {
  switch (tool) {
    case 'pen': return { width: 1, opacity: 1 };
    case 'eraser': return { width: 3, opacity: 1 };
    case 'vectorEraser': return { width: 3, opacity: 1 };
    case 'highlighter': return { width: 6, opacity: 0.35, color: HIGHLIGHTER_COLORS.includes(base.color) ? base.color : HIGHLIGHTER_COLORS[0] };
    case 'pencil': return { width: 1.2, opacity: 0.8, color: '#1C1C1E' };
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
export function eraseVector(strokes: Stroke[], p: Point, radius: number, mk: () => string, only?: (st: Stroke) => boolean): Stroke[] {
  const out: Stroke[] = [];
  for (const st of strokes) {
    if (only && !only(st)) { out.push(st); continue; }
    if (st.shape || st.poly || st.tool === 'text') { if (!strokeHitsPoint(st, p, radius)) out.push(st); continue; }
    let cur: Point[] = []; let changed = false;
    const flush = () => { if (cur.length >= 2) out.push({ ...st, id: changed ? mk() : st.id, points: cur }); cur = []; };
    for (const q of st.points) { if (dist(p, q) <= radius + st.width / 2) { changed = true; flush(); } else cur.push(q); }
    if (!changed) out.push(st); else flush();
  }
  return out;
}
export function pointInPolygon(p: Point, poly: Point[]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y; const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-9) + xi; if (intersect) inside = !inside; } return inside; }
export function snapLine(points: Point[]): Point[] | null { if (points.length < 8) return null; const a = points[0], b = points[points.length - 1]; const L = dist(a, b); if (L < 40) return null; const maxDev = Math.max(...points.map((p) => Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / L)); return maxDev < Math.max(2, L * 0.012) ? [a, b] : null; }
export function boundsOf(points: Point[]) { const xs = points.map((p) => p.x), ys = points.map((p) => p.y); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }

/**
 * Fixed-width pen outline. Pressure and speed never change the width,
 * including legacy strokes that were saved with variable-width metadata.
 * Returned path is in PDF page units; render with `scale={s}`. Cached per points array (immutable per stroke).
 *
 * perfect-freehand is tuned for screen pixels: it pads a lone point with a neighbour 1 unit away and keeps a few other
 * absolute 1-unit thresholds. Our points are PDF page units where a pen is ~1 unit wide, so the first one or two points
 * of every stroke rendered as a dot about twice the chosen width that snapped back once the stroke grew ("a blob for an
 * instant when the nib lands"). Running the generator in a magnified space (≥16 units per pen width) and scaling the
 * outline back makes those constants negligible: the landing dot is the chosen width from the very first frame.
 */
const outlineCache = new WeakMap<Point[], string>();
export const INK_SPACE = (size: number) => Math.max(8, 16 / Math.max(0.05, size));
function strokeOutline(input: number[][], opts: Parameters<typeof getStroke>[1] & { size: number }): number[][] {
  const k = INK_SPACE(opts.size);
  const scaled = input.map((q) => [q[0] * k, q[1] * k, q[2]]);
  const o: any = { ...opts, size: opts.size * k };
  if (o.start && typeof o.start.taper === 'number') o.start = { ...o.start, taper: o.start.taper * k };
  if (o.end && typeof o.end.taper === 'number') o.end = { ...o.end, taper: o.end.taper * k };
  return getStroke(scaled, o).map((q) => [q[0] / k, q[1] / k]);
}
function outlineToPath(out: number[][]): string {
  if (out.length < 3) return '';
  let d = `M ${out[0][0].toFixed(2)} ${out[0][1].toFixed(2)} Q`;
  for (let i = 0; i < out.length; i++) { const [x0, y0] = out[i]; const [x1, y1] = out[(i + 1) % out.length]; d += ` ${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)}`; }
  return d + ' Z';
}
const dotPath = (q: Point, r: number) => `M ${q.x - r} ${q.y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
export function penOutline(points: Point[], width: number, live = false, tool: Tool | string = 'pen'): string {
  if (tool === 'pencil') return pencilLayers(points, width, live).wash;
  if (!live) { const hit = outlineCache.get(points); if (hit) return hit; }
  const size = width * 1.05;
  const out = strokeOutline(points.map((q) => [q.x, q.y, 0.5]), { size, thinning: 0, smoothing: 0.62, streamline: 0.4, simulatePressure: false, last: !live, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } });
  const d = out.length > 2 ? outlineToPath(out) : points.length ? dotPath(points[0], size / 2) : '';
  if (!live) outlineCache.set(points, d);
  return d;
}

/*
 * 연필 (pencil). GoodNotes stores a pencil stroke as centre points with force / altitude / azimuth and a random seed per
 * segment, and draws it as a textured brush raster: a grainy band of graphite specks whose visible width is roughly
 * 0.4–0.9 of the nominal width depending on force, with ragged, speckled edges that extend a little past the centre line.
 * We reproduce that look as a deterministic stamp brush: along the stroke, at a fixed spacing, a few graphite specks are
 * stamped at pseudo-random offsets inside the local radius (denser near the centre), plus a faint continuous core so thin
 * strokes do not break up. Pressure → wider and darker; a flat (tilted) stylus → wider and lighter (shading); ends taper.
 * Everything is derived from the stored points through `grain()`, so a stroke always renders the same.
 */
export type PencilLayers = { core: string; dark: string; light: string; /** short graphite streaks along the stroke direction (stroke this path, width = streakW) */ streaks: string; streakW: number; wash: string };
const pencilCache = new WeakMap<Point[], Map<number, PencilLayers>>();
/** stylus pressure response: raw S Pen / Apple Pencil values are low when writing normally */
export const pencilPressure = (p?: number) => (typeof p === 'number' && p > 0 ? Math.min(1, Math.pow(Math.min(1, p), 0.55)) : 0.55);
/** 0 upright … 1 laid flat for shading (tilt below ~45° from vertical does nothing) */
export const pencilShade = (t?: number) => (typeof t === 'number' && t > 0 ? Math.min(1, Math.max(0, (t - 0.8) / 0.55)) : 0);
/** visible band width relative to the chosen width (GoodNotes: ~0.4 W light … ~0.9 W firm) */
export const pencilWidthFactor = (q: Point) => (0.45 + 0.5 * pencilPressure(q.p)) * (1 + 2 * pencilShade(q.t));
/** graphite darkness 0..1 */
export const pencilDarkness = (q: Point) => (0.35 + 0.65 * pencilPressure(q.p)) * (1 - 0.5 * pencilShade(q.t));
const circ = (x: number, y: number, r: number) => `M${(x - r).toFixed(2)} ${y.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0Z`;
/** a speck is a tiny square (0.1–0.3 page units): indistinguishable from a dot at any zoom, a third of the path text */
const speck = (x: number, y: number, r: number) => { const d = (2 * r).toFixed(1); return `M${(x - r).toFixed(1)} ${(y - r).toFixed(1)}h${d}v${d}h-${d}z`; };
/** Specks are capped per stroke so a page of pencil notes stays cheap to draw; long strokes just get slightly sparser. */
const PENCIL_MAX_SPECKS = 12000;
export function pencilLayers(points: Point[], width: number, live = false): PencilLayers {
  if (!live) { const hit = pencilCache.get(points)?.get(width); if (hit) return hit; }
  const W = Math.max(0.2, width); const res: PencilLayers = { core: '', dark: '', light: '', streaks: '', streakW: W * 0.09, wash: '' };
  if (!points.length) return res;
  // resample the centre line at a fixed spacing (page units)
  const step = Math.max(0.16, W * 0.2);
  type S = { x: number; y: number; p?: number; t?: number; d: number };
  const samples: S[] = []; let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  if (points.length === 1 || total < 1e-6) { const q = points[0]; samples.push({ x: q.x, y: q.y, p: q.p, t: q.t, d: 0 }); }
  else {
    let carry = 0, d = 0;
    samples.push({ x: points[0].x, y: points[0].y, p: points[0].p, t: points[0].t, d: 0 });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]; const L = dist(a, b); if (L < 1e-6) continue;
      let s0 = step - carry;
      while (s0 <= L) { const u = s0 / L; samples.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, p: (a.p ?? b.p) != null ? (a.p ?? b.p!) * (1 - u) + (b.p ?? a.p!) * u : undefined, t: b.t ?? a.t, d: d + s0 }); s0 += step; }
      carry = L - (s0 - step); d += L;
    }
  }
  const n = samples.length; const budget = Math.max(1, Math.min(18, Math.floor(PENCIL_MAX_SPECKS / n)));
  let dark = '', light = '', streaks = '', coreW: number[] = [];
  // ends taper over ~1.2 W (lead lands and lifts), like a real pencil
  const taperLen = Math.max(step * 2, W * 1.2);
  for (let i = 0; i < n; i++) {
    const q = samples[i]; const seed = (Math.round(q.x * 37) + Math.round(q.y * 91) * 1013 + i * 7) | 0;
    const taper = Math.min(1, 0.35 + 0.65 * Math.min(q.d, total - q.d) / taperLen);
    const wf = pencilWidthFactor(q), w = W * wf * taper, R = w / 2, dk = pencilDarkness(q);
    coreW.push(Math.max(0.15, w * 0.42));
    // more graphite per step when the band is wider (shading with a flat lead covers more paper)
    const count = Math.min(budget, Math.max(1, Math.round((7 + 8 * dk) * Math.max(1, wf / 0.9))));
    // local direction (graphite streaks follow the movement of the lead, like fibres)
    const nb = samples[Math.min(n - 1, i + 1)], pa = samples[Math.max(0, i - 1)]; let dx = nb.x - pa.x, dy = nb.y - pa.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    for (let j = 0; j < count; j++) {
      const u1 = grain(seed + j * 13.1), u2 = grain(seed * 0.7 + j * 29.3 + 5), u3 = grain(seed * 1.3 + j * 17.7 + 11), u4 = grain(seed * 2.1 + j * 7.9 + 3);
      const rho = R * 1.3 * Math.sqrt(u1), ang = u2 * Math.PI * 2;
      const x = q.x + Math.cos(ang) * rho, y = q.y + Math.sin(ang) * rho;
      if (u4 < 0.12 + 0.3 * dk && rho < R * 0.8) { dark += speck(x, y, Math.max(0.04, w * (0.05 + 0.06 * u3))); continue; }
      if (u4 > 0.6) { light += speck(x, y, Math.max(0.04, w * (0.04 + 0.07 * u3))); continue; }
      // a streak: short segment along the direction, a little longer towards the centre
      const len = w * (0.1 + 0.28 * u3) * (1 - 0.3 * rho / (R * 1.3 + 1e-6));
      streaks += `M${(x - dx * len / 2).toFixed(1)} ${(y - dy * len / 2).toFixed(1)}l${(dx * len).toFixed(1)} ${(dy * len).toFixed(1)}`;
    }
  }
  // faint continuous core (variable width) so strokes never break into dots; also the hit/selection outline (wash)
  const coreInput = samples.map((q, i) => [q.x, q.y, Math.min(1, coreW[i] / W)]);
  const core = samples.length > 1
    ? strokeOutline(coreInput, { size: W, thinning: 1, smoothing: 0.5, streamline: 0.2, simulatePressure: false, easing: (x: number) => x, last: !live, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } })
    : [];
  res.core = core.length > 2 ? outlineToPath(core) : circ(samples[0].x, samples[0].y, coreW[0] / 2);
  const washInput = samples.map((q) => [q.x, q.y, Math.min(1, pencilWidthFactor(q) * 0.5)]);
  const wash = samples.length > 1 ? strokeOutline(washInput, { size: W * 1.5, thinning: 1, smoothing: 0.5, streamline: 0.2, simulatePressure: false, easing: (x: number) => x, last: !live }) : [];
  res.wash = wash.length > 2 ? outlineToPath(wash) : circ(samples[0].x, samples[0].y, W * 0.5);
  res.dark = dark; res.light = light; res.streaks = streaks;
  if (!live) { let m = pencilCache.get(points); if (!m) { m = new Map(); pencilCache.set(points, m); } m.set(width, res); }
  return res;
}
/**
 * Highlighter input clean-up. Where the pen lands (and lifts) it jitters for a moment; with a wide translucent stroke
 * those tiny back-and-forth steps turn into a half-filled bulge at the start. Keep the landing point, skip points until
 * the pen has really left the landing spot, drop steps shorter than a fraction of the width, and drop a short
 * reversing last step (lift jitter). The start/end then stay clean flat ends, fully coloured.
 */
export function cleanHighlight(points: Point[], width: number): Point[] {
  if (points.length < 3) return points;
  const r0 = Math.max(3.5, width * 0.6), step = Math.max(0.8, width * 0.12); const a = points[0]; const out: Point[] = [a];
  let i = 1; while (i < points.length - 1 && dist(points[i], a) < r0) i++;
  for (; i < points.length; i++) { const q = points[i]; if (i === points.length - 1 || dist(q, out[out.length - 1]) >= step) out.push(q); }
  if (out.length >= 3) { const n = out.length, w0 = out[n - 3], u = out[n - 2], v = out[n - 1]; if ((v.x - u.x) * (u.x - w0.x) + (v.y - u.y) * (u.y - w0.y) < 0 && dist(u, v) < r0) out.pop(); }
  return out;
}
/** deterministic 0..1 noise (same stroke always renders the same grain) */
export function grain(seed: number) { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }
/** id of the SVG grain pattern for a pencil colour */
export const pencilGrainId = (color: string) => 'pg' + color.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
/** paper-tooth grain for graphite: an irregular field of specks in one large pattern cell (page units), so the tiling is not
 * visible. Bigger, fainter specks fill the body; small dark ones give the sparkle of graphite on paper tooth. */
export const PENCIL_GRAIN_CELL = 17;
export const PENCIL_GRAIN_DOTS = Array.from({ length: 520 }, (_, i) => { const big = i % 4 === 0; return { cx: grain(i * 3.7 + 1) * PENCIL_GRAIN_CELL, cy: grain(i * 5.1 + 2) * PENCIL_GRAIN_CELL, r: big ? 0.2 + grain(i * 2.3 + 3) * 0.22 : 0.07 + grain(i * 2.9 + 4) * 0.13, a: big ? 0.35 + grain(i * 7.9 + 5) * 0.35 : 0.6 + grain(i * 6.1 + 6) * 0.4 }; });
export const isInkPen = (tool: string) => tool === 'pen' || tool === 'pencil' || tool === 'fountain' || tool === 'brush';

/** Polyline path (no smoothing) for auto-corrected polygons and straight highlighter strokes. */
export function polyPath(points: Point[], s: number, closed = false) { if (!points.length) return ''; let d = `M ${points[0].x * s} ${points[0].y * s}`; for (let i = 1; i < points.length; i++) d += ` L ${points[i].x * s} ${points[i].y * s}`; return closed ? d + ' Z' : d; }

/** Ramer–Douglas–Peucker simplification. */
function rdp(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts.slice(); const a = pts[0], b = pts[pts.length - 1]; let idx = 0, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = distToSegment(pts[i], a, b); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax <= eps) return [a, b]; return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
/**
 * 도형 자동 보정 (Samsung Notes "neat shape"): turns a rough closed figure into a clean ellipse, rectangle,
 * triangle or polygon. Only large closed strokes qualify, so ordinary handwriting (o, 0, D…) is left alone.
 */
export type NeatShape = { kind: 'ellipse' | 'rectangle'; a: Point; b: Point } | { kind: 'poly'; points: Point[] };
export function recognizeShape(pts: Point[], minSize = 36): NeatShape | null {
  if (pts.length < 12) return null;
  const bx = boundsOf(pts); const diag = Math.hypot(bx.w, bx.h); if (Math.max(bx.w, bx.h) < minSize) return null;
  let len = 0; for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  const gap = dist(pts[0], pts[pts.length - 1]); if (gap > Math.max(diag * 0.22, len * 0.1)) return null; // must be (nearly) closed
  // ellipse test: normalized radius variance around the bbox centre
  const cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2, rx = Math.max(1, bx.w / 2), ry = Math.max(1, bx.h / 2);
  const rr = pts.map((q) => Math.hypot((q.x - cx) / rx, (q.y - cy) / ry)); const mean = rr.reduce((a, b) => a + b, 0) / rr.length; const sd = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / rr.length);
  const closedPts = [...pts, pts[0]]; let poly = rdp(closedPts, diag * 0.07); if (poly.length > 1 && dist(poly[0], poly[poly.length - 1]) < diag * 0.12) poly = poly.slice(0, -1);
  // merge near-collinear vertices
  const corners = poly.filter((q, i) => { const p0 = poly[(i - 1 + poly.length) % poly.length], p2 = poly[(i + 1) % poly.length]; const a1 = Math.atan2(q.y - p0.y, q.x - p0.x), a2 = Math.atan2(p2.y - q.y, p2.x - q.x); let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d; return d > 0.45; });
  if (corners.length >= 3 && corners.length <= 4 && sd > 0.07) {
    if (corners.length === 4) {
      // axis-aligned rectangle when edges are near horizontal/vertical
      const axis = corners.every((q, i) => { const n = corners[(i + 1) % 4]; const ang = Math.abs(Math.atan2(n.y - q.y, n.x - q.x)) % (Math.PI / 2); return ang < 0.2 || ang > Math.PI / 2 - 0.2; });
      if (axis) return { kind: 'rectangle', a: { x: bx.x, y: bx.y }, b: { x: bx.x + bx.w, y: bx.y + bx.h } };
    }
    return { kind: 'poly', points: corners };
  }
  if (sd < 0.11 && mean > 0.75 && mean < 1.15) return { kind: 'ellipse', a: { x: bx.x, y: bx.y }, b: { x: bx.x + bx.w, y: bx.y + bx.h } };
  return null;
}
