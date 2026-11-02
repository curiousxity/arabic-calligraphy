---
paths:
  - "src/lib/kufi/kufiStar*.ts"
  - "src/hooks/useKufiStarLayout.ts"
  - "src/components/KufiStarView.tsx"
  - "src/components/sidebar/KufiStarPanel.tsx"
  - "src/components/guide/sections/kufi-star.tsx"
  - "e2e/kufi-star.spec.ts"
---

# Kufi star panel (`kufiStar` blocks)

A geometric star panel in square Kufi: a centre star, a ring of 2n wedges and
n corners, each region holding its own text on its own lattice, drawn as one
traced outline. Built 2026-11-01 on branch `claude/kufi-star` (not merged).
The argument for the design and the user's words are in
`docs/superpowers/specs/2026-11-01-kufi-star-panel-design.md`; the packer it
shares is [kufi-panel.md](kufi-panel.md), whose grammar, budgets, worker and
clock-override rules all hold here.

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
- **A region's own letter forms** (`kufiFormsOf(unit, true)`). A glyph
  marked `regionOnly` is drawn only in regions, and where a letter has such
  forms they replace its panel forms there; a rectangular panel never takes
  them, so its tuned layouts are unchanged. Today that is الله:
  `allah.isolated.3` (five rows, three uprights, the heh hanging off the
  second lam, as in square-Kufi references) and `allah.isolated.4` (the same
  under the bar of its shadda and dagger alef, one gap above). The panel
  forms put the heh on a stem of its own, four equal uprights that read as
  "اللله" in a wedge (second opinion and the user, 2026-11-01). **The word
  widens through the heh's box** (column stretch at index 1, up to
  `COL_MAX`): the one column that widens without a hole, and how a word fills
  the end of a wedge's line; without it one الله fills no wedge at 21-25.
  **Row stretch is capped at `REGION_ROW_MAX` (2)** in regions: a stem grown
  by six stretched into the next line's room and left the third word nowhere.
- **Otherwise whole letters only** (`drawnWhole`). A letter without region
  forms drops every glyph drawn in more than one piece, except a piece that
  is a full-width bar over a gap row (the barred الله). The gapped-alef
  `allah.isolated.2` read as a broken alef in a wedge.
- **Fillers in a region: bars only, and only two kinds.** A bar may end on a
  letter's baseline (the feet row, so the line runs the width of the region;
  forbidding that left nothing packable) or **carry an upright stroke
  straight on upward**, by at most `STEM_BAR_MAX` (6) cells, to meet the
  slanted side as square-Kufi tilework lengthens an alef or lam (`barEnds`,
  region branch). Never along a stroke off the baseline (the heh's bars grew
  arms) and never downward. **No lone filler squares in a region**
  (`fillPass`): between repeated short words a square reads as a letter's
  dot, and a region packs without them or not at all.
- **Measured fits of الله** (2026-11-02, classic stars): one a wedge at
  4-fold 18-25, 5-fold 21-29, 6-fold 24-30; two a 4-fold wedge at 28-29,
  four at 34-36; a 4-fold corner holds one from 25, two from 35; 5-fold
  corners hold one from 43; 6-fold corners nothing up to 50. محمد fits a
  4-fold wedge twice at 29, 32 and 35 (once never: one word leaves the
  line's end open). `kufiPackRegion.test.ts` pins the first and the 28 fits.
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
  are drawn, up to `FITS_PER_PLAN` (3) fits. A scheduler steps the task of
  lowest `priority` (every fold's first fit, 4-fold first, before any second
  one; default stars before alternatives; run and centre last; a task that
  failed at `PATIENCE` (8) sizes with room for its text, before any fit, is
  set aside until the rest have had their turn), round robin among equals.
  A task that never fits is offered at its closest miss (fewest wedges
  missing, nearest size 24), its note naming what does not fit ("محمد does
  not fit a wedge"). On the 9 s budget "الله" gets three fits a fold
  (4-fold 18, 28, 34; 5-fold 21, 34, 45; 6-fold 24, 39); "الله محمد" gets
  the 4-fold fits (repeat at 29, alternate at 29) and misses for the rest,
  with `complete: false`; a second Find layouts goes on from the cache.
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
  filled before empty (the reference's four filled corners: 4-fold 28 holds
  الله twice a wedge and once a corner, 34 four times a wedge and no corner);
  then denser first (words drawn per region holding text), then fewer filler squares,
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
- **"الله محمد" needs two Find layouts** for the 5- and 6-fold fits: محمد's
  failing packs spend the 9 s on the 4-fold scan (see Sizes and tasks).
- One star layout is one long worker job (up to about 27 s for a 6-fold star
  with 19 different texts); panel jobs wait behind it.
