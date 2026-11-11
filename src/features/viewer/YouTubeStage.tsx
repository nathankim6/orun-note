import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

// The library defaults its generic to undefined, which makes props an impossible intersection.
const WebView = RNWebView<{}>;

import { StageStatus, StageHandle, StageErrorCode, stageFailure, nativeLoadErrorCode, bridgeStatus, validPlaybackRate, validVideoId, allowPlayerNavigation, PLAYER_ORIGIN, PLAYER_BASE } from './reviewVideoSafety';
export { StageStatus, StageHandle, StageErrorCode, EMPTY_STATUS, stageError } from './reviewVideoSafety';

import { PLAYER_PREFERENCES_SOURCE } from './reviewVideoPreferences.safe.generated';

const blockWindow = () => {};

export function playerHtml(videoId: string, origin: string) {
  const vars = JSON.stringify({ autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, cc_load_policy: 0, hl: 'ko', origin });
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#p,iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;pointer-events:none}</style></head>
<body><div id="p" aria-hidden="true" inert></div>
<script>
var player=null,ready=false,tick=null,timeout=null;
var prefs=(${PLAYER_PREFERENCES_SOURCE})(function(){return ready?player:null},post);
function post(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}}
function onYouTubeIframeAPIReady(){
  try{player=new YT.Player('p',{host:'https://www.youtube-nocookie.com',videoId:${JSON.stringify(videoId)},width:'100%',height:'100%',playerVars:${vars},
    events:{
      onReady:function(){try{var frame=player.getIframe();frame.setAttribute("aria-hidden","true");frame.setAttribute("tabindex","-1");frame.setAttribute("inert","");ready=true;clearTimeout(timeout);post({k:'ready',d:player.getDuration()});prefs.captionsOff();prefs.sync();
        clearInterval(tick);tick=setInterval(function(){try{post({k:'time',t:player.getCurrentTime(),d:player.getDuration(),l:player.getVideoLoadedFraction()})}catch(e){}},250)}catch(e){post({k:'error',c:'load'})}},
      onApiChange:function(){prefs.captionsOff();prefs.sync()},
      onPlaybackRateChange:function(){prefs.sync()},
      onStateChange:function(e){post({k:'state',s:e.data})},
      onAutoplayBlocked:function(){post({k:'state',s:2})},
      onError:function(e){post({k:'error',c:e.data})}}});}catch(e){post({k:'error',c:'load'})}
}
window.cmd=function(c){if(!player||!ready)return;
  if(c.t==='play')player.playVideo();else if(c.t==='pause')player.pauseVideo();else if(c.t==='seek')player.seekTo(c.v,true);else if(c.t==='rate')prefs.choose(c.v);};
document.addEventListener('contextmenu',function(e){e.preventDefault()});
window.addEventListener('pagehide',function(){ready=false;prefs.dispose();clearInterval(tick);clearTimeout(timeout);try{if(player)player.destroy()}catch(e){}player=null;});
timeout=setTimeout(function(){if(!ready)post({k:'error',c:'timeout'})},30000);
</script>
<script src="https://www.youtube.com/iframe_api" onerror="post({k:'error',c:'network'})"></script>
</body></html>`;
}

/** No native presentation boundary, external navigation, or automatic process reload. */
export const YouTubeStage = forwardRef<StageHandle, { videoId: string; onStatus: (s: Partial<StageStatus>) => void }>(function YouTubeStage({ videoId, onStatus }, ref) {
  const web = useRef<RNWebView<{}> | null>(null);
  const latest = useRef(onStatus); latest.current = onStatus;
  const alive = useRef(true); const ready = useRef(false); const failed = useRef(false);
  const desiredRate = useRef(1);
  const [failure, setFailure] = useState(false);
  // Crucial: polling status rerenders must not replace the WebView source object.
  const source = useMemo(() => ({ html: playerHtml(videoId, PLAYER_ORIGIN), baseUrl: PLAYER_BASE }), [videoId]);
  const fail = useCallback((code: StageErrorCode = 'load') => {
    if (!alive.current || failed.current) return;
    failed.current = true; ready.current = false; web.current = null;
    setFailure(true);
    latest.current(stageFailure(code));
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ready.current = false; };
  }, []);
  useEffect(() => { ready.current = false; if (!validVideoId(videoId)) fail(); }, [videoId, fail]);
  const send = useCallback((command: object) => {
    if (!alive.current || failed.current || !ready.current || !web.current) return;
    try { web.current.injectJavaScript(`window.cmd && window.cmd(${JSON.stringify(command)}); true;`); } catch { fail(); }
  }, [fail]);
  useImperativeHandle(ref, () => ({ play: () => send({ t: 'play' }), pause: () => send({ t: 'pause' }), setPlaybackRate: (rate: number) => { if (validPlaybackRate(rate)) { desiredRate.current = rate; send({ t: 'rate', v: rate }); } }, seek: (v: number) => { if (Number.isFinite(v)) send({ t: 'seek', v: Math.max(0, v) }); } }), [send]);
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    if (!alive.current || failed.current) return;
    const status = bridgeStatus(event?.nativeEvent?.data);
    if (!status) return;
    if (status.error) { fail(status.errorCode ?? 'load'); return; }
    if (status.ready) { ready.current = true; send({ t: 'rate', v: desiredRate.current }); }
    latest.current(status);
  }, [fail, send]);
  const onLoadError = useCallback((event: Parameters<typeof nativeLoadErrorCode>[0]) => fail(nativeLoadErrorCode(event)), [fail]);
  const onHttpError = useCallback(() => fail('http'), [fail]);
  const onProcessError = useCallback(() => fail('process'), [fail]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="review-video-stage" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {!failure && validVideoId(videoId) && <WebView ref={web} source={source} originWhitelist={['*']} onMessage={onMessage}
        javaScriptEnabled domStorageEnabled allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={false} allowsPictureInPictureMediaPlayback={false} allowsAirPlayForMediaPlayback={false} allowsLinkPreview={false} setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
        scrollEnabled={false} bounces={false} overScrollMode="never" automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
        mixedContentMode="never" textInteractionEnabled={false} dataDetectorTypes="none"
        onShouldStartLoadWithRequest={allowPlayerNavigation} onOpenWindow={blockWindow}
        onError={onLoadError} onHttpError={onHttpError} onContentProcessDidTerminate={onProcessError} onRenderProcessGone={onProcessError}
        style={{ flex: 1, backgroundColor: '#000' }} containerStyle={{ backgroundColor: '#000' }} />}
    </View>
  );
});
