import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDecay, runOnJS, cancelAnimation, useAnimatedReaction, Easing } from 'react-native-reanimated';
import { lastLookupAt } from './InkCanvas';
import { penSession, PALM_WINDOW_MS } from './penSession';

/**
 * Samsung Notes–style document surface.
 * One continuous canvas holds every page; a single transform (zoom + offset) is driven on the UI thread:
 *  - one finger drags with momentum (stylus never pans: it writes),
 *  - two fingers pinch around the exact midpoint of the fingers and pan at the same time,
 *  - double-tap toggles fit-width ↔ 250 % around the tapped point,
 *  - soft rubber-band at the edges and zoom limits, smooth settle,
 *  - pages outside the viewport are not rendered; visible pages re-render sharper after zooming.
 * Web: wheel scrolls, Ctrl/⌘+wheel (and trackpad pinch) zooms at the cursor, PageUp/PageDown/arrows turn pages.
 */
export type DocMode = 'vertical' | 'horizontal' | 'twoPage';
export type PageBox = { x: number; y: number; w: number; h: number; s: number }; // content coords at zoom 1; s = PDF pt → px at zoom 1
export type DocHandle = { goto: (i: number, animated?: boolean) => void; zoomTo: (z: number, fx?: number, fy?: number) => void; zoomBy: (f: number) => void; fit: () => void; fitPage: () => void; getZoom: () => number };
type Props = {
  width: number; height: number; pages: { width: number; height: number }[]; mode: DocMode; startOdd?: boolean; initialPage: number;
  renderPage: (i: number, box: PageBox, rs: number) => React.ReactNode;
  onPageChange?: (i: number) => void; onZoomSettled?: (z: number) => void; mousePans?: boolean; doubleTapZoom?: boolean; dark?: boolean;
  /** 캔버스 고정: no zoom / pan while locked */ locked?: boolean;
  /** notebooks: keep pulling past the last page to add one (Samsung Notes) */ onPullAddPage?: () => void;
};

const M = 14, GAP = 16, MAX_Z = 5;
type Layout = { boxes: PageBox[]; cw: number; ch: number; cells: number; cellOf: number[] };
function computeLayout(pages: Props['pages'], W: number, H: number, mode: DocMode, startOdd: boolean): Layout {
  const boxes: PageBox[] = []; const cellOf: number[] = [];
  if (!pages.length || W <= 0 || H <= 0) return { boxes, cw: W, ch: H, cells: 0, cellOf };
  if (mode === 'vertical') {
    const maxW = Math.max(...pages.map((p) => p.width)); const s = (W - 2 * M) / maxW; let y = M;
    pages.forEach((p, i) => { const w = p.width * s, h = p.height * s; boxes.push({ x: (W - w) / 2, y, w, h, s }); cellOf.push(i); y += h + GAP; });
    return { boxes, cw: W, ch: y - GAP + M, cells: pages.length, cellOf };
  }
  // horizontal / two-page: one "spread" per viewport-wide cell, fitted inside the viewport
  const spreads: number[][] = [];
  if (mode === 'horizontal') pages.forEach((_, i) => spreads.push([i]));
  else { let i = 0; if (!startOdd && pages.length) { spreads.push([0]); i = 1; } for (; i < pages.length; i += 2) spreads.push(i + 1 < pages.length ? [i, i + 1] : [i]); }
  spreads.forEach((sp, c) => {
    const sumW = sp.reduce((a, i) => a + pages[i].width, 0); const maxH = Math.max(...sp.map((i) => pages[i].height));
    const s = Math.min((W - 2 * M - GAP * (sp.length - 1)) / sumW, (H - 2 * M) / maxH);
    const total = sumW * s + GAP * (sp.length - 1); let x = c * W + (W - total) / 2;
    sp.forEach((i) => { const w = pages[i].width * s, h = pages[i].height * s; boxes[i] = { x, y: (H - h) / 2, w, h, s }; cellOf[i] = c; x += w + GAP; });
  });
  return { boxes, cw: spreads.length * W, ch: H, cells: spreads.length, cellOf };
}

