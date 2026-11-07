import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, Text, ActivityIndicator, RefreshControl, Image, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout, type, ios } from '@/theme';
import { Button, Card, Chip, Dialog, IconButton, Input, Muted, Row, Sheet, T, ProgressBar, ListItem, Group, SearchField, Segmented, TextButton, Cell } from '@/components/ui';
import { PageHeader, useMargin } from '@/components/Header';
import { GlassBackground } from '@/components/Glass';
import { COVER_COLORS, useDocsStore } from '@/store/docs';
import { useInkStore } from '@/store/ink';
import { useSession } from '@/store/session';
import { pickAndImportPdf, deleteDocFiles, resolveUri, downloadMaterial, createBlankDoc } from '@/lib/files';
import { PdfPage, BlankPaper } from '@/features/viewer/PdfPage';
import { fmtBytes, timeAgo } from '@/utils/format';
import { Doc } from '@/data/types';
import { Material } from '@/lib/api';

const FRAME = 1.32; // thumbnail frame height / width (Files-style: every cover sits on the same baseline)
/** Fits a page of ratio r (h/w) inside a w×(w·FRAME) frame, bottom-aligned. */
const fit = (frameW: number, r: number) => { const fh = frameW * FRAME; return r > FRAME ? { w: fh / r, h: fh } : { w: frameW, h: frameW * r }; };

/** Document thumbnail with a soft shadow (first page or custom cover). */
function Thumb({ doc, width, frame = true, overlay }: { doc: Doc; width: number; frame?: boolean; overlay?: React.ReactNode }) {
  const [uri, setUri] = useState<string | null>(null); useEffect(() => { resolveUri(doc).then(setUri); }, [doc.id]);
  const p = doc.pages[0]; const r = p ? p.height / p.width : 1.414; const { w, h } = frame ? fit(width, r) : { w: width, h: width * r };
  return (
    <View style={[{ width: frame ? width : w, height: frame ? width * FRAME : h, alignItems: 'center', justifyContent: 'flex-end' }]}>
      <View style={[styles.thumbShadow, { width: w, height: h, borderRadius: 8 }]}>
        <View style={{ width: w, height: h, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.12)' }}>
          {doc.coverUri ? <Image source={{ uri: doc.coverUri }} style={{ width: w, height: h }} resizeMode="cover" /> : uri ? <PdfPage uri={uri} index={p?.index ?? 0} width={w} height={h} template={doc.template} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="document-outline" size={28} color={ios.gray3} /></View>}
        </View>
        {overlay}
      </View>
    </View>
  );
}
/** Assigned material that is not on this device yet (iCloud-style "download" state). */
function MaterialTile({ m, width, progress, onDownload }: { m: Material; width: number; progress?: number; onDownload: () => void }) {
  const { colors } = useTheme(); const { w, h } = fit(width, 1.414); const busy = progress != null;
  return (
    <Pressable onPress={busy ? undefined : onDownload} style={({ pressed }) => ({ width, alignItems: 'center', opacity: pressed ? 0.6 : 1 })}>
      <View style={{ width, height: width * FRAME, alignItems: 'center', justifyContent: 'flex-end' }}>
        <View style={[styles.thumbShadow, { width: w, height: h, borderRadius: 8 }]}>
          <View style={{ width: w, height: h, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.12)', alignItems: 'center', justifyContent: 'center' }}>
            {m.cover_url ? <Image source={{ uri: m.cover_url }} style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, opacity: 0.45 }} resizeMode="cover" /> : <Ionicons name="document-text-outline" size={Math.min(44, w * 0.3)} color={ios.gray3} />}
            {busy && <View style={{ position: 'absolute', left: 12, right: 12, bottom: 14 }}><ProgressBar value={progress ?? 0} /></View>}
          </View>
          <View style={styles.cloudBadge}><Ionicons name="cloud-download-outline" size={15} color={ios.blue} /></View>
        </View>
      </View>
      <Text numberOfLines={2} style={[type.footnote, styles.tileTitle, { color: colors.text }]}>{m.title}</Text>
      <Text style={[type.caption, { color: colors.textMuted, textAlign: 'center' }]}>{m.pages ? `${m.pages}p · ` : ''}{fmtBytes(m.size)}</Text>
      {busy ? <View style={[styles.getPill, { backgroundColor: 'transparent' }]}><ActivityIndicator size="small" color={ios.blue} /><Text style={[type.caption, { color: ios.blue, fontWeight: '600', marginLeft: 6 }]}>받는 중 {Math.round((progress ?? 0) * 100)}%</Text></View>
        : <View style={styles.getPill}><Text style={[type.footnote, { color: ios.blue, fontWeight: '700' }]}>다운받기</Text></View>}
    </Pressable>
  );
}

