import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { useTheme } from '@/theme';
import { useDocsStore } from '@/store/docs';
import { Toast, T } from '@/components/ui';
import { useContentProtection } from '@/lib/security';
import { Logo } from '@/components/Logo';
import { useEffect } from 'react';

const ErrorUtilsAny = (globalThis as any).ErrorUtils;
if (ErrorUtilsAny && !(globalThis as any).__paperlyErrorHandlerInstalled) {
  (globalThis as any).__paperlyErrorHandlerInstalled = true;
  const prev = ErrorUtilsAny.getGlobalHandler?.();
  ErrorUtilsAny.setGlobalHandler((err: any, isFatal?: boolean) => {
    try { useDocsStore.getState().showToast('오류: ' + (err?.message ?? String(err)).slice(0, 140)); } catch {}
    if (!isFatal && prev) prev(err, isFatal); // non-fatal: keep default logging; fatal: swallow instead of killing the app
    console.error('Unhandled JS error', err);
  });
}

export default function RootLayout() {
  const { colors, dark } = useTheme(); const toast = useDocsStore((s) => s.toast); const { hidden, attempts } = useContentProtection(); const showToast = useDocsStore((s) => s.showToast);
  useEffect(() => { if (attempts > 0) showToast('보안 정책에 따라 화면 캡처가 차단되었어요'); }, [attempts]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="viewer/[docId]" options={{ animation: 'fade', gestureEnabled: false }} />
          </Stack>
          <Toast message={toast} />
          {hidden && <View style={{ position: 'absolute', inset: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}><Logo size={48} /><T variant="caption" color={colors.textMuted} style={{ marginTop: 12 }}>콘텐츠 보호를 위해 화면을 가렸어요</T></View>}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
