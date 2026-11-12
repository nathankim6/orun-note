import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle, G } from 'react-native-svg';

export type ToolArtKind = 'pen' | 'pencil' | 'highlighter' | 'eraser' | 'lasso' | 'select';

/**
 * Apple Pencil-kit style tool illustrations (vector, crisp at any scale). The nib / band show the tool's current colour.
 * Drawn 28×72 with the body running off the bottom edge; the container clips it and raises the active tool.
 */
export function ToolArt({ kind, color = '#1C1C1E', size = 1 }: { kind: ToolArtKind; color?: string; size?: number }) {
  const w = 28 * size, h = 72 * size; const g = `ta-${kind}`;
  const body = (y: number, x = 5, bw = 18) => <Rect x={x} y={y} width={bw} height={80 - y} rx={1.5} fill={`url(#${g}-body)`} />;
  const cone = <Path d="M5 31 C7 22 11 12 14 6 C17 12 21 22 23 31 Z" fill={`url(#${g}-metal)`} />;
  return (
    <Svg width={w} height={h} viewBox="0 0 28 72">
      <Defs>
        <LinearGradient id={`${g}-body`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#D5D5DC" /><Stop offset="0.2" stopColor="#FFFFFF" /><Stop offset="0.65" stopColor="#F6F6F8" /><Stop offset="1" stopColor="#C9C9D1" />
        </LinearGradient>
        <LinearGradient id={`${g}-metal`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#BDBDC6" /><Stop offset="0.38" stopColor="#F5F5F7" /><Stop offset="1" stopColor="#A8A8B2" />
        </LinearGradient>
        <LinearGradient id={`${g}-wood`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#E7B86A" /><Stop offset="0.3" stopColor="#F7DCA6" /><Stop offset="0.7" stopColor="#F1C97C" /><Stop offset="1" stopColor="#C9933F" />
        </LinearGradient>
        <LinearGradient id={`${g}-pink`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#E98F98" /><Stop offset="0.35" stopColor="#FBC2C7" /><Stop offset="1" stopColor="#DE7F89" />
        </LinearGradient>
      </Defs>
      {kind === 'pen' && <G>
        {cone}
        <Path d="M11.6 13.5 C12.5 10.5 13.3 8 14 6 C14.7 8 15.5 10.5 16.4 13.5 Z" fill={color} />
        {body(31)}
        <Rect x={5} y={37} width={18} height={6} fill={color} />
      </G>}
      {kind === 'pencil' && <G>
        {/* graphite tip, wooden cone, hex body in classic pencil yellow with a band in the current colour */}
        <Path d="M12.2 13 C12.9 10 13.5 7.8 14 6 C14.5 7.8 15.1 10 15.8 13 Z" fill={color} />
        <Path d="M6 31 C8 23 11 15 12.2 13 L15.8 13 C17 15 20 23 22 31 Z" fill={`url(#${g}-wood)`} />
        <Rect x={5} y={31} width={18} height={49} fill="#F5C33B" />
        <Rect x={5} y={31} width={4} height={49} fill="#E0AB22" /><Rect x={19} y={31} width={4} height={49} fill="#D9A11C" />
        <Rect x={11} y={31} width={5} height={49} fill="#FFD95A" fillOpacity={0.9} />
        <Rect x={5} y={37} width={18} height={6} fill={color} />
      </G>}
      {kind === 'highlighter' && <G>
        <Path d="M8 24 L9.5 10 L18.5 7 L20 24 Z" fill={color} fillOpacity={0.92} />
        <Path d="M6 26 L8 22 L20 22 L22 26 Z" fill="#E6E6EB" />
        {body(26, 4, 20)}
        <Rect x={4} y={31} width={20} height={5} fill={color} fillOpacity={0.9} />
      </G>}
      {kind === 'eraser' && <G>
        <Path d="M5 30 L5 17 C5 10 9 7 14 7 C19 7 23 10 23 17 L23 30 Z" fill={`url(#${g}-pink)`} />
        <Rect x={5} y={28} width={18} height={4} fill="#E4E4EA" />
        {body(32)}
      </G>}
      {kind === 'lasso' && <G>
        {cone}
        <Path d="M8.2 26 L19.8 26 M9.6 21 L18.4 21 M11 16 L17 16 M12.4 11 L15.6 11" stroke="#3A3A3C" strokeWidth={1.4} strokeDasharray="2.2 1.6" />
        {body(31)}
      </G>}
      {kind === 'select' && <G>
        {cone}
        <Path d="M11.2 9.5 L11.2 24 L14.4 20.9 L16.5 25.6 L18.5 24.7 L16.4 20 L20.6 20 Z" fill={color} stroke="#FFFFFF" strokeWidth={0.9} strokeLinejoin="round" />
        {body(31)}
      </G>}
    </Svg>
  );
}

/** iOS-style colour wheel swatch. */
export function ColorWheel({ size = 22 }: { size?: number }) {
  const r = 10, n = 24; const slices = Array.from({ length: n }, (_, i) => {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const p = (a: number) => `${11 + r * Math.cos(a)} ${11 + r * Math.sin(a)}`;
    return <Path key={i} d={`M11 11 L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`} fill={`hsl(${(i / n) * 360}, 90%, 55%)`} />;
  });
  return <Svg width={size} height={size} viewBox="0 0 22 22">{slices}<Circle cx={11} cy={11} r={4.2} fill="#FFFFFF" fillOpacity={0.9} /></Svg>;
}
