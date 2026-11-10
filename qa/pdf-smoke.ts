import * as FileSystem from 'expo-file-system/legacy';
import { PdfRenderer } from '../modules/pdf-renderer';
import { PDF_BASE64 } from './fixtures/pdf.generated';
import { marker } from './telemetry';
const delay = (n: number) => new Promise<void>(resolve => setTimeout(resolve, n));
export async function pdfSmoke(): Promise<'pass' | 'inconclusive'> {
  if (!PdfRenderer.hasReadingRenderer()) throw new Error('reading API missing');
  const results: { first: string; discriminating: boolean }[] = [];
  for (let trial = 1; trial <= 3; trial++) {
    const source = `${FileSystem.cacheDirectory}qa-synthetic-${trial}.pdf`;
    await FileSystem.writeAsStringAsync(source, PDF_BASE64, { encoding: FileSystem.EncodingType.Base64 });
    const stored = await PdfRenderer.importFile(source, `qa-${Date.now()}-${trial}`);
    try {
      const info = await PdfRenderer.getInfo(stored.uri);
      if (info.pageCount !== 2) throw new Error('fixture pages');
      await PdfRenderer.takeRenderTimings();
      const start = performance.now(); const order: string[] = [];
      const detail = PdfRenderer.renderPage(stored.uri, 0, 2400).then(() => {
        order.push('detail'); marker('pdf_completion', { trial, lane: 'detail', elapsedMs: performance.now() - start });
      });
      // Submit detail first; allow native dispatch before submitting a different page on reading lane.
      await delay(25);
      const requested = performance.now();
      const reading = PdfRenderer.renderReading(stored.uri, 1, 900).then(() => {
        order.push('reading'); marker('pdf_completion', { trial, lane: 'reading', elapsedMs: performance.now() - start, requestMs: requested - start });
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([Promise.all([detail, reading]), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('pdf deadline')), 90000); })]); }
      finally { if (timer) clearTimeout(timer); }
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
    } finally {
      await PdfRenderer.deleteFile(stored.uri);
      await FileSystem.deleteAsync(source, { idempotent: true });
    }
  }
  // No absolute speed target. Require repeatable ordering on cold synthetic imports.
  const reproducible = results.every(r => r.discriminating);
  if (reproducible && results.every(r => r.first === 'detail')) throw new Error('reading serialized behind detail');
  const pass = reproducible && results.every(r => r.first === 'reading');
  marker('pdf_result', { result: pass ? 'pass' : 'inconclusive', trials: 3 });
  return pass ? 'pass' : 'inconclusive';
}
