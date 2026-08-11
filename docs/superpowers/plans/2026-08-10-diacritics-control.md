# Diacritics Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user hover any individual tashkeel mark on a plain text block and drag it to reposition (vertical offset), drag another handle to resize it, and click a button to hide just that one instance — without touching the block's text or affecting any other diacritic.

**Architecture:** Diacritic glyph instances are identified by looking up each shaped glyph's HarfBuzz cluster back into the shaped text and testing it against the app's existing (currently private) Arabic-diacritic regex — no new shaping-layer work. Per-instance overrides (`scale`/`offsetY`/`hidden`) are stored on the block, keyed by glyph index (the same keying scheme the existing Stretch tool already uses), applied inside `ShapedText.tsx`'s shared glyph-draw loop as an extra transform pivoted on the glyph's own pen-origin, and edited via a new hover-only overlay component reusing `ShapedText.tsx`'s existing per-glyph hit-box data.

**Tech Stack:** React 19 + TypeScript, Konva/react-konva, Vitest for the new `lib/diacritics.ts` unit tests.

## Global Constraints

- Run `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build` — in that order — after each task, not after every small edit.
- Every mutating handler in `App.tsx` calls `pushHistory()` before changing `blocks` state; continuous/live-updating gestures (drag) instead call a debounced scheduler from `useDebouncedHistoryPush` after `setBlocks` — matching the existing `updateKashidaText`/`scheduleKashidaHistoryPush` pattern. Never invent a third pattern.
- New block-type-specific Konva interactions get their own dedicated named prop threaded through `CanvasStage`, matching how `onKashidaTextChange`/`onUpdateStretchHandle`/`onResizeShapeFillBlock` are already done — never add a generic untyped "onUpdateBlock" prop to `CanvasStage`.
- `Partial<Block>` update paths (`updateBlock`/`updateSelectedBlock` in `App.tsx`) already cast `as Block` — reuse `updateSelectedBlock` for the reset action rather than writing a new bespoke handler for it.
- This feature is `ShapedText.tsx`-only (plain `text` blocks). Shape Fill, Shape Warp, and Image blocks are untouched.
- `glyph.cl` indexes into `shapableText` (the text *after* diacritic-stripping in `harfbuzz.ts`), never the block's raw `text`.

---

## File Structure

New files:
- `src/lib/diacritics.ts` — `findDiacriticGlyphIndices(glyphs, shapableText)`, built on the newly-exported `ARABIC_DIACRITIC_RE`.
- `src/lib/diacritics.test.ts` — unit tests for the above.
- `src/components/DiacriticHoverHandles.tsx` — the on-canvas hover-only move/resize/hide overlay. One job: this interaction, nothing else.

Modified files:
- `src/types.ts` — new `DiacriticOverride` type, `TextBlock.diacriticOverrides`.
- `src/lib/harfbuzz.ts` — export the existing private `ARABIC_DIACRITIC_RE`.
- `src/components/ShapedText.tsx` — `drawWarpedGlyphRun` applies overrides; new `isSelected`/`diacriticOverrides`/`onDragDiacriticOverride`/`onToggleDiacriticHidden` props; renders `DiacriticHoverHandles`; exports its private `GlyphHitBox` type (mirroring `ShapeWarpText.tsx`, which already exports its own copy of this type).
- `src/App.tsx` — `dragDiacriticOverride`, `toggleDiacriticHidden`, `scheduleDiacriticHistoryPush`; reset action reuses `updateSelectedBlock`.
- `src/components/CanvasStage.tsx` — new `onDragDiacriticOverride`/`onToggleDiacriticHidden` props, threaded to `ShapedText`.
- `src/components/Sidebar.tsx` — "Reset diacritic overrides" button next to the existing "Clear diacritics" button.

---

### Task 1: `DiacriticOverride` type

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `export type DiacriticOverride = { glyphIndex: number; scale?: number; offsetY?: number; hidden?: boolean; }` and `TextBlock.diacriticOverrides?: DiacriticOverride[]`. Every later task consumes this type.

- [ ] **Step 1: Add the type**

In `src/types.ts`, add after `GlyphRigValue`:

