# Zoom sharpness on iOS

## What was actually wrong (1.6.20 investigation)

Five things, each measured, none of them the tile geometry. The first three make a textbook page slow to become
sharp; the last two (found with the viewer lab on an iOS simulator) made a magnified page blurry **for good**, even
with a trivial PDF whose sharp tile is ready after 30 ms:

1. **PDFKit cannot interpret the textbooks interactively.** The materials are Chrome "save as PDF" files (producer
   `Skia/PDF`): every page is one page-sized transparency group whose content is painted through page-sized tiling
   patterns and soft masks. Measured with PDFKit on an Apple-silicon Mac on 흑석고1 분석워크북 / 어법팩 해설 / 흑석고 어휘:
   - the **first** draw of a page costs ~2.3–3.0 s **whatever the output size** (a 64×64 px window at 3× zoom costs
     the same as a full page), and adds **~385 MB** of memory that stays for as long as the `PDFPage` lives;
   - every later draw of the same `PDFPage` takes ~0.13 s at any zoom.
   Student iPads on 1.6.17 reported 6–15 s for that first draw (`crash_reports`, "PDF image load … requestedWidth=2400").
2. **The app kept up to 12 interpreted pages** (≈4.6 GB). iOS answers with memory warnings, the module then drops
   every cache, and the next page / zoom tile starts from a cold 6–15 s again. The page looked blurry for as long as
   that took, i.e. practically always while zoomed.
3. **The server's pre-rendered pages were not used reliably.** `RasterPdfPage` asked an in-memory index whether the
   JPEG was on disk; that index is empty after every app start, so a downloaded textbook still went to PDFKit until
   something re-rendered the page. And when the JPEG was used, only the 1200 px reading image was ever shown (the
   2000 px one was gated behind "no tile available", which is never true), so the magnified page was a 1200 px image
   stretched until a PDFKit tile arrived.

4. **iOS draws an image that sits under a scale-down from a reduced copy.** To stay crisp under the zoom transform
   the page content was laid out `rs`× larger (2× above ~120 %, 4× above ~250 %) and scaled back by `1/rs`
   ("density wrapper"). Android and the web composite that at the net scale. iOS does not: the compositing matrix of
   the lab shows ONE sharp bitmap, at exactly one bitmap pixel per screen pixel, through different layer structures
   (contrast kept by bar gratings 1.5 / 2.3 / 3.4 / 5.3 / 7.5 screen px wide; 1 = fully resolved):

   | structure | 1.5 | 2.3 | 3.4 | 5.3 | 7.5 |
   |---|---|---|---|---|---|
   | plain | 1 | 1 | 1 | 1 | 1 |
   | ½ wrapper inside ×2 (net 1:1) | 0.18 | 0.13 | 0.38 | 0.64 | 0.84 |
   | the same plus a rounded clip between | 0.18 | 0.13 | 0.38 | 0.64 | 0.84 |
   | ¼ wrapper inside ×4 (net 1:1) | 0.09 | 0.11 | 0.45 | 0.40 | 0.06 |
   | half-resolution image ×2 (reference) | 0.15 | 0.46 | 0.73 | 0.96 | 0.98 |
   | screen-space sharp frame (below) | 1 | 1 | 1 | 1 | 1 |

   So every extra density step cost resolution instead of adding it (worse than simply showing a half-resolution
   image), on RN images and on the native page bitmap alike, and the rounded clip / shadow that 1.6.18 removed while
   magnified makes no measurable difference. Only the observed behaviour is claimed here, not its mechanism inside
   Core Animation.
5. **The native page view never showed its bitmap on iOS.** `PdfPageView` was a clipping view with a `UIImageView`
   as a direct subview. React Native (`RCTViewComponentView.invalidateLayer`) masks such an image view with the image
   view's bounds at that moment, and at mount those bounds are still empty: the bitmap was set (the view reported
   "ready") but stayed invisible. At rest a zoom tile drawn above the page hid this; while scrolling, and wherever no
   tile was requested, the page was white. Present since the native page view was introduced (same React Native
   0.88.1 in 1.6.16–1.6.19).

