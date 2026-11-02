import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, Text, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Badge, Empty, IconButton, Muted, Row, T } from '@/components/ui';
import { Doc } from '@/data/types';
import { PdfPage } from './PdfPage';
import { PdfRenderer, PdfOutlineItem } from '../../../modules/pdf-renderer';
import { useInkStore, inkKey } from '@/store/ink';
import { splitDoc } from '@/lib/files';

export type LeftTab = 'pages' | 'bookmarks' | 'outline' | 'search';
export const LEFT_TABS: { k: LeftTab; label: string; icon: any }[] = [{ k: 'pages', label: '페이지', icon: 'grid-outline' }, { k: 'bookmarks', label: '북마크', icon: 'bookmark-outline' }, { k: 'outline', label: '목차', icon: 'list-outline' }, { k: 'search', label: '검색', icon: 'search-outline' }];
type Common = { doc: Doc; uri: string | null; pageIndex: number; onGoto: (i: number) => void; onToggleBookmark: (i: number) => void; cycle: number };

export function LeftPanel({ tab, setTab, width, onClose, ...c }: Common & { tab: LeftTab; setTab: (t: LeftTab) => void; width: number; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ width, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border }}>
      <Row style={{ borderBottomWidth: 1, borderBottomColor: colors.border, padding: 6 }} gap={2}>
        {LEFT_TABS.map((t) => <Pressable key={t.k} onPress={() => setTab(t.k)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 8, backgroundColor: tab === t.k ? colors.primarySoft : 'transparent' }}><Ionicons name={t.icon} size={15} color={tab === t.k ? colors.primary : colors.textMuted} /><Text style={{ fontSize: 12, fontWeight: '600', color: tab === t.k ? colors.primary : colors.textMuted }}>{t.label}</Text></Pressable>)}
        <View style={{ flex: 1 }} /><IconButton icon="close" size={16} onPress={onClose} />
      </Row>
      {tab === 'pages' && <PagesGrid {...c} width={width} />}
      {tab === 'bookmarks' && <PagesGrid {...c} width={width} onlyBookmarks />}
      {tab === 'outline' && <OutlineList {...c} />}
      {tab === 'search' && <SearchPanel {...c} />}
    </View>
  );
}

function PagesGrid({ doc, uri, pageIndex, onGoto, onToggleBookmark, width, onlyBookmarks, cycle }: Common & { width: number; onlyBookmarks?: boolean }) {
  const { colors } = useTheme(); const [dense, setDense] = useState(false); const cols = dense ? 3 : 2; const w = (width - 16 - (cols - 1) * 8) / cols;
  // Multi-select → 분할: creates a separate, auto-named document from the selected pages (shares the PDF file).
  const [selectMode, setSelectMode] = useState(false); const [picked, setPicked] = useState<number[]>([]); const [done, setDone] = useState<string | null>(null);
  const togglePick = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  const doSplit = () => { if (!picked.length) return; const nd = splitDoc(doc, picked); setDone(`'${nd.title}' 저장됨`); setPicked([]); setSelectMode(false); setTimeout(() => setDone(null), 2500); };
  const inkPages = useInkStore((s) => s.pages);
  const list = doc.pages.map((p, pos) => ({ ...p, pos })).filter((p) => !onlyBookmarks || doc.bookmarks.includes(p.pos));
  return (
    <View style={{ flex: 1 }}>
      <Row justify="space-between" style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
        <Row gap={6}><T variant="label">{pageIndex + 1} / {doc.pageCount}</T><Pressable onPress={() => { setSelectMode(!selectMode); setPicked([]); }} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: selectMode ? colors.primary : 'rgba(0,0,0,0.05)' }}><Text style={{ fontSize: 11, fontWeight: '700', color: selectMode ? '#fff' : colors.textMuted }}>{selectMode ? `${picked.length}개 선택` : '선택'}</Text></Pressable>{selectMode && picked.length > 0 && <Pressable onPress={doSplit} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.accent }}><Text style={{ fontSize: 11, fontWeight: '700', color: '#172033' }}>분할 저장</Text></Pressable>}</Row>
        <Row gap={0}><IconButton icon={doc.bookmarks.includes(pageIndex) ? 'bookmark' : 'bookmark-outline'} size={16} active={doc.bookmarks.includes(pageIndex)} onPress={() => onToggleBookmark(pageIndex)} /><IconButton icon="grid-outline" size={16} active={dense} onPress={() => setDense(!dense)} /><Pressable onPress={() => onGoto(0)} style={{ paddingHorizontal: 6 }}><Text style={{ fontSize: 12, color: colors.textMuted }}>처음</Text></Pressable><Pressable onPress={() => onGoto(doc.pageCount - 1)} style={{ paddingHorizontal: 6 }}><Text style={{ fontSize: 12, color: colors.textMuted }}>끝</Text></Pressable></Row>
      </Row>
      {done && <View style={{ marginHorizontal: 10, marginBottom: 6, padding: 8, borderRadius: 10, backgroundColor: colors.primarySoft }}><Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>{done} · 내 교재에서 열 수 있어요</Text></View>}
      {list.length === 0 ? <Empty icon="bookmark-outline" title="북마크한 페이지가 없어요" message="하단의 북마크 아이콘으로 추가하세요" /> : (
        <ScrollView contentContainerStyle={{ padding: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {list.map((p) => { const active = p.pos === pageIndex; const h = (p.height / p.width) * w; const inked = (inkPages[inkKey(doc.id, cycle, String(p.pos))]?.strokes.length ?? 0) > 0; return (
            <Pressable key={p.index} onPress={() => (selectMode ? togglePick(p.pos) : onGoto(p.pos))} onLongPress={() => { setSelectMode(true); togglePick(p.pos); }} style={{ width: w }}>
              <View style={{ borderWidth: active || picked.includes(p.pos) ? 2 : 1, borderColor: picked.includes(p.pos) ? colors.accent : active ? colors.primary : colors.border, borderRadius: 6, overflow: 'hidden', height: h }}>
                <PdfPage uri={uri} index={p.index} width={w} height={h} template={doc.template} />
                <Pressable onPress={() => onToggleBookmark(p.pos)} style={{ position: 'absolute', right: 3, top: 2 }}><Ionicons name={doc.bookmarks.includes(p.pos) ? 'bookmark' : 'bookmark-outline'} size={16} color={doc.bookmarks.includes(p.pos) ? colors.primary : colors.textFaint} /></Pressable>
                {inked && <View style={{ position: 'absolute', left: 3, bottom: 3, backgroundColor: colors.primary, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>필기</Text></View>}
              </View>
              <Text style={{ textAlign: 'center', fontSize: 11, color: active ? colors.primary : colors.textMuted, marginTop: 3, fontWeight: active ? '700' : '500' }}>{p.pos + 1}</Text>
            </Pressable>); })}
        </ScrollView>)}
    </View>
  );
}

function OutlineList({ doc, uri, pageIndex, onGoto }: Common) {
  const { colors } = useTheme(); const [items, setItems] = useState<PdfOutlineItem[] | null>(null);
  useEffect(() => { if (!uri) return; PdfRenderer.getOutline(uri).then(setItems); }, [uri]);
  if (items === null) return <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />;
  if (items.length === 0) return <Empty icon="list-outline" title="목차 정보가 없습니다" message="PDF에 포함된 책갈피(outline)가 있으면 여기에 표시돼요" />;
  return <ScrollView>{items.map((t, i) => <Pressable key={i} onPress={() => onGoto(t.pageIndex)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingLeft: 14 + t.level * 14, paddingRight: 14, backgroundColor: pageIndex === t.pageIndex ? colors.primarySoft : 'transparent' }}><Text style={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: t.level === 0 ? '700' : '500' }} numberOfLines={2}>{t.title}</Text><Muted variant="caption">{t.pageIndex + 1}p</Muted></Pressable>)}</ScrollView>;
}

