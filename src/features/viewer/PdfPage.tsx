import React, { useContext, useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Image, PixelRatio, Text, Platform } from 'react-native';
import { PdfRenderer, PdfPageSurface, type PageReadyEvent } from '../../../modules/pdf-renderer';
import { nativePagePixels, useNativeSurface, createWarmBatcher, NATIVE_PAGE_MAX_PX } from './nativePageView';
import { useTheme } from '@/theme';
import { reportError } from '@/lib/diag';
import type { PaperTemplate } from '@/data/types';
import { RenderPriority, type RenderLease } from './renderScheduler';
import { createPdfWork, readingPixels, previewPixels, detailPixels } from './pdfWork';
import { createPreparationReporter, createImageLoadReporter } from './pdfDiagnostics';
import { halfTile, noteTileTiming, tileIsSlow, tileImageStyle } from './tileProgress';
import { PdfImageLayers } from './PdfImageLayers';
import { pageTileKey, type PageTile } from './pdfTileGeometry';
import { PageQualityContext } from './pageQuality';
import { DerivedPagesContext, pageImage as derivedPageImage, forUri as derivedForUri, isPresentSync, pageImagePath, useDerivedFile, noteEngineFallback } from './derivedPages';
import { DerivedPdfPage, useDerivedSharpSource } from './DerivedPage';
import { SharpFrame, sharpTileRect, type SharpMotion, type TileAt } from './SharpFrame';
import { tierWidth } from './derivedPagesCore';

const work = createPdfWork(createPreparationReporter(Platform.OS, () => PdfRenderer.takeRenderTimings(), reportError));
const imageLoads = createImageLoadReporter(Platform.OS, reportError);
const nativePages = !!PdfPageSurface && PdfRenderer.hasPageView();
const warm = createWarmBatcher((uri, indices, px) => PdfRenderer.warmPages(uri, indices, px));
export const withPagePrefetchWindow = (run: () => void) => {
  if (!nativePages) return work.reading.prefetchWindow(run);
  // Native page views: one ordered bitmap warm list per window; JPEG prefetches still go through the scheduler window.
  let release: () => void = () => {};
  warm.window(() => { release = work.reading.prefetchWindow(run); });
  return release;
};
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
  if (useNativeSurface(nativePages, Platform.OS, displayWidth)) { warm.add(uri, index, nativePagePixels(displayWidth, PixelRatio.get()), rank); return; }
  const width = readingPixels(displayWidth), page = `${uri}|${index}`;
  return work.reading.prefetch(`${page}|read|${width}`, RenderPriority.prefetch + rank / 100,
    () => PdfRenderer.renderReading(uri, index, width), { page, width, index }).release;
}
export type { PageTile } from './pdfTileGeometry';
type TileImage = { page: string; token: object; src: string; t: PageTile; px: { w: number; h: number }; at?: TileAt };
/** Screen-space placement for TileLayer (iOS document surface): the page box at zoom 1 and the live transform. */
export type TileOverlay = { box: { x: number; y: number; w: number; h: number }; motion: SharpMotion };
/** Where the tile's pixels come from when it is not the device PDF engine (a window of a server page raster). */
export type TileSource = { key: string; render: (t: PageTile) => Promise<string> };
/** A tile that failed once must not leave a page on the soft base raster for the rest of the visit. */
export const TILE_RETRY_MS = 1200, TILE_RETRIES = 3;
/**
 * Per-page zoom-tile failure clock: after a failed region the same tile is requested again (spaced, up to TILE_RETRIES)
 * and only then does the page fall back for good. `attempt` is TileLayer's re-request trigger.
 */
