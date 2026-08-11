# Text on Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth block type, `textPath`, that flows shaped Arabic text along a user-defined curve (drawn with a pen tool, generated from a formula preset, or imported from an uploaded SVG path), rendered as a new Konva component alongside the existing four block renderers.

**Architecture:** The curve is stored as a plain SVG path `d` string (`textPathD`) on the block, reusing `src/lib/svgPath.ts`'s existing parse/flatten/replay functions instead of inventing a new curve format. A new `src/lib/textPath.ts` module adds arc-length walking (`pathLength`, `pointAtArcLength`), preset generators, and an anchor/handle editing model that converts to/from that `d` string. `TextOnPathText.tsx` renders each glyph as a rigid unit (translate + rotate to the curve tangent), modeled on `ShapedText.tsx`'s glyph loop rather than `ShapeWarpText.tsx`'s per-point remap. `TextPathEditOverlay.tsx` is a separate component providing the on-canvas pen-tool interaction, kept out of the renderer so each file has one job.

**Tech Stack:** React 19 + TypeScript, Konva/react-konva, Vitest for the new `lib/textPath.ts` unit tests.

## Global Constraints

- Run `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build` — in that order — after each task, not after every small edit (per this project's established verification cadence).
- Every mutating handler in `App.tsx` calls `pushHistory()` before changing `blocks` state; continuous/live-updating gestures (drag, slider) instead call a debounced scheduler from `useDebouncedHistoryPush` after `setBlocks`, matching the existing `updateKashidaText`/`scheduleKashidaHistoryPush` pattern — never invent a third pattern.
- New block-type-specific Konva interactions get their own dedicated named prop threaded through `CanvasStage` (e.g. `onUpdateTextPathD`), matching how `onKashidaTextChange`/`onUpdateStretchHandle`/`onResizeShapeFillBlock` are already done — never add a generic untyped "onUpdateBlock" prop to `CanvasStage`.
- `src/types.ts`'s `Partial<Block>` update paths (`updateBlock`/`updateSelectedBlock`) already cast `as Block` — reuse them for `textPath` patches rather than adding new casts elsewhere.
- No Stretch-tool glyph handles, glyph rigs, or multi-line text on `textPath` blocks in this plan (explicit non-goal in the spec).

---

## File Structure

New files:
- `src/lib/textPath.ts` — curve math: `pathLength`, `pointAtArcLength`, preset generators (`arcPathD`/`wavePathD`/`circlePathD`), and the anchor/handle editing model (`CurveAnchor`, `anchorsToD`, `dToAnchors`).
- `src/lib/textPath.test.ts` — unit tests for the above.
- `src/components/TextOnPathText.tsx` — renders shaped text along `textPathD`. One job: final pixel output.
- `src/components/TextPathEditOverlay.tsx` — the on-canvas pen-tool: draggable anchor/handle dots, click-to-add-anchor. One job: curve editing interaction.

Modified files:
- `src/types.ts` — new `TextPathBlock` union member.
- `src/App.tsx` — glyph-edit eligibility guards, `addTextPathBlock`, `updateTextPathD`, prop wiring.
- `src/components/CanvasStage.tsx` — new `textPath` branch, new props.
- `src/components/Sidebar.tsx` — new toolbar button, new panel controls, font-size row guard.
- `src/components/Icons.tsx` — new `PathTextIcon`.
- `src/hooks/useExport.ts` — hide the curve edit-overlay layer during export.
- `CLAUDE.md` — new subsystem section (final task).

---

### Task 1: Add the `TextPathBlock` type and exclude it from glyph-stretch/rig eligibility

**Files:**
- Modify: `src/types.ts`
- Modify: `src/App.tsx:282` (`rightPanelVisible`)
- Modify: `src/App.tsx` — internal glyph-edit mutator guards (search `b.type === "image"` inside `upsertGlyphEditRaw`, `selectGlyphForBlock`, `setGlyphMaskEditMode`, `removeStretchHandle`-calling handler, `setStretchFactor`, `saveStretchHandleAsRig`, `setGlyphRigValue`)

**Interfaces:**
- Produces: `export type TextPathBlock = BlockCommon & { type: "textPath"; textPathD: string; textPathReversed?: boolean; textPathBaselineOffset?: number; textPathEditMode?: boolean; }` and `Block = TextBlock | ShapeFillBlock | ShapeWarpBlock | ImageBlock | TextPathBlock`. Every later task in this plan consumes this type.

- [ ] **Step 1: Add the type**

In `src/types.ts`, update the `BlockType` union and add the new block type after `ImageBlock`:

```ts
export type BlockType = "text" | "shapeFill" | "shapeWarp" | "image" | "textPath";
```

```ts
export type TextPathBlock = BlockCommon & {
  type: "textPath";
  /** SVG path `d` string defining the curve the text follows. */
  textPathD: string;
  /** Manual override for which end of the curve the text starts from. */
  textPathReversed?: boolean;
  /** Perpendicular offset of the text baseline from the curve; 0 = on the curve. */
  textPathBaselineOffset?: number;
  /** True while the on-canvas pen-tool curve editor is active for this block. */
  textPathEditMode?: boolean;
};

export type Block = TextBlock | ShapeFillBlock | ShapeWarpBlock | ImageBlock | TextPathBlock;
```

- [ ] **Step 2: Verify the type addition compiles**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no new errors (the type is additive and nothing references `"textPath"` yet).

- [ ] **Step 3: Exclude `textPath` from the glyph-edit right panel**

In `src/App.tsx`, change:

```ts
const rightPanelVisible = !isMobile && !!selectedBlock && selectedBlock.type !== "image";
```

to:

```ts
const rightPanelVisible =
  !isMobile &&
  !!selectedBlock &&
  selectedBlock.type !== "image" &&
  selectedBlock.type !== "textPath";
```

- [ ] **Step 4: Extend the internal glyph-edit mutator guards**

In `src/App.tsx`, four distinct guard strings gate glyph-stretch/rig mutators on block type. Confirm first that each string appears *only* inside glyph-edit-related functions (`upsertGlyphEditRaw`, the stretch-handle-removal handler, `setStretchFactor`, `saveStretchHandleAsRig`, `setGlyphRigValue`, `selectGlyphForBlock`, `setGlyphMaskEditMode`) — not in the unrelated randomize-typography map near `setBackgroundColor`/`textLight` or `buildLayoutPayload`'s `referencedAxisIds` (those use a different `b.type === "image" ? ... : ...` ternary shape and apply correctly to `textPath` blocks as-is; leave them alone). Then replace every occurrence of each string with `replace_all: true`:

- `if (b.id !== blockId || b.type === "image") return b;` (appears 5 times, across `upsertGlyphEditRaw`, the stretch-handle-removal handler, `setStretchFactor`'s inner `setBlocks`, `saveStretchHandleAsRig`'s inner `setBlocks`, and `setGlyphRigValue`) → `if (b.id !== blockId || b.type === "image" || b.type === "textPath") return b;`
- `b.id === blockId && b.type !== "image"` (appears 2 times, in `selectGlyphForBlock` and `setGlyphMaskEditMode`) → `b.id === blockId && b.type !== "image" && b.type !== "textPath"`
- `if (!block || block.type === "image") return;` (appears once, in `setStretchFactor`'s early return) → `if (!block || block.type === "image" || block.type === "textPath") return;`
- `if (!block || block.type === "image" || !trimmed) return;` (appears once, in `saveStretchHandleAsRig`'s early return) → `if (!block || block.type === "image" || block.type === "textPath" || !trimmed) return;`

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint`
Expected: both pass with no new errors (still nothing constructs a `textPath` block, so this is a compile+lint check only — runtime behavior is verified once Task 5 makes blocks of this type creatable).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/App.tsx
git commit -m "Add TextPathBlock type, exclude it from glyph-stretch/rig eligibility"
```

---

### Task 2: Curve arc-length math (`lib/textPath.ts` core)

**Files:**
- Create: `src/lib/textPath.ts`
- Create: `src/lib/textPath.test.ts`

**Interfaces:**
- Consumes: `parseSvgPath`, `pathToPolygon`, `type SvgCmd` from `src/lib/svgPath.ts`.
- Produces: `pathLength(cmds: SvgCmd[]): number` and `pointAtArcLength(cmds: SvgCmd[], s: number, reversed: boolean): { x: number; y: number; angle: number }`. Task 5 (renderer) and Task 4 (anchor model round-trip tests) consume both.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/textPath.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSvgPath } from "./svgPath";
import { pathLength, pointAtArcLength } from "./textPath";

describe("pathLength", () => {
  it("measures a straight line exactly", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    expect(pathLength(cmds)).toBeCloseTo(100, 5);
  });

  it("approximates a quarter-circle arc within 1%", () => {
    const R = 100;
    const k = 0.5522847498;
    const d = `M ${R} 0 C ${R} ${R * k} ${R * k} ${R} 0 ${R}`;
    const cmds = parseSvgPath(d);
    const expected = (Math.PI / 2) * R;
    expect(pathLength(cmds)).toBeGreaterThan(expected * 0.99);
    expect(pathLength(cmds)).toBeLessThan(expected * 1.01);
  });
});

describe("pointAtArcLength", () => {
  it("returns the start point at s=0, unreversed", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, 0, false);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.angle).toBeCloseTo(0, 5);
  });

  it("returns the end point at s=length, unreversed", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, 100, false);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("interpolates the midpoint, unreversed", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, 50, false);
    expect(p.x).toBeCloseTo(50, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("anchors s=0 to the curve's end point when reversed", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, 0, true);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("clamps s beyond the path length to the end point", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, 500, false);
    expect(p.x).toBeCloseTo(100, 5);
  });

  it("clamps negative s to the start point", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, -50, false);
    expect(p.x).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/textPath.test.ts`
Expected: FAIL — `Cannot find module './textPath'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `lib/textPath.ts`**

