import React from 'react';
import { G, Path } from 'react-native-svg';
import { Point } from '@/data/types';
import { pencilLayers } from './ink';

/**
 * One pencil stroke (see pencilLayers): a soft grey body, graphite streaks along the movement that roughen the edges,
 * and a few darker flecks. Same drawing on Android, iOS and web (react-native-svg, plain paths).
 */
export function PencilStroke({ points, width, color, opacity, scale, live = false, selected, selColor, transform }: {
  points: Point[]; width: number; color: string; opacity: number; scale: number; live?: boolean; selected?: boolean; selColor?: string; transform?: string;
}) {
  const L = pencilLayers(points, width, live);
  if (!L.core && !L.streaks && !L.dark) return null;
  return <G transform={transform}>
    {!!L.core && <Path d={L.core} scale={scale} fill={color} fillOpacity={opacity * 0.4} />}
    {!!L.streaks && <Path d={L.streaks} scale={scale} fill="none" stroke={color} strokeWidth={L.streakW} strokeLinecap="round" strokeOpacity={opacity * 0.36} />}
    {!!L.light && <Path d={L.light} scale={scale} fill={color} fillOpacity={opacity * 0.42} />}
    {!!L.dark && <Path d={L.dark} scale={scale} fill={color} fillOpacity={opacity * 0.6} />}
    {selected && !!L.wash && <Path d={L.wash} scale={scale} fill="none" stroke={selColor} strokeWidth={1.2 / scale} strokeDasharray={`${3 / scale} ${2 / scale}`} />}
  </G>;
}
