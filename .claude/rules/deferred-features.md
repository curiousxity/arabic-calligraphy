---
paths:
  - "src/components/TextOnPathText.tsx"
  - "src/lib/textPath.ts"
---

# Deferred features

These are capabilities that have been explicitly identified as valuable but deliberately left for a future specification rather than partially supported now:

- **Drag-based per-glyph tools on text-on-path blocks** — diacritic
  overrides **shipped 2026-10-15**; the open question (tangent or arc?) was
  answered "the letter's own tangent frame", see
  [text-on-path.md](text-on-path.md). Stretching is declined, below. Dot
  moves (detached marks) on curves were not part of this and stay unbuilt.

- **Straight-stroke stretching on Shape Fill and text-on-path blocks** —
  **Declined, not deferred**, and for a stronger reason than the one this
  entry used to give (that it was the same coordinate-space work as the
  since-removed per-glyph move & scale). The detector and the surgery really are block-type agnostic,
  so that framing looked right; the blocker is downstream of both.

  **Both target renderers renormalise the run to a fixed span.**
  `computeShapeFillLines` sets `fitScaleX = lineWidth / (reps ×
  effectiveAdvance)` and `TextOnPathText` sets `fitScale = curveLen /
  naturalAdvance`. A cut never touches `g.ax`, so there are two ways to wire
  it and both fail: feed the added advance into `totalAdvance` /
  `naturalAdvance` and the renderer divides it straight back out, leaving the
  run exactly as wide as before; leave it out and the cut glyph grows into
  its neighbour's slot. Neither is elongation, and the assertion the whole
  feature rests on — that the advance grows monotonically with the cut
  distance — cannot hold on a span that is normalised afterwards.

  This is the same property that makes Fit to width text-only, and it is why
  a Shape Fill run already spans its silhouette and a Curve run its curve
  without anyone asking. Reaching for it again means changing what those two
  renderers *are*, which is the render-math rewrite CLAUDE.md declines
  elsewhere.

- **Image trace** — Auto-tracing a raster image into a silhouette shape existed on Shape Warp blocks and was removed with that block type. Rebuilding it for Shape Fill means restoring `lib/imageTrace.ts`, `ImageTraceDialog.tsx`, and the `imagetracerjs` dependency from git history; the tracing itself was block-type agnostic, producing the same `{ pathData, w, h }` shape `extractSvgPaths` returns.

- **Stacked compositions (tarkib)** — Shipped 2026-10-14 (see
  [stacked-compositions.md](stacked-compositions.md)); what is left for
  later is below, and in the roadmap that follows this list:
  - *Bending letter bodies* ("Approach C"): skeletonise each glyph into a
    centerline plus a nib and re-render with the nib swept along it, so any
    stroke — not only a join or a tail — can bend with correct weight.
    Open research on Diwani's overlapping, variable-width forms; the
    stroke-cut detector's history (stroke-cuts.md) is the cautionary tale
    for predicates that look reasonable on straight strokes.
    Widening or tightening a *curved stroke* shipped 2026-10-15 by turning
    the curve into a join (`bendCurveAt`; see stacked-compositions.md);
    bending a *whole* letter body with a skeleton stays deferred.
  - *Stacking alternates in the Diwani font* (raised ب, the long sweeping
    م tail): font-side glyph design, exposed through Next Shape; see
    [bundled-fonts.md](bundled-fonts.md).

- **Free movement of nuqtas and diacritics** — Shipped 2026-10-14; see
  [detached-marks.md](detached-marks.md) and [diacritics.md](diacritics.md).
  Still deferred: rotation of a mark; splitting a dot the font draws fused
  to its stem (Diwani ف, Ruqaa ن); and dot handles on the five pieced or
  decorative faces the gate opted out (Kufi2, Qahiri, RanaKufi, ThuluthDeco,
  Wessam), which would need a different notion of "body" than touch
  connectivity.

## Roadmap: towards a pen that behaves like a calligrapher's

Raised 2026-10-16 while comparing HarfCanvas with Kelk. The gap is that Kelk
(as we understand it) is built on its own pen-drawn letters, so it already
knows how each stroke was made; HarfCanvas starts from ordinary fonts and
infers the pen afterwards, from the cut faces (see "The face vector is the
nib" in [stacked-compositions.md](stacked-compositions.md)). In rough order
of size:

1. **Stretch fatha and kasra in a composition** — *shipped 2026-10-16*
   (see stacked-compositions.md). Press either end and pull; Shift keeps it
   straight.
2. **Tilt a mark in a composition.** Marks can move and stretch but have no
   tilt ring; a calligrapher sets a long fatha's angle to the space it fills.
   Small: the ring is gated to letters in `StackEditOverlay`; the open
   question is whether a small mark's ring steals presses from its
   neighbours.
3. **Stretch the other marks** — the kaf's stroke (a detached mark, aspect
   ~2), tanween (two strokes: cut each, pull together?), the tail of a
   damma. Each fails a different gate today; measure before widening one.
4. **Bend any part of any letter** ("Approach C", above): skeleton plus nib,
   so every stroke can stretch or bend, not only straight runs, curves and
   joins. Research; Diwani's overlapping strokes are the hard case.
5. **Letters built for stretching**: font-side alternates (the long م tail,
   a raised ب) through Next Shape, and in the limit pen-drawn letter models
   like Kelk's. Font design work, not app code.

