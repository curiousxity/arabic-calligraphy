# Per-Glyph Move & Scale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user rigidly move a single shaped glyph and stretch or shrink it as a whole in x or y, via on-canvas hover handles on plain text blocks.

**Architecture:** A new `GlyphTransform` record keyed by glyph index, applied as a `ctx.translate`/`ctx.scale` pair in the slot `ShapedText.tsx` already uses for diacritic overrides — which pivots on the glyph's pen origin for free, because the context is already translated there. The same transform is applied to the glyph's hit box so hover targets track the drawn glyph. Interaction is a new hover-only Konva overlay modeled on `DiacriticHoverHandles.tsx`, armed by a checkbox in the Morph Glyph Editor.

**Tech Stack:** React 19, TypeScript, Vite, Konva/react-konva, opentype.js, harfbuzzjs, Vitest.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-12-glyph-transform-design.md`. Read it before starting.
- **No reflow, ever.** `penX += advance` is never modified by this feature. A moved or scaled glyph must not shift its neighbours.
- The scale pivot is the glyph's **pen origin**, achieved by placing the transform inside the existing `ctx.translate(gx, gy)` — never by computing a pivot manually.
- Scale values are clamped to **0.2–4** at both ends. Offsets are unbounded.
- v1 is **plain text blocks only**. `ShapeFillText.tsx`, `ShapeWarpText.tsx`, `TextOnPathText.tsx`, and `ImageBlockView.tsx` are not touched by any task in this plan.
- The renderer and the overlay must agree on a transformed glyph's box by calling the *same* shared function (`transformedBox`), never by duplicating the arithmetic.
- Konva's `dragBoundFunc` receives and returns **absolute (stage)** coordinates while everything else in these overlays is local. Rails are captured in absolute space at `onDragStart`.
- Verification loop after every task, in this order: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build`.
- Tests live beside the code they cover (`src/lib/*.test.ts`), never in a separate `__tests__` tree.
- In `App.tsx`, a handler must be **physically defined above** any `useCallback`/`useEffect` that references it, or TS reports "used before declaration".

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/glyphTransform.ts` (new) | Pure math: defaults, drag→scale conversion, transformed box. No React, no Konva. |
| `src/lib/glyphTransform.test.ts` (new) | Unit tests for the above. |
| `src/types.ts` (modify) | `GlyphTransform` type; `glyphTransforms` + `glyphTransformMode` on `BlockCommon`. |
| `src/components/GlyphTransformHoverHandles.tsx` (new) | The three-dot hover overlay. All interaction lives here. |
| `src/components/ShapedText.tsx` (modify) | Applies the transform when drawing and when computing hit boxes; mounts the overlay. |
| `src/components/CanvasStage.tsx` (modify) | Threads block state and callbacks to `ShapedText`. |
| `src/App.tsx` (modify) | Owns the state mutations and history pushes. |
| `src/components/MorphGlyphEditor.tsx` (modify) | The arming checkbox and the reset button. |

---

### Task 1: The pure transform math

**Files:**
- Create: `src/lib/glyphTransform.ts`
- Create: `src/lib/glyphTransform.test.ts`

**Interfaces:**
- Consumes: `GlyphTransform` from `src/types.ts` — **this task creates that type too** (Step 1), because the lib module cannot compile without it.
- Produces:
  - `export type ResolvedGlyphTransform = { offsetX: number; offsetY: number; scaleX: number; scaleY: number }`
  - `export const GLYPH_SCALE_MIN = 0.2`, `export const GLYPH_SCALE_MAX = 4`
  - `export function resolveGlyphTransform(t: GlyphTransform | undefined): ResolvedGlyphTransform`
  - `export function scaleFromDrag(restDistance: number, dragDistance: number): number`
  - `export function transformedBox(box: { x: number; y: number; width: number; height: number }, gx: number, gy: number, t: GlyphTransform | undefined): { x: number; y: number; width: number; height: number }`

- [ ] **Step 1: Add the type to `src/types.ts`**

Immediately after the `DiacriticOverride` type (which ends at line 105, just before `type BlockCommon = {`), add:

```ts
/**
 * A rigid whole-glyph transform — move and independent x/y scale — keyed
 * by glyphIndex. Distinct from GlyphEdit (which displaces individual
 * outline points) and DiacriticOverride (uniform scale + vertical offset,
 * marks only): this moves and scales the finished glyph as a unit.
 *
 * Shares glyphIndex keying with both, including its known fragility: a
 * text edit before this glyph shifts which index the transform lands on
 * after re-shaping. Unlike DiacriticOverride there is no identity signal
 * to re-check against at render time (every glyph is a legitimate
 * target), so a stale transform simply applies to whatever glyph now
 * holds that index — the same behaviour GlyphEdit already has.
 */
export type GlyphTransform = {
  glyphIndex: number;
  /** Horizontal shift in local (unscaled) units. Default 0. */
  offsetX?: number;
  /** Vertical shift in local (unscaled) units. Default 0. */
  offsetY?: number;
  /** Multiplier on the glyph's natural width. Default 1. */
  scaleX?: number;
  /** Multiplier on the glyph's natural height. Default 1. */
  scaleY?: number;
};
```

Then, in `BlockCommon`, immediately after the `diacriticOverrides?: DiacriticOverride[];` field (line 147), add:

```ts
  /**
   * Per-glyph rigid move/scale. Plain text blocks only for v1 — the other
   * block types inherit the field unused, the same intentional
   * simplification BlockCommon already makes for glyphEdits.
   */
  glyphTransforms?: GlyphTransform[];
  /** Arms the on-canvas move/scale handles. While on, ShapedText does not mount the stroke-stretch dots. */
  glyphTransformMode?: boolean;
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/glyphTransform.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  GLYPH_SCALE_MAX,
  GLYPH_SCALE_MIN,
  resolveGlyphTransform,
  scaleFromDrag,
  transformedBox,
} from "./glyphTransform";

