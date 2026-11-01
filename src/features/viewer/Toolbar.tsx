import React, { useState } from 'react';
import { View, Pressable, Text, ScrollView, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Tool, ShapeKind } from '@/data/types';
import { ToolConfig, PEN_COLORS, HIGHLIGHTER_COLORS } from './ink';
import { Row, T, Muted, Toggle, Button, Dialog } from '@/components/ui';
import { useSettingsStore } from '@/store/settings';
import { ColorPicker } from '@/components/ColorPicker';
import { BlurView } from 'expo-blur';
import { glass } from '@/theme';

const PENS: { tool: Tool; icon: any; label: string; min: number; max: number }[] = [
  { tool: 'pen', icon: 'pen', label: '펜', min: 0.5, max: 12 }, { tool: 'highlighter', icon: 'marker', label: '형광펜', min: 6, max: 40 },
];
const SHAPES: { k: ShapeKind; icon: any; label: string }[] = [{ k: 'line', icon: 'minus', label: '직선' }, { k: 'arrow', icon: 'arrow-top-right', label: '화살표' }, { k: 'rectangle', icon: 'rectangle-outline', label: '사각형' }, { k: 'ellipse', icon: 'ellipse-outline', label: '원' }, { k: 'triangle', icon: 'triangle-outline', label: '삼각형' }, { k: 'diamond', icon: 'rhombus-outline', label: '마름모' }];

