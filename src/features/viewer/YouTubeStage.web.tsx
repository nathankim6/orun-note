import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type StageStatus = { ready: boolean; playing: boolean; ended: boolean; buffering: boolean; time: number; duration: number; loaded: number; error: string | null };
export type StageHandle = { play(): void; pause(): void; seek(seconds: number): void };
export const EMPTY_STATUS: StageStatus = { ready: false, playing: false, ended: false, buffering: false, time: 0, duration: 0, loaded: 0, error: null };

export function stageError(code: unknown) {
  if (code === 100) return '영상을 찾을 수 없어요. 선생님께 알려 주세요.';
  if (code === 101 || code === 150 || code === 152) return '이 영상은 앱 안에서 재생할 수 없도록 설정되어 있어요. 선생님께 알려 주세요.';
  if (code === 'timeout') return '영상을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
  return '영상을 재생하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

type YTApi = { Player: new (el: HTMLElement, o: any) => any };
let loading: Promise<YTApi> | null = null;
function loadYT(): Promise<YTApi> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (loading) return loading;
  loading = new Promise<YTApi>((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady; const timer = setTimeout(() => { loading = null; reject(new Error('timeout')); }, 20000);
    w.onYouTubeIframeAPIReady = () => { clearTimeout(timer); w.onYouTubeIframeAPIReady = prev; resolve(w.YT); prev?.(); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = () => { clearTimeout(timer); loading = null; reject(new Error('load')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Web / desktop version of the locked player: same rules as native (no YouTube controls, no clicks reach the frame). */
export const YouTubeStage = forwardRef<StageHandle, { videoId: string; onStatus: (s: Partial<StageStatus>) => void }>(function YouTubeStage({ videoId, onStatus }, ref) {
  const host = useRef<HTMLDivElement | null>(null); const player = useRef<any>(null); const cb = useRef(onStatus); cb.current = onStatus;
  useImperativeHandle(ref, () => ({ play: () => player.current?.playVideo?.(), pause: () => player.current?.pauseVideo?.(), seek: (v: number) => player.current?.seekTo?.(v, true) }), []);
  useEffect(() => {
    let disposed = false; let tick: any; let ready = false;
    const guard = setTimeout(() => { if (!ready && !disposed) cb.current({ error: stageError('timeout') }); }, 30000);
    loadYT().then((YT) => {
      if (disposed || !host.current) return;
      const mount = document.createElement('div'); host.current.replaceChildren(mount);
      player.current = new YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com', videoId, width: '100%', height: '100%',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, cc_load_policy: 0, hl: 'ko', origin: window.location.origin },
        events: {
          onReady: (e: any) => { ready = true; clearTimeout(guard); const f = e.target.getIframe?.(); if (f) { f.setAttribute('tabindex', '-1'); f.style.pointerEvents = 'none'; } cb.current({ ready: true, duration: e.target.getDuration() || 0, error: null });
            tick = setInterval(() => { try { const p = player.current; cb.current({ time: p.getCurrentTime() || 0, duration: p.getDuration() || 0, loaded: p.getVideoLoadedFraction() || 0 }); } catch {} }, 250); },
          onStateChange: (e: any) => cb.current({ playing: e.data === 1, buffering: e.data === 3, ended: e.data === 0 }),
          onAutoplayBlocked: () => cb.current({ playing: false }),
          onError: (e: any) => { clearTimeout(guard); cb.current({ error: stageError(e.data), playing: false }); },
        },
      });
    }).catch(() => { if (!disposed) cb.current({ error: stageError('timeout') }); });
    return () => { disposed = true; clearTimeout(guard); clearInterval(tick); try { player.current?.destroy?.(); } catch {} player.current = null; };
  }, [videoId]);
  return React.createElement('div', {
    ref: host, onContextMenu: (e: any) => e.preventDefault(),
    style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: '#000', pointerEvents: 'none', userSelect: 'none' },
  });
});
