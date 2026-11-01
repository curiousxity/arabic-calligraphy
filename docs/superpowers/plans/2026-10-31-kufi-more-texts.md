# Square Kufi: More Texts Pack — Implementation Plan

> **Status (2026-10-31):** Two lines (Task 2) was dropped by the user. The Shahada (Task 6) was stopped and stays a known limit, for a later layout with a word in the centre. Rectangles, filler bars and the ranking by bars shipped.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fit and suggestions try rectangles of any proportion; a two-line layout joins the ring; a new filler, the bar, closes the near misses (سبحان الله, Bismillah, قل هو الله أحد); a spike finds the shape that will pack the Shahada.

**Architecture:** All packing changes stay in the pure packer `src/lib/kufi/kufiPack.ts`. Rectangles change only the size order of `fitKufiPanel` and `suggestions`. Two lines is a second set of line templates chosen by a `layout` input, stored on the block as `panelLayout`. Bars are a closing pass in `finish()` beside the lone-square `fillPass`, switched on only in a second phase of `searchInner` when the first phase found no packed panel, so every text that packs today keeps its panel exactly. The rest of the app sees bars only as ink cells plus `quality.bars`.

**Tech Stack:** TypeScript, Vitest (Node), Playwright (Chromium), React 19 + Konva.

**Spec:** `docs/superpowers/specs/2026-10-31-kufi-more-texts-design.md`

## Global Constraints

- The packer stays pure and deterministic: work budget plus clock safety net; `PACK_BUDGET_MS` = 1400, `REPACK_BUDGET_MS` = 150, `FIT_BUDGET_MS` = 9000 unchanged.
- New result fields are additive: `quality` gains `bars: number`. New block field `panelLayout?: "ring" | "lines"`; absent means ring, so old saves load unchanged.
- Two lines: both upright, read right to left, top line first; the text breaks only between words.
- Ranking: packed, then fewest filler squares, then fewest bars, then least shortening, then least lengthening, then score.
- الله 9×9, الحمد لله 13×13 and Al-Baqarah 21×21 keep their panels cell for cell.
- A filler bar: straight, one cell wide, at least 2 cells long, parallel to the baseline of the letter(s) it touches, touching ink only at its two ends, never in a dot zone (`dotZone`), and closing at least one open window or frame break.
- Unit tests that assert a layout use `_internal.setClockOverride(Infinity)`.
- No names of teachers, calligraphers, studios or products in committed files. Never merge to main. No subagent may use the fable model.

## Review Focus

1. **Two lines on a box too short for two bands** (fewer than 11 rows): the packer says tooShort/tooLong, never a panel with a missing line. Task 2 pins this.
2. **A text that packs today, re-fitted:** Fit on الله, الحمد لله and Baqarah must still return 9×9, 13×13 and 21×21, not a rectangle ranked first. Task 1 pins this.
3. **Fit with pins:** a pinned panel's Fit goes through `packPinned` (up to `PINNED_CALL_MS` per size); more candidate sizes must not take it past `FIT_BUDGET_MS` plus one call. Task 1 pins this.
4. **A drag preview on a bar-closed panel:** a repack from `previous` must still find bars when it needs them (it runs `searchInner` too), or every edit on such a panel is refused. Task 2 pins this.
5. **A bar that reads as a stroke:** a bar continuing a letter's tall stroke (across the line) would lengthen an alef or a lam. Task 2's validity helper rejects it.
(Arrangements on a bar-closed panel rank with `bars`, a missing `bars` counting 0: Task 4 pins this.)

---

### Task 1: Fit and suggestions try rectangles

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts` (`sizesFrom`, `suggestions`, `fitKufiPanel`, the constants beside `FIT_TRIES`)
- Test: `src/lib/kufi/kufiPack.test.ts`

**Interfaces:**
- Produces: `fitKufiPanel(text, edits?)` and `suggestions` may return `{ cols, rows }` with `cols !== rows`. Callers (`KufiUnfitFrame`, `kufiPanelStatus`, the sidebar) already take both fields.

- [ ] **Step 1: Write the failing tests** in `kufiPack.test.ts`, inside `describe("fitKufiPanel")`:

```ts
it("fits «الله أكبر», which packs only in a rectangle", () => {
  const size = fitKufiPanel("الله أكبر");
  expect(size.cols).not.toBe(size.rows);
  expectPacked(packKufiPanel({ text: "الله أكبر", ...size }), "الله أكبر");
}, 60000);

