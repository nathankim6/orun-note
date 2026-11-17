import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
export type StylusShortcutEvent = {
  kind: 'stylus-button' | 'pencil-double-tap' | 'pencil-squeeze';
  /** Screen coordinates in logical points/dp, not page or view coordinates. */
  x?: number;
  y?: number;
};
type Subscription = { remove(): void };
type Native = { addListener(name: string, listener: (event: StylusShortcutEvent) => void): Subscription; takeDiagnostics?: () => unknown };
const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<Native>('StylusShortcut');
/** Whether this binary includes the bridge, NOT whether the paired pencil supports the gesture. */
export const hasStylusShortcutBridge = () => native !== null;
/** Subscribe only while viewer is focused; remove on blur/unmount. Missing bridge/web is a no-op. */
export function addStylusShortcutListener(listener: (event: StylusShortcutEvent) => void): Subscription {
  const sub = native?.addListener('onStylusShortcut', listener);
  let removed = false;
  return { remove() { if (!removed) { removed = true; sub?.remove(); } } };
}

/**
 * Field diagnosis: what the pen sent since the last call (event counts and button/key codes only). Null when the
 * bridge is missing or nothing was observed. Used to learn which form a pen-button press takes on a real device.
 */
export async function takeStylusDiagnostics(): Promise<Record<string, unknown> | null> {
  try { const d = await native?.takeDiagnostics?.(); return d && typeof d === 'object' ? (d as Record<string, unknown>) : null; } catch { return null; }
}
/** Pure summary for the diagnostics channel; null when no pen-button-like signal was seen at all. */
export function stylusDiagnosticsSummary(d: Record<string, unknown> | null, os: string): string | null {
  if (!d) return null;
  const n = (k: string) => (typeof d[k] === 'number' && Number.isFinite(d[k] as number) ? Math.round(d[k] as number) : 0);
  const list = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]).filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(0, 12).join(',') : '');
  if (os === 'android') {
    const pressed = list('buttonStates') || list('actionButtons') || list('vendorActions') || list('keyCodes');
    if (!pressed && !n('emitted')) return null;
    return `stylus shortcut android emitted=${n('emitted')} stylusEvents=${n('stylusEvents')} hover=${n('hoverEvents')} unfocused=${n('unfocused')} buttonStates=[${list('buttonStates')}] actionButtons=[${list('actionButtons')}] vendorActions=[${list('vendorActions')}] keyCodes=[${list('keyCodes')}]`;
  }
  if (!n('tap') && !n('squeeze') && !n('emitted')) return null;
  return `stylus shortcut ios emitted=${n('emitted')} tap=${n('tap')} squeeze=${n('squeeze')} tapPreferenceOff=${n('tapPreferenceOff')} squeezePreferenceOff=${n('squeezePreferenceOff')} notKeyOrActive=${n('notKeyOrActive')} preferredTap=${n('preferredTap')} preferredSqueeze=${n('preferredSqueeze')}`;
}
