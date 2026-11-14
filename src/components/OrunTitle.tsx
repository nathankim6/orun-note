import React from 'react';
import { Image } from 'react-native';

/**
 * "Orun Note" wordmark (assets/orun-title.png, transparent): a contemporary humanist sans in navy → royal blue with a gold
 * pen-stroke swash under "Note". 1563×335 px, so it stays crisp up to ~110 pt tall on 3× screens.
 */
export const ORUN_TITLE_RATIO = 1563 / 335;
const SOURCE = require('../../assets/orun-title.png');
export function OrunTitle({ height = 32 }: { height?: number }) {
  return <Image source={SOURCE} accessibilityLabel="Orun Note" resizeMode="contain" style={{ width: height * ORUN_TITLE_RATIO, height }} />;
}
