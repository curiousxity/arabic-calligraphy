---
paths:
  - "src/lib/kufi/**"
  - "src/hooks/useKufiPanelLayout.ts"
  - "src/components/KufiPanel*.tsx"
  - "src/components/sidebar/KufiPanelPanel.tsx"
  - "src/components/sidebar/KufiToolRow.tsx"
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
  fewest filler bars; then least shortening; then least lengthening. Lengthening is how space is
  filled, so it is preferred to a filler square.
- **Filler bars** (`barPass`, `barEnds`) close a panel the text nearly fills.
  A bar is a straight run one cell wide and at least two long, never in a dot
  zone, with nothing beside it, touching ink only at its ends. Each rung is a
  rule a bar must pass: it closes at least one empty window or frame break
  (taken greedily, most closed first); it may end against a letter only on
  that letter's baseline or where its own stroke runs straight on (`barEnds`,
  stricter than "touches ink": a bar never reads as a tail off a tall stroke
  or a stroke across a line); and it never touches the same run at both ends
  (that would close a counter). **Bars are the search's second phase**, tried
  only when nothing packs without them, so a panel that packs bar-free keeps
  every cell. `BAR_WORK` (10%) is added to the work cap for that phase only; the
  bar-free search keeps exactly its own budget. Quality carries `bars`
  (required), and `kufiExplore`'s `rank` is `[squares, bars, cut, grow]`; a
  try with no `quality` at all ranks last.
- **Rectangles.** Fit and the suggestions for tooLong/tooShort try boxes of any
  proportion, not only squares. Fit's order (`fitSizes`): the first
  `FIT_LEAD_SQUARES` (3) squares, then `FIT_LEAD_RECTS` (24) rectangles
  (`fitRectangles`: two by elongation, then one ranked by the greedy pass, and
  so on), then the remaining squares, then the remaining rectangles. A count
  decides the *order*, so a busy machine tries the same sizes in the same
  order; how *far* Fit gets down it is the 9 s `FIT_BUDGET_MS` clock in the
  product (25 to 46 sizes for a failing text on the development machine) and
  `FIT_MAX_SIZES` (32 sizes) under the tests' clock override, so a layout
  test of Fit never depends on load. Fit returns the first size in this order
  that packs, not the smallest. The suggestions keep their old order. Rectangle sides are at least
  `MIN_RECT_SIDE` (7).
- **A pin goes back where a packed panel put it.** The search's replays
  (`reapply`) may open a line past a side of the frame, or past the next
  template line, which the move generator (`forMoves`) never does for a free
  letter. A pinned letter whose usual lines cannot take it therefore also
  tries the first template line of its side still ahead, so every placement
  of a packed panel can be pinned and repacked (an empty repack of إن شاء الله
  13x13 used to give `tooLong`, its own pins `pinConflict`). Only where the
  usual lines fail, so no pin that placed before gets a second way.
