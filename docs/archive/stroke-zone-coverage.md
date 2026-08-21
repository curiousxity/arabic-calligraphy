# Straight-stroke cut-zone coverage sweep

Date: 2026-08-21 (revised same day after independent review — see "Revision
history" at the bottom; the review reproduced the underlying measurements
byte-for-byte and found the metrics themselves needed fixing, not the
detector or the raw numbers).

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
resolution-independent; `maxSlope` and `thicknessTolerance` are the same
across fonts.

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
- **join%** — the real connector metric. For each adjacent glyph pair in a
  shaped word, checks whether a zone sits near the *shared join edge*: the
  earlier glyph's trailing pen-edge (its own local x at its advance width)
  or the later glyph's leading pen-edge (its own local x at 0), within a
  fixed **join window** of 5 sample steps (`JOIN_WINDOW_STEPS = 5`, i.e.
  `upm/20`) — wide enough to tolerate a letter's own side bearing at the
  join without accepting a zone that is really just "somewhere in the
  glyph." The window was fixed before any of the numbers below were seen
  and was never adjusted after seeing them. Divided by `glyphs.length - 1`
  pairs per word, so this denominator, unlike the population it's applied
  to, genuinely is "number of joins."

## Baseline: `DEFAULT_DETECT_OPTS` as shipped (`maxSlope = 0.18`)

| Font | isolated | zones | median zone (em) | contextual | join |
|---|---|---|---|---|---|
| AlFatemi.otf | 36% | 10 | 0.050 | 7% | 0% |
| Amiri.ttf | 64% | 20 | 0.080 | 22% | 0% |
| FatemiMaqala.ttf | 32% | 9 | 0.060 | 29% | 33% |
| HarfCanvasDiwani.ttf | 0% | 0 | - | 18% | 25% |
| Kufi.ttf | 54% | 19 | 0.070 | 94% | 83% |
| Kufi2.ttf | 68% | 29 | 0.090 | 77% | 65% |
| Lateef.ttf | 43% | 12 | 0.050 | 41% | 33% |
| NotoSans.ttf | 71% | 29 | 0.120 | 55% | 59% |
| Qahiri.ttf | 75% | 27 | 0.140 | 48% | 31% |
| Ruqaa.ttf | 46% | 13 | 0.050 | 18% | 6% |
| Scheherazade.ttf | 54% | 15 | 0.090 | 94% | 75% |
| TahaNaskhRegular.ttf | 50% | 15 | 0.060 | 81% | 73% |
| Thuluth.ttf | 61% | 17 | 0.060 | 44% | 36% |
| ThuluthDeco.ttf | 29% | 8 | 0.030 | 38% | 27% |
| Urdu.ttf | 32% | 13 | 0.180 | 13% | 0% |
| Wessam.ttf | 54% | 18 | 0.120 | 47% | 50% |
| Yekan.ttf | 57% | 21 | 0.090 | 94% | 83% |

**Gate fonts** (Amiri, Scheherazade, NotoSans, Kufi — `Kufi.ttf`, the font
registered as `"Kufi"` in `FONT_URLS`/`FONT_OPTIONS`; `Kufi2.ttf` is a
separate second font and not the one named in the gate), against the actual
requirements (isolated ≥ 60%, join ≥ 80%):

| Font | isolated (need ≥60%) | join (need ≥80%) |
|---|---|---|
| Amiri | 64% ✅ | 0% ❌ |
| Scheherazade | 54% ❌ | 75% ❌ |
| NotoSans | 71% ✅ | 59% ❌ |
| Kufi | 54% ❌ | 83% ✅ |

**Zero of four gate fonts clear both thresholds at baseline.** Per the
brief, this is grounds to try `maxSlope` at 0.25 and then 0.35 before
concluding.

## Tuning attempt 1: `maxSlope = 0.25`

| Font | isolated | zones | median zone (em) | contextual | join |
|---|---|---|---|---|---|
| AlFatemi.otf | 46% | 14 | 0.050 | 20% | 10% |
| Amiri.ttf | 57% | 22 | 0.090 | 28% | 0% |
| FatemiMaqala.ttf | 43% | 12 | 0.090 | 29% | 25% |
| HarfCanvasDiwani.ttf | 4% | 1 | 0.050 | 24% | 25% |
| Kufi.ttf | 71% | 28 | 0.070 | 94% | 83% |
| Kufi2.ttf | 61% | 28 | 0.090 | 59% | 41% |
| Lateef.ttf | 39% | 13 | 0.060 | 53% | 58% |
| NotoSans.ttf | 89% | 34 | 0.140 | 64% | 65% |
| Qahiri.ttf | 46% | 17 | 0.100 | 43% | 38% |
| Ruqaa.ttf | 46% | 15 | 0.120 | 36% | 29% |
| Scheherazade.ttf | 46% | 16 | 0.090 | 88% | 75% |
| TahaNaskhRegular.ttf | 57% | 21 | 0.070 | 81% | 73% |
| Thuluth.ttf | 54% | 16 | 0.090 | 50% | 36% |
| ThuluthDeco.ttf | 29% | 8 | 0.060 | 44% | 27% |
| Urdu.ttf | 32% | 13 | 0.180 | 13% | 0% |
| Wessam.ttf | 54% | 16 | 0.340 | 53% | 50% |
| Yekan.ttf | 64% | 28 | 0.080 | 100% | 83% |

