# Stroke Tarkib, Plan 1: the Phrase on a Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw أم أيمن الحب حياتي in HarfCanvas from pen strokes. A flat nib is swept along centre lines, each connected word is one continuous pen path with in-word stacking, and a stroke-opacity setting shows the strokes. The user reviews it in the app.

**Architecture:** Pure `src/lib/pen*.ts` modules do the work:
- the nib sweep, union and curve fitting;
- the stroke library, as JSON data in nuqta units;
- the joins and the word path;
- the layout on a line.

A new `tarkib` block type stores the phrase and its layout and redraws from them. `TarkibView` renders it like `MarkView`. Claude authors the library over the reference plates with a preview script, and the user approves it form by form in the app.

**Tech Stack:** TypeScript, React 19, Konva/react-konva, and Vitest. One new dependency: `polygon-clipping` for unions. A Python overlay for the preview, using cv2 and numpy as `scripts/marks/thuluth/*.py` does.

**Spec:** `docs/superpowers/specs/2026-10-19-stroke-tarkib-design.md`. Research: `docs/superpowers/specs/2026-10-19-stroke-tarkib-research.md`.

**Scope:** this plan covers the spec's milestones 1 and 2. Later plans each start after the user has judged this one:
- live editing (milestone 3);
- the teardrop composer (milestone 4);
- tashkil (milestone 5);
- the rest of the alphabet and retiring the old piece machinery (milestone 6).

## Global Constraints

**Branch and process**
- Work on branch `claude/curve-diacritics`. Never merge to `main` unless the user says so.
- The verification loop after any non-trivial change, in this order: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build`.
- Tests live beside the code (`src/lib/*.test.ts`).
- No browser tests by Claude. The user judges the canvas.
- The pre-commit hook bumps the version: expect `package.json` and `package-lock.json` in every commit.

**Units and data**
- Units: 48 per pen width (`PEN = 48`). 1 nuqta = 1.4 pens (`NUQTA = 1.4 * PEN` = 67.2 units). Block size goes through `fontSize` at 400 units per em (`MARK_UNITS_PER_EM`).
- Pen modules in `src/lib/pen*.ts` are pure and must not import `./harfbuzz`.
- Library data lives in JSON under `src/lib/penData/`. TypeScript never holds stroke coordinates.

**Credit, references and approval**
- The app never credits al-Baghdadi or the user's grandfather: no names in the UI, data or comments that ship.
- Reference plates live at `//monas/homes/monas/Mohammed/Calligraphy resources/plates/` (env `HARF_PLATES` overrides) and are never committed.
- The bought vector set may be used as a reference underlay. No outline of it is copied into `penData`.
- Nothing enters the library as approved without the user's word. Approval is recorded in `scripts/pen/REVIEW.md`.

**User-facing rules**
- The anti-goal: no visible joint anywhere.
- Resizing never changes the pen. Not used in this plan, but no API here may scale ink.
- Hide unsupported controls.
- Plain-language UI text. Thuluth's own terms are fine where the sidebar already uses them.

## Review Focus

1. **A phrase with a letter or form the library lacks:** the block must not throw. It shows the letters it can't draw yet (Task 5 test `reports the letters with no pen forms`).
2. **Typed vowels and shadda in the phrase** (أُمّ أَيْمَن): they are ignored for now (tashkil is a later plan) and the letters still draw (Task 5 test `draws the letters of a vowelled phrase`).
3. **A stroke written along its own nib direction** (a hairline of near-zero width): no throw, no NaN, and a thin but valid outline (Task 1 test `survives a stroke run along the nib`).
4. **Stroke opacity at the slider's ends:** the value is clamped to [0.1, 1], and absent means 1 (Task 6 test `clamps stroke opacity`).
5. **The geometry cost for the whole phrase:** it must stay below 250 ms in the test environment, so the later live-editing plan has headroom. The spec's first risk is to be measured early (Task 5 test `lays the first target out in under 250 ms`).

---

## File Structure

**Pen geometry**

| File | Responsibility |
|---|---|
| `src/lib/penSweep.ts` | A flat nib swept along a cubic path, to polygons. Also flattens drawn shapes. |
| `src/lib/penFit.ts` | Fits cubic Béziers to polygon rings, giving SVG commands. |
| `src/lib/penJoin.ts` | The G2 connecting cubic between two letters, and run assembly into one body stroke. |

**Library and layout**

| File | Responsibility |
|---|---|
| `src/lib/penLibrary.ts` | Types, constants, the loader and validator, and a form's strokes in units. |
| `src/lib/penData/parts.json`, `forms.json`, `joins.json` | The stroke library. |
| `src/lib/penLayout.ts` | Phrase to default layout, placement on a line, and block geometry (per-stroke and union commands). |

**In the app**

| File | Responsibility |
|---|---|
| `src/components/TarkibView.tsx` | Konva renderer for a `tarkib` block. |
| `src/components/sidebar/TarkibPanel.tsx` | The selected tarkib's panel, with the stroke-opacity slider. |
| `src/types.ts`, `src/App.tsx`, `src/components/CanvasStage.tsx`, `Sidebar.tsx`, `MirrorBlockView.tsx`, `sidebar/LayersPanel.tsx`, `lib/blockRenderProps.ts`, `lib/blockCapabilities.ts` | Wire the new block type. |

**Authoring and docs**

| File | Responsibility |
|---|---|
| `src/lib/penPreview.ts` | Builds the preview data: ink polygons in plate pixels. |
| `scripts/pen/preview.mjs`, `scripts/pen/overlay.py`, `scripts/pen/plates.json` | The authoring preview, run with tsx. |
| `scripts/pen/REVIEW.md` | The approval ledger. |
| `.claude/rules/tarkib.md`, `CLAUDE.md` | The subsystem note, and one index line. |

---

### Task 1: The nib sweep

**Files:**
- Create: `src/lib/penSweep.ts`
- Test: `src/lib/penSweep.test.ts`
- Modify: `package.json` (dependency `polygon-clipping@^0.15.7`)

**Interfaces:**
- Produces:
```ts
export type Pt = [number, number];
export type Ring = Pt[];                 // closed, no repeated last point
export type Polygon = Ring[];            // outer ring first, then holes
/** A node on a pen path. `angle`: the nib edge's angle in degrees from the
 *  baseline, counter-clockwise as the reader sees it (the y-down direction
 *  is (cos a, -sin a)). `width`: share of the pen in contact, 0..1 (1 when
 *  absent). `keep`: which end of the nib stays down when width < 1
 *  ("a" = the end at +direction, "b" = the other; centred when absent). */
