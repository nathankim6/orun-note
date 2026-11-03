import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TextInput, Pressable, Text, Platform } from 'react-native';
import Svg, { Path, Rect as SvgRect, G, Circle } from 'react-native-svg';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import { ImageBox, Point, Stroke, TextBox } from '@/data/types';
import { Image } from 'react-native';
import { TEXT_FONTS } from './Toolbar';
import { PdfWord } from '../../../modules/pdf-renderer';
import { wordAt, wordsBetween, cleanWord } from './words';
import { ToolConfig, pathFromPoints, shapePath, strokesHit, eraseVector, pointInPolygon, snapLine, boundsOf, dist } from './ink';
import { uid } from '@/store/persist';
import { useTheme } from '@/theme';

export type InkHandle = { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
type Props = {
  width: number; height: number; s: number; strokes: Stroke[]; textBoxes: TextBox[]; images?: ImageBox[]; onImages?: (next: ImageBox[]) => void; textFont?: string;
  /** Text layer for tap-to-define; rects normalized to the page. */ words?: PdfWord[] | null; onLookup?: (text: string, abs: { x: number; y: number }, rects: { x: number; y: number; w: number; h: number }[]) => void; cfg: ToolConfig; enabled: boolean; fingerDraw: boolean; lineSnap?: boolean;
  onStrokes: (next: Stroke[]) => void; onTextBoxes: (next: TextBox[]) => void; onTap?: (p: Point) => boolean; onLongPress?: (p: Point) => void; onDoubleTap?: (p: Point) => void; readOnly?: boolean;
  onHistory?: (h: { canUndo: boolean; canRedo: boolean }) => void; historyRef?: React.MutableRefObject<InkHandle | null>; onSelectionChange?: (ids: string[]) => void;
};

/** Timestamp of the last word lookup triggered by a double-tap (lets the zoom double-tap skip). */
export let lastLookupAt = 0;
export function InkCanvas({ width, height, s, strokes, textBoxes, images = [], onImages, textFont = 'system', words, onLookup, cfg, enabled, fingerDraw, lineSnap, onStrokes, onTextBoxes, onTap, onLongPress, onDoubleTap, readOnly, historyRef, onHistory, onSelectionChange }: Props) {
  const { colors } = useTheme();
  const [live, setLive] = useState<Point[]>([]); const [laser, setLaser] = useState<Point[]>([]); const [lasso, setLasso] = useState<Point[]>([]); const [selection, setSelection] = useState<string[]>([]); const [editing, setEditing] = useState<string | null>(null);
  // Cursor (select) tool state: selected text boxes/images, live drag offset, text-block and marquee selections.
  const [selText, setSelText] = useState<string[]>([]); const [selImg, setSelImg] = useState<string[]>([]); const [dragOff, setDragOff] = useState<{ x: number; y: number } | null>(null);
  const [textSel, setTextSel] = useState<PdfWord[]>([]); const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const selMode = useRef<'move' | 'text' | 'marquee' | null>(null); const selStart = useRef<Point>({ x: 0, y: 0 });
  const imagesRef = useRef(images); imagesRef.current = images;
  const pageW = width / s, pageH = height / s;
  const tbRect = (tb: TextBox) => { const lines = Math.max(1, (tb.text || ' ').split('\n').length); const longest = Math.max(4, ...(tb.text || '    ').split('\n').map((l) => l.length)); return { x: tb.rect.x, y: tb.rect.y, w: Math.max(tb.rect.w * 0.4, longest * tb.size * 0.6) + 8, h: lines * tb.size * 1.35 + 8 }; };
  const inRect = (p: Point, r: { x: number; y: number; w: number; h: number }, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
  const clearSel = () => { setSelection([]); setSelText([]); setSelImg([]); onSelectionChange?.([]); };
  const lookupAt = (p: Point, abs: { x: number; y: number }) => { const w = wordAt(words ?? null, p.x / pageW, p.y / pageH); if (!w || !onLookup) return false; const t = cleanWord(w.t); if (!/[A-Za-z]/.test(t)) return false; setTextSel([w]); onLookup(t, abs, [{ x: w.x * pageW, y: w.y * pageH, w: w.w * pageW, h: w.h * pageH }]); return true; };
  const liveRef = useRef<Point[]>([]); const startT = useRef(0); const strokesRef = useRef(strokes); strokesRef.current = strokes; const textRef = useRef(textBoxes); textRef.current = textBoxes;
  const undoStack = useRef<{ strokes: Stroke[]; textBoxes: TextBox[] }[]>([]); const redoStack = useRef<typeof undoStack.current>([]);
  const pushHistory = useCallback(() => { undoStack.current.push({ strokes: strokesRef.current, textBoxes: textRef.current }); if (undoStack.current.length > 60) undoStack.current.shift(); redoStack.current = []; onHistory?.({ canUndo: true, canRedo: false }); }, [onHistory]);
  const commit = useCallback((next: Stroke[]) => { pushHistory(); onStrokes(next); }, [onStrokes, pushHistory]);
  const commitText = useCallback((next: TextBox[]) => { pushHistory(); onTextBoxes(next); }, [onTextBoxes, pushHistory]);
  useEffect(() => { if (historyRef) historyRef.current = {
    undo: () => { const prev = undoStack.current.pop(); if (!prev) return; redoStack.current.push({ strokes: strokesRef.current, textBoxes: textRef.current }); onStrokes(prev.strokes); onTextBoxes(prev.textBoxes); onHistory?.({ canUndo: undoStack.current.length > 0, canRedo: true }); },
    redo: () => { const next = redoStack.current.pop(); if (!next) return; undoStack.current.push({ strokes: strokesRef.current, textBoxes: textRef.current }); onStrokes(next.strokes); onTextBoxes(next.textBoxes); onHistory?.({ canUndo: true, canRedo: redoStack.current.length > 0 }); },
    get canUndo() { return undoStack.current.length > 0; }, get canRedo() { return redoStack.current.length > 0; },
  }; });
  const toPage = (x: number, y: number): Point => ({ x: x / s, y: y / s });
  const eraserR = Math.max(8, cfg.width * 3);
  const isDrawingTool = ['pen', 'pencil', 'highlighter', 'fountain', 'brush'].includes(cfg.tool);
  // Finger input draws only when the user enabled it; stylus (Apple Pencil / S Pen) and mouse always draw.
  // Finger input never draws: touch is reserved for pinch-zoom and page scrolling. Only stylus (Apple Pencil / S Pen) draws; mouse is allowed for web/desktop.
  const allowPointer = (pointerType: any) => Platform.OS === 'web' || pointerType === PointerType.STYLUS || pointerType === PointerType.MOUSE || cfg.tool === 'select'; // the cursor tool (select/move/define) also works with a finger
  const rejected = useRef(false);
  // Dwell-to-line: while a pen stroke is in progress, holding still at the end point for 1.5s snaps the stroke to a straight line.
  const dwellTimer = useRef<any>(null); const lastMovePt = useRef<Point | null>(null); const snappedLine = useRef(false);
  const clearDwell = () => { if (dwellTimer.current) { clearTimeout(dwellTimer.current); dwellTimer.current = null; } };
  const armDwell = (p: Point) => { if (!lineSnap) return; clearDwell(); dwellTimer.current = setTimeout(() => { const pts = liveRef.current; if (pts.length < 4 || snappedLine.current) return; if (dist(pts[0], p) < 20 / s) return; snappedLine.current = true; liveRef.current = [pts[0], p]; setLive([pts[0], p]); }, 500); };

  const finish = useCallback((pts: Point[], pointerOk: boolean) => {
    const t = Date.now() - startT.current; const tool = cfg.tool;
    if (!pointerOk) return;
    const isTap = pts.length > 0 && t < 260 && dist(pts[0], pts[pts.length - 1]) < 5 / s && boundsOf(pts).w < 6 / s && boundsOf(pts).h < 6 / s;
    if (isTap) { if (tool === 'text') { const p = pts[0]; const tb: TextBox = { id: uid(), rect: { x: p.x, y: p.y, w: 180, h: 40 }, text: '', color: cfg.color, size: Math.max(8, cfg.width >= 8 ? cfg.width : 14), font: textFont, createdAt: Date.now() }; commitText([...textRef.current, tb]); setEditing(tb.id); return; } if (onTap?.(pts[0])) return; if (tool === 'lasso') { setSelection([]); onSelectionChange?.([]); return; } if (!isDrawingTool) return; }
    if (readOnly) return;
    if (isDrawingTool) { let points = pts; if (lineSnap && tool !== 'highlighter' && !snappedLine.current) { const sn = snapLine(pts); if (sn) points = sn; } if (points.length === 0) return; commit([...strokesRef.current, { id: uid(), tool, color: cfg.color, width: cfg.width, opacity: cfg.opacity, points, createdAt: Date.now() }]); return; }
    if (tool === 'shape' && pts.length >= 2) { commit([...strokesRef.current, { id: uid(), tool: 'shape', shape: cfg.shape, color: cfg.color, width: cfg.width, opacity: 1, points: [pts[0], pts[pts.length - 1]], createdAt: Date.now() }]); return; }
    if (tool === 'lasso' && pts.length > 3) { const ids = strokesRef.current.filter((st) => st.points.some((q) => pointInPolygon(q, pts))).map((st) => st.id); setSelection(ids); onSelectionChange?.(ids); return; }
    if ((tool === 'eraser' || tool === 'vectorEraser') && strokesRef.current !== strokes) { /* already committed progressively */ }
  }, [cfg, s, commit, commitText, onTap, readOnly, lineSnap, isDrawingTool, strokes, onSelectionChange]);

  const erasing = useRef(false); const eraseBefore = useRef<Stroke[] | null>(null);
  const pan = useMemo(() => Gesture.Pan().enabled(enabled).minDistance(0).maxPointers(1).runOnJS(true).manualActivation(true)
    // Decide per pointer: touch (when finger drawing is off) fails immediately so the ScrollView/pinch take over;
    // a second finger cancels any stroke in progress so pinch-zoom never leaves ink behind.
    .onTouchesDown((e, sm) => { if (cfg.tool === 'hand') { rejected.current = true; sm.fail(); return; } if (e.numberOfTouches > 1) { rejected.current = true; liveRef.current = []; setLive([]); setLaser([]); setLasso([]); sm.fail(); return; } if (!allowPointer(e.pointerType)) { rejected.current = true; sm.fail(); return; } rejected.current = false; sm.activate(); })
    .onTouchesMove((e, sm) => { if (e.numberOfTouches > 1) { rejected.current = true; liveRef.current = []; setLive([]); sm.fail(); } })
    .onBegin((e) => { startT.current = Date.now(); snappedLine.current = false; clearDwell(); const p = toPage(e.x, e.y); liveRef.current = [p]; lastMovePt.current = p;
      if (cfg.tool === 'select') { selStart.current = p; setTextSel([]);
        const hasSel = selection.length || selText.length || selImg.length; const sb = combinedBounds();
        if (hasSel && sb && inRect(p, sb, 10 / s)) { selMode.current = 'move'; return; }
        const img = [...imagesRef.current].reverse().find((im) => inRect(p, im.rect)); if (img) { setSelection([]); setSelText([]); setSelImg([img.id]); selMode.current = 'move'; return; }
        const tb = [...textRef.current].reverse().find((t) => inRect(p, tbRect(t), 4 / s)); if (tb) { setSelection([]); setSelImg([]); setSelText([tb.id]); selMode.current = 'move'; return; }
        const hit = strokesHit(strokesRef.current, p, 10 / s); if (hit.length) { setSelText([]); setSelImg([]); setSelection([hit[hit.length - 1]]); selMode.current = 'move'; return; }
        clearSel(); selMode.current = words?.length && wordAt(words, p.x / pageW, p.y / pageH) ? 'text' : 'marquee'; if (selMode.current === 'marquee') setMarquee({ a: p, b: p }); return; } if (cfg.tool === 'eraser' || cfg.tool === 'vectorEraser') { erasing.current = true; eraseBefore.current = strokesRef.current; } if (cfg.tool === 'laser') setLaser([p]); else if (cfg.tool === 'lasso') setLasso([p]); else setLive([p]); })
    .onUpdate((e) => { const p = toPage(e.x, e.y); const pointerOk = allowPointer(e.pointerType); if (!pointerOk) return; liveRef.current.push(p);
      if (cfg.tool === 'select') { const a = selStart.current; if (selMode.current === 'move') setDragOff({ x: p.x - a.x, y: p.y - a.y }); else if (selMode.current === 'text') setTextSel(wordsBetween(words ?? null, { x: a.x / pageW, y: a.y / pageH }, { x: p.x / pageW, y: p.y / pageH })); else setMarquee({ a, b: p }); return; }
      if (cfg.tool === 'eraser') { const prev = liveRef.current.length > 1 ? liveRef.current[liveRef.current.length - 2] : undefined; const hit = strokesHit(strokesRef.current, p, eraserR, prev); if (hit.length) onStrokes(strokesRef.current.filter((st) => !hit.includes(st.id))); setLive([p]); return; }
      if (cfg.tool === 'vectorEraser') { const prev = liveRef.current.length > 1 ? liveRef.current[liveRef.current.length - 2] : undefined; let next = strokesRef.current; const n = prev ? Math.ceil(dist(prev, p) / Math.max(2, eraserR / 2)) : 1; for (let i = 1; i <= n; i++) { const q = prev ? { x: prev.x + ((p.x - prev.x) * i) / n, y: prev.y + ((p.y - prev.y) * i) / n } : p; next = eraseVector(next, q, eraserR, uid); } if (next !== strokesRef.current) onStrokes(next); setLive([p]); return; }
      if (cfg.tool === 'laser') { setLaser((l) => [...l.slice(-25), p]); return; } if (cfg.tool === 'lasso') { setLasso((l) => [...l, p]); return; }
      if (cfg.tool === 'shape') { setLive([liveRef.current[0], p]); return; }
      if (isDrawingTool && cfg.tool !== 'highlighter') {
        if (snappedLine.current) { liveRef.current = [liveRef.current[0], p]; setLive([liveRef.current[0], p]); return; }
        if (!lastMovePt.current || dist(lastMovePt.current, p) > 3 / s) { lastMovePt.current = p; armDwell(p); }
      }
      setLive([...liveRef.current]); })
    .onEnd((e) => { clearDwell(); if (rejected.current) { liveRef.current = []; setLive([]); return; } const pts = liveRef.current; const pointerOk = allowPointer(e.pointerType);
      if (cfg.tool === 'select') { const end = toPage(e.x, e.y); const a = selStart.current; const moved = dist(a, end) > 4 / s; const abs = { x: (e as any).absoluteX ?? e.x, y: (e as any).absoluteY ?? e.y };
        if (selMode.current === 'move') { if (moved) applyMove(end.x - a.x, end.y - a.y); else if (!lookupAt(end, abs)) { /* keep selection */ } setDragOff(null); }
        else if (selMode.current === 'text') { const ws = moved ? wordsBetween(words ?? null, { x: a.x / pageW, y: a.y / pageH }, { x: end.x / pageW, y: end.y / pageH }) : []; if (!moved) lookupAt(end, abs); else if (ws.length && onLookup) { setTextSel(ws); onLookup(ws.map((w) => w.t).join(' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[^A-Za-z]+|[^A-Za-z.!?]+$/g, ''), abs, ws.map((w) => ({ x: w.x * pageW, y: w.y * pageH, w: w.w * pageW, h: w.h * pageH }))); } }
        else { const m = marquee; setMarquee(null); if (m && moved) { const r = { x: Math.min(m.a.x, end.x), y: Math.min(m.a.y, end.y), w: Math.abs(end.x - m.a.x), h: Math.abs(end.y - m.a.y) }; const ids = strokesRef.current.filter((st) => st.points.some((q) => inRect(q, r))).map((st) => st.id); const tids = textRef.current.filter((t) => inRect({ x: t.rect.x, y: t.rect.y }, r)).map((t) => t.id); const iids = imagesRef.current.filter((im) => inRect({ x: im.rect.x + im.rect.w / 2, y: im.rect.y + im.rect.h / 2 }, r)).map((im) => im.id); setSelection(ids); setSelText(tids); setSelImg(iids); onSelectionChange?.(ids); } else lookupAt(end, abs); }
        selMode.current = null; liveRef.current = []; setLive([]); return; } if (erasing.current) { erasing.current = false; if (eraseBefore.current && eraseBefore.current !== strokesRef.current) { undoStack.current.push({ strokes: eraseBefore.current, textBoxes: textRef.current }); redoStack.current = []; onHistory?.({ canUndo: true, canRedo: false }); } eraseBefore.current = null; const isTap = pts.length > 0 && Date.now() - startT.current < 260 && dist(pts[0], pts[pts.length - 1]) < 5 / s; if (isTap) { const hit = strokesHit(strokesRef.current, pts[0], eraserR); if (hit.length) commit(strokesRef.current.filter((st) => !hit.includes(st.id))); else onTap?.(pts[0]); } }
      else if (cfg.tool === 'lasso') { finish(lasso.length ? [...lasso, toPage(e.x, e.y)] : pts, pointerOk); setLasso([]); }
      else finish(pts, pointerOk);
      setLive([]); liveRef.current = []; if (cfg.tool === 'laser') setTimeout(() => setLaser([]), 600); })
    .onFinalize(() => { clearDwell(); setLive([]); if (rejected.current) { liveRef.current = []; erasing.current = false; eraseBefore.current = null; } }), [enabled, cfg, s, finish, eraserR, onStrokes, commit, lasso, onTap, fingerDraw, lineSnap, selection, selText, selImg, words, onLookup, marquee, width, height]);
  const longPress = useMemo(() => Gesture.LongPress().enabled(enabled && !!onLongPress).minDuration(450).runOnJS(true).onStart((e) => onLongPress?.(toPage(e.x, e.y))), [enabled, onLongPress, s]);
  const doubleTap = useMemo(() => Gesture.Tap().enabled(enabled && (!!onDoubleTap || !!words?.length)).numberOfTaps(2).maxDelay(280).runOnJS(true).onStart((e) => { const p = toPage(e.x, e.y); if (lookupAt(p, { x: e.absoluteX, y: e.absoluteY })) { lastLookupAt = Date.now(); return; } onDoubleTap?.(p); }), [enabled, onDoubleTap, s, words, onLookup, width, height]);
  const composed = useMemo(() => Gesture.Simultaneous(pan, longPress, doubleTap), [pan, longPress, doubleTap]);

  const livePath = useMemo(() => { if (live.length === 0) return null; if (cfg.tool === 'shape' && live.length >= 2) return shapePath(cfg.shape, live[0], live[1], s); if (cfg.tool === 'eraser' || cfg.tool === 'vectorEraser') return null; return pathFromPoints(live, s); }, [live, cfg, s]);
  const deleteSelection = () => { commit(strokesRef.current.filter((st) => !selection.includes(st.id))); setSelection([]); onSelectionChange?.([]); };
  const duplicateSelection = () => { const dup = strokesRef.current.filter((st) => selection.includes(st.id)).map((st) => ({ ...st, id: uid(), points: st.points.map((p) => ({ ...p, x: p.x + 20, y: p.y + 20 })), createdAt: Date.now() })); commit([...strokesRef.current, ...dup]); setSelection(dup.map((d) => d.id)); };
  function combinedBounds() { const rs: { x: number; y: number; w: number; h: number }[] = []; const sp = strokesRef.current.filter((st) => selection.includes(st.id)).flatMap((st) => st.points); if (sp.length) rs.push(boundsOf(sp)); for (const t of textRef.current) if (selText.includes(t.id)) rs.push(tbRect(t)); for (const im of imagesRef.current) if (selImg.includes(im.id)) rs.push(im.rect); if (!rs.length) return null; const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)); return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }; }
  function applyMove(dx: number, dy: number) {
    if (selection.length) commit(strokesRef.current.map((st) => (selection.includes(st.id) ? { ...st, points: st.points.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })) } : st)));
    if (selText.length) commitText(textRef.current.map((t) => (selText.includes(t.id) ? { ...t, rect: { ...t.rect, x: t.rect.x + dx, y: t.rect.y + dy } } : t)));
    if (selImg.length) onImages?.(imagesRef.current.map((im) => (selImg.includes(im.id) ? { ...im, rect: { ...im.rect, x: im.rect.x + dx, y: im.rect.y + dy } } : im)));
  }
  const selBoundsRaw = combinedBounds(); const selBounds = selBoundsRaw && dragOff ? { ...selBoundsRaw, x: selBoundsRaw.x + dragOff.x, y: selBoundsRaw.y + dragOff.y } : selBoundsRaw;
  const deleteAll = () => { if (selection.length) commit(strokesRef.current.filter((st) => !selection.includes(st.id))); if (selText.length) commitText(textRef.current.filter((t) => !selText.includes(t.id))); if (selImg.length) onImages?.(imagesRef.current.filter((im) => !selImg.includes(im.id))); clearSel(); };
  const editingBox = textBoxes.find((t) => t.id === editing);
  return (
    <View style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents={enabled ? 'auto' : 'none'}>
      <GestureDetector gesture={composed}>
        <View style={{ width, height }} collapsable={false}>
          <Svg width={width} height={height} pointerEvents="none">
            <G>
              {textSel.map((w, i) => <SvgRect key={'ts' + i} x={w.x * width} y={w.y * height} width={w.w * width} height={w.h * height} fill="rgba(47,111,237,0.22)" rx={2} />)}
              {marquee && <SvgRect x={Math.min(marquee.a.x, marquee.b.x) * s} y={Math.min(marquee.a.y, marquee.b.y) * s} width={Math.abs(marquee.b.x - marquee.a.x) * s} height={Math.abs(marquee.b.y - marquee.a.y) * s} fill="rgba(47,111,237,0.08)" stroke={colors.primary} strokeWidth={1} strokeDasharray="4 3" />}
              {strokes.map((st) => <Path key={st.id} transform={dragOff && selection.includes(st.id) ? `translate(${dragOff.x * s},${dragOff.y * s})` : undefined} d={st.shape ? shapePath(st.shape, st.points[0], st.points[1] ?? st.points[0], s) : pathFromPoints(st.points, s, st.tool !== 'highlighter')} stroke={st.color} strokeWidth={st.width * s} strokeOpacity={selection.includes(st.id) ? Math.min(1, st.opacity + 0.3) : st.opacity} fill="none" strokeLinecap={st.tool === 'highlighter' ? 'butt' : 'round'} strokeLinejoin="round" strokeDasharray={selection.includes(st.id) ? '4 3' : undefined} />)}
              {livePath && <Path d={livePath} stroke={cfg.color} strokeWidth={cfg.width * s} strokeOpacity={cfg.opacity} fill="none" strokeLinecap={cfg.tool === 'highlighter' ? 'butt' : 'round'} strokeLinejoin="round" />}
              {laser.length > 0 && <Path d={pathFromPoints(laser, s)} stroke="#FF3B30" strokeWidth={4} strokeOpacity={0.9} fill="none" strokeLinecap="round" />}
              {lasso.length > 1 && <Path d={pathFromPoints(lasso, s, false)} stroke={colors.primary} strokeWidth={1.5} strokeDasharray="5 4" fill="rgba(14,124,123,0.08)" />}
              {(cfg.tool === 'eraser' || cfg.tool === 'vectorEraser') && live.length > 0 && <Circle cx={live[live.length - 1].x * s} cy={live[live.length - 1].y * s} r={eraserR * s} stroke="#888" strokeWidth={1} fill="rgba(0,0,0,0.05)" />}
              {selBounds && <SvgRect x={(selBounds.x - 6) * s} y={(selBounds.y - 6) * s} width={(selBounds.w + 12) * s} height={(selBounds.h + 12) * s} stroke={colors.primary} strokeWidth={1.5} strokeDasharray="6 4" fill="none" />}
            </G>
          </Svg>
        </View>
      </GestureDetector>
      {images.map((im) => <ImageBoxView key={im.id} im={dragOff && selImg.includes(im.id) ? { ...im, rect: { ...im.rect, x: im.rect.x + dragOff.x, y: im.rect.y + dragOff.y } } : im} s={s} enabled={enabled && (cfg.tool === 'hand' || cfg.tool === 'text')} onChange={(patch) => onImages?.(images.map((x) => (x.id === im.id ? { ...x, ...patch } : x)))} onDelete={() => onImages?.(images.filter((x) => x.id !== im.id))} />)}
      {textBoxes.map((tb) => <TextBoxView key={tb.id} tb={dragOff && selText.includes(tb.id) ? { ...tb, rect: { ...tb.rect, x: tb.rect.x + dragOff.x, y: tb.rect.y + dragOff.y } } : tb} s={s} editing={editing === tb.id} onEdit={() => setEditing(tb.id)} onChange={(patch) => onTextBoxes(textRef.current.map((t) => (t.id === tb.id ? { ...t, ...patch } : t)))} onCommit={() => { setEditing(null); if (!textRef.current.find((t) => t.id === tb.id)?.text.trim()) onTextBoxes(textRef.current.filter((t) => t.id !== tb.id)); else pushHistory(); }} onDelete={() => commitText(textRef.current.filter((t) => t.id !== tb.id))} enabled={enabled && !['pen', 'highlighter', 'eraser', 'vectorEraser', 'shape', 'select'].includes(cfg.tool)} />)}
      {selBounds && (selection.length > 0 || selText.length > 0 || selImg.length > 0) && !dragOff && (
        <View style={{ position: 'absolute', left: Math.max(0, Math.min(width - 150, selBounds.x * s)), top: Math.max(0, (selBounds.y - 44) * s), flexDirection: 'row', backgroundColor: colors.text, borderRadius: 10, overflow: 'hidden' }}>
          {[...(selection.length ? [['복제', duplicateSelection]] : []), ['삭제', deleteAll], ['해제', clearSel]].map(([l, f]) => <Pressable key={l as string} onPress={f as any} style={{ paddingHorizontal: 12, paddingVertical: 8 }}><Text style={{ color: colors.bg, fontWeight: '700', fontSize: 12 }}>{l as string}</Text></Pressable>)}
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

function ImageBoxView({ im, s, enabled, onChange, onDelete }: { im: ImageBox; s: number; enabled: boolean; onChange: (p: Partial<ImageBox>) => void; onDelete: () => void }) {
  const { colors } = useTheme(); const start = useRef({ x: 0, y: 0, w: 0, h: 0 }); const [sel, setSel] = useState(false);
  const drag = useMemo(() => Gesture.Pan().enabled(enabled).minDistance(2).runOnJS(true).onBegin(() => { start.current = { x: im.rect.x, y: im.rect.y, w: im.rect.w, h: im.rect.h }; }).onUpdate((e) => onChange({ rect: { ...im.rect, x: start.current.x + e.translationX / s, y: start.current.y + e.translationY / s } })), [enabled, im.rect, s]);
  const resize = useMemo(() => Gesture.Pan().enabled(enabled).runOnJS(true).onBegin(() => { start.current = { x: im.rect.x, y: im.rect.y, w: im.rect.w, h: im.rect.h }; }).onUpdate((e) => { const ratio = start.current.h / start.current.w; const w = Math.max(30, start.current.w + e.translationX / s); onChange({ rect: { ...im.rect, w, h: w * ratio } }); }), [enabled, im.rect, s]);
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
