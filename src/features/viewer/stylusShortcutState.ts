/** Cancels only the in-progress gesture, never committed ink. Shared by main, zoom and subnote canvases. */
const listeners = new Set<() => void>();
export function onStylusShortcutCancel(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function cancelInkForStylusShortcut(): void { for (const fn of [...listeners]) fn(); }
