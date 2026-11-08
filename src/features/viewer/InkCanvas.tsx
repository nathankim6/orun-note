import { useSharedValue, runOnJS } from 'react-native-reanimated';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TextInput, Pressable, Text, Platform, PixelRatio } from 'react-native';
import Svg, { Path, Rect as SvgRect, G, Circle } from 'react-native-svg';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import { ImageBox, Point, Stroke, TextBox } from '@/data/types';
import { Image } from 'react-native';
import { TEXT_FONTS } from './Toolbar';
import { PdfWord } from '../../../modules/pdf-renderer';
import { wordAt, wordsBetween, cleanWord } from './words';
import { penSession } from './penSession';
import { ToolConfig, penOutline, isInkPen, polyPath, recognizeShape, pathFromPoints, shapePath, strokesHit, eraseVector, pointInPolygon, snapLine, boundsOf, dist } from './ink';
import { uid } from '@/store/persist';
import { useTheme } from '@/theme';

export type InkHandle = { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; /** add/replace page images as one undoable step */ commitImages?: (next: ImageBox[]) => void };
type Props = {
  /** visible window of this page (0..1) when zoomed; with `dense` (page drawn >1x) only that window is rasterised */ region?: { nx: number; ny: number; nw: number; nh: number } | null; dense?: boolean; /** page drawn at this multiple of its 1x size */ density?: number;
  width: number; height: number; s: number; strokes: Stroke[]; textBoxes: TextBox[]; images?: ImageBox[]; onImages?: (next: ImageBox[]) => void; textFont?: string;
  /** Samsung-Notes handwriting options */ opts?: InkOpts;
  /** Text layer for tap-to-define; rects normalized to the page. */ words?: PdfWord[] | null; onLookup?: (text: string, abs: { x: number; y: number }, rects: { x: number; y: number; w: number; h: number }[]) => void; cfg: ToolConfig; enabled: boolean; fingerDraw: boolean; lineSnap?: boolean;
  onStrokes: (next: Stroke[]) => void; onTextBoxes: (next: TextBox[]) => void; onTap?: (p: Point) => boolean; onLongPress?: (p: Point) => void; onDoubleTap?: (p: Point) => void; readOnly?: boolean;
  onHistory?: (h: { canUndo: boolean; canRedo: boolean }) => void; historyRef?: React.MutableRefObject<InkHandle | null>; onSelectionChange?: (ids: string[]) => void;
};

