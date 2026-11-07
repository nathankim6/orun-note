import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, Text, TextInput, ActivityIndicator, RefreshControl, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout } from '@/theme';
import { Badge, Button, Card, Chip, Dialog, Empty, IconButton, Input, Muted, Row, Sheet, T, ProgressBar, ListItem } from '@/components/ui';
import { PageHeader } from '@/components/Header';
import { GlassBackground } from '@/components/Glass';
import { Logo } from '@/components/Logo';
import { COVER_COLORS, useDocsStore } from '@/store/docs';
import { useInkStore } from '@/store/ink';
import { useSession } from '@/store/session';
import { pickAndImportPdf, deleteDocFiles, resolveUri, downloadMaterial, createBlankDoc } from '@/lib/files';
import { OrunLogo } from '@/components/OrunLogo';
import { PdfPage, BlankPaper } from '@/features/viewer/PdfPage';
import { fmtBytes, timeAgo } from '@/utils/format';
import { Doc } from '@/data/types';
import { Material } from '@/lib/api';

function Cover({ doc, width }: { doc: Doc; width: number }) {
  const [uri, setUri] = useState<string | null>(null); useEffect(() => { resolveUri(doc).then(setUri); }, [doc.id]);
  const p = doc.pages[0]; const h = p ? (p.height / p.width) * width : width * 1.38;
  return <View style={{ width, height: h, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }}>{doc.coverUri ? <Image source={{ uri: doc.coverUri }} style={{ width, height: h }} resizeMode="cover" /> : uri ? <PdfPage uri={uri} index={p?.index ?? 0} width={width} height={h} template={doc.template} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="document-outline" size={28} color="#bbb" /></View>}<View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: doc.coverColor }} /></View>;
}
function MaterialTile({ m, width, progress, onDownload }: { m: Material; width: number; progress?: number; onDownload: () => void }) {
  const { colors } = useTheme(); const h = width * 1.38; const busy = progress != null;
  return (
    <Pressable onPress={busy ? undefined : onDownload} style={{ width }}>
      <View style={{ width, height: h, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center', padding: 12 }}>
        {m.cover_url && !busy && <Image source={{ uri: m.cover_url }} style={{ position: 'absolute', left: 0, top: 0, width, height: h, opacity: 0.35 }} resizeMode="cover" />}{busy ? <><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.primary, fontWeight: '800', marginTop: 10 }}>{Math.round((progress ?? 0) * 100)}%</Text><Muted variant="caption">받는 중</Muted><View style={{ width: '80%', marginTop: 8 }}><ProgressBar value={progress ?? 0} /></View></> : <><Ionicons name="cloud-download-outline" size={34} color={colors.primary} /><Text style={{ color: colors.text, fontWeight: '700', marginTop: 10, textAlign: 'center' }} numberOfLines={3}>{m.title}</Text><Muted variant="caption" style={{ marginTop: 4 }}>{m.pages ? `${m.pages}p · ` : ''}{fmtBytes(m.size)}</Muted><View style={{ marginTop: 12, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>다운받기</Text></View></>}
      </View>
      <T variant="label" numberOfLines={2} style={{ marginTop: 8 }}>{m.title}</T>
      <Muted variant="caption">배정된 교재</Muted>
    </Pressable>
  );
}

export default function Library() {
  const { colors } = useTheme(); const { isTablet, width, columns } = useLayout(); const router = useRouter();
  const { docs, folders, remove, createFolder, deleteFolder, moveToFolder, update, openTab, showToast } = useDocsStore(); const inkPages = useInkStore((s) => s.pages);
  const { role, label, student, materials, refreshMaterials, materialsAt, cred } = useSession(); const code = cred() ?? (student ? 'student' : null);
  const [folder, setFolder] = useState<'all' | 'fav' | string>('all'); const [q, setQ] = useState(''); const [select, setSelect] = useState(false); const [selected, setSelected] = useState<string[]>([]); const [sort, setSort] = useState<'recent' | 'title' | 'added'>('recent');
  const [folderSheet, setFolderSheet] = useState(false); const [newFolder, setNewFolder] = useState(''); const [confirmDel, setConfirmDel] = useState(false); const [busy, setBusy] = useState<string | null>(null); const [rename, setRename] = useState<Doc | null>(null); const [renameText, setRenameText] = useState(''); const [refreshing, setRefreshing] = useState(false); const [dl, setDl] = useState<Record<string, number>>({}); const [netErr, setNetErr] = useState<string | null>(null); const [newPage, setNewPage] = useState(false); const [newTitle, setNewTitle] = useState('');
  const refresh = async () => { setRefreshing(true); try { await refreshMaterials(); setNetErr(null); } catch (e: any) { setNetErr(e?.message ?? '교재 목록을 불러오지 못했어요'); } finally { setRefreshing(false); } };
  useEffect(() => { refresh(); }, [role]);
  const localByMaterial = useMemo(() => Object.fromEntries(Object.values(docs).filter((d) => d.materialId).map((d) => [d.materialId!, d])), [docs]);
  const pending = useMemo(() => materials.filter((m) => !localByMaterial[m.id]), [materials, localByMaterial]);
  const qn = q.normalize('NFC').trim().toLowerCase();
  const pendingShown = useMemo(() => (folder === 'all' ? pending.filter((m) => !qn || String(m.title ?? '').normalize('NFC').toLowerCase().includes(qn)) : []), [pending, folder, qn]);
  const list = useMemo(() => Object.values(docs).filter((d) => (folder === 'all' ? true : folder === 'fav' ? d.favorite : d.folderId === folder) && (!q || d.title.normalize('NFC').toLowerCase().includes(q.normalize('NFC').toLowerCase()) || d.fileName.normalize('NFC').toLowerCase().includes(q.normalize('NFC').toLowerCase()))).sort((a, b) => sort === 'title' ? a.title.normalize('NFC').localeCompare(b.title.normalize('NFC'), 'ko') : sort === 'added' ? (b.createdAt > a.createdAt ? 1 : -1) : ((b.lastOpenedAt ?? b.createdAt) > (a.lastOpenedAt ?? a.createdAt) ? 1 : -1)), [docs, folder, q, sort]);
  const tileW = Math.floor((width - (isTablet ? 90 : 0) - 32 - (columns - 1) * 16) / columns);
  const recent = Object.values(docs).filter((d) => d.lastOpenedAt).sort((a, b) => (b.lastOpenedAt! > a.lastOpenedAt! ? 1 : -1))[0];
  const strokeCount = (d: Doc) => Object.entries(inkPages).filter(([k]) => k.startsWith(d.id + ':')).reduce((a, [, p]) => a + p.strokes.length, 0);
  const doImport = async () => { try { setBusy('PDF 가져오는 중...'); const d = await pickAndImportPdf(); setBusy(null); if (d) { showToast(`'${d.title}' 추가됨 · ${d.pageCount}페이지`); openTab(d.id); router.push(`/viewer/${d.id}`); } } catch (e: any) { setBusy(null); showToast('PDF를 열 수 없어요: ' + (e?.message ?? '알 수 없는 오류')); } };
  const doDownload = async (m: Material) => { setDl((s) => ({ ...s, [m.id]: 0 })); try { const d = await downloadMaterial(cred(), m.id, m.title, (p) => setDl((s) => ({ ...s, [m.id]: p })), m.cover_url); showToast(`'${d.title}' 받기 완료 · ${d.pageCount}페이지`); } catch (e: any) { showToast('받기 실패: ' + (e?.message ?? '')); } finally { setDl((s) => { const n = { ...s }; delete n[m.id]; return n; }); } };
  const open = (d: Doc) => { openTab(d.id); router.push(`/viewer/${d.id}`); };
  const toggleSel = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <GlassBackground>
      <PageHeader title="내 교재" logo subtitle={`${label || (role === 'admin' ? '관리자' : '학생')}${student ? ` · ${student.school_name} ${student.grade_name}` : ''} · 받은 교재 ${Object.keys(localByMaterial).length} · 대기 ${pending.length}`} right={<Row gap={0}><IconButton icon="create-outline" size={24} color={colors.primary} onPress={() => { setNewTitle(`새 노트 ${new Date().getMonth() + 1}/${new Date().getDate()}`); setNewPage(true); }} label="새페이지" /><IconButton icon="add-circle" size={26} color={colors.primary} onPress={doImport} label="내 PDF 가져오기" /><IconButton icon="refresh" onPress={refresh} label="새로고침" /><IconButton icon={select ? 'checkmark-done' : 'checkbox-outline'} active={select} onPress={() => { setSelect(!select); setSelected([]); }} /></Row>} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 12 }}><Ionicons name="search" size={18} color={colors.textFaint} /><TextInput value={q} onChangeText={setQ} placeholder="교재 제목으로 찾기" placeholderTextColor={colors.textFaint} style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, color: colors.text }} /></View>
        {busy && <Card style={{ marginBottom: 12 }}><Row><ActivityIndicator color={colors.primary} /><T>{busy}</T></Row></Card>}
        {netErr && <Card style={{ marginBottom: 12, borderColor: colors.danger }}><Row><Ionicons name="cloud-offline-outline" size={18} color={colors.danger} /><Muted style={{ flex: 1 }}>{netErr} (받아둔 교재는 오프라인에서도 열 수 있어요)</Muted><Button small variant="ghost" title="다시" onPress={refresh} /></Row></Card>}
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
          <Muted variant="caption">{list.length + pendingShown.length}개{materialsAt ? ` · 목록 ${timeAgo(materialsAt)} 갱신` : ''}</Muted>
          <Row gap={10}>{([['recent', '최근 열람순'], ['title', '제목순'], ['added', '추가순']] as const).map(([k, l]) => <Pressable key={k} onPress={() => setSort(k)}><Text style={{ color: sort === k ? colors.primary : colors.textMuted, fontSize: 12, fontWeight: '600' }}>{l}</Text></Pressable>)}{folder !== 'all' && folder !== 'fav' && <Pressable onPress={() => { deleteFolder(folder); setFolder('all'); }}><Text style={{ color: colors.danger, fontSize: 12, fontWeight: '600' }}>폴더 삭제</Text></Pressable>}</Row>
        </Row>
        {list.length === 0 && pendingShown.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Logo size={56} withText={false} />
            <T variant="h2" style={{ marginTop: 16 }}>{role === 'admin' ? '아직 교재가 없어요' : '배정된 교재가 아직 없어요'}</T>
            <Muted center style={{ marginTop: 6, maxWidth: 320 }}>{role === 'admin' ? '관리자 탭에서 교재를 올리고 코드별로 배정하세요. 내 PDF를 바로 열 수도 있어요.' : '선생님이 교재를 배정하면 여기에 나타나요. 내 PDF를 직접 가져와 필기할 수도 있어요(이 기기에만 저장).'}</Muted>
            <Row style={{ marginTop: 18 }}>{role === 'admin' && <Button title="관리자 탭으로" icon="shield-outline" onPress={() => router.push('/(tabs)/admin')} />}<Button title="내 PDF 가져오기" variant={role === 'admin' ? 'secondary' : 'primary'} icon="cloud-upload-outline" onPress={doImport} /></Row>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {pendingShown.map((m) => <MaterialTile key={'m' + m.id} m={m} width={tileW} progress={dl[m.id]} onDownload={() => doDownload(m)} />)}
            {list.map((d) => { const sel = selected.includes(d.id); return (
              <Pressable key={d.id} onPress={() => (select ? toggleSel(d.id) : open(d))} onLongPress={() => { setSelect(true); toggleSel(d.id); }} style={{ width: tileW }}>
                <View><Cover doc={d} width={tileW} />
                  {select && <View style={{ position: 'absolute', top: 6, right: 6 }}><Ionicons name={sel ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={sel ? colors.primary : colors.textFaint} /></View>}
                  {!select && <Pressable onPress={() => update(d.id, { favorite: !d.favorite })} hitSlop={6} style={{ position: 'absolute', top: 6, right: 6 }}><Ionicons name={d.favorite ? 'star' : 'star-outline'} size={18} color={d.favorite ? colors.accent : colors.textFaint} /></Pressable>}
                  <View style={{ position: 'absolute', left: 8, bottom: 6, flexDirection: 'row', gap: 4 }}>{d.lastOpenedAt && <Badge label={`${Math.round(((d.lastPage + 1) / d.pageCount) * 100)}%`} tone="info" />}{strokeCount(d) > 0 && <Badge label="필기" tone="primary" />}{!d.materialId && <Badge label="내 파일" />}</View>
                </View>
                <T variant="label" numberOfLines={2} style={{ marginTop: 8 }}>{d.title}</T>
                <Muted variant="caption">{d.pageCount}페이지 · {fmtBytes(d.size)}{d.maxCycle > 1 ? ` · ${d.cycle}회독` : ''}</Muted>
                {!select && <Pressable onPress={() => { setRename(d); setRenameText(d.title); }} hitSlop={6}><Text style={{ fontSize: 11, color: colors.textMuted }}>이름 변경</Text></Pressable>}
              </Pressable>); })}
          </View>)}
      </ScrollView>
      {select && selected.length > 0 && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 20, backgroundColor: colors.text, borderRadius: 16, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: colors.bg, fontWeight: '700', marginLeft: 8, flex: 1 }}>{selected.length}개 선택</Text>
          <Button small variant="ghost" title="폴더 이동" onPress={() => setFolderSheet(true)} style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
          <Button small variant="danger" title="기기에서 삭제" onPress={() => setConfirmDel(true)} />
        </View>)}
      <Sheet visible={newPage} onClose={() => setNewPage(false)} title="새페이지 (자유 필기 노트)" height={420}>
        <Input label="이름" value={newTitle} onChangeText={setNewTitle} />
        <Muted variant="caption" style={{ marginBottom: 8 }}>종이 종류를 고르면 3페이지로 시작하고, 보기 화면 하단 + 버튼으로 페이지를 더 넣을 수 있어요.</Muted>
        <Row style={{ flexWrap: 'wrap' }}>{([['plain', '빈 페이지'], ['lined', '줄'], ['narrowLined', '좁은 줄'], ['wideLined', '넓은 줄'], ['grid', '격자'], ['narrowGrid', '좁은 격자'], ['dot', '점'], ['oxford', '옥스퍼드'], ['music', '음악']] as const).map(([k, l]) => <Pressable key={k} onPress={() => { const d = createBlankDoc(newTitle.trim() || '새 노트', k, 3); setNewPage(false); showToast(`'${d.title}' 만들었어요`); openTab(d.id); router.push(`/viewer/${d.id}`); }} style={{ width: 96, alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' }}><View style={{ width: 56, height: 72, borderRadius: 4, borderWidth: 1, borderColor: '#E3E8F0', backgroundColor: '#fff', overflow: 'hidden' }}><BlankPaper width={56} height={72} template={k} /></View><T variant="label" style={{ marginTop: 6 }}>{l}</T></Pressable>)}</Row>
      </Sheet>
      <Sheet visible={folderSheet} onClose={() => setFolderSheet(false)} title={selected.length ? '폴더로 이동' : '폴더'}>
        {folders.map((f) => <ListItem key={f.id} icon="folder" title={f.name} onPress={() => { if (selected.length) { moveToFolder(selected, f.id); setSelected([]); setSelect(false); showToast(`${f.name}(으)로 이동했어요`); } setFolderSheet(false); }} />)}
        {selected.length > 0 && <ListItem icon="folder-open-outline" title="폴더에서 꺼내기" onPress={() => { moveToFolder(selected, undefined); setSelected([]); setSelect(false); setFolderSheet(false); }} />}
        <Row style={{ marginTop: 8 }} align="flex-start"><View style={{ flex: 1 }}><Input placeholder="새 폴더 이름" value={newFolder} onChangeText={setNewFolder} /></View><Button title="만들기" onPress={() => { if (!newFolder.trim()) return; const id = createFolder(newFolder.trim(), COVER_COLORS[folders.length % COVER_COLORS.length]); if (selected.length) moveToFolder(selected, id); setNewFolder(''); setFolderSheet(false); }} /></Row>
      </Sheet>
      <Sheet visible={!!rename} onClose={() => setRename(null)} title="이름 변경" height={260}><Input value={renameText} onChangeText={setRenameText} autoFocus /><Row><Button title="저장" style={{ flex: 1 }} onPress={() => { if (rename) update(rename.id, { title: renameText.trim() || rename.title }); setRename(null); }} />{COVER_COLORS.slice(0, 6).map((c) => <Pressable key={c} onPress={() => rename && update(rename.id, { coverColor: c })} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c }} />)}</Row></Sheet>
      <Dialog visible={confirmDel} title="기기에서 삭제할까요?" message="이 기기의 파일과 필기가 삭제됩니다. 배정된 교재는 다시 받을 수 있지만 필기는 복구되지 않습니다." onClose={() => setConfirmDel(false)} actions={[{ label: '취소', onPress: () => setConfirmDel(false) }, { label: '삭제', variant: 'danger', onPress: async () => { for (const id of selected) { const d = docs[id]; if (d) { await deleteDocFiles(d); useInkStore.getState().clearPackage(d.id + ':'); remove(id); } } setSelected([]); setSelect(false); setConfirmDel(false); showToast('삭제했어요'); } }]} />
    </GlassBackground>
  );
}
