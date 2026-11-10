import { createContext } from 'react';
/** False for moving/offscreen pages and standalone thumbnails; true only for settled, actually visible pages. */
export const PageQualityContext = createContext(false);
