import React, { useEffect, useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import Constants from 'expo-constants';
import { useTheme, useLayout, type, ios } from '@/theme';
import { ListItem, Toggle, Dialog, Group, Cell, Segmented } from '@/components/ui';
import { PageHeader, useMargin } from '@/components/Header';
import { GlassBackground } from '@/components/Glass';
import { useSettingsStore, ViewerPrefs } from '@/store/settings';
import { useDocsStore } from '@/store/docs';
import { useInkStore } from '@/store/ink';
import { clearPageCache, storageUsage, deleteDocFiles } from '@/lib/files';
import { api } from '@/lib/api';
import { PdfRenderer } from '../../modules/pdf-renderer';
import { clearImageCache } from '@/features/viewer/PdfPage';
import { fmtBytes, fmtDate } from '@/utils/format';
import { useSession } from '@/store/session';
import { APP_NAME } from '@/lib/config';

export default function Settings() {
  const { colors } = useTheme(); const { isTablet } = useLayout(); const m = useMargin(); const s = useSettingsStore(); const docs = useDocsStore((x) => x.docs); const showToast = useDocsStore((x) => x.showToast); const inkPages = useInkStore((x) => x.pages);
  const [usage, setUsage] = useState(0); const [confirm, setConfirm] = useState(false); const [confirmOut, setConfirmOut] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false); const [deleting, setDeleting] = useState(false); const session = useSession();
  useEffect(() => { storageUsage().then(setUsage); }, [docs]);
  const strokes = Object.values(inkPages).reduce((a, p) => a + p.strokes.length, 0);
  const toggleRow = (k: keyof ViewerPrefs, title: string, desc: string, icon: any, iconColor: string) => <ListItem key={k} icon={icon} iconColor={iconColor} title={title} subtitle={desc} right={<Toggle value={!!s.viewer[k]} onChange={(v) => s.setViewer({ [k]: v } as any)} />} />;
  const layout = (s.viewer.defaultLayoutMode === 'continuous' ? 'vertical' : s.viewer.defaultLayoutMode) as 'vertical' | 'horizontal' | 'twoPage';
  const isAdmin = session.role === 'admin';
  return (
    <GlassBackground>
      <PageHeader title="설정" contentMaxWidth={isTablet ? 720 : undefined} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: m, paddingBottom: 60, maxWidth: isTablet ? 720 : undefined, width: '100%', alignSelf: 'center' }}>
        <Group header="접속 정보">
          <ListItem icon={isAdmin ? 'shield-checkmark' : 'person'} iconColor={isAdmin ? ios.indigo : ios.blue} title={isAdmin ? '관리자 모드' : `${session.label || '학생'}${session.student ? ` · ${session.student.school_name} ${session.student.grade_name}` : ''}`} subtitle={`${session.email ?? (session.adminCode ? '관리자 코드로 입장' : '-')}${session.student ? ` · 학생 코드 ${session.student.code}` : ''}${session.verifiedAt ? ' · 확인 ' + fmtDate(session.verifiedAt, { time: true }) : ''}`} />
          <ListItem icon="log-out-outline" iconColor={ios.gray} title="로그아웃" tint={ios.red} subtitle="받아둔 교재와 필기는 기기에 남지만 다시 로그인해야 열 수 있어요. Google 계정 변경은 관리자 승인이 필요해요" onPress={() => setConfirmOut(true)} chevron={false} />
          {!session.adminCode && !!session.email && <ListItem icon="person-remove-outline" iconColor={ios.red} title="계정 삭제" tint={ios.red} subtitle="이 로그인 계정과 학생 코드 연결을 서버에서 지우고, 이 기기에 받은 교재와 필기도 모두 삭제해요." chevron={false} onPress={() => setConfirmDelete(true)} />}
        </Group>
        <Group header="보기 옵션 (뷰어 기본값)" footer="문서를 열 때 적용되는 기본값이에요. 보기 화면에서 바꾼 설정도 여기에 저장돼요.">
          <Cell><Text style={[type.body, { color: colors.text, marginBottom: 10 }]}>기본 레이아웃</Text><Segmented value={layout} onChange={(k) => s.setViewer({ defaultLayoutMode: k })} items={[{ k: 'vertical', label: '상하 스크롤' }, { k: 'horizontal', label: '좌우 넘기기' }, { k: 'twoPage', label: '2페이지씩 좌우' }]} /></Cell>
          {toggleRow('strokeSmoothing', '획 보정', '부드러운 곡선으로 그려요', 'color-wand', ios.orange)}
          {toggleRow('lineSnap', '직선 보정', '끝점에서 0.5초 머무르면 직선으로', 'remove', ios.indigo)}
          {toggleRow('doubleTapZoomEnabled', '더블탭으로 확대', '두 번 탭하면 2배 확대/원복', 'expand', ios.teal)}
          {toggleRow('twoPageStartOdd', '2페이지씩 보기: 1쪽을 왼쪽에', '끄면 1쪽을 표지처럼 따로 보여줘요', 'book', ios.purple)}
          <ListItem title="보기 옵션 초기화" tint={ios.blue} chevron={false} onPress={() => { s.resetViewer(); showToast('기본값으로 되돌렸어요'); }} />
        </Group>
        <Group header="저장 공간">
          <ListItem icon="document-text" iconColor={ios.blue} title="PDF 파일" value={`${Object.keys(docs).length}개 · ${fmtBytes(usage)}`} />
          <ListItem icon="pencil" iconColor={ios.orange} title="필기 데이터" value={`${strokes}획 · ${Object.keys(inkPages).length}페이지`} />
          <ListItem icon="images" iconColor={ios.teal} title="페이지 렌더 캐시 비우기" subtitle="PDF 페이지 이미지 캐시를 삭제합니다 (다시 열면 재생성)" chevron={false} onPress={async () => { await clearPageCache(); clearImageCache(); showToast('캐시를 비웠어요'); }} />
          <ListItem icon="trash" iconColor={ios.red} title="모든 필기 삭제" tint={ios.red} chevron={false} onPress={() => setConfirm(true)} />
        </Group>
        <Group header="정보">
          <ListItem icon="help-buoy" iconColor={ios.pink} title="뷰어 사용 가이드 다시보기" onPress={() => { s.setViewerGuideDone(false); showToast('다음에 문서를 열면 가이드가 표시돼요'); }} />
          <ListItem icon="information-circle" iconColor={ios.gray} title={`${APP_NAME} 버전`} value={`v${Constants.expoConfig?.version ?? '1.0.0'}`} />
          <ListItem icon="code-slash" iconColor={ios.gray} title="PDF 엔진" value="iOS PDFKit · Android PdfRenderer · Web pdf.js" />
        </Group>
        <View style={{ height: 12 }} />
      </ScrollView>
      <Dialog visible={confirmDelete} title="계정을 삭제할까요?" message="로그인 계정과 학생 코드 연결이 서버에서 삭제되고, 이 기기에 받은 교재·필기·설정도 모두 지워져요. 되돌릴 수 없어요. (학원 숙제 시스템의 학생 정보는 그대로예요)" onClose={() => setConfirmDelete(false)}
        actions={[{ label: '취소', onPress: () => setConfirmDelete(false) }, { label: deleting ? '삭제 중…' : '계정 삭제', variant: 'danger', onPress: async () => {
          if (deleting) return; setDeleting(true);
          try {
            await api.deleteAccount();
            const all = Object.values(useDocsStore.getState().docs); for (const d of all) { try { await deleteDocFiles(d); } catch {} }
            useDocsStore.setState({ docs: {}, folders: [], openTabs: [], activeTab: null }); useInkStore.setState({ pages: {} } as any); await PdfRenderer.clearCaches();
            setConfirmDelete(false); await session.signOut(); showToast('계정을 삭제했어요');
          } catch (e: any) { showToast(e?.message ?? '계정을 삭제하지 못했어요'); }
          finally { setDeleting(false); }
        } }]} />
      <Dialog visible={confirmOut} title="로그아웃할까요?" message="로그인 화면으로 돌아갑니다." onClose={() => setConfirmOut(false)} actions={[{ label: '취소', onPress: () => setConfirmOut(false) }, { label: '로그아웃', variant: 'danger', onPress: () => { setConfirmOut(false); session.signOut(); } }]} />
      <Dialog visible={confirm} title="모든 필기를 삭제할까요?" message="모든 문서의 필기와 버전 기록이 삭제됩니다. 되돌릴 수 없습니다." onClose={() => setConfirm(false)} actions={[{ label: '취소', onPress: () => setConfirm(false) }, { label: '삭제', variant: 'danger', onPress: () => { useInkStore.setState({ pages: {} }); setConfirm(false); showToast('모든 필기를 삭제했어요'); } }]} />
    </GlassBackground>
  );
}