Create `src/lib/textPath.ts`:

```ts
import { pathToPolygon, type SvgCmd } from "./svgPath";

const ARC_LENGTH_STEPS = 32;

/** Total length of a flattened path (fixed-step bezier subdivision, same resolution used for contour masking elsewhere). */
export function pathLength(cmds: SvgCmd[]): number {
  const pts = pathToPolygon(cmds, ARC_LENGTH_STEPS);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

/**
 * The point and local tangent angle at arc-length distance `s` along the
 * path. `reversed` flips which end `s=0` starts from — RTL text anchors to
 * the curve's *end* point by default (see `TextOnPathText`), which reverses
 * only this lookup, never the stored path itself. `s` is clamped to
 * `[0, pathLength]`.
 */
export function pointAtArcLength(
  cmds: SvgCmd[],
  s: number,
  reversed: boolean
): { x: number; y: number; angle: number } {
  const raw = pathToPolygon(cmds, ARC_LENGTH_STEPS);
  const pts = reversed ? [...raw].reverse() : raw;
  if (pts.length < 2) return { x: 0, y: 0, angle: 0 };

  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    cum.push(cum[i - 1] + Math.hypot(x2 - x1, y2 - y1));
  }
  const total = cum[cum.length - 1];
  const clamped = Math.max(0, Math.min(total, s));

  let i = 1;
  while (i < cum.length - 1 && cum[i] < clamped) i++;

  const [x1, y1] = pts[i - 1];
  const [x2, y2] = pts[i];
  const segStart = cum[i - 1];
  const segLen = cum[i] - segStart;
  const t = segLen > 0 ? (clamped - segStart) / segLen : 0;

  return {
    x: x1 + (x2 - x1) * t,
    y: y1 + (y2 - y1) * t,
    angle: Math.atan2(y2 - y1, x2 - x1),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/textPath.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/textPath.ts src/lib/textPath.test.ts
git commit -m "Add text-path arc-length math (pathLength, pointAtArcLength)"
```

---

### Task 3: Preset curve generators

**Files:**
- Modify: `src/lib/textPath.ts`
- Modify: `src/lib/textPath.test.ts`

