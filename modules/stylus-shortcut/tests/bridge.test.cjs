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
});
test('iOS source contract: availability, terminal squeeze only, explicit detach, SDK settings respected', () => {
  const s = read('ios/PencilShortcutObserver.swift');
  for (const text of ['@available(iOS 17.5, *)', 'squeeze.phase == .ended', 'pencilInteractionDidTap', 'didReceiveTap', 'removeInteraction(pencil)', 'pencil.delegate = nil', 'window.screen.coordinateSpace', 'preferredSqueezeAction != .ignore', 'preferredTapAction != .ignore']) assert.ok(s.includes(text), text);
  assert.ok(!s.includes('UIGestureRecognizer'));
});
