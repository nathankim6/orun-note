import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, Text, ActivityIndicator, RefreshControl, TextInput } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout } from '@/theme';
import { Badge, Button, Card, Chip, Dialog, Empty, IconButton, Input, Muted, Row, Sheet, T, Toggle, ProgressBar, ListItem } from '@/components/ui';
import { PageHeader } from '@/components/Header';
import { GlassBackground } from '@/components/Glass';
import { useSession } from '@/store/session';
import { useDocsStore } from '@/store/docs';
import { api, Material, Roster, Assignment, HwStudent } from '@/lib/api';
import { uploadMaterial } from '@/lib/files';
import { fmtBytes, fmtDate, timeAgo } from '@/utils/format';

type Tab = 'materials' | 'students' | 'requests' | 'log';
export default function Admin() {
  const { colors } = useTheme(); const { isTablet } = useLayout(); const { role, cred } = useSession(); const c = cred(); const showToast = useDocsStore((s) => s.showToast);
  const [tab, setTab] = useState<Tab>('materials'); const [materials, setMaterials] = useState<Material[]>([]); const [roster, setRoster] = useState<Roster | null>(null); const [loading, setLoading] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ title: string; picked?: { uri: string; name: string; size: number; file?: File }; progress?: number } | null>(null);
  const [assignMat, setAssignMat] = useState<Material | null>(null); const [openSchool, setOpenSchool] = useState<string | null>(null); const [q, setQ] = useState(''); const [confirm, setConfirm] = useState<{ title: string; message: string; onYes: () => void } | null>(null);
  const [stats, setStats] = useState<{ linked: number; materials: number; pending: number; log: { code: string; action: string; ok: boolean; at: string }[] } | null>(null); const [editTitle, setEditTitle] = useState<Material | null>(null); const [titleText, setTitleText] = useState(''); const [admins, setAdmins] = useState<{ email: string; label: string }[]>([]); const [newAdmin, setNewAdmin] = useState('');
  const load = async () => { setLoading(true); setErr(null); try { const [m, r] = await Promise.all([api.list(c), api.roster(c)]); setMaterials(m.materials); setRoster(r); if (tab === 'log') { setStats(await api.stats(c)); setAdmins((await api.admins.list(c)).admins); } } catch (e: any) { setErr(e?.message ?? '불러오기 실패'); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [tab]);
  const assigns = roster?.assignments ?? []; const linkOf = (sid: string) => roster?.links.find((l) => l.student_id === sid);
  const targetsFor = (mid: string) => assigns.filter((a) => a.material_id === mid);
  const isOn = (mid: string, type: Assignment['target_type'], id: string | null) => assigns.some((a) => a.material_id === mid && a.target_type === type && (type === 'all' ? true : a.target_id === id));
  const describeTargets = (mid: string) => { const t = targetsFor(mid); if (!roster) return []; return t.map((a) => a.target_type === 'all' ? '전체 학생' : a.target_type === 'school' ? (roster.schools.find((s) => s.id === a.target_id)?.name ?? '학교') : a.target_type === 'grade' ? (() => { const g = roster.grades.find((g) => g.id === a.target_id); const sc = roster.schools.find((s) => s.id === g?.school_id); return `${sc?.name ?? ''} ${g?.name ?? '반'}`.trim(); })() : (roster.students.find((s) => s.id === a.target_id)?.name ?? '학생')); };
  // How many students a material reaches (dedup by student)
  const reach = (mid: string) => { if (!roster) return 0; const t = targetsFor(mid); if (t.some((a) => a.target_type === 'all')) return roster.students.length; const ids = new Set<string>(); for (const s of roster.students) if (t.some((a) => (a.target_type === 'school' && a.target_id === s.school_id) || (a.target_type === 'grade' && a.target_id === s.grade_id) || (a.target_type === 'student' && a.target_id === s.id))) ids.add(s.id); return ids.size; };
  const toggle = async (m: Material, type: Assignment['target_type'], id: string | null, on: boolean) => { setRoster((r) => r && ({ ...r, assignments: on ? [...r.assignments, { id: 'tmp' + Math.random(), material_id: m.id, target_type: type, target_id: id }] : r.assignments.filter((a) => !(a.material_id === m.id && a.target_type === type && (type === 'all' || a.target_id === id))) })); try { await api.assignToggle(c, m.id, type, id, on); } catch (e: any) { showToast('저장 실패: ' + e?.message); load(); } };
  if (role !== 'admin') return <View style={{ flex: 1 }}><PageHeader title="관리자" /><Empty icon="lock-closed-outline" title="관리자 전용" /></View>;
  const pick = async () => { const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true }); if (r.canceled || !r.assets?.length) return; const a = r.assets[0]; setUpload({ title: a.name.replace(/\.pdf$/i, ''), picked: { uri: a.uri, name: a.name, size: a.size ?? 0, file: (a as any).file } }); };
  const doUpload = async () => { if (!upload?.picked) return; try { setUpload((u) => u && { ...u, progress: 0 }); const m = await uploadMaterial(c, upload.picked, upload.title, (p) => setUpload((u) => u && { ...u, progress: p })); showToast(`'${m.title}' 업로드 완료 · 이제 배정하세요`); setUpload(null); await load(); setAssignMat(m); } catch (e: any) { showToast('업로드 실패: ' + (e?.message ?? '')); setUpload((u) => u && { ...u, progress: undefined }); } };
  const pendingCount = roster?.requests.length ?? 0;
  const filteredStudents = useMemo(() => (roster?.students ?? []).filter((s) => !q || s.name.includes(q) || s.code.includes(q.toUpperCase()) || s.grade_name.includes(q) || s.school_name.includes(q)), [roster, q]);
  const bySchool = useMemo(() => { const map = new Map<string, { school: { id: string; name: string }; grades: { grade: { id: string; name: string }; students: HwStudent[] }[] }>(); for (const sc of roster?.schools ?? []) map.set(sc.id, { school: sc, grades: (roster?.grades ?? []).filter((g) => g.school_id === sc.id).map((g) => ({ grade: g, students: filteredStudents.filter((s) => s.grade_id === g.id) })) }); return Array.from(map.values()); }, [roster, filteredStudents]);
  const Seg = () => <Row style={{ marginBottom: 12, flexWrap: 'wrap' }}>{([['materials', '교재', 'book-outline'], ['students', '학생 · 반', 'people-outline'], ['requests', pendingCount ? `승인 요청 ${pendingCount}` : '승인 요청', 'mail-unread-outline'], ['log', '기록 · 설정', 'time-outline']] as const).map(([k, l, i]) => <Chip key={k} label={l} icon={i} active={tab === k} onPress={() => setTab(k)} color={k === 'requests' && pendingCount ? colors.accent : undefined} />)}</Row>;
  return (
    <GlassBackground>
      <PageHeader title="관리자" subtitle={`교재 ${materials.length} · 학생 ${roster?.students.length ?? '-'}명 (옳은영어 숙제 시스템 실시간) · 연결 ${roster?.links.length ?? '-'}`} right={<Row gap={0}>{tab === 'materials' && <IconButton icon="cloud-upload" size={24} color={colors.primary} onPress={pick} label="교재 업로드" />}<IconButton icon="refresh" onPress={load} /></Row>} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80, maxWidth: isTablet ? 960 : undefined, width: '100%', alignSelf: 'center' }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <Seg />
        {err && <Card style={{ borderColor: colors.danger, marginBottom: 12 }}><Row><Ionicons name="warning-outline" size={18} color={colors.danger} /><Muted style={{ flex: 1 }}>{err}</Muted><Button small variant="ghost" title="다시" onPress={load} /></Row></Card>}
        {tab === 'materials' && <>
          <Card onPress={pick} style={{ borderStyle: 'dashed', alignItems: 'center', marginBottom: 14 }}><Ionicons name="cloud-upload-outline" size={30} color={colors.primary} /><T variant="bodyBold" style={{ marginTop: 6 }}>PDF 교재 업로드</T><Muted variant="caption">파일당 최대 50MB · 업로드 후 학교/반/학생 단위로 배정</Muted></Card>
          {materials.length === 0 ? <Empty icon="book-outline" title="교재가 없어요" message="위 버튼으로 첫 교재를 올려보세요" /> : materials.map((m) => (
            <Card key={m.id} style={{ marginBottom: 10 }} padded={false}>
              <Row style={{ padding: 14 }} align="flex-start">
                <View style={{ width: 40, height: 52, borderRadius: 8, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="document-text" size={22} color={colors.primary} /></View>
                <View style={{ flex: 1 }}><T variant="bodyBold" numberOfLines={2}>{m.title}</T><Muted variant="caption">{m.pages ? `${m.pages}p · ` : ''}{fmtBytes(m.size)} · {fmtDate(m.created_at, { short: true })}{!m.ready ? ' · 업로드 미완료' : ''}</Muted>
                  <Row gap={6} style={{ marginTop: 6, flexWrap: 'wrap' }}><Badge label={reach(m.id) ? `${reach(m.id)}명에게 보임` : '배정 안 됨'} tone={reach(m.id) ? 'primary' : 'neutral'} />{describeTargets(m.id).slice(0, 5).map((t, i) => <Badge key={i} label={t} />)}</Row></View>
                <Row gap={0}><IconButton icon="people-outline" color={colors.primary} onPress={() => setAssignMat(m)} label="배정" /><IconButton icon="create-outline" onPress={() => { setEditTitle(m); setTitleText(m.title); }} /><IconButton icon="trash-outline" color={colors.danger} onPress={() => setConfirm({ title: '교재를 삭제할까요?', message: `'${m.title}' 파일과 배정 정보가 서버에서 삭제됩니다. 학생 기기에 이미 받은 사본은 남습니다.`, onYes: async () => { try { await api.materials.delete(c, m.id); showToast('삭제했어요'); load(); } catch (e: any) { showToast(e?.message); } } })} /></Row>
              </Row>
            </Card>))}
        </>}
        {tab === 'students' && <>
          <Muted variant="caption" style={{ marginBottom: 8 }}>학교·반·학생과 학생 코드는 orunhomework.com 학생관리에서 가져오며 수정은 그곳에서 합니다. 여기서는 Google 계정 연결 상태를 보고 해제할 수 있어요.</Muted>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E3E8F0', paddingHorizontal: 12, marginBottom: 12 }}><Ionicons name="search" size={18} color={colors.textFaint} /><TextInput value={q} onChangeText={setQ} placeholder="이름, 코드, 학교, 반 검색" placeholderTextColor={colors.textFaint} style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, color: colors.text }} /></View>
          {!roster ? <ActivityIndicator color={colors.primary} /> : bySchool.map(({ school, grades }) => (
            <Card key={school.id} style={{ marginBottom: 10 }} padded={false}>
              <Pressable onPress={() => setOpenSchool(openSchool === school.id ? null : school.id)} style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Ionicons name="school-outline" size={20} color={colors.primary} /><T variant="bodyBold" style={{ flex: 1 }}>{school.name}</T><Muted variant="caption">{grades.length}개 반 · {grades.reduce((a, g) => a + g.students.length, 0)}명</Muted><Ionicons name={openSchool === school.id || q ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} /></Pressable>
              {(openSchool === school.id || !!q) && grades.map(({ grade, students }) => (
                <View key={grade.id} style={{ borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', paddingHorizontal: 14, paddingVertical: 8 }}>
                  <Row><Badge label={grade.name} tone="info" /><Muted variant="caption">{students.length}명 · 연결 {students.filter((s) => linkOf(s.id)).length}명</Muted></Row>
                  {students.map((s) => { const l = linkOf(s.id); return (
                    <Row key={s.id} style={{ paddingVertical: 6 }}>
                      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: l ? colors.primarySoft : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontWeight: '800', color: l ? colors.primary : colors.textFaint }}>{s.name.slice(0, 1)}</Text></View>
                      <View style={{ flex: 1 }}><Row gap={6}><T variant="label">{s.name}</T><Text style={{ fontSize: 12, letterSpacing: 1.5, fontWeight: '700', color: colors.textMuted }}>{s.code}</Text>{!s.code_active && <Badge label="코드 비활성" tone="danger" />}</Row><Muted variant="caption" numberOfLines={1}>{l ? `${l.email} · 최근 ${l.last_seen_at ? timeAgo(l.last_seen_at) : '없음'}` : 'Google 계정 미연결 (첫 로그인 시 연결됨)'}</Muted></View>
                      {l && <IconButton icon="link-outline" color={colors.danger} label="연결 해제" onPress={() => setConfirm({ title: `${s.name} 연결을 해제할까요?`, message: `${l.email} 계정과의 연결이 끊어지고, 학생이 다음 로그인 때 학생 코드를 다시 입력해 새 계정을 연결할 수 있어요.`, onYes: async () => { try { await api.unlink(c, s.id); load(); } catch (e: any) { showToast(e?.message); } } })} />}
                    </Row>); })}
                </View>))}
            </Card>))}
        </>}
        {tab === 'requests' && <>
          <Muted variant="caption" style={{ marginBottom: 8 }}>학생이 이미 연결된 것과 다른 Google 계정으로 학생 코드를 입력하면 여기에 요청이 생겨요. 승인하면 새 계정으로만 로그인할 수 있게 바뀝니다.</Muted>
          {!roster ? <ActivityIndicator color={colors.primary} /> : roster.requests.length === 0 ? <Empty icon="checkmark-done-outline" title="대기 중인 요청이 없어요" /> : roster.requests.map((r) => (
            <Card key={r.id} style={{ marginBottom: 10 }}>
              <Row align="flex-start"><Ionicons name="swap-horizontal" size={22} color={colors.accent} /><View style={{ flex: 1 }}><T variant="bodyBold">{r.student_name} <Text style={{ color: colors.textMuted, fontWeight: '500' }}>({r.student_code})</Text></T><Muted variant="caption" style={{ marginTop: 4 }}>기존: {r.old_email}</Muted><Muted variant="caption">변경 요청: <Text style={{ color: colors.text, fontWeight: '600' }}>{r.new_email}</Text></Muted><Muted variant="caption">{timeAgo(r.created_at)}</Muted></View></Row>
              <Row style={{ marginTop: 12 }}><Button small title="승인 (계정 변경)" icon="checkmark" onPress={async () => { try { await api.decide(c, r.id, true); showToast('승인했어요'); load(); } catch (e: any) { showToast(e?.message); } }} /><Button small variant="ghost" title="거절" onPress={async () => { try { await api.decide(c, r.id, false); load(); } catch (e: any) { showToast(e?.message); } }} /></Row>
            </Card>))}
        </>}
        {tab === 'log' && (stats ? <>
          <Row gap={10} style={{ marginBottom: 12 }}><Card style={{ flex: 1 }}><Muted variant="caption">연결된 학생</Muted><T variant="h2">{stats.linked}</T></Card><Card style={{ flex: 1 }}><Muted variant="caption">교재</Muted><T variant="h2">{stats.materials}</T></Card><Card style={{ flex: 1 }}><Muted variant="caption">대기 요청</Muted><T variant="h2">{stats.pending}</T></Card></Row>
          <Card style={{ marginBottom: 12 }}>
            <T variant="bodyBold">관리자 Google 계정</T><Muted variant="caption" style={{ marginBottom: 8 }}>이 이메일들은 Google 로그인만으로 관리자 모드에 들어옵니다. 관리자 코드도 계속 사용할 수 있어요.</Muted>
            {admins.map((a) => <Row key={a.email} style={{ paddingVertical: 4 }}><Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} /><T variant="label" style={{ flex: 1 }}>{a.email}</T><IconButton icon="close" size={16} onPress={async () => { await api.admins.remove(c, a.email); setAdmins((x) => x.filter((y) => y.email !== a.email)); }} /></Row>)}
            <Row style={{ marginTop: 6 }}><View style={{ flex: 1 }}><Input placeholder="admin@gmail.com" value={newAdmin} onChangeText={setNewAdmin} autoCapitalize="none" keyboardType="email-address" /></View><Button small title="추가" onPress={async () => { try { await api.admins.add(c, newAdmin, ''); setNewAdmin(''); setAdmins((await api.admins.list(c)).admins); } catch (e: any) { showToast(e?.message); } }} /></Row>
          </Card>
          <Card padded={false} style={{ paddingHorizontal: 14 }}>{stats.log.map((l, i) => <Row key={i} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' }}><Badge label={l.ok ? '성공' : '거부'} tone={l.ok ? 'success' : 'danger'} /><Text style={{ fontWeight: '700', color: colors.text, width: 110 }} numberOfLines={1}>{l.code || '-'}</Text><Muted variant="caption" style={{ flex: 1 }}>{l.action}</Muted><Muted variant="caption">{timeAgo(l.at)}</Muted></Row>)}</Card>
        </> : <ActivityIndicator color={colors.primary} />)}
      </ScrollView>

      <Sheet visible={!!upload} onClose={() => upload?.progress == null && setUpload(null)} title="교재 업로드">
        {upload && <>
          <Card style={{ marginBottom: 12 }}><Row><Ionicons name="document-text-outline" size={22} color={colors.primary} /><View style={{ flex: 1 }}><T variant="label" numberOfLines={1}>{upload.picked?.name}</T><Muted variant="caption">{fmtBytes(upload.picked?.size ?? 0)}</Muted></View></Row></Card>
          <Input label="교재 제목" value={upload.title} onChangeText={(t) => setUpload((u) => u && { ...u, title: t })} editable={upload.progress == null} />
          {upload.progress != null ? <><ProgressBar value={upload.progress} /><Muted variant="caption" style={{ marginTop: 6, textAlign: 'center' }}>업로드 중 {Math.round(upload.progress * 100)}%</Muted></> : <Button title="업로드" onPress={doUpload} />}
        </>}
      </Sheet>
      <Sheet visible={!!assignMat} onClose={() => setAssignMat(null)} title={assignMat ? `'${assignMat.title}' 배정` : undefined}>
        {assignMat && roster && <>
          <ListItem icon="earth-outline" title="전체 학생" subtitle={`숙제 시스템의 모든 학생 ${roster.students.length}명`} right={<Toggle value={isOn(assignMat.id, 'all', null)} onChange={(v) => toggle(assignMat, 'all', null, v)} />} />
          {roster.schools.map((sc) => (
            <View key={sc.id} style={{ marginTop: 8 }}>
              <ListItem icon="school-outline" title={sc.name} subtitle={`학교 전체 ${roster.students.filter((s) => s.school_id === sc.id).length}명`} right={<Toggle value={isOn(assignMat.id, 'school', sc.id)} onChange={(v) => toggle(assignMat, 'school', sc.id, v)} />} />
              {roster.grades.filter((g) => g.school_id === sc.id).map((g) => (
                <View key={g.id} style={{ paddingLeft: 18 }}>
                  <ListItem icon="people-outline" title={g.name} subtitle={`반 전체 ${roster.students.filter((s) => s.grade_id === g.id).length}명`} right={<Toggle value={isOn(assignMat.id, 'grade', g.id)} onChange={(v) => toggle(assignMat, 'grade', g.id, v)} />} />
                  <Row style={{ flexWrap: 'wrap', paddingLeft: 36, paddingBottom: 6 }} gap={6}>
                    {roster.students.filter((s) => s.grade_id === g.id).map((s) => { const on = isOn(assignMat.id, 'student', s.id); const inherited = isOn(assignMat.id, 'all', null) || isOn(assignMat.id, 'school', sc.id) || isOn(assignMat.id, 'grade', g.id); return <Pressable key={s.id} onPress={() => toggle(assignMat, 'student', s.id, !on)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? colors.primary : inherited ? colors.primarySoft : 'rgba(0,0,0,0.04)', borderWidth: 1, borderColor: on ? colors.primary : 'transparent' }}><Text style={{ fontSize: 12, fontWeight: '600', color: on ? '#fff' : inherited ? colors.primary : colors.textMuted }}>{s.name}</Text></Pressable>; })}
                  </Row>
                </View>))}
            </View>))}
          <Muted variant="caption" style={{ marginTop: 10 }}>진한 파랑 = 개별 배정, 연한 파랑 = 상위(전체/학교/반) 배정으로 이미 보임. 현재 {reach(assignMat.id)}명에게 보입니다.</Muted>
        </>}
      </Sheet>
      <Sheet visible={!!editTitle} onClose={() => setEditTitle(null)} title="교재 제목 변경" height={240}><Input value={titleText} onChangeText={setTitleText} autoFocus /><Button title="저장" onPress={async () => { if (!editTitle) return; try { await api.materials.rename(c, editTitle.id, titleText.trim() || editTitle.title); setEditTitle(null); load(); } catch (e: any) { showToast(e?.message); } }} /></Sheet>
      <Dialog visible={!!confirm} title={confirm?.title ?? ' '} message={confirm?.message} onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '확인', variant: 'danger', onPress: () => { const f = confirm?.onYes; setConfirm(null); f?.(); } }]} />
    </GlassBackground>
  );
}