**Interfaces:**
- Consumes: `pathLength` from Task 2 (same file).
- Produces: `arcPathD(width: number, height: number): string`, `wavePathD(width: number, height: number): string`, `circlePathD(width: number, height: number): string`. Task 8 (Sidebar preset dropdown) consumes all three.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/textPath.test.ts`:

```ts
import { arcPathD, wavePathD, circlePathD } from "./textPath";

describe("arcPathD", () => {
  it("starts and ends at the given width, height", () => {
    const cmds = parseSvgPath(arcPathD(200, 50));
    expect(cmds[0]).toMatchObject({ type: "M", x: 0, y: 50 });
    const last = cmds[cmds.length - 1] as { x: number; y: number };
    expect(last.x).toBeCloseTo(200, 5);
    expect(last.y).toBeCloseTo(50, 5);
  });
});

describe("wavePathD", () => {
  it("starts at the origin and ends at the given width, mid-height", () => {
    const cmds = parseSvgPath(wavePathD(400, 100));
    expect(cmds[0]).toMatchObject({ type: "M", x: 0, y: 50 });
    const last = cmds[cmds.length - 1] as { x: number; y: number };
    expect(last.x).toBeCloseTo(400, 5);
    expect(last.y).toBeCloseTo(50, 5);
  });
});

