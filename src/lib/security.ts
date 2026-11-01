import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';

/**
 * Content protection for the whole app:
 * - Android: FLAG_SECURE (blocks screenshots, screen recording, mirroring; recents thumbnail is blank)
 * - iOS: secure window layer (screenshots/recordings/mirroring show black) + blurred app switcher snapshot
 * - Both: a privacy overlay while the app is inactive/backgrounded as a fallback.
 * Returns whether the privacy overlay should be shown and the last screenshot attempt count (iOS detection).
 */
export function useContentProtection() {
  const [hidden, setHidden] = useState(false); const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let sub: any;
    (async () => {
      try { await ScreenCapture.preventScreenCaptureAsync('paperly'); } catch {}
      try { await ScreenCapture.enableAppSwitcherProtectionAsync(60); } catch {}
      try { sub = ScreenCapture.addScreenshotListener(() => setAttempts((n) => n + 1)); } catch {}
    })();
    const st = AppState.addEventListener('change', (s) => setHidden(s !== 'active'));
    return () => { st.remove(); sub?.remove?.(); ScreenCapture.allowScreenCaptureAsync('paperly').catch(() => {}); ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {}); };
  }, []);
  return { hidden, attempts };
}
