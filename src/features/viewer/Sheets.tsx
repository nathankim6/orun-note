import React, { useState } from 'react';
import { View, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Button, Dialog, ListItem, Muted, Row, Sheet, T, Toggle } from '@/components/ui';
import { InkVersion } from '@/data/types';
import { ViewerPrefs, useSettingsStore } from '@/store/settings';
import { fmtDate } from '@/utils/format';

export function SettingsSheet({ visible, onClose, layout, setLayout }: { visible: boolean; onClose: () => void; layout: ViewerPrefs['defaultLayoutMode']; setLayout: (l: ViewerPrefs['defaultLayoutMode']) => void }) {
  const { colors } = useTheme(); const { viewer, setViewer, resetViewer } = useSettingsStore(); const [confirm, setConfirm] = useState(false);
  const Item = ({ k, title, desc }: { k: keyof ViewerPrefs; title: string; desc: string }) => <Row justify="space-between" style={{ paddingVertical: 10 }}><View style={{ flex: 1, paddingRight: 12 }}><T variant="bodyBold">{title}</T><Muted variant="caption">{desc}</Muted></View><Toggle value={!!viewer[k]} onChange={(v) => setViewer({ [k]: v } as any)} /></Row>;
  return (
    <Sheet visible={visible} onClose={onClose} title="뷰어 설정">
      <Muted variant="label">레이아웃</Muted>
      <Row style={{ marginTop: 8, flexWrap: 'wrap' }} gap={8}>{([['vertical', '세로 페이지', 'phone-portrait-outline'], ['horizontal', '가로 페이지', 'phone-landscape-outline'], ['continuous', '연속 스크롤', 'reorder-four-outline'], ['twoPage', '두 페이지', 'book-outline']] as const).map(([k, l, i]) => <Pressable key={k} onPress={() => setLayout(k)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: layout === k ? colors.primary : colors.border }}><Ionicons name={i} size={16} color={layout === k ? colors.primary : colors.textMuted} /><Text style={{ color: layout === k ? colors.primary : colors.text, fontWeight: '600', fontSize: 13 }}>{l}</Text></Pressable>)}</Row>
      <Item k="twoPageStartOdd" title="두 페이지 보기: 홀수 페이지부터" desc="끄면 짝수 페이지부터 나란히 보여요" />
      <Muted variant="label" style={{ marginTop: 14 }}>필기</Muted>
      <Item k="strokeSmoothing" title="획 보정" desc="손떨림을 줄여 부드러운 선으로 그려요" />
      <Item k="lineSnap" title="직선 보정" desc="끝점에서 1.5초 머무르면 직선으로 바뀌고, 거의 직선인 획도 보정" />
      <Item k="penAutoReturn" title="펜 자동 복귀" desc="도형·텍스트 입력 후 자동으로 펜으로 돌아가요" />
      <Muted variant="label" style={{ marginTop: 14 }}>제스처</Muted>
      <Item k="doubleTapZoomEnabled" title="더블탭으로 확대" desc="지면을 두 번 탭하면 2배로 확대/원복" />
      <Button title="설정 초기화" variant="ghost" style={{ marginTop: 16 }} onPress={() => setConfirm(true)} />
      <Dialog visible={confirm} title="설정 초기화" message="모든 뷰어 설정을 기본값으로 되돌립니다." onClose={() => setConfirm(false)} actions={[{ label: '취소', onPress: () => setConfirm(false) }, { label: '초기화', variant: 'danger', onPress: () => { resetViewer(); setConfirm(false); } }]} />
    </Sheet>
  );
}

export function VersionSheet({ visible, onClose, versions, onRestore, pageIndex, onSnapshot }: { visible: boolean; onClose: () => void; versions: InkVersion[]; onRestore: (id: string) => void; pageIndex: number; onSnapshot: () => void }) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={`버전 기록 (페이지 ${pageIndex + 1})`}>
      <Row justify="space-between"><Muted variant="caption">{versions.length ? '복원할 버전을 선택하세요' : '이 페이지의 버전 기록이 없습니다.'}</Muted><Button small variant="secondary" title="지금 저장" onPress={onSnapshot} /></Row>
      {[...versions].reverse().map((v, i) => <ListItem key={v.id} icon="time-outline" title={`${fmtDate(v.createdAt, { time: true })}${i === 0 ? ' - 최근' : ''}`} subtitle={`${v.strokes.length}획 · 텍스트 ${v.textBoxes.length}개 · ${v.label}`} onPress={() => onRestore(v.id)} right={<Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>복원</Text>} />)}
      <Muted variant="caption" style={{ marginTop: 12 }}>페이지를 떠나거나 지울 때 자동으로 버전이 저장돼요. 페이지당 최근 20개까지 보관합니다.</Muted>
    </Sheet>
  );
}

