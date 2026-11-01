import React, { useEffect, useImperativeHandle, forwardRef } from 'react';
import { Platform } from 'react-native';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, cancelAnimation } from 'react-native-reanimated';

export type ZoomHandle = { zoomTo: (scale: number, fx?: number, fy?: number) => void; reset: () => void };
type Props = {
  width: number; height: number; // viewport size
  contentWidth: number; contentHeight: number; // unscaled content size (centered in the viewport when smaller)
  minScale?: number; maxScale?: number;
  onScaleChange?: (scale: number) => void; // fires continuously (throttled by RN batching) with the live scale
  onScaleSettled?: (scale: number) => void; // fires when a pinch ends; use for re-rendering at higher resolution
  onZoomedChange?: (zoomed: boolean) => void; // true while scale > 1 (parent disables paging scroll)
  children: React.ReactNode;
};
const clamp = (v: number, lo: number, hi: number) => { 'worklet'; return Math.max(lo, Math.min(hi, v)); };

/**
 * Pinch-to-zoom that is anchored at the fingers (focal point) and keeps the content inside the viewport.
 * Content is laid out at its natural size and transformed from the top-left corner, so the ink layer's
 * local coordinates stay valid at any zoom. Finger pans move the zoomed content; stylus touches are ignored
 * here so the ink canvas underneath receives them.
 */
export const ZoomView = forwardRef<ZoomHandle, Props>(function ZoomView({ width, height, contentWidth, contentHeight, minScale = 1, maxScale = 5, onScaleChange, onScaleSettled, onZoomedChange, children }, ref) {
  const scale = useSharedValue(1); const tx = useSharedValue((width - contentWidth) / 2); const ty = useSharedValue((height - contentHeight) / 2);
  const startScale = useSharedValue(1); const startTx = useSharedValue(0); const startTy = useSharedValue(0); const startFx = useSharedValue(0); const startFy = useSharedValue(0);
  const zoomed = useSharedValue(false);
  const report = (s: number) => onScaleChange?.(s); const settled = (s: number) => onScaleSettled?.(s); const zoomedChange = (z: boolean) => onZoomedChange?.(z);

  // Base offset centers the content when it is smaller than the viewport; otherwise clamp so no empty gap shows.
  const bounds = (s: number) => { 'worklet';
    const cw = contentWidth * s, ch = contentHeight * s;
    const minX = cw > width ? width - cw : (width - cw) / 2, maxX = cw > width ? 0 : (width - cw) / 2;
    const minY = ch > height ? height - ch : (height - ch) / 2, maxY = ch > height ? 0 : (height - ch) / 2;
    return { minX, maxX, minY, maxY };
  };
  const settle = (s: number) => { 'worklet';
    const b = bounds(s); tx.value = withTiming(clamp(tx.value, b.minX, b.maxX), { duration: 160 }); ty.value = withTiming(clamp(ty.value, b.minY, b.maxY), { duration: 160 });
    const z = s > 1.001; if (zoomed.value !== z) { zoomed.value = z; runOnJS(zoomedChange)(z); }
    runOnJS(settled)(s);
  };
  useEffect(() => { // viewport/content size changed (rotation, layout mode): re-center at current scale
    const b = bounds(scale.value); tx.value = clamp(tx.value, b.minX, b.maxX); ty.value = clamp(ty.value, b.minY, b.maxY);
  }, [width, height, contentWidth, contentHeight]);

  const zoomToJS = (target: number, fx = width / 2, fy = height / 2) => {
    const s0 = scale.value, s1 = clamp(target, minScale, maxScale);
    const nx = fx - (fx - tx.value) * (s1 / s0), ny = fy - (fy - ty.value) * (s1 / s0);
    const b = bounds(s1);
    scale.value = withTiming(s1, { duration: 220 }); tx.value = withTiming(clamp(nx, b.minX, b.maxX), { duration: 220 }); ty.value = withTiming(clamp(ny, b.minY, b.maxY), { duration: 220 });
    const z = s1 > 1.001; if (zoomed.value !== z) { zoomed.value = z; zoomedChange(z); } report(s1); settled(s1);
  };
  useImperativeHandle(ref, () => ({ zoomTo: zoomToJS, reset: () => zoomToJS(1) }), [width, height, contentWidth, contentHeight]);

  const pinch = Gesture.Pinch()
    .onStart((e) => { cancelAnimation(tx); cancelAnimation(ty); startScale.value = scale.value; startTx.value = tx.value; startTy.value = ty.value; startFx.value = e.focalX; startFy.value = e.focalY; })
    .onUpdate((e) => {
      const s = clamp(startScale.value * e.scale, minScale * 0.7, maxScale * 1.15); // small overshoot, springs back on end
      // Keep the content point that was under the initial focal point under the current focal point.
      tx.value = e.focalX - (startFx.value - startTx.value) * (s / startScale.value);
      ty.value = e.focalY - (startFy.value - startTy.value) * (s / startScale.value);
      scale.value = s; runOnJS(report)(s);
    })
    .onEnd(() => { const s = clamp(scale.value, minScale, maxScale); scale.value = withTiming(s, { duration: 160 }); settle(s); runOnJS(report)(s); });

  // One-finger pan moves the zoomed content. Not active at 1x (the paging ScrollView handles swipes) and never for the stylus.
  const pan = Gesture.Pan().manualActivation(true).minPointers(1).maxPointers(2)
    .onTouchesDown((e, st) => { const t = e.changedTouches[0]; const pt = (t as any)?.pointerType; if (pt === PointerType.STYLUS || (Platform.OS === 'web' && pt === PointerType.MOUSE)) { st.fail(); return; } if (!zoomed.value) { st.fail(); return; } })
    .onTouchesMove((e, st) => { if (zoomed.value && st) st.activate(); })
    .onStart(() => { cancelAnimation(tx); cancelAnimation(ty); startTx.value = tx.value; startTy.value = ty.value; })
    .onUpdate((e) => { const b = bounds(scale.value); tx.value = clamp(startTx.value + e.translationX, b.minX - 40, b.maxX + 40); ty.value = clamp(startTy.value + e.translationY, b.minY - 40, b.maxY + 40); })
    .onEnd(() => { const b = bounds(scale.value); tx.value = withTiming(clamp(tx.value, b.minX, b.maxX), { duration: 160 }); ty.value = withTiming(clamp(ty.value, b.minY, b.maxY), { duration: 160 }); });

  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(260)
    .onTouchesDown((e, st) => { const pt = (e.changedTouches[0] as any)?.pointerType; if (pt === PointerType.STYLUS) st.fail(); })
    .onEnd((e) => { runOnJS(zoomToJS)(scale.value > 1.001 ? 1 : 2.2, e.x, e.y); });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={{ width, height, overflow: 'hidden' }} collapsable={false}>
        <Animated.View style={[{ width: contentWidth, height: contentHeight, transformOrigin: 'top left' as any }, style]}>{children}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});
