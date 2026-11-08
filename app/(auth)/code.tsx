import * as AppleAuthentication from 'expo-apple-authentication';
import { appleSignInAvailable } from '@/lib/appleAuth';
import React, { useEffect, useState } from 'react';
import { View, TextInput, Text, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator, Image, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout, type, ios } from '@/theme';
import { Button, Row, TextButton } from '@/components/ui';
import { GlassBackground } from '@/components/Glass';
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
  const apple = async () => { setBusy(true); setErr(null); const r = await s.signInApple(); setBusy(false); if (!r.ok && r.message) setErr(r.message); };
  const [appleOk, setAppleOk] = useState(false); useEffect(() => { appleSignInAvailable().then(setAppleOk); }, []);
  const link = async () => { if (busy) return; setBusy(true); setErr(null); const r = await s.linkStudent(studentCode); setBusy(false); if (!r.ok) setErr(r.message ?? '연결 실패'); else if (r.pending) setInfo(r.message ?? '관리자 승인 대기 중'); };
  const admin = async () => { setBusy(true); setErr(null); const r = await s.signInAdminCode(adminCode); setBusy(false); if (!r.ok) setErr(r.message ?? '확인 실패'); };
  const signedIn = !!s.email; const pending = s.pendingMessage ?? info;
  return (
    <GlassBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
            <View style={{ width: '100%', maxWidth: isTablet ? 420 : 400, alignItems: 'stretch' }}>
              <View style={{ alignItems: 'center', marginBottom: 26 }}>
                <View style={styles.iconShadow}><Image source={require('../../assets/icon.png')} style={{ width: 96, height: 96, borderRadius: 22 }} /></View>
                <Text style={[type.largeTitle, { color: colors.text, marginTop: 18 }]}>옳은Note</Text>
                <Text style={[type.subhead, { color: colors.textMuted, marginTop: 4 }]}>ORUN ACADEMY · 옳은영어</Text>
              </View>
              {!signedIn && !adminMode && <>
                <Text style={[type.subhead, { color: colors.textMuted, textAlign: 'center', paddingHorizontal: 8 }]}>옳은영어 숙제 시스템 학생 코드와 Google{appleOk ? ' 또는 Apple' : ''} 계정으로 입장해요. 교재는 이 기기 안에 암호화되어 보관됩니다.</Text>
                <Pressable accessibilityRole="button" onPress={google} disabled={busy} style={({ pressed }) => [styles.google, { opacity: pressed || busy ? 0.6 : 1 }]}>
                  {busy ? <ActivityIndicator color={colors.primary} /> : <Image source={{ uri: 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg' }} style={{ width: 20, height: 20 }} />}
                  <Text style={[type.bodyBold, { fontSize: 17, color: colors.text }]}>Google로 계속하기</Text>
                </Pressable>
                {appleOk && <AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE} buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={12} style={{ height: 52, width: '100%', marginTop: 12 }} onPress={apple} />}
              </>}
              {signedIn && (s.needsLink || !s.role) && <>
                <View style={styles.accountRow}><Ionicons name={s.email && /privaterelay\.appleid\.com$|icloud\.com$/.test(s.email) ? 'logo-apple' : 'logo-google'} size={18} color={ios.blue} /><Text style={[type.body, { color: colors.text, flex: 1 }]} numberOfLines={1}>{s.email}</Text><TextButton title="다른 계정" size={15} onPress={() => s.signOut()} /></View>
                {pending ? (
                  <View style={[styles.card, { alignItems: 'center' }]}><Ionicons name="hourglass-outline" size={34} color={ios.orange} /><Text style={[type.h3, { color: colors.text, marginTop: 8 }]}>관리자 승인 대기 중</Text><Text style={[type.subhead, { color: colors.textMuted, textAlign: 'center', marginTop: 6 }]}>{pending}</Text><Button title="다시 확인" variant="secondary" style={{ marginTop: 16, alignSelf: 'stretch' }} onPress={() => s.refreshMe()} /></View>
                ) : (<View style={styles.card}>
                  <Text style={[type.title3, { color: colors.text }]}>학생 코드를 연결하세요</Text>
                  <Text style={[type.subhead, { color: colors.textMuted, marginTop: 6 }]}>숙제 시스템(orunhomework.com)에서 받은 5자리 학생 코드예요. 한 번만 입력하면 이 Google 계정으로 계속 로그인됩니다.</Text>
                  <View style={[styles.field, err ? { borderColor: ios.red } : null]}>
                    <Ionicons name="key-outline" size={20} color={ios.gray} />
                    <TextInput value={studentCode} onChangeText={(t) => setStudentCode(normalizeStudentCode(t))} autoCapitalize="characters" autoCorrect={false} autoComplete="off" spellCheck={false} keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : Platform.OS === 'android' ? 'visible-password' : 'default'} placeholder="예) AGMYE" placeholderTextColor={ios.gray2} style={[styles.fieldInput, { fontSize: 22, letterSpacing: 4, fontWeight: '600', color: colors.text }]} onSubmitEditing={link} />
                  </View>
                  <Button title={busy ? '확인 중...' : '연결하고 시작'} onPress={link} loading={busy} disabled={studentCode.length < 3} style={{ marginTop: 14 }} />
                </View>)}
              </>}
              {adminMode && !signedIn && <View style={styles.card}>
                <Text style={[type.title3, { color: colors.text }]}>관리자 코드</Text>
                <View style={[styles.field, err ? { borderColor: ios.red } : null]}>
                  <Ionicons name="shield-outline" size={20} color={ios.gray} />
                  <TextInput value={adminCode} onChangeText={(t) => setAdminCode(t.replace(/\D/g, '').slice(0, 12))} keyboardType="number-pad" secureTextEntry placeholder="관리자 코드" placeholderTextColor={ios.gray2} style={[styles.fieldInput, { fontSize: 20, letterSpacing: 4, color: colors.text }]} onSubmitEditing={admin} autoFocus />
                </View>
                <Button title="관리자로 입장" onPress={admin} loading={busy} disabled={adminCode.length < 4} style={{ marginTop: 14 }} />
              </View>}
              {err && <Text style={[type.footnote, { color: ios.red, marginTop: 12, textAlign: 'center' }]}>{err}</Text>}
              {!signedIn && <Row justify="center" style={{ marginTop: 18 }}><TextButton title={adminMode ? '학생 로그인으로' : '관리자이신가요?'} size={15} onPress={() => { setAdminMode(!adminMode); setErr(null); }} /></Row>}
              <Row justify="center" style={{ marginTop: 26 }} gap={6}><Ionicons name="lock-closed" size={12} color={ios.gray} /><Text style={[type.caption, { color: colors.textMuted, textAlign: 'center' }]}>교재는 기기 안에서 암호화되어 보관되며 외부로 내보낼 수 없습니다.</Text></Row>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GlassBackground>
  );
}

const styles = StyleSheet.create({
  iconShadow: { borderRadius: 22, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6, backgroundColor: '#fff' },
  google: { marginTop: 22, height: 52, borderRadius: 12, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, paddingLeft: 14, paddingRight: 6, minHeight: 48, marginBottom: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 20 },
  field: { marginTop: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(118,118,128,0.12)', borderRadius: 12, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: 14 },
  fieldInput: { flex: 1, paddingVertical: 13, paddingHorizontal: 10, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
});
