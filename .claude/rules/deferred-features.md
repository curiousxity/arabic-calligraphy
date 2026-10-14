---
paths:
  - "src/components/TextOnPathText.tsx"
  - "src/lib/textPath.ts"
  - "src/lib/squareKufiAlphabet.ts"
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

- **Stacked compositions (tarkib) — curved joins first** — Decided to build
  (2026-10-14); design in
  `docs/superpowers/specs/2026-10-14-stacked-compositions-design.md`. Two
  things it leaves for later, both operating on the baked stack block it
  creates:
  - *Bending letter bodies* ("Approach C"): skeletonise each glyph into a
    centerline plus a nib and re-render with the nib swept along it, so any
    stroke — not only a join or a tail — can bend with correct weight.
    Open research on Diwani's overlapping, variable-width forms; the
    stroke-cut detector's history (stroke-cuts.md) is the cautionary tale
    for predicates that look reasonable on straight strokes.
  - *Stacking alternates in the Diwani font* (raised ب, the long sweeping
    م tail): font-side glyph design, exposed through Next Shape; see
    [bundled-fonts.md](bundled-fonts.md).

  The goal is the Diwani stacked name: in the
  reference piece ("Mosbeh", مصبح) the letters sit on separate baselines,
  the connecting strokes between them are long free curves at constant pen
  width, and the whole fills a teardrop with the م's tail curling back under
  the rest. The bar is "competes with the hand-drawn version", not "a
  stacked-looking effect".

  What that piece *is*, and therefore what the feature is: letter bodies
  placed freely and barely distorted, **joins redrawn as curves**, and a
  silhouette aimed at. The joins are where all the difficulty lives; the
  other two are modest.

  Ruled out, and why:
  - *A liquify-style displacement field.* It keeps things smooth but changes
    stroke **weight** — stretch a stem and the pen looks wider, pinch it and
    it goes hairline. Weight is the one property a calligrapher never varies
    arbitrarily; it is what separates calligraphy from warped type. The
    removed Shape Warp block was this idea with four preset fields (its
    removal commit, f29e469, records no reason; see CLAUDE.md);
    `warpPoint` in `src/lib/warp.ts` is the surviving block-level form.
  - *A packing solver that fits a word into a shape.* It has no notion of
    which letter should rise and which should sweep, so its fits are
    geometrically right and calligraphically wrong. The container is a
    **guide** the user arranges against, not a target the app solves for.
  - *Scaling letters*, per [removed-subsystems.md](removed-subsystems.md).
    Letters translate; they do not resize.
  - *Skeletonising glyphs into centerline + nib* so whole letters can bend
    with correct weight. Right in principle, but open research on Diwani's
    overlapping forms. Not where to start.

  The plan, in order:
  1. **Curved join between two cut faces.** Stroke cuts
     ([stroke-cuts.md](stroke-cuts.md)) already find a straight stroke,
     measure it perpendicular to the pen, and cut it in font units. Extend
     that: cut a join, and draw a bezier between the two cut faces swept
     with a nib whose width and angle come from the cut. A curved,
     nib-width kashida. Worth building on its own — calligraphers draw this
     constantly and no font can supply it.
  2. **Free vertical placement of letters** falls out of (1): once a join is
     a synthesised curve, the letters on either side can sit on different
     baselines and the join follows.
  3. **Container guide.** A teardrop/medallion preset in the ornament or
     guide library to arrange against. Cheap once (1) and (2) exist.

  Known ceiling: fonts do not ship the alternate letterforms a Diwani master
  chooses when stacking (raised ب, the long sweeping م tail), and Next Shape
  can only expose what a font carries. Closing that gap is a font-side
  problem (drawing stacking alternates into the bundled Diwani fonts, see
  [bundled-fonts.md](bundled-fonts.md)), not a renderer one.

  Today's nearest substitute is splitting the word into tatweel-joined
  pieces (`مـ`, `ـصـ`, …) in separate text blocks, arranging them by hand
  and grouping them.

- **Free movement of nuqtas and diacritics** — Wanted (2026-10-13, after
  looking at Qalam Studio, which splits every glyph into body, dots and marks
  and moves each one). Not started; the purpose is not settled yet (collision
  fixes, traditional placement, or decorative freedom), and it should be
  asked before choosing an approach. Two separate pieces:
  - *Diacritics sideways.* Tashkeel already moves vertically, resizes and
    hides ([diacritics.md](diacritics.md)); adding `offsetX` is a widening of
    `DiacriticOverride` and the drag rail, not a new subsystem.
  - *Nuqtas.* The new subsystem. In NotoSans, Ruqaa, Kufi2 and Qahiri a dot is
    its own zero-advance glyph — the very glyph `findDiacriticGlyphIndices`'
    allowance gate exists to *exclude*, so it must not be armed through that
    path. In every other font the dots are contours inside the letter's
    outline and need splitting out, so identifying a dot from its outline is
    the real work. Start from `docs/archive/nuqta-measurements.md` (per-font
    dot size, verified) and `scripts/measureNuqta.py` (modal-contour sweep)
    rather than re-measuring. Moving a dot is a translate only — no scale, per
    [removed-subsystems.md](removed-subsystems.md).
