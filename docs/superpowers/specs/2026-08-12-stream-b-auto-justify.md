# Stream B — Kashida auto-justify

**Read `PARALLEL.md` first.** Branch: `stream/b-auto-justify`.

## Goal

Turn the manual Kashida dial into a target-driven one: instead of dragging
0–100 until a line looks the right length, the user names a width and the app
solves for the dial position that achieves it.

## What exists today, and the trap

`App.tsx`'s `setBlockKashidaAmount` (line ~554) already distributes a 0–100
dial across every kashida-eligible, schema-backed stretch handle in a block,
weighting each by its `priority`:

```
factor = 1 + (maxFactor - 1) * (amount / 100) * (priority / 10)
```

That machinery works and this stream **must not change it**. The only new
thing is a solver that decides which `amount` to pass.

The trap: nothing in the app currently knows how wide a *stretched* run is.
`ShapedText.tsx`'s glyph-metrics memo (lines ~496–563) walks the raw font
outlines — `glyphObj.getPath(gx, gy, fontSize).getBoundingBox()` — and never
applies `glyphEdits`, and `penX += advance` is deliberately untouched by
stretching. So the block's reported bounds, its hit boxes, and its Konva
client rect are all **the unstretched width**. Reading any of them and
expecting it to respond to the kashida dial will produce a solver that
silently converges to nonsense. The measurement has to be built fresh.

## Design

### `src/lib/justify.ts` (new, exclusively owned)

```ts
/** Ink width of a shaped run with `glyphEdits` applied — the stretched width
 *  that `ShapedText` actually draws, which the block's own bounds do not report. */
export function measureStretchedRunWidth(args: {
  glyphs: HarfBuzzGlyph[];
  font: opentype.Font;
  fontSize: number;
  unitsPerEm: number;
  glyphEdits: GlyphEdit[];
}): number;

export type JustifySolution = {
  amount: number;         // 0-100, the dial value to apply
  achievedWidth: number;
  /** False when even amount=100 falls short of the target. */
  reachable: boolean;
};

export function solveKashidaAmount(
  measureAtAmount: (amount: number) => number,
  targetWidth: number,
  opts?: { tolerancePx?: number; maxIterations?: number }
): JustifySolution;
```

**`measureStretchedRunWidth`** replays the same walk `ShapedText` does — pen
advance, `dx`/`dy`, `fontSize / unitsPerEm` scale — but pushes every outline
point through `applyGlyphEdit` from `src/lib/glyphEdits.ts` before taking the
extent. Import that function; do not reimplement its math. If this module's
displacement ever diverges from the renderer's, the solver optimises a width
the user never sees, and nothing will fail loudly.

**`solveKashidaAmount`** bisects on `[0, 100]`. Width is monotonically
non-decreasing in the dial, which makes bisection safe; ~12 iterations reach
sub-pixel precision on any realistic width. Default `tolerancePx: 0.5`. When
`measureAtAmount(100) < targetWidth`, return `{ amount: 100, reachable: false }`
with the achieved width — apply the maximum and tell the user it fell short
rather than throwing or doing nothing.

The `measureAtAmount` callback is supplied by the caller and composes the
existing factor formula (copy it into the callback in `App.tsx`; do not export
`setBlockKashidaAmount`'s internals) with `measureStretchedRunWidth`.

### `App.tsx` — one handler, between the `STREAM-B` anchors

```ts
justifyBlock(blockId: number, target: { kind: "composition"; marginPx: number }
                            | { kind: "block"; otherId: number }): Promise<void>
```

It shapes the block's text via `shapeText(shapableText, FONT_URLS[fontFamily])`
from `src/lib/harfbuzz.ts` — results are cached by `text|fontUrl`, so this is
cheap and does not duplicate the renderer's work — builds the measure callback,
solves, then calls the **existing** `setBlockKashidaAmount(blockId, amount)`.
That single call carries history, the debounced push, and the re-render. No
renderer, no type, and no other handler changes.

Gate on the same block types `setBlockKashidaAmount` already accepts (it
excludes `image` and `textPath`). Do not widen it.

### Target resolution — note a change from the original plan

The design review assumed an artboard of fixed size to fit to. **There is no
such thing in this app.** `CanvasStage.tsx` derives `contentBox` from the
blocks' own bounding box via `padBox(getBlocksBoundingBox(...))`, so "fit to
the artboard" is circular: widening the block widens the artboard. The
`canvasSize`/preset state `CLAUDE.md` mentions does not exist in `App.tsx`.

The substitute, which preserves the intent without the circularity:

- **"Fit to composition"** — target is the bounding width of every *other*
  block on the canvas, minus `2 × marginPx`. Non-circular because the block
  being justified is excluded from the measurement. Disabled, with a tooltip,
  when the canvas holds no other block. Use `getBlocksBoundingBox` from
  `src/lib/canvasBounds.ts` on the filtered block list.
- **"Match block"** — target is the other selected block's client-rect width.
  Enabled only at exactly two selected blocks.

Both reduce to one `targetWidth` number and the same solver.

### `Sidebar.tsx` — Kashida section only

Under the existing "Kashida" title (~line 1883), below the current dial: two
buttons, "Fit to composition" and "Match block", plus a small numeric margin
input feeding the first. After a solve, show the outcome as one quiet line —
`Fitted to 812px` or `Reached maximum stretch at 640px of 812px` — rather than
an alert or a toast. Nothing else in `Sidebar.tsx` may change.

## Constraints

- **Never touch `ShapedText.tsx` or any other renderer.** The whole point of
  this stream's shape is that it bolts a solver onto working machinery.
- **Never touch `src/types.ts`.** The margin value lives in `App.tsx` state,
  not on the block, and is not persisted.
- Do not add a free-text target-width field. It was considered and dropped.
- Do not attempt automatic multi-line justification. This is a per-block,
  user-triggered action; the app has no line-breaking model to hook into.

## Tests (`src/lib/justify.test.ts`)

`solveKashidaAmount` is pure and takes a callback, so test it against
synthetic monotonic width functions: an exact hit; a target below the
`amount=0` width (returns 0); an unreachable target (`reachable: false`,
`amount: 100`); tolerance honoured; iteration cap respected.

For `measureStretchedRunWidth`, follow the precedent set by
`diacritics.test.ts` and shape **real text with real harfbuzzjs against a real
font in `public/fonts/`** rather than hand-writing glyph fixtures. That suite
exists in that form specifically because a fabricated-fixture version of it
once let a real bug ship. Assert the property that matters: measured width with
a stretch applied is strictly greater than with no edits, and equals the
unedited width when `glyphEdits` is empty.

## Guide section

`src/components/guide/sections/auto-justify.tsx`, `id: "auto-justify"`,
`order: 60`, title "Stretching text to fit". Explain kashida as elongation
first, then the manual dial, then the two fit buttons, and be honest that a
line can run out of stretch before reaching its target.

## Done when

The four verification commands pass, and by hand: a Thuluth or Wessam text
block with schema-backed kashida-eligible handles visibly elongates to match a
second block's width on "Match block", and reports a shortfall rather than
silently doing nothing when the target is out of reach.
