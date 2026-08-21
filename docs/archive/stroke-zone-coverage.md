# Straight-stroke cut-zone coverage sweep

Date: 2026-08-21

This is Task 3 of the straight-stroke-extension plan — the go/no-go gate.
`src/lib/strokeCuts.ts` (Tasks 1–2) is a pure geometric detector that walks a
glyph outline and reports `CutZone`s: x-ranges where a vertical cut is
"legal" (crossings roughly parallel to the baseline, consistent ink
thickness across the run). This sweep measures whether that detector finds
anything on the 17 fonts actually bundled with the app, via
`scripts/measureStrokeZones.mjs`, which imports the real detector — no
reimplementation.

Methodology matches the task brief exactly: 28 base Arabic letters shaped in
isolation, plus five short words (`حرف`, `محمد`, `بسم`, `سلام`, `كتاب`) shaped
together to measure how often a zone lands on a connector (join) position.
Per-font `DetectOpts` scale `step` and `minZoneWidth` to each font's own
`unitsPerEm` (`step = upm/100`, `minZoneWidth = upm/40`), so the sweep is
resolution-independent; `maxSlope` and `thicknessTolerance` are the same
across fonts.

## Baseline: `DEFAULT_DETECT_OPTS` as shipped (`maxSlope = 0.18`)

Recorded verbatim, first run, before any tuning.

| Font | letters with a zone | zones | median zone (em) | connector positions |
|---|---|---|---|---|
| AlFatemi.otf | 36% | 10 | 0.050 | 10% |
| Amiri.ttf | 64% | 20 | 0.080 | 31% |
| FatemiMaqala.ttf | 32% | 9 | 0.060 | 42% |
| HarfCanvasDiwani.ttf | 0% | 0 | - | 25% |
| Kufi.ttf | 54% | 19 | 0.070 | 133% |
| Kufi2.ttf | 68% | 29 | 0.090 | 100% |
| Lateef.ttf | 43% | 12 | 0.050 | 58% |
| NotoSans.ttf | 71% | 29 | 0.120 | 71% |
| Qahiri.ttf | 75% | 27 | 0.140 | 63% |
| Ruqaa.ttf | 46% | 13 | 0.050 | 24% |
| Scheherazade.ttf | 54% | 15 | 0.090 | 133% |
| TahaNaskhRegular.ttf | 50% | 15 | 0.060 | 118% |
| Thuluth.ttf | 61% | 17 | 0.060 | 64% |
| ThuluthDeco.ttf | 29% | 8 | 0.030 | 55% |
| Urdu.ttf | 32% | 13 | 0.180 | 33% |
| Wessam.ttf | 54% | 18 | 0.120 | 70% |
| Yekan.ttf | 57% | 21 | 0.090 | 133% |

**Note on `connectorPct` above 100%:** the script (matching the brief's own
listing verbatim) counts a "connector zone" as any glyph in a shaped word
that has at least one cut zone, and divides by `glyphs.length - 1` per word
— not by the number of glyphs actually sitting at a join position. Diacritic
glyphs, the final letter, and multi-zone glyphs all inflate the numerator
against that denominator, which is why several fonts clear 100%. This is a
known looseness in the brief's own measurement, reproduced faithfully rather
than silently patched — the number is still directionally useful (it shows
zones are being found somewhere in running text) but should not be read as a
precise "4 out of 5 joins are extendable" figure.

**Gate fonts at baseline** (Amiri, Scheherazade, NotoSans, Kufi — Kufi.ttf,
the font registered as `"Kufi"` in `FONT_URLS`/`FONT_OPTIONS`; `Kufi2.ttf` is
a separate, second font and not the one named in the gate):

| Font | letters (need ≥60%) | connector (need ≥80%) |
|---|---|---|
| Amiri | 64% ✅ | 31% ❌ |
| Scheherazade | 54% ❌ | 133% ✅ |
| NotoSans | 71% ✅ | 71% ❌ |
| Kufi | 54% ❌ | 133% ✅ |

No gate font clears both thresholds at baseline. Per the brief, this is
grounds to try `maxSlope` at 0.25 and then 0.35 before concluding.

