import React, { useState } from 'react';
import { View, Pressable, Text, ScrollView, StyleSheet, Image } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Tool, ShapeKind } from '@/data/types';
import { ToolConfig } from './ink';
import { Row, Muted, Toggle, Button, Dialog } from '@/components/ui';
import { useSettingsStore } from '@/store/settings';
import { ColorPicker } from '@/components/ColorPicker';

export const TEXT_FONTS: { k: string; label: string; family?: string }[] = [
  { k: 'system', label: '기본' }, { k: 'serif', label: '명조', family: 'serif' }, { k: 'mono', label: '고정폭', family: 'monospace' }, { k: 'rounded', label: '둥근', family: 'sans-serif-medium' },
];
const SHAPES: { k: ShapeKind; icon: any; label: string }[] = [{ k: 'line', icon: 'minus', label: '직선' }, { k: 'arrow', icon: 'arrow-top-right', label: '화살표' }, { k: 'rectangle', icon: 'rectangle-outline', label: '사각형' }, { k: 'ellipse', icon: 'ellipse-outline', label: '원' }, { k: 'triangle', icon: 'triangle-outline', label: '삼각형' }, { k: 'diamond', icon: 'rhombus-outline', label: '마름모' }];
const RANGE: Record<string, { min: number; max: number }> = { pen: { min: 0.5, max: 12 }, highlighter: { min: 6, max: 40 }, eraser: { min: 2, max: 40 }, vectorEraser: { min: 2, max: 40 }, shape: { min: 0.5, max: 12 }, text: { min: 8, max: 48 } };

type Panel = null | 'pen' | 'highlighter' | 'color' | 'shape' | 'eraser' | 'text' | 'snap';
type Props = { cfg: ToolConfig; onCfg: (p: Partial<ToolConfig>) => void; onCfgReplace?: (c: ToolConfig) => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; onClear: () => void; onClearAll?: () => void; onBack: () => void; onMore?: () => void; onInsertImage?: () => void; onSubDoc?: () => void; readOnly?: boolean; recentColors: string[]; textFont?: string; onTextFont?: (k: string) => void };

/**
 * Main toolbar + a single compact option row right under it. Pen and highlighter are both top-level; tapping the
 * active tool again toggles its option row. Option rows preview live; 취소 restores the pre-open state, 적용 keeps it.
 */
