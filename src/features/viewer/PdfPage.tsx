import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Image, PixelRatio, Text } from 'react-native';
import { PdfRenderer } from '../../../modules/pdf-renderer';
import { useTheme } from '@/theme';
import type { PaperTemplate } from '@/data/types';

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
export function BlankPaper({ width, height, template = 'plain' }: { width: number; height: number; template?: PaperTemplate }) {
  const t = template; const base = width / 24; const gap = t === 'narrowLined' || t === 'narrowGrid' ? base * 0.75 : t === 'wideLined' ? base * 1.35 : base;
  const lineColor = 'rgba(47,111,237,0.16)'; const els: React.ReactNode[] = [];
  const hline = (y: number, key: string, color = lineColor, h = 1) => els.push(<View key={key} style={{ position: 'absolute', left: 0, right: 0, top: y, height: h, backgroundColor: color }} />);
  const vline = (x: number, key: string, color = lineColor) => els.push(<View key={key} style={{ position: 'absolute', top: 0, bottom: 0, left: x, width: 1, backgroundColor: color }} />);
  if (t === 'lined' || t === 'narrowLined' || t === 'wideLined' || t === 'oxford') { const top = t === 'oxford' ? height * 0.1 : gap; for (let y = top, i = 0; y < height - gap * 0.5; y += gap, i++) hline(y, 'h' + i); if (t === 'oxford') { hline(height * 0.1 - gap * 0.6, 'hdr', 'rgba(47,111,237,0.35)', 2); vline(width * 0.1, 'mg', 'rgba(220,38,38,0.35)'); } }
  if (t === 'grid' || t === 'narrowGrid') { for (let y = gap, i = 0; y < height; y += gap, i++) hline(y, 'h' + i); for (let x = gap, i = 0; x < width; x += gap, i++) vline(x, 'v' + i); }
  if (t === 'dot') { const cols = Math.floor(width / gap), rows = Math.floor(height / gap); for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) els.push(<View key={`d${r}_${c}`} style={{ position: 'absolute', left: c * gap - 1, top: r * gap - 1, width: 2, height: 2, borderRadius: 1, backgroundColor: 'rgba(23,32,51,0.25)' }} />); }
  if (t === 'music') { const staffGap = width / 70; const block = staffGap * 4 + width / 14; for (let y = height * 0.08, j = 0; y + staffGap * 4 < height * 0.95; y += block, j++) for (let i = 0; i < 5; i++) hline(y + i * staffGap, `m${j}_${i}`, 'rgba(23,32,51,0.35)'); }
  return <View style={{ width, height, backgroundColor: '#fff', overflow: 'hidden' }} pointerEvents="none">{els}</View>;
}
export function PdfPage({ uri, index, width, height, renderScale = 1, template }: { uri: string | null; index: number; width: number; height: number; renderScale?: number; template?: PaperTemplate }) {
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