export type NibNode = { p: Pt; angle: number; width?: number; keep?: "a" | "b" };
/** A pen path in units: a start node and cubic segments. */
export type PenPath = { start: NibNode; segs: { c1: Pt; c2: Pt; to: NibNode }[] };
export function sweepPath(path: PenPath, pen: number): Polygon[];
export function polygonArea(polys: Polygon[]): number;   // nonzero area, holes subtracted
export function unionPolygons(polys: Polygon[][]): Polygon[];
```
- The angle and width are interpolated linearly in the segment parameter `t`.

- [ ] **Step 1: Write the failing tests** in `src/lib/penSweep.test.ts`:
```ts
const node = (x: number, y: number, angle = 90, extra = {}): NibNode => ({ p: [x, y], angle, ...extra });
const line = (a: NibNode, b: NibNode): PenPath => ({ start: a, segs: [{ c1: lerp(a.p, b.p, 1/3), c2: lerp(a.p, b.p, 2/3), to: b }] });
it("sweeps a straight horizontal pull into a parallelogram of length x pen x sin(angle)", () => {
  // nib at 60 degrees, 300 units long, pen 48
  expect(polygonArea(sweepPath(line(node(0, 0, 60), node(-300, 0, 60)), 48))).toBeCloseTo(300 * 48 * Math.sin(Math.PI / 3), -1); // within 1%
});
it("draws a downstroke thin and a horizontal thick with the nib near vertical", () => {
  const down = polygonArea(sweepPath(line(node(0, 0, 80), node(0, 300, 80)), 48));
  const across = polygonArea(sweepPath(line(node(0, 0, 80), node(-300, 0, 80)), 48));
  expect(down / across).toBeLessThan(0.2);
});
it("sweeps a nib turning in place into two quarter discs", () => {
  // no travel, angle 0 -> 90: area = pi * pen^2 / 8
  const p: PenPath = { start: node(0, 0, 0), segs: [{ c1: [0, 0], c2: [0, 0], to: node(0, 0, 90) }] };
  expect(polygonArea(sweepPath(p, 48)) / (Math.PI * 48 * 48 / 8)).toBeGreaterThan(0.98);
  expect(polygonArea(sweepPath(p, 48)) / (Math.PI * 48 * 48 / 8)).toBeLessThan(1.03);
});
it("thins a pull written with a third of the nib, keeping the chosen end down", () => {
  const full = polygonArea(sweepPath(line(node(0, 0, 90), node(-300, 0, 90)), 48));
  const third = sweepPath(line(node(0, 0, 90, { width: 1/3, keep: "b" }), node(-300, 0, 90, { width: 1/3, keep: "b" })), 48);
  expect(polygonArea(third) / full).toBeCloseTo(1/3, 2);
  // "b" end down: the ink hugs the -direction side, i.e. y > 0 (below the centre line) for angle 90
  expect(Math.min(...third[0][0].map((q) => q[1]))).toBeGreaterThan(-1);
});
it("survives a stroke run along the nib", () => {
  const polys = sweepPath(line(node(0, 0, 0), node(-300, 0, 0)), 48);
  expect(polys.flat(2).every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))).toBe(true);
  expect(polygonArea(polys)).toBeLessThan(300 * 2);
});
it("sweeps a curve into one piece with no holes", () => {
  const p: PenPath = { start: node(0, 0, 70), segs: [{ c1: [-100, 120], c2: [-300, 120], to: node(-400, 0, 70) }] };
  const polys = sweepPath(p, 48);
  expect(polys).toHaveLength(1);
  expect(polys[0]).toHaveLength(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/penSweep.test.ts`
Expected: FAIL, "Failed to resolve import ./penSweep" (or `sweepPath is not a function`).

- [ ] **Step 3: Install and implement**

Run `npm install polygon-clipping@^0.15.7`, then implement in `src/lib/penSweep.ts`:
- `sweepPath` samples the path. Each step moves both nib ends by at most 1 unit: subdivide each segment adaptively, by `t` bisection on end displacement.
- Each consecutive pair of nib positions becomes a stamp: the convex hull of the four end points. This is the robust stamping the spec chose; the hull of a turning nib converges on the true sweep as steps shrink.
- `unionPolygons` unions all the stamps with `polygon-clipping`'s `union`. Pass them in one call; use a merge tree if a single call is slow.
- Drop collinear points within 1e-6.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/penSweep.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json src/lib/penSweep.ts src/lib/penSweep.test.ts
git commit -m "Pen: a flat nib swept along a cubic path, stamped and unioned"
```

### Task 2: Fitting curves to the ink

**Files:**
- Create: `src/lib/penFit.ts`
- Test: `src/lib/penFit.test.ts`

**Interfaces:**
- Consumes: `Ring` and `Polygon` from `penSweep.ts`; `SvgCmd` from `./svgPath`.
- Produces:
```ts
/** Cubic Béziers through a ring within `tol` units (max distance from any
 *  ring point to the fitted curve). Corners turning more than CORNER_DEG
 *  stay corners. Output: M, C... , Z commands. */
export const CORNER_DEG = 35;
export function fitRing(ring: Ring, tol: number): SvgCmd[];
export function fitPolygons(polys: Polygon[], tol: number): SvgCmd[];
```

- [ ] **Step 1: Write the failing tests**
```ts
it("fits a finely sampled circle within the tolerance, with few curves", () => {
  const ring: Ring = Array.from({ length: 720 }, (_, i) => [100 * Math.cos(i * Math.PI / 360), 100 * Math.sin(i * Math.PI / 360)] as Pt);
  const cmds = fitRing(ring, 0.25);
  expect(cmds.filter((c) => c.type === "C").length).toBeLessThanOrEqual(12);
  expect(maxDeviation(cmds, ring)).toBeLessThan(0.25);   // helper: sample each C at 64 steps, nearest ring distance both ways
});
it("keeps a square's four corners", () => {
  const sq: Ring = [...edge([0,0],[100,0]), ...edge([100,0],[100,100]), ...edge([100,100],[0,100]), ...edge([0,100],[0,0])]; // 25 points per edge
  const cmds = fitRing(sq, 0.25);
  expect(cornerCount(cmds, 80)).toBe(4);   // helper: turns > 80 deg between consecutive segment tangents
});
it("fits a swept stroke's outline within a quarter unit", () => {
  const polys = sweepPath({ start: { p: [0,0], angle: 70 }, segs: [{ c1: [-100,120], c2: [-300,120], to: { p: [-400,0], angle: 70 } }] }, 48);
  expect(maxDeviation(fitPolygons(polys, 0.25), polys[0][0])).toBeLessThan(0.25);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/penFit.test.ts`
Expected: FAIL (cannot resolve `./penFit`).

- [ ] **Step 3: Implement `fitRing`.** Split the ring at corners (turn > `CORNER_DEG`, measured over ±2 units). Fit each run with Schneider's algorithm (chord-length parameterisation, Newton reparameterisation, split at the worst point) to `tol`. A ring with no corners is fitted as one closed run starting at its leftmost point.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/penFit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/penFit.ts src/lib/penFit.test.ts
git commit -m "Pen: fit cubic curves back to the swept ink, corners kept"
```

### Task 3: The stroke library format

**Files:**
- Create: `src/lib/penLibrary.ts`, `src/lib/penData/parts.json`, `src/lib/penData/forms.json`, `src/lib/penData/joins.json`
- Test: `src/lib/penLibrary.test.ts`

**Interfaces:**
- Consumes: `NibNode`, `PenPath`, `sweepPath` (Task 1); `LetterForm` from `./tarkibText`.
- Produces:
```ts
export const PEN = 48;
export const NUQTA = 1.4 * PEN;
/** Default nib angle (degrees) where a node gives none. Measured off the plates; revisit with evidence. */
export const DEFAULT_ANGLE = 70;
// All library coordinates below are nuqta, y down, origin on the baseline at the form's right edge.
export type LibNode = { p: Pt; angle?: number; width?: number; keep?: "a" | "b" };
export type LibPath = { start: LibNode; segs: { c1: Pt; c2: Pt; to: LibNode }[] };
export type Part = { id: string; name: string; paths?: LibPath[]; drawn?: string[] };   // drawn: closed SVG path "d" strings
export type PlacedPart = { part: string; at: Pt; body?: true };
export type Form = {
  id: string;                      // e.g. "ya.starting.1"
  letter: string;                  // "ي", "أ" uses "ا" plus a hamza part
  form: LetterForm;
  parts: PlacedPart[];             // the body parts, in writing order, are concatenated into one path
  dots?: Pt[];                     // dot centres
  anchors: { above: Pt; below: Pt };
  stretch?: { seg: number; min: number; max: number }[];   // body segment index, extra nuqta
};
export type JoinDefault = { gap: number; rise: number };   // nuqta: leftward distance exit->entry, and upward climb
export type PenLibrary = { parts: Map<string, Part>; forms: Map<string, Form>; joins: Record<string, JoinDefault> };
export function loadPenLibrary(): PenLibrary;               // reads the three JSON files (static imports)
export function validateLibrary(lib: PenLibrary): string[]; // problems, empty when sound
/** A form's ink paths in units, placed at `at` (units): the body as one path, then the separate strokes. */
export function formPaths(lib: PenLibrary, formId: string, at: Pt): { body: PenPath | null; strokes: PenPath[]; drawn: Polygon[]; dots: PenPath[] };
export function formEntry(lib: PenLibrary, formId: string): { p: Pt; dir: Pt; angle: number } | null;   // units, at origin
export function formExit(lib: PenLibrary, formId: string): { p: Pt; dir: Pt; angle: number } | null;
```
- The dot path is the pen's stamp: a pull of one pen width along the nib's normal, at `DEFAULT_ANGLE`.
- The join key is `"<formIdA>><formIdB>"`, falling back to `"*"`.

- [ ] **Step 1: Write the failing tests**, using a two-form fixture library built in the test (not the JSON):
```ts
it("concatenates a form's body parts into one path in writing order", () => { /* two placed body parts meeting end-to-start -> body.segs.length = sum */ });
it("reports a body whose parts do not meet", () => { expect(validateLibrary(gapped)).toContain("ya.starting.1: body parts 1 and 2 do not meet"); });
it("reports a middle form with no exit", () => { expect(validateLibrary(noExit)).toContain("meem.middle.1: a middle form needs a body with an entry and an exit"); });
it("converts nuqta to units and fills the default angle", () => {
  const { body } = formPaths(fixture, "alif.standalone.t", [10, 0]);
  expect(body!.start.p).toEqual([10 + 0 * NUQTA, -7 * NUQTA]);
  expect(body!.start.angle).toBe(DEFAULT_ANGLE);
});
it("makes a dot the pen's own stamp: one pen pulled along the nib's normal", () => {
  const { dots } = formPaths(fixture, "ba.finishing.t", [0, 0]);
  expect(polygonArea(sweepPath(dots[0], PEN))).toBeCloseTo(PEN * PEN, -1);
});
it("ships a library that validates", () => { expect(validateLibrary(loadPenLibrary())).toEqual([]); });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/penLibrary.test.ts`
Expected: FAIL (cannot resolve `./penLibrary`).

- [ ] **Step 3: Implement `penLibrary.ts`** and create the three JSON files. `parts.json` and `forms.json` start as `[]`; `joins.json` is `{ "*": { "gap": 0.5, "rise": 0 } }`.
- Middle forms need an entry and an exit; starting forms an exit; finishing forms an entry. Standalone forms may have neither.
- Body parts meet within 0.01 nuqta.
- Every `part` id resolves.
- Every `drawn` string parses with `parseSvgPath`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/penLibrary.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/penLibrary.ts src/lib/penLibrary.test.ts src/lib/penData
git commit -m "Pen: the stroke library format — parts, forms, joins in nuqta units, validated"
```

### Task 4: Joins and the word as one pen path

**Files:**
- Create: `src/lib/penJoin.ts`
- Test: `src/lib/penJoin.test.ts`

**Interfaces:**
- Consumes: `formPaths`, `formEntry`, `formExit`, `JoinDefault`, `NUQTA` (Task 3); `PenPath`, `NibNode` (Task 1).
- Produces:
```ts
/** The connecting cubic from exit point P0 (direction t0, curvature k0) to entry point P3
 *  (direction t1, curvature k1), matching both curvatures where a positive solution exists (G2),
 *  else chord/3 handles (G1). */
export function joinCubic(p0: Pt, t0: Pt, k0: number, p3: Pt, t1: Pt, k1: number): { c1: Pt; c2: Pt; g2: boolean };
export type RunStrokes = { body: PenPath; strokes: PenPath[]; drawn: Polygon[]; dots: PenPath[]; origins: Pt[] };   // origins: each form's placement, units
/** A connected run: forms in reading order, joins between them (length forms-1). The first form sits at `at`. */
export function assembleRun(lib: PenLibrary, formIds: string[], joins: JoinDefault[], at: Pt): RunStrokes;
```
- Placement: form *k*+1's origin is set so its entry lands at form *k*'s exit + (−gap·NUQTA, −rise·NUQTA).
- The body path is A's body segments, then the `joinCubic` segment (nib angle interpolating from A's exit angle to B's entry angle), then B's body segments.

- [ ] **Step 1: Write the failing tests**
```ts
it("joins with matching direction and curvature at both ends", () => {
  const { c1, c2, g2 } = joinCubic([0, 0], [-1, 0], 0.004, [-200, -60], [-1, 0.3], -0.002);
  expect(g2).toBe(true);
  expect(curvatureAt([[0,0], c1, c2, [-200,-60]], 0)).toBeCloseTo(0.004, 4);
  expect(curvatureAt([[0,0], c1, c2, [-200,-60]], 1)).toBeCloseTo(-0.002, 4);
});
it("falls back to chord-thirds when no positive handles match the curvatures", () => { /* opposing extreme curvatures -> g2 false, |c1-p0| = chord/3 */ });
it("assembles a connected run into one body path with no corner at any join", () => {
  // fixture library: starting tooth -> middle -> finishing bowl
  const run = assembleRun(fixture, ["t.starting", "t.middle", "t.finishing"], [{ gap: 0.5, rise: 0 }, { gap: 0.3, rise: 1 }], [0, 0]);
  for (const k of joinNodes(run.body)) {           // helper: indices where a join segment starts/ends
    expect(turnDeg(run.body, k)).toBeLessThan(0.5);   // tangent continuity at the node
  }
});
it("climbs: a positive rise places the next letter higher", () => { /* origins[1][1] < origins[0][1] by rise*NUQTA relative to the flat case */ });
```
- Where a positive solution exists, the system below is solved for the handle lengths `a, b > 0` by Newton's method from `a = b = chord/3`, up to 30 iterations, tolerance 1e-9. Here `d = p3 − p0` and `c1 = p0 + a·t0`, `c2 = p3 − b·t1`:
  ```
  cross(t0, d) − b·cross(t0, t1) = 1.5·k0·a²
  cross(d, t1) − a·cross(t0, t1) = 1.5·k1·b²
  ```
  Accept the solution only if `a, b` lie in `[0.05·chord, chord]`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/penJoin.test.ts`
Expected: FAIL (cannot resolve `./penJoin`).

- [ ] **Step 3: Implement `joinCubic` and `assembleRun`.** Curvature at a path end comes from its own end segment: `k = 2·cross(c1−p0, c2−c1) / (3·|c1−p0|³)` at the start, and the mirror at the end.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/penJoin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/penJoin.ts src/lib/penJoin.test.ts
git commit -m "Pen: a word's letters joined into one pen path, curvature matched at every join"
```

### Task 5: The phrase laid out on a line

**Files:**
- Create: `src/lib/penLayout.ts`
- Test: `src/lib/penLayout.test.ts`

**Interfaces:**
- Consumes: `analyzePhrase`, `PhraseLetter` (`./tarkibText`); `assembleRun` (Task 4); `sweepPath`, `unionPolygons` (Task 1); `fitPolygons` (Task 2); `PenLibrary` (Task 3).
- Produces:
```ts
export type PenRun = { forms: string[]; joins: JoinDefault[]; hamza?: { index: number; side: "above" | "below" }[] };
export type PenLayout = { runs: PenRun[]; wordStarts: number[] };   // wordStarts: run index where each word begins
/** Default forms (first library form whose letter and form match; "أ" draws "ا" plus the hamza part)
 *  and joins (joins.json) for a phrase. */
export function defaultLayout(lib: PenLibrary, phrase: string): PenLayout | { missing: string[] };
export const RUN_GAP = 0.6;   // nuqta between runs of one word, ink to ink
export const WORD_GAP = 2;    // nuqta between words, ink to ink
/** Ink of a layout on a line, reading right to left from x = 0, baseline y = 0, in units. */
export function layoutGeometry(lib: PenLibrary, layout: PenLayout): { strokes: SvgCmd[][]; union: SvgCmd[]; bounds: { x1: number; y1: number; x2: number; y2: number } };
```
- `strokes` holds one entry per ink stroke, fitted at `tol` 0.25: each run's body, each separate stroke, each drawn part, each dot. `union` is the fitted union of all of them.
- `layoutGeometry` is memoised on `JSON.stringify(layout)`.
- A hamza (`PenRun.hamza`) draws the `hamza` part at the letter's `anchors.above` (or `.below`), as a separate stroke.

- [ ] **Step 1: Write the failing tests** (fixture library for structure; the shipped library for the first target, once Task 8 lands):
```ts
it("reports the letters with no pen forms", () => {
  expect(defaultLayout(emptyLib, "أم")).toEqual({ missing: ["ا", "م"] });
});
it("splits a phrase into runs at letters that do not join forward, words marked", () => {
  const l = defaultLayout(fixtureFull, "أم أيمن") as PenLayout;
  expect(l.runs.map((r) => r.forms.length)).toEqual([1, 1, 1, 3]);
  expect(l.wordStarts).toEqual([0, 2]);
});
it("draws the letters of a vowelled phrase", () => {
  expect(defaultLayout(fixtureFull, "أُمّ أَيْمَن")).toEqual(defaultLayout(fixtureFull, "أم أيمن"));
});
it("keeps runs and words apart by RUN_GAP and WORD_GAP, right to left", () => { /* run k+1's ink right edge = run k's ink left edge - gap*NUQTA */ });
it.skipIf(!shipped("أم أيمن الحب حياتي"))("lays the first target out in under 250 ms", () => {
  const t = performance.now();
  layoutGeometry(loadPenLibrary(), defaultLayout(loadPenLibrary(), "أم أيمن الحب حياتي") as PenLayout);
  expect(performance.now() - t).toBeLessThan(250);
});
```
`shipped(phrase)` is a test helper: true when `defaultLayout` on the shipped library returns no `missing`. Task 9 removes the `skipIf`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/penLayout.test.ts`
Expected: FAIL (cannot resolve `./penLayout`).

- [ ] **Step 3: Implement `defaultLayout` and `layoutGeometry`.**

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/penLayout.test.ts`
Expected: PASS (4 tests). The timing test is skipped until the library has the phrase.

- [ ] **Step 5: Commit**
```bash
git add src/lib/penLayout.ts src/lib/penLayout.test.ts
git commit -m "Pen: a phrase laid out on a line — default forms and joins, runs and words spaced, ink per stroke and as one"
```

### Task 6: The `tarkib` block in the app, with stroke opacity

**Files:**
- Modify: `src/types.ts` (`BlockType`, the `Block` union, and a new `TarkibBlock`)
- Create: `src/components/TarkibView.tsx`, `src/components/sidebar/TarkibPanel.tsx`
- Modify, following the `mark` block's path in each: `src/components/CanvasStage.tsx`, `src/components/MirrorBlockView.tsx`, `src/components/sidebar/LayersPanel.tsx`, `src/components/Sidebar.tsx`, `src/lib/blockRenderProps.ts`, `src/lib/blockCapabilities.ts`, `src/App.tsx`
- Test: `src/lib/penLayout.test.ts` (opacity helper), `src/lib/blockCapabilities.test.ts`

**Interfaces:**
- Consumes: `layoutGeometry`, `defaultLayout`, `PenLayout` (Task 5); `loadPenLibrary` (Task 3); `MARK_UNITS_PER_EM` (`./markLibrary`); `createBlockFillPainter`, `replayPath`.
- Produces:
```ts
// types.ts
export type TarkibBlock = BlockCommon & {
  type: "tarkib";
  /** Forms and joins chosen for `text`, the phrase as typed. */
  layout: PenLayout;
  /** Each stroke's opacity, 0.1..1; absent = 1 (one solid ink). */
  strokeOpacity?: number;
};
// penLayout.ts
export const STROKE_OPACITY_MIN = 0.1;
export function clampStrokeOpacity(v: number | undefined): number;   // undefined -> 1
```

**Rendering, in `TarkibView`, modelled on `MarkView`:**
- Units become px through `fontSize / MARK_UNITS_PER_EM`.
- At opacity 1 it fills `union` once with the block fill painter.
- Below 1, it fills each entry of `strokes` with `globalAlpha = strokeOpacity`.
- The outline (`strokeWidth > 0`) always strokes `union`, before the fill.
- Hits on the ink, with a 5 px margin, as `MarkView` does.

**In the app:**
- **The compose action:** `composeSelectedInThuluth` in `App.tsx` builds a `TarkibBlock` from `defaultLayout` instead of a stack. On `missing` it sets the status "No pen forms yet for: …".
- **The sidebar:** `TarkibPanel` shows the phrase, the line "Written with the pen from the stroke library", and a "Stroke opacity" slider (10–100%, step 5). The slider writes through `updateSelectedBlock` with `pushHistory`. Typography is hidden for a tarkib, as for a mark.
- **Layers:** a tarkib is named "Tarkib · <phrase>".

- [ ] **Step 1: Write the failing tests**
```ts
it("clamps stroke opacity", () => {
  expect(clampStrokeOpacity(undefined)).toBe(1);
  expect(clampStrokeOpacity(0)).toBe(0.1);
  expect(clampStrokeOpacity(1.4)).toBe(1);
  expect(clampStrokeOpacity(0.55)).toBe(0.55);
});
// blockCapabilities.test.ts
it("gives a tarkib no typography, kashida, alternates or diacritic tools", () => { /* each capability guard returns false for a TarkibBlock fixture */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/penLayout.test.ts src/lib/blockCapabilities.test.ts`
Expected: FAIL (`clampStrokeOpacity` not exported; the capability test fails to compile on `type: "tarkib"`).

- [ ] **Step 3: Implement the type, the view, the panel and the wiring.** `npx tsc --noEmit -p tsconfig.app.json` lists every exhaustive switch the new member breaks; handle each as `mark` is handled.

- [ ] **Step 4: Run the verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all clean. The test totals rise by the new tests.

- [ ] **Step 5: Commit**
```bash
git add src/types.ts src/components/TarkibView.tsx src/components/sidebar/TarkibPanel.tsx src/components/CanvasStage.tsx src/components/MirrorBlockView.tsx src/components/sidebar/LayersPanel.tsx src/components/Sidebar.tsx src/lib/blockRenderProps.ts src/lib/blockCapabilities.ts src/lib/blockCapabilities.test.ts src/lib/penLayout.ts src/lib/penLayout.test.ts src/App.tsx
git commit -m "Tarkib block: a phrase drawn with the pen, redrawn from its layout; stroke opacity shows the strokes"
```

### Task 7: The authoring preview and the plates

**Files:**
- Create: `src/lib/penPreview.ts`, `src/lib/penPreview.test.ts`, `scripts/pen/preview.mjs`, `scripts/pen/overlay.py`, `scripts/pen/plates.json`, `scripts/pen/REVIEW.md`

**Interfaces:**
- Consumes: `formPaths` (Task 3), `assembleRun` and `layoutGeometry` (Tasks 4–5), `sweepPath`.
- Produces:
```ts
/** Ink of forms or a phrase in a plate's pixels, for the overlay: per stroke polygons plus the
 *  form's centre line and nodes (for checking the path against the plate). */
export type PlateRef = { file: string; originPx: Pt; pxPerNuqta: number };
export function previewForms(lib: PenLibrary, formIds: string[], plate: PlateRef | null): { strokes: Pt[][][]; centre: Pt[][]; nodes: Pt[] };
```
- `scripts/pen/plates.json` maps form ids to a `PlateRef`. File names are relative to `HARF_PLATES`.

**The preview script:**
- Run `npx --yes tsx scripts/pen/preview.mjs <formId|phrase>... [--out DIR]`.
- It writes JSON and calls `python -I -X utf8 scripts/pen/overlay.py`.
- The overlay draws the plate (or a blank sheet), the ink at 50% in red, and the centre lines and nodes in blue. It saves a PNG per form, plus a phrase sheet.
- The default `--out` is `.superpowers/pen-preview/`, which git ignores.
- Before first use, copy the reference crops into `HARF_PLATES`: `books\f*.png`, `books\d*.png` and `meb_pages\*.png`, from this session's scratchpad (`C:\Users\mezud\AppData\Local\Temp\claude\C--Users-mezud-OneDrive-Desktop-arabic-calligraphy\1e0e7fb4-3a74-4cf5-ace4-79537f69b643\scratchpad\`).
- If the scratchpad is gone, re-render them from the PDFs in `//monas/homes/monas/Mohammed/Calligraphy resources/` (pages listed in the research notes) and from the MEB PDF (URL in the research notes).
- For a vector-set reference, the script draws the mark library's piece outline (`markLibraryData.ts`, by id) underneath in grey.

**The ledger:** `REVIEW.md` starts with one table, with columns form id | drafted | reference | user verdict | date.

- [ ] **Step 1: Write the failing test**
```ts
it("places a form's ink on its plate by origin and scale", () => {
  const p = previewForms(fixture, ["alif.standalone.t"], { file: "x.png", originPx: [500, 800], pxPerNuqta: 40 });
  const ys = p.strokes.flat(2).map((q) => q[1]);
  expect(Math.min(...ys)).toBeCloseTo(800 - 7 * 40, -1);   // a 7-nuqta alif rises 7*40 px above the origin
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/penPreview.test.ts`
Expected: FAIL (cannot resolve `./penPreview`).

- [ ] **Step 3: Implement** `penPreview.ts`, `preview.mjs`, `overlay.py`, `plates.json` (`{}`) and `REVIEW.md`. Copy the plates.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/lib/penPreview.test.ts`, then `npx --yes tsx scripts/pen/preview.mjs alif.standalone.t`. The second fails cleanly with "no form alif.standalone.t" until Task 8.
Expected: the test passes, and the script's error names the form.

- [ ] **Step 5: Commit**
```bash
git add src/lib/penPreview.ts src/lib/penPreview.test.ts scripts/pen
git commit -m "Pen: authoring preview — ink and centre lines over the reference plates; review ledger"
```

### Task 8: Authoring أم and أيمن, then the user's first look

**Files:**
- Modify: `src/lib/penData/parts.json`, `forms.json`, `joins.json`, `scripts/pen/plates.json`, `scripts/pen/REVIEW.md`
- Test: `src/lib/penData.test.ts` (create)

**Forms to author:**

| Form | Built from |
|---|---|
| `alif.standalone.1` | the drawn head tuft, then the stem |
| `meem.standalone.1` | the head loop, then the tail |
| `ya.starting.1` | the tooth |
| `meem.middle.1` | the head loop, entered and left on the body path |
| `nun.finishing.1` | the bowl, with 1 dot above |

Also `ya.starting.1`'s 2 dots below, and the `hamza` part for أ.

**Parts:** `alif-tuft` (drawn), `alif-stem`, `meem-loop`, `meem-tail`, `tooth`, `nun-bowl`, `hamza`.

**References:**
- Shapes: the main plates (books f9, f24–25, f27; Dha p4 ladders).
- Stroke order: MEB pp.72, 85, 87, 90.
- The vector set's ي, م and ن pieces as an underlay where the plates lack a joined form.

**Starting values, revised by eye against the plates:**
- `DEFAULT_ANGLE` 70.
- Alif height 6 nuqta on a line.

- [ ] **Step 1: Write the failing tests** in `src/lib/penData.test.ts`:
```ts
it("draws the standalone alif 5 to 8 nuqta tall", () => { /* ink bounds of alif.standalone.1 */ });
it("joins every join point of أيمن with no corner on the ink", () => {
  // the outline of layoutGeometry for "أيمن", flattened at 256 steps and read at 2-unit spacing, as tarkibChain.test.ts's
  // "leaves no corner where a bridge meets a letter": at each ink point within one pen of a join node, turn - max(neighbour turns) < 4 degrees
});
it("keeps the nib's own width: no body stroke wider than one pen across its direction", () => { /* sample body; width across the path <= PEN + 0.5 */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/penData.test.ts`
Expected: FAIL (no form `alif.standalone.1`).

- [ ] **Step 3: Author the parts and forms.** Iterate with `npx --yes tsx scripts/pen/preview.mjs <form>` and look at each PNG beside its plate, until the ink lies on the plate's ink. Add each to `REVIEW.md` as drafted, with its reference.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/penData.test.ts src/lib/penLibrary.test.ts`
Expected: PASS, including "ships a library that validates".

- [ ] **Step 5: Commit, then stop for the user's look**

```bash
git add src/lib/penData scripts/pen src/lib/penData.test.ts
git commit -m "Pen library: alif, meem, ya, nun and hamza for أم أيمن — drafts for the user's review"
```

Send the user three things:
- the preview PNGs of each form, and of أم أيمن at 25% stroke opacity and at 100%;
- a close-up of each join;
- the instruction: in the app, select a text block reading أم أيمن and use the Thuluth compose action.

**Wait for the user's verdict**, and record it per form in `REVIEW.md`. This is a deliberate stop, because the drafted shape sets the pattern for every later form. Fold fixes in, re-run step 4, and commit.

### Task 9: Authoring الحب and حياتي with in-word stacking, then the user's review

**Files:**
- Modify: `src/lib/penData/*.json`, `scripts/pen/plates.json`, `scripts/pen/REVIEW.md`, `src/lib/penData.test.ts`, `src/lib/penLayout.test.ts` (remove the `skipIf`)

**Forms to author:**
- `lam.starting.1` (stem, then the foot)
- `ha.middle.1` (the head bar, then the body)
- `ba.finishing.1` (the bowl, with 1 dot below)
- `ha.starting.1`
- `ya.middle.1`
- `alif.finishing.1`
- `ta.starting.1` (2 dots above)
- `ya.finishing.1` (the returning tail, 2 dots below)

**Parts:** `lam-stem`, `ha-head`, `ha-body`, `ba-bowl`, `ya-return`, and the shared tooth, stem and tuft.

**Joins in `joins.json`:**
- `lam.starting.1>ha.middle.1` climbs, setting the ح over the ل.
- `ya.middle.1>alif.finishing.1` gets its own gap.
- Add any pair whose default reads wrong on the plates.

**References:**
- Books f16–17 (initial ba/jim, arrows across connected letters), f26 (ha), f27 (final ya joins).
- MEB pp.73–74, 86, 89.
- The vector set's joined pieces for these pairs as underlays.

- [ ] **Step 1: Write the failing tests**
```ts
it("joins every join point of الحب and حياتي with no corner on the ink", () => { /* as Task 8 */ });
it("stacks the ح of الحب above the ل's foot", () => { /* ha.middle.1 origin y < lam.starting.1 origin y by at least 1 nuqta */ });
it("draws the whole first target", () => { expect(defaultLayout(loadPenLibrary(), "أم أيمن الحب حياتي")).not.toHaveProperty("missing"); });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/penData.test.ts`
Expected: FAIL (no form `lam.starting.1`).

- [ ] **Step 3: Author them** with the preview script, as in Task 8.

- [ ] **Step 4: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all clean. The timing test "lays the first target out in under 250 ms" now runs and passes. If it fails, record the measured time in the ledger as the spec's first risk, and tell the user. Do not loosen the bound silently.

- [ ] **Step 5: Commit, then stop for the user's review**

```bash
git add src/lib/penData scripts/pen src/lib/penData.test.ts src/lib/penLayout.test.ts
git commit -m "Pen library: lam, ha, ba, ta, ya and the finishing alif — the whole first target on a line, stacked in-word"
```

Send the user:
- the phrase at 100% and 25% stroke opacity;
- a close-up of every join;
- each new form beside its plate.

They review in the app. Record each verdict in `REVIEW.md`, fold the fixes in, and commit. **This is the spec's milestone 2, the user's named first milestone.**

### Task 10: The subsystem note

**Files:**
- Create: `.claude/rules/tarkib.md`, with `paths:` covering `src/lib/pen*.ts`, `src/lib/penData/**`, `src/components/TarkibView.tsx`, `src/components/sidebar/TarkibPanel.tsx`, `scripts/pen/**`
- Modify: `CLAUDE.md` (one index line under "Subsystem notes"), `PROGRESS.md` (one line and a pointer)

The note says:
- how the pen sweeps (stamped hulls, union, fit), and why;
- the units (48 per pen, nuqta = 1.4 pens) and the nib-angle convention;
- the library format, and that its data is JSON authored with the preview script and approved in `REVIEW.md`;
- joins as G2 cubics in one body path;
- that stroke opacity draws each stroke separately while the outline strokes the union;
- the traps: no `./harfbuzz` import; plates never committed; no credit to al-Baghdadi or the grandfather; `layoutGeometry` is memoised on the layout's JSON.

- [ ] **Step 1: Write the note and the index line.**
- [ ] **Step 2: Verify the note loads on a pen file**

Run: `grep -n "paths:" -A 6 .claude/rules/tarkib.md`
Expected: the globs listed above.
- [ ] **Step 3: Commit**
```bash
git add .claude/rules/tarkib.md CLAUDE.md PROGRESS.md
git commit -m "Docs: the stroke tarkib subsystem note"
```
