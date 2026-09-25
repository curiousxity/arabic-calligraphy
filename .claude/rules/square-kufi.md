---
paths:
  - "src/lib/squareKufi*.ts"
  - "src/components/SquareKufiText.tsx"
  - "src/components/KufiCellEditOverlay.tsx"
  - "e2e/square-kufi.spec.ts"
---

# Square kufi (`src/lib/squareKufi.ts`, `squareKufiAlphabet.ts`, `SquareKufiText.tsx`)

A sixth `Block` variant, `squareKufi`: the block's text set as strokes on a
lattice — الكوفي المربع, the hand worked into brick and tile. It is the one
block type that **loads no font at all**, and that is the fact the whole design
turns on. In square kufi a letter *is* its cells; there is no outline to fetch,
so the pipeline is `text → joining forms → boxes → cells → one traced outline`,
with no HarfBuzz, no `useShapedGlyphs`, and none of the per-glyph loops the
other four renderers are built around. `SquareKufiText.tsx` is the shortest
renderer here for that structural reason, not because it is unfinished.

`fontFamily` is therefore inert and its picker is hidden in Typography (with
the font-upload row and the missing-font notice, which are the same machinery),
the way `fontSize` is already hidden for a curve. `fontSize` *is* read, but only
through `kufiCellSize` — `fontSize / KUFI_CELLS_PER_EM`, eight cells to the em,
chosen so a square-kufi alef (seven cells) stands about as tall as a shaped one
at the same size. That is what lets the existing size slider work with no new
field.

**The alphabet is the feature.** `squareKufiAlphabet.ts` is a hand-authored
table: every letter, in every joining form, as rows of `#`. Two conventions in
it are load-bearing, and both were choices between coherent alternatives:

- **Every join is on the baseline.** Real cursive Arabic joins jeem to the
  previous letter at the top of its head; published square-kufi alphabets go
  both ways. Normalising every join to the baseline row is what lets a join be
  a plain run of baseline cells (the `bridgeAfter` loop in `layoutSquareKufi`)
  instead of a stepped path whose corner has to be reasoned about per letter
  *pair* — 30-odd letters squared. So a form's `joinsRight`/`joinsLeft` is a
  claim about ink at the **baseline row's own end column**, and
  `squareKufi.test.ts` asserts that of every form rather than trusting the
  table. Breaking that claim does not crash; it detaches one letter from the
  next, which is the kind of defect that reads as a font bug.
- **No dots and no tashkeel.** Traditional square kufi omits the iʿjām
  entirely, which is why ب/ت/ث are one skeleton here and not three. This is not
  a stub: a dot is a cell, and a cell beside a letter in a lattice this tight
  reads as part of the letter, so drawing them is a real design problem that
  would also have to widen the letters' advances to keep two neighbours' dots
  from merging. Deferred rather than half-done.

The table is checked structurally rather than by eye. `squareKufi.test.ts`
asserts over **every** skeleton and form that the box is rectangular and
non-empty, that the ink is 4-connected (a letterform in two pieces is a
floating fragment — there is no second pen lift in this hand), that **no 2×2
block of ink exists** (stroke = gap = one unit is the entire grammar; a 2×2 is
a stroke at double weight), and the join-ink rule above. Those four are what
make adding a letter safe.

**`base` is measured downward.** A form's `base` is how many rows its box hangs
*below* the baseline — 1 for the tails of ر, و, م and ج, negative to float ء
above the line. So `baselineRowIndex = rows.length - 1 - base` and
`formAscent = rows.length - base`. Getting the sign backwards puts the join row
outside the box, which the join-ink test then catches.

**One ascent and one descent for the whole block**, not per line, so every
wrapped line's baseline lands on the same lattice rows. Per-line metrics would
make a panel read as stacked strips rather than one woven field.

**`squareColumnTarget` searches rather than solves.** The column count that
squares a given text depends on which letters it uses and where the words fall,
so "Fit to square" tries widths from the widest single letter up to the
unwrapped band and keeps the best ratio. The layout is arithmetic over a
lattice — no shaping, no font — which is also why the Sidebar can afford to lay
the block out a second time to report its size and its unsupported characters
instead of threading the renderer's result back up through `App.tsx`.

