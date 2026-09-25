---
paths:
  - "src/data/ornaments/**"
  - "src/lib/ornaments*.ts"
  - "src/components/OrnamentPicker.tsx"
  - "e2e/ornaments.spec.ts"
---

# Ornament & frame library (`src/data/ornaments/`, `src/lib/ornaments.ts`, `OrnamentPicker.tsx`)

Ten built-in shapes — arches, stars, a medallion, a scalloped roundel, an
ogee cartouche, a crescent, a boteh, a border frame — so Shape Fill is
usable by someone who has no SVG collection of their own, and so decorative
frames exist at all.

**One TS module per ornament**, in `src/data/ornaments/`, each default-
exporting an `OrnamentDef` (`id`/`name`/`nameAr`/`tags`/`viewBox`/`paths`).
Not raw `.svg` assets — same reasoning as the guide sections: no loader, the
data is typed and tree-shaken. `lib/ornaments.ts` globs the folder eagerly,
so **dropping a file in is the whole integration step**; there is no list to
edit. It skips modules that export no ornament, which is what lets the
shared `_geometry.ts` helpers live beside the data they build.

Three things about the geometry are load-bearing:

- **All of it is constructed from primitives** (`_geometry.ts`: arcs,
  polygons, stars, scalloped circles), never traced from a found image.
  That is a licensing property, not a style choice — keep it true of
  anything added.
- **No `A` (elliptical arc) commands.** `lib/svgPath.ts`'s `parseSvgPath`
  degrades an arc to a straight line to its endpoint, so a circle drawn with
  `A` would fill as a diamond. `arcCommands` emits cubic approximations
  instead.
- **A hole is cut with a doubled-back bridge, not a second subpath**
  (`ringPath`, used by `border-frame`). Shape Fill hit-tests by ray-casting
  over *one* flat point list from `pathToPolygon`, so two subpaths are
  joined by two different implicit segments that enclose a wedge the ray
  count then gets wrong. Two coincident bridge edges cancel instead, under
  both SVG fill rules and under the ray cast. `ornaments.test.ts` pins this
  by asserting the frame's middle is *outside* the polygon.

`OrnamentPicker.tsx` is the modal grid (portaled to `document.body`, the
`GuideDrawer`/`TemplateWizardDialog` precedent — the sidebar is
overflow-hidden and would clip it, and nothing non-artwork may live inside
the Konva stage or it risks being baked into an export). Thumbnails are
inline `<svg>`, so no rasterization. `OrnamentPickerButton` bundles launcher
and dialog into one element with local open state, the way `GuideLauncher`
does, so the two mount sites (the add-block row and the Shape Fill panel)
need no state and opening a picker never reaches `App.tsx`, the undo stack,
or a saved layout.

Neither action forks block creation. **Fill with text** builds the SVG
markup and runs it back through the app's own `extractSvgPaths` — with
`preserveAspect`, since these are drawn assets that must not be stretched to
a square — then hands the resulting `{ pathData, w, h }` to the same
`addShapeFillBlock` the upload flow uses. **Insert as frame** base64s the
markup into a data URL and goes through `addImageBlock`; a frame is a
decoration, not a text container, so it needs no new block type. Its fill
colour is therefore **baked in at insert time** and cannot be changed
afterwards (an editable vector frame would need a real vector-shape block
type — see Deferred features); the guide page says so, and the picker shows
the colour in its thumbnails before you commit.

`ornamentSvgMarkup` is deliberately ASCII-only — no `nameAr`, no comment —
because `btoa` throws above U+00FF.

The colour palette (`ORNAMENT_FILL_SWATCHES`, `DEFAULT_ORNAMENT_FILL`) lives in
`lib/ornaments.ts` beside `ornamentSvgDataUrl`, and the swatch strip itself is
`OrnamentFillSwatches`, exported from `OrnamentPicker.tsx`. Both surfaces that
bake a colour into an ornament use them — this picker and the name-design
wizard's frame step — because a second copy of either drifted the moment one
was edited. `lib/nameDesign.ts`'s `DEFAULT_FRAME_COLOR` reads the shared
default rather than restating the hex.

<!-- ---- STREAM-E: styles & palettes ---- -->
