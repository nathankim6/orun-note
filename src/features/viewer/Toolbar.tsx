import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, Text, ScrollView, StyleSheet, Image, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Tool, ShapeKind } from '@/data/types';
import { ToolConfig } from './ink';
import { Row, Muted, Toggle, Button, Dialog } from '@/components/ui';
import { useSettingsStore } from '@/store/settings';
import Svg, { G, Path, Defs, Pattern, Circle } from 'react-native-svg';
import { GradientPalette } from './GradientPalette';
import { penOutline } from './ink';
import { PencilStroke } from './PencilInk';
import { ColorIcon, ColorIconName } from '@/components/ColorIcons';
import { OrunTitle, ORUN_TITLE_RATIO } from '@/components/OrunTitle';
import { OrunMark, ORUN_MARK_RATIO } from '@/components/OrunMark';
const TITLE_H = 22; const MARK_H = 30; const MARK_GAP = 10;
import { ToolArt, ToolArtKind, ColorWheel } from './ToolArt';

export const TEXT_FONTS: { k: string; label: string; family?: string }[] = [
  { k: 'system', label: '기본' }, { k: 'serif', label: '명조', family: 'serif' }, { k: 'mono', label: '고정폭', family: 'monospace' }, { k: 'rounded', label: '둥근', family: 'sans-serif-medium' },
];
// Curated, hue-ordered palette: neutrals then each hue from deep to light, so picking a color is one tap.
const PALETTE = ['#172033', '#475569', '#94A3B8', '#FFFFFF', '#B91C1C', '#EF4444', '#FCA5A5', '#C2410C', '#F97316', '#FDBA74', '#CA8A04', '#FACC15', '#FDE68A', '#15803D', '#22C55E', '#86EFAC', '#0E7490', '#06B6D4', '#1D4ED8', '#3B82F6', '#93C5FD', '#6D28D9', '#8B5CF6', '#C4B5FD', '#BE185D', '#EC4899', '#F9A8D4', '#78350F'];
// Highlighter inks: bright, see-through-friendly hues (the pen card shows the full palette instead).
const HL_PALETTE = ['#FACC15', '#FDE047', '#FB923C', '#F87171', '#F472B6', '#C084FC', '#818CF8', '#60A5FA', '#22D3EE', '#4ADE80', '#A3E635', '#94A3B8'];

/**
 * Drag-or-tap slider (replaces the native slider): works with a finger, Apple Pencil, S Pen and mouse, inside the
 * horizontally scrolling option bar, and keeps tracking for the whole drag (the old one only reacted to taps).
 */
