// Public API status codes / fixed transport enums only. Never error messages.
const youtubeCodes = new Set([2, 5, 100, 101, 150, 152, 153]);
const transportCodes = new Set(['load', 'http', 'process', 'timeout', 'network']);
const jsExceptions = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError', 'InternalError']);
export function playerErrorCode(value: unknown): number | string | undefined {
  if (typeof value === 'number' && youtubeCodes.has(value)) return value;
  if (typeof value === 'string' && transportCodes.has(value)) return value;
  return undefined;
}
export function jsExceptionName(value: unknown): string | undefined {
  return typeof value === 'string' && jsExceptions.has(value) ? value : undefined;
}
