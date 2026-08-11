# Stroke Stretch Hover Handles — Design

Date: 2026-08-11
Status: Approved, ready for implementation planning

## Summary

Replace the Morph Glyph Editor's per-stroke `RangeRow` sliders with
draggable on-canvas handles, for **plain text blocks only**. Hovering a
letter that has an authored stroke schema reveals one draggable dot per
stroke zone; dragging a dot along its stroke's authored anchor→drag axis
sets that stroke's `factor`. This is a deliberate partial reversal of the
Kaleam-style slider-only rework (`37bc755`, `68c4ba3`) — this time backed
by the schema-derived axis those commits introduced, not the old freeform
user-positioned anchor/drag dots that preceded them.

Shape Fill and Shape Warp blocks keep today's `RangeRow` sliders
unchanged — hover-handle positioning in their tiled-row and
warped-envelope coordinate spaces is real, separate design work, same
reasoning that kept the diacritic hover handles (`[[diacritics-control-feature]]`)
scoped to plain text for v1.

## Non-goals

- Shape Fill / Shape Warp blocks — out of scope, sliders untouched.
- Band width, masking (By stroke / Lasso), and Save-as-Rig — these stay
  exactly as they are today (sidebar-driven), not converted to on-canvas
  controls.
- The block-level Kashida 0–100 dial and Rigged Parameters sliders are
  unaffected — only the per-stroke `factor` sliders in the "Stroke
  Sliders" list are being replaced.

## Interaction model

