import React, { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { hsvToHex, hexToHsv } from '@/components/ColorPicker';

/**
 * Gradient colour sheet: hue runs left → right, the rows go from pastel (top) through vivid to deep (bottom), and a
 * grey strip on the left runs white → black. Tap or drag anywhere to pick; the ring shows the current colour.
 * Pure gradients (no swatch grid), so it reads as one smooth palette on both platforms.
 */
const ROWS: { s: number; v: number }[] = [{ s: 0.22, v: 1 }, { s: 0.45, v: 1 }, { s: 0.72, v: 1 }, { s: 1, v: 0.96 }, { s: 1, v: 0.74 }, { s: 1, v: 0.5 }];
const GREY_W = 22, GAP = 6, STOPS = 13;
export function GradientPalette({ color, onChange, width, height = 112, pastelOnly = false }: { color: string; onChange: (hex: string) => void; width: number; height?: number; pastelOnly?: boolean }) {
  const rows = pastelOnly ? ROWS.slice(0, 3) : ROWS; const sheetW = Math.max(60, width - GREY_W - GAP); const rowH = height / rows.length;
  const stops = useMemo(() => rows.map((r) => Array.from({ length: STOPS }, (_, i) => hsvToHex((i / (STOPS - 1)) * 359.9, r.s, r.v))), [pastelOnly]);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const last = useRef<string>(color);
  const pick = (x: number, y: number) => {
    const yy = Math.min(height - 0.01, Math.max(0, y));
    let hex: string;
    if (x < GREY_W + GAP / 2) { hex = hsvToHex(0, 0, 1 - yy / height); setDrag({ x: GREY_W / 2, y: yy }); }
    else {
      const xx = Math.min(sheetW - 0.01, Math.max(0, x - GREY_W - GAP)); const h = (xx / sheetW) * 359.9;
      // interpolate saturation / value between the row centres so dragging vertically is smooth
      const pos = Math.min(rows.length - 1, Math.max(0, yy / rowH - 0.5)); const i = Math.floor(pos), t = pos - i; const a = rows[i], b = rows[Math.min(rows.length - 1, i + 1)];
      hex = hsvToHex(h, a.s + (b.s - a.s) * t, a.v + (b.v - a.v) * t); setDrag({ x: GREY_W + GAP + xx, y: yy });
    }
    if (hex.toUpperCase() !== last.current.toUpperCase()) { last.current = hex; onChange(hex); }
  };
  const gesture = useMemo(() => Gesture.Simultaneous(
    Gesture.Tap().runOnJS(true).onEnd((e) => pick(e.x, e.y)),
    Gesture.Pan().runOnJS(true).minDistance(1).onBegin((e) => pick(e.x, e.y)).onUpdate((e) => pick(e.x, e.y)).onFinalize(() => setDrag(null)),
  ), [sheetW, height, pastelOnly]);
  // marker for the current colour (only when the user is not dragging): hue → x, closest row by saturation / value
  const marker = useMemo(() => {
    if (drag) return drag; const hsv = hexToHsv(color);
    if (hsv.s < 0.08) return { x: GREY_W / 2, y: (1 - hsv.v) * height };
    let best = 0, bd = Infinity; rows.forEach((r, i) => { const d = Math.abs(r.s - hsv.s) * 1.2 + Math.abs(r.v - hsv.v); if (d < bd) { bd = d; best = i; } });
    return { x: GREY_W + GAP + (hsv.h / 360) * sheetW, y: (best + 0.5) * rowH };
  }, [color, drag, sheetW, height, pastelOnly]);
  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height, flexDirection: 'row', gap: GAP }} collapsable={false}>
        <LinearGradient colors={['#FFFFFF', '#000000']} style={{ width: GREY_W, height, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }} />
        <View style={{ width: sheetW, height, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }}>
          {stops.map((row, i) => <LinearGradient key={i} colors={row as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: rowH }} />)}
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: marker.x - 11, top: marker.y - 11, width: 22, height: 22, borderRadius: 11, borderWidth: 3, borderColor: '#fff', backgroundColor: color, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 }} />
      </View>
    </GestureDetector>
  );
}
