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

**Shift-drag on a join grows its radius** (`radiusEnds`, `radiusFactor`,
`radiusOffset`, `stackOutline.ts`). It changes no join field: one end stays,
and the other end's piece is *translated* by `(k − 1)(free − fixed)` between
the face midpoints. With no rotation the tangents are unchanged, and both
handles are proportional to the chord (the 0.05 floor too), so the cubic is
an exact copy scaled by `k` about the fixed end while the faces — the pen —
keep their size (the test pins every control point). The rider end moves (a
freed curve's far fragment rides on its body); between two letters the later
one moves with `chainOf`'s carry, so Alt and "Move letters together" mean
what they mean for a body drag. Either way everything *joined* beyond the
moving end (through any other join, plus riders) comes along: freeing ح's
hook in Amiri's نحن leaves the far fragment joined to the final ن, and moving
that fragment alone stretched the ح–ن join instead of growing the hook. `k` is the pointer's travel along fixed →
curve midpoint over that distance, clamped 0.2–5; sideways travel does
nothing. A rotation would turn the tangents and change the shape, which is
why this is not a scale about the curve's own centre. Double-click resets the
bend only; undo restores the radius.

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

**A curve becomes a join** (`bendCurveAt`, `stackConvert.ts`; tracer in
`stackCurve.ts`, pure). Hovering a letter outlines the apex third of each
curved stroke `curveRegions` finds (seeded along the outline, deduped by
shared samples, cached per `cmds`); pressing there frees the curve and the
same drag bends it. The tracer (`traceCurve`) takes the nearest edge, casts
across to the other edge (whichever of the edge's direction or its
perpendicular gives the thinner cast — near a stroke's end the nearest
edge is the cap), and walks both ways re-centring every quarter thickness.
It stops at a thickness outside 0.35–3.0× the seed or a 40% jump between
steps (a Diwani bowl swells 63→223 units along one stroke; the spec's
0.6–1.6 window traced nothing in UKIJ Diwani), a *sustained* reversal of
0.12 rad (one opposite step is flattening jitter), a straight run longer
than a thickness, a face, or 3 em; a trace is trimmed to π of turn around
the press (one cubic cannot follow more). The two cuts sit half a thickness
in from the ends and are **windowed** (`splitAtCut`'s optional `window`:
crossings farther than a thickness from the stroke's centre in the cut's
frame are ignored) — the infinite line perpendicular to a U's arm also
crosses its other arm. `bendCurveAt` takes the hover's `CurveTrace` (a bare
press re-traces), cuts twice with `splitPieceAtCut`, drops the fragment
holding the trace's middle and the joins the splits made to it, rides the
far fragment on the body, swaps the piece *id* off the arc when the arc was
the largest fragment (ids and join refs only — never `parentId`s, which
name the body and must keep doing so; whatever rode on the arc is
re-parented to the body), and orients the far face to the body face's side
of travel. Because a bend deletes a piece, `splitPieceAtCut` numbers a new
cap one past the highest number ever used, not by count; and it hands an
existing face to the fragment whose *outline carries it*, not to the side of
the infinite cut line (which, windowed, runs through a U's other arm), and
a windowed `splitAtCut` places an uncrossed contour by containment. Reset
layout and the arranger return every join to `rest ?? {0, 0}`. The join's `rest` bend is three Gauss–Newton steps of
`solveJoinDrag` toward the traced midpoint; its `profile` is the traced
width over the faces' interpolated thickness, read in the join's direction.
**A profile sets the drawn width outright** (`joinEdges`: profile × the
faces' interpolated thickness, square across the travel, keeping the rung's
sense) — the pen model's interpolated cross-section passes through zero on
a U, and a rung flipped against its neighbours twists the ribbon into a
figure-eight (both found by the gate's identity numbers). Double-click on
any join returns to `rest ?? {0, 0}`. The overlay's curve layer sits above
the body and below the cut spans; the bend is a `.stackbend` stage listener
reading joins through refs synced in an effect. Gate (`scripts/
measureCurves.mjs`): 331/346 curves across 23 fonts free with identity
under 5%; Amiri 16/16, UKIJ Diwani 11/11; numbers in the spec.

**A letter's own dots, hamza and kaf stroke are riders too.** `convertRunToStack` splits them out of the letter's commands before any cut, at their moved position (`d<index>-<k>` ids, `role: "mark"`, `parentId` the letter), so the join sweep runs on the body only — see [detached-marks.md](detached-marks.md). That is why Amiri's مصبح joins all three pairs now where it joined one.

**The piece transform rotates about a stored `pivot`**, the outline centre
at creation. `rebasePiece` recomputes it after a split so nothing moves.

**Drag chains.** `chainOf` returns the piece, its marks and — unless Alt —
every piece later in reading order with their marks. A chain move is a
translation only.

**The editing chrome has no modes and no handles** (since 2026-10-15; the
"Split strokes" checkbox and the purple/orange/green dots went). Whatever
the pointer is over gets a thin outline in the ink's complement
(`complementColor.ts`) and a drag there does the one thing that place
means: ink moves, the band just outside ink tilts, a join curve bends, the
free end of a straight stroke cuts on press and pulls the tail in the same
drag. **Z-order is the dispatch** in `StackEditOverlay`: tilt rings lowest,
then join hit curves, then body polygons, then the hovered letter's cut
spans — so ink always wins over the ring, and a cut span wins over the
body. All chrome strokes use `strokeScaleEnabled={false}` so the ring and
the outline are constant screen px at any zoom without the overlay knowing
the stage scale. Nothing is drawn at rest, so a selected composition looks
like its export.

**A tail pull is not a Konva drag.** The press splits the piece
(`onSplit` returns the cap), which replaces the body's `cmds`, which
unmounts the span that was pressed — a node drag would die with it. The
overlay instead listens on the stage under a `.stackpull` namespace and
sets the cap's position absolutely each frame; hover is frozen on the cap
until release. `splitStackPiece` pushes history, so the cut and the pull
are one undo step and the press must not call `onBegin`.

**A stretch can be healed or slid** (`stretchCut`, `stretchOf`,
`healStretch`/`healTail`, `beginCutSlide`, `slideCutTo`, `stackConvert.ts`).
A *stretch* is a plain join (no `profile`, not `fallback`) between two
pieces of one letter (same `parentId` root) whose faces are the same line —
which they are, because a split never moves `cmds`: every fragment of a
letter shares its local frame and only `pivot`/`x`/`y` differ. That is the
whole trick: `mergeAtFace` drops each side's straight bridge edge and joins
the two runs, giving the letter's own outline back (the crossing segments
stay split in two; harmless). **Inner and outer are a distance, not
`parentId`**: pull a tail twice from its middle and the chain is body →
middle (rides on the tip) → tip, so `stretchCut` counts joins from the root
through the letter's own pieces. Heal keeps the *inner* piece's id and
placement (the tail snaps back), takes the outer's other faces and riders,
and inherits the outer's parent if the inner rode on it. A freed curve's join
is not a stretch: its arc is gone. **Slide** heals once at the press
(`beginCutSlide`, fixed for the drag so the curve segments are not split
again every frame), finds the straight zone of the healed outline that holds
the cut (no zone, no slide), and each frame re-splits at the new x with the
inner face's angle (so the inner piece is the near side). Both pieces keep
their own transforms (`rebasePiece` preserves the local→world map), so the
tail's tip stays put and every face keeps its index: no join changes.
**Delete** over a tail (hover, or its cut edge) is a *capture-phase* window
listener that stops the event, or the app's Delete would delete the block;
right-click does the same through Konva's `contextmenu`. The cut edge band
(`stack-cutedge`) sits above the body polygons and below the curve apexes.

**Where a press cuts** is the press's x in the zone's frame
(`cutAtPress`, `stackZones.ts`), clamped a little inside the zone. Only
the outer part of a zone's two ends is a pull target (`pullSpans`: 40% of
the zone or two thicknesses, whichever is longer, never more than half);
the middle moves the letter — on a lam the stem is most of the ink, and
"press on the stroke" has to mean one thing. An end beside a join is
offered too: a first version refused any end with a face within a
thickness of it, and that left UKIJ Diwani's مصبح with nothing to pull,
because its only straight runs *are* the connector stubs and their
height exceeds their length. **A span is offered only if it will split**:
zone legality is a stroke-cut notion (an even crossing count), but
`splitAtCut` needs one contour crossed exactly twice, so each span is
probed at both clamped ends and its middle (`spanProbes`) before it is
drawn — the old dots had the same dead spots, they just clicked to
nothing. The zone sweep (fifteen rotations) runs for the hovered letter
only, cached per `cmds`. The span's hit area carries 3 screen px of slack
(`CUT_SLACK_PX`): Chrome rounds mouse positions to whole px while pointer
events keep fractions, and a thin stroke's span can sit between the two.

