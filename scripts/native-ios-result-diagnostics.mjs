/** Read bounded XCResult objects after an unchanged failed XCTest. Never export raw strings or refs. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { classifyIosTestDiagnostics, sanitizeIosDriverStatus } from './native-ios-test-diagnostics.mjs';
const MAX_OBJECTS = 8, MAX_BYTES = 8 * 1024 * 1024, MAX_NODES = 100000, MAX_TEXT = 1024 * 1024;
const REF_KEYS = new Set(['testsRef', 'summaryRef', 'testSummaryRef']);
// Legacy XCResult IDs are version~URL-safe-base64 with optional trailing padding.
// Keep old simple opaque IDs, reject flags/control/path characters, and never export IDs.
function validReference(id) {
  return typeof id === 'string' && id.length <= 256 && !/\s/.test(id) && /^(?:[A-Za-z0-9][A-Za-z0-9_-]*|[0-9]+~[A-Za-z0-9_-]+={0,2})$/.test(id);
}
export function inspectResultObject(root) {
  const stack = [root], refs = [], texts = [], refSeen = new Set(); let nodes = 0, size = 0, clipped = false;
  while (stack.length && nodes++ < MAX_NODES) {
    const value = stack.pop();
    if (typeof value === 'string') {
      if (/(?:error|fail|launch|domain|exception|denied|crash|exited|library not loaded)/i.test(value)) {
        if (value.length + 1 <= MAX_TEXT - size) { texts.push(value); size += value.length + 1; } else clipped = true;
      }
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const id = REF_KEYS.has(key) ? child?.id?._value : undefined;
        if (REF_KEYS.has(key) && !validReference(id)) clipped = true;
        if (validReference(id) && !refSeen.has(id)) {
          refSeen.add(id); if (refs.length < 32) refs.push(id); else clipped = true;
        }
        stack.push(child);
      }
    }
  }
  return { refs, text: texts.join('\n'), clipped: clipped || stack.length > 0 };
}
export function collectResultDiagnostics({ bundle, exitCode, readObject } = {}) {
  let objectsRead = 0, clipped = false, failed = false, invalid = false, text = '';
  const queue = [undefined], seen = new Set();
  while (queue.length && objectsRead < MAX_OBJECTS) {
    const id = queue.shift(), key = id ?? '<root>'; if (seen.has(key)) continue; seen.add(key);
    let raw; try { raw = readObject(bundle, id); } catch { failed = true; continue; }
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES) { invalid = true; continue; }
    let object; try { object = JSON.parse(raw); } catch { invalid = true; continue; }
    objectsRead++;
    const found = inspectResultObject(object); clipped ||= found.clipped;
    if (found.text.length + 1 <= MAX_TEXT - text.length) text += '\n' + found.text; else clipped = true;
    for (const ref of found.refs) if (!seen.has(ref) && !queue.includes(ref)) {
      if (queue.length < 32) queue.push(ref); else clipped = true;
    }
  }
  const collection = objectsRead ? ((failed || invalid || queue.length || clipped) ? 'partial' : 'observed') : (invalid ? 'invalid' : 'unavailable');
  return sanitizeIosDriverStatus({ ...classifyIosTestDiagnostics({ text, stage: 'xctest', exitCode }), source: 'xcresult', collection, objectsRead, textClipped: clipped });
}
function cli() {
  const [bundle, rawExitCode] = process.argv.slice(2);
  const exitCode = /^\d{1,3}$/.test(rawExitCode || '') ? Number(rawExitCode) : undefined;
  if (!['true', '1'].includes(process.env.CI) || process.env.GITHUB_ACTIONS !== 'true' || process.env.NATIVE_SMOKE_QA !== '1') {
    console.log('QA_JSON ' + JSON.stringify(sanitizeIosDriverStatus({ source: 'xcresult', collection: 'not_ci', exitCode }))); process.exitCode = 1; return;
  }
  const readObject = (file, id) => {
    if (typeof file !== 'string' || !fs.existsSync(file)) throw new Error('unavailable');
    const args = ['xcresulttool', 'get', 'object', '--legacy', '--path', file, '--format', 'json'];
    if (id) args.push('--id', id);
    return execFileSync('xcrun', args, { encoding: 'utf8', timeout: 15000, maxBuffer: MAX_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });
  };
  console.log('QA_JSON ' + JSON.stringify(collectResultDiagnostics({ bundle, exitCode, readObject })));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
