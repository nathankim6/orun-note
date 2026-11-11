import { Image } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { PdfRenderer } from '../modules/pdf-renderer';
import { PDF_BASE64 } from './fixtures/pdf.generated';
import { marker } from './telemetry';
const delay = (n: number) => new Promise<void>(resolve => setTimeout(resolve, n));
const stages = ['write_source', 'import', 'info', 'render_detail', 'render_reading', 'await_render', 'region', 'image_load', 'timings', 'cleanup'] as const;
type Stage = typeof stages[number];
const ownReasons: Record<string, string> = {
  'reading API missing': 'reading_api_missing', 'fixture pages': 'fixture_pages',
  'pdf deadline': 'render_timeout', 'missing native timings': 'missing_native_timings',
  'reading serialized behind detail': 'reading_serialized',
  'fixture dimensions': 'fixture_dimensions', 'image load failed': 'image_load_failed', 'raster dimensions': 'raster_dimensions',
};
export function pdfFailureReason(error: unknown): string {
  // Inspect bounded text only to map exact known categories. Never emit text/code/URI.
  const value = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined;
  const message = typeof value === 'string' ? value.slice(0, 4096) : '';
  if (Object.prototype.hasOwnProperty.call(ownReasons, message)) return ownReasons[message];
  const nativeReasons: Record<string, string> = { PDF_OPEN_FAILED: 'open_failed', PDF_PAGE_INVALID: 'page_invalid', PDF_UNAVAILABLE: 'native_unavailable', PDF_KEYCHAIN_ENTITLEMENT: 'keychain_entitlement', PDF_KEYCHAIN_LOCKED: 'keychain_locked', PDF_KEYCHAIN_FAILED: 'keychain_failed', PDF_CRYPTO_FAILED: 'crypto_failed' };
  const native = message.match(/\bPDF_(?:OPEN_FAILED|PAGE_INVALID|UNAVAILABLE|KEYCHAIN_ENTITLEMENT|KEYCHAIN_LOCKED|KEYCHAIN_FAILED|CRYPTO_FAILED)\b/)?.[0];
  if (native) return nativeReasons[native];
  const known = message.match(/\bkeychain\s*(?::|\()?\s*(-34018|-25308)(?=\s|\)|$|[.,;:])/i)?.[1];
  return known === '-34018' ? 'keychain_entitlement' : known === '-25308' ? 'keychain_locked' : 'operation_failed';
}
class QaPdfFailure extends Error {
  constructor(readonly reason: string, readonly stage: Stage, readonly trial: number) { super(reason); }
}
function failure(error: unknown, stage: Stage, trial: number): QaPdfFailure {
  return error instanceof QaPdfFailure ? error : new QaPdfFailure(pdfFailureReason(error), stage, trial);
}
export function pdfFailureSummary(error: unknown): { reason: string; stage: Stage; trial: number } {
  const safe = failure(error, 'info', 1);
  return { reason: safe.reason, stage: safe.stage, trial: safe.trial };
}
export async function pdfSmoke(): Promise<'pass' | 'inconclusive'> {
  let stage: Stage = 'render_reading', currentTrial = 1;
  const enter = (next: Stage, trial: number) => { stage = next; currentTrial = trial; marker('pdf_stage', { stage: next, trial }); };
  const results: { first: string; discriminating: boolean }[] = [];
  try {
    if (!PdfRenderer.hasReadingRenderer()) throw new Error('reading API missing');
    for (let trial = 1; trial <= 3; trial++) {
      const source = `${FileSystem.cacheDirectory}qa-synthetic-${trial}.pdf`;
      let storedUri: string | undefined, primary: QaPdfFailure | undefined;
      try {
        enter('write_source', trial);
        await FileSystem.writeAsStringAsync(source, PDF_BASE64, { encoding: FileSystem.EncodingType.Base64 });
        enter('import', trial);
        storedUri = (await PdfRenderer.importFile(source, `qa-${Date.now()}-${trial}`)).uri;
        enter('info', trial);
        const info = await PdfRenderer.getInfo(storedUri);
        if (info.pageCount !== 2) throw new Error('fixture pages');
        const readingPage = info.pages?.[1];
        if (!readingPage || !Number.isFinite(readingPage.width) || !Number.isFinite(readingPage.height) || readingPage.width <= 0 || readingPage.height <= 0) throw new Error('fixture dimensions');
        const expectedReadingHeight = 900 * readingPage.height / readingPage.width;
        if (!Number.isFinite(expectedReadingHeight) || expectedReadingHeight <= 0) throw new Error('fixture dimensions');
        enter('timings', trial);
        await PdfRenderer.takeRenderTimings();
        const start = performance.now(), deadline = start + 90000; const order: string[] = [];
        const withinBudget = async <T,>(operation: () => Promise<T>): Promise<T> => {
          const remaining = deadline - performance.now();
          if (remaining <= 0) throw new Error('pdf deadline');
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const result = await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('pdf deadline')), remaining); })]);
            if (performance.now() > deadline) throw new Error('pdf deadline');
            return result;
          } finally { if (timer) clearTimeout(timer); }
        };
        enter('render_detail', trial);
        const detail = PdfRenderer.renderPage(storedUri, 0, 2400).then(() => {
          order.push('detail'); marker('pdf_completion', { trial, lane: 'detail', elapsedMs: performance.now() - start });
        }).catch(error => { throw failure(error, 'render_detail', trial); });
        // Attach a rejection handler immediately while preserving the rejection for Promise.all.
        void detail.catch(() => {});
        await delay(25);
        const requested = performance.now();
        if (requested >= deadline) { enter('await_render', trial); throw new Error('pdf deadline'); }
        enter('render_reading', trial);
        const reading = PdfRenderer.renderReading(storedUri, 1, 900).then(uri => {
          order.push('reading'); marker('pdf_completion', { trial, lane: 'reading', elapsedMs: performance.now() - start, requestMs: requested - start });
          return uri;
        }).catch(error => { throw failure(error, 'render_reading', trial); });
        enter('await_render', trial);
        void reading.catch(() => {});
        const [, readingUri] = await withinBudget(() => Promise.all([detail, reading]));
        enter('region', trial);
        const regionUri = await withinBudget(() => PdfRenderer.renderRegion(storedUri!, 1, 2400, 300, 100, 900, 600));
        enter('image_load', trial);
        const checkRaster = async (uri: string, raster: 0 | 1, expectedWidth: number, expectedHeight: number, tolerancePx: number) => {
          let size: { width: number; height: number };
          try {
            size = await new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), () => reject(new Error('image load failed'))));
          } catch {
            marker('pdf_raster', { trial, raster, status: 0 });
            throw new Error('image load failed');
          }
          const valid = Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
          const correct = valid && Math.abs(size.width - expectedWidth) <= tolerancePx && Math.abs(size.height - expectedHeight) <= tolerancePx;
          marker('pdf_raster', { trial, raster, status: correct ? 1 : 0, expectedWidth, expectedHeight, tolerancePx, ...(valid ? { width: size.width, height: size.height } : {}) });
          if (!correct) throw new Error('raster dimensions');
        };
        // raster=0: reading JPEG; raster=1: actual native region JPEG. Payload is numeric only.
        await withinBudget(() => Promise.all([checkRaster(readingUri, 0, 900, expectedReadingHeight, 1), checkRaster(regionUri, 1, 900, 600, 0)]));
        enter('timings', trial);
        const timings = await PdfRenderer.takeRenderTimings();
        for (const row of timings) {
          const clean: Record<string, unknown> = { trial, lane: ['detail', 'reading', 'tile'].includes(String(row.lane)) ? row.lane : 'unknown' };
          for (const key of ['page', 'width', 'openMs', 'drawMs', 'encodeMs', 'writeMs', 'totalMs']) {
            if (typeof row[key] === 'number' && Number.isFinite(row[key])) clean[key] = row[key];
          }
          marker('pdf_timing', clean);
        }
        const d = timings.find(t => t.lane === 'detail' && t.page === 0);
        const r = timings.find(t => t.lane === 'reading' && t.page === 1);
        if (!d || !r) throw new Error('missing native timings');
        results.push({ first: order[0], discriminating: Number(d.totalMs) > Number(r.totalMs) + (requested - start) });
      } catch (error) { primary = failure(error, stage, trial); }
      finally {
        enter('cleanup', trial);
        const cleanup = async (operation: () => Promise<unknown>) => {
          try { await operation(); }
          catch (error) {
            const next = failure(error, 'cleanup', trial);
            if (primary) marker('pdf_failure', { ...pdfFailureSummary(next), secondary: true });
            else primary = next;
          }
        };
        if (storedUri) await cleanup(() => PdfRenderer.deleteFile(storedUri!));
        await cleanup(() => FileSystem.deleteAsync(source, { idempotent: true }));
      }
      if (primary) throw primary;
    }
    // Relative cold-import ordering only, not an absolute speed threshold.
    const reproducible = results.every(r => r.discriminating);
    if (reproducible && results.every(r => r.first === 'detail')) throw new QaPdfFailure('reading_serialized', 'await_render', 3);
    const pass = reproducible && results.every(r => r.first === 'reading');
    marker('pdf_result', { result: pass ? 'pass' : 'inconclusive', trials: 3 });
    return pass ? 'pass' : 'inconclusive';
  } catch (error) {
    const safe = failure(error, stage, currentTrial);
    marker('pdf_failure', { ...pdfFailureSummary(safe), secondary: false });
    throw safe; // Root receives fixed enums, never the original native error message.
  }
}
