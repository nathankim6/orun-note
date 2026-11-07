import React, { useState } from 'react';
import { View, Pressable, Text, ScrollView, StyleSheet, Image } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Tool, ShapeKind } from '@/data/types';
import { ToolConfig } from './ink';
import { Row, Muted, Toggle, Button, Dialog } from '@/components/ui';
import { useSettingsStore } from '@/store/settings';
import { hsvToHex, hexToHsv } from '@/components/ColorPicker';
import { ColorIcon, ColorIconName } from '@/components/ColorIcons';

export const TEXT_FONTS: { k: string; label: string; family?: string }[] = [
  { k: 'system', label: '기본' }, { k: 'serif', label: '명조', family: 'serif' }, { k: 'mono', label: '고정폭', family: 'monospace' }, { k: 'rounded', label: '둥근', family: 'sans-serif-medium' },
];
// Curated, hue-ordered palette: neutrals then each hue from deep to light, so picking a color is one tap.
const PALETTE = ['#172033', '#475569', '#94A3B8', '#FFFFFF', '#B91C1C', '#EF4444', '#FCA5A5', '#C2410C', '#F97316', '#FDBA74', '#CA8A04', '#FACC15', '#FDE68A', '#15803D', '#22C55E', '#86EFAC', '#0E7490', '#06B6D4', '#1D4ED8', '#3B82F6', '#93C5FD', '#6D28D9', '#8B5CF6', '#C4B5FD', '#BE185D', '#EC4899', '#F9A8D4', '#78350F'];
/** Rainbow hue strip + brightness strip for fine tuning the current color (no numbers). */
function HueRow({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const hsv = hexToHsv(color); const hueHex = hsvToHex(hsv.h, 1, 1);
  return (
    <View style={{ width: 170, gap: 2 }}>
      <View style={{ height: 22, justifyContent: 'center' }}><View style={{ position: 'absolute', left: 10, right: 10, height: 10, borderRadius: 5, overflow: 'hidden', flexDirection: 'row' }}>{['#FF0000', '#FF8000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#8000FF', '#FF00FF', '#FF0000'].map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}</View><Slider style={{ height: 22 }} minimumValue={0} maximumValue={359} step={1} value={hsv.h} onValueChange={(h) => onChange(hsvToHex(h, Math.max(hsv.s, 0.6), Math.max(hsv.v, 0.75)))} minimumTrackTintColor="transparent" maximumTrackTintColor="transparent" thumbTintColor={hueHex} /></View>
      <View style={{ height: 22, justifyContent: 'center' }}><View style={{ position: 'absolute', left: 10, right: 10, height: 10, borderRadius: 5, overflow: 'hidden', flexDirection: 'row' }}>{[0.15, 0.35, 0.55, 0.75, 0.95].map((v, i) => <View key={i} style={{ flex: 1, backgroundColor: hsvToHex(hsv.h, Math.max(hsv.s, 0.5), v) }} />)}</View><Slider style={{ height: 22 }} minimumValue={0.12} maximumValue={1} step={0.01} value={hsv.v} onValueChange={(v) => onChange(hsvToHex(hsv.h, hsv.s, v))} minimumTrackTintColor="transparent" maximumTrackTintColor="transparent" thumbTintColor={color} /></View>
    </View>
  );
}
const SHAPES: { k: ShapeKind; icon: any; label: string }[] = [{ k: 'line', icon: 'minus', label: '직선' }, { k: 'arrow', icon: 'arrow-top-right', label: '화살표' }, { k: 'rectangle', icon: 'rectangle-outline', label: '사각형' }, { k: 'ellipse', icon: 'ellipse-outline', label: '원' }, { k: 'triangle', icon: 'triangle-outline', label: '삼각형' }, { k: 'diamond', icon: 'rhombus-outline', label: '마름모' }];
const RANGE: Record<string, { min: number; max: number }> = { pen: { min: 0.5, max: 12 }, highlighter: { min: 6, max: 40 }, eraser: { min: 2, max: 40 }, vectorEraser: { min: 2, max: 40 }, shape: { min: 0.5, max: 12 }, text: { min: 8, max: 48 } };

type Panel = null | 'pen' | 'highlighter' | 'color' | 'shape' | 'eraser' | 'text' | 'snap' | 'lasso';
type Props = { cfg: ToolConfig; onCfg: (p: Partial<ToolConfig>) => void; onCfgReplace?: (c: ToolConfig) => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; onClear: () => void; onClearAll?: () => void; onBack: () => void; onMore?: () => void; onInsertImage?: () => void; onSubDoc?: () => void; readOnly?: boolean; recentColors: string[]; zoomPad?: boolean; onZoomPad?: () => void; locked?: boolean; onLock?: () => void; textFont?: string; onTextFont?: (k: string) => void };

/**
 * Main toolbar + a single compact option row right under it. Pen and highlighter are both top-level; tapping the
 * active tool again toggles its option row. Option rows preview live; 취소 restores the pre-open state, 적용 keeps it.
 */
export function Toolbar({ cfg, onCfg, onCfgReplace, onUndo, onRedo, canUndo, canRedo, onClear, onClearAll, onBack, onMore, onInsertImage, onSubDoc, readOnly, recentColors, textFont = 'system', onTextFont, zoomPad, onZoomPad, locked, onLock }: Props) {
  const { colors } = useTheme(); const [panel, setPanel] = useState<Panel>(null); const [confirm, setConfirm] = useState<null | 'page' | 'all'>(null);
  const settings = useSettingsStore(); const viewer = settings.viewer;
  const snap = React.useRef<{ cfg: ToolConfig; viewer: typeof viewer } | null>(null);
  const openPanel = (p: Panel) => { if (p && !panel) snap.current = { cfg: { ...cfg }, viewer: { ...viewer } }; setPanel(p); };
  const cancelPanel = () => { if (snap.current) { (onCfgReplace ?? ((c: ToolConfig) => onCfg(c)))(snap.current.cfg); settings.setViewer(snap.current.viewer); } setPanel(null); };
  const applyPanel = () => setPanel(null);
  const isEraser = cfg.tool === 'eraser' || cfg.tool === 'vectorEraser';
  const toolPanel: Record<string, Panel> = { lasso: 'lasso', pen: 'pen', highlighter: 'highlighter', eraser: 'eraser', vectorEraser: 'eraser', shape: 'shape', text: 'text' };
  const pick = (tool: Tool) => { if (cfg.tool === tool || (isEraser && (tool === 'eraser' || tool === 'vectorEraser'))) { const p = toolPanel[cfg.tool] ?? null; openPanel(panel === p ? null : p); return; } onCfg({ tool }); setPanel(null); };
  const quick = (viewer.favoriteColors ?? []).slice(0, 5);
  const setFav = (i: number, c: string) => { const next = [...(viewer.favoriteColors ?? [])]; next[i] = c; settings.setViewer({ favoriteColors: next }); };
  const range = RANGE[cfg.tool] ?? RANGE.pen;
  const dot = Math.min(16, 3 + cfg.width * (cfg.tool === 'highlighter' ? 0.35 : 1.1));
  const Btn = ({ active, onPress, children, label, disabled }: { active?: boolean; onPress?: () => void; children: React.ReactNode; label: string; disabled?: boolean }) => (
    <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tb, active && styles.tbActive, pressed && { transform: [{ scale: 0.92 }] }, disabled && { opacity: 0.35 }]}>{children}</Pressable>
  );
  const ic = (name: any, active?: boolean, lib?: 'mci', size = 20) => lib === 'mci' ? <MaterialCommunityIcons name={name} size={size} color={active ? '#fff' : colors.text} /> : <Ionicons name={name} size={size} color={active ? '#fff' : colors.text} />;
  const CI = (n: ColorIconName, ink?: string, d?: boolean) => <ColorIcon name={n} size={24} ink={ink} disabled={d} />;
  const previewDot = (max = 30) => { const d = Math.min(max, Math.max(2, cfg.width * (cfg.tool === 'highlighter' ? 0.8 : isEraser ? 1 : 2.2))); return <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', alignItems: 'center', justifyContent: 'center' }}><View style={{ width: d, height: d, borderRadius: 17, backgroundColor: isEraser ? 'rgba(0,0,0,0.08)' : cfg.color, borderWidth: isEraser ? 1.5 : 0, borderColor: colors.textMuted, opacity: cfg.tool === 'highlighter' ? 0.55 * cfg.opacity + 0.2 : cfg.opacity }} /></View>; };
  const WidthSlider = () => <Row gap={8} style={{ flex: 1, minWidth: 180, maxWidth: 320 }}><MaterialCommunityIcons name="circle-small" size={16} color={colors.textFaint} /><Slider style={{ flex: 1, height: 32 }} minimumValue={range.min} maximumValue={range.max} step={0.5} value={Math.min(range.max, Math.max(range.min, cfg.width))} onValueChange={(v) => onCfg({ width: Math.round(v * 2) / 2 })} minimumTrackTintColor={colors.primary} maximumTrackTintColor="rgba(0,0,0,0.12)" thumbTintColor={colors.primary} /><MaterialCommunityIcons name="circle" size={16} color={colors.textFaint} />{previewDot()}</Row>;
  const OpacitySlider = () => <Row gap={6} style={{ width: 150 }}><MaterialCommunityIcons name="circle-opacity" size={16} color={colors.textFaint} /><Slider style={{ flex: 1, height: 32 }} minimumValue={0.15} maximumValue={1} step={0.05} value={cfg.opacity} onValueChange={(v) => onCfg({ opacity: Math.round(v * 20) / 20 })} minimumTrackTintColor={colors.primary} maximumTrackTintColor="rgba(0,0,0,0.12)" thumbTintColor={colors.primary} /></Row>;
  const Seg = ({ items, value, onChange }: { items: { k: string; label: string; icon?: any }[]; value: string; onChange: (k: string) => void }) => <View style={styles.seg}>{items.map((it) => <Pressable key={it.k} onPress={() => onChange(it.k)} style={[styles.segItem, value === it.k && { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }]}>{it.icon && <MaterialCommunityIcons name={it.icon} size={14} color={value === it.k ? colors.primary : colors.textMuted} />}<Text style={{ fontSize: 12, fontWeight: '700', color: value === it.k ? colors.primary : colors.textMuted }}>{it.label}</Text></Pressable>)}</View>;
  const Footer = () => <Row gap={6} style={{ marginLeft: 'auto', paddingLeft: 10 }}><Pressable onPress={cancelPanel} style={styles.ghostBtn}><Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted }}>취소</Text></Pressable><Pressable onPress={applyPanel} style={[styles.ghostBtn, { backgroundColor: colors.primary }]}><Ionicons name="checkmark" size={14} color="#fff" /><Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>적용</Text></Pressable></Row>;

  return (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.78)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.9)' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 6, height: 50, gap: 2, flexGrow: 1 }}>
        <Pressable accessibilityLabel="뒤로가기" onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6 }}>{CI('back')}<Image source={require('../../../assets/orun-mark.png')} style={{ width: 28, height: 28, borderRadius: 8 }} /></Pressable>
        <View style={styles.sep} />
        {!readOnly && <>
          <Btn label="펜" active={cfg.tool === 'pen'} onPress={() => pick('pen')}>{CI('pen', cfg.tool === 'pen' ? cfg.color : viewer.toolPresets?.pen?.color)}</Btn>
          <Btn label="형광펜" active={cfg.tool === 'highlighter'} onPress={() => pick('highlighter')}>{CI('highlighter', cfg.tool === 'highlighter' ? cfg.color : viewer.toolPresets?.highlighter?.color)}</Btn>
          <Btn label="지우개" active={isEraser} onPress={() => pick(cfg.tool === 'vectorEraser' ? 'vectorEraser' : 'eraser')}>{CI('eraser')}</Btn>
          <Btn label="선택" active={cfg.tool === 'select'} onPress={() => pick('select')}>{CI('select')}</Btn>
          <Btn label="올가미" active={cfg.tool === 'lasso'} onPress={() => pick('lasso')}>{CI('lasso')}</Btn>
          <Pressable accessibilityLabel="굵기" onPress={() => openPanel(panel === (toolPanel[cfg.tool] ?? 'pen') ? null : (toolPanel[cfg.tool] ?? 'pen'))} style={[styles.widthBtn, { borderColor: panel && panel !== 'color' ? colors.primary : 'rgba(0,0,0,0.1)' }]}><View style={{ width: dot, height: dot, borderRadius: dot, backgroundColor: isEraser ? colors.textFaint : cfg.color, opacity: cfg.tool === 'highlighter' ? 0.6 : 1 }} /></Pressable>
          <View style={styles.sep} />
          {quick.map((c, i) => <Pressable key={i} accessibilityLabel={`대표색 ${i + 1}`} onPress={() => { if (cfg.color === c) openPanel(panel === 'color' ? null : 'color'); else onCfg({ color: c }); }} onLongPress={() => setFav(i, cfg.color)} style={[styles.dot, { borderColor: cfg.color === c ? colors.primary : 'transparent' }]}><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }} /></Pressable>)}
          <Pressable accessibilityLabel="색상 선택" onPress={() => openPanel(panel === 'color' ? null : 'color')} style={[styles.dot, { borderColor: panel === 'color' ? colors.primary : 'transparent' }]}><View style={{ width: 18, height: 18, borderRadius: 9, overflow: 'hidden' }}><View style={{ flex: 1, flexDirection: 'row' }}><View style={{ flex: 1, backgroundColor: '#F43F5E' }} /><View style={{ flex: 1, backgroundColor: '#F59E0B' }} /></View><View style={{ flex: 1, flexDirection: 'row' }}><View style={{ flex: 1, backgroundColor: '#22C55E' }} /><View style={{ flex: 1, backgroundColor: '#2F6FED' }} /></View></View></Pressable>
          <View style={styles.sep} />
          <Btn label="도형" active={cfg.tool === 'shape'} onPress={() => pick('shape')}>{CI('shape')}</Btn>
          <Btn label="텍스트" active={cfg.tool === 'text'} onPress={() => pick('text')}>{CI('text')}</Btn>
          {onInsertImage && <Btn label="사진 넣기" onPress={onInsertImage}>{CI('image')}</Btn>}
          <Btn label="보정" active={panel === 'snap'} onPress={() => openPanel(panel === 'snap' ? null : 'snap')}>{CI('magic')}</Btn>
        </>}
        <Btn label="손/이동" active={cfg.tool === 'hand'} onPress={() => pick('hand')}>{CI('hand')}</Btn>
        <View style={styles.sep} />
        <Btn label="되돌리기" onPress={onUndo} disabled={!canUndo}>{CI('undo', undefined, !canUndo)}</Btn>
        <Btn label="다시하기" onPress={onRedo} disabled={!canRedo}>{CI('redo', undefined, !canRedo)}</Btn>
        {onSubDoc && <Btn label="서브교재" onPress={onSubDoc}>{CI('subdoc')}</Btn>}
        {onMore && <Btn label="더보기" onPress={onMore}>{CI('more')}</Btn>}
        <View style={{ flex: 1, minWidth: 8 }} />
        {onZoomPad && <Pressable accessibilityLabel="간편 입력창" onPress={onZoomPad} style={[styles.toggleBtn, zoomPad && { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}><MaterialCommunityIcons name="magnify-plus-outline" size={14} color={zoomPad ? colors.primary : colors.textMuted} /><Text style={{ fontSize: 10, fontWeight: '600', color: zoomPad ? colors.primary : colors.textMuted }}>간편 입력창</Text></Pressable>}
        {onLock && <Pressable accessibilityLabel="캔버스 고정" onPress={onLock} style={[styles.toggleBtn, locked && { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}><MaterialCommunityIcons name={locked ? 'lock' : 'lock-open-variant-outline'} size={14} color={locked ? colors.primary : colors.textMuted} /><Text style={{ fontSize: 10, fontWeight: '600', color: locked ? colors.primary : colors.textMuted }}>캔버스 고정</Text></Pressable>}
        <Pressable accessibilityLabel="펜 자동 복귀" onPress={() => settings.setViewer({ penAutoReturn: !viewer.penAutoReturn })} style={[styles.toggleBtn, viewer.penAutoReturn && { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}><MaterialCommunityIcons name="undo-variant" size={14} color={viewer.penAutoReturn ? colors.primary : colors.textMuted} /><Text style={{ fontSize: 10, fontWeight: '600', color: viewer.penAutoReturn ? colors.primary : colors.textMuted }}>펜 복귀</Text></Pressable>
      </ScrollView>

      {panel && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', backgroundColor: 'rgba(255,255,255,0.6)' }} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 10, minHeight: 46, gap: 12, flexGrow: 1 }}>
          {(panel === 'pen' || panel === 'highlighter') && <><Seg items={[{ k: 'pen', label: '펜', icon: 'pen' }, { k: 'highlighter', label: '형광펜', icon: 'marker' }]} value={cfg.tool} onChange={(k) => { onCfg({ tool: k as Tool }); setPanel(k as Panel); }} /><WidthSlider />{cfg.tool !== 'highlighter' && <OpacitySlider />}
            {cfg.tool === 'pen' ? <Seg items={[{ k: 'var', label: '가변 굵기' }, { k: 'fix', label: '고정 굵기' }]} value={viewer.fixedWidth ? 'fix' : 'var'} onChange={(k) => settings.setViewer({ fixedWidth: k === 'fix' })} /> : <Seg items={[{ k: 'free', label: '자유' }, { k: 'line', label: '직선 형광펜' }]} value={viewer.straightHighlighter ? 'line' : 'free'} onChange={(k) => settings.setViewer({ straightHighlighter: k === 'line' })} />}
            <View style={{ width: 1, height: 26, backgroundColor: 'rgba(0,0,0,0.1)' }} />
            <Row gap={4}>{(viewer.favoritePens ?? []).map((f, i) => <Pressable key={i} accessibilityLabel={`즐겨찾는 펜 ${i + 1}`} onPress={() => { onCfg({ tool: f.tool as Tool, color: f.color, width: f.width, opacity: f.opacity }); if (f.tool === 'pen') settings.setViewer({ fixedWidth: !!f.fixed }); setPanel(f.tool as Panel); }} onLongPress={() => settings.setViewer({ favoritePens: (viewer.favoritePens ?? []).filter((_, j) => j !== i) })} style={[styles.fav, cfg.tool === f.tool && cfg.color === f.color && cfg.width === f.width && { borderColor: colors.primary }]}><MaterialCommunityIcons name={f.tool === 'highlighter' ? 'marker' : 'pen'} size={11} color={colors.textMuted} /><View style={{ width: Math.min(14, 3 + f.width * (f.tool === 'highlighter' ? 0.4 : 1.2)), height: Math.min(14, 3 + f.width * (f.tool === 'highlighter' ? 0.4 : 1.2)), borderRadius: 7, backgroundColor: f.color, opacity: f.tool === 'highlighter' ? 0.7 : 1 }} /></Pressable>)}
              {(viewer.favoritePens ?? []).length < 8 && <Pressable accessibilityLabel="즐겨찾는 펜 추가" onPress={() => settings.setViewer({ favoritePens: [...(viewer.favoritePens ?? []), { tool: cfg.tool, color: cfg.color, width: cfg.width, opacity: cfg.opacity, fixed: cfg.tool === 'pen' ? viewer.fixedWidth : undefined }] })} style={[styles.fav, { borderStyle: 'dashed' }]}><Ionicons name="add" size={14} color={colors.textMuted} /></Pressable>}</Row>
            <Footer /></>}
          {panel === 'eraser' && <><Seg items={[{ k: 'eraser', label: '획 지우개', icon: 'eraser' }, { k: 'vectorEraser', label: '영역 지우개', icon: 'eraser-variant' }]} value={cfg.tool} onChange={(k) => onCfg({ tool: k as Tool })} /><WidthSlider /><Row gap={6}><Text style={styles.lbl}>형광펜만 지우기</Text><Toggle value={!!viewer.eraseHighlighterOnly} onChange={(v) => settings.setViewer({ eraseHighlighterOnly: v })} /></Row><Pressable onPress={() => setConfirm('page')} style={styles.ghostBtn}><Ionicons name="trash-outline" size={14} color={colors.danger} /><Text style={{ fontSize: 12, fontWeight: '700', color: colors.danger }}>손글씨 모두 지우기</Text></Pressable>{onClearAll && <Pressable onPress={() => setConfirm('all')} style={styles.ghostBtn}><Ionicons name="trash-bin-outline" size={14} color={colors.danger} /><Text style={{ fontSize: 12, fontWeight: '700', color: colors.danger }}>모든 페이지 지우기</Text></Pressable>}<Footer /></>}
          {panel === 'shape' && <><Seg items={SHAPES.map((sh) => ({ k: sh.k, label: sh.label, icon: sh.icon }))} value={cfg.shape} onChange={(k) => onCfg({ shape: k as ShapeKind, tool: 'shape' })} /><WidthSlider /><Footer /></>}
          {panel === 'text' && <><Seg items={TEXT_FONTS.map((f) => ({ k: f.k, label: f.label }))} value={textFont} onChange={(k) => onTextFont?.(k)} /><Row gap={8} style={{ width: 220 }}><Text style={{ fontSize: 10, color: colors.textFaint }}>가</Text><Slider style={{ flex: 1, height: 32 }} minimumValue={8} maximumValue={48} step={1} value={cfg.width} onValueChange={(v) => onCfg({ width: Math.round(v) })} minimumTrackTintColor={colors.primary} maximumTrackTintColor="rgba(0,0,0,0.12)" thumbTintColor={colors.primary} /><Text style={{ fontSize: 18, color: colors.textFaint }}>가</Text></Row><Text style={{ fontSize: Math.min(28, cfg.width), color: cfg.color, fontFamily: TEXT_FONTS.find((f) => f.k === textFont)?.family }}>가나다 Abc</Text><Footer /></>}
          {panel === 'color' && <>
            <View style={{ alignItems: 'center' }}><View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: cfg.color, borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }} /><Text style={{ fontSize: 9, color: colors.textMuted, marginTop: 2 }}>현재</Text></View>
            <View style={{ flexDirection: 'row', gap: 6 }}>{PALETTE.map((c) => <Pressable key={c} accessibilityLabel={`색상 ${c}`} onPress={() => onCfg({ color: c })} style={({ pressed }) => ({ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: c.toUpperCase() === cfg.color.toUpperCase() ? 3 : 1, borderColor: c.toUpperCase() === cfg.color.toUpperCase() ? colors.primary : 'rgba(0,0,0,0.12)', transform: [{ scale: pressed ? 0.88 : 1 }] })} />)}</View>
            <HueRow color={cfg.color} onChange={(c) => onCfg({ color: c })} />
            <View style={{ alignItems: 'center' }}><Text style={{ fontSize: 9, color: colors.textMuted, marginBottom: 2 }}>대표색에 저장 ↓ 칸 누르기</Text><Row gap={5}>{quick.map((c, i) => <Pressable key={i} accessibilityLabel={`대표색 ${i + 1}에 저장`} onPress={() => setFav(i, cfg.color)} style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: c, borderWidth: 2, borderColor: c.toUpperCase() === cfg.color.toUpperCase() ? colors.primary : '#fff', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }} />)}</Row></View>
            {!isEraser && <OpacitySlider />}<Footer /></>}
          {panel === 'snap' && <><Row gap={6}><Text style={styles.lbl}>획 보정</Text><Toggle value={viewer.strokeSmoothing} onChange={(v) => settings.setViewer({ strokeSmoothing: v })} /></Row><Row gap={6}><Text style={styles.lbl}>직선 자동 보정 (끝에서 0.5초 멈춤)</Text><Toggle value={viewer.lineSnap} onChange={(v) => settings.setViewer({ lineSnap: v })} /></Row><Row gap={6}><Text style={styles.lbl}>도형 자동 보정</Text><Toggle value={viewer.shapeSnap} onChange={(v) => settings.setViewer({ shapeSnap: v })} /></Row><Footer /></>}
          {panel === 'lasso' && <><Seg items={[{ k: 'free', label: '자유형' }, { k: 'rect', label: '사각형' }]} value={viewer.lassoMode ?? 'free'} onChange={(k) => settings.setViewer({ lassoMode: k as 'free' | 'rect' })} /><Row gap={6}><Text style={styles.lbl}>부분 선택된 개체 포함</Text><Toggle value={viewer.lassoPartial ?? true} onChange={(v) => settings.setViewer({ lassoPartial: v })} /></Row><Text style={{ fontSize: 11, color: colors.textMuted }}>선택한 뒤 끌어서 이동 · 오른쪽 아래 점으로 크기 조절</Text><Footer /></>}
        </ScrollView>
      )}
      <Dialog visible={confirm === 'page'} title="현재 페이지 필기를 모두 제거할까요?" message="버전 기록에서 복원할 수 있어요." onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '제거', variant: 'danger', onPress: () => { setConfirm(null); setPanel(null); onClear(); } }]} />
      <Dialog visible={confirm === 'all'} title="이 문서의 모든 필기를 제거할까요?" message="모든 페이지의 필기가 삭제됩니다. 되돌릴 수 없어요." onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '전체 제거', variant: 'danger', onPress: () => { setConfirm(null); setPanel(null); onClearAll?.(); } }]} />
    </View>
  );
}
const styles = StyleSheet.create({
  tb: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, tbActive: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#2F6FED', shadowColor: '#2F6FED', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 }, sep: { width: 1, height: 22, backgroundColor: 'rgba(128,128,128,0.25)', marginHorizontal: 5 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginHorizontal: 1 }, widthBtn: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginLeft: 2, backgroundColor: '#fff' },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 30, borderRadius: 8, borderWidth: 1, borderColor: 'transparent', marginLeft: 4 },
  seg: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 10, padding: 3, gap: 2 }, segItem: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 28, borderRadius: 8 },
  fav: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 28, minWidth: 34, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)', backgroundColor: '#fff', justifyContent: 'center' },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.05)' }, lbl: { fontSize: 12, fontWeight: '600', color: '#5B6578' },
});
