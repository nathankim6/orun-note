import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Platform } from 'react-native';
import { useTheme } from '@/theme';
import { useDocsStore } from '@/store/docs';
import { useSession } from '@/store/session';
import { Toast, T } from '@/components/ui';
import { useContentProtection } from '@/lib/security';
import { captureProtectionRequired } from '@/lib/capturePolicy';
import { Logo } from '@/components/Logo';
import { UpdateGate } from '@/components/UpdateGate';
import { supabase } from '@/lib/supabase';
import { GlassBackground } from '@/components/Glass';
import { reportError, flushNativeCrashes } from '@/lib/diag';

const ErrorUtilsAny = (globalThis as any).ErrorUtils;
if (ErrorUtilsAny && !(globalThis as any).__paperlyErrorHandlerInstalled) {
  (globalThis as any).__paperlyErrorHandlerInstalled = true;
  const prev = ErrorUtilsAny.getGlobalHandler?.();
  ErrorUtilsAny.setGlobalHandler((err: any, isFatal?: boolean) => {
    try { useDocsStore.getState().showToast('오류: ' + (err?.message ?? String(err)).slice(0, 140)); } catch {}
    reportError('js', err, isFatal ? 'fatal' : '');
    if (!isFatal && prev) prev(err, isFatal);
    console.error('Unhandled JS error', err);
  });
}

// Web/desktop: the browser's rectangular focus ring sits inside our rounded inputs and looks broken; inputs show focus via their own border.
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('orun-web-css')) {
  const st = document.createElement('style'); st.id = 'orun-web-css';
  st.textContent = 'input:focus,textarea:focus{outline:none!important}html,body{overscroll-behavior:none}';
  document.head.appendChild(st);
}

export default function RootLayout() {
  const { colors, dark } = useTheme(); const toast = useDocsStore((s) => s.toast); const showToast = useDocsStore((s) => s.showToast);
  const { role, hydrated, refreshMe } = useSession(); const segments = useSegments(); const router = useRouter();
  const captureProtected = captureProtectionRequired(role, hydrated);
  const { hidden, attempts, protectionPending } = useContentProtection(captureProtected);
  useEffect(() => { if (captureProtected && attempts > 0) showToast('보안 정책에 따라 화면 캡처가 차단되었어요'); }, [captureProtected, attempts]);
  useEffect(() => { if (hydrated) flushNativeCrashes(); }, [hydrated]);
  useEffect(() => { if (!hydrated) return; refreshMe(); const { data } = supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED' || ev === 'SIGNED_OUT') refreshMe(); }); return () => data.subscription.unsubscribe(); }, [hydrated]);
  useEffect(() => { if (!hydrated) return; const inAuth = segments[0] === '(auth)'; const inCallback = segments[0] === 'auth'; if (inCallback) return; if (!role && !inAuth) router.replace('/(auth)/code'); else if (role && inAuth) router.replace('/(tabs)'); }, [hydrated, role, segments[0]]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <GlassBackground>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="viewer/[docId]" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="review-videos" options={{ animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: '#F6F6FB' } }} />
            <Stack.Screen name="auth/callback" />
          </Stack>
          <Toast message={toast} />
          <UpdateGate />
          {(hidden || protectionPending) && <View style={{ position: 'absolute', inset: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}><Logo size={48} /><T variant="caption" color={colors.textMuted} style={{ marginTop: 12 }}>콘텐츠 보호를 위해 화면을 가렸어요</T></View>}
        </GlassBackground>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
