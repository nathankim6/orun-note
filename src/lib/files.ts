import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { PdfRenderer } from '../../modules/pdf-renderer';
import { COVER_COLORS, useDocsStore } from '@/store/docs';
import { api } from './api';
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
  if (doc.kind === 'blank') return 'blank:';
  if (doc.sourceDocId) { const src = useDocsStore.getState().docs[doc.sourceDocId]; if (src) return resolveUri(src); }
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

export async function importPdf({ uri, name: name0, size, file, title: title0, subject, materialId }: { uri: string; name: string; size: number; file?: File; title?: string; subject?: string; materialId?: string }): Promise<Doc> {
  const name = name0.normalize('NFC'); const title = title0?.normalize('NFC'); // Mac file names are decomposed (NFD)
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

export async function deleteDocFiles(doc: Doc) { if (doc.kind === 'blank' || doc.sourceDocId) return; const others = Object.values(useDocsStore.getState().docs).some((d) => d.id !== doc.id && d.sourceDocId === doc.id); if (others) return; // keep the file while split copies still use it
  if (Platform.OS === 'web') { await idb.del(doc.id).catch(() => {}); const u = webUrls.get(doc.id); if (u) URL.revokeObjectURL(u); webUrls.delete(doc.id); } else { await PdfRenderer.deleteFile(doc.uri); } }
export async function storageUsage(): Promise<number> { return Object.values(useDocsStore.getState().docs).reduce((a, d) => a + d.size, 0); }
export async function clearPageCache() { await PdfRenderer.clearCaches(); }

/** Web/desktop download with progress. responseType 'blob' lets the browser keep big files in its blob store instead of JS memory. */
function xhrGetBlob(url: string, onProgress?: (p: number) => void) {
  return new Promise<Blob>((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = 'blob';
    x.onprogress = (ev) => { if (ev.lengthComputable && ev.total > 0) onProgress?.(Math.min(0.99, ev.loaded / ev.total)); };
    x.onload = () => { if (x.status >= 200 && x.status < 300) { onProgress?.(1); resolve(x.response as Blob); } else reject(new Error('다운로드 실패 ' + x.status)); };
    x.onerror = () => reject(new Error('네트워크 문제로 받기가 끊겼어요. 연결을 확인하고 다시 시도해 주세요.'));
    x.send();
  });
}
/** Downloads a material through a short-lived signed URL and stores it encrypted like any other document. */
export async function downloadMaterial(code: string | null, materialId: string, title: string, onProgress?: (p: number) => void, coverUrl?: string | null): Promise<Doc> {
  const r = await api.download(code, materialId);
  const coverUri = coverUrl ? await cacheCover(coverUrl) : null;
  if (Platform.OS === 'web') { const blob = await xhrGetBlob(r.url, onProgress); const url = URL.createObjectURL(blob); const d0 = await importPdf({ uri: url, name: r.fileName || `${title}.pdf`, size: blob.size, file: blob as any, title, materialId }); if (coverUri) useDocsStore.getState().update(d0.id, { coverUri }); return { ...d0, coverUri: coverUri ?? undefined }; }
  const tmp = `${FileSystem.cacheDirectory}dl-${materialId}.pdf`;
  const task = FileSystem.createDownloadResumable(r.url, tmp, {}, (ev) => { if (ev.totalBytesExpectedToWrite > 0) onProgress?.(ev.totalBytesWritten / ev.totalBytesExpectedToWrite); });
  const res = await task.downloadAsync(); if (!res || res.status !== 200) throw new Error('다운로드 실패 ' + (res?.status ?? ''));
  const doc = await importPdf({ uri: tmp, name: r.fileName || `${title}.pdf`, size: 0, title, materialId });
  await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
  if (coverUri) useDocsStore.getState().update(doc.id, { coverUri });
  return { ...doc, coverUri: coverUri ?? undefined };
}
/** Largest PDF the client will try to upload. The real ceiling is the Supabase storage file-size limit (plan + bucket setting). */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
export const UPLOAD_LIMIT_MSG = '서버 업로드 한도를 넘었어요. Supabase 요금제(파일 크기 한도)를 올려야 해요.';
const NET_UPLOAD_MSG = '네트워크 문제로 업로드가 끊겼어요. 연결을 확인하고 다시 시도해 주세요.';
/** Storage answers 413 (or 400 with statusCode "413") and "The object exceeded the maximum allowed size" when the file is over the limit. */
const isSizeLimit = (status: number, body: string) => status === 413 || /maximum allowed size|payload too large|entity too large|exceeded the maximum|"statusCode"\s*:\s*"413"/i.test(body);
function uploadFailure(status: number, body: string): Error {
  if (isSizeLimit(status, body)) { const e = new Error(UPLOAD_LIMIT_MSG); e.name = 'UploadLimitError'; return e; }
  let msg = ''; try { const j = JSON.parse(body); msg = j?.message ?? j?.error ?? ''; } catch { msg = (body ?? '').replace(/<[^>]+>/g, ' ').trim(); }
  return new Error(`업로드 실패 (${status || '네트워크'})${msg ? ' ' + String(msg).slice(0, 120) : ''}`);
}
/** Web/desktop: XHR streams the File from disk and reports upload progress (fetch has no upload progress). */
function xhrPut(url: string, body: Blob, headers: Record<string, string>, onProgress?: (p: number) => void) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (ev) => { if (ev.lengthComputable && ev.total > 0) onProgress?.(Math.min(0.99, ev.loaded / ev.total)); };
    x.onload = () => resolve({ status: x.status, body: String(x.responseText ?? '') });
    x.onerror = () => reject(new Error(NET_UPLOAD_MSG)); x.onabort = () => reject(new Error('업로드를 취소했어요.')); x.ontimeout = () => reject(new Error(NET_UPLOAD_MSG));
    x.send(body);
  });
}
/** Admin: uploads a local PDF to the shared bucket and registers it as a material. Large files are streamed from disk
 *  (native: expo-file-system upload task, web/desktop: XHR with the picked File), never read into JS memory. */
