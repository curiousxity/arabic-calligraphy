---
paths:
  - "docs/archive/**"
  - "scripts/*.py"
  - "src/lib/dragAxis*.ts"
  - "src/lib/diacriticPlacement*.ts"
  - "src/lib/legacySaves*.ts"
---

# Removed subsystems

Six removals so far (the four of 2026-10-14 are the font-first redesign,
spec `docs/superpowers/specs/2026-10-14-font-first-redesign.md`), plus the
older `shapeWarp` block type described in CLAUDE.md. Every one of them is
handled in old saves by the one sanitizer in **`src/lib/legacySaves.ts`**:
`REMOVED_BLOCK_TYPES` lists block types that are dropped on load, and
`REMOVED_BLOCK_FIELDS` lists per-block fields that are deleted.
`sanitizeLegacyBlocks` applies both and is called from
`applyParsedLayoutPayload` in `App.tsx`; `legacySaves.test.ts` pins it with a
fixture save. A further removal adds its type or fields to those two lists
rather than writing a second stripper.

## The font-first redesign: four removals on 2026-10-14

**Why — in the user's words:** *"It has become too bulky and some features
are redundant. I want the app to be clean, and showcase the thing it excels
at; the fonts."* The cut list was the user's own: *"cut Square Kufi,
Horizontal and vertical warp and image blocks"*. The ornament and frame
library followed from the third, because a frame is an image block, and an
image type nobody can add themselves is plumbing. Deleted, not hidden behind
an "advanced" toggle, which would have kept the code and the bloat.

**Recovery:** every file below is recoverable from the local git tag
**`pre-font-first-redesign`** (commit `2d3aeb1`), the last commit before the
first deletion, including the deleted `.claude/rules/square-kufi.md` and
`.claude/rules/ornaments.md` write-ups. Read those before resurrecting
anything piecemeal.

### Square Kufi

**What went:** the `SquareKufiBlock` type and its `kufi*` fields,
`SquareKufiText.tsx`, `KufiCellEditOverlay.tsx`, `lib/squareKufi.ts` and its
1,091-line test, `lib/squareKufiAlphabet.ts`, the Square Kufi sidebar panel
and Add button, `kufiOptionsFor`, the kufi guards in `blockCapabilities.ts`,
the kufi mapping in `blockRenderProps.ts`, `MirrorBlockView`'s kufi path,
`e2e/square-kufi.spec.ts`, the guide section `square-kufi.tsx`, the demo GIF,
the deferred-features lines, and `.claude/rules/square-kufi.md`.

**Old saves:** `squareKufi` is in `REMOVED_BLOCK_TYPES`; `kufiColumns`,
`kufiComposition`, `kufiLineGap`, `kufiWordGap`, `kufiCellEdits` and
`kufiCellEditMode` are in `REMOVED_BLOCK_FIELDS`.

### Horizontal and vertical warp

**What went:** `lib/warp.ts` and its test, `warpX`/`warpY` on `BlockCommon`,
the two Typography sliders, `ShapedText`'s per-glyph warp pass, the
`blockRenderProps` mapping, the warp term in `DiacriticHoverHandles` and in
the fit-to-width solver (`fitToWidth.ts` lost its `warpX` input), and
`composition.ts`'s copy of the warp fields. The detached-marks order
"marks, then cuts, then warp" became "marks, then cuts".

**Old saves:** `warpX` and `warpY` are in `REMOVED_BLOCK_FIELDS`, so a
warped block loads back unwarped.

### Image blocks

**What went:** the `ImageBlock` type with `imageDataUrl`/`imageScale`,
`ImageBlockView.tsx`, `addImageBlock`, the Add image button and its file
input, the Image panel, `MirrorBlockView`'s mirror-of-image path, the image
mapping in `blockRenderProps.ts`, `randomizeLayout`'s image exemption, the
Layers panel's image row, and the demo GIF.

**Old saves:** `image` is in `REMOVED_BLOCK_TYPES`; `imageDataUrl` and
`imageScale` are in `REMOVED_BLOCK_FIELDS`.

### The ornament and frame library

**What went:** `OrnamentPicker.tsx`, `lib/ornaments.ts` and its test, the
whole of `src/data/ornaments/`, the Add ornament button,
`insertOrnamentShapeFill`/`insertOrnamentFrame`, the `ornamental` flag on
`BlockCommon`, Compositions' `framed` layout and `CompositionDialog`'s frame
swatches (muthanna and medallion stay), `FontUploadDialog`'s ornament
reference, `e2e/ornaments.spec.ts`, the guide section `ornaments.tsx`, the
demo GIF, and `.claude/rules/ornaments.md`. The e2e helper
`addOrnamentShapeFill` became `addShapeFillFromSvg`, which uploads
`e2e/fixtures/circle.svg`.

**Old saves:** `ornamental` is in `REMOVED_BLOCK_FIELDS`. An ornament poured
as a Shape Fill was an ordinary `shapeFill` block and loads unchanged; a
frame was an `image` block and is dropped with the image type.

