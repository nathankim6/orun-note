import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { OrunMark } from './OrunMark';
import { PdfRenderer } from '../../modules/pdf-renderer';
import { fetchPublishedUpdate } from '@/lib/appUpdates';
import { PublishedUpdate, UpdateChannel, requiresUpdate, updateChannel, validateUpdate } from '@/lib/updatePolicy';

export function UpdateRequiredScreen({ current, release, channel, checking, opening, error, onUpdate, onRetry }: {
  current: string; release: PublishedUpdate; channel: UpdateChannel; checking: boolean; opening: boolean; error: string;
  onUpdate: () => void; onRetry: () => void;
}) {
  const label = channel === 'ios' ? 'App Store에서 업데이트' : channel === 'android-play' ? 'Google Play에서 업데이트' : '새 버전 설치 파일 받기';
  return <ScrollView style={styles.backdrop} contentContainerStyle={styles.content} bounces={false}>
    <View style={styles.card}>
      <View style={styles.logo}><OrunMark height={66} /></View>
      <Text style={styles.badge}>필수 업데이트</Text>
      <Text accessibilityRole="header" style={styles.title}>업데이트가 필요합니다</Text>
      <Text style={styles.detail}>더 안정적인 필기와 최신 기능을 위해{ '\n' }새 버전으로 업데이트해 주세요.</Text>
      <View style={styles.versions}><Text style={styles.versionText}>현재 {current}</Text><Text style={styles.arrow}>→</Text><Text style={styles.latest}>최신 {release.version}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={opening} onPress={onUpdate} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.82 }, opening && { opacity: 0.65 }]}>
        {opening ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="업데이트 상태 다시 확인" disabled={checking} onPress={onRetry} style={styles.retry}>
        {checking ? <ActivityIndicator size="small" color="#4F46E5" /> : <Text style={styles.retryText}>업데이트 상태 다시 확인</Text>}
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Text style={styles.hint}>업데이트 전에는 앱을 사용할 수 없습니다.{ '\n' }교재와 필기를 유지하려면 앱을 삭제하지 말고{ '\n' }기존 앱 위에 업데이트해 주세요.</Text>
    </View>
  </ScrollView>;
}

/** Launch/resume gate: only a verified, actually published newer version locks the reader. */
export function UpdateGate() {
  const current = Constants.expoConfig?.version ?? '';
  const [channel, setChannel] = useState<UpdateChannel | null>(null);
  const [release, setRelease] = useState<PublishedUpdate | null>(null);
  const [checking, setChecking] = useState(false), [opening, setOpening] = useState(false), [error, setError] = useState('');
  const checkRef = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true, resolvedChannel: UpdateChannel | null = null, pending = false, lastCheck = 0;
    const check = async (force = false) => {
      if (!alive || !resolvedChannel || pending || (!force && Date.now() - lastCheck < 15_000)) return;
      pending = true; lastCheck = Date.now(); setChecking(true);
      const key = 'orun:update-policy:' + resolvedChannel;
      try {
        const next = await fetchPublishedUpdate(resolvedChannel);
        if (!alive) return;
        setRelease(next); setError('');
        // null is an explicit policy withdrawal; a network failure must never erase a known required update.
        if (next) await AsyncStorage.setItem(key, JSON.stringify(next)); else await AsyncStorage.removeItem(key);
      } catch {
        // No known newer release: keep offline access working. A cached required release still stays required.
        if (alive) setError('업데이트 정보를 확인하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      } finally { pending = false; if (alive) setChecking(false); }
    };
    checkRef.current = () => { void check(true); };
    void (async () => {
      const installer = Platform.OS === 'android' ? await PdfRenderer.getInstallSource() : null;
      const ua = Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator.userAgent : '';
      resolvedChannel = updateChannel(Platform.OS, ua, installer);
      if (!alive || !resolvedChannel || !current) return;
      setChannel(resolvedChannel);
      try {
        const raw = await AsyncStorage.getItem('orun:update-policy:' + resolvedChannel);
        const saved = raw ? validateUpdate(resolvedChannel, JSON.parse(raw)) : null;
        if (alive && saved) setRelease(saved);
      } catch { /* bad/missing cache is not grounds to lock the app */ }
      await check();
    })();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void check(); });
    return () => { alive = false; checkRef.current = () => {}; sub.remove(); };
  }, [current]);
  const blocked = !!channel && requiresUpdate(current, release);
  const open = async () => {
    if (!channel || !release || opening) return;
    // Revalidate before opening even persisted policy links. System install confirmation remains mandatory.
    const safe = validateUpdate(channel, release); if (!safe) return;
    setOpening(true); setError('');
    try { await Linking.openURL(safe.url); }
    catch { setError('업데이트 화면을 열지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.'); }
    finally { setOpening(false); }
  };
  return <Modal visible={blocked} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
    {channel && release ? <UpdateRequiredScreen current={current} release={release} channel={channel} checking={checking} opening={opening} error={error} onUpdate={open} onRetry={() => checkRef.current()} /> : null}
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#EEF2F8' },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 22 },
  card: { width: '100%', maxWidth: 430, borderRadius: 28, backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 30, alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0', shadowColor: '#172033', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.08, shadowRadius: 24, elevation: 5 },
  logo: { height: 82, justifyContent: 'center', marginBottom: 12 }, badge: { color: '#4F46E5', fontSize: 12, fontWeight: '800', backgroundColor: '#EEF2FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, overflow: 'hidden', marginBottom: 16 },
  title: { fontSize: 23, fontWeight: '800', color: '#172033', letterSpacing: -0.8, textAlign: 'center' }, detail: { fontSize: 14, lineHeight: 22, textAlign: 'center', color: '#64748B', marginTop: 12 },
  versions: { flexDirection: 'row', gap: 12, alignItems: 'center', marginVertical: 24 }, versionText: { fontSize: 13, color: '#64748B', fontWeight: '600' }, arrow: { fontSize: 17, color: '#94A3B8' }, latest: { fontSize: 13, color: '#4338CA', fontWeight: '800' },
  primary: { width: '100%', minHeight: 52, backgroundColor: '#4F46E5', borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }, primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  retry: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginTop: 5, paddingHorizontal: 12 }, retryText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  error: { fontSize: 12, lineHeight: 18, color: '#B45309', textAlign: 'center', marginTop: 8 }, hint: { fontSize: 11, lineHeight: 18, textAlign: 'center', color: '#94A3B8', marginTop: 14 },
});
