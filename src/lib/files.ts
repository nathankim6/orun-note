import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { PdfRenderer } from '../../modules/pdf-renderer';
import { COVER_COLORS, useDocsStore } from '@/store/docs';
import { Doc } from '@/data/types';

// --- web (preview only): keep PDF bytes in IndexedDB so documents survive reloads. Native builds never use this path;
// they store AES-GCM encrypted files via the native module. ---
const idb = {
  open: () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('paperly', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async put(key: string, blob: Blob) { const db = await this.open(); await new Promise<void>((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(blob, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async get(key: string) { const db = await this.open(); return new Promise<Blob | undefined>((res, rej) => { const r = db.transaction('files').objectStore('files').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async del(key: string) { const db = await this.open(); await new Promise<void>((res) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(key); tx.oncomplete = () => res(); }); },
};
const webUrls = new Map<string, string>();
export async function resolveUri(doc: Doc): Promise<string | null> {
  if (Platform.OS !== 'web') return (await PdfRenderer.fileExists(doc.uri)) ? doc.uri : null;
  if (webUrls.has(doc.id)) return webUrls.get(doc.id)!;
  const blob = await idb.get(doc.id).catch(() => undefined); if (!blob) return null; const url = URL.createObjectURL(blob); webUrls.set(doc.id, url); return url;
}

export async function pickAndImportPdf(): Promise<Doc | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  return importPdf({ uri: a.uri, name: a.name, size: a.size ?? 0, file: (a as any).file as File | undefined });
}

export async function importPdf({ uri, name, size, file, title, subject }: { uri: string; name: string; size: number; file?: File; title?: string; subject?: string }): Promise<Doc> {
  const store = useDocsStore.getState(); const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  let finalUri = uri;
  if (Platform.OS === 'web') { const blob = file ?? (await (await fetch(uri)).blob()); await idb.put(id, blob); finalUri = URL.createObjectURL(blob); webUrls.set(id, finalUri); size = size || blob.size; }
  else {
    const stored = await PdfRenderer.importFile(uri, id); finalUri = stored.uri; size = stored.size;
    // remove the picker's temporary plaintext copy so only the encrypted file remains on device
    if (uri.startsWith(FileSystem.cacheDirectory ?? '§')) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
  const info = await PdfRenderer.getInfo(finalUri);
  const doc: Doc = { id, title: title?.trim() || info.title?.trim() || name.replace(/\.pdf$/i, ''), fileName: name, uri: finalUri, size, pageCount: info.pageCount, pages: info.pages.map((p, i) => ({ index: i, width: p.width, height: p.height })), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastPage: 0, bookmarks: [], coverColor: COVER_COLORS[Object.keys(store.docs).length % COVER_COLORS.length], cycle: 1, maxCycle: 1, subject, tags: [] };
  useDocsStore.setState((s) => ({ docs: { ...s.docs, [id]: doc } }));
  return doc;
}

export async function deleteDocFiles(doc: Doc) { if (Platform.OS === 'web') { await idb.del(doc.id).catch(() => {}); const u = webUrls.get(doc.id); if (u) URL.revokeObjectURL(u); webUrls.delete(doc.id); } else { await PdfRenderer.deleteFile(doc.uri); } }
export async function storageUsage(): Promise<number> { return Object.values(useDocsStore.getState().docs).reduce((a, d) => a + d.size, 0); }
export async function clearPageCache() { await PdfRenderer.clearCaches(); }
