import React, { useContext, useEffect, useRef, useState } from 'react';
import { View, Image, PixelRatio } from 'react-native';
import { PageQualityContext } from './pageQuality';
import { useDerivedFile, requestZoomPage, zoomAvailable, zoomRecentlyFailed, noteZoomUse, zoomHabitual } from './derivedPages';
import { pageImagePath, zoomImagePath, tierWidth, fullResImageStyle, zoomTierWanted, vectorTileWanted, tierIsEnough, ZOOM_WIDTH, type DerivedInfo } from './derivedPagesCore';
import type { PageTile } from './pdfTileGeometry';
import { PdfRenderer } from '../../../modules/pdf-renderer';

export type DerivedTierImage = { key: 'reading' | 'detail' | 'zoom'; uri: string; px: number };
/**
 * Which server rasters a page shows (pure, unit-tested). Lower tiers stay underneath a sharper one, so a tier that is
 * still decoding never leaves a hole and dropping the zoom image never flashes.
 *  - reading: always (the page itself)
 *  - detail:  at once when the reading raster cannot cover the page box even un-magnified (tablets): the page is
 *             sharp from the first frame instead of soft-then-sharp, and neighbours are decoded before the page turn.
 *             Otherwise once the page was settled and visible (sticky for this page).
 *  - zoom:    while the magnified page needs more pixels than the detail raster has, and the file is on disk
 */
export function derivedTiers(o: { reading: string; readingPx: number; detail: string | null; detailPx: number; detailOn: boolean; zoom: string | null; zoomOn: boolean }): DerivedTierImage[] {
  const out: DerivedTierImage[] = [{ key: 'reading', uri: o.reading, px: o.readingPx }];
  if (o.detail && o.detailOn && o.detailPx > o.readingPx) out.push({ key: 'detail', uri: o.detail, px: o.detailPx });
  if (o.zoom && o.zoomOn) out.push({ key: 'zoom', uri: o.zoom, px: ZOOM_WIDTH });
  return out;
}
/**
 * Whether the device PDF engine is asked for a vector tile on top of the server rasters (pure, unit-tested).
 * `zoomState`: 'present' on disk · 'coming' (available, not on disk yet) · 'none' (platform/material has no zoom
 * tier, or its download just failed, e.g. offline: the device engine is then the only way to sharpen). While the zoom image is coming the tile waits for it: starting the engine for
 * a region the image is about to cover costs seconds of CPU and hundreds of MB on textbook pages.
 */
export function wantsVectorTile(o: { neededPx: number; detailPx: number; zoomState: 'present' | 'coming' | 'none' }): boolean {
  if (!(o.neededPx > 0) || tierIsEnough(o.detailPx, o.neededPx)) return false; // the detail raster already covers it
  return o.zoomState === 'none' ? true : vectorTileWanted(o.neededPx, ZOOM_WIDTH);
}

/** The detail raster is the page's first image when the reading raster is too small for the un-magnified page box. */
export const detailFirst = (basePx: number, readingPx: number) => basePx > 0 && !tierIsEnough(readingPx, basePx);
type Props = {
  info: DerivedInfo; index: number; width: number; height: number; tile?: PageTile;
  /** width of the page box in device pixels without magnification */ basePx?: number;
  /** 'none': only the page itself (reading / detail at the box size); the screen-space sharp layer adds the rest (iOS) */ sharp?: 'inline' | 'none';
  /** renders the device-engine vector tile layer (PdfPage owns TileLayer; passed in to avoid an import cycle) */
  renderTile?: () => React.ReactNode;
};
/**
 * A textbook page shown from the server's pre-rendered images only (docs/derived-pages.md): reading → detail → zoom.
 * The device PDF engine is not involved unless the magnification exceeds every server raster.
 */