it("keeps the square sizes of the texts that pack in one", () => {
  expect(fitKufiPanel(ALLAH)).toEqual({ cols: 9, rows: 9 });
  expect(fitKufiPanel("الحمد لله")).toEqual({ cols: 13, rows: 13 });
  expect(fitKufiPanel(BAQARAH)).toEqual({ cols: 21, rows: 21 });
}, 60000);

it("suggests a rectangle when only rectangles pack", () => {
  const r = packKufiPanel({ text: "الله أكبر", cols: 13, rows: 13 });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.suggestions.length).toBeGreaterThanOrEqual(1);
  for (const s of r.suggestions) expectPacked(packKufiPanel({ text: "الله أكبر", ...s }), "الله أكبر");
}, 60000);
```

And in the timing block (clock on), `"a pinned Fit stays within FIT_BUDGET_MS plus one pinned call"`: time `fitKufiPanel(BAQARAH, committed)` (reuse the committed edits of the existing pinned-Fit test) and assert under `FIT_BUDGET_MS + PINNED_CALL_MS` (export `FIT_BUDGET_MS` through `_internal`).

- [ ] **Step 2: Run, expect the first and third to fail**

Run: `npx vitest run src/lib/kufi/kufiPack.test.ts -t "rectangle"`
Expected: FAIL (Fit returns a square that does not pack; suggestions empty).

- [ ] **Step 3: Implement.** Candidate sizes, any proportion: for each height `rows` from 7 to 2 × `estimateSide`, the widths `cols` within ±2 of `round(est² / rows)` (the text's area at that height), each side at least 7. Their order, used as the tie-break after the greedy ranking below: squares first, then by elongation `max(cols, rows) / min(cols, rows)`, then by distance from the area estimate, then rows, then cols. Rank them cheaply first: run the greedy pass alone (`beamPass` at width 1, as `searchInner` starts) on each and order by its score, keeping squares first among equal scores; then full-search in that order until one packs or `FIT_BUDGET_MS` is spent. Measure the greedy pass on Baqarah and the Shahada first; if one costs over 30 ms, rank by the estimate only and note the measurement in the commit body. Suggestions take the same candidates, filtered to the requested direction (larger area for `tooLong`, smaller for `tooShort`), at most 2, within the call's existing deadline. Add a test that a very wide size, 41×9, is accepted by `packKufiPanel` (a result, ok or not, without throwing), so no proportion is capped.

- [ ] **Step 4: Run the file and the whole suite**

Run: `npx vitest run src/lib/kufi/kufiPack.test.ts` then `npm test`
Expected: PASS (the flaky wall-clock "budgets" test predates this; rerun once if it alone fails).

- [ ] **Step 5: Commit** `feat(kufi): Fit and suggestions try rectangular boxes`

---

### Task 2: Two lines

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts` (a `layout` input on `packKufiPanel`, `fitKufiPanel`, `makeCtx`; the line templates; `outOfRoom`; the cache keys), `src/lib/kufi/kufiWorkerProtocol.ts`, `src/lib/kufi/kufiLayoutClient.ts` (the inputs key), `src/lib/kufi/kufiExplore.ts` (passes `layout` through)
- Modify: `src/types.ts` (`KufiPanelBlock.panelLayout?: "ring" | "lines"`), `src/App.tsx` (Fit stores the layout it found), `src/components/sidebar/KufiPanelPanel.tsx` (a Ring / Two lines choice)
- Test: `src/lib/kufi/kufiPack.test.ts`, `e2e/kufi-panel.spec.ts`

