// 옳은Note desktop shell: serves the exported web app from a fixed localhost port (stable origin => saved notes persist),
// opens Google sign-in in the system browser (Google blocks embedded browsers), and blocks screen capture.
const { app, BrowserWindow, shell, session, Menu } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path');

const ROOT = path.join(__dirname, 'app'); const PORTS = [47831, 47832, 47833, 47834, 47835];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };
let win = null; let port = 0;
// ---- 홈워크 (orunhomework.com) app window, signed in as the linked student ----
const HW = 'https://orunhomework.com'; let hwWin = null;
function openHomework(url) {
  const m = /#orunnote-session=([^&]+)/.exec(url); let session = null;
  try { if (m) session = Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8'); JSON.parse(session || '{}'); } catch { session = null; }
  if (!hwWin || hwWin.isDestroyed()) {
    hwWin = new BrowserWindow({ width: 1200, height: 860, minWidth: 700, minHeight: 500, title: '홈워크 · 옳은Note', icon: path.join(__dirname, 'build', 'icon.ico'), autoHideMenuBar: true, show: false, backgroundColor: '#ffffff',
      webPreferences: { partition: 'persist:orunhomework', contextIsolation: true, nodeIntegration: false, sandbox: true } });
    hwWin.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'microphone', 'camera', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
    hwWin.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https:\/\//.test(u)) shell.openExternal(u); return { action: 'deny' }; });
    hwWin.once('ready-to-show', () => hwWin.show());
  }
  (async () => {
    if (session) { await hwWin.loadURL(HW + '/'); await hwWin.webContents.executeJavaScript(`try{localStorage.setItem('homework_auth_session', ${JSON.stringify(session)})}catch(e){}; true`); }
    await hwWin.loadURL(HW + '/'); hwWin.show(); hwWin.focus();
  })().catch(() => {});
}

const doneHtml = '<!doctype html><meta charset="utf-8"><title>옳은Note</title><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#eef3fa;color:#172033"><div style="text-align:center"><h2>로그인이 완료됐어요</h2><p>이 창을 닫고 옳은Note 앱으로 돌아가세요.</p></div></body>';

function serve(req, res) {
  const u = new URL(req.url, 'http://localhost'); const isElectron = /Electron/.test(req.headers['user-agent'] || '');
  // Sign-in finished in the system browser: hand the result to the app window (which holds the PKCE verifier).
  if (u.pathname === '/auth/callback' && !isElectron) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(doneHtml);
    if (win && (u.searchParams.get('code') || u.searchParams.get('error'))) { win.loadURL(`http://localhost:${port}/auth/callback${u.search}`); if (win.isMinimized()) win.restore(); win.focus(); }
    return;
  }
  let rel = decodeURIComponent(u.pathname); if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(ROOT, rel)); if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(ROOT, 'index.html'); // SPA fallback
    fs.readFile(file, (e2, buf) => { if (e2) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf); });
  });
}
function listen(i = 0) {
  return new Promise((resolve, reject) => {
    if (i >= PORTS.length) return reject(new Error('사용 가능한 포트가 없어요'));
    const srv = http.createServer(serve); srv.once('error', () => listen(i + 1).then(resolve, reject)); srv.listen(PORTS[i], '127.0.0.1', () => { port = PORTS[i]; resolve(srv); });
  });
}
function isAppUrl(u) { try { const x = new URL(u); return x.hostname === 'localhost' && Number(x.port) === port; } catch { return false; } }

async function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: '#EEF3FA', title: '옳은Note', icon: path.join(__dirname, 'build', 'icon.ico'), autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false, spellcheck: false } });
  Menu.setApplicationMenu(null);
  // Block screen capture / recording of the window (Windows: excluded from capture).
  win.setContentProtection(true);
  // Google rejects embedded browsers; also avoid shipping an "Electron" user agent to the web app's own requests.
  const ua = win.webContents.getUserAgent().replace(/\sElectron\/[\d.]+/, '').replace(/\s옳은Note\/[\d.]+/, ''); win.webContents.setUserAgent(ua + ' OrunNoteDesktop/' + app.getVersion());
  win.webContents.setVisualZoomLevelLimits(1, 1); // pinch/ctrl+wheel must not zoom the whole UI
  win.webContents.on('will-navigate', (e, url) => { if (isAppUrl(url)) return; e.preventDefault(); if (url.startsWith(HW)) openHomework(url); else if (/^https:\/\//.test(url)) shell.openExternal(url); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith(HW)) openHomework(url); else if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('context-menu', (e) => e.preventDefault()); // no "save image as" / copy page content
  win.webContents.on('before-input-event', (e, input) => { const k = input.key.toLowerCase(); if ((input.control || input.meta) && (k === 'p' || k === 's' || k === 'u') || input.key === 'F12' || (input.control && input.shift && (k === 'i' || k === 'j'))) e.preventDefault(); });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.once('ready-to-show', () => win.show());
  await win.loadURL(`http://localhost:${port}/`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => { try { await listen(); await createWindow(); } catch (e) { require('electron').dialog.showErrorBox('옳은Note', String(e.message || e)); app.quit(); } });
  app.on('window-all-closed', () => app.quit());
}
