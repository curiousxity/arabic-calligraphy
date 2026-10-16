---
paths:
  - "src/lib/textStyles*.ts"
---

# Copying a block's look (`src/lib/textStyles.ts`)

`captureStyle` reads a block's styling fields and `styleToPatch` turns them
back into a patch. Two callers use the pair to make new text look like
existing text: text added to a guide copies the last text written on it
(`writtenTextStyle` in `App.tsx`), and a new verse line copies the selected
block.

- **A style is defined by what it refuses to carry.** `STYLE_FIELDS` is the
  single list both functions walk, so the two directions cannot drift; it
  holds only styling fields, so `text`, `x`/`y`, `id` and `type` can never
  ride along. `textStyles.test.ts` asserts that absence, not only the
  presence of the fields.
- **The field names come from `BlockCommon`.** The outline colour is
  `stroke` (not `strokeColor`). `lineHeight`, `letterSpacing` and
  `wordSpacing` live on `TextBlock` only; they are captured anyway, inert on
  the other types.

## Removed 2026-10-16: saved Styles and Palettes

The top of the Typography panel used to hold a saved **Styles** list (name a
block's look, apply it to every selected block as one undo) and colour
**Palettes** (swatches for the text colour, shipped defaults plus "From
canvas"), both local-only `localStorage` stores (`harfcanvas-text-styles-v1`,
`harfcanvas-palettes-v1`). The user judged them redundant: the colour rows
already have swatches, and a look is copied by duplicating a block. Removed
with them: `lib/palettes.ts`, `PaletteSwatches.tsx`, the store half of
`textStyles.ts`, `patchSelectedBlocks` in `App.tsx`, `e2e/styles.spec.ts` and
the guide's Styles page. Neither store was ever in a saved project, so no
save sanitizing was needed; the stale keys are simply never read again.
