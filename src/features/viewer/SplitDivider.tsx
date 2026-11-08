import React, { useMemo } from 'react';
import { View, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';

/**
 * The bar between the main document and the 서브교재 in split view (화면 2분할). Drag it to resize the two panes: the bar
 * follows the finger / mouse and the panes re-layout once when it is released (no page re-render on every pixel).
 * Double-tap the bar for 50:50. `ratio` is the share of the 서브교재 pane (right / bottom).
 */
export function SplitDivider({ horiz, total, ratio, thickness, onRatio }: { horiz: boolean; total: number; ratio: number; thickness: number; onRatio: (r: number) => void }) {
  const off = useSharedValue(0); const active = useSharedValue(0);
  const pan = useMemo(() => Gesture.Pan().minDistance(1)
    .onStart(() => { active.value = 1; })
    .onUpdate((e) => {
      const d = horiz ? e.translationX : e.translationY;
      const r = Math.max(0.25, Math.min(0.75, ratio - d / Math.max(1, total))); // moving the bar right / down shrinks the 서브교재
      off.value = (ratio - r) * total;
    })
    .onEnd(() => { runOnJS(onRatio)(ratio - off.value / Math.max(1, total)); })
    .onFinalize(() => { off.value = 0; active.value = 0; }), [horiz, total, ratio, onRatio]);
  const dbl = useMemo(() => Gesture.Tap().numberOfTaps(2).onEnd(() => { runOnJS(onRatio)(0.5); }), [onRatio]);
  const gesture = useMemo(() => Gesture.Exclusive(dbl, pan), [dbl, pan]);
  const st = useAnimatedStyle(() => ({ transform: horiz ? [{ translateX: off.value }] : [{ translateY: off.value }], backgroundColor: active.value ? 'rgba(0,122,255,0.14)' : 'rgba(242,242,247,1)' }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View accessibilityLabel="화면 2분할 크기 조절" style={[{ width: horiz ? thickness : '100%', height: horiz ? '100%' : thickness, alignItems: 'center', justifyContent: 'center', zIndex: 30 }, Platform.OS === 'web' ? ({ cursor: horiz ? 'col-resize' : 'row-resize' } as any) : null, st]} collapsable={false}>
        <View style={horiz ? { position: 'absolute', left: thickness / 2 - 0.5, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(60,60,67,0.16)' } : { position: 'absolute', top: thickness / 2 - 0.5, left: 0, right: 0, height: 1, backgroundColor: 'rgba(60,60,67,0.16)' }} />
        <View style={{ width: horiz ? 5 : 46, height: horiz ? 46 : 5, borderRadius: 3, backgroundColor: 'rgba(60,60,67,0.38)' }} />
      </Animated.View>
    </GestureDetector>
  );
}
