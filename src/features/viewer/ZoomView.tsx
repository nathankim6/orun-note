import React, { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { Platform, View } from 'react-native';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import { lastLookupAt } from './InkCanvas';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, cancelAnimation } from 'react-native-reanimated';

export type ZoomHandle = { zoomTo: (scale: number, fx?: number, fy?: number) => void; reset: () => void; pinchBegin: (fx: number, fy: number) => void; pinchUpdate: (scale: number, fx: number, fy: number) => void; pinchEnd: () => void; getScale: () => number };
type Props = {
  width: number; height: number; // viewport size
  contentWidth: number; contentHeight: number; // unscaled content size (centered in the viewport when smaller)
  minScale?: number; maxScale?: number;
  onScaleChange?: (scale: number) => void; // fires continuously (throttled by RN batching) with the live scale
  onScaleSettled?: (scale: number) => void; // fires when a pinch ends; use for re-rendering at higher resolution
  onZoomedChange?: (zoomed: boolean) => void; // true while scale > 1 (parent disables paging scroll)
  /** The view owns all input (no ink layer underneath, e.g. 서브교재): two-finger pinch, pan with finger/stylus/mouse,
   *  and on web/desktop the mouse wheel pans and Ctrl/⌘ + wheel or trackpad pinch zooms around the cursor. */
  standalone?: boolean;
  children: React.ReactNode;
};
const IS_WEB = Platform.OS === 'web';
const clamp = (v: number, lo: number, hi: number) => { 'worklet'; return Math.max(lo, Math.min(hi, v)); };

/**
 * Pinch-to-zoom that is anchored at the fingers (focal point) and keeps the content inside the viewport.
 * Content is laid out at its natural size and transformed from the top-left corner, so the ink layer's
 * local coordinates stay valid at any zoom. Finger pans move the zoomed content; stylus touches are ignored
 * here so the ink canvas underneath receives them.
 */