function useTileFailure() {
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!failed || attempt >= TILE_RETRIES) return;
    const timer = setTimeout(() => { setFailed(null); setAttempt(n => n + 1); }, TILE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [failed, attempt]);
  return { failed, attempt, fail: setFailed };
}
/** Loaded tile stays underneath its replacement, including throughout motion. */
export function TileLayer({ uri, index, tile, width, height, retry = 0, onFailure, overlay, source, needed = true }: { uri: string; index: number; tile?: PageTile; width: number; height: number; /** bumped to request the same region again after a failure */ retry?: number; onFailure?: (key: string) => void;
  /** draw in viewport space, outside the zoom transform (iOS); default: inside the page */ overlay?: TileOverlay; source?: TileSource;
  /** false: the page under the tile is already sharp enough at this magnification, so nothing is requested and nothing stays */ needed?: boolean }) {
  const allowed = useContext(PageQualityContext), page = uri + '|' + index;
  const identity = useRef({ page, token: {} });
  if (identity.current.page !== page) identity.current = { page, token: {} };
  const token = identity.current.token;
  const [shown, setShown] = useState<TileImage | null>(null), [pending, setPending] = useState<TileImage | null>(null);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const shownRef = useRef(shown); shownRef.current = shown;
  const failureRef = useRef(onFailure); failureRef.current = onFailure;
  const rr = PdfRenderer.hasRenderRegion() ? PdfRenderer.renderRegion : undefined;
  const sourceRef = useRef(source); sourceRef.current = source; const sourceKey = source?.key ?? '';
  useEffect(() => { if (!needed) { setShown(null); setPending(null); } }, [needed]);
  useEffect(() => {
    if (!tile || !(rr || source) || !allowed || !needed) return;
    let alive = true; const leases: RenderLease[] = [];
    const failed = () => { if (alive && identity.current.token === token) failureRef.current?.(pageTileKey(tile)); };
    const present = (src: string, t: PageTile) => {
      if (!alive || identity.current.token !== token) return;
      // A same-session cache hit is already decoded. A prior A session's same URI is not:
      // its Image was unmounted during A -> B -> A, so the new session must receive onLoad.
      const decoded = shownRef.current;
      if (decoded?.token === token && decoded.src === src) setPending(null);
      else setPending({ page, token, src, t: tile, px: { w: t.w, h: t.h }, at: tile.at });
    };
    void (async () => {
      // Visible reads remain urgent. Speculative reading neighbours never delay a visible tile.
      await work.reading.whenIdle(RenderPriority.visible); if (!alive) return;
      const render = async (t: PageTile) => {
        const from = sourceRef.current;
        const lease = work.detail.acquire('tile|' + page + '|' + (from ? from.key + '|' : '') + pageTileKey(t), RenderPriority.tile, () => from ? from.render(t) : rr!(uri, index, t.pxW, t.x, t.y, t.w, t.h));
        leases.push(lease); const started = Date.now(); const src = await lease.promise; noteTileTiming(uri, Date.now() - started); return src;
      };
      if (!sourceRef.current && tileIsSlow(uri)) { const quick = await render(halfTile(tile)); if (!alive) return; if (quick) present(quick, halfTile(tile)); }
      const src = await render(tile);
      if (!src) { failed(); return; }
      present(src, tile);
    })().catch(failed);
    return () => { alive = false; for (const l of leases) l.release(); };
  }, [uri, index, tile?.pxW, tile?.x, tile?.y, tile?.w, tile?.h, allowed, token, retry, sourceKey, needed]);
  const currentShown = shown?.token === token ? shown : null;
  const images = [currentShown, pending].filter((im, i) => im && im.token === token && (i === 0 || im.src !== currentShown?.src)) as TileImage[];
  const dpr = PixelRatio.get();
  const onTileLoad = (im: TileImage) => { if (identity.current.token !== im.token || pendingRef.current !== im) return; shownRef.current = im; setShown(im); setPending(null); };
  const onTileError = (im: TileImage) => { if (identity.current.token !== im.token || pendingRef.current !== im) return; setPending(null); failureRef.current?.(pageTileKey(im.t)); };
  // Viewport space: each image sits in a frame that is the identity while the document rests where the tile was made.
  if (overlay) return <>{images.map(im => im.at ? <SharpFrame key={im.src} at={im.at} motion={overlay.motion}>
    <Image source={{ uri: im.src }} style={{ position: 'absolute', ...(({ exact: _exact, ...r }) => r)(sharpTileRect(overlay.box, im.t, im.px, im.at, dpr)), opacity: im === pending ? 0 : 1 }} resizeMode="stretch" fadeDuration={0} onLoad={() => onTileLoad(im)} onError={() => onTileError(im)} />
  </SharpFrame> : null)}</>;
  return <>{images.map(im => { const t = im.t; return <Image key={im.src} source={{ uri: im.src }} style={{ position: 'absolute', ...tileImageStyle(t, im.px, width, height, dpr), opacity: im === pending ? 0 : 1 }} resizeMode="stretch" fadeDuration={0}
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
export function PdfPage(props: { uri: string | null; index: number; width: number; height: number; renderScale?: number; template?: PaperTemplate; tile?: PageTile;
  /** 'none': draw the page only; a PdfSharp in the document's screen-space layer sharpens it (iOS document surface) */ sharp?: 'inline' | 'none' }) {
  if (props.uri === 'blank:') return <BlankPaper width={props.width} height={props.height} template={props.template} />;
  return <RasterPdfPage {...props} />;
}
type RasterProps = { uri: string | null; index: number; width: number; height: number; renderScale?: number; tile?: PageTile; sharp?: 'inline' | 'none' };
const surfaceLoads = createImageLoadReporter(Platform.OS + '-native', reportError);
function RasterPdfPage(props: RasterProps) {
  const page = props.uri + '|' + props.index;
  const [nativeFailed, setNativeFailed] = useState<string | null>(null);
  const tileFailure = useTileFailure();
  // A server pre-rendered page (docs/derived-pages.md) is a JPEG on disk: cheaper than any device drawing, so it wins.
  // The file state is reactive and starts as 'pending' until the disk answered: deciding from an in-memory index that
  // is empty after every app restart sent downloaded textbooks back to the device PDF engine (6–15 s and ~385 MB per
  // page on iPads, docs/ios-zoom-sharpness.md).
  const derived = useContext(DerivedPagesContext);
  const readPath = props.uri && derived ? pageImagePath(derived, props.index, 'reading') : null;
  const derivedFile = useDerivedFile(readPath);
  // counts only: a textbook page that ends up on the device engine although the server has its image
  useEffect(() => { if (readPath && derivedFile === 'absent') { const line = noteEngineFallback(readPath); if (line) reportError('render', line); } }, [readPath, derivedFile]);
  if (readPath && derivedFile === 'present') {
    const { uri, index, width, height, tile } = props; const tileRetry = tileFailure.attempt;
    return <DerivedPdfPage key={page} info={derived!} index={index} width={width} height={height} tile={tile} basePx={width * (props.renderScale ?? 1) * PixelRatio.get()} sharp={props.sharp}
      renderTile={uri && tile && PdfRenderer.hasRenderRegion() && tileFailure.failed !== page + '|' + pageTileKey(tile)
        ? () => <TileLayer uri={uri} index={index} tile={tile} width={width} height={height} retry={tileRetry} onFailure={key => tileFailure.fail(page + '|' + key)} /> : undefined} />;
  }
  // The download manager is about to deliver this page: wait for it (bounded) rather than start a device render.
  if (readPath && derivedFile === 'pending') return <View style={{ width: props.width, height: props.height, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }} pointerEvents="none"><ActivityIndicator color="#C7CCD6" /></View>;
  if (props.uri && useNativeSurface(nativePages, Platform.OS, props.width * (props.renderScale ?? 1)) && nativeFailed !== page)
    return <NativePdfPage {...props} uri={props.uri} onFailure={() => setNativeFailed(page)} />;
  return <ImagePdfPage {...props} />;
}
/** Base page drawn by the native PdfPageView (in-memory bitmap at screen resolution); zoom tiles stay on top as before. */
function NativePdfPage({ uri, index, width, height, renderScale = 1, tile: tileProp, sharp, onFailure }: RasterProps & { uri: string; onFailure: () => void }) {
  const tile = sharp === 'none' ? undefined : tileProp;
  const Surface = PdfPageSurface!; const page = uri + '|' + index;
  const tileRequest = page + '|' + pageTileKey(tile);
  const tileFailure = useTileFailure();
  const session = useRef<{ page: string; done?: () => void } | null>(null);
  if (session.current?.page !== page) { const s = surfaceLoads.begin(index); session.current = { page, done: s.ready('reading', nativePagePixels(width * renderScale, PixelRatio.get())) }; }
  const onPageReady = (e: { nativeEvent: PageReadyEvent }) => {
    if (e.nativeEvent.page !== index) return;
    if (!e.nativeEvent.ok) { onFailure(); return; }
    session.current?.done?.(); if (session.current) session.current.done = undefined;
  };
  return <View style={{ width, height, backgroundColor: '#fff' }} pointerEvents="none">
    <Surface source={uri} index={index} pixelWidth={nativePagePixels(width * renderScale, PixelRatio.get())} style={{ width, height }} onPageReady={onPageReady} />
    {/* The sharp layer must not depend on the base bitmap: it is rendered by the same native module either way, and gating
        it on a page-ready event used to leave the page permanently soft when that event was missed. */}
    {tile && PdfRenderer.hasRenderRegion() && tileFailure.failed !== tileRequest
      ? <View style={{ position: 'absolute', left: 0, top: 0, width, height }}><TileLayer uri={uri} index={index} tile={tile} width={width} height={height} retry={tileFailure.attempt} onFailure={key => tileFailure.fail(page + '|' + key)} /></View> : null}
  </View>;
}
function ImagePdfPage({ uri, index, width, height, renderScale = 1, tile: tileProp, sharp }: RasterProps) {
  const tile = sharp === 'none' ? undefined : tileProp;
  const allowed = useContext(PageQualityContext), { colors } = useTheme();
  const tileRequest = uri + '|' + index + '|' + pageTileKey(tile);
  const tileFailure = useTileFailure();
  const tileFirst = !!tile && PdfRenderer.hasRenderRegion() && tileFailure.failed !== tileRequest;
  // rs is cancelled here intentionally for the <=1200 reading image. Sharpness comes from the
  // actual viewport × zoom × DPR tile, not a capped full page stretched by the outer transform.
  // A tile that failed is the exception: the page widens to the detail raster instead of staying on the
  // small reading image, so a failed sharp layer can never leave the page visibly soft.
  const { src, reading, detail, presented, err, onLoad } = usePageImage(uri, index, width * renderScale, allowed && (!tileFirst || tileFailure.failed === tileRequest));
  return <View style={{ width, height, backgroundColor: '#fff' }} pointerEvents="none">
    {src ? <><PdfImageLayers reading={reading} detail={detail} width={width} height={height} onLoad={onLoad} />{uri && presented ? <TileLayer uri={uri} index={index} tile={tile} width={width} height={height} retry={tileFailure.attempt} onFailure={key => tileFailure.fail(uri + '|' + index + '|' + key)} /> : null}</> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{err ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>페이지를 불러오지 못했어요</Text> : <ActivityIndicator color={colors.primary} />}</View>}
  </View>;
}
/**
 * The sharp part of one page for the document's screen-space layer (iOS): a window of the page at exact screen pixels,
 * from the best server raster on disk or, failing that, the device PDF engine. Rendered OUTSIDE the zoom transform.
 */
export function PdfSharp({ uri, index, tile, box, motion }: { uri: string | null; index: number; tile?: PageTile; box: { x: number; y: number; w: number; h: number }; motion: SharpMotion }) {
  const page = uri + '|' + index; const dpr = PixelRatio.get();
  const derived = useContext(DerivedPagesContext);
  const readPath = uri && uri !== 'blank:' && derived ? pageImagePath(derived, index, 'reading') : null;
  const file = useDerivedFile(readPath);
  const plan = useDerivedSharpSource(readPath && file === 'present' ? derived : null, index, tile, box.w * dpr);
  const failure = useTileFailure();
  if (!uri || uri === 'blank:' || failure.failed === page + '|' + pageTileKey(tile)) return null;
  // A document without server pages shows the native page bitmap at screen resolution: a vector tile only adds
  // pixels once the page is magnified.
  const textbook = !!readPath && file !== 'absent';
  const needed = textbook ? plan.needed : !!tile && PdfRenderer.hasRenderRegion() && tile.pxW > Math.min(NATIVE_PAGE_MAX_PX, nativePagePixels(box.w, dpr)) * 1.05;
  return <TileLayer uri={uri} index={index} tile={tile} width={box.w} height={box.h} retry={failure.attempt} onFailure={key => failure.fail(page + '|' + key)} overlay={{ box, motion }} source={textbook ? plan.source : undefined} needed={needed} />;
}
export type { SharpMotion } from './SharpFrame';
export function clearImageCache() { work.reading.clear(); work.detail.clear(); PdfRenderer.clearPageBitmaps(); }
