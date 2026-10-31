# Square Kufi: More Texts Pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fit and suggestions try rectangular boxes; a new filler, the bar, closes the near misses (سبحان الله, Bismillah, قل هو الله أحد); a spike finds the shape that will pack the Shahada.

**Architecture:** All packing changes stay in the pure packer `src/lib/kufi/kufiPack.ts`. Rectangles change only the size order of `fitKufiPanel` and `suggestions`. Bars are a closing pass in `finish()` beside the lone-square `fillPass`, switched on only in a second phase of `searchInner` when the first phase found no packed panel, so every text that packs today keeps its panel exactly. The rest of the app sees bars only as ink cells plus `quality.bars`.

**Tech Stack:** TypeScript, Vitest (Node), Playwright (Chromium), React 19 + Konva.

**Spec:** `docs/superpowers/specs/2026-10-31-kufi-more-texts-design.md`

## Global Constraints

- The packer stays pure and deterministic: work budget plus clock safety net; `PACK_BUDGET_MS` = 1400, `REPACK_BUDGET_MS` = 150, `FIT_BUDGET_MS` = 9000 unchanged.
- New result fields are additive: `quality` gains `bars: number`.
- Ranking: packed, then fewest filler squares, then fewest bars, then least shortening, then least lengthening, then score.
- الله 9×9, الحمد لله 13×13 and Al-Baqarah 21×21 keep their panels cell for cell.
- A filler bar: straight, one cell wide, at least 2 cells long, parallel to the baseline of the letter(s) it touches, touching ink only at its two ends, never in a dot zone (`dotZone`), and closing at least one open window or frame break.
- Unit tests that assert a layout use `_internal.setClockOverride(Infinity)`.
- No names of teachers, calligraphers, studios or products in committed files. Never merge to main. No subagent may use the fable model.

## Review Focus

1. **A text that packs today, re-fitted:** Fit on الله, الحمد لله and Baqarah must still return 9×9, 13×13 and 21×21, not a rectangle ranked first. Task 1 pins this.
2. **Fit with pins:** a pinned panel's Fit goes through `packPinned` (up to `PINNED_CALL_MS` per size); more candidate sizes must not take it past `FIT_BUDGET_MS` plus one call. Task 1 pins this.
3. **A drag preview on a bar-closed panel:** a repack from `previous` must still find bars when it needs them (it runs `searchInner` too), or every edit on such a panel is refused. Task 2 pins this.
4. **A bar that reads as a stroke:** a bar continuing a letter's tall stroke (across the line) would lengthen an alef or a lam. Task 2's validity helper rejects it.
5. **Arrangements on a bar-closed panel:** options rank with `bars` (a missing `bars` counts 0 for old results). Task 3 pins this.

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

- [ ] **Step 3: Implement.** Candidate sizes are every `(cols, rows)` with both sides within ±3 of `estimateSide` and `|cols − rows| ≤ 3`, ordered by `max(|cols−est|, |rows−est|)`, then squares before rectangles, then `|cols − rows|`, then cols. Rank them cheaply first: run the greedy pass alone (`beamPass` at width 1, as `searchInner` starts) on each and order by its score, keeping squares first among equal scores; then full-search in that order until one packs or `FIT_BUDGET_MS` is spent. Measure the greedy pass on Baqarah and the Shahada first; if one costs over 30 ms, rank by the estimate only and note the measurement in the commit body. Suggestions take the same candidates, filtered to the requested direction (larger area for `tooLong`, smaller for `tooShort`), at most 2, within the call's existing deadline.

- [ ] **Step 4: Run the file and the whole suite**

Run: `npx vitest run src/lib/kufi/kufiPack.test.ts` then `npm test`
Expected: PASS (the flaky wall-clock "budgets" test predates this; rerun once if it alone fails).

- [ ] **Step 5: Commit** `feat(kufi): Fit and suggestions try rectangular boxes`

---

### Task 2: Filler bars close the near misses

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts` (`K_BAR`, `barPass`, `finish`, `Final`, `better`, `searchInner`, `W`, the `quality` field and its doc comment, the header comment)
- Test: `src/lib/kufi/kufiPack.test.ts`

**Interfaces:**
- Consumes: Task 1's Fit.
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

### Task 3: Bars across the app, and the notes

**Files:**
- Modify: `src/lib/kufi/kufiExplore.ts` (`rank`), `src/lib/kufi/kufiExplore.test.ts`
- Modify: `.claude/rules/kufi-panel.md`, `src/components/guide/sections/kufi-panel.tsx`, `PROGRESS.md`
- Test: `e2e/kufi-panel.spec.ts`

**Interfaces:**
- Consumes: `quality.bars` from Task 2.

- [ ] **Step 1: Write the failing unit test** in `kufiExplore.test.ts`: `"ranks fewer bars ahead of less shortening"` — two fake tries with `quality` `{ squares: 0, bars: 1, cut: 0, grow: 0 }` and `{ squares: 0, bars: 0, cut: 3, grow: 0 }` (built the way the file's existing rank tests build tries); `pickArrangements` returns the zero-bar one first. Also a try whose `quality` lacks `bars` ranks as `bars: 0`.

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run src/lib/kufi/kufiExplore.test.ts -t "bars"`

- [ ] **Step 3: Implement** `rank` as `[squares, bars ?? 0, cut, grow]`.

- [ ] **Step 4: Write the e2e test** `"Fit packs «سبحان الله» and draws it"`: add a Kufi panel, type `سبحان الله`, press Fit, then poll until the status no longer shows a "Too long"/"Too short" message and `kufi-unfit-frame` count is 0; assert ink in the block's box (`inkPixels` > 15% of its area, as `openBaqarahPanel` does). Run: `npm run e2e -- kufi-panel -g "سبحان"`. Expected: PASS.

- [ ] **Step 5: Notes.** In `.claude/rules/kufi-panel.md`: rectangles in Fit and suggestions; the filler bar rule and its rung in the ranking; bars only in the second phase. Replace the "Most texts do not pack" gap with what packs now and that the Shahada and short single words still do not; remove the stale "Touch cannot paint" gap (fixed in `dd7c1ca`). One line in the guide section that some texts need a box that is not square and may be closed by a short straight bar. One line in `PROGRESS.md` pointing to the note.

- [ ] **Step 6: Verify and commit.** Run `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npm run build`, then `npm run e2e -- kufi-panel`. Commit `feat(kufi): rank arrangements by bars; notes for rectangles and bars`.

---

### Task 4: Shahada spike (throwaway, not committed)

**Files:**
- Create (untracked, deleted after): `src/lib/kufi/zzshahada.test.ts`, local copies as needed.

- [ ] **Step 1:** On a scratch copy of the packer, try **a core word**: when the remaining text cannot finish the inner ring, the remaining word(s) go into the core inside the last full ring, on lines of their own (bottom first, as the frame does). Record for the Shahada, sizes 19–27 (and rectangles within 3): packed or not, holes, bars, squares.
- [ ] **Step 2:** Try **deeper inner bands**: an inner ring's band may be 5, 6 or 7 cells deep, chosen per ring by the search. Record the same table.
- [ ] **Step 3:** Render each approach's best Shahada panel as a PNG (the probe's ASCII grid drawn at 12 px a cell is enough), check each picture, and report both tables and pictures to the user with a recommendation. Stop there: the spec is amended and a new plan written only after the user picks.