export function DerivedPdfPage(props: Props) { return props.sharp === 'none' ? <DerivedPaper {...props} /> : <DerivedInlinePage {...props} />; }
/** The page at its own box size: reading raster, plus the detail raster when the box needs it or once settled. */
function DerivedPaper({ info, index, width, height, basePx = 0 }: Props) {
  const allowed = useContext(PageQualityContext);
  const reading = pageImagePath(info, index, 'reading')!, detail = pageImagePath(info, index, 'detail');
  const readingPx = tierWidth(info, 'reading') ?? 1200, detailPx = tierWidth(info, 'detail') ?? readingPx;
  const detailFile = useDerivedFile(detail === reading ? null : detail);
  const [settled, setSettled] = useState(false);
  useEffect(() => { if (allowed && !settled) setSettled(true); }, [allowed, settled]);
  const tiers = derivedTiers({ reading, readingPx, detail: detailFile === 'present' ? detail : null, detailPx, detailOn: settled || detailFirst(basePx, readingPx), zoom: null, zoomOn: false });
  // Plain layout at the box size: the platform decodes to (at most) the box's device pixels, and no scale below 1
  // ever applies to these layers.
  return <View style={{ width, height, backgroundColor: '#fff' }} pointerEvents="none">
    {tiers.map((t) => <Image key={t.key} source={{ uri: t.uri }} style={{ position: 'absolute', left: 0, top: 0, width, height }} resizeMode="stretch" fadeDuration={0} />)}
  </View>;
}
/**
 * What the screen-space sharp layer shows for a textbook page (pure, unit-tested).
 *  - 'none'   the page under it already has the pixels (un-magnified, or slightly magnified)
 *  - 'crop'   a window of the best server raster on disk, resampled once to exact screen pixels
 *  - 'vector' the device PDF engine: no usable raster, or the magnification exceeds every raster by the vector margin
 * `paperPx` = pixels the page layer really shows (its raster, limited by the box). While the zoom image is still
 * downloading the detail raster is cropped, never the engine started.
 */