**What survived the redesign, and why:** mirror blocks, including
"Add mirror" and the medallion composition. The "Add medallion" button left
the Add grid (it duplicated Compositions' medallion), so a medallion is now
made only from Compositions.

## Per-glyph move, scale & rotate

Removed on **2026-10-10**. Everything is recoverable from the local git tag
**`glyph-transform-final`** (commit `74ac92f`), including the full write-up
that used to be `.claude/rules/glyph-transform.md`.

**What went:** `lib/glyphTransform.ts` and its tests,
`GlyphTransformHoverHandles.tsx`, `e2e/glyph-transform.spec.ts`, the
`GlyphTransform` type with `glyphTransforms`/`glyphTransformMode` on
`BlockCommon`, `supportsGlyphTransforms`, the Typography checkbox and its
reset button, `makeGlyphTransformAdapter` and `composeAdapters`
(`diacriticPlacement.ts`), `GlyphTransformPlacement`, the Shape Fill
one-placement-per-glyph cap and its `nearestByIndex` pass, the rotation pivots
in `ShapedText`'s metrics walk, the guide's "Move, scale & turn a letter"
section, and the demo GIFs.

**Why — in the user's words:** *"altering the glyph just makes it so that it
looks off. The edges get skewed and stretched when I just wanted for the
stroke itself to be lengthened or shortened."* Scaling a whole letterform
distorts its edges and its pen weight. What was wanted was stroke length, and
that already has two non-distorting routes: **straight-stroke cuts**
([stroke-cuts.md](stroke-cuts.md)), which lengthen a stroke where it runs, and
font-drawn alternates such as `jalt`, which a type designer drew long. **Do
not bring back a whole-glyph scale as the answer to "make this stroke
longer".** If a "nudge one letter" tool is ever wanted, it is a translate
only, and it should be argued for on its own.

**What survived, and why it is where it is:**

- **`makeShapeFillInstanceAdapter`** and the rest of
  `diacriticPlacement.ts` — the diacritic overlay's coordinate layer, which
  predates the transform work.
- **`ShapeFillText`'s `dragBoundFunc` pin fix** — it pins to the node's own
  pre-drag absolute position instead of its layer-space props. Found while
  building the Shape Fill transform overlay, but it is the diacritic tool's
  pin now, and the bug it fixed (the block teleporting at 275% zoom) is real
  without any transform.
- **`projectOntoAxis`** (`src/lib/dragAxis.ts`) — the diacritic and stroke-cut
  overlays both use it as their rail.

**Old saves.** `glyphTransforms` and `glyphTransformMode` are in
`REMOVED_BLOCK_FIELDS`, so a letter moved, scaled or turned in an older
project loads back exactly where HarfBuzz puts it. No payload version bump:
the fields were always optional.

## The Morph Glyph Editor and everything under it

Removed wholesale on **2026-08-14**. What went: the Morph Glyph Editor panel
and its Stretch tool, the stroke schemas (`src/lib/strokeSchema/`, 105 JSONs),
the per-font stroke spines (`src/lib/strokeSpines/`, 30 tables), glyph rigs,
join pins, the per-font nuqta table and nuqta snapping, the block-level Kashida
dial, the tatweel-gap Kashida tool, Fit width / auto-justify
(`src/lib/justify.ts`), and By-stroke/Lasso mask editing
(`src/lib/glyphContours.ts`).

**Why.** The stack's core promise — strokes that extend — was measured inert.
The kashida dial did not widen a run at all (the rendered extent was unchanged
across the dial's whole travel, so Fit width could never fit); taking a letter
as a given font actually draws it, only ~14% of authored stretch zones had a
verified spine and therefore a handle; and the strokes that did move deformed
rather than extended. The user chose removal over continued repair. Phase 1's
tatweel stream replaces the elongation story with one that works.

**Where it lives if it is ever wanted back.** `docs/archive/nuqta-measurements.md`
carries the expensive, human-verified part — the per-font nuqta table, measured
two independent ways — plus the pre-removal SHA
(`fbe942cadec8c82596948309248a99a1fbb21f90`) that every deleted file can be
recovered from. The offline Python tooling (`scripts/measureNuqta.py`,
`deriveStrokeSpines.py`, `auditSpineOrientation.py`) is deliberately **kept**:
scripts are inert, and they are the other half of "don't redo the work." Read
that archive file before resurrecting anything from git history, exactly as the
`shapeWarp` note in CLAUDE.md asks.

**What survived, and why it is where it is:**

- **Per-glyph move, scale & rotate** — survived this removal, then went on
  2026-10-10 (above).
- **Diacritic overrides** — untouched, including the Shape Fill "Diacritic
  tool" checkbox.
- **`projectOntoAxis`** — was `lib/strokeSchema/dragAxis.ts`, now
  `src/lib/dragAxis.ts`, because the two surviving hover-handle overlays use it
  as their Konva `dragBoundFunc` rail. Its siblings `dotPositionForFactor` and
  `factorForPosition` went with the stretch tool.
- **`lib/arabicJoining.ts`** — kept when its only caller, the deleted
  `strokeSchema/glyphLookup.ts`, went. It has consumers again (`tatweel.ts`,
  `spacing.ts`), so it is no longer at risk of looking like dead code.

**Old saves.** `REMOVED_BLOCK_FIELDS` (`src/lib/legacySaves.ts`; it lived in
`App.tsx` as `stripRemovedFields` at the time) deletes `glyphEdits`,
`glyphRigValues`, `glyphMaskEdit`, `glyphEditTool`, `selectedGlyphIndex`,
`kashidaAmount` and `kashidaEditMode` off every block in
`applyParsedLayoutPayload` — the same mechanism and reasoning as the
`shapeWarp` type filter. A project saved before the removal loads with
those edits dropped rather than half-rendered. The layout payload's `version`
moved 4 → 5 and no longer embeds `glyphRigs`. The `harfcanvas-glyph-rigs-v1`
localStorage key is simply orphaned; nothing reads or clears it.