**Interfaces:**
- Consumes: Task 1's candidate sizes.
- Produces: `type KufiLayout = "ring" | "lines"`; `packKufiPanel({ text, cols, rows, layout?, edits?, previous? })` (default `"ring"`); `fitKufiPanel(text, edits?, layout?: KufiLayout | "any")` returning `{ cols, rows, layout }`; suggestions carry `layout`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("two lines", () => {
  it("packs a text on two upright lines, top line first, broken between words", () => {
    const text = "سبحان الله وبحمده";
    const size = fitKufiPanel(text, {}, "lines");
    expect(size.layout).toBe("lines");
    const r = expectPacked(packKufiPanel({ text, ...size }), text);
    expect(r.placements.every((p) => p.turn === 0)).toBe(true);
    const units = resolveKufiText(text).units;
    const lineOf = (k: number) => (r.placements[k].row < r.rows / 2 ? 0 : 1);
    for (let k = 1; k < units.length; k++) {
      expect(lineOf(k)).toBeGreaterThanOrEqual(lineOf(k - 1));
      if (lineOf(k) !== lineOf(k - 1)) expect(units[k].wordIndex).not.toBe(units[k - 1].wordIndex);
    }
  }, 90000);

  it("a box too short for two bands says so", () => {
    const r = packKufiPanel({ text: BAQARAH, cols: 40, rows: 8, layout: "lines" });
    expect(r.ok).toBe(false);
  }, 30000);

  it("ring stays the default: no layout gives the ring panel", () => {
    const a = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 });
    const b = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, layout: "ring" });
    expect(a).toEqual(b);
  }, 20000);
});
```

(If `سبحان الله وبحمده` does not pack as two lines once built, use the shortest text from the spec's table that does, and say so in the commit body.)

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run src/lib/kufi/kufiPack.test.ts -t "two lines"`

- [ ] **Step 3: Implement.** The `lines` layout has two line templates, both `rot` 0: the top line's baseline at row `BAND` (its band rows 0–5), the bottom line's at row `rows − 1`, with the ring's offsets (`RINGK_OFF` for the top, `RING0_OFF` for the bottom) so the bands can interlock. Reading order fills the top line first; a piece may start the bottom line only at a word start. Everything after line choice (search, scoring, fills, dots, natural phase) is shared. `outOfRoom` counts the two lines for this layout. Every cache key and the layout client's inputs key include the layout. `fitKufiPanel` with `"any"` tries, for each candidate size in Task 1's order, the ring then two lines, and returns the first that packs.

- [ ] **Step 4: Wire the block.** `panelLayout` flows from the block into the pack and explore requests; Fit writes the `cols`, `rows` and `layout` it found in one undo step; the Kufi panel section shows two toggle buttons, `Ring` and `Two lines` (`aria-pressed`), switching the layout as one undo step and keeping the size. Old saves without the field read as ring.

- [ ] **Step 5: e2e** `"Two lines lays the text on two upright lines"`: add a panel, type `سبحان الله وبحمده`, press `Two lines`, press Fit, poll until the `kufi-unfit-frame` count is 0, and assert the block's box is wider than tall. Run `npm run e2e -- kufi-panel -g "Two lines"`.

- [ ] **Step 6: Verify and commit.** Typecheck (app and e2e), lint, `npm test`, build. Commit `feat(kufi): a two-line layout beside the ring`.

---

