// Web implementation backed by pdf.js. Page images are returned as blob: URLs (encoded off the main thread by the browser).
import type { PdfInfo, PdfOutlineItem } from './types';
let lib: any = null; const docs = new Map<string, Promise<any>>();
import * as pdfjsLib from 'pdfjs-dist';
async function pdfjs() { if (lib) return lib; lib = pdfjsLib as any; lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'; return lib; }
async function open(uri: string) {
  if (!docs.has(uri)) {
    const p = (async () => { const l = await pdfjs(); const data = await (await fetch(uri)).arrayBuffer(); return l.getDocument({ data }).promise; })();
    docs.set(uri, p); p.catch(() => { if (docs.get(uri) === p) docs.delete(uri); }); // a failed open can be retried
  }
  return docs.get(uri)!;
}

// Separate reusable canvases: detail encoding must not queue reading behind the same canvas lease.
type CanvasLane = 'reading' | 'detail';
const canvases: Record<CanvasLane, { element: HTMLCanvasElement | null; chain: Promise<unknown> }> = {
  reading: { element: null, chain: Promise.resolve() }, detail: { element: null, chain: Promise.resolve() },
};
function withCanvas<T>(lane: CanvasLane, fn: (c: HTMLCanvasElement) => Promise<T>): Promise<T> {
  const state = canvases[lane];
  const run = () => fn(state.element ?? (state.element = document.createElement('canvas')));
  const p = state.chain.then(run, run); state.chain = p.catch(() => {}); return p;
}
function canvasUrl(c: HTMLCanvasElement, jpeg: boolean, quality: number): Promise<string> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('canvas encode failed'))), jpeg ? 'image/jpeg' : 'image/png', quality));
}
async function paint(pg: any, vp: any, w: number, h: number, jpeg: boolean, quality: number, lane: CanvasLane = 'detail'): Promise<string> {
  return withCanvas(lane, async (canvas) => {
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false })!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvasUrl(canvas, jpeg, quality);
  });
}
// Same image requested again (e.g. a remounted page or tile) -> same URL, no re-render. Bounded; old URLs are not revoked
// because a still-mounted <img> may be using them.
const images = new Map<string, Promise<string>>();
const readyImages = new Map<string, string>();
function memo(key: string, make: () => Promise<string>): Promise<string> {
  let p = images.get(key);
  if (!p) { p = make(); images.set(key, p); p.then(value => { if (images.get(key) === p) readyImages.set(key, value); }, () => { if (images.get(key) === p) images.delete(key); }); if (images.size > 400) { const first = images.keys().next().value; if (first !== undefined) { images.delete(first); readyImages.delete(first); } } }
  return p;
}

/** pdf.js returns one item per glyph run; many Korean PDFs position every syllable separately.
 *  Join by geometry: no space when the next run starts where the previous one ended, a space for a real gap, a newline for a new line. */
function joinItems(items: any[]): string {
  let out = ''; let px = 0, py = 0, pw = 0, ph = 0, has = false;
  for (const it of items) {
    const str: string = it.str ?? ''; if (!str) { if (it.hasEOL) out += '\n'; continue; }
    const x = it.transform?.[4] ?? 0, y = it.transform?.[5] ?? 0, h = Math.abs(it.transform?.[3] ?? it.height ?? 10) || 10;
    if (has) {
      const newLine = Math.abs(y - py) > Math.max(ph, h) * 0.6;
      const gap = x - (px + pw);
      if (newLine) out += out.endsWith('\n') ? '' : '\n';
      else if (gap > Math.max(ph, h) * 0.18 && !out.endsWith(' ') && !str.startsWith(' ')) out += ' ';
    }
    out += str; px = x; py = y; pw = it.width ?? 0; ph = h; has = true;
    if (it.hasEOL) out += '\n';
  }
  return out.replace(/[ \t]+\n/g, '\n');
}

