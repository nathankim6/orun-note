import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, Text, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout } from '@/theme';
import { Badge, Button, Card, Chip, Dialog, Empty, IconButton, Input, Muted, Row, Sheet, T, ProgressBar, ListItem } from '@/components/ui';
import { PageHeader } from '@/components/Header';
import { Logo } from '@/components/Logo';
import { COVER_COLORS, useDocsStore } from '@/store/docs';
import { useInkStore } from '@/store/ink';
import { pickAndImportPdf, deleteDocFiles, resolveUri } from '@/lib/files';
import { createSampleDoc } from '@/lib/samplePdf';
import { PdfPage } from '@/features/viewer/PdfPage';
import { fmtBytes, timeAgo } from '@/utils/format';
import { Doc } from '@/data/types';

function Cover({ doc, width }: { doc: Doc; width: number }) {
  const [uri, setUri] = useState<string | null>(null); useEffect(() => { resolveUri(doc).then(setUri); }, [doc.id]);
  const p = doc.pages[0]; const h = p ? (p.height / p.width) * width : width * 1.38;
  return <View style={{ width, height: h, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }}>{uri ? <PdfPage uri={uri} index={0} width={width} height={h} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="document-outline" size={28} color="#bbb" /></View>}<View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: doc.coverColor }} /></View>;
}

