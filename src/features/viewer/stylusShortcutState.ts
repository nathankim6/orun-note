/** Cancels only the in-progress gesture, never committed ink. Shared by main, zoom and subnote canvases. */
const listeners = new Set<() => void>();
export function onStylusShortcutCancel(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function cancelInkForStylusShortcut(): void { for (const fn of [...listeners]) fn(); }

/** First normal pen contact closes UI without consuming or cancelling that contact. */
const contacts = new Set<() => void>();
export function onInkContact(fn: () => void): () => void { contacts.add(fn); return () => { contacts.delete(fn); }; }
export function notifyInkContact(): void { for (const fn of [...contacts]) fn(); }

/** Pen in contact, or lifted less than this ago: a Pencil squeeze / double-tap is taken as grip, not as a request for tools. */
export const SHORTCUT_WRITING_GRACE_MS = 900;
export function shortcutWhileWriting(ps: { writing: boolean; at: number }, now: number): boolean {
  return !!ps.writing || (ps.at > 0 && now - ps.at < SHORTCUT_WRITING_GRACE_MS);
}
