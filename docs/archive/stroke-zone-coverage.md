# Straight-stroke cut-zone coverage sweep

Date: 2026-08-21 (revised same day, three times, after independent review —
see "Revision history" at the bottom; every review reproduced the underlying
measurements byte-for-byte and found the metrics or the prose needed fixing,
never the detector or the raw geometry numbers).

> **Superseded in part, 2026-08-21 (fourth pass).** Everything from
> "Methodology" to "Verdict against the gate" measures the *baseline-relative*
> predicate — cuts perpendicular to the baseline, legality judged by each
> crossed segment's slope against the baseline. That predicate was diagnosed
> as conflating two opposite defects behind one `maxSlope` knob and has been
> replaced. The current numbers are under
> "Second pass: the axis-relative predicate" at the bottom of this file; the
> tables above are kept as the record of what the original predicate did, not
> as a description of the detector as it now stands.

**This file is the single home for the gate numbers.** `CLAUDE.md`,
`PROGRESS.md` and the plan file link here rather than repeating the tables —
duplicating the same numbers in four files is exactly what let two of them
go stale (see the third revision below).

This is Task 3 of the straight-stroke-extension plan — the go/no-go gate.
`src/lib/strokeCuts.ts` (Tasks 1–2) is a pure geometric detector that walks a
glyph outline and reports `CutZone`s: x-ranges where a vertical cut is
"legal" (crossings roughly parallel to the baseline, consistent ink
thickness across the run). This sweep measures whether that detector finds
anything on the 17 fonts actually bundled with the app, via
`scripts/measureStrokeZones.mjs`, which imports the real detector — no
reimplementation.

## Methodology

28 base Arabic letters shaped in isolation, plus five short words (`حرف`,
`محمد`, `بسم`, `سلام`, `كتاب`) shaped together, none of which carry tashkeel.
Per-font `DetectOpts` scale `step` and `minZoneWidth` to each font's own
`unitsPerEm` (`step = upm/100`, `minZoneWidth = upm/40`), so the sweep is
resolution-independent; `maxSlope` and `thicknessTolerance` (fixed at 0.12
across every run in this document — the brief authorizes tuning `maxSlope`
only, and this value was never changed to chase a number) are the same
across fonts.

Outline curves are flattened by `flattenContours` at a **fixed 8 subdivision
steps per bezier command, regardless of a font's `unitsPerEm`** — the same
subdivision `pathToPolygon` already uses elsewhere in this codebase. This is
worth stating plainly because it is the first objection a future reader will
raise against a negative result: could coarse flattening on a high-upm font
(Scheherazade ships at 2048 upm) be manufacturing false slope readings on a
curve, rather than the curve genuinely defeating `maxSlope`? The bias runs
the other way — a chord across one subdivision of a bezier segment reports
that segment's *average* slope, which for a smooth curve is generally
shallower than the curve's own steepest instantaneous slope somewhere inside
that segment. Coarser flattening therefore tends to make a curve read
*flatter*, not steeper, so 8-step flattening is biased toward *finding* more
zones on curved letters than a finer subdivision would, not fewer. The
spot-check's rejections (below) are read directly off these same 8-step
samples, so they are not an artifact of the flattening being too coarse to
see the curve — if anything, a finer flattening would reject more.

Three coverage numbers are reported per font, and they are kept separate
because they measure different populations and none of them predicts the
others:

- **isolated%** — fraction of the 28 base letters, shaped one at a time,
  that carry at least one zone anywhere in their outline. This is what the
  brief's own script measured.
- **contextual%** — fraction of glyphs, across the five shaped test words,
  that carry a zone *anywhere* in their own outline. Not the same
  population as isolated% — a letter's outline through shaping (joining
  forms, ligatures) differs from its isolated form — and **not** a
  connector/join metric either: a zone in the middle of a bowl counts here
  exactly as much as one sitting at a join.
