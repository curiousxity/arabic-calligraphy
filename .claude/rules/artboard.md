---
paths:
  - "src/lib/artboard*.ts"
  - "src/lib/exportChrome.ts"
  - "e2e/artboard.spec.ts"
---

# The artboard (`src/lib/artboard.ts`, `CanvasStage.tsx`, `useExport.ts`)

A document can have a **page**: `artboard: ArtboardConfig | null` in `App.tsx`.
`null` is freeform and is byte-for-byte the behaviour that predates the
feature — it is also what every save written before it loads as, since
`applyParsedLayoutPayload` runs `isArtboardConfig` over the payload's
`artboard` field and falls back to `null` for anything malformed *or absent*
(it must run even when the key is missing, or loading an old project would
inherit the current page). The config is part of the document: it goes in the
save payload and in `EditorSnapshot`, so choosing a page size is undoable.

`src/lib/artboard.ts` is pure — plain rectangles and arithmetic, no React and
no Konva — and fully covered by `artboard.test.ts`.

- **Size is stored in px at the config's own `dpi`**, so A4@300dpi *is*
  2480 × 3508. Stage space is pixel space, so those are also the page's
  canvas dimensions, and that is the single fact the whole design turns on:
  rasterising the page 1:1 reproduces exactly `width × height`.
  `exportPixelRatio` therefore returns **1** whenever a page is set and the
  requested scale only when it is not. The export scale slider is inert with
  a page — deliberately, since the point of choosing A4@300 is that it
  exports at 2480 × 3508 whatever the slider says. The Artboard panel shows
  the resulting pixel size rather than the Export panel (which is stream C's
  file region this phase).
- `unit` is **display only**. `toDisplayUnit`/`fromDisplayUnit` never change
  what is stored; `withDpi` does, because changing dpi keeps the *physical*
  size and rescales the pixels — reinterpreting the same pixels as a smaller
  page is not what "make this print quality" means.
- Margins are clamped to 45% of the shorter side. Not merely cosmetic: a
  margin that met itself in the middle would contribute two coincident snap
  lines through the page centre.
- Preset ids are re-derived on resize (`withSize` → `matchArtboardPreset`),
  so typing 1080 × 1080 shows "Instagram square" rather than "Custom".

**CanvasStage.** `pageRect ?? contentBox` (named `paperBox`) is what the
background fill, the alignment grid and the `kind: "artboard"` snap
candidates come from. `contentBox` — the union of the padded content *and the
current viewport* — is retained for scroll extents and for the full-length
origin-snap lines, but it was a bad page: it made all three of those depend
on the zoom level. The margin rectangle becomes snap targets through a
**second** `buildSnapTargets([], marginRect, NO_GUIDES)` call rather than a
new target kind; `lib/snapping.ts` already models a page rectangle, so it
needs no fork. Blocks may overhang the page freely — nothing clips on canvas.

**Page chrome is id-prefixed `artboard-chrome-`** (the outline and the margin
guide), which is how a *specific* node is addressed — `e2e/artboard.spec.ts`
looks up `#artboard-chrome-outline`.

**Hiding it on export is a different channel: the Konva name `EXPORT_HIDDEN`**
(`src/lib/exportChrome.ts`). Every editor-only node carries it — the alignment
grid, the page outline and margin guide, the pen-tool and cell-paint overlays
— and `useExport`'s `withExportAdjustments` is one `stage.find(".export-hidden")`
that needs to know nothing about any of them. It replaced an allowlist of id
prefixes in that hook which each new overlay had to remember to join, from a
file its author had no other reason to open; three had accumulated, and the
price of forgetting is a gold lattice or a page outline baked silently into
every PNG. A React overlay declares the name on its **own** root Group rather
than being handed it, so the component that knows it is chrome is the one that
says so.

**Export.** `useExport(stageRef, blocks, artboard?)` takes an optional third
argument (`{ config, clipToPage }`, defaulting to freeform), so the two call
sites that predate this feature are unchanged and unchanged in behaviour.
`exportBox` returns the page instead of the blocks' bounding box, so export
dimensions stop being emergent — dragging a block no longer resizes the PNG.
"Clip to page" off unions the page with the content instead. The PDF's px→mm
now uses the config's dpi (`pxToMm(px, dpi)`) rather than a hardcoded 96,
which is what makes an A4 document print as A4 rather than as a 656 mm poster.

**Sidebar.** A new **Artboard** panel opens the `document` tier, above
Background & Grid, and the background-colour row *moved into it* — page
colour is a property of the page. That panel also owns the margin, the
units/dpi selects, the orientation toggle, the export-size readout and the
"Clip to page" checkbox.

Out of scope, deliberately: multiple artboards, bleed marks, dimming the
overhang on canvas, and clipping during editing.
