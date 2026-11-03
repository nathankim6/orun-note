import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import type { PdfInfo, PdfOutlineItem, PdfWord } from './src/types';
export * from './src/types';

type Native = {
  importFile(srcUri: string, id: string): Promise<{ uri: string; size: number }>;
  deleteFile(uri: string): Promise<void>; fileExists(uri: string): Promise<boolean>; clearCaches(): Promise<void>;
  getInfo(uri: string): Promise<PdfInfo>; renderPage(uri: string, index: number, width: number): Promise<string>;
  getPageText(uri: string, index: number): Promise<string>; getOutline(uri: string): Promise<PdfOutlineItem[]>;
  getWords(uri: string, index: number): Promise<PdfWord[]>;
};
let impl: Native;
if (Platform.OS === 'web') { impl = require('./src/web').default as Native; }
else {
  try { impl = requireNativeModule<Native>('PdfRenderer'); }
  catch (e) {
    // Native module missing from this build: fail per call instead of crashing at startup.
    const missing = () => Promise.reject(new Error('PDF 네이티브 모듈이 이 빌드에 포함되지 않았습니다. 앱을 다시 빌드해 주세요.'));
    impl = { importFile: missing, deleteFile: missing, fileExists: async () => false, clearCaches: async () => {}, getInfo: missing, renderPage: missing, getPageText: missing, getOutline: missing, getWords: async () => [] } as unknown as Native;
    console.error('PdfRenderer native module unavailable', e);
  }
}

export const PdfRenderer = {
  /** Encrypts and stores a picked PDF inside app-private storage. Returns the stored (encrypted) URI. */
  importFile: (srcUri: string, id: string) => impl.importFile(srcUri, id),
  deleteFile: (uri: string) => impl.deleteFile(uri).catch(() => {}),
  fileExists: (uri: string) => impl.fileExists(uri).catch(() => false),
  clearCaches: () => impl.clearCaches().catch(() => {}),
  getInfo: (uri: string) => impl.getInfo(uri),
  /** Renders one page to a PNG and returns a file:// or data: URI. `width` is the target pixel width. */
  renderPage: (uri: string, index: number, width: number) => impl.renderPage(uri, index, Math.round(width)),
  getPageText: (uri: string, index: number) => impl.getPageText(uri, index).catch(() => ''),
  getOutline: (uri: string) => impl.getOutline(uri).catch(() => [] as PdfOutlineItem[]),
  /** Words on a page with rectangles normalized to the page (0..1, top-left). Empty when the PDF has no text layer (scans). */
  getWords: (uri: string, index: number) => (impl.getWords ? impl.getWords(uri, index) : Promise.resolve([])).catch(() => [] as PdfWord[]),
};