describe("resolveGlyphTransform", () => {
  it("resolves undefined to the identity", () => {
    expect(resolveGlyphTransform(undefined)).toEqual({
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("resolves missing fields to their identity values", () => {
    expect(resolveGlyphTransform({ glyphIndex: 3, offsetY: -12 })).toEqual({
      offsetX: 0,
      offsetY: -12,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("passes through fields that are set", () => {
    expect(
      resolveGlyphTransform({ glyphIndex: 0, offsetX: 5, offsetY: 6, scaleX: 2, scaleY: 0.5 })
    ).toEqual({ offsetX: 5, offsetY: 6, scaleX: 2, scaleY: 0.5 });
  });

  it("clamps out-of-range stored scales, so a hand-edited project file cannot explode a glyph", () => {
    const r = resolveGlyphTransform({ glyphIndex: 0, scaleX: 99, scaleY: -3 });
    expect(r.scaleX).toBe(GLYPH_SCALE_MAX);
    expect(r.scaleY).toBe(GLYPH_SCALE_MIN);
  });
});

describe("scaleFromDrag", () => {
  it("returns the ratio of dragged distance to rest distance", () => {
    expect(scaleFromDrag(40, 60)).toBeCloseTo(1.5, 6);
    expect(scaleFromDrag(40, 20)).toBeCloseTo(0.5, 6);
  });

  it("returns exactly 1 when the pointer is at the rest position", () => {
    expect(scaleFromDrag(40, 40)).toBe(1);
  });

  it("clamps at both ends", () => {
    expect(scaleFromDrag(10, 1000)).toBe(GLYPH_SCALE_MAX);
    expect(scaleFromDrag(10, 0)).toBe(GLYPH_SCALE_MIN);
  });

  it("stays finite at a degenerate zero rest distance", () => {
    const s = scaleFromDrag(0, 25);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeLessThanOrEqual(GLYPH_SCALE_MAX);
  });

  it("treats a drag past the pivot as a shrink, not a negative scale", () => {
    expect(scaleFromDrag(40, -30)).toBe(GLYPH_SCALE_MIN);
  });
});

describe("transformedBox", () => {
  const box = { x: 100, y: -50, width: 40, height: 60 };

  it("returns the box unchanged for an undefined transform", () => {
    expect(transformedBox(box, 100, 0, undefined)).toEqual(box);
  });

  it("translates by the offset", () => {
    expect(transformedBox(box, 100, 0, { glyphIndex: 0, offsetX: 7, offsetY: -3 })).toEqual({
      x: 107,
      y: -53,
      width: 40,
      height: 60,
    });
  });

  it("scales about the pen origin, not the box origin", () => {
    // Pen origin at (100, 0); the box starts exactly at that x, so its
    // left edge is fixed and only its width grows.
    expect(transformedBox(box, 100, 0, { glyphIndex: 0, scaleX: 2 })).toEqual({
      x: 100,
      y: -50,
      width: 80,
      height: 60,
    });
  });

  it("moves a box that is offset from the pen origin away from it when scaling", () => {
    // Box left edge is 20 units right of the pen origin at x=80.
    expect(transformedBox(box, 80, 0, { glyphIndex: 0, scaleX: 2 })).toEqual({
      x: 120,
      y: -50,
      width: 80,
      height: 60,
    });
  });

  it("scales vertically about the baseline so the glyph keeps sitting on it", () => {
    // Pen origin y = 0 is the baseline; the box sits 50 above it.
    expect(transformedBox(box, 100, 0, { glyphIndex: 0, scaleY: 2 })).toEqual({
      x: 100,
      y: -100,
      width: 40,
      height: 120,
    });
  });

  it("applies offset after scale, matching the ctx.translate-then-scale draw order", () => {
    const r = transformedBox(box, 100, 0, {
      glyphIndex: 0,
      offsetX: 10,
      scaleX: 2,
    });
    expect(r).toEqual({ x: 110, y: -50, width: 80, height: 60 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/lib/glyphTransform.test.ts
```

Expected: FAIL — cannot resolve `./glyphTransform`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/glyphTransform.ts`:

```ts
import type { GlyphTransform } from "../types";

export type ResolvedGlyphTransform = {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
};

/**
 * A glyph may neither collapse to nothing nor grow so large it swamps the
 * artboard. These bounds are enforced both when reading a drag and when
 * resolving a stored value, so a hand-edited or corrupted project file
 * cannot produce a glyph that is impossible to grab and fix.
 */
export const GLYPH_SCALE_MIN = 0.2;
export const GLYPH_SCALE_MAX = 4;

const clampScale = (v: number) =>
  Number.isFinite(v) ? Math.max(GLYPH_SCALE_MIN, Math.min(GLYPH_SCALE_MAX, v)) : 1;

export function resolveGlyphTransform(
  t: GlyphTransform | undefined
): ResolvedGlyphTransform {
  return {
    offsetX: t?.offsetX ?? 0,
    offsetY: t?.offsetY ?? 0,
    scaleX: clampScale(t?.scaleX ?? 1),
    scaleY: clampScale(t?.scaleY ?? 1),
  };
}

/**
 * Converts a scale-handle drag into a scale multiplier: how far the
 * pointer now sits from the pen-origin pivot, over how far the handle sits
 * from it at rest (scale 1). Both distances are signed along the handle's
 * own rail, so dragging past the pivot reads as a shrink toward the
 * minimum rather than flipping the glyph inside out.
 *
 * `restDistance` of zero would divide by zero — it happens for a
 * zero-width glyph such as a bare combining mark whose box collapses — so
 * it floors to a small epsilon, which drives the result straight to the
 * clamp instead of producing Infinity/NaN.
 */
export function scaleFromDrag(restDistance: number, dragDistance: number): number {
  const rest = Math.abs(restDistance) < 1e-6 ? 1e-6 : restDistance;
  return clampScale(dragDistance / rest);
}

/**
 * Where a glyph's bounding box lands once its transform is applied.
 *
 * Mirrors the draw order in ShapedText's `drawWarpedGlyphRun` exactly —
 * `ctx.translate(gx, gy)`, then `ctx.translate(offset)`, then
 * `ctx.scale(...)` — which means the scale pivots on the pen origin
 * `(gx, gy)` and the offset is applied in unscaled units on top. The
 * renderer and the hover overlay must agree on this box, so both call this
 * function rather than repeating the arithmetic.
 */
export function transformedBox(
  box: { x: number; y: number; width: number; height: number },
  gx: number,
  gy: number,
  t: GlyphTransform | undefined
): { x: number; y: number; width: number; height: number } {
  const { offsetX, offsetY, scaleX, scaleY } = resolveGlyphTransform(t);
  return {
    x: gx + (box.x - gx) * scaleX + offsetX,
    y: gy + (box.y - gy) * scaleY + offsetY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/lib/glyphTransform.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 6: Full verification and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add src/types.ts src/lib/glyphTransform.ts src/lib/glyphTransform.test.ts
git commit -m "Add GlyphTransform type and pure transform math with tests"
```

---

### Task 2: Render the transform and transform the hit boxes

Wire `glyphTransforms` through `App.tsx` → `CanvasStage.tsx` → `ShapedText.tsx` and apply it in both glyph loops. After this task a transform set by hand in the browser console renders correctly — there is still no UI to create one.

**Files:**
- Modify: `src/components/ShapedText.tsx` (props, both glyph loops, both `drawWarpedGlyphRun` call sites)
- Modify: `src/components/CanvasStage.tsx:729-778` (the `<ShapedText>` mount)

**Interfaces:**
- Consumes: `resolveGlyphTransform`, `transformedBox` (Task 1); `GlyphTransform` from `src/types.ts`.
- Produces: `ShapedTextProps.glyphTransforms?: GlyphTransform[]`, consumed by Task 4's overlay mount.

- [ ] **Step 1: Add the prop to `ShapedText`**

In `src/components/ShapedText.tsx`, add to the props type immediately after `diacriticOverrides?: DiacriticOverride[];` (line 71):

```ts
  glyphTransforms?: GlyphTransform[];
```

Add `GlyphTransform` to the existing `../types` import rather than writing a second import statement. Destructure it in the component's parameter list beside `diacriticOverrides = []`, with the default `glyphTransforms = []`.

- [ ] **Step 2: Apply the transform in the draw loop**

Add a parameter to `drawWarpedGlyphRun` (signature at lines 178–197), after `diacriticOverrides: DiacriticOverride[] = []`:

```ts
  glyphTransforms: GlyphTransform[] = []
```

Inside its glyph loop, immediately after the existing diacritic-override `ctx.scale` block (lines 228–232), add:

```ts
    const transform = glyphTransforms.find((t) => t.glyphIndex === glyphIndex);
    if (transform) {
      // The context is already translated to this glyph's pen origin, so
      // this scales about the pen origin — on the baseline, at the start
      // of the advance — with no pivot arithmetic. Deliberately does NOT
      // touch `penX += advance` below: a moved or widened glyph must never
      // shift its neighbours.
      const { offsetX, offsetY, scaleX, scaleY } = resolveGlyphTransform(transform);
      ctx.translate(offsetX, offsetY);
      ctx.scale(scaleX, scaleY);
    }
```

Add the import at the top of the file:

```ts
import { resolveGlyphTransform, transformedBox } from "../lib/glyphTransform";
```

- [ ] **Step 3: Pass the prop at both call sites**

`drawWarpedGlyphRun` is called twice — the fill pass at line 801 and the stroke pass at line 827. Both currently end with `activeDiacriticOverrides` as the final argument. Add `glyphTransforms` after it in **both** calls. Missing the stroke pass produces a glyph whose outline stroke stays put while its fill moves, which looks like a rendering bug and is easy to miss on a block with `strokeWidth: 0`.

- [ ] **Step 4: Apply the transform to the hit boxes**

In the `glyphMetrics` memo (lines 428–514), inside `if (glyphObj) {`, the box is computed at line 466 as:

```ts
        const box = glyphObj.getPath(gx, gy, fontSize).getBoundingBox();
```

Leave that line alone — the block-level `bounds` accumulated from `box.x1`/`box.y1`/etc. must stay based on the *untransformed* run, or moving one glyph would resize the whole block and shift every other glyph on canvas. Instead, change only the `hitBoxes.push({...})` call (lines 481–491) to push the transformed rect:

```ts
        if (isFinite(box.x1) && isFinite(box.x2) && isFinite(box.y1) && isFinite(box.y2)) {
          // Hit boxes track where each glyph is actually drawn, so a moved
          // or scaled glyph keeps its hover target under itself. The block
          // bounds above deliberately do not — those must stay stable, or
          // transforming one glyph would re-layout the entire block.
          const raw = {
            x: box.x1,
            y: box.y1,
            width: Math.max(box.x2 - box.x1, 1),
            height: Math.max(box.y2 - box.y1, 1),
          };
          const t = transformedBox(
            raw,
            gx,
            gy,
            glyphTransforms.find((gt) => gt.glyphIndex === i)
          );
          hitBoxes.push({
            glyphIndex: i,
            x: t.x,
            y: t.y,
            width: Math.max(t.width, 1),
            height: Math.max(t.height, 1),
            glyphId: g.g,
            gx,
            gy,
          });
        }
```

Add `glyphTransforms` to that memo's dependency array (currently `[shapeData, text, fontSize]`).

- [ ] **Step 5: Thread the prop in `CanvasStage`**

In `src/components/CanvasStage.tsx`, in the `<ShapedText>` mount, add immediately after the `diacriticOverrides={block.diacriticOverrides ?? []}` line (line 770):

```tsx
                    glyphTransforms={block.glyphTransforms ?? []}
```

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
```

Expected: all clean.

- [ ] **Step 7: Confirm rendering in the browser**

Run `npm run dev`. In the browser console, set a transform on the default text block and confirm the glyph moves and scales while its neighbours stay put:

```js
// Konva stage is reachable as window.Konva.stages[0]; the simplest check
// is to edit the block through the app's own autosave instead:
JSON.parse(localStorage.getItem("harfcanvas:autosave") ?? "null")
```

If that key does not exist or has a different name, skip the console route: instead temporarily hard-code `glyphTransforms={[{ glyphIndex: 0, offsetY: -30, scaleX: 1.6 }]}` in the `CanvasStage` mount from Step 5, confirm on screen that glyph 0 moves up and widens **while every other glyph stays exactly where it was**, then revert the hard-coded value before committing.

- [ ] **Step 8: Commit**

```bash
git add src/components/ShapedText.tsx src/components/CanvasStage.tsx
git commit -m "Render per-glyph transforms and track them in glyph hit boxes"
```

---

### Task 3: State, history, and the Morph panel controls

Adds the mutations and the two sidebar controls. After this task the checkbox toggles and the reset button works; the handles themselves arrive in Task 4.

**Files:**
- Modify: `src/App.tsx` (new handlers near line 616; `<CanvasStage>` props near line 2189; `<MorphGlyphEditor>` props near line 2222)
- Modify: `src/components/CanvasStage.tsx` (props type near line 91; destructure near line 135; `<ShapedText>` mount)
- Modify: `src/components/MorphGlyphEditor.tsx` (props type near line 234; destructure near line 265; UI near line 723)

**Interfaces:**
- Consumes: `GlyphTransform` (Task 1).
- Produces, all consumed by Task 4:
  - `ShapedTextProps.glyphTransformMode?: boolean`
  - `ShapedTextProps.onUpdateGlyphTransform?: (glyphIndex: number, patch: Partial<GlyphTransform>) => void`
  - `CanvasStageProps.onUpdateGlyphTransform: (blockId: number, glyphIndex: number, patch: Partial<GlyphTransform>) => void`
  - `MorphGlyphEditorProps.onToggleGlyphTransformMode?: (blockId: number) => void`
  - `MorphGlyphEditorProps.onResetGlyphTransforms?: (blockId: number) => void`

- [ ] **Step 1: Add the App handlers**

In `src/App.tsx`, add a debounced history pusher beside the existing ones (line 428):

```ts
  const scheduleGlyphTransformHistoryPush = useDebouncedHistoryPush(pushHistory);
```

Then, immediately after the `toggleDiacriticHidden` handler ends (it closes around line 620), add these three. They must sit here, above the `<CanvasStage>` and `<MorphGlyphEditor>` mounts that reference them:

```ts
  /**
   * Plain text blocks only for v1 — Shape Fill and Shape Warp carry the
   * field via BlockCommon but neither renderer reads it, so accepting an
   * edit there would silently discard it.
   */
  const supportsGlyphTransforms = (b: Block) => b.type === "text";

  const updateGlyphTransform = useCallback(
    (blockId: number, glyphIndex: number, patch: Partial<GlyphTransform>) => {
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || !supportsGlyphTransforms(b)) return b;
          const existing = (b.glyphTransforms ?? []).find((t) => t.glyphIndex === glyphIndex);
          const nextTransforms = existing
            ? (b.glyphTransforms ?? []).map((t) =>
                t.glyphIndex === glyphIndex ? { ...t, ...patch } : t
              )
            : [...(b.glyphTransforms ?? []), { glyphIndex, ...patch }];
          return { ...b, glyphTransforms: nextTransforms };
        })
      );
      // Debounced: one continuous drag collapses to a single undo entry,
      // the same treatment diacritic drags and the Kashida dial get.
      scheduleGlyphTransformHistoryPush();
    },
    [scheduleGlyphTransformHistoryPush]
  );

  const toggleGlyphTransformMode = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsGlyphTransforms(b)
            ? { ...b, glyphTransformMode: !b.glyphTransformMode }
            : b
        )
      );
    },
    [pushHistory]
  );

  const resetGlyphTransforms = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, glyphTransforms: [] } : b))
      );
    },
    [pushHistory]
  );
