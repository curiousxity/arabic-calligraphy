# Bending curved strokes: a curve becomes a join

**Date:** 2026-10-15
**Status:** approved in conversation; implementation to be planned
**Builds on:** `docs/superpowers/specs/2026-10-14-stacked-compositions-design.md`
(joins, cut faces, tail pulls) and `.claude/rules/stacked-compositions.md`.
Closes the "widening the radius of a curved stroke" item recorded under
*Bending letter bodies* in `.claude/rules/deferred-features.md`.

## Problem

A stack block's letters are rigid outlines. Joins and pulled tails bend
because they are synthesised: a pen cross-section (the cut face) swept along
a cubic. A bowl drawn by the font — the turn of a ن, the hook of a ح, the
sweep of a ر — has only an outline, no spine, so there is nothing to bend
and no way to widen or tighten its radius. The user asked for "a way to
neatly increase the radius of the curve for letters that have a curve".

## Decision

**A curved stroke becomes bendable by becoming a join.** Pressing a bowl
traces the stroke's centerline and width through its outline, cuts the
stroke at both ends of the turn, drops the arc between, and puts a join
between the two new faces. The join is fitted so that, untouched, it
reproduces the original arc closely, and its width follows the arc's own
profile. After that it is an ordinary join: the existing bow/depth drag
(`solveJoinDrag`), thickness floor (`joinFloor`), hairpin guards and
seamless splice all apply, and undo restores the letter.

Rejected: skeletonising whole letters (Approach C proper — a nib-and-spine
model for every glyph of every font; Diwani's overlapping, variable-width
forms are where skeletons fail), and a circle-fit "radius" join kind (a
subset of this design: the depth drag already widens a U, and a cubic can
also become an S).

The risk is concentrated in one pure function, the tracer. It is measured
on the bundled fonts **before** the rest is built, with a go/no-go gate.

## Gesture (no modes, no handles)

Hovering a letter outlines, in the ink's complement, the **apex third** of
each curve the tracer finds in it — the same way the free ends of straight
strokes are outlined today (`cutSpans`). Pressing there converts the curve
and the same drag bends it (as a tail pull cuts on press and pulls in the
same drag). The rest of the letter's ink still moves the letter. Afterwards
the curve is an ordinary join: drag to bend, double-click to return it to
its **rest** bend (the fitted shape), not to straight. The curve regions
are computed for the hovered letter only, cached per `cmds`, like the zone
sweep.

## The tracer (`src/lib/stackCurve.ts`, pure, never imports `./harfbuzz`)

```ts
export type CurveTrace = {
  /** Centerline samples, piece-local font units, in stroke order. */
  centre: Pt[];
  /** Stroke thickness at each sample. */
  thickness: number[];
  /** The two cuts that free the arc, in `splitAtCut`'s terms (cut line
   *  perpendicular to the stroke, `angle` = stroke direction there). */
  cuts: [{ cutX: number; angle: number }, { cutX: number; angle: number }];
  /** Parameter 0..1 of the press along the trace, for the apex region. */
  pressT: number;
};
export function traceCurve(cmds: SvgCmd[], press: Pt, opts?: TraceOpts): CurveTrace | null;
export function curveRegions(cmds: SvgCmd[], opts?: TraceOpts): CurveRegion[];
```

Algorithm, on `flattenContours(cmds)`:

1. **Seed.** Nearest outline point `A` to the press, with its edge direction
   `d`. Cast from `A` along the inward normal (the side on which a point a
   hair inside is `pointInPolygon`) to the first crossing `B` with the
   outline. Thickness `|AB|`, centre `(A+B)/2`, tangent `d` oriented so the
   walk goes forward.
2. **Walk**, in both directions from the seed, by steps of
   `step = thickness / 4`: move the centre along the tangent, cast along
   ±normal to both edges, re-centre, re-measure thickness, take the new
   tangent from the last two centres. Turning per step (signed angle
   between successive tangents) is recorded.
