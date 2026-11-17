// Viewer lab (QA only, synthetic data): mounts the REAL document surface, page renderer, ink canvas, toolbar and
// pen palette with the same wiring as the viewer screen, so a simulator / emulator run can prove what unit tests
// cannot: what the screen shows when a page is magnified, and what a stylus contact does while a tool panel is open.
// Driven from outside by deep links (orunnote://lab?cmd=…) or, on the iOS simulator, a command file in Documents.
// State goes to the log as `LAB_JSON {…}` and to Documents/lab-state.json. Never part of a store build.
import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import * as FileSystem from 'expo-file-system/legacy';
import { Linking, PixelRatio, Platform, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BlurTargetView } from 'expo-blur';
import { PdfRenderer } from '../../modules/pdf-renderer';
import { addStylusShortcutListener, takeStylusDiagnostics } from '../../modules/stylus-shortcut';
import { DocumentView, type DocHandle, type PageBox, type PageTile } from '../../src/features/viewer/DocumentView';
import { PdfPage, PdfSharp, type SharpMotion } from '../../src/features/viewer/PdfPage';
import { CompositingMatrix, type MatrixCell } from './matrix';
import { InkCanvas } from '../../src/features/viewer/InkCanvas';
import { Toolbar } from '../../src/features/viewer/Toolbar';
import { StylusDial } from '../../src/features/viewer/StylusDial';
import { DerivedPagesContext, registerUri, markZoomUnavailable, markPresent } from '../../src/features/viewer/derivedPages';
import { ZOOM_WIDTH, imageName, type DerivedInfo } from '../../src/features/viewer/derivedPagesCore';
import { onInkContact, cancelInkForStylusShortcut } from '../../src/features/viewer/stylusShortcutState';
import type { ToolConfig } from '../../src/features/viewer/ink';
import type { Stroke, TextBox } from '../../src/data/types';
import { LAB_PDF_BASE64, LAB_TARGET } from './pdf.generated';

type Mode = 'native' | 'derived' | 'derived-nozoom';
const TOP = 76; // room for the toolbar above the document surface
const logLines: string[] = [];
let state: Record<string, unknown> = { ready: false };
function publish(patch: Record<string, unknown>) {
  state = { ...state, ...patch, at: Date.now() };
  console.log('LAB_JSON ' + JSON.stringify(state));
  if (Platform.OS === 'ios' && FileSystem.documentDirectory) void FileSystem.writeAsStringAsync(FileSystem.documentDirectory + 'lab-state.json', JSON.stringify({ ...state, log: logLines.slice(-200) })).catch(() => {});
}
function note(line: string) { logLines.push(`${Date.now()} ${line}`); console.log('LAB_LOG ' + line); }

