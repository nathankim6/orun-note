import React, { useContext, useEffect, useRef, useState } from 'react';
import { View, Image, PixelRatio } from 'react-native';
import { PageQualityContext } from './pageQuality';
import { useDerivedFile, requestZoomPage, zoomAvailable, zoomRecentlyFailed } from './derivedPages';
import { pageImagePath, zoomImagePath, tierWidth, fullResImageStyle, zoomTierWanted, vectorTileWanted, tierIsEnough, ZOOM_WIDTH, type DerivedInfo } from './derivedPagesCore';
import type { PageTile } from './pdfTileGeometry';

export type DerivedTierImage = { key: 'reading' | 'detail' | 'zoom'; uri: string; px: number };
/**
 * Which server rasters a page shows (pure, unit-tested). Lower tiers stay underneath a sharper one, so a tier that is
 * still decoding never leaves a hole and dropping the zoom image never flashes.
 *  - reading: always (the page itself)
 *  - detail:  once the page was settled and visible (sticky for this page)
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

type Props = {
  info: DerivedInfo; index: number; width: number; height: number; tile?: PageTile;
  /** renders the device-engine vector tile layer (PdfPage owns TileLayer; passed in to avoid an import cycle) */
  renderTile?: () => React.ReactNode;
};
/**
 * A textbook page shown from the server's pre-rendered images only (docs/derived-pages.md): reading → detail → zoom.
 * The device PDF engine is not involved unless the magnification exceeds every server raster.
 */
export function DerivedPdfPage({ info, index, width, height, tile, renderTile }: Props) {
  const allowed = useContext(PageQualityContext), dpr = PixelRatio.get();
  const reading = pageImagePath(info, index, 'reading')!, detail = pageImagePath(info, index, 'detail'), zoom = zoomImagePath(info, index);
  const readingPx = tierWidth(info, 'reading') ?? 1200, detailPx = tierWidth(info, 'detail') ?? readingPx;
  const detailFile = useDerivedFile(detail === reading ? null : detail);
  const canZoom = zoomAvailable(info);
  const zoomFile = useDerivedFile(canZoom ? zoom : null, 0);
  // Sticky per page: a page that was settled once keeps its detail raster through later motion.
  const [detailOn, setDetailOn] = useState(false);
  useEffect(() => { if (allowed && !detailOn) setDetailOn(true); }, [allowed, detailOn]);
  // Magnification is known from the settled viewport tile (pxW = whole page width in device px at this zoom).
  const neededPx = tile?.pxW ?? 0;
  const zoomWanted = canZoom && zoomTierWanted(neededPx, detailPx);
  // Keep the zoom raster through motion (tile is only recomputed when settled); drop it once it is no longer needed.
  const zoomOnRef = useRef(false);
  if (tile) zoomOnRef.current = zoomWanted; else if (!canZoom) zoomOnRef.current = false;
  useEffect(() => { if (zoomWanted && allowed && zoomFile !== 'present') requestZoomPage(info, index); }, [zoomWanted, allowed, zoomFile, info, index]);
  const tiers = derivedTiers({ reading, readingPx, detail: detailFile === 'present' ? detail : null, detailPx, detailOn, zoom: zoomFile === 'present' ? zoom : null, zoomOn: zoomOnRef.current });
  const zoomState = !canZoom || (!!zoom && zoomFile !== 'present' && zoomRecentlyFailed(zoom)) ? 'none' : zoomFile === 'present' ? 'present' : 'coming';
  const vector = !!tile && !!renderTile && wantsVectorTile({ neededPx, detailPx, zoomState });
  return <View style={{ width, height, backgroundColor: '#fff' }} pointerEvents="none">
    {tiers.map((t) => <Image key={t.key} source={{ uri: t.uri }} style={fullResImageStyle(t.px, width, height, dpr)} resizeMode="stretch" fadeDuration={0} />)}
    {vector ? <View style={{ position: 'absolute', left: 0, top: 0, width, height }}>{renderTile!()}</View> : null}
  </View>;
}
