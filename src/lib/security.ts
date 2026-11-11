import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { createProtectionQueue } from './capturePolicy';

const protection = createProtectionQueue({
  prevent: () => ScreenCapture.preventScreenCaptureAsync('paperly'),
  allow: () => ScreenCapture.allowScreenCaptureAsync('paperly'),
  enableSwitcher: () => ScreenCapture.enableAppSwitcherProtectionAsync(0.6),
  disableSwitcher: () => ScreenCapture.disableAppSwitcherProtectionAsync(),
});

/** Android FLAG_SECURE / iOS secure layer are disabled for admins only.
 * Inactive/background privacy stays enabled for everyone. A protected screen is
 * covered until the latest native prevent call completes, including fast role switches.
 */
export function useContentProtection(required = true) {
  const protect = required !== false;
  const [hidden, setHidden] = useState(Platform.OS !== 'web' && AppState.currentState !== 'active');
  const [attempts, setAttempts] = useState(0);
  const [appliedRevision, setAppliedRevision] = useState(-1);
  const mounted = useRef(false);
  const policy = useRef({ protect, revision: 0 });
  if (policy.current.protect !== protect) policy.current = { protect, revision: policy.current.revision + 1 };
  const revision = policy.current.revision;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    mounted.current = true;
    void protection.switcher(true).catch(() => {});
    const subscription = AppState.addEventListener('change', state => setHidden(state !== 'active'));
    return () => {
      mounted.current = false;
      subscription.remove();
      void protection.capture(false).catch(() => {});
      void protection.switcher(false).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    setAttempts(0);
    void protection.capture(protect).then(() => {
      if (!cancelled && mounted.current && policy.current.revision === revision) setAppliedRevision(revision);
    }).catch(() => { /* Protected content remains covered; never claim a failed prevent succeeded. */ });
    let screenshot: { remove(): void } | undefined;
    if (protect) {
      try {
        screenshot = ScreenCapture.addScreenshotListener(() => {
          if (!cancelled && policy.current.protect && policy.current.revision === revision) setAttempts(n => n + 1);
        });
      } catch { /* Screenshot detection is optional; native prevention is independent. */ }
    }
    return () => { cancelled = true; screenshot?.remove(); };
  }, [protect, revision]);

  return { hidden, attempts, protectionPending: Platform.OS !== 'web' && protect && appliedRevision !== revision };
}