describe("circlePathD", () => {
  it("produces a path whose length is close to 3/4 of the circle's circumference", () => {
    const r = 100;
    const cmds = parseSvgPath(circlePathD(2 * r, 2 * r));
    const expected = 1.5 * Math.PI * r; // 270° of circumference 2*pi*r
    const length = pathLength(cmds);
    expect(length).toBeGreaterThan(expected * 0.98);
    expect(length).toBeLessThan(expected * 1.02);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/textPath.test.ts`
Expected: FAIL — `arcPathD`/`wavePathD`/`circlePathD` are not exported yet.

- [ ] **Step 3: Implement the presets**

Append to `src/lib/textPath.ts`:

```ts
/** A gentle upward bow from (0, height) to (width, height), peaking near y=0 at the midpoint. */
export function arcPathD(width: number, height: number): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return `M 0 ${h} C ${w * 0.25} 0, ${w * 0.75} 0, ${w} ${h}`;
}

/** One full sine-like cycle across `width`, amplitude `height / 2` around the vertical midpoint. */
export function wavePathD(width: number, height: number): string {
  const w = Math.max(1, width);
  const amp = height / 2;
  const midY = height / 2;
  const q = w / 4;
  return [
    `M 0 ${midY}`,
    `C ${q * 0.5} ${midY - amp}, ${q * 1.5} ${midY - amp}, ${q * 2} ${midY}`,
    `C ${q * 2.5} ${midY + amp}, ${q * 3.5} ${midY + amp}, ${w} ${midY}`,
  ].join(" ");
}

/**
 * Three-quarters of a circle (270°), swept clockwise from the top, leaving
 * the top-left quadrant (the left→top segment) open so the path has a clear
 * start/end for text to anchor to instead of being a closed loop.
 */
export function circlePathD(width: number, height: number): string {
  const r = Math.max(1, Math.min(width, height) / 2);
  const cx = width / 2;
  const cy = height / 2;
  const k = 0.5522847498 * r;

  const top = { x: cx, y: cy - r };
  const right = { x: cx + r, y: cy };
  const bottom = { x: cx, y: cy + r };
  const left = { x: cx - r, y: cy };

  return [
    `M ${top.x} ${top.y}`,
    `C ${top.x + k} ${top.y}, ${right.x} ${right.y - k}, ${right.x} ${right.y}`,
    `C ${right.x} ${right.y + k}, ${bottom.x + k} ${bottom.y}, ${bottom.x} ${bottom.y}`,
    `C ${bottom.x - k} ${bottom.y}, ${left.x} ${left.y + k}, ${left.x} ${left.y}`,
  ].join(" ");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/textPath.test.ts`
Expected: PASS, all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/textPath.ts src/lib/textPath.test.ts
git commit -m "Add text-path preset curve generators (arc, wave, circle)"
```

---

### Task 4: Anchor/handle curve-editing model

**Files:**
- Modify: `src/lib/textPath.ts`
- Modify: `src/lib/textPath.test.ts`

**Interfaces:**
- Consumes: `parseSvgPath`, `type SvgCmd` from `src/lib/svgPath.ts`.
- Produces: `type CurveAnchor = { x: number; y: number; handleX: number; handleY: number }`, `anchorsToD(anchors: CurveAnchor[]): string`, `dToAnchors(cmds: SvgCmd[]): CurveAnchor[]`. Task 7 (`TextPathEditOverlay.tsx`) consumes all three.

This module represents every curve segment with a single *outgoing* handle per anchor — the incoming handle for the next segment is always that anchor's mirror image. This keeps the pen tool to one draggable handle dot per anchor (a full independent-in/out-handle pen tool is out of scope for v1) while still producing smooth, C1-continuous curves through every anchor.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/textPath.test.ts`:

```ts
import { anchorsToD, dToAnchors, type CurveAnchor } from "./textPath";

describe("anchorsToD / dToAnchors round-trip", () => {
  it("round-trips a two-anchor straight segment (corner points, zero-length handles)", () => {
    const anchors: CurveAnchor[] = [
      { x: 0, y: 0, handleX: 0, handleY: 0 },
      { x: 100, y: 0, handleX: 100, handleY: 0 },
    ];
    const d = anchorsToD(anchors);
    const back = dToAnchors(parseSvgPath(d));
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ x: 0, y: 0 });
    expect(back[1]).toMatchObject({ x: 100, y: 0 });
  });

  it("round-trips a curved segment with an authored handle", () => {
    const anchors: CurveAnchor[] = [
      { x: 0, y: 0, handleX: 20, handleY: -30 },
      { x: 100, y: 0, handleX: 100, handleY: 0 },
    ];
    const d = anchorsToD(anchors);
    const back = dToAnchors(parseSvgPath(d));
    expect(back[0]).toMatchObject({ x: 0, y: 0, handleX: 20, handleY: -30 });
    expect(back[1].x).toBeCloseTo(100, 5);
    expect(back[1].y).toBeCloseTo(0, 5);
  });

  it("produces a single-point path for one anchor", () => {
    const d = anchorsToD([{ x: 5, y: 5, handleX: 5, handleY: 5 }]);
    expect(d).toBe("M 5 5");
  });

  it("returns an empty anchor list for an empty path", () => {
    expect(dToAnchors([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/textPath.test.ts`
Expected: FAIL — `anchorsToD`/`dToAnchors`/`CurveAnchor` are not exported yet.

- [ ] **Step 3: Implement the anchor model**

Append to `src/lib/textPath.ts`:

```ts
/**
 * One point on an editable curve, plus its single *outgoing* bezier handle
 * (absolute position, not a delta). The incoming handle for the segment
 * arriving at the *next* anchor is this anchor's mirror image — see
 * `anchorsToD`.
 */
export type CurveAnchor = {
  x: number;
  y: number;
  handleX: number;
  handleY: number;
};

/** Serializes an anchor chain into an SVG path `d` string. */
export function anchorsToD(anchors: CurveAnchor[]): string {
  if (anchors.length === 0) return "";
  if (anchors.length === 1) return `M ${anchors[0].x} ${anchors[0].y}`;

  const parts = [`M ${anchors[0].x} ${anchors[0].y}`];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const c1x = a.handleX;
    const c1y = a.handleY;
    const c2x = 2 * b.x - b.handleX;
    const c2y = 2 * b.y - b.handleY;
    parts.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`);
  }
  return parts.join(" ");
}

/**
 * Converts parsed SVG path commands into the anchor model. Segments with
 * independent in/out handles (e.g. an uploaded SVG authored in another
 * tool) are lossily folded into this module's single-handle-per-anchor
 * model — the previous anchor's handle is set from the segment's first
 * control point, and the new anchor's handle is the mirror of the
 * segment's second control point. `Z` (close path) is ignored — text-path
 * curves are open paths, not closed loops.
 */
export function dToAnchors(cmds: SvgCmd[]): CurveAnchor[] {
  const anchors: CurveAnchor[] = [];

  for (const c of cmds) {
    if (c.type === "M" || c.type === "L") {
      anchors.push({ x: c.x, y: c.y, handleX: c.x, handleY: c.y });
    } else if (c.type === "C") {
      if (anchors.length > 0) {
        anchors[anchors.length - 1].handleX = c.x1;
        anchors[anchors.length - 1].handleY = c.y1;
      }
      anchors.push({
        x: c.x,
        y: c.y,
        handleX: 2 * c.x - c.x2,
        handleY: 2 * c.y - c.y2,
      });
    } else if (c.type === "Q") {
      if (anchors.length > 0) {
        anchors[anchors.length - 1].handleX = c.x1;
        anchors[anchors.length - 1].handleY = c.y1;
      }
      anchors.push({ x: c.x, y: c.y, handleX: c.x, handleY: c.y });
    }
  }

  return anchors;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/textPath.test.ts`
Expected: PASS, all 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/textPath.ts src/lib/textPath.test.ts
git commit -m "Add text-path anchor/handle curve-editing model"
```

---

### Task 5: First visible slice — renderer, canvas wiring, creation button

**Files:**
- Create: `src/components/TextOnPathText.tsx`
- Modify: `src/components/CanvasStage.tsx`
- Modify: `src/components/Icons.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `parseSvgPath`, `replayPath` (`lib/svgPath.ts`); `pathLength`, `pointAtArcLength` (`lib/textPath.ts`, Task 2); `useShapedGlyphs` (`hooks/useShapedGlyphs.ts`); `TextPathBlock` (Task 1).
- Produces: `TextOnPathText` component (props below), a `"textPath"` branch in `CanvasStage`'s block-type switch, `addTextPathBlock()` in `App.tsx`, `PathTextIcon` in `Icons.tsx`. Task 6 consumes the `CanvasStage` branch (adds the edit-overlay sibling next to it) and `addTextPathBlock`.

- [ ] **Step 1: Add the `PathTextIcon`**

In `src/components/Icons.tsx`, add after `ShapesIcon`:

```tsx
export const PathTextIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M3 17c3-8 6-12 9-12s3 8 6 8 3-4 3-4" />
    <circle cx="3" cy="17" r="1.4" fill="currentColor" stroke="none" />
  </IconBase>
);
```

- [ ] **Step 2: Write `TextOnPathText.tsx`**

Create `src/components/TextOnPathText.tsx`:

```tsx
import React, { useMemo } from "react";
import { Group, Shape } from "react-konva";
import type Konva from "konva";
import { parseSvgPath, replayPath } from "../lib/svgPath";
import { pathLength, pointAtArcLength } from "../lib/textPath";
import { useShapedGlyphs } from "../hooks/useShapedGlyphs";

export type TextOnPathTextProps = {
  id?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  rotation?: number;

  textPathD: string;
  textPathReversed?: boolean;
  textPathBaselineOffset?: number;

  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

/**
 * Renders shaped text flowing along an arbitrary curve. Each glyph is drawn
 * as a rigid unit (translate to its curve position, rotate to the local
 * tangent), modeled on ShapedText.tsx's glyph loop — not ShapeWarpText.tsx's
 * per-point remap, since text-on-path doesn't distort individual glyph
 * outlines, it just repositions whole glyphs.
 */
export const TextOnPathText: React.FC<TextOnPathTextProps> = ({
  id,
  text,
  x,
  y,
  fontSize,
  color,
  fontFamily,
  fontStyle = "normal",
  opacity = 1,
  stroke = "#000000",
  strokeWidth = 0,
  rotation = 0,
  textPathD,
  textPathReversed = false,
  textPathBaselineOffset = 0,
  locked,
  draggable = true,
  onClick,
  onTap,
  onDblClick,
  onDragMove,
  onDragEnd,
}) => {
  const { glyphs, font, unitsPerEm, hbLoaded } = useShapedGlyphs(text, fontFamily);
  const isItalic = fontStyle === "italic" || fontStyle === "bold italic";

  const parsedCmds = useMemo(() => parseSvgPath(textPathD || ""), [textPathD]);
  const curveLen = useMemo(() => pathLength(parsedCmds), [parsedCmds]);
  // RTL text anchors to the curve's end point by default (walking the
  // reversed flattened point list); textPathReversed flips that per block.
  const walkReversed = !textPathReversed;

  return (
    <Group
      id={id}
      x={x}
      y={y}
      rotation={rotation}
      draggable={draggable && !locked}
      onClick={onClick}
      onTap={onTap}
      onDblClick={onDblClick}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      opacity={opacity}
    >
      <Shape
        sceneFunc={(ctx) => {
          if (!hbLoaded || !font || parsedCmds.length < 2 || curveLen <= 0) return;

          const scale = fontSize / Math.max(unitsPerEm || 1000, 1);
          let naturalAdvance = 0;
          for (const g of glyphs) naturalAdvance += (g.ax ?? 0) * scale;
          if (naturalAdvance <= 0) return;

          // Auto-fit: the effective size always spans the curve exactly,
          // same idea ShapeFillText already applies per-row to shape width.
          const fitScale = curveLen / naturalAdvance;
          const c2d = ctx as unknown as CanvasRenderingContext2D;

          let cursor = 0;
          for (const g of glyphs) {
            const glyphObj = font.glyphs.get(g.g);
            const advance = (g.ax ?? 0) * scale * fitScale;
            if (!glyphObj) {
              cursor += advance;
              continue;
            }

            const { x: px, y: py, angle } = pointAtArcLength(parsedCmds, cursor, walkReversed);
            const opPath = glyphObj.getPath(0, 0, fontSize * fitScale);

            c2d.save();
            c2d.translate(px, py);
            c2d.rotate(angle);
            c2d.translate(0, textPathBaselineOffset);
            if (isItalic) c2d.transform(1, 0, -0.25, 1, 0, 0);

            c2d.fillStyle = color;
            replayPath(c2d, opPath.commands);
            c2d.fill();

            if (strokeWidth > 0) {
              c2d.strokeStyle = stroke;
              c2d.lineWidth = strokeWidth;
              c2d.stroke();
            }

            c2d.restore();
            cursor += advance;
          }
        }}
      />
    </Group>
  );
};

export default TextOnPathText;
```

- [ ] **Step 3: Wire the `textPath` branch into `CanvasStage.tsx`**

In `src/components/CanvasStage.tsx`, add the import:

```ts
import { TextOnPathText } from "./TextOnPathText";
```

Add a new branch inside the `blocks.map((block) => { ... })` body, right after the `shapeWarp` branch (before the final fallback `return (<ShapedText ...>)`):

```tsx
if (block.type === "textPath") {
  return (
    <TextOnPathText
      key={block.id}
      {...commonProps}
      text={block.text}
      x={block.x}
      y={block.y}
      fontSize={block.fontSize}
      color={block.color}
      fontFamily={block.fontFamily}
      fontStyle={block.fontStyle ?? "normal"}
      opacity={block.opacity ?? 1}
      stroke={block.stroke}
      strokeWidth={block.strokeWidth ?? 0}
      rotation={block.rotation ?? 0}
      textPathD={block.textPathD}
      textPathReversed={block.textPathReversed ?? false}
      textPathBaselineOffset={block.textPathBaselineOffset ?? 0}
      locked={block.locked}
    />
  );
}
```

- [ ] **Step 4: Add `addTextPathBlock` to `App.tsx`**

In `src/App.tsx`, add near `addShapeWarpBlock`:

```ts
const addTextPathBlock = () => {
  const newId = createNextId();
  const width = 400;
  const height = 120;

  beginPlacement(
    {
      ...DEFAULT_BLOCK,
      id: newId,
      text: "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ",
      type: "textPath",
      textPathD: arcPathD(width, height),
      textPathReversed: false,
      textPathBaselineOffset: 0,
      textPathEditMode: false,
      x: 0,
      y: 0,
    },
    width,
    height,
    -width / 2,
    -height / 2,
    "New Text on Path"
  );
};
```

Add the import at the top of `App.tsx`:

```ts
import { arcPathD } from "./lib/textPath";
```

Pass the handler into `Sidebar`'s JSX (near `onAddShapeWarpBlock={addShapeWarpBlock}`):

```tsx
onAddTextPathBlock={addTextPathBlock}
```

- [ ] **Step 5: Add the "Add Text on Path" button to `Sidebar.tsx`**

In `src/components/Sidebar.tsx`, add to `SidebarProps`:

```ts
onAddTextPathBlock?: () => void;
```

Destructure it in the component's props, and add the button after the `onAddShapeWarpBlock` button (same toolbar row):

```tsx
{onAddTextPathBlock && (
  <button
    type="button"
    className="sidebarCircleButton"
    title="Add Text on Path"
    onClick={onAddTextPathBlock}
  >
    <PathTextIcon size={14} />
  </button>
)}
```

Add `PathTextIcon` to the existing `import { ... } from "./Icons"` line.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`
In the browser: click "Add Text on Path" in the sidebar, click to place it on the canvas. Expected: the placeholder text renders following a gentle upward arc, auto-sized to span the arc's width.

- [ ] **Step 7: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/TextOnPathText.tsx src/components/CanvasStage.tsx src/components/Icons.tsx src/App.tsx src/components/Sidebar.tsx
git commit -m "Render text-on-path blocks: renderer, canvas wiring, creation button"
```

---

### Task 6: Curve editing — pen tool, live updates, export hiding

**Files:**
- Create: `src/components/TextPathEditOverlay.tsx`
- Modify: `src/components/CanvasStage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/hooks/useExport.ts`

**Interfaces:**
- Consumes: `CurveAnchor`, `anchorsToD`, `dToAnchors` (`lib/textPath.ts`, Task 4); `parseSvgPath` (`lib/svgPath.ts`); `useDebouncedHistoryPush` (`hooks/useDebouncedHistoryPush.ts`).
- Produces: `TextPathEditOverlay` component; `onUpdateTextPathD(blockId: number, d: string): void` threaded through `CanvasStage`; `textPathEditMode` toggle wired in `Sidebar`.

- [ ] **Step 1: Write `TextPathEditOverlay.tsx`**

Create `src/components/TextPathEditOverlay.tsx`:

```tsx
import React, { useMemo } from "react";
import { Group, Circle, Line, Rect, Fragment } from "react-konva";
import type Konva from "konva";
import { parseSvgPath } from "../lib/svgPath";
import { anchorsToD, dToAnchors, type CurveAnchor } from "../lib/textPath";

export type TextPathEditOverlayProps = {
  id?: string;
  x: number;
  y: number;
  rotation?: number;
  textPathD: string;
  onChange: (d: string) => void;
};

const HANDLE_COLOR = "#38bdf8";
const ANCHOR_COLOR = "#d4af37";
const LINE_COLOR = "rgba(212, 175, 55, 0.6)";

/**
 * The on-canvas pen-tool for editing a text-path block's curve — click
 * empty space to append a new anchor, drag an anchor or its single
 * (mirrored) handle to reshape. Kept separate from TextOnPathText so the
 * renderer's only job is drawing final glyph output.
 */
export const TextPathEditOverlay: React.FC<TextPathEditOverlayProps> = ({
  id,
  x,
  y,
  rotation = 0,
  textPathD,
  onChange,
}) => {
  const anchors = useMemo(
    () => dToAnchors(parseSvgPath(textPathD || "")),
    [textPathD]
  );

  const commit = (next: CurveAnchor[]) => onChange(anchorsToD(next));

  const relativePos = (e: Konva.KonvaEventObject<Event>) => {
    const group = e.target.getParent() as Konva.Group;
    return group.getRelativePointerPosition();
  };

  const handleAddAnchor = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const pos = relativePos(e);
    if (!pos) return;
    commit([...anchors, { x: pos.x, y: pos.y, handleX: pos.x, handleY: pos.y }]);
  };

  return (
    <Group id={id} x={x} y={y} rotation={rotation}>
      <Rect
        x={-2000}
        y={-2000}
        width={4000}
        height={4000}
        fill="transparent"
        onClick={handleAddAnchor}
        onTap={handleAddAnchor}
      />

      {anchors.length > 1 && (
        <Line
          points={anchors.flatMap((a) => [a.x, a.y])}
          stroke={LINE_COLOR}
          strokeWidth={1.5}
          dash={[6, 4]}
          listening={false}
        />
      )}

      {anchors.map((a, i) => (
        <Fragment key={i}>
          <Line
            points={[a.x, a.y, a.handleX, a.handleY]}
            stroke={LINE_COLOR}
            strokeWidth={1}
            listening={false}
          />
          <Circle
            x={a.handleX}
            y={a.handleY}
            radius={5}
            fill={HANDLE_COLOR}
            stroke="#ffffff"
            strokeWidth={1.5}
            draggable
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const pos = relativePos(e);
              if (!pos) return;
              commit(
                anchors.map((anchor, idx) =>
                  idx === i ? { ...anchor, handleX: pos.x, handleY: pos.y } : anchor
                )
              );
            }}
          />
          <Circle
            x={a.x}
            y={a.y}
            radius={7}
            fill={ANCHOR_COLOR}
            stroke="#ffffff"
            strokeWidth={2}
            draggable
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const pos = relativePos(e);
              if (!pos) return;
              const dx = pos.x - anchors[i].x;
              const dy = pos.y - anchors[i].y;
              commit(
                anchors.map((anchor, idx) =>
                  idx === i
                    ? {
                        ...anchor,
                        x: pos.x,
                        y: pos.y,
                        handleX: anchor.handleX + dx,
                        handleY: anchor.handleY + dy,
                      }
                    : anchor
                )
              );
            }}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              if (anchors.length <= 2) return;
              commit(anchors.filter((_, idx) => idx !== i));
            }}
          />
        </Fragment>
      ))}
    </Group>
  );
};

