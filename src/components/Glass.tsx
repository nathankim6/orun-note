import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { ios } from '@/theme';

/** Screen canvas: iOS grouped background (#F2F2F7). (Name kept from the old glass theme.) */
export function GlassBackground({ children }: { children?: React.ReactNode }) {
  return <View style={{ flex: 1, backgroundColor: ios.groupedBg }}>{children}</View>;
}
/** Clean white rounded panel with a soft shadow. (Name/props kept from the old frosted-glass panel.) */
export function Glass({ children, style, radius = 16, padded, border = false }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; intensity?: number; radius?: number; padded?: boolean; border?: boolean }) {
  return (
    <View style={[{ borderRadius: radius, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 3 }, border && { borderWidth: 1, borderColor: ios.separator }, style]}>
      <View style={{ padding: padded ? 20 : 0, borderRadius: radius, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}
