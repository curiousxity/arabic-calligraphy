---
paths:
  - "src/lib/stack*.ts"
  - "src/components/StackView.tsx"
  - "src/components/StackEditOverlay.tsx"
  - "src/components/sidebar/StackPanel.tsx"
  - "e2e/stack.spec.ts"
---

# Stacked compositions (`stack` blocks)

A text block baked into rigid letter pieces joined by synthesised curves.
Design: `docs/superpowers/specs/2026-10-14-stacked-compositions-design.md`;
plan: `docs/superpowers/plans/2026-10-14-stacked-compositions.md`.

**It is a bake, and that is the point.** Nothing on the block is keyed by
text offset, cluster or glyph id, so none of the live-text machinery
(kashida remaps, `glyphId` checksums, Fit to width, Next Shape, diacritic
overrides, stroke cuts) applies — `blockCapabilities.ts` says so. The
spelling cannot be edited; undo restores the text block. Convert *after*
choosing letter shapes and spacing.

**Geometry is in font units, y-down, scaled by `stackScale(fontSize,
unitsPerEm)` at draw time.** `unitsPerEm` is stored on the block because
the font may be gone later (custom fonts). A save without it draws at 1000.

**The face vector is the nib.** A cut's two outline points are the pen's
cross-section; a join's edges are the centerline ± half a vector
interpolated between its two faces, so the stroke thins where the curve
runs along the pen and is full width across it. No per-font nib angle
exists or is needed. `nib.minFraction` floors the perpendicular thickness,
never at the two ends — the ends must land on the faces exactly or the
seam shows.

**Bow is asymmetry.** `joinCenterline`'s two handle lengths are `chord/3·(1±bow)`; scaling both together never moves an S-curve's midpoint, so a symmetric bow had no visible effect. The bow handle drags along the leaving tangent.

**The floor is the pen's slant**: a face vector is the stroke's perpendicular
cross-section, so on a 90° climb the model would thin to nothing; a real reed
held at ~45° draws a vertical stroke nearly as heavy as a horizontal one.
`nibFloorFraction` in `nuqta.ts` holds the measured vertical/horizontal ratio
per font (`scripts/measureNibFloor.mjs`); 0.5 is only the fallback.

**A join is a splice, not a second shape.** `spliceJoin` finds each face's
straight bridge edge (left by `splitAtCut`), removes both, and threads the
two edges between the contours, producing one contour. That is why
outlines, shadows and SVG export are seam-free. Bridges are matched by
point equality after the same transform is applied to commands and faces;
keep `transformCmds` and `transformFace` arithmetically identical.

**Near is left is later.** HarfBuzz's RTL glyph array is in visual order
(index 0 leftmost = last in text). `splitAtCut`'s *near* side (x < cut in
the stroke's frame) is visually left, which is the **later** letter in
reading order. `convertRunToStack` relies on this when handing fragments
to pieces.

**A tail is a split plus a join, and the end cap is a rider.** `splitPieceAtCut` makes the smaller fragment an end cap: `role: "letter"` (it keeps a tilt handle), `parentId` = the body, same `order`. `chainOf` treats any piece with a `parentId` as a rider — it moves with its body, is draggable alone, and never drags anything else. Neither side of the cut is "the tail"; size decides. Cap ids are `<body>t<n>` with a monotonic `n` (relies on pieces never being deleted).

**The piece transform rotates about a stored `pivot`**, the outline centre
at creation. `rebasePiece` recomputes it after a split so nothing moves.

**Drag chains.** `chainOf` returns the piece, its marks and — unless Alt —
every piece later in reading order with their marks. A chain move is a
translation only.

**The zone sweep runs only while "Split strokes" is armed** — fifteen
rotations per piece is too much for every render.

**Fallback joins.** Where no zone sits at a join, the convert handler
inserts a tatweel at that slot and converts again, **only when the shapable
text equals the block text** (cluster offsets index the shapable text).
Otherwise the pair stays unjoined and rigid.

**Old builds** render nothing for a `stack` block (CanvasStage's
fallthrough returns `null`); they do not crash.

Deferred: bending letter bodies (skeleton + nib) and font-side stacking
alternates — see [deferred-features.md](deferred-features.md).