```ts
/**
 * A per-instance manual adjustment to one shaped diacritic glyph — keyed
 * by glyphIndex, the same scheme GlyphStretchHandle already uses (and
 * shares its known fragility: a text edit before this glyph in the string
 * can shift which glyph index the override lands on after re-shaping).
 */
export type DiacriticOverride = {
  glyphIndex: number;
  /** Multiplier on the diacritic's natural size. Default 1. */
  scale?: number;
  /** Extra vertical shift in local (unscaled) units. Default 0. */
  offsetY?: number;
  /** When true, this instance is skipped entirely during drawing. */
  hidden?: boolean;
};
```

Add to `TextBlock`:

```ts
export type TextBlock = BlockCommon & {
  type: "text";
  align?: TextAlign;
  lineHeight?: number;
  warpX?: number;
  warpY?: number;
  kashidaEditMode?: boolean;
  diacriticOverrides?: DiacriticOverride[];
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no new errors (purely additive, nothing references it yet).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "Add DiacriticOverride type and TextBlock.diacriticOverrides field"
```

---

### Task 2: Diacritic-instance detection (`lib/diacritics.ts`)

**Files:**
- Modify: `src/lib/harfbuzz.ts`
- Create: `src/lib/diacritics.ts`
- Create: `src/lib/diacritics.test.ts`

**Interfaces:**
- Consumes: `type HarfBuzzGlyph` from `src/lib/harfbuzz.ts` (already exported).
- Produces: `export const ARABIC_DIACRITIC_RE` (now exported from `harfbuzz.ts`) and `findDiacriticGlyphIndices(glyphs: HarfBuzzGlyph[], shapableText: string): Set<number>`. Task 4 (`DiacriticHoverHandles.tsx`) consumes `findDiacriticGlyphIndices`.

- [ ] **Step 1: Export the existing diacritic regex**

In `src/lib/harfbuzz.ts`, find:

```ts
const ARABIC_DIACRITIC_RE =
```

Change to:

```ts
export const ARABIC_DIACRITIC_RE =
```

