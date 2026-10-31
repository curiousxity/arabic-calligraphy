---
paths:
  - "src/lib/kufi/**"
  - "src/hooks/useKufiPanelLayout.ts"
  - "src/components/KufiPanel*.tsx"
  - "src/components/sidebar/KufiPanelPanel.tsx"
  - "e2e/kufi-panel.spec.ts"
---

# Kufi panel (`kufiPanel` blocks)

Text laid out as square Kufi filling **one box** of `panelCols x panelRows`
cells, drawn as a single traced outline. Built 2026-10-28 to 2026-10-30 on
branch `claude/kufi-square` (not merged). The argument for the design, the
user's own words and the future plan are in
`docs/superpowers/specs/2026-10-28-square-kufi-compositions-design.md`; this
note is how it works and the traps.

**Why the names are `kufiPanel` / `panel*`.** The earlier Square Kufi block
was removed (see [removed-subsystems.md](removed-subsystems.md)): `squareKufi`
is in `REMOVED_BLOCK_TYPES` and `kufiColumns`, `kufiComposition`,
`kufiLineGap`, `kufiWordGap`, `kufiCellEdits`, `kufiCellEditMode` are in
`REMOVED_BLOCK_FIELDS`, and the sanitizer strips them on load. Reusing any of
them would see a new block deleted from its own save. New fields are
`panelCols`, `panelRows`, `panelEdits`. Do not "tidy" the names back.

## Lattice grammar

Stroke = gap = one cell. No 2x2 of ink anywhere, and no empty 2x2 either
(see below). A letter's ink is 4-connected; joins and turns are single-cell
runs. Letters change only by stretching or shortening a marked row or column
in whole cells (shortening down to the form's `min`), or by swapping to
another authored form, never by scaling. No
tashkeel: harakat in the input are dropped silently. `kufiGrid.ts` holds the
shared cell arithmetic (`cellRings`, `packedCells`, `applyCellEdits`);
`kufiAlphabet.ts` the authored forms (`KUFI_FORMS`, stretch points, joins,
`dotCells`); `kufiWords.ts` turns text into `KufiUnit`s (one per letter or
ligature, with a `key`, a `wordIndex` and a UTF-16 `textOffset`).
**Presentation forms:** only ﷲ (U+FDF2) and the lam-alef forms
ﻻ ﻼ ﻷ ﻸ ﻹ ﻺ ﻵ ﻶ (U+FEF5–U+FEFC) are normalised NFKC to their letters before
resolving; every unit made from one carries the form's own `textOffset`, so
edits keyed on it still find their place. Other presentation forms stay
"Not drawn": a shaped single letter would lose its dots (the packer reads
dots from the original character), and an isolated haraka form normalises to
a space that would split the word.

## The packer (`kufiPack.ts`, pure)

`packKufiPanel({ text, cols, rows, edits?, previous? })` returns `ok:true`
with `cells`, `placements` and `editsBreakPacking`, or `ok:false` with a
reason (`tooShort`, `tooLong`, `pinConflict`) and size suggestions
(`pinConflict` never has any: the pins hold absolute cells, so other sizes
are no better).

- **Structure.** Words run clockwise round the frame from the bottom right,
  every baseline on the outer edge: bottom line upright, left line turned and
  read upwards, top line upside down, right line read downwards. Then a ring
  one band inside, and so on to the core. A band is 5 cells deep (`BAND`).
  A word never bends round a corner: it breaks between pieces (runs of joined
  letters) or turns back through `join.uturn.0`. A piece slides along its line
  until its ink neither overlaps nor touches what is placed, which is what
  interlocks the bands.
- **Search.** Letters are placed in reading order, every choice (line,
  alternate, stretch, join run, U-turn, dots) enumerated, scored in place and
  undone; a beam (6, 12, 24 wide) keeps the best distinct panels and widens
  pass by pass until one packs or the budget ends.
- **Natural-length phase.** Packing is found first with strokes free to
  stretch; once packed, the search goes on toward each letter's authored
  length: single-letter polishing, pair moves, then the **repair move** (a
  letter is put back nearer its natural length even where that displaces
  several others, which are replayed and give way to their best fit).
  A greedy packing must still run this phase (an early return once skipped it).
- **Ranking, in order:** packed first; then fewest filler squares (never two
  within two cells of each other, because a pair reads as a dot set); then
  least shortening; then least lengthening. Lengthening is how space is
  filled, so it is preferred to a filler square.
- **Deterministic work budget plus a clock safety net.** A search stops after
  a fixed count of moves (`WORK_PER_MS` x budget), so a busy machine gives the
  same panel as a quiet one. The clock only ends a search that would run past
  `FIRST_DRAFT_CLOCK_MS` (1700 ms; panels up to 32x32 get 2.5x the budget in
  clock terms before it). Only under extreme load can the clock change the
  answer. `PACK_BUDGET_MS` = 1400 (first draft), `REPACK_BUDGET_MS` = 150
  (a repack from `previous`, used for drag previews). `CALL_BUDGET_MS` = 1750.
- **Pinned fresh path.** A reload of a panel with pins has no previous
  layout, so it rebuilds with a draft plus repacks. That path alone is
  bounded by `PINNED_CALL_MS` = 2 x `CALL_BUDGET_MS`; suggestions for
  tooLong/tooShort are computed afterwards within their own budget.
  `fitKufiPanel` tries sizes up to `FIT_BUDGET_MS` = 9000 (worst case it
  is why the worker exists).
- **Test-only clock override.** `setClockOverride(deadline)` makes every
  search use that deadline (Infinity = work-bounded only). Any test that
  asserts a *layout* must use it; wall-clock tests are flaky under load.
  Product code never sets it.
- **Dots are i'jam.** A dotted letter carries its whole dot set (from
  `dotCells`, e.g. ya two below, ta two above, tha three above, nun and fa one
  above, ba one below) on the side where that letter's dots really go, or no
  dots at all; never a partial set, and never dots as free filler (a dot in the
  wrong place turns one letter into another). A whole set may move **one
  cell** along its line (the user accepted this; the reference does it). A
  lone filler square is a different thing: it may plug a hole but never where
  it could read as a letter's dot.
