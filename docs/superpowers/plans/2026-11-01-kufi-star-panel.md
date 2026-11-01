# Kufi star panels: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `kufiStar` block: a 4-, 5- or 6-fold compass-and-ruler construction whose regions (centre star, wedges, corners) hold square Kufi on their own turned lattices, with the app evaluating the user's text and offering splits to approve.

**Architecture:** The construction is pure geometry (`kufiStarGeometry.ts`): regions as polygons in cell units, each with its own lattice frame and a cell mask. The packer gains `packKufiRegion`, which packs text into a mask on upright lines only. `kufiStarLayout.ts` packs each distinct (region shape, text) once and places copies by rotation. `kufiStarEvaluate.ts` scores splits. All packing runs in the existing Kufi worker.

**Tech Stack:** React 19 + TS, Konva, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-kufi-star-panel-design.md` (read it first).

**Branch:** `claude/kufi-star`, cut from `claude/kufi-square`. Never main.

## Global Constraints

- Packer work stays pure and deterministic, runs in the worker, with a work budget plus a clock safety net (`kufiPack.ts`'s pattern). `PACK_BUDGET_MS`, `REPACK_BUDGET_MS`, `FIT_BUDGET_MS` and every existing `kufiPanel` result stay unchanged, cell for cell (الله 9×9, الحمد لله 13×13, Al-Baqarah 21×21 are pinned by existing tests).
- Saved panels reopen identical.
- Old saves are untouched. No new block-type or field name may appear in `REMOVED_BLOCK_TYPES` / `REMOVED_BLOCK_FIELDS` (`src/lib/legacySaves.ts`).
- Text is never mirrored: copies are rotations only.
- Letters are never scaled or squashed: today's lattice grammar (stroke = gap = one cell, no 2×2 ink, no empty 2×2, authored forms only).
- One cell size for the whole panel: `fontSize / KUFI_CELLS_PER_EM` px, as `kufiPanel`.
- Unit tests that assert a layout use `_internal.setClockOverride(Infinity)`.
- No names of teachers, calligraphers, studios or products in committed files. No subagent may use the fable model.

## Decisions this plan makes (the spec left them open)

- **Cell units.** The construction is built in cells, centre at the origin, y down. `starSize` is the ring's apothem in cells (centre to a ring edge). The star's circle radius is `starSize / 1.55`, the spike's ratio.
- **Every region's baseline is on the ring edge.** A wedge's local "down" points outward (its outer edge is the ring edge); a corner's local "down" points inward (its base is the ring edge, its apex the panel corner). The centre star's lattice is upright.
- **Masks.** A region's local grid is its bounding box in its own frame, snapped outward to whole cells. A cell is usable when its whole unit square lies at least 1 cell inside the region polygon (the spec's one-cell seam).
- **Regions are indexed** `0` = centre, `1..m` = wedges clockwise from the top, `m+1..m+n` = corners clockwise from the top right. `m = 2n`.
- **Region kinds:** `"centre"`, `"wedgeA"` (tips facing an outer edge: even wedges), `"wedgeB"` (odd wedges), `"corner"`. A kind's regions are rotations of each other, so one packing per (kind, text) serves them all.
- **Stars offered per fold:** `k` = 3 for 4-fold, 3 for 5-fold, 4 for 6-fold (classic), plus 2 for each fold (the alternative).
- **Block:** `type: "kufiStar"`, fields `starFold: 4 | 5 | 6`, `starK: number`, `starSize: number`, `starRegions: string[]` (the text in each region by index, `""` = pattern only), `starLines: boolean`. The block's `text` is what the user typed and what evaluation reads.

## Review Focus

1. **Editing the text after approving a split.** The panel keeps drawing the approved `starRegions`; the sidebar says the offers are out of date. Task 5 tests this.
2. **Text with characters Kufi cannot draw** (Latin, digits): evaluation skips those words and says which, never crashes. Task 5 tests this.
3. **Empty text:** no offers, the panel shows the construction only. Task 5 tests this.
4. **Export:** a star panel exports as one SVG `<path>` with the lines on or off, and the export waits for its layout as it does for `kufiPanel`. Task 5's e2e tests this.
5. **A region whose text does not pack** at the panel's size: that region draws empty with its outline, the status line names it, and the other regions still draw. Task 4 tests this.

---

### Task 1: The construction

**Files:**
- Create: `src/lib/kufi/kufiStarGeometry.ts`
- Test: `src/lib/kufi/kufiStarGeometry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StarFold = 4 | 5 | 6;
  export type StarRegionKind = "centre" | "wedgeA" | "wedgeB" | "corner";
  export type Pt = { x: number; y: number };
  export type StarRegion = {
    index: number;
    kind: StarRegionKind;
    polygon: Pt[];            // panel cell units, centre at the origin, y down
    /** Local lattice frame: panel point = origin + col * ux + row * uy (unit vectors, local y down). */
    frame: { origin: Pt; ux: Pt; uy: Pt };
    mask: { cols: number; rows: number; cells: Uint8Array }; // 1 = usable
  };
  export type StarConstruction = {
    fold: StarFold; k: number; size: number;
    regions: StarRegion[];    // indexed as in "Decisions"
    outline: Pt[];            // the outer n-gon
    lines: Array<[Pt, Pt]>;   // the construction lines drawn when starLines is on: every region edge, once
  };
  export function starConstruction(fold: StarFold, k: number, size: number): StarConstruction;
  export const STAR_KS: Record<StarFold, number[]>; // { 4: [3, 2], 5: [3, 2], 6: [4, 2] }
  /** The rotation (degrees, clockwise) taking region `from`'s frame onto region `to`'s; null if different kinds. */
  export function starRotation(c: StarConstruction, from: number, to: number): number | null;
  ```

- [ ] **Step 1: Failing tests** in `kufiStarGeometry.test.ts`, for each fold in `[4, 5, 6]` with its classic `k` and `size = 24`:
  - region counts: 1 centre, `2n` wedges, `n` corners;
  - the regions tile the outline: the sum of polygon areas equals the outline's area within 1e-6, and no two regions overlap by more than 1e-6 (polygon intersection area; a small clipping helper in the test is fine);
  - every wedge's polygon has 5 corners and contains no point of the centre star's interior;
  - `starRotation(c, 1, 1 + 2j)` is `j * 360 / n` for wedgeA, and `starRotation(c, 1, 2)` is `null`;
  - masks of same-kind regions are identical (`cols`, `rows`, `cells` equal);
  - every usable mask cell's square, mapped through `frame`, lies inside its polygon at distance ≥ 1 from the polygon's edge (sample the 4 corners and test distance to every edge);
  - a wedge's mask has more usable cells in its bottom row than in its top usable row (it narrows inward);
  - `lines` has no duplicate segment (an edge shared by two regions appears once).
- [ ] **Step 2: Run** `npx vitest run src/lib/kufi/kufiStarGeometry.test.ts`, expect FAIL (module missing).
- [ ] **Step 3: Implement** from the spec's construction section. The spike's geometry is the reference: tips on the circle at angles `-90° + i * 360/m` (y down, so tip 0 points up); inner corners at radius `R cos(πk/m) / cos(π(k−1)/m)`, halfway between tips; the ring's corners on the inner-corner rays at radius `size / cos(π/m)`; the outer n-gon's corners at radius `size / cos(π/n)`, at angles halfway between every other tip. Wedge `i`: `[inner(i−1), tip(i), inner(i), ring(i), ring(i−1)]`. Corners: the outer n-gon minus the ring, one triangle per outer corner.
- [ ] **Step 4: Run** the tests and expect PASS. Then `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`.
- [ ] **Step 5: Commit** `feat(kufi): star panel construction (4-, 5-, 6-fold)`.

### Task 2: The `kufiStar` block draws its construction

**Files:**
- Modify: `src/types.ts` (new `KufiStarBlock`, added to `Block` and the block-type union), `src/lib/blockCapabilities.ts` (`isKufiStar`), `src/lib/blockRenderProps.ts` (`kufiStarProps`), `src/App.tsx` (`addKufiStar`, `setKufiStar(patch)`), `src/components/CanvasStage.tsx`, `src/components/MirrorBlockView.tsx`, `src/components/sidebar/BlockControlsPanel.tsx` (an "Add Kufi star" button beside "Add Kufi panel"), `src/components/Sidebar.tsx`, `src/components/sidebar/LayersPanel.tsx`, `src/components/sidebar/TypographyPanel.tsx` (hide what a Kufi panel hides)
- Create: `src/components/KufiStarView.tsx`, `src/components/sidebar/KufiStarPanel.tsx`, `src/lib/kufi/kufiStarPath.ts`
- Test: `src/lib/kufi/kufiStarPath.test.ts`, `src/lib/blockRenderProps.test.ts`, `src/lib/legacySaves.test.ts`, `e2e/kufi-star.spec.ts`

**Interfaces:**
- Consumes: Task 1's `starConstruction`, `STAR_KS`.
- Produces:
  - `KufiStarBlock` with the fields in "Decisions".
  - `kufiStarPath(c: StarConstruction, regionCells: Array<Uint8Array | null>, lines: boolean, cellPx: number): string`: one SVG path `d` in px, origin at the outline's top-left. It is made of each region's inked cells traced with `cellRings` in local cells and mapped through `frame`, plus, when `lines` is on, every construction line as a filled band one cell wide, centred on the line, all the same winding, so a **nonzero** fill draws their union.
  - `KufiStarPanel` props: `block`, `onPatch(patch: Partial<KufiStarBlock>)` (one undo step per call).

- [ ] **Step 1: Failing tests.**
  - `kufiStarPath.test.ts`:
    - with all regions `null` and `lines` on, the path is non-empty and its bounding box equals the outline's bounding box times `cellPx`, ±1 cell;
    - with `lines` off and all regions `null`, the path is `""`;
    - a region's cells map through its frame: a mask-sized grid with one inked cell in wedge 1 gives a path whose only subpath's centroid lies inside wedge 1's polygon (×`cellPx`).
  - `blockRenderProps.test.ts`: `kufiStarProps` carries every `star*` field (follow the file's existing pattern for `kufiPanelProps`).
  - `legacySaves.test.ts`: a save holding a `kufiStar` block with every `star*` field loads unchanged.
  - `e2e/kufi-star.spec.ts` `"Add Kufi star draws the 4-fold construction and the lines toggle hides it"`: press "Add Kufi star", place it, assert a block of type `kufiStar` with `starFold` 4 exists (through `window.__HARF__`), assert ink pixels inside its box, untick "Show construction lines", and assert those pixels are gone.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement.**
  - Wire the new block through every place `kufiPanel` is wired: `grep -rn "kufiPanel" src --include=*.ts --include=*.tsx`, outside `lib/kufi/`.
  - `addKufiStar` makes `starFold: 4`, `starK: 3`, `starSize: 24`, empty `starRegions` (length `1 + 3n`, all `""`), `starLines: true`, `text: ""`, `fontSize: 112`, `strokeWidth: 0` and `color: "#1a1a1a"`, and places it like `addKufiPanel` (`beginPlacement`, click = centre).
  - `KufiStarView` draws `kufiStarPath` as one Konva `Shape`, with outline before fill and the fill through `createBlockFillPainter` (see `.claude/rules/kufi-panel.md`, "Export").
  - `KufiStarPanel` shows:
    - a Fold choice (4 / 5 / 6), as `aria-pressed` buttons;
    - a Star choice from `STAR_KS[fold]` ("Classic" / "Alternative");
    - a Size number input (12–60);
    - a "Show construction lines" checkbox.

    Changing the fold resets `starK` to the classic value and resizes `starRegions` to `1 + 3n` empty strings. This is the stage 1 preview: the construction, with no text yet.
- [ ] **Step 4: Verify.** Typecheck (app and e2e: `npx tsc --noEmit -p e2e/tsconfig.json`), lint, `npm test`, build, `npm run e2e -- kufi-star`.
- [ ] **Step 5: Commit** `feat(kufi): Kufi star block draws its construction`.

### Task 3: Square Kufi in a region (hidden)

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts`
- Test: `src/lib/kufi/kufiPackRegion.test.ts`

