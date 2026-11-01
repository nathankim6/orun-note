import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, Text, ActivityIndicator, RefreshControl } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout } from '@/theme';
import { Badge, Button, Card, Chip, Dialog, Empty, IconButton, Input, Muted, Row, Sheet, T, Toggle, ProgressBar, ListItem } from '@/components/ui';
import { PageHeader } from '@/components/Header';
import { useSession } from '@/store/session';
import { useDocsStore } from '@/store/docs';
import { api, AccessCode, Material } from '@/lib/api';
import { uploadMaterial } from '@/lib/files';
import { fmtBytes, fmtDate, timeAgo } from '@/utils/format';

export default function Admin() {
  const { colors } = useTheme(); const { isTablet } = useLayout(); const { code, role } = useSession(); const showToast = useDocsStore((s) => s.showToast);
  const [tab, setTab] = useState<'materials' | 'codes' | 'log'>('materials'); const [materials, setMaterials] = useState<Material[]>([]); const [codes, setCodes] = useState<AccessCode[]>([]); const [links, setLinks] = useState<{ code_id: string; material_id: string }[]>([]); const [loading, setLoading] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ title: string; picked?: { uri: string; name: string; size: number; file?: File }; progress?: number } | null>(null);
  const [newCode, setNewCode] = useState<{ label: string; code: string } | null>(null); const [assignFor, setAssignFor] = useState<AccessCode | null>(null); const [assignMat, setAssignMat] = useState<Material | null>(null); const [confirm, setConfirm] = useState<{ title: string; message: string; onYes: () => void } | null>(null); const [stats, setStats] = useState<{ codes: number; materials: number; log: { code: string; action: string; ok: boolean; at: string }[] } | null>(null); const [editTitle, setEditTitle] = useState<Material | null>(null); const [titleText, setTitleText] = useState('');
  const load = async () => { if (!code) return; setLoading(true); setErr(null); try { const [m, c] = await Promise.all([api.list(code), api.codes.list(code)]); setMaterials(m.materials); setCodes(c.codes); setLinks(c.links); if (tab === 'log') setStats(await api.stats(code)); } catch (e: any) { setErr(e?.message ?? '불러오기 실패'); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [code, tab]);
  const assignedCount = (mid: string) => links.filter((l) => l.material_id === mid).length;
  const codeMaterials = (cid: string) => links.filter((l) => l.code_id === cid).map((l) => l.material_id);
  if (role !== 'admin') return <View style={{ flex: 1, backgroundColor: colors.bg }}><PageHeader title="관리자" /><Empty icon="lock-closed-outline" title="관리자 전용" /></View>;
  const pick = async () => { const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true }); if (r.canceled || !r.assets?.length) return; const a = r.assets[0]; setUpload({ title: a.name.replace(/\.pdf$/i, ''), picked: { uri: a.uri, name: a.name, size: a.size ?? 0, file: (a as any).file } }); };
  const doUpload = async () => { if (!upload?.picked || !code) return; try { setUpload((u) => u && { ...u, progress: 0 }); const m = await uploadMaterial(code, upload.picked, upload.title, (p) => setUpload((u) => u && { ...u, progress: p })); showToast(`'${m.title}' 업로드 완료`); setUpload(null); load(); } catch (e: any) { showToast('업로드 실패: ' + (e?.message ?? '')); setUpload((u) => u && { ...u, progress: undefined }); } };
  const toggleAssign = async (c: AccessCode, m: Material, on: boolean) => { if (!code) return; setLinks((ls) => on ? [...ls, { code_id: c.id, material_id: m.id }] : ls.filter((l) => !(l.code_id === c.id && l.material_id === m.id))); try { await api.assign(code, c.id, m.id, on); } catch (e: any) { showToast('저장 실패: ' + e?.message); load(); } };
  const Seg = () => <Row style={{ marginBottom: 12 }}>{([['materials', '교재', 'book-outline'], ['codes', '접속 코드', 'key-outline'], ['log', '접속 기록', 'time-outline']] as const).map(([k, l, i]) => <Chip key={k} label={l} icon={i} active={tab === k} onPress={() => setTab(k)} />)}</Row>;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PageHeader title="관리자" subtitle={`교재 ${materials.length} · 코드 ${codes.length}`} right={<Row gap={0}>{tab === 'materials' && <IconButton icon="cloud-upload" size={24} color={colors.primary} onPress={pick} label="교재 업로드" />}{tab === 'codes' && <IconButton icon="add-circle" size={26} color={colors.primary} onPress={() => setNewCode({ label: '', code: '' })} label="코드 추가" />}<IconButton icon="refresh" onPress={load} /></Row>} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80, maxWidth: isTablet ? 900 : undefined, width: '100%', alignSelf: 'center' }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <Seg />
        {err && <Card style={{ borderColor: colors.danger, marginBottom: 12 }}><Row><Ionicons name="warning-outline" size={18} color={colors.danger} /><Muted style={{ flex: 1 }}>{err}</Muted><Button small variant="ghost" title="다시" onPress={load} /></Row></Card>}
        {tab === 'materials' && <>
          <Card onPress={pick} style={{ borderStyle: 'dashed', alignItems: 'center', marginBottom: 14 }}><Ionicons name="cloud-upload-outline" size={30} color={colors.primary} /><T variant="bodyBold" style={{ marginTop: 6 }}>PDF 교재 업로드</T><Muted variant="caption">파일당 최대 50MB · 업로드 후 코드별로 배정</Muted></Card>
          {materials.length === 0 ? <Empty icon="book-outline" title="교재가 없어요" message="위 버튼으로 첫 교재를 올려보세요" /> : materials.map((m) => (
            <Card key={m.id} style={{ marginBottom: 10 }} padded={false}>
              <Row style={{ padding: 14 }} align="flex-start">
                <View style={{ width: 40, height: 52, borderRadius: 6, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="document-text" size={22} color={colors.primary} /></View>
                <View style={{ flex: 1 }}><T variant="bodyBold" numberOfLines={2}>{m.title}</T><Muted variant="caption">{m.pages ? `${m.pages}p · ` : ''}{fmtBytes(m.size)} · {fmtDate(m.created_at, { short: true })}{!m.ready ? ' · 업로드 미완료' : ''}</Muted>
                  <Row gap={6} style={{ marginTop: 6, flexWrap: 'wrap' }}><Badge label={`${assignedCount(m.id)}개 코드에 배정`} tone={assignedCount(m.id) ? 'primary' : 'neutral'} />{codes.filter((c) => codeMaterials(c.id).includes(m.id)).slice(0, 6).map((c) => <Badge key={c.id} label={c.label || c.code} />)}</Row></View>
                <Row gap={0}><IconButton icon="people-outline" onPress={() => setAssignMat(m)} label="배정" /><IconButton icon="create-outline" onPress={() => { setEditTitle(m); setTitleText(m.title); }} /><IconButton icon="trash-outline" color={colors.danger} onPress={() => setConfirm({ title: '교재를 삭제할까요?', message: `'${m.title}' 파일과 배정 정보가 서버에서 삭제됩니다. 학생 기기에 이미 받은 사본은 남습니다.`, onYes: async () => { try { await api.materials.delete(code!, m.id); showToast('삭제했어요'); load(); } catch (e: any) { showToast(e?.message); } } })} /></Row>
              </Row>
            </Card>))}
        </>}
        {tab === 'codes' && <>
          <Muted variant="caption" style={{ marginBottom: 8 }}>관리자 코드는 서버 설정에 고정되어 있고 여기 목록에는 나오지 않아요. 학생/반별로 코드를 만들고 교재를 배정하세요.</Muted>
          {codes.length === 0 ? <Empty icon="key-outline" title="접속 코드가 없어요" action="코드 추가" onAction={() => setNewCode({ label: '', code: '' })} /> : codes.map((c) => (
            <Card key={c.id} style={{ marginBottom: 10, opacity: c.active ? 1 : 0.6 }} padded={false}>
              <Row style={{ padding: 14 }}>
                <View style={{ flex: 1 }}><Row><Text style={{ fontSize: 22, fontWeight: '800', letterSpacing: 3, color: colors.text }}>{c.code}</Text>{!c.active && <Badge label="비활성" tone="danger" />}</Row><Muted variant="caption">{c.label || '이름 없음'} · 교재 {codeMaterials(c.id).length}개{c.last_used_at ? ` · 최근 접속 ${timeAgo(c.last_used_at)}` : ' · 접속 기록 없음'}</Muted>
                  <Row gap={6} style={{ marginTop: 6, flexWrap: 'wrap' }}>{materials.filter((m) => codeMaterials(c.id).includes(m.id)).slice(0, 5).map((m) => <Badge key={m.id} label={m.title.slice(0, 14)} tone="primary" />)}</Row></View>
                <Toggle value={c.active} onChange={(v) => { setCodes((cs) => cs.map((x) => (x.id === c.id ? { ...x, active: v } : x))); api.codes.update(code!, c.id, { active: v }).catch((e) => { showToast(e.message); load(); }); }} />
                <IconButton icon="book-outline" onPress={() => setAssignFor(c)} label="교재 배정" />
                <IconButton icon="trash-outline" color={colors.danger} onPress={() => setConfirm({ title: '코드를 삭제할까요?', message: `${c.code} (${c.label || '이름 없음'}) 코드로는 더 이상 접속할 수 없게 됩니다.`, onYes: async () => { try { await api.codes.delete(code!, c.id); load(); } catch (e: any) { showToast(e?.message); } } })} />
              </Row>
            </Card>))}
        </>}
        {tab === 'log' && (stats ? <>
          <Row gap={10} style={{ marginBottom: 12 }}><Card style={{ flex: 1 }}><Muted variant="caption">코드</Muted><T variant="h2">{stats.codes}</T></Card><Card style={{ flex: 1 }}><Muted variant="caption">교재</Muted><T variant="h2">{stats.materials}</T></Card></Row>
          <Card padded={false} style={{ paddingHorizontal: 14 }}>{stats.log.map((l, i) => <Row key={i} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}><Badge label={l.ok ? '성공' : '거부'} tone={l.ok ? 'success' : 'danger'} /><Text style={{ fontWeight: '700', color: colors.text, width: 80 }}>{l.code || '-'}</Text><Muted variant="caption" style={{ flex: 1 }}>{l.action}</Muted><Muted variant="caption">{timeAgo(l.at)}</Muted></Row>)}</Card>
        </> : <ActivityIndicator color={colors.primary} />)}
      </ScrollView>

      <Sheet visible={!!upload} onClose={() => upload?.progress == null && setUpload(null)} title="교재 업로드">
        {upload && <>
          <Card style={{ marginBottom: 12 }}><Row><Ionicons name="document-text-outline" size={22} color={colors.primary} /><View style={{ flex: 1 }}><T variant="label" numberOfLines={1}>{upload.picked?.name}</T><Muted variant="caption">{fmtBytes(upload.picked?.size ?? 0)}</Muted></View></Row></Card>
          <Input label="교재 제목" value={upload.title} onChangeText={(t) => setUpload((u) => u && { ...u, title: t })} editable={upload.progress == null} />
          {upload.progress != null ? <><ProgressBar value={upload.progress} /><Muted variant="caption" style={{ marginTop: 6, textAlign: 'center' }}>업로드 중 {Math.round(upload.progress * 100)}%</Muted></> : <Button title="업로드" onPress={doUpload} />}
        </>}
      </Sheet>
      <Sheet visible={!!newCode} onClose={() => setNewCode(null)} title="접속 코드 추가">
        <Input label="이름 (학생/반)" placeholder="예) 고2 김민수" value={newCode?.label ?? ''} onChangeText={(t) => setNewCode((n) => n && { ...n, label: t })} />
        <Input label="코드 (비우면 6자리 자동 생성)" placeholder="숫자 4~12자리" keyboardType="number-pad" value={newCode?.code ?? ''} onChangeText={(t) => setNewCode((n) => n && { ...n, code: t.replace(/\D/g, '') })} />
        <Button title="만들기" onPress={async () => { try { const r = await api.codes.create(code!, newCode?.label ?? '', newCode?.code || undefined); showToast(`코드 ${r.code.code} 생성`); setNewCode(null); load(); setAssignFor(r.code); } catch (e: any) { showToast(e?.message); } }} />
      </Sheet>
      <Sheet visible={!!assignFor} onClose={() => setAssignFor(null)} title={assignFor ? `${assignFor.code} · ${assignFor.label || '이름 없음'}에 보일 교재` : ''}>
        {materials.length === 0 ? <Empty title="올린 교재가 없어요" /> : materials.map((m) => { const on = !!assignFor && codeMaterials(assignFor.id).includes(m.id); return <ListItem key={m.id} icon="document-text-outline" title={m.title} subtitle={`${m.pages ? m.pages + 'p · ' : ''}${fmtBytes(m.size)}`} right={<Toggle value={on} onChange={(v) => assignFor && toggleAssign(assignFor, m, v)} />} />; })}
        <Row style={{ marginTop: 10 }}><Button small variant="secondary" title="전체 배정" onPress={async () => { if (!assignFor) return; await api.assignBulk(code!, assignFor.id, materials.map((m) => m.id)); load(); }} /><Button small variant="ghost" title="전체 해제" onPress={async () => { if (!assignFor) return; await api.assignBulk(code!, assignFor.id, []); load(); }} /></Row>
      </Sheet>
      <Sheet visible={!!assignMat} onClose={() => setAssignMat(null)} title={assignMat ? `'${assignMat.title}'을 볼 수 있는 코드` : ''}>
        {codes.length === 0 ? <Empty title="접속 코드가 없어요" /> : codes.map((c) => <ListItem key={c.id} icon="key-outline" title={`${c.code} · ${c.label || '이름 없음'}`} subtitle={c.active ? '활성' : '비활성'} right={<Toggle value={!!assignMat && codeMaterials(c.id).includes(assignMat.id)} onChange={(v) => assignMat && toggleAssign(c, assignMat, v)} />} />)}
      </Sheet>
      <Sheet visible={!!editTitle} onClose={() => setEditTitle(null)} title="교재 제목 변경" height={240}><Input value={titleText} onChangeText={setTitleText} autoFocus /><Button title="저장" onPress={async () => { if (!editTitle) return; try { await api.materials.rename(code!, editTitle.id, titleText.trim() || editTitle.title); setEditTitle(null); load(); } catch (e: any) { showToast(e?.message); } }} /></Sheet>
      <Dialog visible={!!confirm} title={confirm?.title ?? ''} message={confirm?.message} onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '삭제', variant: 'danger', onPress: () => { const f = confirm?.onYes; setConfirm(null); f?.(); } }]} />
    </View>
  );
}
