---
paths:
  - "src/lib/kufi/kufiStar*.ts"
  - "src/lib/kufi/kufiOctagon*.ts"
  - "src/hooks/useKufiStarLayout.ts"
  - "src/components/KufiStarView.tsx"
  - "src/components/sidebar/KufiStarPanel.tsx"
  - "src/components/guide/sections/kufi-star.tsx"
  - "e2e/kufi-star.spec.ts"
---

# Kufi star panel (`kufiStar` blocks)

A geometric panel in square Kufi, drawn as one traced outline, in one of two
layouts (`starLayout`; a save without the field is `wedges`):

- **`octagon`**, the default since 2026-11-02: the traditional "octagon
  inside a square". One text runs round the four sides of a square, one copy
  per side turned by a quarter, and its tall strokes are lengthened inward
  until their ends draw an octagon at the centre, which stays open. See "The
  octagon layout" below.
- **`wedges`**, built 2026-11-01: a centre star, a ring of 2n wedges and n
  corners, each region holding its own text on its own lattice. The rest of
  this note up to "Worker and cache" is about it.

Branch `claude/kufi-star` (not merged). The argument for the wedges design
and the user's words are in
`docs/superpowers/specs/2026-11-01-kufi-star-panel-design.md`; the packer
both share is [kufi-panel.md](kufi-panel.md), whose grammar, budgets, worker
and clock-override rules all hold here.

## The octagon layout (`kufiOctagon.ts`, pure)

Why: the wedge star packs words into a star drawn first, and the user kept
saying it looked wrong. In the traditional design (a 2004 article on square
Kufi principles, its "octagon inside a square" figures; a 1444 tile mosaic
and a 1386 tomb panel) the star is not drawn first: a short phrase repeats
along the square's four sides and the words' tall strokes extend inward
until their ends form an octagon and a star at the centre. Fill comes from
lengthening strokes, never from loose filler pieces.

`layoutKufiOctagon(size, text)` for a square of N = `starSize` cells
(`OCTAGON_MIN_SIZE` 13 to 60), text = `starRegions[0]` (the side's text,
with its repeats, as the wedge regions carry theirs):

