# Stack arrange: hug the shape, fill the gaps, pull the stems

**Date:** 2026-10-15
**Status:** approved in conversation; implementation planned in three phases
**Builds on:** `docs/superpowers/specs/2026-10-14-stacked-compositions-design.md`
(the stack block, joins, tail pulls) and the "Fill a guide shape" paragraph
of `.claude/rules/stacked-compositions.md` (the current arranger).

## Problem

"Fill a guide shape" (`arrangeStackInShape`, `src/lib/stackArrange.ts`)
packs a stack's letters into a closed guide, but the result reads as rows
of upright boxes inside a silhouette, not as a composition that *is* the
silhouette. Three causes, all in the code:

1. A row is one axis-aligned union box and its width is the shape's
   narrowest chord across that whole band. One tall or dotted letter
   squeezes every letter in the row.
2. Letters never move vertically inside a row and never tilt, so a short
   outer letter cannot drop into a curve and a leaning edge is never
   followed. Every curved edge leaves a crescent of waste.
3. Nothing occupies the gaps between letters and the edge.

The user asked for the result to look more like the provided shape, to
fill the empty space with small characters so it looks busier, to tilt
letters slightly (about 30°), and to lengthen letters with upstrokes.
Increasing the radius of curved strokes was also asked for and is
**deferred to its own spec** (see "Out of scope").

## Decisions

- **Filler vocabulary is tashkeel and ornaments**, not repeated letters:
  fatha, kasra, shadda, damma, sukun, tanwin, the small six-pointed star,
  and a dot. This is how Diwani Jali fills a shape, and a reader never
  tries to read the fill as part of the word.
- **Fillers come from the block's own font**, so they share its pen.
  Probed 2026-10-15 over `public/fonts/`: every bundled font has outlines
  for fatha, damma and kasra; all but Qahiri, RanaKufi and Raqq have sukun
  and shadda; Qahiri and RanaKufi have only hamza-above. A generated
  teardrop built from the nib width is the fallback when a font offers
  fewer than two marks (also covers custom fonts).
- **Fillers are not a new piece role.** A piece with `role: "mark"` and no
  `parentId` already behaves as a filler should everywhere: `chainOf`
  moves it alone and never carries it with a letter; `StackEditOverlay`
  gives it no tilt ring and no cut spans but does give it the hover
  outline and a drag; `letterGroups` ignores it; `assembleStackOutline`
  pools it into the exported outline. One new optional field,
  `filler?: true`, marks it so it can be stripped and never counted as a
  letter.
- **Outer letters tilt toward the edge, capped at 30°.** Inner letters
  and fillers stay upright. The tilt is an ordinary piece `rotation`, so
  the ring adjusts it and undo removes it.
- **Stem lengthening reuses the existing cut-and-pull**, automatically in
  the arranger and still by hand. It is **font-dependent**: the zone
  detector needs a straight run of even thickness, and tapering stems
  (both Diwani fonts, Thuluth) yield nothing. This is stated in the panel
  copy and in the rules note. The detector's tolerance is **not**
  loosened in this work; stroke-cuts.md records why predicates that look
  reasonable on straight strokes go wrong. A measurement script is the
  precondition for any later loosening.
- **The arranger stays pure** and never imports `./harfbuzz`
  (`stackConvert.ts`, `strokeCuts.ts`, `stackGeometry.ts` are all
  harfbuzz-free, verified by grep). Filler outlines are passed in by the
  caller; the arranger only places shapes.
- **Order inside the arranger:** bisection fits rows plus tilt only.
  Stems and fillers are post-passes at the found scale: they consume
  only space the shape already offers, so they cannot change whether the
  letters fit, and they are too costly to run inside 48 bisection steps.
  Tilt before stems (the pull direction is the zone axis rotated by the
  piece), stems before fillers (fillers test against final ink).
- **Three phases**, each shippable and verifiable on its own; the user
  can stop after any. Stems last because the evidence is weakest.

## Evidence