function Lab() {
  const insets = useSafeAreaInsets(); const win = useWindowDimensions();
  const W = win.width, H = win.height - insets.top - TOP - 22;
  const [doc, setDoc] = useState<{ uri: string; pages: { width: number; height: number }[]; derived: DerivedInfo | null; derivedNoZoom: DerivedInfo | null } | null>(null);
  const [mode, setMode] = useState<Mode>('derived');
  // layered = the production iOS surface (paper · viewport-space sharp layer · ink); off = the single-layer surface
  const [layered, setLayered] = useState(Platform.OS === 'ios'); const [matrix, setMatrix] = useState<{ src: string; px: { w: number; h: number } } | null>(null); const matrixCells = useRef<MatrixCell[]>([]);
  const [strokes, setStrokes] = useState<Record<number, Stroke[]>>({}); const [texts, setTexts] = useState<Record<number, TextBox[]>>({});
  const [cfg, setCfg] = useState<ToolConfig>({ tool: 'pen', color: '#172033', width: 1.4, shape: 'rectangle', opacity: 1 });
  const onCfg = useCallback((p: Partial<ToolConfig>) => setCfg((c) => ({ ...c, ...p })), []);
  const docRef = useRef<DocHandle>(null); const root = useRef<React.ElementRef<typeof View>>(null); const blurTarget = useRef<React.ElementRef<typeof View>>(null);
  // ---- the viewer's tool-summon wiring (app/viewer/[docId].tsx), unchanged ----
  const [dismissKey, setDismissKey] = useState(0); const panelOpen = useRef(false); const [panelShown, setPanelShown] = useState(false);
  const [dialAnchor, setDialAnchor] = useState<{ x: number; y: number } | null>(null);
  const size = useRef({ width: win.width, height: win.height }); size.current = { width: win.width, height: win.height };
  const openStylusDial = useCallback((point?: { x?: number; y?: number }) => {
    cancelInkForStylusShortcut(); setDismissKey((k) => k + 1);
    const place = (ox = 0, oy = 0) => setDialAnchor((old) => old ? null : { x: Number.isFinite(point?.x) ? point!.x! - ox : size.current.width * .68, y: Number.isFinite(point?.y) ? point!.y! - oy : size.current.height * .48 });
    if (point && root.current) root.current.measureInWindow((x, y) => place(x, y)); else place();
  }, []);
  useEffect(() => {
    const sub = addStylusShortcutListener((event) => { note('shortcut ' + event.kind); openStylusDial(event); });
    const off = onInkContact(() => { setDialAnchor(null); if (panelOpen.current) setDismissKey((k) => k + 1); });
    return () => { sub.remove(); off(); };
  }, [openStylusDial]);

  // ---- synthetic document + a derived set rendered on this device (same file layout as the server set) ----
  useEffect(() => { void (async () => {
    try {
      const src = `${FileSystem.cacheDirectory}lab.pdf`; await FileSystem.writeAsStringAsync(src, LAB_PDF_BASE64, { encoding: FileSystem.EncodingType.Base64 });
      const uri = (await PdfRenderer.importFile(src, `lab-${Date.now()}`)).uri; const info = await PdfRenderer.getInfo(uri);
      const pages = (info.pages ?? []).map((p: { width: number; height: number }) => ({ width: p.width, height: p.height }));
      const mk = async (name: string, withZoom: boolean) => {
        const dir = `${FileSystem.documentDirectory}derived/${name}/v1/`; await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        for (let i = 0; i < pages.length; i++) for (const w of withZoom && Platform.OS === 'ios' ? [1200, 2000, ZOOM_WIDTH] : [1200, 2000]) { // the zoom image is an iOS tier (Android renders at most a 2400 px page)
          const dest = dir + imageName(i, w); const made = await PdfRenderer.renderPage(uri, i, w);
          await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {}); await FileSystem.copyAsync({ from: made, to: dest }); markPresent(dest);
        }
        return { version: 1, pages: pages.length, widths: [1200, 2000], words: false, dir } as DerivedInfo;
      };
      const derived = await mk('lab', true), derivedNoZoom = await mk('lab-nozoom', false); markZoomUnavailable(derivedNoZoom.dir);
      // every vector-tile request is logged: the derived path must not start the device PDF engine below deep zoom
      const rr = PdfRenderer.renderRegion; (PdfRenderer as any).renderRegion = (...a: any[]) => { const t0 = Date.now(); note(`renderRegion page=${a[1]} pxW=${a[2]} ${a[5]}x${a[6]}`); return (rr as any)(...a).then((r: string) => { note(`renderRegion done ${Date.now() - t0}ms`); return r; }); };
      setDoc({ uri, pages, derived, derivedNoZoom });
    } catch (e: any) {
      // No PDF pipeline here (web preview, or a broken renderer): the ink / toolbar / palette checks still run on blank paper.
      note('prepare failed: ' + String(e?.message ?? e).slice(0, 200)); publish({ pdf: false });
      setDoc({ uri: 'blank:', pages: [{ width: LAB_TARGET.pageW, height: LAB_TARGET.pageH }, { width: LAB_TARGET.pageW, height: LAB_TARGET.pageH }], derived: null, derivedNoZoom: null });
    }
  })(); }, []);
  const derivedInfo = !doc || mode === 'native' ? null : mode === 'derived' ? doc.derived : doc.derivedNoZoom;
  useEffect(() => { if (doc) registerUri(doc.uri, derivedInfo); }, [doc, derivedInfo]);

  // ---- geometry of the resolution target on screen (device px), for the screenshot analysis ----
  const zoomRef = useRef(1); const [zoom, setZoom] = useState(1); const origin = useRef({ x: 0, y: 0 });
  const targetGeometry = useCallback((z: number) => {
    if (!doc) return null; const page = doc.pages[0]; const M = 14; const s = (W - 2 * M) / Math.max(...doc.pages.map((p) => p.width)); const bx = { x: (W - page.width * s) / 2, y: M };
    const g = LAB_TARGET.gratings; const cx = bx.x + (g[0].x + (g[g.length - 1].x + g[g.length - 1].w - g[0].x) / 2) * s, cy = bx.y + (g[0].y + g[0].h / 2) * s; const dpr = PixelRatio.get();
    return { focal: { x: cx, y: cy }, pageScale: s, rects: g.map((r) => ({ bar: r.bar, barPx: r.bar * s * z * dpr, x: (origin.current.x + cx + (bx.x + r.x * s - cx) * z) * dpr, y: (origin.current.y + cy + (bx.y + r.y * s - cy) * z) * dpr, w: r.w * s * z * dpr, h: r.h * s * z * dpr })) };
  }, [doc, W]);
  const report = useCallback((extra: Record<string, unknown> = {}) => {
    const count = Object.values(strokes).reduce((n, list) => n + list.length, 0);
    publish({ ready: !!doc, mode, layered, matrix: matrix ? matrixCells.current : null, zoom: zoomRef.current, strokes: count, panel: panelOpen.current, dial: !!dialAnchor, dpr: PixelRatio.get(), window: { w: win.width, h: win.height }, viewport: { ...origin.current, w: W, h: H }, target: targetGeometry(zoomRef.current), tool: cfg.tool, ...extra });
  }, [doc, mode, layered, matrix, strokes, dialAnchor, win.width, win.height, W, H, targetGeometry, cfg.tool]);
  useEffect(() => { report(); }, [report, panelShown]);

  // ---- commands ----
  const run = useCallback((c: Record<string, string>) => {
    note('cmd ' + JSON.stringify(c));
    if (c.cmd === 'mode' && (c.mode === 'native' || c.mode === 'derived' || c.mode === 'derived-nozoom')) { docRef.current?.zoomTo(1); zoomRef.current = 1; setZoom(1); setMode(c.mode); }
    else if (c.cmd === 'zoom') { const z = Math.max(1, Math.min(5, Number(c.z) || 1)); const t = targetGeometry(1); zoomRef.current = z; setZoom(z); docRef.current?.zoomTo(z, t?.focal.x, t?.focal.y); }
    else if (c.cmd === 'page') docRef.current?.goto(Number(c.page) || 0, false);
    else if (c.cmd === 'dial') openStylusDial(c.x ? { x: Number(c.x), y: Number(c.y) } : undefined);
    else if (c.cmd === 'tool') onCfg({ tool: c.tool as ToolConfig['tool'] });
    else if (c.cmd === 'clear') setStrokes({});
    else if (c.cmd === 'layers') { docRef.current?.zoomTo(1); zoomRef.current = 1; setZoom(1); setLayered(c.on === '1'); }
    else if (c.cmd === 'ink' && doc) { // a few thin synthetic strokes across the target, to judge ink sharpness when magnified
      const g = LAB_TARGET.gratings; const y0 = g[0].y + g[0].h + 10; const now = Date.now();
      const line = (i: number): Stroke => ({ id: 'lab' + i, tool: 'pen', color: '#B91C1C', width: 0.5 + i * 0.4, opacity: 1, createdAt: now, points: Array.from({ length: 40 }, (_, k) => ({ x: g[0].x + (k * (g[g.length - 1].x + g[g.length - 1].w - g[0].x)) / 39, y: y0 + i * 7 + Math.sin(k / 3) * 2 })) } as Stroke);
      setStrokes({ 0: [line(0), line(1), line(2)] });
    }
    else if (c.cmd === 'matrix' && doc && doc.uri !== 'blank:') { // one sharp bitmap of the gratings, shown through different layer structures
      if (c.on === '0') { setMatrix(null); return; }
      const g = LAB_TARGET.gratings; const P = Math.round(LAB_TARGET.pageW * 7.5); const k = P / LAB_TARGET.pageW; const pad = 4;
      const x = Math.floor((g[0].x - pad) * k), y = Math.floor((g[0].y - pad) * k), w = Math.ceil((g[g.length - 1].x + g[g.length - 1].w - g[0].x + 2 * pad) * k), h = Math.ceil((g[0].h + 2 * pad) * k);
      void PdfRenderer.renderRegion(doc.uri, 0, P, x, y, w, h).then((src) => setMatrix({ src, px: { w, h } })).catch((e) => note('matrix failed ' + String(e?.message ?? e)));
    }
    else if (c.cmd === 'diag') void takeStylusDiagnostics().then((d) => publish({ stylusDiagnostics: d }));
    setTimeout(() => report({ ack: c.id ?? c.cmd }), 60);
  }, [targetGeometry, openStylusDial, onCfg, report]);
  const runRef = useRef(run); runRef.current = run;
  useEffect(() => {
    const parse = (url?: string | null) => { if (!url || !/^orunnote:\/\/lab/.test(url)) return; const q: Record<string, string> = {}; (url.split('?')[1] ?? '').split('&').forEach((kv) => { const [k, v] = kv.split('='); if (k) q[decodeURIComponent(k)] = decodeURIComponent(v ?? ''); }); runRef.current(q); };
    const sub = Linking.addEventListener('url', (e) => parse(e.url)); void Linking.getInitialURL().then(parse).catch(() => {});
    // iOS simulator: a command file dropped into the app container (no system "open in app?" prompt involved)
    const file = FileSystem.documentDirectory + 'lab-cmd.json'; let busy = false;
    const timer = Platform.OS === 'ios' ? setInterval(async () => {
      if (busy) return; busy = true;
      try { const i = await FileSystem.getInfoAsync(file); if (i.exists) { const text = await FileSystem.readAsStringAsync(file); await FileSystem.deleteAsync(file, { idempotent: true }); runRef.current(JSON.parse(text)); } } catch { /* next tick */ } finally { busy = false; }
    }, 250) : null;
    return () => { sub.remove(); if (timer) clearInterval(timer); };
  }, []);

  const renderPaper = (pi: number, box: PageBox, tile?: PageTile) => <PdfPage uri={doc!.uri} index={pi} width={box.w} height={box.h} tile={tile} sharp="none" />;
  const renderSharp = (pi: number, box: PageBox, tile: PageTile | undefined, motion: SharpMotion) => <PdfSharp uri={doc!.uri} index={pi} tile={tile} box={box} motion={motion} />;
  const renderPage = (pi: number, box: PageBox, rs: number, tile?: PageTile) => {
    const s = box.s * rs, w = box.w * rs, h = box.h * rs;
    return <View key={pi} style={{ width: w, height: h, backgroundColor: layered ? 'transparent' : '#fff' }}>
      {!layered && <PdfPage uri={doc!.uri} index={pi} width={w} height={h} renderScale={1 / rs} tile={tile} />}
      <InkCanvas region={tile ? { nx: tile.nx, ny: tile.ny, nw: tile.nw, nh: tile.nh } : null} dense={rs > 1} density={rs} width={w} height={h} s={s} strokes={strokes[pi] ?? []} textBoxes={texts[pi] ?? []}
        cfg={cfg} enabled fingerDraw={false} onStrokes={(next: Stroke[]) => setStrokes((m) => ({ ...m, [pi]: next }))} onTextBoxes={(next: TextBox[]) => setTexts((m) => ({ ...m, [pi]: next }))} />
    </View>;
  };
  const count = Object.values(strokes).reduce((n, list) => n + list.length, 0);
  const label = `lab-ready-${doc ? 1 : 0} lab-mode-${mode} lab-layered-${layered ? 1 : 0} lab-strokes-${count} lab-panel-${panelShown ? 1 : 0} lab-dial-${dialAnchor ? 1 : 0} lab-tool-${cfg.tool}`;
  return <View ref={root} style={{ flex: 1, backgroundColor: '#fff' }} onLayout={() => { void SplashScreen.hideAsync().catch(() => {}); }} collapsable={false}>
    <BlurTargetView ref={blurTarget} style={{ flex: 1, paddingTop: insets.top }}>
      <View style={{ flex: 1, marginTop: TOP }} onStartShouldSetResponderCapture={() => { if (panelOpen.current) setDismissKey((k) => k + 1); if (dialAnchor) setDialAnchor(null); return false; }}
        onLayout={() => { origin.current = { x: 0, y: insets.top + TOP }; report(); }}>
        {doc ? <DerivedPagesContext.Provider value={derivedInfo}>
          <DocumentView key={mode + (layered ? '-L' : '-S')} ref={docRef} width={W} height={H} pages={doc.pages} mode="vertical" initialPage={0} renderPage={renderPage} renderPaper={layered ? renderPaper : undefined} renderSharp={layered ? renderSharp : undefined} onZoomSettled={(z) => { zoomRef.current = z; setZoom(z); }} />
        </DerivedPagesContext.Provider> : <Text style={{ padding: 24 }}>Preparing synthetic lab document…</Text>}
        {matrix ? <CompositingMatrix src={matrix.src} px={matrix.px} origin={origin.current} width={W} height={H} onCells={(cells) => { matrixCells.current = cells; report(); }} /> : null}
      </View>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top, left: 0, right: 0, zIndex: 40, elevation: 40 }}>
        <Toolbar onStylusDial={(point) => openStylusDial(point)} cfg={cfg} onCfg={onCfg} onCfgReplace={setCfg} onUndo={() => {}} onRedo={() => {}} canUndo={false} canRedo={false} onClear={() => setStrokes({})} onClearAll={() => setStrokes({})}
          onBack={() => {}} dismissKey={dismissKey} onPanelChange={(o) => { panelOpen.current = o; setPanelShown(o); }} onMore={() => {}} recentColors={[]} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 22, backgroundColor: '#fff', justifyContent: 'center', paddingHorizontal: 8 }}>
        <Text testID="lab-status" accessibilityLabel={label} style={{ fontSize: 10, color: '#64748B' }}>{label} z{zoom.toFixed(2)}</Text>
      </View>
    </BlurTargetView>
    {dialAnchor && <StylusDial blurTarget={blurTarget} anchor={dialAnchor} cfg={cfg} onCfg={onCfg} favorites={['#000000', '#FDE68A', '#BFDBFE', '#FCA5A5', '#BBF7D0']} onClose={() => setDialAnchor(null)} />}
  </View>;
}
function Root() { return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><Lab /></SafeAreaProvider></GestureHandlerRootView>; }
publish({ ready: false, boot: true });
registerRootComponent(Root);
