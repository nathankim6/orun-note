// JS-only component/hook mocks: no claim of native renderer or YouTube playback coverage.
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
const base = 'src/features/viewer/';
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(base + file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, { exports, require: name => { if (name in deps) return deps[name]; throw Error('Unexpected dependency: ' + name); }, URL, console, setTimeout, clearTimeout, setInterval, clearInterval });
  return exports;
}
let current;
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  forwardRef: fn => fn,
  useRef(value) { const r = current, i = r.index++; return r.slots[i] ??= { current: value }; },
  useState(value) { const r = current, i = r.index++; if (!(i in r.slots)) r.slots[i] = typeof value === 'function' ? value() : value; return [r.slots[i], next => { r.slots[i] = typeof next === 'function' ? next(r.slots[i]) : next; }]; },
  useMemo(fn, deps) { const r = current, i = r.index++; if (!r.slots[i] || !same(r.slots[i].deps, deps)) r.slots[i] = { deps, value: fn() }; return r.slots[i].value; },
  useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
  useEffect(fn, deps) { const r = current, i = r.index++; if (!r.slots[i] || !same(r.slots[i].deps, deps)) { const old = r.slots[i]; r.effects.push(() => { old?.cleanup?.(); r.slots[i] = { deps, cleanup: fn() }; }); } },
  useImperativeHandle(ref, fn, deps) { ref.current = React.useMemo(fn, deps); },
  Component: class {}, Fragment: 'Fragment',
};
React.default = React;
function runner(fn, props, ref = { current: null }) {
  const r = { slots: [], index: 0, effects: [], props, ref };
  r.render = (next = r.props) => { r.props = next; r.index = 0; r.effects = []; current = r; const tree = fn(next, ref); current = null; r.effects.forEach(f => f()); return tree; };
  r.unmount = () => r.slots.forEach(s => s?.cleanup?.());
  return r;
}
function all(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(x => all(x, predicate)); return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)]; }
const find = (tree, id) => all(tree, n => n.props?.testID === id)[0];
const safety = load('reviewVideoSafety.ts');
const { bridgeStatus, normalizeReviewVideos, allowPlayerNavigation } = safety;
const validId = 'M7lc1UVf-VE'; // Public IFrame API fixture only, never production data.
for (const message of ['null', '[]', '{}', 'oops', '{"k":"time","t":"1","d":2,"l":0}', '{"k":"time","t":-1,"d":2,"l":0}', '{"k":"state","s":999}', 'x'.repeat(4096)]) assert.equal(bridgeStatus(message), null);
assert.equal(bridgeStatus('{"k":"time","t":1,"d":2,"l":9}').loaded, 1);
assert.equal(bridgeStatus('{"k":"state","s":1}').playing, true);
assert.equal(bridgeStatus('{"k":"error","c":100}').ready, false);
const normalized = normalizeReviewVideos([null, { videoId: '<script>' }, { id: 'a', videoId: validId, title: null, passages: [null, {}, { title: ' A ', id: 'p' }, { title: 'duplicate', id: 'p' }] }, { id: 'a', videoId: validId }, { id: 'b', videoId: validId, passages: null }]);
assert.equal(normalized.length, 2); assert.equal(normalized[0].passages.length, 1); assert.equal(normalized[0].passages[0].title, 'A'); assert.equal(normalized[1].passages.length, 0);
for (const url of ['https://youtube.com/watch?v=' + validId, 'youtube://watch', 'intent://x', 'javascript:alert(1)', 'https://evil.test', safety.PLAYER_BASE + 'evil']) assert.equal(allowPlayerNavigation({ url }), false);
assert.equal(allowPlayerNavigation({ url: safety.PLAYER_BASE }), true);
assert.equal(allowPlayerNavigation({ url: 'https://www.youtube-nocookie.com/embed/' + validId, isTopFrame: false }), true);
assert.equal(allowPlayerNavigation({ url: 'https://evil.test', isTopFrame: false }), false);
const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Image: 'Image', TextInput: 'TextInput', ActivityIndicator: 'Spinner', StyleSheet: { absoluteFill: {}, create: x => x }, Platform: { OS: 'android' }, useWindowDimensions: () => ({ width: 900, height: 1100 }), BackHandler: { addEventListener: (_name, callback) => { native.back = callback; return { remove() { if (native.back === callback) native.back = null; } }; } } };
const stageModule = load('YouTubeStage.tsx', { react: React, 'react-native': native, 'react-native-webview': { WebView: 'WebView' }, './reviewVideoSafety': safety });
const stage = stageModule.YouTubeStage;
let statuses = [], latest = [];
const props = { videoId: validId, onStatus: s => statuses.push(s) };
const handle = { current: null }; const r = runner(stage, props, handle);
let tree = r.render(); let web = all(tree, n => n.type === 'WebView')[0]; const source = web.props.source, message = web.props.onMessage;
let injected = []; web.props.ref.current = { injectJavaScript: js => injected.push(js) };
message({ nativeEvent: { data: 'null' } }); assert.equal(statuses.length, 0);
message({ nativeEvent: { data: '{"k":"ready","d":60}' } }); handle.current.play(); assert.equal(injected.length, 1);
tree = r.render({ ...props, onStatus: s => latest.push(s) }); web = all(tree, n => n.type === 'WebView')[0];
assert.equal(web.props.source, source); assert.equal(web.props.onMessage, message);
message({ nativeEvent: { data: '{"k":"state","s":1}' } }); assert.equal(latest[0].playing, true);
handle.current.seek(NaN); assert.equal(injected.length, 1);
web.props.onContentProcessDidTerminate(); assert.equal(latest.at(-1).ready, false);
assert.equal(all(r.render(), n => n.type === 'WebView').length, 0); handle.current.play(); assert.equal(injected.length, 1);
message({ nativeEvent: { data: '{"k":"ready","d":60}' } }); assert.equal(latest.at(-1).ready, false);
r.unmount();
// New explicit mount recovers. A stale native callback after disposal cannot issue commands/status.
const again = runner(stage, props); tree = again.render(); web = all(tree, n => n.type === 'WebView')[0]; const before = statuses.length; again.unmount(); web.props.onMessage({ nativeEvent: { data: '{"k":"ready","d":1}' } }); assert.equal(statuses.length, before);
const deps = { react: React, 'react-native': native, 'expo-linear-gradient': { LinearGradient: 'Gradient' }, 'expo-status-bar': { StatusBar: 'StatusBar' }, '@expo/vector-icons': {}, 'react-native-svg': {}, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }, '@/lib/api': { api: { reviewVideos: () => Promise.resolve({ videos: [] }) } }, '@/store/session': { useSession: selector => selector({ adminCode: null, student: { id: 'test' } }) }, './YouTubeStage': stageModule, './reviewVideoSafety': safety };
const screens = load('ReviewVideos.tsx', deps);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
(async () => {
  let resolve, calls = 0, closed = 0;
  const loadVideos = () => { calls++; return new Promise(r => { resolve = r; }); };
  const screenProps = { loadVideos, onClose: () => closed++ };
  const wrapper = screens.ReviewVideosScreen(screenProps); const content = wrapper.props.children[0];
  const screen = runner(content.type, content.props);
  tree = screen.render(); assert.ok(find(tree, 'review-videos-screen')); assert.equal(calls, 1);
  resolve({ videos: normalized }); await flush(); tree = screen.render();
  const cards = all(tree, n => n.props?.v); assert.equal(cards.length, 2); cards[0].props.onPress();
  tree = screen.render(); assert.equal(all(tree, n => n.props?.video).length, 1);
  const playerElement = all(tree, n => n.props?.video)[0];
  const playback = []; const playerRunner = runner(playerElement.type, { ...playerElement.props, onPlaybackStatus: s => playback.push(s) });
  let playerTree = playerRunner.render();
  const playerStage = () => all(playerTree, n => n.type === stage)[0];
  playerStage().props.onStatus({ ready: true, duration: 60 }); playerTree = playerRunner.render(); assert.equal(playback.at(-1).ready, true);
  playerStage().props.onStatus({ playing: true }); playerTree = playerRunner.render(); assert.equal(playback.at(-1).playing, true);
  playerStage().props.onStatus({ ready: false, playing: false, error: 'recoverable' }); playerTree = playerRunner.render(); assert.equal(playerStage(), undefined);
  find(playerTree, 'review-video-player-retry').props.onPress(); playerTree = playerRunner.render(); assert.ok(playerStage()); assert.equal(playback.at(-1).error, null);
  playerRunner.unmount();
  all(tree, n => n.props?.video)[0].props.onClose(); tree = screen.render(); assert.equal(all(tree, n => n.props?.video).length, 0);
  native.back(); assert.equal(closed, 1); screen.unmount();
  // Late load completion is ignored after close/unmount, and reopening starts a new request.
  const pending = runner(content.type, content.props); pending.render(); pending.unmount(); resolve({ videos: normalized }); await flush(); assert.equal(pending.slots[0], null);
  const retryProps = { ...screenProps, loadVideos: (() => { let count = 0; return () => ++count === 1 ? Promise.reject(Error('offline')) : Promise.resolve({ videos: normalized }); })() };
  const retry = runner(content.type, retryProps); retry.render(); await flush(); tree = retry.render(); assert.ok(find(tree, 'review-videos-list-retry')); find(tree, 'review-videos-list-retry').props.onPress(); await flush(); tree = retry.render(); assert.equal(all(tree, n => n.props?.v).length, 2); retry.unmount();
  assert.equal(screens.ReviewVideosSheet({ visible: false, onClose() {} }), null);
  for (const file of ['ReviewVideos.tsx', 'YouTubeStage.tsx', 'YouTubeStage.web.tsx']) {
    const source = fs.readFileSync(base + file, 'utf8'); assert.doesNotMatch(source, /<Modal\b|\.reload\(/); assert.doesNotMatch(source, /Linking\.openURL|window\.open\(/);
  }
  console.log('PASS review videos: normalization, malformed bridge, navigation, stable source/callbacks, process failure/unmount, dead refs, screen open/close/back/cancellation/retry. JS mocks only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