/** Pixel density for page content: re-render sharper after zooming in (kept low while zoomed out). */
const densityFor = (z: number) => (z <= 1.2 ? 1 : z <= 2.2 ? 2 : z <= 3.4 ? 3 : 4);

export const DocumentView = forwardRef<DocHandle, Props>(function DocumentView({ width: W, height: H, pages, mode, startOdd = true, initialPage, renderPage, onPageChange, onZoomSettled, mousePans = false, doubleTapZoom = true, dark, locked = false, onPullAddPage }, ref) {
  const L = useMemo(() => computeLayout(pages, W, H, mode, startOdd), [pages, W, H, mode, startOdd]);
  const minZ = mode === 'vertical' ? 0.5 : 1;
  const z = useSharedValue(1); const tx = useSharedValue(0); const ty = useSharedValue(0);
  const sZ = useSharedValue(1), sTx = useSharedValue(0), sTy = useSharedValue(0), sFx = useSharedValue(0), sFy = useSharedValue(0);
  const pinching = useSharedValue(false); const lastKey = useSharedValue('');
  const [range, setRange] = useState<[number, number]>([0, 0]); const [rs, setRs] = useState(1); const [cur, setCur] = useState(initialPage);
  const curRef = useRef(initialPage); const badge = useRef<{ show: (t: string | null) => void } | null>(null);
  const pullStage = useSharedValue(0); const [pullHint, setPullHint] = useState(0); const canPull = !!onPullAddPage && mode === 'vertical';
  const pullJS = useCallback((st: number) => setPullHint(st), []); const addPageJS = useCallback(() => onPullAddPage?.(), [onPullAddPage]);

  // ---------- geometry helpers (worklets) ----------
  const bounds = useCallback((zz: number) => {
    'worklet';
    const cw = L.cw * zz, ch = L.ch * zz;
    const minX = cw > W ? W - cw : (W - cw) / 2, maxX = cw > W ? 0 : (W - cw) / 2;
    const minY = ch > H ? H - ch : (H - ch) / 2, maxY = ch > H ? 0 : (H - ch) / 2;
    return { minX, maxX, minY, maxY };
  }, [L, W, H]);
  const clamp = (v: number, a: number, b: number) => { 'worklet'; return Math.min(b, Math.max(a, v)); };
  const rubber = (v: number, a: number, b: number) => { 'worklet'; return v < a ? a - (a - v) * 0.35 : v > b ? b + (v - b) * 0.35 : v; };

  // ---------- JS-side callbacks ----------
  const settledJS = useCallback((zz: number) => { setRs(densityFor(zz)); onZoomSettled?.(zz); badge.current?.show(null); }, [onZoomSettled]);
  const badgeJS = useCallback((zz: number) => badge.current?.show(`${Math.round(zz * 100)}%`), []);
  const rangeJS = useCallback((a: number, b: number, c: number) => { setRange((r) => (r[0] === a && r[1] === b ? r : [a, b])); if (c !== curRef.current) { curRef.current = c; setCur(c); onPageChange?.(c); } }, [onPageChange]);

  // visible pages + current page, recomputed on the UI thread whenever the transform moves
  const boxes = L.boxes;
  useAnimatedReaction(() => ({ z: z.value, x: tx.value, y: ty.value }), (v) => {
    if (!boxes.length) return;
    const left = -v.x / v.z, top = -v.y / v.z, right = left + W / v.z, bottom = top + H / v.z; const padX = (W / v.z) * 0.6, padY = (H / v.z) * 0.6;
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    let a = -1, b = -1, c = 0, best = 1e12;
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i];
      if (bx.x + bx.w >= left - padX && bx.x <= right + padX && bx.y + bx.h >= top - padY && bx.y <= bottom + padY) { if (a < 0) a = i; b = i; }
      const dx = cx < bx.x ? bx.x - cx : cx > bx.x + bx.w ? cx - (bx.x + bx.w) : 0; const dy = cy < bx.y ? bx.y - cy : cy > bx.y + bx.h ? cy - (bx.y + bx.h) : 0; const d = dx * dx + dy * dy;
      if (d < best) { best = d; c = i; }
    }
    if (a < 0) { a = c; b = c; }
    const key = `${a}:${b}:${c}`; if (key !== lastKey.value) { lastKey.value = key; runOnJS(rangeJS)(a, b, c); }
  }, [boxes, W, H, rangeJS]);

  // ---------- imperative positioning ----------
  const place = useCallback((i: number, zz: number, animated: boolean) => {
    const bx = L.boxes[Math.max(0, Math.min(L.boxes.length - 1, i))]; if (!bx) return;
    const b = bounds(zz); let nx: number, ny: number;
    if (mode === 'vertical') { nx = clamp(tx.value, b.minX, b.maxX); ny = clamp(M - bx.y * zz, b.minY, b.maxY); if (zz === 1) nx = (b.minX + b.maxX) / 2; }
    else { const cell = L.cellOf[i] ?? 0; nx = clamp(-cell * W * zz, b.minX, b.maxX); ny = (b.minY + b.maxY) / 2; }
    const cfg = { duration: 260, easing: Easing.out(Easing.cubic) };
    if (animated) { z.value = withTiming(zz, cfg); tx.value = withTiming(nx, cfg); ty.value = withTiming(ny, cfg); } else { z.value = zz; tx.value = nx; ty.value = ny; }
  }, [L, bounds, mode, W]);
  const zoomAround = useCallback((target: number, fx: number, fy: number, animated: boolean) => {
    'worklet';
    const z1 = clamp(target, minZ, MAX_Z); const z0 = z.value;
    const b = bounds(z1); const nx = clamp(fx - (fx - tx.value) * (z1 / z0), b.minX, b.maxX); const ny = clamp(fy - (fy - ty.value) * (z1 / z0), b.minY, b.maxY);
    const cfg = { duration: 240, easing: Easing.out(Easing.cubic) };
    if (animated) { z.value = withTiming(z1, cfg); tx.value = withTiming(nx, cfg); ty.value = withTiming(ny, cfg); } else { z.value = z1; tx.value = nx; ty.value = ny; }
    return z1;
  }, [bounds, minZ]);
  const zoomJS = useCallback((target: number, fx: number, fy: number) => { const z1 = zoomAround(target, fx, fy, true); settledJS(z1); }, [zoomAround, settledJS]);

  // initial placement and re-placement when the viewport or layout mode changes (keep the current page)
  const placedFor = useRef(''); const placedLen = useRef(0);
  useEffect(() => {
    const key = `${W}x${H}:${mode}`; if (!L.boxes.length) return;
    if (placedFor.current === key) { if (pages.length > placedLen.current && placedLen.current > 0) { const last = pages.length - 1; placedLen.current = pages.length; place(last, mode === 'vertical' ? z.value : 1, true); } placedLen.current = pages.length; return; }
    const first = !placedFor.current; placedFor.current = key; placedLen.current = pages.length; place(first ? initialPage : curRef.current, 1, false); setRs(1); onZoomSettled?.(1);
  }, [L, W, H, mode, pages.length]);

  useImperativeHandle(ref, () => ({
    goto: (i, animated = true) => { const zz = mode === 'vertical' ? z.value : 1; place(i, zz, animated); if (mode !== 'vertical' && z.value !== 1) { setRs(1); onZoomSettled?.(1); } },
    zoomTo: (zz, fx = W / 2, fy = H / 2) => zoomJS(zz, fx, fy),
    zoomBy: (f) => zoomJS(z.value * f, W / 2, H / 2),
    fit: () => zoomJS(1, W / 2, H / 2),
    fitPage: () => { const bx = L.boxes[curRef.current]; if (!bx) return; const zz = Math.min(1, (H - 2 * M) / bx.h, (W - 2 * M) / bx.w); const b = bounds(zz); const cfg = { duration: 260, easing: Easing.out(Easing.cubic) }; z.value = withTiming(zz, cfg); tx.value = withTiming(Math.min(b.maxX, Math.max(b.minX, W / 2 - (bx.x + bx.w / 2) * zz)), cfg); ty.value = withTiming(Math.min(b.maxY, Math.max(b.minY, H / 2 - (bx.y + bx.h / 2) * zz)), cfg); settledJS(zz); },
    getZoom: () => z.value,
  }), [place, zoomJS, mode, W, H, L, bounds, settledJS]);

  // ---------- gestures ----------
  /** Palm rejection: true while the pen hovers / writes / was just lifted — finger & palm contacts are then ignored. */
  const penBusy = () => { 'worklet'; const ps = penSession.value; const now = Date.now(); return (ps.writing && ps.byPen) || now - ps.at < PALM_WINDOW_MS || now - ps.hoverAt < PALM_WINDOW_MS; };
  /** The ink layer owns a stroke right now (pen or mouse): the page must not move under it. */
  const inkOwns = () => { 'worklet'; return penSession.value.writing; };
  const snapPaged = (vx: number) => {
    'worklet';
    const cell = clamp(Math.round((-tx.value - vx * 0.18) / W), 0, Math.max(0, L.cells - 1));
    tx.value = withTiming(-cell * W, { duration: 260, easing: Easing.out(Easing.cubic) });
    const b = bounds(1); ty.value = withTiming((b.minY + b.maxY) / 2, { duration: 200 });
  };
  const thumbActive = useSharedValue(0); const thumbGesture = useRef<any>(null);
  const doubleTapJS = useCallback((x: number, y: number) => { setTimeout(() => { if (Date.now() - lastLookupAt < 600) return; zoomJS(z.value < 1.6 ? 2.5 : 1, x, y); }, 70); }, [zoomJS]);
  const gesture = useMemo(() => {
    const pan = Gesture.Pan().minDistance(4).maxPointers(1)
      .onTouchesDown((e, st) => { const pt = e.pointerType; if (pt === PointerType.STYLUS || (pt === PointerType.MOUSE && !mousePans) || pinching.value || inkOwns() || (pt === PointerType.TOUCH && penBusy())) st.fail(); })
      .onTouchesMove((_e, st) => { if (inkOwns()) st.fail(); })
      .onStart(() => { cancelAnimation(tx); cancelAnimation(ty); sTx.value = tx.value; sTy.value = ty.value; })
      .onUpdate((e) => {
        if (pinching.value || inkOwns()) return; const b = bounds(z.value);
        tx.value = rubber(sTx.value + e.translationX, b.minX, b.maxX);
        const rawY = sTy.value + e.translationY; ty.value = rubber(rawY, b.minY, b.maxY);
        if (canPull) { const over = b.minY - rawY; const st = over > 150 ? 2 : over > 40 ? 1 : 0; if (st !== pullStage.value) { pullStage.value = st; runOnJS(pullJS)(st); } }
      })
      .onEnd((e) => {
        if (pinching.value) return; const b = bounds(z.value);
        if (canPull && pullStage.value === 2) { pullStage.value = 0; runOnJS(pullJS)(0); runOnJS(addPageJS)(); ty.value = withTiming(b.minY, { duration: 220 }); return; }
        if (pullStage.value) { pullStage.value = 0; runOnJS(pullJS)(0); }
        if (mode !== 'vertical' && z.value <= 1.01) { snapPaged(e.velocityX); return; }
        tx.value = withDecay({ velocity: e.velocityX, deceleration: 0.997, clamp: [b.minX, b.maxX], rubberBandEffect: true, rubberBandFactor: 0.7 });
        ty.value = withDecay({ velocity: e.velocityY, deceleration: 0.997, clamp: [b.minY, b.maxY], rubberBandEffect: true, rubberBandFactor: 0.7 });
      });
    const pinch = Gesture.Pinch()
      .onTouchesDown((e, st) => { if (e.pointerType === PointerType.STYLUS || penBusy() || inkOwns()) st.fail(); })
      .onStart((e) => { pinching.value = true; cancelAnimation(tx); cancelAnimation(ty); cancelAnimation(z); sZ.value = z.value; sTx.value = tx.value; sTy.value = ty.value; sFx.value = e.focalX; sFy.value = e.focalY; })
      .onUpdate((e) => {
        if (inkOwns()) return;
        let nz = sZ.value * e.scale;
        if (nz > MAX_Z) nz = MAX_Z + (nz - MAX_Z) * 0.25; if (nz < minZ) nz = minZ - (minZ - nz) * 0.25;
        // the content point that was under the fingers stays under the fingers (and follows them when they move)
        tx.value = e.focalX - (sFx.value - sTx.value) * (nz / sZ.value);
        ty.value = e.focalY - (sFy.value - sTy.value) * (nz / sZ.value);
        z.value = nz; runOnJS(badgeJS)(nz);
      })
      .onEnd((e) => {
        const target = clamp(z.value, minZ, MAX_Z);
        if (mode !== 'vertical' && target <= 1.01) { z.value = withTiming(1, { duration: 200 }); snapPaged(0); runOnJS(settledJS)(1); }
        else { const z1 = zoomAround(target, e.focalX, e.focalY, true); runOnJS(settledJS)(z1); }
      })
      .onFinalize(() => { pinching.value = false; });
    const dbl = Gesture.Tap().numberOfTaps(2).maxDelay(300).maxDistance(30).enabled(doubleTapZoom)
      .onTouchesDown((e, st) => { if (e.pointerType === PointerType.STYLUS || e.numberOfTouches > 1 || penBusy() || inkOwns()) st.fail(); })
      .onEnd((e) => { runOnJS(doubleTapJS)(e.x, e.y); });
    // pen hovering above the screen (S Pen / Apple Pencil hover) arms palm rejection before the tip touches down
    const hover = Gesture.Hover().onBegin((e) => { if (e.pointerType === PointerType.STYLUS) penSession.value = { ...penSession.value, hoverAt: Date.now() }; }).onUpdate((e) => { if (e.pointerType === PointerType.STYLUS) penSession.value = { ...penSession.value, hoverAt: Date.now() }; });
    // draggable scrollbar thumb (vertical mode) — fast scroll through long PDFs
    const thumb = Gesture.Pan().minDistance(0).enabled(mode === 'vertical' && !locked)
      .onStart(() => { cancelAnimation(ty); sTy.value = ty.value; thumbActive.value = 1; })
      .onUpdate((e) => { const ch = L.ch * z.value; if (ch <= H) return; const th = Math.max(40, (H * H) / ch); const track = H - th; const b = bounds(z.value); const frac0 = -sTy.value / (ch - H); const frac = Math.min(1, Math.max(0, frac0 + e.translationY / track)); ty.value = Math.min(b.maxY, Math.max(b.minY, -frac * (ch - H))); })
      .onFinalize(() => { thumbActive.value = 0; });
    thumbGesture.current = thumb;
    pan.requireExternalGestureToFail(thumb);
    if (locked) return Gesture.Simultaneous(Gesture.Tap().enabled(false));
    return Gesture.Simultaneous(pinch, pan, dbl, hover);
  }, [bounds, mousePans, mode, minZ, L, W, doubleTapZoom, zoomAround, settledJS, badgeJS, doubleTapJS, locked, canPull, pullJS, addPageJS]);

  // ---------- web: wheel / trackpad pinch / keyboard ----------
  const hostRef = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return; const node: HTMLElement | null = hostRef.current; if (!node) return;
    let settleT: any = null;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault(); if (locked) return; const r = node.getBoundingClientRect(); const fx = ev.clientX - r.left, fy = ev.clientY - r.top; const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? H : 1;
      cancelAnimation(tx); cancelAnimation(ty); cancelAnimation(z);
      if (ev.ctrlKey || ev.metaKey) { const z0 = z.value; const z1 = Math.min(MAX_Z, Math.max(minZ, z0 * Math.exp(-ev.deltaY * unit * 0.0022))); const b = bounds(z1); tx.value = clamp(fx - (fx - tx.value) * (z1 / z0), b.minX, b.maxX); ty.value = clamp(fy - (fy - ty.value) * (z1 / z0), b.minY, b.maxY); z.value = z1; badgeJS(z1); clearTimeout(settleT); settleT = setTimeout(() => settledJS(z.value), 220); return; }
      let dx = ev.deltaX * unit, dy = ev.deltaY * unit; if (ev.shiftKey && !dx) { dx = dy; dy = 0; }
      if (mode !== 'vertical' && z.value <= 1.01) { if (!dx) dx = dy; dy = 0; }
      const b = bounds(z.value); tx.value = clamp(tx.value - dx, b.minX, b.maxX); ty.value = clamp(ty.value - dy, b.minY, b.maxY);
      if (mode !== 'vertical' && z.value <= 1.01) { clearTimeout(settleT); settleT = setTimeout(() => { const cell = Math.max(0, Math.min(L.cells - 1, Math.round(-tx.value / W))); tx.value = withTiming(-cell * W, { duration: 220 }); }, 140); }
    };
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const next = ['PageDown', 'ArrowRight', ...(mode === 'vertical' ? [] : ['ArrowDown'])].includes(ev.key); const prev = ['PageUp', 'ArrowLeft', ...(mode === 'vertical' ? [] : ['ArrowUp'])].includes(ev.key);
      if (next || prev) { ev.preventDefault(); place(curRef.current + (next ? 1 : -1), mode === 'vertical' ? z.value : 1, true); }
      else if ((ev.ctrlKey || ev.metaKey) && (ev.key === '=' || ev.key === '+')) { ev.preventDefault(); zoomJS(z.value * 1.25, W / 2, H / 2); }
      else if ((ev.ctrlKey || ev.metaKey) && ev.key === '-') { ev.preventDefault(); zoomJS(z.value / 1.25, W / 2, H / 2); }
      else if ((ev.ctrlKey || ev.metaKey) && ev.key === '0') { ev.preventDefault(); zoomJS(1, W / 2, H / 2); }
    };
    node.addEventListener('wheel', onWheel, { passive: false }); window.addEventListener('keydown', onKey);
    return () => { node.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey); clearTimeout(settleT); };
  }, [bounds, mode, minZ, L, W, H, place, zoomJS, settledJS, badgeJS, locked]);

  // ---------- render ----------
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value + ((z.value - 1) * L.cw) / 2 }, { translateY: ty.value + ((z.value - 1) * L.ch) / 2 }, { scale: z.value }] }), [L]);
  const [a, b] = range;
  const thumbStyle = useAnimatedStyle(() => { const ch = L.ch * z.value; if (mode !== 'vertical' || ch <= H + 1) return { opacity: 0, height: 0, transform: [{ translateY: 0 }] }; const th = Math.max(40, (H * H) / ch); const frac = Math.min(1, Math.max(0, -ty.value / (ch - H))); return { opacity: thumbActive.value ? 0.85 : 0.4, height: th, transform: [{ translateY: frac * (H - th) }] }; }, [L, H, mode]);
  return (
    <GestureDetector gesture={gesture}>
      <View ref={hostRef} style={{ width: W, height: H, overflow: 'hidden', backgroundColor: dark ? '#0F1012' : '#E3EAF4' }} collapsable={false}>
        <Animated.View style={[{ width: L.cw, height: L.ch }, contentStyle]}>
          {L.boxes.map((bx, i) => (
            <View key={i} style={[styles.page, { left: bx.x, top: bx.y, width: bx.w, height: bx.h }]}>
              {i >= a && i <= b ? <PageSlot box={bx} rs={rs} render={() => renderPage(i, bx, rs)} /> : null}
            </View>
          ))}
        </Animated.View>
        {mode === 'vertical' && <GestureDetector gesture={thumbGesture.current ?? Gesture.Tap().enabled(false)}><Animated.View hitSlop={{ left: 14, right: 6 }} style={[styles.thumb, thumbStyle]} /></GestureDetector>}
        {pullHint > 0 && <View pointerEvents="none" style={styles.pullWrap}><View style={styles.pull}><Text style={styles.pullText}>{pullHint === 2 ? '손가락을 떼면 페이지가 추가됩니다.' : '새 페이지를 추가하려면 화면을 계속 미세요.'}</Text></View></View>}
        <ZoomBadge ref={badge} right={W > 700 ? 33 : 7} top={W > 700 ? 13 : 7} />
        <PageBubble current={cur} total={pages.length} />
      </View>
    </GestureDetector>
  );
});