**Fill a guide shape** (`arrangeStackInShape`, `stackArrange.ts`, pure)
arranges the letters inside a closed guide chosen in the Stack panel: the
guide's `containerPolygon` in px, the pieces in font units, and the scale
between them found by bisection to the largest at which everything fits.
Rows run **bottom to top in reading order, right to left within a row**,
the way a stacked name climbs; the first letter sits bottom-right. A letter
and its riders (`letterGroups`: marks, split-off caps) move as one, measured
as one, so a dot above a letter makes its row taller. A row takes letters
while their widths plus a gap fit the shape's span over the row's band
(`bandSpan`: the widest chord of each sampled scanline, intersected, both
ends of the band sampled so a box's corners sit inside a curved edge); the
band is searched afresh whenever the row grows taller, creeping up from the
cursor. Rows are then spread over the shape's height with equal margins,
each lifted only as far as its band still takes it and never past the row
above. **Within a row of three or more, the outer letters hug the shape**:
each is measured against its *own* band (`ownSpan`; the row's union band is
narrowed by a tall neighbour), nudged up or down by up to a quarter of its
height to where that band is widest (`nudge`), and **leaned toward the
edge** (`edgeLean`, clamped to `MAX_TILT` = 30°). The lean's room is
reserved, not hoped for (`leanIntoEdge`): the letter's *rotated* bounds sit
one gap inside the chord over their own band, the letter is lifted by the
overhang a leaning box has below its row bottom, and a tilt is accepted only
if that extra height fits the headroom to the row above — else halved, down
to upright. At the bisection's tight fit this means small tilts; it never
means a letter outside the shape. Inner letters share the remaining width
equally and stay upright; `pack` reserves the two edge gaps any row of two
or more uses (`rowNeed`). A row of two leans both letters the same way, then
draws them toward the centre until they are at most one em apart; one alone
is centred upright. **`arrangeAt` then checks the layout as placed**: no
two groups' rotated extents may overlap (hugging, nudging and leaning each
move a letter after the row was measured, and a first version overlapped
letters in half of all curved guides), so the bisection shrinks until the
arrangement is clear. A rider turns with its letter about the letter's
pivot, and carries the letter's rotation; on the next run `unswing` puts a
rider that carries its letter's rotation back to the upright frame before
grouping, or the dot would walk away from its letter on every Fill (a rider
the user rotated alone keeps its own angle and is left as it is). Letters
in a row keep their original vertical relation (their baseline) apart from
the nudge. Inner tilt goes to 0 and every join back to its tangent-matched
default, so the result is an arrangement, not a design: the user drags,
tilts and bends from there. `homeX`/`homeY` are untouched, so
Reset layout still returns to the conversion. The block moves onto the
guide (x, y, rotation) and takes the fitted `fontSize`, one history step.
The guide never moves a piece afterwards. Tunables are fractions of an em
at the top of the module.