### Task 3: Filler bars close the near misses

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts` (`K_BAR`, `barPass`, `finish`, `Final`, `better`, `searchInner`, `W`, the `quality` field and its doc comment, the header comment)
- Test: `src/lib/kufi/kufiPack.test.ts`

**Interfaces:**
- Consumes: Task 1's Fit and Task 2's `layout` (bars apply to both layouts).
- Produces: `quality: { squares; bars; cut; grow }` on an ok result; `const K_BAR = 5` cells in `Final.kind`; `Ctx.bars: boolean`.

- [ ] **Step 1: Pin today's panels before changing anything.** Add a test `"panels that packed before bars keep every cell"` that packs ALLAH 9×9, `"الحمد لله"` 13×13 and BAQARAH 21×21 and compares `Array.from(r.cells).join("")` with string literals. Generate the literals by running the packer at the current HEAD (clock override on), paste them in, and run to see it pass before any other change.

- [ ] **Step 2: Write the failing tests**

```ts
/** Every non-letter, non-dot ink run that is not a lone square: a bar, by the spec's rule. */
function expectBarsAreBars(r: Ok, text: string): number { /* returns the bar count */ }
```

The helper finds ink cells that are in no placement's glyph ink, are no letter's dot (as `expectDotsAreLetters` decides), and are not lone; groups them 4-connected; and asserts each group is one row or one column, at least 2 long, with no ink beside it except at its two ends, no cell in a dot zone, and parallel to the baseline of every letter it touches at an end (turn 0 or 180: one row; 90 or 270: one column). Call it from `expectPacked`.

```ts
describe("filler bars", () => {
  for (const text of ["سبحان الله", "بسم الله الرحمن الرحيم", "قل هو الله أحد"])
    it(`Fit packs «${text}»`, () => {
      const size = fitKufiPanel(text);
      const r = expectPacked(packKufiPanel({ text, ...size }), text);
      expect(r.quality?.bars).toBeGreaterThanOrEqual(0);
    }, 90000);

  it("never draws a bar where a panel packs without one", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    expect(r.quality?.bars).toBe(0);
  }, 20000);

  it("a repack of a bar-closed panel still packs (a drag preview is not refused)", () => {
    const text = "سبحان الله";
    const size = fitKufiPanel(text);
    const first = expectPacked(packKufiPanel({ text, ...size }), text);
    const again = packKufiPanel({ text, ...size, edits: {}, previous: first });
    expectPacked(again, text);
  }, 90000);
});
```

- [ ] **Step 3: Run, expect the three Fit tests to fail**

Run: `npx vitest run src/lib/kufi/kufiPack.test.ts -t "filler bars"`
Expected: FAIL (no size packs).

- [ ] **Step 4: Implement.**
  - `barPass(ctx, own, kind, zone, nextId): number`, run in `finish()` before `fillPass` and only when `ctx.bars`: candidate bars are maximal straight runs of paper cells that pass the rule in Global Constraints; take them greedily by windows and frame breaks closed (most first, ties by index), each marked `K_BAR` with its own owner id, re-checking the rule after each one placed. Return the count.
  - `Final` gains `bars`; `finish` adds `W.bar * bars` to the score, with `W.bar = 12`: under a square (25), so the score orders unpacked panels the way `better` orders packed ones. Tune only if a test shows a bar beating a lengthened stroke.
  - `better`: after squares, `if (a.packed && a.bars !== b.bars) return a.bars < b.bars;`.
  - `searchInner`: run the current phases with `ctx.bars = false`; if the best is not packed and work is left, run the beams again with `ctx.bars = true`, from the start, under the remaining work, and keep the better by `better`.
  - The ok result's `quality` carries `bars`.
  - Update the header comment and the `better` doc comment for the new rung.

- [ ] **Step 5: Run the file and the whole suite**

Run: `npx vitest run src/lib/kufi/kufiPack.test.ts` then `npm test`
Expected: PASS, including Step 1's cell literals unchanged.

- [ ] **Step 6: Commit** `feat(kufi): filler bars close a panel the text nearly fills`

---

### Task 4: Bars across the app, and the notes

**Files:**
- Modify: `src/lib/kufi/kufiExplore.ts` (`rank`), `src/lib/kufi/kufiExplore.test.ts`
- Modify: `.claude/rules/kufi-panel.md`, `src/components/guide/sections/kufi-panel.tsx`, `PROGRESS.md`
- Test: `e2e/kufi-panel.spec.ts`

**Interfaces:**
- Consumes: `quality.bars` from Task 3.

- [ ] **Step 1: Write the failing unit test** in `kufiExplore.test.ts`: `"ranks fewer bars ahead of less shortening"` — two fake tries with `quality` `{ squares: 0, bars: 1, cut: 0, grow: 0 }` and `{ squares: 0, bars: 0, cut: 3, grow: 0 }` (built the way the file's existing rank tests build tries); `pickArrangements` returns the zero-bar one first. Also a try whose `quality` lacks `bars` ranks as `bars: 0`.

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run src/lib/kufi/kufiExplore.test.ts -t "bars"`

- [ ] **Step 3: Implement** `rank` as `[squares, bars ?? 0, cut, grow]`.

- [ ] **Step 4: Write the e2e test** `"Fit packs «سبحان الله» and draws it"`: add a Kufi panel, type `سبحان الله`, press Fit, then poll until the status no longer shows a "Too long"/"Too short" message and `kufi-unfit-frame` count is 0; assert ink in the block's box (`inkPixels` > 15% of its area, as `openBaqarahPanel` does). Run: `npm run e2e -- kufi-panel -g "سبحان"`. Expected: PASS.

