# Diacritic Hover Handles on Shape Fill & Shape Warp — Design

Date: 2026-08-12
Status: Approved, ready for implementation planning

## Summary

Extend the per-instance diacritic hover handles — today plain-text-only —
to Shape Fill and Shape Warp blocks, closing the first entry in CLAUDE.md's
"Deferred features" list.

The existing `DiacriticHoverHandles` component is generalised rather than
duplicated. It stops assuming glyph-run coordinates and instead takes a
list of *placements*, each carrying the mark's box plus a matched
`toCanvas`/`toLocal` function pair supplied by whichever renderer mounted
it. All of the component's interaction logic — hover state,
sticky-hover-while-dragging, the three handles, the override-scaled hit
rect — stays in local space and is untouched; only drawing maps through
`toCanvas` and only drag interpretation maps through `toLocal`.

Text-on-path and image blocks stay out of scope.

## Non-goals

- **Text-on-path blocks.** Glyphs there are rotated to a curve tangent;
  locating a handle in that space is separate work and stays deferred.
- **Per-repetition overrides in Shape Fill.** A Shape Fill block tiles the
  same glyph run many times, so one override necessarily applies to every
  repetition — identical to how `glyphEdits` and glyph rigs already behave
  there. Per-instance keying was considered and rejected: any change to
  spacing, shape, or scale re-tiles the block and would orphan every
  override.
- **New override fields.** `DiacriticOverride` keeps exactly its current
  `scale` / `offsetY` / `hidden` shape.
- **Changing plain text's behaviour.** `ShapedText`'s adapter is the
  identity plus the offset it already applies, so plain text renders and
  behaves exactly as it does today.

## Semantics

**Offsets are stored in text space, not screen space.** A drag is inverted
back into the glyph run's own coordinates, so an adjusted mark keeps being
bent (Shape Warp) or scaled (Shape Fill) along with the rest of the text
rather than floating off the letter it belongs to. Units therefore match
plain text's, and an override survives a block-type change with sane
values — though the exact rendering differs, because the block's own
deformation differs.

**Known asymmetry, deliberate:** `ShapedText` applies its override *after*
`warpX`/`warpY`, because the override is a `ctx` transform wrapping point
math that has already been warped. The two new renderers apply it *before*
their deformation. Shape warp/fill deformation is the entire point of
those block types; an override applied after it would detach the mark from
its letter. This asymmetry is intentional and should not be "fixed" by
aligning the two without revisiting this decision.

## Arming

- **Shape Warp** shows handles whenever the block is selected — one
  instance per mark, the same cost profile as plain text, matching every
  other on-canvas overlay in the app.
- **Shape Fill** requires an explicit "Diacritic tool" checkbox
  (`diacriticEditMode`), modeled on the existing Kashida tool row. A Shape
  Fill block tiles its run across the whole silhouette, so two marks can
  become 200+ on-canvas instances, each needing a hover rect, plus the
  scanline layout pass that locates them. Gating keeps that cost opt-in and
  avoids a selection-lag regression on dense fills.

The inconsistency between the two types is accepted deliberately: it buys a
predictable interaction on Shape Warp and a predictable frame budget on
Shape Fill.

Two consequences in `ShapeFillText` follow from the checkbox, both of which
must be handled explicitly:

- `glyphInstances` is currently memoised behind `if (!glyphEditTool) return []`.
  Its guard widens to `if (!glyphEditTool && !diacriticEditMode) return []`,
  so the scanline layout is computed when either tool is armed and skipped
  when neither is.
- The block `<Group>`'s `dragBoundFunc` currently pins the block's position
  whenever `glyphEditTool != null`, so a glyph drag cannot drag the whole
  block along with it. It pins under `diacriticEditMode` too, for the same
  reason.

On both new renderers the overlay additionally requires the block to be
selected, matching every other interactive on-canvas overlay — on Shape
Fill that means selected *and* `diacriticEditMode`.

## Components & data flow

### The overlay contract

`DiacriticHoverHandles` drops `glyphHitBoxes` / `offsetX` / `offsetY` in
favour of:

```ts
export type DiacriticPlacement = {
  /** Which override this instance edits. */
  glyphIndex: number;
  /** Unique per on-canvas instance (Shape Fill: line + repetition + glyphIndex). */
  key: string;
  /** The mark's box, in this instance's own local space. */
  box: { x: number; y: number; width: number; height: number };
  toCanvas: (x: number, y: number) => { x: number; y: number };
  toLocal: (x: number, y: number) => { x: number; y: number };
};
```

The only invariant is that `box` and the two functions agree on one local
space. Which space that is differs per renderer, and the overlay never
needs to know.

**Move-handle rail.** Today the blue handle's `dragBoundFunc` pins its
absolute x, because plain-text motion is purely vertical. Under a warp a
vertical text-space move is not vertically straight on canvas, so the rail
becomes: project the pointer to local space, hold local x, map back to
absolute. This is the same rail-projection technique
`StrokeStretchHoverHandles` already uses via `dragAxis.ts`, and it keeps
`dragBoundFunc`'s absolute-coordinate contract intact — the exact mixing
of local and absolute space that previously teleported this handle
sideways. Plain text's identity adapter makes this a no-op for text
blocks.

