import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { useDocsStore } from '@/store/docs';
import { resolveUri } from '@/lib/files';
import { PdfPage, usePageImage } from './PdfPage';
import { ZoomView } from './ZoomView';
import { IconButton, Muted, T } from '@/components/ui';
import { Doc } from '@/data/types';
import Svg, { Rect, Path } from 'react-native-svg';

const MIN_W = 260, MIN_H = 220, HEADER_H = 44, EDGE = 14, CORNER = 30;
type Frame = { x: number; y: number; w: number; h: number };
/** Where the user last left the window (kept for the app session, so closing/reopening 서브교재 restores it). */
let lastFrame: Frame | null = null;
/** Last page viewed per document inside the sub window (this session). */
const lastSubPage: Record<string, number> = {};
const clamp = (v: number, lo: number, hi: number) => { 'worklet'; return Math.max(lo, Math.min(hi, v)); };
const webCursor = (c: string) => (Platform.OS === 'web' ? ({ cursor: c } as any) : null);

/** Warms the shared page-image cache for a neighbouring page so turning pages in the sub window is instant. */
function Prefetch({ uri, index, width }: { uri: string; index: number; width: number }) { usePageImage(uri, index, width); return null; }

/**
 * 서브교재: a floating, always-on-top reference window (another document or the same one) that stays put while the
 * main page scrolls. Drag the title bar to move it; drag the right edge, bottom edge or bottom-right corner to resize.
 * Turn pages with the arrows; pinch / double-tap (and Ctrl+wheel on desktop) to zoom inside.
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
  const [page, setPage] = useState(0); const [uri, setUri] = useState<string | null>(null); const [zoomQ, setZoomQ] = useState(1); const [prefetchOn, setPrefetchOn] = useState(false);

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
  const makeResize = (horiz: boolean, vert: boolean) => Gesture.Pan().minDistance(0)
    .onStart(() => { sw.value = w.value; sh.value = h.value; ew.value = w.value; eh.value = h.value; })
    .onUpdate((e) => {
      if (horiz) w.value = clamp(sw.value + e.translationX, MIN_W, Math.max(MIN_W, maxW - x.value));
      if (vert) h.value = clamp(sh.value + e.translationY, MIN_H, Math.max(MIN_H, maxH - y.value));
      // re-layout the page every ~10px of drag (the bitmap is only re-rendered once, when the drag ends)
      if (Math.abs(w.value - ew.value) + Math.abs(h.value - eh.value) >= 10) { ew.value = w.value; eh.value = h.value; runOnJS(live)(w.value, h.value); }
    })
    .onFinalize(() => { runOnJS(commit)(w.value, h.value); runOnJS(save)(x.value, y.value, w.value, h.value); });
  const resizeR = useMemo(() => makeResize(true, false), [maxW, maxH, live, commit, save]);
  const resizeB = useMemo(() => makeResize(false, true), [maxW, maxH, live, commit, save]);
  const resizeRB = useMemo(() => makeResize(true, true), [maxW, maxH, live, commit, save]);
  const style = useAnimatedStyle(() => ({ left: x.value, top: y.value, width: w.value, height: h.value }));

  // page fitted inside the content box (window minus title bar and 1px border)
  const fitScale = (p: { width: number; height: number } | undefined, box: { w: number; h: number }) => (p ? Math.min((box.w - 2) / p.width, (box.h - HEADER_H - 2) / p.height) : 1);
  const box = docked ? { w: docked.w, h: docked.h } : size; const rbox = docked ? box : renderSize;
  const pg = doc?.pages[page]; const contentW = box.w - 2; const contentH = box.h - HEADER_H - 2;
  const scale = fitScale(pg, box); const same = box.w === rbox.w && box.h === rbox.h;
  // While resizing, keep asking for the bitmap width of the last committed size (no intermediate renders; the image stretches).
  const renderScale = same ? zoomQ : zoomQ * (fitScale(pg, rbox) / scale);
  const onZoomSettled = useCallback((s: number) => setZoomQ(s <= 1.05 ? 1 : Math.min(3, Math.ceil(s * 2) / 2)), []);
  useEffect(() => { setPrefetchOn(false); if (!uri) return; const t = setTimeout(() => setPrefetchOn(true), 350); return () => clearTimeout(t); }, [uri, page, rbox.w, rbox.h, zoomQ]);
  const neighbours = doc && uri && prefetchOn ? [page + 1, page - 1].filter((i) => i >= 0 && i < doc.pageCount) : [];
  const showList = !doc || mode === 'pick' || docId === '';

  const header = (
        <View style={[{ height: HEADER_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 6, backgroundColor: '#EEF3FD', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' }, docked ? null : webCursor('move')]} collapsable={false}>
          <Ionicons name="albums-outline" size={16} color={colors.primary} />
          <Text numberOfLines={1} style={{ flex: 1, fontWeight: '700', fontSize: 13, color: colors.text }}>{doc && !showList ? doc.title : '서브교재 선택'}</Text>
          {doc && !showList && <>
            <IconButton icon="swap-horizontal-outline" size={16} onPress={() => onPick('pick')} label="다른 교재" />
            <IconButton icon="chevron-back" size={16} onPress={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} label="이전 페이지" />
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted }}>{page + 1}/{doc.pageCount}</Text>
            <IconButton icon="chevron-forward" size={16} onPress={() => setPage((p) => Math.min(doc.pageCount - 1, p + 1))} disabled={page >= doc.pageCount - 1} label="다음 페이지" />
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
          {pg && <ZoomView standalone width={contentW} height={contentH} contentWidth={pg.width * scale} contentHeight={pg.height * scale} maxScale={4} onScaleSettled={onZoomSettled}><View style={{ backgroundColor: '#fff' }}><PdfPage uri={uri} index={pg.index} width={pg.width * scale} height={pg.height * scale} renderScale={renderScale} template={doc.template} /></View></ZoomView>}
          {uri && neighbours.map((i) => { const pn = doc.pages[i]; return pn ? <Prefetch key={i} uri={uri} index={pn.index} width={pn.width * fitScale(pn, rbox) * zoomQ} /> : null; })}
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
      {/* resize handles: right edge, bottom edge, bottom-right corner */}
      <GestureDetector gesture={resizeR}><View style={[{ position: 'absolute', top: HEADER_H, right: 0, bottom: CORNER, width: EDGE, alignItems: 'center', justifyContent: 'center' }, webCursor('ew-resize')]} collapsable={false}><View style={{ width: 4, height: 34, borderRadius: 2, backgroundColor: 'rgba(47,111,237,0.28)' }} /></View></GestureDetector>
      <GestureDetector gesture={resizeB}><View style={[{ position: 'absolute', left: 0, right: CORNER, bottom: 0, height: EDGE, alignItems: 'center', justifyContent: 'center' }, webCursor('ns-resize')]} collapsable={false}><View style={{ width: 34, height: 4, borderRadius: 2, backgroundColor: 'rgba(47,111,237,0.28)' }} /></View></GestureDetector>
      <GestureDetector gesture={resizeRB}><View style={[{ position: 'absolute', right: 0, bottom: 0, width: CORNER, height: CORNER, alignItems: 'flex-end', justifyContent: 'flex-end', padding: 5 }, webCursor('nwse-resize')]} collapsable={false}><Ionicons name="resize-outline" size={16} color={colors.primary} /></View></GestureDetector>
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