```

Add `GlyphTransform` to the existing `./types` import in `App.tsx`.

- [ ] **Step 2: Pass them to the two mounts**

In the `<CanvasStage>` mount, immediately after `onToggleDiacriticHidden={toggleDiacriticHidden}` (line 2189):

```tsx
          onUpdateGlyphTransform={updateGlyphTransform}
```

In the `<MorphGlyphEditor>` mount, immediately after `onSetBlockKashidaAmount={setBlockKashidaAmount}` (line 2222):

```tsx
        onToggleGlyphTransformMode={toggleGlyphTransformMode}
        onResetGlyphTransforms={resetGlyphTransforms}
```

- [ ] **Step 3: Thread through `CanvasStage`**

In `src/components/CanvasStage.tsx`, add to the props type immediately after `onToggleDiacriticHidden: (blockId: number, glyphIndex: number) => void;` (line 91):

```ts
  onUpdateGlyphTransform: (
    blockId: number,
    glyphIndex: number,
    patch: Partial<GlyphTransform>
  ) => void;
```

Add `GlyphTransform` to the existing `../types` import (line 21). Add `onUpdateGlyphTransform,` to the destructured props beside `onToggleDiacriticHidden,` (line 135).

In the `<ShapedText>` mount, immediately after the `glyphTransforms={...}` line added in Task 2:

```tsx
                    glyphTransformMode={block.glyphTransformMode ?? false}
                    onUpdateGlyphTransform={(glyphIndex, patch) =>
                      onUpdateGlyphTransform(block.id, glyphIndex, patch)
                    }