/** Renders page content at `rs`× resolution and scales it back down so it stays crisp under the outer zoom transform. */
function PageSlot({ box, rs, render }: { box: PageBox; rs: number; render: () => React.ReactNode }) {
  if (rs === 1) return <>{render()}</>;
  const W = box.w * rs, H = box.h * rs;
  return <View style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transform: [{ translateX: -(W - box.w) / 2 }, { translateY: -(H - box.h) / 2 }, { scale: 1 / rs }] }}>{render()}</View>;
}

const ZoomBadge = forwardRef<{ show: (t: string | null) => void }, { right: number; top: number }>(function ZoomBadge({ right, top }, ref) {
  const [t, setT] = useState<string | null>(null); const hide = useRef<any>(null);
  useImperativeHandle(ref, () => ({ show: (v) => { clearTimeout(hide.current); if (v) setT(v); else hide.current = setTimeout(() => setT(null), 500); } }), []);
  if (!t) return null;
  // Samsung Notes: zoom % chip at the top-right while zooming (16sp text, 10×9dp padding)
  return <View pointerEvents="none" style={[styles.badgeWrap, { right, top }]}><View style={styles.badge}><Text style={styles.badgeText}>{t}</Text></View></View>;
});

function PageBubble({ current, total }: { current: number; total: number }) {
  const [show, setShow] = useState(false); const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setShow(true); const t = setTimeout(() => setShow(false), 1100); return () => clearTimeout(t); }, [current]);
  if (!show) return null;
  return <View pointerEvents="none" style={styles.bubbleWrap}><View style={styles.bubble}><Text style={styles.bubbleText}>{current + 1} / {total}</Text></View></View>;
}

const styles = StyleSheet.create({
  page: { position: 'absolute', backgroundColor: '#fff', overflow: 'hidden', borderRadius: 3, shadowColor: '#1B2B4A', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  badgeWrap: { position: 'absolute' },
  badge: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 12, backgroundColor: 'rgba(23,32,51,0.82)', elevation: 2 },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  thumb: { position: 'absolute', right: 3, top: 0, width: 5, borderRadius: 3, backgroundColor: '#3B4A63' },
  pullWrap: { position: 'absolute', bottom: 46, left: 0, right: 0, alignItems: 'center' },
  pull: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(47,111,237,0.92)' },
  pullText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  bubbleWrap: { position: 'absolute', bottom: 14, left: 0, right: 0, alignItems: 'center' },
  bubble: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(23,32,51,0.7)' },
  bubbleText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