function SearchPanel({ doc, uri, onGoto }: Common) {
  const { colors } = useTheme(); const [q, setQ] = useState(''); const [texts, setTexts] = useState<string[] | null>(null); const [loading, setLoading] = useState(false);
  const ensure = async () => { if (texts || !uri) return; setLoading(true); const out: string[] = []; for (let i = 0; i < doc.pageCount; i++) out.push(await PdfRenderer.getPageText(uri, i)); setTexts(out); setLoading(false); };
  useEffect(() => { if (q.length >= 2) ensure(); }, [q]);
  const hits = useMemo(() => { if (!texts || q.trim().length < 2) return []; const n = q.toLowerCase(); const out: { page: number; snippet: string; count: number }[] = []; texts.forEach((t, i) => { const low = t.toLowerCase(); let idx = low.indexOf(n); if (idx < 0) return; let count = 0; while (idx >= 0 && count < 50) { count++; idx = low.indexOf(n, idx + 1); } const first = low.indexOf(n); out.push({ page: i, snippet: t.slice(Math.max(0, first - 40), first + 60).replace(/\s+/g, ' '), count }); }); return out; }, [texts, q]);
  const noText = texts && texts.every((t) => !t.trim());
  return (
    <View style={{ flex: 1 }}>
      <View style={{ margin: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 8 }}><Ionicons name="search" size={14} color={colors.textFaint} /><TextInput value={q} onChangeText={setQ} placeholder="검색어 입력" placeholderTextColor={colors.textFaint} style={{ flex: 1, padding: 8, color: colors.text, fontSize: 13 }} />{q.length > 0 && <Pressable onPress={() => setQ('')}><Ionicons name="close-circle" size={14} color={colors.textFaint} /></Pressable>}</View>
      {loading ? <Row style={{ padding: 12 }}><ActivityIndicator color={colors.primary} /><Muted variant="caption">검색 인덱스 로딩 중...</Muted></Row> : <Muted variant="caption" style={{ paddingHorizontal: 12 }}>{q.length < 2 ? '검색어를 입력하세요' : noText ? '검색 가능한 텍스트가 없습니다 (스캔 PDF 또는 Android)' : `${hits.length}개 페이지 일치`}</Muted>}
      <ScrollView>{hits.map((h) => <Pressable key={h.page} onPress={() => onGoto(h.page)} style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}><Row justify="space-between"><Badge label={`${h.page + 1}p`} /><Muted variant="caption">{h.count}개 일치</Muted></Row><Text style={{ fontSize: 12, color: colors.text, marginTop: 4 }} numberOfLines={2}>…{h.snippet}…</Text></Pressable>)}</ScrollView>
    </View>
  );
}
