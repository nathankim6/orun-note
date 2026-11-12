import { createRenderScheduler, type RenderTiming } from './renderScheduler';
export type PdfLane = 'reading' | 'detail';
const bucket = (w: number) => Math.max(300, Math.ceil(w / 300) * 300);
/** One inexpensive reading raster; full resolution stays unchanged and is requested only after settling. */
export const readingPixels = (displayWidth: number) => Math.min(1200, bucket(displayWidth));
/** 240/360/480px previews: 6.25x fewer pixels than 600/900/1200px reads (240px minimum). */
export const previewPixels = (displayWidth: number) => Math.max(240, readingPixels(displayWidth) / 2.5);
export const detailPixels = (displayWidth: number, ratio: number) => Math.min(2400, bucket(displayWidth * Math.min(2.5, ratio)));
export const PDF_DETAIL_IDLE_MS = 800;
export function createPdfWork(onComplete?: (lane: PdfLane, timing: RenderTiming) => void | Promise<void>) {
  // Separate JS workers AND native renderer instances. A 4-second detail job must not head-of-line block reading.
  const reading = createRenderScheduler(64, 3, { onComplete: t => onComplete?.('reading', t) });
  const detail = createRenderScheduler(32, 0, { onComplete: t => onComplete?.('detail', t) });
  return { reading, detail };
}
