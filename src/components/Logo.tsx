import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '@/theme';
export function Logo({ size = 32, withText = true, color }: { size?: number; withText?: boolean; color?: string }) {
  const { colors } = useTheme(); const c = color ?? colors.primary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.3 }}>
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Rect x="4" y="4" width="40" height="40" rx="11" fill={c} />
        <Path d="M14 33 L14 15 L24 15 C29 15 32 18 32 22.5 C32 27 29 30 24 30 L18 30" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d="M22 36 L34 24" stroke="#F4C04A" strokeWidth="4" strokeLinecap="round" />
      </Svg>
      {withText && <Text style={{ fontSize: size * 0.62, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>페이퍼리</Text>}
    </View>
  );
}