export function DragSlider({ value, min, max, step = 0, onChange, height = 32, width, fill = '#2F6FED', thumb = '#2F6FED', track }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; height?: number; width?: number; fill?: string | null; thumb?: string; track?: React.ReactNode }) {
  const [w, setW] = useState(0); const wRef = useRef(0); const cb = useRef(onChange); cb.current = onChange; const last = useRef<number | null>(null);
  const PAD = 11;
  const toVal = (x: number) => { const W = Math.max(1, wRef.current - PAD * 2); let v = min + Math.min(1, Math.max(0, (x - PAD) / W)) * (max - min); if (step) v = Math.round(v / step) * step; return Math.min(max, Math.max(min, v)); };
  const emit = (x: number) => { const v = toVal(x); if (v !== last.current) { last.current = v; cb.current(v); } };
  const g = useMemo(() => Gesture.Pan().minDistance(0).shouldCancelWhenOutside(false).hitSlop({ top: 10, bottom: 10, left: 6, right: 6 }).runOnJS(true)
    .onBegin((e) => { last.current = null; emit(e.x); }).onUpdate((e) => emit(e.x)).onFinalize(() => { last.current = null; }), [min, max, step]);
  const frac = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0; const x = PAD + frac * Math.max(0, w - PAD * 2);
  return (
    <GestureDetector gesture={g}>
      <View accessibilityRole="adjustable" accessibilityValue={{ min, max, now: value }} onLayout={(e) => { wRef.current = e.nativeEvent.layout.width; setW(e.nativeEvent.layout.width); }} style={{ height, justifyContent: 'center', width, flex: width ? undefined : 1 }} collapsable={false}>
        {track ?? <View style={{ position: 'absolute', left: PAD, right: PAD, height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.12)' }} />}
        {fill ? <View style={{ position: 'absolute', left: PAD, width: Math.max(0, x - PAD), height: 6, borderRadius: 3, backgroundColor: fill }} /> : null}
        <View pointerEvents="none" style={{ position: 'absolute', left: x - 11, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', borderWidth: 3, borderColor: thumb, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }} />
      </View>
    </GestureDetector>
  );
}
const SHAPES: { k: ShapeKind; icon: any; label: string }[] = [{ k: 'line', icon: 'minus', label: '직선' }, { k: 'arrow', icon: 'arrow-top-right', label: '화살표' }, { k: 'rectangle', icon: 'rectangle-outline', label: '사각형' }, { k: 'ellipse', icon: 'ellipse-outline', label: '원' }, { k: 'triangle', icon: 'triangle-outline', label: '삼각형' }, { k: 'diamond', icon: 'rhombus-outline', label: '마름모' }];
const RANGE: Record<string, { min: number; max: number }> = { pen: { min: 0.5, max: 12 }, pencil: { min: 0.5, max: 12 }, highlighter: { min: 6, max: 40 }, eraser: { min: 2, max: 40 }, vectorEraser: { min: 2, max: 40 }, shape: { min: 0.5, max: 12 }, text: { min: 8, max: 48 } };

type Panel = null | 'pen' | 'highlighter' | 'color' | 'shape' | 'eraser' | 'text' | 'snap' | 'lasso';
type Props = { cfg: ToolConfig; onCfg: (p: Partial<ToolConfig>) => void; onCfgReplace?: (c: ToolConfig) => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; onClear: () => void; onClearAll?: () => void; onBack: () => void; onMore?: () => void; onInsertImage?: () => void; onSubDoc?: () => void; onVideos?: () => void; readOnly?: boolean; recentColors: string[]; zoomPad?: boolean; onZoomPad?: () => void; locked?: boolean; onLock?: () => void; textFont?: string; onTextFont?: (k: string) => void; /** bump to close the option bar (e.g. the page was touched) */ dismissKey?: number; onPanelChange?: (open: boolean) => void };

/**
 * Main toolbar + a single compact option row right under it. Pen and highlighter are both top-level; tapping the
 * active tool again toggles its option row. Option rows preview live; 취소 restores the pre-open state, 적용 keeps it.
 */
export function Toolbar({ cfg, onCfg, onCfgReplace, onUndo, onRedo, canUndo, canRedo, onClear, onClearAll, onBack, onMore, onInsertImage, onSubDoc, onVideos, readOnly, recentColors, textFont = 'system', onTextFont, zoomPad, onZoomPad, locked, onLock, dismissKey, onPanelChange }: Props) {
  const [titleSpace, setTitleSpace] = useState(0);
  const { colors } = useTheme(); const [panel, setPanel] = useState<Panel>(null); const [confirm, setConfirm] = useState<null | 'page' | 'all'>(null);
  const settings = useSettingsStore(); const viewer = settings.viewer; const { width: winW } = useWindowDimensions();
  // pen / highlighter card: favorites edit mode (tap a pen to delete it) and the fine color tuner
  const [favEdit, setFavEdit] = useState(false);
  // the fine colour sheet is folded away by default (GoodNotes-like compact card); it stays open while the card is open
  const [spectrum, setSpectrum] = useState(false);
  useEffect(() => { if (!panel) setSpectrum(false); }, [panel]);
  useEffect(() => { if (!panel) setFavEdit(false); }, [panel]);
  useEffect(() => { if (dismissKey) setPanel(null); }, [dismissKey]);
  useEffect(() => { onPanelChange?.(!!panel); }, [panel]);
  const snap = React.useRef<{ cfg: ToolConfig; viewer: typeof viewer } | null>(null);
  const openPanel = (p: Panel) => setPanel(p);
  // 취소 restores exactly what was active when the card opened (also when it opened by picking another tool)
  const prevPanel = React.useRef<Panel>(null);
  useEffect(() => { if (panel && !prevPanel.current) snap.current = { cfg: { ...cfg }, viewer: { ...viewer } }; prevPanel.current = panel; }, [panel]);
  const cancelPanel = () => { if (snap.current) { (onCfgReplace ?? ((c: ToolConfig) => onCfg(c)))(snap.current.cfg); settings.setViewer(snap.current.viewer); } setPanel(null); };
  const applyPanel = () => setPanel(null);
  const isEraser = cfg.tool === 'eraser' || cfg.tool === 'vectorEraser';
  const toolPanel: Record<string, Panel> = { lasso: 'lasso', pen: 'pen', pencil: 'pen', highlighter: 'highlighter', eraser: 'eraser', vectorEraser: 'eraser', shape: 'shape', text: 'text' };
  const pick = (tool: Tool) => { if (cfg.tool === tool || (isEraser && (tool === 'eraser' || tool === 'vectorEraser'))) { const p = toolPanel[cfg.tool] ?? null; openPanel(panel === p ? null : p); return; } onCfg({ tool }); setPanel(toolPanel[tool] ?? null); };
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
  const widthSlider = (<Row gap={8} style={{ flex: 1, minWidth: 180, maxWidth: 320 }}><MaterialCommunityIcons name="circle-small" size={16} color={colors.textFaint} /><DragSlider min={range.min} max={range.max} step={cfg.tool === 'pen' || cfg.tool === 'pencil' ? 0.1 : 0.5} value={Math.min(range.max, Math.max(range.min, cfg.width))} onChange={(v) => onCfg({ width: cfg.tool === 'pen' || cfg.tool === 'pencil' ? Math.round(v * 10) / 10 : Math.round(v * 2) / 2 })} fill={colors.primary} thumb={colors.primary} /><MaterialCommunityIcons name="circle" size={16} color={colors.textFaint} />{(isEraser || cfg.tool === 'shape') && previewDot()}</Row>);
  const opacitySlider = (<Row gap={6} style={{ flex: 1, minWidth: 160, maxWidth: 320 }}><MaterialCommunityIcons name="circle-opacity" size={16} color={colors.textFaint} /><DragSlider min={0.15} max={1} step={0.05} value={cfg.opacity} onChange={(v) => onCfg({ opacity: Math.round(v * 20) / 20 })} fill={colors.primary} thumb={colors.primary} /></Row>);
  const Seg = ({ items, value, onChange }: { items: { k: string; label: string; icon?: any }[]; value: string; onChange: (k: string) => void }) => <View style={styles.seg}>{items.map((it) => <Pressable key={it.k} onPress={() => onChange(it.k)} style={[styles.segItem, value === it.k && { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }]}>{it.icon && <MaterialCommunityIcons name={it.icon} size={14} color={value === it.k ? colors.primary : colors.textMuted} />}<Text style={{ fontSize: 12, fontWeight: '700', color: value === it.k ? colors.primary : colors.textMuted }}>{it.label}</Text></Pressable>)}</View>;
  const Footer = () => <Row gap={6} style={{ marginLeft: 'auto', paddingLeft: 10 }}><Pressable onPress={cancelPanel} style={styles.ghostBtn}><Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted }}>취소</Text></Pressable><Pressable onPress={applyPanel} style={[styles.ghostBtn, { backgroundColor: colors.primary }]}><Ionicons name="checkmark" size={14} color="#fff" /><Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>적용</Text></Pressable></Row>;

  const toolBtn = (kind: ToolArtKind, label: string, active: boolean, onPress: () => void, color?: string) => (
    <Pressable key={kind} accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} hitSlop={{ top: 6, bottom: 0, left: 2, right: 2 }} style={styles.toolSlot}>
      <View style={{ transform: [{ translateY: active ? 0 : 13 }] }}><ToolArt kind={kind} color={color} /></View>
    </Pressable>
  );
  const penColor = cfg.tool === 'pen' ? cfg.color : viewer.toolPresets?.pen?.color ?? '#1C1C1E';
  const hlColor = cfg.tool === 'highlighter' ? cfg.color : viewer.toolPresets?.highlighter?.color ?? '#FACC15';
  const pencilColor = cfg.tool === 'pencil' ? cfg.color : viewer.toolPresets?.pencil?.color ?? '#1C1C1E';
  const roundBtn = (label: string, icon: any, onPress?: () => void, disabled?: boolean) => <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.roundBtn, pressed && { opacity: 0.55 }]}><Ionicons name={icon} size={18} color={disabled ? '#C7C7CC' : '#1C1C1E'} /></Pressable>;
  const iconBtn = (label: string, name: any, lib: 'ion' | 'mci', active: boolean, onPress?: () => void) => <Pressable accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.iconBtn, active && styles.iconBtnActive, pressed && { opacity: 0.55 }]}>{lib === 'mci' ? <MaterialCommunityIcons name={name} size={21} color={active ? '#007AFF' : '#1C1C1E'} /> : <Ionicons name={name} size={21} color={active ? '#007AFF' : '#1C1C1E'} />}</Pressable>;
  const chip = (label: string, text: string, icon: any, active: boolean, onPress?: () => void) => <Pressable accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.6 }]}><MaterialCommunityIcons name={icon} size={15} color={active ? '#007AFF' : '#3A3A3C'} />{winW >= 1100 ? <Text style={[styles.chipText, active && { color: '#007AFF' }]}>{text}</Text> : null}</Pressable>;
  const favs = viewer.favoritePens ?? [];
  const removeFav = (i: number) => { const next = favs.filter((_, j) => j !== i); settings.setViewer({ favoritePens: next }); if (!next.length) setFavEdit(false); };
  const favRow = (
    <View style={[styles.cardRow, { flexWrap: 'wrap', minHeight: 28 }]}><Ionicons name="star-outline" size={14} color="#8E8E93" />
      {favs.map((f, i) => <Pressable key={i} accessibilityLabel={favEdit ? `즐겨찾는 펜 ${i + 1} 삭제` : `즐겨찾는 펜 ${i + 1}`} onPress={() => { if (favEdit) { removeFav(i); return; } onCfg({ tool: f.tool as Tool, color: f.color, width: f.width, opacity: f.opacity }); setPanel(null); /* picked a favourite: close the card and write right away */ }} onLongPress={() => setFavEdit(true)} style={({ pressed }) => [styles.fav, !favEdit && cfg.tool === f.tool && cfg.color === f.color && cfg.width === f.width && { borderColor: '#007AFF' }, favEdit && { borderColor: 'rgba(255,59,48,0.45)' }, pressed && { transform: [{ scale: 0.92 }] }]}><MaterialCommunityIcons name={f.tool === 'highlighter' ? 'marker' : f.tool === 'pencil' ? 'pencil' : 'pen'} size={11} color="#8E8E93" /><View style={{ width: Math.min(14, 3 + f.width * (f.tool === 'highlighter' ? 0.4 : 1.2)), height: Math.min(14, 3 + f.width * (f.tool === 'highlighter' ? 0.4 : 1.2)), borderRadius: 7, backgroundColor: f.color, opacity: f.tool === 'highlighter' ? 0.7 : 1 }} />{favEdit && <View pointerEvents="none" style={styles.favDel}><Ionicons name="close" size={10} color="#fff" /></View>}</Pressable>)}
      {!favEdit && favs.length < 8 && <Pressable accessibilityLabel="즐겨찾는 펜 추가" onPress={() => settings.setViewer({ favoritePens: [...favs, { tool: cfg.tool, color: cfg.color, width: cfg.width, opacity: cfg.opacity, fixed: cfg.tool === 'pen' ? true : undefined }] })} style={[styles.fav, { borderStyle: 'dashed' }]}><Ionicons name="add" size={14} color="#8E8E93" /></Pressable>}
      {favs.length > 0 && <Pressable accessibilityLabel={favEdit ? '즐겨찾기 편집 완료' : '즐겨찾기 편집'} onPress={() => setFavEdit((v) => !v)} style={({ pressed }) => [styles.favEditBtn, favEdit && { backgroundColor: '#007AFF' }, pressed && { opacity: 0.6 }]}><Text style={{ fontSize: 12, fontWeight: '700', color: favEdit ? '#fff' : '#007AFF' }}>{favEdit ? '완료' : '편집'}</Text></Pressable>}
      {favEdit && <Text style={{ fontSize: 11, color: '#8E8E93' }}>지울 펜을 누르세요</Text>}
    </View>
  );
  // color choice inside the pen / highlighter card (same live preview as the toolbar palette; 취소 restores it)
  // colour: a row of ready-made swatches (favourites first) and a gradient sheet to pick any colour by tap or drag
  const colorRow = (list: string[]) => {
    const swatches = Array.from(new Set([...(viewer.favoriteColors ?? []), ...list].map((c) => c.toUpperCase()))).slice(0, 14);
    return (
      <View style={{ gap: 8 }}>
        <View style={[styles.cardRow, { minHeight: 28 }]}>
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
            {swatches.map((c) => { const sel = c === cfg.color.toUpperCase(); return <Pressable key={c} accessibilityLabel={`색상 ${c}`} accessibilityState={{ selected: sel }} hitSlop={3} onPress={() => onCfg({ color: c })} style={({ pressed }) => [styles.cSw, { backgroundColor: c, borderWidth: sel ? 3 : 1, borderColor: sel ? '#007AFF' : 'rgba(0,0,0,0.14)' }, pressed && { transform: [{ scale: 0.88 }] }]} />; })}
            <Pressable accessibilityLabel={spectrum ? '색상표 접기' : '다른 색 고르기'} accessibilityState={{ expanded: spectrum }} hitSlop={3} onPress={() => setSpectrum((v) => !v)} style={({ pressed }) => [styles.cSw, styles.spectrumBtn, spectrum && { borderColor: '#007AFF', borderWidth: 2 }, pressed && { transform: [{ scale: 0.88 }] }]}><Ionicons name="color-palette-outline" size={14} color={spectrum ? '#007AFF' : '#3C3C43'} /></Pressable>
          </View>
        </View>
        {spectrum && <GradientPalette color={cfg.color} onChange={(c) => onCfg({ color: c })} width={Math.min(cardW - 32, 500)} height={cfg.tool === 'highlighter' ? 56 : 84} pastelOnly={cfg.tool === 'highlighter'} />}
      </View>
    );
  };
  const toggleRow = (label: string, value: boolean, onChange: (v: boolean) => void) => <View style={styles.cardRow}><Text style={[styles.rowLbl, { width: undefined, flex: 1 }]}>{label}</Text><Toggle value={value} onChange={onChange} /></View>;
  const sizeRow = (label: string) => <View style={styles.cardRow}><Text style={styles.rowLbl}>{label}</Text>{widthSlider}</View>;
  // live sample of the current tool (a short wave drawn exactly like the page stroke: outline for pens, band for highlighter)
  const strokePreview = (w?: number, h?: number) => {
    const W_ = w ?? Math.min(cardW - 32, 420), H_ = h ?? 46; const pts = Array.from({ length: 24 }, (_, i) => ({ x: 10 + (i / 23) * (W_ - 20), y: H_ / 2 + Math.sin(i / 23 * Math.PI * 2) * 11, p: 0.35 + 0.65 * Math.sin((i / 23) * Math.PI) }));
    const k = 2.2; // screen px per page unit in the sample (matches a typical zoom)
    const ink = cfg.tool === 'highlighter'
      ? <Path d={pts.map((q, i) => `${i ? 'L' : 'M'} ${q.x} ${q.y}`).join(' ')} stroke={cfg.color} strokeOpacity={cfg.opacity} strokeWidth={cfg.width * k} strokeLinecap="butt" strokeLinejoin="round" fill="none" />
      : isEraser ? <G>{/* a thin stroke with its middle rubbed out by an eraser of the chosen size */}
          <Path d={pts.map((q, i) => `${i ? 'L' : 'M'} ${q.x} ${q.y}`).join(' ')} stroke="#3C3C43" strokeWidth={2.2} strokeLinecap="round" fill="none" />
          <Path d={pts.slice(8, 16).map((q, i) => `${i ? 'L' : 'M'} ${q.x} ${q.y}`).join(' ')} stroke="#F6F7FB" strokeWidth={cfg.width * k + 3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d={pts.slice(8, 16).map((q, i) => `${i ? 'L' : 'M'} ${q.x} ${q.y}`).join(' ')} stroke="rgba(0,122,255,0.22)" strokeWidth={cfg.width * k + 3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </G>
      : cfg.tool === 'pencil' ? <PencilStroke points={pts.map((q) => ({ x: q.x / k, y: q.y / k, p: q.p }))} width={cfg.width} color={cfg.color} opacity={cfg.opacity} scale={k} live />
      : <Path d={penOutline(pts.map((q) => ({ x: q.x / k, y: q.y / k, p: q.p })), cfg.width, true, cfg.tool)} scale={k} fill={cfg.color} fillOpacity={cfg.opacity} />;
    return <View style={[styles.previewBox, w ? { alignSelf: 'auto', width: W_ + 12, height: H_ + 4 } : null]}><Svg width={W_} height={H_}>{ink}</Svg></View>;
  };
  const cardW = Math.min(560, winW - 24);

  return (
    <View pointerEvents="box-none">
      <View style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.barContent}>
          <Pressable accessibilityLabel="뒤로가기" onPress={onBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.55 }]}><Ionicons name="chevron-back" size={26} color="#007AFF" /><Image source={require('../../../assets/orun-mark.png')} style={{ width: 26, height: 26, borderRadius: 7 }} /></Pressable>
          {roundBtn('되돌리기', 'arrow-undo', onUndo, !canUndo)}
          {roundBtn('다시하기', 'arrow-redo', onRedo, !canRedo)}
          {!readOnly && <>
            <View style={styles.toolTray}>
              {toolBtn('pen', '펜', cfg.tool === 'pen', () => pick('pen'), penColor)}
              {toolBtn('pencil', '연필', cfg.tool === 'pencil', () => pick('pencil'), pencilColor)}
              {toolBtn('highlighter', '형광펜', cfg.tool === 'highlighter', () => pick('highlighter'), hlColor)}
              {toolBtn('eraser', '지우개', isEraser, () => pick(cfg.tool === 'vectorEraser' ? 'vectorEraser' : 'eraser'))}
              {toolBtn('lasso', '올가미', cfg.tool === 'lasso', () => pick('lasso'))}
              {toolBtn('select', '선택', cfg.tool === 'select', () => pick('select'), '#007AFF')}
            </View>
            <View style={styles.colorGrid}>
              {quick.map((c, i) => { const sel = c.toUpperCase() === cfg.color.toUpperCase(); return <Pressable key={i} accessibilityLabel={`대표색 ${i + 1}`} onPress={() => { if (sel) openPanel(panel === 'color' ? null : 'color'); else onCfg({ color: c }); }} onLongPress={() => setFav(i, cfg.color)} style={[styles.swatch, sel && { borderColor: c.toUpperCase() === '#FFFFFF' ? '#C7C7CC' : c }]}><View style={[styles.swatchIn, { backgroundColor: c }]} /></Pressable>; })}
              <Pressable accessibilityLabel="색상 선택" onPress={() => openPanel(panel === 'color' ? null : 'color')} style={[styles.swatch, panel === 'color' && { borderColor: '#007AFF' }]}><ColorWheel size={20} /></Pressable>
            </View>
            {iconBtn('도형', 'shape-outline', 'mci', cfg.tool === 'shape', () => pick('shape'))}
            {iconBtn('텍스트', 'format-text', 'mci', cfg.tool === 'text', () => pick('text'))}
            {onInsertImage && iconBtn('사진 넣기', 'image-outline', 'ion', false, onInsertImage)}
            {iconBtn('보정', 'auto-fix', 'mci', panel === 'snap', () => openPanel(panel === 'snap' ? null : 'snap'))}
          </>}
          {iconBtn('손/이동', 'hand-left-outline', 'ion', cfg.tool === 'hand', () => pick('hand'))}
          {onSubDoc && iconBtn('서브교재', 'book-open-page-variant-outline', 'mci', false, onSubDoc)}
          {onVideos && iconBtn('보강영상', 'play-box-multiple-outline', 'mci', false, onVideos)}
          {/* the empty space on the right carries the calligraphy title (only when it fits) */}
          <View style={{ flex: 1, minWidth: 8, alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'center', paddingRight: 14 }} onLayout={(e) => setTitleSpace(e.nativeEvent.layout.width)} pointerEvents="none">
            {titleSpace >= MARK_H * ORUN_MARK_RATIO + MARK_GAP + TITLE_H * ORUN_TITLE_RATIO + 30
              ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: MARK_GAP }}><OrunMark height={MARK_H} /><OrunTitle height={TITLE_H} /></View>
              : titleSpace >= TITLE_H * ORUN_TITLE_RATIO + 30 && <OrunTitle height={TITLE_H} />}
          </View>
          {onLock && chip('캔버스 고정', '캔버스 고정', locked ? 'lock' : 'lock-open-variant-outline', !!locked, onLock)}
          {onMore && roundBtn('더보기', 'ellipsis-horizontal', onMore)}
        </ScrollView>
      </View>

      {panel && (
        <View pointerEvents="box-none" style={{ paddingHorizontal: 12, paddingTop: 8, alignItems: 'flex-start' }}>
          <View style={[styles.card, { width: cardW }]}>
            {(panel === 'pen' || panel === 'highlighter') && <>
              {/* GoodNotes-like compact card: type + live sample on one row, thickness (+ quick sizes), colours, favourites */}
              <View style={styles.cardRow}>
                <Seg items={[{ k: 'pen', label: '펜', icon: 'pen' }, { k: 'pencil', label: '연필', icon: 'pencil' }, { k: 'highlighter', label: '형광펜', icon: 'marker' }]} value={cfg.tool} onChange={(k) => { onCfg({ tool: k as Tool }); setPanel(k === 'highlighter' ? 'highlighter' : 'pen'); }} />
                {cfg.tool === 'highlighter' && <Seg items={[{ k: 'free', label: '자유' }, { k: 'line', label: '직선' }]} value={viewer.straightHighlighter ? 'line' : 'free'} onChange={(k) => settings.setViewer({ straightHighlighter: k === 'line' })} />}
                <View style={{ flex: 1 }} />
                {cardW >= 420 && strokePreview(Math.min(170, cardW - 330), 30)}
                <Pressable accessibilityLabel="닫기" hitSlop={8} onPress={applyPanel} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}><Ionicons name="close" size={16} color="#3C3C43" /></Pressable>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.rowLbl}>굵기</Text>{widthSlider}
                <View style={{ flexDirection: 'row', gap: 4 }}>{(cfg.tool === 'highlighter' ? [8, 14, 24] : [0.7, 1.5, 3]).map((w) => <Pressable key={w} accessibilityLabel={`굵기 ${w}`} hitSlop={3} onPress={() => onCfg({ width: w })} style={({ pressed }) => [styles.sizeDot, Math.abs(cfg.width - w) < 0.05 && { borderColor: '#007AFF', backgroundColor: 'rgba(0,122,255,0.08)' }, pressed && { transform: [{ scale: 0.9 }] }]}><View style={{ width: Math.min(18, 3 + w * (cfg.tool === 'highlighter' ? 0.6 : 3)), height: Math.min(18, 3 + w * (cfg.tool === 'highlighter' ? 0.6 : 3)), borderRadius: 9, backgroundColor: cfg.color, opacity: cfg.tool === 'highlighter' ? 0.6 : 1 }} /></Pressable>)}</View>
              </View>
              {cfg.tool === 'highlighter' && <View style={styles.cardRow}><Text style={styles.rowLbl}>투명도</Text>{opacitySlider}<Text style={{ width: 36, fontSize: 11, color: '#8E8E93', textAlign: 'right' }}>{Math.round(cfg.opacity * 100)}%</Text></View>}
              {colorRow(cfg.tool === 'highlighter' ? HL_PALETTE : PALETTE)}
              {favRow}
            </>}
            {panel === 'eraser' && <>
              {strokePreview()}
              <View style={styles.cardRow}><Seg items={[{ k: 'eraser', label: '획 지우개', icon: 'eraser' }, { k: 'vectorEraser', label: '영역 지우개', icon: 'eraser-variant' }]} value={cfg.tool} onChange={(k) => onCfg({ tool: k as Tool })} /></View>
              {sizeRow('크기')}
              {toggleRow('형광펜만 지우기', !!viewer.eraseHighlighterOnly, (v) => settings.setViewer({ eraseHighlighterOnly: v }))}
              <View style={[styles.cardRow, { flexWrap: 'wrap' }]}><Pressable onPress={() => setConfirm('page')} style={styles.ghostBtn}><Ionicons name="trash-outline" size={14} color="#FF3B30" /><Text style={{ fontSize: 13, fontWeight: '600', color: '#FF3B30' }}>이 페이지 필기 모두 지우기</Text></Pressable>{onClearAll && <Pressable onPress={() => setConfirm('all')} style={styles.ghostBtn}><Ionicons name="trash-bin-outline" size={14} color="#FF3B30" /><Text style={{ fontSize: 13, fontWeight: '600', color: '#FF3B30' }}>모든 페이지 지우기</Text></Pressable>}</View>
            </>}
            {panel === 'shape' && <>
              <View style={[styles.cardRow, { flexWrap: 'wrap' }]}><Seg items={SHAPES.map((sh) => ({ k: sh.k, label: sh.label, icon: sh.icon }))} value={cfg.shape} onChange={(k) => onCfg({ shape: k as ShapeKind, tool: 'shape' })} /></View>
              {sizeRow('굵기')}
            </>}
            {panel === 'text' && <>
              <View style={styles.cardRow}><Seg items={TEXT_FONTS.map((f) => ({ k: f.k, label: f.label }))} value={textFont} onChange={(k) => onTextFont?.(k)} /></View>
              <View style={styles.cardRow}><Text style={styles.rowLbl}>크기</Text><Text style={{ fontSize: 11, color: '#8E8E93' }}>가</Text><DragSlider min={8} max={48} step={1} value={cfg.width} onChange={(v) => onCfg({ width: Math.round(v) })} fill="#007AFF" thumb="#007AFF" /><Text style={{ fontSize: 19, color: '#8E8E93' }}>가</Text></View>
              <View style={styles.cardRow}><Text numberOfLines={1} style={{ fontSize: Math.min(28, cfg.width), color: cfg.color, fontFamily: TEXT_FONTS.find((f) => f.k === textFont)?.family }}>가나다 Abc</Text></View>
            </>}
            {panel === 'color' && <>
              <View style={[styles.cardRow, { flexWrap: 'wrap', gap: 7 }]}>{PALETTE.map((c) => <Pressable key={c} accessibilityLabel={`색상 ${c}`} onPress={() => onCfg({ color: c })} style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 14, backgroundColor: c, borderWidth: c.toUpperCase() === cfg.color.toUpperCase() ? 3 : 1, borderColor: c.toUpperCase() === cfg.color.toUpperCase() ? '#007AFF' : 'rgba(0,0,0,0.12)', transform: [{ scale: pressed ? 0.88 : 1 }] })} />)}</View>
              <View style={[styles.cardRow, { alignItems: 'flex-start' }]}><View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: cfg.color, borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 }} /><GradientPalette color={cfg.color} onChange={(c) => onCfg({ color: c })} width={Math.min(cardW - 32 - 44, 460)} height={104} /></View>
              <View style={styles.cardRow}><Text style={[styles.rowLbl, { width: undefined }]}>대표색에 저장</Text><Row gap={6}>{quick.map((c, i) => <Pressable key={i} accessibilityLabel={`대표색 ${i + 1}에 저장`} onPress={() => setFav(i, cfg.color)} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c, borderWidth: 2, borderColor: c.toUpperCase() === cfg.color.toUpperCase() ? '#007AFF' : '#fff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }} />)}</Row></View>
              {!isEraser && <View style={styles.cardRow}><Text style={styles.rowLbl}>투명도</Text>{opacitySlider}</View>}
            </>}
            {panel === 'snap' && <>
              {toggleRow('획 보정 (손떨림 줄이기)', viewer.strokeSmoothing, (v) => settings.setViewer({ strokeSmoothing: v }))}
              {toggleRow('직선 자동 보정 (끝에서 0.5초 멈춤)', viewer.lineSnap, (v) => settings.setViewer({ lineSnap: v }))}
              {toggleRow('도형 자동 보정', viewer.shapeSnap, (v) => settings.setViewer({ shapeSnap: v }))}
            </>}
            {panel === 'lasso' && <>
              <View style={styles.cardRow}><Seg items={[{ k: 'free', label: '자유형' }, { k: 'rect', label: '사각형' }]} value={viewer.lassoMode ?? 'free'} onChange={(k) => settings.setViewer({ lassoMode: k as 'free' | 'rect' })} /></View>
              {toggleRow('부분 선택된 개체 포함', viewer.lassoPartial ?? true, (v) => settings.setViewer({ lassoPartial: v }))}
              <Text style={{ fontSize: 12, color: '#8E8E93' }}>선택한 뒤 끌어서 이동 · 오른쪽 아래 점으로 크기 조절</Text>
            </>}
            {panel !== 'pen' && panel !== 'highlighter' && <View style={styles.cardFooter}>
              <Text style={{ flex: 1, fontSize: 11, color: '#8E8E93' }}>페이지를 터치하면 바로 적용돼요</Text>
              <Pressable accessibilityLabel="취소" onPress={cancelPanel} style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.6 }]}><Text style={styles.cancelText}>취소</Text></Pressable>
              <Pressable accessibilityLabel="적용" onPress={applyPanel} style={({ pressed }) => [styles.applyBtn, pressed && { opacity: 0.8 }]}><Text style={styles.applyText}>적용</Text></Pressable>
            </View>}
          </View>
        </View>
      )}
      <Dialog visible={confirm === 'page'} title="현재 페이지 필기를 모두 제거할까요?" message="버전 기록에서 복원할 수 있어요." onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '제거', variant: 'danger', onPress: () => { setConfirm(null); setPanel(null); onClear(); } }]} />
      <Dialog visible={confirm === 'all'} title="이 문서의 모든 필기를 제거할까요?" message="모든 페이지의 필기가 삭제됩니다. 되돌릴 수 없어요." onClose={() => setConfirm(null)} actions={[{ label: '취소', onPress: () => setConfirm(null) }, { label: '전체 제거', variant: 'danger', onPress: () => { setConfirm(null); setPanel(null); onClearAll?.(); } }]} />
    </View>
  );
}
const styles = StyleSheet.create({
  bar: { backgroundColor: 'rgba(255,255,255,0.96)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(60,60,67,0.22)', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  barContent: { alignItems: 'flex-end', paddingHorizontal: 8, height: 64, gap: 6, flexGrow: 1 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 64, paddingRight: 4 },
  roundBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EFEFF4', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  iconBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  iconBtnActive: { backgroundColor: 'rgba(0,122,255,0.12)' },
  toolTray: { flexDirection: 'row', alignItems: 'flex-end', height: 64, paddingHorizontal: 6, gap: 3 },
  toolSlot: { width: 30, height: 60, overflow: 'hidden', alignItems: 'center' },
  colorGrid: { width: 3 * 26 + 2 * 3, flexDirection: 'row', flexWrap: 'wrap', gap: 3, alignSelf: 'center', marginHorizontal: 6 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatchIn: { width: 19, height: 19, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.15)' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: '#EFEFF4', marginBottom: 17 },
  chipActive: { backgroundColor: 'rgba(0,122,255,0.14)' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#3A3A3C' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 8, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(60,60,67,0.15)' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  rowLbl: { width: 44, fontSize: 12, fontWeight: '600', color: '#3C3C43' },
  closeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center' },
  sizeDot: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  spectrumBtn: { backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.14)' },
  previewBox: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#F6F7FB', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(60,60,67,0.12)', paddingVertical: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(60,60,67,0.18)', paddingTop: 10, marginTop: 2 },
  cancelBtn: { paddingHorizontal: 16, height: 34, borderRadius: 10, backgroundColor: '#EFEFF4', alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#1C1C1E' },
  applyBtn: { paddingHorizontal: 18, height: 34, borderRadius: 10, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  applyText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  tb: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, tbActive: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#2F6FED', shadowColor: '#2F6FED', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 }, sep: { width: 1, height: 22, backgroundColor: 'rgba(128,128,128,0.25)', marginHorizontal: 5 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginHorizontal: 1 }, widthBtn: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginLeft: 2, backgroundColor: '#fff' },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 30, borderRadius: 8, borderWidth: 1, borderColor: 'transparent', marginLeft: 4 },
  seg: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 10, padding: 3, gap: 2 }, segItem: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 28, borderRadius: 8 },
  fav: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 26, minWidth: 32, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)', backgroundColor: '#fff', justifyContent: 'center' },
  favDel: { position: 'absolute', top: -7, right: -7, width: 17, height: 17, borderRadius: 9, backgroundColor: '#FF3B30', borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  favEditBtn: { height: 28, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'rgba(0,122,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  cSw: { width: 24, height: 24, borderRadius: 12 },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.05)' }, lbl: { fontSize: 12, fontWeight: '600', color: '#5B6578' },
});
