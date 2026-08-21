# Straight-stroke extension

Lengthening a letter's own straight strokes by cutting the outline and
bridging the gap, rather than by inserting characters.

## Status: measured and stopped — read this before the rest of the doc

**This design was built through Task 3 of its own plan, measured against
the go/no-go gate below, and the gate failed.** A human reviewed the
measurement and decided not to build Tasks 4–10 (the rendering, storage and
on-canvas UI this document argues for). The argument below is the case
*for* attempting this — it is preserved as-written because it is still an
accurate account of why the attempt seemed worth making, not because the
attempt succeeded. Do not read past this block and start implementing.

The measurement, the two rejected tunings, and the reasoning for stopping:
`docs/archive/stroke-zone-coverage.md`. The short version: the connector
(join) half of what this doc proposes mostly works, but it duplicates
coverage the app's existing tatweel kashida already provides in every
bundled font; the letterform-internal half — the genuinely new capability —
is what failed to clear its own coverage bar. See also CLAUDE.md,
"Straight-stroke cut detection (kept, unused)", and the plan file's own
Status block: `docs/superpowers/plans/2026-08-21-straight-stroke-extension.md`.

## Why this is being attempted again

The Morph Glyph Editor and everything under it were removed on 2026-08-14
because the stack's core promise — strokes that extend — was measured inert:
the kashida dial displaced outline points but never moved `penX += advance`,
so a run's rendered extent did not change across the dial's whole travel;
only ~14% of authored stretch zones had a verified spine and therefore a
handle; and the strokes that did move deformed rather than extended. See
CLAUDE.md, "Removed subsystems", and `docs/archive/nuqta-measurements.md`
for what survives.

Two things are different here, and neither is optimism.

**Straight-only turns coverage from authored data into a predicate.** The old
design needed a *spine* — a medial axis per glyph per font — which is where
the 14% came from. A straight stroke needs no spine: a cut is legal exactly
when every outline segment it crosses runs parallel to the baseline, which is
a cheap geometric test any font can be asked. Nothing is hand-authored, so
nothing can be under-authored. Curved strokes are precisely where that test
stops holding, and they are out of scope for this work.

**The advance grows, by construction.** A cut adds its distance to the run's
total advance and to the block's `bounds`. The assertion that the run really
widens is a required test, not a hoped-for property — the same bar
`tatweel.test.ts` already sets.

This does **not** delete the tatweel kashida. Both mechanisms stay live; a
later, separate decision — gated on a measured comparison, not on taste —
decides whether kashida is retired.

## Scope

Plain `text` blocks only, matching every other per-glyph tool. Shape Fill
tiles a run into hundreds of instances, and text-on-path rotates glyphs to a
tangent; both are excluded for the reasons CLAUDE.md already records for
`glyphTransforms`.

Both elongation cases the user asked for are in scope and are *the same
primitive*: a stroke inside a letterform (the bar of ك, the flat of ص) and
the connector between two joined letters. Neither is special-cased.

## The cut model

A cut is a line perpendicular to the baseline, plus a distance. Applying it:
everything **past the cut in pen order** translates by `d`; every glyph whose
outline the line crosses has that outline cut and bridged with straight edges
at the designed weight; the run's advance grows by `d`.

"Past the cut" means increasing `penX`, not "to the right" — HarfBuzz returns
RTL runs already in visual order and `ShapedText` walks `penX` upward through
them, so pen order is the only unambiguous axis here. Getting this backwards
would extend a stroke by dragging the wrong half of the word.

A cut on a connector is not a distinct feature — the line simply crosses
whichever glyph draws the ink there, which may be both neighbours.

### Validity

A candidate cut is legal iff:

- it crosses the outline an even number of times, at least twice (it is
  inside ink — a cut through a gap would be letter-spacing, not elongation);
- **every crossed segment is near-parallel to the baseline**, `|dy/dx| <= tan ε`;
- the thickness between crossing pairs holds steady across a neighbourhood,
  so a momentary flat on a curve does not read as a straight stroke.

### Storage

```ts
export type StrokeCut = {
  /** HarfBuzz source-character offset (cluster), NOT a glyph index. */
  cluster: number;
  /** Cut's distance from that glyph's pen origin, unscaled font units. */
  localX: number;
  /** Shaped glyph id present when the cut was made — a checksum, exactly as
   *  GlyphTransform.glyphId is used. Optional for the same reason. */
  glyphId?: number;
  /** Extension distance, in nuqta. */
  nuqta: number;
};
```

