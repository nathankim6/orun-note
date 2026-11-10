import type { ReviewVideo } from '@/lib/api';

export type StageStatus = { ready: boolean; playing: boolean; ended: boolean; buffering: boolean; time: number; duration: number; loaded: number; error: string | null };
export type StageHandle = { play(): void; pause(): void; seek(seconds: number): void };
export const EMPTY_STATUS: StageStatus = { ready: false, playing: false, ended: false, buffering: false, time: 0, duration: 0, loaded: 0, error: null };
export const validVideoId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{11}$/.test(id);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, fallback: string) => typeof v === 'string' && v.trim() ? v.trim() : fallback;

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
  if (code === 'timeout') return '영상을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
  return '영상을 재생하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

/** Only the documented, bounded bridge messages can affect native UI state. */
export function bridgeStatus(raw: unknown): Partial<StageStatus> | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!record(m)) return null;
  if (m.k === 'ready' && finite(m.d)) return { ready: true, duration: m.d, error: null };
  if (m.k === 'time' && finite(m.t) && finite(m.d) && finite(m.l)) return { time: m.t, duration: m.d, loaded: Math.min(1, m.l) };
  if (m.k === 'state' && typeof m.s === 'number' && [-1, 0, 1, 2, 3, 5].includes(m.s)) return { playing: m.s === 1, buffering: m.s === 3, ended: m.s === 0 };
  if (m.k === 'error' && (typeof m.c === 'number' || m.c === 'timeout')) return { ready: false, playing: false, buffering: false, error: stageError(m.c) };
  return null;
}

export const PLAYER_ORIGIN = 'https://nathankim6.github.io';
export const PLAYER_BASE = `${PLAYER_ORIGIN}/orun-note/`;
export function allowPlayerNavigation(request: { url?: unknown; isTopFrame?: boolean }) {
  if (typeof request.url !== 'string') return false;
  if (request.url === 'about:blank' || request.url === 'about:srcdoc' || request.url === PLAYER_BASE) return true;
  if (request.isTopFrame !== false) return false;
  try {
    const url = new URL(request.url);
    return url.protocol === 'https:' && ['www.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname) && url.pathname.startsWith('/embed/');
  } catch { return false; }
}