export default {
  // Web is a development/preview target only: no at-rest encryption is applied here.
  async importFile(srcUri: string, _id: string) { const blob = await (await fetch(srcUri)).blob(); return { uri: srcUri, size: blob.size }; },
  async deleteFile(uri: string) { const p = docs.get(uri); docs.delete(uri); p?.then((d: any) => d.destroy?.()).catch(() => {}); }, async fileExists(_uri: string) { return true; }, async clearCaches() { docs.clear(); images.clear(); readyImages.clear(); },
  async getInfo(uri: string): Promise<PdfInfo> { const doc = await open(uri); const pages = []; for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1 }); pages.push({ width: vp.width, height: vp.height }); } let title: string | undefined; try { title = (await doc.getMetadata())?.info?.Title; } catch {} return { pageCount: doc.numPages, pages, title }; },
  async cachedReading(uri: string, index: number, width: number): Promise<string | null> {
    const w = Math.max(1, Math.min(1200, Math.round(width)));
    return readyImages.get(`${uri}|${index}|${w}`) ?? readyImages.get(`read|${uri}|${index}|${w}`) ?? null;
  },
  renderReading(uri: string, index: number, width: number): Promise<string> {
    const w = Math.max(1, Math.min(1200, Math.round(width)));
    const cached = readyImages.get(`${uri}|${index}|${w}`); if (cached) return Promise.resolve(cached);
    return memo(`read|${uri}|${index}|${w}`, async () => {
      const doc = await open(uri), pg = await doc.getPage(index + 1), base = pg.getViewport({ scale: 1 });
      let scale = w / base.width, vp = pg.getViewport({ scale });
      if (Math.ceil(vp.width) * Math.ceil(vp.height) > 4_000_000) {
        scale *= Math.sqrt(3_990_000 / (Math.ceil(vp.width) * Math.ceil(vp.height))); vp = pg.getViewport({ scale });
      }
      return paint(pg, vp, Math.max(1, Math.floor(vp.width)), Math.max(1, Math.floor(vp.height)), true, 0.84, 'reading');
    });
  },
  /** Whole page `width` px wide. PNG up to 1600 px, JPEG 0.92 above (much faster to encode). */
  renderPage(uri: string, index: number, width: number): Promise<string> {
    return memo(`${uri}|${index}|${width}`, async () => {
      const doc = await open(uri); const pg = await doc.getPage(index + 1); const base = pg.getViewport({ scale: 1 }); const vp = pg.getViewport({ scale: width / base.width });
      return paint(pg, vp, Math.ceil(vp.width), Math.ceil(vp.height), width > 1600, 0.92);
    });
  },
  /** `w`×`h` px window (top-left `x`,`y`) of the page scaled to `pageWidthPx` wide, clamped to the page. JPEG 0.9. */
  renderRegion(uri: string, index: number, pageWidthPx: number, x: number, y: number, w: number, h: number): Promise<string> {
    return memo(`${uri}|${index}|${pageWidthPx}|r${x}_${y}_${w}_${h}`, async () => {
      const doc = await open(uri); const pg = await doc.getPage(index + 1); const base = pg.getViewport({ scale: 1 });
      const fullW = Math.max(1, Math.round(pageWidthPx)); const scale = fullW / base.width; const fullH = Math.max(1, Math.round(base.height * scale));
      const x0 = Math.min(Math.max(0, Math.round(x)), fullW - 1), y0 = Math.min(Math.max(0, Math.round(y)), fullH - 1);
      const rw = Math.max(1, Math.min(Math.round(w), fullW - x0)), rh = Math.max(1, Math.min(Math.round(h), fullH - y0));
      const vp = pg.getViewport({ scale, offsetX: -x0, offsetY: -y0 });
      return paint(pg, vp, rw, rh, true, 0.9);
    });
  },
  async getPageText(uri: string, index: number): Promise<string> { const doc = await open(uri); const pg = await doc.getPage(index + 1); const tc = await pg.getTextContent(); return joinItems(tc.items); },
  async getWords(uri: string, index: number) {
    const lib = await pdfjs(); const doc = await open(uri); const pg = await doc.getPage(index + 1); const vp = pg.getViewport({ scale: 1 }); const tc = await pg.getTextContent();
    const out: { t: string; x: number; y: number; w: number; h: number }[] = [];
    for (const it of tc.items as any[]) {
      const str: string = it.str ?? ''; if (!str.trim()) continue;
      const tx = lib.Util.transform(vp.transform, it.transform); const fh = Math.hypot(tx[2], tx[3]) || it.height || 10; const x0 = tx[4]; const yTop = tx[5] - fh; const totalW = (it.width ?? 0) * vp.scale;
      const re = /[A-Za-z\u00C0-\u024F'’-]+|[^\s]+/g; let m: RegExpExecArray | null; const n = str.length || 1;
      while ((m = re.exec(str))) { if (!/[A-Za-z\u00C0-\u024F\uAC00-\uD7A3]/.test(m[0])) continue; const a = m.index / n, b = (m.index + m[0].length) / n; out.push({ t: m[0], x: (x0 + a * totalW) / vp.width, y: (yTop - fh * 0.1) / vp.height, w: ((b - a) * totalW) / vp.width, h: (fh * 1.25) / vp.height }); }
    }
    return out;
  },
  async getOutline(uri: string): Promise<PdfOutlineItem[]> { const doc = await open(uri); const out: PdfOutlineItem[] = []; const walk = async (items: any[], level: number) => { for (const it of items ?? []) { let pageIndex = 0; try { const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest; if (dest) pageIndex = await doc.getPageIndex(dest[0]); } catch {} out.push({ title: it.title, pageIndex, level }); await walk(it.items, level + 1); } }; await walk(await doc.getOutline(), 0); return out; },
};