(Leave everything else about it — the comment above it, `stripUnsupportedDiacritics`'s use of it — unchanged.)

- [ ] **Step 2: Write the failing tests**

Create `src/lib/diacritics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HarfBuzzGlyph } from "./harfbuzz";
import { findDiacriticGlyphIndices } from "./diacritics";

describe("findDiacriticGlyphIndices", () => {
  it("identifies a diacritic glyph by its cluster's source character", () => {
    // "بَ" — beh (U+0628) followed by fatha (U+064E). Two shaped glyphs,
    // each glyph's own cluster equal to its source character's index.
    const shapableText = "بَ";
    const glyphs: HarfBuzzGlyph[] = [
      { g: 10, cl: 0 }, // beh
      { g: 20, cl: 1 }, // fatha
    ];
    const result = findDiacriticGlyphIndices(glyphs, shapableText);
    expect(result.has(0)).toBe(false);
    expect(result.has(1)).toBe(true);
  });

  it("returns an empty set when no glyph is a diacritic", () => {
    const shapableText = "بت"; // beh, teh — two plain letters
    const glyphs: HarfBuzzGlyph[] = [
      { g: 10, cl: 0 },
      { g: 11, cl: 1 },
    ];
    expect(findDiacriticGlyphIndices(glyphs, shapableText).size).toBe(0);
  });

  it("identifies multiple diacritics in one run", () => {
    // "بِّ" — beh, shadda (U+0651), kasra (U+0650).
    const shapableText = "بِّ";
    const glyphs: HarfBuzzGlyph[] = [
      { g: 10, cl: 0 },
      { g: 21, cl: 1 },
      { g: 22, cl: 2 },
    ];
    const result = findDiacriticGlyphIndices(glyphs, shapableText);
    expect(result.has(0)).toBe(false);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
    expect(result.size).toBe(2);
  });

  it("treats a missing cluster as index 0 (HarfBuzzGlyph.cl is optional)", () => {
    const shapableText = "َ"; // fatha alone
    const glyphs: HarfBuzzGlyph[] = [{ g: 20 }];
    expect(findDiacriticGlyphIndices(glyphs, shapableText).has(0)).toBe(true);
  });

  it("returns an empty set for an empty glyph array", () => {
    expect(findDiacriticGlyphIndices([], "").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/diacritics.test.ts`
Expected: FAIL — `Cannot find module './diacritics'`.

- [ ] **Step 3: Implement `lib/diacritics.ts`**

Create `src/lib/diacritics.ts`:

```ts
import type { HarfBuzzGlyph } from "./harfbuzz";
import { ARABIC_DIACRITIC_RE } from "./harfbuzz";

/**
 * Returns the set of shaped-glyph array indices whose source character is
 * an Arabic diacritic (harakat/tanween/sukun/shadda/etc.). Each glyph's
 * HarfBuzz cluster (`glyph.cl`) is used as a character offset into
 * `shapableText` — the same cluster-to-source-character technique
 * strokeSchema/glyphLookup.ts uses for a different purpose.
 *
 * `shapableText` must be the text actually shaped (see useShapedGlyphs'
 * `shapableText` field), not the block's raw `text` — `glyph.cl` indexes
 * into that string, not the original input.
 */
export function findDiacriticGlyphIndices(
  glyphs: HarfBuzzGlyph[],
  shapableText: string
): Set<number> {
  const result = new Set<number>();
  for (let i = 0; i < glyphs.length; i++) {
    const cluster = glyphs[i].cl ?? 0;
    const ch = shapableText[cluster];
    if (ch != null && ARABIC_DIACRITIC_RE.test(ch)) {
      result.add(i);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/diacritics.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/harfbuzz.ts src/lib/diacritics.ts src/lib/diacritics.test.ts
git commit -m "Add diacritic glyph-instance detection (findDiacriticGlyphIndices)"
```

---

### Task 3: Render-time application of overrides

**Files:**
- Modify: `src/components/ShapedText.tsx`

**Interfaces:**
- Consumes: `DiacriticOverride` (`types.ts`, Task 1).
- Produces: `ShapedText`'s `diacriticOverrides?: DiacriticOverride[]` prop (default `[]`), threaded into `drawWarpedGlyphRun`. Task 4 consumes this same prop name and the `drawWarpedGlyphRun` param it adds.

There is no on-canvas way to *create* an override yet (that's Task 4) — this task is verified by type-check/lint/build and a manual code trace, not a live visual check. Visual confirmation happens once Task 4 lands.

- [ ] **Step 1: Add the `diacriticOverrides` param to `drawWarpedGlyphRun`**

In `src/components/ShapedText.tsx`, add `DiacriticOverride` to the existing type import from `"../types"`:

```ts
import type {
  GlyphEdit,
  GlyphStretchHandle,
  GlyphRig,
  GlyphRigValue,
  GlyphStretchMask,
  DiacriticOverride,
} from "../types";
```

Change `drawWarpedGlyphRun`'s signature (add the new last parameter):

```ts
function drawWarpedGlyphRun(
  ctx: CanvasRenderingContext2D,
  glyphs: HarfBuzzGlyph[],
  font: NonNullable<ShapedTextResult["font"]>,
  fontSize: number,
  unitsPerEm: number,
  bounds: GlyphBounds,
  warpX: number,
  warpY: number,
  drawStroke: boolean,
  strokeColor: string,
  strokeWidth: number,
  fauxBoldWidth = 0,
  overrideGlyph: OverrideGlyph | null = null,
  glyphEdits: GlyphEdit[] = [],
  fontFamily = "",
  glyphRigs: GlyphRig[] = [],
  glyphRigValues: GlyphRigValue[] = [],
  diacriticOverrides: DiacriticOverride[] = []
) {
```

- [ ] **Step 2: Apply `hidden` and `scale`/`offsetY` inside the glyph loop**

Inside the `for (let glyphIndex = 0; ...)` loop, right after `const advance = g.ax ?? 0;` and the existing `if (!glyphObj) { penX += advance; continue; }` block, add:

```ts
const diacriticOverride = diacriticOverrides.find((o) => o.glyphIndex === glyphIndex);
if (diacriticOverride?.hidden) {
  penX += advance;
  continue;
}
```

Then, immediately after the existing `ctx.translate(gx, gy);` line (right before the `if (overrideGlyph && ...)` branch), add:

```ts
if (diacriticOverride) {
  ctx.translate(0, diacriticOverride.offsetY ?? 0);
  const diacScale = diacriticOverride.scale ?? 1;
  ctx.scale(diacScale, diacScale);
}
```

This mirrors the existing PUA "override glyph" branch a few lines below it (which already does `ctx.translate(...); ctx.scale(...)` before tracing a glyph's path) — same structural idea, applied to any glyph with a diacritic override instead of only PUA preset symbols. The scale/offset pivot around `(gx, gy)` — the glyph's own pen-origin — so a diacritic grows/shrinks/shifts without drifting from the letter it's attached to.

- [ ] **Step 3: Thread the prop through the component and both draw calls**

In the `Props` type, add:

```ts
diacriticOverrides?: DiacriticOverride[];
```

In the component's destructured props (after `glyphRigValues = [],`), add:

```ts
diacriticOverrides = [],
```

In both `drawWarpedGlyphRun(...)` call sites inside the `sceneFunc` (the fill pass and the stroke pass), add `diacriticOverrides` as the new last argument, e.g.:

```ts
drawWarpedGlyphRun(
  ctx as unknown as CanvasRenderingContext2D,
  shapeData.glyphs,
  font,
  fontSize,
  shapeData.unitsPerEm,
  glyphBounds,
  warpX,
  warpY,
  false,
  stroke,
  strokeWidth,
  fauxBoldWidth,
  overrideGlyph,
  glyphEdits,
  fontFamily,
  glyphRigs,
  glyphRigValues,
  diacriticOverrides
);
```

(and the same addition to the stroke-pass call just below it, which passes `true`/`0` for `drawStroke`/`fauxBoldWidth` instead).

- [ ] **Step 4: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ShapedText.tsx
git commit -m "Apply per-instance diacritic overrides in drawWarpedGlyphRun"
```

---

### Task 4: Hover handles — interaction, wiring, and history

**Files:**
- Create: `src/components/DiacriticHoverHandles.tsx`
- Modify: `src/components/ShapedText.tsx`
- Modify: `src/components/CanvasStage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `findDiacriticGlyphIndices` (`lib/diacritics.ts`, Task 2); `DiacriticOverride` (Task 1); `GlyphHitBox` (exported from `ShapedText.tsx` in this task).
- Produces: `DiacriticHoverHandles` component; `ShapedText`'s `isSelected`/`onDragDiacriticOverride`/`onToggleDiacriticHidden` props; `CanvasStage`'s `onDragDiacriticOverride`/`onToggleDiacriticHidden` props; `App.tsx`'s `dragDiacriticOverride`/`toggleDiacriticHidden` handlers.

- [ ] **Step 1: Export `GlyphHitBox` from `ShapedText.tsx`**

In `src/components/ShapedText.tsx`, change:

```ts
type GlyphHitBox = {
```

to:

```ts
export type GlyphHitBox = {
```

(`ShapeWarpText.tsx` already exports its own copy of this same-shaped type for the same reason — this isn't a new pattern.)

- [ ] **Step 2: Write `DiacriticHoverHandles.tsx`**

Create `src/components/DiacriticHoverHandles.tsx`:

```tsx
import React, { useMemo, useState } from "react";
import { Group, Circle, Rect } from "react-konva";
import type { HarfBuzzGlyph } from "../lib/harfbuzz";
import { findDiacriticGlyphIndices } from "../lib/diacritics";
import type { DiacriticOverride } from "../types";
import type { GlyphHitBox } from "./ShapedText";

export type DiacriticHoverHandlesProps = {
  isSelected: boolean;
  glyphs: HarfBuzzGlyph[];
  shapableText: string;
  glyphHitBoxes: GlyphHitBox[];
  diacriticOverrides: DiacriticOverride[];
  /** Group-local x/y to add to a hit box's own x/y — same `bx + localDrawX` / `by + localDrawY` offset the rest of ShapedText.tsx already uses to place its own overlays. */
  offsetX: number;
  offsetY: number;
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
 * grabbing, while the actual render-time scale (ShapedText.tsx's
 * drawWarpedGlyphRun) pivots around the glyph's pen-origin (gx, gy) —
 * a deliberate, minor approximation: the handle sits where it's easy to
 * grab, not exactly where the glyph visually pivots from.
 */
export const DiacriticHoverHandles: React.FC<DiacriticHoverHandlesProps> = ({
  isSelected,
  glyphs,
  shapableText,
  glyphHitBoxes,
  diacriticOverrides,
  offsetX,
  offsetY,
  fontSize,
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const diacriticIndices = useMemo(
    () => findDiacriticGlyphIndices(glyphs, shapableText),
    [glyphs, shapableText]
  );

  if (!isSelected) return null;

  const diacriticBoxes = glyphHitBoxes.filter((b) => diacriticIndices.has(b.glyphIndex));
  const handleSpacing = fontSize * 0.25;

  return (
    <Group>
      {diacriticBoxes.map((box) => {
        const override = diacriticOverrides.find((o) => o.glyphIndex === box.glyphIndex);
        const cx = offsetX + box.x + box.width / 2;
        const cy = offsetY + box.y + box.height / 2;
        const displayY = cy + (override?.offsetY ?? 0);
        const isHovered = hoveredIndex === box.glyphIndex;

        return (
          <Group key={box.glyphIndex}>
            <Rect
              x={offsetX + box.x - 4}
              y={offsetY + box.y - 4}
              width={box.width + 8}
              height={box.height + 8}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(box.glyphIndex)}
              onMouseLeave={() =>
                setHoveredIndex((v) => (v === box.glyphIndex ? null : v))
              }
            />

            {isHovered && (
              <>
                <Circle
                  x={cx}
                  y={displayY}
                  radius={5}
                  fill={MOVE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  dragBoundFunc={(pos) => ({ x: cx, y: pos.y })}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const newOffsetY = e.target.y() - cy;
                    onDragDiacriticOverride?.(box.glyphIndex, { offsetY: newOffsetY });
                  }}
                />

                <Circle
                  x={cx + handleSpacing}
                  y={displayY}
                  radius={4}
                  fill={RESIZE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const pos = e.target.position();
                    const dist = Math.hypot(pos.x - cx, pos.y - displayY);
                    const nextScale = Math.max(
                      0.3,
                      Math.min(3, dist / Math.max(handleSpacing, 1))
                    );
                    onDragDiacriticOverride?.(box.glyphIndex, { scale: nextScale });
                  }}
                />

                <Circle
                  x={cx - handleSpacing}
                  y={displayY}
                  radius={4}
                  fill={override?.hidden ? HIDE_BUTTON_COLOR_ACTIVE : HIDE_BUTTON_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    onToggleDiacriticHidden?.(box.glyphIndex);
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true;
                    onToggleDiacriticHidden?.(box.glyphIndex);
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

- [ ] **Step 3: Wire `DiacriticHoverHandles` into `ShapedText.tsx`**

Add the import:

```ts
import { DiacriticHoverHandles } from "./DiacriticHoverHandles";
```

Add to `Props`:

```ts
isSelected?: boolean;
onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void;
onToggleDiacriticHidden?: (glyphIndex: number) => void;
```

Add to the destructured props (near `diacriticOverrides = [],` from Task 3):

```ts
isSelected = false,
onDragDiacriticOverride,
onToggleDiacriticHidden,
```

Inside the component's returned JSX, add `<DiacriticHoverHandles>` as a sibling right after the closing `/>` of the main `<Shape ... sceneFunc={...} />` block (the one Task 3 modified), before the `{kashidaEditMode && ...}` block:

```tsx
<DiacriticHoverHandles
  isSelected={isSelected}
  glyphs={shapeData.glyphs}
  shapableText={shapeData.shapableText}
  glyphHitBoxes={glyphHitBoxes}
  diacriticOverrides={diacriticOverrides}
  offsetX={bx + localDrawX}
  offsetY={by + localDrawY}
  fontSize={fontSize}
  onDragDiacriticOverride={onDragDiacriticOverride}
  onToggleDiacriticHidden={onToggleDiacriticHidden}
/>
```

- [ ] **Step 4: Add `dragDiacriticOverride`/`toggleDiacriticHidden` to `App.tsx`**

Near the other `useDebouncedHistoryPush` declarations (`scheduleMoveHistoryPush`, `scheduleKashidaHistoryPush`, etc.):

```ts
const scheduleDiacriticHistoryPush = useDebouncedHistoryPush(pushHistory);
```

Add the import for `DiacriticOverride` to `App.tsx`'s existing `import type { ... } from "./types"` line.

Add two new handlers, near `updateStretchHandle`:

```ts
const dragDiacriticOverride = useCallback(
  (blockId: number, glyphIndex: number, patch: Partial<DiacriticOverride>) => {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== blockId || b.type !== "text") return b;
        const existing = (b.diacriticOverrides ?? []).find((o) => o.glyphIndex === glyphIndex);
        const nextOverrides = existing
          ? (b.diacriticOverrides ?? []).map((o) =>
              o.glyphIndex === glyphIndex ? { ...o, ...patch } : o
            )
          : [...(b.diacriticOverrides ?? []), { glyphIndex, ...patch }];
        return { ...b, diacriticOverrides: nextOverrides };
      })
    );
    scheduleDiacriticHistoryPush();
  },
  [scheduleDiacriticHistoryPush]
);

