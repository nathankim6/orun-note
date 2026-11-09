import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';

const WebView: any = RNWebView;

export type StageStatus = { ready: boolean; playing: boolean; ended: boolean; buffering: boolean; time: number; duration: number; loaded: number; error: string | null };
export type StageHandle = { play(): void; pause(): void; seek(seconds: number): void };
export const EMPTY_STATUS: StageStatus = { ready: false, playing: false, ended: false, buffering: false, time: 0, duration: 0, loaded: 0, error: null };

// The embedded player needs a real https origin as its referrer (YouTube rejects embeds without one).
const ORIGIN = 'https://nathankim6.github.io';
const BASE = `${ORIGIN}/orun-note/`;
// Top-level navigations allowed inside the player page; everything else (youtube.com/watch, youtu.be, app links) is dropped.
const ALLOW_TOP = /^(about:blank|https:\/\/nathankim6\.github\.io\/orun-note\/)/;

export function playerHtml(videoId: string, origin: string) {
  const vars = JSON.stringify({ autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, cc_load_policy: 0, hl: 'ko', origin });
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#p,iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;pointer-events:none}</style></head>
<body><div id="p"></div>
<script>
var player=null,ready=false;
function post(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}}
function onYouTubeIframeAPIReady(){
  player=new YT.Player('p',{host:'https://www.youtube-nocookie.com',videoId:${JSON.stringify(videoId)},width:'100%',height:'100%',playerVars:${vars},
    events:{
      onReady:function(){ready=true;post({k:'ready',d:player.getDuration()});
        setInterval(function(){try{post({k:'time',t:player.getCurrentTime(),d:player.getDuration(),l:player.getVideoLoadedFraction()})}catch(e){}},250)},
      onStateChange:function(e){post({k:'state',s:e.data})},
      onAutoplayBlocked:function(){post({k:'state',s:2})},
      onError:function(e){post({k:'error',c:e.data})}}});
}
window.cmd=function(c){if(!player||!ready)return;
  if(c.t==='play')player.playVideo();else if(c.t==='pause')player.pauseVideo();else if(c.t==='seek')player.seekTo(c.v,true);};
document.addEventListener('contextmenu',function(e){e.preventDefault()});
setTimeout(function(){if(!ready)post({k:'error',c:'timeout'})},30000);
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body></html>`;
}

export function stageError(code: unknown) {
  if (code === 100) return '영상을 찾을 수 없어요. 선생님께 알려 주세요.';
  if (code === 101 || code === 150 || code === 152) return '이 영상은 앱 안에서 재생할 수 없도록 설정되어 있어요. 선생님께 알려 주세요.';
  if (code === 'timeout') return '영상을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
  return '영상을 재생하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

/**
 * Locked in-app YouTube player. The WebView never receives touches (pointerEvents none on its host), YouTube's own
 * controls are off, and every navigation that would leave the player page is blocked, so the video can only be
 * watched inside 옳은Note and its link is never shown.
 */
export const YouTubeStage = forwardRef<StageHandle, { videoId: string; onStatus: (s: Partial<StageStatus>) => void }>(function YouTubeStage({ videoId, onStatus }, ref) {
  const web = useRef<any>(null);
  const send = (c: object) => web.current?.injectJavaScript(`window.cmd && window.cmd(${JSON.stringify(c)}); true;`);
  useImperativeHandle(ref, () => ({ play: () => send({ t: 'play' }), pause: () => send({ t: 'pause' }), seek: (v: number) => send({ t: 'seek', v }) }), []);
  const html = useMemo(() => playerHtml(videoId, ORIGIN), [videoId]);
  const onMessage = (e: any) => {
    let m: any; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.k === 'ready') onStatus({ ready: true, duration: m.d || 0, error: null });
    else if (m.k === 'time') onStatus({ time: m.t || 0, duration: m.d || 0, loaded: m.l || 0 });
    else if (m.k === 'state') onStatus({ playing: m.s === 1, buffering: m.s === 3, ended: m.s === 0 });
    else if (m.k === 'error') onStatus({ error: stageError(m.c), playing: false });
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <WebView ref={web} source={{ html, baseUrl: BASE }} originWhitelist={['*']} onMessage={onMessage}
        javaScriptEnabled domStorageEnabled allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={false} allowsLinkPreview={false} setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
        scrollEnabled={false} bounces={false} overScrollMode="never" automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
        mixedContentMode="never" textInteractionEnabled={false} dataDetectorTypes="none"
        onShouldStartLoadWithRequest={(r: any) => r.isTopFrame === false || ALLOW_TOP.test(r.url)}
        onContentProcessDidTerminate={() => web.current?.reload()} onRenderProcessGone={() => onStatus({ error: stageError('gone'), playing: false })}
        style={{ flex: 1, backgroundColor: '#000' }} containerStyle={{ backgroundColor: '#000' }} />
    </View>
  );
});