- Alphabet traps carried into the packer: some alternates join off the
  baseline (use `joinRow` / `joinCol`); `join.uturn.0` is valid only before a
  letter joined at its top; a form the user chose sets that letter's own
  natural length.

## Edits (`KufiPanelEdits`) and reconciliation

Edits are keyed by **unit index** (a letter or ligature), each carrying the
unit `key` so a stale save is detected, not misapplied: `forms`, `stretch`,
`pinned`, and `cells` (painted cells). `routes` is keyed by word index.

- **Text changes.** `reconcileEdits(edits, oldUnits, newUnits)` (the signature
  the plan gave could not detect shifts) aligns old and new units by diff and
  moves each edit with its letter; edits on removed letters are dropped.
  `kufiPanelTextPatch` is the one place a text change goes through it.
  `alignUnits` first matches the untouched runs at both ends (same key and
  `textOffset` for the prefix; same key and the text's length shift for the
  suffix) and runs the LCS on the keys of the middle only, so a single insert
  or delete beside **repeated identical letters** (a ي typed before يكلف)
  leaves the edit on the letter it was made on. Only an edit inside a run of
  identical keys that itself changed is still ambiguous, and then the
  earliest copy takes it.
- **Pins.** Only `pinned` fixes a place; a `forms` or `stretch` edit keeps the
  edit, not the position. The **UI** pins the edited unit at its resulting
  placement when a gesture commits (the packer never pins by itself), so later
  repacks hold it. Only **explicit** pins (from `edits.pinned`) can cause
  `pinConflict`; pins the packer adds during a repack are implicit and are
  dropped in its last round. Pins hold **absolute cells**, so they survive a
  size change, a Fit (which packs every candidate size with them) and a text
  change, and a pinned panel set to a size its pins do not fit is empty with
  `pinConflict`. **Release hand edits** (`kufiReleasePins`, the button in the
  Kufi panel section whenever `pinned` is non-empty, on the `pinConflict` line
  when there is one) drops `pinned` and `routes` (a route is the record of a
  pin's drag) and keeps `forms`, `stretch` and `cells`, as one undo step.
- **Routes are a record only.** The packer does not read `routes`. A word
  moves by a pin on its first letter, with the word's other pins released so
  its letters follow; the route number is what the next drag starts from.
  A slide that opens a gap behind the word never packs, and on **tight panels
  most moves are refused**: freeing the letters before the word on its line is
  all a re-route may do. On the Al-Baqarah panel nothing moves at plus or minus
  one or two cells (verified with a 20 s budget; the gap is irreducible under
  the grammar). The tool is mostly idle on tight panels and says so in the
  status line. Letting the rest of the panel re-arrange is an open decision
  (spec, future plan).
- **2x2 rules, both ways.** A solid 2x2 of ink is forbidden; an *empty* 2x2
  (a hole) is a packing failure too. Painting (`cells`) can break either, and
  the panel is *not* hidden: it stays `ok:true` with `editsBreakPacking: true`,
  re-checked after painting (`packedCells`), and the status line says
  "Painted cells leave a gap". Painting is a deliberate last resort.
  A cell painted onto a solid 2x2 is refused outright.

## Worker and cache (`kufiLayoutClient.ts`, `useKufiPanelLayout`)

A first draft takes about 0.7 to 1.7 s and a Fit up to about 9 s, so the
packer runs in a Web Worker (`kufiPack.worker.ts`, protocol in
`kufiWorkerProtocol.ts`); nothing on the main thread waits.

- **Cache keyed on inputs, not on the block.** Key = text, cols, rows, edits
  (`kufiLayoutKey`). Dragging a block (new object, same inputs) costs nothing,
  and export / mirrors read the same cache. **Wanted keys are never evicted**
  (any key a mounted slot is drawing): evicting one only sends it straight back
  to the worker. The rest is LRU to `KUFI_CACHE_LIMIT` (64).
- One job in flight; only the newest wanted layout waits behind it. Replies
  carry a request id and stale ones are dropped (still cached by their own
  inputs). Previews (`previewKufiLayout`) are one deep, packed from an explicit
  `previous`; a preview that packs is cached so committing it costs no second
  pack.
- **Watchdogs.** `KUFI_PACK_WATCHDOG_MS` = 10 s and `KUFI_FIT_WATCHDOG_MS` =
  30 s: a worker that dies silently is replaced and the job fails. A `pump()`
  stall guard keeps the queue moving. A failed pack is recorded
  (`kufiLayoutFailed`) so the status says "Couldn't arrange this text".
- **Fit rejects `"Fit failed"`** if the worker dies; the sidebar catches it and
  says so. A Fit answer for inputs that have since changed is dropped by `App`.
- Export paths read synchronously: `cachedKufiLayout` and `ensureKufiLayouts`
  (which packs on the calling thread what the cache lacks).
- `useKufiPanelLayout` returns `KufiPackResult | null` (null while the first
  draft is pending); a panel with no ink yet is still grabbable at its box size.
- The panel is a block like the others; the Fit and size fields live in
  `sidebar/KufiPanelPanel.tsx`, the status line in `kufiPanelStatus.ts` (pure).
  The size fields have a minimum of 3 cells and no maximum.

## Export

`KufiPanelView` draws the panel as **one traced outline**: `cellRings` traces
the boundary of the union of inked cells (outer rings clockwise in y-down,
holes counter-clockwise, so a plain **nonzero** fill empties the counters),
never cell by cell. Points are scaled to px before drawing, not under
`ctx.scale` (the SVG exporter loses a path drawn under a scale); outline
before fill, gradients through `createBlockFillPainter`. The SVG is a single
`<path>` a laser cutter can follow **when the outline width is 0**; a width
above 0 exports the outline as a second path, and the panel says so in its
status line. A new panel starts with outline 0 (text الله, 21x21, then a Fit
resizes it).

## Canvas gestures (`KufiPanelEditOverlay`, `kufiHit.ts`, `kufiPull.ts`, `kufiPaint.ts`)

No modes, no coloured dots: hover outlines and direct drags only. The overlay
is **pointer-resolved** (one listening `Rect`; cell under the pointer found in
arithmetic), like Next Shape; outline, handle and the e2e marker are
`listening={false}`, so there is no Konva hover-leave race. A gesture's drag
is a stage listener, not a node drag.

Priority on mouse down: **Alt first** (paints, claims the press whatever is
under it) -> a **handle** -> any other cell of a letter, not claimed: a press
that drifts drags the whole panel, a **still press (within `CLICK_SLOP`) is a
click that cycles the letter's form** among alternates that pack (skipping
those that do not; a click that finds none says so).

