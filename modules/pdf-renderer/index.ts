import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import type { PdfInfo, PdfOutlineItem } from './src/types';
export * from './src/types';

type Native = {
  importFile(srcUri: string, id: string): Promise<{ uri: string; size: number }>;
  deleteFile(uri: string): Promise<void>; fileExists(uri: string): Promise<boolean>; clearCaches(): Promise<void>;
  getInfo(uri: string): Promise<PdfInfo>; renderPage(uri: string, index: number, width: number): Promise<string>;
  getPageText(uri: string, index: number): Promise<string>; getOutline(uri: string): Promise<PdfOutlineItem[]>;
};
let impl: Native;
if (Platform.OS === 'web') { impl = require('./src/web').default as Native; } else { impl = requireNativeModule<Native>('PdfRenderer'); }

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
};