type Props = { cfg: ToolConfig; onCfg: (p: Partial<ToolConfig>) => void; onCfgReplace?: (c: ToolConfig) => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; onClear: () => void; onClearAll?: () => void; onBack: () => void; onMore?: () => void; readOnly?: boolean; recentColors: string[] };
export function Toolbar({ cfg, onCfg, onCfgReplace, onUndo, onRedo, canUndo, canRedo, onClear, onClearAll, onBack, onMore, readOnly, recentColors }: Props) {
  const { colors } = useTheme(); const [panel, setPanel] = useState<null | 'pen' | 'color' | 'shape' | 'eraser' | 'snap'>(null); const [confirm, setConfirm] = useState<null | 'page' | 'all'>(null);
  const lastPen = React.useRef<Tool>('pen'); const settings = useSettingsStore(); const viewer = settings.viewer;
  // Option panels preview changes live; 취소 restores the state captured when the panel opened, 적용 keeps it.
  const snap = React.useRef<{ cfg: ToolConfig; viewer: typeof viewer } | null>(null);
  const openPanel = (p: typeof panel) => { if (p && !panel) snap.current = { cfg: { ...cfg }, viewer: { ...viewer } }; setPanel(p); };
  const cancelPanel = () => { if (snap.current) { (onCfgReplace ?? ((c: ToolConfig) => onCfg(c)))(snap.current.cfg); settings.setViewer(snap.current.viewer); } setPanel(null); };
  const applyPanel = () => setPanel(null);
  const isPen = PENS.some((p) => p.tool === cfg.tool); if (isPen) lastPen.current = cfg.tool;
  const isEraser = cfg.tool === 'eraser' || cfg.tool === 'vectorEraser';
  const pick = (tool: Tool) => { if (cfg.tool === tool && isPen) { openPanel(panel === 'pen' ? null : 'pen'); return; } if (cfg.tool === tool && tool === 'shape') { openPanel(panel === 'shape' ? null : 'shape'); return; } if (cfg.tool === tool && isEraser) { openPanel(panel === 'eraser' ? null : 'eraser'); return; } onCfg({ tool }); setPanel(null); };
  const palette = cfg.tool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS;
  // quick swatches: the user's 5 favorite colors (long-press a swatch to store the current color there)
  const quick = (viewer.favoriteColors ?? []).slice(0, 5);
  const setFav = (i: number, c: string) => { const next = [...(viewer.favoriteColors ?? [])]; next[i] = c; settings.setViewer({ favoriteColors: next }); };
  const Btn = ({ active, onPress, children, label, disabled }: { active?: boolean; onPress?: () => void; children: React.ReactNode; label: string; disabled?: boolean }) => (
    <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tb, active && { backgroundColor: colors.primary }, pressed && { opacity: 0.6 }, disabled && { opacity: 0.3 }]}>{children}</Pressable>
  );
  const ic = (name: any, active?: boolean, lib?: 'mci', size = 20) => lib === 'mci' ? <MaterialCommunityIcons name={name} size={size} color={active ? '#fff' : colors.text} /> : <Ionicons name={name} size={size} color={active ? '#fff' : colors.text} />;
  const penDef = PENS.find((p) => p.tool === (isPen ? cfg.tool : lastPen.current)) ?? PENS[0];
  const range = isEraser ? { min: 2, max: 40 } : penDef;
  const dot = Math.min(18, 3 + cfg.width * 1.1);
  return (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.72)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.8)' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 6, height: 50, gap: 2, flexGrow: 1 }}>
        <Btn label="뒤로가기" onPress={onBack}>{ic('chevron-back', false, undefined, 22)}</Btn>
        <View style={styles.sep} />
        {!readOnly && <>
          {/* One pen button (GoodNotes-style): tap to draw with the last pen, tap again to switch pen type (펜·연필·형광펜·만년필·붓펜) and thickness */}
          <Btn label={isPen ? penDef.label : '펜'} active={isPen} onPress={() => pick(lastPen.current)}><View style={{ alignItems: 'center' }}>{ic(penDef.icon, isPen, 'mci')}<View style={{ width: 14, height: 3, borderRadius: 2, marginTop: 1, backgroundColor: isPen ? '#fff' : cfg.color, opacity: cfg.tool === 'highlighter' ? 0.7 : 1 }} /></View></Btn>
          <Btn label="지우개" active={isEraser} onPress={() => pick(cfg.tool === 'vectorEraser' ? 'vectorEraser' : 'eraser')}>{ic('eraser', isEraser, 'mci')}</Btn>
          <Btn label="올가미" active={cfg.tool === 'lasso'} onPress={() => pick('lasso')}>{ic('lasso', cfg.tool === 'lasso', 'mci')}</Btn>
          {/* current width indicator: opens the pen panel where the slider lives */}
          <Pressable accessibilityLabel="굵기" onPress={() => openPanel(panel === 'pen' ? null : 'pen')} style={[styles.widthBtn, { borderColor: panel === 'pen' ? colors.primary : colors.border }]}><View style={{ width: dot, height: dot, borderRadius: dot, backgroundColor: isEraser ? colors.textFaint : cfg.color, opacity: cfg.tool === 'highlighter' ? 0.6 : 1 }} /></Pressable>
          <View style={styles.sep} />
          {quick.map((c) => <Pressable key={c} accessibilityLabel={`색상 ${c}`} onPress={() => { if (cfg.color === c) openPanel(panel === 'color' ? null : 'color'); else onCfg({ color: c }); }} style={[styles.dot, { borderColor: cfg.color === c ? colors.primary : 'transparent' }]}><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }} /></Pressable>)}
          <Pressable accessibilityLabel="색상 선택" onPress={() => openPanel(panel === 'color' ? null : 'color')} style={[styles.dot, { borderColor: panel === 'color' ? colors.primary : 'transparent' }]}><View style={{ width: 18, height: 18, borderRadius: 9, overflow: 'hidden' }}><View style={{ flex: 1, flexDirection: 'row' }}><View style={{ flex: 1, backgroundColor: '#F43F5E' }} /><View style={{ flex: 1, backgroundColor: '#F59E0B' }} /></View><View style={{ flex: 1, flexDirection: 'row' }}><View style={{ flex: 1, backgroundColor: '#22C55E' }} /><View style={{ flex: 1, backgroundColor: '#2F6FED' }} /></View></View></Pressable>
          <View style={styles.sep} />
          <Btn label="도형" active={cfg.tool === 'shape'} onPress={() => pick('shape')}>{ic('shape-outline', cfg.tool === 'shape', 'mci')}</Btn>
          <Btn label="텍스트" active={cfg.tool === 'text'} onPress={() => pick('text')}>{ic('format-text', cfg.tool === 'text', 'mci')}</Btn>
          <Btn label="보정" active={panel === 'snap'} onPress={() => openPanel(panel === 'snap' ? null : 'snap')}>{ic('auto-fix', panel === 'snap', 'mci')}</Btn>
        </>}
        <Btn label="손/이동" active={cfg.tool === 'hand'} onPress={() => pick('hand')}>{ic('hand-left-outline', cfg.tool === 'hand')}</Btn>
        <View style={styles.sep} />
        <Btn label="실행 취소" onPress={onUndo} disabled={!canUndo}>{ic('arrow-undo-outline')}</Btn>
        <Btn label="다시 실행" onPress={onRedo} disabled={!canRedo}>{ic('arrow-redo-outline')}</Btn>
        {onMore && <Btn label="더보기" onPress={onMore}>{ic('ellipsis-horizontal')}</Btn>}
        <View style={{ flex: 1, minWidth: 8 }} />
        {/* right end: quick toggles */}
        <Pressable accessibilityLabel="펜 자동 복귀" onPress={() => settings.setViewer({ penAutoReturn: !viewer.penAutoReturn })} style={[styles.toggleBtn, viewer.penAutoReturn && { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}><MaterialCommunityIcons name="undo-variant" size={14} color={viewer.penAutoReturn ? colors.primary : colors.textMuted} /><Text style={{ fontSize: 10, fontWeight: '600', color: viewer.penAutoReturn ? colors.primary : colors.textMuted }}>펜 복귀</Text></Pressable>
      </ScrollView>
      {panel && (
        <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', padding: 12, maxWidth: 560 }}>
          {panel === 'pen' && <>
            <Muted variant="label" style={{ marginBottom: 8 }}>{isEraser ? '지우개 크기' : '펜 종류'}</Muted>
            {!isEraser && <Row style={{ flexWrap: 'wrap' }}>{PENS.map((p) => <Pressable key={p.tool} onPress={() => onCfg({ tool: p.tool })} style={[styles.penOpt, { borderColor: cfg.tool === p.tool ? colors.primary : colors.border, backgroundColor: cfg.tool === p.tool ? colors.primarySoft : 'transparent' }]}><MaterialCommunityIcons name={p.icon} size={26} color={cfg.tool === p.tool ? colors.primary : colors.text} /><Text style={{ fontSize: 9, color: colors.textMuted, marginTop: 3, fontWeight: '600' }}>{p.label}</Text></Pressable>)}</Row>}
            <Row style={{ marginTop: 12 }} gap={14}>
              <MaterialCommunityIcons name="circle-small" size={18} color={colors.textFaint} />
              <Slider style={{ flex: 1, height: 36 }} minimumValue={range.min} maximumValue={range.max} step={0.5} value={Math.min(range.max, Math.max(range.min, cfg.width))} onValueChange={(v) => onCfg({ width: Math.round(v * 2) / 2 })} minimumTrackTintColor={colors.primary} maximumTrackTintColor="rgba(0,0,0,0.12)" thumbTintColor={colors.primary} />
              <MaterialCommunityIcons name="circle" size={18} color={colors.textFaint} />
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', alignItems: 'center', justifyContent: 'center' }}><View style={{ width: Math.min(40, Math.max(2, cfg.width * (cfg.tool === 'highlighter' ? 0.9 : 2.2))), height: Math.min(40, Math.max(2, cfg.width * (cfg.tool === 'highlighter' ? 0.9 : 2.2))), borderRadius: 24, backgroundColor: isEraser ? colors.textFaint : cfg.color, opacity: cfg.tool === 'highlighter' ? 0.55 * cfg.opacity + 0.2 : cfg.opacity }} /></View>
            </Row>
          </>}
          {panel === 'color' && <><Row justify="space-between" style={{ marginBottom: 8 }}><Muted variant="label">색상</Muted>{!isEraser && <Row gap={6} style={{ width: 200 }}><MaterialCommunityIcons name="circle-opacity" size={16} color={colors.textFaint} /><Slider style={{ flex: 1, height: 30 }} minimumValue={0.15} maximumValue={1} step={0.05} value={cfg.opacity} onValueChange={(v) => onCfg({ opacity: Math.round(v * 20) / 20 })} minimumTrackTintColor={colors.primary} maximumTrackTintColor="rgba(0,0,0,0.12)" thumbTintColor={colors.primary} /><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: cfg.color, opacity: cfg.opacity }} /></Row>}</Row>
            <ColorPicker value={cfg.color} onChange={(c) => onCfg({ color: c })} recent={recentColors} compact />
            <Muted variant="caption" style={{ marginTop: 12 }}>자주 쓰는 대표색 5개 (툴바에 표시) · 칸을 누르면 지금 고른 색으로 바뀌어요</Muted>
            <Row style={{ marginTop: 6 }} gap={10}>{quick.map((c, i) => <Pressable key={i} onPress={() => setFav(i, cfg.color)} style={{ alignItems: 'center' }}><View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c, borderWidth: 2, borderColor: c === cfg.color ? colors.primary : 'rgba(0,0,0,0.1)' }} /><Text style={{ fontSize: 9, color: colors.textMuted, marginTop: 2 }}>{i + 1}번</Text></Pressable>)}</Row></>}
          {panel === 'shape' && <><Muted variant="label" style={{ marginBottom: 8 }}>도형 선택</Muted><Row style={{ flexWrap: 'wrap' }}>{SHAPES.map((sh) => <Pressable key={sh.k} onPress={() => { onCfg({ shape: sh.k, tool: 'shape' }); setPanel(null); }} style={[styles.penOpt, { borderColor: cfg.shape === sh.k ? colors.primary : colors.border }]}><MaterialCommunityIcons name={sh.icon} size={20} color={colors.text} /><Text style={{ fontSize: 12, color: colors.text, marginTop: 4 }}>{sh.label}</Text></Pressable>)}</Row></>}
          {panel === 'eraser' && <><Muted variant="label" style={{ marginBottom: 8 }}>지우개</Muted><Row>{[['eraser', '스트로크 지우개', '획 단위로 지워요'], ['vectorEraser', '벡터 지우개', '지나간 부분만 지워요']].map(([k, l, d]) => <Pressable key={k} onPress={() => onCfg({ tool: k as Tool })} style={[styles.penOpt, { flex: 1, alignItems: 'flex-start', borderColor: cfg.tool === k ? colors.primary : colors.border, backgroundColor: cfg.tool === k ? colors.primarySoft : 'transparent' }]}><T variant="label">{l}</T><Muted variant="caption">{d}</Muted></Pressable>)}</Row>
            <Row style={{ marginTop: 6 }} gap={10}><Text style={{ fontSize: 12, color: colors.textMuted }}>크기</Text><Slider style={{ flex: 1, height: 36 }} minimumValue={2} maximumValue={40} step={1} value={cfg.width} onValueChange={(v) => onCfg({ width: Math.round(v) })} minimumTrackTintColor={colors.primary} maximumTrackTintColor="rgba(0,0,0,0.12)" thumbTintColor={colors.primary} /><View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: Math.min(40, cfg.width), height: Math.min(40, cfg.width), borderRadius: 22, borderWidth: 1.5, borderColor: colors.textMuted, backgroundColor: 'rgba(0,0,0,0.05)' }} /></View></Row>
            <Row style={{ marginTop: 10 }} gap={8}><Button small variant="outline" icon="trash-outline" title="현재 페이지 필기 모두 제거" onPress={() => setConfirm('page')} />{onClearAll && <Button small variant="ghost" icon="trash-bin-outline" title="문서 전체 필기 제거" onPress={() => setConfirm('all')} />}</Row>
            <Muted variant="caption" style={{ marginTop: 8 }}>지우개는 다시 펜을 고를 때까지 계속 선택돼요.</Muted></>}
          {panel === 'snap' && <><Muted variant="label" style={{ marginBottom: 8 }}>보정</Muted>
            <Row justify="space-between" style={{ marginTop: 6 }}><T variant="label">획 보정</T><Toggle value={viewer.strokeSmoothing} onChange={(v) => settings.setViewer({ strokeSmoothing: v })} /></Row>
            <Row justify="space-between" style={{ marginTop: 8 }}><View><T variant="label">직선 보정</T><Muted variant="caption">선을 긋다가 끝점에서 1.5초 머무르면 바로 직선으로 바뀌어요</Muted></View><Toggle value={viewer.lineSnap} onChange={(v) => settings.setViewer({ lineSnap: v })} /></Row>
            <Row justify="space-between" style={{ marginTop: 8 }}><T variant="label">도형 보정</T><Toggle value={viewer.shapeSnap} onChange={(v) => settings.setViewer({ shapeSnap: v })} /></Row></>}
          <Row justify="flex-end" style={{ marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' }} gap={8}>
            <Button small variant="ghost" title="취소" onPress={cancelPanel} />
            <Button small title="적용" icon="checkmark" onPress={applyPanel} />
          </Row>
        </View>
      )}
      <Dialog visible={confirm === 'page'} title="현재 페이지 필기를 모두 제거할까요?" message="버전 기록에서 복원할 수 있어요." onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '제거', variant: 'danger', onPress: () => { setConfirm(null); setPanel(null); onClear(); } }]} />
      <Dialog visible={confirm === 'all'} title="이 문서의 모든 필기를 제거할까요?" message="모든 페이지의 필기가 삭제됩니다. 되돌릴 수 없어요." onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '전체 제거', variant: 'danger', onPress: () => { setConfirm(null); setPanel(null); onClearAll?.(); } }]} />
    </View>
  );
}
const styles = StyleSheet.create({ tb: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, sep: { width: 1, height: 22, backgroundColor: 'rgba(128,128,128,0.25)', marginHorizontal: 5 }, dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginHorizontal: 1 }, widthBtn: { width: 36, height: 36, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginLeft: 2 }, toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 30, borderRadius: 8, borderWidth: 1, borderColor: 'transparent', marginLeft: 4 }, penOpt: { borderWidth: 1.5, borderRadius: 10, padding: 10, alignItems: 'center', marginRight: 8, marginBottom: 8, minWidth: 64 }, small: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, marginRight: 6, marginBottom: 6, alignItems: 'center' } });
