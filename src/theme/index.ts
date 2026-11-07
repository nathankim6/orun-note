import { useColorScheme, useWindowDimensions } from 'react-native';
import { useSettingsStore } from '@/store/settings';

export const palette = {
  teal: '#0E7C7B', tealDark: '#0A5E5D', tealLight: '#DDF1EF', tealSoft: '#EEF7F6',
  amber: '#E08E2B', amberLight: '#FDF1E0',
  red: '#D64545', redLight: '#FBE5E5',
  green: '#2E9E5B', greenLight: '#E3F5EA',
  blue: '#3B6FD6', blueLight: '#E4ECFB',
  purple: '#7C5CBF', yellow: '#F5C542',
};

export type ThemeColors = {
  bg: string; surface: string; surfaceAlt: string; text: string; textMuted: string; textFaint: string;
  border: string; primary: string; primaryText: string; primarySoft: string; accent: string;
  danger: string; dangerSoft: string; success: string; successSoft: string; info: string; infoSoft: string;
  overlay: string; paper: string; inkDefault: string;
};

// Light glass theme: airy sky/cream gradient background, translucent white surfaces, navy text, lighthouse-yellow accent (ORUN brand).
export const lightColors: ThemeColors = {
  bg: '#EEF3FA', surface: 'rgba(255,255,255,0.72)', surfaceAlt: 'rgba(255,255,255,0.55)', text: '#172033', textMuted: '#5B6578', textFaint: '#9AA4B5',
  border: 'rgba(255,255,255,0.75)', primary: '#2F6FED', primaryText: '#FFFFFF', primarySoft: 'rgba(47,111,237,0.12)', accent: '#F5C542',
  danger: palette.red, dangerSoft: palette.redLight, success: palette.green, successSoft: palette.greenLight, info: palette.blue, infoSoft: palette.blueLight,
  overlay: 'rgba(23,32,51,0.35)', paper: '#FFFFFF', inkDefault: '#172033',
};
export const glass = { bgGradient: ['#F3F7FF', '#EAF1FB', '#FDF6E3'] as const, blobA: 'rgba(47,111,237,0.18)', blobB: 'rgba(245,197,66,0.22)', blobC: 'rgba(120,200,255,0.20)', shadow: { shadowColor: '#1B3B7A', shadowOpacity: 0.10, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 6 } };
export const darkColors: ThemeColors = {
  bg: '#121315', surface: '#1C1D21', surfaceAlt: '#26282E', text: '#F2F2F4', textMuted: '#B3B6BD', textFaint: '#7C8089',
  border: '#2F3137', primary: '#2FA8A5', primaryText: '#071615', primarySoft: '#173634', accent: '#F0A64B',
  danger: '#E86B6B', dangerSoft: '#3A2222', success: '#4CBF7D', successSoft: '#1E3528', info: '#6C93E8', infoSoft: '#1F2A44',
  overlay: 'rgba(0,0,0,0.6)', paper: '#F3F1EA', inkDefault: '#1B1B1F',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };
export const type = {
  h1: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  bodyBold: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
};

export function useTheme() {
  // Light theme only (system/dark modes removed by request).
  return { colors: lightColors, dark: false, spacing, radius, type };
}

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const isWide = width >= 900;
  const columns = width >= 1200 ? 5 : width >= 900 ? 4 : width >= 600 ? 3 : 2;
  return { width, height, isTablet, isWide, columns, landscape: width > height };
}
