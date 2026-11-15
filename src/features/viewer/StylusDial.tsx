import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useTheme, useContentSize } from '@/theme';
import type { ToolConfig } from './ink';
import { ToolArt, type ToolArtKind } from './ToolArt';
import { DragSlider } from './Toolbar';
import { dialColors, dialWidthRange, placeStylusDial, STYLUS_DIAL_ANGLE, type DialPoint } from './stylusDialGeometry';

export type StylusDialProps = {
  cfg: ToolConfig;
  onCfg: (patch: Partial<ToolConfig>) => void;
  onClose: () => void;
  /** Viewer-local logical coordinates, independent of the PDF zoom transform. */
  anchor: DialPoint;
  favorites?: string[];
  /** Android captures only the content below the palette, never the palette itself. */
  blurTarget?: React.RefObject<React.ElementRef<typeof View> | null>;
};
const TOOLS: { kind: ToolArtKind; label: string; x: number; angle: number; outer: boolean }[] = [
  { kind: 'pen', label: '펜', x: .20, angle: -35, outer: true },
  { kind: 'pencil', label: '연필', x: .40, angle: -12, outer: false },
  { kind: 'highlighter', label: '형광펜', x: .60, angle: 12, outer: false },
  { kind: 'eraser', label: '지우개', x: .80, angle: 35, outer: true },
];
/** A translucent, softly arched glass palette. The semicircle faces up with its flat edge below; tool art retains its radial fan. */
export function StylusDial({ cfg, onCfg, onClose, anchor, favorites, blurTarget }: StylusDialProps) {
  const { colors, dark } = useTheme();
  const content = useContentSize(), insets = useSafeAreaInsets();
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const pos = placeStylusDial(anchor, { ...(measured ?? content), top: insets.top, bottom: insets.bottom });
  const w = pos.width, h = pos.height, compact = w < 260;
  const isEraser = cfg.tool === 'eraser' || cfg.tool === 'vectorEraser';
  const selected = isEraser ? 'eraser' : cfg.tool;
  const name = TOOLS.find(t => t.kind === selected)?.label ?? '펜';
  const swatches = dialColors(cfg.color, favorites), range = dialWidthRange(cfg.tool);
  const sliderWidth = compact ? 112 : 146;
  const edge = dark ? 'rgba(226,238,255,0.24)' : 'rgba(255,255,255,0.86)';
  const shape = { borderTopLeftRadius: w / 2, borderTopRightRadius: w / 2, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 };
  return <View pointerEvents="box-none" style={styles.overlay} onLayout={e => {
    const { width, height } = e.nativeEvent.layout;
    setMeasured(old => old?.width === width && old?.height === height ? old : { width, height });
  }}>
    <View testID="stylus-dial" accessibilityLabel="글라스 펜 빠른 도구 다이얼" onStartShouldSetResponder={() => true}
      style={[styles.shadow, pos, shape, { shadowOpacity: dark ? .3 : .13, transform: [{ rotate: `${STYLUS_DIAL_ANGLE}deg` }] }]}>
      <View style={[StyleSheet.absoluteFill, shape, styles.glassClip, { borderColor: edge }]}>
        <BlurView pointerEvents="none" intensity={36} tint={dark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
          {...(Platform.OS === 'android' ? { blurTarget, blurMethod: 'dimezisBlurViewSdk31Plus' as const } : {})} style={StyleSheet.absoluteFill} />
        <LinearGradient pointerEvents="none" colors={dark ? ['rgba(152,181,220,0.18)', 'rgba(45,56,78,0.32)', 'rgba(31,42,63,0.48)'] : ['rgba(255,255,255,0.40)', 'rgba(247,251,255,0.08)', 'rgba(217,232,252,0.20)']}
          locations={[0, .46, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { borderWidth: 1, borderTopColor: dark ? 'rgba(255,255,255,.25)' : '#FFFFFF', borderLeftColor: edge, borderRightColor: 'transparent', borderBottomColor: dark ? 'rgba(255,255,255,.06)' : 'rgba(120,149,192,.16)' }]} />
      </View>
      {TOOLS.map(t => {
        const active = selected === t.kind, x = w * t.x, y = t.outer ? (compact ? 53 : 61) : (compact ? 39 : 45);
        const ink = t.kind === 'highlighter' && cfg.tool !== 'highlighter' ? '#FDE68A' : cfg.color;
        return <Pressable key={t.kind} testID={`stylus-dial-tool-${t.kind}`} accessibilityRole="button" accessibilityLabel={`${t.label} 선택`} accessibilityState={{ selected: active }}
          onPress={() => onCfg({ tool: t.kind === 'eraser' && cfg.tool === 'vectorEraser' ? 'vectorEraser' : t.kind as ToolConfig['tool'] })}
          style={({ pressed }) => [styles.tool, { left: x - 26, top: y - 38, transform: [{ translateY: active ? -3 : pressed ? 1 : 0 }] }]}>
          {active && <View pointerEvents="none" style={[styles.selectedGlow, { backgroundColor: dark ? 'rgba(126,181,255,.24)' : 'rgba(137,185,250,.22)' }]} />}
          <View pointerEvents="none" style={{ transform: [{ rotate: `${t.angle}deg` }, { scaleX: 1.3 }] }}>
            <ToolArt kind={t.kind} color={ink} size={compact ? .88 : 1.04} />
          </View>
          {active && <View pointerEvents="none" style={[styles.selectedDot, { backgroundColor: dark ? '#A6CCFF' : '#628FC6' }]} />}
        </Pressable>;
      })}
      <View style={{ position: 'absolute', left: (w - sliderWidth) / 2, top: h - 79, width: sliderWidth }}>
        <View testID="stylus-dial-width-slider" accessibilityLabel={`${name} 굵기 조절`}>
          <DragSlider rotation={STYLUS_DIAL_ANGLE} min={range.min} max={range.max} step={range.step} value={Math.max(range.min, Math.min(range.max, cfg.width))} width={sliderWidth} height={30}
            onChange={width => onCfg({ width: Math.round(width * 10) / 10 })} fill={dark ? '#9ABCE8' : '#7B9FCB'} thumb={dark ? '#A6C7F0' : '#789BC8'}
            track={<View style={{ position: 'absolute', left: 11, right: 11, height: 3, borderRadius: 2, backgroundColor: dark ? 'rgba(255,255,255,.15)' : 'rgba(76,104,143,.15)' }} />} />
        </View>
      </View>
      {isEraser ? <Pressable testID="stylus-dial-eraser-mode" accessibilityRole="button" accessibilityLabel={`${cfg.tool === 'eraser' ? '획 지우개' : '영역 지우개'}, 눌러서 종류 변경`}
        onPress={() => onCfg({ tool: cfg.tool === 'eraser' ? 'vectorEraser' : 'eraser' })}
        style={[styles.mode, { left: (w - 140) / 2, top: h - 43, backgroundColor: dark ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.45)' }]}>
        <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>{cfg.tool === 'eraser' ? '획 지우개' : '영역 지우개'}  ⇄</Text>
      </Pressable> : <ScrollView horizontal bounces={false} showsHorizontalScrollIndicator={false}
        style={{ position: 'absolute', left: 15, right: compact ? 15 : 47, top: h - 45, height: 38 }}
        contentContainerStyle={{ gap: 3, flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}>
        {swatches.map((color, i) => {
          const active = color.toLowerCase() === cfg.color.toLowerCase();
          return <Pressable key={`${i}-${color}`} testID={`stylus-dial-color-${color.slice(1)}`} accessibilityRole="button" accessibilityLabel={`색상 ${color}`} accessibilityState={{ selected: active }} onPress={() => onCfg({ color })} style={styles.colorTarget}>
            <View style={[styles.colorRing, { borderColor: active ? (dark ? '#C4DBFA' : '#7494BD') : 'transparent' }]}>
              <View style={[styles.colorDot, { backgroundColor: color }]} />
              {active && <View style={styles.colorSelected} />}
            </View>
          </Pressable>;
        })}
      </ScrollView>}
      {!compact && <Pressable testID="stylus-dial-close" accessibilityRole="button" accessibilityLabel="펜 다이얼 닫기" onPress={onClose} style={[styles.close, { top: h - 45 }]}>
        <Svg width={11} height={11} viewBox="0 0 14 14"><Path d="M3 3L11 11M11 3L3 11" stroke={dark ? '#B3C3D8' : '#8291A5'} strokeWidth={1.5} strokeLinecap="round" /></Svg>
      </Pressable>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 90, elevation: 90 },
  shadow: { position: 'absolute', shadowColor: '#22364F', shadowRadius: 20, shadowOffset: { width: 0, height: 9 }, elevation: 12 },
  glassClip: { overflow: 'hidden', borderWidth: 1 },
  tool: { position: 'absolute', width: 52, height: 76, alignItems: 'center', justifyContent: 'center' },
  selectedGlow: { position: 'absolute', width: 43, height: 48, borderRadius: 24, transform: [{ rotate: '-12deg' }] },
  selectedDot: { position: 'absolute', right: 1, bottom: 1, width: 4, height: 4, borderRadius: 2 },
  colorTarget: { width: 36, height: 38, justifyContent: 'center', alignItems: 'center' },
  colorRing: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  colorDot: { width: 23, height: 23, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,.85)', shadowColor: '#253A56', shadowOpacity: .1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  colorSelected: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF' },
  mode: { position: 'absolute', width: 140, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: 10, width: 32, height: 38, alignItems: 'center', justifyContent: 'center' },
});
