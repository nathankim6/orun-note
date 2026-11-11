import type { ReviewVideo } from '@/lib/api';

/** Deliberately excludes native messages, request URLs, video IDs, and arbitrary numeric codes. */
export type StageErrorCode = 2 | 5 | 100 | 101 | 150 | 152 | 153 | 'network' | 'load' | 'http' | 'process' | 'timeout';
export function sanitizeStageErrorCode(code: unknown): StageErrorCode {
  if (code === 2 || code === 5 || code === 100 || code === 101 || code === 150 || code === 152 || code === 153) return code;
  if (code === 'network' || code === 'load' || code === 'http' || code === 'process' || code === 'timeout') return code;
  return 'load';
}

/** onError includes native details; read only known connectivity codes, never forward its payload. */
export function nativeLoadErrorCode(event: { nativeEvent?: { code?: unknown; domain?: unknown } } | null | undefined): StageErrorCode {
  const code = event?.nativeEvent?.code;
  // Android WebView ERROR_HOST_LOOKUP/CONNECT/IO/TIMEOUT/FAILED_SSL_HANDSHAKE.
  if (event?.nativeEvent?.domain == null && typeof code === 'number' && [-2, -6, -7, -8, -11].includes(code)) return 'network';
  // Apple's connectivity and TLS failures, only in the documented URL error domain.
  if (event?.nativeEvent?.domain === 'NSURLErrorDomain' && typeof code === 'number' && [-1001, -1003, -1004, -1005, -1006, -1008, -1009, -1018, -1020, -1200, -1201, -1202, -1203, -1204, -1205, -1206].includes(code)) return 'network';
  return 'load';
}

export type StageStatus = { ready: boolean; playing: boolean; ended: boolean; buffering: boolean; time: number; duration: number; loaded: number; error: string | null; errorCode?: StageErrorCode | null; playbackRate?: number; availablePlaybackRates?: number[] };
export type StageHandle = { play(): void; pause(): void; seek(seconds: number): void; setPlaybackRate(rate: number): void };
export const EMPTY_STATUS: StageStatus = { ready: false, playing: false, ended: false, buffering: false, time: 0, duration: 0, loaded: 0, error: null, errorCode: null, playbackRate: 1, availablePlaybackRates: [] };
export const validVideoId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{11}$/.test(id);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, fallback: string) => typeof v === 'string' && v.trim() ? v.trim() : fallback;

/** YouTube requires a 200 × 200 CSS-pixel iframe viewport. Its player letterboxes the video.
 * https://developers.google.com/youtube/iframe_api_reference#Requirements
 * Preserve the previous 16:9 tablet/fullscreen geometry wherever it already meets that minimum.
 */
export function reviewPlayerGeometry(width: number, height: number, insets: { top: number; bottom: number }, full: boolean) {
  const screenW = Math.max(0, width), screenH = Math.max(0, height);
  // Reduce side margins only if necessary to fit the minimum into a narrow physical screen.
  const maxW = Math.min(screenW, Math.max(Math.min(200, screenW), full ? screenW : Math.min(screenW - 40, 1040)));
  const availableH = full ? screenH : Math.max(0, screenH - insets.top - insets.bottom);
  const preferredH = full ? screenH : availableH - (screenW >= 700 ? 250 : 300);
  const stageW = Math.min(maxW, Math.max(240, Math.min(maxW, preferredH * 16 / 9)));
  // A sub-200 physical viewport cannot satisfy the API minimum; never overflow it trying.
  const stageH = Math.min(availableH, Math.max(200, stageW * 9 / 16));
  return { width: stageW, height: stageH };
}

export function normalizeReviewVideos(value: unknown): ReviewVideo[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((v): ReviewVideo[] => {
    if (!record(v) || !validVideoId(v.videoId)) return [];
    const id = text(v.id, v.videoId);
    if (seen.has(id)) return [];
    seen.add(id);
    const passageIds = new Set<string>();
    const passages = Array.isArray(v.passages) ? v.passages.flatMap((p, i) => {
      if (!record(p) || typeof p.title !== 'string' || !p.title.trim()) return [];
      const pid = text(p.id, `${id}-passage-${i}`);
      if (passageIds.has(pid)) return [];
      passageIds.add(pid);
      return [{ id: pid, title: p.title.trim() }];
    }) : [];
    return [{ id, videoId: v.videoId, title: text(v.title, '보강영상'), assignedAt: typeof v.assignedAt === 'string' ? v.assignedAt : '', passages }];
  });
}

