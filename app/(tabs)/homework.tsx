import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type, ios } from '@/theme';
import { useSession } from '@/store/session';
import { api, HwSession } from '@/lib/api';
import { HomeworkView } from '@/features/homework/HomeworkView';
import { GlassBackground } from '@/components/Glass';

/** 홈워크: orunhomework.com as an app-in-app, signed in with the student's linked code. */
export default function HomeworkTab() {
  const { colors } = useTheme(); const { role, student, cred } = useSession();
  const [session, setSession] = useState<HwSession | null | undefined>(undefined); const [err, setErr] = useState<string | null>(null);
  const load = () => { setErr(null); api.homeworkSession(cred()).then((r) => setSession(r.session)).catch((e) => { setErr(e?.message ?? '연결 실패'); setSession(null); }); };
  useEffect(() => { load(); }, [role, student?.code]);
  if (session === undefined) return <GlassBackground><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /><Text style={[type.footnote, { marginTop: 10, color: colors.textMuted }]}>홈워크에 연결하는 중…</Text></View></GlassBackground>;
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {err && <Pressable onPress={load} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: pressed ? '#FFF1D6' : '#FFF8E6', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(60,60,67,0.18)' })}><Ionicons name="warning" size={16} color={ios.orange} /><Text style={[type.footnote, { color: colors.text, flex: 1 }]}>학생 정보 확인 실패: {err} · 눌러서 다시 시도 (홈워크는 직접 로그인할 수 있어요)</Text></Pressable>}
      <HomeworkView session={session} />
    </View>
  );
}
