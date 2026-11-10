import type { RenderTiming } from './renderScheduler';
import type { PdfLane } from './pdfWork';
const phaseFields = ['page', 'width', 'openMs', 'drawMs', 'encodeMs', 'writeMs', 'totalMs'] as const;
export function createPreparationReporter(os: string, phases: () => Promise<unknown[]>, report: (kind: 'render', message: string) => void) {
  let attempts = 0;
  return async (lane: PdfLane, t: RenderTiming) => {
    if (os === 'web' || attempts >= 2 || t.index == null || t.width == null || (t.waitMs < 1000 && t.preparationMs < 800)) return;
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
