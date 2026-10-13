# Letter and word spacing

Date: 2026-10-13. Status: design, awaiting review.

The first of three Kelk-gap projects, in build order: spacing, multi-line
text with per-line justification, shaped guides. Each gets its own spec.

## Goal

Let a calligrapher tighten or loosen a text block's spacing — between the
separate pieces of a word, and between words — the way Kelk's تقارب / تباعد
حروف و کلمات does.

**Success:** on `محمد رسول الله` in Amiri, raising Letter spacing widens the
gap after د and after ر and و without parting any joined pair; raising Word
spacing widens only the two spaces; negative values pull them together until
they overlap; a save round-trips both; Fit to width still never overshoots
with spacing set; a muthanna mirror of the block follows it.

**What the user said:** letter spacing acts only at gaps between pieces, never
inside a join. Both directions — negative values tighten, overlap allowed.
Text blocks only. Mirrors follow their source.

**Assumed, open to correction:** values are a fraction of font size; ranges
letter −0.3…+1.0, word −0.5…+2.0; the practice sheet ignores spacing in v1.

## Background

Arabic cannot take Latin tracking: space between every glyph pair would break
every join. A word already breaks after a letter that does not join forward
(ا د ذ ر ز و ة ى and the Persian/Urdu right-joiners) — those breaks, and the
spaces between words, are the only places spacing may act.

Every renderer and measurement path positions glyphs by summing HarfBuzz's
advances (`penX += g.ax`): three loops in `ShapedText`, the ink-box measure
behind Fit to width, the Next Shape and diacritic overlays. Changing the
advances once, right after shaping, reaches all of them; editing each loop
would not.

## Design

### `src/lib/spacing.ts` (pure)

```ts
applySpacing(
  glyphs: readonly HarfBuzzGlyph[],
  shapableText: string,
  spacing: { letter?: number; word?: number }, // fraction of font size
  unitsPerEm: number
): HarfBuzzGlyph[]
```

- Returns the **same glyphs in the same order**; only `ax` changes. Glyph
  count and indices are untouched, so everything keyed by glyph index —
  diacritic overrides, stroke cuts, alternate targets, hit boxes — needs no
  remapping.
- Both values 0 or absent → returns the input array itself (identity), so an
  unaffected block does not re-render.
- **Boundaries** are found on the logical text. A *piece break* follows a
  letter whose `classifyJoiningForms` form is `final` or `isolated` when the
  next non-mark character is a letter. A *word gap* is a whitespace
  character. Letter amount is `letter × unitsPerEm`; word amount likewise.
- **Where the amount lands:** a boundary is applied only between two adjacent
  glyphs (in shaped order) whose clusters differ and straddle it, added to the
  advance of the *earlier* glyph of that pair in the shaped array — the gap
  between array neighbours `i` and `i+1` is exactly glyph `i`'s advance,
  whichever visual direction the array runs (to be confirmed against real
  shaping output in the first test). Marks share their letter's
  cluster and ligatures (lam-alef, Allah) are one cluster, so neither ever
  receives spacing or splits.
- Imports `arabicJoining.ts` and the `HarfBuzzGlyph` *type* only — never
  `./harfbuzz` at runtime (Vitest cannot load it).
- Negative values may drive an advance below zero; that is the overlap the
  user asked for, not clamped.

### Applied in exactly two places

1. **`ShapedText.tsx`**, a `useMemo` over `useShapedGlyphs`' glyphs. All
   internal loops, `glyphBounds`, and the overlays fed from it see the spaced
   run.
2. **`measureShapedRun` / `measureShapedWidth`** take an optional `spacing`
   argument, passed by Fit to width and Name Designs in `App.tsx`, so what is
   measured is what is drawn.

### Data

`TextBlock` gains `letterSpacing?: number` and `wordSpacing?: number`
(fraction of font size; absent = 0). Not on `BlockCommon`. Both added to
`blockRenderProps.ts` so mirrors carry them. No save-format version bump —
absent fields are the old behaviour, so old saves render byte-identically.

### UI

Sidebar → Typography, text blocks only: two slider+number rows (the existing
`FormControls` pattern), "Letter spacing" and "Word spacing", each with a
reset to 0. One `pushHistory()` per gesture, as other sliders do.

### Out of scope

Shape Fill and Curve (both renormalise the run to a fixed span, so spacing
would only redistribute and shrink — the reason stroke stretching is declined
there). Square kufi (has its own word gap). Practice sheet (already ignores
per-letter edits; noted in its rule file).

## Testing

- `src/lib/spacing.test.ts`, real harfbuzzjs and fonts via the `shapeReal`
  pattern from `diacritics.test.ts`:
  - identity at 0; count and order preserved otherwise;
  - each piece gap grows by exactly `letter × upm`; joined pairs' relative
    positions unchanged;
  - each word gap grows by exactly `word × upm`;
  - marks and a lam-alef / Allah ligature receive nothing;
  - negative values tighten by the same exact amount.
- `e2e`: raising Letter spacing on `محمد رسول الله` widens the block's rect.
- Docs: `.claude/rules/spacing.md`, one index line in `CLAUDE.md`, a
  paragraph in `guide/sections/typography.tsx`, a `PROGRESS.md` entry.