export default function Library() {
  const { colors } = useTheme(); const { isTablet, width, columns } = useLayout(); const router = useRouter();
  const { docs, folders, remove, createFolder, deleteFolder, moveToFolder, update, openTab, showToast } = useDocsStore(); const inkPages = useInkStore((s) => s.pages);
  const [folder, setFolder] = useState<'all' | 'fav' | string>('all'); const [q, setQ] = useState(''); const [select, setSelect] = useState(false); const [selected, setSelected] = useState<string[]>([]); const [sort, setSort] = useState<'recent' | 'title' | 'added'>('recent');
  const [folderSheet, setFolderSheet] = useState(false); const [newFolder, setNewFolder] = useState(''); const [confirmDel, setConfirmDel] = useState(false); const [busy, setBusy] = useState<string | null>(null); const [rename, setRename] = useState<Doc | null>(null); const [renameText, setRenameText] = useState('');
  const list = useMemo(() => Object.values(docs).filter((d) => (folder === 'all' ? true : folder === 'fav' ? d.favorite : d.folderId === folder) && (!q || d.title.toLowerCase().includes(q.toLowerCase()) || d.fileName.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'added' ? (b.createdAt > a.createdAt ? 1 : -1) : ((b.lastOpenedAt ?? b.createdAt) > (a.lastOpenedAt ?? a.createdAt) ? 1 : -1)), [docs, folder, q, sort]);
  const tileW = Math.floor((width - (isTablet ? 90 : 0) - 32 - (columns - 1) * 16) / columns);
  const recent = Object.values(docs).filter((d) => d.lastOpenedAt).sort((a, b) => (b.lastOpenedAt! > a.lastOpenedAt! ? 1 : -1))[0];
  const strokeCount = (d: Doc) => Object.entries(inkPages).filter(([k]) => k.startsWith(d.id + ':')).reduce((a, [, p]) => a + p.strokes.length, 0);
  const doImport = async () => { try { setBusy('PDF 가져오는 중...'); const d = await pickAndImportPdf(); setBusy(null); if (d) { showToast(`'${d.title}' 추가됨 · ${d.pageCount}페이지`); openTab(d.id); router.push(`/viewer/${d.id}`); } } catch (e: any) { setBusy(null); showToast('PDF를 열 수 없어요: ' + (e?.message ?? '알 수 없는 오류')); } };
  const doSample = async () => { try { setBusy('샘플 문제지 만드는 중...'); const d = await createSampleDoc(); setBusy(null); showToast('샘플 문제지를 추가했어요'); openTab(d.id); router.push(`/viewer/${d.id}`); } catch (e: any) { setBusy(null); showToast('샘플 생성 실패: ' + (e?.message ?? '')); } };
  const open = (d: Doc) => { openTab(d.id); router.push(`/viewer/${d.id}`); };
  const toggleSel = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PageHeader title="내 서재" subtitle={`${Object.keys(docs).length}개 문서`} right={<Row gap={0}><IconButton icon="add-circle" size={26} color={colors.primary} onPress={doImport} label="PDF 가져오기" /><IconButton icon={select ? 'checkmark-done' : 'checkbox-outline'} active={select} onPress={() => { setSelect(!select); setSelected([]); }} /></Row>} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 12 }}><Ionicons name="search" size={18} color={colors.textFaint} /><TextInput value={q} onChangeText={setQ} placeholder="문서 제목으로 찾기" placeholderTextColor={colors.textFaint} style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, color: colors.text }} /></View>
        {busy && <Card style={{ marginBottom: 12 }}><Row><ActivityIndicator color={colors.primary} /><T>{busy}</T></Row></Card>}
        {recent && !q && folder === 'all' && (
          <Card onPress={() => open(recent)} style={{ marginBottom: 14 }}>
            <Row gap={14}><Cover doc={recent} width={56} /><View style={{ flex: 1 }}><Muted variant="caption">이어서 보기 · {timeAgo(recent.lastOpenedAt!)}</Muted><T variant="bodyBold" numberOfLines={1}>{recent.title}</T><View style={{ marginTop: 6 }}><ProgressBar value={(recent.lastPage + 1) / recent.pageCount} /></View><Muted variant="caption" style={{ marginTop: 3 }}>{recent.lastPage + 1}/{recent.pageCount}p · {recent.cycle}회독 · 필기 {strokeCount(recent)}획</Muted></View><View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="play" size={20} color="#fff" /></View></Row>
          </Card>)}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center' }}>
          <Chip label="전체" active={folder === 'all'} onPress={() => setFolder('all')} /><Chip label="즐겨찾기" icon="star" active={folder === 'fav'} onPress={() => setFolder('fav')} />
          {folders.map((f) => <Chip key={f.id} label={f.name} icon="folder" color={f.color} active={folder === f.id} onPress={() => setFolder(f.id)} />)}
          <Chip label="폴더 추가" icon="add" onPress={() => setFolderSheet(true)} />
        </ScrollView>
        <Row justify="space-between" style={{ marginTop: 14, marginBottom: 6 }}>
          <Muted variant="caption">{list.length}개</Muted>
          <Row gap={10}>{([['recent', '최근 열람순'], ['title', '제목순'], ['added', '추가순']] as const).map(([k, l]) => <Pressable key={k} onPress={() => setSort(k)}><Text style={{ color: sort === k ? colors.primary : colors.textMuted, fontSize: 12, fontWeight: '600' }}>{l}</Text></Pressable>)}{folder !== 'all' && folder !== 'fav' && <Pressable onPress={() => { deleteFolder(folder); setFolder('all'); }}><Text style={{ color: colors.danger, fontSize: 12, fontWeight: '600' }}>폴더 삭제</Text></Pressable>}</Row>
        </Row>
        {list.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Logo size={56} withText={false} />
            <T variant="h2" style={{ marginTop: 16 }}>PDF를 가져와 바로 필기하세요</T>
            <Muted center style={{ marginTop: 6, maxWidth: 320 }}>문제집·프린트·기출 PDF를 올리면 종이처럼 펜으로 풀고, 필기는 페이지별로 자동 저장·버전 관리돼요.</Muted>
            <Row style={{ marginTop: 18 }}><Button title="PDF 가져오기" icon="cloud-upload-outline" onPress={doImport} /><Button title="샘플 문제지" variant="secondary" icon="sparkles-outline" onPress={doSample} /></Row>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {list.map((d) => { const sel = selected.includes(d.id); return (
              <Pressable key={d.id} onPress={() => (select ? toggleSel(d.id) : open(d))} onLongPress={() => { setSelect(true); toggleSel(d.id); }} style={{ width: tileW }}>
                <View><Cover doc={d} width={tileW} />
                  {select && <View style={{ position: 'absolute', top: 6, right: 6 }}><Ionicons name={sel ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={sel ? colors.primary : colors.textFaint} /></View>}
                  {!select && <Pressable onPress={() => update(d.id, { favorite: !d.favorite })} hitSlop={6} style={{ position: 'absolute', top: 6, right: 6 }}><Ionicons name={d.favorite ? 'star' : 'star-outline'} size={18} color={d.favorite ? colors.accent : colors.textFaint} /></Pressable>}
                  <View style={{ position: 'absolute', left: 8, bottom: 6, flexDirection: 'row', gap: 4 }}>{d.lastOpenedAt && <Badge label={`${Math.round(((d.lastPage + 1) / d.pageCount) * 100)}%`} tone="info" />}{strokeCount(d) > 0 && <Badge label="필기" tone="primary" />}</View>
                </View>
                <T variant="label" numberOfLines={2} style={{ marginTop: 8 }}>{d.title}</T>
                <Muted variant="caption">{d.pageCount}페이지 · {fmtBytes(d.size)}{d.maxCycle > 1 ? ` · ${d.cycle}회독` : ''}</Muted>
                {!select && <Row gap={0} style={{ marginTop: 2 }}><Pressable onPress={() => { setRename(d); setRenameText(d.title); }} hitSlop={6}><Text style={{ fontSize: 11, color: colors.textMuted }}>이름 변경</Text></Pressable></Row>}
              </Pressable>); })}
          </View>)}
      </ScrollView>
      {!select && list.length > 0 && <Pressable onPress={doImport} style={{ position: 'absolute', right: 20, bottom: 24, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 }}><Ionicons name="add" size={20} color="#fff" /><Text style={{ color: '#fff', fontWeight: '800' }}>PDF 가져오기</Text></Pressable>}
      {select && selected.length > 0 && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 20, backgroundColor: colors.text, borderRadius: 16, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: colors.bg, fontWeight: '700', marginLeft: 8, flex: 1 }}>{selected.length}개 선택</Text>
          <Button small variant="ghost" title="폴더 이동" onPress={() => setFolderSheet(true)} style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
          <Button small variant="danger" title="삭제" onPress={() => setConfirmDel(true)} />
        </View>)}
      <Sheet visible={folderSheet} onClose={() => setFolderSheet(false)} title={selected.length ? '폴더로 이동' : '폴더'}>
        {folders.map((f) => <ListItem key={f.id} icon="folder" title={f.name} onPress={() => { if (selected.length) { moveToFolder(selected, f.id); setSelected([]); setSelect(false); showToast(`${f.name}(으)로 이동했어요`); } setFolderSheet(false); }} />)}
        {selected.length > 0 && <ListItem icon="folder-open-outline" title="폴더에서 꺼내기" onPress={() => { moveToFolder(selected, undefined); setSelected([]); setSelect(false); setFolderSheet(false); }} />}
        <Row style={{ marginTop: 8 }} align="flex-start"><View style={{ flex: 1 }}><Input placeholder="새 폴더 이름" value={newFolder} onChangeText={setNewFolder} /></View><Button title="만들기" onPress={() => { if (!newFolder.trim()) return; const id = createFolder(newFolder.trim(), COVER_COLORS[folders.length % COVER_COLORS.length]); if (selected.length) moveToFolder(selected, id); setNewFolder(''); setFolderSheet(false); }} /></Row>
      </Sheet>
      <Sheet visible={!!rename} onClose={() => setRename(null)} title="이름 변경" height={260}><Input value={renameText} onChangeText={setRenameText} autoFocus /><Row><Button title="저장" style={{ flex: 1 }} onPress={() => { if (rename) update(rename.id, { title: renameText.trim() || rename.title }); setRename(null); }} />{COVER_COLORS.slice(0, 6).map((c) => <Pressable key={c} onPress={() => rename && update(rename.id, { coverColor: c })} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c }} />)}</Row></Sheet>
      <Dialog visible={confirmDel} title="문서를 삭제할까요?" message="PDF 파일과 필기가 함께 삭제됩니다. 되돌릴 수 없습니다." onClose={() => setConfirmDel(false)} actions={[{ label: '취소', onPress: () => setConfirmDel(false) }, { label: '삭제', variant: 'danger', onPress: async () => { for (const id of selected) { const d = docs[id]; if (d) { await deleteDocFiles(d); useInkStore.getState().clearPackage(d.id + ':'); remove(id); } } setSelected([]); setSelect(false); setConfirmDel(false); showToast('삭제했어요'); } }]} />
    </View>
  );
}