export default TextPathEditOverlay;
```

- [ ] **Step 2: Add `updateTextPathD` and its debounced history push to `App.tsx`**

Near the other `useDebouncedHistoryPush` declarations (`scheduleMoveHistoryPush`, etc.):

```ts
const scheduleTextPathHistoryPush = useDebouncedHistoryPush(pushHistory);
```

Near `updateKashidaText`:

```ts
const updateTextPathD = useCallback(
  (id: number, d: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, textPathD: d } as Block) : b)));
    scheduleTextPathHistoryPush();
  },
  [scheduleTextPathHistoryPush]
);
```

- [ ] **Step 3: Thread `onUpdateTextPathD` through `CanvasStage`**

In `src/components/CanvasStage.tsx`, add to `CanvasStageProps`:

```ts
onUpdateTextPathD: (blockId: number, d: string) => void;
```

Destructure it in the component signature, and update the `textPath` branch added in Task 5 to also render the edit overlay when active and selected:

```tsx
if (block.type === "textPath") {
  return (
    <React.Fragment key={block.id}>
      <TextOnPathText
        {...commonProps}
        text={block.text}
        x={block.x}
        y={block.y}
        fontSize={block.fontSize}
        color={block.color}
        fontFamily={block.fontFamily}
        fontStyle={block.fontStyle ?? "normal"}
        opacity={block.opacity ?? 1}
        stroke={block.stroke}
        strokeWidth={block.strokeWidth ?? 0}
        rotation={block.rotation ?? 0}
        textPathD={block.textPathD}
        textPathReversed={block.textPathReversed ?? false}
        textPathBaselineOffset={block.textPathBaselineOffset ?? 0}
        locked={block.locked}
      />
      {block.textPathEditMode && block.id === selectedId && (
        <TextPathEditOverlay
          id={`text-path-edit-layer-${block.id}`}
          x={block.x}
          y={block.y}
          rotation={block.rotation ?? 0}
          textPathD={block.textPathD}
          onChange={(d) => onUpdateTextPathD(block.id, d)}
        />
      )}
    </React.Fragment>
  );
}
```

Add the import:

```ts
import { TextPathEditOverlay } from "./TextPathEditOverlay";
```

- [ ] **Step 4: Pass `onUpdateTextPathD` from `App.tsx`'s `<CanvasStage>`**

Near `onKashidaTextChange={updateKashidaText}`:

```tsx
onUpdateTextPathD={updateTextPathD}
```

- [ ] **Step 5: Add the "Edit Curve" toggle to `Sidebar.tsx`**

Inside the `selectedBlock.type !== "image"` Effects/Text panel area (or its own small block right after the "Add Text on Path" panel section), add a guard block only shown for `textPath`:

```tsx
{selectedBlock && selectedBlock.type === "textPath" && (
  <div className="sidebarPanel">
    <CollapsibleSection title="Curve" isOpen={showText} onToggle={() => setShowText((v) => !v)}>
      <div className="sectionPanel">
        <button
          type="button"
          className="sidebarPillButton"
          style={
            selectedBlock.textPathEditMode
              ? { background: "var(--accent)", color: "var(--text-on-accent)" }
              : undefined
          }
          onClick={() =>
            onUpdateSelectedBlock({ textPathEditMode: !selectedBlock.textPathEditMode })
          }
        >
          {selectedBlock.textPathEditMode ? "Done Editing Curve" : "Edit Curve"}
        </button>
      </div>
    </CollapsibleSection>
  </div>
)}
```

(`showText`/`setShowText` is the same collapsible-section state `Sidebar.tsx` already shares across its Image and Text panels — line 207 — so reusing it here for the Curve panel matches that existing convention rather than adding a redundant new state pair.)

- [ ] **Step 6: Hide the edit-overlay layer during export**

In `src/hooks/useExport.ts`'s `withExportAdjustments`, hide every text-path edit layer alongside the grid/background (there can be more than one selected across exports over time, so hide all matching nodes, not just one):

```ts
const gridNode = stage.findOne("#grid-lines");
const bgNode = opts.transparent ? stage.findOne("#artboard-background") : null;
const editOverlayNodes = stage.find((node: Konva.Node) => node.id().startsWith("text-path-edit-layer-"));
const gridWasVisible = gridNode?.visible() ?? false;
const bgWasVisible = bgNode?.visible() ?? false;
const overlayVisibility = editOverlayNodes.map((n) => n.visible());
gridNode?.visible(false);
bgNode?.visible(false);
editOverlayNodes.forEach((n) => n.visible(false));
```

and restore them in the `finally` block:

```ts
gridNode?.visible(gridWasVisible);
bgNode?.visible(bgWasVisible);
editOverlayNodes.forEach((n, i) => n.visible(overlayVisibility[i]));
```

- [ ] **Step 7: Manual verification**

Run: `npm run dev`
In the browser: select a text-on-path block, click "Edit Curve". Expected: gold anchor dots and blue handle dots appear on the curve; dragging an anchor reshapes the curve and the text visibly re-flows along it; clicking empty canvas adds a new anchor; right-clicking an anchor (with 3+ anchors present) removes it. Export a PNG while in edit mode — expected: the handles/dots do not appear in the exported image.

- [ ] **Step 8: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/TextPathEditOverlay.tsx src/components/CanvasStage.tsx src/App.tsx src/components/Sidebar.tsx src/hooks/useExport.ts
git commit -m "Add text-path curve editing: pen tool, live updates, export hiding"
```

