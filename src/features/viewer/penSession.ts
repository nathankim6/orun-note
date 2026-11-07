import { makeMutable } from 'react-native-reanimated';
/**
 * Palm rejection state shared by the ink layer (JS) and the document gestures (UI thread).
 * While the pen is hovering, writing, or was lifted < 600 ms ago, finger/palm contacts must not scroll, zoom or draw.
 */
export const penSession = makeMutable({ writing: false, at: 0, hoverAt: 0 });
export const PALM_WINDOW_MS = 600;
