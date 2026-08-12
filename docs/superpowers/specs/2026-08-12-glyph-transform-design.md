# Per-Glyph Move & Scale — Design

**Date:** 2026-08-12
**Status:** Approved, ready for implementation planning

## Goal

Give the user a third per-glyph editing system: rigidly **move** a single
shaped glyph, and **stretch or shrink it as a whole** in x or y. This sits
alongside the two that already exist and does something neither can:

| System | What it does | Granularity |
|---|---|---|
| `glyphEdits` (Stretch tool) | Displaces real font-outline *points* with band falloff | Sub-glyph |
| `diacriticOverrides` | Uniform scale + vertical offset, marks only | Whole mark |
| **`glyphTransforms` (this)** | Offset x/y + independent scale x/y | Whole glyph, any glyph |

## Decisions

| Question | Decision |
|---|---|
| Reflow | None. The glyph's advance is untouched, so neighbours never move. |
| Target glyphs | Any shaped glyph — letters, marks, ligatures. |
| Block types (v1) | Plain text only. |
| Controls | On-canvas hover handles only. No panel numeric fields. |
| Coexistence | A "Move & scale glyph" toggle arms the tool; stroke-stretch dots stand down while it is on. |
| Scale pivot | The glyph's pen origin (on the baseline, at the start of its advance). |

## Data model

In `src/types.ts`:

```ts
export type GlyphTransform = {
  glyphIndex: number;
  /** Horizontal shift in local (unscaled) units. Default 0. */
  offsetX?: number;
  /** Vertical shift in local (unscaled) units. Default 0. */
  offsetY?: number;
  /** Multiplier on the glyph's natural width. Default 1. */
  scaleX?: number;
  /** Multiplier on the glyph's natural height. Default 1. */
  scaleY?: number;
};
```

`glyphTransforms?: GlyphTransform[]` and `glyphTransformMode?: boolean` go
on `BlockCommon`, the same home `glyphEdits` and `diacriticOverrides`
already have. Only plain text blocks read them in v1; the other block
types inherit them unused, the intentional simplification `BlockCommon`
already makes throughout.

Transforms are keyed by glyph index and inherit that scheme's known
fragility: editing text *before* a glyph shifts which index its transform
lands on after re-shaping. Unlike `diacriticOverrides` — which
`ShapedText` re-filters each render against
`findDiacriticGlyphIndices`, so a stale override that now lands on a base
letter is silently dropped — a glyph transform has no identity signal to
check against, because every glyph is a legitimate target. A stale
transform therefore applies to whatever glyph now holds that index. This
matches `glyphEdits` exactly and is accepted rather than solved; solving
it means a real glyph-identity scheme, which is its own project.

## Rendering

One insertion in `ShapedText.tsx`'s `drawWarpedGlyphRun`, in the existing
`ctx.save(); ctx.translate(gx, gy)` slot beside the diacritic-override
block:

```ts
if (transform) {
  ctx.translate(transform.offsetX ?? 0, transform.offsetY ?? 0);
  ctx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);
}
```

Because the context is already translated to the glyph's pen origin
`(gx, gy)`, this pivots on the pen origin with no pivot arithmetic — the
same trick the diacritic override and the Private-Use-Area preset glyphs
already rely on in that function.

**Composition order.** This applies *after* `applyGlyphEdit` and the glyph
rig, which is what "rigid transform of the finished glyph" has to mean:
stretch handles reshape the outline, then this moves and scales the result
as a unit. A glyph carrying both a diacritic override and a transform gets
both, multiplied — coherent, and no special case is needed for it.

**No reflow.** `penX += advance` is untouched, so a moved or widened glyph
never shifts its neighbours. This is the same guarantee `hidden` already
gives on diacritic overrides.

**Hit boxes.** The same transform must be applied in `ShapedText.tsx`'s
second glyph loop, the one that builds `glyphHitBoxes`. Without it a
transformed glyph's hover target drifts away from where the glyph is
drawn — exactly the bug the diacritic hit rects had before they were
derived from the mark's rendered position instead of its original box.

## Interaction