---

### Task 7: Remaining sidebar controls

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `arcPathD`, `wavePathD`, `circlePathD` (`lib/textPath.ts`, Task 3); `extractSvgPaths` (`lib/svgImport.ts`); `onUpdateSelectedBlock` (existing prop).

- [ ] **Step 1: Hide the font-size row for `textPath` blocks**

In `src/components/Sidebar.tsx`'s Text panel, wrap the existing font-size `RangeRow` (currently unconditional inside the `type !== "image"` panel) so it's skipped for `textPath`, with an explanatory note in its place:

```tsx
{selectedBlock.type === "textPath" ? (
  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
    Letter size on a text-path block is set by the curve's length — drag the
    curve longer or shorter in Edit Curve mode, or change the text.
  </div>
) : (
  <RangeRow
    id={makeId("font-size", selectedId)}
    name={makeId("fontSize", selectedId)}
    label="Font size"
    value={selectedBlock.fontSize}
    min={
      selectedBlock.type === "shapeFill" || selectedBlock.type === "shapeWarp" ? 4 : 12
    }
    max={
      selectedBlock.type === "shapeFill" || selectedBlock.type === "shapeWarp" ? 400 : 200
    }
    onChange={(v) => onUpdateSelectedBlock({ fontSize: v })}
    suffix={`${Math.round(selectedBlock.fontSize)}px`}
    fieldKey="fontSize"
  />
)}
```

