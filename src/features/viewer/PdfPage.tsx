import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Image, PixelRatio, Text } from 'react-native';
import { PdfRenderer } from '../../../modules/pdf-renderer';
import { useTheme } from '@/theme';
import type { PaperTemplate } from '@/data/types';

/**
 * One render worker (the native engines are single-threaded anyway) with priorities:
 *   0 = sharp zoom tile, 1 = page on screen, 2 = prefetch of neighbours. Newest request first within a priority,
 * and a queued prefetch is promoted when the page actually becomes visible — scrolling never waits behind old work.
 */
type Job = { pri: number; seq: number; run: () => void };
const jobs: Job[] = []; let busy = false; let seqN = 0;
function pump() { if (busy || !jobs.length) return; jobs.sort((a, b) => a.pri - b.pri || b.seq - a.seq); const j = jobs.shift()!; busy = true; j.run(); }
function schedule<T>(pri: number, fn: () => Promise<T>): { p: Promise<T>; job: Job } {
  let job!: Job; const p = new Promise<T>((resolve, reject) => { job = { pri, seq: seqN++, run: () => { fn().then(resolve, reject).finally(() => { busy = false; pump(); }); } }; jobs.push(job); });
  pump(); return { p, job };
}
const cache = new Map<string, { p: Promise<string>; job: Job }>();
const request = (key: string, pri: number, fn: () => Promise<string>) => {
  const hit = cache.get(key); if (hit) { if (hit.job.pri > pri) { hit.job.pri = pri; hit.job.seq = seqN++; } return hit.p; }
  const e = schedule(pri, fn); e.p.catch(() => cache.delete(key)); cache.set(key, e); return e.p;
};
// base page bitmap: about the on-screen width at 100 % (sharpness when zoomed comes from tiles, not from huge bitmaps)
const bucket = (w: number) => Math.min(2400, Math.max(300, Math.ceil(w / 300) * 300));
const pxFor = (displayWidth: number) => bucket(displayWidth * Math.min(2.5, PixelRatio.get()));
export function usePageImage(uri: string | null, index: number, displayWidth: number) {
  const [src, setSrc] = useState<string | null>(null); const [preview, setPreview] = useState<string | null>(null); const [err, setErr] = useState(false);
  const px = pxFor(displayWidth);
  useEffect(() => {
    if (!uri || uri === 'blank:') return; let alive = true; const key = `${uri}|${index}|${px}`;
    const full = () => request(key, 1, () => PdfRenderer.renderPage(uri, index, px)).then((u) => { if (alive) setSrc(u); }).catch(() => { if (alive) setErr(true); });
    if (cache.has(key)) { full(); return () => { alive = false; }; }
    // Already rendered in an earlier session? Show it at once instead of waiting behind the render queue.
    PdfRenderer.cachedPage(uri, index, px).then((hit) => {
      if (!alive) return;
      if (hit) { cache.set(key, { p: Promise.resolve(hit), job: { pri: -1, seq: 0, run: () => {} } }); setSrc(hit); return; }
      // Not rendered yet: a quick low-resolution pass first (ahead of full renders), then the sharp page replaces it.
      const pv = Math.max(300, Math.min(900, Math.round(px / 3 / 150) * 150));
      if (pv < px) request(`${uri}|${index}|${pv}`, 0.5, () => PdfRenderer.renderPage(uri, index, pv)).then((u) => { if (alive) setPreview(u); }).catch(() => {});
      full();
    });
    return () => { alive = false; };
  }, [uri, index, px]);
  return { src: src ?? preview, err: err && !preview };
}
/** Warm the cache for pages the reader is about to see. `rank` 1 = the page most likely next (rendered first). */
export function prefetchPage(uri: string | null, index: number, displayWidth: number, rank = 1) {
  if (!uri || uri === 'blank:' || index < 0) return; const px = pxFor(displayWidth);
  request(`${uri}|${index}|${px}`, 2 + rank / 100, () => PdfRenderer.renderPage(uri, index, px)).catch(() => {});
}
export type PageTile = { pxW: number; x: number; y: number; w: number; h: number; nx: number; ny: number; nw: number; nh: number };
const tileCache = new Map<string, Promise<string>>();
/** Sharp re-render of the visible part of a zoomed page, laid over the base bitmap (old tile stays until the new one is ready). */
function TileLayer({ uri, index, tile, width, height }: { uri: string; index: number; tile?: PageTile; width: number; height: number }) {
  const [shown, setShown] = useState<{ src: string; t: PageTile } | null>(null);
  const rr = ((PdfRenderer as any).hasRenderRegion?.() ?? true) ? ((PdfRenderer as any).renderRegion as undefined | ((u: string, i: number, pw: number, x: number, y: number, w: number, h: number) => Promise<string>)) : undefined;
  useEffect(() => {
    if (!tile || !rr) { setShown(null); return; } let alive = true;
    const key = `${uri}|${index}|${tile.pxW}|${tile.x}|${tile.y}|${tile.w}|${tile.h}`;
    let p = tileCache.get(key); if (!p) { p = schedule(0, () => rr(uri, index, tile.pxW, tile.x, tile.y, tile.w, tile.h)).p; tileCache.set(key, p); p.catch(() => tileCache.delete(key)); if (tileCache.size > 24) tileCache.delete(tileCache.keys().next().value as string); }
    p.then((src) => { if (alive && src) setShown({ src, t: tile }); }).catch(() => {});
    return () => { alive = false; };
  }, [uri, index, tile?.pxW, tile?.x, tile?.y, tile?.w, tile?.h]);
  if (!shown || !tile) return null; const t = shown.t;
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
export function clearImageCache() { cache.clear(); }
