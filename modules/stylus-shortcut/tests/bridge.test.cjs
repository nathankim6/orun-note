const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
function load(os, native) {
  const out = ts.transpileModule(read('index.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const ctx = { exports: {}, require: name => name === 'react-native' ? { Platform: { OS: os } } : { requireOptionalNativeModule: () => native } };
  vm.runInNewContext(out, ctx);
  return ctx.exports;
}
test('wrapper forwards actual event and removes subscription once', () => {
  let callback, removals = 0;
  const api = load('android', { addListener(name, cb) { assert.equal(name, 'onStylusShortcut'); callback = cb; return { remove() { removals++; } }; } });
  let received;
  const sub = api.addStylusShortcutListener(e => received = e);
  const event = { kind: 'stylus-button', x: 24, y: 56 };
  callback(event);
  assert.equal(received, event);
  sub.remove(); sub.remove();
  assert.equal(removals, 1);
  assert.equal(api.hasStylusShortcutBridge(), true);
});
test('web and older native binaries are safe no-op', () => {
  for (const [os, native] of [['web', {}], ['ios', null]]) {
    const api = load(os, native);
    assert.equal(api.hasStylusShortcutBridge(), false);
    const sub = api.addStylusShortcutListener(() => assert.fail('unexpected event'));
    sub.remove(); sub.remove();
  }
});
test('Android source contract: pass-through both input streams and ownership-safe cleanup', () => {
  const s = read('android/src/main/java/expo/modules/stylusshortcut/StylusShortcutModule.kt');
  for (const text of ['return original.dispatchTouchEvent(event)', 'return original.dispatchGenericMotionEvent(event)', 'window?.callback === wrapper', 'wrapper.active = false', 'if (stylus < 0) return', 'if (state && !held)', 'held = state', 'OnActivityEntersBackground', 'OnDestroy']) assert.ok(s.includes(text), text);
  assert.ok(!/event\.action\s*=|MotionEvent\.obtain|dispatchTouchEvent\(.*cancel/i.test(s));
  // 1.6.20: every form a pen-button press can take is observed, and all of them stay pass-through.
  for (const text of ['return original.dispatchKeyEvent(event)', 'setOf(308, 309, 310)', 'MotionEvent.BUTTON_SECONDARY or MotionEvent.BUTTON_TERTIARY', 'const val SAMSUNG_PEN_DOWN = 211', 'event.repeatCount == 0', 'Function("takeDiagnostics")']) assert.ok(s.includes(text), text);
  assert.ok(!/setOf\([^)]*311/.test(s), 'the tail button belongs to the system (default notes app)');
  const diag = s.slice(s.indexOf('internal class StylusDiagnostics'), s.indexOf('internal class ShortcutCallback'));
  assert.ok(!/getX|getY|rawX|rawY|getPressure/.test(diag), 'diagnostics hold counts and codes only, never positions');
});
test('diagnostics summary: silent without a pen-button signal, bounded text otherwise', () => {
  const api = load('android', { addListener() { return { remove() {} }; } });
  const S = api.stylusDiagnosticsSummary;
  assert.equal(S(null, 'android'), null);
  assert.equal(S({ stylusEvents: 900, hoverEvents: 400, emitted: 0, buttonStates: [], actionButtons: [], vendorActions: [], keyCodes: [] }, 'android'), null, 'plain writing is never reported');
  assert.equal(S({ stylusEvents: 12, hoverEvents: 9, emitted: 0, unfocused: 3, buttonStates: [32], actionButtons: [], vendorActions: [], keyCodes: [] }, 'android'),
    'stylus shortcut android emitted=0 stylusEvents=12 hover=9 unfocused=3 buttonStates=[32] actionButtons=[] vendorActions=[] keyCodes=[]');
  assert.match(S({ emitted: 1, buttonStates: [2], keyCodes: [308], vendorActions: [211, 213], x: 'secret', stylusEvents: Infinity }, 'android'), /emitted=1 stylusEvents=0 .*buttonStates=\[2\].*vendorActions=\[211,213\] keyCodes=\[308\]$/);
  assert.equal(S({ tap: 0, squeeze: 0, emitted: 0, preferredTap: 1 }, 'ios'), null);
  assert.equal(S({ tap: 2, emitted: 0, tapPreferenceOff: 2, preferredTap: 0 }, 'ios'), 'stylus shortcut ios emitted=0 tap=2 squeeze=0 tapPreferenceOff=2 squeezePreferenceOff=0 notKeyOrActive=0 preferredTap=0 preferredSqueeze=0');
});
test('takeStylusDiagnostics tolerates a missing / throwing / older bridge', async () => {
  assert.equal(await load('web', {}).takeStylusDiagnostics(), null);
  assert.equal(await load('android', { addListener() {} }).takeStylusDiagnostics(), null, 'older binary without the function');
  assert.equal(await load('android', { addListener() {}, takeDiagnostics() { throw new Error('x'); } }).takeStylusDiagnostics(), null);
  assert.deepEqual(await load('ios', { addListener() {}, takeDiagnostics: async () => ({ tap: 1 }) }).takeStylusDiagnostics(), { tap: 1 });
});
test('iOS source contract: availability, terminal squeeze only, explicit detach, SDK settings respected', () => {
  const s = read('ios/PencilShortcutObserver.swift');
  assert.ok(s.includes('func takeDiagnostics() -> [String: Any]'));
  for (const text of ['@available(iOS 17.5, *)', 'squeeze.phase == .ended', 'pencilInteractionDidTap', 'didReceiveTap', 'removeInteraction(pencil)', 'pencil.delegate = nil', 'window.screen.coordinateSpace', 'preferredSqueezeAction != .ignore', 'preferredTapAction != .ignore']) assert.ok(s.includes(text), text);
  assert.ok(!s.includes('UIGestureRecognizer'));
});