**`layoutSquareKufi` keeps a two-entry cache**, because more than one consumer
lays the same block out per frame: the renderer, and — while the cell painter
is armed — the overlay, which must resolve a pointer against exactly the grid
the renderer drew. `kufiOptionsFor` already made them *agree*; the cache stops
them *paying twice*, on every mousemove of a paint drag. The layout it returns
is read-only to callers (`applyCellEdits` allocates its own cells whenever it
changes any). `squareColumnTarget` deliberately does not come through it — it
calls `layoutFromWords` directly, so its ~160 single-use candidates cannot
evict what the render path is about to ask for again. That
second pass is **memoised on the layout inputs, never on the block**
(`kufiReadout`): `Sidebar` re-renders on every pan, zoom and drag frame, and
children handed to `CollapsibleSection` are evaluated whether or not the
section is open — so unmemoised it cost ~4ms of every frame for a text
readout, collapsed panel included. Keying it on the block rather than on its
text and gaps would give most of that back, since dragging the panel replaces
the block object without changing anything the readout reads.

**"A few hundred passes is nothing" was wrong three times over**, and all of it
is worth keeping in view because the function reads as cheap:

- *The candidate count grows with the text.* The band widens as you type, so an
  exhaustive sweep is quadratic in length overall — measured at **7.1s of
  blocked main thread at 1800 characters**, from a button that stays clickable
  while it runs. `COLUMN_SWEEP_BUDGET` now caps the sweep at 160 coarse steps
  and re-sweeps every column within one step of the winner. That is a heuristic
  (a tooth on the error curve further than one coarse step away is missed), but
  it returned the *identical* column count to the exhaustive search at every
  size checked from 40 to 1800 characters, at 195ms instead of 7100.
- *`breakIntoLines` was itself quadratic*, rescanning `slotsWidth(current)` per
  candidate and re-summing each prefix when splitting a word. Both are running
  totals now. This one matters beyond the fit button: line breaking runs on
  every render of every square-kufi block.
- *Every candidate re-resolved the same text.* `layoutSquareKufi` opens by
  classifying the joining form of every letter, which was a measured **0.71ms
  of a 1.57ms pass** — re-done ~160 times for a string that cannot change
  across the sweep. `layoutFromWords` is the layout proper, taking already
  resolved words; `layoutSquareKufi` is the one-line wrapper that resolves,
  and `squareColumnTarget` resolves once and hands the result to every
  candidate. Measured 391ms → 206ms at 1800 characters, identical result.
  `kufiFormKey` is memoised on the form's own identity for the same reason:
  the forms are a few dozen stable objects from the module-level alphabet, so
  the same handful of strings was being rebuilt hundreds of thousands of times
  per press.

**`hardBreaks` counts splits, not overflows.** A single letter wider than the
limit takes an over-wide line of its own, and when it is the whole of what
remains nothing was split — so no join was lost, and the Sidebar must not tell
the user to widen the panel to close a break that never happened.

**The Panel width slider's range comes from the text, not a constant.** Any
width at or past the unwrapped band puts the text on one line, and
`squareColumnTarget` searches no further, so the band is the whole useful
domain — and a fitted value always lands inside it. A fixed cap could not: 80
against the 119 that 383 characters fit to, which left the thumb pinned at max
while the readout showed the real number, and the first touch of the track
silently collapsed the fitted panel. The bound is derived from the text rather
than from the slider's own value, or dragging would move the end of its track.

**`cellRings` traces the outline once around the union, never per cell.**
Stroking cell by cell would draw every internal seam and turn the block into a
visible grid. Each filled cell contributes only the edges it does not share
with another, wound so the material is on the edge's right in screen
coordinates — which makes outer rings clockwise and **holes counter-clockwise**,
so an ordinary nonzero `fill()` empties the counters of ه and ص with no
even-odd flag to push through Konva's context wrapper. In screen coordinates
(y down) a clockwise ring gives a *positive* shoelace sum, the opposite of the
textbook reading; the test says so rather than re-deriving it.