`cluster` rather than glyph index is deliberate and is the resolution of the
fragility CLAUDE.md records for `GlyphTransform` and `DiacriticOverride`: a
cluster is a *source text offset*, so it survives re-shaping that changes the
glyph count — ligature formation, an added mark, a font swap — where a glyph
index does not. It still shifts when text is inserted before it, which is
inherent to keying into a mutable string; `glyphId` catches the residue.

Amount is in nuqta, resolved through the per-font table archived at
`docs/archive/nuqta-measurements.md` (15 of the 17 bundled fonts) times
`fontSize`, with a px fallback for the two unmeasured faces.

Field lives at `strokeCuts?: StrokeCut[]` on `BlockCommon`, gated by
`supportsStrokeCuts(b) => b.type === "text"` in `App.tsx`. CLAUDE.md's
warning applies literally: a guard narrower than the field's home
type-checks perfectly while silently discarding every edit.

Absent means no cuts, so projects saved before this load unchanged and the
layout payload version stays 5.

## `src/lib/strokeCuts.ts` (new, pure)

Pure — no React, no Konva, and **no `./harfbuzz` import**, so Vitest can load
it. Callers pass flattened outlines. Same discipline as `tatweel.ts`,
`fitToWidth.ts` and `diacritics.ts`, and for the same concrete reason:
harfbuzzjs's static import throws under Node's ESM loader before any test
code runs.

```ts
/** A contiguous run of legal cut positions — one extendable stroke, one handle. */
export type CutZone = {
  glyphIndex: number;
  cluster: number;
  fromX: number; toX: number;   // font units, glyph-local
  thickness: number;            // for weight-preservation checks and UI
};

/** Sweep candidate positions and merge the legal ones into zones. */
export function findCutZones(outline: Polyline[], opts?: DetectOpts): CutZone[];

/** Per-glyph x shifts, per-glyph surgery, and the width the run gained. */
export function buildCutPlan(glyphs: HarfBuzzGlyph[], cuts: StrokeCut[]): CutPlan;

/** Outline surgery. Splits any crossed bezier at the cut with de Casteljau. */
export function applyCutsToCommands(cmds: PathCommand[], cuts: ResolvedCut[]): PathCommand[];
```

Flattening for detection reuses `lib/svgPath.ts`'s existing fixed-step bezier
subdivision (`pathToPolygon`) rather than introducing a second scheme.

`applyCutsToCommands` splits curves properly instead of forbidding them:
validity guarantees a crossing is *near-parallel*, which is not the same as
*a straight line segment*, and a flat curve can legally cross. The crossing
parameter is found by bisection and split with de Casteljau — exact, and
unit-testable with no canvas.

## Phase 1 — the coverage spike, which gates everything after it

`scripts/measureStrokeZones.mjs` runs `findCutZones` over all 17 bundled
fonts and prints a per-font table: glyphs exposing at least one zone, total
zones, median zone width in nuqta. It shapes real text with real harfbuzzjs
loaded via `createRequire`, as `diacritics.test.ts` does.

**Kept, not thrown away** — matching the deliberate decision to keep
`measureNuqta.py` and its siblings as the other half of "don't redo the work".

Corpus: the 28 base letters isolated, **plus joined words** — حرف · محمد ·
بسم · سلام · كتاب — because isolated letters measure nothing about the
connector case, which is half the feature.

**Go/no-go.** Proceed only if the four naskh/kufi faces — Amiri,
Scheherazade, NotoSans, Kufi — expose at least one zone on **>=60%** of the
base letters, and connector zones at **>=80%** of the positions where a
tatweel is currently legal. Diwani, Ruqaa and Thuluth are expected to score
low; that is an accepted outcome, not a failure. If the naskh faces land near
the old subsystem's 14%, stop and rethink rather than build a UI over it.

## Rendering

`ShapedText.tsx` walks its glyphs twice — the draw loop and the metrics loop
— and both must agree or the ink and the bounding box drift apart. One
`CutPlan` feeds both:

```ts
type CutPlan = {
  shift: number[];                      // extra x per glyph, font units
  surgery: Map<number, ResolvedCut[]>;  // cuts landing inside a glyph
  addedAdvance: number;                 // total
};
```

- Draw loop: add `shift[i]` to `gx`; run `applyCutsToCommands` before
  `tracePath`.
- Metrics loop: add the same shift; box the modified path.
- `addedAdvance` flows into `bounds`, which is what makes a stretched run
  report its real width to snapping, alignment and Fit to width instead of
  lying about it.

This is the one per-glyph edit that **must** move `penX += advance`. The
invariant that a moved or widened glyph never reflows its neighbours — true
of `GlyphTransform` and of a hidden diacritic — is deliberately broken here,
because honouring it is exactly what made the old dial inert.

