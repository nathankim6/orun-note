import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { callDocs } from './api';
import { PdfRenderer } from '../../modules/pdf-renderer';
import { useSession } from '@/store/session';

/** Crash / error diagnostics: sent to the server so failures on students' devices can be traced without the device. */
type Item = { kind: string; at: number; detail: string };
let sentThisSession = 0; const seen = new Set<string>();
const meta = () => {
  const s = useSession.getState(); const c: any = Platform.constants ?? {};
  return {
    app: String(Constants.expoConfig?.version ?? ''), platform: `${Platform.OS} ${Platform.Version ?? ''}`.trim(),
    device: [c.Manufacturer ?? c.Brand, c.Model ?? (Platform.OS === 'ios' ? (Platform as any).isPad ? 'iPad' : 'iPhone' : '')].filter(Boolean).join(' '),
    who: s.role === 'student' && s.student ? `${s.student.name} (${s.student.code})` : s.role === 'admin' ? 'admin' : (s.email ?? ''),
  };
};
async function send(items: Item[]) {
  if (!items.length) return;
  try { await callDocs('crash.report', null, { items, ...meta() }); } catch { /* offline: best effort */ }
}
/** A JS error (uncaught, or a render error caught by a boundary). At most 6 per app session, duplicates dropped. */
export function reportError(kind: 'js' | 'render', err: unknown, extra = '') {
  try {
    const e: any = err; const msg = String(e?.message ?? e ?? 'unknown');
    const key = kind + msg.slice(0, 120); if (seen.has(key) || sentThisSession >= 6) return; seen.add(key); sentThisSession++;
    const detail = [msg, extra, String(e?.componentStack ?? '').slice(0, 3000), String(e?.stack ?? '').slice(0, 6000)].filter(Boolean).join('\n');
    send([{ kind, at: Date.now(), detail }]);
  } catch {}
}
/** Native crashes recorded by the previous runs (Android): uploaded once at start-up. */
export async function flushNativeCrashes() {
  if (Platform.OS === 'web') return;
  try { const items = await PdfRenderer.takeCrashReports(); if (items.length) await send(items.slice(-12)); } catch {}
}
