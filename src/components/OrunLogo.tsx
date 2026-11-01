import React from 'react';
import { Image, View, Text } from 'react-native';
import { useTheme } from '@/theme';
/** ORUN ACADEMY lighthouse mark (from the academy logo) with optional wordmark. */
export function OrunLogo({ size = 40, withText = true, caption }: { size?: number; withText?: boolean; caption?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.3 }}>
      <Image source={require('../../assets/orun-mark.png')} style={{ width: size, height: size, borderRadius: size * 0.24 }} />
      {withText && <View><Text style={{ fontSize: size * 0.5, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>옳은Note</Text><Text style={{ fontSize: size * 0.26, fontWeight: '600', color: colors.textMuted, letterSpacing: 1.5 }}>{caption ?? 'ORUN ACADEMY'}</Text></View>}
    </View>
  );
}