- **`dotsDrawn`** reads a placed letter's dot set from the cells (for the
  implicit pins of a repack). A lone cell of a glyph (الله has one) is that
  letter's own, never a dot; reading it as one once pinned a wrong dot shift.
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
  The repack from `previous` first frees only the letters before the word on
  its line (today's rounds, unchanged). **Only when every round fails**, a
  move may **rearrange every unpinned letter**: a fresh search (`repack`'s
  `rearrange` flag, a boolean parameter set only from `packKufiPanel`'s
  `previous` path, `PACK_BUDGET_MS` / `PACK_WORK`) that keeps the explicit
  pins and the moved first letter. The step runs only when no round was cut
  by the wall clock (rounds ended by their work budget count, as نصر +2's
  do): a repack the clock cut short is refused as before the step, and the
  rest retry (`PULL_REST_MS`) asks again, so a busy machine never shows a
  rearranged panel for a move a quiet one packs in a round. Committing a move that changed **any letter outside
  the word** (`kufiMovedUnits`) pins **every letter of the panel**
  (`kufiPinWordEdits`), whichever step packed it: under the real clock a move
  may pack in the second or third round instead of the rearranging step, and
  those reshuffle letters too, which a reload would rebuild by another road.
  The panel stays rigid until "Release hand edits". A move that changed
  nothing else pins the word only.
  A packed rearranged move costs about 0.1 to 0.5 s; a refused one measured
  about 0.5 s on the development machine, where the search ends on its work.
  The bound is the rounds' 150 ms clock plus the step's strict 1400 ms
  clock, about 1.55 s, which a slow machine can reach. **Moves go in steps of two cells** (`evenRouteStep` in
  `kufiPull.ts`): the lattice is stroke, gap, stroke, so a word moved one
  cell lands its strokes on gaps, and no ±1 move packed in any measured
  panel. The drag snaps to the nearest even step (an odd distance goes on,
  away from the start) and never sends an odd one, which would only cost a
  refusal. On Al-Baqarah, word 1 moves +2 (by today's rounds, no other letter
  changes); most other moves on tight panels are still refused, and the tool
  says so beside the letter. While a move's preview is shown, every letter
  outside the word that it changed is outlined in `MOVED_COLOR`
  (`kufi-moved-outline`, the hover outline's stroke); none when nothing else
  moved.
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

## Arrangements strip (`KufiArrangements`, `useKufiExplore`)

The sidebar's Kufi panel section shows thumbnails of other valid layouts, each
one change from the current panel (another form of one letter, one stretch
slice a step longer or shorter). `kufiExplore.ts` (pure) lists the changes and
tries each through the packer; `kufiExploreClient.ts` runs that in a worker of
its own, never the pack worker, one job at a time, results cached by the
layout key. `useKufiExplore(inputs)` reads the current result from the layout
cache itself and starts once it is packed. `pickArrangements` ranks tries
(filler squares, then bars, then cut, then grow) and drops duplicates of the current
panel and of each other. A thumbnail click goes through App's `editKufiPanel`
(`onApplyEdits` -> `onApplyKufiEdits`) with `fromKey` = the key of the inputs
it was found for: it seeds the layout cache with the explored result, pushes
one history step and sets `panelEdits`, so undo is one step and, **if the old
panel's exploration had finished**, its result is still cached (no "Looking…"
again; one that had not finished shows "Looking…" after the undo until it
does). The strip renders nothing when the current result is not ok, or when
painted cells break packing (`editsBreakPacking`): `useKufiExplore` does not
explore such a panel, since every try would carry the same gap and read as
"doesn't fit". A failed exploration reads like a finished one. Hovering outlines the cells that differ from the current panel.

## The selected letter's options (`kufiLetterOptions`, `KufiLetterOptions`)

The same exploration says, per letter, which forms and stretch lengths fit
before anything is tried. `kufiLetterOptions(text, current, state, unit)`
(pure, in `kufiExplore.ts`) lists every form of the unit in table order with
`fits: true | false | null` (null = not tried; the drawn glyph is `fits:
true, try: null`) and, per stretch slice, the counts that fit, **only once
every step of that slice has a try** (no entry = not known). A failed
exploration leaves untried things unknown, never "doesn't fit".

- **Selecting a letter.** A still click on a letter (the overlay's
  `onSelectLetter`) sets App's `kufiLetterPick`, stored with the text and
  box it was clicked in; `kufiLetter` is derived from it and is null once
  the text or size differs, and a change of selection clears the pick
  (reset during render, not in an effect). A still click on paper clears it.
  The sidebar's **Letter forms** row (`sidebar/KufiLetterOptions.tsx`, under
  the strip) draws each form's `rows` on a small canvas (`useSchemeTick`
  repaints on a theme change); fitting forms are enabled and apply their
  explored try through `onApplyEdits` (one undo step), the drawn one is
  `aria-pressed`, untried ones say "Checking…", the rest are disabled with
  title "Doesn't fit here".
