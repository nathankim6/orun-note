import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useTheme, useContentSize } from '@/theme';
import type { ToolConfig } from './ink';
import { ToolArt, type ToolArtKind } from './ToolArt';
import { DragSlider } from './Toolbar';
import { dialColors, dialWidthRange, placeStylusDial, type DialPoint } from './stylusDialGeometry';

export type StylusDialProps = {
  cfg: ToolConfig;
  onCfg: (patch: Partial<ToolConfig>) => void;
  onClose: () => void;
  /** Viewer overlay-local logical points. Parent converts native screen coordinates before passing them. */
  anchor: DialPoint;
  favorites?: string[];
};
const TOOLS: { kind: ToolArtKind; label: string; x: number; angle: number; outer: boolean }[] = [
  { kind: 'pen', label: '펜', x: 0.23, angle: -35, outer: true },
  { kind: 'pencil', label: '연필', x: 0.405, angle: -12, outer: false },
  { kind: 'highlighter', label: '형광펜', x: 0.595, angle: 12, outer: false },
  { kind: 'eraser', label: '지우개', x: 0.77, angle: 35, outer: true },
];

/** Compact half-disk: enlarged header tool art follows the dome, controls stay above its flat base. */
export function StylusDial({ cfg, onCfg, onClose, anchor, favorites }: StylusDialProps) {
  const { colors, dark } = useTheme();
  const content = useContentSize(); const insets = useSafeAreaInsets();
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const pos = placeStylusDial(anchor, { ...(measured ?? content), top: insets.top, bottom: insets.bottom });
  const w = pos.width, h = pos.height, c = w / 2, compact = w < 260;
  const sliderWidth = compact ? 80 : 100, toolHeight = compact ? 64 : 78, toolWidth = compact ? 44 : 52;
  const isEraser = cfg.tool === 'eraser' || cfg.tool === 'vectorEraser';
  const selected = isEraser ? 'eraser' : cfg.tool;
  const name = TOOLS.find(t => t.kind === selected)?.label ?? '펜 도구';
  const swatches = dialColors(cfg.color, favorites);
  const range = dialWidthRange(cfg.tool);
  const edge = dark ? 'rgba(255,255,255,0.12)' : 'rgba(31,49,84,0.10)';
  return (
    <View pointerEvents="box-none" style={styles.overlay} onLayout={e => {
      const { width, height } = e.nativeEvent.layout;
      setMeasured(old => old?.width === width && old?.height === height ? old : { width, height });
    }}>
      <View testID="stylus-dial" onStartShouldSetResponder={() => true} accessibilityLabel="반원 펜 빠른 도구 다이얼" style={[styles.panel, pos, { borderTopLeftRadius: c, borderTopRightRadius: c, backgroundColor: colors.surface, borderColor: edge }]}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 8, right: 8, top: 8, bottom: 8, borderTopLeftRadius: c - 8, borderTopRightRadius: c - 8, backgroundColor: dark ? '#24262C' : '#F7F9FD', borderColor: edge, borderWidth: StyleSheet.hairlineWidth }} />
        {TOOLS.map(t => {
          const active = selected === t.kind;
          const x = w * t.x, y = t.outer ? (compact ? 73 : 88) : (compact ? 36 : 50);
          const ink = t.kind === 'highlighter' && cfg.tool !== 'highlighter' ? '#FACC15' : cfg.color;
          return <Pressable key={t.kind} testID={`stylus-dial-tool-${t.kind}`} accessibilityRole="button" accessibilityLabel={`${t.label} 선택`} accessibilityState={{ selected: active }}
            onPress={() => onCfg({ tool: t.kind === 'eraser' && cfg.tool === 'vectorEraser' ? 'vectorEraser' : t.kind as ToolConfig['tool'] })}
            style={({ pressed }) => [styles.tool, { left: x - toolWidth / 2, top: y - toolHeight / 2, width: toolWidth, height: toolHeight }, pressed && { opacity: 0.65 }]}>
            <View pointerEvents="none" style={[styles.artWell, { height: toolHeight, width: toolWidth, backgroundColor: active ? colors.primarySoft : 'transparent', borderColor: active ? colors.primary : 'transparent', transform: [{ rotate: `${t.angle}deg` }] }]}>
              {/* Only the illustration gets wider. Never change cfg.width or the actual ink nib. */}
              <View style={{ transform: [{ scaleX: 1.3 }] }}><ToolArt kind={t.kind} color={ink} size={compact ? 0.86 : 1.02} /></View>
            </View>
          </Pressable>;
        })}
        <View style={{ position: 'absolute', left: c - sliderWidth / 2, top: compact ? 67 : 91, width: sliderWidth }}>
          <View pointerEvents="none" style={styles.widthLabel}><Text style={{ color: colors.textMuted, fontSize: 9 }}>{name}</Text><Text testID="stylus-dial-current-width" style={{ color: colors.text, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{Number(cfg.width.toFixed(1))}</Text></View>
          <View testID="stylus-dial-width-slider" accessibilityLabel={`${name} 굵기 조절`}>
            <DragSlider min={range.min} max={range.max} step={range.step} value={Math.max(range.min, Math.min(range.max, cfg.width))} width={sliderWidth} height={30}
              onChange={width => onCfg({ width: Math.round(width * 10) / 10 })} fill={colors.primary} thumb={colors.primary} track={<View style={{ position: 'absolute', left: 11, right: 11, height: 4, borderRadius: 2, backgroundColor: edge }} />} />
          </View>
        </View>
        {isEraser ? <Pressable testID="stylus-dial-eraser-mode" accessibilityRole="button" accessibilityLabel={`${cfg.tool === 'eraser' ? '획 지우개' : '영역 지우개'}, 눌러서 종류 변경`} onPress={() => onCfg({ tool: cfg.tool === 'eraser' ? 'vectorEraser' : 'eraser' })}
          style={({ pressed }) => [styles.mode, { left: c - 68, top: h - 40, backgroundColor: colors.primarySoft, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '700' }}>{cfg.tool === 'eraser' ? '획 지우개' : '영역 지우개'}  ⇄</Text>
        </Pressable> : <ScrollView horizontal bounces={false} showsHorizontalScrollIndicator={false} style={{ position: 'absolute', left: compact ? 12 : 24, right: compact ? 12 : 58, top: h - 40, height: 36 }} contentContainerStyle={{ gap: 4, flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}>
          {swatches.map((color, i) => {
          const active = color.toLowerCase() === cfg.color.toLowerCase();
          return <Pressable key={`${i}-${color}`} testID={`stylus-dial-color-${color.slice(1)}`} accessibilityRole="button" accessibilityLabel={`색상 ${color}`} accessibilityState={{ selected: active }} onPress={() => onCfg({ color })} style={styles.colorTarget}>
            <View style={[styles.colorRing, { borderColor: active ? colors.primary : 'transparent' }]}><View style={[styles.colorDot, { backgroundColor: color, borderColor: color.toLowerCase() === '#ffffff' ? '#C7CDD6' : 'rgba(0,0,0,0.08)' }]} />{active && <View style={[styles.colorSelected, { backgroundColor: colors.surface }]} />}</View>
          </Pressable>;
        })}</ScrollView>}
        {!compact && <Pressable testID="stylus-dial-close" accessibilityRole="button" accessibilityLabel="펜 다이얼 닫기" onPress={onClose}
          style={({ pressed }) => [styles.close, { right: compact ? 14 : 12, top: h - 40, backgroundColor: pressed ? colors.primarySoft : 'transparent' }]}>
          <Svg width={12} height={12} viewBox="0 0 14 14"><Path d="M3 3L11 11M11 3L3 11" stroke={colors.textMuted} strokeWidth={1.6} strokeLinecap="round" /></Svg>
        </Pressable>}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 90, elevation: 90 },
  panel: { position: 'absolute', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderWidth: 1, overflow: 'hidden', shadowColor: '#10234D', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 7 }, elevation: 16 },
  tool: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  artWell: { borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, overflow: 'visible' },
  widthLabel: { height: 12, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  colorTarget: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  colorRing: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 },
  colorSelected: { position: 'absolute', width: 4, height: 4, borderRadius: 2 },
  mode: { position: 'absolute', width: 112, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
