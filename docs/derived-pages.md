# Pre-rendered page images for server materials ("derived pages")

Why: teacher-uploaded textbooks are Chrome "save as PDF" files with thousands of shadings / patterns / transparency
groups per page. Every PDF engine is slow on them (iPad PDFKit 900 px: 2.7–9 s per page; Galaxy pdfium 2400 px: 3.8 s).
Rendering once on the server removes the work from every student device: a page becomes a JPEG decode (10–30 ms).

## Storage layout (bucket `materials`, private; served through signed URLs only)
```
derived/{materialId}/v1/manifest.json
derived/{materialId}/v1/p{index}-1200.jpg      reading tier  (width 1200 px, JPEG q82)
derived/{materialId}/v1/p{index}-2400.jpg      detail tier   (width 2400 px, JPEG q80)
derived/{materialId}/v1/p{index}-words.json    [{t,x,y,w,h}] normalised 0..1, top-left origin (same shape as PdfRenderer.getWords)
```
`index` is 0-based. manifest.json:
```json
{ "version": 1, "materialId": "…", "pages": 132, "widths": [1200, 2400], "words": true,
  "sizes": [[w,h], …] /* page points per page */, "bytes": 71234567, "generatedAt": "2026-11-14T03:00:00Z",
  "engine": "pdfium 7xxx (pypdfium2)" }
```

## DB
`materials.derived jsonb` — the manifest minus `sizes` (nullable; null = not generated yet).

## Edge function actions (`docs`)
- `materials.derivedUploadUrl` (admin) `{materialId, files: ["manifest.json", "p0-1200.jpg", …]}` → `{ ok, uploads: [{path, url, token}] }` (signed upload URLs; batch up to 300).
- `materials.derivedComplete` (admin) `{materialId, manifest}` → stores `materials.derived`.
- `materials.derivedUrls` (admin or entitled student) `{materialId, files: [...]}` → `{ ok, urls: [{path, url}] }` signed download URLs (600 s, batch up to 300). Students only for materials they are assigned.
- `list` / `download` responses now include `derived` on each material.

## Generator (GitHub Actions `derive-materials.yml`)
Hourly schedule + manual. Uses secret `ORUN_ADMIN_CODE` only (masked). For each ready material whose `derived.version` < 1:
download through `download` (signed URL masked in logs) → pypdfium2 renders each page once at 2400 px → JPEG 2400 + Pillow
downscale to 1200 → words from pdfium text page (char boxes merged into words, same normalisation as the app) → upload →
`materials.derivedComplete`. Parallel across pages (process pool). Nothing is written to the repo.

## Client
- After `downloadMaterial` (and on open for already-imported material docs) fetch `manifest.json` + all files into
  `${documentDirectory}derived/{materialId}/v1/` with concurrency 6, resumable, progress in the library card. Setting
  `derivedWifiOnly` (default false). Doc gets `derived: { dir, version, widths, pages, words }` when complete; partial
  state is tracked per file (existence check), so a half-downloaded book already uses what it has.
- `usePageImage`: if `derived/p{i}-1200.jpg` exists it is the reading image (shown at once, no native render) and
  `p{i}-2400.jpg` the detail image (shown when settled, as today). Zoom tiles above 2400 px still come from native
  `renderRegion` (slow path) – unchanged. Preview tier is skipped for derived pages.
- `words.ts`: `p{i}-words.json` preferred over `PdfRenderer.getWords`.
- Materials without `derived` (older uploads, personal PDFs) behave exactly as today.