- [ ] **Step 5: Notes.** In `.claude/rules/kufi-panel.md`: rectangles of any proportion in Fit and suggestions; the two-line layout and `panelLayout`; the filler bar rule and its rung in the ranking; bars only in the second phase. Replace the "Most texts do not pack" gap with what packs now and that the Shahada and short single words still do not; remove the stale "Touch cannot paint" gap (fixed in `dd7c1ca`). One line each in the guide section: some texts need a box that is not square; Two lines sets the text on two upright lines; a panel may be closed by a short straight bar. One line in `PROGRESS.md` pointing to the note.

- [ ] **Step 6: Verify and commit.** Run `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npm run build`, then `npm run e2e -- kufi-panel`. Commit `feat(kufi): rank arrangements by bars; notes for rectangles and bars`.

---

### Task 5: Shahada spike (throwaway, not committed)

**Files:**
- Create (untracked, deleted after): `src/lib/kufi/zzshahada.test.ts`, local copies as needed.

- [ ] **Step 1:** On a scratch copy of the packer, try **a core word**: when the remaining text cannot finish the inner ring, the remaining word(s) go into the core inside the last full ring, on lines of their own (bottom first, as the frame does). Record for the Shahada, sizes 19–27 (and rectangles within 3): packed or not, holes, bars, squares.
- [ ] **Step 2:** Try **deeper inner bands**: an inner ring's band may be 5, 6 or 7 cells deep, chosen per ring by the search. Record the same table.
- [ ] **Step 2b:** Run the built two-line layout (Task 2) on the Shahada at the widths Task 1 proposes, with bars. Record the same table.
- [ ] **Step 3:** Render each of the three approaches' best Shahada panel as a PNG (the probe's ASCII grid drawn at 12 px a cell is enough), check each picture, and report both tables and pictures to the user with a recommendation. Stop there: the spec is amended and a new plan written only after the user picks.

---

### Task 6: The Shahada packs on one ring

Added after Task 5. The user dropped two lines (Task 2: "you can split it up if you don't have enough room" only) and approved closing the Shahada's holes on one ring.

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts` (`ROW_MAX`, Fit's work), the letter table that defines forms for ه ح م د (find it from `kufiPack.ts`'s imports)
- Test: `src/lib/kufi/kufiPack.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 3 (rectangles, bars, Fit order R9). Task 5's spike diff and tables: `scratchpad/shahada-spike/` (path given in the dispatch).
- Produces: no new API. `fitKufiPanel(SHAHADA)` returns a size that packs.

- [ ] **Step 1: Failing test.** `it("the Shahada packs through Fit")`: `SHAHADA = "لا إله إلا الله محمد رسول الله"`; `const size = fitKufiPanel(SHAHADA)`; `expectPacked(packKufiPanel({ text: SHAHADA, ...size }), SHAHADA)`, with `expectBarsAreBars`. Clock override Infinity, timeout as the Bismillah test.
- [ ] **Step 2: Levers, in this order, keeping each only if it helps:** (a) `ROW_MAX` 7 or 8 (the spike's 8 gave 23×25 with 12 holes, 0 edge breaks); (b) taller or wider forms for ه ح م د, each built from an existing form of that letter by lengthening its existing strokes, never a new shape; (c) more search work for long texts only (texts whose estimated side exceeds Baqarah's), inside Fit; (d) anything else the probes show is the blocker, recorded in the report.
- [ ] **Step 3: Guards.** The three pinned panels (الله 9×9, الحمد لله 13×13, Baqarah 21×21) and the Fit results for سبحان الله, Bismillah, قل هو الله أحد stay as today's tests pin them. Every existing test stays green.
- [ ] **Step 4: Render** the packed Shahada as a PNG (the spike's `render.mjs` approach) and save it in the report directory.
- [ ] **Step 5: Verify and commit.** Typecheck (app and e2e), lint, `npm test`, build. Commit `feat(kufi): the Shahada packs on one ring`.

If no combination packs it, do not commit half-measures: report the best result per lever (size, holes, failed letters, edge breaks) and what blocks it, status BLOCKED.
