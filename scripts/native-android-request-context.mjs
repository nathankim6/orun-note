import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const marker = '    // QA_REQUEST_HEADER_MAP_ONLY';
const anchor = 'public class RNCWebViewClient extends WebViewClient {';
// Observation only. Android supplies a header map, not wire-level proof. Never
// log raw URLs/headers, change requests, read responses, or relax player gates.
const probe = String.raw`
    // QA_REQUEST_HEADER_MAP_ONLY
    private final java.util.concurrent.atomic.AtomicInteger qaEmbedCount = new java.util.concurrent.atomic.AtomicInteger();
    private final java.util.concurrent.atomic.AtomicInteger qaPlayerCount = new java.util.concurrent.atomic.AtomicInteger();
    private static boolean qaAppOrigin(String value) {
        if (value == null) return false;
        android.net.Uri uri = android.net.Uri.parse(value);
        return "https".equals(uri.getScheme()) && "com.paperly.study".equals(uri.getHost())
            && uri.getUserInfo() == null && uri.getPort() == -1;
    }
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        try {
            android.net.Uri uri = request.getUrl();
            String host = uri.getHost(), route = uri.getPath();
            boolean provider = "https".equals(uri.getScheme()) && uri.getPort() == -1
                && uri.getUserInfo() == null && ("www.youtube.com".equals(host) || "www.youtube-nocookie.com".equals(host));
            boolean embed = provider && route != null && route.matches("/embed/[A-Za-z0-9_-]{11}");
            boolean player = provider && "/youtubei/v1/player".equals(route);
            if ((embed && qaEmbedCount.getAndIncrement() < 2) || (player && qaPlayerCount.getAndIncrement() < 2)) {
                String referer = null, origin = null;
                java.util.Map<String, String> headers = request.getRequestHeaders();
                if (headers != null) for (java.util.Map.Entry<String, String> entry : headers.entrySet()) {
                    if ("Referer".equalsIgnoreCase(entry.getKey())) referer = entry.getValue();
                    if ("Origin".equalsIgnoreCase(entry.getKey())) origin = entry.getValue();
                }
                org.json.JSONObject row = new org.json.JSONObject();
                row.put("event", "player_request_context");
                row.put("requestKind", embed ? "embed" : "player");
                row.put("mainFrame", request.isForMainFrame());
                row.put("refererPresent", referer != null && !referer.isEmpty());
                row.put("refererAppOriginMatches", qaAppOrigin(referer));
                row.put("originPresent", origin != null && !origin.isEmpty());
                row.put("originAppOriginMatches", qaAppOrigin(origin));
                android.util.Log.i("QARequestContext", "QA_JSON " + row.toString());
            }
        } catch (Exception ignored) { /* No raw data or exception messages. */ }
        return super.shouldInterceptRequest(view, request);
    }
`;
export function patchRequestContext(source) {
  if (source.includes(marker)) return source;
  if (source.split(anchor).length !== 2 || source.includes('shouldInterceptRequest(')) throw new Error('unsupported WebView source');
  return source.replace(anchor, anchor + probe);
}
export function applyRequestContext(root, env = process.env) {
  if (env.NATIVE_SMOKE_QA !== '1' || env.CI !== '1' || env.GITHUB_ACTIONS !== 'true') throw new Error('QA GitHub CI only');
  const target = path.join(root, 'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java');
  const source = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, patchRequestContext(source));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) applyRequestContext(process.cwd());
