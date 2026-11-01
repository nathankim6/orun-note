// Web implementation backed by pdf.js. Page images are returned as data URLs.
import type { PdfInfo, PdfOutlineItem } from './types';
let lib: any = null; const docs = new Map<string, Promise<any>>();
async function pdfjs() { if (lib) return lib; lib = await import('pdfjs-dist'); lib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`; return lib; }
async function open(uri: string) { if (!docs.has(uri)) { docs.set(uri, (async () => { const p = await pdfjs(); const data = await (await fetch(uri)).arrayBuffer(); return p.getDocument({ data }).promise; })()); } return docs.get(uri)!; }
export default {
  // Web is a development/preview target only: no at-rest encryption is applied here.
  async importFile(srcUri: string, _id: string) { const blob = await (await fetch(srcUri)).blob(); return { uri: srcUri, size: blob.size }; },
  async deleteFile(_uri: string) {}, async fileExists(_uri: string) { return true; }, async clearCaches() { docs.clear(); },
  async getInfo(uri: string): Promise<PdfInfo> { const doc = await open(uri); const pages = []; for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1 }); pages.push({ width: vp.width, height: vp.height }); } let title: string | undefined; try { title = (await doc.getMetadata())?.info?.Title; } catch {} return { pageCount: doc.numPages, pages, title }; },
  async renderPage(uri: string, index: number, width: number): Promise<string> { const doc = await open(uri); const pg = await doc.getPage(index + 1); const base = pg.getViewport({ scale: 1 }); const vp = pg.getViewport({ scale: width / base.width }); const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height); const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); await pg.render({ canvasContext: ctx, viewport: vp }).promise; return canvas.toDataURL('image/png'); },
  async getPageText(uri: string, index: number): Promise<string> { const doc = await open(uri); const pg = await doc.getPage(index + 1); const tc = await pg.getTextContent(); return tc.items.map((it: any) => it.str).join(' '); },
  async getOutline(uri: string): Promise<PdfOutlineItem[]> { const doc = await open(uri); const out: PdfOutlineItem[] = []; const walk = async (items: any[], level: number) => { for (const it of items ?? []) { let pageIndex = 0; try { const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest; if (dest) pageIndex = await doc.getPageIndex(dest[0]); } catch {} out.push({ title: it.title, pageIndex, level }); await walk(it.items, level + 1); } }; await walk(await doc.getOutline(), 0); return out; },
};