Whenever a plain text block is selected, hovering anywhere over a letter
with an authored stroke schema reveals a small draggable dot for each of
that letter's stroke zones (one dot per row the Morph panel currently
lists for that letter). Moving the mouse away hides them — the same
declutter rule `DiacriticHoverHandles` already uses (only the
currently-hovered letter's dots are ever shown).

Dragging a dot is constrained to travel along that stroke's authored
anchor→drag axis (a rail, not free 2D movement) via `dragBoundFunc`
projecting the pointer onto the line. `factor` itself is already the
natural interpolation parameter along that axis — by construction
(`App.tsx`'s `setStretchFactor`), `dragOrigin = anchor + 1·(dragOrigin −
anchor)` is the `factor = 1` point and `dragX = anchor + maxFactor·
(dragOrigin − anchor)` is the `factor = maxFactor` point, both on the
same ray from `anchor`. So the dot's rest position for a given `factor`
is simply:

```
dot = anchor + factor · (dragOrigin − anchor)
```

and dragging inverts that directly — no need to go through
`resolveValueMultiplier` (that function is a separate, renderer-side
concern for how a *glyph point* gets displaced, not for where the UI dot
sits):

```
dir = normalize(dragOrigin − anchor)
axisLength = |dragOrigin − anchor|
projectedDistance = (pointer − anchor) · dir
factor = clamp(projectedDistance / axisLength, minFactor, maxFactor)
```

A thin guide line from the stroke's
anchor point to its dot renders only while that stroke's dot is
hovered/dragging, so the pull direction is legible. Double-clicking a dot
resets that stroke to `factor: 1`, mirroring the sidebar's existing Reset
(×) button.

## Components & data flow

A new `StrokeStretchHoverHandles.tsx`, modeled directly on
`DiacriticHoverHandles.tsx` (same hover-`Rect`/sticky-drag/`cancelBubble`
pattern), mounted inside `ShapedText.tsx` alongside the existing
`<DiacriticHoverHandles />`. It receives:

- `glyphSchemaCatalog` — already computed locally by `ShapedText.tsx` via
  `useGlyphSchemaCatalog`; one or more `StretchDefinition`s per glyph
  index.
- `glyphEdits` (existing handles, if any) and `glyphHitBoxes` — both
  already flow through `ShapedText.tsx` today.
- The same `offsetX`/`offsetY` group-local offset `DiacriticHoverHandles`
  already uses.

For each `(glyphIndex, definition)` pair with an authored schema:

- If a matching `GlyphStretchHandle` already exists (same
  `schemaStrokeId`/`schemaZoneIndex` lookup `MorphGlyphEditor.tsx` already
  does), the dot draws from that handle's own stored
  `anchorX/Y`/`dragOriginX/Y`/`dragX/Y`/`factor`.
- If no handle exists yet, a **preview** position is computed the same
  way `App.tsx`'s `setStretchFactor` does on first movement —
  `mapNormToRealBox(definition.anchorNorm/dragNorm, box)` plus
  extrapolation to `maxFactor` — so the dot appears at the natural
  (`factor=1`) position, ready to drag, without creating a handle in
  state until the user actually drags it.

Dragging (every `onDragMove`) calls the existing
`onSetStretchFactor(blockId, glyphIndex, definition, factor)` prop —
already handles "create on first movement, update after" transparently,
so no new `App.tsx` mutator is needed. A new `scheduleStretchHistoryPush`
(the existing `useDebouncedHistoryPush` pattern, same as Kashida/
diacritics) commits one undo step per settled gesture instead of one per
drag-move frame.

**Coordinate-space note for the implementation plan:** the exact
translate offset `StrokeStretchHoverHandles` needs to line up its dots
with `drawWarpedGlyphRun`'s own coordinate space (whether stored
`anchorX/Y` already includes `localDrawX`/`localDrawY` or not) must be
verified against `drawWarpedGlyphRun`'s actual per-glyph translate
sequence before wiring the overlay's `offsetX`/`offsetY` — don't assume
it's identical to `DiacriticHoverHandles`'s offset without checking.

## Sidebar changes (`MorphGlyphEditor.tsx`)

Branch on `selectedBlock.type === "text"`:

- **Text blocks:** each stroke row drops the `RangeRow` and instead shows
  the label, a small editable number input (typing a value calls the same
  `onSetStretchFactor`, clamped to `[minFactor, maxFactor]`), and the
  existing Reset (×) / Options… (band width, masking, save-as-rig)
  controls, unchanged. The Off/Stretch tool toggle is removed for text
  blocks — mask-editing "By stroke"/"Lasso" arms directly via
  `selectedGlyphIndex` (already set when a row's mask-edit is armed),
  no longer gated on `glyphEditTool`.
- **Shape Fill / Shape Warp blocks:** unchanged — keep today's `RangeRow`
  and the Off/Stretch tool toggle exactly as they are now.

`ShapedText.tsx`'s block-drag lock (`dragBoundFunc={glyphEditTool != null
? () => ({ x, y }) : undefined}`) and the click-to-select-glyph handler
are only meaningful for the tool-gated mask-editing flow — for text
blocks this becomes conditioned on whether a mask edit is currently armed
(`glyphMaskEdit != null`) rather than on `glyphEditTool`, so normal block
dragging isn't locked just because the block is selected.

## Integration

- **History:** live dot-dragging follows the debounced-history pattern
  already established by Kashida/diacritics/text-path — state updates on
  every drag frame, one undo step recorded once the gesture settles.
  Double-click reset is a discrete, immediate `pushHistory()` mutation,
  matching every other click-driven mutation in the app.
- **Export:** the overlay only ever renders for the currently-hovered
  letter on a *selected* block; exports run with no live mouse
  interaction, so no export-hiding logic should be needed — same
  assumption the diacritic feature made, verified there by manual check
  rather than taken on faith. This gets the same manual verification step
  in the plan.
- **Masking / Band width / Save-as-Rig:** entirely unchanged — these stay
  sidebar-driven (Options… panel) regardless of whether the factor itself
  is set via slider or hover handle.

## Testing

The `factor ↔ dot position` conversion (project pointer onto the
anchor→dragOrigin axis, scale by `axisLength`, clamp to
`[minFactor, maxFactor]`) is pure math, worth a small unit test —
`dot(factor(dot(f))) ≈ f` for representative `minFactor`/`maxFactor`
ranges and a few sample axis geometries — likely landing in a new small
module (e.g. `lib/strokeSchema/dragAxis.ts`) rather than inline in the
Konva component, consistent with this codebase's convention of
unit-testing pure `lib/*.ts` logic while leaving Konva rendering
components themselves untested. The hover-handle component itself
(`StrokeStretchHoverHandles.tsx`) is not unit-tested, matching
`DiacriticHoverHandles.tsx` and every other on-canvas interaction in this
app.