**Interfaces:**
- Consumes: Task 1's masks (`StarRegion["mask"]`).
- Produces:
  ```ts
  export type KufiMask = { cols: number; rows: number; cells: Uint8Array };
  /** Text packed into the usable cells of a mask on upright lines stacked from the bottom row up. Same result shape as packKufiPanel (cols/rows are the mask's). */
  export function packKufiRegion(input: { text: string; mask: KufiMask }): KufiPackResult;
  ```

- [ ] **Step 1: Failing tests** in `kufiPackRegion.test.ts`, under `_internal.setClockOverride(Infinity)`:
  - **The box is the region:** for a full 21×11 mask and `"الله أكبر"`, `packKufiRegion` gives `ok` or `tooShort`/`tooLong` (never throws). When it is `ok`:
    - every placement has `turn` 0;
    - no inked cell lies outside the mask;
    - there is no 2×2 of ink;
    - no empty 2×2 lies wholly inside the mask.
  - **Measure, then pin:** for each fold's classic construction and for each of `"الله"` and `"محمد"`, find the smallest `size` in 12..60 at which the wedge mask packs, and the same for the corner mask. Record the table in the task report. Pin the 4-fold wedge result for `"الله"` (its size, and the packed cells as a snapshot).
    - If no size up to 60 packs `"الله"` in a 4-fold wedge, stop and report BLOCKED with the table: the plan's premise fails there.
  - **Deterministic:** the same call twice gives equal results.
  - **Existing panels unchanged:** the existing `kufiPack.test.ts` suite passes untouched.
