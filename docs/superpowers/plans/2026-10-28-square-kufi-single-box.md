# Square Kufi — single box — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `kufiPanel` block that packs typed text as square Kufi into a
W×H-cell box, with a calligrapher's editing tools on top.

**Architecture:** Pure modules under `src/lib/kufi/` (alphabet → words →
grid → packer), no HarfBuzz and no font. A Konva renderer draws one traced
outline. The work is split into two phases by a **user gate**. Phase A
builds the letter table and a throwaway packer spike, then the user picks
the look from pictures. Phase B builds the real packer and the block to
that choice.

**Tech Stack:** React 19, TypeScript, Konva/react-konva, Vitest, Playwright.
Spike scripts run with `npx --yes tsx` (the precedent is
`scripts/measureCurves.mjs`). Pictures are rendered with headless Edge.

**Spec:** `docs/superpowers/specs/2026-10-28-square-kufi-compositions-design.md`

## Global Constraints

- The block type is `"kufiPanel"`. Never `"squareKufi"`, which is in `REMOVED_BLOCK_TYPES`.
- Never reuse `kufiColumns`, `kufiComposition`, `kufiLineGap`, `kufiWordGap`, `kufiCellEdits` or `kufiCellEditMode`: they are in `REMOVED_BLOCK_FIELDS` and are stripped on load. New fields use a `panel` prefix.
- Lattice grammar: stroke = gap = one cell. No 2×2 of ink anywhere. A letter's ink is 4-connected. Joins and turns are single-cell runs.
- Letters change only by stretching or shortening a marked row or column in whole cells (never below the minimum), or by swapping to another authored form. Never by scaling.
- No tashkeel; harakat in the input are dropped silently. Dots and single squares may be placed as hole-filling (user "yes" 2026-10-28). Tall strokes may shorten at a marked row, never below the minimum.
- Canvas: no modes and no coloured dots; hover outlines and direct drags only.
- Never name the online studio, a teacher or a product in any committed file. The studio's material and the user's reference photos stay local or on the NAS.
- Pure `src/lib/kufi/*` must not import `./harfbuzz` (or anything that does).
- After any TS change, run `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`.
- Never merge to main. Stage only your own files. The pre-commit hook bumps `package.json`, which is expected. Code still under test stays uncommitted until its results justify committing.

## Review Focus

1. **Unsupported input** (Latin, digits, punctuation, harakat). The block renders what it can and lists unsupported characters in the panel. Harakat are dropped without a message. It never throws. → Task 3 test `resolveKufiText drops harakat and reports latin`.
2. **Empty or one-letter text.** No exception, nothing drawn, and the panel says the text is too short. → Task 5 test `empty and single-letter text return tooShort`.
3. **Long text** (300+ characters). The packer returns within 200 ms, either a layout or `ok:false` with suggestions, and never freezes the UI. → Task 5 test `300-char text returns within budget`.
4. **Editing the text after hand edits.** Edits whose letter still matches are kept. The rest are dropped, and none is applied to the wrong letter. → Task 5 test `text edit keeps matching edits and drops stale ones`.
5. **Old saves.** A project with a `squareKufi` block and `kufiColumns` still loads clean, and a new `kufiPanel` block with its `panel*` fields survives a save and load. → Task 6 test `legacy squareKufi dropped, kufiPanel round-trips`.

---

# Phase A: letters and a spike, ending in the user's choice

### Task 1: Grid primitives

**Files:**
- Create: `src/lib/kufi/kufiGrid.ts`
- Test: `src/lib/kufi/kufiGrid.test.ts`

