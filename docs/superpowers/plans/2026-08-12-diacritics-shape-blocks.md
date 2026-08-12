# Diacritic Hover Handles on Shape Fill & Shape Warp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing per-instance diacritic hover handles from plain text blocks to Shape Fill and Shape Warp blocks.

**Architecture:** Generalise the single `DiacriticHoverHandles` component so it no longer assumes glyph-run coordinates. Each renderer hands it a list of *placements*, each carrying the mark's box in that renderer's own local space plus a matched `toCanvas`/`toLocal` function pair. All interaction logic stays in local space; only drawing and drag-interpretation cross the boundary.

**Tech Stack:** React 19, TypeScript, Vite, Konva/react-konva, opentype.js, harfbuzzjs, Vitest.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-12-diacritics-shape-blocks-design.md`. Read it before starting.
- Offsets are stored in **text space**, never screen space. A drag is inverted back into the glyph run's own coordinates.
- In the two new renderers the override transform is applied **before** the block's own deformation, pivoted on the glyph's pen origin. `ShapedText` keeps applying its override *after* `warpX`/`warpY` — this asymmetry is deliberate, documented in the spec, and must not be "fixed".
- `DiacriticOverride` keeps exactly its current `scale` / `offsetY` / `hidden` shape. No new fields.
- `hidden` skips the draw call but always keeps `penX += advance`, so hiding a mark never reflows surrounding letters.
- One override per glyph index. In Shape Fill it therefore applies to every tiled repetition — this is intended, matching `glyphEdits`.
- Plain text rendering and behaviour must not change. `ShapedText`'s adapter is the identity plus the offset it already applies.
- Text-on-path and image blocks stay out of scope.
- Verification loop after every task, in this order: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build`.
- Tests live beside the code they cover (`src/lib/*.test.ts`), never in a separate `__tests__` tree.

---

### Task 1: Extract the shape-warp point map into a testable lib module

`applyShapeWarpPoint` and `invertShapeWarpPoint` are currently module-private inside `ShapeWarpText.tsx`. Task 5 needs them as a placement adapter, and they need test coverage. Importing a `.tsx` file that pulls in react-konva into a Vitest node environment is fragile, so move the pure math into `src/lib/`. This is a pure refactor — no behaviour change.

**Files:**
- Create: `src/lib/shapeWarpPoint.ts`
- Create: `src/lib/shapeWarpPoint.test.ts`
- Modify: `src/components/ShapeWarpText.tsx` (delete lines 13, 109–210; add import)

**Interfaces:**
- Consumes: `GlyphBounds` from `src/lib/warp.ts` (already exported there, field-for-field identical to `ShapeWarpText.tsx`'s private copy).
- Produces:
  - `export type ShapeWarpMode = "envelope" | "topBottom" | "stretch" | "radial"`
  - `export function applyShapeWarpPoint(x, y, bounds: GlyphBounds, shapeW: number, shapeH: number, padding: number, mode: ShapeWarpMode, strength: number): { x: number; y: number }`
  - `export function invertShapeWarpPoint(targetX, targetY, bounds: GlyphBounds, shapeW: number, shapeH: number, padding: number, mode: ShapeWarpMode, strength: number): { x: number; y: number }`
  - Re-export: `export type { GlyphBounds } from "./warp"`

- [ ] **Step 1: Create the module by moving code verbatim**

Create `src/lib/shapeWarpPoint.ts`. Move these from `src/components/ShapeWarpText.tsx` **without editing their bodies**:

- line 13 — `type ShapeWarpMode` (change to `export type`)
- lines 109–111 — `clamp01` (stays module-private)
- lines 113–115 — `clampUnit` (stays module-private)
- lines 117–165 — `applyShapeWarpPoint` (change to `export function`)
- lines 167–210 — `invertShapeWarpPoint`, including its full doc comment (change to `export function`)

Head the file with:

```ts
import type { GlyphBounds } from "./warp";

export type { GlyphBounds };
```

Delete `ShapeWarpText.tsx`'s own `type GlyphBounds = {...}` block (lines 78–85) and the moved functions, then add at the top of its import list:

```ts
import {
  applyShapeWarpPoint,
  invertShapeWarpPoint,
  type ShapeWarpMode,
  type GlyphBounds,
} from "../lib/shapeWarpPoint";
```

- [ ] **Step 2: Verify the refactor compiles and changes nothing**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
```

Expected: both clean. If `tsc` reports `GlyphBounds` mismatches, the private copy was not field-for-field identical — stop and reconcile rather than casting.

- [ ] **Step 3: Write the round-trip test**

Create `src/lib/shapeWarpPoint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  applyShapeWarpPoint,
  invertShapeWarpPoint,
  type ShapeWarpMode,
  type GlyphBounds,
} from "./shapeWarpPoint";

const bounds: GlyphBounds = {
  minX: 0,
  minY: -80,
  maxX: 300,
  maxY: 20,
  rawWidth: 300,
  rawHeight: 100,
};

const MODES: ShapeWarpMode[] = ["envelope", "topBottom", "stretch", "radial"];

describe("invertShapeWarpPoint", () => {
  for (const mode of MODES) {
    it(`round-trips a point through ${mode} mode`, () => {
      for (const p of [
        { x: 10, y: -70 },
        { x: 150, y: -40 },
        { x: 290, y: 10 },
      ]) {
        const fwd = applyShapeWarpPoint(p.x, p.y, bounds, 400, 260, 24, mode, 1);
        const back = invertShapeWarpPoint(fwd.x, fwd.y, bounds, 400, 260, 24, mode, 1);
        expect(back.x).toBeCloseTo(p.x, 1);
        expect(back.y).toBeCloseTo(p.y, 1);
      }
    });

    it(`returns finite coordinates for ${mode} mode at zero strength`, () => {
      const fwd = applyShapeWarpPoint(150, -40, bounds, 400, 260, 24, mode, 0);
      const back = invertShapeWarpPoint(fwd.x, fwd.y, bounds, 400, 260, 24, mode, 0);
      expect(Number.isFinite(back.x)).toBe(true);
      expect(Number.isFinite(back.y)).toBe(true);
    });
  }
});
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/lib/shapeWarpPoint.test.ts
```

Expected: PASS. If a mode fails the round-trip, that is a real pre-existing limit of the Newton solver for that mode — do **not** loosen the tolerance to hide it. Record the mode and its actual error in the test as an explicit `it.fails` or a documented wider tolerance, and report it, because Task 5's handles will be correspondingly imprecise in that mode.

- [ ] **Step 5: Full verification and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add src/lib/shapeWarpPoint.ts src/lib/shapeWarpPoint.test.ts src/components/ShapeWarpText.tsx
git commit -m "Extract shape-warp point map into lib/shapeWarpPoint.ts with tests"
```