export function Toolbar({ cfg, onCfg, onCfgReplace, onUndo, onRedo, canUndo, canRedo, onClear, onClearAll, onBack, onMore, onInsertImage, onSubDoc, readOnly, recentColors, textFont = 'system', onTextFont }: Props) {
  const { colors } = useTheme(); const [panel, setPanel] = useState<Panel>(null); const [confirm, setConfirm] = useState<null | 'page' | 'all'>(null);
  const settings = useSettingsStore(); const viewer = settings.viewer;
  const snap = React.useRef<{ cfg: ToolConfig; viewer: typeof viewer } | null>(null);
  const openPanel = (p: Panel) => { if (p && !panel) snap.current = { cfg: { ...cfg }, viewer: { ...viewer } }; setPanel(p); };
  const cancelPanel = () => { if (snap.current) { (onCfgReplace ?? ((c: ToolConfig) => onCfg(c)))(snap.current.cfg); settings.setViewer(snap.current.viewer); } setPanel(null); };
  const applyPanel = () => setPanel(null);
  const isEraser = cfg.tool === 'eraser' || cfg.tool === 'vectorEraser';
  const toolPanel: Record<string, Panel> = { pen: 'pen', highlighter: 'highlighter', eraser: 'eraser', vectorEraser: 'eraser', shape: 'shape', text: 'text' };
  const pick = (tool: Tool) => { if (cfg.tool === tool || (isEraser && (tool === 'eraser' || tool === 'vectorEraser'))) { const p = toolPanel[cfg.tool] ?? null; openPanel(panel === p ? null : p); return; } onCfg({ tool }); setPanel(null); };
  const quick = (viewer.favoriteColors ?? []).slice(0, 5);
  const setFav = (i: number, c: string) => { const next = [...(viewer.favoriteColors ?? [])]; next[i] = c; settings.setViewer({ favoriteColors: next }); };
  const range = RANGE[cfg.tool] ?? RANGE.pen;
  const dot = Math.min(16, 3 + cfg.width * (cfg.tool === 'highlighter' ? 0.35 : 1.1));
  const Btn = ({ active, onPress, children, label, disabled }: { active?: boolean; onPress?: () => void; children: React.ReactNode; label: string; disabled?: boolean }) => (
    <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tb, active && { backgroundColor: colors.primary }, pressed && { opacity: 0.6 }, disabled && { opacity: 0.3 }]}>{children}</Pressable>
  );
  const ic = (name: any, active?: boolean, lib?: 'mci', size = 20) => lib === 'mci' ? <MaterialCommunityIcons name={name} size={size} color={active ? '#fff' : colors.text} /> : <Ionicons name={name} size={size} color={active ? '#fff' : colors.text} />;
  const previewDot = (max = 30) => { const d = Math.min(max, Math.max(2, cfg.width * (cfg.tool === 'highlighter' ? 0.8 : isEraser ? 1 : 2.2))); return <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', alignItems: 'center', justifyContent: 'center' }}><View style={{ width: d, height: d, borderRadius: 17, backgroundColor: isEraser ? 'rgba(0,0,0,0.08)' : cfg.color, borderWidth: isEraser ? 1.5 : 0, borderColor: colors.textMuted, opacity: cfg.tool === 'highlighter' ? 0.55 * cfg.opacity + 0.2 : cfg.opacity }} /></View>; };
  const WidthSlider = () => <Row gap={8} style={{ flex: 1, minWidth: 180, maxWidth: 320 }}><MaterialCommunityIcons name="circle-small" size={16} color={colors.textFaint} /><Slider style={{ flex: 1, height: 32 }} minimumValue={range.min} maximumValue={range.max} step={0.5} value={Math.min(range.max, Math.max(range.min, cfg.width))} onValueChange={(v) => onCfg({ width: Math.round(v * 2) / 2 })} minimumTrackTintColor={colors.primary} maximumTrackTintColor="rgba(0,0,0,0.12)" thumbTintColor={colors.primary} /><MaterialCommunityIcons name="circle" size={16} color={colors.textFaint} />{previewDot()}</Row>;
  const OpacitySlider = () => <Row gap={6} style={{ width: 150 }}><MaterialCommunityIcons name="circle-opacity" size={16} color={colors.textFaint} /><Slider style={{ flex: 1, height: 32 }} minimumValue={0.15} maximumValue={1} step={0.05} value={cfg.opacity} onValueChange={(v) => onCfg({ opacity: Math.round(v * 20) / 20 })} minimumTrackTintColor={colors.primary} maximumTrackTintColor="rgba(0,0,0,0.12)" thumbTintColor={colors.primary} /></Row>;
  const Seg = ({ items, value, onChange }: { items: { k: string; label: string; icon?: any }[]; value: string; onChange: (k: string) => void }) => <View style={styles.seg}>{items.map((it) => <Pressable key={it.k} onPress={() => onChange(it.k)} style={[styles.segItem, value === it.k && { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }]}>{it.icon && <MaterialCommunityIcons name={it.icon} size={14} color={value === it.k ? colors.primary : colors.textMuted} />}<Text style={{ fontSize: 12, fontWeight: '700', color: value === it.k ? colors.primary : colors.textMuted }}>{it.label}</Text></Pressable>)}</View>;
  const Footer = () => <Row gap={6} style={{ marginLeft: 'auto', paddingLeft: 10 }}><Pressable onPress={cancelPanel} style={styles.ghostBtn}><Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted }}>취소</Text></Pressable><Pressable onPress={applyPanel} style={[styles.ghostBtn, { backgroundColor: colors.primary }]}><Ionicons name="checkmark" size={14} color="#fff" /><Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>적용</Text></Pressable></Row>;

  return (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.78)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.9)' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 6, height: 50, gap: 2, flexGrow: 1 }}>
        <Pressable accessibilityLabel="뒤로가기" onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6 }}><Ionicons name="chevron-back" size={22} color={colors.text} /><Image source={require('../../../assets/orun-mark.png')} style={{ width: 28, height: 28, borderRadius: 8 }} /></Pressable>
        <View style={styles.sep} />
        {!readOnly && <>
          <Btn label="펜" active={cfg.tool === 'pen'} onPress={() => pick('pen')}><View style={{ alignItems: 'center' }}>{ic('pen', cfg.tool === 'pen', 'mci')}<View style={{ width: 14, height: 3, borderRadius: 2, marginTop: 1, backgroundColor: cfg.tool === 'pen' ? '#fff' : (viewer.toolPresets?.pen?.color ?? cfg.color) }} /></View></Btn>
          <Btn label="형광펜" active={cfg.tool === 'highlighter'} onPress={() => pick('highlighter')}><View style={{ alignItems: 'center' }}>{ic('marker', cfg.tool === 'highlighter', 'mci')}<View style={{ width: 14, height: 3, borderRadius: 2, marginTop: 1, backgroundColor: cfg.tool === 'highlighter' ? '#fff' : (viewer.toolPresets?.highlighter?.color ?? '#FDE68A') }} /></View></Btn>
          <Btn label="지우개" active={isEraser} onPress={() => pick(cfg.tool === 'vectorEraser' ? 'vectorEraser' : 'eraser')}>{ic('eraser', isEraser, 'mci')}</Btn>
          <Btn label="올가미" active={cfg.tool === 'lasso'} onPress={() => pick('lasso')}>{ic('lasso', cfg.tool === 'lasso', 'mci')}</Btn>
          <Pressable accessibilityLabel="굵기" onPress={() => openPanel(panel === (toolPanel[cfg.tool] ?? 'pen') ? null : (toolPanel[cfg.tool] ?? 'pen'))} style={[styles.widthBtn, { borderColor: panel && panel !== 'color' ? colors.primary : 'rgba(0,0,0,0.1)' }]}><View style={{ width: dot, height: dot, borderRadius: dot, backgroundColor: isEraser ? colors.textFaint : cfg.color, opacity: cfg.tool === 'highlighter' ? 0.6 : 1 }} /></Pressable>
          <View style={styles.sep} />
          {quick.map((c, i) => <Pressable key={i} accessibilityLabel={`대표색 ${i + 1}`} onPress={() => { if (cfg.color === c) openPanel(panel === 'color' ? null : 'color'); else onCfg({ color: c }); }} onLongPress={() => setFav(i, cfg.color)} style={[styles.dot, { borderColor: cfg.color === c ? colors.primary : 'transparent' }]}><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }} /></Pressable>)}
          <Pressable accessibilityLabel="색상 선택" onPress={() => openPanel(panel === 'color' ? null : 'color')} style={[styles.dot, { borderColor: panel === 'color' ? colors.primary : 'transparent' }]}><View style={{ width: 18, height: 18, borderRadius: 9, overflow: 'hidden' }}><View style={{ flex: 1, flexDirection: 'row' }}><View style={{ flex: 1, backgroundColor: '#F43F5E' }} /><View style={{ flex: 1, backgroundColor: '#F59E0B' }} /></View><View style={{ flex: 1, flexDirection: 'row' }}><View style={{ flex: 1, backgroundColor: '#22C55E' }} /><View style={{ flex: 1, backgroundColor: '#2F6FED' }} /></View></View></Pressable>
          <View style={styles.sep} />
          <Btn label="도형" active={cfg.tool === 'shape'} onPress={() => pick('shape')}>{ic('shape-outline', cfg.tool === 'shape', 'mci')}</Btn>
          <Btn label="텍스트" active={cfg.tool === 'text'} onPress={() => pick('text')}>{ic('format-text', cfg.tool === 'text', 'mci')}</Btn>
          {onInsertImage && <Btn label="사진 넣기" onPress={onInsertImage}>{ic('image-outline')}</Btn>}
          <Btn label="보정" active={panel === 'snap'} onPress={() => openPanel(panel === 'snap' ? null : 'snap')}>{ic('auto-fix', panel === 'snap', 'mci')}</Btn>
        </>}
        <Btn label="손/이동" active={cfg.tool === 'hand'} onPress={() => pick('hand')}>{ic('hand-left-outline', cfg.tool === 'hand')}</Btn>
        <View style={styles.sep} />
        <Btn label="실행 취소" onPress={onUndo} disabled={!canUndo}>{ic('arrow-undo-outline')}</Btn>
        <Btn label="다시 실행" onPress={onRedo} disabled={!canRedo}>{ic('arrow-redo-outline')}</Btn>
        {onSubDoc && <Btn label="서브교재" onPress={onSubDoc}>{ic('albums-outline')}</Btn>}
        {onMore && <Btn label="더보기" onPress={onMore}>{ic('ellipsis-horizontal')}</Btn>}
        <View style={{ flex: 1, minWidth: 8 }} />
        <Pressable accessibilityLabel="펜 자동 복귀" onPress={() => settings.setViewer({ penAutoReturn: !viewer.penAutoReturn })} style={[styles.toggleBtn, viewer.penAutoReturn && { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}><MaterialCommunityIcons name="undo-variant" size={14} color={viewer.penAutoReturn ? colors.primary : colors.textMuted} /><Text style={{ fontSize: 10, fontWeight: '600', color: viewer.penAutoReturn ? colors.primary : colors.textMuted }}>펜 복귀</Text></Pressable>
      </ScrollView>

      {panel && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', backgroundColor: 'rgba(255,255,255,0.6)' }} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 10, minHeight: 46, gap: 12, flexGrow: 1 }}>
          {(panel === 'pen' || panel === 'highlighter') && <><Seg items={[{ k: 'pen', label: '펜', icon: 'pen' }, { k: 'highlighter', label: '형광펜', icon: 'marker' }]} value={cfg.tool} onChange={(k) => { onCfg({ tool: k as Tool }); setPanel(k as Panel); }} /><WidthSlider />{cfg.tool !== 'highlighter' && <OpacitySlider />}<Footer /></>}
          {panel === 'eraser' && <><Seg items={[{ k: 'eraser', label: '획 지우개', icon: 'eraser' }, { k: 'vectorEraser', label: '부분 지우개', icon: 'eraser-variant' }]} value={cfg.tool} onChange={(k) => onCfg({ tool: k as Tool })} /><WidthSlider /><Pressable onPress={() => setConfirm('page')} style={styles.ghostBtn}><Ionicons name="trash-outline" size={14} color={colors.danger} /><Text style={{ fontSize: 12, fontWeight: '700', color: colors.danger }}>페이지 비우기</Text></Pressable>{onClearAll && <Pressable onPress={() => setConfirm('all')} style={styles.ghostBtn}><Ionicons name="trash-bin-outline" size={14} color={colors.danger} /><Text style={{ fontSize: 12, fontWeight: '700', color: colors.danger }}>전체 비우기</Text></Pressable>}<Footer /></>}
          {panel === 'shape' && <><Seg items={SHAPES.map((sh) => ({ k: sh.k, label: sh.label, icon: sh.icon }))} value={cfg.shape} onChange={(k) => onCfg({ shape: k as ShapeKind, tool: 'shape' })} /><WidthSlider /><Footer /></>}
          {panel === 'text' && <><Seg items={TEXT_FONTS.map((f) => ({ k: f.k, label: f.label }))} value={textFont} onChange={(k) => onTextFont?.(k)} /><Row gap={8} style={{ width: 220 }}><Text style={{ fontSize: 10, color: colors.textFaint }}>가</Text><Slider style={{ flex: 1, height: 32 }} minimumValue={8} maximumValue={48} step={1} value={cfg.width} onValueChange={(v) => onCfg({ width: Math.round(v) })} minimumTrackTintColor={colors.primary} maximumTrackTintColor="rgba(0,0,0,0.12)" thumbTintColor={colors.primary} /><Text style={{ fontSize: 18, color: colors.textFaint }}>가</Text></Row><Text style={{ fontSize: Math.min(28, cfg.width), color: cfg.color, fontFamily: TEXT_FONTS.find((f) => f.k === textFont)?.family }}>가나다 Abc</Text><Footer /></>}
          {panel === 'color' && <><Row gap={6}>{quick.map((c, i) => <Pressable key={i} onPress={() => setFav(i, cfg.color)} style={{ alignItems: 'center' }}><View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, borderWidth: 2, borderColor: c === cfg.color ? colors.primary : 'rgba(0,0,0,0.1)' }} /><Text style={{ fontSize: 8, color: colors.textMuted }}>{i + 1}</Text></Pressable>)}</Row><View style={{ width: 1, height: 26, backgroundColor: 'rgba(0,0,0,0.1)' }} /><View style={{ width: 420 }}><ColorPicker value={cfg.color} onChange={(c) => onCfg({ color: c })} recent={recentColors} compact row /></View>{!isEraser && <OpacitySlider />}<Footer /></>}
          {panel === 'snap' && <><Row gap={6}><Text style={styles.lbl}>획 보정</Text><Toggle value={viewer.strokeSmoothing} onChange={(v) => settings.setViewer({ strokeSmoothing: v })} /></Row><Row gap={6}><Text style={styles.lbl}>직선 보정 (0.5초 머무름)</Text><Toggle value={viewer.lineSnap} onChange={(v) => settings.setViewer({ lineSnap: v })} /></Row><Row gap={6}><Text style={styles.lbl}>도형 보정</Text><Toggle value={viewer.shapeSnap} onChange={(v) => settings.setViewer({ shapeSnap: v })} /></Row><Footer /></>}
        </ScrollView>
      )}
      <Dialog visible={confirm === 'page'} title="현재 페이지 필기를 모두 제거할까요?" message="버전 기록에서 복원할 수 있어요." onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '제거', variant: 'danger', onPress: () => { setConfirm(null); setPanel(null); onClear(); } }]} />
      <Dialog visible={confirm === 'all'} title="이 문서의 모든 필기를 제거할까요?" message="모든 페이지의 필기가 삭제됩니다. 되돌릴 수 없어요." onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '전체 제거', variant: 'danger', onPress: () => { setConfirm(null); setPanel(null); onClearAll?.(); } }]} />
    </View>
  );
}
const styles = StyleSheet.create({
  tb: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, sep: { width: 1, height: 22, backgroundColor: 'rgba(128,128,128,0.25)', marginHorizontal: 5 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginHorizontal: 1 }, widthBtn: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginLeft: 2, backgroundColor: '#fff' },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 30, borderRadius: 8, borderWidth: 1, borderColor: 'transparent', marginLeft: 4 },
  seg: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 10, padding: 3, gap: 2 }, segItem: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 28, borderRadius: 8 },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.05)' }, lbl: { fontSize: 12, fontWeight: '600', color: '#5B6578' },
});