- [ ] **Step 2: Add the preset dropdown, flip toggle, and baseline-offset slider**

In the same "Curve" panel section added in Task 6 (below the Edit Curve button), add:

```tsx
<SelectRow
  id={makeId("text-path-preset", selectedId)}
  name={makeId("textPathPreset", selectedId)}
  label="Preset"
  value="custom"
  onChange={(v) => {
    if (v === "arc") {
      onUpdateSelectedBlock({ textPathD: arcPathD(400, 120) });
    } else if (v === "wave") {
      onUpdateSelectedBlock({ textPathD: wavePathD(400, 120) });
    } else if (v === "circle") {
      onUpdateSelectedBlock({ textPathD: circlePathD(300, 300) });
    }
  }}
>
  <option value="custom">Custom</option>
  <option value="arc">Arc</option>
  <option value="wave">Wave</option>
  <option value="circle">Circle</option>
</SelectRow>

<label className="field">
  <span className="fieldTitle">
    <input
      type="checkbox"
      checked={selectedBlock.textPathReversed ?? false}
      onChange={(e) => onUpdateSelectedBlock({ textPathReversed: e.target.checked })}
      style={{ marginRight: 6 }}
    />
    Flip direction
  </span>
</label>

<RangeRow
  id={makeId("text-path-baseline-offset", selectedId)}
  name={makeId("textPathBaselineOffset", selectedId)}
  label="Baseline offset"
  value={selectedBlock.textPathBaselineOffset ?? 0}
  min={-60}
  max={60}
  onChange={(v) => onUpdateSelectedBlock({ textPathBaselineOffset: v })}
  suffix={selectedBlock.textPathBaselineOffset ?? 0}
  fieldKey="textPathBaselineOffset"
/>
```

