---
paths:
  - "src/lib/markLibrary*.ts"
  - "src/lib/frameWindow*.ts"
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
by `scripts/marks/traceMarks.py` from the raster sheets listed in its
`SHEETS` table: sheet `a`, `scripts/marks/source.jpg` (a user-supplied
514×484 image on a grey grid, 52 marks), and sheet `b`,
`scripts/marks/source-2.webp` (1005×740, clean white, drawn about twice as
large; 15 marks, its other 14 skipped as repeats of sheet `a`), and sheet
`c`, `scripts/marks/source-3.png` (847×760, crowded, about sheet `a`'s
scale). Sheet `c` mostly repeats `a` and `b` and its rows don't sort cleanly,
so it is not named row by row: its `seeds` table picks the 12 new marks by
one source-pixel point each (the nearest cluster is traced), and every other
cluster on it is ignored. Its three drop shapes are the *Frames* group, for
now placeable like any mark (a real frame feature is still to build). Each sheet
has its own `unit` so all come out at one scale (an alif about 500 units),
and its own `prefix` for ids (`a` has none, so ids saved before `b` existed
still resolve; `b`'s are `strokes-b04` and so on). Adding a sheet is a
`SHEETS` entry plus its names in `GROUPS`; the script asserts every traced
mark on a sheet is either named or skipped.
The *Thuluth* group is different: its pieces come from the grandfather's
scanned lesson sheets, cleaned and traced for review under
`scripts/marks/thuluth/` (ledger: `thuluth/REVIEW.md`). `traceMarks.py`
does not trace them; its `TRACED` table reads the review's saved trace, and
only pieces the user has approved are named in `GROUPS` (ids
`thuluth-t1-23` and so on). A clean outline the user supplies is one JSON
per piece (`thuluth/outlines/outline-NN.json`, ids `thuluth-outline-NN`),
traced by `thuluth/traceOutline.py` at a units-per-pixel the ledger records. Nothing goes into that group without approval.
Every scanned Thuluth piece is **edge-smoothed at generation**
(`thuluth/smoothEdges.py`, called from `traceMarks.py`): the scans leave a
pixel ripple a fraction of a pen wide on every edge, and blurring before
tracing would round the nib's corners, so each contour is smoothed along its
length with corners held, then re-traced. Results are cached by outline in
`thuluth/traces/smoothed-cache.json`; the vector set and frames skip it.
The pieces kept in the final run-through are listed in
`thuluth/kept-2026-10-18.json`, not inline in `GROUPS`.
The script finds marks as clusters of dark pixels (dilated 9px, so a mark's
separate dots stay together), keys them row+column (`"40"` = row 4, first),
enlarges 8×, closes small gaps left by the grid lines, and traces with
potrace. One cluster pair is merged by hand (`54` + `55`, a ه over its
stroke). Names and groups are a table at the bottom of the script; it
asserts every traced mark is named. **Don't hand-edit the data file**;
change the script and re-run it (the command is in its docstring).

The traced quality is bounded by the source: marks are 12–80 source px, so
edges are smooth but not pen-sharp. Sheet `b` shows what a clean, larger source gives;
prefer one like it for new marks.

**Units and size.** Paths are in library units (sheet `a`: 10 per source pixel), centred on the
outline's own measured box (curves sampled, not the pixel mask, so the
stored `w`/`h` match what is drawn; a unit test holds this). Only M/L/C/Z
commands: `parseSvgPath` flattens arcs. Size is `fontSize`:
`MARK_UNITS_PER_EM = 400` (the sheet's letters are about 40px tall), so a
mark at a block's font size sits at its letters' scale. A new mark takes the
selected block's size and colour.

**Loaded on demand** (2026-10-18). `markLibraryData.ts` is ~1.9 MB and
most sessions never use it, so nothing imports it statically:
`loadMarkGroups()` fetches it as its own chunk, `useMarkGroups(enabled)`
wraps that for components. The picker mounting (the Marks panel opened, or
a mark selected) is what loads it; the Layers list loads it once a mark
block exists, for names; until then `findMark` returns undefined.
`isFrameMark` goes by id (`frames-…`) so it never needs the data. Tests
`await loadMarkGroups()` at the top. Don't add a static import of the data
file or of `MARK_GROUPS` anywhere; it pulls the whole library back into the
main bundle.

**The block** (`MarkBlock` in `types.ts`) stores `markId` *and* `markD`, so
a save draws the same even if the library entry is renamed, re-traced or
removed. `markFlipX` mirrors left–right; rotation is `BlockCommon.rotation`.

**Rendering** (`MarkView.tsx`) copies StackView: a transparent `Rect` for
bounds only (a sceneFunc-only Shape measures 0×0, which would break
snapping, align and export bounds) — it is `listening={false}`. **The hit is
the ink**: the Shape's `hitFunc` fills the outline plus a 5px stroke
(`HIT_MARGIN_PX`, so a lone dot stays easy to grab). Until 2026-10-16 the
bounding Rect was the hit, and a frame's open middle swallowed every click
meant for the text inside it. Outline before fill, gradients through
`createBlockFillPainter`, commands pre-scaled to px (react-konva-to-svg loses
a path drawn under `ctx.scale`). Mirrors draw it through `markProps` like
every other type.

**Frames** (2026-10-16). A frame is a mark from the `frames` group
(`FRAMES_GROUP_ID`, `isFrameMark`). Picked in the Marks panel *with a block
selected* (not a mark, not a guide), `frameSelectedBlock` in `App.tsx` wraps
that block instead of starting a placement:
- `frameWindow(d)` (`frameWindow.ts`, pure) finds the frame's open window:
  the largest axis-aligned rectangle of grid cells (120 along the long side)
  inside the outline's convex hull and at least one cell clear of ink
  (even-odd, so a counter reads as empty). No per-frame setting, so a new
  frame sheet needs nothing but its trace; a frame with no window (a solid
  shape) falls back to ordinary placement.
- `fitFrameToRect` maps the window onto the block's on-canvas box
  (`getClientRect` relative to the stage) padded by `FRAME_PADDING` (12%)
  each side. It stretches **each way independently** — the user's call:
  "resizing is fine as long as we can see through the center" — via
  `markScaleX`/`markScaleY` on top of `fontSize`'s uniform scale, the
  uniform part chosen so the two stretches multiply to 1.
- The frame is inserted **just below** the framed block (drawn behind it),
  takes its colour, and shares its `groupId` (a new one if it had none), so
  they move together. One `pushHistory()`.
- `frameWindow` reads ink by one scanline per row of cells. It used to test
  every cell against every contour, which took ~17 s on the speckled corner
  frames and would have frozen the click.
- **Panel frames** (2026-10-18), from the grandfather's panels, ids
  `frames-<key>` read from `scripts/marks/thuluth/traces/frames/<key>.json`:
  two sets of corner florals (`traceBorder.py`: the ornament kept by boxes or
  a ring, letters excluded; ordinary stretch frames) and the **rosette
  border**, a *tile*. A whole-border trace was 521 KB and blurry, so
  `tileBorder.py` cuts one period, folds it onto its mirror images to average
  out the scan, and traces it once (~10 KB, `tile: {period, band}` on the
  item). Framing a block with a tile item builds the ring in
  `frameSelectedBlock` (`tileRing.ts`, pure): tiles along top and bottom,
  turned 90° down the sides, counts chosen so the opening holds the padded
  box, tile size `TILE_SHARE_OF_EM` of the block's font size, never
  stretched. The baked ring is the block's `markD`, so nothing else changed;
  a ring is roughly tiles × 10 KB in a save. Picked with nothing selected, a
  tile places as a single tile. `frameWindow.test.ts` skips tile items.
- The fit is a one-off: editing the text does not refit. A frame's Mark panel
  shows *Stretch width* / *Stretch height* (0.3–3) for adjusting by hand;
  other marks don't get those rows, though `markScaleX/Y` works on any mark.

**Sidebar.** The *Marks* panel (canvas tier, after Block Controls, closed by
default) adds one: click a mark, then click the canvas (`beginPlacement`).
It is not in the Add grid, which is a fixed 3×2 (see sidebar.md). The
*Mark* type panel holds Size, Color, Opacity, Rotation, Flip and the same
picker to swap the shape. **Typography hides for a mark**: none of its rows
but size and colour apply, and those are in the Mark panel. Effects (fill,
outline, shadow) shows as usual. Font and Content hide via `hasOwnFont`.