- [ ] **Step 2: Run them and expect FAIL** (`packKufiRegion` missing).
- [ ] **Step 3: Implement** by generalising the packer, not forking it.
  - A context carries an optional mask. Cells outside it are off-panel (`tabOf` gives -1).
  - The templates are side 0 only (`rot` 0), at today's ring offsets, ring count `floor((rows − 1) / (BAND + 1)) + 1`.
  - `count2x2` (empty) counts only windows wholly inside the mask. `edgeBreaks` reads the mask's own boundary cells in place of the frame's.
  - Without a mask, every path is today's code path, so existing results stay cell for cell.
  - Budget: `PACK_BUDGET_MS` / `PACK_WORK`, as a first draft.
- [ ] **Step 4: Verify.** Run `npx vitest run src/lib/kufi/kufiPackRegion.test.ts src/lib/kufi/kufiPack.test.ts`, then typecheck, lint, `npm test`, build.
- [ ] **Step 5: Commit** `feat(kufi): pack square Kufi into a region mask`.

### Task 4: The star panel draws its text

**Files:**
- Create: `src/lib/kufi/kufiStarLayout.ts`, `src/hooks/useKufiStarLayout.ts`
- Modify: `src/lib/kufi/kufiWorkerProtocol.ts` (request kind `"star"`), `src/lib/kufi/kufiLayoutClient.ts` (a `requestKufiStarLayout` with a result cache), `src/components/KufiStarView.tsx`, `src/hooks/useExport.ts` (wait for star layouts as for `kufiPanel`)
- Test: `src/lib/kufi/kufiStarLayout.test.ts`