export const ZoomView = forwardRef<ZoomHandle, Props>(function ZoomView({ width, height, contentWidth, contentHeight, minScale = 1, maxScale = 5, onScaleChange, onScaleSettled, onZoomedChange, standalone = false, children }, ref) {
  const scale = useSharedValue(1); const tx = useSharedValue((width - contentWidth) / 2); const ty = useSharedValue((height - contentHeight) / 2);
  const startScale = useSharedValue(1); const startTx = useSharedValue(0); const startTy = useSharedValue(0); const startFx = useSharedValue(0); const startFy = useSharedValue(0);
  const zoomed = useSharedValue(false); const pinching = useSharedValue(false); const panTx0 = useSharedValue(0); const panTy0 = useSharedValue(0);
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
  const pinchBeginJS = (fx: number, fy: number) => { cancelAnimation(tx); cancelAnimation(ty); cancelAnimation(scale); startScale.value = scale.value; startTx.value = tx.value; startTy.value = ty.value; startFx.value = fx; startFy.value = fy; };
  const pinchUpdateJS = (sc: number, fx: number, fy: number) => {
    const s = clamp(startScale.value * sc, minScale * 0.85, maxScale * 1.1);
    // Keep the content point that was under the initial focal point under the current focal point (GoodNotes behaviour):
    // zooming happens around the fingers and moving both fingers pans the page at the same time.
    tx.value = fx - (startFx.value - startTx.value) * (s / startScale.value);
    ty.value = fy - (startFy.value - startTy.value) * (s / startScale.value);
    scale.value = s; report(s);
  };
  const pinchEndJS = () => { const s = clamp(scale.value, minScale, maxScale); scale.value = withTiming(s, { duration: 160 }); const b = bounds(s); tx.value = withTiming(clamp(tx.value, b.minX, b.maxX), { duration: 160 }); ty.value = withTiming(clamp(ty.value, b.minY, b.maxY), { duration: 160 }); const z = s > 1.001; if (zoomed.value !== z) { zoomed.value = z; zoomedChange(z); } report(s); settled(s); };
  useImperativeHandle(ref, () => ({ zoomTo: zoomToJS, reset: () => zoomToJS(1), pinchBegin: pinchBeginJS, pinchUpdate: pinchUpdateJS, pinchEnd: pinchEndJS, getScale: () => scale.value }), [width, height, contentWidth, contentHeight]);


  // One-finger pan moves the zoomed content. Not active at 1x (the paging ScrollView handles swipes) and never for the stylus.
  const pan = Gesture.Pan().manualActivation(true).minPointers(1).maxPointers(2)
    .onTouchesDown((e, st) => { const pt = e.pointerType; if (!standalone && (pt === PointerType.STYLUS || (IS_WEB && pt === PointerType.MOUSE))) { st.fail(); return; } if (!zoomed.value) { st.fail(); return; } })
    .onTouchesMove((e, st) => { if (zoomed.value && st) st.activate(); })
    .onStart(() => { cancelAnimation(tx); cancelAnimation(ty); panTx0.value = tx.value; panTy0.value = ty.value; })
    .onUpdate((e) => {
      // while two fingers pinch, the pinch owns the transform; keep re-basing so the pan continues smoothly afterwards
      if (pinching.value) { panTx0.value = tx.value - e.translationX; panTy0.value = ty.value - e.translationY; return; }
      const b = bounds(scale.value); tx.value = clamp(panTx0.value + e.translationX, b.minX - 40, b.maxX + 40); ty.value = clamp(panTy0.value + e.translationY, b.minY - 40, b.maxY + 40);
    })
    .onEnd(() => { if (pinching.value) return; const b = bounds(scale.value); tx.value = withTiming(clamp(tx.value, b.minX, b.maxX), { duration: 160 }); ty.value = withTiming(clamp(ty.value, b.minY, b.maxY), { duration: 160 }); });

  // standalone: pinch anchored at the fingers (the content point under the fingers stays under them)
  const pinch = Gesture.Pinch().enabled(standalone)
    .onStart((e) => { pinching.value = true; cancelAnimation(tx); cancelAnimation(ty); cancelAnimation(scale); startScale.value = scale.value; startTx.value = tx.value; startTy.value = ty.value; startFx.value = e.focalX; startFy.value = e.focalY; })
    .onUpdate((e) => {
      const sc = clamp(startScale.value * e.scale, minScale * 0.85, maxScale * 1.1);
      tx.value = e.focalX - (startFx.value - startTx.value) * (sc / startScale.value);
      ty.value = e.focalY - (startFy.value - startTy.value) * (sc / startScale.value);
      scale.value = sc;
    })
    .onEnd(() => { const sc = clamp(scale.value, minScale, maxScale); scale.value = withTiming(sc, { duration: 160 }); settle(sc); })
    .onFinalize(() => { pinching.value = false; });

  // A double-tap on an English word opens the dictionary instead of zooming (InkCanvas records the lookup time).
  const maybeZoom = (target: number, x: number, y: number) => { setTimeout(() => { if (Date.now() - lastLookupAt < 500) return; zoomToJS(target, x, y); }, 60); };
  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(260)
    .onTouchesDown((e, st) => { if (!standalone && e.pointerType === PointerType.STYLUS) st.fail(); })
    .onEnd((e) => { runOnJS(maybeZoom)(scale.value > 1.001 ? 1 : 2.2, e.x, e.y); });

  const gesture = standalone ? Gesture.Simultaneous(pinch, pan, doubleTap) : Gesture.Simultaneous(pan, doubleTap);

  // web/desktop (standalone): wheel pans the zoomed page, Ctrl/⌘ + wheel and trackpad pinch zoom around the cursor
  const hostRef = useRef<any>(null); const wheelSettle = useRef<any>(null);
  useEffect(() => {
    if (!IS_WEB || !standalone) return; const node: HTMLElement | null = hostRef.current; if (!node?.addEventListener) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault(); ev.stopPropagation();
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? height : 1; const r = node.getBoundingClientRect(); const fx = ev.clientX - r.left, fy = ev.clientY - r.top;
      cancelAnimation(tx); cancelAnimation(ty);
      if (ev.ctrlKey || ev.metaKey) {
        cancelAnimation(scale); const s0 = scale.value; const s1 = clamp(s0 * Math.exp(-clamp(ev.deltaY * unit, -80, 80) * 0.005), minScale, maxScale); if (s1 === s0) return;
        const b = bounds(s1); tx.value = clamp(fx - (fx - tx.value) * (s1 / s0), b.minX, b.maxX); ty.value = clamp(fy - (fy - ty.value) * (s1 / s0), b.minY, b.maxY); scale.value = s1; report(s1);
      } else {
        const b = bounds(scale.value); const dx = ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX; const dy = ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY;
        tx.value = clamp(tx.value - dx * unit, b.minX, b.maxX); ty.value = clamp(ty.value - dy * unit, b.minY, b.maxY);
      }
      clearTimeout(wheelSettle.current); wheelSettle.current = setTimeout(() => { const sc = scale.value; const z = sc > 1.001; if (zoomed.value !== z) { zoomed.value = z; zoomedChange(z); } settled(sc); }, 180);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => { node.removeEventListener('wheel', onWheel); clearTimeout(wheelSettle.current); };
  }, [standalone, width, height, contentWidth, contentHeight, minScale, maxScale, onScaleSettled, onZoomedChange, onScaleChange]);
  // RN scales around the view center by default. Compensate so that (tx, ty) describe where the content's top-left
  // corner lands on screen, which is what the focal-point math above assumes. This avoids relying on transformOrigin.
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value + ((scale.value - 1) * contentWidth) / 2 }, { translateY: ty.value + ((scale.value - 1) * contentHeight) / 2 }, { scale: scale.value }] }));
  return (
    <GestureDetector gesture={gesture}>
      <View ref={hostRef} style={{ width, height, overflow: 'hidden' }} collapsable={false}>
        <Animated.View style={[{ width: contentWidth, height: contentHeight }, style]}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
});