A letter's handles are its **stretch ends** (`stretchEnds`; an `end` is the
last cell of a stroke a stretch point lengthens, or a **slice grip** on a
stretchable slice with no free end) and, for a **word's first letter, its
route handle** (`routeHandleOf`: the leading cell of the letter's box, on the
baseline side; dragging it moves the word along its line). Hover shows **one
square**, the handle whose drawn square (`handleCentre`) is nearest the
pointer. A handle's hit cells are its own and the paper cell its square
straddles onto (`hitStretchEnd`, `hitRouteHandle`); where a stretch end and a
route handle share a cell (a first letter's leading corner is often a
stroke's end) the pointer's place in the cell decides, so what hover shows is
what a press takes. A press anywhere else on a first letter is the letter's
own (panel drag or click), never the word's. `KufiEditTargets.words` (e2e)
publishes a point on each route handle's square.

Alt-click toggles a cell, Alt-drag paints every cell crossed the way the
first went: the cells between two pointer samples are filled in
(`cellsBetween`, a 4-connected Bresenham walk), each painted on its own, so a
fast hand paints the same line as a slow one and each cell gets the 2x2
check. A cell that would make a solid 2x2 is refused and its outline flashes
red for `FLASH_MS` = 300. Painting never repacks (`kufiPaint.ts` arithmetic),
one undo step per click or drag; Alt's default (the Windows menu bar) is
suppressed while the pointer is over the panel. A window blur mid-gesture
aborts it (nothing commits) and clears the drawn chrome.

A new panel has `fontSize` 112 (14 px cells): `CLICK_SLOP` (10 px) and the
handle (0.7 cell) must stay under a cell for the tools to be usable at 100%.

Stretch and word drags ask the worker for a repack per cell crossed
(`previewKufiLayout`, newest wins) and keep showing the last preview that
packed; a refused count is asked once more when the pointer rests
(`PULL_REST_MS`), since the repack budget is a clock. Release commits that
preview, pinned where the packer put the letter, as one undo step; if nothing
reached packs, nothing commits and the stroke snaps back with a reason in
the status line. A lengthened stroke may be pulled at most `MAX_PULL` cells
per drag.

## Tests

`e2e/kufi-panel.spec.ts` is **load-sensitive under parallel workers**: it
drives real packs and repacks whose clocks are shared with the rest of the
suite. If it fails in the full run, run it alone before suspecting the code.
`marks.spec` fails independently of this block (pre-existing). Unit tests that
check a layout use the clock override; do not add wall-clock assertions.

## Known gaps

- **Most texts do not pack.** Only Al-Baqarah-like texts (several short words,
  dense in tall letters) pack, at 9 to 21 squares. The Shahada and most of the
  other texts tried do not at any size: a band holds one word's pieces, and
  there are few corner / turn options. Making them pack is first on the future
  plan.
- **Moving a word mostly refuses on tight panels** (the Baqarah finding above).
- **A Fit with pins can run about 12.5 s** (`FIT_BUDGET_MS` is checked between
  sizes, plus one `PINNED_CALL_MS`), under the 30 s watchdog but ahead of every
  other job in `pump`, so drag previews wait for it. Export packs on the main
  thread what the cache lacks (up to about 5 s for a pinned panel plus
  suggestions).
- **A dot or filler square under a removed paint edit** reads as paper to the
  paint tool (the result carries no dot list), so it can be painted over wrongly.
- **Touch has no Alt-paint**, and a touch press on a handle does not set
  `lastLetterPress` (a double tap can slip through).
- A reloaded panel with pins may rebuild its *unpinned* letters differently
  from the session that made it; pinned edits hold.
