---
paths:
  - "src/lib/markLibrary*.ts"
  - "src/components/MarkView.tsx"
  - "src/components/sidebar/MarkPanel.tsx"
  - "src/components/sidebar/MarkPicker.tsx"
  - "scripts/marks/**"
  - "e2e/marks.spec.ts"
---

# Mark library (`mark` blocks)

Loose pen pieces (strokes and tails, heads and loops, dot groups, small
signs) placed anywhere on the canvas. Added 2026-10-16. Unlike the tashkeel
library ([tashkeel-library.md](tashkeel-library.md)) nothing is typed: a
mark is not a character in any font, so it is its own block type.

**Where the outlines come from.** `src/lib/markLibraryData.ts` is generated
by `scripts/marks/traceMarks.py` from the raster sheet
`scripts/marks/source.jpg` (a user-supplied 514×484 image on a grey grid).
The script finds marks as clusters of dark pixels (dilated 9px, so a mark's
separate dots stay together), keys them row+column (`"40"` = row 4, first),
enlarges 8×, closes small gaps left by the grid lines, and traces with
potrace. One cluster pair is merged by hand (`54` + `55`, a ه over its
stroke). Names and groups are a table at the bottom of the script; it
asserts every traced mark is named. **Don't hand-edit the data file**;
change the script and re-run it (the command is in its docstring).

The traced quality is bounded by the source: marks are 12–80 source px, so
edges are smooth but not pen-sharp. A cleaner sheet (higher resolution, no
grid) dropped in as `source.jpg` re-traces with no code change, provided
the row/column layout and the name table still match.

**Units and size.** Paths are in units of 1/10 source pixel, centred on the
outline's own measured box (curves sampled, not the pixel mask, so the
stored `w`/`h` match what is drawn; a unit test holds this). Only M/L/C/Z
commands: `parseSvgPath` flattens arcs. Size is `fontSize`:
`MARK_UNITS_PER_EM = 400` (the sheet's letters are about 40px tall), so a
mark at a block's font size sits at its letters' scale. A new mark takes the
selected block's size and colour.

**The block** (`MarkBlock` in `types.ts`) stores `markId` *and* `markD`, so
a save draws the same even if the library entry is renamed, re-traced or
removed. `markFlipX` mirrors left–right; rotation is `BlockCommon.rotation`.

**Rendering** (`MarkView.tsx`) copies StackView: a transparent `Rect` for
hit and bounds (a sceneFunc-only Shape measures 0×0, which would break
snapping, align and export bounds), outline before fill, gradients through
`createBlockFillPainter`, commands pre-scaled to px (react-konva-to-svg loses
a path drawn under `ctx.scale`). Mirrors draw it through `markProps` like
every other type.

**Sidebar.** The *Marks* panel (canvas tier, after Block Controls, closed by
default) adds one: click a mark, then click the canvas (`beginPlacement`).
It is not in the Add grid, which is a fixed 3×2 (see sidebar.md). The
*Mark* type panel holds Size, Color, Opacity, Rotation, Flip and the same
picker to swap the shape. **Typography hides for a mark**: none of its rows
but size and colour apply, and those are in the Mark panel. Effects (fill,
outline, shadow) shows as usual. Font and Content hide via `hasOwnFont`.