### Adapters

| Renderer | Local space | `toCanvas` | `toLocal` |
|---|---|---|---|
| `ShapedText` | glyph-run | `+ (offsetX, offsetY)` | `− (offsetX, offsetY)` |
| `ShapeWarpText` | glyph-run | `applyShapeWarpPoint` then `+ (bx, by)` | `invertShapeWarpPoint` (already exists) |
| `ShapeFillText` | glyph-local, per instance | `shapeScale · ( (gx,gy) + R(rot)·S(scX,scY)·p )` | closed-form inverse |

Shape Warp's pair is already written and already used for glyph
click-selection. Shape Fill's is a plain affine transform whose inverse is
closed-form.

Note that Shape Fill's local space is *glyph-local* (each instance's own
origin, matching `glyphCache`'s `getPath(0, 0, fontSize)` commands), while
the other two are glyph-run space including `gx`/`gy`. The contract above
tolerates this by construction.

### Render-time application

In both new renderers the override transform goes before the block's own
deformation, pivoted on the glyph's pen origin:

- **`ShapeWarpText.warpPoint`** — `baseX = gx + cx·s`,
  `baseY = gy + offsetY + cy·s`, then `applyShapeWarpPoint` as now.
- **`ShapeFillText.drawGlyphRow`** — `translate(0, offsetY); scale(s, s)`
  inside the existing `translate(gx,gy) → rotate → scale(scX,scY)` block.

`hidden` skips the draw call but keeps `penX += advance` in both, so
hiding a mark never reflows the surrounding letters — same rule
`ShapedText` already follows.

### Mount points

The overlay mounts after the drawing `<Shape>` in both renderers,
mirroring `ShapedText`'s ordering rule. In `ShapeFillText` it mounts
*before* the existing corner resize handle, so that handle keeps winning
Konva's topmost-listener contest at the shape's bottom-right corner.

## Integration

**`types.ts`** — move `diacriticOverrides?: DiacriticOverride[]` from
`TextBlock` up to `BlockCommon`, exactly as `glyphEdits` already sits
there. `ImageBlock` and `TextPathBlock` inherit it unused; that is the
documented, intentional `BlockCommon` simplification, not new debt. Add
`diacriticEditMode?: boolean` to `ShapeFillBlock` only — no other type has
a use for it, and the Sidebar gates by type.

**`App.tsx`** — `dragDiacriticOverride` and `toggleDiacriticHidden` patch
by block id and never inspect `type`, so they work unchanged once the
field moves to `BlockCommon`. `clearDiacritics` already operates on
`selectedBlock.text` generically. The only addition is
`toggleDiacriticEditMode`, modeled directly on `toggleKashidaEditMode`.

**`CanvasStage.tsx`** — thread `diacriticOverrides`,
`onDragDiacriticOverride`, and `onToggleDiacriticHidden` into
`ShapeFillText` and `ShapeWarpText` with the same wiring already present
for `ShapedText`.

**`Sidebar.tsx`** — widen the "Reset diacritic overrides" gate from
`type === "text"` to text | shapeFill | shapeWarp, and add a "Diacritic
tool" `CheckboxRow` inside the existing Shape Fill panel, with helper text
worded like the Kashida tool's.

## Failure modes

Each has a defined behaviour rather than a crash:

- `invertShapeWarpPoint` is Newton's method and bails on a near-singular
  Jacobian, returning its best guess. If an adapter's `toLocal` returns
  anything non-finite, that placement is dropped — no handle — rather than
  mounting a `Circle` at NaN, which Konva silently renders at the origin.
- Near-zero `scX` / `scY` / `shapeScale` divides are guarded with the
  `Math.max(v, 0.0001)` idiom `ShapeFillText`'s click handler already uses.
- No shape path, or a silhouette too thin to produce any scanline, yields
  zero placements and no handles.
- Stale overrides get the treatment `ShapedText` already applies: recompute
  `findDiacriticGlyphIndices` per render and ignore any override whose
  glyph index no longer lands on a mark, so a stale entry can never hide or
  balloon a base letter.

## Testing

The math is testable; the Konva layer is not. That split is explicit:

- New `src/lib/diacriticPlacement.ts` holds the *pure* adapter builders.
  Unit-tested for `toLocal(toCanvas(p)) ≈ p` round-trip across rotation ×
  `scX`/`scY` × `shapeScale` combinations, including the degenerate
  near-zero cases above.
- Add a round-trip test for the existing, currently-untested
  `invertShapeWarpPoint` across all four warp modes. Worth having
  regardless, since this feature depends on it interactively rather than
  only for click hit-testing.
- `diacritics.test.ts` keeps its existing discipline: real harfbuzzjs, real
  fonts from `public/fonts/`, no fabricated `{ g, cl }` fixtures.
- The overlay components get no unit tests — jsdom cannot drive Konva
  hit-testing, the same reasoning that leaves `imageTrace.ts`'s canvas work
  untested. These are verified in the browser before the work is called
  done: on a Shape Warp block in each of the four modes, and on a Shape
  Fill block with the Diacritic tool armed, confirming that an override
  applies to every tiled repetition.

Full verification loop as always: typecheck, lint, tests, build.
