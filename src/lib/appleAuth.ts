import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

/** Sign in with Apple (iPhone / iPad): App Store guideline 4.8 requires it next to Google sign-in. Native flow:
 *  Apple returns an identity token for this app's bundle ID, Supabase Auth verifies it (nonce-bound) and opens a session. */
export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try { return await AppleAuthentication.isAvailableAsync(); } catch { return false; }
}
export async function signInWithApple(): Promise<{ ok: boolean; message?: string }> {
  try {
    const raw = Crypto.randomUUID() + Crypto.randomUUID();
    const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
    const cred = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce: hashed });
    if (!cred.identityToken) return { ok: false, message: 'Apple 로그인 정보를 받지 못했어요' };
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: cred.identityToken, nonce: raw });
    return error ? { ok: false, message: error.message } : { ok: true };
  } catch (e: any) {
    if (e?.code === 'ERR_REQUEST_CANCELED' || e?.code === 'ERR_CANCELED') return { ok: false, message: '로그인이 취소되었어요' };
    return { ok: false, message: e?.message ?? 'Apple 로그인 중 오류가 났어요' };
  }
}
