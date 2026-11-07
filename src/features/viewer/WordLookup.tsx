import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { createAudioPlayer } from 'expo-audio';
import { useTheme } from '@/theme';
import { DOCS_FN, SUPABASE_ANON_KEY } from '@/lib/config';

type Dict = { q: string; headword: string; isWord: boolean; phonetic: { text: string; us: string; uk: string; audioUs: string; audioUk: string }; korean: { main: string; byPos: { pos: string; terms: string[] }[] }; meanings: { pos: string; posKo: string; defs: { def: string; ex?: string }[]; synonyms: string[] }[] };
const memo = new Map<string, Dict>();
async function fetchDict(q0: string): Promise<Dict> {
  const q = q0.normalize('NFKC').replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, ''); const k = q.toLowerCase(); if (memo.has(k)) return memo.get(k)!;
  const r = await fetch(DOCS_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, body: JSON.stringify({ action: 'dict', q }) });
  const j = await r.json(); if (!j.ok) throw new Error(j.error ?? '찾을 수 없어요'); memo.set(k, j); return j;
}
let player: any = null;
/** Recording of exactly this word through the server relay (fresh Naver link, dictionaryapi.dev as backup). */
const audioUrl = (word: string, accent: 'us' | 'uk') => `${DOCS_FN}?audio=1&accent=${accent}&q=${encodeURIComponent(word.normalize('NFKC'))}`;
/** Plays the recording; if it can't start within ~1.6 s (no recording, network, expired link) the device voice reads the word. */
async function play(url: string, fallbackText: string, accent: 'us' | 'uk') {
  const tts = () => { try { Speech.stop(); Speech.speak(fallbackText, { language: accent === 'uk' ? 'en-GB' : 'en-US', rate: 0.9 }); } catch {} };
  if (!url) return tts();
  if (Platform.OS === 'web') {
    try { const a = new (window as any).Audio(url); let started = false; a.onplaying = () => { started = true; }; a.onerror = () => { if (!started) tts(); }; await a.play(); } catch { tts(); }
    return;
  }
  try { player?.remove?.(); } catch {}
  try {
    const p = createAudioPlayer({ uri: url }); player = p; p.play();
    setTimeout(() => { try { const st: any = (p as any).currentStatus ?? {}; const started = p.playing || (p.currentTime ?? 0) > 0 || st.didJustFinish || (st.currentTime ?? 0) > 0; if (!started) { try { p.pause(); } catch {} tts(); } } catch { tts(); } }, 1600);
  } catch { tts(); }
}

/** Context-menu style dictionary card shown next to a tapped/selected English word or phrase. */
export function WordLookup({ text, anchor, onClose, onHighlight, onLookup }: { text: string; anchor: { x: number; y: number }; onClose: () => void; onHighlight?: () => void; onLookup?: (q: string) => void }) {
  const { colors } = useTheme(); const { width: W, height: H } = useWindowDimensions();
  const [d, setD] = useState<Dict | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD(null); setErr(null); fetchDict(text).then(setD).catch((e) => setErr(e.message)); }, [text]);
  const cardW = Math.min(380, W - 24); const left = Math.max(12, Math.min(W - cardW - 12, anchor.x - cardW / 2)); const below = anchor.y < H * 0.55; const maxH = Math.min(440, below ? H - anchor.y - 30 : anchor.y - 40);
  const pos = below ? { top: anchor.y + 18 } : { bottom: H - anchor.y + 18 };
  const isWord = !/\s/.test(text.trim());
  return (
    <>
      <Pressable style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 80 }} onPress={onClose} />
      <View style={[{ position: 'absolute', left, width: cardW, maxHeight: Math.max(220, maxH), zIndex: 81, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(47,111,237,0.25)', shadowColor: '#1B3B7A', shadowOpacity: 0.22, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 14, overflow: 'hidden' }, pos]}>
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)', backgroundColor: '#F3F7FE' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: isWord ? 22 : 16, fontWeight: '800', color: colors.text, flex: 1 }} numberOfLines={2} selectable>{d?.headword && d.headword !== text.toLowerCase() && isWord ? `${text} → ${d.headword}` : text}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={20} color={colors.textMuted} /></Pressable>
          </View>
          {isWord && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {(['us', 'uk'] as const).map((acc) => { const ipa = acc === 'us' ? (d?.phonetic.us || d?.phonetic.text) : d?.phonetic.uk; const url = acc === 'us' ? d?.phonetic.audioUs : d?.phonetic.audioUk; return (
              <Pressable key={acc} onPress={() => play(audioUrl(isWord ? text.trim() : (d?.headword ?? text), acc), d?.headword ?? text, acc)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: pressed ? colors.primary : '#fff', borderWidth: 1, borderColor: 'rgba(47,111,237,0.3)' })}>
                <Ionicons name="volume-high" size={14} color={colors.primary} /><Text style={{ fontSize: 11, fontWeight: '800', color: colors.primary }}>{acc === 'us' ? '미국' : '영국'}</Text>{!!ipa && <Text style={{ fontSize: 13, color: colors.text }}>{ipa}</Text>}
              </Pressable>); })}
          </View>}
          {!isWord && <Pressable onPress={() => play('', text, 'us')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}><Ionicons name="volume-high" size={14} color={colors.primary} /><Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>읽어주기</Text></Pressable>}
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {!d && !err && <View style={{ alignItems: 'center', padding: 12 }}><ActivityIndicator color={colors.primary} /><Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>사전 찾는 중…</Text></View>}
          {err && <Text style={{ color: colors.danger, fontSize: 13 }}>{err}</Text>}
          {d && <>
            {d.korean.byPos.length > 0 ? d.korean.byPos.map((p, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8 }}>{!!p.pos && <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(245,197,66,0.25)', alignSelf: 'flex-start' }}><Text style={{ fontSize: 11, fontWeight: '800', color: '#8A5A00' }}>{p.pos}</Text></View>}<View style={{ flex: 1 }}>{p.terms.map((t, j) => <Text key={j} style={{ fontSize: 15, color: colors.text, lineHeight: 21 }}>{j + 1}. {t}</Text>)}</View></View>
            )) : !!d.korean.main && <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{d.korean.main}</Text>}
            {d.meanings.length > 0 && <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)', paddingTop: 10, gap: 8 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1 }}>ENGLISH DEFINITION</Text>
              {d.meanings.map((m, i) => (
                <View key={i}><Text style={{ fontSize: 12, fontWeight: '800', color: colors.primary }}>{m.pos} · {m.posKo}</Text>
                  {m.defs.slice(0, 2).map((x, j) => <View key={j} style={{ marginTop: 3 }}><Text style={{ fontSize: 13, color: colors.text, lineHeight: 19 }}>• {x.def}</Text>{!!x.ex && <Text style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginLeft: 10 }}>“{x.ex}”</Text>}</View>)}
                  {m.synonyms.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{m.synonyms.map((sy) => <Pressable key={sy} onPress={() => onLookup?.(sy)} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.05)' }}><Text style={{ fontSize: 11, color: colors.textMuted }}>{sy}</Text></Pressable>)}</View>}
                </View>))}
            </View>}
          </>}
        </ScrollView>
        {onHighlight && <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' }}>
          <Pressable onPress={onHighlight} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 }}><View style={{ width: 14, height: 10, borderRadius: 2, backgroundColor: '#FDE68A' }} /><Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>형광펜 표시</Text></Pressable>
        </View>}
      </View>
    </>
  );
}
