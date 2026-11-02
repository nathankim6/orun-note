import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, Pressable, TextInput, LayoutChangeEvent } from 'react-native';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '@/theme';

export const PRESET_COLORS = [
  '#172033', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#FFFFFF',
  '#DC2626', '#EA580C', '#F59E0B', '#EAB308', '#84CC16', '#22C55E',
  '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9', '#2F6FED', '#4F46E5',
  '#7C3AED', '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#B45309',
  '#FCA5A5', '#FDBA74', '#FDE68A', '#D9F99D', '#A7F3D0', '#99F6E4',
  '#BAE6FD', '#C7D2FE', '#E9D5FF', '#FBCFE8', '#92400E', '#1E3A8A',
];
export function hsvToHex(h: number, s: number, v: number) { const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0'); return `#${to(r)}${to(g)}${to(b)}`.toUpperCase(); }
export function hexToHsv(hex: string) { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return { h: 0, s: 0, v: 0 }; const n = parseInt(m[1], 16); const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; let h = 0; if (d) { h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); if (h < 0) h += 360; } return { h, s: max ? d / max : 0, v: max }; }

/** Preset swatches + HSV pad with hue slider + hex input. Emits on every change. */
export function ColorPicker({ value, onChange, recent = [], compact, row }: { value: string; onChange: (hex: string) => void; recent?: string[]; compact?: boolean; row?: boolean }) {
  const { colors } = useTheme();
  const [hsv, setHsv] = useState(() => hexToHsv(value)); const [hex, setHex] = useState(value.toUpperCase()); const [pad, setPad] = useState({ w: 1, h: 1 });
  useEffect(() => { if (value.toUpperCase() !== hex) { setHex(value.toUpperCase()); setHsv(hexToHsv(value)); } }, [value]);
  const emit = (n: { h: number; s: number; v: number }) => { setHsv(n); const hx = hsvToHex(n.h, n.s, n.v); setHex(hx); onChange(hx); };
  const hueHex = useMemo(() => hsvToHex(hsv.h, 1, 1), [hsv.h]);
  const padGesture = useMemo(() => Gesture.Pan().runOnJS(true).minDistance(0).onBegin((e) => emit({ ...hsv, s: Math.min(1, Math.max(0, e.x / pad.w)), v: 1 - Math.min(1, Math.max(0, e.y / pad.h)) })).onUpdate((e) => emit({ ...hsv, s: Math.min(1, Math.max(0, e.x / pad.w)), v: 1 - Math.min(1, Math.max(0, e.y / pad.h)) })), [pad, hsv.h]);
  const sw = compact ? 24 : 28;
  if (row) { // single-row variant for the compact toolbar option bar: scrollable presets + hue slider + hex
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', width: 236 }}>{PRESET_COLORS.map((c) => <Pressable key={c} accessibilityLabel={`색상 ${c}`} onPress={() => { setHsv(hexToHsv(c)); setHex(c); onChange(c); }} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c, borderWidth: hex === c ? 2 : 1, borderColor: hex === c ? colors.primary : 'rgba(0,0,0,0.12)' }} />)}</View>
        <View style={{ width: 120, justifyContent: 'center' }}><View style={{ height: 10, borderRadius: 5, overflow: 'hidden', position: 'absolute', left: 10, right: 10 }}><LinearGradient colors={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} /></View><Slider style={{ height: 30 }} minimumValue={0} maximumValue={360} step={1} value={hsv.h} onValueChange={(h) => emit({ h, s: hsv.s < 0.15 ? 0.85 : hsv.s, v: hsv.v < 0.15 ? 0.9 : hsv.v })} minimumTrackTintColor="transparent" maximumTrackTintColor="transparent" thumbTintColor={hueHex} /></View>
        <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: hex, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }} />
      </View>
    );
  }
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {PRESET_COLORS.map((c) => <Pressable key={c} accessibilityLabel={`색상 ${c}`} onPress={() => { setHsv(hexToHsv(c)); setHex(c); onChange(c); }} style={{ width: sw, height: sw, borderRadius: sw / 2, backgroundColor: c, borderWidth: hex === c ? 3 : 1, borderColor: hex === c ? colors.primary : 'rgba(0,0,0,0.12)' }} />)}
      </View>
      {recent.length > 0 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}><Text style={{ fontSize: 11, color: colors.textMuted, marginRight: 4 }}>최근</Text>{recent.map((c) => <Pressable key={c} onPress={() => { setHsv(hexToHsv(c)); setHex(c); onChange(c); }} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }} />)}</View>}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
        <GestureDetector gesture={padGesture}>
          <View onLayout={(e: LayoutChangeEvent) => setPad({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} style={{ flex: 1, height: compact ? 110 : 140, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }} collapsable={false}>
            <LinearGradient colors={['#FFFFFF', hueHex]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
            <LinearGradient colors={['rgba(0,0,0,0)', '#000000']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: hsv.s * pad.w - 9, top: (1 - hsv.v) * pad.h - 9, width: 18, height: 18, borderRadius: 9, borderWidth: 2.5, borderColor: '#fff', backgroundColor: hex, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }} />
          </View>
        </GestureDetector>
        <View style={{ width: 54, alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hex, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }} />
          <TextInput value={hex} onChangeText={(t) => { const v = t.toUpperCase().replace(/[^#0-9A-F]/g, '').slice(0, 7); setHex(v.startsWith('#') ? v : '#' + v); if (/^#[0-9A-F]{6}$/.test(v.startsWith('#') ? v : '#' + v)) { const vv = v.startsWith('#') ? v : '#' + v; setHsv(hexToHsv(vv)); onChange(vv); } }} autoCapitalize="characters" style={{ fontSize: 11, fontWeight: '700', color: colors.text, textAlign: 'center', width: 60, paddingVertical: 4 }} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <View style={{ flex: 1, height: 14, borderRadius: 7, overflow: 'hidden', position: 'absolute', left: 14, right: 14 }}><LinearGradient colors={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} /></View>
        <Slider style={{ flex: 1, height: 36 }} minimumValue={0} maximumValue={360} step={1} value={hsv.h} onValueChange={(h) => emit({ ...hsv, h })} minimumTrackTintColor="transparent" maximumTrackTintColor="transparent" thumbTintColor={hueHex} />
      </View>
    </View>
  );
}