3. **Stop** a direction when any of: the cast misses or hits at more than
   `1 + thicknessTolerance` (0.12, the detector's) of the seed thickness
   (a junction, a swell into a bowl's belly is allowed up to 1.6× — see
   gate); the centre leaves the ink; a **face** of the piece lies within a
   thickness (an existing cut); the turning changes sign (an inflection);
   the stroke has run **straight for more than one thickness** (the turn is
   over; the cut goes where the straight run began); or the walk exceeds 3
   em. A stroke terminal (the cast ahead misses) ends the trace at the last
   good sample.
4. **Cuts** at the two ends, pulled inward by half a thickness so the cut
   never grazes a terminal or a junction; `angle` = the local tangent,
   `cutX` = the centre's projection in that frame. Each cut is checked with
   `splitAtCut` (one contour crossed exactly twice) and the trace is
   rejected if either fails.
5. **Apex region**: the middle third of the trace's samples, each widened to
   the local thickness, as a polygon for the overlay's hit area.

`curveRegions` seeds the walk from points spaced one thickness apart along
every outline edge, keeps traces whose total turn exceeds `MIN_TURN` (45°)
and whose length exceeds 1.5 thicknesses, and dedupes traces that share
samples (keeps the longest). This is what the hover shows.

## Conversion (`bendCurveAt`, `src/lib/stackConvert.ts`, beside `splitPieceAtCut`)

```ts
export function bendCurveAt(
  pieces: readonly StackPiece[], joins: readonly StackJoin[], pieceId: string, press: Pt
): { pieces: StackPiece[]; joins: StackJoin[]; joinId: string } | null;
```

1. `traceCurve(piece.cmds, press)`; null → null.
2. First cut with `splitPieceAtCut` (body keeps the id; the far side is a
   cap riding on it). Second cut on **whichever fragment contains the
   trace's other end** (decided by the end centre's side of the first cut).
   Of the three fragments the one holding the trace's middle sample is the
   **arc**; it is removed, along with the join `splitPieceAtCut` made to it.
   The remaining far fragment stays a rider (`parentId` = body, same
   `order`), as a pulled tail is.
3. One join from the body's new face to the far fragment's new face, id
   `j<body>-<far>c<n>`, `bow`/`depth` solved with `solveJoinDrag` from (0, 0)
   so the cubic's midpoint lands on the trace's middle sample (the drag
   solver is exactly this least-squares step), `rest: { bow, depth }`, and
   `profile` = the trace's thickness at 16 even parameters divided by the
   linear interpolation of the two face thicknesses (`faceThickness`).
4. Faces of the body and far fragment are those `splitPieceAtCut` produced;
   the tangents are the stroke's own at each cut, so the default cubic
   leaves and arrives along the stroke.

## Data model

`StackJoin` gains two optional fields; old saves read unchanged:

```ts
  /** Width multipliers at even parameters along the curve, 1 = the linear
   *  interpolation of the two faces. Absent = linear (every join today). */
  profile?: number[];
  /** The bend double-click returns to. Absent = { bow: 0, depth: 0 }. A
   *  curve converted from a letter rests at the bend that reproduces it. */
  rest?: { bow: number; depth: number };
```

`joinEdges` gains an optional `profile` and scales each rung's across
component by the interpolated multiplier before the floor is applied (the
floor stays the thinner face's fraction; a profile below 1 can thin to the
floor, never under it). The ends are never scaled (multiplier 1 at t = 0
and t = 1 by construction) so the seam stays exact. `assembleStackOutline`
and the overlay's `joinGeom` pass `j.profile`.

## Overlay and App

- `StackEditOverlay`: a new hover kind `curve` and a new hit layer of
  `curveRegions` polygons for the hovered letter, mounted **between the
  body polygons and the cut spans** in z-order (a cut span still wins over
  everything; a curve wins over the body). Press → `onBendCurve(pieceId,
  pressLocal)` returns the new join id → the overlay seeds `bowStart` for
  that join from the press and continues as a join drag (the join's hit
  node mounts on the next render; like a tail pull, the drag is a stage
  listener under `.stackbend`, not a node drag). Double-click on a join
  returns to `j.rest ?? { bow: 0, depth: 0 }`.
- `App.tsx`: `bendStackCurve(blockId, pieceId, press)` pushes history,
  applies `bendCurveAt`, returns the join id (mirrors `splitStackPiece`).
  Status: "Curve freed; drag to bend, double-click to restore."
- Capabilities: nothing new in `blockCapabilities.ts` (stack-only).

## Evidence gate (first task)

`scripts/measureCurves.mjs`: for each bundled font, shape الملك, مصبح, نحن,
حرف with the test helpers' real shaping, convert with `convertRunToStack`,
and for every letter piece run `curveRegions`. Report per font: curves
found per letter, mean total turn, and — the gate — for each found curve,
whether `bendCurveAt` at the apex succeeds and the identity error
(outline area of the converted block vs the original) is under 5%.

**Go** if UKIJ Diwani and Amiri both free at least one curve per word with
identity error under 5% and no trace crosses into another stroke (checked
by the thickness-jump stop and by the arc fragment having exactly one
contour). **No-go** records the numbers in the spec and stops at the
tracer, as stroke-cuts.md's detector history did.