**Interfaces:**
- Consumes: Task 1's construction and `starRotation`; Task 3's `packKufiRegion`; Task 2's `kufiStarPath`.
- Produces:
  ```ts
  export type KufiStarInputs = { fold: StarFold; k: number; size: number; regions: string[] };
  export type KufiStarLayout = {
    regions: Array<{ text: string; result: KufiPackResult | null }>; // null for "" (pattern only)
    unpacked: number[];   // indices whose text did not pack
  };
  export function layoutKufiStar(i: KufiStarInputs): KufiStarLayout;
  export function kufiStarKey(i: KufiStarInputs): string;
  ```

- [ ] **Step 1: Failing tests** in `kufiStarLayout.test.ts`, under the clock override:
  - With 4-fold, Task 3's pinned size, and `"الله"` in every wedgeA region:
    - every wedgeA region's result is `ok`;
    - all of them have equal `cells`, since a copy is the same packing placed by rotation;
    - `packKufiRegion` is called once, not 4 times (spy through `_internal.stats` or a counter the module exports for tests).
  - A region with `""` gives `null`, and a region whose text does not pack is listed in `unpacked`.
  - `layoutKufiStar` called twice with equal inputs gives equal results (reopening identical).
  - `kufiStarPath` of a layout with text in every wedgeA region gives a single path string with one `M` per traced ring and no `NaN`.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement.**
  - Pack each distinct (kind, text) once with `packKufiRegion` on that kind's mask. Every other region of the kind takes the same result; `KufiStarView` places it through that region's own `frame`, so no cells are rotated in code.
  - The worker answers `"star"` requests with `layoutKufiStar`.
  - The client caches results by `kufiStarKey`, as `kufiLayoutClient` does.
  - `KufiStarView` draws a region that did not pack as empty. The view's status line (the pattern of `kufiPanelStatus`) names how many regions did not pack.
