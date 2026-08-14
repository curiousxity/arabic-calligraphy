# Archived: per-font nuqta measurements

**Why this file exists.** The Morph Glyph Editor and the whole per-stroke
editing subsystem were removed on 2026-08-14 (see `PROGRESS.md`). The nuqta
measurements below were the expensive, human-verified part of that work —
each font measured two independent ways and cross-checked by eye. If
per-stroke editing (or anything else that needs a per-font nuqta) is ever
rebuilt, start from this table instead of re-measuring.

**Where the rest of the subsystem lives.** The last commit on `main` that
contains the complete subsystem — `src/lib/strokeSchema/`,
`src/lib/strokeSpines/`, `src/lib/glyphEdits.ts`, `src/lib/joinPins.ts`,
`src/lib/nuqta.ts`, `src/lib/justify.ts`, all 105 stroke-schema JSONs, all
30 spine tables, and their tests — is recorded here by the removal commit:

- **Pre-removal SHA:** `<filled in by the removal stream — the parent of the
  removal commit>`

The offline tooling (`scripts/measureNuqta.py`, `scripts/deriveStrokeSpines.py`,
`scripts/auditSpineOrientation.py`) is deliberately **kept in the repo** —
scripts are inert and are the other half of "don't redo the work."

## The measurements

The nuqta — the rhombic dot the calligrapher's nib makes — is the unit
traditional Arabic calligraphy measures stroke length in. **It is measured
per font, never derived.** The intuitive rule that the alif's stem is one
nuqta wide fails across this library: `alif/dot` ranges 0.53 (Urdu) to 1.68
(Kufi2), a 3.2× spread where the rule predicts 1.00. `dot/em` itself varies
~2× (0.0762 Wessam → 0.1538 Urdu), so no global constant serves either.

Two independent methods were used and agree within ~2% on every entry except
Yekan (where the beh-dot figure was reviewed and accepted by eye; the ~6%
spread is sub-pixel at normal sizes):

1. **Beh-dot contour** — measure the dot contour of beh (U+0628) directly.
2. **Modal-contour sweep** — scan every glyph in the font, keep small compact
   contours, take the mode. Needs no cmap, GSUB walk, or naming convention,
   and was the only method able to read `Qahiri.ttf`, whose base-codepoint
   glyphs are all empty.

Stored as a dot/em **ratio**: nuqta in pixels is `ratio * fontSize`.

| Font family key | dot/em ratio |
|---|---|
| AlFatemi | 0.0973 |
| Amiri | 0.135 |
| FatemiMaqala | 0.1138 |
| Kufi | 0.121 |
| Kufi2 | 0.116 |
| Lateef | 0.1016 |
| NotoSans | 0.099 |
| Qahiri | 0.1067 |
| Scheherazade | 0.1118 |
| TahaNaskhRegular | 0.1157 |
| Thuluth | 0.0918 |
| ThuluthDeco | 0.0918 |
| Urdu | 0.1538 |
| Wessam | 0.0762 |
| Yekan | 0.1348 |

**Deliberately absent:** `Ruqaa` and `HarfCanvasDiwani`. They were scoped
out of per-stroke editing — every stroke schema declared
`calligraphicModel: "naskh"`, which fits Diwani's sloped letterforms worst,
and Ruq'ah merges dot pairs into strokes, making its measured nuqta the
least reliable figure available. Do not fill these in with a guess.

Full derivation, per-font confidence notes, and the measurement narrative
live in `docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md`.

**Gotcha for any future offline font analysis:** `Kufi2.ttf` and
`NotoSans.ttf` are variable fonts whose `gvar` glyph count disagrees with
`maxp` (825 vs 815; 1718 vs 1708). fontTools throws on `getGlyphSet()` until
the `gvar` table is dropped. Harmless to the app's own rendering path.
