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
evaluation inside its budget.

**Region indexing.** 0 is the centre star; 1..m are the wedges clockwise from
the top, **odd indices are `wedgeA`**, even `wedgeB`; m+1..m+n are the corners
clockwise from the top right. A block's `starRegions` has `1 + 3n` entries in
that order, which is why changing the fold blanks them.

**Lattice frames.** Each region has its own square lattice, a frame
`{ origin, ux, uy }` (panel point = origin + col·ux + row·uy). Wedges face
outward (local down along the wedge's tip direction), corners inward, the
centre upright. A frame is a **rotation only, never a mirror**, so every copy
of a word reads correctly in its own region. The lattice is anchored at the
panel centre, so rotated copies of one kind get equal masks, and so the
wedges' baseline sits on a grid line.

**Masks and seams.** A cell is usable when all four corners lie at least one
cell (`SEAM`) inside the region's polygon: the one-cell seam that keeps
neighbouring regions' ink apart, where the construction lines are drawn. The
mask is trimmed to the usable rows and columns (the frame's origin moves with
it), and its bottom row is the one along the ring edge. **A mask can be
0x0**: no room (6-fold corners at small sizes). Every consumer must take a
0x0 mask without error; the packer reports `tooLong`.

## Text in a region (`packKufiRegion`, `kufiStarLayout.ts`)

- **No edge rule inside a region.** Only the region's outer edge (the ring
  edge, its bottom row) carries a line of text, so the slanted sides and the
  notch are not held to the frame's rule and may run to paper. The empty-2x2
  and solid-2x2 rules stay. The user chose this ("option B", 2026-11-01)
  after the frame rule left nothing packable at any size up to 60.
  Consequence: one short word sits against the outer edge and the inner part
  is sparse; محمد packs no wedge alone and no corner packs either word.
- **Copies by rotation, never mirror.** Every region of a kind is a rotation
  of the kind's first, with the same mask, so `layoutKufiStar` packs each
  distinct (kind, text) once and every other region of that kind takes the
  same cells; the view places them through that region's own frame.
- **Whitespace-only region text counts as empty** (pattern only, `null`),
  exactly as `""`.
- The status line (`kufiStarStatus`) says how many regions did not pack;
  those regions draw empty.

## Worker and cache

The star shares the Kufi panel's worker, queue and cache
(`kufiLayoutClient.ts`, the `*KufiStar*` functions, keyed by `kufiStarKey`).
One star layout is one worker job (all its packs), with a watchdog of
`KUFI_PACK_WATCHDOG_MS` per text it holds.

**A slot's last layout is drawn only on its own construction.** `starLatest`
keeps each slot's last layout *with the inputs it was laid out for*; while new
inputs are pending, `kufiStarLayoutSnapshot` reuses it only when fold, k and
size are unchanged (a region-text edit), and otherwise returns null, so the
view shows "Arranging…". A layout's region indices and masks belong to its
construction; drawing one on another (an approved offer changes all three at
once) put a wedge's cells in the wrong place.

## Evaluation and offers (`kufiStarEvaluate.ts`, pure)

`evaluateKufiStar(text, budgetMs)` splits the text into words (a word with an
unsupported character is reported `drawable: false` and placed nowhere) and
tries each **pattern** on every fold and each `STAR_KS` star:

| pattern | regions |
|---|---|
| `repeat` | the whole text in every wedge |
| `alternate` | 2+ words: the first half of the words in the A wedges, the rest in the B wedges (for two words, one each) |
| `run` | the words in order, clockwise from the top wedge, in m consecutive groups; only with at least m words, else a note says how many more |
| `corners` | the shortest word in the corners, the rest by `alternate` (2+ left) or `repeat` |
| `centre` | the longest word in the centre, the rest likewise |

- **Sizes** 12 to 60 in steps of 2. For each part (kind, text) the first size
  that packs is found once; the scan stops after **two** `tooShort` answers in
  a row (the region has more room than the text fills; one is not enough:
  الله is `tooShort` in a 4-fold wedge at 22 and packs at 24). An offer fits
  at the first size from the latest part's first fit where every part packs.
  An offer some part of which never fits is still made, at the size where the
  parts that do fit all pack (24, a new star's, when none does), its note
  naming what does not fit ("محمد does not fit a wedge").
- **Cache.** Packs are cached between calls by the region's mask and the text
  (the mask is what fold, k, size and kind decide, so wedgeA and wedgeB share
  packs), up to 2000 entries.
- **Budget.** The worker passes `FIT_BUDGET_MS` (9 s; a pack in progress may
  overrun it a little). Under the tests' clock override it stops after
  `STAR_EVAL_MAX_TRIES` (60) real packs instead (cache hits are free), so a
  test's offers never depend on load. The order is likeliest first: repeat
  and alternate on the classic star, then on the alternative, then run,
  corners and centre the same way, so a cut leaves the best offers.
  `complete: false` says the budget ended it.
- **Ranking.** Fitting first; among them fewer filler squares plus bars
  (summed over every region), then the smaller size; non-fitting after, fewer
  unpacked regions first. At most `STAR_MAX_OFFERS` (6). Each offer carries
  its `layout`, so the sidebar previews it and seeds the layout cache on
  approval (`seedKufiStarLayout`: the panel draws with no second pack).

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

- **Follow-up: text standing on the slanted sides** (option C, recorded in
  [deferred-features.md](deferred-features.md)). Until then corners and
  longer words (محمد) do not fit, and wedges are sparse.
- **5-fold misses its one size for الله.** الله packs a 5-fold wedge only at
  25, which the even size steps skip; 5-fold offers for it are non-fitting.
- One star layout is one long worker job (up to about 27 s for a 6-fold star
  with 19 different texts); panel jobs wait behind it.
