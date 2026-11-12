import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOpts } from './persist';

export type ViewerPrefs = {
  defaultLayoutMode: 'vertical' | 'horizontal' | 'continuous' | 'twoPage'; doubleTapZoomEnabled: boolean; keepAnswersOnReset: boolean; preserveInkOnRegionTap: boolean;
  showChoiceRegions: boolean; showCorrectAnswer: boolean; showIncorrectMark: boolean; showQuizRegions: boolean; showSolutionBlur: boolean; twoPageStartOdd: boolean; fingerDraw: boolean; eraserReturnToPen: boolean;
  penAutoReturn: boolean; strokeSmoothing: boolean; lineSnap: boolean; shapeSnap: boolean; paletteDock: 'top' | 'left' | 'right' | 'floating'; favoriteColors: string[];
  // Per-tool presets remembered across launches (color/width/opacity) and the last selected tool.
  toolPresets: Record<string, { color: string; width: number; opacity: number }>; lastTool: string;
  // Samsung Notes–style handwriting options
  favoritePens: { tool: string; color: string; width: number; opacity: number; fixed?: boolean }[];
  fixedWidth: boolean;            // 고정 굵기 (pen ignores pressure)
  straightHighlighter: boolean;   // 직선 형광펜
  eraseHighlighterOnly: boolean;  // 형광펜만 지우기
  lassoMode: 'free' | 'rect';     // 선택 모양: 자유형 / 사각형
  lassoPartial: boolean;          // 부분 선택된 개체 포함
  subDocSplit?: boolean;          // 서브교재를 화면 2분할로 보기
  subDocSplitRatio?: number;      // 2분할에서 서브교재가 차지하는 비율 (0.25–0.75)
  pagesPanelOpen?: boolean;       // 태블릿: 좌측 "페이지" 패널을 열어 둔 채로 시작 (기본 열림)
};
export const defaultViewerPrefs: ViewerPrefs = { defaultLayoutMode: 'vertical', doubleTapZoomEnabled: true, keepAnswersOnReset: true, preserveInkOnRegionTap: true, showChoiceRegions: true, showCorrectAnswer: false, showIncorrectMark: true, showQuizRegions: true, showSolutionBlur: true, twoPageStartOdd: true, fingerDraw: false, eraserReturnToPen: false, penAutoReturn: false, strokeSmoothing: true, lineSnap: true, shapeSnap: false, paletteDock: 'top', favoriteColors: ['#172033', '#DC2626', '#2F6FED', '#22C55E', '#F59E0B'], favoritePens: [{ tool: 'pen', color: '#172033', width: 2, opacity: 1 }, { tool: 'pen', color: '#DC2626', width: 2, opacity: 1 }, { tool: 'pen', color: '#2F6FED', width: 3, opacity: 1 }, { tool: 'highlighter', color: '#FDE68A', width: 14, opacity: 0.35 }], fixedWidth: true, straightHighlighter: true, eraseHighlighterOnly: false, lassoMode: 'free', lassoPartial: true, toolPresets: { pen: { color: '#172033', width: 1, opacity: 1 }, pencil: { color: '#1C1C1E', width: 1.2, opacity: 0.8 }, highlighter: { color: '#FDE68A', width: 6, opacity: 0.35 }, eraser: { color: '#000000', width: 3, opacity: 1 }, vectorEraser: { color: '#000000', width: 3, opacity: 1 }, shape: { color: '#172033', width: 2, opacity: 1 }, text: { color: '#172033', width: 16, opacity: 1 } }, lastTool: 'pen', pagesPanelOpen: true };