- [ ] **Step 4: Verify.** Typecheck (app and e2e), lint, `npm test`, build, `npm run e2e -- kufi-star` (Task 2's test still passes).
- [ ] **Step 5: Commit** `feat(kufi): star panels draw their text, copies by rotation`.

### Task 5: Evaluate, offer, approve; the notes

**Files:**
- Create: `src/lib/kufi/kufiStarEvaluate.ts`
- Modify: `src/lib/kufi/kufiWorkerProtocol.ts` (request kind `"starEvaluate"`), `src/lib/kufi/kufiLayoutClient.ts` (`requestKufiStarOffers`), `src/components/sidebar/KufiStarPanel.tsx`, `src/App.tsx`
- Create: `.claude/rules/kufi-star.md` (`paths:` the new files), `src/components/guide/sections/kufi-star.tsx`
- Modify: `CLAUDE.md` (one line under "Subsystem notes", and `KufiStarBlock` in the `Block` paragraph), `PROGRESS.md` (one Shipped entry), `.claude/rules/deferred-features.md` (item 1 points at the new note)
- Test: `src/lib/kufi/kufiStarEvaluate.test.ts`, `e2e/kufi-star.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 3 and 4.
- Produces:
  ```ts
  export type KufiStarOffer = {
    inputs: KufiStarInputs;        // what approving it sets
    pattern: "repeat" | "alternate" | "run" | "corners" | "centre";
    fits: boolean;
    note: string;                  // plain words, e.g. "محمد does not fit a corner"
    quality: { squares: number; bars: number; size: number };
  };
  export type KufiStarEvaluation = {
    words: Array<{ text: string; drawable: boolean }>;
    offers: KufiStarOffer[];       // fitting offers first, best first; at most 6
  };
  export function evaluateKufiStar(text: string, budgetMs: number): KufiStarEvaluation;
  ```

- [ ] **Step 1: Failing tests** in `kufiStarEvaluate.test.ts`, under the clock override:
  - `"الله محمد"`: one offer has the pattern `"alternate"` (`الله` in wedgeA, `محمد` in wedgeB) and `fits`, on some fold.
  - `"الله"`: an offer with the pattern `"repeat"` (all wedges) `fits`.
  - `""`: no offers.
  - `"الله abc"`: `words[1].drawable` is false, and no offer places `abc`.
  - Offers are sorted: fitting first, then fewer `squares + bars`, then smaller `size`.
  - Run-round (`"run"`) offers exist only when the word count is at least `m`. Fewer words give no run offer for that fold and a note saying how many more words it needs.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement.**
  - The patterns, each tried on every fold and each `STAR_KS` value:
    - `repeat`: the whole text in every wedge;
    - `alternate`: with 2+ words, words alternate between wedgeA and wedgeB;
    - `run`: the words in order, clockwise from the top wedge, split into `m` consecutive groups;
    - `corners`: the shortest word in the corners, the rest by `alternate` or `repeat`;
    - `centre`: one word in the centre, the rest by `alternate` or `repeat`.
  - Sizes: for each offer, try `size` from 12 to 60 in steps of 2. The first size at which every non-empty region packs fits. Cache by (fold, k, size, kind, text).
  - Bound the whole call by `budgetMs`. The worker passes `FIT_BUDGET_MS`. Under the clock override, a fixed cap of tries keeps it deterministic, as Fit's `FIT_MAX_SIZES` does.
  - Sidebar:
    - a "Find layouts" button sends the request;
    - offers show as small previews: the `kufiStarPath` of each offer's layout, in an inline `<svg>`, with its note;
    - clicking one sets `starFold`, `starK`, `starSize` and `starRegions` in one undo step;
    - when the block's `text` differs from the text the offers were made for, the list says "The text changed: find layouts again", and the panel keeps drawing its approved regions.
  - Notes:
    - `.claude/rules/kufi-star.md`: how the construction works, the region indexing, the lattice frames, masks and seams, "copies by rotation, never mirror", and the evaluation patterns;
    - `CLAUDE.md`: one line;
    - the guide section: three short paragraphs for calligraphers;
    - `PROGRESS.md`: one entry;
    - `deferred-features.md`: item 1 marked as built, with a link.
- [ ] **Step 4: e2e** `"Find layouts offers a split and approving it draws the panel"`:
  1. Add a Kufi star and type `الله محمد`.
  2. Press "Find layouts" and wait for at least one offer.
  3. Click the first offer, then assert that `starRegions` has a non-empty entry and that the panel's ink pixels increased.
  4. Undo once and assert `starRegions` is back to all empty.
  5. Redo, export SVG, and assert the file holds exactly one `<path>`.
  6. Type one more letter and assert the "The text changed" line shows.

  Run `npm run e2e -- kufi-star`.
- [ ] **Step 5: Verify and commit.** Typecheck (app and e2e), lint, `npm test`, build, `npm run e2e -- kufi-star kufi-panel`. Commit `feat(kufi): star panels evaluate the text and offer splits`.