**Fillers** (`fillGaps`): when the panel's "Fill gaps with tashkeel" is on,
`App.tsx` loads the block's font through the cached `shapeText` and passes
`fillerShapes` (`stackConvert.ts`: the font's fatha, kasra, shadda, damma,
sukun, tanwin, star and dot, or a nib-width `teardropShape` when fewer than
two exist — Qahiri and RanaKufi; also the fallback when the font fails to
load). After letters are final the shape is scanned on a `FILLER_CELL`
grid (0.2 em), bottom row first, right to left; each cell tries the
candidates in a rotation starting at the cell index, at natural size then
`FILLER_SHRINK`, and accepts the first whose `FILLER_GAP`-padded box (0.03
em) has its corners, edge midpoints and centre inside the shape, meets no
ink (no probe inside a flattened piece contour *and* no contour vertex
inside the box — five probes alone let a letter's corner poke in), and
overlaps no placed filler. The cell and gap were tuned down from 0.33/0.06
because a padded dot could not enter the gutters of a composition whose
letters are as wide as the shape. A filler is `role: "mark"` with no
parent and `filler: true`: it drags alone, has no ring or cut spans,
exports with the outline, and is **stripped** by the arranger, the handler
and Reset layout, so it never accumulates. The preference is `App.tsx`
state like "Move letters together", neither saved nor undoable. The
handler is async: it loads the font first (`arrangeStackInGuide`, which
reads only the block's source), then arranges and commits through a ref to
the latest render's `arrangeStackNow`, so the arrange sees current blocks
and pushes a current history snapshot; a block that changed or vanished
during the load, or an arrange that throws, ends in a status message.

**Stems** (`pullStemEnds`, after tilt, before fillers; `pullStems: true`
from the handler): each letter's straight zones are found once with
`stackDetectOpts` (both sweep bases, aspect floor on the added base); a
zone's end that splits (`spanProbes`) and has no face within a thickness is
a free end. A long zone is cut at the inner edge of its end's pull span; a
short one — under four thicknesses, where `pullSpans` offers one span, and
an Amiri alif is 3.7 — is cut at its middle, and the cap is kept only if it
lands on the end's side (`splitPieceAtCut` picks the smaller fragment).
At the found scale the cap is marched along the stem's axis in `STEM_STEP`
steps until its `LETTER_GAP`-padded box would leave the shape or meet other
ink (`boxMeetsInk`, shared with the filler pass: nine probes *and* any
contour vertex inside the box, so a dot thinner than the probe spacing still
stops it); under `STEM_MIN` the cut is dropped. A letter that already has a
cap is **slid** instead, along the vector between its two faces or — after
Reset, when the faces coincide — along the body face's normal pointed away
from the body (`capSlideAxis`; a face is the stroke's cross-section), so re-runs never cut a letter
twice and a hand-pulled cap is the same thing (a lengthened letter makes its
row taller, so the block re-sizes and other letters may find room on the
next run; a third run changes nothing). One pull per letter per run.
**Font-dependent by design**: the detector wants even thickness, so Amiri
and FatemiMaqala stems pull while both Diwani faces and Thuluth taper and
are left alone (`stackConvert.test.ts` pins this); loosening the tolerance
needs a measurement script first (stroke-cuts.md). A stem that hugs the
edge often has no headroom and stays put. `splitPieceAtCut` is imported
from `stackConvert.ts` (harfbuzz-free) rather than moved: `rebasePiece`
lives in `stackOutline.ts`, which imports `stackGeometry.ts`. Reset returns
caps to the cut (`rebasePiece` keeps a cap's home at the letter's).

**"Move letters together"** is `App.tsx` state, not a block field: it is a
preference about the next drag, not part of the design, so it is neither
saved nor undoable. Alt still moves a letter alone while it is on.

**Fallback joins.** Where no zone sits at a join, the convert handler
inserts a tatweel at that slot and converts again, **only when the shapable
text equals the block text** (cluster offsets index the shapable text) **and
the block has no diacritic overrides** (keyed by glyph index, which an
insertion shifts). The retry is kept only if fewer pairs stay unjoined, and
only the tatweels at slots that became joined survive: a partial win re-runs
from the block's own text with just those slots. The status says how many
were inserted, since the word gets wider (the default font, FatemiMaqala,
takes this path on مصبح). Otherwise the pair stays unjoined and rigid.

**Convert refuses** italic or faux bold (neither is carried: the stack
draws the font's own outline), honorific glyphs, and verse lines. A left- or
right-aligned block is offset so its anchored edge stays put; the stack
itself always centres its ink on (x, y).

**Old builds** render nothing for a `stack` block (CanvasStage's
fallthrough returns `null`); they do not crash.

Deferred: bending a *whole* letter body (skeleton + nib) and font-side
stacking alternates — see [deferred-features.md](deferred-features.md).
Curved strokes bend by becoming joins (above).
