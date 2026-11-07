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
};
export const defaultViewerPrefs: ViewerPrefs = { defaultLayoutMode: 'vertical', doubleTapZoomEnabled: true, keepAnswersOnReset: true, preserveInkOnRegionTap: true, showChoiceRegions: true, showCorrectAnswer: false, showIncorrectMark: true, showQuizRegions: true, showSolutionBlur: true, twoPageStartOdd: true, fingerDraw: false, eraserReturnToPen: false, penAutoReturn: false, strokeSmoothing: true, lineSnap: true, shapeSnap: false, paletteDock: 'top', favoriteColors: ['#172033', '#DC2626', '#2F6FED', '#22C55E', '#F59E0B'], favoritePens: [{ tool: 'pen', color: '#172033', width: 2, opacity: 1 }, { tool: 'pen', color: '#DC2626', width: 2, opacity: 1 }, { tool: 'pen', color: '#2F6FED', width: 3, opacity: 1 }, { tool: 'highlighter', color: '#FDE68A', width: 14, opacity: 0.35 }], fixedWidth: false, straightHighlighter: false, eraseHighlighterOnly: false, lassoMode: 'free', lassoPartial: true, toolPresets: { pen: { color: '#172033', width: 2, opacity: 1 }, highlighter: { color: '#FDE68A', width: 14, opacity: 0.35 }, eraser: { color: '#000000', width: 14, opacity: 1 }, vectorEraser: { color: '#000000', width: 10, opacity: 1 }, shape: { color: '#172033', width: 2, opacity: 1 }, text: { color: '#172033', width: 16, opacity: 1 } }, lastTool: 'pen' };

type SettingsState = {
  theme: 'system' | 'light' | 'dark'; language: 'system' | 'ko' | 'en' | 'zh-TW'; country: 'KR' | 'TW';
  notifications: { exam: boolean; study: boolean; promo: boolean; push: boolean };
  viewer: ViewerPrefs; tutorialDone: boolean; viewerGuideDone: boolean; offlineAudio: boolean;
  setTheme: (t: SettingsState['theme']) => void; setLanguage: (l: SettingsState['language']) => void; setCountry: (c: SettingsState['country']) => void;
  setNotification: (k: keyof SettingsState['notifications'], v: boolean) => void; setViewer: (p: Partial<ViewerPrefs>) => void; resetViewer: () => void;
  setTutorialDone: (v: boolean) => void; setViewerGuideDone: (v: boolean) => void; setOfflineAudio: (v: boolean) => void;
};
export const useSettingsStore = create<SettingsState>()(persist((set) => ({
  theme: 'light', language: 'system', country: 'KR', notifications: { exam: true, study: true, promo: false, push: true }, viewer: defaultViewerPrefs, tutorialDone: false, viewerGuideDone: false, offlineAudio: true,
  setTheme: (theme) => set({ theme }), setLanguage: (language) => set({ language }), setCountry: (country) => set({ country }),
  setNotification: (k, v) => set((s) => ({ notifications: { ...s.notifications, [k]: v } })), setViewer: (p) => set((s) => ({ viewer: { ...s.viewer, ...p } })), resetViewer: () => set({ viewer: defaultViewerPrefs }),
  setTutorialDone: (tutorialDone) => set({ tutorialDone }), setViewerGuideDone: (viewerGuideDone) => set({ viewerGuideDone }), setOfflineAudio: (offlineAudio) => set({ offlineAudio }),
}), { ...persistOpts<SettingsState>('settings'), version: 8, migrate: (state: any, version) => { if (version < 8 && state?.viewer) { const d = defaultViewerPrefs; for (const k of ['favoritePens', 'fixedWidth', 'straightHighlighter', 'eraseHighlighterOnly', 'lassoMode', 'lassoPartial'] as const) if ((state.viewer as any)[k] === undefined) (state.viewer as any)[k] = (d as any)[k]; state.viewer.shapeSnap = false; } if (version < 7 && state?.theme === 'system') state.theme = 'light'; /* bright glass look by default */ if (state?.viewer && !state.viewer.toolPresets) { state.viewer.toolPresets = defaultViewerPrefs.toolPresets; state.viewer.lastTool = 'pen'; } if (state?.viewer) state.viewer.fingerDraw = false; if (state?.viewer && !Array.isArray(state.viewer.favoriteColors)) state.viewer.favoriteColors = ['#172033', '#DC2626', '#2F6FED', '#22C55E', '#F59E0B']; if (state?.viewer && ['pencil','fountain','brush'].includes(state.viewer.lastTool)) state.viewer.lastTool = 'pen'; if (version < 3 && state?.viewer) { state.viewer.eraserReturnToPen = false; state.viewer.lineSnap = true; } return state; } }));