## What the app does now

- **iOS draws the document in three layers** (`DocumentView` `renderPaper` / `renderSharp`, `SharpFrame.tsx`):
  the *paper* (page image at the page's own box size, inside the zoom transform, no density wrapper), the *sharp
  layer* (a window of the page at exactly one tile pixel per screen pixel, in a viewport-sized frame OUTSIDE the zoom
  transform; the frame is the identity while the document rests and follows pans / pinches until the next tile), and
  the *ink* layer above with the paper's transform. Android, the web and their sub-windows keep the single-layer
  surface, where the density wrapper works.
- The sharp layer of a textbook page is a window of the best server raster (`cropImage`, no PDF engine); of any
  other document a PDFKit tile, requested once the page needs more pixels than the native page bitmap has.
- `PdfPageView` does not clip itself and keeps its image view inside a plain container, so the page bitmap is
  visible as soon as it is drawn.

- **Textbook pages come from server rasters only** (`DerivedPage.tsx`): reading 1200 px → detail 2000 px → **zoom
  3600 px** (fetched per page on demand, docs/derived-pages.md). The file state is reactive and starts as *pending*
  until one disk stat returned, so a page never starts a PDFKit draw just because the index was still empty. On
  tablets the detail image is the page's first image (no soft-then-sharp page turn).
- **PDFKit is the last resort**: a vector tile is requested only when the magnified page needs more than the best
  server raster × 1.3 (≈ beyond 290 % on an 11" iPad), or when a material has no zoom tier / the device is offline.
- **Interpreted pages are capped at 2** (`maxParsedPages`).
- The page wrapper no longer changes element type at 120 % zoom (it used to remount the page: white flash, tile
  lost, undo history lost), and the sharper layers are requested 350 ms after the last movement on iOS (800 ms on
  Android, whose vector tiles are expensive for every request).
- Images above the reading tier are laid out at their own pixel size and scaled into the page box
  (`fullResImageStyle`), the same rule `tileImageStyle` uses, so the platform never decodes them to a smaller size.

Rules that follow from the measurements: on iOS never put page pixels that must be sharp under a scale-down ancestor
(no density wrapper around images), and never add a `UIImageView` as a direct subview of a React Native component
view that clips. `DocumentView.styles.pageZoomed` (no rounded clip / shadow while magnified) is kept but is not what
makes the page sharp.

## Numbers to remember (11" iPad, page box 806 pt = 1612 device px at 100 %)

| magnification | device px needed | shown from |
|---|---|---|
| 100–139 % | 1612–2240 | detail 2000 px |
| 140–250 % | 2257–4030 | zoom 3600 px |
| 251–290 % | –4680 | zoom 3600 px (≥ 77 % of native) |
| > 290 % | > 4680 | zoom 3600 px, then a PDFKit tile on top |

## Evidence boundary

- `scripts/test-zoom-tiers.js`, `test-ios-zoom-blur.js`, `test-derived-pages.js`: selection, ordering, download and
  wiring rules (pure JS).
- **Viewer lab** (`.github/workflows/viewer-lab.yml`, `qa/lab`, push a `lab/**` branch): the real DocumentView /
  PdfPage / ink tree on an iOS simulator with a synthetic resolution target. Screenshots at 100 / 150 / 220 / 360 %
  are analysed for the contrast bar gratings keep (`scripts/lab-analyze.mjs`), and the run fails unless the
  un-magnified page is visible and the magnified page is sharp at rest (acceptance checks at the end of that file).
  On the old single-layer surface a 3.3 px grating kept 0.21–0.35 of its contrast at 220 %; on the layered surface 1.
  A JS-only change can be re-checked in ~6 min by naming an earlier run in `qa/lab/reuse-app.txt`.
  This proves compositing and decode behaviour on an iOS **simulator**, not on a physical iPad, and not the speed of
  a particular iPad.
- PDFKit timings above are from a Mac and from field reports; no physical iPad was measured for 1.6.20. The app now
  reports iOS memory warnings per viewing session (`crash_reports`, "ios memory warnings=…") so the field result of
  the cap can be checked.