export async function uploadMaterial(code: string | null, picked: { uri: string; name: string; size: number; file?: File }, title: string, onProgress?: (p: number) => void) {
  let size = picked.size || picked.file?.size || 0;
  if (!size && Platform.OS !== 'web') { const fi: any = await FileSystem.getInfoAsync(picked.uri).catch(() => null); if (fi?.exists && !fi.isDirectory) size = fi.size ?? 0; }
  if (size > MAX_UPLOAD_BYTES) throw new Error('파일이 1GB를 넘어요. PDF를 압축하거나 나눠서 올려 주세요.');
  // Page count for the library tile. Native engines map the file; pdf.js on web would load a huge file into memory,
  // so very large web uploads skip it (students' devices read the real page count after downloading).
  const info = Platform.OS === 'web' && size > 300 * 1024 * 1024 ? { pageCount: 0 } : await PdfRenderer.getInfo(picked.uri).catch(() => ({ pageCount: 0 }));
  const u = await api.materials.uploadUrl(code, title, picked.name);
  const headers = { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }; // same headers as before (allowed by storage CORS)
  try {
    if (Platform.OS === 'web') {
      const blob = picked.file ?? (await (await fetch(picked.uri)).blob());
      const res = await xhrPut(u.uploadUrl, blob, headers, onProgress);
      if (res.status < 200 || res.status >= 300) throw uploadFailure(res.status, res.body);
    } else {
      const task = FileSystem.createUploadTask(u.uploadUrl, picked.uri, { httpMethod: 'PUT', headers, uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT }, (ev) => { if (ev.totalBytesExpectedToSend > 0) onProgress?.(Math.min(0.99, ev.totalBytesSent / ev.totalBytesExpectedToSend)); });
      let res: Awaited<ReturnType<typeof task.uploadAsync>>;
      try { res = await task.uploadAsync(); } catch (e: any) { throw new Error(NET_UPLOAD_MSG + (e?.message ? ` (${String(e.message).slice(0, 80)})` : '')); }
      if (!res || res.status < 200 || res.status >= 300) throw uploadFailure(res?.status ?? 0, res?.body ?? '');
    }
  } catch (e) {
    api.materials.delete(code, u.materialId).catch(() => {}); // don't leave a half-registered material behind
    throw e;
  }
  onProgress?.(1);
  const done = await api.materials.complete(code, u.materialId, size, info.pageCount);
  // native: the picker's cached copy of a big PDF is no longer needed
  if (Platform.OS !== 'web' && picked.uri.startsWith(FileSystem.cacheDirectory ?? '§')) FileSystem.deleteAsync(picked.uri, { idempotent: true }).catch(() => {});
  return done.material;
}

