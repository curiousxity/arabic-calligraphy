# Image-Trace Shape Warp — Design

Date: 2026-08-11
Status: Approved, ready for implementation planning

This is sub-project 1 of 3 in a larger "Fiddlesticks-inspired features"
initiative (the other two are a template/generator builder and cloud
persistence, each spec'd separately so every sub-project can be its own
branch/PR and merged independently). This sub-project has no dependency
on the other two.

## Summary

Add a second way to define a Shape Warp block's shape: upload a raster
image (photo, logo, scan) and auto-trace its silhouette into an SVG path,
instead of only uploading/drawing a vector SVG. The traced path feeds
into the *existing* `ShapeWarpText.tsx` envelope engine unchanged — this
is a new shape **input source**, not a new warp algorithm. The current
"Upload SVG" and hand-draw options are untouched and remain available
side by side.

## Non-goals

- No changes to `ShapeWarpText.tsx`'s remap math (envelope/topBottom/
  stretch/radial modes) or its glyph-handle system.
- No changes to `ShapeFillText.tsx` — this is Shape Warp only. (Adding the
  same trace entry point to Shape Fill later is a natural, cheap follow-up
  once this ships, but is out of scope here — YAGNI until asked for.)
- No removal of the existing SVG-upload/hand-draw shape inputs.
- No server-side processing — tracing runs entirely client-side in the
  browser, consistent with this app having no backend today.

## Algorithm

`imagetracerjs` (new npm dependency) — pure JS, no WASM, MIT-licensed,
purpose-built for bitmap→SVG path tracing with posterize/threshold
options. Chosen over hand-rolling marching-squares + polygon
simplification: that class of geometry code is easy to get subtly wrong
(holes, self-intersections, jagged output) and this project's existing
pattern is to lean on a mature library for exactly this kind of
heavy-lifting (`harfbuzzjs`, `opentype.js`) rather than reinvent it.

We only need a single-color silhouette outline (not `imagetracerjs`'s
full multi-color mode), so it's driven in single-threshold mode: pixels
above/below a luminance (or alpha, for transparent PNGs) threshold become
foreground/background, then traced to one path.

## New pieces

- **`src/lib/imageTrace.ts`** — wraps `imagetracerjs`. Exposes:
  - `traceImageToPath(source: HTMLImageElement | HTMLCanvasElement, threshold: number): { pathData: string; w: number; h: number } | null` —
    draws the source to an offscreen canvas at its natural size, applies
    the threshold, traces, returns `null` if no closed path results
    (blank/fully transparent image).
  - The canvas-prep and threshold-application logic (image → thresholded
    ImageData) is factored out as its own pure function so it's testable
    without mocking `imagetracerjs` itself, matching this project's
    existing pattern of unit-testing pure `lib/*.ts` logic
    (`normalizeGlyphs.ts`, `svgPath.ts`, `warp.ts`).
  - Return shape `{ pathData, w, h }` deliberately matches what
    `extractSvgPaths` (in `lib/svgImport.ts`) already returns, so
    `Sidebar.tsx` can treat both sources uniformly.

- **`src/components/ImageTraceDialog.tsx`** — new modal component:
  - Props: the uploaded image (as an `HTMLImageElement` or data URL),
    `onConfirm(pathData, w, h)`, `onCancel()`.
  - Shows the source image with the current traced outline overlaid, a
    threshold slider, Confirm/Cancel buttons.
  - Re-traces on slider change, debounced (~100ms) so dragging the slider
    stays responsive.
  - Self-contained/controlled — holds its own local threshold state, only
    calls back once, on Confirm. Not wired into `App.tsx`'s state at all.
  - If a trace attempt returns `null` (blank image, threshold at an
    extreme), shows an inline message ("No shape detected — try adjusting
    the threshold") and disables Confirm, rather than a silently-disabled
    button with no explanation.

- **`Sidebar.tsx` changes:**
  - New `handleImageTraceUpload()`, mirroring the existing
    `handleSvgUpload()`'s file-picker pattern (`accept="image/*"` instead
    of `.svg,image/svg+xml`), but instead of calling `onAddShapeWarpBlock`
    directly, it loads the file into an `<img>`, opens
    `<ImageTraceDialog>`, and only calls
    `onAddShapeWarpBlock(pathData, w, h)` — the same existing call the SVG
    path already uses — from the dialog's `onConfirm`.
  - New "Trace image" button next to the existing "Upload SVG" button in
    the Shape Warp section, both visible whenever `onAddShapeWarpBlock` is
    provided (same gating the SVG button already uses).

## Data flow

```
file input → FileReader → <img> element
  → ImageTraceDialog opens, source drawn to offscreen canvas
  → traceImageToPath(canvas, threshold) on mount and on each slider change (debounced)
  → user clicks Confirm
  → onAddShapeWarpBlock(pathData, w, h)   [existing App.tsx handler, unchanged]
  → ShapeWarpText.tsx renders exactly as it does for an SVG-sourced shape today
```

No `types.ts` schema changes — a traced shape produces the same
`shapeSvgPath`/`warpShapeWidth`/`warpShapeHeight` fields an SVG upload
does, so nothing downstream needs to know or care where the path came
from.

## Error handling

- Non-image or unreadable file: same `alert(...)` pattern
  `handleSvgUpload` already uses for unsupported SVGs.
- Trace produces no closed path: handled inline in the dialog (see
  above), not a top-level alert, since the user can fix it by adjusting
  the slider without re-uploading.

## Testing

- `src/lib/imageTrace.test.ts` — unit tests for the pure threshold/
  ImageData-prep function (given a small synthetic bitmap, does
  above/below-threshold classification produce the expected foreground
  mask), and a smoke test that `traceImageToPath` returns `null` for an
  all-transparent/blank input. The `imagetracerjs` call itself is not
  mocked out — call it for real against small fixture bitmaps, matching
  this project's preference (see `diacritics.test.ts`'s rationale) for
  testing against real behavior over hand-fabricated mocks wherever
  practical.
- `ImageTraceDialog.tsx` is not unit-tested — no existing precedent in
  this repo for testing Konva/canvas-heavy or modal UI components
  (consistent with `DiacriticHoverHandles.tsx`,
  `StrokeStretchHoverHandles.tsx`, etc.).

## Manual verification (implementation plan should include)

- Trace a real photo/logo and confirm the resulting Shape Warp block
  looks reasonable in all four warp modes (envelope/topBottom/stretch/
  radial) — no mode-specific regression expected since the engine is
  untouched, but worth a manual check since this is the first
  non-hand-authored path source these modes will ever receive.
- Confirm the existing "Upload SVG" and hand-draw flows still work
  unmodified.