```

- [ ] **Step 4: Declare the new props on `ShapedText`**

In `src/components/ShapedText.tsx`, add to the props type immediately after `glyphTransforms?: GlyphTransform[];` (added in Task 2):

```ts
  glyphTransformMode?: boolean;
  onUpdateGlyphTransform?: (glyphIndex: number, patch: Partial<GlyphTransform>) => void;
```

Destructure both, with `glyphTransformMode = false`. They are unused until Task 4; TypeScript accepts an unused destructured prop, but ESLint may not — if lint complains, do Task 4 before running lint, or leave these two out of the destructure until Task 4 adds the mount that uses them (the props type entries are still needed now so `CanvasStage` typechecks).

- [ ] **Step 5: Add the Morph panel controls**

In `src/components/MorphGlyphEditor.tsx`, add to `MorphGlyphEditorProps` immediately after `onSetBlockKashidaAmount?: (blockId: number, amount: number) => void;` (line 234):

```ts
  onToggleGlyphTransformMode?: (blockId: number) => void;
  onResetGlyphTransforms?: (blockId: number) => void;
```

Add both to the destructured props beside `onSetBlockKashidaAmount,` (line 265).

Change the `RangeRow` import (line 5) to also bring in the checkbox:

```ts
import { CheckboxRow, RangeRow } from "./sidebar/FormControls";
```

Then, immediately **before** the `{kashidaEligibleCount > 0 && (` block (line 723), add:

```tsx
        {selectedBlock.type === "text" && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            <div className="sidebarSectionTitle" style={{ marginBottom: 0 }}>
              Move &amp; Scale
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Hover a letter on the canvas to move it, or stretch it in x or y.
              Neighbouring letters never shift.
            </div>

            <div style={{ marginTop: 8 }}>
              <CheckboxRow
                id={makeId("glyph-transform-mode", selectedId)}
                label="Move &amp; scale glyph"
                checked={!!selectedBlock.glyphTransformMode}
                onChange={() => onToggleGlyphTransformMode?.(selectedBlock.id)}
              />
            </div>

            {(selectedBlock.glyphTransforms?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => onResetGlyphTransforms?.(selectedBlock.id)}
                className="sidebarSmallAction"
                style={{ background: "var(--bg-input)", marginTop: 8 }}
              >
                Reset glyph transforms
              </button>
            )}
          </div>
        )}
