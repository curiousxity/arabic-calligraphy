# Per-stroke editing that preserves letter joining

**Status:** Phases A and B are implemented (2026-08-13, plan:
`docs/superpowers/plans/2026-08-13-per-stroke-editing-phase-ab.md`) —
change 3 (clamp/taper the axis) and change 5 (nuqta quantization) from
Phase A, and change 1 (overlap-based join pins) from Phase B. Join pins
landed **plain-text only**, per the user's 2026-08-13 decision recorded
below as no longer undecided. Detection has a measured, documented gap:
of 30 (font, word) pairs tested, 5 abut without overlapping and go
unpinned — see "Diagnosis" and "Deferred, not forgotten" below; this is
not a regression, it is the pre-existing tearing behaviour, simply not
yet fixed for that geometry.

**Phase C ran 2026-08-13 and its answer was no.** The schema→real-glyph
mapping lands a mapped spine node a median 0.37 nuqta and a p90 of 1.43
nuqta from the ink it describes, with only 14.5% of nodes inside the ink at
all — against a pre-registered bar of median ≤ 0.25 / p90 ≤ 0.5. **Changes 2
and 4 (Phase D) are therefore blocked pending a re-anchoring design**; see
"Phase C result" under Sequencing for the full breakdown and for what the
data rules out. The measurement is committed as a characterization test at
`src/lib/strokeSchema/spineError.test.ts`.