## Tuning attempt 1: `maxSlope = 0.25`

| Font | letters with a zone | zones | median zone (em) | connector positions |
|---|---|---|---|---|
| AlFatemi.otf | 46% | 14 | 0.050 | 30% |
| Amiri.ttf | 57% | 22 | 0.090 | 38% |
| FatemiMaqala.ttf | 43% | 12 | 0.090 | 42% |
| HarfCanvasDiwani.ttf | 4% | 1 | 0.050 | 33% |
| Kufi.ttf | 71% | 28 | 0.070 | 133% |
| Kufi2.ttf | 61% | 28 | 0.090 | 76% |
| Lateef.ttf | 39% | 13 | 0.060 | 75% |
| NotoSans.ttf | 89% | 34 | 0.140 | 82% |
| Qahiri.ttf | 46% | 17 | 0.100 | 56% |
| Ruqaa.ttf | 46% | 15 | 0.120 | 47% |
| Scheherazade.ttf | 46% | 16 | 0.090 | 125% |
| TahaNaskhRegular.ttf | 57% | 21 | 0.070 | 118% |
| Thuluth.ttf | 54% | 16 | 0.090 | 73% |
| ThuluthDeco.ttf | 29% | 8 | 0.060 | 64% |
| Urdu.ttf | 32% | 13 | 0.180 | 33% |
| Wessam.ttf | 54% | 16 | 0.340 | 80% |
| Yekan.ttf | 64% | 28 | 0.080 | 142% |

Gate fonts: Amiri **57%** letters / **38%** connector (both worse — Amiri
regresses at the looser slope), Scheherazade **46%** letters (worse) / 125%
connector, NotoSans **89%/82%** (now clears both), Kufi **71%/133%** (clears
both). Two of four gate fonts pass, but the other two — including Amiri,
whose baseline letter score was already above the bar — get worse, not
better.

## Tuning attempt 2: `maxSlope = 0.35` (the brief's hard ceiling)

| Font | letters with a zone | zones | median zone (em) | connector positions |
|---|---|---|---|---|
| AlFatemi.otf | 29% | 10 | 0.080 | 60% |
| Amiri.ttf | 57% | 23 | 0.120 | 62% |
| FatemiMaqala.ttf | 50% | 16 | 0.050 | 83% |
| HarfCanvasDiwani.ttf | 11% | 3 | 0.050 | 42% |
| Kufi.ttf | 86% | 34 | 0.060 | 133% |
| Kufi2.ttf | 64% | 30 | 0.100 | 76% |
| Lateef.ttf | 32% | 12 | 0.070 | 92% |
| NotoSans.ttf | 79% | 37 | 0.120 | 94% |
| Qahiri.ttf | 46% | 17 | 0.110 | 56% |
| Ruqaa.ttf | 46% | 15 | 0.090 | 35% |
| Scheherazade.ttf | 32% | 13 | 0.130 | 125% |
| TahaNaskhRegular.ttf | 57% | 23 | 0.080 | 118% |
| Thuluth.ttf | 61% | 23 | 0.080 | 82% |
| ThuluthDeco.ttf | 46% | 21 | 0.060 | 73% |
| Urdu.ttf | 21% | 7 | 0.110 | 33% |
| Wessam.ttf | 46% | 21 | 0.130 | 110% |
| Yekan.ttf | 71% | 34 | 0.060 | 142% |

Gate fonts: Amiri **57%/62%** (letters still below 60%; connector improved
but still below 80%), Scheherazade **32%/125%** (letters collapsed further),
NotoSans **79%/94%** (clears both), Kufi **86%/133%** (clears both).

At neither tuning value do all four gate fonts clear both thresholds
simultaneously, and pushing `maxSlope` further trades Amiri's and
Scheherazade's letter coverage away in exchange for Kufi's and NotoSans's —
it is not a monotonic improvement across the board. Scheherazade's letter
score actually falls each time the slope tolerance is loosened (54% → 46% →
32%), which is explained by the curved-letter spot-check below: a looser
slope threshold lets crossings inside a shallow curve pass, which can bridge
two previously-separate straight runs across a curved dip between them; the
merged run's thickness then varies more than `thicknessTolerance` allows and
the whole merged run is rejected, so a font can lose zones it had at a
tighter tolerance. `maxSlope: 0.35` is the brief's stated ceiling, so tuning
stops here.