---

### Task 2: Add the pure placement adapters

**Files:**
- Create: `src/lib/diacriticPlacement.ts`
- Create: `src/lib/diacriticPlacement.test.ts`

**Interfaces:**
- Produces:
  - `export type PlacementPoint = { x: number; y: number }`
  - `export type PlacementAdapter = { toCanvas: (x: number, y: number) => PlacementPoint; toLocal: (x: number, y: number) => PlacementPoint }`
  - `export type DiacriticPlacement = { glyphIndex: number; key: string; box: { x: number; y: number; width: number; height: number } } & PlacementAdapter`
  - `export function makeOffsetAdapter(offsetX: number, offsetY: number): PlacementAdapter`
  - `export function makeShapeFillInstanceAdapter(p: { gx: number; gy: number; rotationDeg: number; scX: number; scY: number; shapeScale: number }): PlacementAdapter`

- [ ] **Step 1: Write the failing test**

Create `src/lib/diacriticPlacement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  makeOffsetAdapter,
  makeShapeFillInstanceAdapter,
} from "./diacriticPlacement";

describe("makeOffsetAdapter", () => {
  it("translates to canvas space and back", () => {
    const a = makeOffsetAdapter(30, -12);
    expect(a.toCanvas(5, 5)).toEqual({ x: 35, y: -7 });
    expect(a.toLocal(35, -7)).toEqual({ x: 5, y: 5 });
  });

  it("is the identity at zero offset", () => {
    const a = makeOffsetAdapter(0, 0);
    expect(a.toCanvas(7, 9)).toEqual({ x: 7, y: 9 });
  });
});

describe("makeShapeFillInstanceAdapter", () => {
  const cases = [
    { gx: 0, gy: 0, rotationDeg: 0, scX: 1, scY: 1, shapeScale: 1 },
    { gx: 40, gy: 120, rotationDeg: 0, scX: 1, scY: 1, shapeScale: 1 },
    { gx: 40, gy: 120, rotationDeg: 0, scX: 1.4, scY: 0.7, shapeScale: 1 },
    { gx: -25, gy: 60, rotationDeg: 18, scX: 1, scY: 1, shapeScale: 1 },
    { gx: 40, gy: 120, rotationDeg: -35, scX: 0.6, scY: 1.9, shapeScale: 2.5 },
    { gx: 5, gy: 5, rotationDeg: 90, scX: 2, scY: 2, shapeScale: 0.3 },
  ];

  for (const c of cases) {
    it(`round-trips with ${JSON.stringify(c)}`, () => {
      const a = makeShapeFillInstanceAdapter(c);
      for (const p of [
        { x: 0, y: 0 },
        { x: 12, y: -30 },
        { x: -8, y: 45 },
      ]) {
        const canvas = a.toCanvas(p.x, p.y);
        const back = a.toLocal(canvas.x, canvas.y);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    });
  }

  it("places a glyph-local origin at the instance origin, scaled by shapeScale", () => {
    const a = makeShapeFillInstanceAdapter({
      gx: 10, gy: 20, rotationDeg: 0, scX: 1, scY: 1, shapeScale: 2,
    });
    expect(a.toCanvas(0, 0)).toEqual({ x: 20, y: 40 });
  });

  it("applies row scale before rotation", () => {
    const a = makeShapeFillInstanceAdapter({
      gx: 0, gy: 0, rotationDeg: 90, scX: 3, scY: 1, shapeScale: 1,
    });
    const p = a.toCanvas(1, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(3, 6);
  });

  it("stays finite and invertible at degenerate zero scales", () => {
    const a = makeShapeFillInstanceAdapter({
      gx: 0, gy: 0, rotationDeg: 0, scX: 0, scY: 0, shapeScale: 0,
    });
    const canvas = a.toCanvas(4, 4);
    const back = a.toLocal(canvas.x, canvas.y);
    expect(Number.isFinite(canvas.x)).toBe(true);
    expect(Number.isFinite(canvas.y)).toBe(true);
    expect(Number.isFinite(back.x)).toBe(true);
    expect(Number.isFinite(back.y)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/diacriticPlacement.test.ts
```

Expected: FAIL — cannot resolve `./diacriticPlacement`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/diacriticPlacement.ts`:

```ts
export type PlacementPoint = { x: number; y: number };

/**
 * A matched pair converting between one renderer's own local coordinate
 * space and the Konva group space its overlay draws in. The only invariant
 * a caller must uphold is that a placement's `box` is expressed in the same
 * local space these two functions operate on — which space that is differs
 * per renderer, and `DiacriticHoverHandles` never needs to know.
 */
export type PlacementAdapter = {
  toCanvas: (x: number, y: number) => PlacementPoint;
  toLocal: (x: number, y: number) => PlacementPoint;
};

/**
 * One hoverable diacritic instance on canvas. `glyphIndex` says which
 * override it edits (Shape Fill draws the same glyph index many times, and
 * every one of those instances edits the same single override — matching
 * how `glyphEdits` already behaves there); `key` is unique per instance so
 * React can tell the repetitions apart.
 */
export type DiacriticPlacement = {
  glyphIndex: number;
  key: string;
  box: { x: number; y: number; width: number; height: number };
} & PlacementAdapter;

/** Smallest magnitude we will divide by, matching ShapeFillText's own idiom. */
const MIN_DIVISOR = 1e-4;

