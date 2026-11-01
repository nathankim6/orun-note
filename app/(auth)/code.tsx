import React, { useState } from 'react';
import { View, TextInput, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useLayout } from '@/theme';
import { Button, Muted, Row, T } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { useSession } from '@/store/session';

export default function CodeGate() {
  const { colors } = useTheme(); const { isTablet } = useLayout(); const { signIn, lastError } = useSession();
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(lastError);
  const submit = async () => { if (busy) return; setBusy(true); setErr(null); const r = await signIn(code); setBusy(false); if (!r.ok) setErr(r.message ?? '확인 실패'); };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: isTablet ? 420 : undefined }}>
            <Logo size={48} />
            <T variant="h1" style={{ marginTop: 22 }}>접속 코드를 입력하세요</T>
            <Muted style={{ marginTop: 8 }}>선생님께 받은 코드로 입장하면 배정된 교재를 받아 필기할 수 있어요.</Muted>
            <View style={{ marginTop: 28, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: err ? colors.danger : colors.border, paddingHorizontal: 14 }}>
              <Ionicons name="key-outline" size={20} color={colors.textMuted} />
              <TextInput value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 12))} keyboardType="number-pad" placeholder="숫자 코드" placeholderTextColor={colors.textFaint} onSubmitEditing={submit} returnKeyType="go" style={{ flex: 1, paddingVertical: 16, paddingHorizontal: 10, fontSize: 24, letterSpacing: 6, fontWeight: '700', color: colors.text }} autoFocus />
            </View>
            {err && <Text style={{ color: colors.danger, marginTop: 8, fontSize: 13 }}>{err}</Text>}
            <Button title={busy ? '확인 중...' : '입장'} onPress={submit} loading={busy} style={{ marginTop: 16 }} disabled={code.length < 4} />
            <Row justify="center" style={{ marginTop: 22 }}><Muted variant="caption">교재는 기기 안에서 암호화되어 보관되며 외부로 내보낼 수 없습니다.</Muted></Row>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
