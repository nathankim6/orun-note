import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, ScrollView, Pressable, Text, Platform, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme, useLayout } from '@/theme';
import { Badge, Button, Dialog, IconButton, ListItem, Muted, Row, Sheet, T } from '@/components/ui';
import { Tool, Stroke, TextBox } from '@/data/types';
import { useDocsStore } from '@/store/docs';
import { inkKey, useInkStore } from '@/store/ink';
import { useSettingsStore } from '@/store/settings';
import { PdfPage } from '@/features/viewer/PdfPage';
import { ZoomView, ZoomHandle } from '@/features/viewer/ZoomView';
import { SubDocWindow } from '@/features/viewer/SubDocWindow';
import { pickImageForPage, addBlankPages } from '@/lib/files';
import { ImageBox } from '@/data/types';
import { InkCanvas, InkHandle } from '@/features/viewer/InkCanvas';
import { Toolbar } from '@/features/viewer/Toolbar';
import { ToolConfig, toolDefaults } from '@/features/viewer/ink';
import { LeftPanel, LeftTab } from '@/features/viewer/Panels';
import { SettingsSheet, VersionSheet, CycleSheet, GuideOverlay } from '@/features/viewer/Sheets';
import { resolveUri } from '@/lib/files';
import { fmtBytes, fmtDate } from '@/utils/format';