`GlyphTransformHoverHandles.tsx`, a new component modeled on
`DiacriticHoverHandles.tsx`. Hover-only, mounted from `ShapedText.tsx`
when the block is selected *and* `glyphTransformMode` is on. Three dots
per hovered glyph:

- **Move** — glyph-box center, free 2D drag, writes `offsetX`/`offsetY`.
- **Scale X** — right edge at mid-height, rail-constrained horizontally.
- **Scale Y** — top edge at center, rail-constrained vertically.

Rails use `projectOntoAxis` (`lib/strokeSchema/dragAxis.ts`) with the rail
captured in **absolute (stage) space** at `onDragStart`. Konva's
`dragBoundFunc` contract is absolute while everything else in these
overlays is local; mixing the two is what previously teleported the
diacritic move handle sideways under any block offset, pan, or zoom.

Each scale dot's rest position is the glyph box edge *at the current
scale*, so the dot travels with the glyph as it grows. The new scale is
the pointer's distance from the pen-origin pivot divided by its rest
distance, clamped to **0.2–4** so a glyph can neither collapse to nothing
nor explode off-canvas.

Two hit-testing rules, both already learned by
`StrokeStretchHoverHandles`: the hover hit-`Rect` is sized to the union of
the glyph box and all three dots' current positions (a dot dragged far out
would otherwise leave the rect, fire `onMouseLeave`, and unmount itself
mid-gesture), and every *other* glyph's rect switches `listening` off
while one glyph is hovered or dragging, so those deliberately wide rects
cannot steal hover from each other.

**Overlay precedence.** While the tool is armed `ShapedText` does not
mount `StrokeStretchHoverHandles` at all — one tool active at a time, so a
dot is never ambiguous. `DiacriticHoverHandles` still mounts *after* this
overlay, keeping its smaller, more precise targets topmost on marks, the
same ordering rule that file already documents.

## State and sidebar

Three handlers in `App.tsx`, following the established shapes:
`updateGlyphTransform(blockId, glyphIndex, patch)`,
`resetGlyphTransforms()`, and `toggleGlyphTransformMode()`, threaded
through `CanvasStage` to `ShapedText`. Handle drags push history through
`useDebouncedHistoryPush`, so one continuous drag collapses to a single
undo entry; the toggle and the reset are discrete, immediate
`pushHistory()` mutations.

The Morph Glyph Editor panel gets exactly two controls: a "Move & scale
glyph" checkbox, and a "Reset glyph transforms" button shown only when the
block has transforms — mirroring "Reset diacritic overrides".

## Testing

Pure math lives in `src/lib/glyphTransform.ts` with unit tests beside it
(`src/lib/glyphTransform.test.ts`, per this repo's convention):

- `resolveGlyphTransform` — missing fields resolve to the identity.
- `scaleFromDrag(pivot, restDistance, pointer)` — the ratio, the 0.2–4
  clamp at both ends, and a near-zero `restDistance` returning a finite
  value rather than `Infinity`/`NaN`.
- `transformedBox` — a glyph's hit box under a transform. The renderer and
  the overlay must agree on this, so it is shared code, not duplicated
  arithmetic.

`GlyphTransformHoverHandles.tsx` itself gets no unit test: jsdom cannot
drive Konva hit-testing. This is the same documented gap as
`DiacriticHoverHandles` and `imageTrace.ts`, and it means the feature is
proven by hand in the browser. Automation can confirm the handles *mount*
and sit on the glyph; it cannot land a press on them, so the drags
themselves need a human.

## Out of scope

- **Rotation** — a fourth handle and a different pivot conversation.
- **Shape Fill and Shape Warp** — the `DiacriticPlacement` adapters
  (`src/lib/diacriticPlacement.ts`) make this a follow-up rather than a
  rewrite, but each renderer's coordinate space needs its own verification
  pass.
- **Text-on-path** — glyphs are rotated to a curve tangent there; already
  deferred for every other per-glyph tool for the same reason.
- **Panel numeric fields** — canvas-only by choice. If typed precision is
  wanted later, the handlers already accept a patch and a panel input is
  a small addition.
