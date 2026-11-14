import React from 'react';
import { Image } from 'react-native';

/**
 * "ORUN NOTE" wordmark (assets/orun-title.png, transparent): generated logotype in an Orbitron-style geometric face with a
 * navy → royal blue gradient, light sheen and a small gold spark on the last E. 1950×237 px: crisp up to ~80 pt on 3× screens.
 */
export const ORUN_TITLE_RATIO = 1950 / 237;
const SOURCE = require('../../assets/orun-title.png');
export function OrunTitle({ height = 32 }: { height?: number }) {
  return <Image source={SOURCE} accessibilityLabel="ORUN NOTE" resizeMode="contain" style={{ width: height * ORUN_TITLE_RATIO, height }} />;
}
