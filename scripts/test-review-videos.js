// JS-only component/hook mocks: no claim of native renderer or YouTube playback coverage.
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), assert = require('node:assert/strict');
const base = 'src/features/viewer/';
function load(file, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(base + file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, { exports, require: name => { if (name in deps) return deps[name]; throw Error('Unexpected dependency: ' + name); }, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, ...globals });
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
const generatedPreferences = load('reviewVideoPreferences.safe.generated.ts');
const { buildPreferencesSource, buildGeneratedFile } = require('./generate-review-video-preferences.js');
const sharedPreferencesInput = fs.readFileSync(base + 'reviewVideoSafety.ts', 'utf8');
assert.equal(generatedPreferences.PLAYER_PREFERENCES_SOURCE, buildPreferencesSource(sharedPreferencesInput));
assert.equal(fs.readFileSync(base + 'reviewVideoPreferences.safe.generated.ts', 'utf8'), buildGeneratedFile(sharedPreferencesInput));
require('node:child_process').execFileSync(process.execPath, ['scripts/generate-review-video-preferences.js', '--check'], { stdio: 'pipe' });
// A stale artifact must fail parity, including a function-only source edit.
assert.notEqual(buildGeneratedFile(sharedPreferencesInput.replace('let wanted = 1,', 'let wanted = 2,')), buildGeneratedFile(sharedPreferencesInput));
// Hermes need not preserve source text. Native HTML must never ask this function for its source.
safety.createPlayerPreferences.toString = () => '[bytecode]';
const staticPreferencesFactory = vm.runInNewContext('(' + generatedPreferences.PLAYER_PREFERENCES_SOURCE + ')');
function preferenceParity(factory) {
  const log = []; let actual = 1, modules = ['captions'], controller;
  const player = { getOptions: () => modules, setOption() { log.push('caption-track'); controller.captionsOff(); }, unloadModule() { log.push('caption-unload'); controller.captionsOff(); }, getAvailablePlaybackRates: () => [0.5, 1, 1.5, 2], getPlaybackRate: () => actual, setPlaybackRate(rate) { log.push(['requested', rate]); actual = rate; controller.sync(); } };
  controller = factory(() => player, message => log.push(message));
  controller.choose(1.5); controller.sync(); controller.captionsOff(); controller.captionsOff(); modules = []; controller.captionsOff(); modules = ['captions']; controller.captionsOff(); controller.choose(1.25); controller.choose(99); controller.dispose(); controller.choose(2); controller.sync(); controller.captionsOff();
  return JSON.stringify(log);
}
assert.equal(preferenceParity(staticPreferencesFactory), preferenceParity(safety.createPlayerPreferences));
const { bridgeStatus, normalizeReviewVideos, allowPlayerNavigation } = safety;
const validId = 'M7lc1UVf-VE'; // Public IFrame API fixture only, never production data.
// Actual shared controller, also serialized into the native player document.
let actualRate = 1, preferenceLive = false, rateCalls = [], captionCalls = [], preferenceMessages = [];
const preferencePlayer = { getAvailablePlaybackRates: () => [0.5, 1, 1.5, 2, 99], getPlaybackRate: () => actualRate, setPlaybackRate: rate => { rateCalls.push(rate); actualRate = rate; }, getOptions: () => ['captions'], setOption: (...args) => captionCalls.push(args), unloadModule: name => captionCalls.push(name) };
const pref = safety.createPlayerPreferences(() => preferenceLive ? preferencePlayer : null, message => preferenceMessages.push(message));
pref.choose(1.5); assert.equal(rateCalls.length, 0); preferenceLive = true; pref.sync(); assert.equal(actualRate, 1.5);
pref.choose(1.25); assert.equal(actualRate, 1.5); pref.choose(99); assert.equal(actualRate, 1.5);
pref.captionsOff(); assert.equal(captionCalls[0][0], 'captions'); assert.equal(captionCalls[0][1], 'track'); assert.equal(captionCalls[1], 'captions');
assert.equal(preferenceMessages.at(-1).r, 1.5); assert.equal(preferenceMessages.at(-1).a.includes(99), false);
pref.dispose(); const stopped = preferenceMessages.length; pref.choose(2); pref.sync(); pref.captionsOff(); assert.equal(preferenceMessages.length, stopped);
// Provider methods synchronously fire their own API/rate events, even without updating state.
let reentrant, captionModules = ['captions'], reentrantTrack = 0, reentrantUnload = 0, reentrantRate = 0, reentrantActual = 1;
const reentrantPlayer = { getOptions: () => captionModules, setOption() { reentrantTrack++; reentrant.captionsOff(); reentrant.sync(); }, unloadModule() { reentrantUnload++; reentrant.captionsOff(); reentrant.sync(); }, getAvailablePlaybackRates: () => [1, 1.5, 2], getPlaybackRate: () => reentrantActual, setPlaybackRate() { reentrantRate++; reentrant.sync(); } };
reentrant = safety.createPlayerPreferences(() => reentrantPlayer, () => {});
reentrant.captionsOff(); reentrant.captionsOff(); assert.equal(reentrantTrack, 1); assert.equal(reentrantUnload, 1);
captionModules = []; reentrant.captionsOff(); captionModules = ['captions']; reentrant.captionsOff(); assert.equal(reentrantTrack, 2); assert.equal(reentrantUnload, 2);
reentrant.choose(1.5); for (let i = 0; i < 20; i++) reentrant.sync(); assert.equal(reentrantRate, 1);
reentrantActual = 1.5; reentrant.sync(); reentrantActual = 1; reentrant.sync(); assert.equal(reentrantRate, 2); reentrant.dispose();
for (const target of [{ tagName: 'INPUT' }, { tagName: 'textarea' }, { tagName: 'SELECT' }, { isContentEditable: true }, { closest: () => ({ role: 'textbox' }) }]) assert.equal(safety.playerShortcutShouldPassThrough({ key: ' ', target }, false), true);
assert.equal(safety.playerShortcutShouldPassThrough({ key: ' ', isComposing: true }, false), true);
assert.equal(safety.playerShortcutShouldPassThrough({ key: ' ', target: null }, true), true);
assert.equal(safety.playerShortcutShouldPassThrough({ key: 'ArrowRight', target: null }, true), true);
assert.equal(safety.playerShortcutShouldPassThrough({ key: ' ', target: null }, false), false);

assert.equal(bridgeStatus('{"k":"rate","r":99,"a":[1]}'), null); assert.equal(bridgeStatus('{"k":"rate","r":1.5,"a":[1,1.5,99]}').availablePlaybackRates.length, 2);
for (const c of [{ width: 375, height: 812, top: 44, bottom: 34 }, { width: 390, height: 844, top: 47, bottom: 34 }, { width: 844, height: 390, top: 0, bottom: 21 }, { width: 1024, height: 768, top: 24, bottom: 20 }]) {
  const popup = safety.floatingVideoGeometry(c.width, c.height, c, { x: 99999, y: -99999 });
  assert.ok(popup.width >= 200 && popup.stageHeight >= 200); assert.ok(popup.x >= 0 && popup.y >= c.top); assert.ok(popup.x + popup.width <= c.width); assert.ok(popup.y + popup.height <= c.height - c.bottom);
}

// Official minimum is the iframe viewport, not a demand to stretch 16:9 video content.
const geometryCases = [
  { width: 375, height: 812, top: 44, bottom: 34, full: false, expectedWidth: 335, expectedHeight: 200 },
  { width: 390, height: 844, top: 47, bottom: 34, full: false, expectedWidth: 350, expectedHeight: 200 },
  { width: 667, height: 375, top: 0, bottom: 21, full: false, expectedWidth: 240, expectedHeight: 200 },
  { width: 844, height: 390, top: 0, bottom: 21, full: false, expectedWidth: 240, expectedHeight: 200 },
  { width: 844, height: 390, top: 0, bottom: 21, full: true, expectedWidth: 390 * 16 / 9, expectedHeight: 390 },
  { width: 1024, height: 1366, top: 24, bottom: 20, full: false, expectedWidth: 984, expectedHeight: 984 * 9 / 16 },
  { width: 1366, height: 1024, top: 24, bottom: 20, full: false, expectedWidth: 1040, expectedHeight: 585 },
  { width: 390, height: 844, top: 47, bottom: 34, full: true, expectedWidth: 390, expectedHeight: 390 * 9 / 16 },
];
for (const c of geometryCases) {
  const actual = safety.reviewPlayerGeometry(c.width, c.height, c, c.full);
  assert.ok(Math.abs(actual.width - c.expectedWidth) < 0.001, JSON.stringify(c)); assert.ok(Math.abs(actual.height - c.expectedHeight) < 0.001, JSON.stringify(c));
  assert.ok(actual.width >= 200 && actual.height >= 200); assert.ok(actual.width <= c.width); assert.ok(actual.height <= c.height - (c.full ? 0 : c.top + c.bottom));
}
const narrow = safety.reviewPlayerGeometry(220, 500, { top: 0, bottom: 0 }, false); assert.equal(narrow.width, 200); assert.equal(narrow.height, 200);
const impossible = safety.reviewPlayerGeometry(180, 160, { top: 0, bottom: 0 }, false); assert.equal(impossible.width, 180); assert.equal(impossible.height, 160);
for (const message of ['null', '[]', '{}', 'oops', '{"k":"time","t":"1","d":2,"l":0}', '{"k":"time","t":-1,"d":2,"l":0}', '{"k":"state","s":999}', 'x'.repeat(4096)]) assert.equal(bridgeStatus(message), null);
assert.equal(bridgeStatus('{"k":"time","t":1,"d":2,"l":9}').loaded, 1);
assert.equal(bridgeStatus('{"k":"state","s":1}').playing, true);
assert.equal(bridgeStatus('{"k":"error","c":100}').ready, false);
for (const code of [2, 5, 100, 101, 150, 152, 153, 'network', 'load', 'http', 'process', 'timeout']) {
  const status = bridgeStatus(JSON.stringify({ k: 'error', c: code, url: 'https://private.invalid', id: validId, message: 'private diagnostic' }));
  assert.equal(status.errorCode, code); assert.equal(status.ready, false); assert.equal(status.playing, false); assert.equal(typeof status.error, 'string');
  assert.equal(JSON.stringify(status).includes('private'), false); assert.equal(JSON.stringify(status).includes(validId), false);
}
for (const code of [999, -1009, NaN, Infinity, {}, null, undefined, '153', 'https://private.invalid', 'arbitrary native message']) assert.equal(safety.sanitizeStageErrorCode(code), 'load');
for (const c of [null, {}, [], true, '153', 'https://private.invalid']) assert.equal(bridgeStatus(JSON.stringify({ k: 'error', c })), null);
assert.equal(bridgeStatus('{"k":"error","c":999}').errorCode, 'load');
assert.equal(bridgeStatus('{"k":"ready","d":60}').errorCode, null);
assert.equal(safety.EMPTY_STATUS.errorCode, null);
assert.equal(safety.nativeLoadErrorCode({ nativeEvent: { code: -2 } }), 'network');
assert.equal(safety.nativeLoadErrorCode({ nativeEvent: { code: -1009, domain: 'NSURLErrorDomain' } }), 'network');
assert.equal(safety.nativeLoadErrorCode({ nativeEvent: { code: -1009, domain: 'unrecognized' } }), 'load');
assert.equal(safety.nativeLoadErrorCode(null), 'load');
const normalized = normalizeReviewVideos([null, { videoId: '<script>' }, { id: 'a', videoId: validId, title: null, passages: [null, {}, { title: ' A ', id: 'p' }, { title: 'duplicate', id: 'p' }] }, { id: 'a', videoId: validId }, { id: 'b', videoId: validId, passages: null }]);
assert.equal(normalized.length, 2); assert.equal(normalized[0].passages.length, 1); assert.equal(normalized[0].passages[0].title, 'A'); assert.equal(normalized[1].passages.length, 0);
const identityDoc = 'https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity';
const app = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo;
assert.equal(safety.PLAYER_ORIGIN, 'https://' + app.ios.bundleIdentifier); assert.equal(safety.PLAYER_ORIGIN, 'https://' + app.android.package);
assert.equal(safety.PLAYER_BASE, safety.PLAYER_ORIGIN + '/');
assert.ok(fs.readFileSync(base + 'reviewVideoSafety.ts', 'utf8').includes(identityDoc));
for (const url of ['https://youtube.com/watch?v=' + validId, 'youtube://watch', 'intent://x', 'javascript:alert(1)', 'https://evil.test', safety.PLAYER_BASE + 'evil', safety.PLAYER_BASE + '?x=1', safety.PLAYER_BASE + '#x', 'https://nathankim6.github.io/orun-note/', 'https://nathankim6.github.io/orun-note/review-player-v1.html#' + validId]) assert.equal(allowPlayerNavigation({ url }), false);
assert.equal(allowPlayerNavigation({ url: safety.PLAYER_BASE }), true);
assert.equal(allowPlayerNavigation({ url: 'about:blank' }), true);
assert.equal(allowPlayerNavigation({ url: 'https://www.youtube-nocookie.com/embed/' + validId, isTopFrame: false }), true);
assert.equal(allowPlayerNavigation({ url: 'https://www.youtube-nocookie.com/embed/' + validId, isTopFrame: true }), false);
assert.equal(allowPlayerNavigation({ url: 'https://evil.test', isTopFrame: false }), false);
assert.equal(allowPlayerNavigation(null), false);
const native = { AppState: { addEventListener: () => ({ remove() {} }) }, PanResponder: { create: handlers => ({ panHandlers: handlers }) }, View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Image: 'Image', TextInput: 'TextInput', ActivityIndicator: 'Spinner', StyleSheet: { absoluteFill: {}, create: x => x }, Platform: { OS: 'android' }, useWindowDimensions: () => ({ width: 900, height: 1100 }), BackHandler: { addEventListener: (_name, callback) => { native.back = callback; return { remove() { if (native.back === callback) native.back = null; } }; } } };
const stageModule = load('YouTubeStage.tsx', { react: React, 'react-native': native, 'react-native-webview': { WebView: 'WebView' }, './reviewVideoSafety': safety, './reviewVideoPreferences.safe.generated': generatedPreferences });
const stage = stageModule.YouTubeStage;
for (const [event, payload, expected] of [
  ['onError', { nativeEvent: { code: -2, description: 'private diagnostic', url: 'https://private.invalid' } }, 'network'],
  ['onError', { nativeEvent: { code: -1009, domain: 'NSURLErrorDomain' } }, 'network'],
  ['onError', { nativeEvent: { code: 999, description: 'private diagnostic' } }, 'load'],
  ['onHttpError', { nativeEvent: { statusCode: 403, url: 'https://private.invalid' } }, 'http'],
  ['onRenderProcessGone', { nativeEvent: { didCrash: true } }, 'process'],
  ['onContentProcessDidTerminate', {}, 'process'],
  ['onMessage', { nativeEvent: { data: '{"k":"error","c":153}' } }, 153],
]) {
  const observed = []; const errorRunner = runner(stage, { videoId: validId, onStatus: status => observed.push(status) });
  const stageTree = errorRunner.render(); const stageWeb = all(stageTree, n => n.type === 'WebView')[0];
  stageWeb.props[event](payload); assert.equal(observed.length, 1); assert.equal(observed[0].errorCode, expected); assert.equal(JSON.stringify(observed).includes('private'), false);
  assert.equal(all(errorRunner.render(), n => n.type === 'WebView').length, 0); errorRunner.unmount();
}
// Execute the real inline script against a minimal documented IFrame API double.
const html = stageModule.playerHtml(validId, safety.PLAYER_ORIGIN);
assert.equal(html.includes('[bytecode]'), false); assert.ok(html.includes(generatedPreferences.PLAYER_PREFERENCES_SOURCE));
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)[1]; new vm.Script(inlineScript);
const inlineMessages = []; let playerOptions;
const inlineContext = { URL, window: { location: { origin: safety.PLAYER_ORIGIN }, isSecureContext: true, ReactNativeWebView: { postMessage: value => inlineMessages.push(JSON.parse(value)) }, addEventListener() {} }, document: { baseURI: safety.PLAYER_BASE, referrer: 'PRIVATE_CANARY', addEventListener() {} }, YT: { Player: function (_id, options) { playerOptions = options; this.getDuration = () => 60; this.getIframe = () => ({ src: 'https://www.youtube-nocookie.com/embed/' + validId + '?origin=' + encodeURIComponent(safety.PLAYER_ORIGIN), getBoundingClientRect: () => ({ width: 900, height: 600 }), setAttribute() {} }); } }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} };
vm.runInNewContext(inlineScript + ';onYouTubeIframeAPIReady();', inlineContext);
assert.equal(playerOptions.playerVars.origin, safety.PLAYER_ORIGIN);
playerOptions.events.onError({ data: 150 }); assert.equal(inlineMessages.at(-1).c, 150);
const contextRow = stageModule.sanitizeQAPlayerContext(inlineMessages.at(-2));
assert.equal(contextRow.topOriginMatches, true); assert.equal(contextRow.baseOriginMatches, true); assert.equal(contextRow.frameOriginMatches, true); assert.equal(contextRow.frameHost, 'nocookie'); assert.equal(contextRow.width, 900); assert.equal(contextRow.height, 600); assert.equal(contextRow.apiReady, false); assert.equal(contextRow.documentReferrerPresent, true);
assert.equal(JSON.stringify(contextRow).includes('PRIVATE_CANARY'), false); assert.equal(JSON.stringify(contextRow).includes(validId), false); assert.equal(JSON.stringify(contextRow).includes(safety.PLAYER_ORIGIN), false);
assert.equal(stageModule.sanitizeQAPlayerContext(null), null); assert.equal(stageModule.sanitizeQAPlayerContext({ k: 'other' }), null);
const hostileContext = stageModule.sanitizeQAPlayerContext({ k: 'qa-context', frameHost: 'PRIVATE_CANARY', width: 10001, height: -1, topOriginMatches: 'PRIVATE_CANARY', url: 'PRIVATE_CANARY' }); assert.equal(JSON.stringify(hostileContext), '{"event":"player_context"}');
playerOptions.events.onError({ data: 153 }); assert.equal(inlineMessages.at(-1).c, 153);
playerOptions.events.onReady(); assert.equal(inlineMessages.at(-1).k, 'ready');
inlineContext.player.getIframe = () => null; playerOptions.events.onReady(); assert.equal(inlineMessages.at(-1).c, 'load');
let statuses = [], latest = [];
const props = { videoId: validId, onStatus: s => statuses.push(s) };
const handle = { current: null }; const r = runner(stage, props, handle);
let tree = r.render(); let web = all(tree, n => n.type === 'WebView')[0]; const source = web.props.source, message = web.props.onMessage;
// Android forwards this value directly into the shared Fabric array spec.
assert.ok(Array.isArray(web.props.dataDetectorTypes));
assert.deepEqual(Array.from(web.props.dataDetectorTypes), ['none']);
assert.match(fs.readFileSync('node_modules/react-native-webview/src/RNCWebViewNativeComponent.ts','utf8'), /dataDetectorTypes\?: WithDefault<\s*ReadonlyArray</);
assert.equal(source.uri, undefined); assert.equal(typeof source.html, 'string'); assert.equal(source.baseUrl, safety.PLAYER_BASE);
assert.equal(tree.props.accessibilityElementsHidden, true); assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants');
assert.equal(web.props.allowsPictureInPictureMediaPlayback, false); assert.equal(web.props.allowsAirPlayForMediaPlayback, false);
let injected = []; web.props.ref.current = { injectJavaScript: js => injected.push(js) };
message({ nativeEvent: { data: 'null' } }); assert.equal(statuses.length, 0);
message({ nativeEvent: { data: '{"k":"ready","d":60}' } }); handle.current.play(); assert.equal(injected.length, 2);
tree = r.render({ ...props, onStatus: s => latest.push(s) }); web = all(tree, n => n.type === 'WebView')[0];
assert.equal(web.props.source, source); assert.equal(web.props.onMessage, message);
message({ nativeEvent: { data: '{"k":"state","s":1}' } }); assert.equal(latest[0].playing, true);
handle.current.seek(NaN); assert.equal(injected.length, 2);
web.props.onContentProcessDidTerminate(); assert.equal(latest.at(-1).ready, false); assert.equal(latest.at(-1).errorCode, 'process');
assert.equal(all(r.render(), n => n.type === 'WebView').length, 0); handle.current.play(); assert.equal(injected.length, 2);
message({ nativeEvent: { data: '{"k":"ready","d":60}' } }); assert.equal(latest.at(-1).ready, false);
r.unmount();
// New explicit mount recovers. A stale native callback after disposal cannot issue commands/status.
const again = runner(stage, props); tree = again.render(); web = all(tree, n => n.type === 'WebView')[0]; const before = statuses.length; again.unmount(); web.props.onMessage({ nativeEvent: { data: '{"k":"ready","d":1}' } }); assert.equal(statuses.length, before);
const deps = { react: React, 'react-native': native, 'expo-linear-gradient': { LinearGradient: 'Gradient' }, 'expo-status-bar': { StatusBar: 'StatusBar' }, '@expo/vector-icons': {}, 'react-native-svg': {}, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }, '@/lib/api': { api: { reviewVideos: () => Promise.resolve({ videos: [] }) } }, '@/store/session': { useSession: selector => selector({ adminCode: null, student: { id: 'test' } }) }, './YouTubeStage': stageModule, './reviewVideoSafety': safety };
let actualKeyHandler;
const screens = load('ReviewVideos.tsx', deps, { window: { addEventListener: (name, fn) => { if (name === 'keydown') actualKeyHandler = fn; }, removeEventListener() {} } });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
(async () => {
  let webOptions, webInstanceCount = 0, webDestroyed = 0, webActualRate = 1, webCaptionCalls = 0;
  const webPlayer = { getDuration: () => 60, getIframe: () => ({ setAttribute() {}, style: {} }), getPlaybackRate: () => webActualRate, getAvailablePlaybackRates: () => [0.5, 1, 1.5, 2], setPlaybackRate: rate => { webActualRate = rate; }, getOptions: () => ['captions'], setOption: () => webCaptionCalls++, unloadModule() {}, destroy() { webDestroyed++; } };
  const webGlobals = { window: { location: { origin: 'https://actual-origin.test' }, YT: { Player: function (_mount, options) { webOptions = options; webInstanceCount++; return webPlayer; } } }, document: { createElement: () => ({}) } };
  const webModule = load('YouTubeStage.web.tsx', { react: React, './reviewVideoSafety': safety }, webGlobals);
  const webStatuses = [], webHandle = { current: null }, webRunner = runner(webModule.YouTubeStage, { videoId: validId, onStatus: s => webStatuses.push(s) }, webHandle);
  let webTree = webRunner.render(); webTree.props.ref.current = { replaceChildren() {} }; webHandle.current.setPlaybackRate(1.5); await flush();
  assert.equal(webOptions.playerVars.origin, 'https://actual-origin.test'); webOptions.events.onReady({ target: webPlayer }); assert.equal(webActualRate, 1.5); assert.ok(webCaptionCalls > 0);
  webOptions.events.onApiChange(); webOptions.events.onPlaybackRateChange({ data: 1.5 }); assert.equal(webStatuses.at(-1).playbackRate, 1.5);
  webRunner.render(); assert.equal(webInstanceCount, 1); webRunner.unmount(); const count = webStatuses.length; webOptions.events.onStateChange({ data: 1 }); assert.equal(webStatuses.length, count); assert.equal(webDestroyed, 1);
  let resolve, calls = 0, closed = 0;
  const loadVideos = () => { calls++; return new Promise(r => { resolve = r; }); };
  const screenProps = { loadVideos, onClose: () => closed++ };
  const wrapper = screens.ReviewVideosScreen(screenProps); const content = wrapper.props.children[0];
  const screen = runner(content.type, content.props);
  tree = screen.render(); assert.ok(find(tree, 'review-videos-screen')); assert.equal(calls, 1);
  resolve({ videos: normalized }); await flush(); tree = screen.render();
  const cards = all(tree, n => n.props?.v); assert.equal(cards.length, 2); cards[0].props.onPress();
  tree = screen.render(); assert.equal(all(tree, n => n.props?.video).length, 1);
  const hiddenList = find(tree, 'review-videos-list'); assert.equal(hiddenList.props['aria-hidden'], true); assert.equal(hiddenList.props.accessibilityElementsHidden, true); assert.equal(hiddenList.props.importantForAccessibility, 'no-hide-descendants');
  const playerElement = all(tree, n => n.props?.video)[0];
  native.Platform.OS = 'web'; let keyPrevented = 0;
  const keyboardPlayer = runner(playerElement.type, { ...playerElement.props }); keyboardPlayer.render();
  actualKeyHandler({ key: ' ', target: { tagName: 'INPUT' }, preventDefault() { keyPrevented++; } }); assert.equal(keyPrevented, 0);
  actualKeyHandler({ key: ' ', target: null, preventDefault() { keyPrevented++; } }); assert.equal(keyPrevented, 1);
  keyboardPlayer.render({ ...keyboardPlayer.props, floating: true }); actualKeyHandler({ key: ' ', target: null, preventDefault() { keyPrevented++; } }); assert.equal(keyPrevented, 1); keyboardPlayer.unmount(); native.Platform.OS = 'android';
  const playback = []; const playerRunner = runner(playerElement.type, { ...playerElement.props, onPlaybackStatus: s => playback.push(s) });
  let playerTree = playerRunner.render();
  const stagePath = tree => { let found; const walk = (node, path = []) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach((n, i) => walk(n, [...path, i])); if (node.type === stage) found = path; walk(node.props?.children, [...path, String(node.type)]); }; walk(tree); return JSON.stringify(found); };
  const normalStagePath = stagePath(playerTree); assert.equal(all(playerTree, n => n.type === 'StatusBar').length, 1);
  assert.ok(find(playerTree, 'review-video-speed-controls'));
  const speedChoices = []; all(playerTree, n => n.type === stage)[0].props.ref.current = { setPlaybackRate: rate => speedChoices.push(rate), pause() {} };
  all(playerTree, n => n.props?.accessibilityLabel === '1.5배속')[0].props.onPress(); assert.equal(speedChoices.at(-1), 1.5); assert.equal(playback.at(-1).playbackRate, 1);
  playerTree = playerRunner.render({ ...playerRunner.props, floating: true }); assert.equal(all(playerTree, n => n.type === 'StatusBar').length, 0); assert.equal(stagePath(playerTree), normalStagePath); assert.ok(find(playerTree, 'review-video-popup-play')); assert.ok(all(playerTree, n => n.props?.testID === 'review-video-popup-restore')[0]); assert.ok(all(playerTree, n => n.props?.testID === 'review-video-popup-close')[0]);
  playerTree = playerRunner.render({ ...playerRunner.props, floating: false }); assert.equal(all(playerTree, n => n.type === 'StatusBar').length, 1); assert.equal(stagePath(playerTree), normalStagePath);
  const viewport = find(playerTree, 'review-video-player-viewport'); assert.ok(viewport.props.style.width >= 200); assert.ok(viewport.props.style.height >= 200);
  const playerStage = () => all(playerTree, n => n.type === stage)[0];
  playerStage().props.onStatus({ ready: true, duration: 60 }); playerTree = playerRunner.render(); assert.equal(playback.at(-1).ready, true);
  playerStage().props.onStatus({ playing: true }); playerTree = playerRunner.render(); assert.equal(playback.at(-1).playing, true);
  playerStage().props.onStatus({ ready: false, playing: false, error: 'recoverable', errorCode: 153 }); playerTree = playerRunner.render(); assert.equal(playback.at(-1).errorCode, 153); assert.equal(playerStage(), undefined);
  find(playerTree, 'review-video-player-retry').props.onPress(); playerTree = playerRunner.render(); assert.ok(playerStage()); assert.equal(playback.at(-1).error, null); assert.equal(playback.at(-1).errorCode, null);
  let pauses = 0; playerStage().props.ref.current = { pause() { pauses++; } };
  const closePlayerControl = all(playerTree, n => n.props?.testID === 'review-video-player-close')[0]; closePlayerControl.props.onPress(); assert.equal(pauses, 1);
  closePlayerControl.props.onPress(); assert.equal(pauses, 1); playerRunner.unmount();
  all(tree, n => n.props?.video)[0].props.onClose(); tree = screen.render(); assert.equal(all(tree, n => n.props?.video).length, 0);
  native.back(); assert.equal(closed, 1); screen.unmount();
  // Actual ReviewVideosContent lifecycle: full-player X returns to the list; popup X dismisses the overlay.
  let overlayClosed = 0; const floatingEvents = [];
  const closeBranches = runner(content.type, { loadVideos: async () => ({ videos: normalized }), onClose: () => overlayClosed++, onFloatingChange: value => floatingEvents.push(value) });
  closeBranches.render(); await flush(); let branchTree = closeBranches.render();
  all(branchTree, n => n.props?.v)[0].props.onPress(); branchTree = closeBranches.render();
  all(branchTree, n => n.props?.video)[0].props.onClose(); branchTree = closeBranches.render();
  assert.equal(overlayClosed, 0); assert.equal(all(branchTree, n => n.props?.video).length, 0); assert.equal(find(branchTree, 'review-videos-list').props.style.display, 'flex');
  all(branchTree, n => n.props?.v)[0].props.onPress(); branchTree = closeBranches.render();
  all(branchTree, n => n.props?.video)[0].props.onFloatingChange(true); branchTree = closeBranches.render();
  assert.equal(find(branchTree, 'review-videos-list').props.style.display, 'none'); assert.equal(all(branchTree, n => n.props?.video)[0].props.floating, true);
  all(branchTree, n => n.props?.video)[0].props.onClose(); branchTree = closeBranches.render();
  assert.equal(overlayClosed, 1); assert.equal(all(branchTree, n => n.props?.video).length, 0); assert.equal(floatingEvents.at(-1), false);
  // Stay transparent until parent unmounts: never flash/expand the full list over the notes.
  assert.equal(find(branchTree, 'review-videos-list').props.style.display, 'none'); closeBranches.unmount();
  // Late load completion is ignored after close/unmount, and reopening starts a new request.
  const pending = runner(content.type, content.props); pending.render(); pending.unmount(); resolve({ videos: normalized }); await flush(); assert.equal(pending.slots[0], null);
  const retryProps = { ...screenProps, loadVideos: (() => { let count = 0; return () => ++count === 1 ? Promise.reject(Error('offline')) : Promise.resolve({ videos: normalized }); })() };
  const retry = runner(content.type, retryProps); retry.render(); await flush(); tree = retry.render(); assert.ok(find(tree, 'review-videos-list-retry')); find(tree, 'review-videos-list-retry').props.onPress(); await flush(); tree = retry.render(); assert.equal(all(tree, n => n.props?.v).length, 2); retry.unmount();
  assert.equal(screens.ReviewVideosSheet({ visible: false, onClose() {} }), null);
  assert.equal(screens.ReviewVideosOverlay({ visible: false, onClose() {} }), null);
  assert.equal(screens.ReviewVideosOverlay({ visible: true, onClose() {} }).props.pointerEvents, 'box-none');
  assert.equal(screens.ReviewVideosSheet({ visible: true, onClose() {} }).props.pointerEvents, 'box-none');
  for (const file of ['ReviewVideos.tsx', 'YouTubeStage.tsx', 'YouTubeStage.web.tsx']) {
    const source = fs.readFileSync(base + file, 'utf8'); assert.doesNotMatch(source, /<Modal\b|\.reload\(/); assert.doesNotMatch(source, /Linking\.openURL|window\.open\(/);
  }
  const viewerSource = fs.readFileSync('app/viewer/[docId].tsx', 'utf8');
  assert.match(viewerSource, /<DocumentView active=\{viewerActive\}/); assert.match(viewerSource, /const inkEnabled = true/); assert.match(viewerSource, /viewerActive && videosOpen && <View pointerEvents="box-none"/);
  const webSource = fs.readFileSync(base + 'YouTubeStage.web.tsx', 'utf8');
  assert.match(webSource, /'aria-hidden': true, inert: true/); assert.match(webSource, /f\.setAttribute\('aria-hidden', 'true'\)/); assert.match(webSource, /f\.setAttribute\('inert', ''\)/);
  const nativeSource = fs.readFileSync(base + 'YouTubeStage.tsx', 'utf8');
  assert.doesNotMatch(nativeSource, /\.toString\s*\(|\beval\s*\(/);
  assert.match(nativeSource, /PLAYER_PREFERENCES_SOURCE/);
  assert.match(nativeSource, /html: playerHtml\(videoId, PLAYER_ORIGIN\), baseUrl: PLAYER_BASE/);
  assert.doesNotMatch(nativeSource, /playerSourceUri|review-player-v1|uri:/);
  assert.match(nativeSource, /allowsPictureInPictureMediaPlayback=\{false\}/); assert.match(nativeSource, /allowsAirPlayForMediaPlayback=\{false\}/); assert.match(nativeSource, /accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/);
  console.log('PASS review videos: normalization, malformed bridge, navigation, stable source/callbacks, process failure/unmount, dead refs, screen open/close/back/cancellation/retry. JS mocks only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
