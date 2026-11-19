# Pre-rendered page images for server materials ("derived pages")

Why: teacher-uploaded textbooks are Chrome "save as PDF" files with thousands of shadings / patterns / transparency
groups per page. Every PDF engine is slow on them (iPad PDFKit 900 px: 2.7–9 s per page; Galaxy pdfium 2400 px: 3.8 s).
Rendering once on the server removes the work from every student device: a page becomes a JPEG decode (10–30 ms).

## Storage layout (bucket `materials`, private; served through signed URLs only)
```
derived/{materialId}/v1/manifest.json
derived/{materialId}/v1/p{index}-1200.jpg      reading tier  (width 1200 px, JPEG q80)
derived/{materialId}/v1/p{index}-2000.jpg      detail tier   (width 2000 px, JPEG q76; 2× an iPad page at 1× zoom)
derived/{materialId}/v1/p{index}-words.json    [{t,x,y,w,h}] normalised 0..1, top-left origin (same shape as PdfRenderer.getWords)
```
`index` is 0-based. manifest.json:
```json
{ "version": 1, "materialId": "…", "pages": 132, "widths": [1200, 2000], "words": true,
  "sizes": [[w,h], …] /* page points per page */, "bytes": 71234567, "generatedAt": "2026-11-14T03:00:00Z",
  "engine": "pdfium 7xxx (pypdfium2)" }
```

## DB
`materials.derived jsonb` — the manifest minus `sizes` (nullable; null = not generated yet).

## Edge function actions (`docs`)
- `materials.derivedUploadUrl` (admin) `{materialId, files: ["manifest.json", "p0-1200.jpg", …]}` → `{ ok, uploads: [{path, url, token}] }` (signed upload URLs; batch up to 300).
- `materials.derivedComplete` (admin) `{materialId, manifest}` → stores `materials.derived`.
- `materials.derivedUrls` (admin or entitled student) `{materialId, files: [...]}` → `{ ok, urls: [{path, url}] }` signed download URLs (900 s, batch up to 300). Students only for materials they are assigned.
  **It must be handled above the function's admin-only gate.** From the first release (1.6.17) until docs v25
  (2026-11-19) it sat below it: every student call returned 403, no student device ever downloaded a page image, and
  each textbook page was drawn by the device PDF engine (field reports on 1.6.20: 4.6 s on a Galaxy Tab, 7.4–7.5 s on
  iPads). Admin accounts were served, which is why it looked right in every admin test.
  `scripts/test-docs-function-access.js` runs the real handler as a student / admin / stranger.
- `list` / `download` responses now include `derived` on each material.

## Generator (GitHub Actions `derive-materials.yml`)
Hourly schedule + manual. Uses secret `ORUN_ADMIN_CODE` only (masked). For each ready material whose `derived.version` < 1:
download through `download` (signed URL masked in logs) → pypdfium2 renders each page once at 2000 px → JPEG 2000 + Pillow
downscale to 1200 → words from pdfium text page (char boxes merged into words, same normalisation as the app) → upload →
`materials.derivedComplete`. Parallel across pages (process pool). Nothing is written to the repo.

## Client
- After `downloadMaterial` (and on open for already-imported material docs) fetch `manifest.json` + all files into
  `${documentDirectory}derived/{materialId}/v1/` with concurrency 6, resumable, progress in the library card. Setting
  `derivedWifiOnly` (default false). Doc gets `derived: { dir, version, widths, pages, words }` when complete; partial
  state is tracked per file (existence check), so a half-downloaded book already uses what it has.
- `usePageImage`: if `derived/p{i}-1200.jpg` exists it is the reading image (shown at once, no native render) and
  `p{i}-2000.jpg` the detail image (shown when settled, as today). Zoom tiles above 2000 px still come from native
  `renderRegion` (slow path) – unchanged. Preview tier is skipped for derived pages.
- `words.ts`: `p{i}-words.json` preferred over `PdfRenderer.getWords`.
- Materials without `derived` (older uploads, personal PDFs) behave exactly as today.

## Zoom tier (1.6.20)

`derived/{materialId}/v1/p{index}-3600.jpg` — width 3600 px, JPEG q72 (~0.9 MB per page), rendered from the vector page
by the same generator. It exists because the device PDF engine cannot serve magnified textbook pages interactively
(docs/ios-zoom-sharpness.md).

- **Not in `manifest.widths`.** Apps up to 1.6.19 download every listed width for every page and use the largest as
  their detail image; a 3600 px entry there would triple their download and memory. The tier is addressed by
  convention instead. Its presence is announced by the token `z3600` appended to `manifest.engine`
  (`zoomMarked`); the generator adds only this tier to a material that already has the base set.
- The edge function's upload/download whitelists already accept `p{n}-3600.jpg`; nothing was redeployed.
- **Client (iOS):** fetched per page on demand through `materials.derivedUrls` when the magnified page needs more
  than the detail image (`zoomTierWanted`), and ahead of time for pages the reader settles on once they magnified
  anything in this session. A material without the tier is detected by the first probe returning no URL and is not
  asked again in that session. At most 56 zoom files are kept per material (oldest removed down to 40). The
  Wi-Fi-only setting applies. Android keeps its own vector tiles (bitmap size limits; pdfium has no cold cost cliff).
- Download queue: see "Download queue" below.

## Download queue (1.6.21)

`src/features/library/derivedDownload.ts`, rules in `derivedPagesCore.downloadRank`, tests in
`scripts/test-derived-download.js`.

- **Order** (re-evaluated for every file a connection takes, so a page turn takes effect at once):
  1. the page being read, completely (reading image, detail image, words), then its neighbours (±2);
  2. the reading image + words of **every** other page, nearest first, ahead before behind (≈ 130 KB per page:
     a 132-page book is openable everywhere after ≈ 17 MB);
  3. the detail images of those pages (≈ 0.7 MB per page), same order.
- **The page the reader just turned to** is fetched immediately, outside the six-connection pool (`prioritise` →
  `urgent`), so a jump to another chapter never waits behind transfers that are already running.
- Signed URLs are requested 120 names at a time, kept for 12 min (they live 15) and never reused after a failed
  transfer.
- A file gets three attempts per run. A run that still misses files, or cannot reach the server, ends in `error`
  and retries itself after 5 s / 15 s / 45 s / 2 min / 5 min; a fresh request (book opened, app started) restarts
  that schedule. 403 / 404 (not assigned any more / removed) are not retried.
  Once the schedule is used up, a page turn starts another attempt (at most once a minute). Twelve failed
  transfers in a row end a run early (storage down), and a failed signed-URL request is made once per run, not once
  per connection.
- The page images start **next to the PDF** (`preloadDerived` in `downloadMaterial`), not after it: what every page
  needs to open is a fraction of the PDF, so the book can be leafed through when the PDF arrives.
- A known set marks its directory as "being filled" before the first await; a page whose file is missing then
  waits for it (`useDerivedFile` → `pending`, at most 8 s) instead of starting a device render. A page that did fall
  back to the device engine stays there until its file is on disk (no spinner over a drawn page).
- Diagnostics (`crash_reports`, kind `render`, states and counts only): `derived pages download failed status=…
  files=done/total attempt=n` for every failed run, and `derived page drawn by device engine count=1|25 reason=…
  download=…` when a textbook page with a server set ends up on the device engine.