**Interfaces:**
- Produces:
  - `type Turn = 0 | 1 | 2 | 3` (quarter turns clockwise)
  - `type Grid = { cols: number; rows: number; cells: Uint8Array }` (1 = ink, row-major)
  - `rotateRows(rows: string[], turn: Turn): string[]`
  - `inkBlocks2x2(grid: Grid): Array<[col: number, row: number]>`
  - `emptyBlocks2x2(grid: Grid): Array<[col: number, row: number]>` (the "packed" measure: 0 means no hole wider than a gap)
  - `isConnected4(rows: string[]): boolean`
  - `type Ring = [number, number][]`, `cellRings(cells: boolean[], cols: number, rows: number): Ring[]`

- [ ] **Step 1: Write the failing tests:**
  - `rotateRows(["#.","##"],1)` deep-equals `["##","#."]`, and four turns return the input;
  - `inkBlocks2x2` finds `[0,0]` in `["##","##"]` and nothing in `["#.","##"]`;
  - `emptyBlocks2x2` finds `[1,1]` in a 4×4 frame of ink with a 2×2 hole and nothing in a 3×3 frame;
  - `isConnected4(["#.",".#"])` is false;
  - `cellRings`: copy the old ring tests from `git show 2d3aeb1:src/lib/squareKufi.test.ts` (outer ring clockwise, i.e. positive shoelace in y-down screen space; holes counter-clockwise).
- [ ] **Step 2:** Run `npx vitest run src/lib/kufi/kufiGrid.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement. Copy `cellRings` and its helpers from `2d3aeb1:src/lib/squareKufi.ts` (lines 1191 onward) unchanged, along with the comment that explains the winding.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(kufi): lattice grid primitives`.

### Task 2: The letter table, from the studio's conventions

**Files:**
- Create: `src/lib/kufi/kufiAlphabet.ts`
- Test: `src/lib/kufi/kufiAlphabet.test.ts`
- Local only, never committed: `<scratchpad>/kufi/studio-forms/` (notes plus screenshots), backed up to NAS `harf scratch backup/kufi/`.

