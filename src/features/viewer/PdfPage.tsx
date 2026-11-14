import React, { useContext, useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Image, PixelRatio, Text, Platform } from 'react-native';
import { PdfRenderer } from '../../../modules/pdf-renderer';
import { useTheme } from '@/theme';
import { reportError } from '@/lib/diag';
import type { PaperTemplate } from '@/data/types';
import { RenderPriority, type RenderLease } from './renderScheduler';
import { createPdfWork, readingPixels, previewPixels, detailPixels } from './pdfWork';
import { createPreparationReporter, createImageLoadReporter } from './pdfDiagnostics';
import { PdfImageLayers } from './PdfImageLayers';
import { pageTileKey, type PageTile } from './pdfTileGeometry';
import { PageQualityContext } from './pageQuality';
import { DerivedPagesContext, pageImage as derivedPageImage, forUri as derivedForUri, isPresentSync, pageImagePath } from './derivedPages';
import { tierWidth } from './derivedPagesCore';

const work = createPdfWork(createPreparationReporter(Platform.OS, () => PdfRenderer.takeRenderTimings(), reportError));
const imageLoads = createImageLoadReporter(Platform.OS, reportError);
export const withPagePrefetchWindow = (run: () => void) => work.reading.prefetchWindow(run);
type PageImage = { page: string; reading: string | null; detail: string | null; detailWidth: number; err: boolean };
export function usePageImage(uri: string | null, index: number, displayWidth: number, detailAllowed = false) {
  // Pre-rendered pages (docs/derived-pages.md): a JPEG on disk replaces every native render of this page.
  const derived = useContext(DerivedPagesContext);
  const derivedReadPath = pageImagePath(derived, index, 'reading'), derivedDetailPath = pageImagePath(derived, index, 'detail');
  const page = `${uri}|${index}`, readPx = readingPixels(displayWidth), previewPx = previewPixels(displayWidth), fullPx = detailPixels(displayWidth, PixelRatio.get());
  const previewKey = `${page}|preview|${previewPx}`, readKey = `${page}|read|${readPx}`, fullKey = `${page}|detail|${fullPx}`;
  const [presentedRequest, setPresentedRequest] = useState<object | null>(null); const pageRef = useRef(page); pageRef.current = page;
  const trackingRef = useRef<{ page: string; session: ReturnType<typeof imageLoads.begin>; loads: Map<string, () => void> } | null>(null);
  if (trackingRef.current?.page !== page) trackingRef.current = { page, session: imageLoads.begin(index), loads: new Map() };
  const tracking = trackingRef.current;
  const sourceReady = (source: string, sharp: boolean, width = sharp ? fullPx : readPx) => {
    if (!tracking.loads.has(source)) tracking.loads.set(source, tracking.session.ready(sharp ? 'detail' : 'reading', width));
  };
  const [image, setImage] = useState<PageImage>({ page: '', reading: null, detail: null, detailWidth: 0, err: false });
  useEffect(() => {
    if (!uri || uri === 'blank:') return;
    let alive = true; const leases: RenderLease[] = [];
    const isCurrent = () => alive && pageRef.current === page;
    setImage(old => old.page === page ? { ...old, err: false } : { page, reading: null, detail: null, detailWidth: 0, err: false });
    const show = (src: string, sharp: boolean, width = sharp ? fullPx : readPx) => {
      if (isCurrent()) { sourceReady(src, sharp, width); setImage(old => ({ ...old, page, ...(sharp ? { detail: src, detailWidth: fullPx } : { reading: src }), err: false })); }
    };
    const start = async () => {
      if (derivedReadPath) {
        // shown at once when already on disk; otherwise one stat, then the native path below as today
        const d = isPresentSync(derivedReadPath) ? derivedReadPath : await derivedPageImage(derived, index, 'reading');
        if (!isCurrent()) return;
        if (d) { show(d, false, tierWidth(derived!, 'reading') ?? readPx); return; }
      }
      const sharp = work.detail.value(fullKey), ready = work.reading.value(readKey);
      if (sharp) { show(sharp, true); return; }
      if (ready) { show(ready, false); return; }
      const preview = work.reading.value(previewKey);
      const available = work.detail.available(page, fullPx) ?? work.reading.available(page, readPx);
      if (available) show(available, false, available === preview ? previewPx : readPx);
      // Disk lookups bypass native drawing workers, including the width-specific preview cache.
      const [cachedFull, cachedRead, cachedPreview] = await Promise.all([
        PdfRenderer.cachedPage(uri, index, fullPx), PdfRenderer.cachedReading(uri, index, readPx),
        PdfRenderer.cachedReading(uri, index, previewPx).catch(() => null),
      ]);
      if (!isCurrent()) return;
      if (cachedFull) { work.detail.remember(fullKey, cachedFull, { page, width: fullPx, index }); show(cachedFull, true); return; }
      if (cachedRead) { work.reading.remember(readKey, cachedRead, { page, width: readPx, index }); show(cachedRead, false); return; }
      if (cachedPreview) {
        work.reading.remember(previewKey, cachedPreview, { page, width: previewPx, index });
        if (!available) show(cachedPreview, false, previewPx);
      } else if (!available) {
        const previewLease = work.reading.acquire(previewKey, RenderPriority.preview,
          () => PdfRenderer.renderReading(uri, index, previewPx), { page, width: previewPx, index });
        leases.push(previewLease);
        try { show(await previewLease.promise, false, previewPx); }
        catch { /* A failed optional preview must not prevent the normal reading request. */ }
      }
      if (!isCurrent()) return;
      const readingLease = work.reading.acquire(readKey, RenderPriority.visible,
        () => PdfRenderer.renderReading(uri, index, readPx), { page, width: readPx, index });
      leases.push(readingLease);
      show(await readingLease.promise, false);
    };
    void start().catch(() => { if (isCurrent()) setImage(old => ({ ...old, page, err: true })); });
    return () => { alive = false; leases.forEach(lease => lease.release()); };
  }, [uri, index, readPx, previewPx, fullPx, derivedReadPath]);
  useEffect(() => {
    if (!uri || uri === 'blank:' || !detailAllowed || presentedRequest !== tracking) return;
    let alive = true; let lease: RenderLease | undefined;
    const show = (src: string, width = fullPx) => { if (alive && pageRef.current === page) { sourceReady(src, true, width); setImage(old => ({ ...old, page, detail: src, detailWidth: width, err: false })); } };
    void (async () => {
      if (derivedDetailPath) {
        const d = await derivedPageImage(derived, index, 'detail'); if (!alive) return;
        if (d) { show(d, tierWidth(derived!, 'detail') ?? fullPx); return; }
        if (isPresentSync(derivedReadPath)) return; // reading tier is derived: never fall back to a slow native full-page render
      }
      const ready = work.detail.value(fullKey); if (ready) { show(ready); return; }
      const cached = await PdfRenderer.cachedPage(uri, index, fullPx); if (!alive) return;
      if (cached) { work.detail.remember(fullKey, cached, { page, width: fullPx, index }); show(cached); return; }
      await work.reading.whenIdle(RenderPriority.visible); if (!alive) return;
      lease = work.detail.acquire(fullKey, RenderPriority.visible, () => PdfRenderer.renderPage(uri, index, fullPx), { page, width: fullPx, index });
      show(await lease.promise);
    })().catch(() => {}); // a refinement failure must not hide the usable reading page
    return () => { alive = false; lease?.release(); };
  }, [uri, index, fullPx, detailAllowed, presentedRequest, derivedDetailPath]);
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
  // derived pages are files already (or arriving from the download manager): nothing to pre-render
  if (derivedForUri(uri)) return;
  const width = readingPixels(displayWidth), page = `${uri}|${index}`;
  return work.reading.prefetch(`${page}|read|${width}`, RenderPriority.prefetch + rank / 100,
    () => PdfRenderer.renderReading(uri, index, width), { page, width, index }).release;
}
export type { PageTile } from './pdfTileGeometry';
type TileImage = { page: string; token: object; src: string; t: PageTile };
/** Loaded tile stays underneath its replacement, including throughout motion. */
export function TileLayer({ uri, index, tile, width, height, onFailure }: { uri: string; index: number; tile?: PageTile; width: number; height: number; onFailure?: (key: string) => void }) {
  const allowed = useContext(PageQualityContext), page = uri + '|' + index;
  const identity = useRef({ page, token: {} });
  if (identity.current.page !== page) identity.current = { page, token: {} };
  const token = identity.current.token;
  const [shown, setShown] = useState<TileImage | null>(null), [pending, setPending] = useState<TileImage | null>(null);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const shownRef = useRef(shown); shownRef.current = shown;
  const failureRef = useRef(onFailure); failureRef.current = onFailure;
  const rr = PdfRenderer.hasRenderRegion() ? PdfRenderer.renderRegion : undefined;
  useEffect(() => {
    if (!tile || !rr || !allowed) return;
    let alive = true; let lease: RenderLease | undefined;
    const failed = () => { if (alive && identity.current.token === token) failureRef.current?.(pageTileKey(tile)); };
    void (async () => {
      // Visible reads remain urgent. Speculative reading neighbours never delay a visible tile.
      await work.reading.whenIdle(RenderPriority.visible); if (!alive) return;
      lease = work.detail.acquire('tile|' + page + '|' + pageTileKey(tile), RenderPriority.tile,
        () => rr(uri, index, tile.pxW, tile.x, tile.y, tile.w, tile.h));
      const src = await lease.promise;
      if (!src) { failed(); return; }
      if (alive && identity.current.token === token) {
        // A same-session cache hit is already decoded. A prior A session's same URI is not:
        // its Image was unmounted during A -> B -> A, so the new session must receive onLoad.
        const decoded = shownRef.current;
        if (decoded?.token === token && decoded.src === src) setPending(null);
        else setPending({ page, token, src, t: tile });
      }
    })().catch(failed);
    return () => { alive = false; lease?.release(); };
  }, [uri, index, tile?.pxW, tile?.x, tile?.y, tile?.w, tile?.h, allowed, token]);
  const currentShown = shown?.token === token ? shown : null;
  const images = [currentShown, pending].filter((im, i) => im && im.token === token && (i === 0 || im.src !== currentShown?.src)) as TileImage[];
  return <>{images.map(im => { const t = im.t; return <Image key={im.src} source={{ uri: im.src }} style={{ position: 'absolute', left: t.nx * width, top: t.ny * height, width: t.nw * width, height: t.nh * height, opacity: im === pending ? 0 : 1 }} resizeMode="stretch" fadeDuration={0}
    onLoad={() => { if (identity.current.token !== im.token || pendingRef.current !== im) return; shownRef.current = im; setShown(im); setPending(null); }}
    onError={() => { if (identity.current.token !== im.token || pendingRef.current !== im) return; setPending(null); failureRef.current?.(pageTileKey(im.t)); }} />; })}</>;
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
  const tileRequest = uri + '|' + index + '|' + pageTileKey(tile);
  const [failedTile, setFailedTile] = useState<string | null>(null);
  const tileFirst = !!tile && PdfRenderer.hasRenderRegion() && failedTile !== tileRequest;
  // rs is cancelled here intentionally for the <=1200 reading image. Sharpness comes from the
  // actual viewport × zoom × DPR tile, not a capped full page stretched by the outer transform.
  const { src, reading, detail, presented, err, onLoad } = usePageImage(uri, index, width * renderScale, allowed && !tileFirst);
  return <View style={{ width, height, backgroundColor: '#fff' }} pointerEvents="none">
    {src ? <><PdfImageLayers reading={reading} detail={detail} width={width} height={height} onLoad={onLoad} />{uri && presented ? <TileLayer uri={uri} index={index} tile={tile} width={width} height={height} onFailure={key => setFailedTile(uri + '|' + index + '|' + key)} /> : null}</> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{err ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>페이지를 불러오지 못했어요</Text> : <ActivityIndicator color={colors.primary} />}</View>}
  </View>;
}
export function clearImageCache() { work.reading.clear(); work.detail.clear(); }
