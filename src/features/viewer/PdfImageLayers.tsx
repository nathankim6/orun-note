import React, { useState } from 'react';
import { Image } from 'react-native';

/** Keep the decoded reading raster underneath until the sharp raster has loaded. */
export function PdfImageLayers({ reading, detail, width, height, onLoad }: {
  reading: string | null; detail: string | null; width: number; height: number; onLoad: (source: string) => void;
}) {
  const [loadedDetail, setLoadedDetail] = useState<string | null>(null);
  const underlay = !!reading && (!detail || loadedDetail !== detail);
  return <>
    {underlay && <Image key={`reading|${reading}`} source={{ uri: reading! }} style={{ width, height }} resizeMode="stretch" fadeDuration={0} onLoad={() => onLoad(reading!)} />}
    {detail && <Image key={`detail|${detail}`} source={{ uri: detail }} style={{ width, height, ...(underlay ? { position: 'absolute' as const, left: 0, top: 0 } : {}) }} resizeMode="stretch" fadeDuration={0} onLoad={() => { setLoadedDetail(detail); onLoad(detail); }} />}
  </>;
}