**Interfaces:**
- Consumes: `JoiningForm` from `src/lib/arabicJoining.ts`; `rotateRows`, `isConnected4`, `inkBlocks2x2` from Task 1.
- Produces:
  - `type KufiStretch = { axis: "row" | "col"; index: number }`. Repeating that row or column of the form's `rows` lengthens one stroke by one cell.
  - `type KufiGlyph = { id: string; rows: string[]; base: number; stretch: KufiStretch[] }` (`base` as in the old table: rows below the baseline)
  - `type SkeletonName` (the old table's names: `alef`, `beh`, `noon`, `yeh`, `jeem`, `dal`, `reh`, `waw`, `seen`, `sad`, `tah`, `ain`, `feh`, `qaf`, `kaf`, `lam`, `meem`, `heh`, `hamza`), plus `LigatureName = "lamAlef" | "allah"`
  - `KUFI_FORMS: Record<SkeletonName | LigatureName, Partial<Record<JoiningForm, KufiGlyph[]>>>` (index 0 is the default form; the rest are alternates)
  - `skeletonOf(cp: number): SkeletonName | null`
  - `stretchGlyph(g: KufiGlyph, counts: number[]): string[]` (`counts[i]` extra copies at `g.stretch[i]`)

- [ ] **Step 1: Collect the studio's forms (research, local).** In the user's Chrome on the Geekmini, open the square Kufi studio's Shahada, Kalima and Surah al-Asr lessons and the letter drill. For every letter, record each joining form and every alternate as `#` rows, and note which rows or columns stretch in the lesson pieces. Try `javascript_tool` on the lesson page first, since the composition data may sit in page state; fall back to screenshots. Keep the notes and images in the local folder above. Then compare against the old table (`git show 2d3aeb1:src/lib/squareKufiAlphabet.ts`) and list where it differs.
- [ ] **Step 2: Write the failing tests.** For every glyph of every form of every entry in `KUFI_FORMS`:
  - the rows are rectangular and non-empty;
  - `isConnected4` holds;
  - `inkBlocks2x2` is empty;
  - every stretch index is in range;
  - `stretchGlyph(g, [1,…])` and `[3,…]` still pass the three checks above;
  - joining forms keep ink at the baseline row's join columns (the old rule: a right join means ink at the rightmost column; a left join means ink at the leftmost).

  Also: `KUFI_FORMS.lamAlef` and `KUFI_FORMS.allah` exist, `ه`, `ك` and lam-alif have at least 2 glyphs in some form, and `skeletonOf(0x0628) === skeletonOf(0x062A)` (no dots, so they share a skeleton).
- [ ] **Step 3:** Run `npx vitest run src/lib/kufi/kufiAlphabet.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Author the table to the studio's conventions, starting from the old table where it agrees. Our own cell rows go in the commit; screenshots and notes don't. Keep the old module comment's two conventions, and update the baseline-join convention if the studio differs.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Render every glyph to one contact sheet (SVG to PNG via headless Edge), and look at it beside the studio screenshots before committing.
- [ ] **Step 7:** Commit: `feat(kufi): square Kufi letter table with alternates and stretch points`.

### Task 3: Text to letter units

**Files:**
- Create: `src/lib/kufi/kufiWords.ts`
- Test: `src/lib/kufi/kufiWords.test.ts`

**Interfaces:**
- Consumes: `classifyJoiningForms` (`src/lib/arabicJoining.ts`), `skeletonOf` and `KUFI_FORMS` (Task 2).
- Produces:
  - `type KufiUnit = { index: number; textOffset: number; key: string; skeleton: SkeletonName | LigatureName; form: JoiningForm; joinsNext: boolean; wordIndex: number }`. `key` is `` `${skeleton}:${form}` ``, used to anchor edits.
  - `resolveKufiText(text: string): { units: KufiUnit[]; unsupported: string[] }`

- [ ] **Step 1: Write the failing tests:**
  - `resolveKufiText("الله")` gives one unit with skeleton `allah`;
  - `"لا"` gives one unit, `lamAlef`;
  - `"لا يكلف الله نفسا إلا وسعها"` gives word indices 0 to 5 in order, with `joinsNext` false at each word end and after non-joining letters (ا, د, ر, و);
  - `resolveKufiText drops harakat and reports latin`: `"بِسمِ abc"` gives units for ب, س and م only, and `unsupported` equals `["a","b","c"]`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Ligatures are matched before single letters, and «الله» only as a whole word.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(kufi): resolve text into square Kufi units`.

### Task 4: Packer spike and the user's choice (THROWAWAY, ends in a gate)

**Files (none in `src/`; not committed until the gate passes):**
- Create: `scripts/kufi/spike.ts` (run: `npx --yes tsx scripts/kufi/spike.ts`)
- Output: `<scratchpad>/kufi/spike/*.png`, plus decision pictures in NAS `HarfCanvas side-by-side/decisions/`

- [ ] **Step 1:** Using Tasks 1 to 3, try three structures from the spec on three phrases at two or three box sizes each:
  - **(a)** rows joined by turns;
  - **(b)** rows plus one 90°-turned column down the right edge;
  - **(c)** words facing different edges.

  The phrases are «لا يكلف الله نفسا إلا وسعها», «الله» and the Shahada «لا إله إلا الله محمد رسول الله». Stretch only at marked points. Score each result by `emptyBlocks2x2` count and `inkBlocks2x2` count; both must be 0 to qualify.
- [ ] **Step 2:** Make one sheet per phrase: ours on the left, the reference on the right, one plain caption line, with the question written on it. The references are the user's Desktop photos and screenshots of the studio lessons. Check every sheet yourself at zoom first: no overlapping titles, no bad crops.
- [ ] **Step 3: GATE.** Show the user the sheets. Put each in the decisions folder numbered in viewing order, using a number range agreed with the other branches (propose 76–85; 16–51 and 60–75 are taken). Ask which structure reads right. Stop until they answer.
- [ ] **Step 4:** Record the user's choice in their own words in the spec under "Composition structure", and delete the decision pictures. If no structure is acceptable after three rounds of fixes, make a decision picture rather than a fourth guess.
- [ ] **Step 5:** Commit the spec update. The spike script itself is committed only if Task 5 builds on it.

---

# Phase B: the block, built to the chosen structure

### Task 5: The packer

**Files:**
- Create: `src/lib/kufi/kufiPack.ts`
- Test: `src/lib/kufi/kufiPack.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces:
  - `type KufiPlacement = { unitIndex: number; key: string; glyphId: string; col: number; row: number; turn: Turn; stretch: number[] }`
  - `type KufiCellEdit = { unitIndex: number; key: string; dx: number; dy: number; on: boolean }` (offsets from the unit's placed box, as in the old block)
  - `type KufiPanelEdits = { forms?: Record<number, string>; stretch?: Record<number, number[]>; routes?: Record<number, number>; pinned?: Record<number, KufiPlacement>; cells?: KufiCellEdit[] }`. Maps are keyed by unit index; a `routes` key is a word index, and its value is an integer offset along that word's path in the chosen structure. Any unit carrying an edit is pinned.
  - `type KufiPackResult = { ok: true; cols: number; rows: number; cells: Uint8Array; placements: KufiPlacement[] } | { ok: false; reason: "tooShort" | "tooLong" | "pinConflict"; suggestions: Array<{ cols: number; rows: number }> }`
  - `packKufiPanel(input: { text: string; cols: number; rows: number; edits?: KufiPanelEdits; previous?: KufiPackResult }): KufiPackResult`
  - `fitKufiPanel(text: string, edits?: KufiPanelEdits): { cols: number; rows: number }`
  - `reconcileEdits(edits: KufiPanelEdits, units: KufiUnit[]): KufiPanelEdits` (drops entries whose `key` no longer matches)

- [ ] **Step 1: Write the failing tests:**
  - For each spike phrase at its spike sizes: `ok` is true; `inkBlocks2x2` and `emptyBlocks2x2` are empty; reading order matches `units` order. Walking placements by `unitIndex` must give strictly increasing reading positions under the chosen structure.
  - `empty and single-letter text return tooShort`: `""` and `"ب"` give `ok:false`, `reason:"tooShort"`.
  - A box too small gives `tooLong` with at least 1 suggestion, and each suggestion packs `ok:true`.
  - **Pins:** pinning a unit at its placement and repacking keeps that placement identical. A pin that can't be honoured gives `pinConflict`, never a moved pin.
  - **Stability:** after adding `stretch[k]=[1]` with `previous`, every placement outside unit k's line or column is unchanged.
  - `300-char text returns within budget`: the Al-Baqarah phrase repeated to over 300 characters, in a box `fitKufiPanel` chose, returns in under 200 ms (measured with `performance.now()`).
  - `text edit keeps matching edits and drops stale ones`: edits on units 0 and 3; after changing the letter at unit 3, `reconcileEdits` keeps 0 and drops 3.
  - `fitKufiPanel` returns a size that packs `ok:true`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the structure the user chose in Task 4, starting from the spike's code. Cap any search with a budget constant, as the old block's `COLUMN_SWEEP_BUDGET` did, and measure before trusting it.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(kufi): square Kufi packer with pins and stable repack`.

### Task 6: The block, renderer, save and export

**Files:**
- Modify: `src/types.ts` (add `KufiPanelBlock` to `Block`)
- Modify: `src/lib/blockRenderProps.ts`, `src/lib/blockCapabilities.ts`, `src/components/CanvasStage.tsx`, `src/components/MirrorBlockView.tsx`, `src/components/sidebar/LayersPanel.tsx`
- Create: `src/components/KufiPanelView.tsx`
- Test: `src/lib/legacySaves.test.ts` (extend), `src/lib/blockRenderProps.test.ts` (extend), `e2e/kufi-panel.spec.ts`

**Interfaces:**
- Consumes: `packKufiPanel`, `reconcileEdits` (Task 5); `cellRings` (Task 1).
- Produces:
  - `type KufiPanelBlock = BlockCommon & { type: "kufiPanel"; panelCols: number; panelRows: number; panelEdits?: KufiPanelEdits }`
  - Cell size in px is `fontSize / 8` (the old `KUFI_CELLS_PER_EM = 8`, so the size slider works).
  - `useKufiPanelLayout(block): KufiPackResult`, memoised on `text`, `panelCols`, `panelRows` and `panelEdits`, never on the block object (the old block's per-frame lesson).

- [ ] **Step 1: Write the failing tests:**
  - `legacy squareKufi dropped, kufiPanel round-trips`: a payload with a `squareKufi` block carrying `kufiColumns`, plus a `kufiPanel` block with `panelCols`, `panelRows` and `panelEdits`, goes through `applyParsedLayoutPayload`. The first block is gone; the second is deep-equal to its input.
  - `blockRenderProps` maps `panelCols`, `panelRows` and `panelEdits` for a mirror.
  - e2e `kufi-panel.spec.ts`: add a Kufi panel, type «لا يكلف الله نفسا إلا وسعها», check the canvas has ink inside the block bounds (coarse pixel check, per `e2e-tests.md`), and check an SVG export contains exactly one `<path` for the block.
- [ ] **Step 2:** Run `npx vitest run src/lib/legacySaves.test.ts src/lib/blockRenderProps.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - `KufiPanelView` fills a single outline from `cellRings`, outline before fill, with `fill` through `createBlockFillPainter`;
  - `ok:false` draws nothing;
  - `blockCapabilities` excludes per-glyph font tools for `kufiPanel`, and Typography hides the font picker as the old block did.
- [ ] **Step 4:** Run the unit tests, then `npm run e2e -- kufi-panel`. Expected: PASS.
- [ ] **Step 5:** Run the full verification loop (Global Constraints).
- [ ] **Step 6:** Commit: `feat(kufi): kufiPanel block, renderer, saves and export`.

### Task 7: Sidebar panel and Add button

**Files:**
- Modify: `src/App.tsx` (`addKufiPanel`, `setKufiPanelSize`, `fitKufiPanelSize`, each starting with `pushHistory()`), `src/components/Sidebar.tsx`
- Create: `src/components/sidebar/KufiPanelPanel.tsx`
- Test: `e2e/kufi-panel.spec.ts` (extend)

**Interfaces:**
- Consumes: `fitKufiPanel`, `resolveKufiText`, `useKufiPanelLayout`.
- Produces: a panel titled **Kufi panel** (sidebar tier "selected", per `sidebar.md`) with width and height in cells, a **Fit** button, and a status line. The status line reads "Too short to fill a box", "Too long for W×H — try …" with each suggestion as a clickable size, "A pinned edit can't stay where it is at this size", and "Not drawn: a b c" for unsupported characters.

- [ ] **Step 1: Write the failing e2e tests:**
  - **Add**, then type the phrase and press **Fit**: the size fields change and the canvas has ink.
  - Set 3×3: the status shows "Too long", and clicking the first suggestion gives ink.
  - Type `abc`: the status shows "Not drawn: a b c".
- [ ] **Step 2:** Run `npm run e2e -- kufi-panel`. Expected: FAIL.
- [ ] **Step 3:** Implement. Width, height and Fit are one undo step each. A new block starts at `fitKufiPanel(text)`.
- [ ] **Step 4:** Run it. Expected: PASS. Then run the full verification loop.
- [ ] **Step 5:** Commit: `feat(kufi): Kufi panel sidebar and add button`.

### Task 8: Stretch and swap on the canvas

**Files:**
- Create: `src/components/KufiPanelEditOverlay.tsx`, `src/lib/kufi/kufiHit.ts`
- Test: `src/lib/kufi/kufiHit.test.ts`, `e2e/kufi-panel.spec.ts` (extend)

**Interfaces:**
- Consumes: `KufiPackResult`, `KufiPanelEdits`, `packKufiPanel` with `previous`.
- Produces:
  - `hitKufiUnit(result: KufiPackResult & { ok: true }, col: number, row: number): number | null`
  - `hitStretchEnd(result, placements, col, row): { unitIndex: number; stretchIndex: number } | null`. It returns a hit only on the end cell of a stroke that a stretch point lengthens.
  - The overlay is pointer-resolved: one listening node, like Next Shape's.

- [ ] **Step 1: Write the failing tests:**
  - `hitKufiUnit` returns the right unit for a cell of each of 3 placements and `null` for paper.
  - `hitStretchEnd` returns `null` on a non-stretchable stroke.
  - e2e: on the selected panel, hovering a letter outlines it, and a click cycles its form (the pixel hash changes, and a second full cycle restores it). Dragging a stretch end 2 cells shows a live preview; releasing makes one undo step, and undo restores the original.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - while dragging, call `packKufiPanel` with `previous` on each cell change for the preview, and commit on release;
  - the edited unit becomes pinned;
  - the hover outline uses the block's selection colour, with no handles except a small square at a stretchable end on hover.
- [ ] **Step 4:** Run it. Expected: PASS. Then run the full verification loop.
- [ ] **Step 5:** Commit: `feat(kufi): stretch strokes and swap letter forms on the canvas`.

### Task 9: Re-route words and paint cells

**Files:**
- Modify: `src/components/KufiPanelEditOverlay.tsx`, `src/lib/kufi/kufiHit.ts`
- Test: `src/lib/kufi/kufiHit.test.ts`, `e2e/kufi-panel.spec.ts` (extend)

**Interfaces:**
- Produces:
  - `hitWordStart(result, units, col, row): number | null` (the word index)
  - `routeOffsetFor(result: KufiPackResult & { ok: true }, wordIndex: number, col: number, row: number): number` (the path offset nearest the pointer cell under the chosen structure)
  - Cell painting is **Alt-click** to toggle a cell and **Alt-drag** to paint. Holding Alt shows a cell outline under the pointer. There is no armed mode. An edit is stored as a `KufiCellEdit` relative to the nearest unit's box.

- [ ] **Step 1: Write the failing tests:**
  - Dragging the first letter of word 2 along its path changes `routes[2]` and keeps words 0 and 1 in place.
  - Alt-clicking paper adds ink, and Alt-clicking that cell again removes it.
  - A painted cell survives a Fit that keeps the same letters.
  - A painted cell that would make a 2×2 is refused, and the cell outline flashes red for 300 ms. This is the one coloured cue, and it's transient.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expected: PASS. Then run the full verification loop.
- [ ] **Step 5:** Commit: `feat(kufi): re-route words and paint single cells`.

### Task 10: Docs and the user guide

**Files:**
- Create: `.claude/rules/kufi-panel.md` (with `paths:` for `src/lib/kufi/**`, `src/components/KufiPanel*.tsx`, `src/components/sidebar/KufiPanelPanel.tsx` and `e2e/kufi-panel.spec.ts`), plus `src/components/guide/sections/kufi-panel.tsx`
- Modify: `CLAUDE.md` (one line under Subsystem notes), `PROGRESS.md`, `.claude/rules/removed-subsystems.md` (a one-line pointer saying Square Kufi returned as `kufiPanel`), and the spec's future-plan section (mark single box shipped)

- [ ] **Step 1:** Write the rule note. Cover how the packer works, the user's structure choice, why the new names exist, edit anchoring, the 2×2 rules both ways, and the memo key.
- [ ] **Step 2:** Write the guide section for calligraphers, not developers.
- [ ] **Step 3:** Run the full verification loop and `npm run e2e`. Expected: all green.
- [ ] **Step 4:** Commit: `docs(kufi): Kufi panel subsystem note, guide and progress`.