const toggleDiacriticHidden = useCallback(
  (blockId: number, glyphIndex: number) => {
    pushHistory();
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== blockId || b.type !== "text") return b;
        const existing = (b.diacriticOverrides ?? []).find((o) => o.glyphIndex === glyphIndex);
        const nextHidden = !(existing?.hidden ?? false);
        const nextOverrides = existing
          ? (b.diacriticOverrides ?? []).map((o) =>
              o.glyphIndex === glyphIndex ? { ...o, hidden: nextHidden } : o
            )
          : [...(b.diacriticOverrides ?? []), { glyphIndex, hidden: nextHidden }];
        return { ...b, diacriticOverrides: nextOverrides };
      })
    );
  },
  [pushHistory]
);
```

- [ ] **Step 5: Thread the new props through `CanvasStage.tsx`**

Add to `CanvasStageProps`:

```ts
onDragDiacriticOverride: (
  blockId: number,
  glyphIndex: number,
  patch: Partial<DiacriticOverride>
) => void;
onToggleDiacriticHidden: (blockId: number, glyphIndex: number) => void;
```

Add `DiacriticOverride` to `CanvasStage.tsx`'s existing `import type { Block, GlyphStretchHandle, GlyphRig } from "../types";` line.

Destructure both new props in the component signature, and add to the `<ShapedText ...>` JSX call (the final branch in the block-rendering switch):

```tsx
isSelected={block.id === selectedId}
diacriticOverrides={block.diacriticOverrides ?? []}
onDragDiacriticOverride={(glyphIndex, patch) =>
  onDragDiacriticOverride(block.id, glyphIndex, patch)
}
onToggleDiacriticHidden={(glyphIndex) => onToggleDiacriticHidden(block.id, glyphIndex)}
```

- [ ] **Step 6: Pass the handlers from `App.tsx`'s `<CanvasStage>`**

Near `onKashidaTextChange={updateKashidaText}`:

```tsx
onDragDiacriticOverride={dragDiacriticOverride}
onToggleDiacriticHidden={toggleDiacriticHidden}
```

- [ ] **Step 7: Manual verification**

Run: `npm run dev`
In the browser: select a text block, type a letter followed by a diacritic (e.g. via the existing "إِعْرَاب" keyboard in the sidebar). Hover the diacritic on canvas — confirm three small dots appear (blue move, gold resize, red hide) only for that one mark. Drag the blue dot vertically — confirm the mark moves and stays hovered/adjustable. Drag the gold dot — confirm the mark resizes. Click the red dot — confirm the mark disappears (and the letter it was attached to does not reflow); click again — confirm it reappears at its last position/size. Add a second diacritic elsewhere in the text and confirm adjusting one never affects the other. Undo/redo through a few of these changes and confirm they undo cleanly.

- [ ] **Step 8: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/DiacriticHoverHandles.tsx src/components/ShapedText.tsx src/components/CanvasStage.tsx src/App.tsx
git commit -m "Add on-canvas hover handles for per-instance diacritic move/resize/hide"
```

