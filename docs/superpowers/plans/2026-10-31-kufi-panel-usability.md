# Kufi Panel Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the square Kufi panel easy to use: a strip of other valid arrangements, per-letter options known to fit, visible tools with nearby messages, and a visible frame when a box doesn't fit.

**Architecture:** One background exploration (its own Web Worker) tries every single form and stretch change the canvas could make against the current packed panel, with the same `packKufiPanel` call the canvas uses. Its answers feed the arrangements strip (distinct packed panels, ranked by the packer's own quality order) and the per-letter options (which forms and stretch lengths fit). The canvas overlay gains explicit tools; refusals show next to the letter.

**Tech Stack:** React 19 + TypeScript, Vite, Konva/react-konva, Vitest (unit, Node), Playwright (e2e, Chromium).

**Spec:** `docs/superpowers/specs/2026-10-31-kufi-panel-usability-design.md`

## Global Constraints

- All rules in `.claude/rules/kufi-panel.md` and `docs/superpowers/specs/2026-10-28-square-kufi-compositions-design.md` hold: dot sets whole or none, filler order, lattice grammar, single-outline export.
- The packer stays pure and deterministic; new result fields are additive.
- No packing on the main thread during editing; exploration must never delay the pack worker's previews.
- No names of teachers, calligraphers, studios or products in committed files; reference images stay local; never merge to main.
- Stage only your own files; the pre-commit hook's package.json patch bump is expected.
- Verification loop for every task: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npm run build`; UI tasks also `npm run e2e -- kufi-panel` (the marks.spec failure is pre-existing; kufi e2e is load-sensitive, rerun once before calling a failure real).

## Review Focus

1. **Text, size or edits change while exploring:** answers for the old inputs must never appear in the strip or the letter options (Task 3 test `drops tries for inputs no longer wanted`).
2. **A panel that does not pack:** no exploration starts; the strip says nothing rather than "Looking…" forever (Task 4 e2e `a panel that does not pack shows no arrangements`).
3. **A panel that already has edits and pins:** changes compose with them; applying an option keeps the other edits (Task 2 test `keeps existing edits`).
4. **Mirrors of a panel:** only one exploration per inputs key, however many renderers show it (Task 3 test `one job per key`).
5. **Undo after applying an option** restores the panel exactly, and returning to it reuses the cached exploration (Task 4 e2e `applies in one undo step`).

---

### Task 1: Quality numbers on a packed result

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts` (type `KufiPackResult`, `okResult`)
- Test: `src/lib/kufi/kufiPack.test.ts`

**Interfaces:**
- Produces: on the ok branch of `KufiPackResult`, `quality?: { squares: number; cut: number; grow: number }`, copied from the `Final` (`squares`, `cut`, `grow`) that packed. Optional so hand-built results in tests still type-check; a missing quality ranks last.

- [ ] **Step 1: Write the failing test** `describe("quality")`: `packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 })` is ok and `result.quality` equals `{ squares: 0, cut: expect.any(Number), grow: expect.any(Number) }` with `cut >= 0 && grow >= 0`.
- [ ] **Step 2: Run** `npx vitest run src/lib/kufi/kufiPack.test.ts -t quality` — FAIL (`quality` undefined).
- [ ] **Step 3: Implement** in `okResult`: `quality: { squares: f.squares, cut: f.cut, grow: f.grow }`.
- [ ] **Step 4: Run** the same — PASS; then the full verification loop.
- [ ] **Step 5: Commit** `feat(kufi): report a packed panel's filler, shortening and lengthening`

---

### Task 2: Pure exploration — the changes, one try, the picks

**Files:**
- Create: `src/lib/kufi/kufiExplore.ts`
- Test: `src/lib/kufi/kufiExplore.test.ts`

**Interfaces:**
- Consumes: `packKufiPanel`, `kufiFormsOf`, `KufiPackResult`, `KufiPanelEdits` (`kufiPack.ts`); `kufiFormEdits`, `kufiStretchEdits`, `kufiPinEdits` (`kufiPanelBlock.ts`); `kufiGlyphById`, `placementOf` (`kufiHit.ts`); `resolveKufiText`; `KufiLayoutInputs`; Task 1's `quality`.
- Produces:
  ```ts
  type Ok = Extract<KufiPackResult, { ok: true }>;
  export type KufiChange =
    | { kind: "form"; unitIndex: number; glyphId: string }
    | { kind: "stretch"; unitIndex: number; stretchIndex: number; counts: number[] };
  /** `edits` are what a commit saves (pinned as the canvas does); `result` null when it did not pack. */
  export type KufiTry = { change: KufiChange; edits: KufiPanelEdits; result: Ok | null };
  export type KufiArrangement = { change: KufiChange; edits: KufiPanelEdits; result: Ok; changedCells: number };
  export const KUFI_STRETCH_STEPS = [1, -1, 2, -2];
  export const KUFI_MAX_ARRANGEMENTS = 6;
  export function kufiChangesOf(text: string, current: Ok): KufiChange[];
  export function tryKufiChange(inputs: KufiLayoutInputs, current: Ok, change: KufiChange): KufiTry;
  export function pickArrangements(current: Ok, tries: KufiTry[], max?: number): KufiArrangement[];
  ```
- `kufiChangesOf` order: every unit's other forms first (unit order, table order), then every stretch slice at `KUFI_STRETCH_STEPS` in that order, unit by unit. A stretch count below `-(slice.min ?? 0)` is skipped. Base counts are `glyph.stretch.map((_, i) => placement.stretch[i] ?? 0)`, as `KufiPanelEditOverlay.beginStretch` does.
- `tryKufiChange` builds edits with `kufiFormEdits` / `kufiStretchEdits` on `inputs.edits`, calls `packKufiPanel({ ...inputs, edits, previous: current })`, and on ok returns `edits: kufiPinEdits(edits, result, unitIndex)`. A result with `editsBreakPacking` counts as not packed.
- `pickArrangements`: packed tries only; drop any whose `cells` equal `current.cells` or an earlier pick's; sort by `quality` (squares, then cut, then grow; missing last); among equal quality, greedy max of the smallest changed-cell count against `current` and every earlier pick. `changedCells` is the count against `current`.

- [ ] **Step 1: Write the failing tests** (`beforeAll(() => _internal.setClockOverride(Infinity))`, Baqarah 21×21 first draft as `current`):
  - `lists forms before stretches`: the first change is a `form`; no `form` follows a `stretch`.
  - `finds the feh's fitting form`: the try for `{ kind: "form", unitIndex: 4, glyphId: "feh.final.1" }` packs; `feh.final.0` and `feh.final.2` do not (facts from `e2e/kufi-panel.spec.ts`).
  - `finds the kaf's fitting stretch`: some stretch change on unit 2 packs, and its `edits.pinned[2].stretch` equals its `change.counts`.
  - `keeps existing edits`: with `inputs.edits = { forms: { 4: "feh.final.1" }, pinned: {...pin of 4} }`, a packed try on another unit still has `edits.forms[4] === "feh.final.1"`.
  - `picks distinct arrangements best first`: on synthetic tries (hand-built Ok results with set `cells` and `quality`), duplicates and the current panel are dropped, a `squares: 1` try ranks after every `squares: 0` try, and at most `max` come back.
- [ ] **Step 2: Run** `npx vitest run src/lib/kufi/kufiExplore.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** the four exports as specified.
- [ ] **Step 4: Run** — PASS; full verification loop.
- [ ] **Step 5: Commit** `feat(kufi): try every single form and stretch change against a packed panel`

---

### Task 3: Exploration worker and client

**Files:**
- Create: `src/lib/kufi/kufiExplore.worker.ts`, `src/lib/kufi/kufiExploreClient.ts`, `src/hooks/useKufiExplore.ts`
- Modify: `src/lib/kufi/kufiWorkerProtocol.ts` (explore message types and `runKufiExplore`)
- Test: `src/lib/kufi/kufiExploreClient.test.ts`

**Interfaces:**
- Consumes: Task 2's `kufiChangesOf`, `tryKufiChange`, `KufiTry`; `kufiLayoutKey`, `KufiLayoutInputs`.
- Produces:
  ```ts
  // kufiWorkerProtocol.ts
  export type KufiExploreRequest = { id: number; inputs: KufiLayoutInputs; current: Ok };
  export type KufiExploreResponse = { id: number; kind: "try"; try: KufiTry } | { id: number; kind: "done" };
  /** Runs the whole exploration, calling `send` after each try; stops at KUFI_EXPLORE_MAX_TRIES or KUFI_EXPLORE_BUDGET_MS. */
  export function runKufiExplore(req: KufiExploreRequest, send: (r: KufiExploreResponse) => void): void;
  export const KUFI_EXPLORE_MAX_TRIES = 120;
  export const KUFI_EXPLORE_BUDGET_MS = 12_000;
  // kufiExploreClient.ts
  export type KufiExploreState = { key: string; tries: KufiTry[]; done: boolean };
  export function exploreKufiPanel(inputs: KufiLayoutInputs, current: Ok): void;
  export function kufiExploreSnapshot(inputs: KufiLayoutInputs): KufiExploreState | null;
  export function subscribeKufiExplore(listener: () => void): () => void;
  export type KufiExploreWorkerLike = { postMessage(m: KufiExploreRequest): void; onmessage: ((e: { data: KufiExploreResponse }) => void) | null; onerror: ((e: unknown) => void) | null; terminate(): void };
  export function _setKufiExploreWorkerFactory(f: () => KufiExploreWorkerLike): void;
  export function _resetKufiExplore(): void;
  // useKufiExplore.ts
  export function useKufiExplore(inputs: KufiLayoutInputs, current: KufiPackResult | null): KufiExploreState | null;
  ```
- Client rules: one job at a time, on its own worker (never the pack worker). A request for a key already done or running is a no-op (cache by `kufiLayoutKey`, at most 16 entries, oldest dropped). A request for a new key terminates the running worker (the next request makes a fresh one) and discards its partial state; replies whose `id` is not the running job's are ignored. Without a `Worker` global the default factory runs `runKufiExplore` in-process on a timer, as the layout client does. The hook starts exploration only when `current?.ok` and the inputs key matches.
- The two caps were set for ~10 s on the Geekmini for Baqarah; measure once with the real worker and adjust the constants, noting the measurement in the commit message.

- [ ] **Step 1: Write the failing tests** with an injected fake worker (pattern: `kufiLayoutClient.test.ts`):
  - `streams tries into the snapshot and marks done`.
  - `one job per key`: two `exploreKufiPanel` calls for equal inputs post once.
  - `drops tries for inputs no longer wanted`: start A, start B; a late `try` with A's id leaves B's snapshot unchanged, and A's worker was terminated.
  - `runKufiExplore sends every try, then done` (call it directly on Baqarah with a stub `send`: `min(kufiChangesOf(...).length, KUFI_EXPLORE_MAX_TRIES)` `try` messages, then exactly one `done`, last).
- [ ] **Step 2: Run** `npx vitest run src/lib/kufi/kufiExploreClient.test.ts` — FAIL.
- [ ] **Step 3: Implement** protocol, worker (`self.onmessage = e => runKufiExplore(e.data, r => self.postMessage(r))`), client, hook.
- [ ] **Step 4: Run** — PASS; full verification loop.
- [ ] **Step 5: Commit** `feat(kufi): explore single changes in a worker of their own`

---

### Task 4: Arrangements strip

**Files:**
- Create: `src/components/sidebar/KufiArrangements.tsx`
- Modify: `src/components/sidebar/KufiPanelPanel.tsx`, `src/components/Sidebar.tsx`, `src/App.tsx` (wire `onApplyKufiEdits` to the existing `editKufiPanel`), the sidebar CSS file the Kufi panel classes live in, `src/components/guide/sections/kufi-panel.tsx`, `.claude/rules/kufi-panel.md`
- Test: `e2e/kufi-panel.spec.ts`

**Interfaces:**
- Consumes: Task 2 `pickArrangements`, `KufiArrangement`; Task 3 `useKufiExplore`; App's `editKufiPanel(id, fromKey, edits, result)`.
- Produces: `KufiPanelPanel` prop `onApplyEdits?: (fromKey: string, edits: KufiPanelEdits, result: Ok) => void`; `KufiArrangements` props `{ current: Ok; state: KufiExploreState | null; onApply: (a: KufiArrangement) => void }`.
- Copy (exact): heading `Arrangements`; while not done `Looking…`; done with none `No other arrangement fits this box`. Each thumbnail is a `<button>` with `aria-label="Arrangement N"` drawing its cells on a `<canvas>` (3 px per cell); the current panel shows first, marked `aria-pressed="true"`, label `Current arrangement`. Hovering a thumbnail outlines the cells that differ from the current panel.
- Renders nothing when the current result is not ok.

- [ ] **Step 1: Write the failing e2e tests** (use `openBaqarahPanel`):
  - `shows other arrangements and applies one in one undo step`: within 20 s at least one `Arrangement 1` button; click it; `panelEdits` becomes defined and the ink signature changes; Undo restores `panelEdits` to undefined and the original signature; the strip shows its options again without "Looking…" (cache hit).
  - `a panel that does not pack shows no arrangements`: Baqarah at 23×23 — no `Arrangements` heading, no `Looking…`.
- [ ] **Step 2: Run** `npm run e2e -- kufi-panel -g Arrangement` — FAIL.
- [ ] **Step 3: Implement** the component, wiring, styles; add the strip to the guide section and the rules file.
- [ ] **Step 4: Run** — PASS; full verification loop and the full kufi-panel e2e.
- [ ] **Step 5: Commit** `feat(kufi): a strip of other arrangements that fit the box`

---

### Task 5: The selected letter's options

**Files:**
- Create: `src/components/sidebar/KufiLetterOptions.tsx`
- Modify: `src/components/KufiPanelEditOverlay.tsx`, `src/components/KufiPanelView.tsx`, `src/components/CanvasStage.tsx`, `src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/sidebar/KufiPanelPanel.tsx`, `src/lib/kufi/kufiPull.ts`, guide section, rules file
- Test: `src/lib/kufi/kufiExplore.test.ts`, `src/lib/kufi/kufiPull.test.ts`, `e2e/kufi-panel.spec.ts`

**Interfaces:**
- Consumes: Task 3 `KufiExploreState`; Task 4 `onApplyEdits`.
- Produces:
  ```ts
  // kufiExplore.ts
  export type KufiLetterOptions = { forms: Array<{ glyphId: string; fits: boolean | null; try: KufiTry | null }>; stretch: Map<number, number[]> /* stretchIndex → counts that fit */ };
  /** Null `fits`: not tried yet. The current glyph is listed with fits: true and try: null. */
  export function kufiLetterOptions(text: string, current: Ok, state: KufiExploreState | null, unitIndex: number): KufiLetterOptions;
  // kufiPull.ts
  /** The nearest count in `fitting` to `wanted`, or `wanted` when `fitting` is null (not explored). */
  export function snapPull(wanted: number, fitting: number[] | null): number;
  ```
- App holds `kufiLetter: { blockId: number; unitIndex: number } | null`, set by a new overlay prop `onSelectLetter(unitIndex | null)` on a still click on a letter (and cleared on text, size or selection change). The sidebar shows `KufiLetterOptions` under the strip: each form as a small `<canvas>` of its glyph rows (`kufiGlyphById(id).rows`), fitting ones enabled, the current one `aria-pressed`, untried ones labelled `Checking…`, the rest disabled with title `Doesn't fit here`.
- The canvas still click now selects the letter and, when its options are known, applies the next fitting form in `kufiFormCycle` order from the explored try (no pack under the pointer); before they are known it keeps today's behaviour.
- Stretch handles: an end shows only if its `stretchIndex` has a fitting count (or exploration has not reached the unit). A drag commits `snapPull(count, fitting)`.

- [ ] **Step 1: Write the failing tests**: unit — `kufiLetterOptions` on Baqarah marks `feh.final.1` fitting and `feh.final.0` not for unit 4; `snapPull(3, [1, 2])` is 2, `snapPull(3, null)` is 3. e2e — `the selected letter lists its forms and only fitting ones apply`: click the feh, the sidebar lists 4 forms with exactly the fitting ones enabled; clicking `feh.final.1`'s preview sets `panelEdits.forms[4]`.
- [ ] **Step 2: Run** the unit and e2e tests — FAIL.
- [ ] **Step 3: Implement**; update the existing e2e "a click cycles its form" test only where the cycle now comes from exploration (same expected glyphs).
- [ ] **Step 4: Run** — PASS; full verification loop and full kufi-panel e2e.
- [ ] **Step 5: Commit** `feat(kufi): show a letter's forms and stretches that fit before trying them`

---

### Task 6: Visible tools and messages beside the letter

**Files:**
- Create: `src/components/sidebar/KufiToolRow.tsx`
- Modify: `src/components/KufiPanelEditOverlay.tsx`, `src/components/KufiPanelView.tsx`, `src/components/CanvasStage.tsx`, `src/App.tsx`, `src/components/sidebar/KufiPanelPanel.tsx`, `src/lib/kufi/kufiPanelStatus.ts`, guide section, rules file
- Test: `src/lib/kufi/kufiPanelStatus.test.ts`, `e2e/kufi-panel.spec.ts`

**Interfaces:**
- Produces: `export type KufiTool = "select" | "stretch" | "move" | "paint";` (in `kufiPanelBlock.ts`); App state `kufiTool` (default `"select"`, not saved with the project); overlay prop `tool: KufiTool`; `export const KUFI_NOTICE_MS = 2000;` in the overlay.
- Tool row: four `<button>`s labelled `Select`, `Stretch`, `Move word`, `Paint`, `aria-pressed` on the current one. The overlay shows only that tool's handles: Select — letter outline only; Stretch — every fitting stretch end of the hovered letter, full-cell targets; Move word — route handles; Paint — cell outline, click/drag paints. Alt paints from any tool, as today.
- A refusal or confirmation draws as a Konva label (`name="kufi-notice"`, EXPORT_HIDDEN) beside the letter's box, gone after `KUFI_NOTICE_MS`. The sidebar `notice` line is removed; App clears `kufiNotice` when any gesture starts.

- [ ] **Step 1: Write the failing tests**: e2e — `the tool row picks which handles show` (Select: no `kufi-stretch-handle` on hover; Stretch: at least one; Move word: a `kufi-route-handle` on a first letter); `a refusal shows beside the letter and fades` (Stretch tool, pull the full top line as the existing "No room to stretch" test does: a `kufi-notice` node appears, and is gone after 2.5 s; the sidebar has no "No room" text). Update existing overlay e2e tests to press the matching tool first; name each changed test in the commit body.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS; full verification loop and full kufi-panel e2e.
- [ ] **Step 5: Commit** `feat(kufi): visible editing tools, and messages beside the letter`

---

### Task 7: A box that doesn't fit still shows

**Files:**
- Modify: `src/components/KufiPanelView.tsx`, `src/components/CanvasStage.tsx`, `src/App.tsx`, guide section, rules file
- Test: `e2e/kufi-panel.spec.ts`

**Interfaces:**
- Consumes: `kufiPanelStatus`, `kufiSizeLabel`; App's `fitKufiPanelSize` and the size setter.
- Produces: `KufiPanelView` props `onFitPanel?: () => void`, `onSetPanelSize?: (s: { cols: number; rows: number }) => void` (passed only for the selected panel).
- When the result is not ok (or not arrived): a dashed frame at the box size in the panel's colour at 40% opacity, the status text centred, and — when selected — Konva buttons `Fit` and each suggestion `N×N`, all `EXPORT_HIDDEN` (the export still draws no ink for an unpacked panel). Hit area unchanged.

- [ ] **Step 1: Write the failing e2e test** `a box too big still shows its frame and a way back`: Baqarah at 23×23 — a node named `kufi-unfit-frame` exists with the box's size, a `21×21` canvas button (node name `kufi-unfit-size`) sets the size back; SVG export contains no path for the panel.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS; full verification loop and full kufi-panel e2e.
- [ ] **Step 5: Commit** `feat(kufi): show the box and its way back when the text doesn't fit`