export function CycleSheet({ visible, onClose, cycle, maxCycle, onSwitch, onNew, onResetInk }: { visible: boolean; onClose: () => void; cycle: number; maxCycle: number; onSwitch: (c: number) => void; onNew: () => void; onResetInk: (scope: 'current' | 'all') => void }) {
  const { colors } = useTheme(); const [confirm, setConfirm] = useState<null | 'new' | 'reset' | 'resetAll'>(null);
  return (
    <Sheet visible={visible} onClose={onClose} title="필기 레이어 (회독)">
      <Muted variant="caption">같은 PDF를 여러 번 풀 때 필기를 회독별로 따로 보관해요. 현재 {cycle}회독, 모두 {maxCycle}개</Muted>
      <Row style={{ flexWrap: 'wrap', marginTop: 10 }} gap={8}>{Array.from({ length: maxCycle }, (_, i) => i + 1).map((c) => <Pressable key={c} onPress={() => { onSwitch(c); onClose(); }} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: c === cycle ? colors.primary : colors.surfaceAlt }}><Text style={{ color: c === cycle ? '#fff' : colors.text, fontWeight: '700' }}>{c}회독{c === cycle ? ' · 현재' : ''}</Text></Pressable>)}</Row>
      <Button title="새 회독 시작 (빈 필기 레이어)" icon="add" style={{ marginTop: 16 }} onPress={() => setConfirm('new')} />
      <Button title={`${cycle}회독 필기 초기화`} variant="outline" style={{ marginTop: 8 }} onPress={() => setConfirm('reset')} />
      <Button title="전체 필기 초기화" variant="ghost" style={{ marginTop: 4 }} onPress={() => setConfirm('resetAll')} />
      <Dialog visible={confirm === 'new'} title="새 회독을 시작할까요?" message={`빈 페이지에서 다시 풀어요. 지금까지의 필기는 ${cycle}회독에 그대로 남아요.`} onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '시작', variant: 'primary', onPress: () => { setConfirm(null); onNew(); onClose(); } }]} />
      <Dialog visible={confirm === 'reset'} title={`${cycle}회독 필기 초기화`} message={`${cycle}회독만 초기화되고 다른 회독은 그대로 남아요.`} onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '삭제', variant: 'danger', onPress: () => { setConfirm(null); onResetInk('current'); onClose(); } }]} />
      <Dialog visible={confirm === 'resetAll'} title="전체 필기 초기화" message="이 문서 모든 페이지·모든 회독의 필기가 삭제됩니다. 되돌릴 수 없습니다." onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '삭제', variant: 'danger', onPress: () => { setConfirm(null); onResetInk('all'); onClose(); } }]} />
    </Sheet>
  );
}

export function GuideOverlay({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const { colors } = useTheme(); const [step, setStep] = useState(0);
  const steps = [{ t: '펜 도구', d: '펜·연필·형광펜·만년필·붓펜을 쓸 수 있어요. 선택된 펜을 다시 탭하면 종류를 바꿔요.', i: 'pencil' }, { t: '색상 · 굵기', d: '5가지 색과 5가지 굵기를 빠르게 고르고, 다시 탭하면 세부 패널(투명도·커스텀 색)이 열려요.', i: 'color-palette' }, { t: '지우개 · 올가미', d: '획 단위 지우개와 지나간 부분만 지우는 벡터 지우개. 올가미로 선택한 필기는 복제·삭제할 수 있어요.', i: 'cut' }, { t: '도형 · 텍스트 · 레이저', d: '직선/화살표/사각형/원을 드래그로 그리고, 텍스트 도구로 탭하면 글상자가 생겨요. 레이저는 저장되지 않는 임시 포인터예요.', i: 'shapes' }, { t: '편집 · 버전', d: '실행취소/다시실행, 현재 페이지 지우기. 지운 필기는 더보기 > 버전 기록에서 언제든 복원돼요.', i: 'arrow-undo' }, { t: '손/이동', d: '손 도구에서는 스크롤·핀치 확대만 돼요. 손가락 필기를 끄면 손가락은 항상 이동, 펜슬만 필기예요.', i: 'hand-left' }];
  if (!visible) return null; const st = steps[step];
  return (
    <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 400 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={st.i as any} size={28} color={colors.primary} /></View>
        <T variant="h2" style={{ marginTop: 16 }}>{st.t}</T><Muted style={{ marginTop: 6 }}>{st.d}</Muted>
        <Row justify="space-between" style={{ marginTop: 20 }}>
          <Row gap={5}>{steps.map((_, i) => <View key={i} style={{ width: i === step ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === step ? colors.primary : colors.border }} />)}</Row>
          <Row><Button small variant="ghost" title="건너뛰기" onPress={onDone} /><Button small title={step === steps.length - 1 ? '완료' : '다음'} onPress={() => (step === steps.length - 1 ? onDone() : setStep(step + 1))} /></Row>
        </Row>
      </View>
    </View>
  );
}
