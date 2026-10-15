---
paths:
  - "src/components/TextOnPathText.tsx"
  - "src/lib/textPath.ts"
---

# Deferred features

These are capabilities that have been explicitly identified as valuable but deliberately left for a future specification rather than partially supported now:

- **Drag-based per-glyph tools on text-on-path blocks** (diacritic
  overrides; stretching is declined, below). The open question is what an
  offset means along a curve: along the tangent, or along the arc. Click-only
  Next Shape does reach curves — see [text-on-path.md](text-on-path.md).

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
  [stacked-compositions.md](stacked-compositions.md)); two things left for
  later:
  - *Bending letter bodies* ("Approach C"): skeletonise each glyph into a
    centerline plus a nib and re-render with the nib swept along it, so any
    stroke — not only a join or a tail — can bend with correct weight.
    Open research on Diwani's overlapping, variable-width forms; the
    stroke-cut detector's history (stroke-cuts.md) is the cautionary tale
    for predicates that look reasonable on straight strokes.
    Includes **widening the radius of a curved stroke** (asked 2026-10-15
    alongside stack arrange fillers; see
    `docs/superpowers/specs/2026-10-15-stack-arrange-fill-design.md`,
    "Out of scope"): a bowl has only an outline, no spine, so this is the
    same skeleton + nib work.
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