```

The `selectedBlock.type === "text"` gate is what keeps this v1-scoped: the Morph panel is also shown for Shape Fill and Shape Warp blocks, which carry the fields but do not render them.

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
```

Expected: all clean.

- [ ] **Step 7: Confirm the controls in the browser**

Run `npm run dev`. Select the default text block, open the Morph Glyph Editor (the panel toggle on the right edge), and confirm: a "Move & Scale" section appears with the checkbox; ticking it survives an undo/redo round trip; the reset button is absent (no transforms exist yet); and the section does **not** appear for a Shape Fill or Shape Warp block.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/CanvasStage.tsx src/components/ShapedText.tsx src/components/MorphGlyphEditor.tsx
git commit -m "Add glyph transform state, history, and Morph panel controls"
```

---

### Task 4: The hover overlay

**Files:**
- Create: `src/components/GlyphTransformHoverHandles.tsx`
- Modify: `src/components/ShapedText.tsx:861-880` (the two existing overlay mounts)

**Interfaces:**
- Consumes: `GLYPH_SCALE_MAX`, `scaleFromDrag` (Task 1); `projectOntoAxis` from `src/lib/strokeSchema/dragAxis.ts`; `GlyphHitBox` exported from `src/components/ShapedText.tsx`; `onUpdateGlyphTransform` (Task 3).
- Produces: `GlyphTransformHoverHandlesProps` — the component is mounted only by `ShapedText`.

- [ ] **Step 1: Write the component**

Create `src/components/GlyphTransformHoverHandles.tsx`:

```tsx
import React, { useRef, useState } from "react";
import { Group, Circle, Rect } from "react-konva";
import { projectOntoAxis } from "../lib/strokeSchema/dragAxis";
import { GLYPH_SCALE_MAX, scaleFromDrag } from "../lib/glyphTransform";
import type { GlyphHitBox } from "./ShapedText";
import type { GlyphTransform } from "../types";

export type GlyphTransformHoverHandlesProps = {
  isSelected: boolean;
  /** Armed by the Morph panel's "Move & scale glyph" checkbox. */
  enabled: boolean;
  /** Already transform-aware: ShapedText applies each glyph's transform when it builds these. */
  glyphHitBoxes: GlyphHitBox[];
  glyphTransforms: GlyphTransform[];
  /** The block's own canvas-space origin — these boxes are in glyph-run space. */
  offsetX: number;
  offsetY: number;
  onUpdateGlyphTransform?: (glyphIndex: number, patch: Partial<GlyphTransform>) => void;
};

