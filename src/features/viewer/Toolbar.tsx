import React, { useState } from 'react';
import { View, Pressable, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Tool, ShapeKind } from '@/data/types';
import { ToolConfig, PEN_COLORS, HIGHLIGHTER_COLORS, WIDTHS } from './ink';
import { Row, T, Muted, Toggle } from '@/components/ui';
import { useSettingsStore } from '@/store/settings';

const PENS: { tool: Tool; icon: any; lib?: 'mci'; label: string }[] = [
  { tool: 'pen', icon: 'pen', lib: 'mci', label: '펜' }, { tool: 'pencil', icon: 'pencil-outline', lib: 'mci', label: '연필' }, { tool: 'highlighter', icon: 'marker', lib: 'mci', label: '형광펜' }, { tool: 'fountain', icon: 'fountain-pen-tip', lib: 'mci', label: '만년필' }, { tool: 'brush', icon: 'brush', lib: 'mci', label: '붓펜' },
];
const SHAPES: { k: ShapeKind; icon: any; label: string }[] = [{ k: 'line', icon: 'minus', label: '직선' }, { k: 'arrow', icon: 'arrow-top-right', label: '화살표' }, { k: 'rectangle', icon: 'rectangle-outline', label: '사각형' }, { k: 'ellipse', icon: 'ellipse-outline', label: '원' }, { k: 'triangle', icon: 'triangle-outline', label: '삼각형' }, { k: 'diamond', icon: 'rhombus-outline', label: '마름모' }];

