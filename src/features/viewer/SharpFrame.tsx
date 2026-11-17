import React from 'react';
import { PixelRatio } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

/** The document transform a sharp tile was made for (zoom and offset of the content inside the viewport). */
export type TileAt = { z: number; tx: number; ty: number };
/** The live document transform and the viewport size, handed to the screen-space sharp layer. */
export type SharpMotion = { z: SharedValue<number>; tx: SharedValue<number>; ty: SharedValue<number>; width: number; height: number };

/**
 * Where a tile sits in the viewport at the transform it was made for, in points (pure, unit-tested).
 * `page` is the page box at zoom 1; `t` the tile's normalised window of that page; `px` the tile's pixels.
 * A tile whose pixels match the on-screen rectangle (the normal case) is laid out at exactly px ÷ dpr on a device
 * pixel boundary, so one tile pixel is one screen pixel: no resampling, no dependence on any image filter.
 */
export function sharpTileRect(page: { x: number; y: number; w: number; h: number }, t: { nx: number; ny: number; nw: number; nh: number }, px: { w: number; h: number }, at: TileAt, dpr: number) {
  const left = at.tx + (page.x + t.nx * page.w) * at.z, top = at.ty + (page.y + t.ny * page.h) * at.z;
  const width = t.nw * page.w * at.z, height = t.nh * page.h * at.z;
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const exact = Math.abs(width * dpr - px.w) <= 2 && Math.abs(height * dpr - px.h) <= 2;
  return { left: snap(left), top: snap(top), width: exact ? px.w / dpr : width, height: exact ? px.h / dpr : height, exact };
}
/**
 * How the layer moves with the document after the tile was made: the same content point stays under the same tile
 * point. Identity (scale 1, no offset) while the document rests where the tile was made (pure worklet, unit-tested).
 */
export function sharpMotionTransform(at: TileAt, z: number, tx: number, ty: number, width: number, height: number) {
  'worklet';
  const s = at.z > 0 ? z / at.z : 1;
  return { scale: s, translateX: tx - s * at.tx + ((s - 1) * width) / 2, translateY: ty - s * at.ty + ((s - 1) * height) / 2 };
}

/**
 * A viewport-sized layer OUTSIDE the document's zoom transform. Whatever is laid out inside it in viewport points is
 * composited at scale 1 while the document rests, and follows pans / pinches until the next tile replaces it.
 * This is what makes a magnified page sharp on iOS: inside the zoom transform Core Animation draws image layers from
 * a reduced copy whenever an ancestor scales them down (docs/ios-zoom-sharpness.md).
 */
export function SharpFrame({ at, motion, children }: { at: TileAt; motion: SharpMotion; children: React.ReactNode }) {
  const { z, tx, ty, width, height } = motion;
  const style = useAnimatedStyle(() => {
    const m = sharpMotionTransform(at, z.value, tx.value, ty.value, width, height);
    return { transform: [{ translateX: m.translateX }, { translateY: m.translateY }, { scale: m.scale }] };
  }, [at.z, at.tx, at.ty, width, height]);
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width, height }, style]}>{children}</Animated.View>;
}
export const devicePixelRatio = () => PixelRatio.get();
