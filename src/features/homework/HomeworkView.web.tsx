import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import type { HwSession } from '@/lib/api';

export const HOMEWORK_URL = 'https://orunhomework.com/';
const isDesktopApp = () => typeof navigator !== 'undefined' && /OrunNoteDesktop/.test(navigator.userAgent);
/** Windows app: the desktop shell opens orunhomework in its own app window and signs the student in from this link. */
const desktopLink = (s: HwSession | null) => HOMEWORK_URL + (s ? '#orunnote-session=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(s))))) : '');

export function HomeworkView({ session }: { session: HwSession | null }) {
  const { colors } = useTheme(); const opened = useRef(false); const [copied, setCopied] = useState(false);
  const desktop = isDesktopApp();
  useEffect(() => { if (desktop && !opened.current) { opened.current = true; window.open(desktopLink(session), '_blank'); } }, [desktop, session?.code]);
  if (desktop) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Ionicons name="school-outline" size={44} color={colors.primary} />
      <Text style={{ marginTop: 12, fontSize: 18, fontWeight: '800', color: colors.text }}>홈워크</Text>
      <Text style={{ marginTop: 6, color: colors.textMuted, textAlign: 'center' }}>{session ? `${session.name} 학생으로 로그인된 홈워크 창을 열었어요.` : '홈워크 창을 열었어요.'}</Text>
      <Pressable onPress={() => window.open(desktopLink(session), '_blank')} style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.primary }}><Ionicons name="open-outline" size={16} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700' }}>홈워크 창 열기</Text></Pressable>
    </View>
  );
  // Plain browser (preview): the site can't be signed in from another origin, so show it inline with the student's code.
  return (
    <View style={{ flex: 1 }}>
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: 'rgba(249,249,249,0.97)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(60,60,67,0.29)' }}>
        <Text style={{ fontWeight: '600', fontSize: 17, color: colors.text }}>홈워크</Text>
        {session && <><Text style={{ color: colors.textMuted, fontSize: 12 }}>학생 코드</Text><Pressable onPress={() => { navigator.clipboard?.writeText(session.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.primarySoft }}><Text style={{ color: colors.primary, fontWeight: '800', letterSpacing: 2 }}>{session.code}{copied ? ' ✓' : ''}</Text></Pressable></>}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => window.open(HOMEWORK_URL, '_blank')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Ionicons name="open-outline" size={15} color={colors.primary} /><Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>새 창</Text></Pressable>
      </View>
      {React.createElement('iframe', { src: HOMEWORK_URL, style: { flex: 1, border: 0, width: '100%', height: '100%', background: '#fff' }, allow: 'microphone; camera; clipboard-write', title: '홈워크' })}
    </View>
  );
}
