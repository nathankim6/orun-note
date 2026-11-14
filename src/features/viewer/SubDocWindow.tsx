import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, FlatList, useWindowDimensions, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { useDocsStore } from '@/store/docs';
import { resolveUri } from '@/lib/files';
import { PdfPage, prefetchPage } from './PdfPage';
import { DocumentView, DocHandle, PageBox, PageTile } from './DocumentView';
import { IconButton, Muted, T } from '@/components/ui';
import { Doc } from '@/data/types';
import Svg, { Rect, Path } from 'react-native-svg';
import { resizeRect, Edges } from './subDocGeometry';

const MIN_W = 280, MIN_H = 260, HEADER_H = 44, BAR_H = 40, EDGE = 14, CORNER = 30;
/** resize hit areas: 24pt edges (centred on the border, half outside the window), 32pt corners */
const HIT = 24, HIT_CORNER = 32;
type Frame = { x: number; y: number; w: number; h: number };
/** Where the user last left the window (kept for the app session, so closing/reopening 서브교재 restores it). */
let lastFrame: Frame | null = null;
/** Last page viewed per document inside the sub window (this session). */
const lastSubPage: Record<string, number> = {};
const clamp = (v: number, lo: number, hi: number) => { 'worklet'; return Math.max(lo, Math.min(hi, v)); };
const webCursor = (c: string) => (Platform.OS === 'web' ? ({ cursor: c } as any) : null);


/**
 * 서브교재: a floating, always-on-top reference window (another document or the same one) that stays put while the
 * main page scrolls. Drag the title bar to move it; drag any edge or corner to resize (left / top keep the opposite edge put).
 * The page area is the same document engine as the main view: scroll / flick to turn pages, pinch or double-tap to zoom
 * (Ctrl+wheel on desktop); the bottom bar has the page grid (모든 페이지 한눈에), previous / next and zoom out / in.
 */
