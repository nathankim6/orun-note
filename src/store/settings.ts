import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistOpts } from './persist';

export type ViewerPrefs = {
  defaultLayoutMode: 'vertical' | 'horizontal' | 'continuous' | 'twoPage'; doubleTapZoomEnabled: boolean; keepAnswersOnReset: boolean; preserveInkOnRegionTap: boolean;
  showChoiceRegions: boolean; showCorrectAnswer: boolean; showIncorrectMark: boolean; showQuizRegions: boolean; showSolutionBlur: boolean; twoPageStartOdd: boolean; fingerDraw: boolean; eraserReturnToPen: boolean;
  penAutoReturn: boolean; strokeSmoothing: boolean; lineSnap: boolean; shapeSnap: boolean; paletteDock: 'top' | 'left' | 'right' | 'floating';
};
export const defaultViewerPrefs: ViewerPrefs = { defaultLayoutMode: 'vertical', doubleTapZoomEnabled: true, keepAnswersOnReset: true, preserveInkOnRegionTap: true, showChoiceRegions: true, showCorrectAnswer: false, showIncorrectMark: true, showQuizRegions: true, showSolutionBlur: true, twoPageStartOdd: true, fingerDraw: true, eraserReturnToPen: true, penAutoReturn: false, strokeSmoothing: true, lineSnap: false, shapeSnap: true, paletteDock: 'top' };

type SettingsState = {
  theme: 'system' | 'light' | 'dark'; language: 'system' | 'ko' | 'en' | 'zh-TW'; country: 'KR' | 'TW';
  notifications: { exam: boolean; study: boolean; promo: boolean; push: boolean };
  viewer: ViewerPrefs; tutorialDone: boolean; viewerGuideDone: boolean; offlineAudio: boolean;
  setTheme: (t: SettingsState['theme']) => void; setLanguage: (l: SettingsState['language']) => void; setCountry: (c: SettingsState['country']) => void;
  setNotification: (k: keyof SettingsState['notifications'], v: boolean) => void; setViewer: (p: Partial<ViewerPrefs>) => void; resetViewer: () => void;
  setTutorialDone: (v: boolean) => void; setViewerGuideDone: (v: boolean) => void; setOfflineAudio: (v: boolean) => void;
};
export const useSettingsStore = create<SettingsState>()(persist((set) => ({
  theme: 'system', language: 'system', country: 'KR', notifications: { exam: true, study: true, promo: false, push: true }, viewer: defaultViewerPrefs, tutorialDone: false, viewerGuideDone: false, offlineAudio: true,
  setTheme: (theme) => set({ theme }), setLanguage: (language) => set({ language }), setCountry: (country) => set({ country }),
  setNotification: (k, v) => set((s) => ({ notifications: { ...s.notifications, [k]: v } })), setViewer: (p) => set((s) => ({ viewer: { ...s.viewer, ...p } })), resetViewer: () => set({ viewer: defaultViewerPrefs }),
  setTutorialDone: (tutorialDone) => set({ tutorialDone }), setViewerGuideDone: (viewerGuideDone) => set({ viewerGuideDone }), setOfflineAudio: (offlineAudio) => set({ offlineAudio }),
}), persistOpts('settings')));