const safeDivisor = (v: number) =>
  Math.abs(v) < MIN_DIVISOR ? (v < 0 ? -MIN_DIVISOR : MIN_DIVISOR) : v;

/**
 * Plain translation — used by `ShapedText`, whose local space already *is*
 * the glyph-run space its overlay draws in, offset by the block's own
 * `bx + localDrawX` / `by + localDrawY`.
 */
export function makeOffsetAdapter(offsetX: number, offsetY: number): PlacementAdapter {
  return {
    toCanvas: (x, y) => ({ x: x + offsetX, y: y + offsetY }),
    toLocal: (x, y) => ({ x: x - offsetX, y: y - offsetY }),
  };
}

/**
 * One tiled repetition of one glyph in a Shape Fill block.
 *
 * Mirrors `ShapeFillText`'s own draw transform exactly: the tile loop does
 * `translate(gx, gy) → rotate → scale(scX, scY)` per glyph, and the whole
 * pass is wrapped in `scale(shapeScale)`. Canvas transforms compose
 * outside-in, so a glyph-local point maps as
 * `shapeScale · ( (gx, gy) + R · S · p )`.
 *
 * Deliberate approximation: the draw loop also applies an italic shear
 * (`transform(1, 0, -0.25, 1, 0, 0)`) inside this transform, which this
 * adapter ignores. On an italic Shape Fill block a handle therefore sits a
 * few pixels from where the mark is drawn. That is the same class of
 * approximation `DiacriticHoverHandles` already documents — the handle sits
 * where it is easy to grab, not exactly where the glyph pivots — and
 * italic is rare on Arabic text.
 */