Everything else is ordinary. The block takes `fill` through
`createBlockFillPainter` like the rest (nothing here draws under a transform of
its own, so the painter's block-space dance is a no-op — but building it over
the whole grid is what makes one gradient sweep the composition rather than
each letter), draws its outline before its fill for the reason recorded in CLAUDE.md (Rendering),
and mirrors through `MirrorBlockView` like any other type. Per-glyph tools do
not apply and are not gated against: they key off shaped glyph indices, which
this block has none of.

Deliberately out of scope: dots, tashkeel, spiral compositions, and Latin.

## Boustrophedon — snaking return lines

`kufiComposition: "boustrophedon"` makes the reading snake: line 1 runs right
to left, line 2 continues from where it stopped, and the stroke turns the
corner between them. Absent (or anything unrecognised) is `"lines"`, whitelisted
by `normalizeKufiComposition` rather than clamped — it is a string union, so a
value from a later release or a hand-edited save must fall back rather than be
coerced — which is why a project saved before the feature needs no payload
version bump.

- **A return line is rotated 180°, never mirrored.** Published panels do both;
  this is the decision, and the rejected alternative is recorded in the module
  header beside it because the choice is invisible in the code that implements
  it. A mirrored Arabic letter is not that letter — its tooth is on the wrong
  side and its joins run backwards — and rotation additionally puts a line's
  two endpoints on the same edge as its neighbour's, which is what makes the
  turn a short L rather than a run across the panel.
- **`placeLine` renders a line into its own tight sub-grid and blits it under
  `turns`.** Going through the sub-grid is what makes the turned case correct
  by construction rather than by a second set of coordinate formulas, and
  `turns: 0` is an identity blit that reproduces the flush-right composition
  cell for cell — the whole safety margin of the extraction, and the reason the
  existing ASCII assertions never moved. The blit is a **full scan** of the
  sub-grid, and that was measured rather than assumed: recording each cell's
  coordinates as it is written and walking that list instead made a *single*
  wide layout faster but a Fit press ~9% **slower**, because the sweep's narrow
  candidates give many small dense sub-grids where the push costs more than the
  scan saves. Don't retry it without measuring the sweep, not one layout.
- **A turned line's baseline row is `bandTop + descent`, not `bandTop`.**
  `baselineRowInBand` is the one place that arithmetic lives. The band is
  `ascent + descent` rows and an unturned baseline sits at `ascent - 1`, so the
  half turn lands it at `descent`. **`descent` is 1 for any text containing
  ر و م ج ح ه** — most real phrases — so the plausible reading (the band's top
  row) puts every turn one row clear of the letters it exists to join. A test
  written with a descender-free fixture holds either way and proves nothing;
  `squareKufi.test.ts` asserts `descent > 0` of each of its eight phrases
  first, and the wrong arithmetic takes four of its assertions red at once.
- **Two reserved gutter columns down each side** (`KUFI_TURN_GUTTER`), so
  `cols = max(columns, ...lineWidths) + 4`; even lines are flush right against
  `cols - 3` and odd lines flush left from column 2. The turn's vertical leg
  runs down the **outermost** column, leaving the inner one as a permanent
  buffer. **One column each side is not enough**, and that is measured rather
  than argued: the leg necessarily spans the baseline *and* descender rows of
  the line it leaves, so with a single gutter it sits directly beside ر or ج —
  both of which carry ink at their left column on both rows — and 123 of 144
  real compositions came out with a 2×2. With the buffer, 0 of 144, and 0 of
  21,600 randomly generated ones across the whole alphabet at four line gaps
  and three word gaps. The composed-grid test is the guard; the buffer is the
  mechanism.
- **The turn is single-cell-wide throughout** — the same primitive a letter
  join already is. It is drawn only when *both* baseline rows carry ink to
  attach to, since a dangling stub reads as a stray stroke. Connectivity is
  asserted **4-connected**, reusing `connectedCount`'s neighbour rule: an
  8-connected fill accepts a bridge that meets the next letter corner to
  corner, which is two strokes touching rather than one turning. That was
  verified by building exactly such a bridge — the 4-connected assertion went
  red and the 8-connected variant stayed green.
