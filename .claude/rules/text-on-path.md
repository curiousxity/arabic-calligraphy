---
paths:
  - "src/lib/textPath*.ts"
  - "src/components/TextOnPathText.tsx"
  - "src/components/TextPathEditOverlay.tsx"
---

# Text on path (`src/lib/textPath.ts`, `TextOnPathText.tsx`, `TextPathEditOverlay.tsx`)

A fourth block type, `textPath`, flows shaped text along an arbitrary curve
instead of a straight baseline. The curve is stored as a plain SVG path `d`
string (`textPathD`) — the same representation `shapeSvgPath` already uses
on `shapeFill` blocks — rather than a bespoke point-array type,
so presets, SVG upload, and freehand pen-tool drawing all converge on one
representation and reuse `lib/svgPath.ts`'s existing parse/flatten/replay
functions wholesale.

`lib/textPath.ts` adds arc-length walking (`pathLength`/`pointAtArcLength`,
built on the same fixed-step bezier subdivision `pathToPolygon` already
provides), three preset-curve generators (`arcPathD`/`wavePathD`/
`circlePathD`), and a single-handle-per-anchor bezier editing model
(`CurveAnchor`/`anchorsToD`/`dToAnchors`) — every anchor has one *outgoing*
handle; the incoming handle for the next segment is always that anchor's
mirror image, trading a fully general independent-in/out-handle pen tool
for a much simpler one-handle-per-anchor editing UI.

`TextOnPathText.tsx` renders each glyph as a rigid unit — translate to its
arc-length position on the curve, rotate to the local tangent, draw the
outline — modeled on `ShapedText.tsx`'s glyph loop rather than a
per-point remap, since text-on-path repositions whole
glyphs rather than distorting their outlines. Text always auto-scales to
span the curve's length exactly (same idea `ShapeFillText` already applies
per-row to its shape width), which means the block's `fontSize` field has
no visible effect for this block type and its slider is hidden in the
sidebar — curve length is the only size control. RTL text anchors to the
curve's *end* point by default (a `textPathReversed` flag flips this per
block when the guess is wrong for a particular curve).

`TextPathEditOverlay.tsx` is a separate component (not part of
`TextOnPathText`) providing the on-canvas pen-tool: click empty canvas to
append an anchor, drag an anchor or its handle to reshape, right-click an
anchor to remove it. Each of those edits calls `onBeginChange` first (App
passes `pushHistory`), so an edit is one undo step: a drag at its start, an
add or remove before it commits. `updateTextPathD` never pushes itself. It's shown only when a `textPath` block is both
selected and has `textPathEditMode` set, and is hidden during export
(`useExport.ts` toggles off every node whose id starts with
`text-path-edit-layer-`, alongside the grid and artboard background it
already hides).

**Guide-attached mode.** With `guide` set, the block's own `textPathD` and
position are ignored: CanvasStage passes the guide's path, and the text is
laid out by `guideGlyphPlacements` at its natural size (shrinking only to
fit) instead of `curveGlyphPlacements`' stretch-to-span. Its hit box is its
letters' extent, not the curve's. See [guides.md](guides.md).

**GPOS offsets go in the pen's tangent frame** (`curvePenPlacement`, used
by both `curveGlyphPlacements` and `guideGlyphPlacements`): a glyph's
`(dx, -dy)` is rotated with the tangent at its pen position. Before
2026-10-15 both layouts ignored `dx`/`dy` entirely, so every tashkeel mark
was drawn where its zero advance left the pen — far above or beside its
letter in most fonts. Rigid in the pen frame, **not slid along the arc**:
HarfBuzz returns Arabic in visual order with each zero-advance mark just
before its base, so a mark's pen *is* its letter's, and the letter is drawn
rigidly in that frame. Sliding by `dx` along the arc was tried and put the
damma of Fatemi Maqala's `مُحَمَّد` past the end of its long ح on the arc
preset. On a straight curve the result equals `ShapedText`'s `(pen + dx,
-dy)`, which `guidePlacement.test.ts` checks against real shaping.

**Diacritic handles work on curves** (since 2026-10-15), plain and
guide-attached, armed on selection like a text block — no checkbox, since a
curve has one copy of each mark. The question that held this back, "is an
offset along the tangent or along the arc?", is answered: neither, it is in
the **mark's own letter's tilted frame** (`makeCurveGlyphAdapter` in
`diacriticPlacement.ts`). Local y is perpendicular to the curve at that
letter, so "up" stays "away from the curve" wherever the letter sits. The
override is stored at `fontSize` and scaled by `k = placement.size /
fontSize` both when drawing and in the adapter, because `fontSize` is inert
here — a curve lengthened later grows its text, and an offset in raw px
would drift relative to its letter. Overrides are re-validated each render
against `findDiacriticGlyphIndices`, as in `ShapedText`. Attaching a text
block to a guide keeps its overrides (`guides.ts`): same text, same font, so
the glyph indices they are keyed by still line up.

The remaining drag tools — stroke cuts and dot moves — still exclude
`"textPath"` in `blockCapabilities.ts`.

**Next Shape also reaches curves**, and it was safe even before the frame
question was answered because it is click-only.
It needs to know *which* letter is under the pointer, never how to move one.
Glyph placement lives in `curveGlyphPlacements` (pure, in `lib/textPath.ts`):
the draw loop renders from it and both overlays (Next Shape, diacritics) outline from it, so a rotated
outline cannot drift from its ink. Keep it that way: placement maths inlined
back into the draw loop would silently desynchronise the two.

<!-- ---- STREAM-G: font upload — document this feature here (see docs/superpowers/specs/PARALLEL-PHASE-2.md) ---- -->