- **Four bands, a pinwheel.** One band is `BAND` (5) rows of letters with
  their feet on the outer edge plus one seam row inside: `DEPTH` 6. The
  bottom band's line runs from the left edge to `DEPTH` short of the right
  edge (N - 6 cells), packed by `packKufiRegion` on a 5 x (N - 6) mask
  with **`bars: false`** (no filler bars; the region's "no lone squares"
  rule already holds) and the star's letter forms (see "A letter's forms by
  place": the band is five rows, so of الله's star forms only the five-row
  `allah.isolated.3` is among its alternates, and nothing in the band
  counts as a cut stem), so a side packs only when the text repeated fills
  its line by stretching (الله's heh box widens by up to `COL_MAX`). **The
  band keeps five rows** (2026-11-02): the tall الله forms would need a
  seven-row band, pushing the interior in by four cells, moving every
  measured square (15, 25, 35, 45) and the pinned geometry, and gaining
  nothing: the octagon already lengthens every word's shafts far above the
  heh's box, and the one word that stays squat, a side's first, does so
  because its heh and first lam lie under the next band's corner, not for
  want of a form. The
  other three bands are the bottom one turned clockwise about the centre
  (`octagonTurn`, cell to cell; N may be odd or even), so the text reads as
  a panel's outer ring: upright below, upward on the left, upside down
  above, downward on the right, never mirrored; the band on each edge stands
  in the corner the previous one leaves, above its first letter, the seam
  row between. The bottom band's first `DEPTH` columns lie under the left
  band and cannot lengthen anything.
- **Fields by the diagonals.** The interior (N - 12 square) is cut by its
  diagonals into four fields, one per band; the diagonal cells themselves
  (`octagonSeam`) stay paper, so two fields' stroke ends meet only at
  corners. A stroke lengthens from the seam row straight inward through its
  field until the next cell is a seam cell or the open centre.
- **What lengthens** (`octagonShafts`): a column whose top-row cell is a
  **shaft**, the upright of a tall letter (`KUFI_SHAFT_LETTERS`: alef, lam,
  kaf, tah, lamAlef, allah) reaching the band's top row, two cells or more,
  with paper beside its top (`kufiShaftTops` in `kufiAlphabet.ts`, the one
  predicate the wedges' filler bars use too). Which letter owns the cell is read from the
  band's placements (the glyph drawn at its stretch), never from the ink
  alone: a heh's wall is as tall as a lam and capped by the heh's bar, a
  box's or bowl's side likewise, and a tooth stretched to the band's top has
  nothing beside it, yet lengthening any of them stretches the letter or
  turns it into another (2026-11-02, the user: with the wedges' merged form
  the heh of الله shot up out of its box; the Topkapi Scroll's الله has four
  verticals, the heh's own short wall ending at its bar and the lams rising
  far above it, and a 2004 article's لله keeps the heh a closed box). A
  capped top (a lam's hook, an alef's head) is not lengthened either: the
  stroke would rise past its own head. **A word's shafts rise together or
  not at all** (2026-11-02, the user: one tall stroke beside the heh's box
  read as the heh's stem, and a lone lengthened shaft beside its word's
  unlengthened siblings is that fault wherever it occurs): a shaft under
  the next band's corner (the band's first `DEPTH` columns) or with ink
  beside its top cannot rise, so a word with one such gives no stroke at
  all. So الله gives three shafts a word (the second lam, the first lam,
  the alef) and never the heh's wall, except a side's first word, whose heh
  and first lam lie under the corner and which stays at the band's height;
  محمد gives none; الحمد لله only لله's two lams (الحمد's alef sits
  under the corner; its meem's walls used to rise). Short letters leave the
  space above them open: in the reference that space is the design, not a
  hole, so the empty-2x2 rule holds inside the bands (the packer's) and not
  above them.
- **The open centre** (`octagonGeometry(size, strokeCols)`): a stepped
  octagon `width` cells across (N's parity, centred, never wider than the
  interior less two), its corners cut so the flat sides are `flat` cells.
  **The strokes choose it** (2026-11-02). A stroke's end on a 45° edge is at
  Y = flat + width - |X| (doubled centred coordinates), its end on the
  diagonal at Y = |X| + 2; where the edge crosses the diagonal *between* two
  strokes, the strokes beyond the crossing stop at the diagonal short of the
  edge and the next field has no strokes at those rows either, so the edge
  is drawn by nothing and the centre reads as a plus (the 0.33 ratio at 29,
  width 9: three strokes on each flat, the rest on the diagonals). So each
  stroke names the octagon whose edge crosses the diagonal *at it*, flat +
  width = 2|X| + 2 (the width nearest sum/√2 of N's parity, the flat the
  rest, the pair nearer `FLAT_RATIO`); of those that fit and lie within
  `CENTRE_SLACK` (a quarter of N) of `CENTRE_RATIO` (half) of N, the nearest
  that aim is taken, the wider on a tie; with none, the ratio's own width
  with a regular flat. The crossing stroke's end is then on the edge and the
  diagonal at once, and the edge continues across the diagonal as the next
  field's stroke ends: at 35 with الله ×3 (shafts 14, 16, 18, 24, 26, 28;
  the first word's none) column 24 gives 21/9: its end (24, 25) under the
  open seam cell (24, 24), the left band's copy ending at (9, 24) beside
  (10, 24), the middle word's three shafts ending together under the flat,
  and beyond the crossing the ends stepping down the diagonal, (26, 27),
  (28, 29). الله ×2 at 25 gives 11/7, ×4 at 45 25/9 (the clearest octagon
  of the four: longer shafts round a centre nearer half the square), the
  Shahada at 33 19/7; الحمد لله at 31 has two shafts a side, both ending
  on a diagonal, and takes 15/7. The 45° staircase is one cell per column only where both
  fields have strokes there; a word's gap and the heh's box leave inlets at
  the octagon's vertices (the pinwheel's four bays), and محمد has no shaft
  at all, so its centre is the ratio's own 7/3 at 21, an open square drawn
  by nothing.
- **Lines on** draws each band's base row solid where its feet leave a
  gap (`frame`, the outer ring only; a gap stays where closing it would make
  a solid 2x2), so the frame line and the feet are one stroke, as the
  wedges' bands are flush on their base edge. Four pinwheel segments, not a
  closed ring: the corner cells belong to the letter standing there.
- **Measured** (2026-11-02, the star's 9-wide الله): الله once a side
  packs at 15 (its line 9; the interior is a 3x3 with the centre cell open,
  and nothing rises: the one word is the first), twice at 25, three times
  at 35, four at 45; `kufiOctagon.test.ts` pins 15 and 35. One الله a side makes a small dense tile with no octagon to speak
  of; three makes a square whose centre reads as an octagon with the
  diagonals drawn by stroke ends, which is why a new star is
  `الله الله الله` at 35 (it was 29 on the merged form). A side with more
  words gives longer, denser strokes, nearer the reference. Under the
  work-only clock الحمد لله packs a side at 31, the Shahada at 33, محمد at
  21.
- **Status.** The side's pack failing gives `unpacked: [0]` and
  `octagon: null`; the view draws the dashed square and the status says
  "doesn't fit a side at this size" (`tooLong`) or "leaves a side open"
  (`tooShort`). `kufiStarBox` is the square for this layout, the
  construction's outline box for the other; `kufiStarLayoutPath` draws
  either; `starPositionKeepingCentre` keeps the centre across a switch.

**Sidebar.** The panel's first row is the layout (`Octagon` / `Wedges`);
Fold and Star show for the wedges only; Size is the square's side (13 to
60) or the ring's apothem (12 to 60). Switching to the octagon puts the
block's text (else الله) once along each side at `octagonSizeFor` (the
line its octagon forms take at their authored widths, plus `DEPTH`); to the
wedges, the blank classic 4-fold star at 24. Find layouts offers the octagon
squares first (`octagonOffers`): the text once, twice, up to
`OCTAGON_REPEATS` (6) times a side, each at the smallest square its line
packs (scanned from `octagonSizeFor` less two, `OCTAGON_SCAN` sizes; a line
the text leaves open ends the scan), smallest first, at most
`OCTAGON_OFFERS` (4), then the wedge offers as below. A side pack is one
short line, milliseconds, so this costs the budget nothing.

## The construction (`kufiStarGeometry.ts`, pure)

`starConstruction(fold, k, size)`: a circle divided into m = 2n points
(n = fold, 4, 5 or 6), the {m/k} star, a ring m-gon and an outer n-gon.
`size` is the ring's apothem in cells; the star's circle has radius
`size / RING_RATIO` (1.55). `STAR_KS` offers two stars per fold, the classic
first (`{8/3}`, `{10/3}`, `{12/4}`) and one alternative (`k` = 2), to keep the
evaluation inside its budget. `defaultStarK(fold)` is the star a new panel or a
fold change starts on: the classic one. (It started 4-fold on the
alternative while the region's only الله forms were too tall for the classic
wedge; the region's own الله forms, below, fit both.)

**Region indexing.** 0 is the centre star; 1..m are the wedges clockwise from
the top, **odd indices are `wedgeA`**, even `wedgeB`; m+1..m+n are the corners
clockwise from the top right. A block's `starRegions` has `1 + 3n` entries in
that order, which is why changing the fold blanks them.

**Lattice frames and base edges.** Each region has its own square lattice, a
frame `{ origin, ux, uy }` (panel point = origin + col·ux + row·uy), and a
**base edge** (`base`, a polygon edge index) its text stands on. Wedges face
outward (local down along the wedge's tip direction; base = the ring edge).
**A corner's base is its outer leg ahead (clockwise)**, the outline side
facing tip 2j+2, so its lattice is the next A wedge's and its lines run with
the outline's (built 2026-11-02; filled from its ring-edge hypotenuse, a
right triangle held one line and a sloped rest, and nothing fitted). The
centre is upright with no base. A frame is a **rotation only, never a
mirror**, so every copy of a word reads correctly in its own region. The
lattice is anchored at the panel centre, so rotated copies of one kind get
equal masks, and so every base edge sits on a grid line.

**Masks and seams.** A cell is usable when all four corners lie inside the
region's polygon at least one cell (`SEAM`) from every side **except the
base edge, which carries no seam**: the mask's bottom row lies on it, the
letters' feet line it, and the construction line drawn there
(`StarConstruction.bands`, flush inside the region on base and outline
edges, centred elsewhere) is the same stroke as the feet. So a line and the
text standing on it are one, with no gap row between (the old centred band
plus a seam plus a baseline bar read as three stripes). The other side of a
ring edge is the corner's seam. The mask is trimmed to the usable rows and
columns (the frame's origin moves with it). **A mask can be 0x0**: no room
(6-fold corners at small sizes). Every consumer must take a 0x0 mask without
error; the packer reports `tooLong`.

## Text in a region (`packKufiRegion`, `kufiStarLayout.ts`)

- **The edge rule holds on the base row only** (`Region.base`: pairs of
  usable bottom-row cells both empty are breaks, in the score, `edgeBreaks`,
  and the closes of fills and bars). So the first line stands on the base
  row (a raised line would need a bar under its feet: a solid 2x2) and its
  feet form the line even with the lines off. The slanted sides and the
  notch carry no line of text, so they are not held to the frame's rule
  (holding them to it left nothing packable at any size up to 60, 2026-11-01)
  and **an empty 2x2 touching them is no hole** (`Region.win`: a window
  counts only with a cell of usable margin all round; below the base row
  counts as usable). Letters meet the sides as a staircase; the pockets that
  staircase leaves, a cell or two wide, stay paper.
- **A letter's forms by place** (`kufiFormsOf(unit, place)`, `KufiPlace`:
  `panel` or `star`; `packKufiRegion` packs for the star). A glyph marked
  `only: "star"` is drawn in a star alone (a wedge or the octagon's band),
  and where a letter has such forms they replace its other forms there; a
  rectangular panel takes the forms marked for no place, so its tuned
  layouts are unchanged; a star otherwise takes the unmarked forms drawn
  whole. A form taller than the region's box even at its shortest is not
  among its alternates there (a seven-row alef shortens to five and stays).
  Today that is الله, three forms, all 9 wide with the heh's own wall under
  its bar, so every الله in every layout reads alef, lam, lam and a heh, as
  the Topkapi Scroll's does:
  - **`allah.isolated.5`, the tall form** (2026-11-02): the panel's
    `allah.isolated.1`, the alef and both lams standing two cells above the
    heh's capped box, the proportion of Topkapi cat. 77; its row slice grows
    the three shafts alone (up to `REGION_ROW_MAX`), so the word reads tall
    beside a short heh even where nothing carries the shafts on.
  - **`allah.isolated.6`, the tall form under its bar**, the shafts meeting
    the bar as a lam meets the line above in a panel, one gap row over the
    heh's box. It is for a wedge with room above the word: the bare tall
    form's pocket above the heh's box (two rows by four columns) is an
    empty 2x2 wherever its margin is usable, and no filler may close it (a
    square is forbidden in a region; a bar a gap row above the shafts would
    leave the hole under it; the heh's box is not lengthened). The bar is a
    filler bar of the form's own (`KufiGlyph.bars`, counted with the drawn
    ones), so the bare form is taken wherever it packs and this one only
    where its bar closes the pocket.
  - **`allah.isolated.3`, the five-row form**, `.1` at a line's height, the
    fallback where no tall form has room: the smallest wedges (4-fold 20 to
    22) and the stacked pairs and triples (6-fold ×2, two of the three in
    5-fold ×3). It is the octagon band's only form (five rows).
  **The packer prefers the tall forms** (`stemOf` in `kufiPack.ts`): in a
  star الله is a tall letter whose stem is its longest stroke on the line,
  7 in the tall forms, 5 in the five-row one, so the five-row form is a
  stem cut by two and the ranking's "least shortening" takes a tall form
  wherever one packs; **in a region the least shortening ranks before the
  fewest bars** (`better`), since a region's bars are its line run to the
  sides and its shafts carried up, the design's own strokes, while a word
  drawn short beside the room for its tall form is the fault the user sees
  (at 5-fold 24 the tall form packs with one base-row bar more than the
  five-row one). A rectangular panel's الله is not a tall letter (`TALL`),
  so its layouts are unchanged. **No star form grows its rows evenly**: the
  five-row form has no row slice (four equal uprights read as "اللله",
  2026-11-01), and `allah.isolated.4`, the five-row body under a bar a gap
  row above it, is gone (replaced by `.6`, the same cells with the shafts
  reaching the bar). The wedges had merged forms of three uprights (the heh
  hanging off the second lam, 7 wide) until 2026-11-02: the merged lam was
  the heh's wall, and once only shafts were carried up a word showed the
  heh's box with one tall stroke beside it, which the user read as the heh's
  stem. **The word widens through the heh's box**
  (column stretch at index 1, up to `COL_MAX`): the one column that widens
  without a hole, and how a word fills the end of a wedge's line.
  **Row stretch is capped at `REGION_ROW_MAX` (2)** in regions: a stem grown
  by six stretched into the next line's room and left the third word nowhere.
- **Otherwise whole letters only** (`drawnWhole`). A letter without region
  forms drops every glyph drawn in more than one piece, except a piece that
  is a full-width bar over a gap row (the barred الله). The gapped-alef
  `allah.isolated.2` read as a broken alef in a wedge.
- **Fillers in a region: bars only, and only two kinds.** A bar may end on a
  letter's baseline (the feet row, so the line runs the width of the region;
  forbidding that left nothing packable) or **carry a shaft straight on
  upward**, by at most `STEM_BAR_MAX` (6) cells, to meet the slanted side as
  square-Kufi tilework lengthens an alef or lam (`barEnds`, region branch).
  A shaft is what the octagon lengthens too, one predicate for both
  (`kufiShaftTops` in `kufiAlphabet.ts`): a column of a `KUFI_SHAFT_LETTERS`
  glyph whose top cell has nothing beside it. **Never a heh's wall, a box's
  or bowl's side or a stretched tooth**, however tall (2026-11-02, the user:
  the heh of الله was carried up out of its box by five or six cells in the
  4-fold wedges at 28 and 34), never along a stroke off the baseline (the
  heh's bars grew arms) and never downward. **A word's shafts rise together
  or not at all** (`shaftGroup`, 2026-11-02): the bar pass's column
  candidates are one per word, every shaft of the word carried up (by two
  cells at least, by lengths the slanted side may vary), taken or left as
  one; a shaft with ink beside its top or no room above it means none of
  the word's rise. One lengthened shaft beside its unlengthened siblings
  read as another letter's stem (the lam beside the heh's box as the heh's).
  Since the tall form and its row slice take الله's shafts to a wedge's
  sides (2026-11-02), no measured fit of الله needs a bar to carry a word up
  (the 4-fold corner at 46 did, and went with the even row growth);
  `kufiPackRegion.test.ts` exercises the rise on a mask of its own, a strip
  six rows tall over the shafts, past the slice's cap.
  **No lone filler squares in a region** (`fillPass`): between repeated
  short words a square reads as a letter's dot, and a region packs without
  them or not at all.
- **A region's search sees what its bars can close.** The beam's partial
  score never counts the space above a region's top line (a later line may
  fill it) and never sees bars (they are drawn in `finish`), so the finals
  it kept were picked among tied scores by hash while what they left open
  above decided whether the region packed. Two things, both regions only:
  at the **last letter every cell is settled** (`lastInRegion`, nothing
  after it opens a line), and the search runs **with its bars from the
  start** (`searchInner`; a panel keeps its bar-free phase, since nearly
  every region packing closes its base row with bars anyway, and a region
  that packs bar-free still draws none). Without both, two الله in a 4-fold
  wedge at 28 (on the merged form of the time) packed only with the heh's
  wall carried up: the legal packing (the barred form right, the plain form
  left, its second lam carried up) tied with the other plan and lost the hash.
- **Measured fits of الله** (2026-11-02, classic stars, the 9-wide forms
  above, a word's shafts carried up together or not at all): one a wedge
  at 4-fold 20-27 (five-row at 20-22, tall at 23, tall under its bar at
  24-27), 5-fold 24-29 (tall at 24-25, under its bar from 26), 6-fold 30
  only (under its bar; 31-33 held the five-row form under a bar before
  the forms changed); three a 5-fold wedge at 40 (one under its bar, two
  five-row), two a 6-fold wedge at 34-40 (five-row pairs; at 40 one under
  its bar); a 4-fold corner holds one at 29-31, tall, and nothing more up
  to 60 (three packed at 46 while the five-row form grew its rows evenly);
  5-fold corners one from 47, tall; 6-fold corners nothing up to 50; **a
  4-fold wedge never holds two**: the pocket the slanted side leaves above
  a heh's box has no legal filler (a lam is two cells away; the barred
  form needs the full width at its bar's row; a word slides to its first fit
  and no further), and two 9-wide words no longer stand on one line before
  the sides close. The tall form fits where the wedge's sides close over the
  pocket above the heh's box (the word's top near the mask's top: small
  wedges, a corner's acute end); with room above the word the pocket is a
  hole and the form under its bar takes over; where even that has no room
  (two lines in a wedge) the five-row form stands. (The merged 7-wide form
  held one from 18, two at 27-28 with the corners filled, three a 5-fold
  wedge at 34, three a 6-fold at 39.)
  محمد fits a 4-fold wedge twice at 29, 32 and 35 (once never: one word
  leaves the line's end open). `kufiPackRegion.test.ts` pins the first fit,
  the 6-fold 34 and corner 29 fits, that no capped top is ever carried up,
  that every packed الله stands on four uprights, which form each measured
  fit takes (the tall one's heh wall never rising, its shafts two or more
  above the heh's bar), and that each word's shafts rise all or none.
- **Copies by rotation, never mirror.** Every region of a kind is a rotation
  of the kind's first, with the same mask, so `layoutKufiStar` packs each
  distinct (kind, text) once and every other region of that kind takes the
  same cells; the view places them through that region's own frame.
- **Whitespace-only region text counts as empty** (pattern only, `null`),
  exactly as `""`.
- The status line (`kufiStarStatus`) says how many regions did not pack;
  those regions draw no ink, only a dashed outline of their polygon
  (`kufi-star-unpacked`, `KufiUnfitFrame`'s style, `EXPORT_HIDDEN` so it never
  exports), so with the lines off an unpacked region is not blank paper. An
  outline width above 0 adds the panel's "The outline exports as a separate
  path." (see [kufi-panel.md](kufi-panel.md), Export).
- **Never a mirror's source.** `isMirrorSourceCandidate` rejects `kufiStar`, so
  Add mirror is disabled for a star: Add mirror always reflects (`mirrorX`),
  and a reflected star reads backwards. Its copies come by rotation, inside it.
- **Changing fold, star or size keeps the centre where it was**, rotated or
  not: `starPositionKeepingCentre` (`kufiStarPath.ts`) turns the outline box's
  change by the block's rotation, since the Group turns about its x,y.

## Worker and cache

The star shares the Kufi panel's worker, queue and cache
(`kufiLayoutClient.ts`, the `*KufiStar*` functions, keyed by `kufiStarKey`).
One star layout is one worker job (all its packs), with a watchdog of
`KUFI_PACK_WATCHDOG_MS` per text it holds.

**A slot's last layout is drawn only on its own construction.** `starLatest`
keeps each slot's last layout *with the inputs it was laid out for*; while new
inputs are pending, `kufiStarLayoutSnapshot` reuses it only when fold, k and
size are unchanged (a region-text edit), and otherwise returns null, so the
view shows "Arranging…". The view's snapshot is `kufiStarSnapshot`, the
layout *and* whether the inputs failed, reused per slot while both are
unchanged: a failure alone must change the snapshot, or a first layout that
throws never re-renders out of "Arranging…". A layout's region indices and
masks belong to its construction; drawing one on another (an approved offer changes all three at
once) put a wedge's cells in the wrong place.

## Evaluation and offers (`kufiStarEvaluate.ts`, pure)

`evaluateKufiStar(text, budgetMs)` splits the text into words (a word with an
unsupported character is reported `drawable: false` and placed nowhere) and
tries each **plan** on every fold and each `STAR_KS` star. **A region is
filled**: its text is repeated as often as the region packs it (a size-28
4-fold wedge holds الله twice, its corner once), as traditional panels repeat
a short phrase to fill their fields, and the region text saved carries the
repeats ("الله الله"). The corners always take the shortest word, where
there is room; a corner that cannot hold it even once stays pattern only and
counts against nothing (6-fold corners never hold الله).

| pattern | wedges |
|---|---|
| `alternate` | 2+ words, first: the first half of the words in the A wedges, the rest in the B wedges, each repeated to fill |
| `repeat` | the whole text in every wedge, repeated to fill |
| `run` | the words in order, clockwise from the top wedge, in m consecutive groups, never repeated; only with at least m words, else a note says how many more |
| `centre` | the longest word in the centre (once), the rest in the wedges as `alternate` or `repeat` |

- **Fill count** (`fillCount`). The repeat count is first tried at an
  estimate (`FILL_FACTOR` 0.6 of the mask's usable cells over the text's
  cells, `areaOf`: each unit's region form width plus a gap, by a line's
  pitch), then stepped by one: up from `tooShort`, down from `tooLong`, and
  from `tooLong` at one, up to two once (محمد alone leaves a 4-fold wedge's
  line open at 29 while two fill it). At most `FILL_TRIES` (5) packs a
  region and text; a region with fewer usable cells than the text's area is
  too small without a pack. Failures are what cost (a pack that fails spends
  its whole budget, up to ~1.7 s on the clock); fits take 0.1-0.5 s.
- **Sizes and tasks.** Each (plan, fold, star) is a task scanning sizes
  from 12 up; a size is an offer when every wedge (and the centre, when it
  holds a word) fills. After a fit the task jumps to the first size whose
  wedge estimate promises one more word (every size between would pack the
  same words again, slowly) and offers again only when strictly more words
  are drawn, or the same words with fewer cut stems (`quality.cut`, the
  packs' own: الله on its five-row form is two a word), up to
  `FITS_PER_PLAN` (3) fits. **A fit with a cut stem first tries the next
  `CUT_SCAN` (3) sizes one by one** before the jump, since the tall form
  may stand a size or two on: الله fits a 4-fold wedge five-row at 20 and
  tall at 23, so both are offered and 23 ranks first. A scheduler steps the task of
  lowest `priority` (every fold's first fit, 4-fold first, before any second
  one; default stars before alternatives; run and centre last; a task that
  failed at `PATIENCE` (8) sizes with room for its text, before any fit, is
  set aside until the rest have had their turn), round robin among equals.
  A task that never fits is offered at its closest miss (fewest wedges
  missing, nearest size 24), its note naming what does not fit ("محمد does
  not fit a wedge"). Under the work cap "الله" gets 4-fold ×1 at 23 (tall)
  and at 20 (five-row), 5-fold ×1 at 24 (tall) and ×3 at 40, 6-fold ×1 at
  30 (tall under its bar) and ×2 at 40 (the merged form's 4-fold 18 and
  28, 5-fold 21 and 34, 6-fold 24 and 39 went with it; 4-fold 34 and
  5-fold 45 were offers while the heh's wall rose); "الله محمد" gets
  the repeat fits (4-fold 30 with الله in the corners, 5-fold 36; the
  6-fold one is beyond the cap) and alternate misses (the pair in turn
  fitted the 4-fold star at 29 while الله twice a wedge packed there; now
  nothing holds both), with `complete: false`; a second Find layouts goes
  on from the cache.
- **Cache.** Packs are cached between calls by the region's mask and the text
  (the mask is what fold, k, size and kind decide, so wedgeA and wedgeB share
  packs), up to 2000 entries; fill counts and text areas likewise.
- **Budget.** The worker passes `FIT_BUDGET_MS` (9 s; a pack in progress may
  overrun it a little). Under the tests' clock override it stops after
  `STAR_EVAL_MAX_TRIES` (300) real packs instead (cache hits are free), so a
  test's offers never depend on load; `kufiStarEvaluate.test.ts` shares one
  cache across its tests, since the cap counts real packs only.
  `complete: false` says the budget ended it.
- **Ranking.** Fitting first; the classic stars before the alternative ones
  (the same split on the other star is nearly the same offer); corners
  filled before empty (the reference's four filled corners: "الله محمد" at
  4-fold 30 holds the pair a wedge and الله a corner; الله alone fills no
  corner, a 4-fold wedge holding it to 27 and the corner from 29; 28 held
  it twice a wedge and once a corner on the merged form, 34 four a wedge
  while the heh's wall rose);
  then denser first (words drawn per region holding text), then fewer filler squares,
  then fewer cut stems (الله tall before squat at the same density),
  then the smaller size; non-fitting after, fewer unpacked regions first.
  `pick` keeps at most `OFFERS_PER_FOLD_PATTERN` (2) per fold and pattern,
  `STAR_MAX_OFFERS` (8) in all, so one construction's sizes never crowd the
  other folds out. Each offer carries its `layout`, so the sidebar previews
  it and seeds the layout cache on approval (`seedKufiStarLayout`: the panel
  draws with no second pack).

**Sidebar.** `KufiStarPanel` holds Find layouts (`requestKufiStarOffers`, a
`"starEvaluate"` worker job queued like a Fit, never run on the main thread;
it rejects "Find layouts failed" if the worker dies). Offers show as small
inline SVG previews (`kufiStarPath` of the offer's layout, unpacked regions
empty) with their notes. A click sets `starFold`, `starK`, `starSize` and
`starRegions` in one `onPatch`, one undo step; non-fitting offers may be
approved too, and the status line then names how many regions did not pack.
When the block's `text` differs from the text the offers were made for, the
list gives way to "The text changed: find layouts again", and the panel keeps
drawing its approved regions. The block's `text` is edited in Content
(`hasOwnText` includes `kufiStar`); it is only ever read by Find layouts.

## Known gaps

- **No line of text stands on a slanted side** (option C, closed 2026-11-02,
  see [deferred-features.md](deferred-features.md)): a wedge's sides run at
  22.5°, 18° or 15° to its lattice, so no straight baseline lies along one.
  Instead the lines stack from the base edge inward and the letters meet the
  sides as a staircase, their stems carried on to it by bars.
- **A corner's acute end stays paper**: the triangle's point beyond its last
  line is too thin for a line of text, and no filler is drawn there.
- **"الله محمد" may need two Find layouts** for the 5- and 6-fold fits on
  the 9 s clock: محمد's failing packs spend it on the 4-fold scan (see Sizes
  and tasks); under the work cap all three repeat fits come at once.
- One star layout is one long worker job (up to about 27 s for a 6-fold star
  with 19 different texts); panel jobs wait behind it.
