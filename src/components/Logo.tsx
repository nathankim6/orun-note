import React from 'react';
import { View, Text, Image } from 'react-native';
import { useTheme } from '@/theme';
export function Logo({ size = 32, withText = true }: { size?: number; withText?: boolean; color?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.3 }}>
      <Image source={require('../../assets/icon.png')} style={{ width: size, height: size, borderRadius: size * 0.22 }} />
      {withText && <Text style={{ fontSize: size * 0.62, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>옳은Note</Text>}
    </View>
  );
}
