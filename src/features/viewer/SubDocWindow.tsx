import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { useDocsStore } from '@/store/docs';
import { resolveUri } from '@/lib/files';
import { PdfPage } from './PdfPage';
import { ZoomView } from './ZoomView';
import { IconButton, Muted, T } from '@/components/ui';
import { Doc } from '@/data/types';

/**
 * 서브교재: a floating, always-on-top reference window (another document or the same one) that stays put while the
 * main page scrolls. Drag by the title bar, resize from the corner, turn pages with the arrows, pinch to zoom inside.
 */
export function SubDocWindow({ mode, docId, excludeId, onPick, onClose }: { mode: 'pick' | 'show'; docId: string | null; excludeId: string; onPick: (id: string) => void; onClose: () => void }) {
  const { colors } = useTheme(); const { width: winW, height: winH } = useWindowDimensions(); const docs = useDocsStore((s) => s.docs);
  const doc = docId ? docs[docId] : null;
  const w = useSharedValue(Math.min(420, winW * 0.42)); const h = useSharedValue(Math.min(520, winH * 0.55)); const x = useSharedValue(winW - Math.min(420, winW * 0.42) - 16); const y = useSharedValue(110);
  const sx = useSharedValue(0); const sy = useSharedValue(0); const sw = useSharedValue(0); const sh = useSharedValue(0);
  const [size, setSize] = useState({ w: w.value, h: h.value }); const [page, setPage] = useState(0); const [uri, setUri] = useState<string | null>(null);
  useEffect(() => { if (!doc) return; setPage(doc.lastPage ?? 0); resolveUri(doc).then(setUri); }, [doc?.id]);
  const drag = useMemo(() => Gesture.Pan().onStart(() => { sx.value = x.value; sy.value = y.value; }).onUpdate((e) => { x.value = Math.max(0, Math.min(winW - 120, sx.value + e.translationX)); y.value = Math.max(0, Math.min(winH - 80, sy.value + e.translationY)); }), [winW, winH]);
  const resize = useMemo(() => Gesture.Pan().onStart(() => { sw.value = w.value; sh.value = h.value; }).onUpdate((e) => { w.value = Math.max(220, Math.min(winW - x.value, sw.value + e.translationX)); h.value = Math.max(200, Math.min(winH - y.value, sh.value + e.translationY)); }).onEnd(() => {}).runOnJS(true).onFinalize(() => setSize({ w: w.value, h: h.value })), [winW, winH]);
  const style = useAnimatedStyle(() => ({ left: x.value, top: y.value, width: w.value, height: h.value }));
  const pg = doc?.pages[page]; const contentW = size.w - 2; const contentH = size.h - 44 - 2; const scale = pg ? Math.min(contentW / pg.width, contentH / pg.height) : 1;
  return (
    <Animated.View style={[{ position: 'absolute', borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.96)', borderWidth: 1, borderColor: 'rgba(47,111,237,0.35)', shadowColor: '#1B3B7A', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12, zIndex: 50 }, style]}>
      <GestureDetector gesture={drag}>
        <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 6, backgroundColor: 'rgba(47,111,237,0.08)', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' }} collapsable={false}>
          <Ionicons name="albums-outline" size={16} color={colors.primary} />
          <Text numberOfLines={1} style={{ flex: 1, fontWeight: '700', fontSize: 13, color: colors.text }}>{doc ? doc.title : '서브교재 선택'}</Text>
          {doc && <>
            <IconButton icon="swap-horizontal-outline" size={16} onPress={() => onPick('')} label="다른 교재" />
            <IconButton icon="chevron-back" size={16} onPress={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted }}>{page + 1}/{doc.pageCount}</Text>
            <IconButton icon="chevron-forward" size={16} onPress={() => setPage((p) => Math.min(doc.pageCount - 1, p + 1))} disabled={page >= doc.pageCount - 1} />
          </>}
          <IconButton icon="close" size={16} onPress={onClose} />
        </View>
      </GestureDetector>
      {!doc || mode === 'pick' || docId === '' ? (
        <ScrollView contentContainerStyle={{ padding: 10, gap: 6 }}>
          <Muted variant="caption" style={{ marginBottom: 4 }}>옆에 띄워 놓고 볼 교재를 고르세요. 화면을 스크롤해도 이 창은 그대로 있어요.</Muted>
          {Object.values(docs).sort((a, b) => ((b.lastOpenedAt ?? b.createdAt) > (a.lastOpenedAt ?? a.createdAt) ? 1 : -1)).map((d: Doc) => (
            <Pressable key={d.id} onPress={() => onPick(d.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: pressed ? colors.primarySoft : 'rgba(0,0,0,0.03)' })}>
              <View style={{ width: 8, height: 32, borderRadius: 4, backgroundColor: d.coverColor }} /><View style={{ flex: 1 }}><T variant="label" numberOfLines={1}>{d.title}{d.id === excludeId ? ' (현재 문서)' : ''}</T><Muted variant="caption">{d.pageCount}페이지</Muted></View><Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
            </Pressable>))}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, backgroundColor: '#E6EDF7' }}>
          {pg && <ZoomView width={contentW} height={contentH} contentWidth={pg.width * scale} contentHeight={pg.height * scale} maxScale={4}><View style={{ backgroundColor: '#fff' }}><PdfPage uri={uri} index={pg.index} width={pg.width * scale} height={pg.height * scale} template={doc.template} /></View></ZoomView>}
        </View>
      )}
      <GestureDetector gesture={resize}><View style={{ position: 'absolute', right: 0, bottom: 0, width: 28, height: 28, alignItems: 'flex-end', justifyContent: 'flex-end', padding: 4 }} collapsable={false}><Ionicons name="resize-outline" size={16} color={colors.textMuted} /></View></GestureDetector>
    </Animated.View>
  );
}