type SettingsState = {
  theme: 'system' | 'light' | 'dark'; language: 'system' | 'ko' | 'en' | 'zh-TW'; country: 'KR' | 'TW';
  notifications: { exam: boolean; study: boolean; promo: boolean; push: boolean };
  viewer: ViewerPrefs; tutorialDone: boolean; viewerGuideDone: boolean; offlineAudio: boolean;
  /** true once the persisted settings were read from disk (not persisted itself) */ hydrated: boolean;
  setTheme: (t: SettingsState['theme']) => void; setLanguage: (l: SettingsState['language']) => void; setCountry: (c: SettingsState['country']) => void;
  setNotification: (k: keyof SettingsState['notifications'], v: boolean) => void; setViewer: (p: Partial<ViewerPrefs>) => void; resetViewer: () => void;
  setTutorialDone: (v: boolean) => void; setViewerGuideDone: (v: boolean) => void; setOfflineAudio: (v: boolean) => void;
};
export const useSettingsStore = create<SettingsState>()(persist((set) => ({
  theme: 'light', language: 'system', country: 'KR', notifications: { exam: true, study: true, promo: false, push: true }, viewer: defaultViewerPrefs, tutorialDone: false, viewerGuideDone: false, offlineAudio: true, hydrated: false,
  setTheme: (theme) => set({ theme }), setLanguage: (language) => set({ language }), setCountry: (country) => set({ country }),
  setNotification: (k, v) => set((s) => ({ notifications: { ...s.notifications, [k]: v } })), setViewer: (p) => set((s) => ({ viewer: { ...s.viewer, ...p } })), resetViewer: () => set({ viewer: defaultViewerPrefs }),
  setTutorialDone: (tutorialDone) => set({ tutorialDone }), setViewerGuideDone: (viewerGuideDone) => set({ viewerGuideDone }), setOfflineAudio: (offlineAudio) => set({ offlineAudio }),
}), { ...persistOpts<SettingsState>('settings'), version: 12, partialize: (s) => { const { hydrated: _h, ...rest } = s as any; return rest; }, onRehydrateStorage: () => () => { useSettingsStore.setState({ hydrated: true }); }, migrate: (state: any, version) => { /* v9: 직선 형광펜 and the thinnest pen / highlighter become the defaults (applied once to existing installs) */ if (version < 9 && state?.viewer) { state.viewer.straightHighlighter = true; const tp = state.viewer.toolPresets ?? {}; state.viewer.toolPresets = { ...tp, pen: { ...(tp.pen ?? { color: '#172033', opacity: 1 }), width: 0.5 }, highlighter: { ...(tp.highlighter ?? { color: '#FDE68A', opacity: 0.35 }), width: 6 } }; } if (version < 8 && state?.viewer) { const d = defaultViewerPrefs; for (const k of ['favoritePens', 'fixedWidth', 'straightHighlighter', 'eraseHighlighterOnly', 'lassoMode', 'lassoPartial'] as const) if ((state.viewer as any)[k] === undefined) (state.viewer as any)[k] = (d as any)[k]; state.viewer.shapeSnap = false; } if (version < 7 && state?.theme === 'system') state.theme = 'light'; /* bright glass look by default */ if (state?.viewer && !state.viewer.toolPresets) { state.viewer.toolPresets = defaultViewerPrefs.toolPresets; state.viewer.lastTool = 'pen'; } if (state?.viewer) state.viewer.fingerDraw = false; if (state?.viewer && !Array.isArray(state.viewer.favoriteColors)) state.viewer.favoriteColors = ['#172033', '#DC2626', '#2F6FED', '#22C55E', '#F59E0B']; if (state?.viewer && ['fountain','brush'].includes(state.viewer.lastTool)) state.viewer.lastTool = 'pen'; if (version < 3 && state?.viewer) { state.viewer.eraserReturnToPen = false; state.viewer.lineSnap = true; } /* v10: every pen is fixed-width; reset the main pen to the minimum once. Preserve custom eraser sizes. */
if (version < 10 && state?.viewer) {
  const v = state.viewer; v.fixedWidth = true;
  const tp = { ...defaultViewerPrefs.toolPresets, ...v.toolPresets };
  tp.pen = { ...tp.pen, width: 0.5 };
  if (tp.eraser.width === 14) tp.eraser = { ...tp.eraser, width: 8 };
  if (tp.vectorEraser.width === 10) tp.vectorEraser = { ...tp.vectorEraser, width: 6 };
  v.toolPresets = tp;
  if (Array.isArray(v.favoritePens)) v.favoritePens = v.favoritePens.map((f: any) => f.tool === 'pen' ? { ...f, fixed: true } : f);
}
/* v11: modestly larger defaults on both platforms; do not rewrite custom presets or saved strokes. */
if (version < 11 && state?.viewer) {
  const tp = { ...defaultViewerPrefs.toolPresets, ...state.viewer.toolPresets };
  for (const [tool, oldWidth, newWidth] of [['pen', 0.5, 0.7], ['eraser', 8, 10], ['vectorEraser', 6, 8]] as const) {
    const preset = { ...defaultViewerPrefs.toolPresets[tool], ...tp[tool] };
    if (preset.width === oldWidth || !Number.isFinite(preset.width) || preset.width <= 0) preset.width = newWidth;
    tp[tool] = preset;
  }
  state.viewer.toolPresets = tp;
}
/* v12: slightly thicker pen, small (3) erasers, pencil preset, pages panel open by default. Applied once; a width the
 * user changed away from the previous default is kept. */
if (version < 12 && state?.viewer) {
  const tp = { ...defaultViewerPrefs.toolPresets, ...state.viewer.toolPresets };
  for (const [tool, oldWidth, newWidth] of [['pen', 0.7, 1], ['eraser', 10, 3], ['vectorEraser', 8, 3]] as const) {
    const preset = { ...defaultViewerPrefs.toolPresets[tool], ...tp[tool] };
    if (preset.width === oldWidth || !Number.isFinite(preset.width) || preset.width <= 0) preset.width = newWidth;
    tp[tool] = preset;
  }
  if (!tp.pencil || !Number.isFinite(tp.pencil.width)) tp.pencil = defaultViewerPrefs.toolPresets.pencil;
  state.viewer.toolPresets = tp;
  if (state.viewer.pagesPanelOpen === undefined) state.viewer.pagesPanelOpen = true;
}
return state; } }));
