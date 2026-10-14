# Stacked Compositions (tarkib) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A text block can be baked into a `stack` block whose letters are rigid outline pieces that move and tilt, with every join between them re-drawn as a tangent-matched curve of the stroke's own nib weight, spliced back into one outline.

**Architecture:** Three pure modules under `src/lib/` — `stackGeometry.ts` (segments, transforms, splitting an outline at a cut), `stackJoin.ts` (curve synthesis and splicing), `stackConvert.ts` (shaped run → pieces + joins) — plus one assembler (`stackOutline.ts`) that turns a block into path commands. One Konva renderer (`StackView.tsx`) draws those commands; one overlay (`StackEditOverlay.tsx`) edits pieces and joins. `App.tsx` owns the convert handler and the per-frame setters, as it does for every other block type.

**Tech Stack:** React 19 + TypeScript, Konva/react-konva, opentype.js, harfbuzzjs (real fonts in tests via the `shapeReal` pattern), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-stacked-compositions-design.md`

### Deviations from the spec, decided while planning

1. **A tail is a split plus a join.** Cutting a stroke that leads nowhere makes its far fragment a small piece of its own; the ordinary join code connects it. So `StackJoin` has no `kind`/`end` fields, and "tail" needs no code of its own beyond the split action.
2. **Export needs no code.** `useExport` snapshots the Konva stage (PNG/JPEG/PDF) or serialises it with `react-konva-to-svg`; a `Shape` with a `sceneFunc` is what `ShapedText` already uses, so a stack exports the moment it renders.
3. **The piece transform rotates about a stored pivot**, the piece's own outline centre at creation, not its pen origin — rotating a letter about its baseline corner is unusable.
4. **The block stores `unitsPerEm`.** Font units mean nothing without it, and the font may be gone later.
5. **Fallback tatweel insertion runs only when `shapableText === text`.** Cluster offsets index the shapable text; a block whose unsupported marks were stripped has offsets the kashida code cannot use. Such pairs stay unjoined (rigid, no curve) rather than mis-inserted.
6. **Conversion refuses** a block with `warpX`/`warpY` set, or whose text contains an honorific override glyph (`isOverrideGlyphChar`), with a status message. Both draw something other than the font's outline.

## Global Constraints

- All geometry stored on the block is in **font units, y-down** (opentype.js `getPath` negates y), scaled by `fontSize / unitsPerEm` only at draw time.
- `stackGeometry.ts`, `stackJoin.ts`, `stackOutline.ts`, `stackConvert.ts` import **nothing from `./harfbuzz`** (its static `harfbuzzjs` import throws under Vitest). Type-only imports are fine.
- Tests that need shaping use **real harfbuzzjs and real fonts from `public/fonts/`** via a `shapeReal` helper copied from `src/lib/diacritics.test.ts`; never hand-written glyph fixtures.
- Every drag pushes history **once at drag start** (`onBegin*` = `pushHistory`); per-frame setters never push.
- Outline is stroked **before** the fill (CLAUDE.md, "Rendering").
- No `as Block` casts outside the two existing update paths in `App.tsx`.
- The verification loop after each task: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`. The pre-commit hook bumps `package.json`'s patch; expect it in every diff.
- Commit messages end with the attribution lines in effect for the session.

## Review Focus

Inputs the spec implies but no task's tests exercise until they are added below:

1. **A word with no joins at all** (e.g. `ا د ر`, every letter non-joining) → converts to rigid pieces with an empty `joins` array and renders identically; nothing throws. Pinned in Task 5.
2. **A cut whose zone yields other than two crossings** (a dot contour straddling the cut line) → `splitAtCut` returns `null` and the pair is reported unjoined rather than producing a torn outline. Pinned in Task 2.
3. **Dragging a letter when a later piece has been rotated** → the chain moves rigidly (rotation unchanged, relative positions preserved); the join re-solves. Pinned in Task 8 (unit test on the chain helper).
4. **A stack block in a project loaded by this build** whose `unitsPerEm` is missing (hand-edited save) → renderer uses 1000, not NaN. Pinned in Task 7.
5. **Old builds loading a project with a `stack` block** → documented: `CanvasStage`'s fallthrough returns `null` for an unknown type, so nothing crashes; the block is invisible. Not testable here; recorded in the rules note (Task 12).

---

### Task 1: Types, capability guard, and plumbing that must not forget the new type

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/blockCapabilities.ts`
- Modify: `src/lib/blockRenderProps.ts`
- Modify: `src/lib/strokeCuts.ts` (export three private helpers)
- Test: `src/lib/blockCapabilities.test.ts` (create)

**Interfaces:**
- Produces: `StackBlock`, `StackPiece`, `StackJoin`, `CutFace` types; `isStackBlock(b)`; `stackProps(b)`; exported `splitCubic`, `splitQuad`, `tAtX` from `strokeCuts.ts`.

- [ ] **Step 1: Add the types**

In `src/types.ts`, after the `GuideBlock` declaration, add:

```ts
import type { SvgCmd } from "./lib/svgPath";
import type { Pt } from "./lib/strokeCuts";

/** The two outline points on a cut line and the stroke's outward direction
 *  there (radians, pointing away from the piece), piece-local font units. */
export type CutFace = { a: Pt; b: Pt; tangent: number };

export type StackPiece = {
  id: string;
  /** Closed contours, piece-local font units, cut faces closed by a straight
   *  bridge edge between `face.a` and `face.b`. */
  cmds: SvgCmd[];
  /** Placement relative to the block origin, font units. */
  x: number;
  y: number;
  /** Radians, about `pivot`. */
  rotation: number;
  /** Piece-local point the rotation turns about — the outline centre when
   *  the piece was made. Stored, not derived: a later split would move it. */
  pivot: Pt;
  /** Where "Reset layout" returns the piece to. */
  homeX: number;
  homeY: number;
  /** Reading order; a drag carries every piece with a greater order. */
  order: number;
  role: "letter" | "mark";
  /** Marks: the letter they ride with. */
  parentId?: string;
  faces: CutFace[];
};

export type StackJoin = {
  id: string;
  from: { pieceId: string; faceIndex: number };
  to: { pieceId: string; faceIndex: number };
  /** Scales the curve's handles: 0 is the tangent-matched default. */
  bow: number;
  /** Made from an inserted tatweel rather than a cut in the letter. */
  fallback?: true;
};

/** A text block baked into movable letter pieces joined by synthesised
 *  curves. One-way; the spelling cannot be edited. */
