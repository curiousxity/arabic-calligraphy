# Stroke Stretch Hover Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Morph Glyph Editor's per-stroke `RangeRow` sliders with draggable on-canvas hover handles, for plain text blocks only.

**Architecture:** A new `StrokeStretchHoverHandles.tsx` Konva overlay (modeled on the existing `DiacriticHoverHandles.tsx`) mounts inside `ShapedText.tsx`. Hovering a letter with an authored stroke schema reveals one draggable dot per stroke zone; dragging is rail-constrained to the stroke's anchor→dragOrigin axis via a small new pure-math module. Dragging calls the already-existing `setStretchFactor`/`onSetStretchFactor` App.tsx handler (already handles "create on first movement, update after" and its own debounced history push) — no new state-mutation logic is needed in App.tsx, only new prop plumbing through `CanvasStage.tsx`. The Off/Stretch tool toggle and click-to-select-glyph flow are removed from `ShapedText.tsx` (text blocks only); `MorphGlyphEditor.tsx`'s per-stroke rows drop the slider in favor of a small numeric input, for text blocks only. Shape Fill / Shape Warp blocks are untouched throughout.

**Tech Stack:** React 19, TypeScript, Konva / react-konva, Vitest.

## Global Constraints

- Scope is plain **text blocks only** (`selectedBlock.type === "text"` / `block.type === "text"`). Shape Fill and Shape Warp blocks keep today's `RangeRow` sliders and Off/Stretch tool toggle completely unchanged.
- `dragOrigin` is the schema's `factor = 1` (natural) reference point and `dragX` is the `factor = maxFactor` reference point, both already established by `App.tsx`'s existing `setStretchFactor` — a stroke's on-canvas dot position for a given `factor` is `anchor + factor · (dragOrigin − anchor)`, directly reusing `factor` as the axis-interpolation parameter (no need to route through `resolveValueMultiplier`, which is a separate, renderer-side concern in `lib/glyphEdits.ts`).
- Reuse the existing debounced-history infrastructure already wired into `setStretchFactor`/`updateStretchHandle` (`scheduleGlyphEditHistoryPush` in `App.tsx`) — do not add a new debounce hook.
- After each task: run `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, in that order, and fix anything that fails before moving on. Run `npm run build` at the end of the plan (Task 5).

---

### Task 1: Pure axis math (`lib/strokeSchema/dragAxis.ts`)

**Files:**
- Create: `src/lib/strokeSchema/dragAxis.ts`
- Test: `src/lib/strokeSchema/dragAxis.test.ts`

**Interfaces:**
- Produces: `AxisPoint = { x: number; y: number }`, `dotPositionForFactor(anchor: AxisPoint, dragOrigin: AxisPoint, factor: number): AxisPoint`, `factorForPosition(anchor: AxisPoint, dragOrigin: AxisPoint, pos: AxisPoint, minFactor: number, maxFactor: number): number`, `projectOntoAxis(anchor: AxisPoint, dragOrigin: AxisPoint, pos: AxisPoint): AxisPoint` — all consumed by Task 2's `StrokeStretchHoverHandles.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/strokeSchema/dragAxis.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dotPositionForFactor, factorForPosition, projectOntoAxis } from "./dragAxis";

describe("dotPositionForFactor", () => {
  it("lands exactly on dragOrigin at factor 1", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    const p = dotPositionForFactor(anchor, dragOrigin, 1);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it("lands exactly on the extrapolated point at factor = maxFactor", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    const maxFactor = 1.8;
    const p = dotPositionForFactor(anchor, dragOrigin, maxFactor);
    expect(p.x).toBeCloseTo(180);
    expect(p.y).toBeCloseTo(0);
  });

  it("lands on the anchor at factor 0", () => {
    const anchor = { x: 10, y: 20 };
    const dragOrigin = { x: 10, y: 120 };
    const p = dotPositionForFactor(anchor, dragOrigin, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(20);
  });
});

describe("factorForPosition", () => {
  it("round-trips with dotPositionForFactor for a representative range", () => {
    const anchor = { x: 5, y: 5 };
    const dragOrigin = { x: 5, y: 105 };
    for (const factor of [0.85, 1, 1.2, 1.5, 1.8]) {
      const dot = dotPositionForFactor(anchor, dragOrigin, factor);
      const recovered = factorForPosition(anchor, dragOrigin, dot, 0.85, 1.8);
      expect(recovered).toBeCloseTo(factor, 5);
    }
  });

  it("round-trips on a diagonal axis", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 60, y: 80 }; // length 100
    for (const factor of [0.5, 1, 1.5, 2]) {
      const dot = dotPositionForFactor(anchor, dragOrigin, factor);
      const recovered = factorForPosition(anchor, dragOrigin, dot, 0, 3);
      expect(recovered).toBeCloseTo(factor, 5);
    }
  });

  it("clamps to minFactor/maxFactor", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    expect(factorForPosition(anchor, dragOrigin, { x: -50, y: 0 }, 0.85, 1.8)).toBeCloseTo(0.85);
    expect(factorForPosition(anchor, dragOrigin, { x: 500, y: 0 }, 0.85, 1.8)).toBeCloseTo(1.8);
  });

  it("ignores perpendicular offset (projects onto the axis)", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    // Directly above the dragOrigin point — perpendicular distance shouldn't change the factor.
    const factor = factorForPosition(anchor, dragOrigin, { x: 100, y: 40 }, 0, 3);
    expect(factor).toBeCloseTo(1);
  });
});