Stem zones on real converted stack pieces (`convertRunToStack` of الملك
and طالب, `findCutZonesSwept` on each letter's `cmds`, once as today and
once with the contours rotated 90°; zone length in units per 1000 em;
30 is the detector's minimum and unusable):

| Font | Usable vertical stem zones |
|---|---|
| Amiri | alif 230, kaf 170 |
| FatemiMaqala | lam 360 and 260, alif-like 130, ta 70 |
| UKIJ Diwani | none (30–50) |
| HarfCanvas Diwani | none (30–50) |
| Thuluth | none (40–50) |

Tashkeel outline availability: see Decisions. The probe scripts were
throwaway (scratchpad), not kept.

## Phase 1 — Hug the silhouette (`stackArrange.ts` only)

**Row membership is unchanged**: letters join a row while their widths
plus gaps fit the shape's span over the row's union band, found by
`bandSpan` as today. This stays conservative so bisection keeps a
monotone "fits / does not fit" answer.

**Placement changes** (`placeRow`):

1. The two outer letters of a row are re-measured against **their own**
   vertical band (`y + box.y1 .. y + box.y2`) rather than the row's, and
   slid outward until their box is `LETTER_GAP` inside that span's edge.
   Inner letters are spread evenly between the two outer letters.
2. Each outer letter then tries a **vertical nudge**: offsets from
   −¼ to +¼ of its own height in a few steps, keeping the offset at which
   its own band's span is widest (ties keep the original). A short letter
   drops into a curve this way; a letter in a flat band does not move.
3. Each outer letter **tilts toward the edge**. The edge's local
   direction on that side is the vector between the chord endpoints at
   the top and bottom of the letter's own band. The letter rotates about
   its stored `pivot` so its vertical axis turns toward that direction,
   clamped to ±30° (`MAX_TILT`). Its rotated bounds (the four box corners
   rotated about the pivot) are re-tested: every corner inside the shape
   (`bandSpan` over the rotated box's band contains its x-range) and no
   overlap with its neighbour's box plus gap. If the test fails the tilt
   is halved, down to zero.
4. `MAX_SPREAD` applies only to rows of one or two letters. Rows of three
   or more hug both edges; the gaps between letters are then whatever the
   span gives.

**Fit check:** `arrangeAt` returns null if any placed group, after nudge
and tilt, has a corner outside the shape. Bisection therefore fits rows
plus tilt.

Letter and group vertical relations within a row (`dys`) still hold for
inner letters; an outer letter's nudge is added on top.

## Phase 2 — Fill the gaps with tashkeel

### Input

`ArrangeInput` gains:

```ts
fillers?: readonly FillerShape[];   // omitted or [] = no filler pass
```

```ts
export type FillerShape = {
  /** Closed contours, font units at the block's unitsPerEm, origin anywhere. */
  cmds: SvgCmd[];
  /** A stable name for ids and tests: "fatha", "shadda", "dot", … */
  name: string;
};
```

### Pass (pure, after letters and stems are final)

1. Build the obstacle set: every letter group's final ink as flattened
   contours in block space (rotated, with riders and any caps).
2. Grid the shape's bounding box with cell size `FILLER_CELL = 0.33 em`.
   Visit cells in reading order (bottom row first, right to left) so
   coverage is even and the result is deterministic.
3. At each cell, try the candidates in a fixed rotation starting at
   `cellIndex % candidates.length` (so neighbours differ), each centred on
   the cell centre, first at natural size then at `FILLER_SHRINK = 0.6`.
4. Accept a candidate when, with its bounding box padded by
   `FILLER_GAP = 0.06 em`:
   - all four padded corners and the centre satisfy the shape test
     (`bandSpan` over the padded box's band contains its x-range), and
   - none of those five points is inside any obstacle contour
     (`pointInPolygon`), and
   - the padded box does not overlap any accepted filler's box.
   The first accepted candidate wins the cell; its box joins the filler
   set. If nothing fits, the cell stays empty.
5. Each accepted filler becomes a piece:

   ```ts
   { id: `f${n}`, cmds (scaled if shrunk, translated so its centre is at the cell), x, y,
     rotation: 0, pivot: cmdsCentre, homeX: x, homeY: y, order: maxLetterOrder,
     role: "mark", filler: true, faces: [] }
   ```

Scaling a filler uniformly is allowed: the no-scaling rule
(removed-subsystems.md) is about letters, whose stroke weight is the
design; an ornament shrunk as a whole keeps its own proportions and is
read as a smaller ornament.

`ArrangeResult` gains `fillers: number`.

### Where the outlines come from (`App.tsx`, `stackConvert.ts`)

- `fillerShapes(font: opentype.Font, upm: number, nibWidth: number): FillerShape[]`
  lives beside `convertRunToStack` in `stackConvert.ts` (already imports
  opentype types, never harfbuzz). It looks up each codepoint in
  `FILLER_MARKS` (U+064E fatha, U+0650 kasra, U+0651 shadda, U+064F damma,
  U+0652 sukun, U+064B/064C/064D tanwin, U+066D star, U+06EC dot) with
  `font.charToGlyph`, keeps those whose path has commands and whose glyph
  index is not 0, and when fewer than two survive appends a generated
  teardrop: a circle of diameter `nibWidth` with a short tail, as a
  cubic path.
- `arrangeStackInGuide` becomes async: it calls the cached
  `shapeText(block.source.text, resolveFontUrl(block.source.fontFamily))`
  to obtain `shaped.font`, builds the shapes, and passes them when the
  "Fill gaps with tashkeel" checkbox is on. A font that fails to load
  falls back to the teardrop alone and the status says so.
- Before arranging, the handler **strips existing fillers**
  (`pieces.filter(p => !p.filler)`) so a re-run never accumulates them.
- `resetStackLayout` also strips fillers: home is the conversion, which
  had none.

### Panel

Under the guide picker in `StackPanel.tsx`: `CheckboxRow` "Fill gaps
with tashkeel", on by default, held as `App.tsx` state next to
`stackMoveTogether` (a preference about the next arrange, neither saved
nor undoable). The explanatory paragraph is updated to mention tilt,
fillers and stems, and that stems are pulled only where a stroke is
straight and even.

Status line: "Arranged N letters in R rows inside the guide, F ornaments
added, S stems lengthened."

## Phase 3 — Lengthen upstrokes

### Sweep extension (`strokeCuts.ts`)

`DetectOpts` gains `baseAngles?: number[]` (default `[0]`).
`findCutZonesSwept` sweeps `base ± k·angleStep` for each base, so a
vertical stem is found with `angle ≈ ±π/2` **already in the glyph's
frame**; `zoneRect`, `cutAtPress`, `spanProbes`, `splitAtCut` and
`pullSpans` work unchanged. `dedupeZones` runs over the union.

The stroke-cut subsystem for live text keeps `[0]`; only the stack
consumers pass `[0, Math.PI / 2]`:

- `StackEditOverlay`'s `cutSpans` (the per-`cmds` cache keeps the
  doubled sweep cheap), so press-and-pull now reaches an alif by hand.
- The arranger, below.

### Automatic pull (`stackArrange.ts`)

`ArrangeInput` gains `pullStems?: boolean` (default false; the handler
passes true).

1. Before bisection, compute each letter's zones once
   (`findCutZonesSwept(flattenContours(letter.cmds), …, {baseAngles:[0, π/2]})`,
   font units, scale-independent). Keep only **free ends**: a `pullSpans`
   end whose outward side has no face of the piece within one thickness,
   and which `spanProbes` confirms `splitAtCut` will split.
2. After placement at the found scale, for each outer letter and each
   free end: the stem's outward direction in block space is the zone axis
   rotated by the piece's rotation, pointing from the body toward the
   end. Keep it only if it points toward the nearest boundary (dot with
   the outward normal of the chord endpoint on that side > 0.5).
3. Cut with `splitAtCut` at the span's clamped outer probe and build the
   cap exactly as `splitPieceAtCut` does — that function is **moved** from
   `stackConvert.ts` into `stackGeometry.ts` (already imported by the
   arranger) so the arranger can call it without pulling in convert
   code; `stackConvert.ts` re-exports it so `App.tsx` and the tests are
   untouched.
4. Pull the cap along the stem axis until its box, padded by
   `LETTER_GAP`, would leave the shape or touch any other group's ink
   (the row above included, by contour test). The join between body and
   cap is appended with `bow: 0`.
5. **Idempotence:** a letter that already has a cap (`parentId` equal to
   the letter, `role: "letter"`) whose join axis points at the boundary
   is **slid** along that axis rather than cut again. A manual cap and an
   arranger cap are therefore the same thing. Caps that do not point at
   the boundary are left where they are.

Reset already un-lengthens: `rebasePiece` keeps a cap's `homeX/homeY`
at the original letter's, so Reset returns caps to where they were cut.

This runs through the arranger's one return value and the handler's one
`updateSelectedBlock`, never through `splitStackPiece` (which pushes its
own history).

## Data model

`StackPiece` gains one optional field:

```ts
/** Placed by "Fill a guide shape" to busy the gaps; stripped on re-run and Reset. */
filler?: true;
```

No legacy-save work: old builds already draw nothing for a stack block,
and an absent `filler` means a normal piece.

## Testing

All in `stackArrange.test.ts` on synthetic rectangles (pure geometry, no
shaping involved, so the real-font rule does not apply) unless noted:

Phase 1
- In an almond, the outer letter of a 3-letter row ends within
  `LETTER_GAP + 1` of the shape's edge at its own band.
- A row of two in a wide band still respects `MAX_SPREAD`.
- Outer letters in a leaning-edged shape (a parallelogram) take a
  nonzero rotation, |rotation| ≤ 30°, and every rotated box corner is
  inside the polygon; inner letters have rotation 0.
- A rectangle produces rotation 0 everywhere (no false tilt).
- Nudge: a short letter beside a tall one in a circle ends lower or
  higher than before and still inside.

Phase 2
- With fillers given and a loose shape, `fillers > 0`; every filler
  piece has `role: "mark"`, `filler: true`, no `parentId`, and its box
  (padded) is inside the polygon.
- No filler point lies inside any letter contour; no two filler boxes
  overlap.
- A tight shape (letters fill it) yields `fillers === 0`.
- Two runs with the same input are deep-equal (determinism).
- `fillerShapes` (in `stackConvert.test.ts`, real fonts): Amiri returns
  ≥ 5 named shapes with no teardrop; Qahiri returns the teardrop.

Phase 3
- `findCutZonesSwept` with `baseAngles: [0, π/2]` on a vertical bar
  returns a zone with |angle| ≈ π/2 and the full bar length
  (`strokeCuts.test.ts`).
- Arranger: a tall thin letter at the edge of a shape with headroom gets
  a cap piece (`parentId` = letter) and a new join; the cap's padded box
  is inside the polygon; re-running on the result adds no second cap and
  the cap count is unchanged.
- A letter whose stem points at another row's ink is not pulled through
  it (cap box clear of other groups' contours).
- Real-font check in `stackConvert.test.ts`: Amiri الملك converted and
  swept with both base angles reports a usable zone (length > 100 units
  per 1000 em) on the alif; UKIJ Diwani reports none. This pins the
  font-dependence as measured, so a later tolerance change is visible.

Verification loop per phase: `npx tsc --noEmit -p tsconfig.app.json`,
`npm run lint`, `npm test`, `npm run build`. The pre-commit hook bumps
`package.json`'s patch on each commit.

## Docs

- `.claude/rules/stacked-compositions.md`: rewrite the "Fill a guide
  shape" paragraph to cover edge hugging, nudge, tilt cap, the filler
  pass and its flag, the stem pull and its font-dependence, and the
  order (tilt → stems → fillers). Add one line to stroke-cuts.md about
  `baseAngles`.
- `PROGRESS.md`: one dated entry pointing at the rules note.
- `.claude/rules/deferred-features.md`: add "widening a curved stroke's
  radius" under bending letter bodies.

## Out of scope

- **Curve-radius editing** (widening the bowl of a curved letter). A
  curved stroke has only an outline, no centerline; changing its radius
  with correct weight is the deferred "bending letter bodies" work
  (skeleton + nib). Own spec after this ships.
- Tilting fillers or inner letters; user-chosen filler sets; rotating
  fillers to the edge.
- Loosening the zone detector for tapering Diwani stems (needs a
  measurement script first).
- Anything on live text blocks: `baseAngles` defaults to `[0]`, so
  stroke cuts on text are unchanged.
