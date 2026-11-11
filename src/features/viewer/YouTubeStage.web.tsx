import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StageHandle, StageStatus, stageFailure, bridgeStatus, validVideoId } from './reviewVideoSafety';
export { StageHandle, StageStatus, StageErrorCode, EMPTY_STATUS, stageError } from './reviewVideoSafety';

type YTApi = { Player: new (el: HTMLElement, o: any) => any };
let loading: Promise<YTApi> | null = null;
function loadYT(): Promise<YTApi> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (loading) return loading;
  loading = new Promise<YTApi>((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    const failed = () => { clearTimeout(timer); if (w.onYouTubeIframeAPIReady === callback) w.onYouTubeIframeAPIReady = prev; script.remove(); loading = null; reject(new Error('load')); };
    const callback = () => { clearTimeout(timer); w.onYouTubeIframeAPIReady = prev; if (w.YT?.Player) resolve(w.YT); else failed(); try { prev?.(); } catch {} };
    const timer = setTimeout(failed, 20000);
    w.onYouTubeIframeAPIReady = callback;
    script.src = 'https://www.youtube.com/iframe_api'; script.async = true; script.onerror = failed;
    document.head.appendChild(script);
  });
  return loading;
}

/** Web player has the same guarded status bridge and explicit-retry lifecycle as native. */
export const YouTubeStage = forwardRef<StageHandle, { videoId: string; onStatus: (s: Partial<StageStatus>) => void }>(function YouTubeStage({ videoId, onStatus }, ref) {
  const host = useRef<HTMLDivElement | null>(null); const player = useRef<any>(null);
  const cb = useRef(onStatus); cb.current = onStatus;
  const ready = useRef(false);
  useImperativeHandle(ref, () => {
    const call = (method: string, ...args: unknown[]) => { if (!ready.current) return; try { player.current?.[method]?.(...args); } catch { /* a disposed iframe must never escape into UI */ } };
    return { play: () => call('playVideo'), pause: () => call('pauseVideo'), seek: (v: number) => { if (Number.isFinite(v)) call('seekTo', Math.max(0, v), true); } };
  }, []);
  useEffect(() => {
    let disposed = false, failed = false; let tick: ReturnType<typeof setInterval> | undefined;
    ready.current = false;
    const destroy = () => { clearInterval(tick); ready.current = false; const p = player.current; player.current = null; try { p?.destroy?.(); } catch {} host.current?.replaceChildren(); };
    const fail = (code: unknown) => {
      if (disposed || failed) return;
      failed = true; clearTimeout(guard); destroy();
      cb.current(stageFailure(code));
    };
    const emit = (message: object) => {
      if (disposed || failed) return;
      const status = bridgeStatus(JSON.stringify(message)); if (status) cb.current(status);
    };
    const guard = setTimeout(() => { if (!ready.current) fail('timeout'); }, 30000);
    if (!validVideoId(videoId)) fail('invalid');
    else loadYT().then((YT) => {
      if (disposed || failed || !host.current) return;
      const mount = document.createElement('div'); host.current.replaceChildren(mount);
      player.current = new YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com', videoId, width: '100%', height: '100%',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, cc_load_policy: 0, hl: 'ko', origin: window.location.origin },
        events: {
          onReady: (event: any) => {
            if (disposed || failed || ready.current) return;
            try {
              ready.current = true; clearTimeout(guard);
              const f = event.target.getIframe?.(); if (f) { f.setAttribute('tabindex', '-1'); f.setAttribute('aria-hidden', 'true'); f.setAttribute('inert', ''); f.setAttribute('allow', 'autoplay; encrypted-media'); f.style.pointerEvents = 'none'; }
              emit({ k: 'ready', d: event.target.getDuration() || 0 });
              tick = setInterval(() => { if (disposed || failed || !player.current) return; try { const p = player.current; emit({ k: 'time', t: p.getCurrentTime(), d: p.getDuration(), l: p.getVideoLoadedFraction() }); } catch { fail('process'); } }, 250);
            } catch { fail('load'); }
          },
          onStateChange: (e: any) => emit({ k: 'state', s: e.data }),
          onAutoplayBlocked: () => emit({ k: 'state', s: 2 }),
          onError: (e: any) => fail(e.data),
        },
      });
    }).catch(() => fail('network'));
    return () => { disposed = true; clearTimeout(guard); destroy(); };
  }, [videoId]);
  return React.createElement('div', {
    ref: host, 'aria-hidden': true, inert: true, onContextMenu: (e: any) => e.preventDefault(), 'data-testid': 'review-video-stage',
    style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: '#000', pointerEvents: 'none', userSelect: 'none' },
  });
});
