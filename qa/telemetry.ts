type Event = { event: string; [key: string]: unknown };
const events: Event[] = [];
let listener: (() => void) | undefined;
export function marker(event: string, values: Record<string, unknown> = {}) {
  const row = { event, ...values };
  events.push(row); if (events.length > 900) events.shift(); // a full 20-cycle run with PDF trials emits ~300 markers; the driver reads this buffer once at the end
  console.log('QA_JSON ' + JSON.stringify(row)); listener?.();
}
export function telemetry() { return JSON.stringify(events); }
export function subscribe(fn: () => void) { listener = fn; return () => { listener = undefined; }; }
