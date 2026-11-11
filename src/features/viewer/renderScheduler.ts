/** Pure single-worker queue. Native renders cannot be interrupted once started. */
export const RenderPriority = { preview: -1, tile: 0, visible: 1, prefetch: 2 } as const;
export class RenderCancelled extends Error { constructor() { super('Unused queued PDF render'); } }
type Meta = { page: string; width: number; index?: number };
// Deliberately excludes cache keys/URIs and document metadata.
export type RenderTiming = { index?: number; width?: number; waitMs: number; preparationMs: number };
type ObserverOptions = { now?: () => number; onComplete?: (timing: RenderTiming) => void | Promise<void> };
type Entry = {
  queuedAt: number; key: string; state: 'queued' | 'running' | 'settled'; value?: string; meta?: Meta;
  promise: Promise<string>; resolve: (value: string) => void; reject: (error: unknown) => void;
  run: () => Promise<string>; users: Map<number, number>; pri: number; seq: number;
};
export type RenderLease = { promise: Promise<string>; release: () => void };
export function createRenderScheduler(maxSettled = 64, maxPrefetch = 2, options: ObserverOptions = {}) {
  const now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  function observe(e: Entry, startedAt: number) {
    if (!options.onComplete) return;
    try {
      const result = options.onComplete({ index: e.meta?.index, width: e.meta?.width,
        waitMs: Math.max(0, startedAt - e.queuedAt), preparationMs: Math.max(0, now() - startedAt) });
      // Neither a thrown observer nor a rejected async observer may interrupt the worker.
      if (result) Promise.resolve(result).catch(() => {});
    } catch {}
  }
  const entries = new Map<string, Entry>();
  const idleWaiters = new Map<() => void, number>();
  const hasWork = (priority: number) => [...entries.values()].some(e => e.state !== 'settled' && e.pri <= priority);
  function notifyIdle() { for (const [done, priority] of idleWaiters) if (!hasWork(priority)) { idleWaiters.delete(done); done(); } }
  const speculative = new Map<RenderLease, number>();
  let active = false, seq = 0, user = 0;
  let window: RenderLease[] | null = null;
  function trim() {
    const settled = [...entries.values()].filter(e => e.state === 'settled');
    for (const e of settled.slice(0, Math.max(0, settled.length - maxSettled))) entries.delete(e.key);
  }
  function touch(e: Entry) { entries.delete(e.key); entries.set(e.key, e); }
  function pump() {
    notifyIdle();
    if (active) return;
    const e = [...entries.values()].filter(e => e.state === 'queued')
      .sort((a, b) => a.pri - b.pri || b.seq - a.seq)[0];
    if (!e) return;
    active = true; e.state = 'running';
    // Also catch synchronous bridge failures; never leave the worker stuck or create an unhandled finally chain.
    let startedAt = 0;
    Promise.resolve().then(() => { startedAt = now(); return e.run(); }).then(value => {
      observe(e, startedAt);
      e.state = 'settled'; e.value = value; touch(e); trim(); e.resolve(value);
    }, error => { if (entries.get(e.key) === e) entries.delete(e.key); e.reject(error); })
      .then(() => { active = false; pump(); });
  }
  function acquire(key: string, pri: number, run: () => Promise<string>, meta?: Meta): RenderLease {
    let e = entries.get(key);
    if (!e) {
      let resolve!: Entry['resolve'], reject!: Entry['reject'];
      const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
      // Callers may release a queued lease before attaching their own handler.
      promise.catch(() => {});
      e = { queuedAt: now(), key, state: 'queued', promise, resolve, reject, run, meta, users: new Map(), pri, seq: seq++ };
      entries.set(key, e);
    }
    const entry = e, id = user++;
    entry.users.set(id, pri); entry.pri = Math.min(...entry.users.values()); entry.seq = seq++;
    if (entry.state === 'settled') touch(entry);
    let released = false;
    const lease: RenderLease = { promise: entry.promise, release: () => {
      if (released) return; released = true; speculative.delete(lease); entry.users.delete(id);
      if (!entry.users.size && entry.state === 'queued') {
        if (entries.get(key) === entry) entries.delete(key);
        entry.reject(new RenderCancelled());
      } else if (entry.users.size) entry.pri = Math.min(...entry.users.values());
      notifyIdle();
    } };
    pump(); return lease;
  }
  return {
    acquire,
    whenIdle(priority = Infinity): Promise<void> {
      if (!hasWork(priority)) return Promise.resolve();
      return new Promise(resolve => idleWaiters.set(resolve, priority));
    },
    state: (key: string) => entries.get(key)?.state,
    value(key: string) { const e = entries.get(key); if (e?.state !== 'settled') return undefined; touch(e); return e.value; },
    available(page: string, width: number) {
      const e = [...entries.values()].filter(e => e.state === 'settled' && e.meta?.page === page && e.meta.width <= width)
        .sort((a, b) => b.meta!.width - a.meta!.width)[0];
      if (e) touch(e); return e?.value;
    },
    remember(key: string, value: string, meta?: Meta) {
      if (entries.has(key)) return;
      // Disk hits need no worker slot and must not overwrite a shared running/queued request.
      entries.set(key, { queuedAt: now(), key, state: 'settled', value, meta, promise: Promise.resolve(value),
        resolve: () => {}, reject: () => {}, run: () => Promise.resolve(value),
        users: new Map(), pri: RenderPriority.preview, seq: seq++ });
      trim();
    },
    prefetch(key: string, pri: number, run: () => Promise<string>, meta?: Meta) {
      const lease = acquire(key, pri, run, meta); speculative.set(lease, seq++); window?.push(lease);
      // Bound all speculative leases, including callers without a lifecycle window.
      while (speculative.size > maxPrefetch) {
        const oldest = speculative.keys().next().value!; oldest.release();
      }
      lease.promise.then(lease.release, lease.release); return lease;
    },
    prefetchWindow(run: () => void) {
      const prior = window, leases: RenderLease[] = []; window = leases;
      try { run(); } catch (error) { leases.forEach(lease => lease.release()); throw error; }
      finally { window = prior; }
      return () => leases.forEach(lease => lease.release());
    },
    clear() {
      for (const lease of [...speculative.keys()]) lease.release();
      for (const e of entries.values()) if (e.state === 'settled') entries.delete(e.key);
    },
  };
}
