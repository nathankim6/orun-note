import React from 'react';
import Svg, { Path, Rect, Circle, G, Defs, LinearGradient, Stop, Polygon, Ellipse } from 'react-native-svg';

/** Full-color toolbar icons (24×24 artboard). `ink` tints the pen/highlighter nib with the current color. */
export type ColorIconName = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'select' | 'shape' | 'text' | 'image' | 'magic' | 'hand' | 'undo' | 'redo' | 'subdoc' | 'more' | 'back';
export function ColorIcon({ name, size = 24, ink, disabled }: { name: ColorIconName; size?: number; ink?: string; disabled?: boolean }) {
  const o = disabled ? 0.35 : 1;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={o}>
      <Defs>
        <LinearGradient id="gPen" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#3B6FE8" /><Stop offset="1" stopColor="#1E3A8A" /></LinearGradient>
        <LinearGradient id="gHi" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FDE047" /><Stop offset="1" stopColor="#F59E0B" /></LinearGradient>
        <LinearGradient id="gSky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#7DD3FC" /><Stop offset="1" stopColor="#E0F2FE" /></LinearGradient>
        <LinearGradient id="gT" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FB923C" /><Stop offset="1" stopColor="#E11D48" /></LinearGradient>
        <LinearGradient id="gArrow" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#60A5FA" /><Stop offset="1" stopColor="#2563EB" /></LinearGradient>
      </Defs>
      {name === 'pen' && <G>
        <Path d="M16.6 3.2l4.2 4.2-11.3 11.3-4.9 1.1 1.1-4.9z" fill="url(#gPen)" />
        <Path d="M16.6 3.2l4.2 4.2-1.9 1.9-4.2-4.2z" fill="#93C5FD" />
        <Path d="M5.7 14.9l3.4 3.4-4.5 1z" fill="#FCD34D" />
        <Path d="M4.6 19.3l1-.2-.8-.8z" fill={ink ?? '#172033'} />
        <Path d="M3 21.4h9" stroke={ink ?? '#172033'} strokeWidth={1.8} strokeLinecap="round" />
      </G>}
      {name === 'highlighter' && <G>
        <Rect x="3" y="19" width="12" height="3" rx="1.2" fill={ink ?? '#FDE68A'} opacity={0.85} />
        <Path d="M14.2 2.8l6.9 6.9-7.3 7.3-6.9-6.9z" fill="url(#gHi)" />
        <Path d="M6.9 10.1l6.9 6.9-2.2 2.2-1.6-.5-4.6-4.6-.5-1.6z" fill="#A16207" />
        <Path d="M8 15.7l2.2 2.2-2.6 1.3-.9-.9z" fill={ink ?? '#FACC15'} />
        <Path d="M15.6 4.2l4.2 4.2" stroke="#FFF7CC" strokeWidth={1.2} strokeLinecap="round" />
      </G>}
      {name === 'eraser' && <G>
        <Path d="M13.5 3.6l6.9 6.9-7.6 7.6-6.9-6.9z" fill="#F472B6" />
        <Path d="M5.9 11.2l6.9 6.9-2.1 2.1H6.6L3.4 17a1.6 1.6 0 010-2.3z" fill="#60A5FA" />
        <Path d="M10.7 20.2H20" stroke="#94A3B8" strokeWidth={1.6} strokeLinecap="round" />
        <Path d="M14.6 5.1l4.7 4.7" stroke="#FBCFE8" strokeWidth={1.2} strokeLinecap="round" />
      </G>}
      {name === 'lasso' && <G>
        <Ellipse cx="12" cy="9.5" rx="8" ry="5.5" fill="rgba(139,92,246,0.12)" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="3 2.2" />
        <Path d="M8.5 14.3c-1.6 1.4-1.4 3.6.3 4.3 1.6.6 2.4 1.9 1.7 3" stroke="#7C3AED" strokeWidth={1.8} fill="none" strokeLinecap="round" />
        <Circle cx="8.6" cy="14.6" r="1.6" fill="#C4B5FD" stroke="#7C3AED" strokeWidth={1} />
      </G>}
      {name === 'select' && <G>
        <Path d="M5 3l13.5 8.2-5.9 1.4 3.4 6.4-2.6 1.4-3.4-6.4L5.6 18z" fill="url(#gArrow)" stroke="#1E40AF" strokeWidth={1.1} strokeLinejoin="round" />
        <Path d="M6.6 6l8.2 5" stroke="#BFDBFE" strokeWidth={1.1} strokeLinecap="round" />
        <Path d="M19.5 2.5v3M18 4h3" stroke="#F59E0B" strokeWidth={1.4} strokeLinecap="round" />
      </G>}
      {name === 'shape' && <G>
        <Rect x="11" y="11" width="10" height="10" rx="2" fill="#34D399" />
        <Circle cx="8.5" cy="8.5" r="5.5" fill="#F87171" opacity={0.92} />
        <Polygon points="17,2.5 21.5,10 12.5,10" fill="#60A5FA" opacity={0.95} />
      </G>}
      {name === 'text' && <G>
        <Rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#FFF1E6" />
        <Path d="M7 7h10v2.6h-1.4l-.4-1.2h-2.3v8.2l1.4.4V18h-4.6v-1.9l1.4-.4V8.4H8.8l-.4 1.2H7z" fill="url(#gT)" />
      </G>}
      {name === 'image' && <G>
        <Rect x="2.5" y="4" width="19" height="16" rx="3" fill="url(#gSky)" stroke="#0EA5E9" strokeWidth={1.2} />
        <Circle cx="16.5" cy="8.8" r="2.2" fill="#FBBF24" />
        <Path d="M3.2 17.5l5.3-6 3.8 4.2 2.4-2.6 6.1 5.4V18a1.9 1.9 0 01-1.9 1.9H5.1a1.9 1.9 0 01-1.9-1.9z" fill="#22C55E" />
        <Path d="M8.5 11.5l3.8 4.2-3 4.2H5.1a1.9 1.9 0 01-1.9-1.9v-.5z" fill="#15803D" opacity={0.6} />
      </G>}
      {name === 'magic' && <G>
        <Path d="M4 20L15.2 8.8" stroke="#334155" strokeWidth={2.6} strokeLinecap="round" />
        <Path d="M13.6 10.4l1.6-1.6" stroke="#F8FAFC" strokeWidth={2.6} strokeLinecap="round" />
        <Path d="M17.5 2.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" fill="#FBBF24" />
        <Path d="M20.5 10l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" fill="#F472B6" />
        <Path d="M10.5 3.5l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" fill="#60A5FA" />
      </G>}
      {name === 'hand' && <G>
        <Path d="M8 11V5.2a1.4 1.4 0 012.8 0V10V3.8a1.4 1.4 0 012.8 0V10V4.6a1.4 1.4 0 012.8 0V11V7.2a1.4 1.4 0 012.8 0v6.6c0 4.2-2.8 7.2-6.8 7.2-2.6 0-4.2-1-5.6-3l-2.6-3.8a1.5 1.5 0 012.3-1.9L8 13.6z" fill="#FDBA8C" stroke="#C2410C" strokeWidth={1} strokeLinejoin="round" />
      </G>}
      {name === 'undo' && <Path d="M9 5L4 10l5 5M4.5 10H14a6 6 0 010 12h-3" stroke="#2F6FED" strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(0,-2)" />}
      {name === 'redo' && <Path d="M15 5l5 5-5 5M19.5 10H10a6 6 0 000 12h3" stroke="#2F6FED" strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(0,-2)" />}
      {name === 'subdoc' && <G>
        <Rect x="7" y="2.5" width="14" height="15" rx="2.5" fill="#99F6E4" stroke="#0D9488" strokeWidth={1.2} />
        <Rect x="3" y="6.5" width="14" height="15" rx="2.5" fill="#fff" stroke="#2F6FED" strokeWidth={1.4} />
        <Path d="M6 11h8M6 14h8M6 17h5" stroke="#93C5FD" strokeWidth={1.4} strokeLinecap="round" />
      </G>}
      {name === 'more' && <G><Circle cx="5" cy="12" r="2.2" fill="#F43F5E" /><Circle cx="12" cy="12" r="2.2" fill="#F59E0B" /><Circle cx="19" cy="12" r="2.2" fill="#2F6FED" /></G>}
      {name === 'back' && <Path d="M15 4l-8 8 8 8" stroke="#172033" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    </Svg>
  );
}
