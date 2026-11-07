import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, Text, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout, type, ios } from '@/theme';
import { Badge, Button, Dialog, Empty, IconButton, Input, Row, Sheet, Toggle, ProgressBar, ListItem, Group, Cell, Segmented, SearchField, TextButton } from '@/components/ui';
import { PageHeader, useMargin } from '@/components/Header';
import { GlassBackground } from '@/components/Glass';
import { useSession } from '@/store/session';
import { useDocsStore } from '@/store/docs';
import { api, Material, Roster, Assignment, HwStudent } from '@/lib/api';
import { uploadMaterial, uploadCover, MAX_UPLOAD_BYTES } from '@/lib/files';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'react-native';
import { fmtBytes, fmtDate, timeAgo } from '@/utils/format';

type Tab = 'materials' | 'students' | 'requests' | 'log';
export default function Admin() {
  const { colors } = useTheme(); const { isTablet } = useLayout(); const m = useMargin(); const { role, cred } = useSession(); const c = cred(); const showToast = useDocsStore((s) => s.showToast);
  const [tab, setTab] = useState<Tab>('materials'); const [materials, setMaterials] = useState<Material[]>([]); const [roster, setRoster] = useState<Roster | null>(null); const [loading, setLoading] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ title: string; picked?: { uri: string; name: string; size: number; file?: File }; cover?: { uri: string; mimeType?: string } | null; progress?: number; error?: string } | null>(null);
  const pickCover = async () => { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [3, 4] }); if (r.canceled || !r.assets?.length) return null; const a = r.assets[0]; return { uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg' }; };
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
  if (role !== 'admin') return <GlassBackground><PageHeader title="관리자" /><Empty icon="lock-closed-outline" title="관리자 전용" /></GlassBackground>;
  const pick = async () => { const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true }); if (r.canceled || !r.assets?.length) return; const a = r.assets[0]; setUpload({ title: a.name.replace(/\.pdf$/i, ''), picked: { uri: a.uri, name: a.name, size: a.size ?? 0, file: (a as any).file } }); };
  const doUpload = async () => { if (!upload?.picked) return; try { setUpload((u) => u && { ...u, progress: 0, error: undefined }); const m = await uploadMaterial(c, upload.picked, upload.title, (p) => setUpload((u) => u && { ...u, progress: p })); if (upload.cover) await uploadCover(c, m.id, upload.cover); showToast(`'${m.title}' 업로드 완료 · 이제 배정하세요`); setUpload(null); await load(); setAssignMat(m); } catch (e: any) { const msg = e?.name === 'UploadLimitError' || /^업로드 실패|^파일이|^네트워크/.test(e?.message ?? '') ? String(e.message) : '업로드 실패: ' + (e?.message ?? ''); showToast(msg); setUpload((u) => u && { ...u, progress: undefined, error: msg }); } };
  const pendingCount = roster?.requests.length ?? 0;
  const filteredStudents = useMemo(() => (roster?.students ?? []).filter((s) => !q || s.name.includes(q) || s.code.includes(q.toUpperCase()) || s.grade_name.includes(q) || s.school_name.includes(q)), [roster, q]);
  const bySchool = useMemo(() => { const map = new Map<string, { school: { id: string; name: string }; grades: { grade: { id: string; name: string }; students: HwStudent[] }[] }>(); for (const sc of roster?.schools ?? []) map.set(sc.id, { school: sc, grades: (roster?.grades ?? []).filter((g) => g.school_id === sc.id).map((g) => ({ grade: g, students: filteredStudents.filter((s) => s.grade_id === g.id) })) }); return Array.from(map.values()); }, [roster, filteredStudents]);
  const tabs = [{ k: 'materials' as Tab, label: '교재' }, { k: 'students' as Tab, label: '학생 · 반' }, { k: 'requests' as Tab, label: pendingCount ? `승인 요청 ${pendingCount}` : '승인 요청' }, { k: 'log' as Tab, label: '기록 · 설정' }];
  return (
    <GlassBackground>
      <PageHeader title="관리자" contentMaxWidth={isTablet ? 960 : undefined} subtitle={`교재 ${materials.length} · 학생 ${roster?.students.length ?? '-'}명 (옳은영어 숙제 시스템 실시간) · 연결 ${roster?.links.length ?? '-'}`} right={<>{tab === 'materials' && <IconButton icon="cloud-upload-outline" size={24} color={ios.blue} onPress={pick} label="교재 업로드" />}<IconButton icon="refresh" size={23} color={ios.blue} onPress={load} label="새로고침" /></>} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: m, paddingBottom: 80, maxWidth: isTablet ? 960 : undefined, width: '100%', alignSelf: 'center' }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
        <Segmented value={tab} onChange={setTab} items={tabs} style={{ marginTop: 4, marginBottom: 6 }} />
        {err && <Group><Cell><Row><Ionicons name="warning" size={18} color={ios.orange} /><Text style={[type.subhead, { color: colors.text, flex: 1 }]}>{err}</Text><TextButton title="다시 시도" size={15} onPress={load} /></Row></Cell></Group>}
        {tab === 'materials' && <>
          <Group><ListItem icon="cloud-upload" iconColor={ios.blue} title="PDF 교재 업로드" subtitle="파일당 최대 1GB · 업로드 후 학교/반/학생 단위로 배정" onPress={pick} /></Group>
          {materials.length === 0 ? <Empty icon="book-outline" title="교재가 없어요" message="위 버튼으로 첫 교재를 올려보세요" /> : (
            <Group header={`교재 ${materials.length}개`}>
              {materials.map((mt) => (
                <Cell key={mt.id} inset={56}>
                  <Row align="flex-start" gap={14}>
                    <Pressable accessibilityLabel="표지 바꾸기" onPress={async () => { const cv = await pickCover(); if (!cv) return; try { await uploadCover(c, mt.id, cv); showToast('표지를 바꿨어요'); load(); } catch (e: any) { showToast(e?.message); } }} style={styles.cover}>{mt.cover_url ? <Image source={{ uri: mt.cover_url }} style={{ width: 42, height: 56 }} /> : <Ionicons name="document-text" size={22} color={ios.blue} />}</Pressable>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={2} style={[type.bodyBold, { color: colors.text }]}>{mt.title}</Text>
                      <Text style={[type.footnote, { color: colors.textMuted, marginTop: 1 }]}>{mt.pages ? `${mt.pages}p · ` : ''}{fmtBytes(mt.size)} · {fmtDate(mt.created_at, { short: true })}{!mt.ready ? ' · 업로드 미완료' : ''}</Text>
                      <Row gap={6} style={{ marginTop: 7, flexWrap: 'wrap' }}><Badge label={reach(mt.id) ? `${reach(mt.id)}명에게 보임` : '배정 안 됨'} tone={reach(mt.id) ? 'primary' : 'neutral'} />{describeTargets(mt.id).slice(0, 5).map((t, i) => <Badge key={i} label={t} />)}</Row>
                    </View>
                    <Row gap={0}>
                      <IconButton icon="people-outline" color={ios.blue} onPress={() => setAssignMat(mt)} label="배정" />
                      <IconButton icon="pencil-outline" color={ios.blue} onPress={() => { setEditTitle(mt); setTitleText(mt.title); }} label="제목 변경" />
                      <IconButton icon="trash-outline" color={ios.red} label="삭제" onPress={() => setConfirm({ title: '교재를 삭제할까요?', message: `'${mt.title}' 파일과 배정 정보가 서버에서 삭제됩니다. 학생 기기에 이미 받은 사본은 남습니다.`, onYes: async () => { try { await api.materials.delete(c, mt.id); showToast('삭제했어요'); load(); } catch (e: any) { showToast(e?.message); } } })} />
                    </Row>
                  </Row>
                </Cell>))}
            </Group>)}
        </>}
        {tab === 'students' && <>
          <Text style={[type.footnote, { color: colors.textMuted, marginTop: 10, marginBottom: 10, paddingHorizontal: 4 }]}>학교·반·학생과 학생 코드는 orunhomework.com 학생관리에서 가져오며 수정은 그곳에서 합니다. 여기서는 Google 계정 연결 상태를 보고 해제할 수 있어요.</Text>
          <SearchField value={q} onChangeText={setQ} placeholder="이름, 코드, 학교, 반 검색" style={{ marginBottom: 4 }} />
          {!roster ? <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} /> : bySchool.map(({ school, grades }) => { const open = openSchool === school.id || !!q; return (
            <Group key={school.id}>
              <ListItem icon="school" iconColor={ios.blue} title={school.name} value={`${grades.length}개 반 · ${grades.reduce((a, g) => a + g.students.length, 0)}명`} chevron={false} right={<Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={17} color={ios.gray3} />} onPress={() => setOpenSchool(openSchool === school.id ? null : school.id)} />
              {open ? grades.map(({ grade, students }) => (
                <Cell key={grade.id}>
                  <Row style={{ marginBottom: 4 }}><Badge label={grade.name} tone="info" /><Text style={[type.footnote, { color: colors.textMuted }]}>{students.length}명 · 연결 {students.filter((st) => linkOf(st.id)).length}명</Text></Row>
                  {students.map((st) => { const l = linkOf(st.id); return (
                    <Row key={st.id} style={{ paddingVertical: 6 }} gap={12}>
                      <View style={[styles.avatar, { backgroundColor: l ? 'rgba(0,122,255,0.12)' : ios.tertiaryFill }]}><Text style={[type.subhead, { fontWeight: '700', color: l ? ios.blue : colors.textMuted }]}>{st.name.slice(0, 1)}</Text></View>
                      <View style={{ flex: 1, minWidth: 0 }}><Row gap={6}><Text style={[type.body, { color: colors.text }]}>{st.name}</Text><Text style={[type.footnote, { letterSpacing: 1.5, fontWeight: '600', color: colors.textMuted }]}>{st.code}</Text>{!st.code_active && <Badge label="코드 비활성" tone="danger" />}</Row><Text numberOfLines={1} style={[type.footnote, { color: colors.textMuted }]}>{l ? `${l.email} · 최근 ${l.last_seen_at ? timeAgo(l.last_seen_at) : '없음'}` : 'Google 계정 미연결 (첫 로그인 시 연결됨)'}</Text></View>
                      {l && <TextButton title="연결 해제" color={ios.red} size={15} accessibilityLabel="연결 해제" onPress={() => setConfirm({ title: `${st.name} 연결을 해제할까요?`, message: `${l.email} 계정과의 연결이 끊어지고, 학생이 다음 로그인 때 학생 코드를 다시 입력해 새 계정을 연결할 수 있어요.`, onYes: async () => { try { await api.unlink(c, st.id); load(); } catch (e: any) { showToast(e?.message); } } })} />}
                    </Row>); })}
                </Cell>)) : null}
            </Group>); })}
        </>}
        {tab === 'requests' && <>
          <Text style={[type.footnote, { color: colors.textMuted, marginTop: 10, marginBottom: 4, paddingHorizontal: 4 }]}>학생이 이미 연결된 것과 다른 Google 계정으로 학생 코드를 입력하면 여기에 요청이 생겨요. 승인하면 새 계정으로만 로그인할 수 있게 바뀝니다.</Text>
          {!roster ? <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} /> : roster.requests.length === 0 ? <Empty icon="checkmark-done-circle-outline" title="대기 중인 요청이 없어요" /> : (
            <Group>
              {roster.requests.map((r) => (
                <Cell key={r.id}>
                  <Row align="flex-start" gap={12}><View style={[styles.avatar, { backgroundColor: 'rgba(255,149,0,0.14)' }]}><Ionicons name="swap-horizontal" size={18} color={ios.orange} /></View><View style={{ flex: 1 }}><Text style={[type.bodyBold, { color: colors.text }]}>{r.student_name} <Text style={{ color: colors.textMuted, fontWeight: '400' }}>({r.student_code})</Text></Text><Text style={[type.footnote, { color: colors.textMuted, marginTop: 3 }]}>기존: {r.old_email}</Text><Text style={[type.footnote, { color: colors.textMuted }]}>변경 요청: <Text style={{ color: colors.text, fontWeight: '600' }}>{r.new_email}</Text></Text><Text style={[type.caption, { color: colors.textMuted, marginTop: 2 }]}>{timeAgo(r.created_at)}</Text>
                    <Row style={{ marginTop: 10 }}><Button small title="승인 (계정 변경)" icon="checkmark" onPress={async () => { try { await api.decide(c, r.id, true); showToast('승인했어요'); load(); } catch (e: any) { showToast(e?.message); } }} /><Button small variant="outline" title="거절" onPress={async () => { try { await api.decide(c, r.id, false); load(); } catch (e: any) { showToast(e?.message); } }} /></Row></View></Row>
                </Cell>))}
            </Group>)}
        </>}
        {tab === 'log' && (stats ? <>
          <Row gap={12} style={{ marginTop: 12 }}>{([['연결된 학생', stats.linked, ios.blue], ['교재', stats.materials, ios.green], ['대기 요청', stats.pending, ios.orange]] as const).map(([l, v, col]) => <View key={l} style={styles.stat}><Text style={[type.footnote, { color: colors.textMuted }]}>{l}</Text><Text style={[type.h1, { color: col, marginTop: 2 }]}>{v}</Text></View>)}</Row>
          <Group header="관리자 Google 계정" footer="이 이메일들은 Google 로그인만으로 관리자 모드에 들어옵니다. 관리자 코드도 계속 사용할 수 있어요.">
            {admins.map((a) => <ListItem key={a.email} icon="shield-checkmark" iconColor={ios.indigo} title={a.email} right={<TextButton title="삭제" color={ios.red} size={15} accessibilityLabel={`${a.email} 삭제`} onPress={async () => { await api.admins.remove(c, a.email); setAdmins((x) => x.filter((y) => y.email !== a.email)); }} />} />)}
            <Cell><Row><View style={{ flex: 1 }}><Input placeholder="admin@gmail.com" value={newAdmin} onChangeText={setNewAdmin} autoCapitalize="none" keyboardType="email-address" style={{ marginBottom: -12 }} /></View><Button small title="추가" onPress={async () => { try { await api.admins.add(c, newAdmin, ''); setNewAdmin(''); setAdmins((await api.admins.list(c)).admins); } catch (e: any) { showToast(e?.message); } }} /></Row></Cell>
          </Group>
          <Group header="최근 기록">
            {stats.log.length === 0 ? <Cell><Text style={[type.subhead, { color: colors.textMuted }]}>기록이 없어요</Text></Cell> : stats.log.map((l, i) => <Cell key={i}><Row gap={10}><Badge label={l.ok ? '성공' : '거부'} tone={l.ok ? 'success' : 'danger'} /><Text style={[type.subhead, { fontWeight: '600', color: colors.text, width: 110 }]} numberOfLines={1}>{l.code || '-'}</Text><Text numberOfLines={1} style={[type.footnote, { color: colors.textMuted, flex: 1 }]}>{l.action}</Text><Text style={[type.footnote, { color: colors.textMuted }]}>{timeAgo(l.at)}</Text></Row></Cell>)}
          </Group>
        </> : <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />)}
      </ScrollView>

      <Sheet visible={!!upload} onClose={() => upload?.progress == null && setUpload(null)} title="교재 업로드" grouped>
        {upload && <>
          <Group>
            <ListItem icon="document-text" iconColor={ios.blue} title={upload.picked?.name ?? ''} subtitle={fmtBytes(upload.picked?.size ?? 0)} />
          </Group>
          {(upload.picked?.size ?? 0) > MAX_UPLOAD_BYTES && <Text style={[type.footnote, { color: ios.red, fontWeight: '600', marginBottom: 8, paddingHorizontal: 4 }]}>1GB를 넘는 파일은 올릴 수 없어요. 압축하거나 나눠서 올려 주세요.</Text>}
          <Input label="교재 제목" value={upload.title} onChangeText={(t) => setUpload((u) => u && { ...u, title: t })} editable={upload.progress == null} style={{ backgroundColor: '#fff' }} />
          <Group header="표지 사진 (선택)">
            <Cell><Row gap={14}>
              <Pressable onPress={async () => { const cv = await pickCover(); if (cv) setUpload((u) => u && { ...u, cover: cv }); }} style={[styles.coverPick, upload.cover ? null : { borderStyle: 'dashed', borderWidth: 1, borderColor: ios.gray3 }]}>{upload.cover ? <Image source={{ uri: upload.cover.uri }} style={{ width: 66, height: 88 }} /> : <Ionicons name="image-outline" size={22} color={ios.gray} />}</Pressable>
              <View style={{ flex: 1 }}><Text style={[type.subhead, { color: colors.textMuted }]}>따로 넣지 않으면 PDF 첫 페이지가 표지로 보여요.</Text>{upload.cover && <TextButton title="표지 제거" color={ios.red} size={15} onPress={() => setUpload((u) => u && { ...u, cover: null })} style={{ marginLeft: -6 }} />}</View>
            </Row></Cell>
          </Group>
          <View style={{ marginTop: 14 }}>{upload.progress != null ? <><ProgressBar value={upload.progress} height={6} /><Text style={[type.footnote, { color: colors.textMuted, marginTop: 8, textAlign: 'center' }]}>업로드 중 {Math.round(upload.progress * 100)}%{upload.picked?.size ? ` · ${fmtBytes(upload.progress * upload.picked.size)} / ${fmtBytes(upload.picked.size)}` : ''}{upload.progress >= 0.99 ? ' · 서버에서 마무리 중' : ''}</Text></> : <>{!!upload.error && <Text style={[type.footnote, { color: ios.red, fontWeight: '600', marginBottom: 10, textAlign: 'center' }]}>{upload.error}</Text>}<Button title={upload.error ? '다시 업로드' : '업로드'} onPress={doUpload} disabled={(upload.picked?.size ?? 0) > MAX_UPLOAD_BYTES} /></>}</View>
        </>}
      </Sheet>
      <Sheet visible={!!assignMat} onClose={() => setAssignMat(null)} title={assignMat ? `'${assignMat.title}' 배정` : undefined} grouped>
        {assignMat && roster && <>
          <Group><ListItem icon="earth" iconColor={ios.blue} title="전체 학생" subtitle={`숙제 시스템의 모든 학생 ${roster.students.length}명`} right={<Toggle value={isOn(assignMat.id, 'all', null)} onChange={(v) => toggle(assignMat, 'all', null, v)} />} /></Group>
          {roster.schools.map((sc) => (
            <Group key={sc.id} header={sc.name}>
              <ListItem icon="school" iconColor={ios.indigo} title="학교 전체" subtitle={`${roster.students.filter((st) => st.school_id === sc.id).length}명`} right={<Toggle value={isOn(assignMat.id, 'school', sc.id)} onChange={(v) => toggle(assignMat, 'school', sc.id, v)} />} />
              {roster.grades.filter((g) => g.school_id === sc.id).map((g) => (
                <Cell key={g.id} inset={43}>
                  <Row gap={14}><View style={[styles.sq, { backgroundColor: ios.teal }]}><Ionicons name="people" size={16} color="#fff" /></View><View style={{ flex: 1 }}><Text style={[type.body, { color: colors.text }]}>{g.name}</Text><Text style={[type.footnote, { color: colors.textMuted }]}>반 전체 {roster.students.filter((st) => st.grade_id === g.id).length}명</Text></View><Toggle value={isOn(assignMat.id, 'grade', g.id)} onChange={(v) => toggle(assignMat, 'grade', g.id, v)} /></Row>
                  <Row style={{ flexWrap: 'wrap', paddingLeft: 43, paddingTop: 10 }} gap={6}>
                    {roster.students.filter((st) => st.grade_id === g.id).map((st) => { const on = isOn(assignMat.id, 'student', st.id); const inherited = isOn(assignMat.id, 'all', null) || isOn(assignMat.id, 'school', sc.id) || isOn(assignMat.id, 'grade', g.id); return <Pressable key={st.id} onPress={() => toggle(assignMat, 'student', st.id, !on)} style={({ pressed }) => ({ paddingHorizontal: 11, height: 30, justifyContent: 'center', borderRadius: 15, backgroundColor: on ? ios.blue : inherited ? 'rgba(0,122,255,0.12)' : ios.tertiaryFill, opacity: pressed ? 0.6 : 1 })}><Text style={[type.footnote, { fontWeight: '600', color: on ? '#fff' : inherited ? ios.blue : colors.textMuted }]}>{st.name}</Text></Pressable>; })}
                  </Row>
                </Cell>))}
            </Group>))}
          <Text style={[type.footnote, { color: colors.textMuted, marginTop: 6, paddingHorizontal: 4 }]}>파란 이름 = 개별 배정, 연한 파랑 = 상위(전체/학교/반) 배정으로 이미 보임. 현재 {reach(assignMat.id)}명에게 보입니다.</Text>
        </>}
      </Sheet>
      <Sheet visible={!!editTitle} onClose={() => setEditTitle(null)} title="교재 제목 변경" grouped height={260}><Input value={titleText} onChangeText={setTitleText} autoFocus style={{ backgroundColor: '#fff' }} /><Button title="저장" onPress={async () => { if (!editTitle) return; try { await api.materials.rename(c, editTitle.id, titleText.trim() || editTitle.title); setEditTitle(null); load(); } catch (e: any) { showToast(e?.message); } }} /></Sheet>
      <Dialog visible={!!confirm} title={confirm?.title ?? ' '} message={confirm?.message} onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '확인', variant: 'danger', onPress: () => { const f = confirm?.onYes; setConfirm(null); f?.(); } }]} />
    </GlassBackground>
  );
}

const styles = StyleSheet.create({
  cover: { width: 42, height: 56, borderRadius: 6, backgroundColor: 'rgba(0,122,255,0.10)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.12)' },
  coverPick: { width: 66, height: 88, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#F2F2F7' },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sq: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14 },
});