const MOVE_HANDLE_COLOR = "#38bdf8";
const SCALE_X_HANDLE_COLOR = "#d4af37";
const SCALE_Y_HANDLE_COLOR = "#22c55e";

/** How far outside the glyph box the two scale dots sit, in px. */
const SCALE_HANDLE_GAP = 10;

/**
 * On-canvas hover-only overlay for moving and scaling a whole glyph.
 *
 * Only the currently-hovered glyph shows handles — the same rule that keeps
 * the diacritic and stroke-stretch overlays from turning a line of text
 * into a field of dots.
 *
 * All arithmetic is in glyph-run space; `offsetX`/`offsetY` shift into the
 * Konva group space the overlay draws in. The one exception is
 * `dragBoundFunc`, whose contract is *absolute* (stage) coordinates — the
 * rails are therefore captured through the parent's absolute transform at
 * drag start, the technique DiacriticHoverHandles established after mixing
 * the two spaces teleported its move handle sideways under pan/zoom.
 */
export const GlyphTransformHoverHandles: React.FC<GlyphTransformHoverHandlesProps> = ({
  isSelected,
  enabled,
  glyphHitBoxes,
  glyphTransforms,
  offsetX,
  offsetY,
  onUpdateGlyphTransform,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  // Sticky-hover while a handle is being dragged: a move handle travels
  // well outside the hit rect during a normal gesture, so containment
  // alone can't be trusted mid-drag.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const railRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(
    null
  );
  // The transform as it stood when this drag began. Reading it live from
  // props during onDragMove would compound each frame's scale onto the
  // previous one and run away exponentially.
  const dragStartRef = useRef<{
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);

  if (!isSelected || !enabled) return null;

  return (
    <Group>
      {glyphHitBoxes.map((box) => {
        const transform = glyphTransforms.find((t) => t.glyphIndex === box.glyphIndex);
        const isActive = hoveredIndex === box.glyphIndex || draggingIndex === box.glyphIndex;

        // Handle rest positions, in glyph-run space, on the box as
        // currently drawn (ShapedText already folded the transform into
        // these boxes, so the dots follow a transformed glyph).
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const scaleXAt = { x: box.x + box.width + SCALE_HANDLE_GAP, y: cy };
        const scaleYAt = { x: cx, y: box.y - SCALE_HANDLE_GAP };

        // The pen origin is the scale pivot — the same point the renderer
        // pivots on, so a drag reads back the scale the glyph will draw at.
        const pivotX = box.gx;
        const pivotY = box.gy;

        // The hit rect covers the glyph plus every dot's rest position, so
        // a dot dragged outward can't leave the rect, fire onMouseLeave,
        // and unmount itself mid-gesture.
        const rx1 = Math.min(box.x, scaleYAt.x, scaleXAt.x) - SCALE_HANDLE_GAP;
        const ry1 = Math.min(box.y, scaleYAt.y, scaleXAt.y) - SCALE_HANDLE_GAP;
        const rx2 = Math.max(box.x + box.width, scaleXAt.x, scaleYAt.x) + SCALE_HANDLE_GAP;
        const ry2 = Math.max(box.y + box.height, scaleXAt.y, scaleYAt.y) + SCALE_HANDLE_GAP;

        const beginDrag = (pointer: { x: number; y: number }) => {
          dragStartRef.current = {
            scaleX: transform?.scaleX ?? 1,
            scaleY: transform?.scaleY ?? 1,
            offsetX: transform?.offsetX ?? 0,
            offsetY: transform?.offsetY ?? 0,
            pointerX: pointer.x,
            pointerY: pointer.y,
          };
          setDraggingIndex(box.glyphIndex);
        };

        const endDrag = () => {
          railRef.current = null;
          dragStartRef.current = null;
          setDraggingIndex((v) => (v === box.glyphIndex ? null : v));
        };

        return (
          <Group key={box.glyphIndex}>
            <Rect
              x={rx1 + offsetX}
              y={ry1 + offsetY}
              width={rx2 - rx1}
              height={ry2 - ry1}
              fill="transparent"
              // Konva routes a pointer only to the topmost listening shape,
              // and these rects are deliberately wide. Switching every
              // other glyph's rect off while one is active stops them
              // stealing hover from each other.
              listening={hoveredIndex === null || isActive}
              onMouseEnter={() => setHoveredIndex(box.glyphIndex)}
              onMouseLeave={() =>
                setHoveredIndex((v) => (v === box.glyphIndex ? null : v))
              }
            />

            {isActive && (
              <>
                <Circle
                  x={cx + offsetX}
                  y={cy + offsetY}
                  radius={5}
                  fill={MOVE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    beginDrag(e.target.position());
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const start = dragStartRef.current;
                    if (!start) return;
                    const pos = e.target.position();
                    onUpdateGlyphTransform?.(box.glyphIndex, {
                      offsetX: start.offsetX + (pos.x - start.pointerX),
                      offsetY: start.offsetY + (pos.y - start.pointerY),
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    endDrag();
                  }}
                />

                <Circle
                  x={scaleXAt.x + offsetX}
                  y={scaleXAt.y + offsetY}
                  radius={4}
                  fill={SCALE_X_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  dragBoundFunc={(pos) => {
                    const rail = railRef.current;
                    return rail ? projectOntoAxis(rail.a, rail.b, pos) : pos;
                  }}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    const parent = e.target.getParent();
                    if (parent) {
                      const tr = parent.getAbsoluteTransform();
                      railRef.current = {
                        a: tr.point({ x: pivotX + offsetX, y: scaleXAt.y + offsetY }),
                        b: tr.point({
                          x: pivotX + offsetX + 100,
                          y: scaleXAt.y + offsetY,
                        }),
                      };
                    }
                    beginDrag(e.target.position());
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const start = dragStartRef.current;
                    if (!start) return;
                    const pos = e.target.position();
                    // Rest distance is measured at scale 1, so divide the
                    // current dot distance by the scale it was drawn at.
                    const restDistance =
                      (scaleXAt.x + offsetX - (pivotX + offsetX)) / (start.scaleX || 1);
                    const dragDistance = pos.x - (pivotX + offsetX);
                    onUpdateGlyphTransform?.(box.glyphIndex, {
                      scaleX: scaleFromDrag(restDistance, dragDistance),
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    endDrag();
                  }}
                />

                <Circle
                  x={scaleYAt.x + offsetX}
                  y={scaleYAt.y + offsetY}
                  radius={4}
                  fill={SCALE_Y_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  dragBoundFunc={(pos) => {
                    const rail = railRef.current;
                    return rail ? projectOntoAxis(rail.a, rail.b, pos) : pos;
                  }}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    const parent = e.target.getParent();
                    if (parent) {
                      const tr = parent.getAbsoluteTransform();
                      railRef.current = {
                        a: tr.point({ x: scaleYAt.x + offsetX, y: pivotY + offsetY }),
                        b: tr.point({
                          x: scaleYAt.x + offsetX,
                          y: pivotY + offsetY - 100,
                        }),
                      };
                    }
                    beginDrag(e.target.position());
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const start = dragStartRef.current;
                    if (!start) return;
                    const pos = e.target.position();
                    const restDistance =
                      (scaleYAt.y + offsetY - (pivotY + offsetY)) / (start.scaleY || 1);
                    const dragDistance = pos.y - (pivotY + offsetY);
                    onUpdateGlyphTransform?.(box.glyphIndex, {
                      scaleY: scaleFromDrag(restDistance, dragDistance),
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    endDrag();
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

export default GlyphTransformHoverHandles;
```

`GLYPH_SCALE_MAX` is imported but only used if you add a visual clamp indicator; if lint flags it as unused, drop it from the import rather than adding a suppression.

- [ ] **Step 2: Mount it and stand the stroke dots down**

In `src/components/ShapedText.tsx`, add the import:

```ts
import { GlyphTransformHoverHandles } from "./GlyphTransformHoverHandles";
```

Replace the existing `<StrokeStretchHoverHandles ... />` mount (lines 861–870) with a gated version plus the new overlay, keeping the long ordering comment above it untouched:

```tsx
      {!glyphTransformMode && (
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
      )}

      {/*
        Mounted between the stroke-stretch dots and the diacritic handles
        for the same topmost-wins reason the comment above describes: these
        rects are glyph-sized, so they must not paint over a mark's smaller,
        more precise target. The stroke dots stand down entirely while this
        tool is armed — one tool at a time, so a dot is never ambiguous.
      */}
      <GlyphTransformHoverHandles
        isSelected={isSelected}
        enabled={glyphTransformMode}
        glyphHitBoxes={glyphHitBoxes}
        glyphTransforms={glyphTransforms}
        offsetX={bx + localDrawX}
        offsetY={by + localDrawY}
        onUpdateGlyphTransform={onUpdateGlyphTransform}
      />
```

Leave the `<DiacriticHoverHandles>` mount below it exactly as it is — mounted last, it stays topmost on marks.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
```

Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/GlyphTransformHoverHandles.tsx src/components/ShapedText.tsx
git commit -m "Add on-canvas move and scale handles for individual glyphs"
```

---

### Task 5: Browser verification and documentation

The overlay has no unit tests — jsdom cannot drive Konva hit-testing, the same documented gap as `DiacriticHoverHandles` and `imageTrace.ts`. This task is where the feature is actually proven.

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Verify the handles by hand**

Run `npm run dev`. On a plain text block with several letters, select it and tick "Move & scale glyph" in the Morph Glyph Editor. Confirm each of these:

- Hovering a letter shows three dots: blue at its center, gold to its right, green above it.
- Dragging blue moves that glyph in any direction; **no other glyph moves**.
- Dragging gold widens/narrows the glyph horizontally; it stays anchored at its pen origin and neighbours stay put.
- Dragging green grows/shrinks it vertically; it keeps sitting on the baseline rather than floating off it.
- Each dot follows the glyph after the change — hovering again shows the dots on the glyph's new position and size, not its old one.
- Dragging cannot push a glyph below a fifth of its size or above four times it.
- A continuous drag is one undo step; undo restores the pre-drag state.
- With the checkbox **off**, the stroke-stretch dots come back and the move/scale dots are gone.
- On a block with tashkeel, hovering a mark still gives the diacritic handles rather than these.
- "Reset glyph transforms" appears once a glyph has been transformed and clears every transform on the block.

Note: scripted browser automation can mount these handles by hovering but cannot land a press on them (Konva's hit canvas is stale at the instant a hover-mounted circle appears), so every drag above must be done by hand.

- [ ] **Step 2: Confirm export is unaffected**

Export the block to PNG and to SVG. The transformed glyphs must appear transformed in both, and no handle dots may appear in either — they are hover-only, and nothing is hovered during an export, so no extra hiding logic should be needed in `useExport.ts`. If a dot does appear in an export, stop: that means the overlay is rendering unhovered, which is a bug in Task 4's `isActive` gate rather than something to paper over in the export path.

- [ ] **Step 3: Update `CLAUDE.md`**

Add a new section immediately after the "Per-instance diacritic control" section:

```markdown
### Per-glyph move & scale (`src/lib/glyphTransform.ts`, `GlyphTransformHoverHandles.tsx`)

Plain text blocks support rigidly moving a single shaped glyph and
stretching or shrinking it as a whole in x or y — a third per-glyph system
alongside `glyphEdits` (which displaces individual *outline points* with
band falloff) and `diacriticOverrides` (uniform scale plus vertical offset,
marks only). Ticking "Move & scale glyph" in the Morph Glyph Editor arms it;
hovering a letter then shows three dots — blue to move, gold to scale x,
green to scale y.

`GlyphTransform` (`types.ts`: `offsetX`/`offsetY`/`scaleX`/`scaleY`, all
defaulting to the identity) is applied in `ShapedText.tsx`'s
`drawWarpedGlyphRun` as a `ctx.translate`/`ctx.scale` pair placed inside the
existing `ctx.translate(gx, gy)` — which is what makes the pivot the glyph's
**pen origin** (on the baseline, at the start of its advance) with no pivot
arithmetic, so a scaled letter keeps sitting on the baseline. It composes
*after* `applyGlyphEdit` and the glyph rig: stretch handles reshape the
outline, then this moves and scales the result as a unit. A glyph carrying
both a diacritic override and a transform gets both, multiplied.

**`penX += advance` is never touched** — a moved or widened glyph does not
reflow its neighbours, matching what `hidden` already guarantees on
diacritic overrides. The same transform *is* applied to the glyph's entry in
`glyphHitBoxes` (via `transformedBox`, shared with the overlay so the two
cannot disagree) but deliberately **not** to the block-level `bounds`
accumulated in that same loop: those must stay based on the untransformed
run, or transforming one glyph would resize the block and shift every other
glyph on canvas.

Scales are clamped to 0.2–4 in `glyphTransform.ts`, both when reading a drag
and when resolving a stored value, so a corrupted project file cannot
produce a glyph too small to grab and fix.

Arming is exclusive: while `glyphTransformMode` is on, `ShapedText` does not
mount `StrokeStretchHoverHandles` at all, so a dot is never ambiguous.
`DiacriticHoverHandles` still mounts last and stays topmost, keeping its
smaller targets winning on marks.

Transforms are keyed by glyph index and share that scheme's fragility, with
one difference worth knowing: `diacriticOverrides` are re-filtered each
render against `findDiacriticGlyphIndices`, so a stale override landing on a
base letter is dropped, but a glyph transform has no such signal — every
glyph is a legitimate target — so a stale transform applies to whatever glyph
now holds that index, exactly as `glyphEdits` already does.

Plain text only. Shape Fill and Shape Warp carry the fields via
`BlockCommon` but neither renderer reads them; `App.tsx`'s
`supportsGlyphTransforms` gate rejects edits there rather than accepting
and silently discarding them.
```

Then add to the "Deferred features" list:

```markdown
- **Per-glyph move & scale on Shape Fill, Shape Warp, and text-on-path blocks** — Implemented for plain text only. The `DiacriticPlacement` adapters (`src/lib/diacriticPlacement.ts`) make the two shape types a follow-up rather than a rewrite, but each renderer's coordinate space needs its own verification pass; text-on-path is excluded for the same reason every other per-glyph tool is, its glyphs being rotated to a curve tangent.

- **Per-glyph rotation** — The move/scale handles cover translation and axis-aligned scale only. Rotation needs a fourth handle and its own pivot decision.
```

- [ ] **Step 4: Final verification and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add CLAUDE.md
git commit -m "Document per-glyph move & scale"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `GlyphTransform` type, fields, defaults | 1 |
| `glyphTransforms` / `glyphTransformMode` on `BlockCommon` | 1 |
| Stale-index behaviour documented, not solved | 1 (comment), 5 (CLAUDE.md) |
| `ctx.translate`/`ctx.scale` in the pen-origin slot | 2 |
| Composition after `applyGlyphEdit` and the rig | 2 (placement in the loop) |
| No reflow — `penX += advance` untouched | 2 (and a Global Constraint) |
| Hit boxes track the drawn glyph | 2 |
| Block bounds must *not* follow the transform | 2 |
| Three dots, positions, colors | 4 |
| Rails in absolute space via `projectOntoAxis` | 4 |
| Rest position measured at current scale | 4 |
| 0.2–4 clamp | 1 (`clampScale`), 4 (via `scaleFromDrag`) |
| Union hit rect + `listening` toggle | 4 |
| Stroke dots stand down; diacritic handles stay topmost | 4 |
| `App.tsx` handlers, debounced drag history | 3 |
| Morph panel checkbox + reset button | 3 |
| Plain-text-only gate | 3 (`supportsGlyphTransforms`, panel gate) |
| `glyphTransform.ts` unit tests | 1 |
| Overlay untested, proven by hand | 5 |
| Export unaffected | 5 |
| Out-of-scope items recorded | 5 (CLAUDE.md deferred list) |

No gaps.

**Type consistency:** `GlyphTransform`, `ResolvedGlyphTransform`,
`resolveGlyphTransform`, `scaleFromDrag`, `transformedBox`,
`GLYPH_SCALE_MIN`/`GLYPH_SCALE_MAX`, `glyphTransforms`,
`glyphTransformMode`, `onUpdateGlyphTransform`,
`onToggleGlyphTransformMode`, `onResetGlyphTransforms`, and
`supportsGlyphTransforms` are spelled identically everywhere they appear
across Tasks 1–5.

**Commit integrity:** Task 1 adds the type and the lib together because the
lib cannot compile without the type. Task 3 declares props on `ShapedText`
that only Task 4 consumes — that typechecks (an unused optional prop is
legal), and Step 4 of that task calls out the one lint wrinkle and how to
handle it. Every other task is independently green.
