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

export async function importPdf({ uri, name, size, file, title, subject, materialId }: { uri: string; name: string; size: number; file?: File; title?: string; subject?: string; materialId?: string }): Promise<Doc> {
  const store = useDocsStore.getState(); const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  let finalUri = uri;
  if (Platform.OS === 'web') { const blob = file ?? (await (await fetch(uri)).blob()); await idb.put(id, blob); finalUri = URL.createObjectURL(blob); webUrls.set(id, finalUri); size = size || blob.size; }
  else {
    const stored = await PdfRenderer.importFile(uri, id); finalUri = stored.uri; size = stored.size;
    // remove the picker's temporary plaintext copy so only the encrypted file remains on device
    if (uri.startsWith(FileSystem.cacheDirectory ?? '§')) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
  const info = await PdfRenderer.getInfo(finalUri);
  const doc: Doc = { id, title: title?.trim() || info.title?.trim() || name.replace(/\.pdf$/i, ''), fileName: name, uri: finalUri, size, pageCount: info.pageCount, pages: info.pages.map((p, i) => ({ index: i, width: p.width, height: p.height })), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastPage: 0, bookmarks: [], coverColor: COVER_COLORS[Object.keys(store.docs).length % COVER_COLORS.length], cycle: 1, maxCycle: 1, subject, tags: [], materialId };
  useDocsStore.setState((s) => ({ docs: { ...s.docs, [id]: doc } }));
  return doc;
}

export async function deleteDocFiles(doc: Doc) { if (Platform.OS === 'web') { await idb.del(doc.id).catch(() => {}); const u = webUrls.get(doc.id); if (u) URL.revokeObjectURL(u); webUrls.delete(doc.id); } else { await PdfRenderer.deleteFile(doc.uri); } }
export async function storageUsage(): Promise<number> { return Object.values(useDocsStore.getState().docs).reduce((a, d) => a + d.size, 0); }
export async function clearPageCache() { await PdfRenderer.clearCaches(); }

/** Downloads a material through a short-lived signed URL and stores it encrypted like any other document. */
export async function downloadMaterial(code: string, materialId: string, title: string, onProgress?: (p: number) => void): Promise<Doc> {
  const { api } = await import('./api');
  const r = await api.download(code, materialId);
  if (Platform.OS === 'web') { const res = await fetch(r.url); if (!res.ok) throw new Error('다운로드 실패 ' + res.status); const blob = await res.blob(); const url = URL.createObjectURL(blob); return importPdf({ uri: url, name: r.fileName || `${title}.pdf`, size: blob.size, file: blob as any, title, materialId }); }
  const tmp = `${FileSystem.cacheDirectory}dl-${materialId}.pdf`;
  const task = FileSystem.createDownloadResumable(r.url, tmp, {}, (ev) => { if (ev.totalBytesExpectedToWrite > 0) onProgress?.(ev.totalBytesWritten / ev.totalBytesExpectedToWrite); });
  const res = await task.downloadAsync(); if (!res || res.status !== 200) throw new Error('다운로드 실패 ' + (res?.status ?? ''));
  const doc = await importPdf({ uri: tmp, name: r.fileName || `${title}.pdf`, size: 0, title, materialId });
  await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
  return doc;
}
/** Admin: uploads a local PDF to the shared bucket and registers it as a material. */
export async function uploadMaterial(code: string, picked: { uri: string; name: string; size: number; file?: File }, title: string, onProgress?: (p: number) => void) {
  const { api } = await import('./api');
  if (picked.size > 50 * 1024 * 1024) throw new Error('파일이 50MB를 넘습니다 (무료 서버 한도). PDF를 압축하거나 나눠서 올려 주세요.');
  const info = await PdfRenderer.getInfo(picked.uri).catch(() => ({ pageCount: 0 }));
  const u = await api.materials.uploadUrl(code, title, picked.name);
  if (Platform.OS === 'web') { const blob = picked.file ?? (await (await fetch(picked.uri)).blob()); const res = await fetch(u.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: blob }); if (!res.ok) throw new Error('업로드 실패 ' + res.status + ' ' + (await res.text()).slice(0, 120)); onProgress?.(1); }
  else { const task = FileSystem.createUploadTask(u.uploadUrl, picked.uri, { httpMethod: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT }, (ev) => { if (ev.totalBytesExpectedToSend > 0) onProgress?.(ev.totalBytesSent / ev.totalBytesExpectedToSend); }); const res = await task.uploadAsync(); if (!res || res.status >= 300) throw new Error('업로드 실패 ' + (res?.status ?? '') + ' ' + (res?.body ?? '').slice(0, 120)); }
  const done = await api.materials.complete(code, u.materialId, picked.size, info.pageCount);
  return done.material;
}
