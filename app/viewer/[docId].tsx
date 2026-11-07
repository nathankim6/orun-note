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
import { DocumentView, DocHandle, PageBox } from '@/features/viewer/DocumentView';
import { ZoomPad, PadFrame, PadRegion } from '@/features/viewer/ZoomPad';
import type { InkOpts } from '@/features/viewer/InkCanvas';
import { SubDocWindow } from '@/features/viewer/SubDocWindow';
import { pickImageForPage, addBlankPages } from '@/lib/files';
import { ImageBox } from '@/data/types';
import { InkCanvas, InkHandle } from '@/features/viewer/InkCanvas';
import { WordLookup } from '@/features/viewer/WordLookup';
import { cachedWords, loadWords } from '@/features/viewer/words';
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
  const [layout, setLayout] = useState(prefs.defaultLayoutMode); const [fullscreen, setFullscreen] = useState(false);
  const docRef = useRef<DocHandle>(null); const [zoomPct, setZoomPct] = useState(1);
  const [locked, setLocked] = useState(false); const [zoomPad, setZoomPad] = useState(false); const [padRegions, setPadRegions] = useState<Record<number, PadRegion>>({});
  // Samsung-Notes handwriting options (stable object so the canvas gestures are not rebuilt every render)
  const inkOpts = useMemo<InkOpts>(() => ({ fixedWidth: !!prefs.fixedWidth, straightHighlighter: !!prefs.straightHighlighter, eraseHighlighterOnly: !!prefs.eraseHighlighterOnly, lassoMode: prefs.lassoMode ?? 'free', lassoPartial: prefs.lassoPartial ?? true, neatShape: !!prefs.shapeSnap }), [prefs.fixedWidth, prefs.straightHighlighter, prefs.eraseHighlighterOnly, prefs.lassoMode, prefs.lassoPartial, prefs.shapeSnap]);
  const pageSizes = useMemo(() => (doc?.pages ?? []).map((p) => ({ width: p.width, height: p.height })), [doc?.pages]);
  // Text layer for tap-to-define: load current and neighbouring pages in the background.
  useEffect(() => { if (!uri || !doc || doc.kind === 'blank') return; let alive = true; [pageIndex, pageIndex + 1, pageIndex - 1].filter((i) => i >= 0 && i < doc.pageCount).forEach((i) => loadWords(uri, doc.pages[i].index).then(() => alive && setWordsVer((v) => v + 1))); return () => { alive = false; }; }, [uri, pageIndex, doc?.id]);
  const [cfg, setCfg] = useState<ToolConfig>(() => { const v = useSettingsStore.getState().viewer; const t = (v.lastTool as Tool) || 'pen'; const pr = v.toolPresets?.[t] ?? v.toolPresets?.pen ?? { color: '#172033', width: 2, opacity: 1 }; return { tool: ['pen', 'highlighter'].includes(t) ? t : 'pen', color: pr.color, width: pr.width, shape: 'rectangle', opacity: pr.opacity }; }); const [textFont, setTextFont] = useState<string>('system'); const [lookup, setLookup] = useState<{ text: string; abs: { x: number; y: number }; rects: { x: number; y: number; w: number; h: number }[]; k: string } | null>(null); const [wordsVer, setWordsVer] = useState(0); const [subDoc, setSubDoc] = useState<string | null | 'pick'>(null); const prevPen = useRef<ToolConfig>(cfg); const [recentColors, setRecentColors] = useState<string[]>([]);
  const [leftTab, setLeftTab] = useState<LeftTab | null>(null); const [sheet, setSheet] = useState<null | 'settings' | 'versions' | 'cycle' | 'more' | 'tabs' | 'info' | 'goto'>(null); const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const inkRefs = useRef<Record<string, InkHandle | null>>({}); const scrollRef = useRef<any>(null);
  const onCfg = useCallback((p: Partial<ToolConfig>) => setCfg((c) => {
    const next = { ...c, ...p }; const v = useSettingsStore.getState().viewer;
    if (p.tool && p.tool !== c.tool) { const pr = v.toolPresets?.[p.tool]; if (pr) { next.color = p.color ?? pr.color; next.width = p.width ?? pr.width; next.opacity = p.opacity ?? pr.opacity; } else Object.assign(next, toolDefaults(p.tool, next), p); }
    if (p.color) setRecentColors((r) => Array.from(new Set([p.color!, ...r])).slice(0, 6));
    if (['pen', 'highlighter'].includes(next.tool)) prevPen.current = next;
    // remember per-tool settings and last tool across launches
    if (['pen', 'highlighter', 'eraser', 'vectorEraser', 'shape', 'text'].includes(next.tool)) useSettingsStore.getState().setViewer({ toolPresets: { ...v.toolPresets, [next.tool]: { color: next.color, width: next.width, opacity: next.opacity } }, ...(['pen', 'highlighter'].includes(next.tool) ? { lastTool: next.tool } : {}) });
    return next; }), []);

  useEffect(() => { if (doc) store.touch(doc.id, pageIndex); }, [pageIndex, doc?.id]);
  const prevPage = useRef(pageIndex);
  useEffect(() => { if (doc && prevPage.current !== pageIndex) { ink.snapshot(inkKey(doc.id, cycle, String(prevPage.current))); prevPage.current = pageIndex; } }, [pageIndex]);

  if (!doc) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><T>문서를 찾을 수 없어요</T><Button title="돌아가기" style={{ marginTop: 12 }} onPress={() => router.replace('/(tabs)')} /></View>;
  if (missing) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 }}><Ionicons name="document-lock-outline" size={48} color={colors.textFaint} /><T variant="h3" style={{ marginTop: 12 }}>PDF 파일을 찾을 수 없어요</T><Muted center style={{ marginTop: 6 }}>원본 파일이 삭제되었거나 (웹) 브라우저 저장소가 비워졌어요. 다시 가져와 주세요.</Muted><Button title="내 서재로" style={{ marginTop: 16 }} onPress={() => router.replace('/(tabs)')} /></View>;

  const leftW = isTablet ? 300 : 0;
  const toolbarH = fullscreen ? 0 : 50; const headerH = fullscreen ? 0 : 44; const tabsH = store.openTabs.length > 1 && !fullscreen ? 34 : 0; const bottomH = 40;
  const availW = winW - (leftTab && isTablet ? leftW : 0); const padH = zoomPad ? Math.round(Math.min(250, Math.max(170, winH * 0.27))) : 0;
  const availH = winH - insets.top - insets.bottom - toolbarH - headerH - tabsH - bottomH - padH;
  const docMode = layout === 'twoPage' && availW > 700 ? 'twoPage' : layout === 'horizontal' ? 'horizontal' : 'vertical';
  const pageAt = (i: number) => doc.pages[i] ?? doc.pages[0];
  const padRegion = (i: number): PadRegion => padRegions[i] ?? { x: pageAt(i).width * 0.05, y: pageAt(i).height * 0.12, w: pageAt(i).width * 0.45 };
  const padRegionH = (r: PadRegion) => (r.w * (padH - 20)) / Math.max(1, availW - 120);
  const goto = (i: number) => { i = Math.max(0, Math.min(doc.pageCount - 1, i)); setPageIndex(i); docRef.current?.goto(i); };

  const clearAllInk = () => { for (let i = 0; i < doc.pageCount; i++) { const k = inkKey(doc.id, cycle, String(i)); if (ink.pages[k]?.strokes.length) ink.snapshot(k, '전체 삭제 전'); } ink.clearPackage(`${doc.id}:${cycle}:`); toast('이 문서의 필기를 모두 제거했어요'); };
  const clearPage = () => { const k = inkKey(doc.id, cycle, String(pageIndex)); ink.snapshot(k, '삭제 전'); ink.clear(k); toast('현재 페이지 필기를 삭제했어요 (버전 기록에서 복원 가능)'); };
  const exit = () => { ink.snapshot(inkKey(doc.id, cycle, String(pageIndex))); router.canGoBack() ? router.back() : router.replace('/(tabs)'); };
  const activeInk = inkRefs.current[String(pageIndex)]; const inkEnabled = true; // hand tool: the canvas ignores drags (pan fails) but still receives taps for word lookup

  // Page content at resolution `rs` (the DocumentView scales it back down; keeps ink and PDF crisp when zoomed).
  const renderPage = (pi: number, box: PageBox, rs: number) => { const s = box.s * rs, w = box.w * rs, h = box.h * rs; const k = inkKey(doc.id, cycle, String(pi)); const pi_ = ink.pages[k]; const strokes = pi_?.strokes ?? []; const textBoxes = pi_?.textBoxes ?? []; return (
    <View key={pi} style={{ width: w, height: h, backgroundColor: '#fff' }}>
      <PdfPage uri={uri} index={pageAt(pi).index} width={w} height={h} template={doc.template} />
      {/* frame for 간편 입력창 is rendered after the ink layer (below) */}
      <InkCanvas width={w} height={h} s={s} strokes={strokes} textBoxes={textBoxes} images={pi_?.images ?? []} onImages={(next: ImageBox[]) => ink.setImages(k, next)} textFont={textFont} words={doc.kind === 'blank' ? null : cachedWords(uri, pageAt(pi).index)} onLookup={(text, abs, rects) => setLookup({ text, abs, rects, k })} opts={inkOpts} cfg={cfg} enabled={inkEnabled} fingerDraw={prefs.fingerDraw} lineSnap={prefs.lineSnap}
        onStrokes={(next: Stroke[]) => { ink.setStrokes(k, next); if (cfg.tool === 'shape' && prefs.penAutoReturn && next.length > strokes.length) setTimeout(() => setCfg(prevPen.current), 60); }}
        onTextBoxes={(next: TextBox[]) => useInkStore.setState((st) => ({ pages: { ...st.pages, [k]: { ...(st.pages[k] ?? { strokes: [], textBoxes: [], versions: [], updatedAt: '' }), textBoxes: next } } }))}
        historyRef={{ get current() { return inkRefs.current[String(pi)]; }, set current(v) { inkRefs.current[String(pi)] = v; } } as any} onHistory={(h) => pi === pageIndex && setHist(h)} />
      {zoomPad && pi === pageIndex && <PadFrame region={padRegion(pi)} regionH={padRegionH(padRegion(pi))} s={s} pageW={pageAt(pi).width} pageH={pageAt(pi).height} setRegion={(r) => setPadRegions((m) => ({ ...m, [pi]: r }))} />}
    </View>); };

  const zoomBy = (f: number) => docRef.current?.zoomBy(f);
  const resetZoom = () => docRef.current?.fit();
  const pages = Array.from({ length: doc.pageCount }, (_, i) => i);
  const pageInk = ink.pages[inkKey(doc.id, cycle, String(pageIndex))];

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#0F1012' : '#E6EDF7', paddingTop: insets.top }}>
      {!fullscreen && <Toolbar cfg={cfg} onCfg={onCfg} onCfgReplace={(c) => { setCfg(c); if (['pen', 'highlighter'].includes(c.tool)) prevPen.current = c; }} onUndo={() => activeInk?.undo()} onRedo={() => activeInk?.redo()} canUndo={hist.canUndo} canRedo={hist.canRedo} onClear={clearPage} onClearAll={clearAllInk} onBack={exit} onMore={() => setSheet('more')} recentColors={recentColors} textFont={textFont} onTextFont={setTextFont} onSubDoc={() => setSubDoc(subDoc ? null : 'pick')} zoomPad={zoomPad} onZoomPad={() => setZoomPad((v) => !v)} locked={locked} onLock={() => { setLocked((v) => { toast(v ? '캔버스 고정을 해제했습니다.' : '캔버스를 고정했습니다. 확대/축소와 이동이 잠겨요.'); return !v; }); }} onInsertImage={async () => { const im = await pickImageForPage(); if (!im) return; const k = inkKey(doc.id, cycle, String(pageIndex)); const pg = pageAt(pageIndex); const w = Math.min(pg.width * 0.35, im.width); const h = w * (im.height / im.width); ink.setImages(k, [...(ink.pages[k]?.images ?? []), { id: Math.random().toString(36).slice(2, 10), rect: { x: (pg.width - w) / 2, y: pg.height * 0.1, w, h }, uri: im.uri, createdAt: Date.now() }]); setCfg((c) => ({ ...c, tool: 'hand' })); toast('사진을 넣었어요. 드래그로 옮기고 모서리로 크기를 바꿔요'); }} />}
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
          <IconButton icon={layout === 'horizontal' ? 'phone-landscape-outline' : layout === 'twoPage' ? 'book-outline' : 'reorder-four-outline'} onPress={() => { const next = layout === 'horizontal' ? 'twoPage' : layout === 'twoPage' ? 'vertical' : 'horizontal'; setLayout(next); settings.setViewer({ defaultLayoutMode: next }); toast(next === 'horizontal' ? '스크롤 방향: 좌우' : next === 'twoPage' ? '스크롤 방향: 2페이지씩 좌우' : '스크롤 방향: 상하'); }} label="스크롤 방향" />
          <IconButton icon="ellipsis-horizontal" onPress={() => setSheet('more')} label="더보기" />
          <IconButton icon="expand-outline" onPress={() => setFullscreen(true)} label="전체 화면" />
        </View>)}
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {leftTab && isTablet && <LeftPanel tab={leftTab} setTab={setLeftTab} width={leftW} onClose={() => setLeftTab(null)} doc={doc} uri={uri} pageIndex={pageIndex} onGoto={goto} onToggleBookmark={(i) => store.toggleBookmark(doc.id, i)} cycle={cycle} />}
        {/* Narrow screens (phones / split view): the same panel as a modal sheet so the ≡ button always shows the page grid */}
        {leftTab && !isTablet && <Modal visible transparent animationType="slide" onRequestClose={() => setLeftTab(null)}><Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' }} onPress={() => setLeftTab(null)} /><View style={{ height: '70%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' }}><LeftPanel tab={leftTab} setTab={setLeftTab} width={winW} onClose={() => setLeftTab(null)} doc={doc} uri={uri} pageIndex={pageIndex} onGoto={(i) => { goto(i); setLeftTab(null); }} onToggleBookmark={(i) => store.toggleBookmark(doc.id, i)} cycle={cycle} /></View></Modal>}
        <View style={{ flex: 1 }} collapsable={false}>
            {!uri ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /><Muted variant="caption" style={{ marginTop: 8 }}>PDF를 여는 중...</Muted></View>
            : <DocumentView ref={docRef} key={doc.id} width={availW} height={availH} pages={pageSizes} mode={docMode} startOdd={prefs.twoPageStartOdd} initialPage={pageIndex} renderPage={renderPage} dark={dark}
                mousePans={cfg.tool === 'hand'} doubleTapZoom={prefs.doubleTapZoomEnabled} onPageChange={setPageIndex} onZoomSettled={setZoomPct} locked={locked}
                onPullAddPage={doc.kind === 'blank' ? () => { addBlankPages(doc, 1); toast('새 페이지를 추가했어요'); } : undefined} />}
            {fullscreen && <Pressable onPress={() => setFullscreen(false)} style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 8 }}><Ionicons name="contract-outline" size={18} color="#fff" /></Pressable>}
        </View>
      </View>
      {lookup && <WordLookup text={lookup.text} anchor={lookup.abs} onClose={() => setLookup(null)} onLookup={(q) => setLookup((l) => l && { ...l, text: q })} onHighlight={() => { const k = lookup.k; const add = lookup.rects.map((r) => ({ id: Math.random().toString(36).slice(2, 10), tool: 'highlighter' as Tool, color: '#FDE68A', width: r.h * 0.95, opacity: 0.45, points: [{ x: r.x, y: r.y + r.h / 2 }, { x: r.x + r.w, y: r.y + r.h / 2 }], createdAt: Date.now() })); ink.setStrokes(k, [...(ink.pages[k]?.strokes ?? []), ...add]); setLookup(null); toast('형광펜으로 표시했어요'); }} />}
      {zoomPad && uri && (() => { const k = inkKey(doc.id, cycle, String(pageIndex)); const pg = ink.pages[k]; return (
        <ZoomPad height={padH} uri={uri} pageW={pageAt(pageIndex).width} pageH={pageAt(pageIndex).height} sourceIndex={pageAt(pageIndex).index} template={doc.template}
          region={padRegion(pageIndex)} setRegion={(r) => setPadRegions((m) => ({ ...m, [pageIndex]: r }))} strokes={pg?.strokes ?? []} textBoxes={pg?.textBoxes ?? []} images={pg?.images ?? []}
          onStrokes={(next) => ink.setStrokes(k, next)} onTextBoxes={(next) => useInkStore.setState((st) => ({ pages: { ...st.pages, [k]: { ...(st.pages[k] ?? { strokes: [], textBoxes: [], versions: [], updatedAt: '' }), textBoxes: next } } }))} onImages={(next) => ink.setImages(k, next)}
          cfg={cfg} opts={inkOpts} textFont={textFont} onClose={() => setZoomPad(false)} />); })()}
      {subDoc && <SubDocWindow mode={subDoc === 'pick' ? 'pick' : 'show'} docId={subDoc === 'pick' ? null : subDoc} excludeId={doc.id} onPick={(id) => setSubDoc(id)} onClose={() => setSubDoc(null)} />}
      <View style={{ height: bottomH + insets.bottom, paddingBottom: insets.bottom, backgroundColor: 'rgba(255,255,255,0.72)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.8)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        <IconButton icon="chevron-back" size={18} onPress={() => goto(pageIndex - 1)} disabled={pageIndex === 0} label="이전 페이지" />
        <Pressable onPress={() => setSheet('goto')} style={{ paddingHorizontal: 8 }}><Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>{pageIndex + 1} <Text style={{ color: colors.textMuted, fontWeight: '500' }}>/ {doc.pageCount}</Text></Text></Pressable>
        <IconButton icon="chevron-forward" size={18} onPress={() => goto(pageIndex + 1)} disabled={pageIndex >= doc.pageCount - 1} label="다음 페이지" />
        {doc.kind === 'blank' && <IconButton icon="add-circle-outline" size={20} color={colors.primary} onPress={() => { addBlankPages(doc, 1); setTimeout(() => goto(doc.pageCount), 50); }} label="페이지 추가" />}
        <View style={{ flex: 1, height: 4, backgroundColor: colors.surfaceAlt, borderRadius: 2, marginHorizontal: 8 }}><View style={{ width: `${((pageIndex + 1) / doc.pageCount) * 100}%`, height: 4, backgroundColor: colors.primary, borderRadius: 2 }} /></View>
        <IconButton icon={doc.bookmarks.includes(pageIndex) ? 'bookmark' : 'bookmark-outline'} size={18} active={doc.bookmarks.includes(pageIndex)} onPress={() => store.toggleBookmark(doc.id, pageIndex)} label="북마크" />
        <Pressable onPress={resetZoom} style={{ paddingHorizontal: 6 }}><Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '600' }}>{Math.round(zoomPct * 100)}%</Text></Pressable>
        <IconButton icon="remove-circle-outline" size={18} onPress={() => zoomBy(1 / 1.25)} label="축소" /><IconButton icon="add-circle-outline" size={18} onPress={() => zoomBy(1.25)} label="확대" />
      </View>

      {!isTablet && leftTab && <Sheet visible onClose={() => setLeftTab(null)} height="80%"><View style={{ height: winH * 0.7, marginHorizontal: -16 }}><LeftPanel tab={leftTab} setTab={setLeftTab} width={winW} onClose={() => setLeftTab(null)} doc={doc} uri={uri} pageIndex={pageIndex} onGoto={(i) => { goto(i); setLeftTab(null); }} onToggleBookmark={(i) => store.toggleBookmark(doc.id, i)} cycle={cycle} /></View></Sheet>}
      <SettingsSheet visible={sheet === 'settings'} onClose={() => setSheet(null)} layout={layout} setLayout={(l) => { setLayout(l); settings.setViewer({ defaultLayoutMode: l }); }} />
      <VersionSheet visible={sheet === 'versions'} onClose={() => setSheet(null)} pageIndex={pageIndex} versions={pageInk?.versions ?? []} onRestore={(id) => { ink.restore(inkKey(doc.id, cycle, String(pageIndex)), id); setSheet(null); toast('복원 완료'); }} onSnapshot={() => { ink.snapshot(inkKey(doc.id, cycle, String(pageIndex)), '수동 저장'); toast('현재 필기를 버전으로 저장했어요'); }} />
      <CycleSheet visible={sheet === 'cycle'} onClose={() => setSheet(null)} cycle={cycle} maxCycle={doc.maxCycle} onSwitch={(c) => store.switchCycle(doc.id, c)} onNew={() => { const c = store.startNewCycle(doc.id); toast(`${c}회독을 시작했어요`); }} onResetInk={(scope) => { if (scope === 'all') ink.clearPackage(doc.id + ':'); else ink.clearPackage(`${doc.id}:${cycle}:`); toast('필기가 초기화되었습니다'); }} />
      <Sheet visible={sheet === 'more'} onClose={() => setSheet(null)} title="메뉴">
        <ListItem icon="lock-closed-outline" title="보안 모드" subtitle="암호화 저장 · 캡처/녹화 차단 · 공유/내보내기 없음" right={<Badge label="켜짐" tone="success" />} />
        <ListItem icon="scan-outline" title="화면에 맞추기" subtitle="현재 페이지 전체가 보이게" onPress={() => { setSheet(null); docRef.current?.fitPage(); }} />
        <ListItem icon="resize-outline" title="페이지 너비에 맞추기" onPress={() => { setSheet(null); docRef.current?.fit(); }} />
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
