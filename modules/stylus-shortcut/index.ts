import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
export type StylusShortcutEvent = {
  kind: 'stylus-button' | 'pencil-double-tap' | 'pencil-squeeze';
  /** Screen coordinates in logical points/dp, not page or view coordinates. */
  x?: number;
  y?: number;
};
type Subscription = { remove(): void };
type Native = { addListener(name: string, listener: (event: StylusShortcutEvent) => void): Subscription };
const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<Native>('StylusShortcut');
/** Whether this binary includes the bridge, NOT whether the paired pencil supports the gesture. */
export const hasStylusShortcutBridge = () => native !== null;
/** Subscribe only while viewer is focused; remove on blur/unmount. Missing bridge/web is a no-op. */
export function addStylusShortcutListener(listener: (event: StylusShortcutEvent) => void): Subscription {
  const sub = native?.addListener('onStylusShortcut', listener);
  let removed = false;
  return { remove() { if (!removed) { removed = true; sub?.remove(); } } };
}