export type InkOpts = { fixedWidth: boolean; straightHighlighter: boolean; eraseHighlighterOnly: boolean; lassoMode: 'free' | 'rect'; lassoPartial: boolean; neatShape: boolean };
const DEFAULT_OPTS: InkOpts = { fixedWidth: false, straightHighlighter: false, eraseHighlighterOnly: false, lassoMode: 'free', lassoPartial: true, neatShape: false };
/** Lasso clipboard shared across pages (잘라내기/복사 → 붙여넣기). */
let CLIP: { strokes: Stroke[]; textBoxes: TextBox[]; images: ImageBox[]; b: { x: number; y: number; w: number; h: number } } | null = null;
/** Timestamp of the last word lookup triggered by a double-tap (lets the zoom double-tap skip). */
export let lastLookupAt = 0;
export function InkCanvas({ width, height, s, strokes, textBoxes, images = [], onImages, textFont = 'system', words, onLookup, opts = DEFAULT_OPTS, cfg, enabled, fingerDraw, lineSnap, onStrokes, onTextBoxes, onTap, onLongPress, onDoubleTap, readOnly, historyRef, onHistory, onSelectionChange , region, dense, density = 1}: Props) {
  const { colors } = useTheme();
  const [live, setLive] = useState<Point[]>([]); const [laser, setLaser] = useState<Point[]>([]); const [lasso, setLasso] = useState<Point[]>([]); const [selection, setSelection] = useState<string[]>([]); const [editing, setEditing] = useState<string | null>(null);
  // Cursor (select) tool state: selected text boxes/images, live drag offset, text-block and marquee selections.
  const [selText, setSelText] = useState<string[]>([]); const [selImg, setSelImg] = useState<string[]>([]); const [dragOff, setDragOff] = useState<{ x: number; y: number } | null>(null);
  const [textSel, setTextSel] = useState<PdfWord[]>([]); const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const selMode = useRef<'move' | 'resize' | 'text' | 'marquee' | 'lasso' | null>(null); const selStart = useRef<Point>({ x: 0, y: 0 });
  const [dragScale, setDragScaleState] = useState<{ f: number; ox: number; oy: number } | null>(null); const dragScaleRef = useRef<{ f: number; ox: number; oy: number } | null>(null);
  const setDragScale = (v: { f: number; ox: number; oy: number } | null) => { dragScaleRef.current = v; setDragScaleState(v); };
  const lassoRef = useRef<Point[]>([]); const marqueeRef = useRef<{ a: Point; b: Point } | null>(null); const resizeBase = useRef({ x: 0, y: 0, w: 1, h: 1 }); const [pasteAt, setPasteAt] = useState<Point | null>(null);
  const imagesRef = useRef(images); imagesRef.current = images;
  const pageW = width / s, pageH = height / s;
  const tbRect = (tb: TextBox) => { const lines = Math.max(1, (tb.text || ' ').split('\n').length); const longest = Math.max(4, ...(tb.text || '    ').split('\n').map((l) => l.length)); return { x: tb.rect.x, y: tb.rect.y, w: Math.max(tb.rect.w * 0.4, longest * tb.size * 0.6) + 8, h: lines * tb.size * 1.35 + 8 }; };
  const inRect = (p: Point, r: { x: number; y: number; w: number; h: number }, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
  const clearSel = () => { setSelection([]); setSelText([]); setSelImg([]); setPasteAt(null); onSelectionChange?.([]); };
  const lookupAt = (p: Point, abs: { x: number; y: number }) => { const w = wordAt(words ?? null, p.x / pageW, p.y / pageH); if (!w || !onLookup) return false; const t = cleanWord(w.t); if (!/[A-Za-z]/.test(t)) return false; setTextSel([w]); onLookup(t, abs, [{ x: w.x * pageW, y: w.y * pageH, w: w.w * pageW, h: w.h * pageH }]); return true; };
  const liveRef = useRef<Point[]>([]); const startT = useRef(0); const strokesRef = useRef(strokes); strokesRef.current = strokes; const textRef = useRef(textBoxes); textRef.current = textBoxes;
  const undoStack = useRef<{ strokes: Stroke[]; textBoxes: TextBox[]; images?: ImageBox[] }[]>([]); const redoStack = useRef<typeof undoStack.current>([]);
  const pushSnap = useCallback((sn: { strokes: Stroke[]; textBoxes: TextBox[]; images?: ImageBox[] }) => { undoStack.current.push(sn); if (undoStack.current.length > 60) undoStack.current.shift(); redoStack.current = []; onHistory?.({ canUndo: true, canRedo: false }); }, [onHistory]);
  const pushHistory = useCallback(() => pushSnap({ strokes: strokesRef.current, textBoxes: textRef.current, images: imagesRef.current }), [pushSnap]);
  /** One user action = one undo step, whatever mix of strokes / text / images it touches. */
  const commitAll = useCallback((n: { strokes?: Stroke[]; texts?: TextBox[]; images?: ImageBox[] }) => { if (!n.strokes && !n.texts && !n.images) return; pushHistory(); if (n.strokes) onStrokes(n.strokes); if (n.texts) onTextBoxes(n.texts); if (n.images) onImages?.(n.images); }, [pushHistory, onStrokes, onTextBoxes, onImages]);
  const commit = useCallback((next: Stroke[]) => { pushHistory(); onStrokes(next); }, [onStrokes, pushHistory]);
  /** Text editing records ONE undo step per finished edit: the page as it was before the box was created/opened. */
  const editBase = useRef<TextBox[] | null>(null);
  const pushTextBase = useCallback((base: TextBox[]) => pushSnap({ strokes: strokesRef.current, textBoxes: base, images: imagesRef.current }), [pushSnap]);
  const commitText = useCallback((next: TextBox[]) => { pushHistory(); onTextBoxes(next); }, [onTextBoxes, pushHistory]);
  useEffect(() => { if (historyRef) historyRef.current = {
    undo: () => { const prev = undoStack.current.pop(); if (!prev) return; redoStack.current.push({ strokes: strokesRef.current, textBoxes: textRef.current, images: imagesRef.current }); onStrokes(prev.strokes); onTextBoxes(prev.textBoxes); if (prev.images && onImages) onImages(prev.images); onHistory?.({ canUndo: undoStack.current.length > 0, canRedo: true }); },
    redo: () => { const next = redoStack.current.pop(); if (!next) return; undoStack.current.push({ strokes: strokesRef.current, textBoxes: textRef.current, images: imagesRef.current }); onStrokes(next.strokes); onTextBoxes(next.textBoxes); if (next.images && onImages) onImages(next.images); onHistory?.({ canUndo: true, canRedo: redoStack.current.length > 0 }); },
    get canUndo() { return undoStack.current.length > 0; }, get canRedo() { return redoStack.current.length > 0; },
    commitImages: (next: ImageBox[]) => commitAll({ images: next }),
  }; });
  const toPage = (x: number, y: number): Point => ({ x: x / s, y: y / s });
  // stylus pressure (0..1) from Apple Pencil / S Pen; absent for touch/mouse
  const toPageP = (e: any): Point => { const q: Point = { x: e.x / s, y: e.y / s }; const pr = e?.stylusData?.pressure; if (typeof pr === 'number' && pr > 0) q.p = pr; return q; };
  const eraserR = Math.max(8, cfg.width * 3);
  const isDrawingTool = ['pen', 'pencil', 'highlighter', 'fountain', 'brush'].includes(cfg.tool);
  // Finger input draws only when the user enabled it; stylus (Apple Pencil / S Pen) and mouse always draw.
  // Finger input never draws: touch is reserved for pinch-zoom and page scrolling. Only stylus (Apple Pencil / S Pen) draws; mouse is allowed for web/desktop.
  const allowPointer = (pointerType: any) => (Platform.OS === 'web' && pointerType !== PointerType.TOUCH) || pointerType === PointerType.STYLUS || pointerType === PointerType.MOUSE || cfg.tool === 'select'; // the cursor tool (select/move/define) also works with a finger
  const rejected = useRef(false); const lastPe = useRef<PseudoEvt | null>(null);
  useEffect(() => () => { if (activeId.current != null) penSession.value = { ...penSession.value, writing: false }; }, []);
  // Dwell-to-line: while a pen stroke is in progress, holding still at the end point for 1.5s snaps the stroke to a straight line.
  const dwellTimer = useRef<any>(null); const lastMovePt = useRef<Point | null>(null); const snappedLine = useRef(false);
  const clearDwell = () => { if (dwellTimer.current) { clearTimeout(dwellTimer.current); dwellTimer.current = null; } };
  const armDwell = (p: Point) => { if (!lineSnap) return; clearDwell(); dwellTimer.current = setTimeout(() => { const pts = liveRef.current; if (pts.length < 4 || snappedLine.current) return; if (dist(pts[0], p) < 20 / s) return; snappedLine.current = true; liveRef.current = [pts[0], p]; setLive([pts[0], p]); }, 500); };

  const finish = useCallback((pts: Point[], pointerOk: boolean) => {
    const t = Date.now() - startT.current; const tool = cfg.tool;
    if (!pointerOk) return;
    const isTap = pts.length > 0 && t < 260 && dist(pts[0], pts[pts.length - 1]) < 5 / s && boundsOf(pts).w < 6 / s && boundsOf(pts).h < 6 / s;
    if (isTap) { if (tool === 'text') { const p = pts[0]; const tb: TextBox = { id: uid(), rect: { x: p.x, y: p.y, w: 180, h: 40 }, text: '', color: cfg.color, size: Math.max(8, cfg.width >= 8 ? cfg.width : 14), font: textFont, createdAt: Date.now() }; editBase.current = textRef.current; onTextBoxes([...textRef.current, tb]); setEditing(tb.id); return; } if (onTap?.(pts[0])) return; if (tool === 'lasso') { setSelection([]); onSelectionChange?.([]); return; } if (!isDrawingTool) return; }
    if (readOnly) return;
    if (isDrawingTool) {
      let points = pts; let poly = false;
      if (tool === 'highlighter' && opts.straightHighlighter && pts.length >= 2) { const a = pts[0], b0 = pts[pts.length - 1]; const b = Math.abs(b0.y - a.y) < Math.abs(b0.x - a.x) * 0.09 ? { x: b0.x, y: a.y } : b0; points = [a, b]; poly = true; }
      else if (lineSnap && !snappedLine.current) { const sn = snapLine(pts); if (sn) points = sn; }
      if (points.length === 0) return;
      if (opts.neatShape && tool !== 'highlighter' && !snappedLine.current && points.length > 8) {
        const sh = recognizeShape(points, 30);
        if (sh && sh.kind !== 'poly') { commit([...strokesRef.current, { id: uid(), tool: 'shape', shape: sh.kind, color: cfg.color, width: cfg.width, opacity: cfg.opacity, points: [sh.a, sh.b], createdAt: Date.now() }]); return; }
        if (sh && sh.kind === 'poly') { commit([...strokesRef.current, { id: uid(), tool, color: cfg.color, width: cfg.width, opacity: cfg.opacity, points: sh.points, poly: true, closed: true, createdAt: Date.now() }]); return; }
      }
      commit([...strokesRef.current, { id: uid(), tool, color: cfg.color, width: cfg.width, opacity: cfg.opacity, points, createdAt: Date.now(), ...(poly ? { poly: true } : {}), ...(tool !== 'highlighter' && opts.fixedWidth ? { fixed: true } : {}) }]); return; }
    if (tool === 'shape' && pts.length >= 2) { commit([...strokesRef.current, { id: uid(), tool: 'shape', shape: cfg.shape, color: cfg.color, width: cfg.width, opacity: 1, points: [pts[0], pts[pts.length - 1]], createdAt: Date.now() }]); return; }
    if (tool === 'lasso' && pts.length > 3) { const ids = strokesRef.current.filter((st) => st.points.some((q) => pointInPolygon(q, pts))).map((st) => st.id); setSelection(ids); onSelectionChange?.(ids); return; }
    if ((tool === 'eraser' || tool === 'vectorEraser') && strokesRef.current !== strokes) { /* already committed progressively */ }
  }, [cfg, s, commit, commitText, onTap, readOnly, lineSnap, isDrawingTool, strokes, onSelectionChange, opts]);

  const erasing = useRef(false); const eraseBefore = useRef<Stroke[] | null>(null);
  // ---- input pipeline with palm rejection ----
  // A stroke follows ONLY the contact that started it (the pen). Palms/fingers landing while writing are ignored
  // (they no longer cancel the stroke or drag the line toward the palm). Finger contacts never draw; they wait, so the
  // document can scroll/zoom with them — or a pen that lands while the palm rests still starts a stroke.
  const activeId = useRef<number | null>(null); const activeType = useRef<any>(null); const pressureRef = useRef<number | undefined>(undefined);
  const rafRef = useRef<any>(null); const scheduleLive = () => { if (rafRef.current == null) rafRef.current = requestAnimationFrame(() => { rafRef.current = null; setLive([...liveRef.current]); }); }; const cancelLive = () => { if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  type PseudoEvt = { x: number; y: number; absoluteX: number; absoluteY: number; pointerType: any; stylusData?: { pressure: number } };
  const pseudo = (t: { x: number; y: number; absoluteX: number; absoluteY: number }): PseudoEvt => ({ x: t.x, y: t.y, absoluteX: t.absoluteX, absoluteY: t.absoluteY, pointerType: activeType.current, stylusData: pressureRef.current ? { pressure: pressureRef.current } : undefined });
  const beginAt = (e: PseudoEvt) => { startT.current = Date.now(); snappedLine.current = false; clearDwell(); const p = toPageP(e); liveRef.current = [p]; lastMovePt.current = p;
      if (cfg.tool === 'select' || cfg.tool === 'lasso') { selStart.current = p; setTextSel([]); setPasteAt(null);
        const hasSel = selection.length || selText.length || selImg.length; const sb = combinedBounds();
        if (hasSel && sb && dist(p, { x: sb.x + sb.w + 6 / s, y: sb.y + sb.h + 6 / s }) < 18 / s) { selMode.current = 'resize'; resizeBase.current = { x: sb.x - 6 / s, y: sb.y - 6 / s, w: sb.w + 12 / s, h: sb.h + 12 / s }; return; }
        if (hasSel && sb && inRect(p, sb, 10 / s)) { selMode.current = 'move'; return; }
        if (cfg.tool === 'lasso') { clearSel(); if (opts.lassoMode === 'rect') { selMode.current = 'marquee'; marqueeRef.current = { a: p, b: p }; setMarquee({ a: p, b: p }); } else { selMode.current = 'lasso'; lassoRef.current = [p]; setLasso([p]); } return; }
        const img = [...imagesRef.current].reverse().find((im) => inRect(p, im.rect)); if (img) { setSelection([]); setSelText([]); setSelImg([img.id]); selMode.current = 'move'; return; }
        const tb = [...textRef.current].reverse().find((t) => inRect(p, tbRect(t), 4 / s)); if (tb) { setSelection([]); setSelImg([]); setSelText([tb.id]); selMode.current = 'move'; return; }
        const hit = strokesHit(strokesRef.current, p, 10 / s); if (hit.length) { setSelText([]); setSelImg([]); setSelection([hit[hit.length - 1]]); selMode.current = 'move'; return; }
        clearSel(); selMode.current = words?.length && wordAt(words, p.x / pageW, p.y / pageH) ? 'text' : 'marquee'; if (selMode.current === 'marquee') { marqueeRef.current = { a: p, b: p }; setMarquee({ a: p, b: p }); } return; } if (cfg.tool === 'eraser' || cfg.tool === 'vectorEraser') { erasing.current = true; eraseBefore.current = strokesRef.current; } if (cfg.tool === 'laser') setLaser([p]); else setLive([p]); 
  };
  const moveTo = (e: PseudoEvt) => { const p = toPageP(e); const pointerOk = allowPointer(e.pointerType); if (!pointerOk) return; liveRef.current.push(p);
      if (cfg.tool === 'select' || cfg.tool === 'lasso') { const a = selStart.current;
        if (selMode.current === 'move') setDragOff({ x: p.x - a.x, y: p.y - a.y });
        else if (selMode.current === 'resize') { const b0 = resizeBase.current; setDragScale({ f: Math.max(0.15, ((p.x - b0.x) + (p.y - b0.y)) / Math.max(1e-3, b0.w + b0.h)), ox: b0.x, oy: b0.y }); }
        else if (selMode.current === 'text') setTextSel(wordsBetween(words ?? null, { x: a.x / pageW, y: a.y / pageH }, { x: p.x / pageW, y: p.y / pageH }));
        else if (selMode.current === 'lasso') { lassoRef.current = [...lassoRef.current, p]; setLasso(lassoRef.current); }
        else { marqueeRef.current = { a, b: p }; setMarquee(marqueeRef.current); } return; }
      if (cfg.tool === 'eraser') { const prev = liveRef.current.length > 1 ? liveRef.current[liveRef.current.length - 2] : undefined; const hit = strokesHit(eraseCands(), p, eraserR, prev); if (hit.length) onStrokes(strokesRef.current.filter((st) => !hit.includes(st.id))); setLive([p]); return; }
      if (cfg.tool === 'vectorEraser') { const prev = liveRef.current.length > 1 ? liveRef.current[liveRef.current.length - 2] : undefined; let next = strokesRef.current; const n = prev ? Math.ceil(dist(prev, p) / Math.max(2, eraserR / 2)) : 1; for (let i = 1; i <= n; i++) { const q = prev ? { x: prev.x + ((p.x - prev.x) * i) / n, y: prev.y + ((p.y - prev.y) * i) / n } : p; next = eraseVector(next, q, eraserR, uid, opts.eraseHighlighterOnly ? (st) => st.tool === 'highlighter' : undefined); } if (next !== strokesRef.current) onStrokes(next); setLive([p]); return; }
      if (cfg.tool === 'laser') { setLaser((l) => [...l.slice(-25), p]); return; }
      if (cfg.tool === 'shape') { setLive([liveRef.current[0], p]); return; }
      if (cfg.tool === 'highlighter' && opts.straightHighlighter) { const a0 = liveRef.current[0]; liveRef.current = [a0, p]; setLive([a0, Math.abs(p.y - a0.y) < Math.abs(p.x - a0.x) * 0.09 ? { x: p.x, y: a0.y } : p]); return; }
      if (isDrawingTool) { // pen AND highlighter: hold still at the end for 0.5 s → straight line
        if (snappedLine.current) { liveRef.current = [liveRef.current[0], p]; setLive([liveRef.current[0], p]); return; }
        if (!lastMovePt.current || dist(lastMovePt.current, p) > 3 / s) { lastMovePt.current = p; armDwell(p); }
      }
      scheduleLive(); 
  };
  const endAt = (e: PseudoEvt) => { clearDwell(); cancelLive(); if (rejected.current) { liveRef.current = []; setLive([]); return; } const pts = liveRef.current; const pointerOk = allowPointer(e.pointerType);
      if (cfg.tool === 'select' || cfg.tool === 'lasso') { const end = toPage(e.x, e.y); const a = selStart.current; const moved = dist(a, end) > 4 / s; const abs = { x: (e as any).absoluteX ?? e.x, y: (e as any).absoluteY ?? e.y };
        if (selMode.current === 'move') { if (moved) applyMove(end.x - a.x, end.y - a.y); setDragOff(null); }
        else if (selMode.current === 'resize') { const ds = dragScaleRef.current; if (ds) applyScale(ds.f, ds.ox, ds.oy); setDragScale(null); }
        else if (selMode.current === 'lasso') { const poly = [...lassoRef.current, end]; lassoRef.current = []; setLasso([]); const span = poly.length > 1 ? Math.max(...poly.map((q) => dist(poly[0], q))) : 0; if (poly.length > 3 && span > 8 / s) selectWhere((q) => pointInPolygon(q, poly)); else setPasteAt(end); }
        else if (selMode.current === 'text') { const ws = moved ? wordsBetween(words ?? null, { x: a.x / pageW, y: a.y / pageH }, { x: end.x / pageW, y: end.y / pageH }) : []; if (moved && ws.length && onLookup) { setTextSel(ws); onLookup(ws.map((w) => w.t).join(' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[^A-Za-z]+|[^A-Za-z.!?]+$/g, ''), abs, ws.map((w) => ({ x: w.x * pageW, y: w.y * pageH, w: w.w * pageW, h: w.h * pageH }))); } }
        else { const m = marqueeRef.current; marqueeRef.current = null; setMarquee(null); if (m && moved) { const r = { x: Math.min(m.a.x, end.x), y: Math.min(m.a.y, end.y), w: Math.abs(end.x - m.a.x), h: Math.abs(end.y - m.a.y) }; selectWhere((q) => inRect(q, r)); } else if (cfg.tool === 'lasso') setPasteAt(end); }
        selMode.current = null; liveRef.current = []; setLive([]); return; } if (erasing.current) { erasing.current = false; if (eraseBefore.current && eraseBefore.current !== strokesRef.current) { undoStack.current.push({ strokes: eraseBefore.current, textBoxes: textRef.current }); redoStack.current = []; onHistory?.({ canUndo: true, canRedo: false }); } eraseBefore.current = null; const isTap = pts.length > 0 && Date.now() - startT.current < 260 && dist(pts[0], pts[pts.length - 1]) < 5 / s; if (isTap) { const hit = strokesHit(eraseCands(), pts[0], eraserR); if (hit.length) commit(strokesRef.current.filter((st) => !hit.includes(st.id))); else onTap?.(pts[0]); } }
      else finish(pts, pointerOk);
      setLive([]); liveRef.current = []; if (cfg.tool === 'laser') setTimeout(() => setLaser([]), 600); 
  };
  const abortStroke = () => { clearDwell(); cancelLive(); activeId.current = null; liveRef.current = []; setLive([]); setLasso([]); setMarquee(null); setDragOff(null); setDragScale(null); selMode.current = null; erasing.current = false; eraseBefore.current = null; penSession.value = { ...penSession.value, writing: false, at: activeType.current === PointerType.STYLUS ? Date.now() : penSession.value.at }; };
  // Pen input pipeline (Samsung Notes / GoodNotes model).
  // The pen/finger decision, activation and stroke ownership happen ON THE UI THREAD (worklets), synchronously with the touch.
  // Earlier versions asked gesture-handler to activate / end the gesture from the JS thread; those requests arrive late, and a
  // late "end" from stroke N landed on stroke N+1 and cut it off after its first point → every other stroke went missing.
  // The gesture now never gets an "end" from us (gesture-handler ends it itself when the pen lifts), and only a pen (or a
  // mouse) can ever start a stroke — fingers and palms are left entirely to zoom / move the page.
  const H = useRef<any>({});
  H.current = {
    down: (x: number, y: number, ax: number, ay: number, pt: any) => {
      rejected.current = false; activeId.current = 1; activeType.current = pt; pressureRef.current = undefined;
      const pe: PseudoEvt = { x, y, absoluteX: ax, absoluteY: ay, pointerType: pt }; lastPe.current = pe; beginAt(pe);
    },
    move: (x: number, y: number, ax: number, ay: number, pr: number) => {
      if (activeId.current == null) return; if (pr > 0) pressureRef.current = pr;
      const pe: PseudoEvt = { x, y, absoluteX: ax, absoluteY: ay, pointerType: activeType.current, stylusData: pressureRef.current ? { pressure: pressureRef.current } : undefined }; lastPe.current = pe; moveTo(pe);
    },
    up: (x: number, y: number, ax: number, ay: number, pr: number) => {
      if (activeId.current == null) return; if (pr > 0) pressureRef.current = pr; activeId.current = null;
      endAt({ x, y, absoluteX: ax, absoluteY: ay, pointerType: activeType.current, stylusData: pressureRef.current ? { pressure: pressureRef.current } : undefined }); lastPe.current = null;
    },
    finish: () => { if (activeId.current == null) return; const pe = lastPe.current; activeId.current = null; if (pe) endAt(pe); else abortStroke(); lastPe.current = null; },
    abort: () => { if (activeId.current != null) abortStroke(); lastPe.current = null; },
  };
  const jsDown = useCallback((x: number, y: number, ax: number, ay: number, pt: any) => H.current.down(x, y, ax, ay, pt), []);
  const jsMove = useCallback((x: number, y: number, ax: number, ay: number, pr: number) => H.current.move(x, y, ax, ay, pr), []);
  const jsUp = useCallback((x: number, y: number, ax: number, ay: number, pr: number) => H.current.up(x, y, ax, ay, pr), []);
  const jsFinish = useCallback(() => H.current.finish(), []); const jsAbort = useCallback(() => H.current.abort(), []);
  const penId = useSharedValue(-1); const pressSV = useSharedValue(-1); const handMode = useSharedValue(cfg.tool === 'hand');
  useEffect(() => { handMode.value = cfg.tool === 'hand'; }, [cfg.tool]);
  const pan = useMemo(() => Gesture.Pan().enabled(enabled).minDistance(0).maxPointers(10).averageTouches(false).manualActivation(true)
    .onTouchesDown((e, sm) => {
      'worklet';
      if (handMode.value) { sm.fail(); return; }
      if (penId.value !== -1) return;                           // a stroke is in progress: palm / extra fingers are ignored
      const t = e.changedTouches[e.changedTouches.length - 1]; if (!t) return;
      const pt = e.pointerType;
      if (pt !== PointerType.STYLUS && pt !== PointerType.MOUSE) return; // finger / palm: never writes or erases — and keep listening for the pen
      penId.value = t.id; pressSV.value = -1;
      const now = Date.now(); penSession.value = { ...penSession.value, writing: true, byPen: pt === PointerType.STYLUS, at: now, since: now };
      sm.activate();
      runOnJS(jsDown)(t.x, t.y, t.absoluteX, t.absoluteY, pt);
    })
    .onTouchesMove((e) => {
      'worklet';
      const id = penId.value; if (id === -1) return;
      for (let i = 0; i < e.allTouches.length; i++) { const t = e.allTouches[i]; if (t.id === id) { runOnJS(jsMove)(t.x, t.y, t.absoluteX, t.absoluteY, pressSV.value); return; } }
    })
    .onTouchesUp((e) => {
      'worklet';
      const id = penId.value; if (id === -1) return;
      for (let i = 0; i < e.changedTouches.length; i++) { const t = e.changedTouches[i]; if (t.id === id) {
        penId.value = -1; penSession.value = { ...penSession.value, writing: false, at: Date.now() };
        runOnJS(jsUp)(t.x, t.y, t.absoluteX, t.absoluteY, pressSV.value); return; } }
    })
    .onTouchesCancelled(() => { 'worklet'; if (penId.value !== -1) { penId.value = -1; penSession.value = { ...penSession.value, writing: false, at: Date.now() }; runOnJS(jsAbort)(); } })
    // Apple Pencil force/maxForce and S Pen getPressure() arrive as 0..1 (handwriting sits around 0.15-0.5): gamma curve + smoothing
    .onUpdate((e) => { 'worklet'; const pr = (e as any).stylusData?.pressure; if (typeof pr === 'number' && pr > 0) { const c = Math.min(1, Math.max(0.06, Math.pow(pr, 0.65))); pressSV.value = pressSV.value < 0 ? c : pressSV.value + (c - pressSV.value) * 0.35; } })
    .onFinalize((_e, success) => { 'worklet'; if (penId.value !== -1) { penId.value = -1; penSession.value = { ...penSession.value, writing: false, at: Date.now() }; if (success) runOnJS(jsFinish)(); else runOnJS(jsAbort)(); } }),
  [enabled]);
  const longPress = useMemo(() => Gesture.LongPress().enabled(enabled && !!onLongPress).minDuration(450).runOnJS(true).onStart((e) => onLongPress?.(toPage(e.x, e.y))), [enabled, onLongPress, s]);
  const doubleTap = useMemo(() => Gesture.Tap().enabled(enabled && cfg.tool === 'select' && (!!onDoubleTap || !!words?.length)).numberOfTaps(2).maxDelay(280).runOnJS(true).onStart((e) => { const p = toPage(e.x, e.y); if (lookupAt(p, { x: e.absoluteX, y: e.absoluteY })) { lastLookupAt = Date.now(); return; } onDoubleTap?.(p); }), [enabled, onDoubleTap, s, words, onLookup, width, height, cfg.tool]);
  const composed = useMemo(() => Gesture.Simultaneous(pan, longPress, doubleTap), [pan, longPress, doubleTap]);

  const livePath = useMemo(() => { if (live.length === 0) return null; if (cfg.tool === 'shape' && live.length >= 2) return shapePath(cfg.shape, live[0], live[1], s); if (cfg.tool === 'eraser' || cfg.tool === 'vectorEraser') return null; return pathFromPoints(live, s); }, [live, cfg, s]);
  const deleteSelection = () => { commit(strokesRef.current.filter((st) => !selection.includes(st.id))); setSelection([]); onSelectionChange?.([]); };
  const duplicateSelection = () => { const dup = strokesRef.current.filter((st) => selection.includes(st.id)).map((st) => ({ ...st, id: uid(), points: st.points.map((p) => ({ ...p, x: p.x + 20, y: p.y + 20 })), createdAt: Date.now() })); commit([...strokesRef.current, ...dup]); setSelection(dup.map((d) => d.id)); };
  function combinedBounds() { const rs: { x: number; y: number; w: number; h: number }[] = []; const sp = strokesRef.current.filter((st) => selection.includes(st.id)).flatMap((st) => st.points); if (sp.length) rs.push(boundsOf(sp)); for (const t of textRef.current) if (selText.includes(t.id)) rs.push(tbRect(t)); for (const im of imagesRef.current) if (selImg.includes(im.id)) rs.push(im.rect); if (!rs.length) return null; const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)); return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }; }
  function eraseCands() { return opts.eraseHighlighterOnly ? strokesRef.current.filter((st) => st.tool === 'highlighter') : strokesRef.current; }
  /** Select strokes (all points inside, or any point when 부분 선택 포함), text boxes and images whose centre is inside. */
  function selectWhere(inside: (q: Point) => boolean) {
    const ids = strokesRef.current.filter((st) => { const pts = st.shape ? [st.points[0], st.points[1] ?? st.points[0]] : st.points; return opts.lassoPartial ? pts.some(inside) : pts.every(inside); }).map((st) => st.id);
    const tids = textRef.current.filter((t) => { const r = tbRect(t); return inside({ x: r.x + r.w / 2, y: r.y + r.h / 2 }); }).map((t) => t.id);
    const iids = imagesRef.current.filter((im) => inside({ x: im.rect.x + im.rect.w / 2, y: im.rect.y + im.rect.h / 2 })).map((im) => im.id);
    setSelection(ids); setSelText(tids); setSelImg(iids); onSelectionChange?.(ids);
  }
  function applyScale(f: number, ox: number, oy: number) {
    const sc = (q: Point): Point => ({ ...q, x: ox + (q.x - ox) * f, y: oy + (q.y - oy) * f });
    commitAll({
      strokes: selection.length ? strokesRef.current.map((st) => (selection.includes(st.id) ? { ...st, width: Math.max(0.3, st.width * f), points: st.points.map(sc) } : st)) : undefined,
      texts: selText.length ? textRef.current.map((t) => (selText.includes(t.id) ? { ...t, size: Math.max(6, t.size * f), rect: { ...t.rect, x: ox + (t.rect.x - ox) * f, y: oy + (t.rect.y - oy) * f, w: t.rect.w * f } } : t)) : undefined,
      images: selImg.length ? imagesRef.current.map((im) => (selImg.includes(im.id) ? { ...im, rect: { x: ox + (im.rect.x - ox) * f, y: oy + (im.rect.y - oy) * f, w: im.rect.w * f, h: im.rect.h * f } } : im)) : undefined,
    });
  }
  function copySel() { const b = combinedBounds(); if (!b) return; CLIP = { strokes: strokesRef.current.filter((st) => selection.includes(st.id)).map((st) => ({ ...st, points: st.points.map((q) => ({ ...q })) })), textBoxes: textRef.current.filter((t) => selText.includes(t.id)).map((t) => ({ ...t, rect: { ...t.rect } })), images: imagesRef.current.filter((im) => selImg.includes(im.id)).map((im) => ({ ...im, rect: { ...im.rect } })), b }; }
  function pasteClip(at?: Point) {
    if (!CLIP) return; const c = CLIP; const dx = at ? at.x - c.b.x : 18, dy = at ? at.y - c.b.y : 18; const mv = (q: Point): Point => ({ ...q, x: q.x + dx, y: q.y + dy });
    const ns = c.strokes.map((st) => ({ ...st, id: uid(), points: st.points.map(mv), createdAt: Date.now() })); const nt = c.textBoxes.map((t) => ({ ...t, id: uid(), rect: { ...t.rect, x: t.rect.x + dx, y: t.rect.y + dy }, createdAt: Date.now() })); const ni = c.images.map((im) => ({ ...im, id: uid(), rect: { ...im.rect, x: im.rect.x + dx, y: im.rect.y + dy }, createdAt: Date.now() }));
    commitAll({ strokes: ns.length ? [...strokesRef.current, ...ns] : undefined, texts: nt.length ? [...textRef.current, ...nt] : undefined, images: ni.length ? [...imagesRef.current, ...ni] : undefined });
    setPasteAt(null); setSelection(ns.map((x) => x.id)); setSelText(nt.map((x) => x.id)); setSelImg(ni.map((x) => x.id)); onSelectionChange?.(ns.map((x) => x.id));
  }
  function recolorSel() { commitAll({ strokes: selection.length ? strokesRef.current.map((st) => (selection.includes(st.id) ? { ...st, color: cfg.color } : st)) : undefined, texts: selText.length ? textRef.current.map((t) => (selText.includes(t.id) ? { ...t, color: cfg.color } : t)) : undefined }); }
  function reorderSel(front: boolean) { const sel = strokesRef.current.filter((st) => selection.includes(st.id)), rest = strokesRef.current.filter((st) => !selection.includes(st.id)); const si = imagesRef.current.filter((im) => selImg.includes(im.id)), ri = imagesRef.current.filter((im) => !selImg.includes(im.id)); commitAll({ strokes: sel.length ? (front ? [...rest, ...sel] : [...sel, ...rest]) : undefined, images: si.length ? (front ? [...ri, ...si] : [...si, ...ri]) : undefined }); }
  function selectAll() { setPasteAt(null); setSelection(strokesRef.current.map((st) => st.id)); setSelText(textRef.current.map((t) => t.id)); setSelImg(imagesRef.current.map((im) => im.id)); onSelectionChange?.(strokesRef.current.map((st) => st.id)); }
  function applyMove(dx: number, dy: number) {
    commitAll({
      strokes: selection.length ? strokesRef.current.map((st) => (selection.includes(st.id) ? { ...st, points: st.points.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })) } : st)) : undefined,
      texts: selText.length ? textRef.current.map((t) => (selText.includes(t.id) ? { ...t, rect: { ...t.rect, x: t.rect.x + dx, y: t.rect.y + dy } } : t)) : undefined,
      images: selImg.length ? imagesRef.current.map((im) => (selImg.includes(im.id) ? { ...im, rect: { ...im.rect, x: im.rect.x + dx, y: im.rect.y + dy } } : im)) : undefined,
    });
  }
  const selBoundsRaw = combinedBounds();
  const selBounds = selBoundsRaw && dragOff ? { ...selBoundsRaw, x: selBoundsRaw.x + dragOff.x, y: selBoundsRaw.y + dragOff.y } : selBoundsRaw && dragScale ? { x: dragScale.ox + (selBoundsRaw.x - dragScale.ox) * dragScale.f, y: dragScale.oy + (selBoundsRaw.y - dragScale.oy) * dragScale.f, w: selBoundsRaw.w * dragScale.f, h: selBoundsRaw.h * dragScale.f } : selBoundsRaw;
  const selTransform = dragOff ? `translate(${dragOff.x * s},${dragOff.y * s})` : dragScale ? `translate(${dragScale.ox * s},${dragScale.oy * s}) scale(${dragScale.f}) translate(${-dragScale.ox * s},${-dragScale.oy * s})` : undefined;
  const xfBox = <T extends { rect: { x: number; y: number; w: number; h: number } }>(o: T, sel: boolean): T => (!sel ? o : dragOff ? { ...o, rect: { ...o.rect, x: o.rect.x + dragOff.x, y: o.rect.y + dragOff.y } } : dragScale ? { ...o, rect: { x: dragScale.ox + (o.rect.x - dragScale.ox) * dragScale.f, y: dragScale.oy + (o.rect.y - dragScale.oy) * dragScale.f, w: o.rect.w * dragScale.f, h: o.rect.h * dragScale.f } } : o);
  const deleteAll = () => { commitAll({ strokes: selection.length ? strokesRef.current.filter((st) => !selection.includes(st.id)) : undefined, texts: selText.length ? textRef.current.filter((t) => !selText.includes(t.id)) : undefined, images: selImg.length ? imagesRef.current.filter((im) => !selImg.includes(im.id)) : undefined }); clearSel(); };
  const editingBox = textBoxes.find((t) => t.id === editing);
  // ---- finished ink elements (shared by the base and sharp layers); stroke geometry is cached per stroke object ----
  const geoCache = useRef(new WeakMap<Stroke, { s: number; d: string }>()).current;
  const dFor = (st: Stroke, kind: 'pen' | 'poly' | 'line'): string => {
    const sk = kind === 'pen' ? 1 : s; const c = geoCache.get(st); if (c && c.s === sk) return c.d;
    const d = kind === 'pen' ? penOutline(st.points, st.width, false, st.fixed) : kind === 'poly' ? polyPath(st.points, s, st.closed) : st.shape ? shapePath(st.shape, st.points[0], st.points[1] ?? st.points[0], s) : pathFromPoints(st.points, s, st.tool !== 'highlighter');
    geoCache.set(st, { s: sk, d }); return d;
  };
  const { inkBounds, boxOf } = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const boxOf = new Map<Stroke, { x0: number; y0: number; x1: number; y1: number }>();
    for (const st of strokes) { const m = (st.width || 2) * 1.25 + 3; const pts = st.points; let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
      for (let i = 0; i < pts.length; i++) { const q = pts[i]; if (q.x < a0) a0 = q.x; if (q.y < b0) b0 = q.y; if (q.x > a1) a1 = q.x; if (q.y > b1) b1 = q.y; }
      if (!isFinite(a0)) continue; const bx = { x0: a0 - m, y0: b0 - m, x1: a1 + m, y1: b1 + m }; boxOf.set(st, bx);
      if (bx.x0 < x0) x0 = bx.x0; if (bx.y0 < y0) y0 = bx.y0; if (bx.x1 > x1) x1 = bx.x1; if (bx.y1 > y1) y1 = bx.y1; }
    return { inkBounds: isFinite(x0) ? { x0, y0, x1, y1 } : null, boxOf };
  }, [strokes]);
  /** opaqueOnly: the sharp layer re-draws only opaque ink (translucent highlighter drawn twice would darken); withUi: selection chrome */
  /** base: everything, except opaque strokes lying wholly inside the sharp window (re-drawn crisp there; drawing them
   *  in both would leave a soft upscaled edge around the crisp one). sharp: opaque strokes only (translucent highlighter
   *  drawn twice would darken). Selection chrome goes on the sharp layer when there is one. */
  const inkEls = (layer: 'base' | 'sharp') => { const withUi = layer === 'sharp' || !sharpBox;
    const sb = layer === 'base' && sharpBox && !interactive ? { x0: sharpBox.x / s, y0: sharpBox.y / s, x1: (sharpBox.x + sharpBox.w) / s, y1: (sharpBox.y + sharpBox.h) / s } : null;
    const skip = (st: Stroke) => { if (layer === 'sharp') return st.opacity < 0.99; if (!sb || st.opacity < 0.99) return false; const b = boxOf.get(st); return !!b && b.x0 >= sb.x0 && b.y0 >= sb.y0 && b.x1 <= sb.x1 && b.y1 <= sb.y1; };
    return (<>
    {withUi && textSel.map((w, i) => <SvgRect key={'ts' + i} x={w.x * width} y={w.y * height} width={w.w * width} height={w.h * height} fill="rgba(47,111,237,0.22)" rx={2} />)}
    {strokes.map((st) => { if (skip(st)) return null; const sel = selection.includes(st.id); const tr = sel ? selTransform : undefined;
      if (st.poly) return <Path key={st.id} transform={tr} d={dFor(st, 'poly')} stroke={st.color} strokeWidth={st.width * s} strokeOpacity={st.opacity} fill="none" strokeLinecap={st.tool === 'highlighter' ? 'butt' : 'round'} strokeLinejoin="round" strokeDasharray={sel ? '4 3' : undefined} />;
      if (!st.shape && isInkPen(st.tool) && st.points.length > 0) return <G key={st.id} transform={tr}><Path d={dFor(st, 'pen')} scale={s} fill={st.color} fillOpacity={st.opacity} stroke={sel ? colors.primary : undefined} strokeWidth={sel ? 1.2 / s : 0} strokeDasharray={sel ? `${3 / s} ${2 / s}` : undefined} /></G>;
      return <Path key={st.id} transform={tr} d={dFor(st, 'line')} stroke={st.color} strokeWidth={st.width * s} strokeOpacity={sel ? Math.min(1, st.opacity + 0.3) : st.opacity} fill="none" strokeLinecap={st.tool === 'highlighter' ? 'butt' : 'round'} strokeLinejoin="round" strokeDasharray={sel ? '4 3' : undefined} />; })}
    {withUi && selBounds && <SvgRect x={selBounds.x * s - 6} y={selBounds.y * s - 6} width={selBounds.w * s + 12} height={selBounds.h * s + 12} stroke={colors.primary} strokeWidth={1.5} strokeDasharray="6 4" fill="rgba(47,111,237,0.04)" />}
    {withUi && selBounds && !dragOff && <Circle cx={(selBounds.x + selBounds.w) * s + 6} cy={(selBounds.y + selBounds.h) * s + 6} r={8} fill={colors.primary} stroke="#fff" strokeWidth={2.5} />}
  </>); };
  // ---- raster windows for the finished-ink SVG layers ----
  // Android's SVG view rasterises its whole frame into ONE bitmap (iOS: one backing store). A full page drawn at 2-4x
  // is 140 MB+, over Android's 100 MB draw limit -> "Canvas: trying to draw too large bitmap" crash; and every page
  // allocating a page-sized bitmap (even with no ink) made scrolling hitch. So:
  //  * pages without ink rasterise nothing;
  //  * the base layer covers only the inked area, at the page's 1x resolution (scaled up while zoomed);
  //  * while zoomed (dense), a sharp layer re-draws the visible window (+20 %) at full resolution once the view settles.
  const dpr = PixelRatio.get();
  const interactive = selection.length > 0 || textSel.length > 0 || selText.length > 0 || selImg.length > 0 || !!dragOff || !!dragScale;
  const inkArea = (() => {
    if (interactive) return { x: 0, y: 0, w: width, h: height };
    if (!inkBounds) return null;
    const x0 = Math.max(0, Math.floor(inkBounds.x0 * s)), y0 = Math.max(0, Math.floor(inkBounds.y0 * s)), x1 = Math.min(width, Math.ceil(inkBounds.x1 * s)), y1 = Math.min(height, Math.ceil(inkBounds.y1 * s));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  })();
  const baseK = (() => { // raster scale of the base layer (1 = native)
    if (!inkArea) return 1; let k = 1 / Math.max(1, density);
    const px = inkArea.w * k * dpr * inkArea.h * k * dpr; const CAP = 16e6; // ≤ 64 MB
    if (px > CAP) k *= Math.sqrt(CAP / px);
    return k;
  })();
  const sharpBox = (() => {
    if (!dense || !region || !inkArea) return null;
    const MAX_PX = 12e6; // ≤ ~48 MB
    for (const pad of [0.2, 0.08, 0]) {
      const px = region.nw * pad, py = region.nh * pad;
      const x0 = Math.max(inkArea.x, (region.nx - px) * width), y0 = Math.max(inkArea.y, (region.ny - py) * height);
      const x1 = Math.min(inkArea.x + inkArea.w, (region.nx + region.nw + px) * width), y1 = Math.min(inkArea.y + inkArea.h, (region.ny + region.nh + py) * height);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      const b = { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) };
      if (b.w * b.h * dpr * dpr <= MAX_PX || pad === 0) return b;
    }
    return null;
  })();
  const liveBox = (() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x: number, y: number, m: number) => { if (x - m < x0) x0 = x - m; if (y - m < y0) y0 = y - m; if (x + m > x1) x1 = x + m; if (y + m > y1) y1 = y + m; };
    if (live.length) { const m = Math.max(cfg.width * s * 1.6, (cfg.tool === 'eraser' || cfg.tool === 'vectorEraser') ? eraserR * s + 4 : 0) + 6; for (const q of live) add(q.x * s, q.y * s, m); }
    for (const q of laser) add(q.x * s, q.y * s, 8);
    for (const q of lasso) add(q.x * s, q.y * s, 6);
    if (marquee) { add(marquee.a.x * s, marquee.a.y * s, 4); add(marquee.b.x * s, marquee.b.y * s, 4); }
    if (!isFinite(x0)) return null;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(width, Math.ceil(x1)); y1 = Math.min(height, Math.ceil(y1));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  })();
  return (
    <View style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents={enabled ? 'auto' : 'none'}>
      <GestureDetector gesture={composed}>
        <View style={{ width, height }} collapsable={false}>
          {/* photos sit under the ink so pen notes drawn on a photo stay visible */}
          {images.map((im) => <ImageBoxView key={im.id} im={xfBox(im, selImg.includes(im.id))} s={s} enabled={enabled && (cfg.tool === 'hand' || cfg.tool === 'text')} onEditStart={pushHistory} onChange={(patch) => onImages?.(imagesRef.current.map((x) => (x.id === im.id ? { ...x, ...patch } : x)))} onDelete={() => commitAll({ images: imagesRef.current.filter((x) => x.id !== im.id) })} />)}
          {inkArea && (baseK >= 0.999
            ? <Svg pointerEvents="none" style={{ position: 'absolute', left: inkArea.x, top: inkArea.y }} width={inkArea.w} height={inkArea.h} viewBox={`${inkArea.x} ${inkArea.y} ${inkArea.w} ${inkArea.h}`}>
                <G>{inkEls('base')}</G>
              </Svg>
            : <Svg pointerEvents="none" style={{ position: 'absolute', left: inkArea.x + (inkArea.w - inkArea.w * baseK) / 2, top: inkArea.y + (inkArea.h - inkArea.h * baseK) / 2, transform: [{ scale: 1 / baseK }] }} width={inkArea.w * baseK} height={inkArea.h * baseK} viewBox={`${inkArea.x} ${inkArea.y} ${inkArea.w} ${inkArea.h}`}>
                <G>{inkEls('base')}</G>
              </Svg>)}
          {sharpBox && <Svg pointerEvents="none" style={{ position: 'absolute', left: sharpBox.x, top: sharpBox.y }} width={sharpBox.w} height={sharpBox.h} viewBox={`${sharpBox.x} ${sharpBox.y} ${sharpBox.w} ${sharpBox.h}`}>
            <G>{inkEls('sharp')}</G>
          </Svg>}
          {/* The stroke being written (and lasso / marquee / eraser cursor) lives in its own small SVG sized to what it draws,
              so writing never re-rasterises the whole page 60x per second. */}
          {liveBox && <Svg pointerEvents="none" style={{ position: 'absolute', left: liveBox.x, top: liveBox.y }} width={liveBox.w} height={liveBox.h} viewBox={`${liveBox.x} ${liveBox.y} ${liveBox.w} ${liveBox.h}`}>
            <G>
              {marquee && <SvgRect x={Math.min(marquee.a.x, marquee.b.x) * s} y={Math.min(marquee.a.y, marquee.b.y) * s} width={Math.abs(marquee.b.x - marquee.a.x) * s} height={Math.abs(marquee.b.y - marquee.a.y) * s} fill="rgba(47,111,237,0.08)" stroke={colors.primary} strokeWidth={1} strokeDasharray="4 3" />}
              {livePath && (isInkPen(cfg.tool) && !snappedLine.current ? <Path d={penOutline(live, cfg.width, true, opts.fixedWidth)} scale={s} fill={cfg.color} fillOpacity={cfg.opacity} /> : <Path d={livePath} stroke={cfg.color} strokeWidth={cfg.width * s} strokeOpacity={cfg.opacity} fill="none" strokeLinecap={cfg.tool === 'highlighter' ? 'butt' : 'round'} strokeLinejoin="round" />)}
              {laser.length > 0 && <Path d={pathFromPoints(laser, s)} stroke="#FF3B30" strokeWidth={4} strokeOpacity={0.9} fill="none" strokeLinecap="round" />}
              {lasso.length > 1 && <Path d={pathFromPoints(lasso, s, false)} stroke={colors.primary} strokeWidth={1.5} strokeDasharray="5 4" fill="rgba(14,124,123,0.08)" />}
              {(cfg.tool === 'eraser' || cfg.tool === 'vectorEraser') && live.length > 0 && <Circle cx={live[live.length - 1].x * s} cy={live[live.length - 1].y * s} r={eraserR * s} stroke="#888" strokeWidth={1} fill="rgba(0,0,0,0.05)" />}
            </G>
          </Svg>}
        </View>
      </GestureDetector>
      {textBoxes.map((tb) => { const sel = selText.includes(tb.id); const t2 = xfBox(tb, sel); return <TextBoxView key={tb.id} tb={dragScale && sel ? { ...t2, size: tb.size * dragScale.f } : t2} s={s} editing={editing === tb.id} onEdit={() => { if (editing !== tb.id) editBase.current = textRef.current; setEditing(tb.id); }} onChange={(patch) => onTextBoxes(textRef.current.map((t) => (t.id === tb.id ? { ...t, ...patch } : t)))} onCommit={() => { setEditing(null); const base = editBase.current; editBase.current = null; const cur = textRef.current.find((t) => t.id === tb.id); const before = base?.find((t) => t.id === tb.id); if (!cur?.text.trim()) { onTextBoxes(textRef.current.filter((t) => t.id !== tb.id)); if (before) pushTextBase(base!); return; } if (!before || before.text !== cur.text || before.size !== cur.size || before.font !== cur.font || before.color !== cur.color || before.rect.w !== cur.rect.w) pushTextBase(base ?? textRef.current); }} onDelete={() => { const base = editBase.current; editBase.current = null; setEditing(null); const existed = !base || base.some((t) => t.id === tb.id); if (existed) pushTextBase(base ?? textRef.current); onTextBoxes(textRef.current.filter((t) => t.id !== tb.id)); }} enabled={enabled && !['pen', 'highlighter', 'eraser', 'vectorEraser', 'shape', 'select', 'lasso'].includes(cfg.tool)} />; })}
      {selBounds && (selection.length > 0 || selText.length > 0 || selImg.length > 0) && !dragOff && !dragScale && (
        <View style={{ position: 'absolute', left: Math.max(0, Math.min(width - 330, selBounds.x * s - 6)), top: selBounds.y * s - 52 > 0 ? selBounds.y * s - 52 : Math.min(height - 44, (selBounds.y + selBounds.h) * s + 22), flexDirection: 'row', backgroundColor: 'rgba(23,32,51,0.94)', borderRadius: 12, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}>
          {([['잘라내기', () => { copySel(); deleteAll(); }], ['복사', () => { copySel(); }], ...(CLIP ? [['붙여넣기', () => pasteClip()]] : []), ['삭제', deleteAll], ...(selection.length || selText.length ? [['색 변경', recolorSel]] : []), ['앞으로', () => reorderSel(true)], ['뒤로', () => reorderSel(false)], ['해제', clearSel]] as [string, () => void][]).map(([l, f], i) => <Pressable key={l} onPress={f} style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 9, backgroundColor: pressed ? 'rgba(255,255,255,0.15)' : 'transparent', borderLeftWidth: i ? StyleSheet.hairlineWidth : 0, borderLeftColor: 'rgba(255,255,255,0.2)' })}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{l}</Text></Pressable>)}
        </View>)}
      {pasteAt && (cfg.tool === 'lasso' || cfg.tool === 'select') && (
        <View style={{ position: 'absolute', left: Math.max(0, Math.min(width - 170, pasteAt.x * s - 40)), top: Math.max(0, pasteAt.y * s - 48), flexDirection: 'row', backgroundColor: 'rgba(23,32,51,0.94)', borderRadius: 12, overflow: 'hidden' }}>
          {CLIP && <Pressable onPress={() => pasteClip(pasteAt)} style={{ paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>붙여넣기</Text></Pressable>}
          <Pressable onPress={selectAll} style={{ paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>모두 선택</Text></Pressable>
          <Pressable onPress={() => setPasteAt(null)} style={{ paddingHorizontal: 10, paddingVertical: 9 }}><Text style={{ color: 'rgba(255,255,255,0.6)', fontWeight: '700', fontSize: 12 }}>✕</Text></Pressable>
        </View>)}
      {editingBox && null}
    </View>
  );
}

function TextBoxView({ tb, s, editing, onEdit, onChange, onCommit, onDelete, enabled }: { tb: TextBox; s: number; editing: boolean; onEdit: () => void; onChange: (p: Partial<TextBox>) => void; onCommit: () => void; onDelete: () => void; enabled: boolean }) {
  const { colors } = useTheme(); const start = useRef({ x: 0, y: 0 });
  const drag = useMemo(() => Gesture.Pan().enabled(enabled && !editing).minDistance(2).runOnJS(true).onBegin(() => { start.current = { x: tb.rect.x, y: tb.rect.y }; }).onUpdate((e) => onChange({ rect: { ...tb.rect, x: start.current.x + e.translationX / s, y: start.current.y + e.translationY / s } })).onEnd(() => onCommit()), [enabled, editing, tb.rect, s]);
  const tap = useMemo(() => Gesture.Tap().enabled(enabled).numberOfTaps(2).runOnJS(true).onStart(onEdit), [enabled, onEdit]);
  return (
    <GestureDetector gesture={Gesture.Race(tap, drag)}>
      <View style={{ position: 'absolute', left: tb.rect.x * s, top: tb.rect.y * s, minWidth: tb.rect.w * s, borderWidth: editing || enabled ? 1 : 0, borderStyle: 'dashed', borderColor: editing ? colors.primary : 'rgba(0,0,0,0.15)', borderRadius: 4, padding: 4 * s, backgroundColor: editing ? 'rgba(255,255,255,0.9)' : 'transparent' }} pointerEvents={enabled ? 'auto' : 'none'}>
        {editing ? (
          <>
            <TextInput autoFocus multiline value={tb.text} onChangeText={(text) => onChange({ text })} onBlur={onCommit} style={{ color: tb.color, fontSize: tb.size * s, minWidth: 160 * s, padding: 0, fontFamily: TEXT_FONTS.find((f) => f.k === tb.font)?.family }} placeholder="텍스트 입력" />
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
              {[12, 16, 20, 28, 36].map((sz) => <Pressable key={sz} onPress={() => onChange({ size: sz })}><Text style={{ fontSize: 11, fontWeight: '700', color: tb.size === sz ? colors.primary : colors.textMuted }}>{sz}</Text></Pressable>)}{TEXT_FONTS.map((f) => <Pressable key={f.k} onPress={() => onChange({ font: f.k })}><Text style={{ fontSize: 11, fontWeight: '700', color: (tb.font ?? 'system') === f.k ? colors.primary : colors.textMuted, fontFamily: f.family }}>{f.label}</Text></Pressable>)}
              <Pressable onPress={onCommit}><Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary }}>완료</Text></Pressable>
              <Pressable onPress={onDelete}><Text style={{ fontSize: 11, fontWeight: '700', color: colors.danger }}>삭제</Text></Pressable>
            </View>
          </>
        ) : <Text style={{ color: tb.color, fontSize: tb.size * s, fontFamily: TEXT_FONTS.find((f) => f.k === tb.font)?.family }}>{tb.text}</Text>}
        {enabled && !editing && <View style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary, borderWidth: 2, borderColor: '#fff' }} />}
      </View>
    </GestureDetector>
  );
}