- **Pick, then cycle** (Select tool only; in Stretch and Move word a click
  only selects). App passes the picked unit down (`kufiLetter` ->
  CanvasStage -> `KufiPanelView` -> the overlay's `pickedUnit`). A still
  click on a letter that is not the picked one only picks it (the sidebar
  lists its options); a still click on the picked letter runs `cycleForm`.
  The pick survives the commit (it is keyed on text and box, not edits), so
  repeated clicks keep cycling. `cycleForm` walks `kufiFormCycle` order: a
  known fit commits its explored try (no pack under the pointer), a known
  misfit is skipped.
- **Untried forms: one rule for sidebar and canvas.** While exploration is
  still running, an untried form says "Checking…" in the sidebar and a
  canvas click asks the packer for it live. Once exploration is **done or
  failed**, an untried form (cut off by the budget, or never reached) is
  "Not checked": disabled in the sidebar and **skipped** by the canvas
  click, so the two never disagree. So once every form is known or settled
  and none fits, the click says `NO_OTHER_FORM_FITS` at once. The one
  exception is a panel never explored (painted cells break packing): the
  sidebar says "Not checked" for every other form, and a canvas click still
  asks the packer, since nothing else ever will.
- **Stretch handles** (`endShown`): an end shows unless its slice is known
  and has no fitting count; hidden ends are also dropped from hover, hits
  and the e2e `ends`. The hit test takes the filter itself
  (`hitStretchEnd(result, col, row, endShown)`): filtering its answer
  afterwards let a hidden end that came first in the cell (a neighbour's, or
  a sibling slice's) win the press, so a drawn handle could not be grabbed
  and the press dragged the panel. **While a stretch is held**, a faint cell
  (`kufi-fit-mark`, `FIT_MARK_OPACITY`, in the chrome colour, inside the
  overlay's `EXPORT_HIDDEN` group) marks the end's place at each count of
  that slice's fitting counts (`optionsOf(unit).stretch.get(stretchIndex)`),
  measured from the end pressed; none while the slice is not known. A drag within `KUFI_STRETCH_STEPS` reach (two cells)
  of the drawn count, on a known slice, snaps to the nearest fitting count
  on the same side of the start (`snapPull`) and shows that count's
  explored try; nothing fitting on that side is a refusal, with no repack.
  **Beyond two cells, or on a slice not yet known, the pull asks the packer
  per cell as before**: exploration never tried those counts. Routes are
  not explored.
- In a live browser the exploration's repacks run on a clock, as the drag
  previews do, so what it finds can differ from a work-only unit test (unit
  3's lam fits at `-1` with an unlimited clock, yet the canvas refused it in
  the e2e). The e2e tests of the packer fallback block the explore worker
  (`withoutExploration`, a `page.route` abort), which leaves every option
  unknown.

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

**A visible tool row, not hidden gestures** (2026-10-31; the user could not
find hover-only handles, half-cell targets or Alt-to-paint). The Kufi panel
section starts with `sidebar/KufiToolRow.tsx`: four buttons, `Select` ·
`Stretch` · `Move word` · `Paint`, `aria-pressed` on the current one.
`KufiTool` lives in `kufiPanelBlock.ts`; App owns `kufiTool` (default
`"select"`, **never saved**, reset to `"select"` when the selection changes,
in the same render-time reset as `kufiLetterPick`) and threads it through
Sidebar → `KufiPanelPanel` and CanvasStage → `KufiPanelView` → the overlay's
`tool` prop. No keyboard shortcuts (none was free of the App's existing
ones without checking each, and the row is the point).

| tool | shows | press on a handle | still click on a letter |
|---|---|---|---|
| Select | letter outline only | (no handles) | pick; on the picked letter, cycle to the next fitting form |
| Stretch | outline + **every** fitting end of the hovered letter, whole-cell squares | pull the stroke | select only |
| Move word | outline + **every word's** route handle (0.7 cell) | drag the word | select only |
| Paint | cell outline, no letter outline | — | paints (click or drag) |

A still press on a handle (no pull) is a still click: it selects the letter
(it used to cycle the form too). **Alt paints from any tool.** Each tool
hit-tests only its own handles (`hoverAt`), so a route handle and a stretch
end sharing a first letter's corner never compete. Non-hovered handles draw
at `IDLE_HANDLE_OPACITY`, the one under the pointer solid. In every tool
but Paint a press on a letter away from a handle is not claimed (a drift
drags the panel); Paint claims every press. The e2e `kufi-edit-targets`
publishes every end and word whatever the tool.

**Refusals and confirmations draw beside the letter**, not in the sidebar.
The overlay reports `onNotice(fromKey, { text, unitIndex })`; App holds
`kufiNotice` (dropped if the inputs moved on from `fromKey`), clears it after
`KUFI_NOTICE_MS` = 2000, on a commit, and when any gesture starts (the
overlay sends `onNotice(fromKey, null)` on press). The overlay draws a Konva
`Label` named `kufi-notice` (inside its `EXPORT_HIDDEN` group) beside the
letter's placed box; `kufiNoticeAt` (pure, in `kufiPanelStatus.ts`) picks
right, else left, else the roomier side, level with the box top and clamped
to the panel's height. The label is drawn at the inverse of the stage's
absolute scale (12 px type on screen at any zoom), so its size is known only
once drawn: a `useLayoutEffect` scales and positions it imperatively. The
sidebar's status line no longer carries a notice; e2e reads the label with
`namedNodeText` (`e2e/harf.ts`).

The overlay is **pointer-resolved** (one listening `Rect`; cell under the
pointer found in arithmetic), like Next Shape; outline, handles, notice and
the e2e marker are `listening={false}`, so there is no Konva hover-leave
race. A gesture's drag is a stage listener, not a node drag.

Priority on mouse down: **painting first** (the Paint tool or Alt; claims
the press whatever is under it) -> a **handle of the current tool** -> any
other cell of a letter, not claimed: a press that drifts drags the whole
panel, a **still press (within `CLICK_SLOP`) is a click** (see the table;
in Select it picks the letter, and on the already-picked letter cycles the
form among alternates that pack, skipping those that do not; a click that
finds none says so; see "The selected letter's
options" for what exploration changes).

A letter's handles are its **stretch ends** (`stretchEnds`; an `end` is the
last cell of a stroke a stretch point lengthens, or a **slice grip** on a
stretchable slice with no free end) and, for a **word's first letter, its
route handle** (`routeHandleOf`: the leading cell of the letter's box, on the
baseline side; dragging it moves the word along its line). A handle's hit
cells are its own and the paper cell its square straddles onto
(`hitStretchEnd`, `hitRouteHandle`). A press anywhere else on a first letter
is the letter's own (panel drag or click), never the word's.
`KufiEditTargets.words` (e2e) publishes a point on each route handle's
square.

Painting: a click toggles a cell, a drag paints every cell crossed the way
the first went: the cells between two pointer samples are filled in
(`cellsBetween`, a 4-connected Bresenham walk), each painted on its own, so a
fast hand paints the same line as a slow one and each cell gets the 2x2
check. A cell that would make a solid 2x2 is refused and its outline flashes
red for `FLASH_MS` = 300. Painting never repacks (`kufiPaint.ts` arithmetic),
one undo step per click or drag; Alt's default (the Windows menu bar) is
suppressed while the pointer is over the panel. A window blur mid-gesture
aborts it (nothing commits) and clears the drawn chrome.

A new panel has `fontSize` 112 (14 px cells): `CLICK_SLOP` (10 px) and the
handles (the stretch square is 1 cell, the route handle 0.7) must stay within a cell for the tools to be usable at 100%.

Stretch and word drags ask the worker for a repack per cell crossed (a
word per two cells, `evenRouteStep`; `previewKufiLayout`, newest wins) and keep showing the last preview that
packed; a refused count is asked once more when the pointer rests
(`PULL_REST_MS`), since the repack budget is a clock. Release commits that
preview, pinned where the packer put the letter, as one undo step; if nothing
reached packs, nothing commits and the stroke snaps back with a reason
beside the letter. A lengthened stroke may be pulled at most `MAX_PULL` cells
per drag.

## A box that doesn't fit still shows (`KufiUnfitFrame`)

When the packed result is not ok (or has not arrived), `KufiPanelView` draws
`KufiUnfitFrame` inside an `EXPORT_HIDDEN` group: a dashed frame (node
`kufi-unfit-frame`) at the box size in the panel colour at 40% opacity, the
status line from `kufiPanelStatus` (`kufi-unfit-text`) and, on the selected
panel with an answer in hand, `Fit` and each suggested size as Konva buttons
(`kufi-unfit-fit`, `kufi-unfit-size`). "Arranging…" shows the text and no
buttons; a mirror gets the frame and never buttons (it is passed no
`onFitPanel`/`onSetPanelSize`; CanvasStage passes them for the selected panel
only). Text and buttons are drawn at the inverse of the stage's zoom (13 px on
screen); buttons cancel bubble on press and click so they neither drag the
panel nor deselect it. The export still holds no path for the panel, and the
hit area is unchanged. **One Fit at a time:** App holds `kufiFitPending`
(block id and the layout key it was pressed on); while it matches the
panel's inputs, `fitKufiPanelSize` returns at once on a second press, the
canvas buttons give way to "Finding a size…" (`fitPending`), and the
sidebar's Fit is disabled with the same words, whichever was pressed. Once the
inputs change the pending Fit no longer applies (its answer is dropped) and
the buttons return. The zoom is read as `Math.abs(getAbsoluteScale().x)`,
so a mirrored parent cannot flip the text.

## A word in the centre (`panelCentre`, `panelStart`)

Built 2026-11-04 on branch `claude/kufi-star` from
`docs/superpowers/specs/2026-11-03-kufi-spiral-centre-design.md`: the
historical spiral, where the text runs clockwise round the frame and ends
with its **last word alone in the core**. Two block fields, both absent on an
old save, so it redraws unchanged: `panelCentre` (`true`: the last word in
the centre; off by default) and `panelStart` (`"bottomRight"`, the default,
or `"topRight"`: the same clockwise order begun one side later, the right
side read downward, then bottom, left, top; `Ctx.start`, `templateLine`).
They travel in `KufiLayoutInputs` as `centre` and `start` and in the layout
key only when set, so every key and every input of a block without them is
what it was. With the centre off the packer takes exactly today's path:
`kufiPack.test.ts` pins الله 9x9, Al-Baqarah 21x21, سبحان الله 13x15,
الله أكبر 9x13 and قل هو الله أحد 17x19 against a pack without the fields.

- **The core is reserved first** (`centreOf`). The last word is packed alone
  into its box by `coreFinal`: the search itself on a context of one line
  (`Ctx.core`: template line 0 alone, the box's frame rule on every side and,
  since the panel's gap ring round the core would make an empty corner a
  hole, at the four corners too, in `edgeBreaks`, `partialScore`, the fill
  squares' `closes` and the bars' `gaps`), on `CORE_BUDGET_MS` (300)
  work-bounded, cached by the word and its box. The core of k rings is
  `k * (BAND + 1)` cells in from each side (`coreBox`, `CORE_RING` = 12 per
  ring): the most rings, one at least, whose core still holds the word's
  smallest box (`wordExtent`), upright or turned; both orientations are
  packed where both fit and the `better` kept (`Final.centre`, the
  result's `centre: { unitFrom, col, row, cols, rows, turn }`; turn 1 is
  the word read upward, a quarter turn, never a mirror). `carryCentre`
  stamps its cells, owners and kinds into every starting state
  (`initState`, `stampCentre`), appends its placements to the result and
  gives `barEnds` and `dotZone` its letters' lines (`allPlaced`), so a band
  bar may end on the centre word's baseline and no square may read as its
  dot. The band letters (the units before `unitFrom`) then pack as today on
  `4k` template lines, meeting the core as they meet any placed ink. A size
  whose core is smaller than the word is `tooLong`; one the word cannot fill
  within the grammar is `tooShort`, never padded; the suggestions and Fit's
  centre pass draw from `centreSizes` (a ring or two round every box of the
  word's extent, `CENTRE_RINGS_MAX` = 2), ranked by the greedy pass with
  the core reserved.
- **The centre place** (`KufiPlace` `"centre"`, `kufiFormsOf`): a word in
  the core takes its star forms and its centre-only forms where it has
  either, else the panel's. For الله that is the three star forms, whose
  heh never grows taller (a row slice lies in the shafts alone), and
  `allah.isolated.7`, the 9x5 of the Cairo Shahada's centre: a closed
  three-row heh box on its stem, the shafts the height of the box, and the
  dot in the bottom-left corner that closes the empty 2x2 under the box
  (`parts: 2`, no stretch: widening the box opens a hole between the dot and
  the stem). It is drawn in a centre alone, so no panel or star layout
  changes. A heh widens sideways and never taller: a wide core is filled by
  the heh's column slice and then by bars along the heh's bars (الله fills
  25x5 with three), a tall one by the star forms' shafts.
- **Centre letters are fixed.** The packer places, stretches and swaps them;
  they take no pins, forms, stretch, routes or painted cells
  (`stripCentreEdits` drops those before anything else reads the edits, so a
  pin on one is never a `pinConflict`), and the UI never offers them:
  `kufiIsCentreUnit` (`kufiHit.ts`) is false on a result without a centre,
  and `hitKufiUnit`, `stretchEnds`, `routeHandleOf`, `nearestKufiUnit` (a
  painted cell is keyed to the nearest band letter) and `kufiChangesOf` skip
  them. **Switching the centre on or off releases the pins and routes**
  (`kufiCentrePatch`, the sidebar's `Centre word` select: Off / Last word),
  since every letter moves; forms, stretch counts and painted cells are
  kept. `Start` (Bottom right / Top right) is a plain patch: pins hold and
  may conflict, as after a size change, with Release hand edits beside it.
- **Fit's second pass** (`fitCentre`). Pass one is today's, unchanged, so a
  text that packs today gets the size it got (الله ×5 and الله أكبر ×2 الله
  both pack at 17x22 without a centre). Only when it finds nothing, and the
  text has two words or more, the centre pass runs on
  `FIT_CENTRE_BUDGET_MS` (9000; `FIT_CENTRE_MAX_SIZES` = 12 under the clock
  override) over `centreSizes` ranked by the greedy pass, with the centre
  on and the start at the top right, the Cairo way; a success returns
  `{ cols, rows, centre: true, start: "topRight" }` (`KufiFitResult`,
  carried by the worker protocol and `requestKufiFit`), and `App` writes
  `panelCentre` and `panelStart` with the size in one undo step. A block
  whose centre is already on gets the centre pass alone, with its own
  start, so Fit never switches a centre off. A failing text can now cost a
  Fit 18 s on the clock (two passes), under the 30 s watchdog.
- **The spiral place: the tall محمد** (2026-11-05). A band whose letters
  stop short of its depth is closed in a plain panel by the next ring's
  letters interlocking into it; round a fixed core nothing does, so a short
  word must reach the band's depth by itself. The band letters of a centre
  panel are therefore packed in a place of their own, `KufiPlace`
  `"spiral"` (`ctxFor` passes it to `makeCtx` for `lettersOf`), which takes a
  letter's `only: "spiral"` forms **in place of** its panel forms where it
  has any, as a star takes its star forms, and the panel's forms otherwise
  (`kufiFormsOf`). Offered beside the short forms instead, the search kept
  the short ones and their holes. No plain panel, star or octagon sees them.
  The forms are محمد's, read off the Cairo Shahada spirals (the 1340 mosque
  panel, the 21x21 plate, and the plates' compact محمد), the word of the
  Shahada that the plain forms left open: `meem.initial.2`, a hollow square
  on a short upright at the middle of its base, five rows; `jeem.medial.2`
  to `.6`, the ح as a hook of two parallels joined on the right by an
  upright the band's depth, whose bar reaches **past its left stub**
  (`inset.left`) over the medial meem and the dal, which stand three rows
  high under it, one gap row below the bar, a gap column before the
  upright; and `meem.medial.2`, a hollow square whose base is the line. The
  embrace is a fixed length, 9 to 13 columns (a column slice beyond a stub
  would move the stub, which the alphabet test forbids), so there is one
  form per length and the search picks; the dal keeps the panel's forms
  (`dal.final.0` widened by one to meet the bar's end). The word's rise is
  structural: every letter of محمد that has a spiral form stands in it, so
  the word rises as a whole, never one tall stroke beside short siblings. A
  heh never grows taller: no spiral form has a row slice. Which uprights
  count as shafts is unchanged (`KUFI_SHAFT_LETTERS`): none of these is one,
  so no bar lengthens them.
  **رسول keeps the panel's forms.** Its ر, س and و were given tall forms
  too (a five-row ر standing on its bar as the corner ر of the plates, a
  raised س on three teeth with its first tooth carried down to the line,
  the و's head on its wall with a foot) and dropped: the ر's bar leaves a
  two-column shadow beside its upright that only the next piece can fill,
  and in the plates the س sits inside the ر's embrace, which the packer's
  pieces cannot do (a piece starts past the one before it, `st.cursor`;
  letting the raised س start back over the ر's bar packed رسول alone in a
  box but cost لا إله إلا الله twice its 21x17 packing when done for every
  piece, and found nothing when done for the س alone, since the rigid
  ر-س-و-ل of 15 cells fits no side of the sizes the text fills). What
  closes رسول's band is the panel's own means: the و on its foot with its
  head at the band's top (`waw.final.1`, five rows) and a **filler bar
  drawn on from the head's top bar over the س** (the panel's `barEnds`
  rule, a stroke drawn on along the line), with محمد's dal interlocking at
  the corner under the three-row ر.
- **Recognising a drawn form** is place-agnostic: `kufiGlyphOf(unit, id)`
  finds a glyph of any place, so a pin, a saved form, a previous panel's
  placement or an explored try on a band letter in a spiral form (or the
  centre word in a centre form) is read back (`glyphCells`, `dotsDrawn`,
  `explicitPins`, `lineKeys`, `boxIndices`, `repack`, `reconcileEdits`).
  Which forms a letter may *take* stays `kufiFormsOf` for its place, and the
  UI asks for the letter's place with `kufiPlaceOf(result, unitIndex)`
  (centre, spiral or panel): the exploration's changes and options
  (`kufiExplore`), the click cycle (`kufiFormCycle`'s `place`) and the
  overlay's e2e targets, so a band letter's forms list is the one it was
  drawn from.
- **Measured 2026-11-05** (work-bounded, every size on a cold cache;
  `kufiPack.test.ts` pins the fixtures): **the Shahada packs round a centre
  at 24x19 from the top right and at 19x25 from the bottom right**, 2 of
  its 130 centre sizes from either corner (0 of 130 on 2026-11-04, before
  the tall محمد), with two filler squares and two or three bars each; Fit
  finds 24x19, top right, the tenth size of its centre pass. (A scan on a
  warm cache counts 19x24 too: a failing neighbour's suggestions pack it,
  a fresh pack on its own budget does not, so it is not pinned.) In the
  packed panels لا إله and إلا الله take the first two sides, محمد the
  third in its tall forms and رسول the fourth in the panel's, with الله
  upright in the core at 24x19 and turned at 19x25. محمد رسول الله is still `tooShort` at every
  size (two band words cannot fill a ring) and محمد أبو بكر عمر عثمان علي
  still fills no core with علي. What else packs: **لا إله إلا الله twice at
  21x17 from either corner** (Fit finds 17x24, top right), الله ×5 at 21x17
  (الله on four sides round a centre الله), الله أكبر ×2 الله at 21x17 and
  23x17, and the single لا إله إلا الله at 17x21, 17x22, 19x21 and 23x17
  (with many bars). الله fills cores of 9 to 13 wide by 5 to 13 tall; محمد
  a 15x5 or 17x5 core.

## Tests

`e2e/kufi-panel.spec.ts` is **load-sensitive under parallel workers**: it
drives real packs and repacks whose clocks are shared with the rest of the
suite. If it fails in the full run, run it alone before suspecting the code.
`marks.spec` fails independently of this block (pre-existing). Unit tests that
check a layout use the clock override; do not add wall-clock assertions.

## Known gaps

- **Some texts still do not pack.** Fit now packs الله أكبر, سبحان الله
  (13x15), قل هو الله أحد and Bismillah (17x19), by rectangles and bars, as
  well as the Al-Baqarah-like texts. **The Shahada packs only with the
  centre on** (24x19 from the top right, 19x25 from the bottom right; see
  "A word in the centre", Measured): with it off a band holds
  one word's pieces and there are few corner / turn options. Short single
  words such as محمد do not pack either. Round a centre, رسول's band is
  closed by a filler bar drawn on from the و's head over the س, not by a
  tall form of its own: its ر has none that packs (see "The spiral place").
  The spiral forms are محمد's alone; another short word in a centre
  panel's bands (a ب, a ن, a د without a tall neighbour) still leaves its
  band open. Shallower laps are in
  [deferred-features.md](deferred-features.md) with the other layouts.
- **The embracing ح is taken wherever محمد stands in a centre panel's
  bands**, since the spiral place replaces the panel forms: a text with a
  ح followed by a letter taller than three rows, or by more than a dal's
  width of letters, has no ح form that fits there and does not pack with
  the centre on. Only محمد's letters have spiral forms, so any other word
  packs as before.
- **A centre panel needs a long text of tall letters.** The core's smallest
  ring is 21x17 round a 9x5 الله, about 56 cells of baseline, and every band
  letter must reach the band's depth or be stretched to it; a text of two
  band words (محمد رسول الله) is `tooShort` at every size. A core must be
  filled exactly by its word: علي fills none (its letters stand at
  different heights), الله and محمد do.
- **The centre's Fit can be slow.** A text that fails both passes costs
  up to 18 s on the clock (`FIT_BUDGET_MS` + `FIT_CENTRE_BUDGET_MS`), under
  the 30 s watchdog but ahead of every other job. Even core widths (a 10- or
  12-wide core for الله) fail at once in the core and rank last.
- **Bismillah's Fit is close to the clock in the product.** It reaches its
  size (the 17th size tried) at about 6 s of the 9 s wall-clock
  `FIT_BUDGET_MS`, so a slow machine may stop before it. Under the tests'
  clock override Fit counts sizes instead (`FIT_MAX_SIZES`), so its test does
  not depend on load.
- **Moving a word mostly refuses on tight panels**, even with the rearrange
  step (7 of 64 measured ±1/±2 moves pack; see "Routes are a record only").
- **A Fit with pins can run about 12.5 s** (`FIT_BUDGET_MS` is checked between
  sizes, plus one `PINNED_CALL_MS`), under the 30 s watchdog but ahead of every
  other job in `pump`, so drag previews wait for it. Export packs on the main
  thread what the cache lacks (up to about 5 s for a pinned panel plus
  suggestions).
- **A dot or filler square under a removed paint edit** reads as paper to the
  paint tool (the result carries no dot list), so it can be painted over wrongly.
- **A touch press on a handle does not set `lastLetterPress`** (a double tap
  can slip through). The Paint tool does paint by touch.
- A reloaded panel with pins may rebuild its *unpinned* letters differently
  from the session that made it; pinned edits hold.
