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
  useEffect(() => { if (!uri || uri === 'blank:') return; let alive = true; const key = `${uri}|${index}|${px}`; if (!cache.has(key)) cache.set(key, enqueue(() => PdfRenderer.renderPage(uri, index, px))); cache.get(key)!.then((u) => alive && setSrc(u)).catch(() => alive && setErr(true)); return () => { alive = false; }; }, [uri, index, px]);
  return { src, err };
}
export function BlankPaper({ width, height, template = 'plain' }: { width: number; height: number; template?: 'plain' | 'lined' | 'grid' | 'dot' }) {
  const gap = width / 24; const lines = Math.floor(height / gap); const cols = Math.floor(width / gap);
  return (
    <View style={{ width, height, backgroundColor: '#fff', overflow: 'hidden' }} pointerEvents="none">
      {(template === 'lined' || template === 'grid') && Array.from({ length: lines }, (_, i) => <View key={'h' + i} style={{ position: 'absolute', left: 0, right: 0, top: (i + 1) * gap, height: 1, backgroundColor: 'rgba(47,111,237,0.14)' }} />)}
      {template === 'grid' && Array.from({ length: cols }, (_, i) => <View key={'v' + i} style={{ position: 'absolute', top: 0, bottom: 0, left: (i + 1) * gap, width: 1, backgroundColor: 'rgba(47,111,237,0.14)' }} />)}
      {template === 'dot' && Array.from({ length: lines * cols }, (_, k) => <View key={'d' + k} style={{ position: 'absolute', left: ((k % cols) + 1) * gap - 1, top: (Math.floor(k / cols) + 1) * gap - 1, width: 2, height: 2, borderRadius: 1, backgroundColor: 'rgba(23,32,51,0.25)' }} />)}
    </View>
  );
}
export function PdfPage({ uri, index, width, height, renderScale = 1, template }: { uri: string | null; index: number; width: number; height: number; renderScale?: number; template?: 'plain' | 'lined' | 'grid' | 'dot' }) {
  if (uri === 'blank:') return <BlankPaper width={width} height={height} template={template} />;
  // renderScale > 1 asks the native renderer for a sharper bitmap while the page is zoomed in via transform.
  const { colors } = useTheme(); const { src, err } = usePageImage(uri, index, width * renderScale);
  return (
    <View style={{ width, height, backgroundColor: '#fff' }} pointerEvents="none">
      {src ? <Image source={{ uri: src }} style={{ width, height }} resizeMode="stretch" fadeDuration={0} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{err ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>페이지를 불러오지 못했어요</Text> : <ActivityIndicator color={colors.primary} />}</View>}
    </View>
  );
}
export function clearImageCache() { cache.clear(); }
