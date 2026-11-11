import type { RenderTiming } from './renderScheduler';
import type { PdfLane } from './pdfWork';
const phaseFields = ['page', 'width', 'openMs', 'drawMs', 'encodeMs', 'writeMs', 'totalMs'] as const;
export function createPreparationReporter(os: string, phases: () => Promise<unknown[]>, report: (kind: 'render', message: string) => void) {
  let attempts = 0;
  return async (lane: PdfLane, t: RenderTiming) => {
    if (os === 'web' || attempts >= 2 || t.index == null || t.width == null || t.width < 600 || (t.waitMs < 1000 && t.preparationMs < 800)) return;
    attempts++;
    let detail: Record<string, number | string>[] = [];
    try {
      detail = (await phases()).slice(-6).map(raw => {
        const p = raw as Record<string, unknown>; const clean: Record<string, number | string> = {};
        if (['reading', 'detail', 'tile'].includes(String(p.lane))) clean.lane = String(p.lane);
        for (const key of phaseFields) if (typeof p[key] === 'number' && Number.isFinite(p[key])) clean[key] = Math.round(p[key] as number);
        return clean;
      });
    } catch { /* the summary remains useful on older binaries */ }
    report('render', `PDF preparation lane=${lane} page=${t.index} width=${t.width} waitMs=${Math.round(t.waitMs)} preparationMs=${Math.round(t.preparationMs)} phases=${JSON.stringify(detail)}`);
  };
}

/** Image onLoad is decode/load completion, not a measurement of physical screen scanout. No source URI is accepted. */
export function createImageLoadReporter(os: string, report: (kind: 'render', message: string) => void,
  now: () => number = () => globalThis.performance?.now() ?? Date.now()) {
  let attempts = 0;
  const elapsed = (start: number, end: number) => Math.round(Math.max(0, Math.min(3_600_000, end - start)));
  return {
    begin(page: number) {
      const started = now(); let loaded = false;
      return {
        ready(lane: PdfLane, requestedWidth: number) {
          const ready = now();
          return () => {
            if (loaded || os === 'web' || requestedWidth < 600 || !Number.isSafeInteger(page) || page < 0 ||
              !Number.isFinite(requestedWidth) || requestedWidth > 16384 || !['reading', 'detail'].includes(lane)) return;
            loaded = true;
            const end = now();
            if (![started, ready, end].every(Number.isFinite) || attempts >= 2) return;
            const requestToReadyMs = elapsed(started, ready), readyToLoadMs = elapsed(ready, end), requestToLoadMs = elapsed(started, end);
            if (requestToLoadMs < 800 && readyToLoadMs < 250) return;
            attempts++;
            try { report('render', `PDF image load lane=${lane} page=${page} requestedWidth=${Math.round(requestedWidth)} requestToReadyMs=${requestToReadyMs} readyToLoadMs=${readyToLoadMs} requestToLoadMs=${requestToLoadMs}`); } catch { /* diagnostics must not interrupt presentation */ }
          };
        },
      };
    },
  };
}