---

### Task 5: "Reset diacritic overrides" sidebar button

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `onUpdateSelectedBlock` (existing prop, already generic).

- [ ] **Step 1: Add the button next to "Clear diacritics"**

In `src/components/Sidebar.tsx`, immediately after the existing "Clear diacritics" button (which calls `onClearDiacritics`), add:

```tsx
<button
  type="button"
  onClick={() => onUpdateSelectedBlock({ diacriticOverrides: [] })}
  className="sidebarSmallAction"
  style={{ background: "var(--bg-input)" }}
>
  Reset diacritic overrides
</button>
```

No new prop is needed — `onUpdateSelectedBlock` is already passed into `Sidebar` and already pushes history and casts `as Block` via `App.tsx`'s existing generic `updateSelectedBlock`, so this is a one-line addition reusing infrastructure that already exists.

- [ ] **Step 2: Manual verification**

Run: `npm run dev`
Adjust a diacritic's position/size/visibility via the hover handles, then click "Reset diacritic overrides" — confirm every adjusted diacritic snaps back to its font-default rendering, and the text itself is untouched (unlike "Clear diacritics", which removes the characters). Undo once — confirm the resets are undone and the overrides reappear.

- [ ] **Step 3: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "Add non-destructive 'Reset diacritic overrides' sidebar button"
```

---

### Task 6: Final verification and documentation

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing new — this task only verifies and documents what Tasks 1–5 built.

- [ ] **Step 1: Full manual smoke test**

Run: `npm run dev`
Walk through, in order: type Arabic text with several different diacritics via the "إِعْرَاب" keyboard → hover and adjust each one's position and size → hide one and confirm the rest are unaffected → unhide it → change the block's font family and confirm overrides still land on the right marks (or degrade reasonably if the new font shapes the text differently) → duplicate the block and confirm the copy keeps its overrides → undo/redo through several of the above steps → click "Reset diacritic overrides" and confirm a clean reset → export to PNG and confirm hover handles never appear in the output (there is no live mouse hover during export, so this should already hold — confirm it does) → save and reload the layout (localStorage save/load) and confirm overrides survive the round-trip.

- [ ] **Step 2: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 3: Document the subsystem in `CLAUDE.md`**

Add a new section to `CLAUDE.md`, after the "Arabic text shaping pipeline" section (before "Stroke-schema-driven glyph editor"), following the existing documentation style:

```markdown
### Per-instance diacritic control (`src/lib/diacritics.ts`, `DiacriticHoverHandles.tsx`)

