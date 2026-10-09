---
paths:
  - "src/lib/practiceSheet*.ts"
  - "src/components/PracticeSheetDialog.tsx"
---

# Practice sheet export (`practiceSheet.ts`, `practiceSheetPaths.ts`, `practiceSheetPdf.ts`, `PracticeSheetDialog.tsx`)

Turns the selected plain `text` block into a printable PDF *mashq* sheet: a
solid model row, faint rows to trace, ruled blank rows, all on a nuqta grid.
The argument for the design is `docs/superpowers/specs/2026-10-09-practice-sheet-design.md`.

**The whole feature turns on one equation: one nuqta on paper equals the nib
width.** `nuqta.ts` holds a measured nuqta-to-font-size ratio per bundled face
(`FALLBACK_RATIO` for uploaded fonts), so `emHeightMm = nib / ratio`, and the
grid pitch is that nuqta. The "set letter size directly" override sets the em
and derives the nuqta from it, so the grid is always true to the drawn letters.

## Three lib files, split by what can be unit-tested

- **`practiceSheet.ts`** is pure page arithmetic and must not import
  `./harfbuzz`. Shaping is injected as a `MeasuredRun` (advance sum plus the
  run's ink extent), the `fitToWidth` pattern, so layout is testable with round
  numbers in `practiceSheet.test.ts`.
- **`practiceSheetPaths.ts`** holds the outline converter (`glyphPathToPdfOps`)
  and the filename slug. **Trap:** they live here, not in the writer, because
  `harfbuzz.ts` statically imports harfbuzzjs, which throws under Vitest's Node
  ESM loader. Anything that value-imports `./harfbuzz` cannot be unit-tested,
  and this file must never do so. `practiceSheetPdf.ts` re-exports both.
- **`practiceSheetPdf.ts`** shapes (`measurePracticeRun`) and writes the PDF
  (`buildPracticeSheetPdf`). It imports harfbuzz, so Vitest cannot load it.

## Layout rules

- **Row height comes from the run's ink, not the font's ascender/descender.**
  `inkTopUnits`/`inkBottomUnits` are the raw glyph bounding boxes plus `dy`;
  a row is that ink plus one nuqta of air, half above and half below. Some
  bundled fonts declare an ascender/descender about three letter-heights tall,
  which fit only 3 of 7 rows on A4 at a 4 mm nib.
- **Overflow never wraps.** A run wider than the printable area shrinks the
  whole sheet (`fitScale < 1`); `emHeightMm`/`nuqtaMm` are the *effective*
  post-shrink values and the footer says so. Rows that do not fit are dropped
  from the end, never squeezed; `droppedRows` counts them.
- **Grid pitch has a 2 mm floor.** Below a 2 mm nuqta the grid is drawn every
  N nuqta (`gridPitchMm`, `gridEveryNuqta`) and the footer says "grid every N
  nuqta". A finer grid printed as a grey wash and bloated the file.
- **Rows walk left to right from `leftX`** with `penX += ax`, as `ShapedText.tsx`
  does; `leftX` is the right margin minus the run width, so the run is
  right-aligned. Nothing here handles bidi beyond what HarfBuzz emitted.

## Writer traps

- **`glyphPathToPdfOps` takes RAW font-unit, y-up commands.** The writer passes
  `glyph.path.commands`, never `glyph.getPath(...)`: opentype's `getPath`
  already flips y, and the converter flips it again, so a second flip prints
  every glyph upside down.
- **jsPDF `path(lines)` takes one argument and only builds the path.** The
  writer calls `pdf.path(ops)` then `pdf.fill()` (nonzero) for model rows or
  `pdf.stroke()` for trace rows (0.15 mm `#B4B4B4`). The TypeScript types still
  declare a `style` argument; the installed implementation ignores it, so
  passing one draws nothing.
- Model rows are filled only, never also outlined: an outline over a fill
  thickens the letter (see the stroke-before-fill note in CLAUDE.md).
- The PDF is written with `compress: true`; jsPDF is imported lazily.

## Dialog

- The dialog shapes the text on open and whenever text or font change, and
  computes the layout live, so it shows the rows that will actually print plus
  shrink, dropped-row and grid warnings *before* download. A shaping failure
  shows immediately and disables Download.
- Numeric fields are draft strings validated to nib 0.5-15 mm, em 5-150 mm,
  rows 0-20 whole numbers; an invalid field shows a hint and disables Download.
- **Dialog state never reaches `App.tsx`.** `PracticeSheetButton` is launcher
  plus dialog in one element (the `FontUploadButton` pattern), mounted in the
  Export panel with only the selected block as input. Under multi-select it
  uses the sidebar's primary selected block (accepted deviation from "exactly
  one"). Its `aria-label` is `Practice sheet`; renaming it means updating
  `e2e/` in the same commit.
- **Deliberately ignored in v1:** diacritic overrides, glyph transforms,
  stroke cuts, gradients. Kashida works because it is real tatweel text.
  Non-text block types never reach the dialog; the launcher is disabled.

## Tests

Unit coverage is the layout module (`practiceSheet.test.ts`) and the
converter/slug (`practiceSheetPaths.test.ts`). There is no unit test of
`buildPracticeSheetPdf`; the writer was verified by rendering real PDFs.

Planned follow-up on the same page machinery, not built: alphabet sheets
(one letter and its forms per page).
