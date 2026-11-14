/** Cancels only the in-progress gesture, never committed ink. Shared by main, zoom and subnote canvases. */
const listeners = new Set<() => void>();
export function onStylusShortcutCancel(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function cancelInkForStylusShortcut(): void { for (const fn of [...listeners]) fn(); }

/** First normal pen contact closes UI without consuming or cancelling that contact. */
const contacts = new Set<() => void>();
export function onInkContact(fn: () => void): () => void { contacts.add(fn); return () => { contacts.delete(fn); }; }
export function notifyInkContact(): void { for (const fn of [...contacts]) fn(); }