- **`lineGap` is floored at 1 while snaking.** At gap 0 with no descenders the
  two baseline rows are adjacent and the turn's own two horizontal legs stack,
  which is a 2×2 made by the bridge alone.
- **A single line is exactly `"lines"`** — gutters are not reserved for a turn
  that cannot happen, or switching mode would widen a block while changing
  nothing else.
- **`App.tsx`'s `setKufiComposition` sets a wrap width in the same patch.**
  Every block is created with `kufiColumns: 0` and `breakIntoLines` reads that
  as `Infinity`, so a fresh block is one unbroken line and the switch would
  otherwise do nothing visible at all. Two document fields moving together is
  why it is a handler in `App.tsx` rather than a `SelectRow` patch in the
  Sidebar: one `pushHistory()`, one undo.
- **Known and inherent: the inter-line white space alternates.** A turned
  line's tails point upward, so the gap under an upright line is
  `lineGap + 2·descent` rows and the one under a turned line is `lineGap`.
  That is what turning a line with descenders does. The guide says so.

`squareKufi.test.ts`'s four structural assertions still check only the
*authored alphabet*; a turn bridge is composed geometry that never passes
through them, which is why the composed-grid invariants are separate
assertions over eight real phrases at five widths in both compositions.

## Hand-painted cells (`KufiCellEditOverlay.tsx`)

Ticking **Paint cells** in the Square Kufi panel puts a lattice over the block:
click or drag to fill cells, click ink to cut it away. This is how a
calligrapher actually finishes a panel, and it is cheap here for the same
structural reason the block type is — no font, no shaping, no coordinate
adapters, no async.

- **An edit is anchored to a letter, never to the grid.** `ascent`/`descent`
  are block-wide, `cols` is `Math.max(opts.columns, ...lineWidths)`, and every
  line is laid flush right from `cursor = cols` — so nearly every text edit,
  and the Panel width, Line gap, Word gap and Fit-to-square controls too, move
  every absolute coordinate in the panel. `KufiCellEdit` is therefore
  `{ unitIndex, unitKey?, dx, dy, on }`, with `dx`/`dy` in cells from the
  letter's own placed box.
- **`dy` is measured from the baseline row, not the box top.** The box top is
  `lineTop + (ascent - formAscent(form))`, which moves whenever the form
  changes height even though the letter has not.
- **`unitKey` fingerprints the resolved `KufiForm`** (`rows.join("|")|base`),
  not `skeleton:form`. `squareKufiAlphabet.ts`'s `all()` gives feh, heh and tah
  one `KufiForm` across all four joining forms and `TOOTH_INITIAL`/
  `TOOTH_MEDIAL` are shared objects across beh, noon and yeh — so typing the
  next letter of a word can change the *requested* form while the drawn box is
  literally the same object, and a `skeleton:form` key would throw the user's
  edits away on that keystroke. It is the faithful analogue of `glyphId`:
  identity of what is drawn. And like `glyphId` it is **optional** — an edit
  carrying none still applies, rather than being dropped as unverifiable.
- **Placements are emitted from inside the existing `lines.forEach`**, in the
  same pass that writes the cells, and are **gated behind
  `layoutSquareKufi`'s third argument**. Both halves matter: a second pass over
  the same arithmetic type-checks perfectly and lands every edit a cell or two
  off, and `squareColumnTarget` re-lays the text ~160 times per Fit press —
  per-unit allocation across that sweep is exactly the cliff this function has
  already been wrong about twice.
- **Which letter owns a cell: the nearest one.** That is the maintainer's
  chosen rule, decided on this feature rather than defaulted into. Distance is
  measured to the nearest point of the letter's *box*, not to its centre, so a
  cell just outside a wide letter belongs to it rather than to a small letter
  whose centre is nearer; a cell inside a box is at distance 0, which is why no
  separate containing-box stage exists. Ties go to the lower `unitIndex`, never
  to emission order. It lives alone in `resolveCellOwner` because it decides
  where a cell painted out in the blank field travels on rewrap — provisional
  in the sense that it is worth re-judging on a real panel, and one function to
  change if it is.
