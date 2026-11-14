import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useTheme, useContentSize } from '@/theme';
import type { ToolConfig } from './ink';
import { ToolArt, type ToolArtKind } from './ToolArt';
import { dialColors, dialWidthPresets, placeStylusDial, type DialPoint } from './stylusDialGeometry';

export type StylusDialProps = {
  cfg: ToolConfig;
  onCfg: (patch: Partial<ToolConfig>) => void;
  onClose: () => void;
  /** Viewer overlay-local logical points. Parent converts native screen coordinates before passing them. */
  anchor: DialPoint;
  favorites?: string[];
};
const TOOLS: { kind: ToolArtKind; label: string; angle: number; lift: number }[] = [
  { kind: 'pen', label: '펜', angle: -24, lift: 24 },
  { kind: 'pencil', label: '연필', angle: -8, lift: 0 },
  { kind: 'highlighter', label: '형광펜', angle: 8, lift: 0 },
  { kind: 'eraser', label: '지우개', angle: 24, lift: 24 },
];

/** Non-modal: only this small panel catches input. Outside Pencil down dismisses AND writes in the parent. */
export function StylusDial({ cfg, onCfg, onClose, anchor, favorites }: StylusDialProps) {
  const { colors, dark } = useTheme();
  const content = useContentSize(); const insets = useSafeAreaInsets();
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const bounds = measured ?? content;
  const pos = placeStylusDial(anchor, { ...bounds, top: insets.top, bottom: insets.bottom });
  const isEraser = cfg.tool === 'eraser' || cfg.tool === 'vectorEraser';
  const selected = isEraser ? 'eraser' : cfg.tool;
  const name = TOOLS.find(t => t.kind === selected)?.label ?? '펜 도구';
  const swatches = dialColors(cfg.color, favorites, Math.min(6, Math.max(1, Math.floor((pos.width - 28) / 44))));
  const widths = dialWidthPresets(cfg.tool);
  const edge = dark ? 'rgba(255,255,255,0.12)' : 'rgba(31,49,84,0.10)';
  const soft = dark ? '#303238' : '#F1F5FC';
  return (
    <View pointerEvents="box-none" style={styles.overlay} onLayout={e => {
      const { width, height } = e.nativeEvent.layout;
      setMeasured(old => old?.width === width && old?.height === height ? old : { width, height });
    }}>
      <View testID="stylus-dial" onStartShouldSetResponder={() => true} accessibilityLabel="펜 빠른 도구 다이얼" style={[styles.panel, pos, { backgroundColor: colors.surface, borderColor: edge }]}>
        <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={[styles.status, { backgroundColor: colors.primary }]} />
            <Text style={[styles.eyebrow, { color: colors.textMuted }]}>빠른 도구</Text>
            <Pressable testID="stylus-dial-close" accessibilityRole="button" accessibilityLabel="펜 다이얼 닫기" onPress={onClose} style={({ pressed }) => [styles.close, pressed && { backgroundColor: soft }]}>
              <Svg width={14} height={14} viewBox="0 0 14 14"><Path d="M3 3L11 11M11 3L3 11" stroke={colors.textMuted} strokeWidth={1.6} strokeLinecap="round" /></Svg>
            </Pressable>
          </View>
          <View style={styles.fan}>
            <View pointerEvents="none" style={[styles.orbit, { borderColor: edge, backgroundColor: dark ? '#24262C' : '#FAFBFE' }]} />
            {TOOLS.map((t, i) => {
              const active = selected === t.kind;
              const ink = t.kind === 'highlighter' && cfg.tool !== 'highlighter' ? '#FACC15' : cfg.color;
              return <Pressable key={t.kind} testID={`stylus-dial-tool-${t.kind}`} accessibilityRole="button" accessibilityLabel={`${t.label} 선택`} accessibilityState={{ selected: active }}
                onPress={() => onCfg({ tool: t.kind === 'eraser' && cfg.tool === 'vectorEraser' ? 'vectorEraser' : t.kind as ToolConfig['tool'] })}
                style={({ pressed }) => [styles.tool, { left: `${3 + i * 24}%`, top: t.lift, width: '22%' }, pressed && { opacity: 0.7 }]}>
                <View style={[styles.artWell, { backgroundColor: active ? colors.primarySoft : 'transparent', borderColor: active ? colors.primary : 'transparent', transform: [{ rotate: `${t.angle}deg` }, { translateY: active ? -3 : 0 }] }]}>
                  <ToolArt kind={t.kind} color={ink} size={0.88} />
                </View>
                <Text style={[styles.toolLabel, { color: active ? colors.primary : colors.textMuted, fontWeight: active ? '800' : '500' }]}>{t.label}</Text>
              </Pressable>;
            })}
            <View pointerEvents="none" style={[styles.hub, { backgroundColor: colors.surface, borderColor: edge }]}>
              {isEraser ? <View style={[styles.eraseSample, { borderColor: colors.textFaint }]} /> : <Svg width={46} height={22} viewBox="0 0 46 22"><Path d="M3 15C9 2 14 3 17 12S24 22 29 10S36 4 43 9" stroke={cfg.color} strokeWidth={Math.min(7, Math.max(1.2, cfg.width * 1.3))} opacity={cfg.tool === 'highlighter' ? cfg.opacity : 1} strokeLinecap="round" fill="none" /></Svg>}
              <Text style={[styles.hubLabel, { color: colors.text }]}>{name}</Text>
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: edge }]} />
          {isEraser ? <View style={styles.eraserRow}>
            {([{ tool: 'eraser', label: '획 지우개' }, { tool: 'vectorEraser', label: '영역 지우개' }] as const).map(t => <Pressable key={t.tool} testID={`stylus-dial-${t.tool}`} accessibilityRole="button" accessibilityLabel={t.label} accessibilityState={{ selected: cfg.tool === t.tool }} onPress={() => onCfg({ tool: t.tool })} style={[styles.eraserButton, { backgroundColor: cfg.tool === t.tool ? colors.primarySoft : soft }]}><Text style={{ color: cfg.tool === t.tool ? colors.primary : colors.textMuted, fontSize: 12, fontWeight: '700' }}>{t.label}</Text></Pressable>)}
          </View> : <View style={styles.colors}>
            {swatches.map(color => { const active = color.toLowerCase() === cfg.color.toLowerCase(); return <Pressable key={color} testID={`stylus-dial-color-${color.slice(1)}`} accessibilityRole="button" accessibilityLabel={`색상 ${color}`} accessibilityState={{ selected: active }} onPress={() => onCfg({ color })} style={styles.colorTarget}>
              <View style={[styles.colorRing, { borderColor: active ? colors.primary : 'transparent' }]}><View style={[styles.colorDot, { backgroundColor: color, borderColor: color.toLowerCase() === '#ffffff' ? '#C7CDD6' : 'rgba(0,0,0,0.08)' }]} />{active && <View style={[styles.colorSelected, { backgroundColor: colors.surface }]} />}</View>
            </Pressable>; })}
          </View>}
          <View style={styles.widthHeader}><Text style={[styles.caption, { color: colors.textMuted }]}>굵기</Text><Text testID="stylus-dial-current-width" style={[styles.widthValue, { color: colors.text }]}>{Number(cfg.width.toFixed(1))}</Text></View>
          <View style={styles.widths}>
            {widths.map((w, i) => { const active = Math.abs(cfg.width - w) < 0.01; const dot = [3, 6, 10][i]; return <Pressable key={w} testID={`stylus-dial-width-${w}`} accessibilityRole="button" accessibilityLabel={`${name} 굵기 ${w}`} accessibilityState={{ selected: active }} onPress={() => onCfg({ width: w })} style={({ pressed }) => [styles.widthButton, { backgroundColor: active ? colors.primarySoft : soft, borderColor: active ? colors.primary : 'transparent' }, pressed && { opacity: 0.65 }]}>
              <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: active ? colors.primary : colors.textMuted }} /><Text style={{ fontSize: 12, fontWeight: active ? '800' : '600', color: active ? colors.primary : colors.textMuted }}>{w}</Text>
            </Pressable>; })}
          </View>
          <Text style={[styles.hint, { color: colors.textFaint }]}>고른 뒤 바로 쓰세요</Text>
        </ScrollView>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 90, elevation: 90 },
  panel: { position: 'absolute', borderRadius: 30, borderWidth: 1, overflow: 'hidden', shadowColor: '#10234D', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 16 },
  content: { minHeight: 352, paddingHorizontal: 14 },
  header: { height: 44, paddingLeft: 7, flexDirection: 'row', alignItems: 'center' },
  status: { width: 4, height: 4, borderRadius: 2, marginRight: 6 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  close: { width: 44, height: 44, marginLeft: 'auto', marginRight: -7, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  fan: { height: 150, position: 'relative' },
  orbit: { position: 'absolute', left: '10%', right: '10%', top: 23, height: 125, borderRadius: 100, borderWidth: 1 },
  tool: { position: 'absolute', minWidth: 44, height: 102, alignItems: 'center', zIndex: 2 },
  artWell: { height: 74, width: 46, borderRadius: 18, paddingTop: 5, alignItems: 'center', overflow: 'hidden', borderWidth: 1.5 },
  toolLabel: { fontSize: 10, marginTop: 5 },
  hub: { position: 'absolute', left: '50%', marginLeft: -37, top: 86, width: 74, height: 60, borderRadius: 30, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hubLabel: { fontSize: 10, fontWeight: '700', marginTop: 1 },
  eraseSample: { width: 25, height: 14, borderRadius: 6, borderWidth: 1.5, borderStyle: 'dashed', marginBottom: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 7, marginBottom: 4 },
  colors: { height: 48, flexDirection: 'row', justifyContent: 'space-evenly' },
  colorTarget: { minWidth: 44, height: 48, justifyContent: 'center', alignItems: 'center' },
  colorRing: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  colorDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1 },
  colorSelected: { position: 'absolute', width: 5, height: 5, borderRadius: 3 },
  eraserRow: { height: 48, flexDirection: 'row', gap: 8, alignItems: 'center' },
  eraserButton: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  widthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 5, height: 20 },
  caption: { fontSize: 10, fontWeight: '600' },
  widthValue: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  widths: { flexDirection: 'row', gap: 8, marginTop: 3 },
  widthButton: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  hint: { textAlign: 'center', fontSize: 10, marginTop: 9, marginBottom: 10 },
});
