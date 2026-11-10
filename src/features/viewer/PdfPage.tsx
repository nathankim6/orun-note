import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Image, PixelRatio, Text, Platform } from 'react-native';
import { PdfRenderer } from '../../../modules/pdf-renderer';
import { useTheme } from '@/theme';
import { reportError } from '@/lib/diag';
import type { PaperTemplate } from '@/data/types';
import { createRenderScheduler, RenderPriority, type RenderLease } from './renderScheduler';

let slowPreparationsReported = 0;
const renders = createRenderScheduler(64, 2, {
  onComplete: ({ index, width, waitMs, preparationMs }) => {
    if (Platform.OS === 'web' || slowPreparationsReported >= 2 || index == null || width == null) return;
    if (waitMs < 1000 && preparationMs < 800) return;
    slowPreparationsReported++;
    // Preparation includes render + JPEG + disk + bridge, not raster-only timing or first paint.
    reportError('render', 'PDF preparation page=' + index + ' width=' + width +
      ' waitMs=' + Math.round(waitMs) + ' preparationMs=' + Math.round(preparationMs));
  },
});
// Owns leases even when the existing onPrefetch callback does not return them.
export const withPagePrefetchWindow = (run: () => void) => renders.prefetchWindow(run);
// Full-page density and sharp zoom tiles are unchanged.
const bucket = (w: number) => Math.min(2400, Math.max(300, Math.ceil(w / 300) * 300));
const pxFor = (displayWidth: number) => bucket(displayWidth * Math.min(2.5, PixelRatio.get()));
type PageImage = { page: string; src: string | null; preview: string | null; err: boolean };
export function usePageImage(uri: string | null, index: number, displayWidth: number) {
  const [image, setImage] = useState<PageImage>({ page: '', src: null, preview: null, err: false });
  const px = pxFor(displayWidth), page = uri + '|' + index;
  useEffect(() => {
    if (!uri || uri === 'blank:') return;
    let alive = true; const leases: RenderLease[] = [];
    const key = page + '|' + px, meta = { page, width: px, index };
    const available = renders.available(page, px);
    setImage(old => ({ page, src: null, preview: available ?? (old.page === page ? old.src ?? old.preview : null), err: false }));
    const show = (src: string, full: boolean) => {
      if (alive) setImage(old => ({ ...old, page, ...(full ? { src, err: false } : { preview: src }) }));
    };
    const request = (key: string, priority: number, width: number) => {
      const lease = renders.acquire(key, priority, () => PdfRenderer.renderPage(uri, index, width), { page, width, index });
      leases.push(lease); return lease.promise;
    };
    const full = () => request(key, RenderPriority.visible, px).then(u => show(u, true)).catch(() => {
      if (alive) setImage(old => ({ ...old, err: true }));
    });
    const pv = Math.max(300, Math.min(900, Math.round(px / 3 / 150) * 150));
    const previewKey = page + '|' + pv;
    const preview = async (mayRender: boolean) => {
      if (pv >= px || available) return;
      const ready = renders.value(previewKey); if (ready) { show(ready, false); return; }
      const disk = await PdfRenderer.cachedPage(uri, index, pv);
      if (!alive) return;
      if (disk) { renders.remember(previewKey, disk, { page, width: pv, index }); show(disk, false); }
      // Never add a redundant preview pass behind an already-running full render.
      else if (mayRender && renders.state(key) !== 'running' && renders.state(key) !== 'settled') {
        request(previewKey, RenderPriority.preview, pv).then(u => show(u, false)).catch(() => {});
      }
    };
    const start = async () => {
      if (renders.state(key)) {
        const queued = renders.state(key) === 'queued';
        void full(); // Promotion must not wait for a disk preview lookup.
        void preview(queued).catch(() => {}); return;
      }
      const disk = await PdfRenderer.cachedPage(uri, index, px);
      if (!alive) return;
      if (disk) { renders.remember(key, disk, meta); show(disk, true); return; }
      await preview(true);
      if (alive) void full();
    };
    void start().catch(() => { if (alive) void full(); });
    return () => { alive = false; leases.forEach(lease => lease.release()); };
  }, [uri, index, px]);
  const current = image.page === page ? image : null;
  return { src: current?.src ?? current?.preview ?? null, err: !!current?.err && !current.src && !current.preview };
}
/** Warm only the current bounded neighbour window. */
export function prefetchPage(uri: string | null, index: number, displayWidth: number, rank = 1) {
  if (!uri || uri === 'blank:' || index < 0) return;
  const px = pxFor(displayWidth), page = uri + '|' + index;
  return renders.prefetch(page + '|' + px, RenderPriority.prefetch + rank / 100,
    () => PdfRenderer.renderPage(uri, index, px), { page, width: px, index }).release;
}
export type PageTile = { pxW: number; x: number; y: number; w: number; h: number; nx: number; ny: number; nw: number; nh: number };
/** Sharp re-render of the visible part of a zoomed page, laid over the base bitmap (old tile stays until the new one is ready). */
function TileLayer({ uri, index, tile, width, height }: { uri: string; index: number; tile?: PageTile; width: number; height: number }) {
  const [shown, setShown] = useState<{ page: string; src: string; t: PageTile } | null>(null);
  const rr = ((PdfRenderer as any).hasRenderRegion?.() ?? true) ? ((PdfRenderer as any).renderRegion as undefined | ((u: string, i: number, pw: number, x: number, y: number, w: number, h: number) => Promise<string>)) : undefined;
  useEffect(() => {
    if (!tile || !rr) { setShown(null); return; } let alive = true;
    const key = `${uri}|${index}|${tile.pxW}|${tile.x}|${tile.y}|${tile.w}|${tile.h}`;
    const lease = renders.acquire('tile|' + key, RenderPriority.tile, () => rr(uri, index, tile.pxW, tile.x, tile.y, tile.w, tile.h));
    lease.promise.then((src) => { if (alive && src) setShown({ page: uri + '|' + index, src, t: tile }); }).catch(() => {});
    return () => { alive = false; lease.release(); };
  }, [uri, index, tile?.pxW, tile?.x, tile?.y, tile?.w, tile?.h]);
  if (!shown || !tile || shown.page !== uri + '|' + index) return null; const t = shown.t;
  return <Image source={{ uri: shown.src }} style={{ position: 'absolute', left: t.nx * width, top: t.ny * height, width: t.nw * width, height: t.nh * height }} resizeMode="stretch" fadeDuration={0} />;
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
export function PdfPage({ uri, index, width, height, renderScale = 1, template, tile }: { uri: string | null; index: number; width: number; height: number; renderScale?: number; template?: PaperTemplate; tile?: PageTile }) {
  if (uri === 'blank:') return <BlankPaper width={width} height={height} template={template} />;
  // renderScale > 1 asks the native renderer for a sharper bitmap while the page is zoomed in via transform.
  const { colors } = useTheme(); const { src, err } = usePageImage(uri, index, width * renderScale);
  return (
    <View style={{ width, height, backgroundColor: '#fff' }} pointerEvents="none">
      {src ? <><Image source={{ uri: src }} style={{ width, height }} resizeMode="stretch" fadeDuration={0} />{uri ? <TileLayer uri={uri} index={index} tile={tile} width={width} height={height} /> : null}</> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{err ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>페이지를 불러오지 못했어요</Text> : <ActivityIndicator color={colors.primary} />}</View>}
    </View>
  );
}
export function clearImageCache() { renders.clear(); }
