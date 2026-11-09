import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, Text, Platform, StyleSheet, PixelRatio } from 'react-native';
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
/** A sharp re-render of the on-screen part of a zoomed page: region (x,y,w,h) in device pixels of a page rendered pxW wide; n* = same region normalized 0..1. */
export type PageTile = { pxW: number; x: number; y: number; w: number; h: number; nx: number; ny: number; nw: number; nh: number };
export type PageBox = { x: number; y: number; w: number; h: number; s: number }; // content coords at zoom 1; s = PDF pt → px at zoom 1
export type DocHandle = { goto: (i: number, animated?: boolean) => void; zoomTo: (z: number, fx?: number, fy?: number) => void; zoomBy: (f: number) => void; fit: () => void; fitPage: () => void; getZoom: () => number };
type Props = {
  width: number; height: number; pages: { width: number; height: number }[]; mode: DocMode; startOdd?: boolean; initialPage: number;
  renderPage: (i: number, box: PageBox, rs: number, tile?: PageTile) => React.ReactNode;
  /** warm the page cache for neighbours of the visible range */ onPrefetch?: (i: number, box: PageBox, rank?: number) => void;
  onPageChange?: (i: number) => void; onZoomSettled?: (z: number) => void; mousePans?: boolean; doubleTapZoom?: boolean; dark?: boolean;
  /** 캔버스 고정: no zoom / pan while locked */ locked?: boolean;
  /** notebooks: keep pulling past the last page to add one (Samsung Notes) */ onPullAddPage?: () => void;
  /** a second document on screen (서브교재): leave the keyboard to the main document */ noKeys?: boolean;
  /** mouse drags pan the page 1:1 while fingers keep scrolling / flicking pages (read-only panes) */ mouseDrag?: boolean;
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

export const DocumentView = forwardRef<DocHandle, Props>(function DocumentView({ width: W, height: H, pages, mode, startOdd = true, initialPage, renderPage, onPageChange, onZoomSettled, mousePans = false, doubleTapZoom = true, dark, locked = false, onPullAddPage, onPrefetch, noKeys, mouseDrag}, ref) {
  const L = useMemo(() => computeLayout(pages, W, H, mode, startOdd), [pages, W, H, mode, startOdd]);
  const minZ = mode === 'vertical' ? 0.5 : 1;
  const z = useSharedValue(1); const tx = useSharedValue(0); const ty = useSharedValue(0);
  const sZ = useSharedValue(1), sTx = useSharedValue(0), sTy = useSharedValue(0), sFx = useSharedValue(0), sFy = useSharedValue(0);
  const pinching = useSharedValue(false); const lastKey = useSharedValue('');
  const [range, setRange] = useState<[number, number]>([0, 0]); const [rs, setRs] = useState(1); const [cur, setCur] = useState(initialPage);
  const curRef = useRef(initialPage); const badge = useRef<{ show: (t: string | null) => void } | null>(null);
  const lastMv = useSharedValue(0); const lastTr = useSharedValue(0);
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
  const computeTilesRef = useRef<() => void>(() => {});
  const settledJS = useCallback((zz: number) => { setRs(densityFor(zz)); computeTilesRef.current(); onZoomSettled?.(zz); badge.current?.show(null); }, [onZoomSettled]);
  const badgeJS = useCallback((zz: number) => badge.current?.show(`${Math.round(zz * 100)}%`), []);
  const rangeJS = useCallback((a: number, b: number, c: number) => { setRange((r) => { if (r[0] === a && r[1] === b) return r; if (onPrefetch) [b + 1, a - 1, b + 2, b + 3, a - 2].forEach((i, k) => { if (i >= 0 && i < L.boxes.length && (i < a || i > b)) onPrefetch(i, L.boxes[i], k + 1); }); return [a, b]; }); if (c !== curRef.current) { curRef.current = c; setCur(c); onPageChange?.(c); } }, [onPageChange, onPrefetch, L]);

  const [tiles, setTiles] = useState<Record<number, PageTile>>({}); const tileTimer = useRef<any>(null); const rangeRef = useRef(range); rangeRef.current = range;
  const computeTiles = useCallback(() => {
    const zz = z.value, x0 = tx.value, y0 = ty.value; const dpr = Math.min(3, PixelRatio.get());
    if (zz <= 1.2) { setTiles((t) => (Object.keys(t).length ? {} : t)); return; } // same threshold as the 2x page density
    const out: Record<number, PageTile> = {}; const [ra, rb] = rangeRef.current;
    for (let i = Math.max(0, ra); i <= rb && i < L.boxes.length; i++) {
      const bx = L.boxes[i]; const sx = x0 + bx.x * zz, sy = y0 + bx.y * zz, sw = bx.w * zz, sh = bx.h * zz;
      const ix0 = Math.max(0, sx), iy0 = Math.max(0, sy), ix1 = Math.min(W, sx + sw), iy1 = Math.min(H, sy + sh);
      if (ix1 - ix0 < 8 || iy1 - iy0 < 8) continue;
      const pxW = Math.round(sw * dpr), pxH = Math.round(sh * dpr);
      const x = Math.max(0, Math.floor((ix0 - sx) * dpr)), y = Math.max(0, Math.floor((iy0 - sy) * dpr)); const w = Math.min(pxW - x, Math.ceil((ix1 - ix0) * dpr)), h = Math.min(pxH - y, Math.ceil((iy1 - iy0) * dpr));
      out[i] = { pxW, x, y, w, h, nx: x / pxW, ny: y / pxH, nw: w / pxW, nh: h / pxH };
    }
    setTiles(out);
  }, [L, W, H]);
  computeTilesRef.current = computeTiles;
  const kickTiles = useCallback(() => { clearTimeout(tileTimer.current); tileTimer.current = setTimeout(computeTiles, 260); }, [computeTiles]);
  useAnimatedReaction(() => (z.value <= 1.2 ? -1 : Math.round(tx.value / 48) * 7919 + Math.round(ty.value / 48) * 31 + Math.round(z.value * 50)), (k, prev) => { if (k !== prev) runOnJS(kickTiles)(); }, [kickTiles]);
  useEffect(() => () => clearTimeout(tileTimer.current), []);

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
  const penBusy = () => { 'worklet'; const ps = penSession.value; const now = Date.now(); return (ps.writing && ps.byPen && now - ps.since < 20000) || now - ps.at < PALM_WINDOW_MS || now - ps.hoverAt < PALM_WINDOW_MS; };
  /** The ink layer owns a stroke right now (pen or mouse): the page must not move under it. Stale (>20 s) flags are ignored. */
  const inkOwns = () => { 'worklet'; const ps = penSession.value; return ps.writing && Date.now() - ps.since < 20000; };
  /** A pen stroke is in progress (two-finger pinch is still allowed while the pen merely hovers). */
  const penWriting = () => { 'worklet'; const ps = penSession.value; return ps.writing && ps.byPen && Date.now() - ps.since < 20000; };
  /** Single-finger palm guard: pen writing or lifted < 450 ms ago (hover alone only raises the drag threshold). */
  const palmBusy = () => { 'worklet'; const ps = penSession.value; return penWriting() || Date.now() - ps.at < 450; };
  const hoverRecent = () => { 'worklet'; return Date.now() - penSession.value.hoverAt < PALM_WINDOW_MS; };
  const panStartX = useSharedValue(0); const panStartY = useSharedValue(0); const panThresh = useSharedValue(8); const panAxis = useSharedValue(0); // 0 free · 1 horizontal only · 2 vertical only
  const snapPaged = (vx: number) => {
    'worklet';
    const cell = clamp(Math.round((-tx.value - vx * 0.18) / W), 0, Math.max(0, L.cells - 1));
    tx.value = withTiming(-cell * W, { duration: 260, easing: Easing.out(Easing.cubic) });
    const b = bounds(1); ty.value = withTiming((b.minY + b.maxY) / 2, { duration: 200 });
  };
  const thumbActive = useSharedValue(0); const thumbGesture = useRef<any>(null);
  const doubleTapJS = useCallback((x: number, y: number) => { setTimeout(() => { if (Date.now() - lastLookupAt < 600) return; zoomJS(z.value < 1.6 ? 2.5 : 1, x, y); }, 70); }, [zoomJS]);
  // ---------- page turns by flick (one finger never drags the paper, so a resting palm / hand edge can't move it) ----------
  const slideCfg = { duration: 190, easing: Easing.in(Easing.quad) }; const inCfg = { duration: 230, easing: Easing.out(Easing.cubic) };
  const turnJS = useCallback((dir: number, vertical: boolean) => {
    const n = L.boxes.length; if (!n) return; const zz = z.value; const x0 = tx.value, y0 = ty.value; const b = bounds(zz);
    if (mode === 'vertical') {
      if (vertical) {
        // like Page Down / Page Up: move about one screen, but always stop at the start of the next/previous page
        const tops = L.boxes.map((bx) => y0 + bx.y * zz); let ny: number;
        if (dir > 0) { const below = tops.filter((t) => t > M + 10); const nextTop = below.length ? Math.min(...below) : Infinity; ny = y0 - Math.min(0.85 * H, nextTop - M); if (!isFinite(nextTop) && y0 <= b.minY + 1 && onPullAddPage) { onPullAddPage(); return; } }
        else { const above = tops.filter((t) => t < M - 4); const prevTop = above.length ? Math.max(...above) : -Infinity; ny = y0 + Math.min(0.85 * H, isFinite(prevTop) ? M - prevTop : 0.85 * H); }
        ty.value = withTiming(clamp(ny, b.minY, b.maxY), inCfg); return;
      }
      // left / right flick: previous / next page with a sideways slide (zoom and horizontal position are kept)
      const cur0 = curRef.current; const target = Math.max(0, Math.min(n - 1, cur0 + dir));
      if (target === cur0) { if (dir > 0 && onPullAddPage) onPullAddPage(); return; }
      const ny = clamp(M - L.boxes[target].y * zz, b.minY, b.maxY); const out = dir > 0 ? -W : W;
      tx.value = withTiming(x0 + out, slideCfg, (fin) => { 'worklet'; if (!fin) return; ty.value = ny; tx.value = x0 - out; tx.value = withTiming(x0, inCfg); });
      return;
    }
    // paged (좌우 / 2페이지씩): every flick goes to the neighbouring spread; up/down slide vertically, left/right horizontally
    const cell0 = Math.max(0, Math.min(L.cells - 1, Math.round(-x0 / (W * zz)))); const cell = Math.max(0, Math.min(L.cells - 1, cell0 + dir));
    if (cell === cell0) return;
    const b1 = bounds(1); const cx = -cell * W, cy = (b1.minY + b1.maxY) / 2;
    if (zz !== 1) { z.value = withTiming(1, inCfg); settledJS(1); }
    if (vertical) { const out = dir > 0 ? -H : H; ty.value = withTiming(y0 + out, slideCfg, (fin) => { 'worklet'; if (!fin) return; tx.value = cx; ty.value = cy - out; ty.value = withTiming(cy, inCfg); }); }
    else { tx.value = withTiming(cx, { duration: 260, easing: Easing.out(Easing.cubic) }); ty.value = withTiming(cy, inCfg); }
  }, [L, bounds, mode, W, H, onPullAddPage, settledJS]);

  const flickT0 = useSharedValue(0); const pinchEndAt = useSharedValue(0);
  const gesture = useMemo(() => {
    // one finger (not the hand tool):
    //  - 상하 mode / zoomed page: the paper follows the finger 1:1 and glides on (momentum), locked to the drag direction
    //    (never wobbles sideways when the page fits the width) — smooth like any scroll view;
    //  - left/right flick in 상하 mode, or any flick on an un-zoomed 좌우/2페이지 page: turns the page.
    //  Palm safety: never while the pen writes or was lifted < 0.45 s ago; while the pen hovers a much longer drag is needed.
    const flick = Gesture.Pan().manualActivation(true).maxPointers(1).enabled(!mousePans)
      .onTouchesDown((e, st) => {
        const pt = e.pointerType;
        if (pt === PointerType.STYLUS || pt === PointerType.MOUSE || pinching.value || inkOwns() || palmBusy() || e.numberOfTouches > 1) { st.fail(); return; }
        const t0 = e.allTouches[0]; panStartX.value = t0 ? t0.absoluteX : 0; panStartY.value = t0 ? t0.absoluteY : 0; flickT0.value = Date.now();
        panThresh.value = hoverRecent() ? 28 : 10;
      })
      .onTouchesMove((e, st) => {
        if (e.numberOfTouches > 1 || inkOwns() || pinching.value) { st.fail(); return; }
        const t0 = e.allTouches[0]; if (!t0) return; const dx = t0.absoluteX - panStartX.value, dy = t0.absoluteY - panStartY.value;
        if (dx * dx + dy * dy > panThresh.value * panThresh.value) st.activate();
      })
      .onStart(() => { cancelAnimation(tx); cancelAnimation(ty); sTx.value = tx.value; sTy.value = ty.value; panAxis.value = -1; lastMv.value = Date.now(); lastTr.value = 0; })
      .onUpdate((e) => {
        if (pinching.value || inkOwns()) return;
        const trSum = e.translationX + e.translationY * 1.0001; if (Math.abs(trSum - lastTr.value) > 0.5) { lastTr.value = trSum; lastMv.value = Date.now(); }
        const b = bounds(z.value);
        if (panAxis.value === -1) {
          const ax = Math.abs(e.translationX), ay = Math.abs(e.translationY); if (ax + ay < 6) return;
          const wide = b.maxX - b.minX > 2; // page wider than the screen (zoomed in)
          if (mode === 'vertical') panAxis.value = wide ? (ay > ax * 1.25 ? 2 : ax > ay * 1.25 ? 1 : 0) : (ay >= ax ? 2 : 3); // zoomed: lock only a clearly straight drag
          else panAxis.value = z.value > 1.01 ? (ay > ax * 1.25 ? 2 : ax > ay * 1.25 ? 1 : 0) : 3;
        }
        if (panAxis.value === 3) return; // page-turn flick: decided on release
        if (panAxis.value !== 2) tx.value = clamp(sTx.value + e.translationX, b.minX, b.maxX);
        if (panAxis.value !== 1) {
          const rawY = sTy.value + e.translationY; ty.value = clamp(rawY, b.minY, b.maxY);
          if (canPull) { const over = b.minY - rawY; const stg = over > 150 ? 2 : over > 40 ? 1 : 0; if (stg !== pullStage.value) { pullStage.value = stg; runOnJS(pullJS)(stg); } }
        }
      })
      .onEnd((e, success) => {
        if (pullStage.value) { const add = pullStage.value === 2; pullStage.value = 0; runOnJS(pullJS)(0); if (add && success) { runOnJS(addPageJS)(); return; } }
        if (!success || pinching.value || inkOwns() || Date.now() - pinchEndAt.value < 450 || e.numberOfPointers > 1) return;
        if (panAxis.value === 3) {
          const dt = Date.now() - flickT0.value; const ax = Math.abs(e.translationX), ay = Math.abs(e.translationY);
          const strict = hoverRecent(); const minD = strict ? 120 : 56, minV = strict ? 1400 : 550;
          if (dt > 650) return;
          if (ax > ay * 1.25 && ax >= minD && Math.abs(e.velocityX) >= minV) runOnJS(turnJS)(e.translationX < 0 ? 1 : -1, false);
          else if (mode !== 'vertical' && ay > ax * 1.25 && ay >= minD && Math.abs(e.velocityY) >= minV) runOnJS(turnJS)(e.translationY < 0 ? 1 : -1, true);
          return;
        }
        const b = bounds(z.value); const still = Date.now() - lastMv.value > 90; // finger held still before lifting: stop where it is
        if (still) return;
        if (panAxis.value !== 2) tx.value = withDecay({ velocity: e.velocityX, deceleration: 0.998, clamp: [b.minX, b.maxX] });
        if (panAxis.value !== 1) ty.value = withDecay({ velocity: e.velocityY, deceleration: 0.998, clamp: [b.minY, b.maxY] });
      });
    // hand tool (finger) and mouse drag: the paper follows 1:1 and stays exactly where it is released (no momentum, no snap-back)
    const drag = Gesture.Pan().maxPointers(1).minDistance(2).enabled(!!mousePans || !!mouseDrag)
      .onTouchesDown((e, st) => { if (e.pointerType === PointerType.STYLUS || pinching.value || (!mousePans && e.pointerType !== PointerType.MOUSE)) st.fail(); })
      .onStart(() => { cancelAnimation(tx); cancelAnimation(ty); sTx.value = tx.value; sTy.value = ty.value; })
      .onUpdate((e) => { if (pinching.value) return; const b = bounds(z.value); tx.value = clamp(sTx.value + e.translationX, b.minX, b.maxX); ty.value = clamp(sTy.value + e.translationY, b.minY, b.maxY); })
      .onEnd(() => { if (mode !== 'vertical' && z.value <= 1.01) snapPaged(0); });
    // two fingers: zoom around the fingers and move with them; hard limits while moving, so nothing re-adjusts after release
    const pinch = Gesture.Pinch()
      .onTouchesDown((e, st) => { if (e.pointerType === PointerType.STYLUS || penWriting()) st.fail(); })
      .onStart((e) => { pinching.value = true; cancelAnimation(tx); cancelAnimation(ty); cancelAnimation(z); sZ.value = z.value; sTx.value = tx.value; sTy.value = ty.value; sFx.value = e.focalX; sFy.value = e.focalY; })
      .onUpdate((e) => {
        if (penWriting() || e.numberOfPointers < 2) return; // a lifting finger moves the focal point to the other finger: ignore it
        const nz = clamp(sZ.value * e.scale, minZ, MAX_Z); const b = bounds(nz);
        tx.value = clamp(e.focalX - (sFx.value - sTx.value) * (nz / sZ.value), b.minX, b.maxX);
        ty.value = clamp(e.focalY - (sFy.value - sTy.value) * (nz / sZ.value), b.minY, b.maxY);
        z.value = nz; runOnJS(badgeJS)(nz);
      })
      .onEnd(() => {
        if (mode !== 'vertical' && z.value <= 1.02) { z.value = withTiming(1, { duration: 160 }); snapPaged(0); runOnJS(settledJS)(1); return; } // un-zoomed page view: realign to the page
        runOnJS(settledJS)(z.value); // stays exactly as left — ready to write
      })
      .onFinalize(() => { pinching.value = false; pinchEndAt.value = Date.now(); });
    const dbl = Gesture.Tap().numberOfTaps(2).maxDelay(300).maxDistance(30).enabled(doubleTapZoom)
      .onTouchesDown((e, st) => { if (e.pointerType === PointerType.STYLUS || e.numberOfTouches > 1 || penBusy() || inkOwns()) st.fail(); })
      .onEnd((e) => { runOnJS(doubleTapJS)(e.x, e.y); });
    // pen hovering above the screen (S Pen / Apple Pencil hover) arms palm rejection before the tip touches down
    const hover = Gesture.Hover().onBegin((e) => { if (e.pointerType === PointerType.STYLUS) penSession.value = { ...penSession.value, hoverAt: Date.now() }; }).onUpdate((e) => { if (e.pointerType === PointerType.STYLUS) penSession.value = { ...penSession.value, hoverAt: Date.now() }; });
    // draggable scrollbar thumb (vertical mode) — fast scroll through long PDFs
    const thumb = Gesture.Pan().minDistance(0).enabled(mode === 'vertical')
      .onStart(() => { cancelAnimation(ty); sTy.value = ty.value; thumbActive.value = 1; })
      .onUpdate((e) => { const ch = L.ch * z.value; if (ch <= H) return; const th = Math.max(40, (H * H) / ch); const track = H - th; const b = bounds(z.value); const frac0 = -sTy.value / (ch - H); const frac = Math.min(1, Math.max(0, frac0 + e.translationY / track)); ty.value = Math.min(b.maxY, Math.max(b.minY, -frac * (ch - H))); })
      .onFinalize(() => { thumbActive.value = 0; });
    thumbGesture.current = thumb;
    flick.requireExternalGestureToFail(thumb); drag.requireExternalGestureToFail(thumb);
    return Gesture.Simultaneous(pinch, flick, drag, dbl, hover);
  }, [bounds, mousePans, mouseDrag, mode, minZ, L, W, H, doubleTapZoom, settledJS, badgeJS, doubleTapJS, turnJS, canPull, pullJS, addPageJS]);


  // ---------- web: wheel / trackpad pinch / keyboard ----------
  const hostRef = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return; const node: HTMLElement | null = hostRef.current; if (!node) return;
    let settleT: any = null;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault(); const r = node.getBoundingClientRect(); const fx = ev.clientX - r.left, fy = ev.clientY - r.top; const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? H : 1;
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
    node.addEventListener('wheel', onWheel, { passive: false }); if (!noKeys) window.addEventListener('keydown', onKey);
    return () => { node.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey); clearTimeout(settleT); };
  }, [bounds, mode, minZ, L, W, H, place, zoomJS, settledJS, badgeJS, locked]);

  // ---------- render ----------
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value + ((z.value - 1) * L.cw) / 2 }, { translateY: ty.value + ((z.value - 1) * L.ch) / 2 }, { scale: z.value }] }), [L]);
  const [a, b] = range;
  const thumbStyle = useAnimatedStyle(() => { const ch = L.ch * z.value; if (mode !== 'vertical' || ch <= H + 1) return { opacity: 0, height: 0, transform: [{ translateY: 0 }] }; const th = Math.max(40, (H * H) / ch); const frac = Math.min(1, Math.max(0, -ty.value / (ch - H))); return { opacity: thumbActive.value ? 0.85 : 0.4, height: th, transform: [{ translateY: frac * (H - th) }] }; }, [L, H, mode]);
  return (
    <GestureDetector gesture={gesture}>
      <View testID="document-viewport" ref={hostRef} style={{ width: W, height: H, overflow: 'hidden', backgroundColor: dark ? '#0F1012' : '#E3EAF4' }} collapsable={false}>
        <Animated.View style={[{ width: L.cw, height: L.ch }, contentStyle]}>
          {L.boxes.map((bx, i) => (
            <View key={i} style={[styles.page, { left: bx.x, top: bx.y, width: bx.w, height: bx.h }]}>
              {i >= a && i <= b ? <PageSlot box={bx} rs={rs} render={() => renderPage(i, bx, rs, tiles[i])} /> : null}
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