Add the import:

```ts
import { arcPathD, wavePathD, circlePathD } from "../lib/textPath";
```

(The preset `<SelectRow>`'s `value="custom"` is intentionally static — picking a preset applies it immediately as a one-shot action rather than persisting "which preset is active" as block state, since a user's subsequent hand-edit in Edit Curve mode would otherwise leave a stale preset name selected.)

- [ ] **Step 3: Add the "Upload SVG path" button for an already-selected block**

Add a new handler near `handleSvgUpload` in `Sidebar.tsx`:

```ts
const handleTextPathSvgUpload = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".svg,image/svg+xml";

  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = extractSvgPaths(e.target?.result as string, undefined, true);
      if (!result) {
        alert(
          "No supported shape elements found in SVG (path, rect, circle, ellipse, polygon, polyline)."
        );
        return;
      }
      onUpdateSelectedBlock({ textPathD: result.pathData });
    };
    reader.readAsText(file);
  };

  input.click();
};
```

Add the button in the same "Curve" panel section:

```tsx
<button type="button" className="sidebarPillButton" onClick={handleTextPathSvgUpload}>
  Upload SVG Path
</button>
```

(`extractSvgPaths(text, undefined, true)` passes `preserveAspect: true` — for a curve, keeping the uploaded shape's actual proportions matters more than fitting a fixed square, unlike the `shapeFill`/`shapeWarp` upload flow which always constrains to a target box.)

- [ ] **Step 4: Manual verification**

Run: `npm run dev`
In the browser: select a text-on-path block, try each preset in the dropdown (curve visibly changes, text re-flows), toggle "Flip direction" (text starts from the other end), drag the baseline-offset slider (text moves perpendicular to the curve), upload a small hand-drawn SVG path (curve replaced, text follows it). Confirm the font-size slider is replaced by the explanatory note.

- [ ] **Step 5: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "Add text-path sidebar controls: presets, upload, flip, baseline offset"
```

---

### Task 8: Final verification and documentation

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing new — this task only verifies and documents what Tasks 1–7 built.

- [ ] **Step 1: Full manual smoke test**

Run: `npm run dev`
Walk through, in order: add a text-on-path block → confirm it renders on the default arc → edit the curve (drag anchors/handles, add and remove points) → switch between all three presets → upload a custom SVG path → flip direction → adjust baseline offset → change the outline/shadow/color controls (Effects/Text panels) and confirm they apply → duplicate the block → undo/redo through several of the above steps and confirm each undoes cleanly → export to PNG and SVG and confirm the curve handles never appear in the output → save and reload the layout (localStorage save/load) and confirm the block survives round-trip.

- [ ] **Step 2: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 3: Document the subsystem in `CLAUDE.md`**

Add a new section to `CLAUDE.md`, after the "Stroke-schema-driven glyph editor" section, following the existing documentation style (architecture rationale, not a feature list):

```markdown
### Text on path (`src/lib/textPath.ts`, `TextOnPathText.tsx`, `TextPathEditOverlay.tsx`)

A fifth block type, `textPath`, flows shaped text along an arbitrary curve
instead of a straight baseline. The curve is stored as a plain SVG path `d`
string (`textPathD`) — the same representation `shapeSvgPath` already uses
on `shapeFill`/`shapeWarp` blocks — rather than a bespoke point-array type,
so presets, SVG upload, and freehand pen-tool drawing all converge on one
representation and reuse `lib/svgPath.ts`'s existing parse/flatten/replay
functions wholesale.

`lib/textPath.ts` adds arc-length walking (`pathLength`/`pointAtArcLength`,
built on the same fixed-step bezier subdivision `pathToPolygon` already
provides), three preset-curve generators (`arcPathD`/`wavePathD`/
`circlePathD`), and a single-handle-per-anchor bezier editing model
(`CurveAnchor`/`anchorsToD`/`dToAnchors`) — every anchor has one *outgoing*
handle; the incoming handle for the next segment is always that anchor's
mirror image, trading a fully general independent-in/out-handle pen tool
for a much simpler one-handle-per-anchor editing UI.

`TextOnPathText.tsx` renders each glyph as a rigid unit — translate to its
arc-length position on the curve, rotate to the local tangent, draw the
outline — modeled on `ShapedText.tsx`'s glyph loop rather than
`ShapeWarpText.tsx`'s per-point remap, since text-on-path repositions whole
glyphs rather than distorting their outlines. Text always auto-scales to
span the curve's length exactly (same idea `ShapeFillText` already applies
per-row to its shape width), which means the block's `fontSize` field has
no visible effect for this block type and its slider is hidden in the
sidebar — curve length is the only size control. RTL text anchors to the
curve's *end* point by default (a `textPathReversed` flag flips this per
block when the guess is wrong for a particular curve).

`TextPathEditOverlay.tsx` is a separate component (not part of
`TextOnPathText`) providing the on-canvas pen-tool: click empty canvas to
append an anchor, drag an anchor or its handle to reshape, right-click an
anchor to remove it. It's shown only when a `textPath` block is both
selected and has `textPathEditMode` set, and is hidden during export
(`useExport.ts` toggles off every node whose id starts with
`text-path-edit-layer-`, alongside the grid and artboard background it
already hides).

Stretch-tool glyph handles and glyph rigs do not apply to `textPath`
blocks — `App.tsx`'s `rightPanelVisible` and every internal glyph-edit
mutator guard exclude `"textPath"` the same way they've always excluded
`"image"`. The anchor/drag math those tools use assumes a straight glyph
bounding box; making it work once a glyph is rotated to a curve tangent
is a real design problem, deliberately left for a future spec rather than
half-supported here.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the text-on-path subsystem in CLAUDE.md"
```
