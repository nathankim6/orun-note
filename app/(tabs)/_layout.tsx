import React from 'react';
import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { TabIcon, TabIconName } from '@/components/TabIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout, ios, fontFamily } from '@/theme';
import { useSession } from '@/store/session';

/** iOS tab bar (phones) / iPadOS-style side rail (tablets & desktop): translucent white, hairline edge, blue tint, filled icon when selected. */
export default function TabsLayout() {
  const { isTablet } = useLayout(); const role = useSession((s) => s.role); const insets = useSafeAreaInsets();
  const icon = (name: TabIconName) => ({ focused }: { focused: boolean }) => <TabIcon name={name} focused={focused} size={isTablet ? 32 : 28} />;
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarPosition: isTablet ? 'left' : 'bottom', tabBarVariant: isTablet ? 'material' : 'uikit', tabBarLabelPosition: 'below-icon',
      tabBarActiveTintColor: ios.blue, tabBarInactiveTintColor: '#8E8E93',
      tabBarLabelStyle: { fontSize: isTablet ? 11 : 10, fontWeight: '500', ...(fontFamily ? { fontFamily } : {}) },
      tabBarStyle: isTablet
        ? { width: 96, backgroundColor: 'rgba(249,249,249,0.97)', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(60,60,67,0.29)', borderTopWidth: 0, paddingTop: insets.top + 14 }
        : { backgroundColor: 'rgba(249,249,249,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(60,60,67,0.29)' },
      tabBarItemStyle: isTablet ? { height: 70, marginHorizontal: 4, marginVertical: 4, borderRadius: 14, paddingHorizontal: 0 } : undefined,
      tabBarActiveBackgroundColor: isTablet ? 'rgba(0,122,255,0.10)' : undefined,
      sceneStyle: { backgroundColor: ios.groupedBg },
    } as any}>
      <Tabs.Screen name="index" options={{ title: '내 교재', tabBarIcon: icon('library') }} />
      <Tabs.Screen name="homework" options={{ title: '홈워크', tabBarIcon: icon('homework') }} />
      <Tabs.Screen name="admin" options={{ title: '관리자', tabBarIcon: icon('admin'), href: role === 'admin' ? undefined : null }} />
      <Tabs.Screen name="settings" options={{ title: '설정', tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}