## Curved-letter spot-check

Checked ن (tail/hook), ح (bowl), and س (three-tooth body with a curled tail)
in isolation across the four gate fonts, at both `maxSlope = 0.18` (baseline)
and `maxSlope = 0.35` (the ceiling), by printing each reported zone's x-range
relative to the glyph's own width and sampling the actual crossing slopes at
five points inside the zone (using the real `crossingsAt` from
`strokeCuts.ts`, not a guess).

**At `maxSlope = 0.18` (baseline):**
- Amiri `ن`, Scheherazade `ن`/`ح`, NotoSans `ح`, Kufi `ن` — no zone found at
  all on these curved letters.
- Amiri `ح` has one zone (rel. x 0.62–0.75) with sampled slopes between
  -0.174 and +0.044 — modest variation, consistent with a genuinely
  near-vertical segment (a tail stroke), not a curve apex.
- Amiri `س` has one zone (rel. x 0.22–0.32, near the first tooth) with
  sampled slopes between -0.116 and +0.089 — again modest, sitting on one of
  the letter's vertical tooth edges rather than the curled tail.
- Kufi `ح` has one zone (rel. x 0.43–0.49) with wider slope swings
  (-0.14…+0.17 across four simultaneous crossings, i.e. a glyph with an
  inner counter) — Kufi's blocky, low-curvature letterforms make this
  plausible as a real straight segment, but it is the least clean of the
  baseline examples.

**At `maxSlope = 0.35` (ceiling), the same letters look different:**
- Amiri `س` now reports *three* zones, one of them at rel. x 0.89–0.94 —
  the tail curl — where sampled slopes swing from +0.322 down to -0.058
  across the zone: the outline is visibly curving through that x-range, not
  running flat. This is a false positive by the brief's own definition.
- Scheherazade `ن` now reports a zone at rel. x 0.28–0.34 (the hook) with
  slopes sweeping +0.337 → +0.123 — again a curve, not a flat run, sitting
  almost exactly where the letter's hook departs from the bowl.
- Kufi `ن` now reports a zone at rel. x 0.46–0.53 where one pair of
  crossings swings from -0.342 to +0.342 across the zone — the slope passes
  through zero at the bottom of a curve (a classic false-flat at a curve's
  vertex) rather than staying near zero throughout.

This is a real, structural failure mode, not a coincidence of these three
letters: loosening `maxSlope` measurably buys zones on ن's hook and س's tail
curl — exactly the letters the brief named as the ones to watch. It is the
detector lying, and it is the reason this report does **not** adopt 0.25 or
0.35 as the recorded default, even though 0.25/0.35 numerically clear the
gate for two of the four fonts.

## Verdict

**`DEFAULT_DETECT_OPTS` is left unchanged** (`maxSlope: 0.18`, the value
already in `src/lib/strokeCuts.ts`) — no code change was made to that file.
Tuning `maxSlope` to 0.25 or 0.35 does not produce a table where all four
gate fonts (Amiri, Scheherazade, NotoSans, Kufi) clear both the 60%-letters
and 80%-connector thresholds at once, and at 0.35 the detector visibly starts
reporting zones on curved regions of ن and س that the spot-check shows are
not straight strokes — precisely the failure mode this sweep exists to catch
before it ships as a UI feature. **At every value tested, the gate is not
met.** Two of the four required fonts (NotoSans, Kufi) can be made to clear
both thresholds by loosening `maxSlope`, but the other two (Amiri,
Scheherazade) get *worse*, not better, as the slope tolerance loosens, and
Scheherazade never comes close to the 60% letter bar at any tested value
(54% → 46% → 32%). The connector-position numbers are additionally
unreliable in their own right (see the note on the >100% figures above) and
should not be read as confirming the join story even where they nominally
clear 80%. Per the plan, this is a stop-and-report point: a human should
decide whether the remaining seven tasks proceed, are rescoped, or are
shelved, on this measurement.