describe("projectOntoAxis", () => {
  it("leaves an on-axis point unchanged", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    const p = projectOntoAxis(anchor, dragOrigin, { x: 40, y: 0 });
    expect(p.x).toBeCloseTo(40);
    expect(p.y).toBeCloseTo(0);
  });

  it("projects an off-axis point onto the line", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 100, y: 0 };
    const p = projectOntoAxis(anchor, dragOrigin, { x: 40, y: 25 });
    expect(p.x).toBeCloseTo(40);
    expect(p.y).toBeCloseTo(0);
  });

  it("projects correctly on a diagonal axis", () => {
    const anchor = { x: 0, y: 0 };
    const dragOrigin = { x: 3, y: 4 }; // unit direction (0.6, 0.8), length 5
    // Point at distance 10 along the axis direction, offset perpendicular by 1 unit.
    const alongX = 0.6 * 10;
    const alongY = 0.8 * 10;
    const perpX = -0.8 * 1;
    const perpY = 0.6 * 1;
    const p = projectOntoAxis(anchor, dragOrigin, { x: alongX + perpX, y: alongY + perpY });
    expect(p.x).toBeCloseTo(alongX);
    expect(p.y).toBeCloseTo(alongY);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/strokeSchema/dragAxis.test.ts`
Expected: FAIL — `dragAxis.ts` doesn't exist yet (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/lib/strokeSchema/dragAxis.ts`:

```ts
export type AxisPoint = { x: number; y: number };

/**
 * A stroke's on-canvas stretch handle has no independent drag state of its
 * own — its rest position for a given `factor` is derived directly from the
 * anchor→dragOrigin axis already established at handle-creation time
 * (App.tsx's `setStretchFactor`): `dragOrigin` is defined as the `factor=1`
 * (natural) point, and `dragX` (not used here) as the `factor=maxFactor`
 * point, both on the same ray from `anchor`. So `factor` itself is already
 * the interpolation parameter along that ray — no need to go through
 * `lib/glyphEdits.ts`'s `resolveValueMultiplier`, which is a separate,
 * renderer-side concern for how a *glyph outline point* gets displaced, not
 * for where this UI handle sits.
 */
export function dotPositionForFactor(
  anchor: AxisPoint,
  dragOrigin: AxisPoint,
  factor: number
): AxisPoint {
  return {
    x: anchor.x + factor * (dragOrigin.x - anchor.x),
    y: anchor.y + factor * (dragOrigin.y - anchor.y),
  };
}

/**
 * Inverse of `dotPositionForFactor`: projects an arbitrary point onto the
 * anchor→dragOrigin axis and reads off the corresponding `factor`, clamped
 * to `[minFactor, maxFactor]`. Perpendicular distance from the axis is
 * ignored (a drag doesn't have to land exactly on the rail before this is
 * called — `projectOntoAxis` below is what actually constrains the visual
 * drag to the rail; this function just needs *a* point to read a factor
 * from).
 */
export function factorForPosition(
  anchor: AxisPoint,
  dragOrigin: AxisPoint,
  pos: AxisPoint,
  minFactor: number,
  maxFactor: number
): number {
  const dx = dragOrigin.x - anchor.x;
  const dy = dragOrigin.y - anchor.y;
  const axisLen = Math.max(Math.hypot(dx, dy), 1e-6);
  const dirX = dx / axisLen;
  const dirY = dy / axisLen;
  const relX = pos.x - anchor.x;
  const relY = pos.y - anchor.y;
  const along = relX * dirX + relY * dirY;
  const factor = along / axisLen;
  return Math.max(minFactor, Math.min(maxFactor, factor));
}

/**
 * Projects `pos` onto the anchor→dragOrigin line (unclamped — the caller
 * decides factor bounds separately via `factorForPosition`). Used as a
 * Konva `dragBoundFunc` to constrain a stretch handle's drag to a straight
 * rail instead of free 2D movement. All three points must be in the same
 * coordinate space — `dragBoundFunc` specifically receives/returns
 * *absolute* (stage) coordinates, so callers project the axis endpoints
 * into that same absolute space before calling this (see
 * `StrokeStretchHoverHandles.tsx`).
 */
export function projectOntoAxis(
  anchor: AxisPoint,
  dragOrigin: AxisPoint,
  pos: AxisPoint
): AxisPoint {
  const dx = dragOrigin.x - anchor.x;
  const dy = dragOrigin.y - anchor.y;
  const axisLen = Math.max(Math.hypot(dx, dy), 1e-6);
  const dirX = dx / axisLen;
  const dirY = dy / axisLen;
  const relX = pos.x - anchor.x;
  const relY = pos.y - anchor.y;
  const along = relX * dirX + relY * dirY;
  return { x: anchor.x + dirX * along, y: anchor.y + dirY * along };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/strokeSchema/dragAxis.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: all green.

```bash
git add src/lib/strokeSchema/dragAxis.ts src/lib/strokeSchema/dragAxis.test.ts
git commit -m "Add pure axis math for stroke-stretch hover handles"
```

---

### Task 2: `StrokeStretchHoverHandles.tsx` + wire into `ShapedText.tsx`

**Files:**
- Create: `src/components/StrokeStretchHoverHandles.tsx`
- Modify: `src/components/ShapedText.tsx`

**Interfaces:**
- Consumes: `dotPositionForFactor`/`factorForPosition`/`projectOntoAxis`/`AxisPoint` (Task 1), `mapNormToRealBox` (`src/lib/strokeSchema/schemaGeometry.ts`, already exists), `StretchDefinition` (`src/lib/strokeSchema/deriveCatalog.ts`, already exists), `GlyphEdit`/`GlyphStretchHandle` (`src/types.ts`, already exist), `GlyphHitBox` (`src/components/ShapedText.tsx`, already exported).
- Produces: `StrokeStretchHoverHandlesProps` and the `StrokeStretchHoverHandles` component, consumed by `ShapedText.tsx` in this task and by `CanvasStage.tsx` in Task 3 (via two new `ShapedText` props: `onSetStretchFactor?: (glyphIndex: number, definition: StretchDefinition, factor: number) => void` and `onDeleteStretchHandle?: (glyphIndex: number, handleId: string) => void`).

- [ ] **Step 1: Create `StrokeStretchHoverHandles.tsx`**

```tsx
import React, { useRef, useState } from "react";
import { Group, Circle, Rect, Line } from "react-konva";
import type { StretchDefinition } from "../lib/strokeSchema/deriveCatalog";
import { mapNormToRealBox } from "../lib/strokeSchema/schemaGeometry";
import {
  dotPositionForFactor,
  factorForPosition,
  projectOntoAxis,
  type AxisPoint,
} from "../lib/strokeSchema/dragAxis";
import type { GlyphEdit, GlyphStretchHandle } from "../types";
import type { GlyphHitBox } from "./ShapedText";

export type StrokeStretchHoverHandlesProps = {
  isSelected: boolean;
  /** One or more StretchDefinitions per glyph index that has an authored schema — absent/empty for a glyph with none. */
  glyphSchemaCatalog: Record<number, StretchDefinition[]>;
  glyphEdits: GlyphEdit[];
  glyphHitBoxes: GlyphHitBox[];
  /** Group-local x/y to add to a hit box's own x/y — same offset DiacriticHoverHandles already uses. */
  offsetX: number;
  offsetY: number;
  onSetStretchFactor?: (
    glyphIndex: number,
    definition: StretchDefinition,
    factor: number
  ) => void;
  onDeleteStretchHandle?: (glyphIndex: number, handleId: string) => void;
};

const DOT_COLOR = "#22c55e";
const DOT_ACTIVE_COLOR = "#16a34a";
const GUIDE_COLOR = "#22c55e";

function findHandle(
  edits: GlyphEdit[],
  glyphIndex: number,
  def: StretchDefinition
): GlyphStretchHandle | undefined {
  return edits
    .find((e) => e.glyphIndex === glyphIndex)
    ?.stretches.find(
      (h) => h.schemaStrokeId === def.strokeId && (h.schemaZoneIndex ?? 0) === def.zoneIndex
    );
}

/**
 * On-canvas hover-only overlay for setting a stroke's stretch `factor`
 * directly, replacing the Morph panel's per-stroke sliders for plain text
 * blocks (Shape Fill / Shape Warp keep the sliders). Modeled on
 * DiacriticHoverHandles.tsx: only the currently-hovered letter's dots ever
 * show, to keep text with many authored strokes from turning into visual
 * clutter. A dot's rest position for a given `factor` is
 * `anchor + factor · (dragOrigin - anchor)` (lib/strokeSchema/dragAxis.ts) —
 * `dragOrigin` is already the schema's `factor=1` reference point by
 * construction (App.tsx's `setStretchFactor`), so `factor` doubles directly
 * as the axis-interpolation parameter.
 */
export const StrokeStretchHoverHandles: React.FC<StrokeStretchHoverHandlesProps> = ({
  isSelected,
  glyphSchemaCatalog,
  glyphEdits,
  glyphHitBoxes,
  offsetX,
  offsetY,
  onSetStretchFactor,
  onDeleteStretchHandle,
}) => {
  const [hoveredGlyphIndex, setHoveredGlyphIndex] = useState<number | null>(null);
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const railRef = useRef<{ anchorAbs: AxisPoint; dragOriginAbs: AxisPoint } | null>(null);

  if (!isSelected) return null;

  const glyphIndicesWithSchema = Object.keys(glyphSchemaCatalog)
    .map(Number)
    .filter((i) => (glyphSchemaCatalog[i]?.length ?? 0) > 0);

  const draggingGlyphIndex =
    draggingRowKey != null ? Number(draggingRowKey.split(":")[0]) : null;
  const visibleGlyphIndex = hoveredGlyphIndex ?? draggingGlyphIndex;

  return (
    <Group>
      {glyphIndicesWithSchema.map((glyphIndex) => {
        const box = glyphHitBoxes.find((b) => b.glyphIndex === glyphIndex);
        if (!box) return null;

        // Generous margin so the hover area also covers where a dot can
        // travel while dragging — dots sit on the anchor->dragOrigin axis,
        // which commonly reaches somewhat outside the glyph's own bounding
        // box (e.g. a tooth or tail stroke stretching past the letter).
        const hitMargin = Math.max(box.width, box.height) * 0.6;

        return (
          <Group key={glyphIndex}>
            <Rect
              x={offsetX + box.x - hitMargin}
              y={offsetY + box.y - hitMargin}
              width={box.width + hitMargin * 2}
              height={box.height + hitMargin * 2}
              fill="transparent"
              onMouseEnter={() => setHoveredGlyphIndex(glyphIndex)}
              onMouseLeave={() =>
                setHoveredGlyphIndex((v) => (v === glyphIndex ? null : v))
              }
            />

            {visibleGlyphIndex === glyphIndex &&
              glyphSchemaCatalog[glyphIndex].map((def) => {
                const rowKey = `${glyphIndex}:${def.strokeId}:${def.zoneIndex}`;
                const handle = findHandle(glyphEdits, glyphIndex, def);
                const anchorLocal: AxisPoint = handle
                  ? { x: handle.anchorX, y: handle.anchorY }
                  : mapNormToRealBox(def.anchorNorm, box);
                const dragOriginLocal: AxisPoint = handle
                  ? { x: handle.dragOriginX, y: handle.dragOriginY }
                  : mapNormToRealBox(def.dragNorm, box);
                const factor = handle?.factor ?? 1;
                const dotLocal = dotPositionForFactor(anchorLocal, dragOriginLocal, factor);
                const isDragging = draggingRowKey === rowKey;

                return (
                  <Group key={rowKey}>
                    {isDragging && (
                      <Line
                        points={[
                          offsetX + anchorLocal.x,
                          offsetY + anchorLocal.y,
                          offsetX + dotLocal.x,
                          offsetY + dotLocal.y,
                        ]}
                        stroke={GUIDE_COLOR}
                        strokeWidth={1}
                        dash={[4, 3]}
                        listening={false}
                      />
                    )}
                    <Circle
                      x={offsetX + dotLocal.x}
                      y={offsetY + dotLocal.y}
                      radius={5}
                      fill={isDragging ? DOT_ACTIVE_COLOR : DOT_COLOR}
                      stroke="#ffffff"
                      strokeWidth={1.5}
                      draggable
                      onMouseDown={(e) => {
                        e.cancelBubble = true;
                      }}
                      onDragStart={(e) => {
                        e.cancelBubble = true;
                        const parent = e.target.getParent();
                        if (!parent) return;
                        const transform = parent.getAbsoluteTransform();
                        railRef.current = {
                          anchorAbs: transform.point({
                            x: offsetX + anchorLocal.x,
                            y: offsetY + anchorLocal.y,
                          }),
                          dragOriginAbs: transform.point({
                            x: offsetX + dragOriginLocal.x,
                            y: offsetY + dragOriginLocal.y,
                          }),
                        };
                        setDraggingRowKey(rowKey);
                      }}
                      dragBoundFunc={(pos) => {
                        const rail = railRef.current;
                        if (!rail) return pos;
                        return projectOntoAxis(rail.anchorAbs, rail.dragOriginAbs, pos);
                      }}
                      onDragMove={(e) => {
                        e.cancelBubble = true;
                        const localPos = e.target.position();
                        const nextFactor = factorForPosition(
                          { x: offsetX + anchorLocal.x, y: offsetY + anchorLocal.y },
                          { x: offsetX + dragOriginLocal.x, y: offsetY + dragOriginLocal.y },
                          localPos,
                          def.minFactor,
                          def.maxFactor
                        );
                        onSetStretchFactor?.(glyphIndex, def, nextFactor);
                      }}
                      onDragEnd={(e) => {
                        e.cancelBubble = true;
                        railRef.current = null;
                        setDraggingRowKey((v) => (v === rowKey ? null : v));
                      }}
                      onDblClick={(e) => {
                        e.cancelBubble = true;
                        if (handle) onDeleteStretchHandle?.(glyphIndex, handle.id);
                      }}
                      onDblTap={(e) => {
                        e.cancelBubble = true;
                        if (handle) onDeleteStretchHandle?.(glyphIndex, handle.id);
                      }}
                    />
                  </Group>
                );
              })}
          </Group>
        );
      })}
    </Group>
  );
};

export default StrokeStretchHoverHandles;
```

- [ ] **Step 2: Wire it into `ShapedText.tsx` and remove the `glyphEditTool` gate**

In `src/components/ShapedText.tsx`:

1. Add the import, near the existing `DiacriticHoverHandles` import:

```ts
import { StrokeStretchHoverHandles } from "./StrokeStretchHoverHandles";
```

2. In the `Props` type, remove the `glyphEditTool?: "stretch" | null;` line (around line 61) and add:

```ts
  onSetStretchFactor?: (
    glyphIndex: number,
    definition: StretchDefinition,
    factor: number
  ) => void;
  onDeleteStretchHandle?: (glyphIndex: number, handleId: string) => void;
```
right after the existing `onUpdateStretchHandle` prop declaration.

3. In the destructured props (around line 349), remove `glyphEditTool = null,` and `onGlyphSelect,` (this project's `tsconfig.app.json` sets `noUnusedParameters: true`, and after step 5 below `onGlyphSelect` is never called inside this component, so leaving it destructured fails the build — it stays declared in the `Props` type for `CanvasStage.tsx` to keep passing until Task 3 removes that call site, just not bound here). Add `onSetStretchFactor,` and `onDeleteStretchHandle,` right after the existing `onUpdateStretchHandle,` line.

4. Change the `selectedEdit` derivation (around line 549-552) from:

```ts
  const selectedEdit =
    glyphEditTool != null && selectedGlyphIndex != null
      ? glyphEdits.find((w) => w.glyphIndex === selectedGlyphIndex)
      : undefined;
```

to:

```ts
  const selectedEdit =
    selectedGlyphIndex != null
      ? glyphEdits.find((w) => w.glyphIndex === selectedGlyphIndex)
      : undefined;
```

5. On the outer `<Group>` (around line 694-730):

   - Remove `dragBoundFunc={glyphEditTool != null ? () => ({ x, y }) : undefined}` entirely (block dragging is no longer locked by a tool — text blocks drag normally, exactly like every other block type).
   - Replace the whole `onClick` handler body (the click-to-select-glyph logic) with:

```tsx
      onClick={() => {
        onClick?.();
      }}
```

   - Change `onDragMove={glyphEditTool == null ? onDragMove : undefined}` to `onDragMove={onDragMove}`.
   - Change `onDragEnd={glyphEditTool == null ? onDragEnd : undefined}` to `onDragEnd={onDragEnd}`.

6. Mount the new component right after the existing `<DiacriticHoverHandles ... />` block (around line 861):

```tsx
      <StrokeStretchHoverHandles
        isSelected={isSelected}
        glyphSchemaCatalog={glyphSchemaCatalog}
        glyphEdits={glyphEdits}
        glyphHitBoxes={glyphHitBoxes}
        offsetX={bx + localDrawX}
        offsetY={by + localDrawY}
        onSetStretchFactor={onSetStretchFactor}
        onDeleteStretchHandle={onDeleteStretchHandle}
      />
```

7. In the two mask-overlay JSX blocks (around lines 910 and 942), remove the `glyphEditTool === "stretch" &&` prefix from each condition:

```tsx
      {glyphMaskEdit?.mode === "contours" &&
        activeMaskHandle &&
        selectedGlyphContours.map((c) => {
```

and

```tsx
      {glyphMaskEdit?.mode === "lasso" && activeMaskHandle && (
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS. `onGlyphSelect` stays declared on `ShapedText`'s `Props` type (harmless — `CanvasStage.tsx` still passes it until Task 3 removes that one call site) but is no longer destructured/bound in the component itself, per step 3 above.

Run: `npm run lint`
Expected: PASS.

Run: `npm test`
Expected: PASS (all existing tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/components/StrokeStretchHoverHandles.tsx src/components/ShapedText.tsx
git commit -m "Add stroke-stretch hover handles, remove glyph-edit-tool gate from ShapedText"
```

---

### Task 3: Thread `onSetStretchFactor`/`onDeleteStretchHandle` through `CanvasStage.tsx` and `App.tsx`

**Files:**
- Modify: `src/components/CanvasStage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `setStretchFactor` and `deleteStretchHandle` (`src/App.tsx`, both already exist and are already wired to `MorphGlyphEditor`), `StrokeStretchHoverHandles`'s two new `ShapedText` props from Task 2.
- Produces: fully working end-to-end data flow — dragging a canvas handle now updates block state.

- [ ] **Step 1: Add the two new props to `CanvasStageProps`**

In `src/components/CanvasStage.tsx`, in the `CanvasStageProps` type (around line 56-61, right after `onUpdateStretchHandle`), add:

```ts
  onSetStretchFactor: (
    blockId: number,
    glyphIndex: number,
    definition: StretchDefinition,
    factor: number
  ) => void;
  onDeleteStretchHandle: (blockId: number, glyphIndex: number, handleId: string) => void;
```

(`StretchDefinition` is already imported at the top of this file.)

- [ ] **Step 2: Destructure the new props**

In the component's destructured parameters (around line 119, right after `onUpdateStretchHandle,`), add:

```ts
  onSetStretchFactor,
  onDeleteStretchHandle,
```

- [ ] **Step 3: Update the text-block JSX branch**

In the `block.type === "text"` branch (around lines 704-750):

- Remove the line `glyphEditTool={block.glyphEditTool ?? null}`.
- Remove the line `onGlyphSelect={(glyphIndex) => onSelectGlyph(block.id, glyphIndex)}`.
- Add, right after the existing `onUpdateStretchHandle={...}` block:

```tsx
                    onSetStretchFactor={(glyphIndex, definition, factor) =>
                      onSetStretchFactor(block.id, glyphIndex, definition, factor)
                    }
                    onDeleteStretchHandle={(glyphIndex, handleId) =>
                      onDeleteStretchHandle(block.id, glyphIndex, handleId)
                    }
```

Leave the `ShapeFillText` and `ShapeWarpText` branches (the other two occurrences of `glyphEditTool={block.glyphEditTool ?? null}` and `onGlyphSelect={...}` in this file) completely unchanged.

- [ ] **Step 4: Pass the two App.tsx handlers into `<CanvasStage>`**

In `src/App.tsx`, find the `<CanvasStage ... />` invocation (around line 2050, right after `onUpdateStretchHandle={updateStretchHandle}`) and add:

```tsx
          onSetStretchFactor={setStretchFactor}
          onDeleteStretchHandle={deleteStretchHandle}
```

- [ ] **Step 5: Stop forcing the Stretch tool on for text blocks in `setGlyphMaskEditMode`**

In `src/App.tsx`, replace the `setGlyphMaskEditMode` callback (around lines 421-439):

```ts
  const setGlyphMaskEditMode = useCallback(
    (blockId: number, glyphIndex: number, handleId: string, mode: "contours" | "lasso" | null) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && b.type !== "image" && b.type !== "textPath"
            ? mode
              ? {
                  ...b,
                  glyphEditTool: "stretch" as const,
                  selectedGlyphIndex: glyphIndex,
                  glyphMaskEdit: { handleId, mode },
                }
              : { ...b, glyphMaskEdit: null }
            : b
        )
      );
    },
    []
  );
```

with:

```ts
  // Arming a mask edit from the Morph panel's per-stroke rows also selects
  // that glyph on the canvas — the canvas contour/lasso overlays render for
  // the selected glyph while a mask edit is armed. Shape Fill/Shape Warp
  // still gate their overlay on the Stretch tool being turned on, so those
  // block types still need `glyphEditTool` forced on here; plain text
  // blocks dropped that gate entirely (ShapedText.tsx's overlay now checks
  // only `glyphMaskEdit`/`selectedGlyphIndex`), so leave their
  // `glyphEditTool` untouched.
  const setGlyphMaskEditMode = useCallback(
    (blockId: number, glyphIndex: number, handleId: string, mode: "contours" | "lasso" | null) => {
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || b.type === "image" || b.type === "textPath") return b;
          if (!mode) return { ...b, glyphMaskEdit: null };
          return {
            ...b,
            glyphEditTool: b.type === "text" ? b.glyphEditTool : ("stretch" as const),
            selectedGlyphIndex: glyphIndex,
            glyphMaskEdit: { handleId, mode },
          };
        })
      );
    },
    []
  );
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: all green.

- [ ] **Step 7: Manual smoke test**

Run: `npm run dev`, open the app, add a text block with a letter that has an authored schema (e.g. type "بسم" with the default font), select the block, hover the first letter on the canvas. Confirm: a small green dot appears; dragging it along its axis changes the letter's shape live; releasing keeps the change; Ctrl/Cmd+Z undoes it in one step; double-clicking the dot resets that stroke (removes the handle, glyph returns to its natural shape); dragging the block itself (not on a dot) still moves it normally.

- [ ] **Step 8: Commit**

```bash
git add src/components/CanvasStage.tsx src/App.tsx
git commit -m "Wire stroke-stretch hover handles through CanvasStage and App"
```

---

### Task 4: Update `MorphGlyphEditor.tsx` sidebar for text blocks

**Files:**
- Modify: `src/components/MorphGlyphEditor.tsx`

**Interfaces:**
- Consumes: `onSetStretchFactor` prop (already exists on `MorphGlyphEditorProps`, already wired from `App.tsx`).
- No new interfaces produced — this task only changes rendering.

- [ ] **Step 1: Hide the Off/Stretch tool toggle for text blocks**

In the `body` JSX (around lines 285-310), wrap the existing tool-toggle block and its helper paragraph in a type check. Replace:

```tsx
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {(
            [
              { value: null, label: "Off" },
              { value: "stretch", label: "Stretch" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => onSetGlyphEditTool?.(opt.value)}
              className="sidebarPillButton"
              style={
                (selectedBlock.glyphEditTool ?? null) === opt.value
                  ? { background: "var(--accent)", color: "var(--text-on-accent)" }
                  : undefined
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          Stretch shows the handles on the canvas (click a letter to inspect);
          the sliders below work either way.
        </div>
```

with:

```tsx
        {selectedBlock.type === "text" ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>
            Hover a letter on the canvas to drag its stroke handles directly —
            nothing needs to be turned on first.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {(
                [
                  { value: null, label: "Off" },
                  { value: "stretch", label: "Stretch" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => onSetGlyphEditTool?.(opt.value)}
                  className="sidebarPillButton"
                  style={
                    (selectedBlock.glyphEditTool ?? null) === opt.value
                      ? { background: "var(--accent)", color: "var(--text-on-accent)" }
                      : undefined
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Stretch shows the handles on the canvas (click a letter to inspect);
              the sliders below work either way.
            </div>
          </>
        )}
```

- [ ] **Step 2: Replace the per-stroke `RangeRow` with a numeric input for text blocks**

Find this block (around lines 366-381):

```tsx
                        <div style={{ flex: 1, minWidth: 0 }} title={def.label.ar}>
                          <RangeRow
                            id={makeId(`stroke-${rowKey}`, selectedId)}
                            name={makeId(`strokeFactor-${rowKey}`, selectedId)}
                            label={`${def.label.en ?? def.componentType}${def.kashidaEligible ? " · kashida" : ""}`}
                            value={value}
                            min={def.minFactor}
                            max={def.maxFactor}
                            step={0.01}
                            onChange={(v) =>
                              onSetStretchFactor?.(selectedBlock.id, glyphIndex, def, v)
                            }
                            suffix={value.toFixed(2)}
                          />
                        </div>
```

Replace it with:

```tsx
                        <div style={{ flex: 1, minWidth: 0 }} title={def.label.ar}>
                          {selectedBlock.type === "text" ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
                                {def.label.en ?? def.componentType}
                                {def.kashidaEligible ? " · kashida" : ""}
                              </span>
                              <input
                                type="number"
                                value={value.toFixed(2)}
                                min={def.minFactor}
                                max={def.maxFactor}
                                step={0.01}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  if (Number.isNaN(v)) return;
                                  const clamped = Math.max(
                                    def.minFactor,
                                    Math.min(def.maxFactor, v)
                                  );
                                  onSetStretchFactor?.(selectedBlock.id, glyphIndex, def, clamped);
                                }}
                                className="hexInput"
                                style={{ width: 64 }}
                                aria-label={`${def.label.en ?? def.componentType} factor`}
                              />
                            </div>
                          ) : (
                            <RangeRow
                              id={makeId(`stroke-${rowKey}`, selectedId)}
                              name={makeId(`strokeFactor-${rowKey}`, selectedId)}
                              label={`${def.label.en ?? def.componentType}${def.kashidaEligible ? " · kashida" : ""}`}
                              value={value}
                              min={def.minFactor}
                              max={def.maxFactor}
                              step={0.01}
                              onChange={(v) =>
                                onSetStretchFactor?.(selectedBlock.id, glyphIndex, def, v)
                              }
                              suffix={value.toFixed(2)}
                            />
                          )}
                        </div>
```

- [ ] **Step 3: Update the help dialog**

In `MorphHelpDialog`, right after the existing intro paragraph (`<p>Distort individual letterforms ... Not available for image blocks.</p>`, around line 55-58), add:

```tsx
          <p>
            On a plain text block, hover a letter on the canvas to reveal its
            stroke handles directly — drag one along its stretch axis instead
            of using a slider. Shape Fill and Shape Warp blocks still use the
            sliders below.
          </p>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: all green.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`. Select a text block with an authored letter — confirm the Off/Stretch buttons are gone and each stroke row shows a small number field instead of a slider; typing a value in range updates the letter live; typing an out-of-range value clamps. Select a Shape Fill or Shape Warp block with the same letter — confirm the Off/Stretch buttons and sliders still look and behave exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/components/MorphGlyphEditor.tsx
git commit -m "Replace text-block stroke sliders with a numeric input, hide the tool toggle"
```

---

### Task 5: Export check, CLAUDE.md documentation, final verification

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** None — documentation and verification only.

- [ ] **Step 1: Manually verify export doesn't show the hover handles**

With the dev server running (`npm run dev`), select a text block with a visible stroke handle (hover a letter so a dot shows), then trigger an export (PNG or SVG, via the sidebar's Save/Export panel) *without* first moving the mouse off the letter. Confirm the exported image shows no green dots/guide lines — `StrokeStretchHoverHandles` only renders while `isSelected` and while a specific glyph is actively hovered, and `useExport.ts`'s render pass doesn't involve live mouse state, so this is expected to already be clean with no code changes. If a dot does leak into an export, that's a real bug: file it as a follow-up rather than papering over it in this task (this plan doesn't include export-hiding logic since none should be needed).

- [ ] **Step 2: Verify mask editing ("By stroke" / "Lasso") still works for text blocks**

On a text block, create a stretch handle (drag a dot slightly), open its Options… panel in the sidebar, click "By stroke", confirm the contour highlight overlay appears on the canvas for that letter and clicking a contour toggles it green; click "Lasso", confirm dragging a loop on the canvas sets the mask. Click "Done" and confirm the overlay disappears. This exercises `setGlyphMaskEditMode`'s Task 3 change end-to-end.

- [ ] **Step 3: Verify Shape Fill / Shape Warp are unaffected**

Add a Shape Fill block and a Shape Warp block with the same schema-authored letter. Confirm both still show the Off/Stretch tool toggle, the `RangeRow` sliders, and clicking a letter with the Stretch tool on still selects it (unchanged click-to-select behavior) — none of this plan's changes should have touched `ShapeFillText.tsx` or `ShapeWarpText.tsx`.

- [ ] **Step 4: Update `CLAUDE.md`**

In the "Stroke-schema-driven glyph editor" section, find the bullet point beginning `- **No manual dragging — the axis is auto-derived from the schema's own geometry, sliders are the only control.**` and add a new bullet immediately after it:

```markdown
- **Plain text blocks moved back to on-canvas dragging (Shape Fill/Shape Warp did not).** `StrokeStretchHoverHandles.tsx` (modeled directly on `DiacriticHoverHandles.tsx`) is a second reversal, layered on top of the schema-derived axis the previous bullet describes: hovering a letter on a *selected plain text block* reveals one draggable dot per authored stroke zone, replacing that stroke's Morph-panel slider with direct on-canvas dragging (the panel keeps a small numeric input for typed precision instead). A dot's rest position for a given `factor` is `anchor + factor · (dragOrigin - anchor)` (`lib/strokeSchema/dragAxis.ts`) — since `dragOrigin` is already the schema-derived `factor=1` point and `dragX` the `factor=maxFactor` point (both established at handle-creation time, unchanged from before), `factor` itself doubles as the axis-interpolation parameter, with no new "manual anchor/drag positioning" reintroduced. Dragging is rail-constrained (Konva `dragBoundFunc` via `dragAxis.ts`'s `projectOntoAxis`, absolute-space, same technique `DiacriticHoverHandles.tsx`'s move handle already established) rather than free 2D movement. This is **plain text only** — same reasoning that kept the diacritic hover handles (see below) text-only: Shape Fill's tiled-row and Shape Warp's warped-envelope coordinate spaces are real, separate work. `ShapedText.tsx` also dropped the `glyphEditTool` ("Off"/"Stretch") gate entirely for its own click-to-select-glyph and mask-overlay-rendering logic — mask editing ("By stroke"/"Lasso") now arms directly via `selectedGlyphIndex` regardless of any tool state. `ShapeFillText.tsx`/`ShapeWarpText.tsx` still use `glyphEditTool` exactly as before.
```

- [ ] **Step 5: Full verification loop**

Run, in order:

```bash
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm test
npm run build
```

Expected: all four succeed.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "Document stroke-stretch hover handles in CLAUDE.md"
```