## The handle — `src/components/StrokeCutHoverHandles.tsx`

Mounted from `ShapedText`, armed by a **"Stretch strokes"** checkbox in
Sidebar → Typography beside "Move & scale glyph". A third always-on overlay
would compete with the other two for the same pixels.

Three rules this codebase has already paid for:

- **Hover handlers on the per-zone `Group`, never on the hit `Rect`.** With
  handlers on the Rect, a mounted handle covering the pointer makes the next
  mousemove a genuine Rect→Circle leave: the handle unmounts and is present
  on exactly every other frame. Measured; see CLAUDE.md, "End-to-end tests".
- **Mount order largest → smallest**: glyph-transform rects, then zone rects,
  then diacritic rects. Konva routes a pointer to the topmost listening
  shape; a zone is a slice of a glyph and a mark is smaller still.
- **Drag rail via `projectOntoAxis`** (`lib/dragAxis.ts` — kept from the
  removed subsystem for precisely this), history via
  `useDebouncedHistoryPush`, as block dragging does.

Drag **snaps to half-nuqta, Alt bypasses, a typed value stays exact.** That
advisory-snapping model was the good idea in the removed system, and the
measurements it needs already survive in the archive.

## Coexistence

**Kashida.** A tatweel insertion rewrites the text, so every source offset
after it shifts — and cuts are keyed by cluster. `applyKashida` knows where
it inserted and how much, so `setKashidaAtSlot` **remaps later cuts' clusters
by the same delta** rather than letting the checksum drop them.

**Fit to width.** `styledRunWidth` already exists to say that outlines are not
the whole of what is drawn — it sums the italic shear, faux-bold stroke,
outline `strokeWidth` and warp spread. Total cut extension becomes the fifth
term. Without it, a fit promises a width a stretched block then visibly
exceeds, which is the bug that term list was built to prevent. Solving a fit
*using* cuts rather than tatweels is explicitly later work.

**Mirrors** need nothing. `MirrorBlockView` mounts the source's own renderer
with `listening={false}`, so a stretched source mirrors for free and no zone
handle can mount inside a mirror.

**Export** needs nothing. A cut glyph is ordinary path commands, so PNG,
JPEG, SVG and PDF all get it unchanged.

## Testing

`strokeCuts.test.ts` uses **real fonts and real harfbuzzjs** via
`diacritics.test.ts`'s `shapeReal` helper, loaded with `createRequire`. This
convention is absolute here: a fabricated-fixture suite is exactly what let
the cluster-lookup bug ship unnoticed once.

Three assertions carry the feature:

1. **Total ink extent strictly increases with cut amount, in at least three
   real fonts.** This is `tatweel.test.ts`'s bar. Its absence is why an inert
   feature shipped last time; a fixture-based version of it would restate the
   assumption instead of testing it.
2. **Stroke weight is preserved across the bridge** — thickness after the cut
   equals thickness before, within tolerance. Catches "deformed rather than
   extended", the old system's second defect.
3. **Illegal cuts are rejected** — across a curve, and through a gap.

`e2e/stroke-cuts.spec.ts`: drag a zone handle and assert the run's ink widens
via `inkPixels`; undo reverts it; a saved project round-trips the cuts.

## Out of scope

- **Curved strokes.** The user's own scoping, and the boundary where the
  validity predicate stops holding.
- **Shape Fill and text-on-path blocks.**
- **Fit to width solving via cuts** — it must *measure* them correctly, not
  use them.
- **Deleting the tatweel kashida** — a separate decision, gated on a measured
  comparison.
- **Any per-font authored schema, ever.** That economics is what removed the
  last subsystem.

## Order of work

1. `lib/strokeCuts.ts` detection + `scripts/measureStrokeZones.mjs`; run the
   spike; **stop at the go/no-go gate.**
2. Surgery (`applyCutsToCommands`) and `buildCutPlan`, with the three
   real-font assertions.
3. `ShapedText` integration, both loops; `styledRunWidth`'s fifth term.
4. Storage, the `supportsStrokeCuts` gate, save round-trip.
5. `StrokeCutHoverHandles` + the Typography checkbox.
6. Kashida cluster remapping.
7. `e2e/stroke-cuts.spec.ts`; guide section; CLAUDE.md and PROGRESS.md.

## Open questions

- **ε, the parallelism tolerance, and the neighbourhood width** for the
  steady-thickness rule are unset. They are the dials that trade coverage
  against distortion, and the spike in phase 1 is what should set them —
  deliberately not guessed here.
- **Whether a zone should offer one handle or two** (extend from either end)
  is left to the phase-5 UI work; the data model supports either, since a cut
  is a position and a distance rather than an edge.
