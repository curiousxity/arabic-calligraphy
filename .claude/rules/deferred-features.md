---
paths:
  - "src/components/TextOnPathText.tsx"
  - "src/lib/textPath.ts"
  - "src/lib/squareKufiAlphabet.ts"
---

# Deferred features

These are capabilities that have been explicitly identified as valuable but deliberately left for a future specification rather than partially supported now:

- **Per-glyph move, scale & rotate on text-on-path blocks** — Shape Fill
  shipped (see [glyph-transform.md](glyph-transform.md)); text-on-path did not, and the reason is
  its own rather than the coordinate-space work Shape Fill needed.
  `TextOnPathText` has no metrics pass, no hit boxes, no `isSelected` prop and
  no overlay of any kind, and — the part a spec has to answer first —
  `offsetX` on a curve has no defined meaning: along the tangent, or along
  arc length? That question has now been deferred twice. It is excluded for
  the same reason every other per-glyph tool excludes it, its glyphs being
  rotated to a curve tangent.

- **Straight-stroke stretching on Shape Fill and text-on-path blocks** —
  **Declined, not deferred**, and for a stronger reason than the one this
  entry used to give (that it was the same coordinate-space work as per-glyph
  move & scale). The detector and the surgery really are block-type agnostic,
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

- **Dots and tashkeel in square kufi** — Deliberately undrawn, matching the
  style; see [square-kufi.md](square-kufi.md) for why it is a design problem
  rather than a missing loop. Doing it means a dot cell, a placement band clear
  of the letter, and widening a letter's advance so two neighbours' dots cannot
  merge into one blob.

- **Spiral square-kufi compositions** — Classic panels also spiral inward from
  the edge. Boustrophedon shipped (see the square-kufi section); a spiral is a
  different problem, since it turns a line through 90° rather than 180° and so
  cannot reuse `placeLine`'s half-turn blit.

- **Image trace** — Auto-tracing a raster image into a silhouette shape existed on Shape Warp blocks and was removed with that block type. Rebuilding it for Shape Fill means restoring `lib/imageTrace.ts`, `ImageTraceDialog.tsx`, and the `imagetracerjs` dependency from git history; the tracing itself was block-type agnostic, producing the same `{ pathData, w, h }` shape `extractSvgPaths` returns.
