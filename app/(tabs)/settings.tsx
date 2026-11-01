import React, { useEffect, useState } from 'react';
import { View, ScrollView, Pressable, Text } from 'react-native';
import Constants from 'expo-constants';
import { useTheme, useLayout } from '@/theme';
import { Card, Chip, ListItem, Muted, Row, SectionHeader, T, Toggle, Button, Dialog } from '@/components/ui';
import { PageHeader } from '@/components/Header';
import { useSettingsStore, ViewerPrefs } from '@/store/settings';
import { useDocsStore } from '@/store/docs';
import { useInkStore } from '@/store/ink';
import { clearPageCache, storageUsage } from '@/lib/files';
import { clearImageCache } from '@/features/viewer/PdfPage';
import { fmtBytes } from '@/utils/format';

export default function Settings() {
  const { colors } = useTheme(); const { isTablet } = useLayout(); const s = useSettingsStore(); const docs = useDocsStore((x) => x.docs); const showToast = useDocsStore((x) => x.showToast); const inkPages = useInkStore((x) => x.pages);
  const [usage, setUsage] = useState(0); const [confirm, setConfirm] = useState(false);
  useEffect(() => { storageUsage().then(setUsage); }, [docs]);
  const strokes = Object.values(inkPages).reduce((a, p) => a + p.strokes.length, 0);
  const Item = ({ k, title, desc }: { k: keyof ViewerPrefs; title: string; desc: string }) => <Row justify="space-between" style={{ paddingVertical: 10 }}><View style={{ flex: 1, paddingRight: 12 }}><T variant="bodyBold">{title}</T><Muted variant="caption">{desc}</Muted></View><Toggle value={!!s.viewer[k]} onChange={(v) => s.setViewer({ [k]: v } as any)} /></Row>;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PageHeader title="설정" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, maxWidth: isTablet ? 760 : undefined, width: '100%', alignSelf: 'center' }}>
        <SectionHeader title="테마" />
        <Row>{([['system', '시스템 설정'], ['light', '라이트'], ['dark', '다크']] as const).map(([k, l]) => <Chip key={k} label={l} active={s.theme === k} onPress={() => s.setTheme(k)} />)}</Row>
        <Muted variant="caption" style={{ marginTop: 6 }}>시스템 설정을 선택하면 기기의 다크 모드 설정을 따릅니다.</Muted>
        <SectionHeader title="보기 옵션 (뷰어 기본값)" />
        <Card>
          <Muted variant="label">기본 레이아웃</Muted>
          <Row style={{ marginTop: 8, flexWrap: 'wrap' }}>{([['vertical', '세로 페이지'], ['horizontal', '가로 페이지'], ['continuous', '연속 스크롤'], ['twoPage', '두 페이지']] as const).map(([k, l]) => <Chip key={k} label={l} active={s.viewer.defaultLayoutMode === k} onPress={() => s.setViewer({ defaultLayoutMode: k })} />)}</Row>
          <Item k="fingerDraw" title="손가락 필기" desc="끄면 펜슬/스타일러스로만 필기하고 손가락은 스크롤·확대" />
          <Item k="eraserReturnToPen" title="지우개 후 펜 복귀" desc="한 번 지운 후 자동으로 이전 펜 도구로 돌아갑니다" />
          <Item k="strokeSmoothing" title="획 보정" desc="부드러운 곡선으로 그려요" />
          <Item k="lineSnap" title="직선 보정" desc="거의 직선인 획을 직선으로" />
          <Item k="penAutoReturn" title="펜 자동 복귀" desc="도형·텍스트 후 펜으로 복귀" />
          <Item k="doubleTapZoomEnabled" title="더블탭으로 확대" desc="두 번 탭하면 2배 확대/원복" />
          <Item k="twoPageStartOdd" title="두 페이지 보기: 홀수 페이지부터" desc="" />
          <Button title="보기 옵션 초기화" variant="ghost" style={{ marginTop: 8 }} onPress={() => { s.resetViewer(); showToast('기본값으로 되돌렸어요'); }} />
        </Card>
        <SectionHeader title="저장 공간" />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          <ListItem icon="document-text-outline" title="PDF 파일" value={`${Object.keys(docs).length}개 · ${fmtBytes(usage)}`} />
          <ListItem icon="pencil-outline" title="필기 데이터" value={`${strokes}획 · ${Object.keys(inkPages).length}페이지`} />
          <ListItem icon="images-outline" title="페이지 렌더 캐시 비우기" subtitle="PDF 페이지 이미지 캐시를 삭제합니다 (다시 열면 재생성)" onPress={async () => { await clearPageCache(); clearImageCache(); showToast('캐시를 비웠어요'); }} />
          <ListItem icon="trash-outline" title="모든 필기 삭제" danger onPress={() => setConfirm(true)} />
        </Card>
        <SectionHeader title="정보" />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          <ListItem icon="help-buoy-outline" title="뷰어 사용 가이드 다시보기" onPress={() => { s.setViewerGuideDone(false); showToast('다음에 문서를 열면 가이드가 표시돼요'); }} />
          <ListItem icon="information-circle-outline" title="앱 버전" value={`v${Constants.expoConfig?.version ?? '1.0.0'}`} />
          <ListItem icon="code-slash-outline" title="PDF 엔진" value="iOS PDFKit · Android PdfRenderer · Web pdf.js" />
        </Card>
      </ScrollView>
      <Dialog visible={confirm} title="모든 필기를 삭제할까요?" message="모든 문서의 필기와 버전 기록이 삭제됩니다. 되돌릴 수 없습니다." onClose={() => setConfirm(false)} actions={[{ label: '취소', onPress: () => setConfirm(false) }, { label: '삭제', variant: 'danger', onPress: () => { useInkStore.setState({ pages: {} }); setConfirm(false); showToast('모든 필기를 삭제했어요'); } }]} />
    </View>
  );
}
