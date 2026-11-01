import React, { useEffect } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { completeFromUrl } from '@/lib/googleAuth';
import { useSession } from '@/store/session';
import { GlassBackground } from '@/components/Glass';
/** Web OAuth return URL. Native uses the in-app auth session instead. */
export default function AuthCallback() {
  const router = useRouter(); const refreshMe = useSession((s) => s.refreshMe);
  useEffect(() => { (async () => { if (Platform.OS === 'web') await completeFromUrl(window.location.href); await refreshMe(); router.replace('/(tabs)'); })(); }, []);
  return <GlassBackground><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View></GlassBackground>;
}
