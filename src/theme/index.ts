import { Platform, useWindowDimensions } from 'react-native';

/** Apple system colors (iOS / iPadOS light appearance). */
export const ios = {
  blue: '#007AFF', bluePressed: '#0062CC', green: '#34C759', red: '#FF3B30', orange: '#FF9500', yellow: '#FFCC00',
  pink: '#FF2D55', purple: '#AF52DE', indigo: '#5856D6', teal: '#30B0C7', cyan: '#32ADE6', mint: '#00C7BE', brown: '#A2845E',
  gray: '#8E8E93', gray2: '#AEAEB2', gray3: '#C7C7CC', gray4: '#D1D1D6', gray5: '#E5E5EA', gray6: '#F2F2F7',
  label: '#1C1C1E', secondaryLabel: 'rgba(60,60,67,0.6)', tertiaryLabel: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.18)', opaqueSeparator: '#C6C6C8',
  fill: 'rgba(120,120,128,0.2)', secondaryFill: 'rgba(120,120,128,0.16)', tertiaryFill: 'rgba(118,118,128,0.12)',
  groupedBg: '#F2F2F7', cell: '#FFFFFF', cellPressed: '#D1D1D6',
};
/** Kept for older callers. */
export const palette = {
  teal: ios.teal, tealDark: '#1E8FA3', tealLight: 'rgba(48,176,199,0.15)', tealSoft: 'rgba(48,176,199,0.08)',
  amber: ios.orange, amberLight: 'rgba(255,149,0,0.14)', red: ios.red, redLight: 'rgba(255,59,48,0.12)',
  green: ios.green, greenLight: 'rgba(52,199,89,0.14)', blue: ios.blue, blueLight: 'rgba(0,122,255,0.12)', purple: ios.purple, yellow: ios.yellow,
};

export type ThemeColors = {
  bg: string; surface: string; surfaceAlt: string; text: string; textMuted: string; textFaint: string;
  border: string; primary: string; primaryText: string; primarySoft: string; accent: string;
  danger: string; dangerSoft: string; success: string; successSoft: string; info: string; infoSoft: string;
  overlay: string; paper: string; inkDefault: string;
  /** Apple semantic extras */
  separator: string; fill: string; fillTertiary: string; cellPressed: string; primaryPressed: string; star: string;
};

// Light appearance only. Key names are unchanged so every screen (incl. the viewer) keeps working.
export const lightColors: ThemeColors = {
  bg: ios.groupedBg, surface: '#FFFFFF', surfaceAlt: ios.gray6, text: ios.label, textMuted: '#6E6E73', textFaint: ios.gray2,
  border: ios.separator, primary: ios.blue, primaryText: '#FFFFFF', primarySoft: 'rgba(0,122,255,0.12)', accent: ios.orange,
  danger: ios.red, dangerSoft: 'rgba(255,59,48,0.12)', success: ios.green, successSoft: 'rgba(52,199,89,0.14)', info: ios.blue, infoSoft: 'rgba(0,122,255,0.10)',
  overlay: 'rgba(0,0,0,0.28)', paper: '#FFFFFF', inkDefault: ios.label,
  separator: ios.separator, fill: ios.tertiaryFill, fillTertiary: 'rgba(118,118,128,0.08)', cellPressed: ios.cellPressed, primaryPressed: ios.bluePressed, star: ios.yellow,
};
export const darkColors: ThemeColors = {
  bg: '#000000', surface: '#1C1C1E', surfaceAlt: '#2C2C2E', text: '#FFFFFF', textMuted: 'rgba(235,235,245,0.6)', textFaint: 'rgba(235,235,245,0.3)',
  border: 'rgba(84,84,88,0.6)', primary: '#0A84FF', primaryText: '#FFFFFF', primarySoft: 'rgba(10,132,255,0.2)', accent: '#FF9F0A',
  danger: '#FF453A', dangerSoft: 'rgba(255,69,58,0.2)', success: '#30D158', successSoft: 'rgba(48,209,88,0.2)', info: '#0A84FF', infoSoft: 'rgba(10,132,255,0.2)',
  overlay: 'rgba(0,0,0,0.5)', paper: '#F3F1EA', inkDefault: '#1B1B1F',
  separator: 'rgba(84,84,88,0.6)', fill: 'rgba(118,118,128,0.24)', fillTertiary: 'rgba(118,118,128,0.18)', cellPressed: '#3A3A3C', primaryPressed: '#0060DF', star: '#FFD60A',
};
/** Previous glass tokens, now flat Apple surfaces (kept so existing imports compile). */
export const glass = {
  bgGradient: [ios.groupedBg, ios.groupedBg, ios.groupedBg] as const, blobA: 'transparent', blobB: 'transparent', blobC: 'transparent',
  shadow: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 10, lg: 12, xl: 14, pill: 999 };
/** San Francisco on Apple platforms; the platform UI font elsewhere (Hangul falls back to Apple SD Gothic Neo / Malgun Gothic / Noto Sans KR). */
export const fontFamily = Platform.select({ web: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", "Malgun Gothic", Roboto, "Noto Sans KR", sans-serif', default: undefined });
const f = fontFamily ? { fontFamily } : {};
export const type = {
  largeTitle: { ...f, fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.2, lineHeight: 41 },
  h1: { ...f, fontSize: 28, fontWeight: '700' as const, letterSpacing: 0.2, lineHeight: 34 },
  h2: { ...f, fontSize: 22, fontWeight: '700' as const, letterSpacing: 0.1, lineHeight: 28 },
  h3: { ...f, fontSize: 17, fontWeight: '600' as const, lineHeight: 22 },
  title3: { ...f, fontSize: 20, fontWeight: '600' as const, lineHeight: 25 },
  body: { ...f, fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  bodyBold: { ...f, fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },
  callout: { ...f, fontSize: 16, fontWeight: '400' as const, lineHeight: 21 },
  subhead: { ...f, fontSize: 15, fontWeight: '400' as const, lineHeight: 20 },
  footnote: { ...f, fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  caption: { ...f, fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  caption2: { ...f, fontSize: 11, fontWeight: '400' as const, lineHeight: 13 },
  label: { ...f, fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
};

export function useTheme() {
  // Light appearance only (system/dark modes removed by request).
  return { colors: lightColors, dark: false, spacing, radius, type };
}

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const isWide = width >= 900;
  const columns = width >= 1200 ? 6 : width >= 900 ? 5 : width >= 600 ? 4 : 2;
  return { width, height, isTablet, isWide, columns, landscape: width > height };
}