export default function Viewer() {
  const { docId: paramId } = useLocalSearchParams<{ docId: string }>();
  const router = useRouter(); const { colors, dark } = useTheme(); const insets = useSafeAreaInsets(); const { width: winW, height: winH } = useWindowDimensions(); const { isTablet } = useLayout();
  const store = useDocsStore(); const toast = store.showToast; const settings = useSettingsStore(); const prefs = settings.viewer; const ink = useInkStore();
  const docId = store.activeTab && store.openTabs.includes(store.activeTab) ? store.activeTab : paramId!;
  useEffect(() => { if (paramId) store.openTab(paramId); }, [paramId]);
  const doc = store.docs[docId]; const cycle = doc?.cycle ?? 1;
  const [uri, setUri] = useState<string | null>(null); const [missing, setMissing] = useState(false);
  useEffect(() => { if (!doc) return; setUri(null); resolveUri(doc).then((u) => { if (u) setUri(u); else setMissing(true); }); }, [doc?.id]);

  const [pageIndex, setPageIndex] = useState(doc?.lastPage ?? 0);
  useEffect(() => { setPageIndex(doc?.lastPage ?? 0); }, [doc?.id]);
  const [layout, setLayout] = useState(prefs.defaultLayoutMode); const [zoom, setZoom] = useState(1); const [fullscreen, setFullscreen] = useState(false);
  // Paged layouts zoom with a focal-anchored transform (ZoomView); `tzoom` mirrors its scale for the % label and sharper re-render.
  const [tzoom, setTzoom] = useState(1); const [pinching, setPinching] = useState(false); const [renderScale, setRenderScale] = useState(1); const [tzoomed, setTzoomed] = useState(false); const zoomRefs = useRef<Record<string, ZoomHandle | null>>({}); const contScroll = useRef(0);
  useEffect(() => { setTzoom(1); setRenderScale(1); }, [pageIndex, layout]);
  const [cfg, setCfg] = useState<ToolConfig>(() => { const v = useSettingsStore.getState().viewer; const t = (v.lastTool as Tool) || 'pen'; const pr = v.toolPresets?.[t] ?? v.toolPresets?.pen ?? { color: '#172033', width: 2, opacity: 1 }; return { tool: ['pen', 'highlighter'].includes(t) ? t : 'pen', color: pr.color, width: pr.width, shape: 'rectangle', opacity: pr.opacity }; }); const [textFont, setTextFont] = useState<string>('system'); const [subDoc, setSubDoc] = useState<string | null | 'pick'>(null); const prevPen = useRef<ToolConfig>(cfg); const [recentColors, setRecentColors] = useState<string[]>([]);
  const [leftTab, setLeftTab] = useState<LeftTab | null>(null); const [sheet, setSheet] = useState<null | 'settings' | 'versions' | 'cycle' | 'more' | 'tabs' | 'info' | 'goto'>(null); const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const inkRefs = useRef<Record<string, InkHandle | null>>({}); const scrollRef = useRef<any>(null);
  const onCfg = useCallback((p: Partial<ToolConfig>) => setCfg((c) => {
    const next = { ...c, ...p }; const v = useSettingsStore.getState().viewer;
    if (p.tool && p.tool !== c.tool) { const pr = v.toolPresets?.[p.tool]; if (pr) { next.color = pr.color; next.width = pr.width; next.opacity = pr.opacity; } else Object.assign(next, toolDefaults(p.tool, next)); }
    if (p.color) setRecentColors((r) => Array.from(new Set([p.color!, ...r])).slice(0, 6));
    if (['pen', 'highlighter'].includes(next.tool)) prevPen.current = next;
    // remember per-tool settings and last tool across launches
    if (['pen', 'highlighter', 'eraser', 'vectorEraser', 'shape', 'text'].includes(next.tool)) useSettingsStore.getState().setViewer({ toolPresets: { ...v.toolPresets, [next.tool]: { color: next.color, width: next.width, opacity: next.opacity } }, ...(['pen', 'highlighter'].includes(next.tool) ? { lastTool: next.tool } : {}) });
    return next; }), []);

  useEffect(() => { if (doc) store.touch(doc.id, pageIndex); }, [pageIndex, doc?.id]);
  const prevPage = useRef(pageIndex);
  useEffect(() => { if (doc && prevPage.current !== pageIndex) { ink.snapshot(inkKey(doc.id, cycle, String(prevPage.current))); prevPage.current = pageIndex; } }, [pageIndex]);

  const zoomKeyRef = useRef('0');
  // Paged layouts: one pinch recognizer over the whole viewport (so the paging ScrollView never competes), forwarded to the visible page's ZoomView.
  const pagedPinch = useMemo(() => Gesture.Pinch().runOnJS(true)
    .onStart((e) => { setPinching(true); zoomRefs.current[zoomKeyRef.current]?.pinchBegin(e.focalX, e.focalY); })
    .onUpdate((e) => { zoomRefs.current[zoomKeyRef.current]?.pinchUpdate(e.scale, e.focalX, e.focalY); })
    .onEnd(() => { zoomRefs.current[zoomKeyRef.current]?.pinchEnd(); setPinching(false); })
    .onFinalize(() => setPinching(false)), []);
  // Continuous layout reflows page widths on zoom; keep the content under the fingers fixed by correcting the scroll offset.
  const pinchStart = useRef({ zoom: 1, y: 0, fy: 0 });
  const pinch = useMemo(() => Gesture.Pinch().runOnJS(true)
    .onStart((e) => { pinchStart.current = { zoom, y: contScroll.current, fy: e.focalY }; })
    .onUpdate((e) => { const z = Math.max(0.6, Math.min(4, pinchStart.current.zoom * e.scale)); setZoom(z); const ratio = z / pinchStart.current.zoom; const y = (pinchStart.current.y + pinchStart.current.fy) * ratio - pinchStart.current.fy; scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: false }); }), [zoom]);
  if (!doc) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><T>문서를 찾을 수 없어요</T><Button title="돌아가기" style={{ marginTop: 12 }} onPress={() => router.replace('/(tabs)')} /></View>;
  if (missing) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 }}><Ionicons name="document-lock-outline" size={48} color={colors.textFaint} /><T variant="h3" style={{ marginTop: 12 }}>PDF 파일을 찾을 수 없어요</T><Muted center style={{ marginTop: 6 }}>원본 파일이 삭제되었거나 (웹) 브라우저 저장소가 비워졌어요. 다시 가져와 주세요.</Muted><Button title="내 서재로" style={{ marginTop: 16 }} onPress={() => router.replace('/(tabs)')} /></View>;

  const leftW = isTablet ? 300 : 0;
  const toolbarH = fullscreen ? 0 : 50; const headerH = fullscreen ? 0 : 44; const tabsH = store.openTabs.length > 1 && !fullscreen ? 34 : 0; const bottomH = 40;
  const availW = winW - (leftTab && isTablet ? leftW : 0); const availH = winH - insets.top - insets.bottom - toolbarH - headerH - tabsH - bottomH;
  const twoPage = layout === 'twoPage' && availW > 700;
  const pageAt = (i: number) => doc.pages[i] ?? doc.pages[0];
  const baseScaleFor = (i: number) => { const p = pageAt(i); if (layout === 'continuous') return (availW - 24) / p.width; if (twoPage) return Math.min((availW - 36) / 2 / p.width, (availH - 16) / p.height); return Math.min((availW - 16) / p.width, (availH - 16) / p.height); };
  const sizeFor = (i: number) => { const p = pageAt(i); const s = baseScaleFor(i) * (layout === 'continuous' ? zoom : 1); return { s, w: p.width * s, h: p.height * s }; };
  const contHeights = doc.pages.map((_, i) => sizeFor(i).h + 12); const contOffset = (i: number) => contHeights.slice(0, i).reduce((a, b) => a + b, 0);

  const goto = (i: number) => { i = Math.max(0, Math.min(doc.pageCount - 1, i)); setPageIndex(i); if (layout === 'continuous') scrollRef.current?.scrollTo({ y: contOffset(i), animated: true }); else if (twoPage) scrollRef.current?.scrollTo({ x: Math.floor(i / 2) * availW, animated: true }); else scrollRef.current?.scrollTo(layout === 'horizontal' ? { x: i * availW, animated: true } : { y: i * availH, animated: true }); };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => { const { x, y } = e.nativeEvent.contentOffset; let i = pageIndex; if (layout === 'continuous') { let acc = 0; i = 0; for (let k = 0; k < contHeights.length; k++) { if (y < acc + contHeights[k] / 2) { i = k; break; } acc += contHeights[k]; i = k; } } else if (twoPage) i = Math.round(x / availW) * 2; else i = layout === 'horizontal' ? Math.round(x / availW) : Math.round(y / availH); if (i !== pageIndex && i >= 0 && i < doc.pageCount) setPageIndex(i); };

  const clearAllInk = () => { for (let i = 0; i < doc.pageCount; i++) { const k = inkKey(doc.id, cycle, String(i)); if (ink.pages[k]?.strokes.length) ink.snapshot(k, '전체 삭제 전'); } ink.clearPackage(`${doc.id}:${cycle}:`); toast('이 문서의 필기를 모두 제거했어요'); };
  const clearPage = () => { const k = inkKey(doc.id, cycle, String(pageIndex)); ink.snapshot(k, '삭제 전'); ink.clear(k); toast('현재 페이지 필기를 삭제했어요 (버전 기록에서 복원 가능)'); };
  const exit = () => { ink.snapshot(inkKey(doc.id, cycle, String(pageIndex))); router.canGoBack() ? router.back() : router.replace('/(tabs)'); };
  const activeInk = inkRefs.current[String(pageIndex)]; const inkEnabled = cfg.tool !== 'hand';
  const scrollOK = !tzoomed && !pinching; // finger swipes turn pages; while pinching or zoomed in, the ZoomView owns the fingers

  const renderPage = (pi: number) => { if (pi < 0 || pi >= doc.pageCount) return <View key={'blank' + pi} style={{ width: sizeFor(0).w, height: sizeFor(0).h }} />; const { s, w, h } = sizeFor(pi); const k = inkKey(doc.id, cycle, String(pi)); const pi_ = ink.pages[k]; const strokes = pi_?.strokes ?? []; const textBoxes = pi_?.textBoxes ?? []; return (
    <View key={pi} style={{ width: w, height: h, backgroundColor: '#fff', borderRadius: 2, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, overflow: 'hidden' }}>
      <PdfPage uri={uri} index={pageAt(pi).index} width={w} height={h} renderScale={layout === 'continuous' ? 1 : renderScale} template={doc.template} />
      <InkCanvas width={w} height={h} s={s} strokes={strokes} textBoxes={textBoxes} images={pi_?.images ?? []} onImages={(next: ImageBox[]) => ink.setImages(k, next)} textFont={textFont} cfg={cfg} enabled={inkEnabled} fingerDraw={prefs.fingerDraw} lineSnap={prefs.lineSnap}
        onStrokes={(next: Stroke[]) => { ink.setStrokes(k, next); if (cfg.tool === 'shape' && prefs.penAutoReturn && next.length > strokes.length) setTimeout(() => setCfg(prevPen.current), 60); }}
        onTextBoxes={(next: TextBox[]) => useInkStore.setState((st) => ({ pages: { ...st.pages, [k]: { ...(st.pages[k] ?? { strokes: [], textBoxes: [], versions: [], updatedAt: '' }), textBoxes: next } } }))}
        onDoubleTap={prefs.doubleTapZoomEnabled && cfg.tool === 'hand' && layout === 'continuous' ? () => setZoom((z) => (z > 1 ? 1 : 2)) : undefined} historyRef={{ get current() { return inkRefs.current[String(pi)]; }, set current(v) { inkRefs.current[String(pi)] = v; } } as any} onHistory={(h) => pi === pageIndex && setHist(h)} />
    </View>); };

  const zoomKey = twoPage ? 'pair' + Math.floor((pageIndex + (prefs.twoPageStartOdd ? 0 : 1)) / 2) : String(pageIndex);
  zoomKeyRef.current = zoomKey;
  const zoomBy = (d: number) => { if (layout === 'continuous') setZoom((z) => Math.max(0.6, Math.min(4, z + d))); else zoomRefs.current[zoomKey]?.zoomTo(tzoom + d); };
  const resetZoom = () => { if (layout === 'continuous') setZoom(1); else zoomRefs.current[zoomKey]?.reset(); };
  const zoomPct = layout === 'continuous' ? zoom : tzoom;
  const wrapZoom = (key: string, w: number, h: number, node: React.ReactNode) => (
    <ZoomView key={key} ref={(r) => { zoomRefs.current[key] = r; }} width={twoPage ? availW : availW} height={availH} contentWidth={w} contentHeight={h} maxScale={5}
      onScaleChange={(sc) => setTzoom(Math.round(sc * 100) / 100)} onScaleSettled={(sc) => setRenderScale(Math.min(3, Math.max(1, Math.ceil(sc))))} onZoomedChange={setTzoomed}>{node}</ZoomView>);
  const pages = Array.from({ length: doc.pageCount }, (_, i) => i);
  const pageInk = ink.pages[inkKey(doc.id, cycle, String(pageIndex))];

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#0F1012' : '#E6EDF7', paddingTop: insets.top }}>
      {!fullscreen && <Toolbar cfg={cfg} onCfg={onCfg} onCfgReplace={(c) => { setCfg(c); if (['pen', 'highlighter'].includes(c.tool)) prevPen.current = c; }} onUndo={() => activeInk?.undo()} onRedo={() => activeInk?.redo()} canUndo={hist.canUndo} canRedo={hist.canRedo} onClear={clearPage} onClearAll={clearAllInk} onBack={exit} onMore={() => setSheet('more')} recentColors={recentColors} textFont={textFont} onTextFont={setTextFont} onSubDoc={() => setSubDoc(subDoc ? null : 'pick')} onInsertImage={async () => { const im = await pickImageForPage(); if (!im) return; const k = inkKey(doc.id, cycle, String(pageIndex)); const pg = pageAt(pageIndex); const w = Math.min(pg.width * 0.5, im.width); const h = w * (im.height / im.width); ink.setImages(k, [...(ink.pages[k]?.images ?? []), { id: Math.random().toString(36).slice(2, 10), rect: { x: (pg.width - w) / 2, y: pg.height * 0.1, w, h }, uri: im.uri, createdAt: Date.now() }]); setCfg((c) => ({ ...c, tool: 'hand' })); toast('사진을 넣었어요. 드래그로 옮기고 모서리로 크기를 바꿔요'); }} />}
      {tabsH > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: tabsH, backgroundColor: colors.surfaceAlt }} contentContainerStyle={{ alignItems: 'flex-end' }}>
          {store.openTabs.map((id) => { const d = store.docs[id]; const active = id === docId; return <Pressable key={id} onPress={() => { store.setActiveTab(id); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 30, backgroundColor: active ? colors.surface : 'transparent', borderTopLeftRadius: 8, borderTopRightRadius: 8, maxWidth: 220 }}><Text numberOfLines={1} style={{ fontSize: 12, fontWeight: active ? '700' : '500', color: active ? colors.text : colors.textMuted, flexShrink: 1 }}>{d?.title ?? id}</Text><Pressable hitSlop={6} onPress={() => { store.closeTab(id); if (store.openTabs.length <= 1) exit(); }}><Ionicons name="close" size={14} color={colors.textMuted} /></Pressable></Pressable>; })}
          <Pressable onPress={() => setSheet('tabs')} style={{ paddingHorizontal: 10, height: 30, justifyContent: 'center' }}><Ionicons name="add" size={18} color={colors.textMuted} /></Pressable>
        </ScrollView>)}
      {!fullscreen && (
        <View style={{ height: headerH, backgroundColor: 'rgba(255,255,255,0.6)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.8)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }}>
          <IconButton icon="menu-outline" active={!!leftTab} onPress={() => setLeftTab(leftTab ? null : 'pages')} label="좌측 패널" />
          <Pressable onPress={() => setSheet('cycle')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.surfaceAlt }}><Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{cycle}회독</Text><Ionicons name="chevron-down" size={12} color={colors.textMuted} /></Pressable>
          <Pressable onPress={() => setSheet('info')} style={{ flex: 1, marginLeft: 8 }}><Text numberOfLines={1} style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>{doc.title}</Text></Pressable>
          {pageInk && pageInk.strokes.length > 0 && <Muted variant="caption" style={{ marginHorizontal: 6 }}>{pageInk.strokes.length}획</Muted>}
          <IconButton icon={layout === 'continuous' ? 'reorder-four-outline' : layout === 'horizontal' ? 'phone-landscape-outline' : layout === 'twoPage' ? 'book-outline' : 'phone-portrait-outline'} onPress={() => setLayout(layout === 'vertical' ? 'horizontal' : layout === 'horizontal' ? 'continuous' : layout === 'continuous' ? 'twoPage' : 'vertical')} label="보기 모드 변경" />
          <IconButton icon="ellipsis-horizontal" onPress={() => setSheet('more')} label="더보기" />
          <IconButton icon="expand-outline" onPress={() => setFullscreen(true)} label="전체 화면" />
        </View>)}
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {leftTab && isTablet && <LeftPanel tab={leftTab} setTab={setLeftTab} width={leftW} onClose={() => setLeftTab(null)} doc={doc} uri={uri} pageIndex={pageIndex} onGoto={goto} onToggleBookmark={(i) => store.toggleBookmark(doc.id, i)} cycle={cycle} />}
        {/* Narrow screens (phones / split view): the same panel as a modal sheet so the ≡ button always shows the page grid */}
        {leftTab && !isTablet && <Modal visible transparent animationType="slide" onRequestClose={() => setLeftTab(null)}><Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' }} onPress={() => setLeftTab(null)} /><View style={{ height: '70%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' }}><LeftPanel tab={leftTab} setTab={setLeftTab} width={winW} onClose={() => setLeftTab(null)} doc={doc} uri={uri} pageIndex={pageIndex} onGoto={(i) => { goto(i); setLeftTab(null); }} onToggleBookmark={(i) => store.toggleBookmark(doc.id, i)} cycle={cycle} /></View></Modal>}
        <View style={{ flex: 1 }} collapsable={false}>
            {!uri ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /><Muted variant="caption" style={{ marginTop: 8 }}>PDF를 여는 중...</Muted></View>
            : layout === 'continuous' ? (
              <GestureDetector gesture={pinch}><ScrollView ref={scrollRef} scrollEnabled={scrollOK} onScroll={(e) => { contScroll.current = e.nativeEvent.contentOffset.y; onScrollEnd(e); }} scrollEventThrottle={60} contentContainerStyle={{ alignItems: 'center', paddingVertical: 8, gap: 12 }} contentOffset={{ x: 0, y: contOffset(pageIndex) }}>{pages.map(renderPage)}</ScrollView></GestureDetector>
            ) : twoPage ? (
              <GestureDetector gesture={pagedPinch}><ScrollView ref={scrollRef} horizontal pagingEnabled scrollEnabled={scrollOK} onMomentumScrollEnd={onScrollEnd} contentOffset={{ x: Math.floor(pageIndex / 2) * availW, y: 0 }} showsHorizontalScrollIndicator={false}>
                {Array.from({ length: Math.ceil((doc.pageCount + (prefs.twoPageStartOdd ? 0 : 1)) / 2) }, (_, pair) => wrapZoom('pair' + pair, sizeFor(0).w * 2 + 8, sizeFor(0).h, <View style={{ width: sizeFor(0).w * 2 + 8, height: sizeFor(0).h, flexDirection: 'row', gap: 8 }}>{renderPage(prefs.twoPageStartOdd ? pair * 2 : pair * 2 - 1)}{renderPage(prefs.twoPageStartOdd ? pair * 2 + 1 : pair * 2)}</View>))}
              </ScrollView></GestureDetector>
            ) : (
              <GestureDetector gesture={pagedPinch}><ScrollView ref={scrollRef} horizontal={layout === 'horizontal'} pagingEnabled scrollEnabled={scrollOK} onMomentumScrollEnd={onScrollEnd} contentOffset={layout === 'horizontal' ? { x: pageIndex * availW, y: 0 } : { x: 0, y: pageIndex * availH }} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
                {pages.map((i) => { const { w, h } = sizeFor(i); const content = Math.abs(i - pageIndex) <= 1 ? renderPage(i) : <View style={{ width: w, height: h, backgroundColor: '#fff' }} />; return wrapZoom(String(i), w, h, content); })}
              </ScrollView></GestureDetector>
            )}
            {fullscreen && <Pressable onPress={() => setFullscreen(false)} style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 8 }}><Ionicons name="contract-outline" size={18} color="#fff" /></Pressable>}
        </View>
      </View>
      {subDoc && <SubDocWindow mode={subDoc === 'pick' ? 'pick' : 'show'} docId={subDoc === 'pick' ? null : subDoc} excludeId={doc.id} onPick={(id) => setSubDoc(id)} onClose={() => setSubDoc(null)} />}
      <View style={{ height: bottomH + insets.bottom, paddingBottom: insets.bottom, backgroundColor: 'rgba(255,255,255,0.72)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.8)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        <IconButton icon="chevron-back" size={18} onPress={() => goto(pageIndex - 1)} disabled={pageIndex === 0} label="이전 페이지" />
        <Pressable onPress={() => setSheet('goto')} style={{ paddingHorizontal: 8 }}><Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>{pageIndex + 1} <Text style={{ color: colors.textMuted, fontWeight: '500' }}>/ {doc.pageCount}</Text></Text></Pressable>
        <IconButton icon="chevron-forward" size={18} onPress={() => goto(pageIndex + 1)} disabled={pageIndex >= doc.pageCount - 1} label="다음 페이지" />
        {doc.kind === 'blank' && <IconButton icon="add-circle-outline" size={20} color={colors.primary} onPress={() => { addBlankPages(doc, 1); setTimeout(() => goto(doc.pageCount), 50); }} label="페이지 추가" />}
        <View style={{ flex: 1, height: 4, backgroundColor: colors.surfaceAlt, borderRadius: 2, marginHorizontal: 8 }}><View style={{ width: `${((pageIndex + 1) / doc.pageCount) * 100}%`, height: 4, backgroundColor: colors.primary, borderRadius: 2 }} /></View>
        <IconButton icon={doc.bookmarks.includes(pageIndex) ? 'bookmark' : 'bookmark-outline'} size={18} active={doc.bookmarks.includes(pageIndex)} onPress={() => store.toggleBookmark(doc.id, pageIndex)} label="북마크" />
        <Pressable onPress={resetZoom} style={{ paddingHorizontal: 6 }}><Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '600' }}>{Math.round(zoomPct * 100)}%</Text></Pressable>
        <IconButton icon="remove-circle-outline" size={18} onPress={() => zoomBy(-0.25)} /><IconButton icon="add-circle-outline" size={18} onPress={() => zoomBy(0.25)} />
      </View>

      {!isTablet && leftTab && <Sheet visible onClose={() => setLeftTab(null)} height="80%"><View style={{ height: winH * 0.7, marginHorizontal: -16 }}><LeftPanel tab={leftTab} setTab={setLeftTab} width={winW} onClose={() => setLeftTab(null)} doc={doc} uri={uri} pageIndex={pageIndex} onGoto={(i) => { goto(i); setLeftTab(null); }} onToggleBookmark={(i) => store.toggleBookmark(doc.id, i)} cycle={cycle} /></View></Sheet>}
      <SettingsSheet visible={sheet === 'settings'} onClose={() => setSheet(null)} layout={layout} setLayout={(l) => { setLayout(l); settings.setViewer({ defaultLayoutMode: l }); }} />
      <VersionSheet visible={sheet === 'versions'} onClose={() => setSheet(null)} pageIndex={pageIndex} versions={pageInk?.versions ?? []} onRestore={(id) => { ink.restore(inkKey(doc.id, cycle, String(pageIndex)), id); setSheet(null); toast('복원 완료'); }} onSnapshot={() => { ink.snapshot(inkKey(doc.id, cycle, String(pageIndex)), '수동 저장'); toast('현재 필기를 버전으로 저장했어요'); }} />
      <CycleSheet visible={sheet === 'cycle'} onClose={() => setSheet(null)} cycle={cycle} maxCycle={doc.maxCycle} onSwitch={(c) => store.switchCycle(doc.id, c)} onNew={() => { const c = store.startNewCycle(doc.id); toast(`${c}회독을 시작했어요`); }} onResetInk={(scope) => { if (scope === 'all') ink.clearPackage(doc.id + ':'); else ink.clearPackage(`${doc.id}:${cycle}:`); toast('필기가 초기화되었습니다'); }} />
      <Sheet visible={sheet === 'more'} onClose={() => setSheet(null)} title="메뉴">
        <ListItem icon="lock-closed-outline" title="보안 모드" subtitle="암호화 저장 · 캡처/녹화 차단 · 공유/내보내기 없음" right={<Badge label="켜짐" tone="success" />} />
        <ListItem icon="options-outline" title="뷰어 설정" subtitle="레이아웃 · 필기 · 제스처" onPress={() => setSheet('settings')} />
        <ListItem icon="time-outline" title="필기 버전 기록" subtitle="이 페이지 필기 기록 보기/복원" onPress={() => setSheet('versions')} />
        <ListItem icon="repeat-outline" title="필기 레이어 (회독) 전환" subtitle={`현재 ${cycle}회독`} onPress={() => setSheet('cycle')} />
        <ListItem icon="albums-outline" title="탭 목록" subtitle={`${store.openTabs.length}개 열림`} onPress={() => setSheet('tabs')} />
        <ListItem icon="information-circle-outline" title="문서 정보" onPress={() => setSheet('info')} />
        <ListItem icon="help-circle-outline" title="사용 가이드 다시보기" onPress={() => { setSheet(null); settings.setViewerGuideDone(false); }} />
      </Sheet>
      <Sheet visible={sheet === 'tabs'} onClose={() => setSheet(null)} title="탭 목록">
        {Object.values(store.docs).map((d) => { const open = store.openTabs.includes(d.id); return <ListItem key={d.id} icon={open ? 'checkmark-circle' : 'document-outline'} title={d.title} subtitle={`${d.pageCount}p`} right={open && d.id !== docId ? <Button small variant="ghost" title="탭 닫기" onPress={() => store.closeTab(d.id)} /> : undefined} onPress={() => { store.openTab(d.id); setSheet(null); }} />; })}
      </Sheet>
      <Sheet visible={sheet === 'info'} onClose={() => setSheet(null)} title="문서 정보">
        {[['제목', doc.title], ['파일', doc.fileName], ['크기', fmtBytes(doc.size)], ['페이지', `${doc.pageCount}p · ${Math.round(doc.pages[0].width)}×${Math.round(doc.pages[0].height)}pt`], ['추가', fmtDate(doc.createdAt, { time: true })], ['필기', `${Object.entries(ink.pages).filter(([k]) => k.startsWith(doc.id + ':')).reduce((a, [, p]) => a + p.strokes.length, 0)}획 · ${doc.maxCycle}개 회독`], ['북마크', doc.bookmarks.length ? doc.bookmarks.map((b) => b + 1).join(', ') + 'p' : '없음']].map(([l, v]) => <Row key={l} justify="space-between" style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}><Muted>{l}</Muted><T variant="label" style={{ flex: 1, textAlign: 'right', marginLeft: 16 }} numberOfLines={2}>{v}</T></Row>)}
      </Sheet>
      <Sheet visible={sheet === 'goto'} onClose={() => setSheet(null)} title="페이지 이동" height={320}>
        <Muted variant="caption">페이지 번호 (1 ~ {doc.pageCount})</Muted>
        <Row style={{ flexWrap: 'wrap', marginTop: 10 }} gap={6}>{pages.map((i) => <Pressable key={i} onPress={() => { goto(i); setSheet(null); }} style={{ width: 40, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: i === pageIndex ? colors.primary : doc.bookmarks.includes(i) ? colors.primarySoft : colors.surfaceAlt }}><Text style={{ fontWeight: '700', fontSize: 12, color: i === pageIndex ? '#fff' : colors.text }}>{i + 1}</Text></Pressable>)}</Row>
      </Sheet>
      <GuideOverlay visible={!settings.viewerGuideDone && !!uri} onDone={() => settings.setViewerGuideDone(true)} />
    </View>
  );
}