**Goal (user's words):** "I want every stroke to be able to be modified
separately but I still want the glyphs/letters to join to each other
seamlessly."

## Scope

**In:** every font in `public/fonts/` except the two named below.

**Out for now (user's decision, 2026-08-12):** Diwani and Ruq'ah —
`HarfCanvasDiwani.ttf` and `Ruqaa.ttf`.

Deferring these two removes the design's biggest risk. Every stroke schema
declares `calligraphicModel: "naskh"`, and Diwani's steeply sloped,
long-sweeping letterforms are the worst fit in the library for Naskh-authored
proportions — it was the case most likely to break the schema→real-glyph
mapping that changes 2 and 4 rest on. Ruq'ah merges dot pairs into strokes,
which also makes its measured nuqta the least reliable figure we have.

Note this is a *risk* reduction, not an elimination: Kufi, Urdu, Yekan and
Qahiri are not Naskh either, and Thuluth's proportions differ from Naskh's
noticeably. Phase C exists precisely to measure how far that mismatch
actually goes, and it should sample across those faces rather than only the
Naskh ones.

Consequences: the per-style schema override layer (below) is **not needed
yet** and should not be built speculatively. `HarfCanvasDiwani.ttf` and
`Ruqaa.ttf` remain selectable in the app and simply do not gain the improved
stroke editing in this phase.

**Also out:** parametric letterform rendering. Considered as the route to
Kaleam-style editing and rejected — the schemas carry no joining geometry at
all, so drawing from skeletons would forfeit the seamless joining this whole
feature exists to protect. See CLAUDE.md's deferred-features entry.

## Diagnosis — confirmed live in the browser

Two symptoms, both reproduced at 275% zoom on the default `حرف` text in
Naskh.

### The engine ignores three layers of authored data

Verified by grep across `src/`:

- `protectedZones` survives only as `protectedReasons`, a string list used
  for display. The zones never scope an edit.
- `preserveCurvature`, `preserveThickness`, and each zone's own `axis` field
  (`"x"` / `"path"`) are read **nowhere**.
- `lengthDots`, `styleProfile.measurementSystem.dotUnit` and
  `verticalLevels` appear **only in test fixtures**.

The engine is not missing information. It has it and discards it.

### Symptom 1 — a cleft opens at a join

Reproduce: default `حرف`, stretch the ra down-and-left. A hairline gap opens
at the hah/ra junction, **on the side being dragged toward**.

`ra-final.json` has one stroke whose stretch zone spans the *entire* stroke
(`fromNode 0` → `toNode 2`), and `connectsRight: true` means node 0 **is**
the connection point:

```
S_HEAD_1  nodes = (2.8,1.0) → (2.0,0.7) → (0.8,-0.9)
  zone:      0 → 2,  axis: "path",  preserveCurvature: true
  protected: (1,2) terminal-shape,  (2,2) left-tail-terminal
```

Two causes compound:

- `applyAxisDisplacement`'s `tAlong = along / axisLen` (`src/lib/glyphEdits.ts:63`)
  is **unbounded and signed**, with falloff only *perpendicular* to the axis
  and none along it. Points past the drag origin travel further than the drag
  itself; points behind the anchor travel backwards.
- The anchor is a **proportional guess** — `anchorNorm` mapped from the
  schema's idealized bounding box onto the real glyph's box — so it never
  lands exactly on the true connection point. Any nonzero displacement there
  tears the seam, and nothing pins it, because `join-integrity` is never read.

### Symptom 2 — strokes deform rather than extend

`fa-medial.json`'s eye loop asks for `axis: "path"` and
`preserveCurvature: true`; the catalog collapses the zone to a straight
chord, so the loop shears sideways and its counter pinches shut instead of
growing around its curve.

Separately, `ra-final.json` protects nodes 1→2 while its stretch axis runs
0→2 — displacement is **maximum exactly where the schema says do not
deform.** The protection is inverted.

## The five changes

### 1. Pin the connection point, found from real ink

Displacement is multiplied by a guard that is 0 at the connection point and
ramps smoothly to 1 beyond a pin radius, so the join cannot move and there is
no crease where the guard releases.

**The connection point is derived from the actual overlap between adjacent
glyphs**, not from a per-glyph geometric guess. After shaping, two connected
letters' outlines physically overlap; the connection is wherever that overlap
is. Computing that region and pinning its centroid assumes nothing about
baselines, slopes or letterform style, so it is correct per font by
construction. `ShapedText` already has the whole glyph run, so the neighbour
is available.

An earlier draft proposed scanning a vertical line near the joining edge and
taking the midpoint of ink crossing the baseline. **Rejected**: it assumes
joins happen at the baseline, which is Naskh-shaped thinking and false for
sloped styles. Do not reintroduce it.

Pin radius: derive from the measured nuqta (below) rather than a fixed
fraction of em.

### 2. A real spine instead of a chord

Map the schema stroke's nodes `fromNode..toNode` through the existing
`normalizePoint`/`mapNormToRealBox` into a *polyline* in real-glyph space. An
outline point projects onto its nearest spine segment and is displaced along
**that segment's tangent**, scaled by arc-length position. Two-node strokes
degrade to exactly today's straight chord, so nothing regresses; feh's
four-node eye grows around its loop instead of shearing across it.

This is `axis: "path"` actually implemented.

### 3. Clamp and taper along the axis

Clamp `tAlong` to `[0, 1]` and add a falloff approaching the far end. Kills
the overshoot that lets points past the drag origin travel further than the
drag itself.

### 4. Enforce `protectedZones`

Map each protected node span onto the same spine; outline points projecting
into a protected span get displacement zeroed with the same smooth ramp.
Fixes the ra's deforming tail terminal.

### 5. Quantize stretch to nuqta / half-nuqta increments

Traditional Arabic calligraphy measures stroke length in whole and half
nuqta, and the schemas are authored that way. No new schema data is needed: a
stroke's stretched length is `lengthDots × factor`, so half-nuqta steps mean
snapping the factor to multiples of `0.5 / lengthDots`. Beh's body
(`lengthDots 4.2`, zone 0.85–1.8) gets steps of ≈0.119 — about 28 discrete
positions. The UI reads in calligraphers' units ("+1½ nuqta") instead of
abstract factors, and the block-level Kashida dial quantizes with it.

**Advisory, not compulsory** (user's decision): snap by default with a
modifier to override, mirroring the grid snapping `CanvasStage.tsx` already
establishes as this app's idiom. Off-grid values must stay expressible and
must round-trip through save/load unchanged — a quantizer that silently
re-snaps on load would destroy deliberate off-grid work.

**The nuqta must be measured per font, not derived.** The intuitive rule that
the alif's stem is one nuqta wide **fails**: `alif/dot` ranges 0.53 (Urdu) to
1.68 (Kufi2), a 3.2× spread, where the rule predicts 1.00. `dot/em` itself
varies ~2× across the library, so no global constant works either. Use a
per-font table seeded by `scripts/measureNuqta.py` and human-confirmed.

Measured table (2026-08-12), in-scope fonts:

| font | upem | nuqta w×h | dot/em | confidence |
|---|---:|---:|---:|---|
| AlFatemi.otf | 925 | 90×90 | 0.0973 | high |
| Amiri.ttf | 1000 | 135×132 | 0.1350 | high |
| FatemiMaqala.ttf | 2048 | 233×226 | 0.1138 | high |
| Kufi.ttf | 1000 | 121×115 | 0.1210 | high |
| Kufi2.ttf | 1000 | 116×116 | 0.1160 | high |
| Lateef.ttf | 2048 | 208×208 | 0.1016 | high |
| NotoSans.ttf | 1000 | 99×99 | 0.0990 | high |
| Qahiri.ttf | 750 | 80×72 | 0.1067 | medium (modal only) |
| Scheherazade.ttf | 2048 | 229×239 | 0.1118 | high |
| TahaNaskhRegular.ttf | 2048 | 237×238 | 0.1157 | high |
| Thuluth.ttf | 2048 | 188×219 | 0.0918 | high |
| ThuluthDeco.ttf | 2048 | 188×219 | 0.0918 | high |
| Urdu.ttf | 2048 | 315×283 | 0.1538 | high |
| Wessam.ttf | 2048 | 156×177 | 0.0762 | high |
| Yekan.ttf | 2048 | 276×248 | 0.1348 | accepted (see note) |

Two methods cross-checked (beh dot contour; modal-contour sweep over every
glyph). They agree within ~2% on every row above except Yekan, where the beh
dot gives 276×248 and the modal sweep 260×220 — a ~6% spread. **Reviewed and
accepted by the user 2026-08-12**; the table uses the beh-dot figure, which
is the more direct measurement (the actual dot of an actual letter, rather
than the commonest compact contour in the font). At a ~6% spread the
practical consequence is sub-pixel at normal sizes, and change 5's
quantization is advisory anyway, so a small error degrades the snap
increment rather than corrupting geometry.

## Sequencing

Deliberately ordered by confidence, so the uncertain work is informed by the
certain work rather than gambling on it.

**Phase A — changes 3 and 5.** Highest confidence, no dependency on the
schema→real-glyph mapping. Change 3 alone measurably reduces the cleft by
removing the overshoot; change 5 is additive and independently useful.

**Phase B — change 1**, with overlap-based join detection. This is what makes
the join guarantee structural rather than incidental.

**Phase C — measure before building.** Map the schema spine onto real glyphs
for ~12 letters and quantify how far the mapped points land from actual ink.
Sample deliberately across the in-scope styles — Naskh (TahaNaskh, Amiri),
Thuluth, Kufi and Urdu — not just the Naskh faces, since the mapping's error
is expected to grow with distance from Naskh proportions and Phase D's
viability depends on the worst case, not the average. This is investigation,
not implementation.

### Phase C result, 2026-08-13 — the mapping is NOT accurate enough

Measured over **every** authored schema (105) × 5 fonts = 1318 mapped nodes,
by `src/lib/strokeSchema/spineError.test.ts`, which imports the app's real
`mapNormToRealBox`/`deriveStretchCatalog` rather than reimplementing them.
Error is each mapped node's distance to the nearest ink (0 if inside),
expressed in nuqta because a stroke feature is about one nuqta thick.

The bar was set **before** looking at the data: median ≤ 0.25 and p90 ≤ 0.5
to proceed as designed; p90 > 1 to require re-anchoring first.

    landed inside ink   14.5%
    median 0.37   p90 1.43   p99 2.98   max 4.68

| font | style | inside | median | p90 | max |
|---|---|---:|---:|---:|---:|
| TahaNaskhRegular | Naskh | 8% | 0.41 | 1.47 | 2.86 |
| Amiri | Naskh | 11% | 0.38 | 1.18 | 2.75 |
| Thuluth | Thuluth | 13% | 0.54 | 1.74 | 3.79 |
| Kufi | Kufi | 26% | 0.24 | 1.27 | 3.09 |
| Urdu | Nastaliq-ish | 13% | 0.26 | 1.49 | 4.68 |

**p90 is 1.43 nuqta — the mapped node routinely lands more than a full
stroke-width away from the ink it is supposed to describe, and 85% of nodes
land outside the ink altogether.** Phase D must not proceed as designed.

Three things in the breakdown matter more than the headline number, because
they say *why*, and they rule out the explanations the spec itself offered:

- **It is not a style-mismatch problem.** This spec predicted the error would
  "grow with distance from Naskh proportions". It does not. The two Naskh
  faces the schemas were authored against are no better than Kufi, and Kufi
  has the *best* median of the five. Distance from Naskh is not the variable.
- **It is not per-form skeleton reuse.** Split by joining form, everything
  sits in the same band (isolated p90 1.68, initial 1.06, medial 1.24, final
  1.74). The `formMetadata` caveat about reused skeletons is real but is not
  what is driving this.
- **Multi-component letters are worse, but simple ones already fail.** By
  component count, p90 climbs 0.95 → 1.35 → 1.37 → 1.74 → 2.75 for 1…5
  components, so normalizing against the whole-glyph bounding box does hurt
  compound letters (seen/sheen with their teeth, kaf, theh dominate the worst
  15). But a *single*-component glyph still lands outside the ink 90% of the
  time. Per-component normalization would cut the tail without rescuing the
  design.

What that leaves: the proportional whole-glyph bounding-box mapping is
inaccurate for reasons independent of style, contextual form, and letter
complexity. It is the mechanism itself, exactly as suspected when this phase
was written — the schema's box and the font's box are simply not in
correspondence beyond "same letter, roughly this region".

**Phase D — changes 2 and 4 — is therefore blocked**, and re-anchoring is
required first: snap the mapped spine to nearest ink, or derive a medial
axis from the real outline and fit the schema's node sequence to it. That is
a different design and needs its own pass through this document. Note the
prize is still worth it — change 4 in particular is what stops a stretch
deforming a letter's protected terminal — but building it on the current
mapping would freeze the wrong part of the letter 85% of the time, which is
a new failure mode rather than a fixed one.

The measurement is committed as a **characterization test**: it asserts the
error is still this large, so an improved mapping fails the suite and tells
whoever improved it to re-run these numbers and reconsider Phase D. A
failure there is good news.

**Why C gates D.** Changes 2 and 4 are the only two built on the proportional
mapping — the exact mechanism that caused the cleft. Change 4 is the riskier
of the pair: a protected zone that lands in the wrong place does not merely
fail to protect, it freezes the wrong part of the letter, which is a *new*
failure mode rather than a fixed one.

## Success criteria

Falsifiable, not a matter of taste:

1. **Join invariance** — for every kashida-eligible letter pair, the
   connection point moves **0px** at every factor from `minFactor` to
   `maxFactor`. Automatable across all 105 schemas × the in-scope fonts.
   This is the reported bug turned into pass/fail.
2. **No overshoot** — no outline point displaces further than the axis extent.
3. **Protected spans do not move** — 0px displacement for points inside one.
4. **Regression bar** — at `factor = 1`, rendering is byte-identical to today.

## Testing

- Changes 2–5 are pure functions over point sets — unit-testable in the style
  of `snapping.test.ts`.
- Change 1 needs a real font; `diacritics.test.ts` is the precedent (real
  harfbuzzjs, real fonts from `public/fonts/`, no hand-written fixtures).
  A fabricated-fixture version of that suite is exactly what let a bug ship
  unnoticed once before.

## Open questions

- Phase C's outcome decides whether Phase D proceeds as designed.
- Pin radius as a multiple of the nuqta: exact factor to be tuned once
  change 1 is testable.

## Deferred, not forgotten

- **Join-pin detection for abutting-but-not-overlapping glyphs.**
  `overlapCentroid` (`lib/joinPins.ts`) finds a join only where two adjacent
  glyphs' real outlines physically overlap; measured 2026-08-13, 5 of 30
  (font, word) pairs shape to glyphs that merely abut, so no pin is placed
  and those joins keep the pre-existing tearing behaviour (see
  "Implementation notes" above for the full breakdown). Deliberately **not**
  improvised with a dilation radius here: dilate enough to catch abutting
  letters and false joins start getting manufactured between letters that
  merely pass near each other without connecting — its own new failure mode,
  not a free fix. A baseline-scan heuristic was considered and rejected for
  the same reason changes 2 and 4 were deferred to Phase C: it assumes
  Naskh-shaped geometry the design explicitly does not want to bake in this
  early. Extending detection to this case is new design work.
- **Mark detection for fonts that encode marks in the Private Use Area.**
  Because pairing now skips marks, join-pin coverage on vocalized text is
  only as good as `findDiacriticGlyphIndices`, and that detector cannot see
  `Thuluth.ttf`'s marks (PUA codepoints, positioned by advance rather than
  GPOS). A third signal — the font's own GDEF glyph classes, which mark up
  mark glyphs directly — would likely fix it, and would simultaneously make
  the per-mark diacritic overlay work on that font. It was not bolted on
  here: the detector is shared by every diacritic feature in the app and
  changing it needs its own real-font verification pass, on the same
  reasoning that keeps its test suite free of fabricated glyph fixtures.
- **Join pins on Shape Fill and text-on-path blocks.** Plain text only, per
  the 2026-08-13 decision recorded above. `ShapeFillText` tiles its run
  through a per-tile affine transform; computing pins in that space is
  separate work.
- **Diwani and Ruq'ah support**, and with them the per-style schema override
  layer: one base schema per letter-form plus a thin per-style layer carrying
  only the numbers that differ (`minFactor`/`maxFactor`, `priority`), rather
  than 105 × N hand-authored files. Full geometry overrides remain possible
  where a style genuinely is a different letterform. The registry hook for
  this — keying `registry.ts` by `(unicode, joiningForm, styleId?)` with
  fallback to the base — is small but painful to retrofit; revisit when these
  styles come back in scope.
- **Parametric nib-sweep rendering.** Needs numeric stroke widths (only
  qualitative profiles exist), finer skeletons (current ones are 2–4 nodes),
  per-style profiles, and joining geometry that does not exist. Note that
  `public/fonts/` already ships Thuluth and Ruqaa, so those proportions do not
  require it.

## Implementation notes (gathered while drafting the plan, 2026-08-13)

The plan itself was not written — work paused before it. These are the
concrete findings from reading the code, recorded so they need not be
re-derived.

**Quantization must snap the ADDED length, not the absolute length.** This
corrects an ambiguity in change 5 above. A stroke's natural `lengthDots` is
not itself a half-nuqta multiple (beh's body is 4.2), so snapping absolute
length would move `factor = 1` off the font's natural rendering and violate
success criterion 4. Snap the delta instead:

    step      = 0.5 / lengthDots
    quantized = 1 + round((factor - 1) / step) * step

`factor = 1` then maps to itself exactly, and the step in factor space is the
`0.5 / lengthDots` the spec already describes.

**`lengthDots` is authored but not carried.** It exists on `Stroke`
(`src/lib/strokeSchema/types.ts:119`) but `deriveStretchCatalog` never copies
it, so it never reaches a handle. Change 5 needs it added to
`StretchDefinition` and to `GlyphStretchHandle`, and set at creation in
`App.tsx`'s `addStretchHandle`.

**Nuqta table shape.** Store `dot/em` ratios keyed by font family, not raw
font units — then nuqta in px is `ratio * fontSize`. A font absent from the
table should return `null` and **disable quantization** rather than snap to a
guess. That gives Diwani and Ruq'ah correct out-of-scope behaviour for free:
they simply do not snap.

**The kashida formula is duplicated and both copies must change together.**
`App.tsx:600` (`setBlockKashidaAmount`) and `src/lib/justify.ts:114`
(`applyKashidaAmountToEdits`) each compute
`factor = 1 + (maxFactor - 1) * (amount/100) * (priority/10)`. If
quantization is applied to one and not the other, the auto-justify solver
optimises a width that applying its own answer would not produce.

**Join guard plumbing.** `applyGlyphEdit(x, y, edit, contourIndex)` has four
call sites: `ShapedText.tsx` (291/307/323), `ShapeFillText.tsx:596`, and
`justify.ts` (85/88/91). Add pins as an **optional fifth parameter** so all
existing call sites keep working untouched. Apply the guard to the *total*
displacement — run the handles as now, then blend
`result = p0 + (p1 - p0) * guard` — rather than threading it through
`applyAxisDisplacement`.

**Overlap detection.** `src/lib/svgPath.ts` already exports `pathToPolygon`
and `pointInPolygon`, which is enough: intersect the two glyphs' bounding
boxes, sample a grid inside, keep points inside both outlines, take the mean.
No new geometry library.

**The clamp is shared with the glyph-rig path, and that changes how old
projects render.** `applyPreparedGlyphRig` runs through the same
`applyAxisDisplacement`, and unlike a schema stretch handle it has no
`factor = 1` neutral — a rig axis's slider value *is* the multiplier. So a
saved project carrying a nonzero rig value draws slightly differently after
this change: points beyond the axis tip stop overshooting, and points behind
the anchor stop moving backwards. Kept deliberately. It is the same
overshoot bug in the same function, a rig axis tears a join exactly as a
stretch handle does, and forking the math to preserve the old rig behaviour
would mean maintaining two displacement engines differing only in a defect.
Recorded because the difference is small enough to be mistaken later for an
unrelated regression.

**Clamping `tAlong` is safe for the existing suite.** No test in
`glyphEdits.test.ts` asserts the unbounded behaviour — the one point tested
beyond the drag origin (`x = 200`) is excluded by a lasso mask, so it asserts
masking, not overshoot.

**Decided 2026-08-13 — plain text only.** Shape Fill blocks do not get join
pins in this phase. `ShapeFillText` shares `applyGlyphEdit` but tiles its run
through a per-tile affine transform, so computing pins there is real work,
not a one-line change; it was scoped out rather than attempted alongside the
plain-text fix. See "Deferred, not forgotten" below.

**Marks break adjacency, so pairing skips them (2026-08-13).** The first
implementation paired shaped glyphs `i` and `i+1`. HarfBuzz emits every
tashkeel mark as its own glyph *between* the base letters it attaches to,
so a single harakah destroyed the adjacency of the two letters around it
and the run produced no pins at all — measured against real shaping,
`حَرْف` in Amiri went from 2 pins to 0 and `مُحَمَّد` from 4 to 0, in both
TahaNaskh and Amiri. With an إعراب keyboard, a diacritics subsystem and a
per-mark canvas overlay in the app, vocalized Arabic is a core use case,
so a join feature that silently switched off on it did not deliver the
goal at the top of this document.

`computeJoinPins` now pairs each base glyph with the **next base glyph**,
passing over marks. A mark receives no pin of its own — it floats above
the baseline and is not what tears. Marks are identified by
`lib/diacritics.ts`'s `findDiacriticGlyphIndices`, the app's single mark
detector (tested against real HarfBuzz output for real fonts); a second
detector here would be a second thing to keep true, and the obvious
hand-rolled approach — cluster-to-source-character lookup — provably
detects nothing, as that module's header explains. The consequence worth
carrying into the next design pass: **join-pin coverage on vocalized text
is bounded by that detector's accuracy**, so anything that widens it (the
GDEF-class signal noted below) widens join detection too.

**Detection coverage, measured 2026-08-13
(`src/lib/joinPins.fonts.test.ts`).** 7 fonts (TahaNaskhRegular, Amiri,
Thuluth, Kufi, Urdu, FatemiMaqala, Kufi2) × 6 words — four connected
(`حرف`, `بسم`, `كتب`, `سلام`) and two vocalized (`حَرْف`, `مُحَمَّد`) = 42
pairs, shaped with real harfbuzzjs against the real fonts. The 0px
displacement-at-a-pinned-join invariance held for every join that was
detected. 9 of 42 pairs detected no join, in three distinct categories,
confirmed by independently re-shaping and counting glyphs. (The matrix was
5 fonts × 6 words when first measured; `FatemiMaqala` and `Kufi2` were
added 2026-08-13 and both detect a join on all six words. A fourth
category — the mark detector flagging a real letter — was found in that
pass and fixed, so it no longer produces a `false` entry; it is documented
below because the guard that closed it must not be removed.)

- **Correct-by-design (2 pairs):** `Urdu/بسم` and `Urdu/كتب` each shape to a
  single glyph — the font fuses the letters via GSUB. No glyph boundary
  means no seam to tear, so "no pin" is the right answer, not a gap.
- **A real, currently-inert gap (5 pairs):** `Urdu/حرف`, `Urdu/سلام`,
  `Urdu/حَرْف`, `Urdu/مُحَمَّد` and `Thuluth/سلام` shape to multiple glyphs
  whose ink genuinely does not
  overlap — those letters abut rather than overlap, so `overlapCentroid`
  correctly finds nothing and the join stays unpinned. This is not a
  regression: those joins have exactly the pre-existing tearing behaviour
  this whole feature exists to fix, just not yet fixed for this geometry.
  See "Deferred, not forgotten" for why this was not improvised with a
  dilation radius.
- **The mark detector cannot see the font's marks (2 pairs):**
  `Thuluth/حَرْف` and `Thuluth/مُحَمَّد`. `Thuluth.ttf` maps its shaped mark
  glyphs into the *Private Use Area* (U+E012 and U+E016 observed for fatha
  and sukun) rather than U+064B–U+065F, and positions them by advance with
  `dx === dy === 0` instead of by GPOS — defeating both signals
  `findDiacriticGlyphIndices` uses. Its marks therefore read as base
  letters, break the pairing, and the font behaves exactly as it did
  before the mark-skipping fix; its unvocalized words are unaffected. Note
  this is the *same* blind spot that already stops the per-mark diacritic
  overlay arming on Thuluth, i.e. one detector fix would resolve two
  features. See "Deferred, not forgotten".
- **The mark detector flags a real letter (0 pairs — found and fixed
  2026-08-13):** the mirror image of the case above, and the reason
  `computeJoinPins` treats a glyph as a mark only when the detector flags it
  **and** its advance is zero. `FatemiMaqala.ttf` emits `dx` values of 1–4
  units out of an upem of 2048 — shaper rounding noise — on ordinary
  letters, which the detector's cluster-plus-nonzero-`dx` fallback reads as
  mark attachment. Measured on unvocalized `كتب`: glyphs 2 (`gid1549`,
  dx=1, ax=263) and 3 (`U+FEDB` kaf initial, dx=4, ax=584) were both
  flagged, dropping the pinned set from `[0,1,2,3]` to `[0,1]`; `مُحَمَّد`
  lost every pin (`[0,3,6]` → `[]`). A genuine mark takes no horizontal
  space of its own and so cannot participate in a join, while a letter
  always advances the pen — across the 17-font corpus measured for this
  branch, every true mark had `ax === 0` and every false positive carried a
  real advance. The guard is deliberately local to join pairing;
  `lib/diacritics.ts` is shared with the per-mark canvas overlay and was
  left untouched.

Adding `Kufi2` also confirmed a *gain* the mark-skipping change had made
outside the original matrix: that face decomposes its nuqat into separately
positioned GPOS mark glyphs, so a dot glyph sits between two letters and
severs their adjacency under raw-neighbour pairing. Measured at FONT_SIZE
200, `Kufi2/بسم` goes from 2 pinned glyphs to 3 and `Kufi2/كتب` from 2 to 3
once marks are skipped.

## Repro notes

- `npm run dev`, default text `حرف` at 275% zoom.
- Cleft: select block → Morph Glyph Editor → ra → stretch handle → drag
  down-left. Gap appears at the hah/ra junction.
- Konva's hover-mounted handles do not take scripted drags reliably — drive
  by hand.