export function makeShapeFillInstanceAdapter(p: {
  gx: number;
  gy: number;
  rotationDeg: number;
  scX: number;
  scY: number;
  shapeScale: number;
}): PlacementAdapter {
  const rad = (p.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sc = safeDivisor(p.shapeScale);
  const sx = safeDivisor(p.scX);
  const sy = safeDivisor(p.scY);

  return {
    toCanvas: (x, y) => {
      const ax = x * sx;
      const ay = y * sy;
      return {
        x: (p.gx + ax * cos - ay * sin) * sc,
        y: (p.gy + ax * sin + ay * cos) * sc,
      };
    },
    toLocal: (x, y) => {
      const rx = x / sc - p.gx;
      const ry = y / sc - p.gy;
      return {
        x: (rx * cos + ry * sin) / sx,
        y: (-rx * sin + ry * cos) / sy,
      };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/diacriticPlacement.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Full verification and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add src/lib/diacriticPlacement.ts src/lib/diacriticPlacement.test.ts
git commit -m "Add pure diacritic placement adapters with round-trip tests"
```

---

### Task 3: Generalise `DiacriticHoverHandles` to placements

Rewrite the overlay to consume `DiacriticPlacement[]` instead of `glyphHitBoxes` + `offsetX`/`offsetY`, and update `ShapedText` to build identity placements. **Plain text behaviour must be identical afterwards.**

**Files:**
- Modify: `src/components/DiacriticHoverHandles.tsx` (full rewrite of props and body)
- Modify: `src/components/ShapedText.tsx:853-864` (the `<DiacriticHoverHandles>` mount)

**Interfaces:**
- Consumes: `DiacriticPlacement`, `makeOffsetAdapter` from Task 2.
- Produces: `DiacriticHoverHandlesProps = { isSelected: boolean; placements: DiacriticPlacement[]; diacriticOverrides: DiacriticOverride[]; fontSize: number; onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void; onToggleDiacriticHidden?: (glyphIndex: number) => void }`. Tasks 5 and 6 mount this component with exactly these props.

Note the component no longer takes `glyphs` / `font` / `glyphHitBoxes`: filtering to actual diacritics moves to each renderer, which already computes `findDiacriticGlyphIndices` for its own draw pass.

- [ ] **Step 1: Rewrite the component**

Replace the whole body of `src/components/DiacriticHoverHandles.tsx`:

```tsx
import React, { useRef, useState } from "react";
import { Group, Circle, Rect } from "react-konva";
import { projectOntoAxis } from "../lib/strokeSchema/dragAxis";
import type { DiacriticPlacement } from "../lib/diacriticPlacement";
import type { DiacriticOverride } from "../types";

export type DiacriticHoverHandlesProps = {
  isSelected: boolean;
  /**
   * One entry per hoverable diacritic instance on canvas, already filtered
   * to real diacritics by the calling renderer. Each carries its own
   * local↔canvas mapping, so this component's arithmetic stays in local
   * space regardless of whether the host block warps, tiles, or neither.
   */
  placements: DiacriticPlacement[];
  diacriticOverrides: DiacriticOverride[];
  fontSize: number;
  onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void;
  onToggleDiacriticHidden?: (glyphIndex: number) => void;
};

const MOVE_HANDLE_COLOR = "#38bdf8";
const RESIZE_HANDLE_COLOR = "#d4af37";
const HIDE_BUTTON_COLOR = "#ef4444";
const HIDE_BUTTON_COLOR_ACTIVE = "#9ca3af";

/**
 * On-canvas hover-only overlay for adjusting individual diacritic marks.
 * Only the currently-hovered diacritic ever shows handles — that's what
 * keeps text with many marks from turning into visual clutter. Handles
 * are positioned at each diacritic's bounding-box center for easy
 * grabbing, while the actual render-time scale pivots around the glyph's
 * pen-origin — a deliberate, minor approximation: the handle sits where
 * it's easy to grab, not exactly where the glyph visually pivots from.
 *
 * All arithmetic below is in the placement's *local* space (the glyph run
 * for text and shape-warp blocks, one tiled glyph instance for shape-fill
 * blocks); `toCanvas` is applied only when drawing and `toLocal` only when
 * reading a drag back. That is the whole of what varies between block
 * types — hover state, the rail, the hit rect, and the three handles are
 * identical for all of them.
 */
export const DiacriticHoverHandles: React.FC<DiacriticHoverHandlesProps> = ({
  isSelected,
  placements,
  diacriticOverrides,
  fontSize,
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // Sticky-hover while a handle for this placement is actively being
  // dragged: the move handle can travel well outside the (generous but
  // still bounded) hit-rect during a normal drag, so rect containment
  // alone can't be trusted mid-gesture — this keeps the handle mounted
  // regardless of pointer position until the drag ends.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  // The move handle's rail, in absolute (stage) space, captured once at
  // drag start. Konva's dragBoundFunc receives and returns absolute
  // coordinates while everything else here is local, and mixing the two
  // previously teleported this handle sideways under any block
  // offset/pan/zoom. Under a warp the rail is not vertical on screen even
  // though it is vertical in local space, so it is stored as two mapped
  // endpoints rather than a single fixed x.
  const railRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);

  if (!isSelected) return null;

  const handleSpacing = fontSize * 0.25;
  // The hit-rect has to cover the full reach of all three handles, not just
  // the diacritic's own (typically tiny) bounding box: the gold/resize and
  // red/hide handles sit at rest `handleSpacing` to either side of center,
  // and the blue/move handle can be dragged a normal vertical distance away
  // while the gesture is in progress.
  const hitRectHorizontalMargin = handleSpacing + 12;
  const hitRectVerticalMargin = fontSize * 0.5;

  return (
    <Group>
      {placements.map((placement) => {
        const override = diacriticOverrides.find((o) => o.glyphIndex === placement.glyphIndex);
        const { box } = placement;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const overrideScale = override?.scale ?? 1;
        const displayY = cy + (override?.offsetY ?? 0);
        const isHovered = hoveredKey === placement.key || draggingKey === placement.key;

        // Local-space hit rect derived from the mark's actual rendered
        // position/size (displayY + scaled box), not its original
        // un-overridden box — otherwise a mark moved via offsetY or
        // enlarged via scale drifts out from under its own hit area.
        const scaledWidth = box.width * overrideScale;
        const scaledHeight = box.height * overrideScale;
        const rx1 = cx - scaledWidth / 2 - hitRectHorizontalMargin * overrideScale;
        const ry1 = displayY - scaledHeight / 2 - hitRectVerticalMargin * overrideScale;
        const rx2 = cx + scaledWidth / 2 + hitRectHorizontalMargin * overrideScale;
        const ry2 = displayY + scaledHeight / 2 + hitRectVerticalMargin * overrideScale;

        // A rotated or warped local rect is not an axis-aligned rect on
        // canvas, and Konva's Rect cannot express one. Map all four
        // corners and take their bounding box: slightly larger than the
        // true region, which only ever makes the mark easier to hover.
        const corners = [
          placement.toCanvas(rx1, ry1),
          placement.toCanvas(rx2, ry1),
          placement.toCanvas(rx1, ry2),
          placement.toCanvas(rx2, ry2),
        ];
        const xs = corners.map((c) => c.x);
        const ys = corners.map((c) => c.y);

        const moveAt = placement.toCanvas(cx, displayY);
        const resizeAt = placement.toCanvas(cx + handleSpacing, displayY);
        const hideAt = placement.toCanvas(cx - handleSpacing, displayY);

        // A non-invertible warp (Newton's method bailing on a near-singular
        // Jacobian) would otherwise mount a Circle at NaN, which Konva
        // silently renders at the origin. Drop the placement instead.
        if (![...xs, ...ys, moveAt.x, moveAt.y, resizeAt.x, resizeAt.y, hideAt.x, hideAt.y].every(Number.isFinite)) {
          return null;
        }

        return (
          <Group key={placement.key}>
            <Rect
              x={Math.min(...xs)}
              y={Math.min(...ys)}
              width={Math.max(...xs) - Math.min(...xs)}
              height={Math.max(...ys) - Math.min(...ys)}
              fill="transparent"
              onMouseEnter={() => setHoveredKey(placement.key)}
              onMouseLeave={() => setHoveredKey((v) => (v === placement.key ? null : v))}
            />

            {isHovered && (
              <>
                <Circle
                  x={moveAt.x}
                  y={moveAt.y}
                  radius={5}
                  fill={MOVE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  dragBoundFunc={(pos) => {
                    const rail = railRef.current;
                    if (!rail) return pos;
                    return projectOntoAxis(rail.a, rail.b, pos);
                  }}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    const parent = e.target.getParent();
                    if (parent) {
                      // The rail is "hold local x, vary local y". Two local
                      // points a font-size apart define it; mapping both
                      // through toCanvas and then the parent's absolute
                      // transform expresses it in the space dragBoundFunc
                      // actually speaks.
                      const transform = parent.getAbsoluteTransform();
                      const lo = placement.toCanvas(cx, displayY - fontSize);
                      const hi = placement.toCanvas(cx, displayY + fontSize);
                      railRef.current = {
                        a: transform.point(lo),
                        b: transform.point(hi),
                      };
                    }
                    setDraggingKey(placement.key);
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const pos = e.target.position();
                    const local = placement.toLocal(pos.x, pos.y);
                    if (!Number.isFinite(local.y)) return;
                    onDragDiacriticOverride?.(placement.glyphIndex, {
                      offsetY: local.y - cy,
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    railRef.current = null;
                    setDraggingKey((v) => (v === placement.key ? null : v));
                  }}
                />

                <Circle
                  x={resizeAt.x}
                  y={resizeAt.y}
                  radius={4}
                  fill={RESIZE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    setDraggingKey(placement.key);
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const pos = e.target.position();
                    const local = placement.toLocal(pos.x, pos.y);
                    if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return;
                    const dist = Math.hypot(local.x - cx, local.y - displayY);
                    const nextScale = Math.max(
                      0.3,
                      Math.min(3, dist / Math.max(handleSpacing, 1))
                    );
                    onDragDiacriticOverride?.(placement.glyphIndex, { scale: nextScale });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    setDraggingKey((v) => (v === placement.key ? null : v));
                  }}
                />

                <Circle
                  x={hideAt.x}
                  y={hideAt.y}
                  radius={4}
                  fill={override?.hidden ? HIDE_BUTTON_COLOR_ACTIVE : HIDE_BUTTON_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    onToggleDiacriticHidden?.(placement.glyphIndex);
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true;
                    onToggleDiacriticHidden?.(placement.glyphIndex);
                  }}
                />
              </>
            )}
          </Group>
        );
      })}
    </Group>
  );
};

export default DiacriticHoverHandles;
```

- [ ] **Step 2: Build identity placements in `ShapedText`**

Add to `ShapedText.tsx`'s imports:

```ts
import {
  makeOffsetAdapter,
  type DiacriticPlacement,
} from "../lib/diacriticPlacement";
```

`ShapedText` already computes `diacriticGlyphIndices` (line 391) and `glyphHitBoxes` (line 514). Add a memo just after `glyphHitBoxes` is declared — note `bx`, `by`, `localDrawX`, `localDrawY` are declared further down the component body, so this memo must be placed *after* them (the file's "defined above the point that references it" rule):

```ts
const diacriticPlacements = useMemo<DiacriticPlacement[]>(() => {
  const adapter = makeOffsetAdapter(bx + localDrawX, by + localDrawY);
  return glyphHitBoxes
    .filter((b) => diacriticGlyphIndices.has(b.glyphIndex))
    .map((b) => ({
      glyphIndex: b.glyphIndex,
      key: String(b.glyphIndex),
      box: { x: b.x, y: b.y, width: b.width, height: b.height },
      ...adapter,
    }));
}, [glyphHitBoxes, diacriticGlyphIndices, bx, by, localDrawX, localDrawY]);
```

Then replace the mount at lines 853–864 with:

```tsx
<DiacriticHoverHandles
  isSelected={isSelected}
  placements={diacriticPlacements}
  diacriticOverrides={diacriticOverrides}
  fontSize={fontSize}
  onDragDiacriticOverride={onDragDiacriticOverride}
  onToggleDiacriticHidden={onToggleDiacriticHidden}
/>
```

Leave the `StrokeStretchHoverHandles` mount and its ordering comment above it exactly as they are.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
```

Expected: all clean. `findDiacriticGlyphIndices` is no longer imported by `DiacriticHoverHandles.tsx`; make sure lint does not flag a now-unused import in either file.

- [ ] **Step 4: Confirm plain text is unchanged in the browser**

Run `npm run dev`. On a plain text block with tashkeel (e.g. `بِسْمِ اللَّهِ`), select it and confirm all three behaviours still work: hovering a mark shows three handles, the blue handle drags vertically without jumping sideways, the gold handle resizes, and the red handle hides the mark without reflowing the line. This is a refactor — any visible change is a regression, so stop and fix rather than proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/components/DiacriticHoverHandles.tsx src/components/ShapedText.tsx
git commit -m "Generalise DiacriticHoverHandles to coordinate-space placements"
```

---

### Task 4: Wire the state and support both shape renderers

This is one task in three parts. The state wiring (Part A) adds props that only Parts B and C declare, so splitting them would produce a commit that does not typecheck — which the Global Constraints forbid. Implement all three parts, then verify and commit once.

**Files:**
- Modify: `src/types.ts:150-167`
- Modify: `src/App.tsx:2101-2106`
- Modify: `src/components/Sidebar.tsx:1280` (Shape Fill panel), `:1591` (reset gate), plus prop type/destructure
- Modify: `src/components/CanvasStage.tsx:613-707`
- Modify: `src/components/ShapeWarpText.tsx`
- Modify: `src/components/ShapeFillText.tsx`

**Interfaces:**
- Consumes: `applyShapeWarpPoint` / `invertShapeWarpPoint` (Task 1); `makeShapeFillInstanceAdapter` / `DiacriticPlacement` (Task 2); `DiacriticHoverHandlesProps` (Task 3).
- Produces: nothing later tasks depend on in code — Task 5 only verifies and documents.

#### Part A — state and UI wiring

- [ ] **Step 1: Move the field in `types.ts`**

In `BlockCommon`, immediately after the `kashidaAmount` field, add:

```ts
  /**
   * Per-instance diacritic adjustments. Lives on BlockCommon rather than
   * TextBlock because plain text, shapeFill, and shapeWarp blocks all
   * support the on-canvas diacritic handles; image and textPath blocks
   * inherit it unused, the same intentional simplification glyphEdits
   * already makes.
   */
  diacriticOverrides?: DiacriticOverride[];
```

Delete `diacriticOverrides?: DiacriticOverride[];` from `TextBlock` (line 157).

In `ShapeFillBlock`, add:

```ts
  /** Arms the on-canvas diacritic hover handles. Opt-in on shapeFill only: a fill tiles its glyph run across the whole silhouette, so the handles' scanline layout pass and their per-instance hit rects are real cost. */
  diacriticEditMode?: boolean;
```

- [ ] **Step 2: Add the App handler**

In `src/App.tsx`, immediately after the `onToggleKashidaEditMode` prop passed to `<Sidebar>` (line 2101–2106), add:

```tsx
onToggleDiacriticEditMode={() => {
  if (!selectedBlock || selectedBlock.type !== "shapeFill") return;
  updateSelectedBlock({
    diacriticEditMode: !selectedBlock.diacriticEditMode,
  });
}}
```

`dragDiacriticOverride` and `toggleDiacriticHidden` (lines 582–616) patch by block id and never inspect `type`, so they need no change. `clearDiacritics` operates on `selectedBlock.text` generically — also unchanged.

- [ ] **Step 3: Update the Sidebar**

Add to `SidebarProps` beside `onToggleKashidaEditMode` (line 135):

```ts
  onToggleDiacriticEditMode?: () => void;
```

Add it to the destructured props beside `onToggleKashidaEditMode` (line 257).

Widen the reset-button gate at line 1591 from `selectedBlock?.type === "text" &&` to:

```tsx
{(selectedBlock?.type === "text" ||
  selectedBlock?.type === "shapeFill" ||
  selectedBlock?.type === "shapeWarp") &&
  (selectedBlock.diacriticOverrides?.length ?? 0) > 0 && (
```

Inside the Shape Fill panel (the `selectedBlock.type === "shapeFill"` block starting line 1280), after the existing "Tip:" hint div, add:

```tsx
<CheckboxRow
  id={makeId("diacritic-edit-mode", selectedId)}
  label="Diacritic tool"
  checked={!!selectedBlock.diacriticEditMode}
  onChange={() => onToggleDiacriticEditMode?.()}
/>

<div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
  Hover a tashkeel mark on the canvas to move, resize, or hide it. One
  change applies to every repetition of that mark in the fill.
</div>
```

Confirm `CheckboxRow` is already imported from `./sidebar/FormControls` — it is used by the Kashida tool row at line 1560.

- [ ] **Step 4: Thread the props in `CanvasStage`**

In the `<ShapeFillText>` block (ends line 658), add before the closing `/>`:

```tsx
isSelected={block.id === selectedId}
diacriticEditMode={block.diacriticEditMode ?? false}
diacriticOverrides={block.diacriticOverrides ?? []}
onDragDiacriticOverride={(glyphIndex, patch) =>
  onDragDiacriticOverride(block.id, glyphIndex, patch)
}
onToggleDiacriticHidden={(glyphIndex) => onToggleDiacriticHidden(block.id, glyphIndex)}
```

`ShapeFillText` already receives `isSelected` at line 641 — do **not** add a duplicate; add only the four new props there.

In the `<ShapeWarpText>` block (ends line 706), add:

```tsx
isSelected={block.id === selectedId}
diacriticOverrides={block.diacriticOverrides ?? []}
onDragDiacriticOverride={(glyphIndex, patch) =>
  onDragDiacriticOverride(block.id, glyphIndex, patch)
}
onToggleDiacriticHidden={(glyphIndex) => onToggleDiacriticHidden(block.id, glyphIndex)}
```

`ShapeWarpText` currently has **no** `isSelected` prop at all (`commonProps` does not supply one), so this genuinely is new for that component — Part B declares it.

At this point `tsc` will report unknown props on both components. That is expected mid-task; Parts B and C close it. Do not commit here.

#### Part B — Shape Warp

- [ ] **Step 5: Add the props**

Add to `ShapeWarpTextProps`:

```ts
  isSelected?: boolean;
  diacriticOverrides?: DiacriticOverride[];
  onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void;
  onToggleDiacriticHidden?: (glyphIndex: number) => void;
```

Destructure with defaults `isSelected = false`, `diacriticOverrides = []`.

Add imports:

```ts
import { findDiacriticGlyphIndices } from "../lib/diacritics";
import { DiacriticHoverHandles } from "./DiacriticHoverHandles";
import type { DiacriticPlacement } from "../lib/diacriticPlacement";
import type { DiacriticOverride } from "../types";
```

Add `DiacriticOverride` to the existing `../types` import rather than a second import statement if lint prefers that.

- [ ] **Step 6: Filter overrides to real diacritics**

After the `hitBoxes` memo (line 384–397), add — mirroring what `ShapedText.tsx:387-398` already does, so a stale override whose index now lands on a base letter is ignored instead of hiding or ballooning that letter:

```ts
const diacriticGlyphIndices = useMemo(
  () => findDiacriticGlyphIndices(shapeData.glyphs, shapeData.font),
  [shapeData.glyphs, shapeData.font]
);

const activeDiacriticOverrides = useMemo(
  () => diacriticOverrides.filter((o) => diacriticGlyphIndices.has(o.glyphIndex)),
  [diacriticOverrides, diacriticGlyphIndices]
);
```

- [ ] **Step 7: Apply overrides in the draw pass**

Inside `sceneFunc`'s glyph loop, right after `const edit = glyphEdits.find(...)` and before `const gx = ...`, add:

```ts
const diacriticOverride = activeDiacriticOverrides.find(
  (o) => o.glyphIndex === glyphIndex
);
if (diacriticOverride?.hidden) {
  penX += advance;
  continue;
}
```

Then change the body of `warpPoint` so the override transform is applied **before** the shape warp, pivoted on the glyph's pen origin:

```ts
const warpPoint = (cx: number, cy: number) => {
  // Override applied here, before applyShapeWarpPoint, so an adjusted
  // mark keeps being bent along with the rest of the run instead of
  // floating off its letter. This is deliberately the opposite order
  // from ShapedText, whose own warpX/warpY is a mild distortion rather
  // than the point of the block type — see the design spec.
  const ds = diacriticOverride?.scale ?? 1;
  const dy = diacriticOverride?.offsetY ?? 0;
  const baseX = gx + cx * ds;
  const baseY = gy + dy + cy * ds;
  const pGlyph = applyGlyphEdit(baseX, baseY, edit);
  const pRigged = applyPreparedGlyphRig(pGlyph.x, pGlyph.y, preparedRig);

  return applyShapeWarpPoint(
    pRigged.x,
    pRigged.y,
    glyphBounds,
    bw,
    bh,
    warpShapePadding,
    warpShapeMode,
    warpShapeStrength
  );
};
```

- [ ] **Step 8: Build placements and mount the overlay**

After the `invertToRawPoint` helper (line 446–456), add:

```ts
const diacriticPlacements = useMemo<DiacriticPlacement[]>(() => {
  const toCanvas = (x: number, y: number) => {
    const p = applyShapeWarpPoint(
      x, y, glyphBounds, bw, bh, warpShapePadding, warpShapeMode, warpShapeStrength
    );
    return { x: p.x + bx, y: p.y + by };
  };
  const toLocal = (x: number, y: number) => invertToRawPoint(x, y);

  return hitBoxes
    .filter((b) => diacriticGlyphIndices.has(b.glyphIndex))
    .map((b) => ({
      glyphIndex: b.glyphIndex,
      key: String(b.glyphIndex),
      box: { x: b.x, y: b.y, width: b.width, height: b.height },
      toCanvas,
      toLocal,
    }));
}, [
  hitBoxes,
  diacriticGlyphIndices,
  glyphBounds,
  bw,
  bh,
  bx,
  by,
  warpShapePadding,
  warpShapeMode,
  warpShapeStrength,
]);
```

`invertToRawPoint` already subtracts `bx`/`by` before inverting, so it is the exact inverse of `toCanvas` above. If lint flags `invertToRawPoint` as a missing dependency, wrap it in its own `useCallback` with the same dependency list rather than suppressing the rule.

Mount the overlay as the last child of the outer `<Group>`, after the drawing `<Shape>` (which closes at line 655):

```tsx
<DiacriticHoverHandles
  isSelected={isSelected}
  placements={diacriticPlacements}
  diacriticOverrides={diacriticOverrides}
  fontSize={fontSize}
  onDragDiacriticOverride={onDragDiacriticOverride}
  onToggleDiacriticHidden={onToggleDiacriticHidden}
/>
```

#### Part C — Shape Fill

- [ ] **Step 9: Add the props**

Add to `ShapeFillTextProps`:

```ts
  diacriticEditMode?: boolean;
  diacriticOverrides?: DiacriticOverride[];
  onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void;
  onToggleDiacriticHidden?: (glyphIndex: number) => void;
```

Destructure with defaults `diacriticEditMode = false`, `diacriticOverrides = []`. Add the same four imports Part B Step 5 lists, plus `makeShapeFillInstanceAdapter`.

- [ ] **Step 10: Widen the two `glyphEditTool` gates**

`glyphInstances` (line 343) currently starts `if (!glyphEditTool) return [];`. Change to:

```ts
if (!glyphEditTool && !diacriticEditMode) return [];
```

and add `diacriticEditMode` to that memo's dependency array.

The outer `<Group>`'s `dragBoundFunc` (line 428) currently reads `glyphEditTool != null ? () => ({ x, y }) : undefined`. Change to:

```tsx
dragBoundFunc={glyphEditTool != null || diacriticEditMode ? () => ({ x, y }) : undefined}
```

so dragging a mark's handle cannot drag the whole block with it. Leave `onDragMove`/`onDragEnd`'s `glyphEditTool == null` guards and the `onClick` glyph-picking logic alone — those are the Stretch tool's, and the diacritic handles stop their own events with `cancelBubble`.

- [ ] **Step 11: Filter overrides to real diacritics**

After the `glyphLocalBoxes` memo (line 304–329), add:

```ts
const diacriticGlyphIndices = useMemo(
  () => findDiacriticGlyphIndices(shapeData.glyphs, shapeData.font),
  [shapeData.glyphs, shapeData.font]
);

const activeDiacriticOverrides = useMemo(
  () => diacriticOverrides.filter((o) => diacriticGlyphIndices.has(o.glyphIndex)),
  [diacriticOverrides, diacriticGlyphIndices]
);
```

- [ ] **Step 12: Apply overrides in `drawGlyphRow`**

Inside `drawGlyphRow`'s glyph loop, right after `if (!g.obj || g.commands.length === 0) continue;`, add:

```ts
const diacriticOverride = activeDiacriticOverrides.find((o) => o.glyphIndex === gi);
if (diacriticOverride?.hidden) continue;
```

There is no `penX` accumulator to advance here — `glyphCache` precomputes each glyph's `penX`, so skipping the draw already leaves the surrounding letters untouched.

Then, inside the existing `targetCtx.save()` block, after `targetCtx.scale(scX, scY);` and before the italic transform, add:

```ts
if (diacriticOverride) {
  // Applied inside the row's own scale so an adjusted mark keeps being
  // scaled with its row, and pivoted on the glyph's pen origin — the
  // same meaning offsetY has on plain text.
  targetCtx.translate(0, diacriticOverride.offsetY ?? 0);
  const ds = diacriticOverride.scale ?? 1;
  targetCtx.scale(ds, ds);
}
```

Note `fauxBoldWidth` and `strokeWidth` are divided by `scX` further down that block; leave them as they are — the extra diacritic scale makes those stroke widths approximate on an overridden mark only, which is not worth complicating the expression for.

- [ ] **Step 13: Build placements and mount the overlay**

After the `glyphInstances` memo, add:

```ts
const diacriticPlacements = useMemo<DiacriticPlacement[]>(() => {
  if (!diacriticEditMode) return [];

  const boxByIndex = new Map(glyphLocalBoxes.map((b) => [b.glyphIndex, b]));

  return glyphInstances.flatMap((inst, i) => {
    if (!diacriticGlyphIndices.has(inst.glyphIndex)) return [];
    const box = boxByIndex.get(inst.glyphIndex);
    if (!box) return [];

    return [{
      glyphIndex: inst.glyphIndex,
      // Unique per tiled repetition, so React can tell the instances of
      // one mark apart. They all edit the same single override.
      key: `${i}:${inst.glyphIndex}`,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      ...makeShapeFillInstanceAdapter({
        gx: inst.gx,
        gy: inst.gy,
        rotationDeg: shapeFillTextRotation,
        scX: inst.scX,
        scY: inst.scY,
        shapeScale,
      }),
    }];
  });
}, [
  diacriticEditMode,
  glyphInstances,
  glyphLocalBoxes,
  diacriticGlyphIndices,
  shapeFillTextRotation,
  shapeScale,
]);
```

Mount the overlay **after** the drawing `<Shape>` (closes line 563) and **before** the `isSelected && !locked` resize `<Circle>` (line 565), so the corner resize handle keeps winning Konva's topmost-listener contest at the shape's bottom-right corner:

```tsx
<DiacriticHoverHandles
  isSelected={isSelected && diacriticEditMode}
  placements={diacriticPlacements}
  diacriticOverrides={diacriticOverrides}
  fontSize={fontSize}
  onDragDiacriticOverride={onDragDiacriticOverride}
  onToggleDiacriticHidden={onToggleDiacriticHidden}
/>
```

- [ ] **Step 14: Verify and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
```

Expected: fully clean. All three parts land in one commit, so no intermediate commit is left un-typechecked.

```bash
git add src/types.ts src/App.tsx src/components/Sidebar.tsx src/components/CanvasStage.tsx src/components/ShapeWarpText.tsx src/components/ShapeFillText.tsx
git commit -m "Support diacritic hover handles on Shape Fill and Shape Warp blocks"
```

---

### Task 5: Browser verification and documentation

The overlay components have no unit tests — jsdom cannot drive Konva hit-testing, the same reason `imageTrace.ts`'s canvas work is untested. This task is where the feature is actually proven to work.

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Verify Shape Warp in the browser**

Run `npm run dev`. Create a Shape Warp block, upload or draw a shape, and set its text to something with tashkeel (e.g. `بِسْمِ اللَّهِ`). With the block selected, for **each** of the four warp modes (envelope, topBottom, stretch, radial):

- Hover a mark — three handles appear, positioned on the mark as drawn, not somewhere off it.
- Drag the blue handle — the mark moves along the warped vertical rail and stays visually attached to its letter.
- Drag the gold handle — the mark grows/shrinks and remains inside the warp.
- Click the red handle — the mark disappears and the surrounding letters do **not** shift.

Record any mode where handle placement is visibly off; if Task 1 Step 4 flagged a mode as poorly invertible, that is the expected cause.

- [ ] **Step 2: Verify Shape Fill in the browser**

Create a Shape Fill block with the same text and a shape. Confirm:

- With "Diacritic tool" **off**, no handles appear and selecting the block is not noticeably slower than before.
- Turning it **on** reveals handles when hovering any mark in any tiled repetition.
- Dragging one instance's blue handle moves that mark in **every** repetition simultaneously.
- The gold and red handles likewise apply across all repetitions.
- Dragging a handle does not drag the whole block.
- The gold corner resize handle at the shape's bottom-right still works with the tool on.

- [ ] **Step 3: Verify the Sidebar**

- "Reset diacritic overrides" appears for Shape Fill and Shape Warp blocks once they have overrides, and clears them.
- It still appears and works for plain text blocks.
- Undo/redo steps through diacritic drags (they are debounced via `useDebouncedHistoryPush`, so a continuous drag collapses to one history entry) and through hide-clicks individually.

- [ ] **Step 4: Update `CLAUDE.md`**

Under "Deferred features", delete the entire **"Diacritic hover handles on Shape Fill and Shape Warp blocks"** bullet.

In the "Per-instance diacritic control" section, replace the final paragraph (the one beginning "This feature is `ShapedText.tsx`-only for v1") with:

```markdown
This feature covers plain text, Shape Fill, and Shape Warp blocks.
`DiacriticHoverHandles.tsx` takes a list of `DiacriticPlacement`s
(`src/lib/diacriticPlacement.ts`) rather than raw hit boxes — each carries
the mark's box in its renderer's own local space plus a matched
`toCanvas`/`toLocal` pair, so all of the overlay's arithmetic (hover, the
drag rail, the hit rect, the three handles) stays in local space and only
drawing and drag-readback cross into canvas space. `ShapedText`'s adapter
is a plain translation; `ShapeWarpText`'s is
`applyShapeWarpPoint`/`invertShapeWarpPoint` (moved to
`src/lib/shapeWarpPoint.ts` to be testable — the inverse is Newton's
method, since none of the four warp modes has a closed-form inverse);
`ShapeFillText`'s is the per-tile affine transform, which deliberately
ignores the italic shear.

Two behaviours differ per block type, both deliberate. **Order:**
`ShapedText` applies an override *after* its own `warpX`/`warpY` (it is a
`ctx` transform wrapping already-warped point math), while Shape Fill and
Shape Warp apply it *before* their deformation — those deformations are
the entire point of those block types, and an override applied after would
detach the mark from its letter. **Arming:** Shape Warp shows handles on
selection like plain text, but Shape Fill requires an explicit "Diacritic
tool" checkbox (`diacriticEditMode` on `ShapeFillBlock`), because a fill
tiles its run across the whole silhouette and two marks can become 200+
instances — that checkbox also widens `glyphInstances`'s memo guard and
the block's `dragBoundFunc` pin, both of which were previously
`glyphEditTool`-only. Because overrides are keyed by glyph index, one
adjustment applies to every tiled repetition, exactly as `glyphEdits`
already does there.

Text-on-path blocks remain unsupported — their glyphs are rotated to a
curve tangent, which is separate design work.
```

- [ ] **Step 5: Final verification and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add CLAUDE.md
git commit -m "Document diacritic handles on shape blocks; drop from deferred list"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Overlay contract (`DiacriticPlacement`, rail change) | 2, 3 |
| Adapters table (text / warp / fill) | 2 (fill, text), 4 Part B (warp) |
| Render-time application, `hidden` keeps advance | 4 Parts B and C |
| Mount points and Konva ordering | 3, 4 |
| Text-space offset semantics | 4 |
| Known order asymmetry vs `ShapedText` | 4 (code comment), 5 (CLAUDE.md) |
| Arming: warp on selection, fill on checkbox | 4 Parts A and C |
| `glyphInstances` guard + `dragBoundFunc` pin | 4 Step 10 |
| `types.ts` / `App.tsx` / `Sidebar.tsx` / `CanvasStage.tsx` | 4 Part A |
| Non-finite `toLocal` drops the placement | 3 |
| Near-zero divisor guards | 2 (`safeDivisor`) |
| No shape path → zero placements | 4 (`glyphInstances` returns `[]`) |
| Stale overrides filtered per render | 4 Parts B and C |
| `diacriticPlacement.ts` round-trip tests | 2 |
| `invertShapeWarpPoint` round-trip tests | 1 |
| Browser verification | 5 |

No gaps.

**Type consistency:** `DiacriticPlacement`, `PlacementAdapter`, `makeOffsetAdapter`, `makeShapeFillInstanceAdapter`, `applyShapeWarpPoint`, `invertShapeWarpPoint`, `findDiacriticGlyphIndices`, `projectOntoAxis`, and the `DiacriticHoverHandlesProps` field names are used identically across Tasks 1–4.

**Commit integrity:** every task commits only after the full verification loop passes, so no commit on the branch fails to typecheck. Task 4 is deliberately larger than the others for exactly this reason — its three parts are mutually dependent at the type level.
