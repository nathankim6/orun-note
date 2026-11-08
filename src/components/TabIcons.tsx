import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Circle } from 'react-native-svg';

/**
 * Main menu icons (내 교재 / 홈워크 / 설정 / 관리자), drawn in code like the toolbar's ColorIcons.
 * Selected: an iOS-style rounded square filled with the menu's colour gradient, white symbol, soft top sheen.
 * Not selected: the same square as a pale tint with the symbol in the menu colour.
 */
export type TabIconName = 'library' | 'homework' | 'settings' | 'admin';
const PAL: Record<TabIconName, { a: string; b: string; tint: string }> = {
  library: { a: '#5AC8FA', b: '#007AFF', tint: '#0A7AFF' },
  homework: { a: '#FFC145', b: '#FF6B00', tint: '#FF7A00' },
  settings: { a: '#B4BAC4', b: '#69707C', tint: '#6E7581' },
  admin: { a: '#9E9BFF', b: '#5856D6', tint: '#5E5CE6' },
};

function gearPath(cx: number, cy: number, R: number, r: number, teeth: number, hole: number) {
  const step = (Math.PI * 2) / teeth; const p = (ang: number, rad: number) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${p(a - step * 0.25, r)} L${p(a - step * 0.15, R)} L${p(a + step * 0.15, R)} L${p(a + step * 0.25, r)} A${r} ${r} 0 0 1 ${p(a + step * 0.75, r)}`;
  }
  return `${d} Z M${cx + hole} ${cy} A${hole} ${hole} 0 1 0 ${cx - hole} ${cy} A${hole} ${hole} 0 1 0 ${cx + hole} ${cy} Z`;
}
const GEAR = gearPath(16, 16, 9.6, 7.2, 8, 3.2);

export function TabIcon({ name, focused, size = 30 }: { name: TabIconName; focused: boolean; size?: number }) {
  const c = PAL[name]; const id = `tab-${name}`;
  const glyph = focused ? '#FFFFFF' : c.tint;           // symbol colour
  const cut = focused ? c.b : '#FFFFFF';                // details drawn "into" the symbol (check marks, holes)
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Defs>
        <LinearGradient id={`${id}-g`} x1="0" y1="0" x2="0.35" y2="1"><Stop offset="0" stopColor={c.a} /><Stop offset="1" stopColor={c.b} /></LinearGradient>
        <LinearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.32} /><Stop offset="0.55" stopColor="#FFFFFF" stopOpacity={0} /></LinearGradient>
      </Defs>
      <Rect x={1} y={1} width={30} height={30} rx={8.6} fill={focused ? `url(#${id}-g)` : c.tint} fillOpacity={focused ? 1 : 0.13} />
      {focused && <Rect x={1} y={1} width={30} height={30} rx={8.6} fill={`url(#${id}-s)`} />}
      {name === 'library' && <>
        <Path d="M6.6 10.4c3-1.5 6.2-1.4 8.6.4v12.9c-2.4-1.6-5.6-1.7-8.6-.4z" fill={glyph} />
        <Path d="M25.4 10.4c-3-1.5-6.2-1.4-8.6.4v12.9c2.4-1.6 5.6-1.7 8.6-.4z" fill={glyph} opacity={focused ? 0.92 : 0.85} />
        <Path d="M9 14.1c1.7-.5 3.3-.4 4.6.2M9 17.1c1.7-.5 3.3-.4 4.6.2" stroke={focused ? c.a : '#FFFFFF'} strokeWidth={1.1} strokeLinecap="round" fill="none" opacity={0.9} />
        <Path d="M20.5 9.2h2.8v6.2l-1.4-1.1-1.4 1.1z" fill={focused ? '#FFD60A' : '#FF9F0A'} />
      </>}
      {name === 'homework' && <>
        <Rect x={8.4} y={7.6} width={15.2} height={18.6} rx={3.3} fill={glyph} />
        <Rect x={12} y={5.4} width={8} height={4.6} rx={1.8} fill={glyph} stroke={focused ? c.b : '#FFFFFF'} strokeWidth={1.2} />
        <Path d="M12.3 17.6l2.8 2.8 5.3-5.8" stroke={cut} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </>}
      {name === 'settings' && <>
        <Path d={GEAR} fill={glyph} fillRule="evenodd" stroke={glyph} strokeWidth={0.9} strokeLinejoin="round" />
      </>}
      {name === 'admin' && <>
        <Path d="M16 5.4l8.2 3.2v6.4c0 5.3-3.5 9.1-8.2 10.9-4.7-1.8-8.2-5.6-8.2-10.9V8.6z" fill={glyph} />
        <Path d="M12.3 15.9l2.7 2.7 5-5.4" stroke={cut} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </>}
    </Svg>
  );
}
