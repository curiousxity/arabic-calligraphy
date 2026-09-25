---
paths:
  - "src/lib/strokeCuts*.ts"
  - "src/lib/nuqta*.ts"
  - "src/lib/normalizeGlyphs*.ts"
  - "src/components/StrokeCutHoverHandles.tsx"
  - "scripts/measureStrokeZones.mjs"
  - "e2e/stroke-cuts.spec.ts"
---

# Straight-stroke cut detection (`src/lib/strokeCuts.ts`)

Lengthening a letter's own straight strokes by cutting the outline and
bridging the gap — the one elongation mechanism that can stretch a stroke
*inside* a letterform, which tatweel kashida structurally cannot. Design:
`docs/superpowers/specs/2026-08-21-straight-stroke-extension-design.md`;
plan: `docs/superpowers/plans/2026-08-21-straight-stroke-extension.md`.

**This was stopped once, at its own coverage gate, and then resumed after
the predicate was replaced.** That history is the useful part of this
section, because the first predicate looked reasonable and was not:

- **A cut line is perpendicular to the *stroke*, not to the baseline.** The
  original predicate measured every crossed segment's slope against the
  baseline and rejected anything steeper than `maxSlope`. Arabic strokes as
  these fonts actually draw them are subtly inclined nearly everywhere, so a
  straight, perfectly extendable stem at 12 degrees (edge slope ~0.21)
  failed a 0.18 bar. `findCutZonesSwept` rotates the outline through a range
  of candidate angles and runs the same legality code in each frame, so a
  stem is horizontal in its own frame and passes with nothing loosened.
- **Loosening `maxSlope` could never fix that**, because the same tolerance
  that admits an inclined stem also admits the tangent point of any curve,
  where the edge slope passes through zero. One knob, two populations moving
  in opposite directions. That is why the first tuning pass made
  Scheherazade's coverage *worse* as it loosened.