- **join%** — the real connector metric, and reported as **two columns**
  because they score against two different populations, and the difference
  matters. For each adjacent **letter** pair in a shaped word, both columns
  check the same thing — whether a zone sits near the *shared join edge*:
  the earlier letter's trailing pen-edge (its own local x at its advance
  width) or the later letter's leading pen-edge (its own local x at 0),
  within a fixed **join window** of 5 sample steps (`JOIN_WINDOW_STEPS = 5`,
  i.e. `upm/20`) — wide enough to tolerate a letter's own side bearing at
  the join without accepting a zone that is really just "somewhere in the
  glyph." The window was fixed before any of the numbers below were seen
  and was never adjusted after seeing them. **Zero-advance glyphs are
  excluded when pairing** — an i'jam dot component or other mark attachment
  has `ax === 0`, which would collapse its own trailing and leading edges
  onto the same point and make the edge arithmetic meaningless (a mark's
  real offset lives in `dx`, which this metric never reads) — so each
  letter is paired with its next non-zero-advance neighbour, skipping over
  any mark glyphs sitting between them.

  The two columns differ only in their **denominator**:
  - **join (all adjacent pairs)** divides by every such letter-pair the
    corpus produces — 10–13 per font. This is the population the script has
    always used, kept here for continuity.
  - **join (tatweel-legal)** — what the design doc's gate actually
    specifies ("connector zones at ≥80% of the positions where a tatweel is
    currently legal") — restricts the denominator to the subset of those
    pairs where `findKashidaSlots` (`src/lib/tatweel.ts`, the app's own
    authority on where a tatweel may legally be inserted) reports a legal
    join. These are not the same population: of the corpus's 10–13 adjacent
    pairs, only 7–9 per font are tatweel-legal joins. A pair like ر-ف in
    حرف, ل-ا or ا-م in سلام, or ا-ب in كتاب is an adjacent glyph pair with no
    connector a tatweel could ever occupy — ا and ل are not letters a
    straight-stroke connector mechanism could act on either, since nothing
    joins across them — so counting them as "uncovered joins" understates
    real coverage against what the gate is actually asking about. The two
    populations were conflated in an earlier draft of this document; see the
    third revision below for how that was found and fixed, and why the
    conclusion did not change.

**Corpus size.** Five short test words yield only 10–13 letter-join slots
per font once zero-advance glyphs are excluded (`Urdu.ttf` yields just 3,
its heavy ligation collapsing five words to 8 glyphs total), and 7–9 of
those are tatweel-legal joins per font (`Urdu.ttf` has 0 — none of its 3
adjacent pairs is a legal tatweel slot). A single slot flipping moves most
fonts' join% by roughly 8–14 points on either denominator, and Urdu's by 33
on the all-pairs one — so differences of a few points between fonts are
noise, not signal. Read join% as "clearly clears 80%," "clearly doesn't," or
"unclear," never as a fine-grained ranking between two nearby fonts.

## Baseline: `DEFAULT_DETECT_OPTS` as shipped (`maxSlope = 0.18`)

Reproduce with: `npx --yes tsx scripts/measureStrokeZones.mjs`

| Font | isolated | zones | median zone (em) | contextual | join (all pairs) | join (tatweel-legal) |
|---|---|---|---|---|---|---|
| AlFatemi.otf | 36% | 10 | 0.050 | 7% | 0% | 0% (n=7) |
| Amiri.ttf | 64% | 20 | 0.080 | 22% | 0% | 0% (n=9) |
| FatemiMaqala.ttf | 32% | 9 | 0.060 | 29% | 33% | 25% (n=8) |
| HarfCanvasDiwani.ttf | 0% | 0 | - | 18% | 25% | 33% (n=9) |
| Kufi.ttf | 54% | 19 | 0.070 | 94% | 83% | 100% (n=9) |
| Kufi2.ttf | 68% | 29 | 0.090 | 77% | 75% | 100% (n=9) |
| Lateef.ttf | 43% | 12 | 0.050 | 41% | 33% | 44% (n=9) |
| NotoSans.ttf | 71% | 29 | 0.120 | 55% | 62% | 89% (n=9) |
| Qahiri.ttf | 75% | 27 | 0.140 | 48% | 42% | 56% (n=9) |
| Ruqaa.ttf | 46% | 13 | 0.050 | 18% | 8% | 11% (n=9) |
| Scheherazade.ttf | 54% | 15 | 0.090 | 94% | 75% | 100% (n=9) |
| TahaNaskhRegular.ttf | 50% | 15 | 0.060 | 81% | 73% | 100% (n=8) |
| Thuluth.ttf | 61% | 17 | 0.060 | 44% | 36% | 38% (n=8) |
| ThuluthDeco.ttf | 29% | 8 | 0.030 | 38% | 27% | 38% (n=8) |
| Urdu.ttf | 32% | 13 | 0.180 | 13% | 0% | 0% (n=0) |
| Wessam.ttf | 54% | 18 | 0.120 | 47% | 50% | 57% (n=7) |
| Yekan.ttf | 57% | 21 | 0.090 | 94% | 83% | 100% (n=9) |

(Four fonts move on the `join (all pairs)` column relative to an earlier
draft of this sweep, once zero-advance glyphs are excluded from join
pairing: NotoSans 59%→62%, Kufi2 65%→75%, Qahiri 31%→42%, Ruqaa 6%→8%. The
other thirteen fonts — Amiri, Scheherazade and Kufi among them — carry no
zero-advance glyphs in this corpus and are unaffected. No gate cell flips.)

**Gate fonts** (Amiri, Scheherazade, NotoSans, Kufi — `Kufi.ttf`, the font
registered as `"Kufi"` in `FONT_URLS`/`FONT_OPTIONS`; `Kufi2.ttf` is a
separate second font and not the one named in the gate), against the actual
requirements (isolated ≥ 60%, join ≥ 80%) and against **the design doc's own
denominator** — join coverage over tatweel-legal positions, not every
adjacent pair:

| Font | isolated (need ≥60%) | join, all pairs (need ≥80%) | join, tatweel-legal (need ≥80%) |
|---|---|---|---|
| Amiri | 64% ✅ | 0% ❌ | 0% ❌ (n=9) |
| Scheherazade | 54% ❌ | 75% ❌ | 100% ✅ (n=9) |
| NotoSans | 71% ✅ | 62% ❌ | 89% ✅ (n=9) |
| Kufi | 54% ❌ | 83% ✅ | 100% ✅ (n=9) |

**Against the gate's own denominator, NotoSans clears both thresholds
already at baseline.** Three of the four gate fonts (Scheherazade, NotoSans,
Kufi) clear the join bar outright once it is measured over tatweel-legal
positions rather than every adjacent pair — Amiri is the one font whose join
score is genuinely low by either measure. Scheherazade and Kufi still miss
on isolated coverage at baseline, so the four-way gate is not met here, but
the shape of the failure is different from what an all-pairs join reading
suggests: this is not a join problem for three of the four fonts. Per the
brief, a failed gate is grounds to try `maxSlope` at 0.25 and then 0.35
before concluding either way.

## Tuning attempt 1: `maxSlope = 0.25`

Reproduce with: `npx --yes tsx scripts/measureStrokeZones.mjs --maxSlope=0.25`

| Font | isolated | zones | median zone (em) | contextual | join (all pairs) | join (tatweel-legal) |
|---|---|---|---|---|---|---|
| AlFatemi.otf | 46% | 14 | 0.050 | 20% | 10% | 14% (n=7) |
| Amiri.ttf | 57% | 22 | 0.090 | 28% | 0% | 0% (n=9) |
| FatemiMaqala.ttf | 43% | 12 | 0.090 | 29% | 25% | 25% (n=8) |
| HarfCanvasDiwani.ttf | 4% | 1 | 0.050 | 24% | 25% | 33% (n=9) |
| Kufi.ttf | 71% | 28 | 0.070 | 94% | 83% | 100% (n=9) |
| Kufi2.ttf | 61% | 28 | 0.090 | 59% | 58% | 78% (n=9) |
| Lateef.ttf | 39% | 13 | 0.060 | 53% | 58% | 78% (n=9) |
| NotoSans.ttf | 89% | 34 | 0.140 | 64% | 69% | 100% (n=9) |
| Qahiri.ttf | 46% | 17 | 0.100 | 43% | 50% | 56% (n=9) |
| Ruqaa.ttf | 46% | 15 | 0.120 | 36% | 31% | 44% (n=9) |
| Scheherazade.ttf | 46% | 16 | 0.090 | 88% | 75% | 100% (n=9) |
| TahaNaskhRegular.ttf | 57% | 21 | 0.070 | 81% | 73% | 100% (n=8) |
| Thuluth.ttf | 54% | 16 | 0.090 | 50% | 36% | 38% (n=8) |
| ThuluthDeco.ttf | 29% | 8 | 0.060 | 44% | 27% | 38% (n=8) |
| Urdu.ttf | 32% | 13 | 0.180 | 13% | 0% | 0% (n=0) |
| Wessam.ttf | 54% | 16 | 0.340 | 53% | 50% | 71% (n=7) |
| Yekan.ttf | 64% | 28 | 0.080 | 100% | 83% | 100% (n=9) |

Gate cells (isolated / join all-pairs / join tatweel-legal): Amiri
**57% ❌ / 0% ❌ / 0% ❌**, Scheherazade **46% ❌ / 75% ❌ / 100% ✅**,
NotoSans **89% ✅ / 69% ❌ / 100% ✅**, Kufi **71% ✅ / 83% ✅ / 100% ✅**. On
the all-pairs reading only Kufi clears both — one of four. On the design
doc's own tatweel-legal denominator, **both NotoSans and Kufi clear both** —
two of four — and Scheherazade's join score alone (100%) is no longer what
is holding it back; its isolated score (46%) still is.

## Tuning attempt 2: `maxSlope = 0.35` (the brief's hard ceiling)

Reproduce with: `npx --yes tsx scripts/measureStrokeZones.mjs --maxSlope=0.35`

| Font | isolated | zones | median zone (em) | contextual | join (all pairs) | join (tatweel-legal) |
|---|---|---|---|---|---|---|
| AlFatemi.otf | 29% | 10 | 0.080 | 40% | 10% | 14% (n=7) |
| Amiri.ttf | 57% | 23 | 0.120 | 44% | 38% | 56% (n=9) |
| FatemiMaqala.ttf | 50% | 16 | 0.050 | 59% | 42% | 50% (n=8) |
| HarfCanvasDiwani.ttf | 11% | 3 | 0.050 | 29% | 33% | 44% (n=9) |
| Kufi.ttf | 86% | 34 | 0.060 | 94% | 83% | 100% (n=9) |
| Kufi2.ttf | 64% | 30 | 0.100 | 59% | 67% | 78% (n=9) |
| Lateef.ttf | 32% | 12 | 0.070 | 65% | 67% | 89% (n=9) |
| NotoSans.ttf | 79% | 37 | 0.120 | 73% | 69% | 100% (n=9) |
| Qahiri.ttf | 46% | 17 | 0.110 | 43% | 50% | 56% (n=9) |
| Ruqaa.ttf | 46% | 15 | 0.090 | 27% | 31% | 44% (n=9) |
| Scheherazade.ttf | 32% | 13 | 0.130 | 88% | 75% | 100% (n=9) |
| TahaNaskhRegular.ttf | 57% | 23 | 0.080 | 81% | 73% | 100% (n=8) |
| Thuluth.ttf | 61% | 23 | 0.080 | 56% | 36% | 38% (n=8) |
| ThuluthDeco.ttf | 36% | 11 | 0.050 | 50% | 27% | 38% (n=8) |
| Urdu.ttf | 21% | 7 | 0.110 | 13% | 0% | 0% (n=0) |
| Wessam.ttf | 46% | 21 | 0.130 | 73% | 60% | 86% (n=7) |
| Yekan.ttf | 71% | 34 | 0.060 | 100% | 83% | 100% (n=9) |

Gate cells (isolated / join all-pairs / join tatweel-legal): Amiri
**57% ❌ / 38% ❌ / 56% ❌**, Scheherazade **32% ❌ / 75% ❌ / 100% ✅**,
NotoSans **79% ✅ / 69% ❌ / 100% ✅**, Kufi **86% ✅ / 83% ✅ / 100% ✅**. Same
pattern as 0.25: on the all-pairs reading only Kufi clears both; on the
tatweel-legal reading both NotoSans and Kufi do. `maxSlope: 0.35` is the
brief's stated ceiling, so tuning stops here.

**Across all three tested values, measured against the design doc's own
tatweel-legal denominator, NotoSans clears both thresholds at every tested
value including baseline, and Kufi clears both at the two loosened settings
(not at baseline, where its isolated score is 54%). Amiri and Scheherazade
never both clear at any tested value — but not for the same reason.**
Scheherazade's join score is 100% at every tested value; what keeps it out
is its isolated score, which never reaches the 60% bar and gets *worse*, not
better, as `maxSlope` loosens (54% → 46% → 32%) — see the curved-letter
spot-check below for why: a looser slope threshold lets crossings inside a
shallow curve pass, which can bridge two previously-separate straight runs
across a curved dip between them; the merged run's thickness then varies
more than `thicknessTolerance` allows and the whole merged run is rejected,
losing zones a tighter tolerance had kept. Amiri is the opposite case: its
isolated score is fine at baseline (64%) but its join score is the one
genuinely low join reading in this whole sweep (0% / 0% / 56% across the
three settings, on the tatweel-legal denominator) — checked directly below
and confirmed a real property of the font, not a measurement artifact.
Because the gate requires all four fonts to clear at once, it is not met at
any tested value — but the reason is now clearly the letterform-internal
half (isolated coverage), not the join half, for three of the four fonts.

## Curved-letter spot-check (reproducible: `--spotCheck`)

Run with `npx --yes tsx scripts/measureStrokeZones.mjs --spotCheck` (add
`--maxSlope=N` to restrict to one value; without it, both 0.18 and 0.35 are
checked). This is the script producing the samples below directly — nothing
here is hand-transcribed.

Checked ن, ح, and س in isolation across the four gate fonts, at both
`maxSlope = 0.18` (baseline) and `maxSlope = 0.35` (the ceiling), printing
each reported zone's position relative to the glyph's own width and the
actual sampled `crossingsAt` slopes at five points inside it.

**At `maxSlope = 0.18` (baseline):**
- Amiri `ن`, Scheherazade `ن`/`ح`, NotoSans `ح`, Kufi `ن` — no zone found at
  all on these curved letters.
- Where a zone is found (Amiri `ح`/`س`, Scheherazade `س`, NotoSans `ن`/`س`,
  Kufi `ح`/`س`), the sampled slopes inside it stay modest — roughly
  ±0.05–0.17, i.e. within or close to the 0.18 cap by construction — mostly
  consistent with a genuinely near-vertical segment (a tooth or stem), not a
  curve apex. Kufi `ح`'s zone (rel. x 0.43–0.49) has the widest swing among
  these — the spot-check prints **six** simultaneous crossings at each
  sample point there (three ink spans rather than one), the least clean of
  the baseline examples but still bounded by the cap.

**At `maxSlope = 0.35` (ceiling), the same letters look different:**
- Amiri `س` now reports *three* zones, one at rel. x 0.89–0.94 — the tail
  curl — where sampled slopes swing from +0.322 down to -0.058 across the
  zone: the outline is visibly curving through that x-range, not running
  flat.
- Scheherazade `ن` now reports a zone at rel. x 0.28–0.34 (the hook) with
  slopes sweeping +0.337 → +0.123 — a curve, not a flat run, sitting almost
  exactly where the letter's hook departs from the bowl.
- NotoSans `س` now reports zones with slopes sweeping as wide as +0.35 →
  -0.30 within a single zone (rel. x 0.17–0.35).
- Kufi `ن` now reports a zone at rel. x 0.46–0.53 where two of its crossings
  each sweep through zero across the zone's width — one runs -0.342 → +0.228
  from the zone's start to its end, the other +0.342 → -0.228 — rather than
  either one holding steady near zero throughout. That is the slope passing
  through zero at a curve's own vertex, a classic false-flat, not a flat run
  read at two different points.

This is a real, structural failure mode, not a coincidence of these three
letters: loosening `maxSlope` measurably buys zones on ن's hook and س's tail
curl — exactly the letters the brief named as the ones to watch — in three
of the four gate fonts. It is the detector lying, and it is why this report
does **not** adopt 0.25 or 0.35 even though Kufi numerically clears the gate
at both.

## Note on an earlier (fixed) mismeasurement

The first version of this sweep (and of this record) reported a
`connectorPct` computed as "glyphs anywhere in a word with a zone" divided
by `glyphs.length - 1`, which is two different populations wearing one
label — hence readings such as 133% for Scheherazade and Kufi, and 142% for
Yekan, none of which is possible for a real percentage. That column has
been replaced by the properly separated **contextual%** (same numerator
population, honestly labeled as "anywhere in the glyph," bounded 0–100%
since its own denominator now matches its numerator) and **join%** (a new,
correctly windowed measurement, also bounded 0–100% by construction — no
tuned setting in this document ever produces a value over 100%). The first
version of this record also attributed the >100% readings to diacritic
glyphs inflating the numerator; that was incorrect on inspection — none of
the five test words carries tashkeel, and the only mark-like glyphs present
(NotoSans's dot components, ~99×99 units against a `minZoneWidth` of ~25
units, i.e. a legal window of only ~17 units, just under the bar) never
carry a zone, so they *depress* the old numerator relative to the
denominator rather than inflate it. The real cause was purely the
numerator/denominator population mismatch described above.

## Note on glyph resolution

`zonesForGlyph` in the script now throws (naming the font file and the
unresolved glyph id) if `opentype.js` cannot resolve a glyph id HarfBuzz
returned, rather than silently treating it as zone-free. A silent `[]`
would have quietly depressed every coverage number derived from that glyph
instead of failing the run — the wrong failure mode for a measurement
script. This does not fire on any of the 17 bundled fonts as of this
writing; a clean run of the sweep is itself evidence every glyph id in this
corpus resolved.

## Verdict against the gate

**The isolated-letter number alone already rules out a passing gate,
independent of any tuning choice.** Scheherazade's isolated coverage — 54%
at baseline, 46% at `maxSlope = 0.25`, 32% at `maxSlope = 0.35` — never
reaches the 60% bar at any of the three tested settings, and it gets worse,
not better, the more the slope tolerance is loosened. No value in the
brief's authorized tuning range fixes this; going past the 0.35 ceiling is
out of scope.

**The join half, measured against the design doc's own denominator, mostly
works — and that is precisely why it does not save the gate.** An earlier
draft of this record measured join coverage over *every adjacent glyph
pair*, which is not what the gate specifies ("connector zones at ≥80% of the
positions where a tatweel is currently legal") and is a strictly harder
population — a pair like ر-ف in حرف has no connector for this feature to act
on at all, since no tatweel could ever legally sit there. Restricted to the
right denominator, join coverage reaches **100% for Scheherazade, 89–100%
for NotoSans, and 100% for Kufi** at baseline, and stays at or near 100% for
all three across the whole tuning range. **Amiri is the one genuine outlier**
— 0% at baseline, 0% at 0.25, 56% at the ceiling — checked directly and
confirmed a real property of the font, not a measurement artifact: its four
detected zones at `maxSlope = 0.18` sit at least 128 font units from the
nearest join edge, more than 2.6× the `upm/20` join window, and the same
code gives Amiri 56% at `maxSlope = 0.35`, so the metric does respond when
the font's own geometry supports it. So the join half of this feature is not
the reason the gate fails for three of the four fonts — the letterform-
internal half (isolated coverage) is: Scheherazade never clears its own bar,
Kufi clears it only at the two loosened settings the spot-check disqualifies
above, and Amiri's isolated score, while it clears 60% at baseline, is not
what carries the font through the *whole* four-way gate since its own join
score is what fails there instead. No single setting clears isolated *and*
join on all four gate fonts at once.

**This also means the join half would not have been the valuable part to
ship anyway, even if the gate had passed on it alone.** Kashida elongation
already covers the connector case in every bundled font today, by inserting
a tatweel — a real character the font shapes at its own designed weight (see
CLAUDE.md, "Kashida elongation"). A straight-stroke connector mechanism
reaching 89–100% coverage on three fonts would be a second, more complex way
to do something the app can already do everywhere. The half that would have
been genuinely new — stretching a stroke *inside* a letterform, which
tatweel cannot touch — is the half whose own coverage number is what
actually keeps the gate from passing. That is a cleaner reason to stop than
"the join case doesn't work": the join case mostly does work, and duplicates
existing coverage; the letterform case would have been new, and does not
work.

**`DEFAULT_DETECT_OPTS` is left unchanged** (`maxSlope: 0.18`, already in
`src/lib/strokeCuts.ts`) — no edit was made to that file. The corrected
join numbers do not change this choice, for two independent reasons: first,
Scheherazade's isolated coverage — the metric actually blocking the gate for
that font — never reaches 60% in the brief's authorized tuning range
regardless of which join denominator is used; second, the curved-letter
spot-check above shows *why* 0.25/0.35 should not be trusted even where they
numerically help (Kufi's isolated score, NotoSans's), independent of the
join numbers entirely. At every tested value, the four-way gate is not met.
Diwani, Ruqaa, and Thuluth score low across all three runs as expected and
are not part of the gate.

Per the plan, this was a stop-and-report point: a human reviewed this
measurement and decided not to proceed. Tasks 4–10 were never started. See
`docs/superpowers/plans/2026-08-21-straight-stroke-extension.md` and
CLAUDE.md, "Straight-stroke cut detection" for that decision
and its consequences.


## Second pass: the axis-relative predicate (2026-08-21)

The stop recorded above was correct for the predicate it measured. That
predicate has since been replaced — see the "Amendment: axis-relative cuts"
section of
`docs/superpowers/specs/2026-08-21-straight-stroke-extension-design.md` for
the argument. Two changes, addressing two defects the single `maxSlope` knob
could not separate:

- **Parallelism is judged against the stroke's own axis.** Detection sweeps a
  candidate angle (+/-35 degrees, 5-degree resolution); at each angle the
  outline is rotated into that frame and the same crossing/legality/zone code
  runs unchanged. An inclined stem is horizontal in its own frame and passes
  at the shipped `maxSlope` of 0.18 with nothing loosened. One stroke found
  at several neighbouring angles is deduplicated to its best-fitting angle.
- **Straightness is measured as bow away from a chord, per edge**
  (`maxEdgeBow`, a fraction of the stroke's own thickness), replacing the
  earlier per-segment slope-drift idea. `flattenContours` turns every curve
  into 8 straight segments, so consecutive samples land on segments whose
  slopes differ discretely; a slope-drift test reads that quantization as
  curvature and throws away real strokes. Crossing *positions* carry the
  signal without the quantization. Per edge rather than averaged, because a
  stroke that bows symmetrically moves its two edges in opposite directions
  and a mean cancels it out.

### Shipped settings

`maxSlope: 0.18` (unchanged), `maxEdgeBow: 0.015`, `maxAngle: 35 degrees`,
`angleStep: 5 degrees`. Reproduce with
`npx --yes tsx scripts/measureStrokeZones.mjs`; `--baselineOnly` restores
vertical-only detection and `--maxEdgeBow=` / `--maxAngleDeg=` /
`--angleStepDeg=` override the new knobs.

| Font | isolated letters | zones | median zone (em) | contextual | join (all adjacent pairs) | join (tatweel-legal slots) |
|---|---|---|---|---|---|---|
| AlFatemi.otf | 64% | 39 | 0.030 | 53% | 30% | 43% (n=7) |
| Amiri.ttf | 86% | 78 | 0.050 | 78% | 31% | 44% (n=9) |
| FatemiMaqala.ttf | 75% | 47 | 0.040 | 71% | 42% | 38% (n=8) |
| HarfCanvasDiwani.ttf | 11% | 3 | 0.030 | 41% | 50% | 67% (n=9) |
| Kufi.ttf | 82% | 83 | 0.050 | 100% | 92% | 100% (n=9) |
| Kufi2.ttf | 68% | 55 | 0.060 | 77% | 75% | 100% (n=9) |
| Lateef.ttf | 75% | 45 | 0.030 | 76% | 67% | 89% (n=9) |
| NotoSans.ttf | 79% | 60 | 0.040 | 77% | 77% | 100% (n=9) |
| Qahiri.ttf | 93% | 62 | 0.090 | 67% | 92% | 100% (n=9) |
| Ruqaa.ttf | 75% | 54 | 0.050 | 82% | 62% | 89% (n=9) |
| Scheherazade.ttf | 75% | 50 | 0.040 | 94% | 75% | 100% (n=9) |
| TahaNaskhRegular.ttf | 89% | 63 | 0.040 | 94% | 73% | 100% (n=8) |
| Thuluth.ttf | 71% | 36 | 0.040 | 81% | 73% | 75% (n=8) |
| ThuluthDeco.ttf | 79% | 48 | 0.030 | 69% | 64% | 75% (n=8) |
| Urdu.ttf | 68% | 37 | 0.040 | 88% | 0% | 0% (n=0) |
| Wessam.ttf | 54% | 27 | 0.040 | 60% | 40% | 43% (n=7) |
| Yekan.ttf | 93% | 81 | 0.050 | 94% | 83% | 100% (n=9) |

### Verdict against the same gate

The gate is unchanged: the four naskh/kufi faces must clear isolated-letter
coverage >=60% **and** join coverage >=80% (on the design doc's own
denominator, positions where a tatweel is currently legal) **at once**.

| Gate font | isolated (>=60%) | join, tatweel-legal (>=80%) |
|---|---|---|
| Amiri | 86% PASS | 44% **FAIL** |
| Scheherazade | 75% PASS | 100% PASS |
| NotoSans | 79% PASS | 100% PASS |
| Kufi | 82% PASS | 100% PASS |

**The half that failed structurally now passes on every gate font.**
Isolated-letter coverage was the blocker: Scheherazade never reached 60% at
any authorized setting and got *worse* as the tolerance loosened (54% ->
46% -> 32%). It now reads 75%, and the whole four-font isolated column
clears the bar. This is the letterform-internal capability — stretching a
stroke *inside* a letter, which tatweel structurally cannot touch — and it
is the genuinely new thing this feature was for.

**The remaining failure is Amiri's join coverage, and it is the same outlier
the first pass identified.** 44% here against 0/0/56% before; the first pass
checked it directly and confirmed it a real property of where Amiri's zones
sit relative to its joins, not a metric artifact. It is also the half that
duplicates tatweel kashida, which already covers connectors in every bundled
font.

So the gate as literally written does not pass. It fails on one font, on the
metric that was never the point, while the metric that *was* the point passes
on all four.

### Sensitivity

Unlike `maxSlope`, whose numbers flipped wildly across its authorized range,
`maxEdgeBow` is stable — the four gate fonts' isolated column moves only a
few points across a seven-fold change, and the join column not at all:

| `maxEdgeBow` | Amiri iso / join | Scheherazade | NotoSans | Kufi |
|---|---|---|---|---|
| 0.015 (shipped) | 86% / 44% | 75% / 100% | 79% / 100% | 82% / 100% |
| 0.025 | 89% / 44% | 89% / 100% | 89% / 100% | 82% / 100% |
| 0.04 | 89% / 44% | 89% / 100% | 89% / 100% | 82% / 100% |
| 0.10 | 89% / 44% | 89% / 100% | 89% / 100% | 82% / 100% |

That stability is the evidence the predicate is measuring the intended
property rather than being fitted to it. The shipped value is the *tightest*
of these, not the most generous: 0.015 was chosen because it is the loosest
setting at which the curved-letter spot-check below stays clean.

### Curved-letter spot-check (reproducible: `--spotCheck`)

The first pass named three specific false flats. At the shipped settings:

- **Kufi noon** — no zones. Was the headline false flat (two crossings each
  sweeping through zero across the zone's width). Gone.
- **Scheherazade noon** — no zones. Gone.
- **Amiri seen** — no zones at `maxEdgeBow` 0.015 or 0.02. At 0.025 it
  returns, marginally (bow ~2.3 units against a 2.64 limit), which is what
  fixed the shipped value at 0.015 rather than 0.025.

**One known residue:** NotoSans seen still reports a 40-unit zone at
x=[700,740] whose two edges sweep 0.141 -> -0.121 and 0.094 -> -0.091 — a
tooth's vertex, accepted because over so short a span its bow (~1.3 units)
sits right at the 1.23-unit limit. It is a genuine false positive, bounded
and short rather than systematic. Raising `minZoneWidth` above its current
`upm/40` would remove this class, and is independently defensible — a handle
on a 40-unit stroke is not much use — but it was not changed here, because
doing so alters every number in the table above and this record should
report one predicate change at a time.

## Revision history

- **2026-08-21, first pass.** Baseline + two tuning tables using the
  brief's own `connectorPct` formula, and a spot-check performed but not
  committed as a reproducible script mode.
- **2026-08-21, this revision, after independent review.** The reviewer
  re-ran the sweep cold and reproduced every row and every spot-check slope
  sample byte-for-byte, confirming the underlying detector measurements
  were never in question. Five findings were about what two of the metrics
  *meant* and about the record's own arithmetic, all fixed here:
  `connectorPct` replaced by properly separated `contextual%`/`join%`
  columns measuring the two different things it used to conflate; an
  `isolated ≠ contextual` population gap called out explicitly rather than
  left implicit; the gate table's three wrong pass/fail cells (which had
  read the old >100% figures as passing) corrected; the incorrect
  diacritics explanation for the old >100% readings replaced with the real
  cause; and the spot-check made reproducible via `--spotCheck`. The
  conclusion — gate not met, `DEFAULT_DETECT_OPTS` unchanged — did not
  change, and is now better supported than before.
- **2026-08-21, second revision, after independent re-review.** All five
  prior findings were verified independently rather than taken on trust —
  the reviewer re-derived the join arithmetic by hand for several fonts,
  confirmed the pen-axis coordinate space is correct for RTL, swept the
  join window across seven values (0/1/2/5/10/20/40 steps) and found 5
  sits on a flat plateau rather than a knife edge, and confirmed Amiri's
  0% join reading is a genuine property of the font rather than a
  measurement bug. One residual finding, decision-neutral but fixed anyway
  because this record's own claim about its denominator was inaccurate for
  four fonts: zero-advance mark glyphs (i'jam dot components) were being
  paired as if they were joining letters, which both inflated the "number
  of joins" denominator with non-joins and asked a meaningless edge
  question about a glyph whose real position offset lives in `dx`, not in
  its (zero) advance. Fixed by excluding zero-advance glyphs from join
  pairing; affects `NotoSans.ttf` (59%→62% baseline, 65%→69% tuned),
  `Kufi2.ttf`, `Qahiri.ttf`, and `Ruqaa.ttf` — the other thirteen fonts,
  Amiri/Scheherazade/Kufi among them, carry no zero-advance glyphs in this
  corpus and are unaffected. No gate cell flips. Two smaller findings also
  addressed: `zonesForGlyph` now throws loudly (naming the font and glyph
  id) instead of silently treating an unresolvable glyph as zone-free; and
  a corpus-size limitation (10–13 join slots per font, 3 for Urdu) is now
  stated explicitly so a future reader does not mistake small differences
  between fonts for signal. The conclusion did not change and remains
  better supported.
- **2026-08-21, third revision, after a final whole-branch review.** This
  review found the code, tooling and reproducibility sound — every sweep and
  the `--spotCheck` still reproduce byte-for-byte — but found the *prose*
  had drifted from what the numbers actually say, in one critical and
  several important ways, all fixed here:
  - **The critical finding: `join%` was scored against the wrong
    population.** The design doc's gate specifies join coverage "at the
    positions where a tatweel is currently legal," and this record's own
    script instead denominated over every adjacent glyph pair — a strictly
    larger and different population (10–13 pairs vs. 7–9 tatweel-legal
    slots per font). `scripts/measureStrokeZones.mjs` now imports
    `findKashidaSlots` from `src/lib/tatweel.ts` directly and reports both
    denominators side by side, rather than reimplementing the join-legality
    logic. Restricted to the right denominator, join coverage turns out to
    be **89–100% in three of the four gate fonts** (Scheherazade, NotoSans,
    Kufi) — not the 62–83% the all-pairs reading showed. This does not
    reopen the stop decision (the gate still requires all four fonts to
    clear at once, and Amiri's join score and Scheherazade's isolated score
    still never both clear), but it inverts *why* the gate fails: the join
    half of the feature mostly works and duplicates coverage tatweel kashida
    already provides everywhere; the letterform-internal half is the one
    that does not work, and is the half that would have been genuinely new.
    The "Baseline"/"Tuning attempt" tables and gate cells, the Methodology's
    `join%` bullet, and the Verdict section were all rewritten around this;
    see the Verdict section for the corrected argument.
  - **A repeated false claim.** "Zero of the four gate fonts cleared both
    thresholds" was asserted in four files including this one; it was false
    even before the denominator fix — Kufi cleared both at 0.25 and 0.35
    under the *old* all-pairs reading too. Corrected to "at most one of four
    (Kufi) at 0.25/0.35, none at baseline" for the all-pairs reading, and
    the new tatweel-legal reading is now reported alongside it (up to two of
    four — NotoSans and Kufi — at the loosened settings, and NotoSans alone
    at baseline).
  - **Two numeric slips in the curved-letter spot-check**, both now fixed
    against the script's own literal output: Kufi ح's baseline zone prints
    six simultaneous crossings (three ink spans), not four; and Kufi ن's
    0.35 zone does not have "one pair of crossings swinging from -0.342 to
    +0.342" — it has two separate crossings, one running -0.342 → +0.228 and
    the other +0.342 → -0.228 across the zone's width.
  - **The Methodology section now states `thicknessTolerance = 0.12`
    explicitly** (previously implied but never written down) and explains
    that `flattenContours` subdivides at a fixed 8 steps per bezier
    regardless of a font's `unitsPerEm` — and why that biases *toward*
    finding zones on curves, not away, so it cannot explain the negative
    isolated-letter result.
  - The companion documents (`CLAUDE.md`, `PROGRESS.md`, the plan file, and
    `src/lib/strokeCuts.ts`'s own header) were brought into agreement with
    this file rather than left to restate its numbers, per this repo's own
    "state a fact once and link to it" rule — see their own edit history for
    the same date.
- **2026-08-21, fourth pass: the axis-relative predicate.** The stop was
  reviewed and the baseline-relative predicate replaced rather than retuned,
  after diagnosing it as conflating inclined-stem rejection with
  curve-vertex acceptance behind one knob. Detection now sweeps the stroke's
  own axis, and straightness is measured as per-edge bow away from a chord.
  Isolated-letter coverage — the half that structurally failed — now clears
  60% on all four gate fonts (75-86%). Amiri's join coverage remains the one
  gate failure. The earlier tables are kept above as the record of the old
  predicate. Unit coverage for the new predicate is in
  `src/lib/strokeCuts.test.ts`, including a synthetic case pinning why bow is
  measured per edge rather than averaged, and one pinning why bow replaced
  per-segment slope drift.
