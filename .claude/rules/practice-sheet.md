---
paths:
  - "src/lib/practiceSheet*.ts"
  - "src/components/PracticeSheetDialog.tsx"
---

# Practice sheet export (`practiceSheet.ts`, `practiceSheetPaths.ts`, `practiceSheetDraw.ts`, `practiceSheetPdf.ts`, `PracticeSheetDialog.tsx`)

Turns the selected plain `text` block into a printable PDF *mashq* sheet: a
solid model row, faint rows to trace, ruled blank rows, all on a nuqta grid.
The argument for the design is `docs/superpowers/specs/2026-10-09-practice-sheet-design.md`.

**The whole feature turns on one equation: one nuqta on paper equals the nib
width.** `nuqta.ts` holds a measured nuqta-to-font-size ratio per bundled face
(`FALLBACK_RATIO` for uploaded fonts), so `emHeightMm = nib / ratio`, and the
grid pitch is that nuqta. The "set letter size directly" override sets the em
and derives the nuqta from it, so the grid is always true to the drawn letters.

## Four lib files, split by what can be unit-tested

- **`practiceSheet.ts`** is pure page arithmetic and must not import
  `./harfbuzz`. Shaping is injected as a `MeasuredRun` (advance sum plus the
  run's ink extent), the `fitToWidth` pattern, so layout is testable with round
  numbers in `practiceSheet.test.ts`.
- **`practiceSheetPaths.ts`** holds the outline converter (`glyphPathToPdfOps`)
  and the filename slug. **Trap:** they live here, not in the writer, because
  `harfbuzz.ts` statically imports harfbuzzjs, which throws under Vitest's Node
  ESM loader. Anything that value-imports `./harfbuzz` cannot be unit-tested,
  and this file must never do so. `practiceSheetPdf.ts` re-exports both.
- **`practiceSheetDraw.ts`** paints the sheet: `drawPracticeSheet(pdf, layout,
  glyphs, font, upm)` draws rules, glyph rows and footer into a jsPDF. It takes
  the shaped glyphs and the opentype font as arguments and must not import
  `./harfbuzz` either, so `practiceSheetDraw.test.ts` paints real Amiri into a
  real jsPDF under Node, counts operators, and checks that glyph movetos land
  inside the row's ink band. Both writer bugs found on the branch would fail
  it: a path that never painted (no `f`/`S`), and a double y-flip (outlines
  mirrored below the baseline, outside the band).
- **`practiceSheetPdf.ts`** shapes (`measurePracticeRun`) and builds the PDF
  (`buildPracticeSheetPdf`, which calls `drawPracticeSheet`). It imports
  harfbuzz, so Vitest cannot load it; keep it to shaping and the jsPDF
  constructor.

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
- **Fit and alignment use the ink, not the advance.** `MeasuredRun` carries
  `inkLeftUnits`/`inkRightUnits` (pen position + `dx` + glyph box `x1`/`x2`).
  The run shrinks to fit its ink width, and `runWidthMm` is that ink width.
  A Thuluth basmala's swash starts several hundred units left of the pen
  origin, so fitting the advance sum pushed it about 6 mm into the left margin.
- **Rows walk left to right from `leftX`** with `penX += ax`, as `ShapedText.tsx`
  does. `leftX` is the *pen origin*, not the ink edge: it is placed so the
  ink's right edge sits exactly on the right margin. Nothing here handles bidi
  beyond what HarfBuzz emitted.
- **The footer lives inside `FOOTER_RESERVE_MM`.** Rows and grid stop that far
  above the bottom margin, and `layout.footerY` puts the footer baseline in
  that reserve; the writer reads `footerY` rather than recomputing it. In both
  nib and em mode a shrunk sheet's footer says so and names the size asked for.

## Writer traps

- **`glyphPathToPdfOps` takes RAW font-unit, y-up commands.** The writer passes
  `glyph.path.commands`, never `glyph.getPath(...)`: opentype's `getPath`
  already flips y, and the converter flips it again, so a second flip prints
  every glyph upside down.
- **jsPDF `path(lines)` takes one argument and only builds the path.** The
  writer calls `pdf.path(ops)` then `pdf.fill()` (nonzero) or `pdf.stroke()`.
  The TypeScript types still declare a `style` argument; the installed
  implementation ignores it, so passing one draws nothing.
- **Trace rows are two passes over the whole row: stroke every glyph, then
  fill every glyph white.** Stroking glyph by glyph left a seam tick at every
  join and, where glyphs overlap (Amiri's stacked محمد), each glyph's outline
  showed through the other, and learners trace exactly those lines. The white
  fill hides the inner half of every stroke and every internal seam, leaving
  only the outer silhouette. That is why the stroke is **0.30 mm `#B4B4B4`**:
  half of it is covered, so the visible outline is 0.15 mm. Do not interleave
  stroke and fill per glyph, and do not halve the width. Accepted cost: on
  trace rows the grid, and the baseline rule, are hidden inside the letter
  bodies.
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
  Export panel with only the selected block as input. `Sidebar.tsx` passes
  `undefined` when more than one block is selected, so the launcher is
  disabled under multi-select. Its `aria-label` is `Practice sheet`; renaming
  it means updating `e2e/` in the same commit.
- **An unavailable uploaded font is an error, not a fallback.** `resolveFontUrl`
  would silently shape in Noto Sans, so the dialog checks
  `isFontUnavailable(block.fontFamily, FONT_URLS)` on every render, shows
  "This block's font isn't available in this browser." and skips measuring.
  Availability is part of the run key, so a font primed after the dialog
  opened is re-measured in its real face.
- **The dialog stops keydown propagation** on its `role="dialog"` element.
  App's shortcuts listen on `window`, so Delete/Backspace would otherwise
  delete the block behind the modal and arrows would nudge it. Stopping the
  React event also keeps it from the dialog's own window Escape listener, so
  the `onKeyDown` handles Escape itself.
- **Deliberately ignored in v1:** diacritic overrides, stroke cuts, gradients, faux bold/italic (`fontStyle`),
  letter and word spacing. Kashida works because it is real tatweel text.
  Non-text block types never reach the dialog; the launcher is disabled.

## Tests

Unit coverage is the layout module (`practiceSheet.test.ts`, including real
Thuluth ink-fit checks), the converter/slug (`practiceSheetPaths.test.ts`),
and the painter (`practiceSheetDraw.test.ts`: real Amiri, real jsPDF with
`compress: false`, coarse operator counts, stroke-before-white-fill order,
and an ink-band check on glyph movetos, no pixels). Only the shaping wrapper in `practiceSheetPdf.ts` is untested.

Planned follow-up on the same page machinery, not built: alphabet sheets
(one letter and its forms per page).