export function SubDocWindow({ mode, docId, excludeId, onPick, onClose, docked, split = false, onToggleSplit }: { mode: 'pick' | 'show'; docId: string | null; excludeId: string; onPick: (id: string) => void; onClose: () => void;
  /** 화면 2분할: render as a fixed pane of this size (no move / resize handles) */ docked?: { w: number; h: number } | null; split?: boolean; onToggleSplit?: () => void }) {
  const { colors } = useTheme(); const { width: winW, height: winH } = useWindowDimensions(); const insets = useSafeAreaInsets(); const docs = useDocsStore((s) => s.docs);
  const doc = docId ? docs[docId] : null;
  const top = insets.top, bottom = insets.bottom;
  const fit = useCallback((f: Frame): Frame => {
    const w = clamp(f.w, Math.min(MIN_W, winW), winW), h = clamp(f.h, Math.min(MIN_H, winH - top - bottom), winH - top - bottom);
    return { w, h, x: clamp(f.x, 0, Math.max(0, winW - w)), y: clamp(f.y, top, Math.max(top, winH - bottom - h)) };
  }, [winW, winH, top, bottom]);
  const [f0] = useState<Frame>(() => { const w = Math.min(420, winW * 0.42), h = Math.min(520, winH * 0.55); return fit(lastFrame ?? { x: winW - w - 16, y: 110, w, h }); });
  const x = useSharedValue(f0.x), y = useSharedValue(f0.y), w = useSharedValue(f0.w), h = useSharedValue(f0.h);
  const sx = useSharedValue(0), sy = useSharedValue(0), sw = useSharedValue(0), sh = useSharedValue(0), ew = useSharedValue(0), eh = useSharedValue(0);
  /** size = live layout size (updated while dragging); renderSize = size the page bitmap is rendered for (updated when the drag ends). */
  const [size, setSize] = useState({ w: f0.w, h: f0.h }); const [renderSize, setRenderSize] = useState({ w: f0.w, h: f0.h });
  const [page, setPage] = useState(0); const [uri, setUri] = useState<string | null>(null); const [zoomPct, setZoomPct] = useState(100); const [grid, setGrid] = useState(false);
  const docRef = useRef<DocHandle>(null);

  useEffect(() => { if (!doc) return; let alive = true; setUri(null); setPage(Math.max(0, Math.min(doc.pageCount - 1, lastSubPage[doc.id] ?? doc.lastPage ?? 0))); resolveUri(doc).then((u) => alive && setUri(u)); return () => { alive = false; }; }, [doc?.id]);
  useEffect(() => { if (doc) lastSubPage[doc.id] = page; }, [doc?.id, page]);
  // screen rotated / desktop window resized: keep the whole window on screen
  useEffect(() => { const f = fit({ x: x.value, y: y.value, w: w.value, h: h.value }); x.value = f.x; y.value = f.y; w.value = f.w; h.value = f.h; setSize({ w: f.w, h: f.h }); setRenderSize({ w: f.w, h: f.h }); lastFrame = f; }, [fit]);

  const save = useCallback((fx: number, fy: number, fw: number, fh: number) => { lastFrame = { x: fx, y: fy, w: fw, h: fh }; }, []);
  const live = useCallback((fw: number, fh: number) => setSize({ w: fw, h: fh }), []);
  const commit = useCallback((fw: number, fh: number) => { setSize({ w: fw, h: fh }); setRenderSize({ w: fw, h: fh }); }, []);
  const maxW = winW, maxH = winH - bottom;
  const move = useMemo(() => Gesture.Pan().minDistance(2)
    .onStart(() => { sx.value = x.value; sy.value = y.value; })
    .onUpdate((e) => { x.value = clamp(sx.value + e.translationX, 0, Math.max(0, maxW - w.value)); y.value = clamp(sy.value + e.translationY, top, Math.max(top, maxH - h.value)); })
    .onEnd(() => { runOnJS(save)(x.value, y.value, w.value, h.value); }), [maxW, maxH, top, save]);
  const makeResize = (edges: Edges) => Gesture.Pan().minDistance(0)
    .onStart(() => { sx.value = x.value; sy.value = y.value; sw.value = w.value; sh.value = h.value; ew.value = w.value; eh.value = h.value; })
    .onUpdate((e) => {
      const r = resizeRect({ x: sx.value, y: sy.value, w: sw.value, h: sh.value }, edges, e.translationX, e.translationY, { minW: MIN_W, minH: MIN_H, maxW, maxH, minY: top });
      x.value = r.x; y.value = r.y; w.value = r.w; h.value = r.h;
      // re-layout the page every ~10px of drag (the bitmap is only re-rendered once, when the drag ends)
      if (Math.abs(w.value - ew.value) + Math.abs(h.value - eh.value) >= 10) { ew.value = w.value; eh.value = h.value; runOnJS(live)(w.value, h.value); }
    })
    .onFinalize(() => { runOnJS(commit)(w.value, h.value); runOnJS(save)(x.value, y.value, w.value, h.value); });
  const deps = [maxW, maxH, top, live, commit, save];
  const resizeL = useMemo(() => makeResize({ left: true }), deps), resizeR = useMemo(() => makeResize({ right: true }), deps);
  const resizeT = useMemo(() => makeResize({ top: true }), deps), resizeB = useMemo(() => makeResize({ bottom: true }), deps);
  const resizeLT = useMemo(() => makeResize({ left: true, top: true }), deps), resizeRT = useMemo(() => makeResize({ right: true, top: true }), deps);
  const resizeLB = useMemo(() => makeResize({ left: true, bottom: true }), deps), resizeRB = useMemo(() => makeResize({ right: true, bottom: true }), deps);
  const style = useAnimatedStyle(() => ({ left: x.value, top: y.value, width: w.value, height: h.value }));

  // page area = window minus title bar, bottom bar and the 1px border (docked panes have no border)
  const box = docked ? { w: docked.w, h: docked.h } : size; const bw = docked ? 0 : 2;
  const viewW = Math.max(80, box.w - bw), viewH = Math.max(80, box.h - HEADER_H - BAR_H - bw);
  const pageSizes = useMemo(() => (doc ? doc.pages.map((p) => ({ width: p.width, height: p.height })) : []), [doc?.id, doc?.pageCount]);
  const renderSub = useCallback((pi: number, b: PageBox, rs: number, tile?: PageTile) => {
    const pg = doc?.pages[pi]; if (!doc || !pg) return null; const w = b.w * rs, h = b.h * rs;
    return <View key={pi} style={{ width: w, height: h, backgroundColor: '#fff' }}><PdfPage uri={uri} index={pg.index} width={w} height={h} renderScale={1 / rs} tile={tile} template={doc.template} /></View>;
  }, [doc, uri]);
  const goto = (i: number) => { if (!doc) return; const t = Math.max(0, Math.min(doc.pageCount - 1, i)); docRef.current?.goto(t); setPage(t); };
  const showList = !doc || mode === 'pick' || docId === '';

  const header = (
        <View style={[{ height: HEADER_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 6, backgroundColor: '#EEF3FD', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' }, docked ? null : webCursor('move')]} collapsable={false}>
          <Ionicons name="albums-outline" size={16} color={colors.primary} />
          <Text numberOfLines={1} style={{ flex: 1, fontWeight: '700', fontSize: 13, color: colors.text }}>{doc && !showList ? doc.title : '서브교재 선택'}</Text>
          {doc && !showList && <>
            <IconButton icon="swap-horizontal-outline" size={16} onPress={() => onPick('pick')} label="다른 교재" />
          </>}
          {onToggleSplit && <Pressable onPress={onToggleSplit} accessibilityRole="button" accessibilityLabel={split ? '떠 있는 창으로 보기' : '화면 2분할로 보기'} hitSlop={6} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 7, borderRadius: 8, backgroundColor: pressed ? 'rgba(0,122,255,0.18)' : 'rgba(0,122,255,0.10)' })}><PaneIcon kind={split ? 'float' : 'split'} color={colors.primary} /><Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.primary }}>{split ? '창' : '2분할'}</Text></Pressable>}
          <IconButton icon="close" size={16} onPress={onClose} label="서브교재 닫기" />
        </View>
  );
  const body = (<>
      {showList || !doc ? (
        <ScrollView style={{ flex: 1, backgroundColor: '#FFFFFF' }} contentContainerStyle={{ padding: 10, paddingRight: 10 + EDGE, gap: 6 }}>
          <Muted variant="caption" style={{ marginBottom: 4 }}>{docked ? '옆에 나란히 볼 교재를 고르세요. 가운데 막대를 끌면 두 화면의 크기를 바꿀 수 있어요.' : '옆에 띄워 놓고 볼 교재를 고르세요. 화면을 스크롤해도 이 창은 그대로 있어요. 오른쪽·아래 가장자리를 끌면 크기를 바꿀 수 있어요. 위의 2분할 버튼을 누르면 화면을 반으로 나눠 볼 수 있어요.'}</Muted>
          {Object.values(docs).sort((a, b) => ((b.lastOpenedAt ?? b.createdAt) > (a.lastOpenedAt ?? a.createdAt) ? 1 : -1)).map((d: Doc) => (
            <Pressable key={d.id} onPress={() => onPick(d.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: pressed ? colors.primarySoft : 'rgba(0,0,0,0.03)' })}>
              <View style={{ width: 8, height: 32, borderRadius: 4, backgroundColor: d.coverColor }} /><View style={{ flex: 1 }}><T variant="label" numberOfLines={1}>{d.title}{d.id === excludeId ? ' (현재 문서)' : ''}</T><Muted variant="caption">{d.pageCount}페이지</Muted></View><Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
            </Pressable>))}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, backgroundColor: '#E6EDF7' }}>
          {uri ? <DocumentView ref={docRef} key={doc.id} width={viewW} height={viewH} pages={pageSizes} mode="vertical" initialPage={page} renderPage={renderSub} mouseDrag doubleTapZoom noKeys
            onPageChange={setPage} onZoomSettled={(z) => setZoomPct(Math.round(z * 100))} onPrefetch={(i, b, rank) => { const pg = doc.pages[i]; if (pg && uri) prefetchPage(uri, pg.index, b.w, rank); }} />
            : <View style={{ width: viewW, height: viewH }} />}
          {grid && <SubPageGrid doc={doc} uri={uri} page={page} width={viewW} height={viewH} onPick={(i) => { setGrid(false); goto(i); }} />}
          {/* bottom bar: page grid · previous / page / next · zoom out / % (tap = fit) / zoom in */}
          <View style={{ height: BAR_H, flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 6, paddingRight: docked ? 6 : CORNER, backgroundColor: '#F7F9FD', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' }}>
            <Pressable onPress={() => setGrid((g) => !g)} accessibilityRole="button" accessibilityLabel="페이지 한눈에 보기" hitSlop={4} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 8, borderRadius: 8, backgroundColor: grid ? colors.primary : pressed ? 'rgba(0,122,255,0.16)' : 'rgba(0,122,255,0.08)' })}>
              <Ionicons name="grid-outline" size={14} color={grid ? '#fff' : colors.primary} /><Text style={{ fontSize: 11.5, fontWeight: '700', color: grid ? '#fff' : colors.primary }}>페이지</Text>
            </Pressable>
            <IconButton icon="chevron-back" size={16} onPress={() => goto(page - 1)} disabled={page === 0} label="이전 페이지" />
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, minWidth: 44, textAlign: 'center' }}>{page + 1}/{doc.pageCount}</Text>
            <IconButton icon="chevron-forward" size={16} onPress={() => goto(page + 1)} disabled={page >= doc.pageCount - 1} label="다음 페이지" />
            <View style={{ flex: 1 }} />
            <IconButton icon="remove-circle-outline" size={18} onPress={() => docRef.current?.zoomBy(1 / 1.25)} label="축소" />
            <Pressable onPress={() => docRef.current?.fit()} accessibilityRole="button" accessibilityLabel="화면에 맞춤" hitSlop={4}><Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.textMuted, minWidth: 38, textAlign: 'center' }}>{zoomPct}%</Text></Pressable>
            <IconButton icon="add-circle-outline" size={18} onPress={() => docRef.current?.zoomBy(1.25)} label="확대" />
          </View>
        </View>
      )}
  </>);
  if (docked) return (
    <View style={{ width: docked.w, height: docked.h, overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
      {header}
      {body}
    </View>
  );
  return (
    <Animated.View style={[{ position: 'absolute', borderRadius: 16, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(47,111,237,0.35)', shadowColor: '#1B3B7A', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12, zIndex: 50 }, style]}>
      <GestureDetector gesture={move}>
        {header}
      </GestureDetector>
      {body}
      {/* resize handles: four edges (24pt bands) and four corners (32pt squares with a subtle grip) */}
      <GestureDetector gesture={resizeL}><View style={[{ position: 'absolute', left: 0, top: HIT_CORNER, bottom: HIT_CORNER, width: HIT, justifyContent: 'center' }, webCursor('ew-resize')]} collapsable={false}><View style={{ marginLeft: 3, width: 4, height: 34, borderRadius: 2, backgroundColor: 'rgba(47,111,237,0.22)' }} /></View></GestureDetector>
      <GestureDetector gesture={resizeR}><View style={[{ position: 'absolute', right: 0, top: HIT_CORNER, bottom: HIT_CORNER, width: HIT, alignItems: 'flex-end', justifyContent: 'center' }, webCursor('ew-resize')]} collapsable={false}><View style={{ marginRight: 3, width: 4, height: 34, borderRadius: 2, backgroundColor: 'rgba(47,111,237,0.28)' }} /></View></GestureDetector>
      <GestureDetector gesture={resizeT}><View style={[{ position: 'absolute', top: 0, left: HIT_CORNER, right: HIT_CORNER, height: 10, alignItems: 'center' }, webCursor('ns-resize')]} collapsable={false}><View style={{ marginTop: 3, width: 34, height: 4, borderRadius: 2, backgroundColor: 'rgba(47,111,237,0.22)' }} /></View></GestureDetector>
      <GestureDetector gesture={resizeB}><View style={[{ position: 'absolute', bottom: 0, left: HIT_CORNER, right: HIT_CORNER, height: HIT, alignItems: 'center', justifyContent: 'flex-end' }, webCursor('ns-resize')]} collapsable={false}><View style={{ marginBottom: 3, width: 34, height: 4, borderRadius: 2, backgroundColor: 'rgba(47,111,237,0.28)' }} /></View></GestureDetector>
      {([['lt', resizeLT, true, true, 'nwse-resize', 0], ['rt', resizeRT, false, true, 'nesw-resize', 90], ['rb', resizeRB, false, false, 'nwse-resize', 180], ['lb', resizeLB, true, false, 'nesw-resize', 270]] as const).map(([k, g, isLeft, isTop, cur, rot]) => { const pos = { [isLeft ? 'left' : 'right']: 0, [isTop ? 'top' : 'bottom']: 0 }; return (
        <GestureDetector key={k} gesture={g}><View style={[{ position: 'absolute', width: HIT_CORNER, height: HIT_CORNER, alignItems: isLeft ? 'flex-start' : 'flex-end', justifyContent: isTop ? 'flex-start' : 'flex-end', padding: 4 }, pos, webCursor(cur)]} collapsable={false}>
          {/* corner grip: a small rounded L hugging the corner (rotated per corner) */}
          <Svg width={14} height={14} viewBox="0 0 14 14" style={{ transform: [{ rotate: `${rot}deg` }] }}><Path d="M3 11V3h8" stroke={colors.primary} strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" /></Svg>
        </View></GestureDetector>); })}
    </Animated.View>
  );
}

/** Two small panes (split view) / a window floating over a page (floating view). Drawn in code like the other app icons. */
function PaneIcon({ kind, color }: { kind: 'split' | 'float'; color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16">
      <Rect x={1.25} y={2.25} width={13.5} height={11.5} rx={2.4} fill="none" stroke={color} strokeWidth={1.5} />
      {kind === 'split'
        ? <><Rect x={8.6} y={3.6} width={4.8} height={8.8} rx={1.2} fill={color} opacity={0.9} /><Path d="M7.6 2.9v10.2" stroke={color} strokeWidth={1.3} /></>
        : <Rect x={6.4} y={5.4} width={6.6} height={5.4} rx={1.3} fill={color} opacity={0.9} />}
    </Svg>
  );
}

/** 페이지 한눈에 보기 for the 서브교재: all pages as thumbnails (only the visible rows render); tap one to jump there. */
function SubPageGrid({ doc, uri, page, width, height, onPick }: { doc: Doc; uri: string | null; page: number; width: number; height: number; onPick: (i: number) => void }) {
  const { colors } = useTheme();
  const cols = Math.max(2, Math.min(6, Math.floor((width - 12) / 132))); const gap = 8; const tw = (width - 16 - gap * (cols - 1)) / cols;
  const aspect = Math.max(...doc.pages.map((p) => p.height / p.width), 1); const th = tw * aspect; const rowH = th + 26;
  const rows = useMemo(() => { const out: number[][] = []; for (let i = 0; i < doc.pageCount; i += cols) out.push(Array.from({ length: Math.min(cols, doc.pageCount - i) }, (_, k) => i + k)); return out; }, [doc.pageCount, cols]);
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width, height, backgroundColor: 'rgba(242,242,247,0.98)' }}>
      <FlatList data={rows} key={cols} keyExtractor={(r) => String(r[0])} initialScrollIndex={Math.max(0, Math.floor(page / cols) - 1)} getItemLayout={(_, i) => ({ length: rowH, offset: 8 + rowH * i, index: i })}
        contentContainerStyle={{ padding: 8 }} initialNumToRender={6} windowSize={5}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', gap, height: rowH }}>
            {item.map((i) => { const pg = doc.pages[i]; const h = (pg.height / pg.width) * tw; const cur = i === page; return (
              <Pressable key={i} onPress={() => onPick(i)} style={{ width: tw }}>
                <View style={{ height: th, justifyContent: 'flex-start' }}>
                  <View style={{ width: tw, height: h, borderRadius: 6, overflow: 'hidden', borderWidth: cur ? 2 : 1, borderColor: cur ? colors.primary : 'rgba(0,0,0,0.12)', backgroundColor: '#fff' }}>
                    <PdfPage uri={uri} index={pg.index} width={tw - (cur ? 4 : 2)} height={h - (cur ? 4 : 2)} template={doc.template} />
                  </View>
                </View>
                <Text style={{ textAlign: 'center', fontSize: 11, marginTop: 4, color: cur ? colors.primary : colors.textMuted, fontWeight: cur ? '800' : '500' }}>{i + 1}</Text>
              </Pressable>); })}
          </View>
        )} />
    </View>
  );
}
