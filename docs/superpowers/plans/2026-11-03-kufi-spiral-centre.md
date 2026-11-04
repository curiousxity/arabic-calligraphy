# Kufi spiral centre: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `kufiPanel` block may put its text's last word alone in the panel's core (`panelCentre: true`), on its own line, upright or turned, with the bands packed round it; the words may start at the top right (`panelStart: "topRight"`); Fit tries the centre when today's pass finds nothing. Target: the Shahada with الله in the centre.

**Architecture:** An extension of `kufiPack.ts`, not a new packer. The core is reserved first: the last word is packed alone into a small box (`coreFinal`, the existing search on a one-line context whose frame rule also closes the box's corners), and that box is stamped into the panel's starting state at the panel's middle, `6k` cells in from each side for `k` rings. The band letters (the text minus its last word) then pack round it exactly as today, meeting the core as they meet any placed ink; the fill order (stretch, bars, squares) is the search's existing ranking. `panelStart` rotates which side template line 0 is. Everything stays pure, deterministic and work-bounded, in the worker.

**Tech Stack:** React 19 + TS, Konva, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-kufi-spiral-centre-design.md`, including "Settled after the builder check", which is binding.

## Global Constraints

- Panels with Centre off pack the same cells and placements as today; pinned by tests on الله 9×9, Al-Baqarah 21×21, سبحان الله 13×15, الله أكبر 9×13, نصر من الله 13×13 (Task 5). Old saves (no `panelCentre`, no `panelStart`) redraw unchanged: a missing field means off / bottom right.
- Grammar unchanged: stroke = gap = one cell, no 2×2 of ink, no empty 2×2, whole-cell stretch or authored alternates only, shafts rise together.
- Never mirror a letter: the core is placed on `lineOf` lines with the band rotations (0 or 90), never a reflection. Never stretch a heh's height: the centre-only الله form has a column slice on the heh's box only.
- New block fields are `panelCentre` (boolean) and `panelStart` (`"bottomRight" | "topRight"`); never a name in `REMOVED_BLOCK_FIELDS`. Only "Last word" in v1.
- Variable lap depth: every lap stays `BAND` = 5 unless Task 9's gate opens it. Centre off keeps `BAND` always.
- Centre letters take no pins, no Move word, no paint edits; edits aimed at them are dropped by the packer and never offered by the UI. Toggling Centre releases pins.
- Fit: pass 1 is today's, unchanged; pass 2 (centre on, start top right) runs only when pass 1 finds nothing, under its own budget. A block whose Centre is already on gets the centre pass alone, with its own start.
- Unit tests that assert a layout use `_internal.setClockOverride(Infinity)`; no wall-clock assertions.
- No teacher, calligrapher, channel, studio or product named in committed files; no reference PDFs or scans.
- Branch `claude/kufi-star`; never push or merge. Stage only changed files; never `.githooks/pre-commit`, `.gitignore`, `CLAUDE.md`, `.claude/settings.json`, `.claude/skills/`, `.mcp.json`, `scripts/kufi/*`.
- Run `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test` before every commit; e2e at the end (kufi-panel specs rerun alone on failure; `marks.spec` is a known failure).

## Review Focus

1. A one-word text with Centre on (محمد): no band letters. Expected: the packer packs as if Centre were off and the result carries no `centre`. Test in Task 5.
2. A size whose core is smaller than the word (الله at 15×15: core 3×3). Expected: `tooLong` with suggestions, never a crash or a mirrored/squashed word. Test in Task 5.
3. A save with pins on the last word's letters, then Centre switched on. Expected: those pins are ignored (no `pinConflict`), the rest hold. Test in Task 5.
4. A result without `centre` (an old cached result, a star region) drawn by the overlay. Expected: every unit is editable as before. Test in Task 7 (`kufiIsCentreUnit` on a result without `centre` is false).
5. Fit on a text that packs today. Expected: the same size as before this change and no `centre` in the answer, whatever the clock. Test in Task 6.

---

### Task 1: The fields and their plumbing

**Files:**
- Modify: `src/types.ts` (`KufiPanelBlock`), `src/lib/kufi/kufiPack.ts` (export `KufiPanelStart`), `src/lib/kufi/kufiWorkerProtocol.ts` (`KufiLayoutInputs`), `src/lib/kufi/kufiPanelBlock.ts` (`kufiPanelInputs`), `src/lib/kufi/kufiLayoutClient.ts` (`kufiLayoutKey`), `src/lib/blockRenderProps.ts`, `src/hooks/useKufiPanelLayout.ts`, `src/components/KufiPanelView.tsx`, `src/components/sidebar/KufiPanelPanel.tsx` (the `inputs` memo deps)
- Test: `src/lib/kufi/kufiPanelBlock.test.ts`, `src/lib/kufi/kufiLayoutClient.test.ts`

**Interfaces:**
- Produces: `export type KufiPanelStart = "bottomRight" | "topRight"` (kufiPack.ts). `KufiPanelBlock` gains `panelCentre?: boolean; panelStart?: KufiPanelStart`. `KufiLayoutInputs` gains `centre?: boolean; start?: KufiPanelStart`. `kufiPanelInputs(b)` copies them (undefined when absent). `kufiLayoutKey` appends `centre` and `start` only when set, so every key of a block without them is byte-identical to today's.

- [ ] **Step 1: Write failing tests**

```ts
// kufiPanelBlock.test.ts
it("inputs carry the centre and start fields, undefined when absent", () => {
  expect(kufiPanelInputs({ text: "الله", panelCols: 9, panelRows: 9 })).toEqual({ text: "الله", cols: 9, rows: 9, edits: undefined, centre: undefined, start: undefined });
  expect(kufiPanelInputs({ text: "الله", panelCols: 9, panelRows: 9, panelCentre: true, panelStart: "topRight" })).toMatchObject({ centre: true, start: "topRight" });
});
// kufiLayoutClient.test.ts
it("the layout key is unchanged for inputs without centre or start, and differs with them", () => {
  const base = { text: "الله", cols: 9, rows: 9 };
  expect(kufiLayoutKey(base)).toBe(JSON.stringify(["الله", 9, 9, null]));
  expect(kufiLayoutKey({ ...base, centre: false, start: "bottomRight" })).toBe(kufiLayoutKey(base));
  expect(kufiLayoutKey({ ...base, centre: true })).not.toBe(kufiLayoutKey(base));
  expect(kufiLayoutKey({ ...base, start: "topRight" })).not.toBe(kufiLayoutKey(base));
});
```

- [ ] **Step 2: Run them; expect failure** (`npx vitest run src/lib/kufi/kufiPanelBlock.test.ts src/lib/kufi/kufiLayoutClient.test.ts`).
- [ ] **Step 3: Add the type, the fields, `kufiPanelInputs`, `kufiLayoutKey` (`centre: false` and `start: "bottomRight"` are the defaults and count as unset), the render-props mapping, and the hook/view/panel memo dependencies.**
- [ ] **Step 4: Run tests, tsc, lint; expect pass.**
- [ ] **Step 5: Commit** `feat(kufi): panelCentre and panelStart fields, carried to the packer's inputs`.

---

### Task 2: A start corner in the packer

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts` (`Ctx.start`, `templateLine`, `apply`, `forMoves`, `reapply`, `makeCtx`, `packKufiPanel` input, `freshFinal` key)
- Test: `src/lib/kufi/kufiPack.test.ts`

**Interfaces:**
- Produces: `packKufiPanel(input: { ...; start?: KufiPanelStart })`. Internally `Ctx.start: 0 | 3` (`"topRight"` = 3: template line t lies on side `(t + start) % 4`, so the first line is the right side read downward, then bottom, left, top). Default 0 everywhere, so every existing path is unchanged.

- [ ] **Step 1: Write failing tests**

```ts
describe("panelStart", () => {
  it("bottom right is the default: the same cells as a pack without the field", () => {
    for (const [text, n] of [[ALLAH, 9], [BAQARAH, 21]] as const)
      expect(layoutOf(packKufiPanel({ text, cols: n, rows: n, start: "bottomRight" }))).toEqual(layoutOf(packKufiPanel({ text, cols: n, rows: n })));
  });
  it("top right starts the first word on the right side, read downward, and still packs", () => {
    const r = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, start: "topRight" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.placements[0].turn).toBe(3);
  });
});
```

- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement.** `templateLine(cols, rows, t, off, sides = 4, start = 0)`; replace the four `SIDE_ROT[... % ctx.sides]` and `reapply`'s `len` with `(t + ctx.start) % ctx.sides`; `makeCtx` takes `start`; `freshFinal`'s cache key includes it.
- [ ] **Step 4: Run the whole `kufiPack.test.ts`; expect pass (every pinned layout unchanged).**
- [ ] **Step 5: Commit** `feat(kufi): panelStart, the ring begun at the top right`.

---

### Task 3: The centre place and the 9×5 الله

**Files:**
- Modify: `src/lib/kufi/kufiAlphabet.ts` (`KufiPlace`, `allah.isolated.7`), `src/lib/kufi/kufiPack.ts` (`kufiFormsOf`, `lettersOf`)
- Test: `src/lib/kufi/kufiAlphabet.test.ts`, `src/lib/kufi/kufiPack.test.ts`

**Interfaces:**
- Produces: `KufiPlace = "panel" | "star" | "centre"`. `kufiFormsOf(unit, "centre")` = the unit's forms with no `only` plus those with `only: "centre"`. New glyph `allah.isolated.7`: rows `["###.#.#.#", "#.#.#.#.#", "###.#.#.#", "..#.#.#.#", "#.#######"]`, base 0, stretch `[{ axis: "col", index: 1 }]` (the heh's box widens; no row slice, so four equal uprights never read as اللله and the heh never grows taller), `parts: 2` (the bottom-left cell is the dot that stops an empty 2×2), `only: "centre"`. In `lettersOf`, `whole` (region semantics) is `place === "star"` alone.

- [ ] **Step 1: Write failing tests**

```ts
// kufiAlphabet.test.ts: whatever invariant loop runs over KUFI_FORMS must accept the new glyph (parts: 2); add
it("the centre الله is 9x5, a closed heh box on a stem, widening only through the box", () => {
  const g = glyphOf("allah.isolated.7");
  expect(g.rows.length).toBe(5); expect(g.rows[0].length).toBe(9); expect(g.only).toBe("centre");
  expect(g.stretch).toEqual([{ axis: "col", index: 1 }]);
});
// kufiPack.test.ts
it("the centre place takes the panel forms and the centre-only ones; panel and star lists are unchanged", () => {
  const u = resolveKufiText("الله").units[0];
  expect(kufiFormsOf(u).map((g) => g.id)).toEqual(["allah.isolated.0", "allah.isolated.1", "allah.isolated.2"]);
  expect(kufiFormsOf(u, "star").map((g) => g.id)).toEqual(["allah.isolated.3", "allah.isolated.5", "allah.isolated.6"]);
  expect(kufiFormsOf(u, "centre").map((g) => g.id)).toEqual(["allah.isolated.0", "allah.isolated.1", "allah.isolated.2", "allah.isolated.7"]);
});
```

- [ ] **Step 2: Run; expect failure.** **Step 3: Implement.** **Step 4: Run alphabet + pack tests; expect pass.**
- [ ] **Step 5: Commit** `feat(kufi): a centre place, and the Cairo 9x5 الله for it`.

---

### Task 4: The core: one word packed into a box

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts`
- Test: `src/lib/kufi/kufiPack.test.ts`

**Interfaces:**
- Produces (internal, exported through `_internal`): `coreFinal(text: string, units: KufiUnit[], cols: number, rows: number): Final | null` — `units` are the centre word's units (a suffix of the text's), packed on the box's bottom line alone (`nTpl` 1, `sides` 4, `start` 0, place `"centre"`, `Ctx.core = true`), cached by the units' keys and the box, `CORE_BUDGET_MS` = 300 work-bounded. In a core context the frame rule also holds at the four corners: an empty corner cell counts as a frame break in `edgeBreaks` and `partialScore`, since in the panel the gap ring round the core makes an empty corner a hole. `makeCtx` gains an options object `{ units?, place?, nTpl?, core?, start?, centre? }`.

- [ ] **Step 1: Write failing tests**

```ts
describe("coreFinal", () => {
  const units = resolveKufiText("الله").units;
  it("fills the Cairo 9x5 with the centre form, dot and all", () => {
    const f = _internal.coreFinal("الله", units, 9, 5);
    expect(f?.packed).toBe(true);
    expect(rowsOf(f!)).toEqual(["###.#.#.#", "#.#.#.#.#", "###.#.#.#", "..#.#.#.#", "#.#######"]);
  });
  it("widens through the heh's box to fill 11x5 and 13x5, and fills 9x7 with a panel form", () => {
    for (const [w, h] of [[11, 5], [13, 5], [9, 7]]) expect(_internal.coreFinal("الله", units, w, h)?.packed).toBe(true);
  });
  it("refuses a box the word cannot fill or does not fit", () => {
    expect(_internal.coreFinal("الله", units, 9, 4)?.packed ?? false).toBe(false);
    expect(_internal.coreFinal("الله", units, 7, 5)?.packed ?? false).toBe(false);
    expect(_internal.coreFinal("الله", units, 25, 5)?.packed ?? false).toBe(false);
  });
  it("packs a joined word (علي) into a box of its natural width and 5 rows, every corner inked", () => { /* measure the width in Task 8's script; assert packed and the four corner cells inked */ });
});
```
`rowsOf(f)` renders `f.owner` as `#`/`.` rows (a test helper).

