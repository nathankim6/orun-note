type Event = { event: string; [key: string]: unknown };
const events: Event[] = [];
let listener: (() => void) | undefined;
export function marker(event: string, values: Record<string, unknown> = {}) {
  const row = { event, ...values };
  events.push(row); if (events.length > 180) events.shift();
  console.log('QA_JSON ' + JSON.stringify(row)); listener?.();
}
export function telemetry() { return JSON.stringify(events); }
export function subscribe(fn: () => void) { listener = fn; return () => { listener = undefined; }; }
