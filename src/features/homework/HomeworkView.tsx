import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, BackHandler, Linking, Platform } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
// The package's TS types resolve to an incompatible class signature with this RN version; runtime is fine.
const WebView: any = RNWebView;
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import type { HwSession } from '@/lib/api';

export const HOMEWORK_URL = 'https://orunhomework.com/';
const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(orunhomework\.com|supabase\.co|googleapis\.com|gstatic\.com|jsdelivr\.net|unpkg\.com|kakao\.com|kakaocdn\.net)(\/|$)/i;

/** orunhomework.com inside the app, signed in as the linked student (its login lives in localStorage "homework_auth_session"). */
export function HomeworkView({ session }: { session: HwSession | null }) {
  const { colors } = useTheme(); const ref = useRef<any>(null);
  const [canBack, setCanBack] = useState(false); const [loading, setLoading] = useState(true); const [err, setErr] = useState<string | null>(null); const [key, setKey] = useState(0);
  // Runs before the site's own scripts on every page load: (re)write the login entry for this student only.
  const inject = session
    ? `(function(){try{var want=${JSON.stringify(JSON.stringify(session))};var cur=localStorage.getItem('homework_auth_session');var c=null;try{c=cur?JSON.parse(cur):null}catch(e){}if(!c||c.code!==${JSON.stringify(session.code)}){localStorage.setItem('homework_auth_session',want);}}catch(e){}})();true;`
    : 'true;';
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android') return; const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (canBack) { ref.current?.goBack(); return true; } return false; }); return () => sub.remove();
  }, [canBack]));
  return (
    <View style={{ flex: 1 }}>
      <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4, backgroundColor: 'rgba(255,255,255,0.85)', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' }}>
        <Pressable accessibilityLabel="뒤로" disabled={!canBack} onPress={() => ref.current?.goBack()} style={{ padding: 8, opacity: canBack ? 1 : 0.3 }}><Ionicons name="chevron-back" size={20} color={colors.text} /></Pressable>
        <Pressable accessibilityLabel="새로고침" onPress={() => { setErr(null); ref.current?.reload(); }} style={{ padding: 8 }}><Ionicons name="refresh" size={19} color={colors.text} /></Pressable>
        <Pressable accessibilityLabel="홈워크 처음 화면" onPress={() => { setErr(null); setKey((k) => k + 1); }} style={{ padding: 8 }}><Ionicons name="home-outline" size={19} color={colors.text} /></Pressable>
        <Text numberOfLines={1} style={{ flex: 1, fontWeight: '700', color: colors.text, marginLeft: 4 }}>홈워크{session ? ` · ${session.name}${session.schoolName ? ` (${session.schoolName} ${session.gradeName ?? ''})` : ''}` : ''}</Text>
        {loading && <ActivityIndicator size="small" color={colors.primary} />}
      </View>
      {err ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}><Ionicons name="cloud-offline-outline" size={40} color={colors.textFaint} /><Text style={{ marginTop: 10, color: colors.text, fontWeight: '700' }}>홈워크를 불러오지 못했어요</Text><Text style={{ marginTop: 4, color: colors.textMuted, fontSize: 12 }}>{err}</Text>
          <Pressable onPress={() => { setErr(null); setKey((k) => k + 1); }} style={{ marginTop: 14, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primary }}><Text style={{ color: '#fff', fontWeight: '700' }}>다시 시도</Text></Pressable></View>
      ) : (
        <WebView key={key} ref={ref} source={{ uri: HOMEWORK_URL }} injectedJavaScriptBeforeContentLoaded={inject}
          onLoadStart={() => setLoading(true)} onLoadEnd={() => setLoading(false)} onNavigationStateChange={(n: any) => setCanBack(n.canGoBack)}
          onError={(e: any) => setErr(e.nativeEvent.description || '네트워크를 확인해 주세요')} onHttpError={(e: any) => { if (e.nativeEvent.statusCode >= 500) setErr(`서버 오류 (${e.nativeEvent.statusCode})`); }}
          onShouldStartLoadWithRequest={(r: any) => { if (r.url.startsWith('about:') || r.url.startsWith('blob:') || r.url.startsWith('data:') || ALLOWED.test(r.url)) return true; Linking.openURL(r.url).catch(() => {}); return false; }}
          javaScriptEnabled domStorageEnabled sharedCookiesEnabled thirdPartyCookiesEnabled allowsBackForwardNavigationGestures pullToRefreshEnabled
          allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} mediaCapturePermissionGrantType="grantIfSameHostElsePrompt" allowFileAccess setSupportMultipleWindows={false}
          style={{ flex: 1, backgroundColor: '#fff' }} />
      )}
    </View>
  );
}
