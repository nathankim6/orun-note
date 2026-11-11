import React, { useContext, useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Image, PixelRatio, Text, Platform } from 'react-native';
import { PdfRenderer } from '../../../modules/pdf-renderer';
import { useTheme } from '@/theme';
import { reportError } from '@/lib/diag';
import type { PaperTemplate } from '@/data/types';
import { RenderPriority, type RenderLease } from './renderScheduler';
import { createPdfWork, readingPixels, detailPixels } from './pdfWork';
import { createPreparationReporter, createImageLoadReporter } from './pdfDiagnostics';
import { PdfImageLayers } from './PdfImageLayers';
import { PageQualityContext } from './pageQuality';

const work = createPdfWork(createPreparationReporter(Platform.OS, () => PdfRenderer.takeRenderTimings(), reportError));
const imageLoads = createImageLoadReporter(Platform.OS, reportError);
export const withPagePrefetchWindow = (run: () => void) => work.reading.prefetchWindow(run);
type PageImage = { page: string; reading: string | null; detail: string | null; detailWidth: number; err: boolean };
export function usePageImage(uri: string | null, index: number, displayWidth: number, detailAllowed = false) {
  const page = `${uri}|${index}`, readPx = readingPixels(displayWidth), fullPx = detailPixels(displayWidth, PixelRatio.get());
  const readKey = `${page}|read|${readPx}`, fullKey = `${page}|detail|${fullPx}`;
  const [presentedRequest, setPresentedRequest] = useState<object | null>(null); const pageRef = useRef(page); pageRef.current = page;
  const trackingRef = useRef<{ page: string; session: ReturnType<typeof imageLoads.begin>; loads: Map<string, () => void> } | null>(null);
  if (trackingRef.current?.page !== page) trackingRef.current = { page, session: imageLoads.begin(index), loads: new Map() };
  const tracking = trackingRef.current;
  const sourceReady = (source: string, sharp: boolean) => {
    if (!tracking.loads.has(source)) tracking.loads.set(source, tracking.session.ready(sharp ? 'detail' : 'reading', sharp ? fullPx : readPx));
  };
  const [image, setImage] = useState<PageImage>({ page: '', reading: null, detail: null, detailWidth: 0, err: false });
  useEffect(() => {
    if (!uri || uri === 'blank:') return;
    let alive = true; let lease: RenderLease | undefined;
    setImage(old => old.page === page ? { ...old, err: false } : { page, reading: null, detail: null, detailWidth: 0, err: false });
    const show = (src: string, sharp: boolean) => {
      if (alive && pageRef.current === page) { sourceReady(src, sharp); setImage(old => ({ ...old, page, ...(sharp ? { detail: src, detailWidth: fullPx } : { reading: src }), err: false })); }
    };
    const start = async () => {
      const sharp = work.detail.value(fullKey), ready = work.reading.value(readKey);
      if (sharp) { show(sharp, true); return; }
      if (ready) { show(ready, false); return; }
      const available = work.detail.available(page, fullPx) ?? work.reading.available(page, readPx);
      if (available) show(available, false);
      // Reusing a ready full image is cheap; neither lookup waits behind the native drawing workers.
      const [cachedFull, cachedRead] = await Promise.all([PdfRenderer.cachedPage(uri, index, fullPx), PdfRenderer.cachedReading(uri, index, readPx)]);
      if (!alive) return;
      if (cachedFull) { work.detail.remember(fullKey, cachedFull, { page, width: fullPx, index }); show(cachedFull, true); return; }
      if (cachedRead) { work.reading.remember(readKey, cachedRead, { page, width: readPx, index }); show(cachedRead, false); return; }
      lease = work.reading.acquire(readKey, RenderPriority.preview, () => PdfRenderer.renderReading(uri, index, readPx), { page, width: readPx, index });
      show(await lease.promise, false);
    };
    void start().catch(() => { if (alive) setImage(old => ({ ...old, page, err: true })); });
    return () => { alive = false; lease?.release(); };
  }, [uri, index, readPx, fullPx]);
  useEffect(() => {
    if (!uri || uri === 'blank:' || !detailAllowed || presentedRequest !== tracking) return;
    let alive = true; let lease: RenderLease | undefined;
    const show = (src: string) => { if (alive && pageRef.current === page) { sourceReady(src, true); setImage(old => ({ ...old, page, detail: src, detailWidth: fullPx, err: false })); } };
    void (async () => {
      const ready = work.detail.value(fullKey); if (ready) { show(ready); return; }
      const cached = await PdfRenderer.cachedPage(uri, index, fullPx); if (!alive) return;
      if (cached) { work.detail.remember(fullKey, cached, { page, width: fullPx, index }); show(cached); return; }
      await work.reading.whenIdle(); if (!alive) return;
      lease = work.detail.acquire(fullKey, RenderPriority.visible, () => PdfRenderer.renderPage(uri, index, fullPx), { page, width: fullPx, index });
      show(await lease.promise);
    })().catch(() => {}); // a refinement failure must not hide the usable reading page
    return () => { alive = false; lease?.release(); };
  }, [uri, index, fullPx, detailAllowed, presentedRequest]);
  const current = image.page === page ? image : null;
  const rendered = useRef({ reading: current?.reading, detail: current?.detail }); rendered.current = { reading: current?.reading, detail: current?.detail };
  return { onLoad: (source = current?.detail ?? current?.reading ?? null) => {
    if (pageRef.current !== page || trackingRef.current !== tracking || !source || (source !== rendered.current.reading && source !== rendered.current.detail)) return;
    tracking.loads.get(source)?.(); setPresentedRequest(tracking);
  }, presented: presentedRequest === tracking, reading: current?.reading ?? null, detail: current?.detail ?? null, src: current?.detail ?? current?.reading ?? null, err: !!current?.err && !current.detail && !current.reading };
}
/** Neighbours get reading images only, never speculative 2400px detail rasters. */
export function prefetchPage(uri: string | null, index: number, displayWidth: number, rank = 1) {
  if (!uri || uri === 'blank:' || index < 0) return;
  const width = readingPixels(displayWidth), page = `${uri}|${index}`;
  return work.reading.prefetch(`${page}|read|${width}`, RenderPriority.prefetch + rank / 100,
    () => PdfRenderer.renderReading(uri, index, width), { page, width, index }).release;
}
export type PageTile = { pxW: number; x: number; y: number; w: number; h: number; nx: number; ny: number; nw: number; nh: number };
function TileLayer({ uri, index, tile, width, height }: { uri: string; index: number; tile?: PageTile; width: number; height: number }) {
  const allowed = useContext(PageQualityContext);
  const [shown, setShown] = useState<{ page: string; src: string; t: PageTile } | null>(null);
  const rr = PdfRenderer.hasRenderRegion() ? PdfRenderer.renderRegion : undefined;
  useEffect(() => {
    if (!tile || !rr) { setShown(null); return; }
    if (!allowed) return; // retain a valid old tile, but enqueue no expensive work while moving
    let alive = true;
    const key = `${uri}|${index}|${tile.pxW}|${tile.x}|${tile.y}|${tile.w}|${tile.h}`;
    let lease: RenderLease | undefined;
    void (async () => {
      await work.reading.whenIdle(); if (!alive) return;
      lease = work.detail.acquire('tile|' + key, RenderPriority.tile, () => rr(uri, index, tile.pxW, tile.x, tile.y, tile.w, tile.h));
      const src = await lease.promise; if (alive && src) setShown({ page: uri + '|' + index, src, t: tile });
    })().catch(() => {});
    return () => { alive = false; lease?.release(); };
  }, [uri, index, tile?.pxW, tile?.x, tile?.y, tile?.w, tile?.h, allowed]);
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
export function PdfPage(props: { uri: string | null; index: number; width: number; height: number; renderScale?: number; template?: PaperTemplate; tile?: PageTile }) {
  if (props.uri === 'blank:') return <BlankPaper width={props.width} height={props.height} template={props.template} />;
  return <RasterPdfPage {...props} />;
}
function RasterPdfPage({ uri, index, width, height, renderScale = 1, tile }: { uri: string | null; index: number; width: number; height: number; renderScale?: number; tile?: PageTile }) {
  const allowed = useContext(PageQualityContext), { colors } = useTheme();
  const { src, reading, detail, presented, err, onLoad } = usePageImage(uri, index, width * renderScale, allowed);
  return <View style={{ width, height, backgroundColor: '#fff' }} pointerEvents="none">
    {src ? <><PdfImageLayers reading={reading} detail={detail} width={width} height={height} onLoad={onLoad} />{uri && presented ? <TileLayer uri={uri} index={index} tile={tile} width={width} height={height} /> : null}</> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{err ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>페이지를 불러오지 못했어요</Text> : <ActivityIndicator color={colors.primary} />}</View>}
  </View>;
}
export function clearImageCache() { work.reading.clear(); work.detail.clear(); }