export function derivedSharpPlan(o: { neededPx: number; paperPx: number; detailPx: number; detailOnDisk: boolean; zoomState: 'present' | 'coming' | 'none'; canCrop: boolean; canVector: boolean }): { kind: 'none' | 'crop' | 'vector'; tier?: 'detail' | 'zoom' } {
  if (!(o.neededPx > 0) || tierIsEnough(o.paperPx, o.neededPx)) return { kind: 'none' };
  const tier = o.zoomState === 'present' ? 'zoom' : o.detailOnDisk && o.detailPx > o.paperPx ? 'detail' : undefined;
  const tierPx = tier === 'zoom' ? ZOOM_WIDTH : tier === 'detail' ? o.detailPx : 0;
  const best = o.zoomState === 'none' ? Math.max(tierPx, o.paperPx) : ZOOM_WIDTH; // a coming zoom image counts: wait for it
  if (o.canVector && (vectorTileWanted(o.neededPx, best) || (o.zoomState === 'none' && !tierIsEnough(best, o.neededPx) && !tier))) return { kind: 'vector' };
  if (tier && !o.canCrop) return o.canVector ? { kind: 'vector' } : { kind: 'none' }; // a binary without the crop function
  if (tier && o.canCrop) return { kind: 'crop', tier };
  if (o.canVector && o.zoomState === 'none') return { kind: 'vector' };
  return { kind: 'none' };
}
/** Source for the screen-space sharp layer of a textbook page; also fetches the zoom image when it is wanted. */
export function useDerivedSharpSource(info: DerivedInfo | null, index: number, tile: PageTile | undefined, basePx: number) {
  const allowed = useContext(PageQualityContext);
  const reading = pageImagePath(info, index, 'reading'), detail = pageImagePath(info, index, 'detail'), zoom = zoomImagePath(info, index);
  const readingPx = info ? tierWidth(info, 'reading') ?? 1200 : 0, detailPx = info ? tierWidth(info, 'detail') ?? readingPx : 0;
  const detailFile = useDerivedFile(detail && detail !== reading ? detail : null);
  const canZoom = zoomAvailable(info);
  const zoomFile = useDerivedFile(canZoom ? zoom : null, 0);
  const neededPx = tile?.pxW ?? 0;
  const zoomWanted = canZoom && zoomTierWanted(neededPx, detailPx);
  useEffect(() => { if (zoomWanted) noteZoomUse(); }, [zoomWanted]);
  useEffect(() => { if (info && allowed && zoomFile !== 'present' && (zoomWanted || (canZoom && zoomHabitual()))) requestZoomPage(info, index); }, [zoomWanted, allowed, zoomFile, canZoom, info, index]);
  if (!info) return { needed: false, source: undefined, vector: false } as const;
  const paperPx = Math.min(detailFile === 'present' ? detailPx : readingPx, basePx > 0 ? basePx : readingPx);
  const zoomState = !canZoom || (!!zoom && zoomFile !== 'present' && zoomRecentlyFailed(zoom)) ? 'none' : zoomFile === 'present' ? 'present' : 'coming';
  const plan = derivedSharpPlan({ neededPx, paperPx, detailPx, detailOnDisk: detailFile === 'present', zoomState, canCrop: PdfRenderer.hasCropImage(), canVector: PdfRenderer.hasRenderRegion() });
  if (plan.kind === 'none') return { needed: false, source: undefined, vector: false } as const;
  if (plan.kind === 'vector') return { needed: true, source: undefined, vector: true } as const;
  const path = plan.tier === 'zoom' ? zoom! : detail!;
  return { needed: true, vector: false, source: { key: 'crop|' + path, render: (t: PageTile) => PdfRenderer.cropImage(path, t.pxW, t.x, t.y, t.w, t.h) } } as const;
}
function DerivedInlinePage({ info, index, width, height, tile, basePx = 0, renderTile }: Props) {
  const allowed = useContext(PageQualityContext), dpr = PixelRatio.get();
  const reading = pageImagePath(info, index, 'reading')!, detail = pageImagePath(info, index, 'detail'), zoom = zoomImagePath(info, index);
  const readingPx = tierWidth(info, 'reading') ?? 1200, detailPx = tierWidth(info, 'detail') ?? readingPx;
  const detailFile = useDerivedFile(detail === reading ? null : detail);
  const canZoom = zoomAvailable(info);
  const zoomFile = useDerivedFile(canZoom ? zoom : null, 0);
  // Sticky per page: a page that was settled once keeps its detail raster through later motion.
  const [settled, setSettled] = useState(false);
  useEffect(() => { if (allowed && !settled) setSettled(true); }, [allowed, settled]);
  const detailOn = settled || detailFirst(basePx, readingPx);
  // Magnification is known from the settled viewport tile (pxW = whole page width in device px at this zoom).
  const neededPx = tile?.pxW ?? 0;
  const zoomWanted = canZoom && zoomTierWanted(neededPx, detailPx);
  // Keep the zoom raster through motion (tile is only recomputed when settled); drop it once it is no longer needed.
  const zoomOnRef = useRef(false);
  if (tile) zoomOnRef.current = zoomWanted; else if (!canZoom) zoomOnRef.current = false;
  // A reader who magnified once is likely to do it again: from then on the zoom image of each page they settle on is
  // fetched ahead, so the next magnification is sharp without waiting for the network.
  useEffect(() => { if (zoomWanted) noteZoomUse(); }, [zoomWanted]);
  useEffect(() => { if (allowed && zoomFile !== 'present' && (zoomWanted || (canZoom && zoomHabitual()))) requestZoomPage(info, index); }, [zoomWanted, allowed, zoomFile, canZoom, info, index]);
  const tiers = derivedTiers({ reading, readingPx, detail: detailFile === 'present' ? detail : null, detailPx, detailOn, zoom: zoomFile === 'present' ? zoom : null, zoomOn: zoomOnRef.current });
  const zoomState = !canZoom || (!!zoom && zoomFile !== 'present' && zoomRecentlyFailed(zoom)) ? 'none' : zoomFile === 'present' ? 'present' : 'coming';
  const vector = !!tile && !!renderTile && wantsVectorTile({ neededPx, detailPx, zoomState });
  return <View style={{ width, height, backgroundColor: '#fff' }} pointerEvents="none">
    {tiers.map((t) => <Image key={t.key} source={{ uri: t.uri }} // The reading raster keeps the plain layout (thumbnails and page strips decode it at their own small size); the
      // sharper tiers are laid out at their pixel size so no source pixel is dropped under the zoom transform.
      style={t.key === 'reading' ? { position: 'absolute', left: 0, top: 0, width, height } : fullResImageStyle(t.px, width, height, dpr)} resizeMode="stretch" fadeDuration={0} />)}
    {vector ? <View style={{ position: 'absolute', left: 0, top: 0, width, height }}>{renderTile!()}</View> : null}
  </View>;
}
