import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();
/** Google sign-in through Supabase Auth. Native: system auth session + orunnote:// deep link (PKCE). Web: full-page redirect. */
export async function signInWithGoogle(): Promise<{ ok: boolean; message?: string }> {
  const redirectTo = Platform.OS === 'web' ? window.location.origin + '/auth/callback' : Linking.createURL('auth/callback');
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web', queryParams: { prompt: 'select_account' } } });
  if (error) return { ok: false, message: error.message };
  if (Platform.OS === 'web') return { ok: true }; // page navigates away
  if (!data?.url) return { ok: false, message: '로그인 URL을 만들지 못했어요' };
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, { preferEphemeralSession: false });
  if (res.type !== 'success' || !res.url) return { ok: false, message: res.type === 'cancel' || res.type === 'dismiss' ? '로그인이 취소되었어요' : '로그인에 실패했어요' };
  return completeFromUrl(res.url);
}
/** Finish PKCE (code) or implicit (fragment tokens) callback. */
export async function completeFromUrl(url: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const u = new URL(url); const code = u.searchParams.get('code'); const err = u.searchParams.get('error_description') || u.searchParams.get('error');
    if (err) return { ok: false, message: err };
    if (code) { const { error } = await supabase.auth.exchangeCodeForSession(code); return error ? { ok: false, message: error.message } : { ok: true }; }
    const frag = new URLSearchParams(u.hash.replace(/^#/, '')); const at = frag.get('access_token'), rt = frag.get('refresh_token');
    if (at && rt) { const { error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt }); return error ? { ok: false, message: error.message } : { ok: true }; }
    return { ok: false, message: '로그인 응답을 해석하지 못했어요' };
  } catch (e: any) { return { ok: false, message: e?.message ?? '로그인 처리 오류' }; }
}
export async function signOutGoogle() { try { await supabase.auth.signOut(); } catch {} }