export type StackBlock = BlockCommon & {
  type: "stack";
  source: { text: string; fontFamily: string };
  unitsPerEm: number;
  nib: { width: number; minFraction: number };
  pieces: StackPiece[];
  joins: StackJoin[];
  /** Arms the split handles on cuttable strokes. */
  stackTailMode?: boolean;
};
```

Add `"stack"` to `BlockType` and `| StackBlock` to the `Block` union. Place the two `import type` lines with the file's other imports.

- [ ] **Step 2: Export the three private helpers from `strokeCuts.ts`**

Change `function splitCubic(`, `function splitQuad(`, and `function tAtX(` to `export function …`. No other change.

- [ ] **Step 3: Capability guard and render props**

Append to `src/lib/blockCapabilities.ts`:

```ts
export const isStackBlock = (b: Block): b is Extract<Block, { type: "stack" }> =>
  b.type === "stack";
```

Append to `src/lib/blockRenderProps.ts`:

```ts
export const stackProps = (b: Extract<Block, { type: "stack" }>) => ({
  ...typographicProps(b),
  pieces: b.pieces,
  joins: b.joins,
  nib: b.nib,
  unitsPerEm: b.unitsPerEm,
});
```

- [ ] **Step 4: Write the test**

Create `src/lib/blockCapabilities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isStackBlock, supportsStrokeCuts, supportsGlyphAlternates, supportsDiacriticOverrides,
} from "./blockCapabilities";
import type { Block } from "../types";

const stack = {
  id: 1, type: "stack", text: "مصبح", x: 0, y: 0, fontSize: 53, color: "#000",
  fontFamily: "UKIJDiwani", stroke: "#000", shadowColor: "#000",
  source: { text: "مصبح", fontFamily: "UKIJDiwani" }, unitsPerEm: 1000,
  nib: { width: 110, minFraction: 0.15 }, pieces: [], joins: [],
} as Block;

describe("stack capability", () => {
  it("is its own kind and has none of the live-text capabilities", () => {
    expect(isStackBlock(stack)).toBe(true);
    expect(supportsStrokeCuts(stack)).toBe(false);
    expect(supportsGlyphAlternates(stack)).toBe(false);
    expect(supportsDiacriticOverrides(stack)).toBe(false);
  });
});
```

- [ ] **Step 5: Run typecheck and the test**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx vitest run src/lib/blockCapabilities.test.ts`
Expected: typecheck passes (no code dispatches on `"stack"` yet, and the if-chains fall through) and the test passes.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lib/blockCapabilities.ts src/lib/blockCapabilities.test.ts src/lib/blockRenderProps.ts src/lib/strokeCuts.ts
git commit -m "Stack block: types, capability guard, render props"
```

---

### Task 2: `stackGeometry.ts` — segments, transforms, splitting an outline at a cut

**Files:**
- Create: `src/lib/stackGeometry.ts`
- Test: `src/lib/stackGeometry.test.ts`

**Interfaces:**
- Consumes: `SvgCmd` (`./svgPath`), `Pt`, `rotateCmds`, `splitCubic`, `splitQuad`, `tAtX`, `outlineBounds` (`./strokeCuts`), `CutFace`, `StackPiece` (`../types`).
- Produces:
  - `type Seg = { type: "L" | "Q" | "C"; p: Pt[] }` — `p[0]` start, last is end.
  - `toSegments(cmds: SvgCmd[]): Seg[][]`, `fromSegments(contours: Seg[][]): SvgCmd[]`
  - `type PieceTransform = { x: number; y: number; rotation: number; pivot: Pt }`
  - `transformPt(p: Pt, t: PieceTransform): Pt`, `transformCmds(cmds, t)`, `transformFace(face, t)`
  - `translateCmds(cmds, dx, dy)`, `cmdsCentre(cmds): Pt`
  - `splitAtCut(cmds, cut: { cutX: number; angle: number }): { near: SvgCmd[]; far: SvgCmd[]; nearFace: CutFace; farFace: CutFace } | null`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/stackGeometry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toSegments, fromSegments, transformPt, transformCmds, transformFace, splitAtCut, cmdsCentre,
} from "./stackGeometry";
import { flattenContours } from "./strokeCuts";
import type { SvgCmd } from "./svgPath";

/** A 100×20 bar from (0,-10) to (100,10): one straight horizontal stroke. */
const BAR: SvgCmd[] = [
  { type: "M", x: 0, y: -10 }, { type: "L", x: 100, y: -10 },
  { type: "L", x: 100, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" },
];

const area = (cmds: SvgCmd[]) =>
  flattenContours(cmds).reduce((sum, c) => {
    let a = 0;
    for (let i = 0; i + 1 < c.length; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1];
    return sum + Math.abs(a) / 2;
  }, 0);

describe("segments", () => {
  it("round-trips commands, closing an open contour with an explicit edge", () => {
    const segs = toSegments(BAR);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toHaveLength(4);
    expect(area(fromSegments(segs))).toBeCloseTo(2000, 6);
  });
});

describe("transform", () => {
  const t = { x: 5, y: 7, rotation: Math.PI / 2, pivot: [50, 0] as [number, number] };
  it("rotates about the pivot then translates", () => {
    const p = transformPt([100, 0], t);
    expect(p[0]).toBeCloseTo(55, 9);
    expect(p[1]).toBeCloseTo(57, 9);
  });
  it("moves a face's points and turns its tangent", () => {
    const f = transformFace({ a: [100, -10], b: [100, 10], tangent: 0 }, t);
    expect(f.tangent).toBeCloseTo(Math.PI / 2, 9);
    expect(f.a[0]).toBeCloseTo(65, 9);
  });
  it("keeps the area of a transformed outline", () => {
    expect(area(transformCmds(BAR, t))).toBeCloseTo(2000, 6);
  });
  it("centres on the outline's bounds", () => {
    expect(cmdsCentre(BAR)).toEqual([50, 0]);
  });
});

describe("splitAtCut", () => {
  it("splits a bar into two closed halves whose areas sum to the whole", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 });
    expect(r).not.toBeNull();
    expect(area(r!.near)).toBeCloseTo(800, 6);
    expect(area(r!.far)).toBeCloseTo(1200, 6);
  });
  it("reports the same two face points on both halves, tangents opposed", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const xs = [r.nearFace.a, r.nearFace.b].map((p) => p[0]);
    expect(xs).toEqual([40, 40]);
    expect(r.farFace.a).toEqual(r.nearFace.a);
    expect(r.farFace.b).toEqual(r.nearFace.b);
    expect(Math.abs(r.farFace.tangent - r.nearFace.tangent)).toBeCloseTo(Math.PI, 9);
    expect(r.nearFace.tangent).toBe(0);
  });
  it("closes each half with a straight bridge between the face points", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const isBridge = (s: { type: string; p: [number, number][] }) =>
      s.type === "L" && s.p[0][0] === 40 && s.p[1][0] === 40;
    expect(toSegments(r.near)[0].some(isBridge)).toBe(true);
    expect(toSegments(r.far)[0].some(isBridge)).toBe(true);
  });
  it("cuts an inclined bar in its own frame", () => {
    const tilted = transformCmds(BAR, { x: 0, y: 0, rotation: 0.3, pivot: [0, 0] });
    const r = splitAtCut(tilted, { cutX: 40, angle: 0.3 })!;
    expect(area(r.near) + area(r.far)).toBeCloseTo(2000, 4);
    expect(r.nearFace.tangent).toBeCloseTo(0.3, 9);
  });
  it("splits a curved edge without losing area", () => {
    const curved: SvgCmd[] = [
      { type: "M", x: 0, y: -10 },
      { type: "C", x1: 30, y1: -20, x2: 70, y2: -20, x: 100, y: -10 },
      { type: "L", x: 100, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" },
    ];
    const whole = area(curved);
    const r = splitAtCut(curved, { cutX: 50, angle: 0 })!;
    expect(area(r.near) + area(r.far)).toBeCloseTo(whole, 1);
  });
  it("sends an uncrossed contour whole to the side it lies on", () => {
    const withDot: SvgCmd[] = [
      ...BAR,
      { type: "M", x: 80, y: -30 }, { type: "L", x: 90, y: -30 },
      { type: "L", x: 90, y: -20 }, { type: "L", x: 80, y: -20 }, { type: "Z" },
    ];
    const r = splitAtCut(withDot, { cutX: 40, angle: 0 })!;
    expect(toSegments(r.near)).toHaveLength(1);
    expect(toSegments(r.far)).toHaveLength(2);
  });
  it("returns null when the cut line crosses a contour other than twice", () => {
    // A U shape: x=40 crosses it four times.
    const u: SvgCmd[] = [
      { type: "M", x: 0, y: -30 }, { type: "L", x: 100, y: -30 }, { type: "L", x: 100, y: 30 },
      { type: "L", x: 0, y: 30 }, { type: "L", x: 0, y: 10 }, { type: "L", x: 80, y: 10 },
      { type: "L", x: 80, y: -10 }, { type: "L", x: 0, y: -10 }, { type: "Z" },
    ];
    expect(splitAtCut(u, { cutX: 40, angle: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/stackGeometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/stackGeometry.ts`:

```ts
// Geometry for stack blocks: outlines as segment lists, rigid piece
// transforms, and splitting an outline into two closed halves at a cut.
// Pure — no React, no Konva, no ./harfbuzz.
import type { SvgCmd } from "./svgPath";
import type { CutFace } from "../types";
import {
  type Pt, rotateCmds, splitCubic, splitQuad, tAtX, outlineBounds,
} from "./strokeCuts";

export type Seg = { type: "L" | "Q" | "C"; p: Pt[] };

const EPS = 1e-9;
const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

/** Commands → contours of segments. Every contour is closed explicitly, so
 *  the segment implied by Z (or by a missing Z) is a real `L`. */
export function toSegments(cmds: SvgCmd[]): Seg[][] {
  const out: Seg[][] = [];
  let cur: Seg[] = [];
  let start: Pt = [0, 0];
  let pos: Pt = [0, 0];
  const close = () => {
    if (cur.length === 0) return;
    if (!same(pos, start)) cur.push({ type: "L", p: [pos, start] });
    out.push(cur);
    cur = [];
  };
  for (const c of cmds) {
    switch (c.type) {
      case "M": close(); start = pos = [c.x, c.y]; break;
      case "L": { const e: Pt = [c.x, c.y]; cur.push({ type: "L", p: [pos, e] }); pos = e; break; }
      case "Q": { const e: Pt = [c.x, c.y]; cur.push({ type: "Q", p: [pos, [c.x1, c.y1], e] }); pos = e; break; }
      case "C": { const e: Pt = [c.x, c.y]; cur.push({ type: "C", p: [pos, [c.x1, c.y1], [c.x2, c.y2], e] }); pos = e; break; }
      case "Z": close(); pos = start; break;
    }
  }
  close();
  return out;
}

export function fromSegments(contours: Seg[][]): SvgCmd[] {
  const out: SvgCmd[] = [];
  for (const segs of contours) {
    if (segs.length === 0) continue;
    const [sx, sy] = segs[0].p[0];
    out.push({ type: "M", x: sx, y: sy });
    for (const s of segs) {
      const e = s.p[s.p.length - 1];
      if (s.type === "L") out.push({ type: "L", x: e[0], y: e[1] });
      else if (s.type === "Q") out.push({ type: "Q", x1: s.p[1][0], y1: s.p[1][1], x: e[0], y: e[1] });
      else out.push({ type: "C", x1: s.p[1][0], y1: s.p[1][1], x2: s.p[2][0], y2: s.p[2][1], x: e[0], y: e[1] });
    }
    out.push({ type: "Z" });
  }
  return out;
}

export type PieceTransform = { x: number; y: number; rotation: number; pivot: Pt };

/** world = R(p − pivot) + pivot + (x, y) */
export function transformPt(p: Pt, t: PieceTransform): Pt {
  const c = Math.cos(t.rotation), s = Math.sin(t.rotation);
  const dx = p[0] - t.pivot[0], dy = p[1] - t.pivot[1];
  return [dx * c - dy * s + t.pivot[0] + t.x, dx * s + dy * c + t.pivot[1] + t.y];
}

export function translateCmds(cmds: SvgCmd[], dx: number, dy: number): SvgCmd[] {
  return cmds.map((c) => {
    switch (c.type) {
      case "M": case "L": return { ...c, x: c.x + dx, y: c.y + dy };
      case "Q": return { ...c, x: c.x + dx, y: c.y + dy, x1: c.x1 + dx, y1: c.y1 + dy };
      case "C": return { ...c, x: c.x + dx, y: c.y + dy, x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy };
      default: return c;
    }
  });
}

export function transformCmds(cmds: SvgCmd[], t: PieceTransform): SvgCmd[] {
  const [px, py] = t.pivot;
  return translateCmds(rotateCmds(translateCmds(cmds, -px, -py), t.rotation), px + t.x, py + t.y);
}

export function transformFace(f: CutFace, t: PieceTransform): CutFace {
  return { a: transformPt(f.a, t), b: transformPt(f.b, t), tangent: f.tangent + t.rotation };
}

export function cmdsCentre(cmds: SvgCmd[]): Pt {
  const b = outlineBounds(cmds);
  return [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
}

/** x(t) of a segment. */
function xAt(s: Seg, t: number): number {
  const p = s.p, u = 1 - t;
  if (s.type === "L") return p[0][0] + (p[1][0] - p[0][0]) * t;
  if (s.type === "Q") return u * u * p[0][0] + 2 * u * t * p[1][0] + t * t * p[2][0];
  return u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
}

/** Split a segment where it crosses x = cutX, returning [before, after]. */
function splitSegAtX(s: Seg, cutX: number): [Seg, Seg] {
  if (s.type === "L") {
    const t = (cutX - s.p[0][0]) / (s.p[1][0] - s.p[0][0]);
    const m: Pt = [cutX, s.p[0][1] + (s.p[1][1] - s.p[0][1]) * t];
    return [{ type: "L", p: [s.p[0], m] }, { type: "L", p: [m, s.p[1]] }];
  }
  const t = tAtX(cutX, (tt) => xAt(s, tt));
  if (s.type === "Q") {
    const [L, R] = splitQuad(s.p[0], s.p[1], s.p[2], t);
    L[2] = [cutX, L[2][1]]; R[0] = L[2];
    return [{ type: "Q", p: L }, { type: "Q", p: R }];
  }
  const [L, R] = splitCubic(s.p[0], s.p[1], s.p[2], s.p[3], t);
  L[3] = [cutX, L[3][1]]; R[0] = L[3];
  return [{ type: "C", p: L }, { type: "C", p: R }];
}

/**
 * Split an outline into the part on the near side (x < cutX in the cut's
 * frame) and the far side, each closed with a straight bridge edge between
 * the two crossing points. Those two points, with the stroke direction, are
 * the faces a join is later drawn between. Null if any contour crosses the
 * cut line other than 0 or 2 times — the cut is not a legal stroke cut.
 */
export function splitAtCut(
  cmds: SvgCmd[], cut: { cutX: number; angle: number }
): { near: SvgCmd[]; far: SvgCmd[]; nearFace: CutFace; farFace: CutFace } | null {
  const contours = toSegments(rotateCmds(cmds, -cut.angle));
  const near: Seg[][] = [], far: Seg[][] = [];
  let face: [Pt, Pt] | null = null;
  const isNear = (x: number) => x < cut.cutX;

  for (const segs of contours) {
    const crossing = segs.map((s) => isNear(s.p[0][0]) !== isNear(s.p[s.p.length - 1][0]));
    const n = crossing.filter(Boolean).length;
    if (n === 0) { (isNear(segs[0].p[0][0]) ? near : far).push(segs); continue; }
    if (n !== 2 || face) return null;
    const i1 = crossing.indexOf(true), i2 = crossing.indexOf(true, i1 + 1);
    const [a1, b1] = splitSegAtX(segs[i1], cut.cutX);
    const [a2, b2] = splitSegAtX(segs[i2], cut.cutX);
    const c1 = a1.p[a1.p.length - 1], c2 = a2.p[a2.p.length - 1];
    const runA = [...segs.slice(0, i1), a1];                 // start → c1
    const runB = [b1, ...segs.slice(i1 + 1, i2), a2];        // c1 → c2
    const runC = [b2, ...segs.slice(i2 + 1)];                // c2 → start
    const sideB = [...runB, { type: "L" as const, p: [c2, c1] }];
    const sideAC = [...runC, ...runA, { type: "L" as const, p: [c1, c2] }];
    const bIsNear = isNear(segs[i1].p[segs[i1].p.length - 1][0]);
    (bIsNear ? near : far).push(sideB);
    (bIsNear ? far : near).push(sideAC);
    face = [c1, c2];
  }
  if (!face) return null;

  const back = (c: Seg[][]) => rotateCmds(fromSegments(c), cut.angle);
  const rot = (p: Pt): Pt => {
    const c = Math.cos(cut.angle), s = Math.sin(cut.angle);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  };
  const a = rot(face[0]), b = rot(face[1]);
  return {
    near: back(near), far: back(far),
    nearFace: { a, b, tangent: cut.angle },
    farFace: { a, b, tangent: cut.angle + Math.PI },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackGeometry.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stackGeometry.ts src/lib/stackGeometry.test.ts
git commit -m "Stack geometry: segments, piece transforms, splitting an outline at a cut"
```

---

### Task 3: `stackJoin.ts` — the curve between two faces, and splicing it in

**Files:**
- Create: `src/lib/stackJoin.ts`
- Test: `src/lib/stackJoin.test.ts`

**Interfaces:**
- Consumes: `Seg`, `toSegments`, `fromSegments`, `splitAtCut` (`./stackGeometry`), `CutFace`, `Pt`.
- Produces:
  - `joinCenterline(A: CutFace, B: CutFace, bow: number): [Pt, Pt, Pt, Pt]`
  - `joinEdges(A, B, bow, minWidth, samples?): { edgeA: Pt[]; edgeB: Pt[] }` — `edgeA` runs `A.a → B.a`, `edgeB` runs `A.b → B.b`.
  - `spliceJoin(contours: Seg[][], faceN: CutFace, faceF: CutFace, edges): Seg[][] | null` — replaces the two contours carrying those faces' bridges with one.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/stackJoin.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { joinCenterline, joinEdges, spliceJoin } from "./stackJoin";
import { splitAtCut, toSegments, fromSegments } from "./stackGeometry";
import { flattenContours } from "./strokeCuts";
import type { CutFace } from "../types";
import type { SvgCmd } from "./svgPath";

const A: CutFace = { a: [0, -10], b: [0, 10], tangent: 0 };
/** 100 to the right and 50 up, facing back. */
const B: CutFace = { a: [100, -60], b: [100, -40], tangent: Math.PI };
const dist = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);

describe("joinCenterline", () => {
  it("starts and ends at the face midpoints, leaving and arriving along the tangents", () => {
    const [p0, p1, p2, p3] = joinCenterline(A, B, 0);
    expect(p0).toEqual([0, 0]);
    expect(p3).toEqual([100, -50]);
    expect(p1[1]).toBeCloseTo(0, 9);       // handle along A's tangent (+x)
    expect(p1[0]).toBeGreaterThan(0);
    expect(p2[1]).toBeCloseTo(-50, 9);     // handle along B's tangent (−x)
    expect(p2[0]).toBeLessThan(100);
  });
  it("bow lengthens both handles without turning them", () => {
    const [, p1a, p2a] = joinCenterline(A, B, 0);
    const [, p1b, p2b] = joinCenterline(A, B, 0.5);
    expect(p1b[0]).toBeGreaterThan(p1a[0]);
    expect(p2b[0]).toBeLessThan(p2a[0]);
    expect(p1b[1]).toBeCloseTo(0, 9);
  });
});

describe("joinEdges", () => {
  it("lands exactly on the four face points", () => {
    const { edgeA, edgeB } = joinEdges(A, B, 0, 3);
    expect(dist(edgeA[0], A.a)).toBeLessThan(1e-9);
    expect(dist(edgeB[0], A.b)).toBeLessThan(1e-9);
    expect(dist(edgeA[edgeA.length - 1], B.a)).toBeLessThan(1e-9);
    expect(dist(edgeB[edgeB.length - 1], B.b)).toBeLessThan(1e-9);
  });
  it("is full width where the curve crosses the nib and never thinner than the floor", () => {
    // Both faces have a vertical vector and face each other across a climb:
    // A leaves to the right, `up` sits 100 above and leaves to the left, so
    // the S-curve between them runs vertically — along the nib — mid-way.
    const up: CutFace = { a: [0, -110], b: [0, -90], tangent: Math.PI };
    const { edgeA, edgeB } = joinEdges(A, up, 0, 4, 40);
    const widths = edgeA.map((p, i) => dist(p, edgeB[i]));
    expect(widths[0]).toBeCloseTo(20, 6);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(4 - 1e-9);
    expect(Math.min(...widths)).toBeLessThan(20);   // it does thin on the climb
  });
  it("collapses to the face points when the faces coincide", () => {
    const { edgeA, edgeB } = joinEdges(A, { ...A, tangent: Math.PI }, 0, 3, 8);
    for (const p of edgeA) expect(dist(p, A.a)).toBeLessThan(1e-9);
    for (const p of edgeB) expect(dist(p, A.b)).toBeLessThan(1e-9);
  });
});

const BAR: SvgCmd[] = [
  { type: "M", x: 0, y: -10 }, { type: "L", x: 100, y: -10 },
  { type: "L", x: 100, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" },
];
const area = (cmds: SvgCmd[]) =>
  flattenContours(cmds).reduce((sum, c) => {
    let a = 0;
    for (let i = 0; i + 1 < c.length; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1];
    return sum + Math.abs(a) / 2;
  }, 0);

describe("spliceJoin", () => {
  it("re-joins a split bar into exactly the original single contour", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const pool = [...toSegments(r.near), ...toSegments(r.far)];
    const edges = joinEdges(r.nearFace, r.farFace, 0, 3, 4);
    const out = spliceJoin(pool, r.nearFace, r.farFace, edges)!;
    expect(out).toHaveLength(1);
    expect(area(fromSegments(out))).toBeCloseTo(2000, 6);
    // No bridge edge survives.
    const bridges = out[0].filter((s) => s.type === "L" && s.p[0][0] === 40 && s.p[1][0] === 40);
    expect(bridges).toHaveLength(0);
  });
  it("makes one closed contour when the far half has moved", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const lifted = toSegments(r.far).map((c) => c.map((s) => ({ ...s, p: s.p.map(([x, y]) => [x + 30, y - 60] as [number, number]) })));
    const farFace = { a: [70, -70] as [number, number], b: [70, -50] as [number, number], tangent: Math.PI };
    const pool = [...toSegments(r.near), ...lifted];
    const out = spliceJoin(pool, r.nearFace, farFace, joinEdges(r.nearFace, farFace, 0, 3))!;
    expect(out).toHaveLength(1);
    expect(area(fromSegments(out))).toBeGreaterThan(2000);
  });
  it("returns null when a face's bridge is not in the pool", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const pool = toSegments(r.near);
    expect(spliceJoin(pool, r.nearFace, r.farFace, joinEdges(r.nearFace, r.farFace, 0, 3))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/stackJoin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/stackJoin.ts`:

```ts
// The curve a stack block draws between two cut faces, and the splice that
// makes it part of one outline. Pure — no React, Konva or ./harfbuzz.
import type { CutFace } from "../types";
import type { Pt } from "./strokeCuts";
import type { Seg } from "./stackGeometry";

const EPS = 1e-6;
const near = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS;
const mid = (f: CutFace): Pt => [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];

/** Cubic from A's midpoint to B's, leaving along A's outward tangent and
 *  arriving along B's. Handles are chord × (1/3 + bow) so a bend never
 *  breaks the tangent match. */
export function joinCenterline(A: CutFace, B: CutFace, bow: number): [Pt, Pt, Pt, Pt] {
  const m0 = mid(A), m3 = mid(B);
  const chord = Math.hypot(m3[0] - m0[0], m3[1] - m0[1]);
  const h = chord * (1 / 3 + bow);
  return [
    m0,
    [m0[0] + h * Math.cos(A.tangent), m0[1] + h * Math.sin(A.tangent)],
    [m3[0] + h * Math.cos(B.tangent), m3[1] + h * Math.sin(B.tangent)],
    m3,
  ];
}

function bezierAt([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function bezierTangent([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  return [
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]),
  ];
}

/**
 * The join's two edges. The face vector (a→b) is the pen's cross-section
 * where the stroke was cut, so the edges are the centerline ± half of a
 * vector interpolated from A's to B's: full width across it, thin along it —
 * a broad-edge nib with nothing to measure. `minWidth` is the floor on the
 * thickness perpendicular to the curve, never applied at the two ends so
 * the edges land on the faces exactly.
 */
export function joinEdges(
  A: CutFace, B: CutFace, bow: number, minWidth: number, samples = 24
): { edgeA: Pt[]; edgeB: Pt[] } {
  const cl = joinCenterline(A, B, bow);
  const vA: Pt = [A.b[0] - A.a[0], A.b[1] - A.a[1]];
  const vB: Pt = [B.b[0] - B.a[0], B.b[1] - B.a[1]];
  const edgeA: Pt[] = [], edgeB: Pt[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const c = bezierAt(cl, t);
    let v: Pt = [vA[0] + (vB[0] - vA[0]) * t, vA[1] + (vB[1] - vA[1]) * t];
    if (i > 0 && i < samples) {
      let [dx, dy] = bezierTangent(cl, t);
      const len = Math.hypot(dx, dy);
      if (len < EPS) { dx = Math.cos(A.tangent); dy = Math.sin(A.tangent); }
      else { dx /= len; dy /= len; }
      const n: Pt = [-dy, dx];
      const along = v[0] * n[0] + v[1] * n[1];
      const w = Math.abs(along);
      if (w < minWidth) {
        const sign = along >= 0 ? 1 : -1;
        v = [v[0] + n[0] * sign * (minWidth - w), v[1] + n[1] * sign * (minWidth - w)];
      }
    }
    edgeA.push([c[0] - v[0] / 2, c[1] - v[1] / 2]);
    edgeB.push([c[0] + v[0] / 2, c[1] + v[1] / 2]);
  }
  return { edgeA, edgeB };
}

type Found = { contour: number; seg: number; startsAtA: boolean };

/** The straight bridge edge a split left between a face's two points. */
function findBridge(contours: Seg[][], f: CutFace): Found | null {
  for (let ci = 0; ci < contours.length; ci++) {
    const segs = contours[ci];
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      if (s.type !== "L") continue;
      if (near(s.p[0], f.a) && near(s.p[1], f.b)) return { contour: ci, seg: si, startsAtA: true };
      if (near(s.p[0], f.b) && near(s.p[1], f.a)) return { contour: ci, seg: si, startsAtA: false };
    }
  }
  return null;
}

/** The contour's segments walked from just after the bridge round to just
 *  before it: a path from the bridge's end point to its start point. */
function walkWithout(segs: Seg[], bridge: number): Seg[] {
  return [...segs.slice(bridge + 1), ...segs.slice(0, bridge)];
}

function reversed(segs: Seg[]): Seg[] {
  return segs.map((s) => ({ ...s, p: [...s.p].reverse() })).reverse();
}

const polyline = (pts: Pt[]): Seg[] => {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push({ type: "L", p: [pts[i], pts[i + 1]] });
  return out;
};

/**
 * Replace the two contours carrying `faceN`'s and `faceF`'s bridge edges
 * with one contour: N without its bridge, the edge from N's end point to F's
 * matching point, F without its bridge, and the other edge back. This is
 * what makes a join seam-free under outlines, shadows and SVG export.
 */
export function spliceJoin(
  contours: Seg[][], faceN: CutFace, faceF: CutFace, edges: { edgeA: Pt[]; edgeB: Pt[] }
): Seg[][] | null {
  const n = findBridge(contours, faceN);
  const f = findBridge(contours, faceF);
  if (!n || !f || n.contour === f.contour) return null;

  // N's walk runs from its bridge's end to its bridge's start.
  const nWalk = walkWithout(contours[n.contour], n.seg);
  const nEndsAtA = n.startsAtA;                 // bridge a→b means the walk ends at a
  const out = nEndsAtA ? edges.edgeA : edges.edgeB;   // leave N at the point it ended on
  const back = nEndsAtA ? edges.edgeB : edges.edgeA;

  // F's walk must start at the same label N ended on.
  let fWalk = walkWithout(contours[f.contour], f.seg);
  const fWalkStartsAtA = !f.startsAtA;          // bridge b→a means the walk starts at a
  if (fWalkStartsAtA !== nEndsAtA) fWalk = reversed(fWalk);

  const merged: Seg[] = [...nWalk, ...polyline(out), ...fWalk, ...polyline([...back].reverse())];
  const rest = contours.filter((_, i) => i !== n.contour && i !== f.contour);
  return [...rest, merged];
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackJoin.test.ts`
Expected: PASS. If "is full width where the curve crosses the nib…" fails on the minimum, check the floor sign logic before touching the test: widths must reach the floor from above, never dip below.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stackJoin.ts src/lib/stackJoin.test.ts
git commit -m "Stack joins: nib-weighted curve between two cut faces, spliced into one contour"
```

---

### Task 4: `stackOutline.ts` — a block's pieces and joins as one path

**Files:**
- Create: `src/lib/stackOutline.ts`
- Test: `src/lib/stackOutline.test.ts`

**Interfaces:**
- Consumes: `StackPiece`, `StackJoin`, `transformCmds`, `transformFace`, `toSegments`, `fromSegments`, `joinEdges`, `spliceJoin`.
- Produces:
  - `pieceTransform(p: StackPiece): PieceTransform`
  - `assembleStackOutline(pieces, joins, nib: { width; minFraction }): SvgCmd[]` — block-space font units.
  - `chainOf(pieces, pieceId, alone: boolean): string[]` — ids a drag of `pieceId` carries.
  - `rebasePiece(p: StackPiece, cmds: SvgCmd[]): StackPiece` — a piece with new local commands whose world placement is unchanged (new pivot, adjusted x/y).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/stackOutline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assembleStackOutline, chainOf, rebasePiece, pieceTransform } from "./stackOutline";
import { splitAtCut, transformPt, cmdsCentre } from "./stackGeometry";
import { flattenContours } from "./strokeCuts";
import type { StackPiece, StackJoin } from "../types";
import type { SvgCmd } from "./svgPath";

const BAR: SvgCmd[] = [
  { type: "M", x: 0, y: -10 }, { type: "L", x: 100, y: -10 },
  { type: "L", x: 100, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" },
];
const NIB = { width: 20, minFraction: 0.15 };
const piece = (id: string, cmds: SvgCmd[], order: number, extra: Partial<StackPiece> = {}): StackPiece => ({
  id, cmds, x: 0, y: 0, rotation: 0, pivot: cmdsCentre(cmds), homeX: 0, homeY: 0,
  order, role: "letter", faces: [], ...extra,
});
const area = (cmds: SvgCmd[]) =>
  flattenContours(cmds).reduce((sum, c) => {
    let a = 0;
    for (let i = 0; i + 1 < c.length; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1];
    return sum + Math.abs(a) / 2;
  }, 0);

function splitBar() {
  const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
  const left = piece("L", r.near, 1, { faces: [r.nearFace] });
  const right = piece("R", r.far, 0, { faces: [r.farFace] });
  const join: StackJoin = { id: "j", from: { pieceId: "R", faceIndex: 0 }, to: { pieceId: "L", faceIndex: 0 }, bow: 0 };
  return { left, right, join };
}

describe("assembleStackOutline", () => {
  it("is the identity straight after a split", () => {
    const { left, right, join } = splitBar();
    const out = assembleStackOutline([right, left], [join], NIB);
    expect(flattenContours(out)).toHaveLength(1);
    expect(area(out)).toBeCloseTo(2000, 6);
  });
  it("grows when a piece is lifted and keeps one contour", () => {
    const { left, right, join } = splitBar();
    const out = assembleStackOutline([right, { ...left, y: -60 }], [join], NIB);
    expect(flattenContours(out)).toHaveLength(1);
    expect(area(out)).toBeGreaterThan(2000);
  });
  it("draws pieces with no join as separate contours", () => {
    const { left, right } = splitBar();
    const out = assembleStackOutline([right, left], [], NIB);
    expect(flattenContours(out)).toHaveLength(2);
  });
  it("skips a join whose piece is missing rather than throwing", () => {
    const { left, join } = splitBar();
    expect(() => assembleStackOutline([left], [join], NIB)).not.toThrow();
  });
});

describe("chainOf", () => {
  const ps = [
    piece("a", BAR, 0), piece("b", BAR, 1), piece("c", BAR, 2),
    piece("mb", BAR, 1, { role: "mark", parentId: "b" }),
  ];
  it("carries the piece, its marks, and every later piece", () => {
    expect(chainOf(ps, "b", false).sort()).toEqual(["b", "c", "mb"]);
  });
  it("alone carries only the piece and its marks", () => {
    expect(chainOf(ps, "b", true).sort()).toEqual(["b", "mb"]);
  });
  it("a mark moves by itself", () => {
    expect(chainOf(ps, "mb", false)).toEqual(["mb"]);
  });
});

describe("rebasePiece", () => {
  it("keeps every world point where it was when the local outline changes", () => {
    const p = { ...piece("p", BAR, 0), x: 12, y: -7, rotation: 0.4 };
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const q = rebasePiece(p, r.far);
    const before = transformPt([70, 5], pieceTransform(p));
    const after = transformPt([70, 5], pieceTransform(q));
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    expect(q.pivot).toEqual(cmdsCentre(r.far));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/stackOutline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/stackOutline.ts`:

```ts
// A stack block as one outline: every piece placed, every join spliced.
// Pure; the renderer and the tests both call this.
import type { StackPiece, StackJoin } from "../types";
import type { SvgCmd } from "./svgPath";
import {
  type PieceTransform, transformCmds, transformFace, transformPt, toSegments, fromSegments, cmdsCentre,
} from "./stackGeometry";
import { joinEdges, spliceJoin } from "./stackJoin";

export const pieceTransform = (p: StackPiece): PieceTransform =>
  ({ x: p.x, y: p.y, rotation: p.rotation, pivot: p.pivot });

export function assembleStackOutline(
  pieces: readonly StackPiece[], joins: readonly StackJoin[], nib: { width: number; minFraction: number }
): SvgCmd[] {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  let pool = pieces.flatMap((p) => toSegments(transformCmds(p.cmds, pieceTransform(p))));
  const floor = nib.width * nib.minFraction;
  for (const j of joins) {
    const from = byId.get(j.from.pieceId), to = byId.get(j.to.pieceId);
    const fa = from?.faces[j.from.faceIndex], fb = to?.faces[j.to.faceIndex];
    if (!from || !to || !fa || !fb) continue;
    const A = transformFace(fa, pieceTransform(from));
    const B = transformFace(fb, pieceTransform(to));
    const spliced = spliceJoin(pool, A, B, joinEdges(A, B, j.bow, floor));
    if (spliced) pool = spliced;
  }
  return fromSegments(pool);
}

/** The piece ids a drag of `pieceId` carries: the piece and its marks, plus
 *  — unless `alone` — every piece later in reading order and their marks. */
export function chainOf(pieces: readonly StackPiece[], pieceId: string, alone: boolean): string[] {
  const p = pieces.find((x) => x.id === pieceId);
  if (!p) return [];
  if (p.role === "mark") return [p.id];
  const letters = new Set(
    pieces.filter((x) => x.role === "letter" && (x.id === p.id || (!alone && x.order > p.order))).map((x) => x.id)
  );
  return pieces.filter((x) => letters.has(x.id) || (x.parentId !== undefined && letters.has(x.parentId))).map((x) => x.id);
}

/** The same piece with new local commands, placed so nothing on it moves:
 *  the pivot becomes the new outline centre and x/y absorb the difference. */
export function rebasePiece(p: StackPiece, cmds: SvgCmd[]): StackPiece {
  const pivot = cmdsCentre(cmds);
  const world = transformPt(pivot, pieceTransform(p));
  return { ...p, cmds, pivot, x: world[0] - pivot[0], y: world[1] - pivot[1] };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackOutline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stackOutline.ts src/lib/stackOutline.test.ts
git commit -m "Stack outline: assemble pieces and joins into one path; drag chains; rebasing"
```

---

### Task 5: `stackConvert.ts` — a shaped run becomes pieces and joins

**Files:**
- Create: `src/lib/stackConvert.ts`
- Test: `src/lib/stackConvert.test.ts`

**Interfaces:**
- Consumes: `HarfBuzzGlyph` (`./normalizeGlyphs`), `opentype.Font`, `CutPlan`, `applyCutsToCommands`, `toSvgCmds`, `flattenContours`, `findCutZonesSwept`, `zoneExtentX`, `zoneCentre`, `DEFAULT_DETECT_OPTS`, `outlineBounds` (`./strokeCuts`), `findKashidaSlots`, `TATWEEL` (`./tatweel`), `DiacriticOverride`, `StackPiece`, `StackJoin`, `splitAtCut`, `translateCmds`, `cmdsCentre`, `rebasePiece`.
- Produces:
  ```ts
  export type ConvertInput = {
    glyphs: HarfBuzzGlyph[]; font: opentype.Font; unitsPerEm: number; shapableText: string;
    cutPlan: CutPlan | null; diacriticOverrides: readonly DiacriticOverride[]; fontSize: number;
  };
  export type UnjoinedPair = { earlierCl: number; laterCl: number };
  export type ConvertResult = { pieces: StackPiece[]; joins: StackJoin[]; unjoined: UnjoinedPair[] };
  export function convertRunToStack(input: ConvertInput): ConvertResult;
  export function splitPieceAtCut(pieces, joins, pieceId, cut: { cutX; angle }): { pieces; joins } | null;
  export function runOutline(input: ConvertInput): SvgCmd[];   // the un-converted run as one path, for the identity test and the renderer's bounds
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/stackConvert.test.ts`. Copy the `resolveHbLoader`, `HbModule` type, `hbPromise`, and `shapeReal` from `src/lib/diacritics.test.ts` verbatim (lines 1–130 there), then:

```ts
import { convertRunToStack, runOutline, splitPieceAtCut } from "./stackConvert";
import { assembleStackOutline } from "./stackOutline";
import { flattenContours } from "./strokeCuts";
import type { SvgCmd } from "./svgPath";

const area = (cmds: SvgCmd[]) =>
  flattenContours(cmds).reduce((sum, c) => {
    let a = 0;
    for (let i = 0; i + 1 < c.length; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1];
    return sum + Math.abs(a) / 2;
  }, 0);

async function convert(text: string, fontFile: string) {
  const { glyphs, font } = await shapeReal(text, fontFile);
  const unitsPerEm = font.unitsPerEm || 1000;
  const input = { glyphs, font, unitsPerEm, shapableText: text, cutPlan: null, diacriticOverrides: [], fontSize: unitsPerEm };
  return { input, result: convertRunToStack(input) };
}

describe("convertRunToStack", () => {
  beforeAll(async () => {
    const hb = await hbPromise;
    expect(typeof hb.shape).toBe("function");
  });

  for (const fontFile of ["UKIJDiwani.ttf", "Amiri.ttf", "NotoSans.ttf"]) {
    it(`${fontFile}: one letter piece per base letter of مصبح, a join per adjacent pair or an unjoined report`, async () => {
      const { result } = await convert("مصبح", fontFile);
      const letters = result.pieces.filter((p) => p.role === "letter");
      expect(letters).toHaveLength(4);
      expect(result.joins.length + result.unjoined.length).toBe(3);
      for (const m of result.pieces.filter((p) => p.role === "mark")) {
        expect(letters.some((l) => l.id === m.parentId)).toBe(true);
      }
      // Reading order is text order.
      expect(letters.map((l) => l.order).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    });

    it(`${fontFile}: converting and touching nothing reproduces the run's outline`, async () => {
      const { input, result } = await convert("محمد", fontFile);
      const original = runOutline(input);
      const baked = assembleStackOutline(result.pieces, result.joins, { width: 100, minFraction: 0.15 });
      expect(flattenContours(baked)).toHaveLength(flattenContours(original).length);
      expect(area(baked)).toBeCloseTo(area(original), -Math.log10(area(original) * 0.005));
    });
  }

  it("UKIJDiwani joins every adjacent pair of مصبح by a cut (the coverage sweep's 100%)", async () => {
    const { result } = await convert("مصبح", "UKIJDiwani.ttf");
    expect(result.unjoined).toHaveLength(0);
    expect(result.joins).toHaveLength(3);
  });

  it("a word with no joins converts to rigid pieces and an empty join list", async () => {
    const { input, result } = await convert("ادر", "Amiri.ttf");
    expect(result.joins).toHaveLength(0);
    expect(result.unjoined).toHaveLength(0);
    expect(area(assembleStackOutline(result.pieces, [], { width: 100, minFraction: 0.15 })))
      .toBeCloseTo(area(runOutline(input)), 0);
  });

  it("carries an existing tatweel into the earlier letter's piece", async () => {
    const { result } = await convert("مـصبح", "Amiri.ttf");
    const letters = result.pieces.filter((p) => p.role === "letter");
    expect(letters).toHaveLength(4);
  });

  it("a hidden mark is dropped and a lifted mark is lifted, in font units", async () => {
    const { glyphs, font } = await shapeReal("بَ", "Amiri.ttf");
    const upm = font.unitsPerEm || 1000;
    const base = { glyphs, font, unitsPerEm: upm, shapableText: "بَ", cutPlan: null, fontSize: 100 };
    const markIdx = glyphs.findIndex((g) => (g.ax ?? 0) === 0);
    expect(markIdx).toBeGreaterThanOrEqual(0);
    const plain = convertRunToStack({ ...base, diacriticOverrides: [] });
    const hidden = convertRunToStack({ ...base, diacriticOverrides: [{ glyphIndex: markIdx, hidden: true }] });
    const lifted = convertRunToStack({ ...base, diacriticOverrides: [{ glyphIndex: markIdx, offsetY: -10 }] });
    expect(hidden.pieces.filter((p) => p.role === "mark")).toHaveLength(plain.pieces.filter((p) => p.role === "mark").length - 1);
    const my = (r: typeof plain) => r.pieces.find((p) => p.role === "mark")!.y;
    expect(my(lifted) - my(plain)).toBeCloseTo((-10 * upm) / 100, 6);
  });

  it("splitPieceAtCut turns one piece into two joined pieces with the same outline", async () => {
    const { result } = await convert("مصبح", "UKIJDiwani.ttf");
    const nib = { width: 100, minFraction: 0.15 };
    const before = area(assembleStackOutline(result.pieces, result.joins, nib));
    const target = result.pieces.find((p) => p.role === "letter")!;
    // Any legal zone on the piece works; take the first the detector offers.
    const { findCutZonesSwept, DEFAULT_DETECT_OPTS } = await import("./strokeCuts");
    const zones = findCutZonesSwept(flattenContours(target.cmds), { glyphIndex: 0, cluster: 0 },
      { ...DEFAULT_DETECT_OPTS, step: 10, minZoneWidth: 25 });
    expect(zones.length).toBeGreaterThan(0);
    const z = zones[0];
    const split = splitPieceAtCut(result.pieces, result.joins, target.id, { cutX: (z.fromX + z.toX) / 2, angle: z.angle });
    expect(split).not.toBeNull();
    expect(split!.pieces.length).toBe(result.pieces.length + 1);
    expect(split!.joins.length).toBe(result.joins.length + 1);
    expect(area(assembleStackOutline(split!.pieces, split!.joins, nib))).toBeCloseTo(before, 0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/stackConvert.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/stackConvert.ts`:

```ts
// Converting a shaped run into stack pieces and joins. Pure: the shaped run
// is passed in (never imports ./harfbuzz).
import type * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import type { DiacriticOverride, StackPiece, StackJoin, CutFace } from "../types";
import type { SvgCmd } from "./svgPath";
import {
  type CutPlan, type CutZone, applyCutsToCommands, toSvgCmds, flattenContours, findCutZonesSwept,
  zoneExtentX, zoneCentre, DEFAULT_DETECT_OPTS, outlineBounds,
} from "./strokeCuts";
import { findKashidaSlots, TATWEEL } from "./tatweel";
import { splitAtCut, translateCmds, cmdsCentre } from "./stackGeometry";
import { rebasePiece } from "./stackOutline";

export type ConvertInput = {
  glyphs: HarfBuzzGlyph[];
  font: opentype.Font;
  unitsPerEm: number;
  shapableText: string;
  cutPlan: CutPlan | null;
  diacriticOverrides: readonly DiacriticOverride[];
  /** Diacritic overrides are stored in px at this size. */
  fontSize: number;
};
export type UnjoinedPair = { earlierCl: number; laterCl: number };
export type ConvertResult = { pieces: StackPiece[]; joins: StackJoin[]; unjoined: UnjoinedPair[] };

type Placed = {
  index: number; cl: number; ax: number;
  /** Pen position in run space (font units, y-down). */
  px: number; py: number;
  cmds: SvgCmd[];
  kind: "letter" | "tatweel" | "mark";
};

function placeGlyphs(input: ConvertInput): Placed[] {
  const { glyphs, font, unitsPerEm: upm, cutPlan, shapableText } = input;
  const out: Placed[] = [];
  let penX = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const ax = g.ax ?? 0;
    const obj = font.glyphs.get(g.g);
    if (obj) {
      const raw = toSvgCmds(obj.getPath(0, 0, upm).commands);
      const cuts = cutPlan?.surgery.get(i);
      const cmds = cuts?.length ? applyCutsToCommands(raw, cuts) : raw;
      const cl = g.cl ?? 0;
      const kind: Placed["kind"] =
        ax === 0 ? "mark" : shapableText[cl] === TATWEEL ? "tatweel" : "letter";
      out.push({ index: i, cl, ax, px: penX + (g.dx ?? 0) + (cutPlan?.shift[i] ?? 0), py: -(g.dy ?? 0), cmds, kind });
    }
    penX += ax;
  }
  return out;
}

/** The run as one path in run space — what the text block draws. */
export function runOutline(input: ConvertInput): SvgCmd[] {
  const scale = input.unitsPerEm / input.fontSize;
  const out: SvgCmd[] = [];
  for (const p of placeGlyphs(input)) {
    const o = input.diacriticOverrides.find((d) => d.glyphIndex === p.index);
    if (o?.hidden) continue;
    out.push(...translateCmds(markAdjusted(p.cmds, o), p.px, p.py + (o?.offsetY ?? 0) * scale));
  }
  return out;
}

/** A mark's `scale` override, applied about its own origin as ShapedText does. */
function markAdjusted(cmds: SvgCmd[], o: DiacriticOverride | undefined): SvgCmd[] {
  const s = o?.scale ?? 1;
  if (s === 1) return cmds;
  return cmds.map((c) => {
    switch (c.type) {
      case "M": case "L": return { ...c, x: c.x * s, y: c.y * s };
      case "Q": return { ...c, x: c.x * s, y: c.y * s, x1: c.x1 * s, y1: c.y1 * s };
      case "C": return { ...c, x: c.x * s, y: c.y * s, x1: c.x1 * s, y1: c.y1 * s, x2: c.x2 * s, y2: c.y2 * s };
      default: return c;
    }
  });
}

const detectOpts = (upm: number) => ({ ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40 });

/** Zones overlapping a window round `x`, nearest first. */
function zonesNear(cmds: SvgCmd[], x: number, window: number, upm: number): CutZone[] {
  return findCutZonesSwept(flattenContours(cmds), { glyphIndex: 0, cluster: 0 }, detectOpts(upm))
    .filter((z) => { const [a, b] = zoneExtentX(z); return a <= x + window && b >= x - window; })
    .sort((p, q) => Math.abs(zoneCentre(p)[0] - x) - Math.abs(zoneCentre(q)[0] - x));
}

export function convertRunToStack(input: ConvertInput): ConvertResult {
  const { unitsPerEm: upm, shapableText } = input;
  const scale = upm / input.fontSize;
  const placed = placeGlyphs(input);

  // Letters, in text order.
  const letters = placed.filter((p) => p.kind === "letter").sort((a, b) => a.cl - b.cl);
  type Draft = { placed: Placed; cmds: SvgCmd[]; faces: CutFace[]; id: string; order: number };
  const drafts: Draft[] = letters.map((p, order) => ({ placed: p, cmds: [...p.cmds], faces: [], id: `p${p.index}`, order }));
  const ownerOf = (cl: number) => {
    let best: Draft | null = null;
    for (const d of drafts) if (d.placed.cl <= cl && (!best || d.placed.cl > best.placed.cl)) best = d;
    return best ?? drafts[0];
  };

  // Tatweels ride with the letter before them in the text.
  for (const t of placed.filter((p) => p.kind === "tatweel")) {
    const o = ownerOf(t.cl - 1);
    if (!o) continue;
    o.cmds.push(...translateCmds(t.cmds, t.px - o.placed.px, t.py - o.placed.py));
  }

  // Joins: each adjacent letter pair the text actually joins.
  const slots = findKashidaSlots(shapableText);
  const joins: StackJoin[] = [];
  const unjoined: UnjoinedPair[] = [];
  const window = upm / 20;
  for (let k = 0; k + 1 < drafts.length; k++) {
    const E = drafts[k], L = drafts[k + 1];
    const joined = slots.some((s) => s.index > E.placed.cl && s.index <= L.placed.cl);
    if (!joined) continue;
    // The shared edge: the later (visually left) letter's right edge, in run space.
    const xShared = L.placed.px + L.placed.ax;
    const onE = zonesNear(E.cmds, xShared - E.placed.px, window, upm).map((z) => ({ z, host: E, other: L }));
    const onL = zonesNear(L.cmds, xShared - L.placed.px, window, upm).map((z) => ({ z, host: L, other: E }));
    const candidates = [...onE, ...onL].sort(
      (p, q) => Math.abs(zoneCentre(p.z)[0] + p.host.placed.px - xShared) - Math.abs(zoneCentre(q.z)[0] + q.host.placed.px - xShared)
    );
    let made = false;
    for (const { z, host } of candidates) {
      const split = splitAtCut(host.cmds, { cutX: (z.fromX + z.toX) / 2, angle: z.angle });
      if (!split) continue;
      // Near = x < cut in the stroke's frame = visually left = the later letter.
      const dx = host.placed.px - (host === E ? L : E).placed.px;
      const dy = host.placed.py - (host === E ? L : E).placed.py;
      if (host === E) {
        E.cmds = split.far;
        E.faces.push(split.farFace);
        L.cmds.push(...translateCmds(split.near, dx, dy));
        L.faces.push({ a: [split.nearFace.a[0] + dx, split.nearFace.a[1] + dy], b: [split.nearFace.b[0] + dx, split.nearFace.b[1] + dy], tangent: split.nearFace.tangent });
      } else {
        L.cmds = split.near;
        L.faces.push(split.nearFace);
        E.cmds.push(...translateCmds(split.far, dx, dy));
        E.faces.push({ a: [split.farFace.a[0] + dx, split.farFace.a[1] + dy], b: [split.farFace.b[0] + dx, split.farFace.b[1] + dy], tangent: split.farFace.tangent });
      }
      joins.push({ id: `j${E.id}-${L.id}`, from: { pieceId: E.id, faceIndex: E.faces.length - 1 }, to: { pieceId: L.id, faceIndex: L.faces.length - 1 }, bow: 0 });
      made = true;
      break;
    }
    if (!made) unjoined.push({ earlierCl: E.placed.cl, laterCl: L.placed.cl });
  }

  // Marks: separate pieces riding with the letter of their cluster.
  const markPieces: StackPiece[] = [];
  for (const m of placed.filter((p) => p.kind === "mark")) {
    const o = input.diacriticOverrides.find((d) => d.glyphIndex === m.index);
    if (o?.hidden) continue;
    const parent = ownerOf(m.cl);
    const cmds = markAdjusted(m.cmds, o);
    markPieces.push({
      id: `m${m.index}`, cmds, x: m.px, y: m.py + (o?.offsetY ?? 0) * scale, rotation: 0,
      pivot: cmdsCentre(cmds), homeX: 0, homeY: 0, order: parent.order, role: "mark", parentId: parent.id, faces: [],
    });
  }

  const letterPieces: StackPiece[] = drafts.map((d) => ({
    id: d.id, cmds: d.cmds, x: d.placed.px, y: d.placed.py, rotation: 0, pivot: cmdsCentre(d.cmds),
    homeX: 0, homeY: 0, order: d.order, role: "letter", faces: d.faces,
  }));

  // Centre the composition on the run's ink so the block does not jump.
  const all = [...letterPieces, ...markPieces];
  const b = outlineBounds(all.flatMap((p) => translateCmds(p.cmds, p.x, p.y)));
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  const pieces = all.map((p) => ({ ...p, x: p.x - cx, y: p.y - cy, homeX: p.x - cx, homeY: p.y - cy }));
  return { pieces, joins, unjoined };
}

/** Cut a piece's stroke; the far fragment becomes its own piece joined to
 *  the near one. Orders are renumbered so the new piece follows its parent. */
export function splitPieceAtCut(
  pieces: readonly StackPiece[], joins: readonly StackJoin[], pieceId: string, cut: { cutX: number; angle: number }
): { pieces: StackPiece[]; joins: StackJoin[] } | null {
  const p = pieces.find((x) => x.id === pieceId);
  if (!p || p.role !== "letter") return null;
  const split = splitAtCut(p.cmds, cut);
  if (!split) return null;
  const nearPiece = rebasePiece(p, split.near);
  const farId = `${p.id}t${p.faces.length}`;
  const farPiece = rebasePiece({ ...p, id: farId, order: p.order + 0.5, parentId: undefined }, split.far);
  // Faces on the old piece that now live in the far fragment: a face whose
  // points sit on the far side of the cut moves with it.
  const inFar = (f: CutFace) => {
    const c = Math.cos(-cut.angle), s = Math.sin(-cut.angle);
    return f.a[0] * c - f.a[1] * s >= cut.cutX;
  };
  const movedFaces: number[] = [];
  const nearFaces: CutFace[] = [];
  p.faces.forEach((f, i) => (inFar(f) ? movedFaces.push(i) : nearFaces.push(f)));
  const near: StackPiece = { ...nearPiece, faces: [...nearFaces, split.nearFace] };
  const far: StackPiece = { ...farPiece, faces: [...movedFaces.map((i) => p.faces[i]), split.farFace] };
  const nearIdx = (i: number) => nearFaces.indexOf(p.faces[i]);
  const farIdx = (i: number) => movedFaces.indexOf(i);
  const remap = (ref: { pieceId: string; faceIndex: number }) =>
    ref.pieceId !== p.id ? ref
      : movedFaces.includes(ref.faceIndex) ? { pieceId: farId, faceIndex: farIdx(ref.faceIndex) }
      : { pieceId: p.id, faceIndex: nearIdx(ref.faceIndex) };
  const newJoins: StackJoin[] = [
    ...joins.map((j) => ({ ...j, from: remap(j.from), to: remap(j.to) })),
    { id: `j${p.id}-${farId}`, from: { pieceId: p.id, faceIndex: near.faces.length - 1 }, to: { pieceId: farId, faceIndex: far.faces.length - 1 }, bow: 0 },
  ];
  const withNew = pieces.map((x) => (x.id === p.id ? near : x)).concat(far);
  const letters = withNew.filter((x) => x.role === "letter").sort((a, b) => a.order - b.order);
  const orderOf = new Map(letters.map((x, i) => [x.id, i]));
  const renumbered = withNew.map((x) =>
    x.role === "letter" ? { ...x, order: orderOf.get(x.id)! } : { ...x, order: orderOf.get(x.parentId ?? "") ?? x.order }
  );
  return { pieces: renumbered, joins: newJoins };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackConvert.test.ts`
Expected: PASS. The identity test's tolerance is 0.5% of area; if a font fails it by a hair, the cause is curve flattening at split points (8 steps per curve either side) — widen to 1% only after confirming contour counts match.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stackConvert.ts src/lib/stackConvert.test.ts
git commit -m "Stack convert: shaped run to letter pieces, marks, and cut-face joins"
```

---

### Task 6: The convert action in `App.tsx` and its button

**Files:**
- Modify: `src/App.tsx` (near `applyComposition`, ~line 2814; `replaceBlockWithHistory` ~line 1903; the missing-font effects ~lines 3121 and 3144; the `<Sidebar>` props)
- Modify: `src/components/Sidebar.tsx` (Content panel, ~line 2246; `SidebarProps` ~line 131)
- Modify: `src/components/sidebar/LayersPanel.tsx` (lines 22–35)

**Interfaces:**
- Consumes: `shapeText` (`./lib/harfbuzz`), `applySpacing` (`./lib/spacing`), `spacingForBlock`, `buildCutPlan`, `nuqtaUnits`, `convertRunToStack`, `findKashidaSlots`, `applyKashida`, `readKashida`, `remapCutsForEdits`, `isOverrideGlyphChar`, `resolveFontUrl`.
- Produces: `convertSelectedBlockToStack(): Promise<void>` in App; Sidebar prop `onConvertToStack?: () => void`; a button with `aria-label="Convert to stacked composition"`.

- [ ] **Step 1: The handler**

In `src/App.tsx`, directly after `applyComposition`, add:

```ts
  /**
   * Bake the selected text block into a stack block. One-way (undo restores
   * the text block). Captured by id like `applyComposition`: shaping is
   * async and the selection can change meanwhile.
   *
   * Joins the detector cannot cut get a tatweel inserted and are cut there
   * instead — only when the shaped text equals the block text, because the
   * cluster offsets index the shaped text.
   */
  const convertSelectedBlockToStack = async () => {
    const source = selectedBlock;
    if (!source || source.type !== "text") return;
    if (source.text.trim() === "") { setExportStatus("Type some text into this block first."); return; }
    if ((source.warpX ?? 0) !== 0 || (source.warpY ?? 0) !== 0) {
      setExportStatus("Set Warp to 0 before converting to a stacked composition.");
      return;
    }
    if ([...source.text].some((ch) => isOverrideGlyphChar(ch.codePointAt(0)))) {
      setExportStatus("Honorific glyphs cannot be converted to a stacked composition.");
      return;
    }
    const { id, fontFamily, fontSize } = source;
    const fontUrl = resolveFontUrl(fontFamily);
    const shapeAndConvert = async (text: string, cuts: StrokeCut[]) => {
      const shaped = await shapeText(text, fontUrl, source.glyphAlternates, source.styleSets);
      const upm = Math.max(shaped.unitsPerEm || 1000, 1);
      const glyphs = applySpacing(shaped.glyphs, shaped.shapableText, spacingForBlock(source), upm);
      const cutPlan = cuts.length ? buildCutPlan(glyphs, cuts, nuqtaUnits(fontFamily, upm)) : null;
      const result = convertRunToStack({
        glyphs, font: shaped.font, unitsPerEm: upm, shapableText: shaped.shapableText,
        cutPlan, diacriticOverrides: source.diacriticOverrides ?? [], fontSize,
      });
      return { shaped, upm, result };
    };
    try {
      let text = source.text;
      let cuts = source.strokeCuts ?? [];
      let { shaped, upm, result } = await shapeAndConvert(text, cuts);
      if (result.unjoined.length > 0 && shaped.shapableText === text) {
        const slots = findKashidaSlots(text);
        const counts = readKashida(text, slots);
        // Highest offset first so earlier insertions do not move later ones.
        const targets = [...result.unjoined].sort((a, b) => b.laterCl - a.laterCl);
        const edits: { index: number; delta: number }[] = [];
        for (const u of targets) {
          const slot = slots.find((s) => s.index > u.earlierCl && s.index <= u.laterCl);
          if (!slot) continue;
          const next = applyKashida(text, slot, (counts.get(slot.index) ?? 0) + 1);
          edits.push({ index: slot.index, delta: next.length - text.length });
          text = next;
        }
        if (edits.length) {
          cuts = remapCutsForEdits(cuts, edits);
          ({ shaped, upm, result } = await shapeAndConvert(text, cuts));
        }
      }
      const stack: StackBlock = {
        id, type: "stack", name: source.name, text: source.text, x: source.x, y: source.y,
        fontSize, color: source.color, fontFamily, fontStyle: source.fontStyle, opacity: source.opacity,
        stroke: source.stroke, strokeWidth: source.strokeWidth, shadowColor: source.shadowColor,
        shadowBlur: source.shadowBlur, shadowOffsetX: source.shadowOffsetX, shadowOffsetY: source.shadowOffsetY,
        shadowOpacity: source.shadowOpacity, locked: source.locked, rotation: source.rotation,
        ornamental: source.ornamental, groupId: source.groupId, fill: source.fill,
        source: { text: source.text, fontFamily },
        unitsPerEm: upm,
        nib: { width: nuqtaUnits(fontFamily, upm), minFraction: 0.15 },
        pieces: result.pieces, joins: result.joins,
      };
      replaceBlockWithHistory(id, stack);
      setExportStatus(
        result.unjoined.length
          ? `Converted; ${result.unjoined.length} join${result.unjoined.length === 1 ? "" : "s"} could not be cut and stay rigid.`
          : "Converted to a stacked composition."
      );
    } catch (err) {
      console.error("stack conversion failed", err);
      setExportStatus("Could not convert this block.");
    }
  };
```

Add the imports: `shapeText` from `./lib/harfbuzz` (check whether App already imports from it; add to the existing line if so), `applySpacing` from `./lib/spacing`, `buildCutPlan`, `remapCutsForEdits` from `./lib/strokeCuts`, `nuqtaUnits` from `./lib/nuqta`, `convertRunToStack` from `./lib/stackConvert`, `findKashidaSlots`, `applyKashida`, `readKashida` from `./lib/tatweel`, `isOverrideGlyphChar` from `./lib/glyphOverrides`, and `StackBlock`, `StrokeCut` types from `./types`. Several are already imported — extend the existing lines rather than duplicating.

`StackJoin.fallback` is left unset in v1: after the retry the handler cannot tell which joins came from inserted tatweels without a per-slot report, and nothing reads the field yet. It stays in the type for a later refinement.

- [ ] **Step 2: Font effects skip stack blocks**

At the missing-font effect (`App.tsx` ~line 3121, the one that skips `image`, `mirror`, `guide`) and at `selectedFontUnavailable` (~line 3144), add `"stack"` to the skipped types: a stack is baked and needs no font.

- [ ] **Step 3: Pass the handler to Sidebar and add the button**

Add `onConvertToStack={convertSelectedBlockToStack}` in the `<Sidebar>` props. In `Sidebar.tsx` add `onConvertToStack?: () => void;` to `SidebarProps`, destructure it, and in the Content panel (the block at ~line 2246), inside its `selectedBlock.type === "text"` region, add after the existing text controls:

```tsx
{selectedBlock.type === "text" && onConvertToStack && (
  <button
    type="button"
    className="sidebarSmallAction"
    aria-label="Convert to stacked composition"
    title="Bake the letters into movable pieces joined by curves. One-way; undo restores the text."
    onClick={onConvertToStack}
  >
    Convert to stacked composition
  </button>
)}
```

Then exclude `stack` from the Content and Typography panels: extend both conditions (`selectedBlock.type !== "image" && selectedBlock.type !== "mirror" && selectedBlock.type !== "guide"`) with `&& selectedBlock.type !== "stack"`.

- [ ] **Step 4: Layers label**

In `LayersPanel.tsx`, extend `defaultLabel`:

```ts
const defaultLabel = (b: Block) =>
  b.type === "guide" ? `Guide · ${GUIDE_SHAPE_LABELS[b.guideShape]}`
  : b.type === "stack" ? `Stack · ${b.source.text}`
  : `Block ${b.id}`;
```

- [ ] **Step 5: Typecheck, lint, test, build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all pass. (The block renders as nothing yet — `CanvasStage` falls through — that is Task 7.)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx src/components/sidebar/LayersPanel.tsx
git commit -m "Convert a text block to a stacked composition (handler and button)"
```

---

### Task 7: `StackView.tsx` — rendering, mirrors, and the CanvasStage dispatch

**Files:**
- Create: `src/components/StackView.tsx`
- Modify: `src/components/CanvasStage.tsx` (dispatch, ~line 869 onward)
- Modify: `src/components/MirrorBlockView.tsx` (lines 111–145)
- Test: `src/lib/stackOutline.test.ts` (one more case)

**Interfaces:**
- Consumes: `stackProps`, `assembleStackOutline`, `outlineBounds`, `replayPath` (`../lib/svgPath`), `createBlockFillPainter` (`../lib/blockFill`), `EXPORT_HIDDEN`.
- Produces: `StackView` with props:
  ```ts
  type StackViewProps = ReturnType<typeof stackProps> & {
    id?: string; x: number; y: number; opacity?: number; locked?: boolean; draggable?: boolean;
    isSelected?: boolean;
    onClick?: () => void; onTap?: () => void; onDblClick?: () => void;
    onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
    onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
    /** Task 8 fills these in; optional so a mirror can omit them. */
    editing?: React.ReactNode;
  };
  ```

- [ ] **Step 1: Pin the missing-`unitsPerEm` guard**

Add to `src/lib/stackOutline.test.ts`:

```ts
import { stackScale } from "./stackOutline";
describe("stackScale", () => {
  it("falls back to 1000 units per em when the block has none", () => {
    expect(stackScale(50, undefined)).toBeCloseTo(0.05, 12);
    expect(stackScale(50, 0)).toBeCloseTo(0.05, 12);
    expect(stackScale(50, 2048)).toBeCloseTo(50 / 2048, 12);
  });
});
```

And to `src/lib/stackOutline.ts`:

```ts
/** px per font unit. A hand-edited save without `unitsPerEm` draws at 1000. */
export const stackScale = (fontSize: number, unitsPerEm: number | undefined) =>
  fontSize / Math.max(unitsPerEm || 1000, 1);
```

Run `npx vitest run src/lib/stackOutline.test.ts` — PASS.

- [ ] **Step 2: The renderer**

Create `src/components/StackView.tsx`:

```tsx
import React, { useMemo } from "react";
import { Group, Rect, Shape } from "react-konva";
import type Konva from "konva";
import type { stackProps } from "../lib/blockRenderProps";
import { assembleStackOutline, stackScale } from "../lib/stackOutline";
import { outlineBounds } from "../lib/strokeCuts";
import { replayPath } from "../lib/svgPath";
import { createBlockFillPainter } from "../lib/blockFill";

export type StackViewProps = ReturnType<typeof stackProps> & {
  id?: string;
  x: number;
  y: number;
  opacity?: number;
  locked?: boolean;
  draggable?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  /** Editing chrome mounted inside the block's group (Task 8). */
  editing?: React.ReactNode;
};

/**
 * Draws a stack block: one outline assembled from its pieces and joins, in
 * font units, scaled at draw time. Outline before fill, like every other
 * renderer (see CLAUDE.md, "Rendering"). Export needs nothing extra: the
 * stage snapshot and react-konva-to-svg both replay this sceneFunc.
 */
export const StackView: React.FC<StackViewProps> = (p) => {
  const scale = stackScale(p.fontSize, p.unitsPerEm);
  const outline = useMemo(() => assembleStackOutline(p.pieces, p.joins, p.nib), [p.pieces, p.joins, p.nib]);
  const b = useMemo(() => outlineBounds(outline), [outline]);
  const px = {
    x: b.x1 * scale, y: b.y1 * scale, width: (b.x2 - b.x1) * scale, height: (b.y2 - b.y1) * scale,
  };
  const bounds = {
    minX: px.x, minY: px.y, maxX: px.x + px.width, maxY: px.y + px.height, rawWidth: px.width, rawHeight: px.height,
  };

  return (
    <Group
      id={p.id}
      x={p.x}
      y={p.y}
      rotation={p.rotation}
      opacity={p.opacity ?? 1}
      draggable={p.draggable}
      onClick={p.onClick}
      onTap={p.onTap}
      onDblClick={p.onDblClick}
      onDragMove={p.onDragMove}
      onDragEnd={p.onDragEnd}
    >
      {/* Hit area for selecting and dragging the whole block. */}
      <Rect x={px.x} y={px.y} width={px.width} height={px.height} fill="transparent" />
      <Shape
        listening={false}
        shadowColor={p.shadowColor}
        shadowBlur={p.shadowBlur}
        shadowOffsetX={p.shadowOffsetX}
        shadowOffsetY={p.shadowOffsetY}
        shadowOpacity={p.shadowOpacity}
        sceneFunc={(context) => {
          const ctx = context._context as CanvasRenderingContext2D;
          ctx.save();
          ctx.scale(scale, scale);
          replayPath(ctx, outline);
          ctx.restore();
          if ((p.strokeWidth ?? 0) > 0) {
            ctx.strokeStyle = p.stroke ?? "#000";
            ctx.lineWidth = p.strokeWidth ?? 0;
            ctx.stroke();
          }
          const painter = createBlockFillPainter(ctx, p.fill, p.color, bounds);
          if (painter) painter.fill(ctx); else { ctx.fillStyle = p.color; ctx.fill(); }
        }}
      />
      {p.editing}
    </Group>
  );
};
```

Check `createBlockFillPainter`'s signature in `src/lib/blockFill.ts` and match it (it returns `null` for a flat colour in `ShapedText`'s usage — mirror that exactly).

- [ ] **Step 3: Dispatch in CanvasStage and MirrorBlockView**

In `CanvasStage.tsx`, import `StackView` and `stackProps`, and add before the `// Unreachable` fallback:

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
    />
  );
}
```

In `MirrorBlockView.tsx`, before the `ShapedText` fallthrough:

```tsx
if (source.type === "stack") return <StackView {...common} {...stackProps(source)} />;
```

- [ ] **Step 4: Run the app and look**

Run: `npm run dev`, type مصبح in the default block, switch the font to UKIJ Diwani, click **Convert to stacked composition**. Expected: the block looks identical before and after; the layer is named `Stack · مصبح`; undo brings the text block back; a mirror of it reflects it. Export a PNG and an SVG and confirm both contain the word.

- [ ] **Step 5: Verification loop, then commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`

```bash
git add src/components/StackView.tsx src/components/CanvasStage.tsx src/components/MirrorBlockView.tsx src/lib/stackOutline.ts src/lib/stackOutline.test.ts
git commit -m "StackView: render a stacked composition; mirrors and the canvas dispatch"
```

---

### Task 8: `StackEditOverlay.tsx` — move, chain, tilt, bend

**Files:**
- Create: `src/components/StackEditOverlay.tsx`
- Modify: `src/App.tsx` (handlers, `<CanvasStage>` props)
- Modify: `src/components/CanvasStage.tsx` (props type and the stack arm)
- Modify: `src/components/StackView.tsx` (mount the overlay via `editing`)
- Test: `src/lib/stackOutline.test.ts` already pins `chainOf`; add the rotated-chain case below.

**Interfaces:**
- App handlers (no push in the per-frame ones):
  ```ts
  onBeginStackEdit: () => void;                                   // = pushHistory
  onSetStackPieces: (blockId: number, patches: { id: string; x?: number; y?: number; rotation?: number }[]) => void;
  onSetStackJoinBow: (blockId: number, joinId: string, bow: number) => void;
  ```
- Overlay props:
  ```ts
  type StackEditOverlayProps = {
    isSelected: boolean; pieces: StackPiece[]; joins: StackJoin[]; nib: StackBlock["nib"]; scale: number;
    onBegin?: () => void;
    onSetPieces?: (patches: { id: string; x?: number; y?: number; rotation?: number }[]) => void;
    onSetBow?: (joinId: string, bow: number) => void;
  };
  ```

- [ ] **Step 1: Pin the rotated chain**

Add to `src/lib/stackOutline.test.ts` under `chainOf`:

```ts
it("a chain move is a pure translation: rotations and relative placement are untouched", () => {
  const ps = [piece("a", BAR, 0), { ...piece("b", BAR, 1), rotation: 0.7, x: 40, y: -30 }];
  const ids = chainOf(ps, "a", false);
  const moved = ps.map((p) => (ids.includes(p.id) ? { ...p, x: p.x + 10, y: p.y - 20 } : p));
  expect(moved[1].rotation).toBe(0.7);
  expect(moved[1].x - moved[0].x).toBe(40);
  expect(moved[1].y - moved[0].y).toBe(-30);
});
```

Run `npx vitest run src/lib/stackOutline.test.ts` — PASS (it exercises the drag arithmetic the overlay uses).

- [ ] **Step 2: App handlers**

In `App.tsx`, near `setStrokeCut` (~line 700), add:

```ts
  const setStackPieces = useCallback(
    (blockId: number, patches: { id: string; x?: number; y?: number; rotation?: number }[]) => {
      const byId = new Map(patches.map((p) => [p.id, p]));
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || !isStackBlock(b)) return b;
          return { ...b, pieces: b.pieces.map((p) => { const q = byId.get(p.id); return q ? { ...p, ...q, id: p.id } : p; }) };
        })
      );
      // No push: the overlay's drag start took one through `onBeginStackEdit`.
    },
    []
  );

  const setStackJoinBow = useCallback((blockId: number, joinId: string, bow: number) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id !== blockId || !isStackBlock(b) ? b
          : { ...b, joins: b.joins.map((j) => (j.id === joinId ? { ...j, bow } : j)) }
      )
    );
  }, []);
```

Import `isStackBlock`. Pass to `<CanvasStage>`: `onBeginStackEdit={pushHistory}`, `onSetStackPieces={setStackPieces}`, `onSetStackJoinBow={setStackJoinBow}`. Add the three to `CanvasStageProps`.

- [ ] **Step 3: The overlay**

Create `src/components/StackEditOverlay.tsx`:

```tsx
import React, { useMemo, useRef, useState } from "react";
import { Circle, Group, Line } from "react-konva";
import type Konva from "konva";
import type { StackPiece, StackJoin, StackBlock } from "../types";
import { chainOf, pieceTransform } from "../lib/stackOutline";
import { transformCmds, transformFace } from "../lib/stackGeometry";
import { flattenContours } from "../lib/strokeCuts";
import { joinCenterline } from "../lib/stackJoin";
import { EXPORT_HIDDEN } from "../lib/exportChrome";

const ROTATE_HANDLE_COLOR = "#8b5cf6";
const BOW_HANDLE_COLOR = "#f59e0b";
const BOW_MIN = -0.3, BOW_MAX = 3;

export type StackEditOverlayProps = {
  isSelected: boolean;
  pieces: StackPiece[];
  joins: StackJoin[];
  nib: StackBlock["nib"];
  /** px per font unit. */
  scale: number;
  onBegin?: () => void;
  onSetPieces?: (patches: { id: string; x?: number; y?: number; rotation?: number }[]) => void;
  onSetBow?: (joinId: string, bow: number) => void;
};

/**
 * Editing chrome for a selected stack block. One hit polygon per piece
 * (Konva hit-tests a closed Line by its fill, so a letter's real outline is
 * the drag target), a rotation handle on the hovered piece, and a bow
 * handle on every join. Everything is in the block group's px space.
 */
export const StackEditOverlay: React.FC<StackEditOverlayProps> = ({
  isSelected, pieces, joins, scale, onBegin, onSetPieces, onSetBow,
}) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const dragStart = useRef<{ ids: string[]; at: Map<string, { x: number; y: number }>; pointer: { x: number; y: number } } | null>(null);
  const rotateStart = useRef<{ id: string; centre: { x: number; y: number } } | null>(null);
  const bowStart = useRef<{ id: string; bow: number; n: { x: number; y: number }; chord: number; pointer: { x: number; y: number } } | null>(null);

  const polygons = useMemo(() =>
    pieces.map((p) => {
      const contours = flattenContours(transformCmds(p.cmds, pieceTransform(p)));
      // The largest contour is the letter body; marks are a single contour anyway.
      const outer = contours.reduce((a, b) => (b.length > a.length ? b : a), contours[0] ?? []);
      return { id: p.id, points: outer.flatMap(([x, y]) => [x * scale, y * scale]) };
    }), [pieces, scale]);

  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);

  if (!isSelected) return null;

  const pointerIn = (e: Konva.KonvaEventObject<Event>) =>
    e.target.getParent()?.getParent()?.getRelativePointerPosition() ?? { x: 0, y: 0 };

  return (
    <Group name={EXPORT_HIDDEN}>
      {polygons.map(({ id, points }) => (
        <Group key={id} onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered((h) => (h === id ? null : h))}>
          <Line
            name="stack-piece"
            points={points}
            closed
            fill="transparent"
            draggable
            onMouseDown={(e) => { e.cancelBubble = true; }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              const ids = chainOf(pieces, id, e.evt.altKey);
              dragStart.current = {
                ids,
                at: new Map(ids.map((i) => [i, { x: byId.get(i)!.x, y: byId.get(i)!.y }])),
                pointer: pointerIn(e),
              };
              onBegin?.();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const s = dragStart.current;
              if (!s) return;
              const now = pointerIn(e);
              const dx = (now.x - s.pointer.x) / scale, dy = (now.y - s.pointer.y) / scale;
              onSetPieces?.(s.ids.map((i) => ({ id: i, x: s.at.get(i)!.x + dx, y: s.at.get(i)!.y + dy })));
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              dragStart.current = null;
              e.target.position({ x: 0, y: 0 });   // the polygon re-renders from state
            }}
          />
          {hovered === id && byId.get(id)?.role === "letter" && (() => {
            const p = byId.get(id)!;
            const t = pieceTransform(p);
            const cx = (p.pivot[0] + p.x) * scale, cy = (p.pivot[1] + p.y) * scale;
            const r = 36;
            const hx = cx + r * Math.sin(t.rotation), hy = cy - r * Math.cos(t.rotation);
            return (
              <>
                <Line points={[cx, cy, hx, hy]} stroke={ROTATE_HANDLE_COLOR} strokeWidth={1} dash={[3, 3]} listening={false} />
                <Circle
                  name="stack-rotate"
                  x={hx} y={hy} radius={5} fill={ROTATE_HANDLE_COLOR} stroke="#fff" strokeWidth={1.5}
                  draggable
                  onMouseDown={(e) => { e.cancelBubble = true; }}
                  onDragStart={(e) => { e.cancelBubble = true; rotateStart.current = { id, centre: { x: cx, y: cy } }; onBegin?.(); }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const s = rotateStart.current; if (!s) return;
                    const pos = e.target.position();
                    const angle = Math.atan2(pos.y - s.centre.y, pos.x - s.centre.x) + Math.PI / 2;
                    onSetPieces?.([{ id: s.id, rotation: e.evt.shiftKey ? Math.round(angle / (Math.PI / 12)) * (Math.PI / 12) : angle }]);
                  }}
                  onDragEnd={(e) => { e.cancelBubble = true; rotateStart.current = null; }}
                />
              </>
            );
          })()}
        </Group>
      ))}

      {joins.map((j) => {
        const from = byId.get(j.from.pieceId), to = byId.get(j.to.pieceId);
        const fa = from?.faces[j.from.faceIndex], fb = to?.faces[j.to.faceIndex];
        if (!from || !to || !fa || !fb) return null;
        const A = transformFace(fa, pieceTransform(from)), B = transformFace(fb, pieceTransform(to));
        const [p0, p1, p2, p3] = joinCenterline(A, B, j.bow);
        const m = { x: (p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8 * scale, y: (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8 * scale };
        const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) * scale;
        if (chord < 4) return null;   // nothing to bend yet
        const n = { x: -(p3[1] - p0[1]) * scale / chord, y: (p3[0] - p0[0]) * scale / chord };
        return (
          <Circle
            key={j.id}
            name="stack-bow"
            x={m.x} y={m.y} radius={4.5} fill={BOW_HANDLE_COLOR} stroke="#fff" strokeWidth={1.5}
            draggable
            onMouseDown={(e) => { e.cancelBubble = true; }}
            onDblClick={(e) => { e.cancelBubble = true; onBegin?.(); onSetBow?.(j.id, 0); }}
            onDragStart={(e) => { e.cancelBubble = true; bowStart.current = { id: j.id, bow: j.bow, n, chord, pointer: pointerIn(e) }; onBegin?.(); }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const s = bowStart.current; if (!s) return;
              const now = pointerIn(e);
              const along = ((now.x - s.pointer.x) * s.n.x + (now.y - s.pointer.y) * s.n.y) / s.chord;
              onSetBow?.(s.id, Math.min(BOW_MAX, Math.max(BOW_MIN, s.bow + along * 2)));
            }}
            onDragEnd={(e) => { e.cancelBubble = true; bowStart.current = null; }}
          />
        );
      })}
    </Group>
  );
};
```

`pointerIn` walks two parents up (handle → per-piece Group → overlay Group → block Group). Verify the nesting while implementing: the pointer must be read relative to the **block group**, the frame `pieces` are drawn in. If the Circle's parent chain differs, adjust the number of `getParent()` calls rather than the maths.

- [ ] **Step 4: Mount it**

In `CanvasStage.tsx`'s stack arm, pass:

```tsx
editing={
  block.id === selectedId && !effectivePanMode ? (
    <StackEditOverlay
      isSelected
      pieces={block.pieces}
      joins={block.joins}
      nib={block.nib}
      scale={stackScale(block.fontSize, block.unitsPerEm)}
      onBegin={onBeginStackEdit}
      onSetPieces={(patches) => onSetStackPieces(block.id, patches)}
      onSetBow={(joinId, bow) => onSetStackJoinBow(block.id, joinId, bow)}
    />
  ) : null
}
```

Import `StackEditOverlay` and `stackScale`.

- [ ] **Step 5: Try it**

`npm run dev`: convert مصبح in UKIJ Diwani; drag the second letter upward — the later letters rise with it and the joins curve; Alt-drag moves one letter; hover a letter and drag its purple handle to tilt; drag an orange handle to bend a join; double-click it to reset. Undo steps back one gesture at a time. Rotate the whole block in Transform and confirm handles track.

- [ ] **Step 6: Verification loop, then commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`

```bash
git add src/components/StackEditOverlay.tsx src/components/CanvasStage.tsx src/App.tsx src/lib/stackOutline.test.ts
git commit -m "Stack editing: drag letters with their chain, tilt, and bend joins"
```

---

### Task 9: Tails — splitting a stroke from the canvas

**Files:**
- Modify: `src/components/StackEditOverlay.tsx`
- Modify: `src/App.tsx`, `src/components/CanvasStage.tsx`

**Interfaces:**
- App: `splitStackPiece(blockId: number, pieceId: string, cut: { cutX: number; angle: number }): void` (pushes history).
- Overlay props gain `tailMode: boolean` and `onSplit?: (pieceId: string, cut: { cutX: number; angle: number }) => void`.

- [ ] **Step 1: App handler**

```ts
  const splitStackPiece = useCallback(
    (blockId: number, pieceId: string, cut: { cutX: number; angle: number }) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block || !isStackBlock(block)) return;
      const next = splitPieceAtCut(block.pieces, block.joins, pieceId, cut);
      if (!next) return;
      pushHistory();
      setBlocks((prev) => prev.map((b) => (b.id === blockId && isStackBlock(b) ? { ...b, pieces: next.pieces, joins: next.joins } : b)));
    },
    [blocks, pushHistory]
  );
```

Import `splitPieceAtCut`. Pass `onSplitStackPiece={splitStackPiece}` to CanvasStage; type it there; in the stack arm pass `tailMode={block.stackTailMode ?? false}` and `onSplit={(pieceId, cut) => onSplitStackPiece(block.id, pieceId, cut)}` to the overlay.

- [ ] **Step 2: Zone handles in the overlay**

In `StackEditOverlay.tsx`, add props `tailMode: boolean; onSplit?: …`, and compute zones only while armed (the sweep is fifteen rotations per piece — never on every render):

```tsx
const zones = useMemo(() => {
  if (!tailMode) return [];
  const opts = { ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40 };
  return pieces.filter((p) => p.role === "letter").flatMap((p) =>
    findCutZonesSwept(flattenContours(p.cmds), { glyphIndex: 0, cluster: 0 }, opts).map((z, i) => {
      const [lx, ly] = zoneCentre(z);
      const w = transformPt([lx, ly], pieceTransform(p));
      return { key: `${p.id}:${i}`, pieceId: p.id, cut: { cutX: (z.fromX + z.toX) / 2, angle: z.angle }, x: w[0] * scale, y: w[1] * scale };
    })
  );
}, [tailMode, pieces, scale, upm]);
```

`upm` comes from a new prop `unitsPerEm: number` (pass `block.unitsPerEm` from CanvasStage). Render, after the pieces and before the bow handles:

```tsx
{zones.map((z) => (
  <Circle
    key={z.key} name="stack-split" x={z.x} y={z.y} radius={4} fill="#10b981" stroke="#fff" strokeWidth={1.5}
    onMouseDown={(e) => { e.cancelBubble = true; }}
    onClick={(e) => { e.cancelBubble = true; onSplit?.(z.pieceId, z.cut); }}
    onTap={(e) => { e.cancelBubble = true; onSplit?.(z.pieceId, z.cut); }}
  />
))}
```

Import `findCutZonesSwept`, `zoneCentre`, `DEFAULT_DETECT_OPTS` from `../lib/strokeCuts` and `transformPt` from `../lib/stackGeometry`.

- [ ] **Step 3: Try it**

Task 10 adds the checkbox; for now flip `stackTailMode` from the console via a temporary `updateSelectedBlock({ stackTailMode: true })` call or wait for Task 10. Expected once armed: green dots on straight strokes; clicking one splits the stroke; dragging the new end-cap piece sweeps a tail that tapers as it turns.

- [ ] **Step 4: Verification loop, then commit**

```bash
git add src/components/StackEditOverlay.tsx src/components/CanvasStage.tsx src/App.tsx
git commit -m "Stack tails: split a stroke into a joined end piece from the canvas"
```

---

### Task 10: The Stack sidebar panel

**Files:**
- Create: `src/components/sidebar/StackPanel.tsx`
- Modify: `src/components/Sidebar.tsx` (mount in the selected tier, after the Guide panel ~line 2846)
- Modify: `src/App.tsx` (`resetStackLayout`)

**Interfaces:**
- App: `resetStackLayout(): void` — selected stack block's pieces back to `homeX/homeY`, rotation 0, every bow 0; one `pushHistory()`.
- `StackPanel` props: `{ block: StackBlock; onUpdate: (patch: Partial<StackBlock>) => void; onReset: () => void }`.

- [ ] **Step 1: App handler**

```ts
  const resetStackLayout = () => {
    if (!selectedBlock || !isStackBlock(selectedBlock)) return;
    updateSelectedBlock({
      pieces: selectedBlock.pieces.map((p) => ({ ...p, x: p.homeX, y: p.homeY, rotation: 0 })),
      joins: selectedBlock.joins.map((j) => ({ ...j, bow: 0 })),
    });
  };
```

(`updateSelectedBlock` pushes history itself.) Pass `onResetStackLayout={resetStackLayout}` to Sidebar.

- [ ] **Step 2: The panel**

Create `src/components/sidebar/StackPanel.tsx`:

```tsx
import React from "react";
import type { StackBlock } from "../../types";
import { RangeRow } from "./FormControls";

export const StackPanel: React.FC<{
  block: StackBlock;
  onUpdate: (patch: Partial<StackBlock>) => void;
  onReset: () => void;
}> = ({ block, onUpdate, onReset }) => (
  <div className="sectionPanel">
    <p className="sidebarHint" dir="rtl">{block.source.text}</p>
    <p className="sidebarHint">
      Baked from {block.source.fontFamily}. The spelling cannot be edited here — undo the
      conversion, or convert a fresh text block.
    </p>
    <label className="sidebarCheckbox">
      <input
        type="checkbox"
        checked={block.stackTailMode ?? false}
        onChange={(e) => onUpdate({ stackTailMode: e.target.checked })}
        aria-label="Split strokes"
      />
      Split strokes
    </label>
    <RangeRow
      label="Thinnest stroke"
      value={block.nib.minFraction}
      min={0.05}
      max={0.5}
      step={0.01}
      onChange={(v) => onUpdate({ nib: { ...block.nib, minFraction: v } })}
    />
    <button type="button" className="sidebarSmallAction" onClick={onReset} aria-label="Reset layout">
      Reset layout
    </button>
  </div>
);
```

Check `RangeRow`'s real prop names in `src/components/sidebar/FormControls.tsx` and match them.

- [ ] **Step 3: Mount it**

In `Sidebar.tsx`, add `onResetStackLayout?: () => void;` to the props, a `showStack` collapsible state like `showGuide`, and after the Guide panel:

```tsx
{selectedBlock?.type === "stack" && onResetStackLayout && (
  <div className="sidebarPanel">
    <CollapsibleSection title="Stacked composition" isOpen={showStack} onToggle={() => setShowStack((v) => !v)}>
      <StackPanel block={selectedBlock} onUpdate={onUpdateSelectedBlock} onReset={onResetStackLayout} />
    </CollapsibleSection>
  </div>
)}
```

`onUpdateSelectedBlock` takes `Partial<Block>`; `Partial<StackBlock>` is assignable to it. Confirm Transform and Effects panels still show for a stack (their conditions only exclude `image`/`guide`).

- [ ] **Step 4: Verification loop, then commit**

```bash
git add src/components/sidebar/StackPanel.tsx src/components/Sidebar.tsx src/App.tsx
git commit -m "Stack panel: split strokes, thinnest stroke, reset layout"
```

---

### Task 11: Teardrop and almond guides

**Files:**
- Modify: `src/types.ts` (`GuideShape`)
- Modify: `src/lib/guideShapes.ts`
- Modify: `src/components/GuideDialog.tsx` (`SHAPES`)
- Modify: `src/components/sidebar/GuidePanel.tsx` (`ROWS`)
- Test: `src/lib/guideShapes.test.ts`

- [ ] **Step 1: Failing tests**

In `src/lib/guideShapes.test.ts`, add `"teardrop"` and `"almond"` to its `SHAPES` list and append:

```ts
it("teardrop and almond are closed, centred, start at the top, and match their size", () => {
  for (const s of ["teardrop", "almond"] as const) {
    const cmds = parseSvgPath(guidePathD(s, GUIDE_DEFAULTS[s]));
    expect(isClosedPath(cmds)).toBe(true);
    const first = cmds[0];
    expect(first.type).toBe("M");
    if (first.type === "M") { expect(first.x).toBeCloseTo(0, 6); expect(first.y).toBeCloseTo(-(GUIDE_DEFAULTS[s].height ?? 0) / 2, 6); }
    const poly = pathToPolygon(cmds, 16);
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(GUIDE_DEFAULTS[s].width ?? 0, 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(GUIDE_DEFAULTS[s].height ?? 0, 0);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0, 0);
  }
});
```

Import `pathToPolygon` from `./svgPath` if not already.

- [ ] **Step 2: Implement**

`types.ts`: `export type GuideShape = "circle" | "ellipse" | "arc" | "wave" | "line" | "pen" | "teardrop" | "almond";`

`guideShapes.ts`: add to `GUIDE_DEFAULTS` `teardrop: { width: 260, height: 380 }, almond: { width: 220, height: 400 }`; to labels `teardrop: "Teardrop", almond: "Almond"`; and two cases in `guidePathD`:

```ts
case "teardrop": {
  // A circle of radius w/2 at the bottom, drawn up to a point at the top.
  const h = Math.max(p.height ?? w * 1.4, w);
  const r = w / 2, cy = h / 2 - r, k = 0.5523;
  const ty = -h / 2;
  return [
    `M 0 ${n(ty)}`,
    `C ${n(r * 0.45)} ${n(ty + (cy - ty) * 0.45)}, ${n(r)} ${n(cy - r * 0.6)}, ${n(r)} ${n(cy)}`,
    `C ${n(r)} ${n(cy + r * k)}, ${n(r * k)} ${n(h / 2)}, 0 ${n(h / 2)}`,
    `C ${n(-r * k)} ${n(h / 2)}, ${n(-r)} ${n(cy + r * k)}, ${n(-r)} ${n(cy)}`,
    `C ${n(-r)} ${n(cy - r * 0.6)}, ${n(-r * 0.45)} ${n(ty + (cy - ty) * 0.45)}, 0 ${n(ty)}`,
    "Z",
  ].join(" ");
}
case "almond": {
  const h = Math.max(p.height ?? w * 1.8, 2);
  const kx = w * 0.72, ky = h * 0.27;
  return [
    `M 0 ${n(-h / 2)}`,
    `C ${n(kx)} ${n(-h / 2 + ky)}, ${n(kx)} ${n(h / 2 - ky)}, 0 ${n(h / 2)}`,
    `C ${n(-kx)} ${n(h / 2 - ky)}, ${n(-kx)} ${n(-h / 2 + ky)}, 0 ${n(-h / 2)}`,
    "Z",
  ].join(" ");
}
```

If the width assertion misses by more than a unit for the almond, tune `0.72` (the bulge comes from the control points; `max x` of a cubic with both handles at `kx` is `0.75·kx`) — set `kx = w / 1.5` for an exact width.

`GuideDialog.tsx`: `SHAPES` gains `"teardrop", "almond"`. `GuidePanel.tsx` `ROWS` gains, for both, `[{ key: "width", label: "Width", min: 40, max: 1200 }, { key: "height", label: "Height", min: 40, max: 1600 }]`.

- [ ] **Step 3: Run tests, then the verification loop, then commit**

```bash
git add src/types.ts src/lib/guideShapes.ts src/lib/guideShapes.test.ts src/components/GuideDialog.tsx src/components/sidebar/GuidePanel.tsx
git commit -m "Teardrop and almond guides to arrange a stacked composition against"
```

---

### Task 12: End-to-end test, user guide, and the subsystem note

**Files:**
- Create: `e2e/stack.spec.ts`
- Create: `src/components/guide/sections/stacked.tsx`
- Create: `.claude/rules/stacked-compositions.md`
- Modify: `CLAUDE.md` (Block union sentence; Subsystem notes list), `PROGRESS.md`, `.claude/rules/deferred-features.md`

- [ ] **Step 1: The e2e spec**

Create `e2e/stack.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { getBlocks, gotoApp, setBlockText, settleFrames, blockClientBox } from "./harf";

const WORD = "مصبح";

async function convert(page: Page) {
  await page.getByLabel("Convert to stacked composition").click();
  await expect.poll(async () => (await getBlocks(page))[0].type).toBe("stack");
  await settleFrames(page);
}

/** Centre of a piece's hit polygon, in page px. */
async function pieceCentre(page: Page, index: number) {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getStage()!;
    const node = stage.find(".stack-piece")[i];
    const r = node.getClientRect();
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
  }, index);
}

test("converting bakes the block into pieces and undo brings the text back", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const before = await blockClientBox(page, 1);
  await convert(page);
  const block = (await getBlocks(page))[0];
  expect(block.type).toBe("stack");
  expect((block as { pieces: unknown[] }).pieces.length).toBeGreaterThanOrEqual(4);
  // Same footprint, give or take a pixel: convert-and-touch-nothing is the identity.
  const after = await blockClientBox(page, 1);
  expect(Math.abs(after.width - before.width)).toBeLessThan(3);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await getBlocks(page))[0].type).toBe("text");
});

test("dragging a letter lifts it and the letters after it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  await convert(page);
  const pieces = () => getBlocks(page).then((b) => (b[0] as { pieces: { role: string; order: number; y: number }[] }).pieces);
  const before = await pieces();
  const letters = before.filter((p) => p.role === "letter").sort((a, b) => a.order - b.order);
  // Piece polygons are mounted in `pieces` order; find the second letter's index.
  const idx = before.findIndex((p) => p === letters[1]);
  const c = await pieceCentre(page, idx);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 1, c.y - 2);
  await page.mouse.move(c.x, c.y - 60, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);
  const after = (await pieces()).filter((p) => p.role === "letter").sort((a, b) => a.order - b.order);
  expect(after[0].y).toBeCloseTo(letters[0].y, 3);           // the first letter stayed
  expect(after[1].y).toBeLessThan(letters[1].y - 10);        // the dragged one rose (y is down)
  expect(after[2].y).toBeLessThan(letters[2].y - 10);        // and carried the chain
  const box = await blockClientBox(page, 1);
  expect(box.height).toBeGreaterThan(0);
});
```

If `blockClientBox` or `settleFrames` have different names in `e2e/harf.ts`, use the real ones. Run `npx tsc --noEmit -p e2e/tsconfig.json` then `npm run e2e -- stack.spec.ts`.

- [ ] **Step 2: User guide section**

Create `src/components/guide/sections/stacked.tsx` (order 36.5 would sort oddly — use 37 and the title decides; or renumber: use `order: 39`):

```tsx
import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "stacked",
  title: "Stacking a word",
  order: 39,
  keywords: ["stack", "tarkib", "diwani", "name", "composition", "join", "tail", "convert", "teardrop"],
  Body: () => (
    <>
      <p>
        A Diwani name design piles its letters up, each one sitting a little above the
        last, with long sweeping strokes between them. To do that here, finish the word
        first — font, letter shapes, kashida — then open <strong>Content</strong> and press{" "}
        <strong>Convert to stacked composition</strong>.
      </p>
      <p>
        That bakes the letters into pieces you can move. Drag a letter and the letters
        after it come along; hold <kbd>Alt</kbd> to move one by itself. Hover a letter for
        its tilt handle. The strokes between letters are redrawn as curves as you go, with
        the pen's own thick-and-thin; drag the orange handle on a curve to bend it, and
        double-click it to straighten it again.
      </p>
      <h4>Tails</h4>
      <p>
        Tick <strong>Split strokes</strong> in the Stacked composition panel to see green
        dots on the straight strokes. Click one to cut the stroke there; the end becomes
        its own piece you can sweep out and round, the way the tail of a meem curls under a
        name.
      </p>
      <h4>Shape</h4>
      <p>
        Add a <strong>Teardrop</strong> or <strong>Almond</strong> guide and arrange the
        letters inside it by eye. Guides never print.
      </p>
      <p>
        Converting is one-way: the spelling can't be edited afterwards. Undo brings the
        text block back, or convert a fresh one.
      </p>
    </>
  ),
};
```

- [ ] **Step 3: The subsystem note**

Create `.claude/rules/stacked-compositions.md`:

```markdown
---
paths:
  - "src/lib/stack*.ts"
  - "src/components/StackView.tsx"
  - "src/components/StackEditOverlay.tsx"
  - "src/components/sidebar/StackPanel.tsx"
  - "e2e/stack.spec.ts"
---

# Stacked compositions (`stack` blocks)

A text block baked into rigid letter pieces joined by synthesised curves.
Design: `docs/superpowers/specs/2026-10-14-stacked-compositions-design.md`;
plan: `docs/superpowers/plans/2026-10-14-stacked-compositions.md`.

**It is a bake, and that is the point.** Nothing on the block is keyed by
text offset, cluster or glyph id, so none of the live-text machinery
(kashida remaps, `glyphId` checksums, Fit to width, Next Shape, diacritic
overrides, stroke cuts) applies — `blockCapabilities.ts` says so. The
spelling cannot be edited; undo restores the text block. Convert *after*
choosing letter shapes and spacing.

**Geometry is in font units, y-down, scaled by `stackScale(fontSize,
unitsPerEm)` at draw time.** `unitsPerEm` is stored on the block because
the font may be gone later (custom fonts). A save without it draws at 1000.

**The face vector is the nib.** A cut's two outline points are the pen's
cross-section; a join's edges are the centerline ± half a vector
interpolated between its two faces, so the stroke thins where the curve
runs along the pen and is full width across it. No per-font nib angle
exists or is needed. `nib.minFraction` floors the perpendicular thickness,
never at the two ends — the ends must land on the faces exactly or the
seam shows.

**A join is a splice, not a second shape.** `spliceJoin` finds each face's
straight bridge edge (left by `splitAtCut`), removes both, and threads the
two edges between the contours, producing one contour. That is why
outlines, shadows and SVG export are seam-free. Bridges are matched by
point equality after the same transform is applied to commands and faces;
keep `transformCmds` and `transformFace` arithmetically identical.

**Near is left is later.** HarfBuzz's RTL glyph array is in visual order
(index 0 leftmost = last in text). `splitAtCut`'s *near* side (x < cut in
the stroke's frame) is visually left, which is the **later** letter in
reading order. `convertRunToStack` relies on this when handing fragments
to pieces.

**A tail is a split plus a join.** `splitPieceAtCut` makes the far fragment
its own piece and joins it; dragging that piece sweeps the tail. There is
no tail-specific geometry.

**The piece transform rotates about a stored `pivot`**, the outline centre
at creation. `rebasePiece` recomputes it after a split so nothing moves.

**Drag chains.** `chainOf` returns the piece, its marks and — unless Alt —
every piece later in reading order with their marks. A chain move is a
translation only.

**The zone sweep runs only while "Split strokes" is armed** — fifteen
rotations per piece is too much for every render.

**Fallback joins.** Where no zone sits at a join, the convert handler
inserts a tatweel at that slot and converts again, **only when the shapable
text equals the block text** (cluster offsets index the shapable text).
Otherwise the pair stays unjoined and rigid.

**Old builds** render nothing for a `stack` block (CanvasStage's
fallthrough returns `null`); they do not crash.

Deferred: bending letter bodies (skeleton + nib) and font-side stacking
alternates — see [deferred-features.md](deferred-features.md).
```

- [ ] **Step 4: CLAUDE.md, PROGRESS.md, deferred-features**

- CLAUDE.md "The `Block` discriminated union" paragraph: add `StackBlock` to the parenthetical list with "a baked stacked composition, see stacked-compositions.md".
- CLAUDE.md "Subsystem notes": add
  `- **Stacked compositions** — [`.claude/rules/stacked-compositions.md`](.claude/rules/stacked-compositions.md). A bake: no text-offset keys, nothing re-shapes. Face vector is the nib; joins are splices into one contour; near = left = later letter. Zone sweep only while armed.`
- PROGRESS.md: a dated entry (2026-10-14) "Stacked compositions shipped" with one line and a pointer to the note.
- `.claude/rules/deferred-features.md`: change the stacked-compositions entry's first line to "Shipped 2026-10-14 (see stacked-compositions.md); two things left for later:" and keep the two bullets.

- [ ] **Step 5: Full verification, e2e, commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build && npx tsc --noEmit -p e2e/tsconfig.json && npm run e2e -- stack.spec.ts`

```bash
git add e2e/stack.spec.ts src/components/guide/sections/stacked.tsx .claude/rules/stacked-compositions.md .claude/rules/deferred-features.md CLAUDE.md PROGRESS.md
git commit -m "Stacked compositions: e2e, user guide, subsystem note"
```

---

## Self-review

**Spec coverage.** §1 data model → Task 1 (with the planned deviations listed at the top). §2 conversion → Tasks 5, 6 (identity invariant pinned in Task 5; fallback tatweel in Task 6; refusals in Task 6). §3 join synthesis → Task 3 (centerline, face-vector weight, floor, splice, identity). §4 interaction → Tasks 8 (move/chain/Alt/tilt/bend/reset-by-double-click), 9 (tails), 10 (panel, reset). §5 container guide → Task 11. §6 rendering/export/mirrors/capabilities → Tasks 1, 7. §7 testing → each task; e2e in Task 12. Ceiling and future → Task 12 docs.

**Type consistency.** `CutFace { a, b, tangent }` used identically in Tasks 1–5, 8. `PieceTransform` from Task 2 consumed by `pieceTransform` in Task 4 and the overlay in Task 8. `splitPieceAtCut` signature in Task 5 matches its call in Task 9. `stackScale` defined in Task 7 Step 1 before it is used in Tasks 7 and 8. `chainOf(pieces, id, alone)` consistent between Tasks 4 and 8.

**Review Focus coverage.** (1) no-join word → Task 5 test. (2) non-two crossings → Task 2 test. (3) rotated chain → Task 8 Step 1 test. (4) missing `unitsPerEm` → Task 7 Step 1 test. (5) old builds → documented in Task 12's note.

**Known soft spots to watch while executing.** Task 5's `inFar` test in `splitPieceAtCut` classifies existing faces by their `a` point only; a face straddling the cut cannot occur (two cuts on one stroke at the same place is not offered). Task 8's `pointerIn` parent depth must be verified against the real Konva tree.
