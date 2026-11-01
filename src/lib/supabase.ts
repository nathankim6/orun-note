import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

// Auth only: data access goes through the Edge Function. Session persisted locally so Google login survives restarts.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: Platform.OS === 'web' ? undefined : AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: Platform.OS === 'web', flowType: 'pkce' },
});
export async function getAccessToken(): Promise<string | null> { const { data } = await supabase.auth.getSession(); return data.session?.access_token ?? null; }