function ImageBoxView({ im, s, enabled, onChange, onDelete, onEditStart }: { im: ImageBox; s: number; enabled: boolean; onChange: (p: Partial<ImageBox>) => void; onDelete: () => void; /** called once when a drag/resize actually starts (records one undo step) */ onEditStart?: () => void }) {
  const { colors } = useTheme(); const start = useRef({ x: 0, y: 0, w: 0, h: 0 }); const [sel, setSel] = useState(false);
  const drag = useMemo(() => Gesture.Pan().enabled(enabled).minDistance(2).runOnJS(true).onBegin(() => { start.current = { x: im.rect.x, y: im.rect.y, w: im.rect.w, h: im.rect.h }; }).onStart(() => onEditStart?.()).onUpdate((e) => onChange({ rect: { ...im.rect, x: start.current.x + e.translationX / s, y: start.current.y + e.translationY / s } })), [enabled, im.rect, s]);
  const resize = useMemo(() => Gesture.Pan().enabled(enabled).runOnJS(true).onBegin(() => { start.current = { x: im.rect.x, y: im.rect.y, w: im.rect.w, h: im.rect.h }; }).onStart(() => onEditStart?.()).onUpdate((e) => { const ratio = start.current.h / start.current.w; const w = Math.max(30, start.current.w + e.translationX / s); onChange({ rect: { ...im.rect, w, h: w * ratio } }); }), [enabled, im.rect, s]);
  const tap = useMemo(() => Gesture.Tap().enabled(enabled).runOnJS(true).onStart(() => setSel((v) => !v)), [enabled]);
  return (
    <View style={{ position: 'absolute', left: im.rect.x * s, top: im.rect.y * s, width: im.rect.w * s, height: im.rect.h * s }} pointerEvents={enabled ? 'auto' : 'none'}>
      <GestureDetector gesture={Gesture.Race(tap, drag)}><View style={{ flex: 1, borderWidth: enabled ? 1 : 0, borderStyle: 'dashed', borderColor: sel ? colors.primary : 'rgba(0,0,0,0.15)' }} collapsable={false}><Image source={{ uri: im.uri }} style={{ width: '100%', height: '100%' }} resizeMode="stretch" /></View></GestureDetector>
      {enabled && sel && <>
        <GestureDetector gesture={resize}><View style={{ position: 'absolute', right: -10, bottom: -10, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, borderWidth: 2, borderColor: '#fff' }} collapsable={false} /></GestureDetector>
        <Pressable onPress={onDelete} style={{ position: 'absolute', right: -10, top: -10, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>×</Text></Pressable>
      </>}
    </View>
  );
}
