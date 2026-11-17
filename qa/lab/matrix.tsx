// Compositing matrix (viewer lab, iOS question): ONE sharp bitmap of the resolution gratings, shown at exactly one
// bitmap pixel per screen pixel through different layer structures. Every cell ends at the same size on screen; only
// the chain of transforms / clips above the image differs. Whatever a cell loses is lost by compositing alone.
import React, { useEffect } from 'react';
import { Image, PixelRatio, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SharpFrame } from '../../src/features/viewer/SharpFrame';
import { LAB_TARGET } from './pdf.generated';

export type MatrixCell = { name: string; rects: { bar: number; barPx: number; x: number; y: number; w: number; h: number }[] };
const ROW_LABEL = 18, LEFT = 16, TOP = 8, GAP = 6;
const tl = { transformOrigin: 'top left' } as const;

export function CompositingMatrix({ src, px, origin, width, height, onCells }: { src: string; px: { w: number; h: number }; origin: { x: number; y: number }; width: number; height: number; onCells: (cells: MatrixCell[]) => void }) {
  const dpr = PixelRatio.get(); const W0 = px.w / dpr, H0 = px.h / dpr; const rowH = ROW_LABEL + H0 + GAP;
  const two = useSharedValue(2); const up2 = useAnimatedStyle(() => ({ transform: [{ scale: two.value }] }));
  const z = useSharedValue(2), tx = useSharedValue(0), ty = useSharedValue(0);
  const img = (style: object = { width: W0, height: H0 }) => <Image source={{ uri: src }} style={style} resizeMode="stretch" fadeDuration={0} />;
  const half = { width: W0 / 2, height: H0 / 2 };
  const cells: { name: string; node: (top: number) => React.ReactNode }[] = [
    { name: 'plain', node: () => img() },
    { name: 'down2-up2', node: () => <View style={[half, { transform: [{ scale: 2 }] }, tl]}><View style={[{ width: W0, height: H0, transform: [{ scale: 0.5 }] }, tl]}>{img()}</View></View> },
    { name: 'down4-up4', node: () => <View style={[{ width: W0 / 4, height: H0 / 4, transform: [{ scale: 4 }] }, tl]}><View style={[{ width: W0, height: H0, transform: [{ scale: 0.25 }] }, tl]}>{img()}</View></View> },
    { name: 'down2-roundclip-up2', node: () => <View style={[half, { transform: [{ scale: 2 }] }, tl]}><View style={[half, { borderRadius: 3, overflow: 'hidden' }]}><View style={[{ width: W0, height: H0, transform: [{ scale: 0.5 }] }, tl]}>{img()}</View></View></View> },
    { name: 'image-scaled-down2-up2', node: () => <View style={[half, { transform: [{ scale: 2 }] }, tl]}>{img([{ width: W0, height: H0, transform: [{ scale: 0.5 }] }, tl])}</View> },
    { name: 'reanimated-up2', node: () => <Animated.View style={[half, tl, up2]}><View style={[{ width: W0, height: H0, transform: [{ scale: 0.5 }] }, tl]}>{img()}</View></Animated.View> },
    { name: 'half-layout-up2', node: () => <View style={[half, { transform: [{ scale: 2 }] }, tl]}>{img(half)}</View> },
    // the production sharp layer: a frame made for zoom 2 while the document is at zoom 2 = identity
    { name: 'sharp-frame', node: (top) => <SharpFrame at={{ z: 2, tx: 0, ty: 0 }} motion={{ z, tx, ty, width, height }}>{img({ position: 'absolute', left: LEFT, top, width: W0, height: H0 })}</SharpFrame> },
  ];
  useEffect(() => {
    const g = LAB_TARGET.gratings; const k = px.w / ((g[g.length - 1].x + g[g.length - 1].w - g[0].x) + 8); const pad = 4 * k;
    onCells(cells.map((c, r) => { const top = TOP + r * rowH + ROW_LABEL; return { name: c.name, rects: g.map((q) => ({ bar: q.bar, barPx: q.bar * k, x: (origin.x + LEFT) * dpr + pad + (q.x - g[0].x) * k, y: (origin.y + top) * dpr + pad, w: q.w * k, h: q.h * k })) }; }));
  }, [src, px.w, px.h, origin.x, origin.y]);
  return <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height, backgroundColor: '#fff' }}>
    {cells.map((c, r) => { const top = TOP + r * rowH; return <React.Fragment key={c.name}>
      <Text style={{ position: 'absolute', left: LEFT, top, fontSize: 11, color: '#334155' }}>{c.name}</Text>
      {c.name === 'sharp-frame' ? c.node(top + ROW_LABEL) : <View style={{ position: 'absolute', left: LEFT, top: top + ROW_LABEL, width: W0, height: H0 }}>{c.node(0)}</View>}
    </React.Fragment>; })}
  </View>;
}