/** A free-drawing notebook: no PDF file, N pages of the chosen paper template (US letter-like proportions in PDF points). */
export function createBlankDoc(title: string, template: Doc['template'] = 'plain', pages = 3): Doc {
  const store = useDocsStore.getState();
  const pg = Array.from({ length: pages }, (_, i) => ({ index: i, width: 612, height: 792 }));
  return store.add({ title, fileName: '', uri: 'blank:', size: 0, pageCount: pages, pages: pg, kind: 'blank', template, coverColor: COVER_COLORS[Object.keys(store.docs).length % COVER_COLORS.length] } as any);
}
export function addBlankPages(doc: Doc, count = 1) {
  const next = [...doc.pages, ...Array.from({ length: count }, (_, i) => ({ index: doc.pages.length + i, width: 612, height: 792 }))];
  useDocsStore.getState().update(doc.id, { pages: next, pageCount: next.length });
}
/** Split: a new document showing only the selected pages of `doc`, sharing its file. Auto-named "<title> (p.a-b)". */
export function splitDoc(doc: Doc, pageIndexes: number[], titleOverride?: string): Doc {
  const store = useDocsStore.getState(); const sorted = [...pageIndexes].sort((a, b) => a - b);
  const label = sorted.length === 1 ? `p.${sorted[0] + 1}` : sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1) ? `p.${sorted[0] + 1}-${sorted[sorted.length - 1] + 1}` : `${sorted.length}p 발췌`;
  const base = doc.sourceDocId ? store.docs[doc.sourceDocId] ?? doc : doc;
  const pages = sorted.map((i) => ({ ...doc.pages[i] }));
  return store.add({ title: titleOverride ?? `${doc.title} (${label})`, fileName: base.fileName, uri: base.uri, size: 0, pageCount: pages.length, pages, kind: base.kind, template: base.template, sourceDocId: base.kind === 'blank' ? undefined : base.id, coverColor: doc.coverColor, folderId: doc.folderId } as any);
}
/** Pick a photo and return a data/file URI suitable for an ImageBox. */
export async function pickImageForPage(): Promise<{ uri: string; width: number; height: number } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!perm.granted && Platform.OS !== 'web') return null;
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, base64: Platform.OS === 'web' });
  if (r.canceled || !r.assets?.length) return null; const a = r.assets[0];
  let uri = a.uri;
  if (Platform.OS !== 'web') { // copy into app-private storage so the image survives picker cache cleanup
    const FS = FileSystem; const dir = FS.documentDirectory + 'orun-images/'; await FS.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {}); const dest = dir + Date.now().toString(36) + '.jpg'; await FS.copyAsync({ from: a.uri, to: dest }); uri = dest;
  } else if (a.base64) uri = `data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}`;
  return { uri, width: a.width, height: a.height };
}

/** Admin: upload a cover image for a material (PUT to a signed URL). */
export async function uploadCover(code: string | null, materialId: string, picked: { uri: string; mimeType?: string }) {
  const ext = (picked.mimeType?.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
  const r = await api.materials.coverUploadUrl(code, materialId, ext);
  const blob = await (await fetch(picked.uri)).blob();
  const res = await fetch(r.uploadUrl, { method: 'PUT', headers: { 'Content-Type': picked.mimeType ?? 'image/jpeg', 'x-upsert': 'true' }, body: blob });
  if (!res.ok) throw new Error('표지 업로드 실패 (' + res.status + ')');
}
/** Cache a material's cover locally so the library can show it offline. */
export async function cacheCover(url: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') { const b = await (await fetch(url)).blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b); }); }
    const dir = FileSystem.documentDirectory + 'orun-covers/'; await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {}); const dest = dir + Date.now().toString(36) + '.jpg'; const d = await FileSystem.downloadAsync(url, dest); return d.uri;
  } catch { return null; }
}
