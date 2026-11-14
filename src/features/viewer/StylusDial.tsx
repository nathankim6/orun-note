import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
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
const TOOLS: { kind: ToolArtKind; label: string; angle: number }[] = [
  { kind: 'pen', label: '펜', angle: -60 },
  { kind: 'pencil', label: '연필', angle: -20 },
  { kind: 'highlighter', label: '형광펜', angle: 20 },
  { kind: 'eraser', label: '지우개', angle: 60 },
];
const RAD = Math.PI / 180;

/** Small circular non-modal palette. Outside Pencil down dismisses AND writes in the parent. */
export function StylusDial({ cfg, onCfg, onClose, anchor, favorites }: StylusDialProps) {
  const { colors, dark } = useTheme();
  const content = useContentSize(); const insets = useSafeAreaInsets();
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const pos = placeStylusDial(anchor, { ...(measured ?? content), top: insets.top, bottom: insets.bottom });
  const d = pos.width, c = d / 2, compact = d < 236, tiny = d < 220;
  const sliderWidth = tiny ? 100 : compact ? 128 : 144;
  const isEraser = cfg.tool === 'eraser' || cfg.tool === 'vectorEraser';
  const selected = isEraser ? 'eraser' : cfg.tool;
  const name = TOOLS.find(t => t.kind === selected)?.label ?? '펜 도구';
  const swatches = dialColors(cfg.color, favorites, tiny ? 3 : compact ? 4 : 5);
  const range = dialWidthRange(cfg.tool);
  const edge = dark ? 'rgba(255,255,255,0.12)' : 'rgba(31,49,84,0.10)';
  return (
    <View pointerEvents="box-none" style={styles.overlay} onLayout={e => {
      const { width, height } = e.nativeEvent.layout;
      setMeasured(old => old?.width === width && old?.height === height ? old : { width, height });
    }}>
      <View testID="stylus-dial" onStartShouldSetResponder={() => true} accessibilityLabel="원형 펜 빠른 도구 다이얼" style={[styles.panel, pos, { borderRadius: c, backgroundColor: colors.surface, borderColor: edge }]}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 12, top: 12, width: d - 24, height: d - 24, borderRadius: c, borderWidth: 1, borderColor: edge, backgroundColor: dark ? '#24262C' : '#FAFBFE' }} />
        {TOOLS.map(t => {
          const active = selected === t.kind, r = c - (compact ? 32 : 41);
          const x = c + r * Math.sin(t.angle * RAD), y = c - r * Math.cos(t.angle * RAD);
          const ink = t.kind === 'highlighter' && cfg.tool !== 'highlighter' ? '#FACC15' : cfg.color;
          return <Pressable key={t.kind} testID={`stylus-dial-tool-${t.kind}`} accessibilityRole="button" accessibilityLabel={`${t.label} 선택`} accessibilityState={{ selected: active }}
            onPress={() => onCfg({ tool: t.kind === 'eraser' && cfg.tool === 'vectorEraser' ? 'vectorEraser' : t.kind as ToolConfig['tool'] })}
            style={({ pressed }) => [styles.tool, { left: x - 22, top: y - (compact ? 22 : 30), height: compact ? 44 : 60, transform: [{ rotate: `${t.angle}deg` }] }, pressed && { opacity: 0.65 }]}>
            <View style={[styles.artWell, { height: compact ? 44 : 58, backgroundColor: active ? colors.primarySoft : 'transparent', borderColor: active ? colors.primary : 'transparent' }]}>
              <ToolArt kind={t.kind} color={ink} size={compact ? 0.54 : 0.72} />
            </View>
          </Pressable>;
        })}
        {!tiny && <Pressable testID="stylus-dial-close" accessibilityRole="button" accessibilityLabel={`${name} 선택됨. 펜 다이얼 닫기`} onPress={onClose}
          style={({ pressed }) => [styles.hub, { left: c - 50, top: compact ? c - 42 : c - 49, height: compact ? 28 : 36, backgroundColor: pressed ? colors.primarySoft : colors.surface, borderColor: edge }]}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text }}>{name}</Text>
          <Svg width={10} height={10} viewBox="0 0 14 14"><Path d="M3 3L11 11M11 3L3 11" stroke={colors.textMuted} strokeWidth={1.6} strokeLinecap="round" /></Svg>
        </Pressable>}
        <View style={{ position: 'absolute', left: c - sliderWidth / 2, top: tiny ? c - 14 : c - 12, width: sliderWidth }}>
          <View pointerEvents="none" style={[styles.widthLabel, compact && { height: 12 }]}><Text style={{ color: colors.textMuted, fontSize: 9 }}>굵기</Text><Text testID="stylus-dial-current-width" style={{ color: colors.text, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{Number(cfg.width.toFixed(1))}</Text></View>
          <View testID="stylus-dial-width-slider" accessibilityLabel={`${name} 굵기 조절`}>
            <DragSlider min={range.min} max={range.max} step={range.step} value={Math.max(range.min, Math.min(range.max, cfg.width))} width={sliderWidth} height={compact ? 30 : 36}
              onChange={width => onCfg({ width: Math.round(width * 10) / 10 })} fill={colors.primary} thumb={colors.primary} track={<View style={{ position: 'absolute', left: 11, right: 11, height: 4, borderRadius: 2, backgroundColor: edge }} />} />
          </View>
        </View>
        {isEraser ? <Pressable testID="stylus-dial-eraser-mode" accessibilityRole="button" accessibilityLabel={`${cfg.tool === 'eraser' ? '획 지우개' : '영역 지우개'}, 눌러서 종류 변경`} onPress={() => onCfg({ tool: cfg.tool === 'eraser' ? 'vectorEraser' : 'eraser' })}
          style={({ pressed }) => [styles.mode, { left: c - 50, top: d - 65, backgroundColor: colors.primarySoft, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '700' }}>{cfg.tool === 'eraser' ? '획 지우개' : '영역 지우개'}  ⇄</Text>
        </Pressable> : swatches.map((color, i) => {
          const start = tiny ? 60 : 40, span = tiny ? 60 : 100;
          const angle = (start + i * span / (swatches.length - 1)) * RAD, r = c - 34;
          const x = c + r * Math.cos(angle), y = c + r * Math.sin(angle);
          const active = color.toLowerCase() === cfg.color.toLowerCase();
          return <Pressable key={color} testID={`stylus-dial-color-${color.slice(1)}`} accessibilityRole="button" accessibilityLabel={`색상 ${color}`} accessibilityState={{ selected: active }} onPress={() => onCfg({ color })} style={[styles.colorTarget, { left: x - 18, top: y - 18 }]}>
            <View style={[styles.colorRing, { borderColor: active ? colors.primary : 'transparent' }]}><View style={[styles.colorDot, { backgroundColor: color, borderColor: color.toLowerCase() === '#ffffff' ? '#C7CDD6' : 'rgba(0,0,0,0.08)' }]} />{active && <View style={[styles.colorSelected, { backgroundColor: colors.surface }]} />}</View>
          </Pressable>;
        })}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 90, elevation: 90 },
  panel: { position: 'absolute', borderWidth: 1, overflow: 'hidden', shadowColor: '#10234D', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 7 }, elevation: 16 },
  tool: { position: 'absolute', width: 44, height: 60, alignItems: 'center', justifyContent: 'center' },
  artWell: { height: 58, width: 38, borderRadius: 18, paddingTop: 4, alignItems: 'center', overflow: 'hidden', borderWidth: 1.5 },
  hub: { position: 'absolute', width: 100, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  widthLabel: { height: 16, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  colorTarget: { position: 'absolute', width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  colorRing: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 },
  colorSelected: { position: 'absolute', width: 4, height: 4, borderRadius: 2 },
  mode: { position: 'absolute', width: 100, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
