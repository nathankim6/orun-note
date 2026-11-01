import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout } from '@/theme';
import { useSession } from '@/store/session';

export default function TabsLayout() {
  const { colors } = useTheme(); const { isTablet } = useLayout(); const role = useSession((s) => s.role);
  const icon = (name: string, focused: string) => ({ color, focused: f }: { color: any; focused: boolean }) => <Ionicons name={(f ? focused : name) as any} size={22} color={color} />;
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarPosition: isTablet ? 'left' : 'bottom', tabBarVariant: isTablet ? 'material' : 'uikit', tabBarLabelPosition: 'below-icon',
      tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: { backgroundColor: 'rgba(255,255,255,0.72)', borderTopWidth: 0, borderRightWidth: 0, ...(isTablet ? { width: 96 } : {}) },
      sceneStyle: { backgroundColor: colors.bg },
    } as any}>
      <Tabs.Screen name="index" options={{ title: '내 교재', tabBarIcon: icon('library-outline', 'library') }} />
      <Tabs.Screen name="admin" options={{ title: '관리자', tabBarIcon: icon('shield-outline', 'shield'), href: role === 'admin' ? undefined : null }} />
      <Tabs.Screen name="settings" options={{ title: '설정', tabBarIcon: icon('settings-outline', 'settings') }} />
    </Tabs>
  );
}
