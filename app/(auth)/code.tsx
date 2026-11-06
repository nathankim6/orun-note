import React, { useEffect, useState } from 'react';
import { View, TextInput, Text, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout } from '@/theme';
import { Button, Muted, Row, T } from '@/components/ui';
import { Glass, GlassBackground } from '@/components/Glass';
import { OrunLogo } from '@/components/OrunLogo';
import { useSession } from '@/store/session';
import { normalizeStudentCode } from '@/utils/codeInput';

/**
 * Entry: Google sign-in. First time, the student also enters the 옳은영어 숙제 student code to bind this Google account.
 * A code already bound to another Google account creates an approval request for the admin.
 */
export default function Gate() {
  const { colors } = useTheme(); const { isTablet } = useLayout();
  const s = useSession();
  const [studentCode, setStudentCode] = useState(''); const [adminCode, setAdminCode] = useState(''); const [adminMode, setAdminMode] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  useEffect(() => { setErr(s.lastError); }, [s.lastError]);
  const google = async () => { setBusy(true); setErr(null); const r = await s.signInGoogle(); setBusy(false); if (!r.ok && r.message) setErr(r.message); };
  const link = async () => { if (busy) return; setBusy(true); setErr(null); const r = await s.linkStudent(studentCode); setBusy(false); if (!r.ok) setErr(r.message ?? '연결 실패'); else if (r.pending) setInfo(r.message ?? '관리자 승인 대기 중'); };
  const admin = async () => { setBusy(true); setErr(null); const r = await s.signInAdminCode(adminCode); setBusy(false); if (!r.ok) setErr(r.message ?? '확인 실패'); };
  const signedIn = !!s.email; const pending = s.pendingMessage ?? info;
  return (
    <GlassBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Glass style={{ width: '100%', maxWidth: isTablet ? 440 : undefined }} padded>
              <View style={{ alignItems: 'center', marginTop: 8 }}>
                <Image source={require('../../assets/icon.png')} style={{ width: 92, height: 92, borderRadius: 24 }} />
                <T variant="h1" style={{ marginTop: 16 }}>옳은Note</T>
                <Muted variant="caption" style={{ letterSpacing: 2, marginTop: 2 }}>ORUN ACADEMY · 옳은영어</Muted>
              </View>
              {!signedIn && !adminMode && <>
                <Muted center style={{ marginTop: 22 }}>옳은영어 숙제 시스템 학생 코드와 Google 계정으로 입장해요. 교재는 이 기기 안에 암호화되어 보관됩니다.</Muted>
                <Pressable onPress={google} disabled={busy} style={({ pressed }) => [{ marginTop: 24, height: 52, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E8F0', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, opacity: pressed || busy ? 0.7 : 1 }]}>
                  {busy ? <ActivityIndicator color={colors.primary} /> : <Image source={{ uri: 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg' }} style={{ width: 20, height: 20 }} />}
                  <Text style={{ fontWeight: '700', fontSize: 16, color: '#1F2937' }}>Google로 계속하기</Text>
                </Pressable>
              </>}
              {signedIn && (s.needsLink || !s.role) && <>
                <View style={{ marginTop: 20, padding: 12, borderRadius: 14, backgroundColor: colors.primarySoft, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Ionicons name="logo-google" size={18} color={colors.primary} /><Text style={{ color: colors.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>{s.email}</Text><Pressable onPress={() => s.signOut()}><Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>다른 계정</Text></Pressable></View>
                {pending ? (
                  <View style={{ marginTop: 18, alignItems: 'center' }}><Ionicons name="hourglass-outline" size={34} color={colors.accent} /><T variant="h3" style={{ marginTop: 8 }}>관리자 승인 대기 중</T><Muted center style={{ marginTop: 6 }}>{pending}</Muted><Button title="다시 확인" variant="secondary" style={{ marginTop: 16 }} onPress={() => s.refreshMe()} /></View>
                ) : (<>
                  <T variant="h3" style={{ marginTop: 22 }}>학생 코드를 연결하세요</T>
                  <Muted style={{ marginTop: 6 }}>숙제 시스템(orunhomework.com)에서 받은 5자리 학생 코드예요. 한 번만 입력하면 이 Google 계정으로 계속 로그인됩니다.</Muted>
                  <View style={{ marginTop: 18, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: err ? colors.danger : '#E3E8F0', paddingHorizontal: 14 }}>
                    <Ionicons name="key-outline" size={20} color={colors.textMuted} />
                    <TextInput value={studentCode} onChangeText={(t) => setStudentCode(normalizeStudentCode(t))} autoCapitalize="characters" autoCorrect={false} autoComplete="off" spellCheck={false} keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : Platform.OS === 'android' ? 'visible-password' : 'default'} placeholder="예) AGMYE" placeholderTextColor={colors.textFaint} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 10, fontSize: 22, letterSpacing: 4, fontWeight: '700', color: colors.text }} onSubmitEditing={link} />
                  </View>
                  <Button title={busy ? '확인 중...' : '연결하고 시작'} onPress={link} loading={busy} disabled={studentCode.length < 3} style={{ marginTop: 14 }} />
                </>)}
              </>}
              {adminMode && !signedIn && <>
                <T variant="h3" style={{ marginTop: 22 }}>관리자 코드</T>
                <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: err ? colors.danger : '#E3E8F0', paddingHorizontal: 14 }}>
                  <Ionicons name="shield-outline" size={20} color={colors.textMuted} />
                  <TextInput value={adminCode} onChangeText={(t) => setAdminCode(t.replace(/\D/g, '').slice(0, 12))} keyboardType="number-pad" secureTextEntry placeholder="관리자 코드" placeholderTextColor={colors.textFaint} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 10, fontSize: 20, letterSpacing: 4, color: colors.text }} onSubmitEditing={admin} autoFocus />
                </View>
                <Button title="관리자로 입장" onPress={admin} loading={busy} disabled={adminCode.length < 4} style={{ marginTop: 14 }} />
              </>}
              {err && <Text style={{ color: colors.danger, marginTop: 12, fontSize: 13, textAlign: 'center' }}>{err}</Text>}
              <Row justify="center" style={{ marginTop: 20 }}>
                {!signedIn && <Pressable onPress={() => { setAdminMode(!adminMode); setErr(null); }}><Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>{adminMode ? '학생 로그인으로' : '관리자이신가요?'}</Text></Pressable>}
              </Row>
            </Glass>
            <Row style={{ marginTop: 18 }} gap={6}><Ionicons name="lock-closed-outline" size={12} color={colors.textFaint} /><Muted variant="caption">교재는 기기 안에서 암호화되어 보관되며 외부로 내보낼 수 없습니다.</Muted></Row>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GlassBackground>
  );
}
