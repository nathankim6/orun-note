import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Over-the-air JS patches (expo-updates).
 *
 * - Launch: the native `checkAutomatically: "ON_LOAD"` check downloads a patch in the background
 *   (`fallbackToCacheTimeout: 0`, so it never delays the reader).
 * - Foreground resume: this hook re-checks quietly, at most once per interval, because a tablet
 *   can stay open for days in class.
 * - Apply: never during a session. A downloaded patch loads on the next cold start, so unsaved ink,
 *   scroll position and open viewer state are never thrown away by a reload. Docs: docs/ota-updates.md.
 */

/** Foreground re-check interval; the native ON_LOAD check already covers launches. */
export const OTA_RESUME_INTERVAL_MS = 30 * 60_000;

export type OtaResumeGate = {
  platform: string; enabled: boolean; busy: boolean; now: number; lastCheck: number; intervalMs?: number;
};

/** True only when a quiet foreground re-check is both possible and due. */
export function shouldFetchOnResume({ platform, enabled, busy, now, lastCheck, intervalMs = OTA_RESUME_INTERVAL_MS }: OtaResumeGate): boolean {
  if (platform !== 'ios' && platform !== 'android') return false; // web/desktop: no OTA runtime
  if (!enabled || busy) return false;
  return now - lastCheck >= intervalMs;
}

export type PatchFetchResult = 'downloaded' | 'none' | 'skipped' | 'failed';
type UpdatesLike = { isEnabled: boolean; fetchUpdateAsync: () => Promise<{ isNew: boolean }> };

/**
 * Downloads a patch if the update service has one. Never reloads and never throws: an offline
 * device, a withdrawn channel or a bad manifest leaves the running bundle untouched.
 */
export async function fetchPatchQuietly(updates: UpdatesLike): Promise<PatchFetchResult> {
  if (!updates?.isEnabled) return 'skipped';
  try {
    const result = await updates.fetchUpdateAsync();
    return result?.isNew ? 'downloaded' : 'none';
  } catch {
    return 'failed';
  }
}

/** Quiet resume check. Mount once, in the root layout. */
export function useOtaUpdateResumeCheck() {
  useEffect(() => {
    let alive = true, busy = false, lastCheck = Number.NEGATIVE_INFINITY;
    const run = () => {
      if (!alive) return;
      if (!shouldFetchOnResume({ platform: Platform.OS, enabled: !!Updates.isEnabled, busy, now: Date.now(), lastCheck })) return;
      busy = true; lastCheck = Date.now();
      void fetchPatchQuietly(Updates).finally(() => { busy = false; });
    };
    const sub = AppState.addEventListener('change', (state: string) => { if (state === 'active') run(); });
    return () => { alive = false; sub.remove(); };
  }, []);
}
