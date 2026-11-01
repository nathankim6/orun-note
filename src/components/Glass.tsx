import React from 'react';
import { View, StyleSheet, Platform, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { glass, useTheme } from '@/theme';

/** Full-screen soft gradient with blurred color blobs: the canvas every screen sits on. */
export function GlassBackground({ children }: { children?: React.ReactNode }) {
  const { dark } = useTheme();
  if (dark) return <View style={{ flex: 1, backgroundColor: '#121315' }}>{children}</View>;
  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={[...glass.bgGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[styles.blob, { width: 420, height: 420, top: -140, left: -120, backgroundColor: glass.blobA }]} />
      <View pointerEvents="none" style={[styles.blob, { width: 360, height: 360, top: 120, right: -140, backgroundColor: glass.blobB }]} />
      <View pointerEvents="none" style={[styles.blob, { width: 460, height: 460, bottom: -200, left: '20%', backgroundColor: glass.blobC }]} />
      {children}
    </View>
  );
}
/** Frosted panel. Uses native blur on iOS/Android/web where available, translucent fallback elsewhere. */
export function Glass({ children, style, intensity = 40, radius = 22, padded, border = true }: { children?: React.ReactNode; style?: ViewStyle | ViewStyle[]; intensity?: number; radius?: number; padded?: boolean; border?: boolean }) {
  const { dark, colors } = useTheme();
  const inner = <View style={[{ padding: padded ? 16 : 0 }, { flex: Array.isArray(style) ? undefined : (style as any)?.flex }]}>{children}</View>;
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden', backgroundColor: dark ? 'rgba(30,32,38,0.8)' : 'rgba(255,255,255,0.55)', borderWidth: border ? 1 : 0, borderColor: dark ? 'rgba(255,255,255,0.08)' : colors.border }, glass.shadow, style]}>
      {Platform.OS !== 'android' && <BlurView intensity={intensity} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />}
      {inner}
    </View>
  );
}
const styles = StyleSheet.create({ blob: { position: 'absolute', borderRadius: 999, opacity: 0.9, ...(Platform.OS === 'web' ? ({ filter: 'blur(60px)' } as any) : {}) } });