Plain text blocks support per-instance adjustment of individual tashkeel
marks (harakat, tanween, sukun, shadda, etc.) — hovering any diacritic on
a selected block's canvas shows three small handles: drag one vertically
to reposition it, drag another to resize it, and click a third to hide
just that one instance. This is separate from, and non-destructive
relative to, the existing "Clear diacritics" button (`clearDiacritics` in
`App.tsx`), which permanently removes every diacritic character from the
block's text — overrides only change how a diacritic *renders*, never the
underlying text, and a "Reset diacritic overrides" button clears them
without touching the text either.

`lib/diacritics.ts`'s `findDiacriticGlyphIndices(glyphs, shapableText)`
identifies which shaped glyphs are diacritics by looking up each glyph's
HarfBuzz cluster (`glyph.cl`) as a character offset into `shapableText`
and testing it against `ARABIC_DIACRITIC_RE` (now exported from
`lib/harfbuzz.ts`, previously private to `stripUnsupportedDiacritics`) —
the same cluster-to-source-character technique
`strokeSchema/glyphLookup.ts` already uses for an unrelated purpose.

Overrides (`DiacriticOverride` in `types.ts`: `scale`/`offsetY`/`hidden`,
default no-op) are keyed by glyph index — the same scheme
`GlyphStretchHandle` already uses for the Stretch tool, including that
scheme's known fragility (a text edit before a diacritic in the string can
shift which glyph index its override lands on after re-shaping). They're
applied inside `ShapedText.tsx`'s shared `drawWarpedGlyphRun` as an extra
`ctx.translate`/`ctx.scale` pivoted on the glyph's own pen-origin
`(gx, gy)`, structurally identical to how that same function already
handles the Private-Use-Area "override glyph" preset symbols. A `hidden`
override skips the glyph's draw call but not its advance width, so hiding
a mark never reflows surrounding letters.

`DiacriticHoverHandles.tsx` is a separate component (not folded into
`ShapedText.tsx` itself) reusing `ShapedText`'s existing per-glyph
`glyphHitBoxes` (already computed for the Stretch tool's hit-testing) —
only the currently-hovered diacritic ever shows handles, which is what
keeps text with many marks from becoming visual clutter. It's active only
when the block is selected, matching every other interactive on-canvas
overlay in this app. Live handle drags follow the same debounced-history
pattern (`useDebouncedHistoryPush`) the Kashida tool already established;
the hide-button click is a discrete, immediate `pushHistory()` mutation.

This feature is `ShapedText.tsx`-only for v1 — Shape Fill (tiled rows),
Shape Warp (bounding-envelope remap), and any curve-following text put a
diacritic's on-screen position through additional transforms beyond
`ShapedText.tsx`'s simple pen-advance layout, and correctly locating a
hover-handle in each of those coordinate spaces is real, separate design
work, deliberately left for a future spec rather than half-supported here.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the per-instance diacritic control subsystem in CLAUDE.md"
```