type Props = { cfg: ToolConfig; onCfg: (p: Partial<ToolConfig>) => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; onClear: () => void; onBack: () => void; compact?: boolean; onImage?: () => void; onMore?: () => void; readOnly?: boolean; recentColors: string[] };
export function Toolbar({ cfg, onCfg, onUndo, onRedo, canUndo, canRedo, onClear, onBack, compact, onImage, onMore, readOnly, recentColors }: Props) {
  const { colors } = useTheme(); const [panel, setPanel] = useState<null | 'pen' | 'color' | 'width' | 'shape' | 'eraser' | 'snap'>(null);
  const lastPen = React.useRef<Tool>('pen'); const settings = useSettingsStore(); const viewer = settings.viewer;
  const isPen = PENS.some((p) => p.tool === cfg.tool);
  if (isPen) lastPen.current = cfg.tool;
  const pick = (tool: Tool) => { if (cfg.tool === tool && isPen) { setPanel(panel === 'pen' ? null : 'pen'); return; } if (cfg.tool === tool && tool === 'shape') { setPanel(panel === 'shape' ? null : 'shape'); return; } if (cfg.tool === tool && (tool === 'eraser' || tool === 'vectorEraser')) { setPanel(panel === 'eraser' ? null : 'eraser'); return; } onCfg({ tool }); setPanel(null); };
  const palette = cfg.tool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const Btn = ({ active, onPress, children, label, disabled }: { active?: boolean; onPress?: () => void; children: React.ReactNode; label: string; disabled?: boolean }) => (
    <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tb, active && { backgroundColor: colors.primary }, pressed && { opacity: 0.6 }, disabled && { opacity: 0.3 }]}>{children}</Pressable>
  );
  const ic = (name: any, active?: boolean, lib?: 'mci', size = 20) => lib === 'mci' ? <MaterialCommunityIcons name={name} size={size} color={active ? '#fff' : colors.text} /> : <Ionicons name={name} size={size} color={active ? '#fff' : colors.text} />;
  const penDef = PENS.find((p) => p.tool === lastPen.current) ?? PENS[0];
  return (
    <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 6, height: 50, gap: 2 }}>
        <Btn label="뒤로가기" onPress={onBack}>{ic('chevron-back', false, undefined, 22)}</Btn>
        <View style={styles.sep} />
        {!readOnly && <>
          <Btn label={penDef.label} active={isPen} onPress={() => pick(lastPen.current)}>{ic(penDef.icon, isPen, 'mci')}</Btn>
          <Btn label="형광펜" active={cfg.tool === 'highlighter'} onPress={() => pick('highlighter')}>{ic('marker', cfg.tool === 'highlighter', 'mci')}</Btn>
          <Btn label="지우개" active={cfg.tool === 'eraser' || cfg.tool === 'vectorEraser'} onPress={() => pick(cfg.tool === 'vectorEraser' ? 'vectorEraser' : 'eraser')}>{ic('eraser', cfg.tool === 'eraser' || cfg.tool === 'vectorEraser', 'mci')}</Btn>
          <Btn label="올가미" active={cfg.tool === 'lasso'} onPress={() => pick('lasso')}>{ic('lasso', cfg.tool === 'lasso', 'mci')}</Btn>
          <View style={styles.sep} />
          {palette.map((c) => <Pressable key={c} accessibilityLabel={`색상 ${c}`} onPress={() => { if (cfg.color === c) setPanel(panel === 'color' ? null : 'color'); else onCfg({ color: c }); }} style={[styles.dot, { borderColor: cfg.color === c ? colors.primary : 'transparent' }]}><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c }} /></Pressable>)}
          <Pressable accessibilityLabel="색상 선택" onPress={() => setPanel(panel === 'color' ? null : 'color')} style={[styles.dot, { borderColor: palette.includes(cfg.color) ? 'transparent' : colors.primary }]}><MaterialCommunityIcons name="palette" size={18} color={palette.includes(cfg.color) ? colors.textMuted : cfg.color} /></Pressable>
          <View style={styles.sep} />
          {WIDTHS.map((w) => <Pressable key={w} accessibilityLabel={`굵기 ${w}`} onPress={() => { if (cfg.width === w) setPanel(panel === 'width' ? null : 'width'); else onCfg({ width: w }); }} style={[styles.wbtn, cfg.width === w && { backgroundColor: colors.primarySoft }]}><View style={{ width: Math.min(16, 3 + w * 1.4), height: Math.min(16, 3 + w * 1.4), borderRadius: 10, backgroundColor: colors.text }} /><Text style={{ fontSize: 8, color: colors.textMuted, marginTop: 1 }}>{w}</Text></Pressable>)}
          <View style={styles.sep} />
          <Btn label="도형" active={cfg.tool === 'shape'} onPress={() => pick('shape')}>{ic('shape-outline', cfg.tool === 'shape', 'mci')}</Btn>
          <Btn label="텍스트" active={cfg.tool === 'text'} onPress={() => pick('text')}>{ic('format-text', cfg.tool === 'text', 'mci')}</Btn>
          <Btn label="레이저 포인터" active={cfg.tool === 'laser'} onPress={() => pick('laser')}>{ic('laser-pointer', cfg.tool === 'laser', 'mci')}</Btn>
          <Btn label="보정" onPress={() => setPanel(panel === 'snap' ? null : 'snap')}>{ic('auto-fix', false, 'mci')}</Btn>
          {onImage && <Btn label="이미지 첨부" onPress={onImage}>{ic('image-outline')}</Btn>}
        </>}
        <Btn label="손/이동" active={cfg.tool === 'hand'} onPress={() => pick('hand')}>{ic('hand-left-outline', cfg.tool === 'hand')}</Btn>
        <View style={styles.sep} />
        <Btn label="실행 취소" onPress={onUndo} disabled={!canUndo}>{ic('arrow-undo-outline')}</Btn>
        <Btn label="다시 실행" onPress={onRedo} disabled={!canRedo}>{ic('arrow-redo-outline')}</Btn>
        {!readOnly && <Btn label="현재 페이지 지우기" onPress={onClear}>{ic('trash-outline')}</Btn>}
        {onMore && <Btn label="더보기" onPress={onMore}>{ic('ellipsis-horizontal')}</Btn>}
      </ScrollView>
      {panel && (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 12, maxWidth: 520 }}>
          {panel === 'pen' && <><Muted variant="label" style={{ marginBottom: 8 }}>펜 종류 선택</Muted><Row style={{ flexWrap: 'wrap' }}>{PENS.map((p) => <Pressable key={p.tool} onPress={() => { onCfg({ tool: p.tool }); setPanel(null); }} style={[styles.penOpt, { borderColor: cfg.tool === p.tool ? colors.primary : colors.border }]}><MaterialCommunityIcons name={p.icon} size={20} color={colors.text} /><Text style={{ fontSize: 12, color: colors.text, marginTop: 4 }}>{p.label}</Text></Pressable>)}</Row>
            <Row justify="space-between" style={{ marginTop: 12 }}><T variant="label">펜 자동 복귀</T><Toggle value={viewer.penAutoReturn} onChange={(v) => settings.setViewer({ penAutoReturn: v })} /></Row>
            <Row justify="space-between" style={{ marginTop: 8 }}><T variant="label">손가락 필기</T><Toggle value={viewer.fingerDraw} onChange={(v) => settings.setViewer({ fingerDraw: v })} /></Row></>}
          {panel === 'color' && <><Muted variant="label" style={{ marginBottom: 8 }}>색상 선택</Muted><Row style={{ flexWrap: 'wrap' }}>{[...PEN_COLORS, ...HIGHLIGHTER_COLORS, '#F97316', '#0EA5E9', '#A3E635', '#8B5CF6', '#EC4899', '#78716C', '#FFFFFF'].map((c) => <Pressable key={c} onPress={() => { onCfg({ color: c }); setPanel(null); }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: cfg.color === c ? 3 : 1, borderColor: cfg.color === c ? colors.primary : colors.border, margin: 3 }} />)}</Row>
            {recentColors.length > 0 && <><Muted variant="caption" style={{ marginTop: 10 }}>최근 사용</Muted><Row style={{ marginTop: 4 }}>{recentColors.map((c) => <Pressable key={c} onPress={() => onCfg({ color: c })} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c, borderWidth: 1, borderColor: colors.border }} />)}</Row></>}
            <Row justify="space-between" style={{ marginTop: 12 }}><T variant="label">투명도</T><Row>{[0.25, 0.5, 0.75, 1].map((o) => <Pressable key={o} onPress={() => onCfg({ opacity: o })} style={[styles.small, { backgroundColor: cfg.opacity === o ? colors.primary : colors.surfaceAlt }]}><Text style={{ fontSize: 11, color: cfg.opacity === o ? '#fff' : colors.text }}>{o * 100}%</Text></Pressable>)}</Row></Row></>}
          {panel === 'width' && <><Muted variant="label" style={{ marginBottom: 8 }}>굵기 조절</Muted><Row style={{ flexWrap: 'wrap' }}>{[0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 12, 16, 20].map((w) => <Pressable key={w} onPress={() => { onCfg({ width: w }); setPanel(null); }} style={[styles.small, { backgroundColor: cfg.width === w ? colors.primary : colors.surfaceAlt, minWidth: 40 }]}><Text style={{ fontSize: 12, color: cfg.width === w ? '#fff' : colors.text }}>{w}</Text></Pressable>)}</Row></>}
          {panel === 'shape' && <><Muted variant="label" style={{ marginBottom: 8 }}>도형 선택</Muted><Row style={{ flexWrap: 'wrap' }}>{SHAPES.map((sh) => <Pressable key={sh.k} onPress={() => { onCfg({ shape: sh.k, tool: 'shape' }); setPanel(null); }} style={[styles.penOpt, { borderColor: cfg.shape === sh.k ? colors.primary : colors.border }]}><MaterialCommunityIcons name={sh.icon} size={20} color={colors.text} /><Text style={{ fontSize: 12, color: colors.text, marginTop: 4 }}>{sh.label}</Text></Pressable>)}</Row></>}
          {panel === 'eraser' && <><Muted variant="label" style={{ marginBottom: 8 }}>지우개 설정</Muted><Row>{[['eraser', '스트로크 지우개', '획 단위로 지워요'], ['vectorEraser', '벡터 지우개', '지나간 부분만 지워요']].map(([k, l, d]) => <Pressable key={k} onPress={() => onCfg({ tool: k as Tool })} style={[styles.penOpt, { flex: 1, alignItems: 'flex-start', borderColor: cfg.tool === k ? colors.primary : colors.border }]}><T variant="label">{l}</T><Muted variant="caption">{d}</Muted></Pressable>)}</Row>
            <Row justify="space-between" style={{ marginTop: 12 }}><View><T variant="label">지우개 후 펜 복귀</T><Muted variant="caption">한 번 지운 후 자동으로 이전 펜 도구로 돌아갑니다</Muted></View><Toggle value={viewer.eraserReturnToPen} onChange={(v) => settings.setViewer({ eraserReturnToPen: v })} /></Row></>}
          {panel === 'snap' && <><Muted variant="label" style={{ marginBottom: 8 }}>보정</Muted>
            <Row justify="space-between" style={{ marginTop: 6 }}><T variant="label">획 보정</T><Toggle value={viewer.strokeSmoothing} onChange={(v) => settings.setViewer({ strokeSmoothing: v })} /></Row>
            <Row justify="space-between" style={{ marginTop: 8 }}><T variant="label">직선 보정</T><Toggle value={viewer.lineSnap} onChange={(v) => settings.setViewer({ lineSnap: v })} /></Row>
            <Row justify="space-between" style={{ marginTop: 8 }}><T variant="label">도형 보정</T><Toggle value={viewer.shapeSnap} onChange={(v) => settings.setViewer({ shapeSnap: v })} /></Row></>}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({ tb: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, sep: { width: 1, height: 22, backgroundColor: 'rgba(128,128,128,0.25)', marginHorizontal: 5 }, dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginHorizontal: 1 }, wbtn: { width: 26, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, penOpt: { borderWidth: 1.5, borderRadius: 10, padding: 10, alignItems: 'center', marginRight: 8, marginBottom: 8, minWidth: 64 }, small: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, marginRight: 6, marginBottom: 6, alignItems: 'center' } });
