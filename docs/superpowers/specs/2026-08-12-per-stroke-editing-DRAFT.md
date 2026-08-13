# Per-stroke editing that preserves joining — DRAFT (design not yet approved)

**Status:** brainstorm in progress, paused 2026-08-12. Design below was
presented but *not* approved. No code has been written. Resume by
re-reading this file, confirming the design, then writing the real spec.

**Goal (user's words):** "I want every stroke to be able to be modified
separately but I still want the glyphs/letters to join to each other
seamlessly." Long-term, also wants true Thuluth/Diwani proportions.

## What started this

User asked for stroke stretching "like Kaleam" (https://kaleam.com) and
initially picked "draw letters from real stroke skeletons, independent of
the font file." Investigation showed that option is the one most likely to
*lose* the seamless joining they said they wanted to keep — the schema files
carry no joining geometry at all.

## Diagnosis — confirmed live in the browser

Two distinct symptoms, both real, both reproduced at 275% zoom on the
default `حرف` text (Naskh):

### Symptom 1 — cleft between hah and ra when dragging the ra

Confirmed visually: a hairline white slit opens at the hah/ra junction,
**on the side being dragged toward** (user dragged down-and-left).

Root cause: `ra-final.json`'s only stroke has its stretch zone spanning the
*entire* stroke (`fromNode: 0` → `toNode: 2`), and `connectsRight: true`
means node 0 **is** the connection point. Displacement is zero exactly at
the anchor — but the anchor is not exactly at the join. Per CLAUDE.md,
`anchorNorm` is mapped proportionally from the schema's idealized bounding
box onto the real font glyph's box: "a proportional guess, not a
per-font-verified point." The connection point therefore picks up a small
nonzero displacement in the drag direction and slides out from under the
hah. Nothing pins it, because `join-integrity` is never read.

Contributing: `tAlong = along / axisLen` in `applyAxisDisplacement`
(`src/lib/glyphEdits.ts:63`) is **unbounded and signed** — points past the
drag origin move *further* than the drag distance; points behind the anchor
move backwards.

### Symptom 2 — stroke distortion (best example: feh)

`fa-medial.json`'s eye loop declares `axis: "path"` and
`preserveCurvature: true`, but `deriveStretchCatalog` collapses the zone to
a straight anchor→drag chord. A closed loop pulled along a chord flattens on
one side and pinches its counter shut.

`ra-final.json` protects nodes 1→2 (`terminal-shape`, `left-tail-terminal`)
while the stretch axis runs 0→2 — so displacement is **maximum exactly where
the schema says do not deform**. The protection is inverted.

### The core finding

The engine is not missing data. It has the data and reads none of it.
Verified by grep: `protectedZones` survives only as `protectedReasons`
(a string list, display-only); `preserveCurvature`, `preserveThickness`,
and the zone's own `axis` field are read **nowhere in the codebase**.

## Scope decision

`public/fonts/` already contains `Thuluth.ttf`, `ThuluthDeco.ttf`,
`Diwani.ttf`, `Ruqaa.ttf` — so Thuluth/Diwani *proportions* are already
available. The gap is per-stroke editing that doesn't wreck them, not
letterform availability. This demotes the parametric engine from
prerequisite to later ambition.

Agreed decomposition (two sub-projects, each with its own spec):

1. **Now — schema-honoring stroke editing on real fonts.** Below.
2. **Later — parametric nib-sweep rendering.** True Kaleam. Needs numeric
   stroke widths (only qualitative profiles exist), finer skeletons (current
   ones are 2–4 nodes), per-style profiles, and joining geometry that does
   not exist yet.

Sub-project 1 builds four things sub-project 2 needs anyway: path-axis
displacement math, protected-zone enforcement, connection-point pinning as a
first-class concept, and the whole per-stroke editing UI.

### Per-style schemas (user's proposal, accepted with a refinement)

Every schema file declares `calligraphicModel: "naskh"`. Mapped onto
Thuluth's much steeper, longer sweeps, the proportional anchor guess gets
*worse* — the cleft would be more pronounced on Thuluth than on the Naskh
tested.

Once coordinates come from real outlines (change 1 below), the schema's
geometry is demoted from "supplies coordinates" to "identifies a region,"
and most of a file becomes style-invariant. What genuinely differs per style
is numeric: `minFactor`/`maxFactor` and `priority`.

So: **one base schema per letter-form + a thin per-style override layer**
carrying only the differing numbers — not 105 × 4 = 420 hand-authored files.
Full geometry overrides remain possible where a style really is a different
letterform (Diwani will need some), as a deliberate exception.

Build the hook in sub-project 1 (small now, painful to retrofit):
`registry.ts` keyed by `(unicode, joiningForm, styleId?)` with fallback to
the base, plus a font→style map alongside `FONT_URLS`.

## Proposed design — sub-project 1

All four changes live in pure, testable modules (`lib/glyphEdits.ts`,
`lib/strokeSchema/schemaGeometry.ts`, `lib/strokeSchema/deriveCatalog.ts`).

1. **Connection points from real outlines.** For a glyph whose
   `formMetadata` says `connectsRight`/`connectsLeft`, flatten its contours
   (reuse `lib/svgPath.ts`'s existing bezier subdivision), scan a vertical
   line near the joining edge, take the midpoint of the ink interval
   crossing the baseline. Multiply displacement by a guard that is 0 at that
   point and ramps smoothly to 1 beyond a pin radius — the join cannot move,
   and there is no crease where the guard releases. Font-independent by
   construction, so it works on Thuluth/Diwani too. **This is the cleft fix.**

2. **A real spine instead of a chord.** Map the schema stroke's nodes
   `fromNode..toNode` through the existing `normalizePoint`/`mapNormToRealBox`
   into a *polyline* in real-glyph space. An outline point projects onto its
   nearest spine segment and is displaced along **that segment's tangent**,
   scaled by arc-length position. Two-node strokes degrade to exactly today's
   straight chord (no regression); feh's four-node eye grows around its loop
   instead of shearing across it. This is `axis: "path"` actually implemented.

3. **Clamp and taper along the axis.** Clamp `tAlong` to [0,1] and add a
   falloff approaching the far end. Kills the overshoot.

4. **Enforce `protectedZones`.** Map each protected node span onto the same
   spine; outline points projecting into a protected span get displacement
   zeroed with the same smooth ramp. Fixes the ra's deforming tail terminal.

5. **Quantize stretch to nuqta / half-nuqta increments.** (User's idea,
   2026-08-12.) Traditional Arabic calligraphy measures stroke lengths in
   whole and half nuqta, and the schema is already authored that way — every
   stroke carries `lengthDots`, and `styleProfile.measurementSystem` declares
   the rhombic `dotUnit` and 45° nib angle. **None of it is read by any real
   code** (grep: `lengthDots`, `dotUnit`, `verticalLevels` appear only in
   test fixtures) — a second unused data layer alongside `protectedZones` /
   `preserveCurvature` / `axis`.

   No new schema data is needed. A stroke's stretched length is
   `lengthDots × factor`, so half-nuqta increments mean the factor snaps to
   multiples of `0.5 / lengthDots`. Beh's body (`lengthDots 4.2`, zone
   0.85–1.8) gets steps of ≈0.119 — about 28 discrete positions. The UI
   reads in calligraphers' units ("+1½ nuqta") instead of abstract factors,
   and the block-level Kashida dial quantizes along with it.

   **Deriving the nuqta from a real font — needs a per-font table, not a
   formula.** The obvious approach (alif stem = 1 nuqta) was **rejected by
   the user on 2026-08-12: it does not hold across these fonts.** Do not
   build on it.

   Better auto-derivation candidate: measure the *dot itself*, since the
   nuqta is by definition the rhombic mark the nib makes. Shape an isolated
   beh (U+0628), take its smallest separate contour (the dot), and measure
   that contour's extent. Caveat: many fonts draw dots round or square
   rather than rhombic, and often exaggerate them for legibility at small
   sizes — so this is a starting guess, not a source of truth.

   **Planned resolution:** a per-font nuqta constant stored alongside
   `FONT_URLS` in `src/hooks/useShapedGlyphs.ts`. There are only 17 fonts;
   measuring once and storing the value is more reliable and far cheaper
   than any formula that has to be right for every face. Auto-measurement
   (dot contour) seeds the table; a human confirms each entry. Expose a
   user-facing calibration control too, so an imported font is usable
   without a code change.

   ### Measured 2026-08-12 — results

   Two independent methods, cross-checked:

   * **beh-dot** — take the isolated beh (U+0628), keep contours that are
     compact (aspect 0.6–1.6) and below the baseline, choose the smallest.
   * **modal-contour** — sweep *every* glyph in the font, keep every small
     compact contour, and take the mode of their sizes. Dots recur across
     many letters, so the nuqta is the most common such contour. Needs no
     cmap, no GSUB walk and no naming convention — it rescued the two faces
     the beh method could not read.

   | font | upem | nuqta w×h | dot/em | alif/dot | confidence |
   |---|---:|---:|---:|---:|---|
   | AlFatemi.otf | 925 | 90×90 | 0.0973 | 0.87 | high |
   | Amiri.ttf | 1000 | 135×132 | 0.1350 | 0.88 | high |
   | Diwani.ttf | 2048 | 180×200 | 0.0879 | — | **LOW — see note** |
   | FatemiMaqala.ttf | 2048 | 233×226 | 0.1138 | 0.81 | high |
   | Kufi.ttf | 1000 | 121×115 | 0.1210 | 0.93 | high |
   | Kufi2.ttf | 1000 | 116×116 | 0.1160 | 1.68 | high |
   | Lateef.ttf | 2048 | 208×208 | 0.1016 | 0.56 | high |
   | NotoSans.ttf | 1000 | 99×99 | 0.0990 | 1.02 | high |
   | Qahiri.ttf | 750 | 80×72 | 0.1067 | — | medium (modal only) |
   | Ruqaa.ttf | 1000 | 153×169 | 0.1530 | 0.67 | **LOW — methods disagree** |
   | Scheherazade.ttf | 2048 | 229×239 | 0.1118 | 0.87 | high |
   | TahaNaskhRegular.ttf | 2048 | 237×238 | 0.1157 | 0.84 | high |
   | Thuluth.ttf | 2048 | 188×219 | 0.0918 | 1.19 | high |
   | ThuluthDeco.ttf | 2048 | 188×219 | 0.0918 | 1.19 | high |
   | Urdu.ttf | 2048 | 315×283 | 0.1538 | 0.53 | high |
   | Wessam.ttf | 2048 | 156×177 | 0.0762 | 1.05 | high |
   | Yekan.ttf | 2048 | 276×248 | 0.1348 | 0.74 | medium |

   **The alif-stem assumption is dead, quantitatively.** `alif/dot` would be
   ~1.00 for every font if it held. It ranges **0.53 (Urdu) to 1.68
   (Kufi2)** — a 3.2× spread. The user's rejection was correct.

   **`dot/em` varies ~2× across the library** (0.0762 Wessam → 0.1538 Urdu).
   So a half-nuqta step is a very different visual distance per font. This
   is exactly why the constant must be per-font and cannot be a global.

   **Confidence notes**

   * 14 of 17 fonts: both methods agree within ~2%. Treat as settled.
   * `ThuluthDeco` and `Thuluth` return identical dots (188×219), as
     expected for the same base face — a useful validation of the method.
     Note ThuluthDeco needed the hard aspect filter: it carries decorative
     slivers of *smaller area* than the real dot, which a
     smallest-area-wins rule picks by mistake.
   * `Ruqaa` — beh gives 153×169, modal gives 120×115 with 180×190 a close
     runner-up, all at low counts. Ruq'ah merges dot pairs into strokes, so
     the dot population is genuinely small. **Needs a human decision.**
   * `Yekan` — 276×248 vs 260×220, a mild disagreement. Worth an eyeball.
   * `Qahiri` — every base-codepoint glyph is **empty**; ink lives only on
     positional variants reached through GSUB, and its 552 glyphs are
     generically named (`glyph000NN`) with no `.isol`-style convention.
     Only the modal method could read it.

   **Separate finding — `Diwani.ttf` is currently unusable.** It maps **zero
   Arabic codepoints**: its cmaps are 8-bit legacy tables (platform 0/1/3,
   256 entries) of the old "Arabic letterforms on Latin byte positions"
   kind. HarfBuzz shaping with `arab` script cannot work on it. It is also
   **absent from `FONT_URLS`** (16 registered, 17 files on disk), which is
   presumably why nobody noticed. Since the user explicitly wants Diwani,
   **a properly Unicode-mapped Diwani font must be sourced** — this is a
   prerequisite for the per-style schema work, not a detail.

   Measurement scripts live in this session's scratchpad
   (`measure_final.py`, `modal_nuqta.py`); they are not committed. They need
   `fonttools`, and drop a corrupt `gvar` table before building the glyph
   set — Kufi2 and NotoSans are variable fonts whose `gvar` glyph count
   disagrees with `maxp` (825 vs 815; 1718 vs 1708), which otherwise makes
   `getGlyphSet()` throw.

   **This is the answer to the Diwani open question.** Rather than trusting
   Naskh-authored proportional geometry to map onto Diwani letterforms,
   each font self-reports its own unit and lengths are *counted* in it —
   making `lengthDots` a portable, style-independent measure. It also yields
   a free consistency check: a large disagreement between a font's measured
   nuqta and the schema's `lengthDots` flags a stroke needing a per-style
   override, which is the mechanism already planned above.

### Testing

- Changes 2–4 are pure functions over point sets — unit-testable in the
  style of `snapping.test.ts`.
- Change 1 needs a real font; `diacritics.test.ts` is the precedent (real
  harfbuzzjs, real fonts from `public/fonts/`, no hand-written fixtures).
- **Regression bar:** at `factor = 1`, every glyph must render
  byte-identically to today.

## Open questions

- Design above is unapproved — confirm before writing the real spec.
- Pin radius in change 1: fixed fraction of em, or derived from stroke width?
  (Likely answer now: derive it from the measured nuqta — see change 5.)
- ~~Does the spine mapping in change 2 hold up on Diwani?~~ Largely answered
  by change 5: count in font-measured nuqta rather than trusting Naskh
  proportional geometry. Still worth verifying on Diwani specifically.
- ~~Change 5 assumes the alif stem is one nuqta wide.~~ **Settled
  2026-08-12: it does not hold across these fonts.** Resolved via a
  per-font nuqta table seeded by dot-contour measurement — see change 5.
- ~~Should quantization be enforced or advisory?~~ **Settled 2026-08-12:
  advisory, not compulsory.** Snap to nuqta / half-nuqta by default, with a
  modifier to override — mirroring the existing grid snapping, which
  `CanvasStage.tsx` already establishes as this app's snapping idiom.
  Off-grid values must remain expressible and must round-trip through
  save/load unchanged.

## Repro notes

- `npm run dev`, default text `حرف` at 275% zoom.
- Cleft: select block → Morph Glyph Editor → ra → stretch handle → drag
  down-left. Gap appears at the hah/ra junction.
- Konva's hover-mounted handles do not take scripted drags reliably — drive
  this by hand.
