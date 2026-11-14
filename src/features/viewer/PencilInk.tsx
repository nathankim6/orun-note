import React from 'react';
import { G, Path } from 'react-native-svg';
import { Point } from '@/data/types';
import { pencilLayers } from './ink';

/**
 * One pencil stroke (see pencilLayers): graphite specks stamped along the line (dark core specks, lighter edge specks)
 * over a faint continuous core. Same drawing on Android, iOS and web (react-native-svg, plain filled paths).
 */
export function PencilStroke({ points, width, color, opacity, scale, live = false, selected, selColor, transform }: {
  points: Point[]; width: number; color: string; opacity: number; scale: number; live?: boolean; selected?: boolean; selColor?: string; transform?: string;
}) {
  const L = pencilLayers(points, width, live);
  if (!L.core && !L.dark && !L.light) return null;
  return <G transform={transform}>
    {!!L.core && <Path d={L.core} scale={scale} fill={color} fillOpacity={opacity * 0.42} />}
    {!!L.light && <Path d={L.light} scale={scale} fill={color} fillOpacity={opacity * 0.45} />}
    {!!L.dark && <Path d={L.dark} scale={scale} fill={color} fillOpacity={opacity * 0.62} />}
    {selected && !!L.wash && <Path d={L.wash} scale={scale} fill="none" stroke={selColor} strokeWidth={1.2 / scale} strokeDasharray={`${3 / scale} ${2 / scale}`} />}
  </G>;
}
