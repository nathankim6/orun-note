import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, Pressable, Text, Platform, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme, useLayout } from '@/theme';
import { Badge, Button, Dialog, IconButton, ListItem, Muted, Row, Sheet, T } from '@/components/ui';
import { Stroke, TextBox } from '@/data/types';
import { useDocsStore } from '@/store/docs';
import { inkKey, useInkStore } from '@/store/ink';
import { useSettingsStore } from '@/store/settings';
import { PdfPage } from '@/features/viewer/PdfPage';
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
  const [cfg, setCfg] = useState<ToolConfig>({ tool: 'pen', color: '#1B1B1F', width: 2, shape: 'rectangle', opacity: 1 }); const prevPen = useRef<ToolConfig>(cfg); const [recentColors, setRecentColors] = useState<string[]>([]);
  const [leftTab, setLeftTab] = useState<LeftTab | null>(null); const [sheet, setSheet] = useState<null | 'settings' | 'versions' | 'cycle' | 'more' | 'tabs' | 'info' | 'goto'>(null); const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const inkRefs = useRef<Record<string, InkHandle | null>>({}); const scrollRef = useRef<any>(null);
  const onCfg = useCallback((p: Partial<ToolConfig>) => setCfg((c) => { const next = { ...c, ...p }; if (p.tool && p.tool !== c.tool) Object.assign(next, toolDefaults(p.tool, next)); if (p.color) setRecentColors((r) => Array.from(new Set([p.color!, ...r])).slice(0, 6)); if (['pen', 'pencil', 'highlighter', 'fountain', 'brush'].includes(next.tool)) prevPen.current = next; return next; }), []);

  useEffect(() => { if (doc) store.touch(doc.id, pageIndex); }, [pageIndex, doc?.id]);
  const prevPage = useRef(pageIndex);
  useEffect(() => { if (doc && prevPage.current !== pageIndex) { ink.snapshot(inkKey(doc.id, cycle, String(prevPage.current))); prevPage.current = pageIndex; } }, [pageIndex]);

  if (!doc) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><T>문서를 찾을 수 없어요</T><Button title="돌아가기" style={{ marginTop: 12 }} onPress={() => router.replace('/(tabs)')} /></View>;
  if (missing) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 }}><Ionicons name="document-lock-outline" size={48} color={colors.textFaint} /><T variant="h3" style={{ marginTop: 12 }}>PDF 파일을 찾을 수 없어요</T><Muted center style={{ marginTop: 6 }}>원본 파일이 삭제되었거나 (웹) 브라우저 저장소가 비워졌어요. 다시 가져와 주세요.</Muted><Button title="내 서재로" style={{ marginTop: 16 }} onPress={() => router.replace('/(tabs)')} /></View>;

  const leftW = isTablet ? 300 : 0;
  const toolbarH = fullscreen ? 0 : 50; const headerH = fullscreen ? 0 : 44; const tabsH = store.openTabs.length > 1 && !fullscreen ? 34 : 0; const bottomH = 40;
  const availW = winW - (leftTab && isTablet ? leftW : 0); const availH = winH - insets.top - insets.bottom - toolbarH - headerH - tabsH - bottomH;
  const twoPage = layout === 'twoPage' && availW > 700;
  const pageAt = (i: number) => doc.pages[i] ?? doc.pages[0];
  const baseScaleFor = (i: number) => { const p = pageAt(i); if (layout === 'continuous') return (availW - 24) / p.width; if (twoPage) return Math.min((availW - 36) / 2 / p.width, (availH - 16) / p.height); return Math.min((availW - 16) / p.width, (availH - 16) / p.height); };
  const sizeFor = (i: number) => { const p = pageAt(i); const s = baseScaleFor(i) * zoom; return { s, w: p.width * s, h: p.height * s }; };
  const contHeights = doc.pages.map((_, i) => sizeFor(i).h + 12); const contOffset = (i: number) => contHeights.slice(0, i).reduce((a, b) => a + b, 0);

  const goto = (i: number) => { i = Math.max(0, Math.min(doc.pageCount - 1, i)); setPageIndex(i); if (layout === 'continuous') scrollRef.current?.scrollTo({ y: contOffset(i), animated: true }); else if (twoPage) scrollRef.current?.scrollTo({ x: Math.floor(i / 2) * availW, animated: true }); else scrollRef.current?.scrollTo(layout === 'horizontal' ? { x: i * availW, animated: true } : { y: i * availH, animated: true }); };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => { const { x, y } = e.nativeEvent.contentOffset; let i = pageIndex; if (layout === 'continuous') { let acc = 0; i = 0; for (let k = 0; k < contHeights.length; k++) { if (y < acc + contHeights[k] / 2) { i = k; break; } acc += contHeights[k]; i = k; } } else if (twoPage) i = Math.round(x / availW) * 2; else i = layout === 'horizontal' ? Math.round(x / availW) : Math.round(y / availH); if (i !== pageIndex && i >= 0 && i < doc.pageCount) setPageIndex(i); };

  const clearPage = () => { const k = inkKey(doc.id, cycle, String(pageIndex)); ink.snapshot(k, '삭제 전'); ink.clear(k); toast('현재 페이지 필기를 삭제했어요 (버전 기록에서 복원 가능)'); };
  const exit = () => { ink.snapshot(inkKey(doc.id, cycle, String(pageIndex))); router.canGoBack() ? router.back() : router.replace('/(tabs)'); };
  const activeInk = inkRefs.current[String(pageIndex)]; const inkEnabled = cfg.tool !== 'hand';
  const scrollOK = cfg.tool === 'hand' || !prefs.fingerDraw || Platform.OS === 'web';

  const renderPage = (pi: number) => { if (pi < 0 || pi >= doc.pageCount) return <View key={'blank' + pi} style={{ width: sizeFor(0).w, height: sizeFor(0).h }} />; const { s, w, h } = sizeFor(pi); const k = inkKey(doc.id, cycle, String(pi)); const pi_ = ink.pages[k]; const strokes = pi_?.strokes ?? []; const textBoxes = pi_?.textBoxes ?? []; return (
    <View key={pi} style={{ width: w, height: h, backgroundColor: '#fff', borderRadius: 2, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, overflow: 'hidden' }}>
      <PdfPage uri={uri} index={pi} width={w} height={h} />
      <InkCanvas width={w} height={h} s={s} strokes={strokes} textBoxes={textBoxes} cfg={cfg} enabled={inkEnabled} fingerDraw={prefs.fingerDraw} lineSnap={prefs.lineSnap}
        onStrokes={(next: Stroke[]) => { ink.setStrokes(k, next); if ((cfg.tool === 'eraser' || cfg.tool === 'vectorEraser') && prefs.eraserReturnToPen && next.length < strokes.length) setTimeout(() => setCfg(prevPen.current), 60); if (cfg.tool === 'shape' && prefs.penAutoReturn && next.length > strokes.length) setTimeout(() => setCfg(prevPen.current), 60); }}
        onTextBoxes={(next: TextBox[]) => useInkStore.setState((st) => ({ pages: { ...st.pages, [k]: { ...(st.pages[k] ?? { strokes: [], textBoxes: [], versions: [], updatedAt: '' }), textBoxes: next } } }))}
        onDoubleTap={prefs.doubleTapZoomEnabled && cfg.tool === 'hand' ? () => setZoom((z) => (z > 1 ? 1 : 2)) : undefined} historyRef={{ get current() { return inkRefs.current[String(pi)]; }, set current(v) { inkRefs.current[String(pi)] = v; } } as any} onHistory={(h) => pi === pageIndex && setHist(h)} />
    </View>); };

  const pinch = useMemo(() => Gesture.Pinch().runOnJS(true).onUpdate((e) => setZoom((z) => Math.max(0.6, Math.min(4, e.scale > 1 ? z + (e.scale - 1) * 0.06 : z - (1 - e.scale) * 0.06)))), []);
  const pages = Array.from({ length: doc.pageCount }, (_, i) => i);
  const pageInk = ink.pages[inkKey(doc.id, cycle, String(pageIndex))];

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#0F1012' : '#E9E7E0', paddingTop: insets.top }}>
      {!fullscreen && <Toolbar cfg={cfg} onCfg={onCfg} onUndo={() => activeInk?.undo()} onRedo={() => activeInk?.redo()} canUndo={hist.canUndo} canRedo={hist.canRedo} onClear={clearPage} onBack={exit} onMore={() => setSheet('more')} recentColors={recentColors} />}
      {tabsH > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: tabsH, backgroundColor: colors.surfaceAlt }} contentContainerStyle={{ alignItems: 'flex-end' }}>
          {store.openTabs.map((id) => { const d = store.docs[id]; const active = id === docId; return <Pressable key={id} onPress={() => { store.setActiveTab(id); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 30, backgroundColor: active ? colors.surface : 'transparent', borderTopLeftRadius: 8, borderTopRightRadius: 8, maxWidth: 220 }}><Text numberOfLines={1} style={{ fontSize: 12, fontWeight: active ? '700' : '500', color: active ? colors.text : colors.textMuted, flexShrink: 1 }}>{d?.title ?? id}</Text><Pressable hitSlop={6} onPress={() => { store.closeTab(id); if (store.openTabs.length <= 1) exit(); }}><Ionicons name="close" size={14} color={colors.textMuted} /></Pressable></Pressable>; })}
          <Pressable onPress={() => setSheet('tabs')} style={{ paddingHorizontal: 10, height: 30, justifyContent: 'center' }}><Ionicons name="add" size={18} color={colors.textMuted} /></Pressable>
        </ScrollView>)}
      {!fullscreen && (
        <View style={{ height: headerH, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }}>
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
        <GestureDetector gesture={pinch}>
          <View style={{ flex: 1 }} collapsable={false}>
            {!uri ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /><Muted variant="caption" style={{ marginTop: 8 }}>PDF를 여는 중...</Muted></View>
            : layout === 'continuous' ? (
              <ScrollView ref={scrollRef} scrollEnabled={scrollOK} onScroll={onScrollEnd} scrollEventThrottle={120} contentContainerStyle={{ alignItems: 'center', paddingVertical: 8, gap: 12 }} contentOffset={{ x: 0, y: contOffset(pageIndex) }}>{pages.map(renderPage)}</ScrollView>
            ) : twoPage ? (
              <ScrollView ref={scrollRef} horizontal pagingEnabled scrollEnabled={scrollOK} onMomentumScrollEnd={onScrollEnd} contentOffset={{ x: Math.floor(pageIndex / 2) * availW, y: 0 }} showsHorizontalScrollIndicator={false}>
                {Array.from({ length: Math.ceil((doc.pageCount + (prefs.twoPageStartOdd ? 0 : 1)) / 2) }, (_, pair) => <View key={pair} style={{ width: availW, height: availH, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>{renderPage(prefs.twoPageStartOdd ? pair * 2 : pair * 2 - 1)}{renderPage(prefs.twoPageStartOdd ? pair * 2 + 1 : pair * 2)}</View>)}
              </ScrollView>
            ) : (
              <ScrollView ref={scrollRef} horizontal={layout === 'horizontal'} pagingEnabled scrollEnabled={scrollOK} onMomentumScrollEnd={onScrollEnd} contentOffset={layout === 'horizontal' ? { x: pageIndex * availW, y: 0 } : { x: 0, y: pageIndex * availH }} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
                {pages.map((i) => { const { w, h } = sizeFor(i); const content = Math.abs(i - pageIndex) <= 1 ? renderPage(i) : <View style={{ width: w, height: h, backgroundColor: '#fff' }} />; return zoom > 1 ? (
                  <ScrollView key={i} horizontal style={{ width: availW, height: availH }} contentContainerStyle={{ minWidth: availW, alignItems: 'flex-start' }}><ScrollView contentContainerStyle={{ minHeight: availH, padding: 8, alignItems: 'center', justifyContent: 'center', minWidth: availW }}>{content}</ScrollView></ScrollView>
                ) : <View key={i} style={{ width: availW, height: availH, alignItems: 'center', justifyContent: 'center' }}>{content}</View>; })}
              </ScrollView>
            )}
            {fullscreen && <Pressable onPress={() => setFullscreen(false)} style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 8 }}><Ionicons name="contract-outline" size={18} color="#fff" /></Pressable>}
          </View>
        </GestureDetector>
      </View>
      <View style={{ height: bottomH + insets.bottom, paddingBottom: insets.bottom, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        <IconButton icon="chevron-back" size={18} onPress={() => goto(pageIndex - 1)} disabled={pageIndex === 0} label="이전 페이지" />
        <Pressable onPress={() => setSheet('goto')} style={{ paddingHorizontal: 8 }}><Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>{pageIndex + 1} <Text style={{ color: colors.textMuted, fontWeight: '500' }}>/ {doc.pageCount}</Text></Text></Pressable>
        <IconButton icon="chevron-forward" size={18} onPress={() => goto(pageIndex + 1)} disabled={pageIndex >= doc.pageCount - 1} label="다음 페이지" />
        <View style={{ flex: 1, height: 4, backgroundColor: colors.surfaceAlt, borderRadius: 2, marginHorizontal: 8 }}><View style={{ width: `${((pageIndex + 1) / doc.pageCount) * 100}%`, height: 4, backgroundColor: colors.primary, borderRadius: 2 }} /></View>
        <IconButton icon={doc.bookmarks.includes(pageIndex) ? 'bookmark' : 'bookmark-outline'} size={18} active={doc.bookmarks.includes(pageIndex)} onPress={() => store.toggleBookmark(doc.id, pageIndex)} label="북마크" />
        <Pressable onPress={() => setZoom(1)} style={{ paddingHorizontal: 6 }}><Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '600' }}>{Math.round(zoom * 100)}%</Text></Pressable>
        <IconButton icon="remove-circle-outline" size={18} onPress={() => setZoom((z) => Math.max(0.6, z - 0.25))} /><IconButton icon="add-circle-outline" size={18} onPress={() => setZoom((z) => Math.min(4, z + 0.25))} />
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