export default function Library() {
  const { colors } = useTheme(); const { isTablet, width, columns } = useLayout(); const router = useRouter(); const insets = useSafeAreaInsets(); const m = useMargin(); const narrow = width < 560;
  const { docs, folders, remove, createFolder, deleteFolder, moveToFolder, update, openTab, showToast } = useDocsStore(); const inkPages = useInkStore((s) => s.pages);
  const { role, label, student, materials, refreshMaterials, materialsAt, cred } = useSession();
  const [folder, setFolder] = useState<'all' | 'fav' | string>('all'); const [q, setQ] = useState(''); const [select, setSelect] = useState(false); const [selected, setSelected] = useState<string[]>([]); const [sort, setSort] = useState<'recent' | 'title' | 'added'>('recent');
  const [folderSheet, setFolderSheet] = useState(false); const [newFolder, setNewFolder] = useState(''); const [confirmDel, setConfirmDel] = useState(false); const [busy, setBusy] = useState<string | null>(null); const [rename, setRename] = useState<Doc | null>(null); const [renameText, setRenameText] = useState(''); const [refreshing, setRefreshing] = useState(false); const [dl, setDl] = useState<Record<string, number>>({}); const [netErr, setNetErr] = useState<string | null>(null); const [newPage, setNewPage] = useState(false); const [newTitle, setNewTitle] = useState('');
  const [menuDoc, setMenuDoc] = useState<Doc | null>(null);
  const refresh = async () => { setRefreshing(true); try { await refreshMaterials(); setNetErr(null); } catch (e: any) { setNetErr(e?.message ?? '교재 목록을 불러오지 못했어요'); } finally { setRefreshing(false); } };
  useEffect(() => { refresh(); }, [role]);
  const localByMaterial = useMemo(() => Object.fromEntries(Object.values(docs).filter((d) => d.materialId).map((d) => [d.materialId!, d])), [docs]);
  const pending = useMemo(() => materials.filter((mm) => !localByMaterial[mm.id]), [materials, localByMaterial]);
  const qn = q.normalize('NFC').trim().toLowerCase();
  const pendingShown = useMemo(() => (folder === 'all' ? pending.filter((mm) => !qn || String(mm.title ?? '').normalize('NFC').toLowerCase().includes(qn)) : []), [pending, folder, qn]);
  const list = useMemo(() => Object.values(docs).filter((d) => (folder === 'all' ? true : folder === 'fav' ? d.favorite : d.folderId === folder) && (!q || d.title.normalize('NFC').toLowerCase().includes(q.normalize('NFC').toLowerCase()) || d.fileName.normalize('NFC').toLowerCase().includes(q.normalize('NFC').toLowerCase()))).sort((a, b) => sort === 'title' ? a.title.normalize('NFC').localeCompare(b.title.normalize('NFC'), 'ko') : sort === 'added' ? (b.createdAt > a.createdAt ? 1 : -1) : ((b.lastOpenedAt ?? b.createdAt) > (a.lastOpenedAt ?? a.createdAt) ? 1 : -1)), [docs, folder, q, sort]);
  const railW = isTablet ? 96 : 0; const gap = narrow ? 16 : 22;
  const tileW = Math.floor((width - railW - m * 2 - (columns - 1) * gap) / columns);
  const recent = Object.values(docs).filter((d) => d.lastOpenedAt).sort((a, b) => (b.lastOpenedAt! > a.lastOpenedAt! ? 1 : -1))[0];
  const strokeCount = (d: Doc) => Object.entries(inkPages).filter(([k]) => k.startsWith(d.id + ':')).reduce((a, [, p]) => a + p.strokes.length, 0);
  const doImport = async () => { try { setBusy('PDF 가져오는 중...'); const d = await pickAndImportPdf(); setBusy(null); if (d) { showToast(`'${d.title}' 추가됨 · ${d.pageCount}페이지 · 이 기기에만 저장돼요`); openTab(d.id); router.push(`/viewer/${d.id}`); } } catch (e: any) { setBusy(null); showToast('PDF를 열 수 없어요: ' + (e?.message ?? '알 수 없는 오류')); } };
  const doDownload = async (mm: Material) => { setDl((s) => ({ ...s, [mm.id]: 0 })); try { const d = await downloadMaterial(cred(), mm.id, mm.title, (p) => setDl((s) => ({ ...s, [mm.id]: p })), mm.cover_url); showToast(`'${d.title}' 받기 완료 · ${d.pageCount}페이지`); } catch (e: any) { showToast('받기 실패: ' + (e?.message ?? '')); } finally { setDl((s) => { const n = { ...s }; delete n[mm.id]; return n; }); } };
  const open = (d: Doc) => { openTab(d.id); router.push(`/viewer/${d.id}`); };
  const toggleSel = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const who = label || (role === 'admin' ? '관리자' : '학생');
  const subtitle = narrow ? `${who} · 받은 ${Object.keys(localByMaterial).length} · 대기 ${pending.length}` : `${who}${student ? ` · ${student.school_name} ${student.grade_name}` : ''} · 받은 교재 ${Object.keys(localByMaterial).length} · 대기 ${pending.length}`;
  return (
    <GlassBackground>
      <PageHeader title="내 교재" subtitle={subtitle} right={<>
        <IconButton icon="create-outline" size={25} color={ios.blue} onPress={() => { setNewTitle(`새 노트 ${new Date().getMonth() + 1}/${new Date().getDate()}`); setNewPage(true); }} label="새 노트" />
        {!narrow && <IconButton icon="refresh" size={23} color={ios.blue} onPress={refresh} label="새로고침" />}
        {/* Students and admins can add their own PDFs; the file and its ink stay on this device only. */}
        <Pressable accessibilityRole="button" accessibilityLabel="내 PDF 추가" onPress={doImport} disabled={!!busy} style={({ pressed }) => [styles.addPill, { opacity: busy ? 0.5 : pressed ? 0.75 : 1 }]}><Ionicons name="add" size={19} color="#fff" /><Text style={[type.subhead, { color: '#fff', fontWeight: '600' }]}>{narrow ? 'PDF' : '내 PDF 추가'}</Text></Pressable>
        <TextButton title={select ? '완료' : '선택'} bold={select} accessibilityLabel="선택" onPress={() => { setSelect(!select); setSelected([]); }} />
      </>} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: m, paddingTop: 2, paddingBottom: select ? 110 : 60 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <SearchField value={q} onChangeText={setQ} placeholder="교재 제목으로 찾기" style={{ marginBottom: 14 }} />
        {busy && <Card style={{ marginBottom: 12 }}><Row><ActivityIndicator color={colors.primary} /><T>{busy}</T></Row></Card>}
        {netErr && <Card style={{ marginBottom: 12 }}><Row><Ionicons name="wifi-outline" size={20} color={ios.orange} /><Muted variant="subhead" style={{ flex: 1 }}>{netErr} · 받아둔 교재는 오프라인에서도 열 수 있어요</Muted><TextButton title="다시 시도" onPress={refresh} size={15} /></Row></Card>}
        {recent && !q && folder === 'all' && (
          <Pressable onPress={() => open(recent)} style={({ pressed }) => [styles.resume, { opacity: pressed ? 0.8 : 1 }]}>
            <Thumb doc={recent} width={46} frame={false} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.footnote, { color: colors.textMuted }]}>이어서 보기 · {timeAgo(recent.lastOpenedAt!)}</Text>
              <Text numberOfLines={1} style={[type.h3, { color: colors.text, marginTop: 1 }]}>{recent.title}</Text>
              <View style={{ marginTop: 7, maxWidth: 420 }}><ProgressBar value={(recent.lastPage + 1) / recent.pageCount} /></View>
              <Text style={[type.caption, { color: colors.textMuted, marginTop: 5 }]}>{recent.lastPage + 1}/{recent.pageCount}p · {recent.cycle}회독 · 필기 {strokeCount(recent)}획</Text>
            </View>
            <View style={styles.playBtn}><Ionicons name="play" size={17} color="#fff" style={{ marginLeft: 2 }} /></View>
          </Pressable>)}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -m }} contentContainerStyle={{ paddingHorizontal: m, paddingVertical: 4, alignItems: 'center' }}>
          <Chip label="전체" active={folder === 'all'} onPress={() => setFolder('all')} /><Chip label="즐겨찾기" icon="star" active={folder === 'fav'} onPress={() => setFolder('fav')} />
          {folders.map((f) => <Chip key={f.id} label={f.name} icon="folder" color={f.color} active={folder === f.id} onPress={() => setFolder(f.id)} />)}
          <Chip label="폴더 추가" icon="add" onPress={() => { setSelected([]); setFolderSheet(true); }} />
        </ScrollView>
        <View style={{ flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'stretch' : 'center', justifyContent: 'space-between', gap: 8, marginTop: 12, marginBottom: 16 }}>
          <Row gap={10}><Text style={[type.footnote, { color: colors.textMuted }]}>{list.length + pendingShown.length}개{materialsAt ? ` · 목록 ${timeAgo(materialsAt)} 갱신` : ''}</Text>{folder !== 'all' && folder !== 'fav' && <TextButton title="폴더 삭제" color={ios.red} size={13} onPress={() => { deleteFolder(folder); setFolder('all'); }} />}</Row>
          <Segmented size="small" style={{ width: narrow ? undefined : 280 }} value={sort} onChange={setSort} items={[{ k: 'recent', label: '최근 열람순' }, { k: 'title', label: '제목순' }, { k: 'added', label: '추가순' }]} />
        </View>
        {list.length === 0 && pendingShown.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Ionicons name={q ? 'search' : 'books-outline' as any} size={52} color={ios.gray2} />
            <Text style={[type.title3, { color: colors.text, marginTop: 14, textAlign: 'center' }]}>{q ? '검색 결과 없음' : role === 'admin' ? '아직 교재가 없어요' : '배정된 교재가 아직 없어요'}</Text>
            <Text style={[type.subhead, { color: colors.textMuted, textAlign: 'center', marginTop: 6, maxWidth: 360 }]}>{q ? `'${q}'와(과) 일치하는 교재가 없어요.` : role === 'admin' ? '관리자 탭에서 교재를 올리고 코드별로 배정하세요. 내 PDF를 바로 열 수도 있어요.' : '선생님이 교재를 배정하면 여기에 나타나요. 내 PDF를 직접 가져와 필기할 수도 있어요(이 기기에만 저장).'}</Text>
            {!q && <Row style={{ marginTop: 18 }}>{role === 'admin' && <Button small title="관리자 탭으로" variant="secondary" onPress={() => router.push('/(tabs)/admin')} />}<Button small title="내 PDF 추가" icon="add" onPress={doImport} /></Row>}
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: gap, rowGap: 26 }}>
            {pendingShown.map((mm) => <MaterialTile key={'m' + mm.id} m={mm} width={tileW} progress={dl[mm.id]} onDownload={() => doDownload(mm)} />)}
            {list.map((d) => { const sel = selected.includes(d.id); const ink = strokeCount(d); const pct = d.lastOpenedAt ? Math.round(((d.lastPage + 1) / d.pageCount) * 100) : null; return (
              <Pressable key={d.id} onPress={() => (select ? toggleSel(d.id) : open(d))} onLongPress={() => (select ? toggleSel(d.id) : setMenuDoc(d))} delayLongPress={380} style={({ pressed }) => ({ width: tileW, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
                <Thumb doc={d} width={tileW} overlay={<>
                  {d.favorite && <View style={[styles.cornerBadge, { left: 6 }]}><Ionicons name="star" size={13} color={ios.yellow} /></View>}
                  {select ? <View style={[styles.check, sel ? { backgroundColor: ios.blue, borderColor: '#fff' } : { backgroundColor: 'rgba(255,255,255,0.9)', borderColor: ios.gray3 }]}>{sel && <Ionicons name="checkmark" size={15} color="#fff" />}</View>
                    : <Pressable accessibilityRole="button" accessibilityLabel={`${d.title} 메뉴`} onPress={() => setMenuDoc(d)} hitSlop={8} style={({ pressed }) => [styles.moreBtn, { opacity: pressed ? 0.5 : 1 }]}><Ionicons name="ellipsis-horizontal" size={15} color={colors.text} /></Pressable>}
                </>} />
                <Text numberOfLines={2} style={[type.footnote, styles.tileTitle, { color: colors.text }]}>{d.title}</Text>
                <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted, textAlign: 'center' }]}>{d.pageCount}페이지 · {fmtBytes(d.size)}</Text>
                {(pct != null || ink > 0 || !d.materialId || d.maxCycle > 1) && <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted, textAlign: 'center' }]}>{[pct != null ? `${pct}% 읽음` : null, ink > 0 ? '필기' : null, d.maxCycle > 1 ? `${d.cycle}회독` : null, !d.materialId ? '내 파일' : null].filter(Boolean).join(' · ')}</Text>}
              </Pressable>); })}
          </View>)}
      </ScrollView>
      {select && (
        <View style={[styles.selectBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextButton title="폴더 이동" disabled={!selected.length} onPress={() => setFolderSheet(true)} />
          <Text style={[type.bodyBold, { color: colors.text }]}>{selected.length ? `${selected.length}개 선택` : '항목 선택'}</Text>
          <TextButton title="기기에서 삭제" color={ios.red} disabled={!selected.length} onPress={() => setConfirmDel(true)} />
        </View>)}
      <Sheet visible={!!menuDoc} onClose={() => setMenuDoc(null)} title={menuDoc?.title} grouped height={520}>
        {menuDoc && <>
          <Group>
            <ListItem icon="book-outline" title="열기" onPress={() => { const d = menuDoc; setMenuDoc(null); open(d); }} chevron={false} />
            <ListItem icon={menuDoc.favorite ? 'star' : 'star-outline'} title={menuDoc.favorite ? '즐겨찾기에서 제거' : '즐겨찾기에 추가'} chevron={false} onPress={() => { update(menuDoc.id, { favorite: !menuDoc.favorite }); setMenuDoc(null); }} />
            <ListItem icon="pencil" title="이름 변경" chevron={false} onPress={() => { const d = menuDoc; setMenuDoc(null); setRename(d); setRenameText(d.title); }} />
            <ListItem icon="folder-outline" title="폴더로 이동" chevron={false} onPress={() => { const d = menuDoc; setMenuDoc(null); setSelected([d.id]); setFolderSheet(true); }} />
          </Group>
          <Group><ListItem icon="trash-outline" title="기기에서 삭제" danger chevron={false} onPress={() => { const d = menuDoc; setMenuDoc(null); setSelected([d.id]); setConfirmDel(true); }} /></Group>
          <Text style={[type.footnote, { color: colors.textMuted, textAlign: 'center', marginTop: 6 }]}>{menuDoc.pageCount}페이지 · {fmtBytes(menuDoc.size)}{menuDoc.materialId ? ' · 배정된 교재' : ' · 이 기기에만 저장된 내 파일'}</Text>
        </>}
      </Sheet>
      <Sheet visible={newPage} onClose={() => setNewPage(false)} title="새 노트" grouped height={560}>
        <Input label="이름" value={newTitle} onChangeText={setNewTitle} style={{ backgroundColor: '#fff' }} />
        <Text style={[type.footnote, { color: colors.textMuted, marginBottom: 12, marginLeft: 4 }]}>종이를 고르면 3페이지로 시작해요. 마지막 페이지에서 더 밀거나 하단 + 버튼으로 페이지를 늘릴 수 있어요.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{([['plain', '빈 페이지'], ['lined', '줄'], ['narrowLined', '좁은 줄'], ['wideLined', '넓은 줄'], ['grid', '격자'], ['narrowGrid', '좁은 격자'], ['dot', '점'], ['oxford', '옥스퍼드'], ['music', '음악']] as const).map(([k, l]) => <Pressable key={k} onPress={() => { const d = createBlankDoc(newTitle.trim() || '새 노트', k, 3); setNewPage(false); showToast(`'${d.title}' 만들었어요`); openTab(d.id); router.push(`/viewer/${d.id}`); }} style={({ pressed }) => ({ width: 92, alignItems: 'center', opacity: pressed ? 0.6 : 1 })}><View style={[styles.thumbShadow, { borderRadius: 6 }]}><View style={{ width: 64, height: 84, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.12)', backgroundColor: '#fff', overflow: 'hidden' }}><BlankPaper width={64} height={84} template={k} /></View></View><Text style={[type.footnote, { color: colors.text, marginTop: 7 }]}>{l}</Text></Pressable>)}</View>
      </Sheet>
      <Sheet visible={folderSheet} onClose={() => { setFolderSheet(false); if (!select) setSelected([]); }} title={selected.length ? '폴더로 이동' : '폴더'} grouped>
        {(folders.length > 0 || selected.length > 0) && <Group>
          {folders.map((f) => <ListItem key={f.id} icon="folder" iconColor={f.color} title={f.name} onPress={() => { if (selected.length) { moveToFolder(selected, f.id); setSelected([]); setSelect(false); showToast(`${f.name}(으)로 이동했어요`); } else setFolder(f.id); setFolderSheet(false); }} />)}
          {selected.length > 0 && <ListItem icon="folder-open-outline" iconColor={ios.gray} title="폴더에서 꺼내기" onPress={() => { moveToFolder(selected, undefined); setSelected([]); setSelect(false); setFolderSheet(false); }} />}
        </Group>}
        <Group header="새 폴더"><Cell><Row><View style={{ flex: 1 }}><Input placeholder="새 폴더 이름" value={newFolder} onChangeText={setNewFolder} style={{ marginBottom: -12 }} /></View><Button small title="만들기" onPress={() => { if (!newFolder.trim()) return; const id = createFolder(newFolder.trim(), COVER_COLORS[folders.length % COVER_COLORS.length]); if (selected.length) { moveToFolder(selected, id); setSelected([]); setSelect(false); } setNewFolder(''); setFolderSheet(false); }} /></Row></Cell></Group>
      </Sheet>
      <Sheet visible={!!rename} onClose={() => setRename(null)} title="이름 변경" grouped height={330}>
        <Input value={renameText} onChangeText={setRenameText} autoFocus style={{ backgroundColor: '#fff' }} />
        <Text style={[type.footnote, { color: colors.textMuted, marginLeft: 4, marginBottom: 8 }]}>태그 색</Text>
        <Row gap={12} style={{ marginBottom: 18, paddingLeft: 4 }}>{COVER_COLORS.slice(0, 7).map((c) => <Pressable key={c} accessibilityLabel={`색 ${c}`} onPress={() => rename && update(rename.id, { coverColor: c })} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, borderWidth: 3, borderColor: rename && docs[rename.id]?.coverColor === c ? 'rgba(0,0,0,0.28)' : 'transparent' }} />)}</Row>
        <Button title="저장" onPress={() => { if (rename) update(rename.id, { title: renameText.trim() || rename.title }); setRename(null); }} />
      </Sheet>
      <Dialog visible={confirmDel} title="기기에서 삭제할까요?" message="이 기기의 파일과 필기가 삭제됩니다. 배정된 교재는 다시 받을 수 있지만 필기는 복구되지 않습니다." onClose={() => { setConfirmDel(false); if (!select) setSelected([]); }} actions={[{ label: '취소', onPress: () => { setConfirmDel(false); if (!select) setSelected([]); } }, { label: '삭제', variant: 'danger', onPress: async () => { for (const id of selected) { const d = docs[id]; if (d) { await deleteDocFiles(d); useInkStore.getState().clearPackage(d.id + ':'); remove(id); } } setSelected([]); setSelect(false); setConfirmDel(false); showToast('삭제했어요'); } }]} />
    </GlassBackground>
  );
}

const styles = StyleSheet.create({
  thumbShadow: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  tileTitle: { marginTop: 9, fontWeight: '600', textAlign: 'center', alignSelf: 'stretch' },
  cloudBadge: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  getPill: { flexDirection: 'row', alignItems: 'center', marginTop: 7, paddingHorizontal: 14, height: 28, borderRadius: 14, backgroundColor: 'rgba(118,118,128,0.12)' },
  addPill: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 34, paddingLeft: 10, paddingRight: 14, marginHorizontal: 4, borderRadius: 17, backgroundColor: ios.blue },
  resume: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 16 },
  playBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: ios.blue, alignItems: 'center', justifyContent: 'center' },
  cornerBadge: { position: 'absolute', top: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  moreBtn: { position: 'absolute', right: 6, bottom: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  check: { position: 'absolute', right: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  selectBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(249,249,249,0.97)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(60,60,67,0.29)' },
});