### Measured 2026-10-15 (tracer, before conversion)

`scripts/measureCurves.mjs`, words الملك مصبح نحن حرف, tracer window
0.35–3.0× seed thickness, 40% per-step jump, inflection = 0.12 rad
sustained reversal (the spec's 0.6–1.6 window traced 0 of 66 seeds on the
UKIJ Diwani ن; see the plan's ledger rulings).

| Font | letters | curves | per letter | mean turn |
|---|---|---|---|---|
| UKIJ Diwani | 15 | 13 | 0.87 | 109° |
| HarfCanvas Diwani | 15 | 13 | 0.87 | 97° |
| Amiri | 15 | 16 | 1.07 | 94° |
| FatemiMaqala | 12 | 16 | 1.33 | 105° |
| Thuluth | 13 | 20 | 1.54 | 79° |
| Ruqaa | 15 | 11 | 0.73 | 121° |
| Kufi | 15 | 8 | 0.53 | 129° |
| Qahiri | 16 | 5 | 0.31 | 95° |

(Full table of 23 fonts in the script's output.) **Tracer: GO** — both
gate fonts find roughly one curve per letter.

### Measured 2026-10-15 (conversion, `bendCurveAt` on the hover's trace)

| Font | curves | freed | identity < 5% |
|---|---|---|---|
| UKIJ Diwani | 11 | 11 | 11 |
| HarfCanvas Diwani | 15 | 14 | 13 |
| Amiri | 16 | 16 | 16 |
| FatemiMaqala | 19 | 19 | 19 |
| Thuluth | 17 | 17 | 17 |
| Ruqaa | 11 | 11 | 11 |
| Scheherazade | 22 | 22 | 22 |
| ThuluthDeco | 57 | 52 | 49 |
| Wessam | 20 | 18 | 16 |

Across all 23 fonts, 331 of 346 curves free and 325 hold identity under
5%; the worst error on a gate font is 0.9%. **Conversion: GO.** After the
branch review (same day) the script also counts dangling `parentId`s and
faces off their own piece's outline — both read 0 for every font, where
before the review's fixes 21 fonts had dangling parents (83 id swaps of
331 frees) and 9 fonts had misplaced faces; frees rose to 334 of 346. Three
things had to change from the first design to get here (each a ledger
ruling in the plan): the profile sets the drawn width outright rather
than scaling the pen model (whose interpolated cross-section vanishes on
a U), the cut is a bounded segment rather than an infinite line (a U's
other arm), and the inflection stop is a sustained reversal rather than
one jittering step.

## Testing

- `stackCurve.test.ts`: `arcBand` (from `strokeCuts.test.ts`, 100–120 radius,
  0.15π–0.85π) traced from its apex: both cuts land within 10 units of the
  band's ends pulled in by half a thickness; thickness samples all within
  2% of 20; total turn ≈ 0.7π. A straight bar: `traceCurve` null (no turn).
  An S (two arcs joined): the trace stops at the inflection. A bowl with a
  stem (arc + bar): the trace stops at the thickness jump. Real glyph
  (`shapeReal`, `convertRunToStack`): Amiri ن has one region; UKIJ Diwani ن
  has at least one.
- `stackJoin.test.ts`: `joinEdges` with a profile peaking at 1.5 draws a
  band whose mid-width is 1.5× the linear one; profile 1 everywhere equals
  today's output bit for bit; a profile of 0.2 never thins under the floor.
- `stackConvert.test.ts`: `bendCurveAt` on `arcBand` glued to two bars:
  three fragments → arc removed, one join with `rest` and a 16-entry
  `profile`, outline area within 5% of the original, bending `depth` by +0.5
  widens the bowl (its outline's bounding height grows), undo-equivalent
  (the input is untouched).
- e2e `stack.spec.ts`: hover a ن in Amiri shows a curve region; press and
  drag it; the join count rises by one and the ink's bounding box changes;
  double-click returns the bounding box to within 2 px.

## Docs

- `.claude/rules/stacked-compositions.md`: a "Curves become joins" paragraph
  (tracer, stops, gate numbers, profile and rest fields, gesture, z-order).
- `.claude/rules/deferred-features.md`: move the curve-radius item to
  shipped (bending a *whole* letter stays deferred).
- `PROGRESS.md`: one dated entry.
- `src/guide/sections/`: one short section for calligraphers.

## Out of scope

- Bending straight strokes (a stem bends only by being cut and joined,
  which the tail pull already does).
- Curves that cross or overlap another stroke of the same letter (the
  thickness-jump stop refuses them).
- Changing the arc's own width model (the profile is sampled, not drawn).
- Live text blocks.
