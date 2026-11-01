import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout } from '@/theme';

export default function TabsLayout() {
  const { colors } = useTheme(); const { isTablet } = useLayout();
  const icon = (name: string, focused: string) => ({ color, focused: f }: { color: any; focused: boolean }) => <Ionicons name={(f ? focused : name) as any} size={22} color={color} />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarPosition: isTablet ? 'left' : 'bottom', tabBarVariant: isTablet ? 'material' : 'uikit', tabBarLabelPosition: 'below-icon', tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.textMuted, tabBarActiveBackgroundColor: isTablet ? colors.primarySoft : undefined, tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, borderRightColor: colors.border, borderRightWidth: isTablet ? 1 : 0, ...(isTablet ? { width: 92 } : {}) }, tabBarItemStyle: isTablet ? { borderRadius: 14, marginVertical: 4 } : undefined, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" options={{ title: '내 서재', tabBarIcon: icon('library-outline', 'library') }} />
      <Tabs.Screen name="settings" options={{ title: '설정', tabBarIcon: icon('settings-outline', 'settings') }} />
    </Tabs>
  );
}
