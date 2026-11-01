# Move word may rearrange the panel: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A word dragged with Move word may make the rest of the panel rearrange around it (anything not explicitly pinned may shift, stretch or change form). The drag only offers moves the lattice can take.

**Architecture:** `repack` gains a last step for a moved word: a fresh search with only the explicit pins, at a first draft's work, run only when today's rounds did not pack. The overlay's route drag steps two cells at a time. The preview outlines the other letters that moved. The commit pins those letters too, so the panel reopens as it was.

**Tech Stack:** React 19 + TS, Konva, Vitest, Playwright.

**Spec:**
- `docs/superpowers/specs/2026-10-31-kufi-panel-usability-design.md`, the Move word tool;
- the user's decision of 2026-11-01: "a move may rearrange the rest of the panel", with the preview showing what else moves.

The measurements behind this plan are in the reroute spike, which covered 7 panels, every word, and routes ±1 and ±2:
- **Odd moves:** no ±1 move packs under any search. The lattice's stroke = gap = one cell parity rules them out.
- **±2 moves with today's repack:** 2 of 32 pack.
- **±2 moves with a fresh search:** at a first draft's work, 7 of 32 pack. A median of 2 other letters change, 10 at most (Al-Baqarah).
- **Speed:** the fresh search takes 0.3 s median, 0.6 s max, in the worker.
- **Ruled out:** 10× work adds nothing. Freeing the moved letter's form adds 1.

## Global Constraints

- The packer stays pure and deterministic: work budget plus clock safety net. `PACK_BUDGET_MS` = 1400, `REPACK_BUDGET_MS` = 150 and `FIT_BUDGET_MS` = 9000 stay unchanged. The new step uses `PACK_BUDGET_MS` / `PACK_WORK`.
- A move that packs today packs identically, cell for cell, because the new step runs only after today's rounds fail. The same holds for every non-route repack (stretch, form, pin, paint), which never reaches the new step.
- The pinned panels stay cell for cell: الله 9×9, الحمد لله 13×13, Al-Baqarah 21×21.
- Explicit pins (`edits.pinned`) stay hard.
- Unit tests that assert a layout use `_internal.setClockOverride(Infinity)`.
- No names of teachers, calligraphers, studios or products in committed files. Never merge to main. No subagent may use the fable model.

## Review Focus

1. **A refused move stays refused quickly enough to drag.** Each cell crossed waits for the previous preview, so the new step must not run for the ±1 positions the drag no longer offers. Task 2 pins the even-only steps.
2. **Reopening a rearranged panel.** A saved panel whose move reshuffled other letters must reopen identical. Task 1 tests a pack with the committed edits and no `previous`.
3. **Undo.** One undo restores the panel before the move, including the other letters that moved. Task 2's e2e asserts this.
4. **A word next to explicitly pinned letters:** the new step never moves them. Task 1 tests this.

---

### Task 1: The packer rearranges for a moved word

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts` (`repack`, around 2696; it may call `freshFinal`, around 2429)
- Modify: `src/lib/kufi/kufiPanelBlock.ts` (`kufiPinWordEdits`)
- Test: `src/lib/kufi/kufiPack.test.ts`, `src/lib/kufi/kufiPanelBlock.test.ts` (or wherever `kufiPinWordEdits` is tested now)

**Interfaces:**
- Produces:
  - `kufiPinWordEdits(edits, before: Ok, result: Ok, units, wordIndex): KufiPanelEdits`. It pins every letter of the word, plus every other letter whose glyph, turn, place or stretch differs between `before` and `result`.
  - No new packer API; the behaviour sits behind `packKufiPanel({ previous, edits })`.

- [ ] **Step 1: Failing tests.** Use the clock override. Build route edits with `kufiRouteEdits` on the committed panel.
  - (a) نصر من الله at 15×9, word 0, route +2: the pack is ok and has no holes, and the word's first letter sits at its pin.
  - (b) Al-Baqarah 21×21, word 1, route +2: the pack equals what HEAD's repack gives, cell for cell. Today that move packs in round 1, with no other letter changed.
  - (c) Any panel and word, route +1: the pack is not ok.
  - (d) After (a), every letter outside the word that is explicitly pinned beforehand still sits at its pin.
  - (e) After (a), `kufiPinWordEdits(edits, before, after, units, 0)` gives edits. `packKufiPanel` with those edits and no `previous` reproduces `after`, cell for cell.
  - (f) A stretch edit on Baqarah equals HEAD's result, so the guard covers non-route repacks.
- [ ] **Step 2: Run them and expect FAIL** for (a) and (e).
- [ ] **Step 3: Implement.**
  - In `repack`: when a word moved (the `first` set is non-empty) and no round packed, run a fresh search with `explicit` pins only, at `PACK_BUDGET_MS` / `PACK_WORK`.
  - Return the search's result if it packs; otherwise return the best result so far, as today.
  - Extend `kufiPinWordEdits` as in Interfaces and update its one caller in `KufiPanelEditOverlay.tsx` (`pinFor`) to pass the committed panel.
- [ ] **Step 4: Verify and commit.** Run the typecheck for the app and for e2e, then lint, `npm test` and the build. Commit `feat(kufi): a moved word may rearrange the panel`.

### Task 2: The drag steps two cells, and the preview shows what else moved

**Files:**
- Modify: `src/components/KufiPanelEditOverlay.tsx` (`beginRoute`, the pull machinery it uses, the preview drawing)
- Modify: `.claude/rules/kufi-panel.md` (the "Routes are a record only" bullet, around line 174), `src/components/guide/sections/kufi-panel.tsx` (one line), `PROGRESS.md` (one entry)
- Test: `e2e/kufi-panel.spec.ts`, plus unit tests for any pure helper you add

**Interfaces:**
- Consumes: Task 1's `kufiPinWordEdits(edits, before, result, units, wordIndex)`.

- [ ] **Step 1: Even steps only.**
  - The route drag offers only routes whose difference from the committed route is even: ±2, ±4 and so on, up to `MAX_PULL`.
  - The pointer snaps to the nearest even step. Odd positions are never sent to the packer.
  - A refused even step shows the existing `NO_ROOM_TO_ROUTE` notice, as today.
- [ ] **Step 2: Show what else moved.**
  - While a route preview is shown and packs, outline every letter outside the dragged word whose glyph, turn, place or stretch differs from the committed panel.
  - Use the overlay's existing outline style for a hovered letter, in a distinct colour token.
  - Nothing is outlined when nothing else moved.
- [ ] **Step 3: The notes.**
  - `kufi-panel.md`:
    - a move may rearrange every unpinned letter (a fresh search, only when the local rounds fail);
    - moves go in steps of two cells, because of the lattice parity;
    - remove the stale claim that nothing on Al-Baqarah moves at ±2. Word 1 moves +2.
  - The guide: one line saying a moved word may shift other letters, and that the preview outlines them.
  - `PROGRESS.md`: one entry.
- [ ] **Step 4: e2e** `"Move word rearranges the panel and one undo restores it"`:
  1. Add a panel, type نصر من الله and set 15×9.
  2. Choose Move word and drag word 0's route handle two cells on.
  3. Poll until the preview's outline count is at least 1. If that move changes no other letter, assert 0 instead and say so in the test name.
  4. Release, and assert the panel changed.
  5. Undo once, and assert the panel matches the cells it had before.
  6. Run `npm run e2e -- kufi-panel -g "Move word"`.
- [ ] **Step 5: Verify and commit.** Run the typecheck for the app and for e2e, then lint, `npm test`, the build and `npm run e2e -- kufi-panel`. Commit `feat(kufi): Move word steps two cells and outlines what else moves`.
