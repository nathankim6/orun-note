import { PDF_DETAIL_IDLE_MS } from './pdfWork';
export function createIdleQualityGate(options: {
  onReady: (ready: boolean) => void; isBusy: () => boolean;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const set = options.setTimer ?? setTimeout, clear = options.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null, disposed = false;
  const idle = () => {
    timer = null; if (disposed) return;
    if (options.isBusy()) { timer = set(idle, 250); return; }
    options.onReady(true);
  };
  return {
    activity() { if (disposed) return; options.onReady(false); if (timer != null) clear(timer); timer = set(idle, PDF_DETAIL_IDLE_MS); },
    dispose() { disposed = true; if (timer != null) clear(timer); timer = null; },
  };
}