export function stageError(code: unknown) {
  if (code === 100) return '영상을 찾을 수 없어요. 선생님께 알려 주세요.';
  if (code === 101 || code === 150 || code === 152) return '이 영상은 앱 안에서 재생할 수 없도록 설정되어 있어요. 선생님께 알려 주세요.';
  if (code === 153) return '영상 연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
  if (code === 'network' || code === 'timeout') return '영상을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
  return '영상을 재생하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

export function stageFailure(code: unknown): Partial<StageStatus> {
  const errorCode = sanitizeStageErrorCode(code);
  return { ready: false, playing: false, buffering: false, error: stageError(errorCode), errorCode };
}

/** Only the documented, bounded bridge messages can affect native UI state. */
export function bridgeStatus(raw: unknown): Partial<StageStatus> | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!record(m)) return null;
  if (m.k === 'ready' && finite(m.d)) return { ready: true, duration: m.d, error: null, errorCode: null };
  if (m.k === 'time' && finite(m.t) && finite(m.d) && finite(m.l)) return { time: m.t, duration: m.d, loaded: Math.min(1, m.l) };
  if (m.k === 'rate' && validPlaybackRate(m.r) && Array.isArray(m.a)) return { playbackRate: m.r, availablePlaybackRates: PLAYBACK_RATES.filter(r => (m.a as unknown[]).includes(r)) };
  if (m.k === 'state' && typeof m.s === 'number' && [-1, 0, 1, 2, 3, 5].includes(m.s)) return { playing: m.s === 1, buffering: m.s === 3, ended: m.s === 0 };
  if (m.k === 'error' && ((typeof m.c === 'number' && Number.isFinite(m.c)) || ['network', 'load', 'http', 'process', 'timeout'].includes(m.c as string))) return stageFailure(m.c);
  return null;
}

// Official mobile WebView client identity guidance (not proof that observed failures are 153):
// https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity
// baseUrl's HTTPS host is the installed bundle/package identifier, not a remote page URL.
export const PLAYER_ORIGIN = 'https://com.paperly.study';
export const PLAYER_BASE = `${PLAYER_ORIGIN}/`;
export function allowPlayerNavigation(request: { url?: unknown; isTopFrame?: boolean } | null | undefined) {
  if (!request || typeof request.url !== 'string') return false;
  if (request.url === 'about:blank' || request.url === 'about:srcdoc' || request.url === PLAYER_BASE) return true;
  if (request.isTopFrame !== false) return false;
  try {
    const url = new URL(request.url);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['www.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname) && /^\/embed\/[\w-]{11}$/.test(url.pathname);
  } catch { return false; }
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export function validPlaybackRate(rate: unknown): rate is number { return typeof rate === 'number' && (PLAYBACK_RATES as readonly number[]).includes(rate); }
/** Self-contained so the exact same implementation can run in the native HTML document. */
export function createPlayerPreferences(getPlayer: () => any, emit: (message: object) => void) {
  const supported = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  let wanted = 1, disposed = false, applying = false, captionsApplying = false, captionsSuppressed = false;
  let attemptedRate: number | null = null, availability = '';
  const captionsOff = () => {
    if (disposed || captionsApplying) return;
    captionsApplying = true;
    try {
      const p = getPlayer();
      if (!p?.getOptions?.()?.includes('captions')) { captionsSuppressed = false; return; }
      if (captionsSuppressed) return;
      // Set before either API call: both may synchronously emit onApiChange.
      captionsSuppressed = true;
      p.setOption?.('captions', 'track', {}); p.unloadModule?.('captions');
    } catch {} finally { captionsApplying = false; }
  };
  const sync = () => {
    if (disposed || applying) return;
    applying = true;
    try {
      const p = getPlayer(); const raw = p?.getAvailablePlaybackRates?.();
      const available = Array.isArray(raw) ? supported.filter(r => raw.includes(r)) : [];
      const nextAvailability = available.join(',');
      if (availability !== nextAvailability) { availability = nextAvailability; attemptedRate = null; }
      const before = p?.getPlaybackRate?.();
      if (before === wanted) attemptedRate = null;
      else if (available.includes(wanted) && attemptedRate !== wanted) {
        // Remember in-flight/rejected requests before calling a potentially reentrant API.
        attemptedRate = wanted; p?.setPlaybackRate?.(wanted);
      }
      const actual = p?.getPlaybackRate?.();
      if (supported.includes(actual)) emit({ k: 'rate', r: actual, a: available });
    } catch {} finally { applying = false; }
  };
  return { choose(rate: unknown) { if (!disposed && typeof rate === 'number' && supported.includes(rate)) { if (wanted !== rate) attemptedRate = null; wanted = rate; sync(); } }, sync, captionsOff, dispose() { disposed = true; } };
}

export function floatingVideoGeometry(width: number, height: number, insets: { top: number; bottom: number; left?: number; right?: number }, position?: { x: number; y: number }) {
  const left = Math.max(0, insets.left ?? 0), top = Math.max(0, insets.top);
  const availableW = Math.max(0, width - left - (insets.right ?? 0));
  const availableH = Math.max(0, height - top - insets.bottom);
  const w = Math.min(320, availableW), stageH = Math.min(availableH, Math.max(200, w * 9 / 16));
  const controlsH = Math.min(88, Math.max(0, availableH - stageH));
  const h = stageH + controlsH;
  const x = Math.max(left, Math.min(width - (insets.right ?? 0) - w, position?.x ?? width - w - 12));
  const y = Math.max(top, Math.min(height - insets.bottom - h, position?.y ?? height - insets.bottom - h - 12));
  return { x, y, width: w, height: h, stageHeight: stageH, controlsHeight: controlsH };
}

/** Global shortcuts never steal typing/IME/modifier shortcuts or document keys under a popup. */
export function playerShortcutShouldPassThrough(event: { key: string; target?: unknown; isComposing?: boolean; defaultPrevented?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, floating: boolean) {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return true;
  const target = event.target as { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown } | null;
  if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName?.toUpperCase() ?? '') || target.isContentEditable || target.closest?.('[contenteditable="true"],[role="textbox"]'))) return true;
  return floating && event.key !== 'Escape';
}