Gate cells: Amiri **57% ❌ / 0% ❌**, Scheherazade **46% ❌ / 75% ❌**,
NotoSans **89% ✅ / 65% ❌**, Kufi **71% ✅ / 83% ✅**. Only Kufi clears both —
one of four.

## Tuning attempt 2: `maxSlope = 0.35` (the brief's hard ceiling)

| Font | isolated | zones | median zone (em) | contextual | join |
|---|---|---|---|---|---|
| AlFatemi.otf | 29% | 10 | 0.080 | 40% | 10% |
| Amiri.ttf | 57% | 23 | 0.120 | 44% | 38% |
| FatemiMaqala.ttf | 50% | 16 | 0.050 | 59% | 42% |
| HarfCanvasDiwani.ttf | 11% | 3 | 0.050 | 29% | 33% |
| Kufi.ttf | 86% | 34 | 0.060 | 94% | 83% |
| Kufi2.ttf | 64% | 30 | 0.100 | 59% | 47% |
| Lateef.ttf | 32% | 12 | 0.070 | 65% | 67% |
| NotoSans.ttf | 79% | 37 | 0.120 | 73% | 65% |
| Qahiri.ttf | 46% | 17 | 0.110 | 43% | 38% |
| Ruqaa.ttf | 46% | 15 | 0.090 | 27% | 29% |
| Scheherazade.ttf | 32% | 13 | 0.130 | 88% | 75% |
| TahaNaskhRegular.ttf | 57% | 23 | 0.080 | 81% | 73% |
| Thuluth.ttf | 61% | 23 | 0.080 | 56% | 36% |
| ThuluthDeco.ttf | 36% | 11 | 0.050 | 50% | 27% |
| Urdu.ttf | 21% | 7 | 0.110 | 13% | 0% |
| Wessam.ttf | 46% | 21 | 0.130 | 73% | 60% |
| Yekan.ttf | 71% | 34 | 0.060 | 100% | 83% |

Gate cells: Amiri **57% ❌ / 38% ❌**, Scheherazade **32% ❌ / 75% ❌**,
NotoSans **79% ✅ / 65% ❌**, Kufi **86% ✅ / 83% ✅**. Again only Kufi clears
both. `maxSlope: 0.35` is the brief's stated ceiling, so tuning stops here.

**Across all three tested values, at most one of the four gate fonts
(Kufi, and only at 0.25/0.35, not at baseline) ever clears both
thresholds at once.** Amiri and NotoSans never clear the join threshold at
any tested value. Scheherazade never clears the isolated threshold at any
tested value, and its isolated score gets *worse*, not better, as `maxSlope`
loosens (54% → 46% → 32%) — see the curved-letter spot-check below for why:
a looser slope threshold lets crossings inside a shallow curve pass, which
can bridge two previously-separate straight runs across a curved dip
between them; the merged run's thickness then varies more than
`thicknessTolerance` allows and the whole merged run is rejected, losing
zones a tighter tolerance had kept.

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
  these (four simultaneous crossings, i.e. a glyph with an inner counter),
  the least clean of the baseline examples but still bounded by the cap.

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
- Kufi `ن` now reports a zone at rel. x 0.46–0.53 where one pair of
  crossings swings from -0.342 to +0.342 across the zone — the slope passes
  through zero at the bottom of a curve (a classic false-flat at a curve's
  vertex) rather than staying near zero throughout.

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

## Verdict against the gate

**The isolated-letter number alone already rules out a passing gate,
independent of any tuning choice.** Scheherazade's isolated coverage — 54%
at baseline, 46% at `maxSlope = 0.25`, 32% at `maxSlope = 0.35` — never
reaches the 60% bar at any of the three tested settings, and it gets worse,
not better, the more the slope tolerance is loosened. No value in the
brief's authorized tuning range fixes this; going past the 0.35 ceiling is
out of scope.

**The join number confirms it independently.** Even setting Scheherazade
aside, Amiri's join coverage is 0% at baseline and only 38% at the ceiling —
nowhere near 80% at any tested value — and NotoSans's join coverage tops out
at 65%, also never reaching 80%. Only Kufi clears both thresholds, and only
at the two loosened settings this report declines to adopt, because the
same settings are shown by the spot-check to accept curved regions of ن and
س as flat — the exact failure mode this sweep exists to catch before it
ships as a UI feature.

**`DEFAULT_DETECT_OPTS` is left unchanged** (`maxSlope: 0.18`, already in
`src/lib/strokeCuts.ts`) — no edit was made to that file. The corrected
contextual/join numbers do not change this choice: they make the case
against 0.25/0.35 stronger, not weaker (NotoSans's real join% is *lower*
than its old, mislabeled connector reading at every tested value), and the
curved-letter evidence against those settings was never in question. At
every tested value, the gate is not met. Diwani, Ruqaa, and Thuluth score
low across all three runs as expected and are not part of the gate.

Per the plan, this remains a stop-and-report point: a human should decide
whether the remaining seven tasks proceed, are rescoped, or are shelved, on
this measurement.

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
