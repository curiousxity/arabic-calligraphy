# Stack Editor Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all editing of a stacked composition into a modal editor window that shows the composition with the real renderer, explains the gestures, offers teardrop and almond templates, and commits its staged edits on Done.

**Architecture:** A pure `stackDraft.ts` holds the draft type and every mutation the window performs (patch, bend, split, free a curve, reset, arrange, measure, fit), so the dialog is thin and the logic is Vitest-covered. `StackEditorDialog.tsx` is a portaled modal with its own Konva `Stage`, rendering the draft through the existing `StackView` + `StackEditOverlay`, with an editor-local undo stack built on the existing `useUndoRedo`. `App.tsx` keeps only open/close/commit; the five on-canvas stack mutators, the arrange handler and Reset leave it, and `CanvasStage` stops mounting the overlay.

**Tech Stack:** React 19, TypeScript, react-konva, Vitest (unit, `src/lib/*.test.ts`), Playwright (e2e, `e2e/*.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-10-15-stack-editor-window-design.md`

## Global Constraints

- `src/lib/stackDraft.ts` and `src/lib/stackTemplates.ts` must never import `./harfbuzz` (Vitest cannot load it). Font loading stays in `App.tsx` behind the `loadFillers` prop.
- The gesture model inside the window is unchanged: `StackEditOverlay` is reused as is. No new handles, dots, or mode switches.
- Nothing that is not artwork lives in the main Konva stage; the dialog is portaled to `document.body`.
- Edits are staged: the main canvas's block changes only on Done, as one history step, and only if the draft changed.
- Templates never add a block to the canvas and never move the block; only a canvas guide moves the block (on Done).
- Button labels are e2e selectors: `Edit composition`, `Done`, `Cancel`, `Fit view`, `Reset layout`, `Undo`, `Redo`, template cards `Free`, `Teardrop`, `Almond`. Do not rename them without updating `e2e/`.
- Verification order after any non-trivial change: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build`, then `npm run e2e` for tasks that touch e2e.
- `package.json` / `package-lock.json` appear in every commit diff (pre-commit version bump); that is expected.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc
  ```

## Review Focus

1. **Font load finishes after the user picked a different card.** The arrange must apply the *current* choice, not the stale one. Test in Task 2 (`arrange token` is in the dialog, so pinned by the e2e "second pick wins" test in Task 5).
2. **A composition that fills its whole frame cannot be grabbed.** Fit must leave the margin so the tilt ring just outside the ink is reachable. Pinned by `fitTransform` test in Task 2.
3. **Done with no change must not add a history step** (otherwise every open/close pollutes undo). Pinned by `draftChanged` test in Task 2 and the e2e Escape test in Task 5.
4. **A rotated block.** The main canvas block may carry a rotation; the fit must use the rotated ink bounds or the composition hangs off the frame's edge. Pinned by `fitTransform` rotation test in Task 2.
5. **A guide card whose guide is not closed** (an open pen guide) must not appear. Pinned by the Sidebar filter already used today (`isClosedPath`), carried into App's `closedGuides` in Task 4; e2e in Task 5 asserts only closed guides are listed.

---

### Task 1: `stackTemplates.ts` — template polygons sized to the ink

**Files:**
- Create: `src/lib/stackTemplates.ts`
- Test: `src/lib/stackTemplates.test.ts`

**Interfaces:**
- Consumes: `guidePathD`, `GUIDE_DEFAULTS`, `containerPolygon` from `./guideShapes`; `parseSvgPath` from `./svgPath`.
- Produces:
  ```ts
  export type StackTemplate = "teardrop" | "almond";
  export const STACK_TEMPLATES: readonly StackTemplate[];
  export function templatePolygon(t: StackTemplate, inkHeightPx: number, sizeFactor: number): Array<[number, number]>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stackTemplates.test.ts
import { describe, it, expect } from "vitest";
import { STACK_TEMPLATES, templatePolygon } from "./stackTemplates";
import { GUIDE_DEFAULTS } from "./guideShapes";

const bounds = (poly: Array<[number, number]>) => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of poly) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
};

describe("templatePolygon", () => {
  it("lists teardrop and almond", () => {
    expect(STACK_TEMPLATES).toEqual(["teardrop", "almond"]);
  });

  it.each(STACK_TEMPLATES)("%s: closed polygon, centred on the origin, height = ink height × factor, default aspect", (t) => {
    const poly = templatePolygon(t, 300, 1);
    expect(poly.length).toBeGreaterThan(8);
    const b = bounds(poly);
    // Height matched (a sampled polygon can miss the extremum by a sliver).
    expect(b.h).toBeCloseTo(300, 0);
    // Width follows the shape's default aspect.
    const d = GUIDE_DEFAULTS[t];
    expect(b.w / b.h).toBeCloseTo(d.width! / d.height!, 1);
    // Centred: the bounds' centre is the origin.
    expect((b.x1 + b.x2) / 2).toBeCloseTo(0, 0);
    expect((b.y1 + b.y2) / 2).toBeCloseTo(0, 0);
  });

  it("scales with the size factor", () => {
    const one = bounds(templatePolygon("almond", 200, 1));
    const two = bounds(templatePolygon("almond", 200, 2));
    expect(two.h).toBeCloseTo(one.h * 2, 0);
    expect(two.w).toBeCloseTo(one.w * 2, 0);
  });

  it("never returns a degenerate shape for a tiny ink height", () => {
    const b = bounds(templatePolygon("teardrop", 0, 1));
    expect(b.h).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/stackTemplates.test.ts`
Expected: FAIL — cannot resolve `./stackTemplates`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/stackTemplates.ts
// Built-in container shapes for the stack editor window. Pure; never imports
// ./harfbuzz. A template is a guide shape's formula sized to the composition
// rather than a guide block on the canvas.
import { GUIDE_DEFAULTS, containerPolygon, guidePathD } from "./guideShapes";
import { parseSvgPath } from "./svgPath";

export type StackTemplate = "teardrop" | "almond";
export const STACK_TEMPLATES: readonly StackTemplate[] = ["teardrop", "almond"];

/** The least height a template is ever built at, px: a composition with no
 *  ink yet (or a measured height of 0) still gets a usable shape. */
const MIN_HEIGHT_PX = 40;

/**
 * The template's container polygon in px, centred on the origin, scaled
 * uniformly so its height equals `inkHeightPx × sizeFactor`. Width follows
 * the shape's default aspect. Height is the dimension matched because a
 * stacked name climbs: the composition is tall and the rows fill the height.
 */
export function templatePolygon(t: StackTemplate, inkHeightPx: number, sizeFactor: number): Array<[number, number]> {
  const d = GUIDE_DEFAULTS[t];
  const poly = containerPolygon(parseSvgPath(guidePathD(t, d)));
  if (!poly) return [];
  let y1 = Infinity, y2 = -Infinity, x1 = Infinity, x2 = -Infinity;
  for (const [x, y] of poly) { y1 = Math.min(y1, y); y2 = Math.max(y2, y); x1 = Math.min(x1, x); x2 = Math.max(x2, x); }
  const h = Math.max(y2 - y1, 1);
  const target = Math.max(inkHeightPx * sizeFactor, MIN_HEIGHT_PX);
  const s = target / h;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  return poly.map(([x, y]) => [(x - cx) * s, (y - cy) * s] as [number, number]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/stackTemplates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stackTemplates.ts src/lib/stackTemplates.test.ts
git commit -m "Stack editor: template polygons sized to the ink (teardrop, almond)"
```

---

### Task 2: `stackDraft.ts` — the staged draft and every mutation on it

**Files:**
- Create: `src/lib/stackDraft.ts`
- Test: `src/lib/stackDraft.test.ts`

**Interfaces:**
- Consumes: `splitPieceAtCut`, `bendCurveAt` from `./stackConvert`; `arrangeStackInShape`, `FillerShape`, `ArrangeResult` from `./stackArrange`; `assembleStackOutline`, `stackScale` from `./stackOutline`; `outlineBounds` from `./strokeCuts`; `CurveTrace` from `./stackCurve`; `StackBlock`, `StackPiece`, `StackJoin` from `../types`.
- Produces:
  ```ts
  export type StackDraft = {
    pieces: StackPiece[]; joins: StackJoin[]; fontSize: number;
    nib: { width: number; minFraction: number };
    x: number; y: number; rotation: number;
  };
  export type Box = { x1: number; y1: number; x2: number; y2: number };
  export type PiecePatch = { id: string; x?: number; y?: number; rotation?: number };
  export function draftOf(block: StackBlock): StackDraft;
  export function draftChanged(a: StackDraft, b: StackDraft): boolean;
  export function patchPieces(d: StackDraft, patches: PiecePatch[]): StackDraft;
  export function setJoinBend(d: StackDraft, joinId: string, bend: { bow: number; depth: number }): StackDraft;
  export function splitDraft(d: StackDraft, pieceId: string, cut: { cutX: number; angle: number }): { draft: StackDraft; cap: { id: string; x: number; y: number } } | null;
  export function bendDraft(d: StackDraft, pieceId: string, trace: CurveTrace): { draft: StackDraft; joinId: string } | null;
  export function resetDraft(d: StackDraft): StackDraft;
  export function inkBoundsPx(d: StackDraft, unitsPerEm: number): Box;   // block-local px, rotation 0, fillers excluded
  export function arrangeDraft(d: StackDraft, unitsPerEm: number, shapePx: Array<[number, number]>, fillers: FillerShape[], placement?: { x: number; y: number; rotation: number }): { draft: StackDraft; result: ArrangeResult } | null;
  export function fitTransform(ink: Box, rotationDeg: number, frame: { width: number; height: number }, marginFraction: number): { scale: number; x: number; y: number };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/stackDraft.test.ts
import { describe, it, expect } from "vitest";
import type { StackBlock, StackPiece } from "../types";
import type { SvgCmd } from "./svgPath";
import {
  draftOf, draftChanged, patchPieces, setJoinBend, resetDraft, inkBoundsPx, arrangeDraft, fitTransform,
} from "./stackDraft";

// Synthetic pieces: nothing here is shaped, so hand-made rectangles are fine
// (CLAUDE.md's fixture rule is about shaping).
const UPM = 1000;
const rect = (w: number, h: number): SvgCmd[] => [
  { type: "M", x: 0, y: -h }, { type: "L", x: w, y: -h }, { type: "L", x: w, y: 0 }, { type: "L", x: 0, y: 0 }, { type: "Z" },
];
const letter = (id: string, order: number, x: number, w: number, h: number, extra: Partial<StackPiece> = {}): StackPiece => ({
  id, cmds: rect(w, h), x, y: 0, rotation: 0, pivot: [w / 2, -h / 2], homeX: x, homeY: 0, order, role: "letter", faces: [], ...extra,
});

const block = (): StackBlock => ({
  id: 1, type: "stack", x: 100, y: 200, rotation: 15,
  text: "", fontSize: 100, color: "#000", fontFamily: "Amiri",
  source: { text: "اب", fontFamily: "Amiri" }, unitsPerEm: UPM,
  nib: { width: 60, minFraction: 0.5 },
  pieces: [letter("a", 0, 0, 200, 600), letter("b", 1, 300, 300, 400)],
  joins: [{ id: "j1", from: { pieceId: "a", faceIndex: 0 }, to: { pieceId: "b", faceIndex: 0 }, bow: 0.4, depth: 0.2, rest: { bow: 0.1, depth: 0 } }],
} as unknown as StackBlock);

describe("draftOf / draftChanged", () => {
  it("copies the block's editable fields and reports no change until something is patched", () => {
    const d = draftOf(block());
    expect(d.x).toBe(100); expect(d.rotation).toBe(15); expect(d.pieces.length).toBe(2);
    expect(draftChanged(d, d)).toBe(false);
    expect(draftChanged(d, patchPieces(d, [{ id: "a", y: -50 }]))).toBe(true);
    expect(draftChanged(d, { ...d, fontSize: 101 })).toBe(true);
    expect(draftChanged(d, { ...d, nib: { ...d.nib, minFraction: 0.6 } })).toBe(true);
    expect(draftChanged(d, { ...d, x: 101 })).toBe(true);
  });
});

describe("patchPieces / setJoinBend / resetDraft", () => {
  it("patches by id, keeps ids, and leaves other pieces untouched by reference", () => {
    const d = draftOf(block());
    const n = patchPieces(d, [{ id: "b", x: 310, rotation: 0.3 }]);
    expect(n.pieces[1]).toMatchObject({ id: "b", x: 310, rotation: 0.3 });
    expect(n.pieces[0]).toBe(d.pieces[0]);
  });
  it("sets a join's bow and depth", () => {
    const n = setJoinBend(draftOf(block()), "j1", { bow: -0.2, depth: 0.5 });
    expect(n.joins[0]).toMatchObject({ bow: -0.2, depth: 0.5 });
  });
  it("reset returns pieces home, joins to rest, and drops fillers", () => {
    const d = draftOf(block());
    const moved = patchPieces(d, [{ id: "a", x: 50, y: -90, rotation: 0.4 }]);
    const withFiller = { ...moved, pieces: [...moved.pieces, { ...letter("f", 9, 0, 40, 40), role: "mark" as const, filler: true }] };
    const r = resetDraft(withFiller);
    expect(r.pieces.map((p) => p.id)).toEqual(["a", "b"]);
    expect(r.pieces[0]).toMatchObject({ x: 0, y: 0, rotation: 0 });
    expect(r.joins[0]).toMatchObject({ bow: 0.1, depth: 0 });
  });
});

describe("inkBoundsPx", () => {
  it("measures the assembled outline in px at the draft's size, ignoring fillers", () => {
    const d = draftOf(block());
    const b = inkBoundsPx(d, UPM);
    // 600 font units tall at 100px/1000upm = 60px; x spans 0..600 units = 60px.
    expect(b.y2 - b.y1).toBeCloseTo(60, 0);
    expect(b.x2 - b.x1).toBeCloseTo(60, 0);
    const withFiller = { ...d, pieces: [...d.pieces, { ...letter("f", 9, 5000, 40, 40), role: "mark" as const, filler: true }] };
    expect(inkBoundsPx(withFiller, UPM).x2).toBeCloseTo(b.x2, 0);
  });
});

describe("arrangeDraft", () => {
  it("re-flows the letters into the shape, keeps the block in place unless a placement is given", () => {
    const d = draftOf(block());
    const tall: Array<[number, number]> = [[-60, -200], [60, -200], [60, 200], [-60, 200]];
    const r = arrangeDraft(d, UPM, tall, []);
    expect(r).not.toBeNull();
    expect(r!.draft.x).toBe(100); expect(r!.draft.y).toBe(200); expect(r!.draft.rotation).toBe(15);
    expect(r!.result.rows).toBeGreaterThanOrEqual(1);
    const placed = arrangeDraft(d, UPM, tall, [], { x: 1, y: 2, rotation: 3 });
    expect(placed!.draft).toMatchObject({ x: 1, y: 2, rotation: 3 });
  });
  it("strips earlier fillers before arranging", () => {
    const d = draftOf(block());
    const withFiller = { ...d, pieces: [...d.pieces, { ...letter("f", 9, 0, 40, 40), role: "mark" as const, filler: true }] };
    const tall: Array<[number, number]> = [[-60, -200], [60, -200], [60, 200], [-60, 200]];
    const r = arrangeDraft(withFiller, UPM, tall, []);
    expect(r!.draft.pieces.some((p) => p.filler)).toBe(false);
  });
  it("returns null when nothing fits", () => {
    const d = draftOf(block());
    const dot: Array<[number, number]> = [[0, 0], [1, 0], [1, 1]];
    expect(arrangeDraft(d, UPM, dot, [])).toBeNull();
  });
});

describe("fitTransform", () => {
  const frame = { width: 800, height: 600 };
  it("scales the ink to the frame minus the margin and centres it", () => {
    const t = fitTransform({ x1: -50, y1: -100, x2: 50, y2: 100 }, 0, frame, 0.12);
    // Shorter side 600, margin 72 each side → 456 usable height for 200 of ink.
    expect(t.scale).toBeCloseTo(456 / 200, 3);
    // Ink centre (0, 0) lands at the frame's centre.
    expect(t.x).toBeCloseTo(400, 3); expect(t.y).toBeCloseTo(300, 3);
  });
  it("uses the rotated bounds so a turned composition still fits", () => {
    const up = fitTransform({ x1: -200, y1: -10, x2: 200, y2: 10 }, 0, frame, 0.12);
    const turned = fitTransform({ x1: -200, y1: -10, x2: 200, y2: 10 }, 90, frame, 0.12);
    // Upright the 400-wide bar is limited by width; turned 90° it is 400 tall
    // and limited by the (shorter) height, so it scales less.
    expect(turned.scale).toBeLessThan(up.scale);
    expect(turned.scale * 400).toBeLessThanOrEqual(600 - 2 * 72 + 1e-6);
  });
  it("offsets so an off-centre ink box is centred", () => {
    const t = fitTransform({ x1: 100, y1: 100, x2: 300, y2: 200 }, 0, frame, 0);
    // Ink centre (200, 150) × scale must land at (400, 300).
    expect(t.x + 200 * t.scale).toBeCloseTo(400, 3);
    expect(t.y + 150 * t.scale).toBeCloseTo(300, 3);
  });
  it("never divides by zero on empty ink", () => {
    const t = fitTransform({ x1: 0, y1: 0, x2: 0, y2: 0 }, 0, frame, 0.12);
    expect(Number.isFinite(t.scale)).toBe(true);
    expect(t.scale).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/stackDraft.test.ts`
Expected: FAIL — cannot resolve `./stackDraft`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/stackDraft.ts
// The stack editor window's staged state and every mutation it performs.
// Pure: never imports ./harfbuzz. Geometry in font units like the block;
// `inkBoundsPx` and `fitTransform` are the only px-aware parts.
import type { StackBlock, StackPiece, StackJoin } from "../types";
import type { CurveTrace } from "./stackCurve";
import { bendCurveAt, splitPieceAtCut } from "./stackConvert";
import { arrangeStackInShape, type ArrangeResult, type FillerShape } from "./stackArrange";
import { assembleStackOutline, stackScale } from "./stackOutline";
import { outlineBounds } from "./strokeCuts";

export type StackDraft = {
  pieces: StackPiece[];
  joins: StackJoin[];
  fontSize: number;
  nib: { width: number; minFraction: number };
  /** Carried so a canvas-guide arrange can move the block on Done; nothing
   *  else in the window touches them. */
  x: number;
  y: number;
  rotation: number;
};

export type Box = { x1: number; y1: number; x2: number; y2: number };
export type PiecePatch = { id: string; x?: number; y?: number; rotation?: number };

export function draftOf(block: StackBlock): StackDraft {
  return {
    pieces: block.pieces ?? [],
    joins: block.joins ?? [],
    fontSize: block.fontSize,
    nib: block.nib,
    x: block.x,
    y: block.y,
    rotation: block.rotation ?? 0,
  };
}

/**
 * Whether Done has anything to commit. Arrays compare by reference: every
 * mutation here returns a new array, and an undo back to the opening state
 * restores the opening arrays themselves, so reference equality is "nothing
 * happened". A drag that nets to zero counts as a change; that costs one
 * history step, never a lost edit.
 */
export function draftChanged(a: StackDraft, b: StackDraft): boolean {
  return (
    a.pieces !== b.pieces || a.joins !== b.joins || a.fontSize !== b.fontSize ||
    a.nib.minFraction !== b.nib.minFraction || a.nib.width !== b.nib.width ||
    a.x !== b.x || a.y !== b.y || a.rotation !== b.rotation
  );
}

export function patchPieces(d: StackDraft, patches: PiecePatch[]): StackDraft {
  const byId = new Map(patches.map((p) => [p.id, p]));
  return { ...d, pieces: d.pieces.map((p) => { const q = byId.get(p.id); return q ? { ...p, ...q, id: p.id } : p; }) };
}

export function setJoinBend(d: StackDraft, joinId: string, bend: { bow: number; depth: number }): StackDraft {
  return { ...d, joins: d.joins.map((j) => (j.id === joinId ? { ...j, bow: bend.bow, depth: bend.depth } : j)) };
}

/** Cut a piece; the cap is the piece the split appended (the overlay pulls it in the same gesture). */
export function splitDraft(
  d: StackDraft, pieceId: string, cut: { cutX: number; angle: number }
): { draft: StackDraft; cap: { id: string; x: number; y: number } } | null {
  const next = splitPieceAtCut(d.pieces, d.joins, pieceId, cut);
  if (!next) return null;
  const cap = next.pieces[next.pieces.length - 1];
  return { draft: { ...d, pieces: next.pieces, joins: next.joins }, cap: { id: cap.id, x: cap.x, y: cap.y } };
}

/** Free the curve the hover traced into a join. */
export function bendDraft(d: StackDraft, pieceId: string, trace: CurveTrace): { draft: StackDraft; joinId: string } | null {
  const next = bendCurveAt(d.pieces, d.joins, pieceId, trace);
  if (!next) return null;
  return { draft: { ...d, pieces: next.pieces, joins: next.joins }, joinId: next.joinId };
}

/** Pieces home, joins to rest, fillers gone (home is the conversion, which had none). */
export function resetDraft(d: StackDraft): StackDraft {
  return {
    ...d,
    pieces: d.pieces.filter((p) => !p.filler).map((p) => ({ ...p, x: p.homeX, y: p.homeY, rotation: 0 })),
    joins: d.joins.map((j) => ({ ...j, bow: j.rest?.bow ?? 0, depth: j.rest?.depth ?? 0 })),
  };
}

/** The assembled outline's bounds in block-local px (rotation 0), fillers excluded. */
export function inkBoundsPx(d: StackDraft, unitsPerEm: number): Box {
  const s = stackScale(d.fontSize, unitsPerEm);
  const b = outlineBounds(assembleStackOutline(d.pieces.filter((p) => !p.filler), d.joins, d.nib));
  return { x1: b.x1 * s, y1: b.y1 * s, x2: b.x2 * s, y2: b.y2 * s };
}

/**
 * Arrange the draft's letters into `shapePx` (block-local px, centred on the
 * origin). Earlier fillers are stripped first so a re-run never accumulates
 * them. `placement` moves the block (a canvas guide); absent, it stays.
 * Returns null when nothing fits; lets the arranger's throw propagate.
 */
export function arrangeDraft(
  d: StackDraft, unitsPerEm: number, shapePx: Array<[number, number]>, fillers: FillerShape[],
  placement?: { x: number; y: number; rotation: number }
): { draft: StackDraft; result: ArrangeResult } | null {
  const result = arrangeStackInShape({
    pieces: d.pieces.filter((p) => !p.filler), joins: d.joins, shapePx,
    fontSize: d.fontSize, unitsPerEm, fillers, pullStems: true,
  });
  if (!result) return null;
  return {
    draft: { ...d, pieces: result.pieces, joins: result.joins, fontSize: result.fontSize, ...(placement ?? {}) },
    result,
  };
}

/**
 * The group transform that shows `ink` (block-local px, before rotation)
 * centred in `frame` with `marginFraction` of the frame's shorter side kept
 * clear on every edge. The rotated bounds are fitted, so a turned block
 * stays inside the frame.
 */
export function fitTransform(
  ink: Box, rotationDeg: number, frame: { width: number; height: number }, marginFraction: number
): { scale: number; x: number; y: number } {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const corners: Array<[number, number]> = [[ink.x1, ink.y1], [ink.x2, ink.y1], [ink.x2, ink.y2], [ink.x1, ink.y2]];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of corners) {
    const rx = x * c - y * s, ry = x * s + y * c;
    x1 = Math.min(x1, rx); y1 = Math.min(y1, ry); x2 = Math.max(x2, rx); y2 = Math.max(y2, ry);
  }
  const margin = Math.min(frame.width, frame.height) * marginFraction;
  const usableW = Math.max(frame.width - 2 * margin, 1);
  const usableH = Math.max(frame.height - 2 * margin, 1);
  const w = Math.max(x2 - x1, 1e-6), h = Math.max(y2 - y1, 1e-6);
  const scale = Math.max(Math.min(usableW / w, usableH / h), 1e-3);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  return { scale, x: frame.width / 2 - cx * scale, y: frame.height / 2 - cy * scale };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/stackDraft.test.ts`
Expected: PASS. If `arrangeDraft`'s "re-flows" test returns null for the tall rectangle, widen the rectangle (the arranger needs letters plus gaps to fit at *some* scale; the bisection shrinks fontSize, so any shape larger than a few px fits) — the test's shape is 120×400 px and the two letters are 60 px wide together, so it fits as written.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stackDraft.ts src/lib/stackDraft.test.ts
git commit -m "Stack editor: staged draft — patch, bend, split, free, reset, arrange, measure, fit"
```

---

### Task 3: `StackEditorDialog.tsx` — the window

**Files:**
- Create: `src/components/StackEditorDialog.tsx`
- Modify: `src/lib/testBridge.ts` (add `getEditorStage`, `setEditorStage`)
- Modify: `src/index.css` (dialog layout classes, appended after the `.nameDesign*` block)

**Interfaces:**
- Consumes: everything from Task 1 and Task 2; `StackView` (`./StackView`), `StackEditOverlay` (`./StackEditOverlay`), `stackProps` (`../lib/blockRenderProps`), `stackScale` (`../lib/stackOutline`), `complementOf` (`../lib/complementColor`), `useUndoRedo` (`../hooks/useUndoRedo`), `ConfirmDialog` + `ConfirmDialogRequest` (`./ConfirmDialog`), `CloseIcon` (`./Icons`), `RangeRow`, `CheckboxRow` (`./sidebar/FormControls`), `FillerShape` (`../lib/stackArrange`).
- Produces:
  ```ts
  export type StackEditorGuide = { id: number; label: string; polygon: Array<[number, number]>; x: number; y: number; rotation: number };
  export type StackEditorDialogProps = {
    block: StackBlock;
    surfaceColor: string;
    closedGuides: StackEditorGuide[];
    moveTogether: boolean; onMoveTogether: (v: boolean) => void;
    fillGaps: boolean; onFillGaps: (v: boolean) => void;
    loadFillers: (block: StackBlock) => Promise<{ fillers: FillerShape[]; note: string }>;
    onDone: (patch: StackDraft) => void;
    onCancel: () => void;
  };
  export const StackEditorDialog: React.FC<StackEditorDialogProps>;
  ```
  and in `testBridge.ts`:
  ```ts
  export type HarfTestBridge = { getBlocks; getSelectedIds; getStage; getEditorStage: () => Konva.Stage | null };
  export function setEditorStage(stage: Konva.Stage | null): void;   // module-level slot read by the bridge
  export function currentEditorStage(): Konva.Stage | null;
  ```

- [ ] **Step 1: Extend the e2e bridge**

In `src/lib/testBridge.ts`, add to the type and a module-level slot:

```ts
export type HarfTestBridge = {
  getBlocks: () => Block[];
  getSelectedIds: () => number[];
  getStage: () => Konva.Stage | null;
  /** The stack editor window's own stage while it is open; null otherwise. */
  getEditorStage: () => Konva.Stage | null;
};

let editorStage: Konva.Stage | null = null;
/** Set by `StackEditorDialog` while mounted. Read-only to tests, like the rest. */
export function setEditorStage(stage: Konva.Stage | null): void { editorStage = stage; }
export function currentEditorStage(): Konva.Stage | null { return editorStage; }
```

Then in `App.tsx`'s `installTestBridge({...})` call (around line 586) add `getEditorStage: currentEditorStage,` and import `currentEditorStage` next to `installTestBridge`.

- [ ] **Step 2: Add the CSS**

Append to `src/index.css` after the `.nameDesignGrid` rules:

```css
/* Stack editor window. Reuses .confirmDialogOverlay for the backdrop and the
   .nameDesign* header pieces; the body is a proof (its own Konva stage) beside
   a column of controls. */
.stackEditorDialog { width: min(1180px, 96vw); height: 90vh; max-height: 90vh; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--bg-panel-floating); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45); }
.stackEditorBody { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 12px; }
.stackEditorBody > * { min-width: 0; }
.stackEditorProof { position: relative; min-height: 0; border: 1px solid var(--border-soft); border-radius: 10px; overflow: hidden; }
.stackEditorProof > div { position: absolute; inset: 0; }
.stackEditorSide { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 2px; }
.stackEditorSide h4 { margin: 4px 0 0; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; color: var(--text-muted); }
.stackEditorGestures { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 1.45; color: var(--text-secondary); }
.stackEditorGestures strong { color: var(--text-primary); font-weight: 600; }
.stackEditorTemplates { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 6px; }
.stackEditorTemplate { border: 1px solid var(--border-soft); border-radius: 10px; padding: 8px 6px; background: var(--bg-panel); color: var(--text-primary); font-size: 12px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.stackEditorTemplate svg { width: 28px; height: 40px; }
.stackEditorTemplate--active { border-color: var(--accent); background: var(--accent-soft); }
.stackEditorFooter { display: flex; align-items: center; gap: 8px; }
.stackEditorFooter .sidebarSmallAction { width: auto; padding: 9px 14px; }
.stackEditorFooter .sidebarSmallAction[disabled] { opacity: 0.5; cursor: default; }
.stackEditorStatus { flex: 1; min-width: 0; font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stackEditorTitle { font-family: var(--font-display); font-size: 17px; font-weight: 600; color: var(--text-primary); }
.stackEditorTitle bdi { font-family: inherit; }
```

- [ ] **Step 3: Write the component**

```tsx
// src/components/StackEditorDialog.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Stage, Layer, Group, Rect, Line } from "react-konva";
import type Konva from "konva";
import type { StackBlock } from "../types";
import type { FillerShape } from "../lib/stackArrange";
import type { CurveTrace } from "../lib/stackCurve";
import { stackProps } from "../lib/blockRenderProps";
import { stackScale } from "../lib/stackOutline";
import { complementOf } from "../lib/complementColor";
import { setEditorStage } from "../lib/testBridge";
import { useUndoRedo } from "../hooks/useUndoRedo";
import {
  arrangeDraft, bendDraft, draftChanged, draftOf, fitTransform, inkBoundsPx, patchPieces, resetDraft,
  setJoinBend, splitDraft, type StackDraft,
} from "../lib/stackDraft";
import { STACK_TEMPLATES, templatePolygon, type StackTemplate } from "../lib/stackTemplates";
import { StackView } from "./StackView";
import { StackEditOverlay } from "./StackEditOverlay";
import { ConfirmDialog, type ConfirmDialogRequest } from "./ConfirmDialog";
import { CloseIcon } from "./Icons";
import { CheckboxRow, RangeRow } from "./sidebar/FormControls";

export type StackEditorGuide = {
  id: number;
  label: string;
  /** The guide's container polygon in px, in the guide's local frame. */
  polygon: Array<[number, number]>;
  x: number;
  y: number;
  rotation: number;
};

export type StackEditorDialogProps = {
  block: StackBlock;
  /** The canvas surface the composition will sit on (paper or freeform). */
  surfaceColor: string;
  closedGuides: StackEditorGuide[];
  moveTogether: boolean;
  onMoveTogether: (v: boolean) => void;
  fillGaps: boolean;
  onFillGaps: (v: boolean) => void;
  /** The font's tashkeel for the gaps (App owns font loading). */
  loadFillers: (block: StackBlock) => Promise<{ fillers: FillerShape[]; note: string }>;
  /** Called only when the draft differs from the block; App makes one history step. */
  onDone: (patch: StackDraft) => void;
  onCancel: () => void;
};

type Choice = { kind: "free" } | { kind: "template"; template: StackTemplate } | { kind: "guide"; id: number };

const FIT_MARGIN = 0.12;
const TEMPLATE_LABELS: Record<StackTemplate, string> = { teardrop: "Teardrop", almond: "Almond" };

/** Card glyphs: schematic, not the formula (the formula is what the arrange uses). */
const TEMPLATE_ICON: Record<StackTemplate, string> = {
  teardrop: "M14 2 C 22 14, 26 22, 26 28 C 26 35, 20 39, 14 39 C 8 39, 2 35, 2 28 C 2 22, 6 14, 14 2 Z",
  almond: "M14 1 C 24 12, 24 29, 14 40 C 4 29, 4 12, 14 1 Z",
};

const GESTURES: Array<[string, string]> = [
  ["Move", "drag a letter; the letters after it come along."],
  ["Tilt", "drag just outside a letter's edge; hold Shift for even steps."],
  ["Bend", "drag a curve between letters; double-click it to straighten."],
  ["Pull a tail", "press the free end of a straight stroke and pull it out."],
  ["One letter alone", "hold Alt, or untick Move letters together."],
];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * The stack editor window: a proof of the composition on its own stage with
 * the same renderer and the same gesture overlay the canvas used to mount,
 * plus every stack control. Edits are staged on a draft with an editor-local
 * undo stack; Done hands the draft to App, Cancel drops it.
 *
 * Portaled to `document.body` like every modal here: nothing that is not
 * artwork may live in the main stage.
 */
export const StackEditorDialog: React.FC<StackEditorDialogProps> = ({
  block, surfaceColor, closedGuides, moveTogether, onMoveTogether, fillGaps, onFillGaps, loadFillers, onDone, onCancel,
}) => {
  // Captured once: `draftChanged` compares arrays by reference, so the opening
  // draft must hold the block's own arrays, not a copy made on a later render.
  const [opening] = useState<StackDraft>(() => draftOf(block));
  const [draft, setDraft] = useState<StackDraft>(opening);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [choice, setChoice] = useState<Choice>({ kind: "free" });
  const [sizeFactor, setSizeFactor] = useState(1);
  const [outline, setOutline] = useState<Array<[number, number]> | null>(null);
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState<ConfirmDialogRequest | null>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const proofRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const arrangeToken = useRef(0);

  // Editor-local undo: the draft is the snapshot; there is no thumbnail.
  const getSnapshot = useCallback(() => draftRef.current, []);
  const applySnapshot = useCallback((s: StackDraft) => setDraft(s), []);
  const noThumb = useCallback(() => "", []);
  const { pushHistory, handleUndo, handleRedo, canUndo, canRedo } = useUndoRedo(getSnapshot, applySnapshot, noThumb);

  // The proof's size, kept current as the window resizes.
  useLayoutEffect(() => {
    const el = proofRef.current;
    if (!el) return;
    const measure = () => setFrame({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback(() => {
    if (frame.width === 0 || frame.height === 0) return;
    const d = draftRef.current;
    setView(fitTransform(inkBoundsPx(d, block.unitsPerEm), d.rotation, frame, FIT_MARGIN));
  }, [frame, block.unitsPerEm]);
  // Fit on open and whenever the frame changes size.
  useEffect(() => { fitView(); }, [fitView]);

  // The e2e bridge's view of this stage, while mounted.
  useEffect(() => {
    setEditorStage(stageRef.current);
    return () => setEditorStage(null);
  });

  const requestCancel = useCallback(() => {
    if (!draftChanged(opening, draftRef.current)) { onCancel(); return; }
    setConfirm({
      title: "Discard changes?",
      message: "Discard the changes to this composition? The canvas keeps the version you opened.",
      confirmLabel: "Discard",
      onConfirm: () => { setConfirm(null); onCancel(); },
    });
  }, [opening, onCancel]);

  const done = useCallback(() => {
    if (draftChanged(opening, draftRef.current)) onDone(draftRef.current);
    else onCancel();
  }, [opening, onDone, onCancel]);

  // Keys: Escape cancels (the confirm's own Escape handler closes only the
  // confirm, since it mounts after this one and both listen on window — so
  // ignore Escape here while the confirm is up); Ctrl/Cmd+Z and Shift+Z / Y
  // drive the editor's stack. App's global handler is suppressed while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (!confirm) requestCancel(); return; }
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); if (e.shiftKey) handleRedo(); else handleUndo(); }
      else if (e.key === "y") { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, requestCancel, handleUndo, handleRedo]);

  // ---- overlay callbacks, rewired to the draft ----
  const onSetPieces = useCallback((patches: Parameters<typeof patchPieces>[1]) => {
    setDraft((d) => patchPieces(d, patches));
  }, []);
  const onSetBow = useCallback((joinId: string, bend: { bow: number; depth: number }) => {
    setDraft((d) => setJoinBend(d, joinId, bend));
  }, []);
  const onSplit = useCallback((pieceId: string, cut: { cutX: number; angle: number }) => {
    const r = splitDraft(draftRef.current, pieceId, cut);
    if (!r) return null;
    pushHistory();                 // the cut and the pull that follows are one step
    draftRef.current = r.draft;    // the overlay reads the cap from the return value; keep the ref current for the next frame
    setDraft(r.draft);
    return r.cap;
  }, [pushHistory]);
  const onBend = useCallback((pieceId: string, trace: CurveTrace) => {
    const r = bendDraft(draftRef.current, pieceId, trace);
    if (!r) { setStatus("That curve could not be freed cleanly."); return null; }
    pushHistory();
    draftRef.current = r.draft;
    setDraft(r.draft);
    setStatus("Curve freed; drag to bend, double-click to restore.");
    return r.joinId;
  }, [pushHistory]);

  // ---- arranging ----
  const arrange = useCallback(async (c: Choice, factor: number, fill: boolean) => {
    if (c.kind === "free") { setOutline(null); return; }
    const token = ++arrangeToken.current;
    let fillers: FillerShape[] = [], note = "";
    if (fill) ({ fillers, note } = await loadFillers(block));
    if (token !== arrangeToken.current) return;   // a later pick wins
    const d = draftRef.current;
    let shapePx: Array<[number, number]>;
    let placement: { x: number; y: number; rotation: number } | undefined;
    if (c.kind === "template") {
      const ink = inkBoundsPx(d, block.unitsPerEm);
      shapePx = templatePolygon(c.template, ink.y2 - ink.y1, factor);
    } else {
      const g = closedGuides.find((x) => x.id === c.id);
      if (!g) { setStatus("That guide is gone; nothing was arranged."); return; }
      shapePx = g.polygon;
      placement = { x: g.x, y: g.y, rotation: g.rotation };
    }
    let r: ReturnType<typeof arrangeDraft>;
    try {
      r = arrangeDraft(d, block.unitsPerEm, shapePx, fillers, placement);
    } catch (err) {
      setStatus(`Could not arrange the letters: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!r) { setStatus("Could not fit the letters inside that shape."); return; }
    pushHistory();
    draftRef.current = r.draft;
    setDraft(r.draft);
    setOutline(shapePx);
    const letters = r.result.pieces.filter((p) => p.role === "letter" && p.parentId === undefined).length;
    setStatus(
      `Arranged ${plural(letters, "letter")} in ${plural(r.result.rows, "row")}` +
      (r.result.fillers > 0 ? `, ${plural(r.result.fillers, "ornament")} added` : "") +
      (r.result.stems > 0 ? `, ${plural(r.result.stems, "stem")} lengthened` : "") + note + "."
    );
    // The size changed; refit on the next frame so the new draft is measured.
    requestAnimationFrame(() => {
      setView(fitTransform(inkBoundsPx(r!.draft, block.unitsPerEm), r!.draft.rotation, frame, FIT_MARGIN));
    });
  }, [block, closedGuides, loadFillers, pushHistory, frame]);

  const pick = (c: Choice) => { setChoice(c); void arrange(c, sizeFactor, fillGaps); };
  const changeSize = (v: number) => { setSizeFactor(v); if (choice.kind === "template") void arrange(choice, v, fillGaps); };
  const changeFillGaps = (v: boolean) => { onFillGaps(v); if (choice.kind !== "free") void arrange(choice, sizeFactor, v); };
  const reset = () => {
    pushHistory();
    const r = resetDraft(draftRef.current);
    draftRef.current = r;
    setDraft(r);
    setChoice({ kind: "free" });
    setOutline(null);
    setStatus("Layout reset.");
    requestAnimationFrame(fitView);
  };
  const setMinFraction = (v: number) => {
    pushHistory();
    setDraft((d) => ({ ...d, nib: { ...d.nib, minFraction: v } }));
  };

  const accent = useMemo(() => complementOf(block.color), [block.color]);
  const scale = stackScale(draft.fontSize, block.unitsPerEm);
  const renderBlock = useMemo<StackBlock>(
    () => ({ ...block, pieces: draft.pieces, joins: draft.joins, fontSize: draft.fontSize, nib: draft.nib }),
    [block, draft]
  );
  const isActive = (c: Choice) =>
    c.kind === choice.kind && (c.kind === "free" || (c.kind === "template" && choice.kind === "template" && c.template === choice.template) ||
      (c.kind === "guide" && choice.kind === "guide" && c.id === choice.id));

  return createPortal(
    <div className="confirmDialogOverlay" role="presentation" data-testid="stack-editor">
      <div className="stackEditorDialog" role="dialog" aria-modal="true" aria-labelledby="stackEditorTitle">
        <div className="nameDesignHeader">
          <div>
            <div id="stackEditorTitle" className="stackEditorTitle">
              Edit composition · <bdi dir="rtl" style={{ fontFamily: `"${block.source.fontFamily}"` }}>{block.source.text}</bdi>
            </div>
            <div className="nameDesignSubtitle">What you see here is what the canvas will show when you press Done.</div>
          </div>
          <button type="button" className="sidebarCircleButton" onClick={requestCancel} aria-label="Close composition editor">
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="stackEditorBody">
          <div className="stackEditorProof" ref={proofRef}>
            {frame.width > 0 && (
              <Stage ref={stageRef} width={frame.width} height={frame.height}>
                <Layer>
                  <Rect x={0} y={0} width={frame.width} height={frame.height} fill={surfaceColor} listening={false} />
                  <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale} rotation={draft.rotation}>
                    <StackView
                      {...stackProps(renderBlock)}
                      rotation={0}
                      x={0}
                      y={0}
                      opacity={block.opacity ?? 1}
                      isSelected
                      editing={
                        <StackEditOverlay
                          isSelected
                          pieces={draft.pieces}
                          joins={draft.joins}
                          nib={draft.nib}
                          scale={scale}
                          color={block.color}
                          moveTogether={moveTogether}
                          unitsPerEm={block.unitsPerEm}
                          onBegin={pushHistory}
                          onSetPieces={onSetPieces}
                          onSetBow={onSetBow}
                          onSplit={onSplit}
                          onBend={onBend}
                        />
                      }
                    />
                    {outline && (
                      <Line
                        name="stack-template-outline"
                        points={outline.flat()}
                        closed
                        stroke={accent}
                        strokeWidth={1}
                        strokeScaleEnabled={false}
                        dash={[6, 4]}
                        listening={false}
                      />
                    )}
                  </Group>
                </Layer>
              </Stage>
            )}
          </div>

          <div className="stackEditorSide">
            <h4>Gestures</h4>
            <ul className="stackEditorGestures">
              {GESTURES.map(([k, v]) => (<li key={k}><strong>{k}</strong> — {v}</li>))}
            </ul>

            <h4>Templates</h4>
            <div className="stackEditorTemplates" role="group" aria-label="Templates">
              <button type="button" className={`stackEditorTemplate${isActive({ kind: "free" }) ? " stackEditorTemplate--active" : ""}`}
                aria-pressed={isActive({ kind: "free" })} onClick={() => pick({ kind: "free" })}>
                <svg viewBox="0 0 28 42" aria-hidden="true"><rect x="3" y="3" width="22" height="36" rx="4" fill="none" stroke="currentColor" strokeDasharray="3 3" /></svg>
                Free
              </button>
              {STACK_TEMPLATES.map((t) => (
                <button key={t} type="button"
                  className={`stackEditorTemplate${isActive({ kind: "template", template: t }) ? " stackEditorTemplate--active" : ""}`}
                  aria-pressed={isActive({ kind: "template", template: t })} onClick={() => pick({ kind: "template", template: t })}>
                  <svg viewBox="0 0 28 42" aria-hidden="true"><path d={TEMPLATE_ICON[t]} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
                  {TEMPLATE_LABELS[t]}
                </button>
              ))}
              {closedGuides.map((g) => (
                <button key={g.id} type="button"
                  className={`stackEditorTemplate${isActive({ kind: "guide", id: g.id }) ? " stackEditorTemplate--active" : ""}`}
                  aria-pressed={isActive({ kind: "guide", id: g.id })} onClick={() => pick({ kind: "guide", id: g.id })}>
                  <svg viewBox="0 0 28 42" aria-hidden="true"><ellipse cx="14" cy="21" rx="11" ry="18" fill="none" stroke="currentColor" strokeDasharray="3 3" /></svg>
                  {g.label}
                </button>
              ))}
            </div>
            <RangeRow
              id="stack-editor-size"
              name="stackTemplateSize"
              label="Template size"
              value={sizeFactor}
              min={0.5}
              max={2}
              step={0.05}
              suffix={`${Math.round(sizeFactor * 100)}%`}
              disabled={choice.kind !== "template"}
              onChange={changeSize}
            />
            <CheckboxRow id="stack-editor-fill-gaps" label="Fill gaps with tashkeel" checked={fillGaps} onChange={changeFillGaps} />

            <h4>Strokes</h4>
            <RangeRow
              id="stack-editor-minFraction"
              name="stackMinFraction"
              label="Join thickness"
              value={draft.nib.minFraction}
              min={0.05}
              max={1}
              step={0.01}
              suffix={draft.nib.minFraction.toFixed(2)}
              onChange={setMinFraction}
            />
            <CheckboxRow id="stack-editor-together" label="Move letters together" checked={moveTogether} onChange={onMoveTogether} />
            <button type="button" className="sidebarSmallAction" aria-label="Reset layout" onClick={reset}>Reset layout</button>
            <button type="button" className="sidebarSmallAction" aria-label="Fit view" onClick={fitView}>Fit view</button>
          </div>
        </div>

        <div className="stackEditorFooter">
          <button type="button" className="sidebarSmallAction" aria-label="Undo" disabled={!canUndo} onClick={handleUndo}>Undo</button>
          <button type="button" className="sidebarSmallAction" aria-label="Redo" disabled={!canRedo} onClick={handleRedo}>Redo</button>
          <div className="stackEditorStatus" role="status">{status}</div>
          <button type="button" className="sidebarSmallAction" aria-label="Cancel" onClick={requestCancel}>Cancel</button>
          <button type="button" className="sidebarSmallAction" aria-label="Done" onClick={done}>Done</button>
        </div>
      </div>
      <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />
    </div>,
    document.body
  );
};
```

Notes for the implementer:
- `RangeRow` must accept `disabled`. Check `src/components/sidebar/FormControls.tsx`; if it does not, add an optional `disabled?: boolean` prop passed to the `<input type="range">` (a one-line change; keep the file's style).
- `useMemo` is still used for `accent` and `renderBlock`; `useLayoutEffect` for the frame measure.
- `StackView` takes `rotation` from `stackProps`; the explicit `rotation={0}` after the spread overrides it, since the outer `Group` carries the draft's rotation so the template outline shares the frame.
- `ConfirmDialog` mounts inside the overlay div, so its backdrop stacks above the editor's (both `position: fixed; z-index: 2000` — later in DOM wins).

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint`
Expected: clean. (The component is not mounted yet; Task 4 wires it.)

- [ ] **Step 5: Commit**

```bash
git add src/components/StackEditorDialog.tsx src/lib/testBridge.ts src/index.css src/components/sidebar/FormControls.tsx src/App.tsx
git commit -m "Stack editor: the window — proof stage, gesture guide, templates, staged draft with local undo"
```

---

### Task 4: Rewire `App.tsx`, `CanvasStage.tsx`, `Sidebar.tsx`, `StackPanel.tsx`

**Files:**
- Modify: `src/App.tsx` (remove `setStackPieces`, `splitStackPiece`, `bendStackCurve`, `setStackJoinBow`, `arrangeStackNow`, `arrangeStackNowRef`, `arrangeStackInGuide`, `resetStackLayout`; add `stackEditorId` state, `openStackEditor`, `commitStackEditor`, `loadStackFillers`, key guard, dialog mount; trim Sidebar/CanvasStage props)
- Modify: `src/components/CanvasStage.tsx` (drop five stack handler props + `stackMoveTogether`; add `onEditStack`; stack `onDblClick` → `onEditStack`; `StackView` without `editing`; drop the `StackEditOverlay` and `stackScale` imports if now unused)
- Modify: `src/components/Sidebar.tsx` (replace `onResetStackLayout`, `onArrangeStackInGuide`, `stackMoveTogether`, `onStackMoveTogether`, `stackFillGaps`, `onStackFillGaps` with `onEditStack?: () => void`; simplify the Stack section)
- Modify: `src/components/sidebar/StackPanel.tsx` (shrink)

**Interfaces:**
- Consumes: `StackEditorDialog`, `StackEditorGuide` (Task 3); `StackDraft` (Task 2).
- Produces: `CanvasStage` prop `onEditStack: (id: number) => void`; `Sidebar` prop `onEditStack?: () => void`; `StackPanel` props `{ block: StackBlock; onEdit: () => void }`.

- [ ] **Step 1: Shrink `StackPanel.tsx`**

Replace the file's contents with:

```tsx
import type { StackBlock } from "../../types";

/**
 * The Stack type panel: the baked spelling (read-only) and the way into the
 * editor window, where every stack control and gesture lives
 * (StackEditorDialog). Double-clicking the composition on the canvas opens
 * the same window.
 */
export const StackPanel: React.FC<{
  block: StackBlock;
  onEdit: () => void;
}> = ({ block, onEdit }) => (
  <div className="sectionPanel">
    <p className="guideEmpty" dir="rtl">{block.source.text}</p>
    <p className="guideEmpty">
      Baked from {block.source.fontFamily}. The spelling cannot be edited here — undo the
      conversion, or convert a fresh text block.
    </p>
    <p className="guideEmpty">
      Move, tilt, bend and arrange the letters in the editor window. Double-click the
      composition on the canvas, or press the button below.
    </p>
    <button type="button" className="sidebarSmallAction" aria-label="Edit composition" onClick={onEdit}>
      Edit composition
    </button>
  </div>
);
```

- [ ] **Step 2: Simplify `Sidebar.tsx`**

In the props type (around lines 133–140): delete `onResetStackLayout`, `onArrangeStackInGuide`, `stackMoveTogether`, `onStackMoveTogether`, `stackFillGaps`, `onStackFillGaps`; add `onEditStack?: () => void;`. Do the same in the destructuring (around lines 374–380). Replace the Stack section (around line 1961) with:

```tsx
        {selectedBlock?.type === "stack" && onEditStack && (
          <div className="sidebarPanel">
            <CollapsibleSection title="Stacked composition" isOpen={showStack} onToggle={() => setShowStack((v) => !v)}>
              <StackPanel block={selectedBlock} onEdit={onEditStack} />
            </CollapsibleSection>
          </div>
        )}
```

Remove the now-unused imports `GUIDE_SHAPE_LABELS`, `isClosedPath`, `parseSvgPath`, `guidesIn` **only if** nothing else in the file uses them (`guidesIn` is used at line 1832 and 1843 — keep it; run `npm run lint` to find out).

- [ ] **Step 3: `CanvasStage.tsx` — no overlay on the canvas**

In the props type delete lines 176–182 (`onBeginStackEdit` … `stackMoveTogether`) and add `onEditStack: (id: number) => void;`. Mirror in the destructuring (308–313). Replace the stack render block (around 1215–1243) with:

```tsx
              if (block.type === "stack") {
                return (
                  <StackView
                    key={block.id}
                    {...commonProps}
                    {...stackProps(block)}
                    x={block.x}
                    y={block.y}
                    opacity={block.opacity ?? 1}
                    locked={block.locked}
                    isSelected={block.id === selectedId}
                    // Editing lives in the editor window; double-click opens it.
                    onDblClick={() => onEditStack(block.id)}
                  />
                );
              }
```

Delete the `StackEditOverlay` import and, if nothing else uses it, `stackScale`.

- [ ] **Step 4: `App.tsx` — open, commit, guard**

(a) Delete `setStackPieces` (704–716), `splitStackPiece` (718–733), `bendStackCurve` (737–751), `setStackJoinBow` (758–765), `arrangeStackNow` + its ref (2105–2149), `arrangeStackInGuide` (2151–2168), `resetStackLayout` (2170–2178). Keep `stackMoveTogether` / `stackFillGaps` state (752–756).

(b) Next to the `confirmRequest` state (line 316) add:

```ts
  /** The stack block open in the editor window, or null. */
  const [stackEditorId, setStackEditorId] = useState<number | null>(null);
```

(c) In the global key handler (line 1151) change the guard to:

```ts
      // The start overlay and the stack editor window both hide the editor;
      // their shortcuts must not act on the block underneath.
      if (showStart || stackEditorId !== null) return;
```
and add `stackEditorId` to that effect's dependency array (the array near line 1244 that lists `showStart`).

(d) Where `arrangeStackInGuide` was, add (these reference `blocks`, `updateBlock`, `pushHistory`, `shapeText`, `resolveFontUrl`, `fillerShapes`, `teardropShape`, all already imported):

```ts
  const openStackEditor = useCallback((id: number) => {
    const b = blocks.find((x) => x.id === id);
    if (!b || !isStackBlock(b) || b.locked) return;
    setSelectedIds([]);
    setSelectedId(id);
    setStackEditorId(id);
  }, [blocks]);

  /** Done: one history step with the draft's editable fields. */
  const commitStackEditor = useCallback((patch: StackDraft) => {
    if (stackEditorId === null) return;
    updateBlock(stackEditorId, {
      pieces: patch.pieces, joins: patch.joins, fontSize: patch.fontSize, nib: patch.nib,
      x: patch.x, y: patch.y, rotation: patch.rotation,
    });
    setStackEditorId(null);
  }, [stackEditorId, updateBlock]);

  /** The font's tashkeel for the editor's "Fill gaps"; teardrops when the font is unavailable. */
  const loadStackFillers = useCallback(async (b: StackBlock) => {
    try {
      const shaped = await shapeText(b.source.text, resolveFontUrl(b.source.fontFamily));
      return { fillers: fillerShapes(shaped.font, b.unitsPerEm, b.nib.width), note: "" };
    } catch {
      return { fillers: [teardropShape(b.nib.width)], note: " (font unavailable; teardrops used)" };
    }
  }, []);

  const stackEditorBlock = stackEditorId !== null ? blocks.find((b) => b.id === stackEditorId) : undefined;
  const stackEditorGuides = useMemo<StackEditorGuide[]>(
    () => blocks
      .filter((b): b is GuideBlock => b.type === "guide")
      .flatMap((g) => {
        const polygon = containerPolygon(parseSvgPath(g.guideD));
        return polygon ? [{ id: g.id, label: g.name ?? `Guide · ${GUIDE_SHAPE_LABELS[g.guideShape]}`, polygon, x: g.x, y: g.y, rotation: g.rotation ?? 0 }] : [];
      }),
    [blocks]
  );
```

`containerPolygon` returns null for anything not closed, so an open pen guide is filtered here (Review Focus 5). Import `GUIDE_SHAPE_LABELS` from `./lib/guideShapes`, `parseSvgPath` from `./lib/svgPath` (check it is not already imported), `StackEditorDialog, type StackEditorGuide` from `./components/StackEditorDialog`, `type StackDraft` from `./lib/stackDraft`. If `useMemo` is not imported, add it.

(e) Props: in `<Sidebar>` replace the six stack props with `onEditStack={selectedBlock && isStackBlock(selectedBlock) ? () => openStackEditor(selectedBlock.id) : undefined}`. In `<CanvasStage>` replace the six stack props (3595–3600) with `onEditStack={openStackEditor}`.

(f) Mount the dialog beside `<ConfirmDialog>` (line 3620):

```tsx
      {stackEditorBlock && isStackBlock(stackEditorBlock) && (
        <StackEditorDialog
          key={stackEditorBlock.id}
          block={stackEditorBlock}
          surfaceColor={backgroundColor}
          closedGuides={stackEditorGuides}
          moveTogether={stackMoveTogether}
          onMoveTogether={setStackMoveTogether}
          fillGaps={stackFillGaps}
          onFillGaps={setStackFillGaps}
          loadFillers={loadStackFillers}
          onDone={commitStackEditor}
          onCancel={() => setStackEditorId(null)}
        />
      )}
```

`backgroundColor` is the canvas surface state (line 494). The `key` makes a fresh draft per block.

Also: the dialog's `opening` is `useMemo(() => draftOf(block), [block])`, and the mounted `block` object is stable while the dialog is open because nothing changes the block until Done. Do not pass a derived object.

- [ ] **Step 5: Verify**

Run, in order:
```
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm test
npm run build
```
Expected: all clean. Lint will point at any import left unused by the deletions; remove them.

- [ ] **Step 6: Smoke in the browser**

`npm run dev`, add text, Convert to stacked composition, double-click it: the window opens, letters drag inside it, the canvas behind does not change, Done applies, Ctrl+Z on the canvas restores. Pick Teardrop: letters re-flow inside a dashed teardrop centred on the block. Cancel after a drag asks to discard.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "Stack editor: all composition editing moves into the window; canvas stack is select and move"
```

---

### Task 5: e2e — retarget the stack suite and cover the window

**Files:**
- Modify: `e2e/harf.ts` (`namedNodeCount`, `hitTargetAt` get an `editor` option)
- Modify: `e2e/stack.spec.ts`
- Create: `e2e/stack-editor.spec.ts`

**Interfaces:**
- Consumes: `window.__HARF__.getEditorStage()` (Task 3); labels from Global Constraints.
- Produces: `openEditor(page)`, `done(page)` helpers in `e2e/stack.spec.ts` (spec-local).

- [ ] **Step 1: `harf.ts` helpers learn the editor stage**

Change the two helpers so a test can point them at the window:

```ts
export async function namedNodeCount(page: Page, name: string, opts: { editor?: boolean } = {}): Promise<number> {
  return page.evaluate(
    ([n, editor]) => (editor ? window.__HARF__!.getEditorStage() : window.__HARF__!.getStage())?.find(`.${n}`).length ?? 0,
    [name, opts.editor ?? false] as const
  );
}

export async function hitTargetAt(page: Page, point: Point, opts: { editor?: boolean } = {}): Promise<string | null> {
  return page.evaluate(([pt, editor]) => {
    const stage = editor ? window.__HARF__!.getEditorStage() : window.__HARF__!.getStage();
    if (!stage) return null;
    const c = stage.container().getBoundingClientRect();
    const node = stage.getIntersection({ x: pt.x - c.left, y: pt.y - c.top });
    return node ? `${node.getClassName()}.${node.name()}` : null;
  }, [point, opts.editor ?? false] as const);
}
```

Typecheck: `npx tsc --noEmit -p e2e/tsconfig.json`.

- [ ] **Step 2: Retarget `e2e/stack.spec.ts`**

Add two helpers after `convert`:

```ts
/** Open the editor window by double-clicking the composition; wait for its stage. */
async function openEditor(page: Page) {
  const box = await blockClientBox(page, 1);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId("stack-editor").waitFor();
  await page.waitForFunction(() => !!window.__HARF__?.getEditorStage());
  await settleFrames(page);
}

/** Commit the window's draft to the block. */
async function done(page: Page) {
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
}
```

Then, in every `page.evaluate` in this file that reads `window.__HARF__!.getStage()!` to find `.stack-piece`, `.stack-cut`, `.stack-ring`, `.stack-join` or `.stack-curve` nodes (`pieceCentre`, `grabPoint`, `ringPoint`, `findCutSpan`, `joinPoint`, and the bowl helpers in the last test), replace `getStage()` with `getEditorStage()`. Replace `namedNodeCount(page, "stack-…")` with `namedNodeCount(page, "stack-…", { editor: true })` and `hitTargetAt(page, c)` with `hitTargetAt(page, c, { editor: true })` in those tests. In every test after `await convert(page);` add `await openEditor(page);`, and before the assertions that read `piecesOf`/`fullPiecesOf`/`joinsOf` (block state) add `await done(page);`. Where a test performs a second gesture after reading state (the bend test lifts a letter, then bends; the bowl test frees, then double-clicks, then undoes), keep the gestures inside one open window and call `done` once at the end, and read intermediate state through the window's nodes rather than the block (the block's pieces are untouched until Done). Specifically, for the bend test, the "join exists" wait becomes `await expect.poll(() => namedNodeCount(page, "stack-join", { editor: true })).toBeGreaterThan(0);` and the before/after `joinsOf` comparison moves to after `done`. For the bowl test's undo step, replace the canvas Ctrl+Z with the window's: `await page.keyboard.press("Control+z")` while the window is open (the editor's stack handles it), then `done`, then assert the block equals its converted state.

The first test ("converting bakes…undo brings the text back") does not open the window; leave it.

- [ ] **Step 3: Run the retargeted suite**

Run: `npm run e2e -- e2e/stack.spec.ts`
Expected: PASS. If a gesture test fails to find a node, the window's fit scale differs from the canvas: the helpers use `getClientRect()` and `getIntersection` on the editor stage, which are scale-agnostic, so check that the `{ editor: true }` option reached every call before touching tolerances.

- [ ] **Step 4: New spec for the window itself**

```ts
// e2e/stack-editor.spec.ts
import { expect, test, type Page } from "@playwright/test";
import { blockClientBox, getBlocks, gotoApp, namedNodeCount, settleFrames, setBlockText } from "./harf";

/**
 * The stack editor window: opening, staging, templates. Gestures themselves
 * are covered in stack.spec.ts.
 */
const WORD = "مصبح";

type PieceLite = { id: string; role: string; x: number; y: number; rotation: number; parentId?: string; filler?: boolean };
const blockOf = (page: Page) => getBlocks(page).then((b) => b[0] as unknown as { type: string; x: number; y: number; fontSize: number; pieces: PieceLite[] });

/** Same as stack.spec.ts's `convert`. */
async function convert(page: Page) {
  await page.getByLabel("Convert to stacked composition").click();
  await expect.poll(async () => (await blockOf(page)).type).toBe("stack");
  await settleFrames(page);
}

async function openByDoubleClick(page: Page) {
  const box = await blockClientBox(page, 1);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId("stack-editor").waitFor();
  await page.waitForFunction(() => !!window.__HARF__?.getEditorStage());
  await settleFrames(page);
}

/** Centre of the i-th `stack-piece` hit polygon in the window, page px. */
async function pieceCentre(page: Page, index: number) {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getEditorStage()!;
    const node = stage.find(".stack-piece")[i];
    const r = node.getClientRect();
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
  }, index);
}

async function dragPiece(page: Page, index: number, dy: number) {
  const c = await pieceCentre(page, index);
  await page.mouse.move(c.x, c.y);
  await settleFrames(page);
  await page.mouse.down();
  await page.mouse.move(c.x + 1, c.y - 2);
  await page.mouse.move(c.x, c.y + dy, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  await convert(page);
});

test("double-click and the panel button both open the window; Escape closes an untouched one without asking", async ({ page }) => {
  await openByDoubleClick(page);
  expect(await namedNodeCount(page, "stack-piece", { editor: true })).toBeGreaterThan(0);
  // The canvas itself mounts no editing chrome any more.
  expect(await namedNodeCount(page, "stack-piece")).toBe(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  await expect(page.getByRole("dialog", { name: /Discard/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit composition", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor();
});

test("Cancel after a drag leaves the block as it was", async ({ page }) => {
  const before = await blockOf(page);
  await openByDoubleClick(page);
  await dragPiece(page, 1, -60);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  const after = await blockOf(page);
  expect(after.pieces).toEqual(before.pieces);
});

test("Done after a drag commits one history step; Ctrl+Z on the canvas restores", async ({ page }) => {
  const before = await blockOf(page);
  await openByDoubleClick(page);
  await dragPiece(page, 1, -60);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  const after = await blockOf(page);
  expect(after.pieces).not.toEqual(before.pieces);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await blockOf(page)).pieces).toEqual(before.pieces);
});

test("undo inside the window steps the draft, not the canvas", async ({ page }) => {
  const before = await blockOf(page);
  await openByDoubleClick(page);
  await dragPiece(page, 1, -60);
  await page.keyboard.press("Control+z");
  await settleFrames(page);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  expect((await blockOf(page)).pieces).toEqual(before.pieces);
});

test("Teardrop arranges the letters in place: size changes, origin does not, outline shows; Free clears the outline", async ({ page }) => {
  const before = await blockOf(page);
  await openByDoubleClick(page);
  await page.getByRole("button", { name: "Teardrop", exact: true }).click();
  await expect.poll(() => namedNodeCount(page, "stack-template-outline", { editor: true })).toBe(1);
  await expect(page.getByRole("status")).toContainText(/Arranged \d+ letters? in \d+ rows?/);
  await page.getByRole("button", { name: "Free", exact: true }).click();
  await expect.poll(() => namedNodeCount(page, "stack-template-outline", { editor: true })).toBe(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  const after = await blockOf(page);
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  expect(after.fontSize).not.toBe(before.fontSize);
  const letters = (p: PieceLite[]) => p.filter((q) => q.role === "letter" && !q.parentId).length;
  expect(letters(after.pieces)).toBe(letters(before.pieces));
});

test("a later template pick wins over a slower earlier one", async ({ page }) => {
  await openByDoubleClick(page);
  await page.getByRole("button", { name: "Teardrop", exact: true }).click();
  await page.getByRole("button", { name: "Almond", exact: true }).click();
  await expect.poll(() => namedNodeCount(page, "stack-template-outline", { editor: true })).toBe(1);
  await expect(page.getByRole("button", { name: "Almond", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Teardrop", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("only closed guides are offered as cards", async ({ page }) => {
  await openByDoubleClick(page);
  // A fresh document has no guides: Free, Teardrop, Almond and nothing else.
  const cards = page.getByRole("group", { name: "Templates" }).getByRole("button");
  await expect(cards).toHaveCount(3);
});
```

- [ ] **Step 5: Run the new spec**

Run: `npm run e2e -- e2e/stack-editor.spec.ts`
Expected: PASS. Then the full suite: `npm run e2e`.

- [ ] **Step 6: Commit**

```bash
git add e2e/harf.ts e2e/stack.spec.ts e2e/stack-editor.spec.ts
git commit -m "e2e: stack gestures run in the editor window; open, cancel, done, undo, templates"
```

---

### Task 6: Docs — rules note, user guide, PROGRESS

**Files:**
- Modify: `.claude/rules/stacked-compositions.md`
- Modify: `src/components/guide/sections/stacked.tsx`
- Modify: `PROGRESS.md`

- [ ] **Step 1: `stacked-compositions.md`**

Add to the frontmatter `paths:` list:
```yaml
  - "src/components/StackEditorDialog.tsx"
  - "src/lib/stackDraft.ts"
  - "src/lib/stackTemplates.ts"
  - "e2e/stack-editor.spec.ts"
```

Insert a section after "**The editing chrome has no modes and no handles**":

```markdown
**All editing happens in the editor window** (`StackEditorDialog`, since
2026-10-15; spec `docs/superpowers/specs/2026-10-15-stack-editor-window-design.md`).
On the main canvas a stack block is select, move, style, delete; `CanvasStage`
mounts no `StackEditOverlay`. Double-click, or the Stack panel's one button,
opens a portaled modal with its **own Konva stage** that renders the draft
through the same `StackView` + `StackEditOverlay` (the overlay finds its stage
by `getStage()` on its own node, so the `.stackpull` / `.stackbend` listeners
need nothing). **Edits are staged** on a `StackDraft` (`stackDraft.ts`, pure:
patch, bend, split, free, reset, arrange, measure, fit) with an editor-local
`useUndoRedo`; Done is one `updateBlock` only if `draftChanged`; Cancel asks
only if it changed; Escape is Cancel. App's global keydown returns early while
`stackEditorId` is set, like behind the start screen. "Move letters together"
and "Fill gaps" remain App preferences passed through. The view is fit to the
*rotated* ink bounds with a 12% margin (`fitTransform`) so the tilt ring
outside the ink stays reachable; Fit view refits, and an arrange refits on
the next frame. The e2e bridge exposes the window's stage as `getEditorStage`
(set by the dialog in an effect; still read-only).

**Templates** (`stackTemplates.ts`): teardrop and almond are the guide
formulas (`guidePathD`) scaled uniformly so the shape's *height* equals the
draft's ink height × the size slider (50–200%), centred on the block's origin,
so the block never moves. A canvas guide is a card too; picking one arranges
in the guide's frame and sets the draft's `x`/`y`/`rotation` to the guide's,
so Done moves the block onto it (the old "Fill a guide shape"). The arrange
is async (fillers load through App's `loadFillers`); a token drops a result
whose card is no longer the current pick. The outline is a dashed `Line` in
the ink's complement inside the window only — never saved, never exported;
re-opening starts at Free. Reset layout clears it.
```

In the "Fill a guide shape" paragraph, change "chosen in the Stack panel" to "chosen in the editor window (a template or a canvas guide; see above)". Change "**Fillers** … when the panel's "Fill gaps with tashkeel" is on, `App.tsx` loads the block's font…" to "…when the window's "Fill gaps with tashkeel" is on, App's `loadStackFillers` loads the block's font…" and drop the sentence about `arrangeStackNow` / the ref (replace with "The dialog arranges against its draft at completion and pushes one editor-undo step.").

- [ ] **Step 2: User guide section**

In `src/components/guide/sections/stacked.tsx`, after the first paragraph (Convert), replace the second paragraph's opening sentence "That bakes the letters into pieces you can move. There is nothing to switch on:" with:

```tsx
        That bakes the letters into pieces. Double-click the composition (or press{" "}
        <strong>Edit composition</strong>) to open the editor window: it shows the
        composition exactly as the canvas will, and every move you make there is held
        until you press <strong>Done</strong>; <strong>Cancel</strong> puts it back.
        There is nothing to switch on:
```

Replace the "Shape" section with:

```tsx
      <h4>Shape</h4>
      <p>
        In the editor window choose <strong>Teardrop</strong> or <strong>Almond</strong>{" "}
        and the letters are laid in rows inside it, sized to the composition; the{" "}
        <strong>Template size</strong> slider grows or shrinks the shape. A closed guide
        you drew on the canvas is offered too, and with that one the composition moves
        onto the guide when you press Done. Nothing is printed but the letters.
      </p>
```

Add `"editor", "template"` to `keywords`.

- [ ] **Step 3: PROGRESS.md**

Under `## Shipped`, above the "Curved strokes bend" entry:

```markdown
### 2026-10-15 — Stack editor window

- **All composition editing moved into a window.** Double-click a stacked
  composition (or Edit composition in its panel): a modal with its own stage
  shows it as the canvas will, with the gesture guide, Teardrop and Almond
  templates sized to the composition, join thickness, fill gaps, and Reset.
  Edits are staged with their own undo; Done commits one history step,
  Cancel discards. The canvas no longer mounts the overlay. Spec:
  `docs/superpowers/specs/2026-10-15-stack-editor-window-design.md`; how:
  [stacked-compositions.md](.claude/rules/stacked-compositions.md).
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: clean (the guide section is TSX).

```bash
git add .claude/rules/stacked-compositions.md src/components/guide/sections/stacked.tsx PROGRESS.md
git commit -m "Docs: stack editor window — rules note, user guide, progress"
```