- **Straightness is bow away from a chord, measured per edge**
  (`maxEdgeBow`, as a fraction of the stroke's thickness) — not drift in
  per-segment slope. `flattenContours` turns every curve into 8 straight
  segments, so consecutive samples land on segments whose slopes differ
  discretely; a slope-drift test reads that quantization as curvature and
  throws real strokes away. Crossing *positions* carry the signal without
  the quantization. **Per edge, never averaged**: a stroke that bows
  symmetrically moves its two edges in opposite directions, so a mean stays
  put the whole way through. `strokeCuts.test.ts` pins both of these with
  synthetic outlines, and both tests were verified to fail against the
  variant they rule out.
- **Zone coordinates are in the zone's own rotated frame.** `fromX`/`toX`
  are displaced from glyph space by `centreY * sin(angle)`, which at a
  typical stroke height exceeds the join window the coverage sweep uses.
  Anything asking *where on the glyph* a zone sits must go through
  `zoneExtentX`, never read the raw fields.

**Extension runs along the stroke axis**, which is what keeps the bridged
span a clean rectangle of the stroke's own weight. So a cut of distance `d`
at angle `t` grows the run's advance by `d * cos t`, and shifts everything
past the cut vertically by `d * sin t`. The assertion the feature rests on is
that the advance grows *monotonically* with `d`, not that it grows by exactly
`d`.

**Coverage, and the gate that was accepted rather than met.** The gate asked
four naskh/kufi faces to clear isolated-letter coverage >=60% and join
coverage >=80% at once. After the amendment, isolated clears on all four
(Amiri 86%, Kufi 82%, NotoSans 79%, Scheherazade 75%) — that is the half
that structurally failed before, and the genuinely new capability. Join
clears on three; **Amiri's joins do not, and that is accepted as a known
per-font limitation** rather than fixed, because the join case duplicates
tatweel kashida, which already covers connectors in every bundled font. A
known false-positive residue is recorded too (NotoSans seen, one short zone
at a tooth's vertex). All numbers, the sensitivity table and the
reproducible spot-check live in `docs/archive/stroke-zone-coverage.md` —
**the single home for them**; this section only summarizes.

`scripts/measureStrokeZones.mjs` is the offline sweep that produces those
numbers. It imports the real detector rather than reimplementing it, and
`--baselineOnly` restores the original vertical-only predicate so the two
readings can be compared directly rather than from memory.

**The pieces, and the two that are easy to get wrong.**
`src/lib/strokeCuts.ts` holds all of it and stays pure — no React, no Konva,
and **no `./harfbuzz` import**, whose static harfbuzzjs import throws under
Vitest's Node loader before any test code runs (`normalizeGlyphs` is imported
type-only, and imports nothing itself). `findCutZonesSwept` detects,
`applyCutsToCommands` performs the surgery, `buildCutPlan` resolves stored
cuts against a shaped run, `nuqta.ts` holds the measured per-font dot table
restored from `docs/archive/nuqta-measurements.md`.

- **Two spaces, and cuts are stored in the font's.** `StrokeCut.localX` and
  `CutPlan.shift` are in font units, so a cut survives a font-size change and
  `shift` can be added straight to `penX`. `ShapedText` scales them by
  `fontSize / upm` at the one point they meet a path opentype.js has already
  drawn at `fontSize` (`scaleCuts`). Mixing the two silently mis-places every
  cut in proportion to the size.
- **A cluster can hold several glyphs.** Resolving a cut by cluster and *then*
  checksumming `glyphId` against whichever glyph came first drops valid cuts
  on any letter carrying a mark — `buildCutPlan` matches on both together.

`ShapedText` builds one `cutPlan` memo and uses it in **both** glyph loops:
the draw loop, and the metrics loop, which boxes the surgically modified
outline via `outlineBounds` rather than asking opentype.js for the original
glyph's box. A stretched letter has to report its real ink, or snapping,
alignment and Fit to width all keep measuring the un-stretched run.
`fitToWidth`'s `styledRunWidth` gains a fifth term for the same reason, fed by
`cutAdvanceTotal` — **shared with `buildCutPlan` rather than restated**, the
same discipline that has `ShapedText` import `ITALIC_SHEAR` from `fitToWidth`
instead of keeping a copy.

The zone sweep in `ShapedText` runs **only while the tool is armed**: it
rotates every glyph outline through fifteen candidate angles, which is far too
much to run on every text block on the canvas all the time.

`StrokeCutHoverHandles.tsx` is the on-canvas overlay, mounted **between**
`GlyphTransformHoverHandles` and `DiacriticHoverHandles` — Konva routes to the
topmost listening shape and later siblings sit on top, so the order is
largest → smallest (glyph rect, stroke rail, mark). Its hover handlers sit on
the per-zone `Group`, never on the hit `Rect`, for the reason recorded in
[e2e-tests.md](e2e-tests.md); `e2e/stroke-cuts.spec.ts` pins that with the same
every-other-frame check the other two overlays have.

**Kashida coexistence.** Cuts are keyed by source-text offset, so stepping a
kashida moves every cut after it. `setKashidaAtSlot` remaps them inside the
same `updateSelectedBlock` patch, so one `pushHistory()` still covers the edit
and a stretch is not silently dropped by the `glyphId` checksum because an
unrelated join was widened.

The rule this expresses is that **any handler rewriting a block's text by
inserting tatweel owes a remap of everything keyed by a text offset**, so it
lives in one place rather than being paid by whoever remembers: `App.tsx`'s
`kashidaTextPatch` builds the patch, over `remapCutsForEdits` in
`strokeCuts.ts`. Both callers go through it — a single kashida step is the
one-element case of what a Fit to width solve returns in `result.edits`. That
matters because the two got out of step exactly this way once before, in
`runStyleForBlock`; the next text-offset-keyed field is added here rather than
at whichever call site its author happened to be looking at.
