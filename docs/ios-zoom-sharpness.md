# Zoom sharpness on iOS (page compositing)

The viewer magnifies a document with ONE transform on the page container (`DocumentView`), and sharpens it with a
viewport tile rendered by the native renderer (`PdfPage.TileLayer` → `PdfRenderer.renderRegion`). Both platforms share
that code. iOS still looked soft at any zoom while Android looked sharp; the difference is in how each platform
composites the magnified page, not in the tile geometry.

## What iOS does differently

A layer with BOTH `cornerRadius` and `masksToBounds` (RN: `borderRadius` + `overflow: 'hidden'`) clips its sublayers
through an implicit mask. Core Animation therefore renders that subtree into an offscreen buffer sized by the layer's
own bounds × `contentsScale` — one page pixel per device pixel — and composites the *buffer* with whatever ancestor
transform applies. The zoom transform then magnifies that 1x page raster, so every layer inside the page (native page
bitmap, the sharp zoom tile, the ink SVGs) is resampled from a 1x page raster and stays visibly soft, however sharp
the tile inside it is. Rectangular clips (`overflow: 'hidden'` without a radius) and transforms alone do not do this,
which is why panning and ordinary scroll views stay crisp.

Android clips while replaying the display list and never materializes such a buffer, so the identical page tree and
tile land at full device resolution there.

## Rules

- While the document is magnified (`z > 1.001`) the page container drops `borderRadius`/`overflow` and the iOS shadow
  (`DocumentView.styles.pageZoomed`, iOS only). The rounded card and its shadow stay exactly as before at 1x, where the
  corners are on screen and no magnification happens.
- Do not introduce a new rounded-clipping ancestor (or `shouldRasterize`) between the document viewport and the page
  content. A rounded corner inside an untransformed subtree (e.g. the 간편 입력창 pad, which magnifies by *laying out*
  larger instead of transforming) is unaffected.
- The sharp tile must not depend on the base page bitmap. It mounts on its own and a failed region is retried
  (`useTileFailure`, 3 attempts, 1.2 s apart) before the page falls back — and the image path's fallback is the detail
  raster, never the ≤1200 px reading raster.

## Evidence boundary

`scripts/test-ios-zoom-blur.js` pins the container rule (iOS + magnified only, clip and shadow removed, 1x unchanged),
the tile retry wiring, and that a retried tile re-requests the identical region and can then be shown. It cannot
measure device pixels: the visual result needs a look on an iPhone/iPad at 2–5x zoom (PDF text should stay crisp with
no settle delay), because no simulator assertion here proves offscreen compositing behaviour.
