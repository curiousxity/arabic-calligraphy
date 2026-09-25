---
paths:
  - "src/hooks/useExport.ts"
  - "src/lib/download.ts"
---

# Export (`src/hooks/useExport.ts`)

PNG/JPEG/PDF use `stage.toDataURL()`; SVG uses `react-konva-to-svg`. All four temporarily hide the on-screen alignment grid (`Konva.Group#grid-lines`) and, if "transparent background" is checked, the artboard background rect (`#artboard-background`) via `stage.findOne(...)`, so neither ever gets baked into exported output.


## Export options, clipboard copy, export-all, and presets

Every handler in `useExport.ts` now takes `boolean | { scale?, transparent?,
baseName? }`. The bare boolean is still accepted **on purpose**: it is what
`App.tsx`'s existing JSX call sites pass (`handleExportPNG(transparentExport)`),
and with no options supplied each handler is byte-identical to what it did
before — `scale` defaults to the old hardcoded `pixelRatio: 2`, `baseName` to
`calligraphy`, JPEG quality stays `0.92`, and the PDF keeps its 96dpi px→mm
conversion.

`handleCopyPNG(opts)` writes a PNG to the system clipboard and **returns a
`{ ok }` result rather than throwing**, matching how the rest of the hook
already reports "no stage"/"no blocks" by returning early; the sidebar shows
`reason` verbatim. Two non-obvious pieces:

- `navigator.clipboard?.write` and `ClipboardItem` are both absent in
  non-secure contexts and some browsers, so they are feature-detected up front
  and reported — a copy button that silently does nothing is worse than one
  that explains itself.
- The `ClipboardItem` is handed a **promise** of the blob, not an awaited blob.
  Safari only honours `clipboard.write` when the item is constructed
  synchronously inside the user-gesture task, and the render is async; the
  promise form is equally valid in Chrome and Firefox, so there is one path.
  Nothing in `handleCopyPNG` awaits before `clipboard.write`, which is what
  keeps that call inside the gesture — inserting an `await` above it breaks
  Safari and nothing else, so it will look fine in testing.
- The data URL is decoded to a `Blob` with `atob`, not `fetch(dataURL)`, since
  a `connect-src` CSP can block fetching `data:` URLs.

`handleExportAll(opts)` writes several formats from a **single**
`withExportAdjustments` pass instead of one pass per format, with both lazy
imports (`react-konva-to-svg`, `jspdf`) awaited *inside* that pass so the stage
is still in export state when they resolve. It honours an `opts.formats` list
(all four by default). Transparency is applied to PNG and SVG only; the
background node is briefly turned back on around the JPEG and PDF rasterizes,
because neither format has an alpha channel and a transparent request would
otherwise come out black. The downloads are sequenced with a short `await`
between them — browsers throttle downloads fired in one tick, and that is
cheaper than adding a zip dependency.

`src/lib/exportPresets.ts` holds `ExportPreset` (id/name/scale/transparent/
formats) plus `loadPresets`/`savePresets` (best-effort `localStorage` under
`harfcanvas-export-presets-v1`, same try/catch-and-fall-back-to-defaults
pattern as the named-project store) and the pure
`upsertPreset`/`removePreset` list functions, which is where the test coverage
is — jsdom can't rasterize, so the canvas-touching handlers aren't unit
testable. `loadPresets` filters out malformed entries and falls back to
`DEFAULT_PRESETS` when nothing usable survives. Presets are **local-only** and
deliberately not wired into the Supabase store, which is for named projects;
they are not part of a saved project either.

Preset state lives in `App.tsx` and is threaded to `Sidebar.tsx` like every
other piece of state. Selecting a preset loads its values into the scale /
transparency / format controls (so what it will do is visible before running),
while Run always exports from the preset's own stored values. Saving
overwrites by name, matching the named-project store.
