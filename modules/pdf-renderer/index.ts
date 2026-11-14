import { Platform } from 'react-native';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import type { PdfInfo, PdfOutlineItem, PdfWord } from './src/types';
export * from './src/types';

type Native = {
  importFile(srcUri: string, id: string): Promise<{ uri: string; size: number }>;
  deleteFile(uri: string): Promise<void>; fileExists(uri: string): Promise<boolean>; clearCaches(): Promise<void>;
  getInfo(uri: string): Promise<PdfInfo>; renderPage(uri: string, index: number, width: number): Promise<string>;
  getPageText(uri: string, index: number): Promise<string>; getOutline(uri: string): Promise<PdfOutlineItem[]>;
  getWords(uri: string, index: number): Promise<PdfWord[]>;
  /** Missing on app binaries built before it existed (JS updated over the air). */
  renderRegion?(uri: string, index: number, pageWidthPx: number, x: number, y: number, w: number, h: number): Promise<string>;
  /** Android: saved crash stack traces + system exit records since the last call (missing on iOS / older builds). */
  takeCrashReports?(): Promise<{ kind: string; at: number; detail: string }[]>;
  /** file URI of an already-rendered page (no rendering, no lock), or null. Missing on older builds. */
  renderReading?(uri: string, index: number, width: number): Promise<string>;
  cachedReading?(uri: string, index: number, width: number): Promise<string | null>;
  takeRenderTimings?(): Promise<Record<string, unknown>[]>;
  getInstallSource?(): Promise<string | null>;
  cachedPage?(uri: string, index: number, width: number): Promise<string | null>;
  /** Native page surface prefetch (synchronous enqueue). Missing on builds without PdfPageView. */
  warmPages?(uri: string, indices: number[], width: number): void;
  clearPageBitmaps?(): void;
};
export type PageReadyEvent = { ok: boolean; page: number; width?: number; ms?: number; cached?: boolean };
export type PdfPageSurfaceProps = ViewProps & { source: string; index: number; pixelWidth: number; onPageReady?: (e: { nativeEvent: PageReadyEvent }) => void };
let impl: Native;
if (Platform.OS === 'web') { impl = require('./src/web').default as Native; }
else {
  try { impl = requireNativeModule<Native>('PdfRenderer'); }
  catch (e) {
    // Native module missing from this build: fail per call instead of crashing at startup.
    const missing = () => Promise.reject(new Error('PDF 네이티브 모듈이 이 빌드에 포함되지 않았습니다. 앱을 다시 빌드해 주세요.'));
    impl = { importFile: missing, deleteFile: missing, fileExists: async () => false, clearCaches: async () => {}, getInfo: missing, renderPage: missing, renderRegion: missing, getPageText: missing, getOutline: missing, getWords: async () => [] } as unknown as Native;
    console.error('PdfRenderer native module unavailable', e);
  }
}

let surface: ComponentType<PdfPageSurfaceProps> | null = null;
if (Platform.OS !== 'web' && typeof impl.warmPages === 'function') {
  try { surface = requireNativeViewManager<PdfPageSurfaceProps>('PdfRenderer'); } catch { surface = null; }
}
/** Native page view (draws the page bitmap directly). Null on web and on builds made before it existed. */
export const PdfPageSurface = surface;

export const PdfRenderer = {
  hasPageView: () => surface !== null,
  warmPages: (uri: string, indices: number[], width: number) => { try { impl.warmPages?.(uri, indices, Math.round(width)); } catch { /* prefetch is optional */ } },
  clearPageBitmaps: () => { try { impl.clearPageBitmaps?.(); } catch { /* optional */ } },
  /** Encrypts and stores a picked PDF inside app-private storage. Returns the stored (encrypted) URI. */
  importFile: (srcUri: string, id: string) => impl.importFile(srcUri, id),
  deleteFile: (uri: string) => impl.deleteFile(uri).catch(() => {}),
  fileExists: (uri: string) => impl.fileExists(uri).catch(() => false),
  clearCaches: () => impl.clearCaches().catch(() => {}),
  getInfo: (uri: string) => impl.getInfo(uri),
  /** Renders one page and returns a file:// (native) or blob: (web) URI; cached on disk/memory, so repeat calls are instant.
   *  `width` is the target pixel width. Native full pages use JPEG92; reading images use JPEG84. */
  hasReadingRenderer: () => typeof impl.renderReading === 'function',
  renderReading: (uri: string, index: number, width: number): Promise<string> => typeof impl.renderReading === 'function' ? impl.renderReading(uri, index, Math.min(1200, Math.round(width))) : impl.renderPage(uri, index, Math.min(1200, Math.round(width))),
  cachedReading: (uri: string, index: number, width: number): Promise<string | null> => typeof impl.cachedReading === 'function' ? impl.cachedReading(uri, index, Math.min(1200, Math.round(width))).catch(() => null) : Promise.resolve(null),
  takeRenderTimings: (): Promise<Record<string, unknown>[]> => typeof impl.takeRenderTimings === 'function' ? impl.takeRenderTimings().catch(() => []) : Promise.resolve([]),
  renderPage: (uri: string, index: number, width: number) => impl.renderPage(uri, index, Math.round(width)),
  /** Renders only the `w`×`h` px window whose top-left is (`x`,`y`) of the page as it looks when the whole page is `pageWidthPx`
   *  wide (clamped to the page) — sharp tiles for zoomed-in views without rasterizing the whole page. JPEG, cached like renderPage. */
  renderRegion: (uri: string, index: number, pageWidthPx: number, x: number, y: number, w: number, h: number): Promise<string> =>
    impl.renderRegion ? impl.renderRegion(uri, index, Math.round(pageWidthPx), Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))) : Promise.reject(new Error('renderRegion is not available in this app build')),
  /** False on app binaries built before renderRegion existed: fall back to renderPage. */
  hasRenderRegion: () => typeof impl.renderRegion === 'function',
  getPageText: (uri: string, index: number) => impl.getPageText(uri, index).catch(() => ''),
  getOutline: (uri: string) => impl.getOutline(uri).catch(() => [] as PdfOutlineItem[]),
  /** Words on a page with rectangles normalized to the page (0..1, top-left). Empty when the PDF has no text layer (scans). */
  cachedPage: (uri: string, index: number, width: number): Promise<string | null> => (typeof impl.cachedPage === 'function' ? impl.cachedPage(uri, index, Math.round(width)).catch(() => null) : Promise.resolve(null)),
  getInstallSource: (): Promise<string | null> => typeof impl.getInstallSource === 'function' ? impl.getInstallSource().catch(() => 'unknown') : Promise.resolve('unknown'),
  takeCrashReports: (): Promise<{ kind: string; at: number; detail: string }[]> => (typeof impl.takeCrashReports === 'function' ? impl.takeCrashReports().catch(() => []) : Promise.resolve([])),
  getWords: (uri: string, index: number) => (impl.getWords ? impl.getWords(uri, index) : Promise.resolve([])).catch(() => [] as PdfWord[]),
};
