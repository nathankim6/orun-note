import React from 'react';
import { PixelRatio, View } from 'react-native';
import { InkCanvas } from './InkCanvas';
import { SharpFrame, type SharpMotion, type TileAt } from './SharpFrame';
import type { ToolConfig } from './ink';
import type { Stroke } from '../../data/types';

/** Up to this magnification the ink under the zoom transform is already drawn at (about) screen resolution. */
export const INK_SHARP_MIN_ZOOM = 1.02;
/** Where the whole page lies in the viewport at the resting transform `at`, in points; its origin on a device pixel (pure, unit-tested). */
export function inkSharpPageRect(box: { x: number; y: number; w: number; h: number }, at: TileAt, dpr: number) {
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  return { left: snap(at.tx + box.x * at.z), top: snap(at.ty + box.y * at.z), width: box.w * at.z, height: box.h * at.z };
}
/** A crisp ink window is worth drawing: the page is magnified, has ink, and no selection / drag is going on (pure). */
export const inkSharpWanted = (tile: { at?: TileAt } | undefined, strokes: number, hidden: boolean) => !!tile?.at && !hidden && strokes > 0 && tile.at.z > INK_SHARP_MIN_ZOOM;
/** The input canvas leaves the crisp window to InkSharp exactly when InkSharp draws one (same rule on both sides). */
export const inkSharpElsewhere = (tile: { at?: TileAt } | undefined) => !!tile?.at && tile.at.z > INK_SHARP_MIN_ZOOM;

const NO_TEXT: never[] = []; const noop = () => {};
const IDLE: ToolConfig = { tool: 'hand', color: '#000000', width: 1, shape: 'rectangle', opacity: 1 };

/**
 * Finished ink of one page at screen resolution, for the document's viewport-space layer (iOS document surface).
 * Under the zoom transform iOS shows vector ink from a reduced copy as soon as its layer sits under a scale-down
 * (docs/ios-zoom-sharpness.md), so the magnified page gets its crisp ink here: laid out at the resting zoom, in a frame
 * that is the identity while the document rests and follows pans / pinches. The input canvas below keeps the stroke
 * being written, translucent ink, text and selection.
 */
export function InkSharp({ box, tile, motion, strokes, hidden = false }: { box: { x: number; y: number; w: number; h: number; s: number }; tile?: { nx: number; ny: number; nw: number; nh: number; at?: TileAt }; motion: SharpMotion; strokes: Stroke[]; hidden?: boolean }) {
  if (!tile || !inkSharpWanted(tile, strokes.length, hidden)) return null;
  const at = tile.at!; const r = inkSharpPageRect(box, at, PixelRatio.get());
  // One instance per resting transform: a new frame starts as the identity, so the new layout never meets the transform
  // that belonged to the previous one (the page tiles follow the same rule, one frame per tile image).
  return <SharpFrame key={`${at.z}|${at.tx}|${at.ty}`} at={at} motion={motion}>
    <View pointerEvents="none" style={{ position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height }}>
      <InkCanvas sharpOnly dense density={at.z} region={{ nx: tile.nx, ny: tile.ny, nw: tile.nw, nh: tile.nh }} width={r.width} height={r.height} s={box.s * at.z}
        strokes={strokes} textBoxes={NO_TEXT} cfg={IDLE} enabled={false} fingerDraw={false} readOnly onStrokes={noop} onTextBoxes={noop} />
    </View>
  </SharpFrame>;
}
