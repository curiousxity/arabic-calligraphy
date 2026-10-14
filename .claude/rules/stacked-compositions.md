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

**The floor is a fraction of the join's own stroke** (`joinFloor`):
`minFraction × min(|vA × t̂A|, |vB × t̂B|)`, the thinner face's thickness
across its own stroke. It used to be `minFraction × nib.width` (one nuqta),
which in six bundled fonts (NotoSans, Kufi, Qahiri, Rabat, RanaKufi, Urdu)
exceeded the connector itself: every moved join bulged in the middle, and
an untouched one grew zero-area spikes. `NIB_FLOOR_RATIO` was measured as
stem / connector, so applying it to the face is the first correct use of it.
`nib.width` is provenance only; nothing reads it. The identity test pins this
with the real per-font nib (no point added over a zero floor).

**A join bends in two dimensions: `bow` and `depth`.** `joinCenterline`'s
handles are `h0 = chord/3·(1 + depth + bow)` and `h1 = chord/3·(1 + depth −
bow)`, each floored at `0.05·chord` (`joinHandles`). The curve's midpoint is
the chord's centre plus `(3/8)(h0·t̂A + h1·t̂B)`, so on an S (opposed
tangents) only the difference — `bow` — moves it, and on a U (parallel
tangents, a cap swung back under its body) only the sum — `depth` — does.
Either parameter alone covers one of the two; the first model (symmetric
scale) could not swing an S, and the second (asymmetry only) fixed every U at
chord/4 deep. `depth` is optional; old saves read as 0.

**The bow handle is a 2-D target.** It sits at the cubic's midpoint, and a
drag solves `(3/8)[t̂A t̂B]·Δh = Δpointer` by ridge-regularised least squares
(`solveJoinDrag`, dimensionless ridge 1e-2, ~3.4% lag on an S; no handle moves more than 3× the pointer, so a join a few degrees off an exact S or U cannot run away) from the
handle lengths at the press, then converts back to `(bow, depth)`. The
handle therefore follows the pointer along every direction the two tangents
can reach and ignores the rest: on an exact S or U the midpoint can only move
along the tangent, never along the chord. The baseline is the pointer at
**mousedown**, not dragstart: Konva starts a drag a few px into the move, and
measuring from there left the handle ~3 px behind for the whole gesture.
Double-click resets both to 0, the tangent-matched default (not a straight
line).

**A hairpin must not pinch.** Swing a piece so its face points away from
its partner (the ح lifted up and left of a ر whose face still looks right)
and the tangent-matched cubic has to overshoot and hook back — a hairpin
whose apex turns tighter than half the stroke. Three things in `joinEdges`
keep that from drawing as a twist: the curve is sampled at `samples` even
steps *plus* every gap it turns through more than `MAX_TURN` (halved up to
`MAX_SPLIT` times), so the apex is never between two samples; rungs stand on
the curve's own tangent, not the polyline's; and `clipRungs` snaps the inner
end of a rung to where it crosses the rung before, so no rung-to-rung quad
sweeps backwards — a backwards sweep cancels the ink it overlaps under
nonzero fill, which is what the pinch (and the white crescent behind it)
was. Backwards is judged on the *across* component only (`half`): where the
nib lies along the stroke the drawn rungs are long needles that cross one
another at a grazing angle on any bend, and clipping those notches the band
instead. `clipFolds` then cuts the zigzag those needles leave on an edge.
The ribbon may still overlap itself — ink over ink is the correct result
when the legs of a hairpin are closer than the stroke is wide. The test
probes the spine, not the width: with the nib slanted along the stroke the
across thickness on the inside of a bend is below the floor by the model.

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

**A letter's own dots, hamza and kaf stroke are riders too.** `convertRunToStack` splits them out of the letter's commands before any cut, at their moved position (`d<index>-<k>` ids, `role: "mark"`, `parentId` the letter), so the join sweep runs on the body only — see [detached-marks.md](detached-marks.md). That is why Amiri's مصبح joins all three pairs now where it joined one.

**The piece transform rotates about a stored `pivot`**, the outline centre
at creation. `rebasePiece` recomputes it after a split so nothing moves.

**Drag chains.** `chainOf` returns the piece, its marks and — unless Alt —
every piece later in reading order with their marks. A chain move is a
translation only.

**The zone sweep runs only while "Split strokes" is armed** — fifteen
rotations per piece is too much for every render.

**Hover is held near the tilt handle.** Letters overlap in a stack, so the
way to a piece's tilt handle often crosses a neighbour's polygon: while the
pointer is within 12 px of the current handle, entering another piece does
not take the hover.

**Fallback joins.** Where no zone sits at a join, the convert handler
inserts a tatweel at that slot and converts again, **only when the shapable
text equals the block text** (cluster offsets index the shapable text) **and
the block has no diacritic overrides** (keyed by glyph index, which an
insertion shifts). The retry is kept only if fewer pairs stay unjoined, and
only the tatweels at slots that became joined survive: a partial win re-runs
from the block's own text with just those slots. The status says how many
were inserted, since the word gets wider (the default font, FatemiMaqala,
takes this path on مصبح). Otherwise the pair stays unjoined and rigid.

**Convert refuses** warp, italic or faux bold (neither is carried: the stack
draws the font's own outline), honorific glyphs, and verse lines. A left- or
right-aligned block is offset so its anchored edge stays put; the stack
itself always centres its ink on (x, y).

**Old builds** render nothing for a `stack` block (CanvasStage's
fallthrough returns `null`); they do not crash.

Deferred: bending letter bodies (skeleton + nib) and font-side stacking
alternates — see [deferred-features.md](deferred-features.md).
