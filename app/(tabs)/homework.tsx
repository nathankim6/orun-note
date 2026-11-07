import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, Pressable } from 'react-native';
import { useTheme } from '@/theme';
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
  if (session === undefined) return <GlassBackground><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /><Text style={{ marginTop: 8, color: colors.textMuted, fontSize: 12 }}>홈워크에 연결하는 중…</Text></View></GlassBackground>;
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {err && <Pressable onPress={load} style={{ padding: 8, backgroundColor: '#FEF3C7' }}><Text style={{ fontSize: 12, color: '#92400E' }}>학생 정보 확인 실패: {err} · 눌러서 다시 시도 (홈워크는 직접 로그인할 수 있어요)</Text></Pressable>}
      <HomeworkView session={session} />
    </View>
  );
}
