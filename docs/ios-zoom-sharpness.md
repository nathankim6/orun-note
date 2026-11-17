# Zoom sharpness on iOS

## What was actually wrong (1.6.20 investigation)

Three things, each measured, none of them the tile geometry:

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

## What the app does now

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

Earlier rule kept: while magnified, the iOS page container drops `borderRadius` + `overflow` and its shadow
(`DocumentView.styles.pageZoomed`). Do not add a rounded-clipping ancestor or `shouldRasterize` between the
document viewport and the page content.

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
- **Viewer lab** (`.github/workflows/viewer-lab.yml`, `qa/lab`): the real DocumentView / PdfPage tree on an iOS
  simulator with a synthetic resolution target; screenshots at 220 % and 360 % are analysed for how many bar gratings
  stay resolved (`scripts/lab-analyze.mjs`). This proves compositing and decode behaviour on iOS, not the speed of a
  particular iPad.
- PDFKit timings above are from a Mac and from field reports; no physical iPad was measured for 1.6.20. The app now
  reports iOS memory warnings per viewing session (`crash_reports`, "ios memory warnings=…") so the field result of
  the cap can be checked.