- [ ] **Step 2: Run; expect failure.** **Step 3: Implement** `coreFinal`, `Ctx.core`, the corner rule, the cache (`cores: Map<string, Final | null>`, cleared by `clearCaches`). **Step 4: Run; expect pass.**
- [ ] **Step 5: Commit** `feat(kufi): coreFinal packs one word into a box whose corners close`.

---

### Task 5: The panel round a reserved core

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts`
- Test: `src/lib/kufi/kufiPack.test.ts`

**Interfaces:**
- Produces: `export type KufiCentre = { unitFrom: number; col: number; row: number; cols: number; rows: number; turn: Turn }`; the ok result gains `centre?: KufiCentre`. `packKufiPanel(input: { text; cols; rows; edits?; previous?; centre?: boolean; start?: KufiPanelStart })`. Internally: `CORE_RING = 2 * (BAND + 1)`; `coreBox(cols, rows, k) = { col: 6k, row: 6k, cols: cols - 12k, rows: rows - 12k }`; `centreOf(text, units, cols, rows): Centre | null` picks `k` = the most rings (≥ 1) whose core still holds the word's smallest box in either orientation, runs `coreFinal` for the upright box and for the turned one (box transposed), keeps the `better` of those that pack, and transforms its cells, placements and `Placed` entries into panel coordinates (upright: offset; turned: mini `(r, c)` → panel `(row + c, col + H - 1 - r)`, turn `+1`). `Ctx.centre: Centre | null`; `initState` stamps the centre's cells (owner, kind, letter, adj, hash) and starts `st.ids` after them; `ctx.letters` are the band units' letters only; `allPlaced(ctx, st)` feeds `barEnds` and `dotZone`; `Final.centre`; `placementsOf` appends the centre placements; `okResult` sets `centre`. Edits on centre units are dropped before packing (`forms`, `stretch`, `pinned`, `cells` with `unitIndex >= unitFrom`). `outOfRoom` is measured on the band text. A one-word text, or `centre` false, takes today's path exactly. Reasons: core smaller than the word → `tooLong`; core the word cannot fill → `tooShort`.

- [ ] **Step 1: Write failing tests**

```ts
describe("centre off is today's panel", () => {
  it.each([[ALLAH, 9, 9], [BAQARAH, 21, 21], ["سبحان الله", 13, 15], ["الله أكبر", 9, 13], [NASR, 13, 13]])("%s %dx%d", (text, cols, rows) => {
    const a = packKufiPanel({ text, cols, rows });
    expect(layoutOf(packKufiPanel({ text, cols, rows, centre: false, start: "bottomRight" }))).toEqual(layoutOf(a));
    if (a.ok) expect(a.centre).toBeUndefined();
  });
});
describe("a word in the centre", () => {
  it("one word with centre on packs as with it off", () => {
    expect(layoutOf(packKufiPanel({ text: ALLAH, cols: 9, rows: 9, centre: true }))).toEqual(layoutOf(packKufiPanel({ text: ALLAH, cols: 9, rows: 9 })));
  });
  it("a core smaller than the word is tooLong", () => {
    const r = packKufiPanel({ text: "محمد الله", cols: 15, rows: 15, centre: true });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toBe("tooLong");
  });
  it("محمد رسول الله packs with الله alone in the core, at the size Task 8 measures", () => {
    const r = packKufiPanel({ text: "محمد رسول الله", cols: W, rows: H, centre: true, start: "topRight" }); // W×H from Task 8
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.centre).toMatchObject({ unitFrom: 8, cols: r.cols - 12, rows: r.rows - 12, col: 6, row: 6 });
    expect([0, 1]).toContain(r.centre!.turn);
    expect(r.placements.map((p) => p.unitIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(emptyBlocks2x2(grid(r))).toBe(0); expect(inkBlocks2x2(grid(r))).toBe(0);
    // every centre cell is inside the core box, and the core's glyph cells match coreFinal's
  });
  it("pins, forms and painted cells on a centre letter are ignored, never a pinConflict", () => {
    const r = packKufiPanel({ text: "محمد رسول الله", cols: W, rows: H, centre: true, start: "topRight",
      edits: { pinned: { 8: { unitIndex: 8, key: "…", glyphId: "allah.isolated.0", col: 0, row: 0, turn: 0, stretch: [0, 0] } }, forms: { 8: "allah.isolated.2" } } });
    expect(r.ok).toBe(true);
  });
  it("never mirrors: every placement's turn is 0..3 from a rotation, and the centre word reads with its line", () => { /* centre placements' turn equals centre.turn (or +2 after a U-turn) */ });
});
```

- [ ] **Step 2: Run; expect failure.** **Step 3: Implement** as in Interfaces; thread `centre`/`start` through `freshFinal` (key), `packPinned`, `repack`, `suggestions`, `rankByGreedy`. **Step 4: Run the full `kufiPack.test.ts`; expect pass (the measured size fills in after Task 8; until then the two size-dependent tests are `it.skip` with a note).**
- [ ] **Step 5: Commit** `feat(kufi): the last word in the centre, bands packed round a reserved core`.

---

### Task 6: Fit's second pass

**Files:**
- Modify: `src/lib/kufi/kufiPack.ts` (`fitKufiPanel`), `src/lib/kufi/kufiWorkerProtocol.ts`, `src/lib/kufi/kufiLayoutClient.ts` (`requestKufiFit`), `src/App.tsx` (`fitKufiPanelSize`)
- Test: `src/lib/kufi/kufiPack.test.ts`, `src/lib/kufi/kufiLayoutClient.test.ts`

**Interfaces:**
- Produces: `export type KufiFitResult = { cols: number; rows: number; centre?: true; start?: KufiPanelStart }`; `fitKufiPanel(text, edits = {}, opts: { centre?: boolean; start?: KufiPanelStart } = {}): KufiFitResult`. With `opts.centre` false: pass 1 exactly as today, then, only when it fails, pass 2 over `centreSizes(units)` with centre on and start `"topRight"`, bounded by `FIT_CENTRE_BUDGET_MS` = 9000 on the clock and `FIT_CENTRE_MAX_SIZES` = 12 under the override; a success returns `{ cols, rows, centre: true, start: "topRight" }`. With `opts.centre` true: the centre pass alone, with `opts.start ?? "bottomRight"`. `centreSizes(units)`: for `k` in 1..2 and both orientations, every panel `(W + 12k) × (H + 12k)` whose core the word may take (`W` from the word's authored width to that plus `COL_MAX` per column slice; `H` from its shortest to its tallest form), ranked by `rankByGreedy` with the centre reserved. Worker: the fit request carries `centre?`/`start?`, the response's `size` is a `KufiFitResult`; `requestKufiFit(text, edits, opts)` resolves one; App writes `panelCentre`/`panelStart` with the size when present (one undo step).

- [ ] **Step 1: Write failing tests**

```ts
it("Fit on a text that packs today gives today's size and no centre", () => {
  expect(fitKufiPanel(BAQARAH)).toEqual({ cols: 21, rows: 21 });
  expect(fitKufiPanel("الله أكبر")).toEqual({ cols: 9, rows: 13 });
});
it("Fit falls back to the centre for محمد رسول الله and says so", () => {
  const r = fitKufiPanel("محمد رسول الله");
  expect(r.centre).toBe(true); expect(r.start).toBe("topRight");
  expect(packKufiPanel({ text: "محمد رسول الله", cols: r.cols, rows: r.rows, centre: true, start: "topRight" }).ok).toBe(true);
});
it("with centre already on, Fit keeps it and the block's start", () => {
  const r = fitKufiPanel("محمد رسول الله", {}, { centre: true, start: "bottomRight" });
  expect(r).toMatchObject({ centre: true, start: "bottomRight" });
});
// kufiLayoutClient.test.ts: requestKufiFit resolves the worker's KufiFitResult unchanged (centre: true carried)
```

- [ ] **Step 2: Run; expect failure.** **Step 3: Implement.** **Step 4: Run; expect pass; tsc; lint.**
- [ ] **Step 5: Commit** `feat(kufi): Fit tries a word in the centre when nothing else packs`.

---

### Task 7: Sidebar, overlay and exploration

**Files:**
- Modify: `src/components/sidebar/KufiPanelPanel.tsx` (two `SelectRow`s: **Centre word** Off / Last word; **Start** Bottom right / Top right; prop `onPatch: (patch: Partial<KufiPanelBlock>) => void`), `src/components/Sidebar.tsx` (wire `onPatch` to `updateSelectedBlock` with one history step), `src/lib/sidebarHints.ts` (entries for both labels), `src/lib/kufi/kufiPanelBlock.ts`, `src/components/KufiPanelEditOverlay.tsx`, `src/lib/kufi/kufiExplore.ts`, `src/lib/kufi/kufiHit.ts`
- Test: `src/lib/kufi/kufiPanelBlock.test.ts`, `src/lib/kufi/kufiExplore.test.ts`, `src/lib/kufi/kufiHit.test.ts`, `e2e/kufi-panel.spec.ts`

**Interfaces:**
- Produces: `kufiCentrePatch(b: { panelCentre?: boolean; panelEdits?: KufiPanelEdits }, centre: boolean): Partial<KufiPanelBlock>` — `{ panelCentre }` (undefined when false) plus `panelEdits: kufiReleasePins(b.panelEdits)` whenever the value changes (toggling clears the pins, as a size change does). `kufiIsCentreUnit(result: Ok, unitIndex: number): boolean` (false without `result.centre`) in `kufiHit.ts`; `hitStretchEnd`, `hitRouteHandle`, `hitKufiUnit`'s callers in the overlay skip centre units (no hover outline, no handles, no pick, no paint on their cells: a press there is not claimed); `kufiChangesOf` lists no change for a centre unit; `kufiLetterOptions` on a centre unit lists its drawn form alone.

- [ ] **Step 1: Write failing tests**

```ts
// kufiPanelBlock.test.ts
it("switching the centre releases pins and routes, keeps forms, stretch and cells", () => {
  const edits = { pinned: { 0: pin }, routes: { 0: 2 }, forms: { 1: "x" }, stretch: { 2: [1] }, cells: [cell] };
  expect(kufiCentrePatch({ panelEdits: edits }, true)).toEqual({ panelCentre: true, panelEdits: { forms: { 1: "x" }, stretch: { 2: [1] }, cells: [cell] } });
  expect(kufiCentrePatch({ panelCentre: true, panelEdits: edits }, true)).toEqual({});
  expect(kufiCentrePatch({ panelCentre: true }, false)).toEqual({ panelCentre: undefined, panelEdits: undefined });
});
// kufiHit.test.ts
it("kufiIsCentreUnit is false without a centre, true from unitFrom on", ...);
// kufiExplore.test.ts
it("lists no change for a centre unit", ...); // on the Task 8 fixture result
// e2e/kufi-panel.spec.ts
test("Centre word: Last word packs «محمد رسول الله» with the last word in the middle and draws it", async ({ page }) => {
  // add a panel, set the text, choose Centre word → Last word, set the size Task 8 measured, expect ink and no status text; Start → Top right keeps it drawn
});
```

- [ ] **Step 2: Run unit tests; expect failure. Step 3: Implement.** The overlay reads `result.centre` from the committed result; the Start select is always shown. **Step 4: Run unit tests, tsc, lint, `npx tsc --noEmit -p e2e/tsconfig.json`.**
- [ ] **Step 5: Commit** `feat(kufi): Centre word and Start in the sidebar; centre letters take no edits`.

---

### Task 8: Measure, render, pin

**Files:**
- Scratchpad only: `C:\Users\Mo\AppData\Local\Temp\claude\C--Users-Mo-OneDrive-Desktop\665d7bbb-2122-4b66-aa94-2fb40f8588f4\scratchpad\fable-spiral\` (`run.sh`, `spiral.ts`, `draw.py` copied from `fable-octagon4`)
- Modify: `src/lib/kufi/kufiPack.test.ts` (fill the measured sizes into Task 5–7's tests; un-skip)

- [ ] **Step 1: Script** `spiral.ts`: for each target text (`لا إله إلا الله محمد رسول الله`, `محمد رسول الله`, `محمد أبو بكر عمر عثمان علي`), run `fitKufiPanel` (clock override, work-bounded) and `packKufiPanel` over `centreSizes` for both starts; print per size packed / reason / time / quality, and write each packed panel's cell quads as JSON for `draw.py`.
- [ ] **Step 2: Render** every packed panel to PNG (`<text>-<cols>x<rows>-<start>.png`), plus `before-` (centre off, best failing attempt drawn by its cells with holes tinted, as `render.mjs` in `shahada-spike` does) and `after-` for one text that newly packs. Look at every PNG.
- [ ] **Step 3: Tune within reason** (`centreSizes` order, `CORE_BUDGET_MS`, the `W`/`H` ranges) — at most a few rounds; keep the work cap. Record the measurement either way.
- [ ] **Step 4: Pin** the measured sizes in the tests from Tasks 5–7 and run the full unit suite.
- [ ] **Step 5: Commit** `test(kufi): the measured centre panels pinned`.

---

### Task 9 (gate): shallower laps

Only if Task 8 leaves the Shahada unpacked at every lap depth 5 within the work cap. Then: a one-day bounded attempt at a per-ring depth of 3 or 4 holding only pieces whose authored forms fit it (the spike's `lineDep`/`depthOf` shape in `kufiPack-spike.diff`), searched only with Centre on. If it does not pack the Shahada inside that effort, or costs the existing panels any change, it is dropped and recorded. If Task 8 packs the Shahada, this task is skipped and variable depth is recorded as deferred.

---

### Task 10: Documentation

**Files:**
- Modify: `.claude/rules/kufi-panel.md` (a "A word in the centre" section: how the core is reserved, the centre place and the 9×5 form, the corner rule, Fit's second pass, `panelStart`, the fixed centre letters; Known gaps updated with the measurement and what the Shahada does), `src/components/guide/sections/kufi-panel.tsx` (a paragraph on Centre word and Start, and one picture: the Task 8 render of محمد رسول الله or the Shahada embedded as an inline SVG of its cells, in the section's existing picture style), `.claude/rules/deferred-features.md` (variable lap depth; "Last two words"; words bending round a corner; the four-way pinwheel), `PROGRESS.md` one line pointing at the rules note.

- [ ] **Step 1: Write the sections.** No teacher, calligrapher, channel, studio or product named.
- [ ] **Step 2: Run the full unit suite, tsc, lint, e2e (`npm run e2e`; rerun kufi-panel failures alone).**
- [ ] **Step 3: Commit** `docs(kufi): a word in the centre: how it works, what packs, what is deferred`.

---

## Outcome (2026-11-04)

Built as planned through Task 7 and Task 10, with these departures:

- **Task 3:** the centre place takes the **star forms and the centre-only
  ones** (الله: `.3`, `.5`, `.6` and the 9x5 `.7`), not the panel forms:
  the panel forms' row slice runs through the heh's walls, and a heh may
  widen only. `.7` has no stretch (widening its box opens a hole between the
  dot and the stem).
- **Task 4:** علي fills no core up to 17x9 (letters of different heights);
  محمد fills 15x5. Pinned as measured.
- **Task 5 / 8:** the fixture is `لا إله إلا الله لا إله إلا الله` at 21x17
  (both starts); محمد رسول الله is `tooShort` at every size (two band words
  cannot fill a ring). **The Shahada does not pack at any of its 130 centre
  sizes from either corner**: محمد and رسول have no tall letter, and a band
  that stops short of its depth is closed by the next ring in a plain panel
  and by nothing round a fixed core (see kufi-panel.md, "A word in the
  centre", Measured).
- **Task 9:** skipped. A shallower lap would not close the Shahada's bands
  either (its sides mix tall and short letters); what would is tall
  alternates for the short letters, recorded in deferred-features.md.
- **Task 6:** Fit's centre pass has `FIT_CENTRE_BUDGET_MS` = 9000 of its
  own and `FIT_CENTRE_MAX_SIZES` = 12 under the override; لا إله إلا الله
  twice fits at 17x24, top right.