- **`KUFI_EDIT_REACH` (8 cells) bounds the anchor**, because nearest-letter
  ownership without a bound would tie a cell dropped in an empty corner to a
  letter half a panel away and then move it with that letter. Out-of-reach is
  refused at the point of painting *and* counted as dropped when resolving.
- **The composed grid can start at a negative origin**, and
  `SquareKufiText` puts `originX * cell` / `originY * cell` on **both the hit
  `Rect` and the `Shape`**, drawing at plain `cx * cell` in that shifted frame.
  Keeping the nodes at 0,0 and offsetting only the draw calls leaves Konva's
  self-rect excluding the grown ink, and `exportBox`, `buildSnapTargets`, Align
  & Arrange and `MirrorBlockView`'s settle loop then all silently under-report
  — cells cropped out of every PNG on a freeform document. `e2e/square-kufi.spec.ts`
  pins it by asserting the client box grows *upward* after a cell is painted
  above the panel; that assertion was verified to fail with the offset removed.
- **The overlay is one hit `Rect`, one lattice `Shape` and one highlight**,
  never a node per cell — a padded 60×60 panel is thousands of listening
  nodes. It also means the Konva `mouseleave`/`compareShape` race the three
  hover-handle overlays fight structurally cannot happen here: nothing is
  hover-*mounted*, so there is no sibling for the pointer to retarget onto.
  Don't reintroduce per-cell nodes without re-reading that.
- **Two frames, and the overlay states which it is in.** The pointer resolves
  to a cell in the *generated* frame (the one placements are expressed in)
  while the drawing may sit at a negative origin. Everything in the overlay is
  kept in the generated frame, where group-local px is exactly
  `cell index × cellSize` — the same convention the renderer draws under.
- **The stroke ends on a stage-level mouseup.** Konva does not capture the
  pointer, so a fast drag that leaves the hit rect would otherwise strand paint
  mode on. A whole stroke is **one** undo entry: `beginKufiCellEdit` is a bare
  `pushHistory()` on mousedown and `setKufiCell` calls `setBlocks` directly —
  routing paint through `updateBlock`/`updateSelectedBlock`, which push
  unconditionally, would cost one undo per painted cell.
- **Painting a cell back to what the alphabet draws removes the entry**
  (`upsertCellEdit`), the same zero-is-a-removal rule `setStrokeCut` follows,
  or the array grows forever as a user paints and unpaints.
- **`kufiOptionsFor(block)` is the single source of a block's layout options**,
  used by the renderer, both Sidebar readouts, the placement ghost, Fit to
  square and the overlay. The overlay resolves a pointer against the grid the
  renderer drew, so one forgotten field puts the two a wrap apart.
- **Painted cells legitimately break the alphabet's grammar** — a 2×2 block, a
  floating island. That is the point of the feature. The four structural
  assertions in `squareKufi.test.ts` check the *authored table*, which a hand
  edit never passes through, so paint must not be validated against them.
- While the tool is armed the panel cannot be dragged; the overlay's hit rect
  takes the pointer. The guide says so.
- **A mirror draws the hand edits too**, `MirrorBlockView` passing
  `kufiCellEdits` straight through, with no stable-identity constant beside
  it: `SquareKufiText` defaults an absent list to its own module-level
  `NO_CELL_EDITS` rather than keying a memo on whatever the caller passed.
  **Every renderer here now does that**, `ShapedText` and `ShapeFillText`
  included — a default of `[]` in the parameter list is a fresh identity per
  render, and these props feed memos that walk every glyph's outline. Defaulted
  at the component, the guard holds for every caller; defaulted at the call
  sites, as `CanvasStage` and `MirrorBlockView` used to have to do, a caller
  that forgets gets a silent per-frame re-walk with nothing to see.
