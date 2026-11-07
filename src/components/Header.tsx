import React from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type, ios } from '@/theme';

/** Horizontal content margin: 16 pt on phones, 24 pt on iPad / desktop (matches the large title). */
export const useMargin = () => { const { width } = useWindowDimensions(); return width >= 700 ? 24 : 16; };

/**
 * iOS large-title header: optional "‹ 뒤로", 34 pt bold title (left), subtitle below, bar buttons on the right.
 * `children` render under the title (e.g. a search field).
 */
export function PageHeader({ title, right, back, subtitle, children, contentMaxWidth }: { title: string; right?: React.ReactNode; back?: boolean; subtitle?: string; logo?: boolean; children?: React.ReactNode; /** center the header like the content column below it */ contentMaxWidth?: number }) {
  const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter(); const { width } = useWindowDimensions(); const m = useMargin(); const narrow = width < 560;
  return (
    <View style={{ paddingTop: insets.top + (narrow ? 4 : 12), paddingHorizontal: m, paddingBottom: 8, backgroundColor: colors.bg }}>
      <View style={contentMaxWidth ? { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' } : null}>
      {back && (
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} hitSlop={8} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', marginLeft: -8, height: 40, opacity: pressed ? 0.4 : 1 })}>
          <Ionicons name="chevron-back" size={26} color={ios.blue} /><Text style={[type.body, { fontSize: 17, color: ios.blue }]}>뒤로</Text>
        </Pressable>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.largeTitle, { color: colors.text }, narrow && { fontSize: 30, lineHeight: 36 }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={[type.subhead, { color: colors.textMuted, marginTop: 1 }]}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{right}</View> : null}
      </View>
      {children}
      </View>
    </View>
  );
}
