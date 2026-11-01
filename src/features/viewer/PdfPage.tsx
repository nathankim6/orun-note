import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Image, PixelRatio, Text } from 'react-native';
import { PdfRenderer } from '../../../modules/pdf-renderer';
import { useTheme } from '@/theme';

const cache = new Map<string, Promise<string>>();
// Native PDF engines are serialized per process; keep the JS side to one in-flight render as well so a burst
// (cover + page + thumbnails) never piles up large bitmaps.
let chain: Promise<unknown> = Promise.resolve();
const enqueue = <T,>(fn: () => Promise<T>) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
const bucket = (w: number) => Math.min(2000, Math.max(300, Math.ceil(w / 300) * 300));
export function usePageImage(uri: string | null, index: number, displayWidth: number) {
  const [src, setSrc] = useState<string | null>(null); const [err, setErr] = useState(false);
  const px = bucket(displayWidth * Math.min(2, PixelRatio.get()));
  useEffect(() => { if (!uri) return; let alive = true; const key = `${uri}|${index}|${px}`; if (!cache.has(key)) cache.set(key, enqueue(() => PdfRenderer.renderPage(uri, index, px))); cache.get(key)!.then((u) => alive && setSrc(u)).catch(() => alive && setErr(true)); return () => { alive = false; }; }, [uri, index, px]);
  return { src, err };
}
export function PdfPage({ uri, index, width, height }: { uri: string | null; index: number; width: number; height: number }) {
  const { colors } = useTheme(); const { src, err } = usePageImage(uri, index, width);
  return (
    <View style={{ width, height, backgroundColor: '#fff' }} pointerEvents="none">
      {src ? <Image source={{ uri: src }} style={{ width, height }} resizeMode="stretch" fadeDuration={0} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{err ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>페이지를 불러오지 못했어요</Text> : <ActivityIndicator color={colors.primary} />}</View>}
    </View>
  );
}
export function clearImageCache() { cache.clear(); }
