# Shaped Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `guide` block type: a dashed helper path that is never exported. `textPath` (Curve) blocks can be attached to a guide, where they keep their own size, sit at a chosen place along it, and pick a side and a flip. Moving or reshaping the guide carries them with it.

**Architecture:** Pure modules do the geometry and the bookkeeping:
- `guideShapes.ts` builds the guide paths.
- `guidePlacement.ts` places the glyphs and projects a drag point onto a guide.
- `guides.ts` handles attach, detach, delete-with-detach and orphans.

`GuideView.tsx` draws a guide. `TextOnPathText` gains a guide mode, fed by `CanvasStage`, which resolves the guide each render. `App.tsx` handlers and Sidebar panels drive it.

**Tech Stack:** React 19, TypeScript, Vite, Konva/react-konva, harfbuzzjs (WASM), opentype.js, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-shaped-guides-design.md`

## Global Constraints

- **Pure modules stay pure.** `guideShapes.ts`, `guidePlacement.ts` and `guides.ts` must not import `./harfbuzz`, React or Konva.
- **Shaping tests use real shaping.** Any test that shapes text uses real harfbuzzjs and real fonts from `public/fonts/`, through a `shapeReal` helper copied verbatim from the top of `src/lib/spacing.test.ts` (lines 1–129). That helper loads harfbuzzjs with `createRequire`.
- **Old saves are untouched.** They have no `guide` blocks and no `guide` attachment, and must load and render exactly as before. Don't bump the save format.
- **Exports never show a guide**, and a guide never enlarges a freeform export's crop box.
- **Undo granularity.** Each user gesture gets one `pushHistory()`. Slides along a guide go through `scheduleMoveHistoryPush`, the same path ordinary drags use.
- **Mirrors can't take a guide as their source.** A mirror of attached text follows that text.
- **Plain Curve blocks behave exactly as today.** Every guide branch is gated on `block.guide`.
- **Commit message ending:**
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc
  ```
- **Verification:**
  - `npx tsc --noEmit -p tsconfig.app.json`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `npx tsc --noEmit -p e2e/tsconfig.json`
  - `npm run e2e`

## Decisions this plan makes beyond the spec

Task 9 writes each of these back into the spec.

1. **Guide paths are centred on the block origin** (0, 0). The guide's `x`, `y` and `rotation` place it, which makes rotation pivot on the centre.
2. **The line guide has no angle parameter.** Its angle is the block's own `rotation`, set in the Transform panel. Two controls for one thing would drift.
3. **Pen guides reuse `TextPathEditOverlay` unchanged.** It already takes `textPathD` and `onChange(d)`, so it needs no generalising. CanvasStage renders it for a selected guide in edit mode, with `onChange` writing `guideD`.
4. **Baseline-offset sign follows the renderer.** `TextOnPathText` applies `translate(0, offset)` after rotating to the tangent, so a positive offset moves glyphs *down* in the glyph frame. Rising is `−gap × fontSize`. Hanging is `+(ascent + gap × fontSize)`.
5. **"start" alignment means the anchor sits at the text's first glyph in walking order**, and the text runs forward along the walked direction. "end" means the anchor sits at its last glyph.
6. **Grab offset is preserved when sliding.** On the first move frame, the gap between the projected pointer and the current offset is recorded. The text then keeps that gap instead of jumping its anchor under the pointer.
7. **The shrink note goes through a non-persisted callback.** `TextOnPathText` reports `onGuideLayout({ shrink })`, App keeps a `Map<id, shrink>` that isn't saved or undoable, and the Sidebar reads it.
8. **Detaching approximates the hang offset with an ascent of `0.8 × fontSize`.** App has no font metrics at hand synchronously. The detached block stretches its text along the curve anyway, so the approximation is invisible in practice.
9. **When an attached text is created, its `textPathD` is set to the guide's `guideD`.** If the guide later vanishes through a path that didn't detach it, the orphan fallback still has a sensible curve.

## Review Focus

1. **Undo and redo across delete-with-detach.** Deleting a guide detaches its texts in the same step, and one undo restores the guide *and* re-attaches the texts. Pinned in Task 7's e2e "delete the guide then undo".
2. **A multi-selection deleted while it includes a guide and some of its texts.** The deleted texts go. The surviving texts detach. Pinned in Task 3 (`deleteBlocksDetachingGuides` unit test).
3. **Flipped text at the seam of a closed guide** (position near 0 or 100%). It wraps without a gap or a jump. Pinned in Task 2 ("wraps across the seam" with flip).
4. **An attached text whose guide is locked.** The guide can't move. The text can still slide, because it is not locked. Pinned by code in Task 6. The reviewer checks the drag handler reads the text's own `locked`, not the guide's.
5. **A mirror of an attached text, and Ctrl+V of an attached text.** The mirror follows. A pasted copy stays attached to the same guide at the same offset, overlapping the original until it is slid. Pinned in Task 4 (blockRenderProps test) and stated in `guides.md`.

---

### Task 1: Guide types and `guideShapes.ts`

**Files:**
- Modify: `src/types.ts` (the `BlockType` union at lines 1–7, the `Block` union at lines 288–294, new types near `TextPathBlock` at line 194)
- Create: `src/lib/guideShapes.ts`
- Test: `src/lib/guideShapes.test.ts`

**Interfaces:**
- Produces, in `types.ts`:

```ts
export type GuideShape = "circle" | "ellipse" | "arc" | "wave" | "line" | "pen";
export type GuideParams = { width?: number; height?: number; sweep?: number; amplitude?: number };
export type GuideBlock = BlockCommon & {
  type: "guide";
  /** SVG path in the block's local space, centred on its origin. */
  guideD: string;
  guideShape: GuideShape;
  /** What the Guide panel edits; `guideD` is regenerated from it (never for pen). */
  guideParams?: GuideParams;
  /** Pen point editing active (pen guides only). */
  guideEditMode?: boolean;
};
export type GuideAttachment = {
  /** The guide block's id. */
  id: number;
  /** 0..1 along the guide, in its un-flipped direction. */
  offset: number;
  align: "start" | "center" | "end";
  side: "outside" | "inside";
  flip: boolean;
  /** Distance from the line, × font size. */
  gap: number;
};
```

  Also, in `types.ts`:
  - `TextPathBlock` gains `guide?: GuideAttachment;`.
  - `"guide"` joins `BlockType`.
  - `GuideBlock` joins `Block`.

- Produces, in `guideShapes.ts`:
  - `GUIDE_DEFAULTS: Record<GuideShape, GuideParams>`
  - `guidePathD(shape: GuideShape, params?: GuideParams): string`
  - `isClosedPath(cmds: SvgCmd[]): boolean`
  - `GUIDE_SHAPE_LABELS: Record<GuideShape, string>`

- [ ] **Step 1: Write the failing test.** Create `src/lib/guideShapes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSvgPath } from "./svgPath";
import { buildArcTable, pathBoundingBox, pathLength, pointAtArcLengthFromTable } from "./textPath";
import { GUIDE_DEFAULTS, guidePathD, isClosedPath } from "./guideShapes";
import type { GuideShape } from "../types";

const SHAPES: GuideShape[] = ["circle", "ellipse", "arc", "wave", "line", "pen"];

describe("guidePathD", () => {
  it("builds a parseable path for every shape", () => {
    for (const s of SHAPES) {
      const cmds = parseSvgPath(guidePathD(s, GUIDE_DEFAULTS[s]));
      expect(cmds.length).toBeGreaterThanOrEqual(2);
      expect(pathLength(cmds)).toBeGreaterThan(0);
    }
  });

  it("closes circle and ellipse, and leaves the others open", () => {
    const closed = (s: GuideShape) => isClosedPath(parseSvgPath(guidePathD(s, GUIDE_DEFAULTS[s])));
    expect(closed("circle")).toBe(true);
    expect(closed("ellipse")).toBe(true);
    expect(closed("arc")).toBe(false);
    expect(closed("wave")).toBe(false);
    expect(closed("line")).toBe(false);
    expect(closed("pen")).toBe(false);
  });

  it("gives a circle its circumference to within 1%", () => {
    const cmds = parseSvgPath(guidePathD("circle", { width: 300 }));
    expect(Math.abs(pathLength(cmds) - Math.PI * 300) / (Math.PI * 300)).toBeLessThan(0.01);
  });

  it("is centred on the origin", () => {
    const box = pathBoundingBox(parseSvgPath(guidePathD("ellipse", { width: 360, height: 240 })));
    expect(box.x + box.width / 2).toBeCloseTo(0, 0);
    expect(box.y + box.height / 2).toBeCloseTo(0, 0);
    expect(box.width).toBeCloseTo(360, 0);
    expect(box.height).toBeCloseTo(240, 0);
  });

  it("starts a circle at the top centre and runs clockwise (rightward first)", () => {
    const table = buildArcTable(parseSvgPath(guidePathD("circle", { width: 200 })), false);
    const p0 = pointAtArcLengthFromTable(table, 0);
    const p1 = pointAtArcLengthFromTable(table, 5);
    expect(p0.x).toBeCloseTo(0, 3);
    expect(p0.y).toBeCloseTo(-100, 3);
    expect(p1.x).toBeGreaterThan(0);
  });

  it("sets an arc's length from its sweep", () => {
    const len = (sweep: number) => pathLength(parseSvgPath(guidePathD("arc", { width: 200, sweep })));
    expect(len(180) / (Math.PI * 100)).toBeCloseTo(1, 2);
    expect(len(90) / len(180)).toBeCloseTo(0.5, 2);
  });

  it("makes a wave about twice its amplitude tall", () => {
    const box = pathBoundingBox(parseSvgPath(guidePathD("wave", { width: 400, amplitude: 50 })));
    expect(box.height).toBeGreaterThan(80);
    expect(box.height).toBeLessThan(110);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**
  Run: `npx vitest run src/lib/guideShapes.test.ts`
  Expected: FAIL, because the module `./guideShapes` can't be found.

- [ ] **Step 3: Implement it.**
  1. Edit the types as listed under Interfaces.
  2. Create `src/lib/guideShapes.ts`:

```ts
import type { GuideParams, GuideShape } from "../types";
import type { SvgCmd } from "./svgPath";

/**
 * Paths for guide blocks. Pure. Every path is centred on the block origin, so
 * the guide's own x/y/rotation place it and rotation pivots on its centre.
 *
 * Closed shapes run **clockwise in screen space from the top centre**, so
 * offset 0 is the top and text along the top, unflipped, walks left to right
 * — the order the Curve renderer lays glyphs in.
 */

export const GUIDE_DEFAULTS: Record<GuideShape, GuideParams> = {
  circle: { width: 300 },
  ellipse: { width: 360, height: 240 },
  arc: { width: 300, sweep: 180 },
  wave: { width: 400, amplitude: 40 },
  line: { width: 400 },
  pen: { width: 300 },
};

export const GUIDE_SHAPE_LABELS: Record<GuideShape, string> = {
  circle: "Circle",
  ellipse: "Ellipse",
  arc: "Arc",
  wave: "Wave",
  line: "Line",
  pen: "Pen",
};

const n = (v: number) => Number(v.toFixed(3));

/** Cubic segments (≤ 90° each) along an ellipse from a0 to a1 degrees, screen angles (y down, so increasing = clockwise). */
function ellipseArc(rx: number, ry: number, a0: number, a1: number): string {
  const parts: string[] = [];
  const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
  const step = (a1 - a0) / segs;
  for (let i = 0; i < segs; i++) {
    const s = ((a0 + i * step) * Math.PI) / 180;
    const e = ((a0 + (i + 1) * step) * Math.PI) / 180;
    const k = (4 / 3) * Math.tan((e - s) / 4);
    const p0 = [Math.cos(s), Math.sin(s)];
    const p3 = [Math.cos(e), Math.sin(e)];
    const c1 = [p0[0] - k * p0[1], p0[1] + k * p0[0]];
    const c2 = [p3[0] + k * p3[1], p3[1] - k * p3[0]];
    if (i === 0) parts.push(`M ${n(rx * p0[0])} ${n(ry * p0[1])}`);
    parts.push(
      `C ${n(rx * c1[0])} ${n(ry * c1[1])}, ${n(rx * c2[0])} ${n(ry * c2[1])}, ${n(rx * p3[0])} ${n(ry * p3[1])}`
    );
  }
  return parts.join(" ");
}

export function guidePathD(shape: GuideShape, params: GuideParams = GUIDE_DEFAULTS[shape]): string {
  const p = { ...GUIDE_DEFAULTS[shape], ...params };
  const w = Math.max(p.width ?? 300, 2);
  switch (shape) {
    case "circle":
      return `${ellipseArc(w / 2, w / 2, -90, 270)} Z`;
    case "ellipse": {
      const h = Math.max(p.height ?? w, 2);
      return `${ellipseArc(w / 2, h / 2, -90, 270)} Z`;
    }
    case "arc": {
      const sweep = Math.min(Math.max(p.sweep ?? 180, 10), 350);
      return ellipseArc(w / 2, w / 2, -90 - sweep / 2, -90 + sweep / 2);
    }
    case "wave": {
      const a = p.amplitude ?? 40;
      const h = w / 4;
      let d = `M ${n(-w / 2)} 0`;
      for (let i = 0; i < 4; i++) {
        const x = -w / 2 + i * h;
        const s = i % 2 === 0 ? -1 : 1;
        d += ` C ${n(x + h * 0.36)} ${n(s * a * 1.33)}, ${n(x + h * 0.64)} ${n(s * a * 1.33)}, ${n(x + h)} 0`;
      }
      return d;
    }
    case "line":
      return `M ${n(-w / 2)} 0 L ${n(w / 2)} 0`;
    case "pen":
      return `M ${n(-w / 2)} 0 C ${n(-w / 6)} ${n(-w / 5)}, ${n(w / 6)} ${n(-w / 5)}, ${n(w / 2)} 0`;
  }
}

/** True when the path ends where it starts, or carries a Z. */
export function isClosedPath(cmds: SvgCmd[]): boolean {
  if (cmds.some((c) => c.type === "Z")) return true;
  const first = cmds.find((c) => c.type === "M");
  const last = [...cmds].reverse().find((c) => c.type !== "Z");
  if (!first || !last || first === last || first.type !== "M" || last.type === "Z") return false;
  return Math.hypot(last.x - first.x, last.y - first.y) < 1e-6;
}
```

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run src/lib/guideShapes.test.ts && npx tsc --noEmit -p tsconfig.app.json`
  Expected: the tests PASS. The typecheck may FAIL in `MirrorBlockView.tsx`, because `MirrorSource` now includes `guide`. If it does, apply Task 3 Step 3's `mirror.ts` change now, and record a ruling in the ledger. No other errors are expected.

- [ ] **Step 5: Commit.**

```bash
git add src/types.ts src/lib/guideShapes.ts src/lib/guideShapes.test.ts src/lib/mirror.ts
git commit -m "Guides: block type and shapes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 2: `guidePlacement.ts`

**Files:**
- Create: `src/lib/guidePlacement.ts`
- Test: `src/lib/guidePlacement.test.ts`

**Interfaces:**
- Consumes:
  - `ArcTable`, `CurveGlyphPlacement`, `buildArcTable` and `pointAtArcLengthFromTable` from `./textPath`;
  - `GuideAttachment` from `../types`;
  - `guidePathD` and `isClosedPath` from Task 1.
- Produces:

```ts
export type GuideLayout = {
  placements: CurveGlyphPlacement[];
  size: number;
  shrink: number;
  /** Glyph-frame y offset for every glyph: negative rises off the line, positive hangs below it. */
  baselineOffset: number;
};
export const DEFAULT_ATTACHMENT: Omit<GuideAttachment, "id">;
export function guideGlyphPlacements(args: {
  glyphs: readonly { ax?: number }[];
  fontSize: number;
  unitsPerEm: number;
  /** Font ascender, in font units. */
  ascender: number;
  /** Built with `reversed = attachment.flip`. */
  arcTable: ArcTable;
  closed: boolean;
  attachment: GuideAttachment;
}): GuideLayout | null;
export function projectToGuide(arcTable: ArcTable /* un-reversed */, point: { x: number; y: number }): number; // 0..1
```

- [ ] **Step 1: Write the failing test.**
  1. Create `src/lib/guidePlacement.test.ts`.
  2. Copy lines 1–129 of `src/lib/spacing.test.ts` verbatim. That block is the imports, the harfbuzz loader and `shapeReal`.
  3. Then append:

```ts
import { parseSvgPath } from "./svgPath";
import { buildArcTable, pointAtArcLengthFromTable, type ArcTable } from "./textPath";
import { guidePathD, isClosedPath } from "./guideShapes";
import { DEFAULT_ATTACHMENT, guideGlyphPlacements, projectToGuide } from "./guidePlacement";
import type { GuideAttachment } from "../types";

async function amiri(text: string) {
  const { glyphs, font } = await shapeReal(text, "Amiri.ttf");
  return { glyphs, upm: font.unitsPerEm || 1000, ascender: font.ascender };
}
const natural = (glyphs: { ax?: number }[], fontSize: number, upm: number) =>
  glyphs.reduce((s, g) => s + (g.ax ?? 0), 0) * (fontSize / upm);
const attach = (over: Partial<GuideAttachment> = {}): GuideAttachment => ({ id: 1, ...DEFAULT_ATTACHMENT, ...over });
const table = (d: string, flip: boolean): { t: ArcTable; closed: boolean } => {
  const cmds = parseSvgPath(d);
  return { t: buildArcTable(cmds, flip), closed: isClosedPath(cmds) };
};

describe("guideGlyphPlacements (real HarfBuzz, Amiri)", () => {
  it("keeps the natural size when the text fits", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم الله");
    const { t, closed } = table(guidePathD("circle", { width: 600 }), false);
    const r = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach() })!;
    expect(r.shrink).toBe(1);
    expect(r.size).toBe(40);
  });

  it("shrinks to exactly the available length when too long, closed and open", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم الله الرحمن الرحيم");
    for (const d of [guidePathD("circle", { width: 80 }), guidePathD("line", { width: 120 })]) {
      const { t, closed } = table(d, false);
      const r = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach() })!;
      expect(r.shrink).toBeCloseTo(t.total / natural(glyphs, 40, upm), 6);
    }
  });

  it("puts the anchor at the text's start, middle or end", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم");
    const { t, closed } = table(guidePathD("line", { width: 1000 }), false);
    const L = natural(glyphs, 40, upm);
    const firstAt = (align: GuideAttachment["align"]) =>
      guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach({ offset: 0.5, align }) })!
        .placements[0].x;
    // Line runs from x = -500 to 500; offset 0.5 is x = 0.
    expect(firstAt("start")).toBeCloseTo(0, 1);
    expect(firstAt("center")).toBeCloseTo(-L / 2, 1);
    expect(firstAt("end")).toBeCloseTo(-L, 1);
  });

  it("clamps the text inside an open guide", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم الله");
    const { t, closed } = table(guidePathD("line", { width: 1000 }), false);
    const r = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach({ offset: 0, align: "center" }) })!;
    expect(r.placements[0].x).toBeCloseTo(-500, 1);
  });

  it("wraps across the seam of a closed guide, flipped or not", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم الله");
    for (const flip of [false, true]) {
      const { t, closed } = table(guidePathD("circle", { width: 600 }), flip);
      const r = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach({ offset: 0, flip }) })!;
      // Consecutive glyphs stay close: no jump across the seam.
      for (let i = 1; i < r.placements.length; i++) {
        const a = r.placements[i - 1];
        const b = r.placements[i];
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(40);
      }
    }
  });

  it("keeps the same anchor point when flipped", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم");
    const d = guidePathD("circle", { width: 600 });
    const centre = (flip: boolean) => {
      const { t, closed } = table(d, flip);
      const r = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach({ offset: 0.5, flip }) })!;
      const xs = r.placements.map((p) => p.x);
      const ys = r.placements.map((p) => p.y);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    };
    // Offset 0.5 on a top-start clockwise circle is the bottom: (0, 300).
    expect(centre(false).y).toBeGreaterThan(250);
    expect(centre(true).y).toBeGreaterThan(250);
    expect(Math.abs(centre(true).x)).toBeLessThan(60);
  });

  it("rises outside and hangs inside; flipped outside on the bottom hangs too", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم");
    const { t, closed } = table(guidePathD("circle", { width: 600 }), false);
    const at = (a: Partial<GuideAttachment>) =>
      guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach(a) })!.baselineOffset;
    expect(at({ side: "outside" })).toBeLessThanOrEqual(0);
    expect(at({ side: "inside" })).toBeGreaterThan(0);
    const { t: tf } = table(guidePathD("circle", { width: 600 }), true);
    const flipped = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: tf, closed, attachment: attach({ side: "outside", flip: true }) })!;
    expect(flipped.baselineOffset).toBeGreaterThan(0);
  });

  it("returns null for empty text", () => {
    const { t, closed } = table(guidePathD("circle"), false);
    expect(guideGlyphPlacements({ glyphs: [], fontSize: 40, unitsPerEm: 1000, ascender: 800, arcTable: t, closed, attachment: attach() })).toBeNull();
  });
});

describe("projectToGuide", () => {
  it("finds the nearest point on a circle and an ellipse to within 0.5 px", () => {
    for (const d of [guidePathD("circle", { width: 300 }), guidePathD("ellipse", { width: 360, height: 200 })]) {
      const t = buildArcTable(parseSvgPath(d), false);
      for (const s of [0, 0.13, 0.5, 0.77, 0.99]) {
        const p = pointAtArcLengthFromTable(t, s * t.total);
        const off = projectToGuide(t, { x: p.x * 1.1, y: p.y * 1.1 });
        const q = pointAtArcLengthFromTable(t, off * t.total);
        expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(0.5 + 0.1 * Math.hypot(p.x, p.y) * 0.02);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**
  Run: `npx vitest run src/lib/guidePlacement.test.ts`
  Expected: FAIL, because the module `./guidePlacement` can't be found.

- [ ] **Step 3: Implement it.** Create `src/lib/guidePlacement.ts`:

```ts
import type { GuideAttachment } from "../types";
import { pointAtArcLengthFromTable, type ArcTable, type CurveGlyphPlacement } from "./textPath";

/**
 * Glyph placement for text attached to a guide. Pure.
 *
 * Unlike a plain Curve block, which always stretches its run to span the
 * curve, attached text keeps its own size and sits at `offset` along the
 * guide, shrinking only when it would not fit. Output uses the same
 * `CurveGlyphPlacement` the Curve renderer and Next Shape overlay consume.
 */

export type GuideLayout = {
  placements: CurveGlyphPlacement[];
  size: number;
  shrink: number;
  baselineOffset: number;
};

export const DEFAULT_ATTACHMENT: Omit<GuideAttachment, "id"> = {
  offset: 0,
  align: "center",
  side: "outside",
  flip: false,
  gap: 0.15,
};

const mod = (v: number, m: number) => ((v % m) + m) % m;

export function guideGlyphPlacements(args: {
  glyphs: readonly { ax?: number }[];
  fontSize: number;
  unitsPerEm: number;
  ascender: number;
  arcTable: ArcTable;
  closed: boolean;
  attachment: GuideAttachment;
}): GuideLayout | null {
  const { glyphs, fontSize, arcTable, closed, attachment } = args;
  const length = arcTable.total;
  if (glyphs.length === 0 || length <= 0 || fontSize <= 0) return null;
  const upm = Math.max(args.unitsPerEm || 1000, 1);
  const scale = fontSize / upm;
  let natural = 0;
  for (const g of glyphs) natural += (g.ax ?? 0) * scale;
  if (natural <= 0) return null;

  const shrink = Math.min(1, length / natural);
  const size = fontSize * shrink;
  const textLen = natural * shrink;

  // The offset is stored in the guide's un-flipped direction; a flipped
  // attachment walks a reversed table, where that same point sits at
  // `length - s`.
  const raw = Math.min(Math.max(attachment.offset, 0), 1) * length;
  const anchor = attachment.flip ? length - raw : raw;
  let start =
    attachment.align === "start" ? anchor : attachment.align === "center" ? anchor - textLen / 2 : anchor - textLen;
  if (!closed) start = Math.min(Math.max(start, 0), Math.max(length - textLen, 0));

  const placements: CurveGlyphPlacement[] = [];
  let cursor = start;
  glyphs.forEach((g, glyphIndex) => {
    const s = closed ? mod(cursor, length) : cursor;
    const { x, y, angle } = pointAtArcLengthFromTable(arcTable, s);
    placements.push({ glyphIndex, x, y, angle, size });
    cursor += (g.ax ?? 0) * scale * shrink;
  });

  // The renderer translates by (0, baselineOffset) after rotating to the
  // tangent: negative moves a glyph up (away from the line, on the side its
  // own "up" points to), positive moves it down. Walking a flipped guide turns
  // the glyphs' up toward the other side, so "outside" must then hang.
  const ascent = (args.ascender * size) / upm;
  const gap = attachment.gap * fontSize;
  const hang = (attachment.side === "inside") !== attachment.flip;
  return { placements, size, shrink, baselineOffset: hang ? ascent + gap : -gap };
}

/** Nearest point on the guide to `point`, as 0..1 along its un-flipped direction. */
export function projectToGuide(arcTable: ArcTable, point: { x: number; y: number }): number {
  const { pts, cum, total } = arcTable;
  if (pts.length < 2 || total <= 0) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(Math.max(((point.x - ax) * dx + (point.y - ay) * dy) / len2, 0), 1) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = (point.x - px) ** 2 + (point.y - py) ** 2;
    if (d < bestD) {
      bestD = d;
      best = cum[i] + t * (cum[i + 1] - cum[i]);
    }
  }
  return best / total;
}
```

  Before relying on it, check `ArcTable`'s fields in `src/lib/textPath.ts` around line 18 (`pts`, `cum`, `total`). Confirm that `cum[i]` is the arc length *at* `pts[i]`. If `cum` is indexed differently, adapt the two `cum[...]` reads and record a ruling.

- [ ] **Step 4: Run the test and confirm it passes.**
  Run: `npx vitest run src/lib/guidePlacement.test.ts`
  Expected: PASS.
  - If the anchor test fails by exactly `L`, the walked direction is reversed from what Decision 5 assumes. Swap `start`/`end` in the align expression and the test's comment, and record a ruling.
  - Never loosen the shrink or seam assertions.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/guidePlacement.ts src/lib/guidePlacement.test.ts
git commit -m "Guides: natural-size placement and drag projection" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 3: `guides.ts` bookkeeping, and mirror exclusion

**Files:**
- Create: `src/lib/guides.ts`
- Test: `src/lib/guides.test.ts`
- Modify: `src/lib/mirror.ts` (`MirrorSource` at line 28, `isMirrorSourceCandidate` at line 45)

**Interfaces:**
- Consumes:
  - from `../types`: `Block`, `GuideBlock`, `TextPathBlock`, `TextBlock`, `GuideAttachment`;
  - from Task 2: `DEFAULT_ATTACHMENT`.
- Produces:

```ts
export const DETACH_ASCENT = 0.8;
export function guidesIn(blocks: readonly Block[]): GuideBlock[];
export function attachedTo(blocks: readonly Block[], guideId: number): TextPathBlock[];
export function detachFromGuide(text: TextPathBlock, guide: GuideBlock): TextPathBlock;
export function deleteBlocksDetachingGuides(blocks: readonly Block[], ids: ReadonlySet<number>): Block[];
export function hasOrphanedAttachments(blocks: readonly Block[]): boolean;
export function dropOrphanedAttachments(blocks: readonly Block[]): Block[];
export function attachTextToGuide(text: TextBlock, guide: GuideBlock): { block: TextPathBlock; dropped: string[] };
export function newAttachedText(id: number, guide: GuideBlock, style: Partial<Block>): TextPathBlock;
```

- [ ] **Step 1: Write the failing test.** Create `src/lib/guides.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Block, GuideBlock, TextBlock, TextPathBlock } from "../types";
import {
  attachTextToGuide,
  attachedTo,
  deleteBlocksDetachingGuides,
  detachFromGuide,
  dropOrphanedAttachments,
  hasOrphanedAttachments,
  newAttachedText,
} from "./guides";
import { isMirrorSourceCandidate } from "./mirror";

const base = {
  text: "", x: 0, y: 0, fontSize: 40, color: "#000", fontFamily: "Amiri",
  stroke: "#000", shadowColor: "#000",
};
const guide: GuideBlock = { ...base, id: 1, type: "guide", guideShape: "circle", guideD: "M 0 -100 Z", x: 50, y: 60, rotation: 15 };
const onGuide = (id: number, over: Partial<TextPathBlock> = {}): TextPathBlock => ({
  ...base, id, type: "textPath", text: "بسم", textPathD: "M 0 0 L 1 0",
  guide: { id: 1, offset: 0.25, align: "center", side: "outside", flip: false, gap: 0.1 }, ...over,
});

describe("guides bookkeeping", () => {
  it("lists the texts on a guide", () => {
    const blocks: Block[] = [guide, onGuide(2), onGuide(3, { guide: undefined })];
    expect(attachedTo(blocks, 1).map((b) => b.id)).toEqual([2]);
  });

  it("detaches onto the guide's own shape and place", () => {
    const d = detachFromGuide(onGuide(2, { guide: { id: 1, offset: 0, align: "center", side: "outside", flip: true, gap: 0.1 } }), guide);
    expect(d.guide).toBeUndefined();
    expect(d.textPathD).toBe(guide.guideD);
    expect([d.x, d.y, d.rotation]).toEqual([50, 60, 15]);
    // The Curve renderer walks reversed when textPathReversed is false.
    expect(d.textPathReversed).toBe(false);
    // flip + outside hangs: positive offset.
    expect(d.textPathBaselineOffset).toBeGreaterThan(0);
  });

  it("detaches the survivors when a guide is deleted, and drops the deleted", () => {
    const blocks: Block[] = [guide, onGuide(2), onGuide(3)];
    const out = deleteBlocksDetachingGuides(blocks, new Set([1, 3]));
    expect(out.map((b) => b.id)).toEqual([2]);
    expect((out[0] as TextPathBlock).guide).toBeUndefined();
    expect((out[0] as TextPathBlock).textPathD).toBe(guide.guideD);
  });

  it("finds and drops orphaned attachments without losing the block", () => {
    const blocks: Block[] = [onGuide(2)];
    expect(hasOrphanedAttachments(blocks)).toBe(true);
    const out = dropOrphanedAttachments(blocks);
    expect(out).toHaveLength(1);
    expect((out[0] as TextPathBlock).guide).toBeUndefined();
    expect(hasOrphanedAttachments([guide, onGuide(2)])).toBe(false);
  });

  it("converts a text block, naming what it had to drop", () => {
    const t: TextBlock = {
      ...base, id: 9, type: "text", text: "الله", letterSpacing: 0.2,
      diacriticOverrides: [{ glyphIndex: 1 } as never],
      glyphAlternates: [{ letter: 0, tag: "salt", index: 1 } as never],
    };
    const { block, dropped } = attachTextToGuide(t, guide);
    expect(block.type).toBe("textPath");
    expect(block.id).toBe(9);
    expect(block.text).toBe("الله");
    expect(block.guide?.id).toBe(1);
    expect(block.textPathD).toBe(guide.guideD);
    expect(block.glyphAlternates).toEqual(t.glyphAlternates);
    expect("letterSpacing" in block).toBe(false);
    expect(dropped).toContain("diacritic moves");
    expect(dropped).toContain("letter and word spacing");
  });

  it("creates a new attached text at the guide", () => {
    const b = newAttachedText(7, guide, { fontFamily: "Amiri" });
    expect(b.guide?.id).toBe(1);
    expect(b.type).toBe("textPath");
    expect(b.fontSize).toBeGreaterThan(0);
  });

  it("never lets a guide be a mirror source", () => {
    expect(isMirrorSourceCandidate(guide)).toBe(false);
  });
});
```

  Check `DiacriticOverride` and `GlyphAlternate` in `types.ts`, and replace the `as never` fixtures with minimal valid objects if the shapes are simple.

- [ ] **Step 2: Run the test and confirm it fails.**
  Run: `npx vitest run src/lib/guides.test.ts`
  Expected: FAIL, because the module `./guides` can't be found.

- [ ] **Step 3: Implement it.**
  1. In `src/lib/mirror.ts`, make `MirrorSource = Exclude<Block, MirrorBlock | GuideBlock>`, and change the candidate check to:

```ts
export const isMirrorSourceCandidate = (block: Block | null | undefined): block is MirrorSource =>
  !!block && block.type !== "mirror" && block.type !== "guide";
```

  (Keep the existing signature's shape, and only add the guide clause. If `resolveMirrorSource` narrows by `type !== "mirror"`, add `&& s.type !== "guide"` there too.)

  2. Create `src/lib/guides.ts`:

```ts
import type { Block, GuideBlock, TextBlock, TextPathBlock } from "../types";
import { DEFAULT_ATTACHMENT } from "./guidePlacement";

/**
 * Guide bookkeeping. Pure: attach, detach, delete-with-detach, orphans.
 * A detached text keeps the guide's path as its own curve, so nothing a
 * user attached ever disappears with a guide.
 */

/** Ascent used when baking a hang offset without font metrics (see guides.md). */
export const DETACH_ASCENT = 0.8;
export const ATTACHED_TEXT_DEFAULT = "نص على الدليل";

export const guidesIn = (blocks: readonly Block[]): GuideBlock[] =>
  blocks.filter((b): b is GuideBlock => b.type === "guide");

export const attachedTo = (blocks: readonly Block[], guideId: number): TextPathBlock[] =>
  blocks.filter((b): b is TextPathBlock => b.type === "textPath" && b.guide?.id === guideId);

export function detachFromGuide(text: TextPathBlock, guide: GuideBlock): TextPathBlock {
  const a = text.guide;
  const { guide: _drop, ...rest } = text;
  void _drop;
  const hang = a ? (a.side === "inside") !== a.flip : false;
  const gap = (a?.gap ?? 0) * text.fontSize;
  return {
    ...rest,
    textPathD: guide.guideD,
    x: guide.x,
    y: guide.y,
    rotation: guide.rotation ?? 0,
    // TextOnPathText walks reversed when textPathReversed is false.
    textPathReversed: !(a?.flip ?? false),
    textPathBaselineOffset: hang ? DETACH_ASCENT * text.fontSize + gap : -gap,
  };
}

export function deleteBlocksDetachingGuides(blocks: readonly Block[], ids: ReadonlySet<number>): Block[] {
  const dying = new Map(guidesIn(blocks).filter((g) => ids.has(g.id)).map((g) => [g.id, g]));
  return blocks
    .filter((b) => !ids.has(b.id))
    .map((b) => {
      if (b.type !== "textPath" || !b.guide) return b;
      const g = dying.get(b.guide.id);
      return g ? detachFromGuide(b, g) : b;
    });
}

export function hasOrphanedAttachments(blocks: readonly Block[]): boolean {
  const ids = new Set(guidesIn(blocks).map((g) => g.id));
  return blocks.some((b) => b.type === "textPath" && b.guide !== undefined && !ids.has(b.guide.id));
}

/** An attachment whose guide is gone becomes a plain Curve block on its last-known curve. */
export function dropOrphanedAttachments(blocks: readonly Block[]): Block[] {
  const ids = new Set(guidesIn(blocks).map((g) => g.id));
  return blocks.map((b) => {
    if (b.type !== "textPath" || !b.guide || ids.has(b.guide.id)) return b;
    const { guide: _drop, ...rest } = b;
    void _drop;
    return rest;
  });
}

export function attachTextToGuide(
  text: TextBlock,
  guide: GuideBlock
): { block: TextPathBlock; dropped: string[] } {
  const dropped: string[] = [];
  if (text.diacriticOverrides?.length) dropped.push("diacritic moves");
  if (text.strokeCuts?.length) dropped.push("stroke cuts");
  if (text.letterSpacing || text.wordSpacing) dropped.push("letter and word spacing");
  if (text.verse) dropped.push("verse membership");
  const {
    type: _t, align: _a, lineHeight: _l, letterSpacing: _ls, wordSpacing: _ws, verse: _v,
    diacriticOverrides: _d, strokeCuts: _s, strokeCutEditMode: _se,
    ...keep
  } = text;
  void [_t, _a, _l, _ls, _ws, _v, _d, _s, _se];
  return {
    block: {
      ...keep,
      type: "textPath",
      textPathD: guide.guideD,
      guide: { id: guide.id, ...DEFAULT_ATTACHMENT },
    },
    dropped,
  };
}

export function newAttachedText(id: number, guide: GuideBlock, style: Partial<Block>): TextPathBlock {
  return {
    text: ATTACHED_TEXT_DEFAULT,
    fontSize: 53,
    color: "#1e3a5f",
    fontFamily: "FatemiMaqala",
    stroke: "#000000",
    shadowColor: "#000000",
    ...(style as Partial<TextPathBlock>),
    id,
    x: guide.x,
    y: guide.y,
    type: "textPath",
    textPathD: guide.guideD,
    guide: { id: guide.id, ...DEFAULT_ATTACHMENT },
  } as TextPathBlock;
}
```

  If lint rejects the `_`-prefixed unused destructures despite the `void`, check the eslint config for `argsIgnorePattern`/`varsIgnorePattern`. Use whichever idiom the repo already uses for this: grep `void _` or `eslint-disable-next-line @typescript-eslint/no-unused-vars` in `src/`. Record a ruling.

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run src/lib/guides.test.ts src/lib/mirror.test.ts && npx tsc --noEmit -p tsconfig.app.json && npm run lint`
  Expected: PASS and clean.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/guides.ts src/lib/guides.test.ts src/lib/mirror.ts
git commit -m "Guides: attach, detach and orphan bookkeeping; guides are never mirror sources" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 4: Rendering — `GuideView`, the guide mode in `TextOnPathText`, CanvasStage, render props

**Files:**
- Create: `src/components/GuideView.tsx`
- Modify: `src/components/TextOnPathText.tsx` (props at lines 22–64; layout at lines 120–144; sceneFunc offset at line 263; alternate targets at line 180)
- Modify: `src/lib/blockRenderProps.ts` (`textPathProps` at line 96)
- Modify: `src/components/CanvasStage.tsx`:
  - render map at line 813: guides are drawn after all other blocks;
  - textPath branch at line 959;
  - new props.
- Modify: `src/components/MirrorBlockView.tsx` (the textPath branch passes the source's guide props through)
- Test: `src/lib/blockRenderProps.test.ts` (append)

**Interfaces:**
- Consumes Tasks 1–3.
- Produces these new `TextOnPathText` props:
  - `guidePath?: { d: string; closed: boolean }`
  - `guideAttachment?: GuideAttachment`
  - `onGuideLayout?: (info: { shrink: number }) => void`
- `textPathProps(b)` gains `guideAttachment: b.guide`. The guide *path* is resolved by the caller, because blockRenderProps has no `blocks` to look it up in.
- Produces a new `CanvasStage` prop: `onGuideLayout?: (blockId: number, shrink: number) => void`.
- Produces `export function resolveGuidePath(blocks: readonly Block[], b: TextPathBlock): { d: string; closed: boolean; x: number; y: number; rotation: number } | null` in `src/lib/guides.ts`, appended there.

- [ ] **Step 1: Write the failing test.** Append to `src/lib/blockRenderProps.test.ts`:

```ts
import { resolveGuidePath } from "./guides";

describe("guide-attached Curve props", () => {
  it("carries the attachment so a mirror of attached text follows it", () => {
    const b = {
      id: 2, type: "textPath", text: "بسم", x: 0, y: 0, fontSize: 40, color: "#000",
      fontFamily: "Amiri", stroke: "#000", shadowColor: "#000", textPathD: "M 0 0 L 1 0",
      guide: { id: 1, offset: 0.3, align: "center", side: "inside", flip: true, gap: 0.2 },
    } as const;
    expect(textPathProps(b as never).guideAttachment).toEqual(b.guide);
  });

  it("resolves a guide's path and placement, or null when it is gone", () => {
    const guide = {
      id: 1, type: "guide", guideShape: "circle", guideD: "M 0 -10 C 5 -10, 10 -5, 10 0 Z",
      text: "", x: 5, y: 6, rotation: 30, fontSize: 1, color: "#000", fontFamily: "Amiri",
      stroke: "#000", shadowColor: "#000",
    };
    const t = { id: 2, type: "textPath", guide: { id: 1 } };
    expect(resolveGuidePath([guide as never], t as never)).toMatchObject({ d: guide.guideD, closed: true, x: 5, y: 6, rotation: 30 });
    expect(resolveGuidePath([], t as never)).toBeNull();
  });
});
```

  (`textPathProps` is presumably already imported at the top of that file. Add it to the import if not.)

- [ ] **Step 2: Run the test and confirm it fails.**
  Run: `npx vitest run src/lib/blockRenderProps.test.ts`
  Expected: FAIL. `resolveGuidePath` isn't exported, and `guideAttachment` is `undefined`.

- [ ] **Step 3: Implement it.**

  **3a.** Append `resolveGuidePath` to `src/lib/guides.ts`, and import `parseSvgPath` and `isClosedPath`:

```ts
import { parseSvgPath } from "./svgPath";
import { isClosedPath } from "./guideShapes";

/** The guide an attached text draws on, in the form its renderer needs; null when gone. */
export function resolveGuidePath(
  blocks: readonly Block[],
  b: TextPathBlock
): { d: string; closed: boolean; x: number; y: number; rotation: number } | null {
  if (!b.guide) return null;
  const g = blocks.find((x): x is GuideBlock => x.type === "guide" && x.id === b.guide!.id);
  if (!g) return null;
  return { d: g.guideD, closed: isClosedPath(parseSvgPath(g.guideD)), x: g.x, y: g.y, rotation: g.rotation ?? 0 };
}
```

  **3b.** In `blockRenderProps.ts`, add `guideAttachment: b.guide,` to `textPathProps`'s return.

  **3c.** Create `src/components/GuideView.tsx`:

```tsx
import { Group, Path } from "react-konva";
import type Konva from "konva";
import { EXPORT_HIDDEN } from "../lib/exportChrome";

/**
 * A guide: a dashed construction line. Named EXPORT_HIDDEN so every export
 * path skips it; a wide transparent hit stroke makes a 1px line clickable.
 */
export const GuideView: React.FC<{
  id: string;
  x: number;
  y: number;
  rotation?: number;
  d: string;
  stageScale: number;
  selected: boolean;
  draggable: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
}> = ({ id, x, y, rotation = 0, d, stageScale, selected, ...handlers }) => (
  <Group id={id} name={EXPORT_HIDDEN} x={x} y={y} rotation={rotation} {...handlers}>
    <Path
      data={d}
      stroke={selected ? "#d4af37" : "#00b4d8"}
      strokeWidth={(selected ? 2 : 1) / stageScale}
      dash={[6 / stageScale, 4 / stageScale]}
      hitStrokeWidth={14 / stageScale}
      opacity={0.85}
    />
  </Group>
);

export default GuideView;
```

  **3d.** `TextOnPathText.tsx`:
  1. Add the three props to the props type and the destructuring.
  2. Replace the curve source and layout with this:

```ts
  // Attached to a guide: the guide's path, walked flipped or not, with the
  // natural-size placement. Otherwise the block's own curve, stretched to fit.
  const curveD = guidePath?.d ?? textPathD;
  const parsedCmds = useMemo(() => parseSvgPath(curveD || ""), [curveD]);
  const curveLen = useMemo(() => pathLength(parsedCmds), [parsedCmds]);
  const walkReversed = guideAttachment ? guideAttachment.flip : !textPathReversed;
  const arcTable = useMemo(() => buildArcTable(parsedCmds, walkReversed), [parsedCmds, walkReversed]);
  const curveBox = useMemo(() => pathBoundingBox(parsedCmds), [parsedCmds]);

  const layout = useMemo(() => {
    if (!hbLoaded || !font || parsedCmds.length < 2) return null;
    if (guideAttachment && guidePath) {
      return guideGlyphPlacements({
        glyphs, fontSize, unitsPerEm, ascender: font.ascender, arcTable,
        closed: guidePath.closed, attachment: guideAttachment,
      });
    }
    const fit = curveGlyphPlacements({ glyphs, fontSize, unitsPerEm, curveLen, arcTable });
    return fit ? { placements: fit.placements, baselineOffset: textPathBaselineOffset, shrink: 1 } : null;
  }, [hbLoaded, font, parsedCmds.length, glyphs, fontSize, unitsPerEm, curveLen, arcTable, guideAttachment, guidePath, textPathBaselineOffset]);
  const baselineOffset = layout?.baselineOffset ?? textPathBaselineOffset;

  useEffect(() => {
    if (guideAttachment && layout) onGuideLayout?.({ shrink: layout.shrink });
  }, [guideAttachment, layout, onGuideLayout]);
```

  3. Replace both uses of `textPathBaselineOffset` that follow (the alternate-target polygon at line ~180 and its dependency list, and `c2d.translate(0, textPathBaselineOffset)` in sceneFunc) with `baselineOffset`.
  4. Import `useEffect`, `guideGlyphPlacements` and `GuideAttachment`.
  5. The hit rect pad uses `fontSize`. That stays correct, because attached text is drawn at no more than its `fontSize`.

  **3e.** `CanvasStage.tsx`:
  1. Import `GuideView` and `resolveGuidePath`.
  2. Add the props `onGuideLayout?: (blockId: number, shrink: number) => void` and `onUpdateGuideD?: (id: number, d: string) => void`.
  3. Change the render map so guides draw last. Wrap the existing `blocks.map((block) => { ... })` as `[...blocks.filter((b) => b.type !== "guide"), ...blocks.filter((b) => b.type === "guide")].map((block) => { ... })`.
  4. Add a guide branch before the fallback `return null`:

```tsx
              if (block.type === "guide") {
                return (
                  <React.Fragment key={block.id}>
                    <GuideView
                      {...commonProps}
                      x={block.x}
                      y={block.y}
                      rotation={block.rotation ?? 0}
                      d={block.guideD}
                      stageScale={stageScale}
                      selected={block.id === selectedId}
                    />
                    {block.guideShape === "pen" && block.guideEditMode && block.id === selectedId && onUpdateGuideD && (
                      <TextPathEditOverlay
                        id={`text-path-edit-layer-${block.id}`}
                        x={block.x}
                        y={block.y}
                        rotation={block.rotation ?? 0}
                        textPathD={block.guideD}
                        onBeginChange={onBeginTextPathEdit}
                        onChange={(d) => onUpdateGuideD(block.id, d)}
                      />
                    )}
                  </React.Fragment>
                );
              }
```

  5. In the textPath branch, resolve the guide and override the position:

```tsx
              const guidePlace = block.guide ? resolveGuidePath(blocks, block) : null;
```

     Pass these props to `TextOnPathText`:
     - `guidePath={guidePlace ? { d: guidePlace.d, closed: guidePlace.closed } : undefined}`
     - `x={guidePlace?.x ?? block.x}`
     - `y={guidePlace?.y ?? block.y}`
     - `rotation={guidePlace?.rotation ?? block.rotation ?? 0}`
     - `onGuideLayout={onGuideLayout ? (info) => onGuideLayout(block.id, info.shrink) : undefined}`

     Put the `x`/`y`/`rotation` overrides **after** the spreads, so they win.

     Leave the drag wiring alone in this task. Task 6 replaces it for attached text.

  **3f.** `MirrorBlockView.tsx`: in the textPath source branch, pass `guidePath` resolved from the blocks list, if the component has access to it. If it doesn't, add an optional `guidePath` prop and have CanvasStage's mirror branch pass `resolveGuidePath(blocks, source)` when the source is an attached `textPath`. A mirror is drawn at its own position, so don't override its x/y.

- [ ] **Step 4: Run the full static loop.**
  Run: `npx vitest run src/lib/blockRenderProps.test.ts && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
  Expected: everything passes.

- [ ] **Step 5: Commit.**

```bash
git add src/components/GuideView.tsx src/components/TextOnPathText.tsx src/components/CanvasStage.tsx src/components/MirrorBlockView.tsx src/lib/blockRenderProps.ts src/lib/blockRenderProps.test.ts src/lib/guides.ts
git commit -m "Guides: draw guides, and Curve text in natural-size guide mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 5: Making the rest of the app guide-aware

**Files:**
- Modify: `src/hooks/useExport.ts` (line 86)
- Modify: `src/components/sidebar/LayersPanel.tsx` (lines 21–28 for the icon, line 136 for the label, line 71 for the rename default)
- Modify: `src/components/Sidebar.tsx`:
  - Content gate (line 2198);
  - Typography gate (line 2852);
  - Effects gate (line 3511).
- Modify: `src/App.tsx`:
  - the font-missing filter (line ~3009);
  - `selectedFontUnavailable` (line ~3034);
  - the restyle at line ~1125.
- Modify: `src/lib/blockCapabilities.ts`. No change is needed if every guard lists types explicitly. Verify this and leave the file alone.

**Interfaces:**
- Produces `export function exportableBlocks(blocks: readonly Block[]): Block[]` in `src/lib/guides.ts`, which returns the non-guide blocks.

- [ ] **Step 1: Write the failing test.** Append to `src/lib/guides.test.ts`:

```ts
import { exportableBlocks } from "./guides";

describe("exportableBlocks", () => {
  it("leaves guides out of the export crop", () => {
    expect(exportableBlocks([guide, onGuide(2)]).map((b) => b.id)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**
  Run: `npx vitest run src/lib/guides.test.ts`
  Expected: FAIL, because `exportableBlocks` is not a function.

- [ ] **Step 3: Implement it.**
  1. Add `exportableBlocks` to `guides.ts`: `blocks.filter((b) => b.type !== "guide")`.
  2. In `useExport.ts`, make it `getBlocksBoundingBoxShared(stage, exportableBlocks(blocks))`.
  3. In `LayersPanel.tsx`:
     - **Icon:** a guide gets `"◯"`.
     - **Label:** `block.name ?? (block.type === "guide" ? `Guide · ${GUIDE_SHAPE_LABELS[block.guideShape]}` : `Block ${block.id}`)`. Apply the same rule to the rename default.
  4. In `Sidebar.tsx`, add `&& selectedBlock.type !== "guide"` to the Content, Typography and Effects gates. Transform stays, because rotation is how a line guide is angled.
  5. In `App.tsx`:
     - add `&& b.type !== "guide"` to the font-missing filter and to `selectedFontUnavailable`;
     - make line ~1125 skip guides as it skips images: `b.type === "image" || b.type === "guide" ? b : ...`.
  6. Read `blockCapabilities.ts`. Every guard is a positive list (`b.type === ...`), so `guide` is excluded automatically. Make no change.

- [ ] **Step 4: Run the full static loop.**
  Run: `npx vitest run src/lib/guides.test.ts && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
  Expected: everything passes.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/guides.ts src/lib/guides.test.ts src/hooks/useExport.ts src/components/sidebar/LayersPanel.tsx src/components/Sidebar.tsx src/App.tsx
git commit -m "Guides: excluded from export crop, labelled in Layers, hidden from text panels" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 6: App handlers and sliding along a guide

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/CanvasStage.tsx` (the drag wiring for attached text)

**Interfaces:**
- Consumes:
  - `guidePathD` and `GUIDE_DEFAULTS` (Task 1);
  - `projectToGuide` (Task 2);
  - `guides.ts` (Tasks 3 and 4).
- Produces these App handlers, passed as Sidebar props:
  - `onAddGuide(shape: GuideShape)`
  - `onUpdateGuideParams(params: GuideParams)`, which acts on the selected guide; one `pushHistory` per call is acceptable, because RangeRows already debounce through `updateSelectedBlock`'s pattern
  - `onAddTextToGuide()`
  - `onAttachToGuide(guideId: number)`
  - `onDetachFromGuide()`
  - `onUpdateGuideAttachment(patch: Partial<GuideAttachment>)`
  - `guideShrink: ReadonlyMap<number, number>`
- Produces these CanvasStage props:
  - `onSlideAlongGuide(blockId: number, offset: number)`
  - `onGuideLayout`
  - `onUpdateGuideD`

There is no unit test, because these are App and Konva wiring. Task 7's e2e covers them. The gate for this task is the static loop plus manual sanity in Task 7.

- [ ] **Step 1: Add the App handlers.** Place them after `addTextPathBlock` (line ~1851):

```ts
  // Guides: dashed construction paths that Curve text can attach to. See .claude/rules/guides.md.
  const addGuideBlock = (shape: GuideShape) => {
    const newId = createNextId();
    const params = GUIDE_DEFAULTS[shape];
    const w = params.width ?? 300;
    const h = params.height ?? params.width ?? 300;
    beginPlacement(
      {
        ...DEFAULT_BLOCK,
        id: newId,
        text: "",
        type: "guide",
        guideShape: shape,
        guideParams: params,
        guideD: guidePathD(shape, params),
        guideEditMode: shape === "pen",
        x: 0,
        y: 0,
      } as Block,
      w,
      h,
      0,
      0,
      "New Guide"
    );
  };

  const updateGuideParams = (params: GuideParams) => {
    if (selectedBlock?.type !== "guide" || selectedBlock.guideShape === "pen") return;
    const next = { ...selectedBlock.guideParams, ...params };
    updateSelectedBlock({ guideParams: next, guideD: guidePathD(selectedBlock.guideShape, next) } as Partial<Block>);
  };

  const updateGuideD = (id: number, d: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === id && b.type === "guide" ? { ...b, guideD: d } : b)));
  };

  const addTextToGuide = () => {
    if (selectedBlock?.type !== "guide") return;
    const guide = selectedBlock;
    const style = blocks.find((b) => b.type === "text");
    const id = createNextId();
    pushHistory();
    setBlocks((prev) => [
      ...prev,
      newAttachedText(id, guide, style ? styleToPatch(captureStyle(style, "guide")) : {}),
    ]);
    setSelectedIds([]);
    setSelectedId(id);
  };

  const attachSelectedToGuide = (guideId: number) => {
    if (selectedBlock?.type !== "text") return;
    const guide = blocks.find((b): b is GuideBlock => b.type === "guide" && b.id === guideId);
    if (!guide) return;
    const { block, dropped } = attachTextToGuide(selectedBlock, guide);
    pushHistory();
    setBlocks((prev) => prev.map((b) => (b.id === block.id ? block : b)));
    setExportStatus(
      dropped.length ? `Attached to the guide. Dropped: ${dropped.join(", ")}.` : "Attached to the guide."
    );
  };

  const detachSelectedFromGuide = () => {
    if (selectedBlock?.type !== "textPath" || !selectedBlock.guide) return;
    const guide = blocks.find((b): b is GuideBlock => b.type === "guide" && b.id === selectedBlock.guide!.id);
    if (!guide) return;
    updateBlockReplacing(selectedBlock.id, detachFromGuide(selectedBlock, guide));
  };

  const updateGuideAttachment = (patch: Partial<GuideAttachment>) => {
    if (selectedBlock?.type !== "textPath" || !selectedBlock.guide) return;
    updateSelectedBlock({ guide: { ...selectedBlock.guide, ...patch } } as Partial<Block>);
  };

  const slideAlongGuide = (id: number, offset: number) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id && b.type === "textPath" && b.guide ? { ...b, guide: { ...b.guide, offset } } : b))
    );
    scheduleMoveHistoryPush();
  };

  // Not saved, not undoable: what the renderer measured, for the panel's note.
  const [guideShrink, setGuideShrink] = useState<ReadonlyMap<number, number>>(new Map());
  const reportGuideLayout = useCallback((id: number, shrink: number) => {
    setGuideShrink((prev) => (prev.get(id) === shrink ? prev : new Map(prev).set(id, shrink)));
  }, []);
```

  - `updateBlockReplacing(id, block)` replaces a whole block, which is needed because `detach` *removes* the `guide` key. A spread patch can't remove a key. Implement it as `pushHistory(); setBlocks((prev) => prev.map((b) => (b.id === id ? block : b)));`, defined just above.
  - `scheduleMoveHistoryPush` must be declared above this code. It is at line ~640, which is fine.

- [ ] **Step 2: Wire delete and orphans.**
  1. In `deleteSelectedBlock` (line ~986), replace:

```ts
setBlocks((prev) => dissolveSingletonGroups(prev.filter((b) => !idsToDelete.has(b.id))));
```

     with:

```ts
setBlocks((prev) => dissolveSingletonGroups(deleteBlocksDetachingGuides(prev, idsToDelete)));
```

  2. Next to the mirror orphan effect (line ~2318), add:

```ts
  // An attached text whose guide vanished outside delete (a load, an old
  // save) becomes a plain Curve block. Like the mirror pass: no history.
  useEffect(() => {
    if (!hasOrphanedAttachments(blocks)) return;
    setBlocks(dropOrphanedAttachments(blocks));
  }, [blocks]);
```

  3. In `applyParsedLayoutPayload` (line ~1537), after `dropOrphanedMirrors`, also apply `dropOrphanedAttachments`.

- [ ] **Step 3: Slide along the guide in CanvasStage.**
  1. Add the prop `onSlideAlongGuide?: (blockId: number, offset: number) => void`.
  2. In the textPath branch, when `guidePlace` is non-null, replace `commonProps`' drag handlers with a handler that slides. It projects the pointer into guide-local space, keeps the grab delta from the first frame, and pins the node to the guide's origin:

```tsx
              const slideRef = slideGrabRef; // useRef<{ id: number; delta: number } | null>(null), declared at component top
              const slide = guidePlace && onSlideAlongGuide && block.guide
                ? (e: Konva.KonvaEventObject<DragEvent>, end: boolean) => {
                    const node = e.target;
                    const parent = node.getParent();
                    const p = parent?.getRelativePointerPosition();
                    node.position({ x: guidePlace.x, y: guidePlace.y });
                    if (!p) return;
                    const r = (-guidePlace.rotation * Math.PI) / 180;
                    const dx = p.x - guidePlace.x;
                    const dy = p.y - guidePlace.y;
                    const local = { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
                    const table = guideArcTable(guidePlace.d); // memoised helper, see below
                    const projected = projectToGuide(table, local);
                    if (!slideRef.current || slideRef.current.id !== block.id) {
                      slideRef.current = { id: block.id, delta: projected - block.guide!.offset };
                    }
                    let offset = projected - slideRef.current.delta;
                    offset = guidePlace.closed ? ((offset % 1) + 1) % 1 : Math.min(Math.max(offset, 0), 1);
                    onSlideAlongGuide(block.id, offset);
                    if (end) slideRef.current = null;
                  }
                : null;
```

  3. Pass `onDragMove={slide ? (e) => slide(e, false) : commonProps.onDragMove}` and `onDragEnd={slide ? (e) => slide(e, true) : commonProps.onDragEnd}` **after** the `commonProps` spread. A slide bypasses snapping and grid snap entirely.
  4. Keep `draggable` as `!block.locked && !effectivePanMode`. The text's own lock governs, never the guide's.
  5. `guideArcTable(d)` is a module-level helper with a small `Map<string, ArcTable>` cache, keyed by `d`: `buildArcTable(parseSvgPath(d), false)`. Clear the cache when it passes 64 entries.

- [ ] **Step 4: Pass the new props** from App to CanvasStage and Sidebar:
  - CanvasStage:
    - `onSlideAlongGuide={slideAlongGuide}`
    - `onGuideLayout={reportGuideLayout}`
    - `onUpdateGuideD={updateGuideD}`
  - Sidebar:
    - `onAddGuide={addGuideBlock}`
    - `onUpdateGuideParams={updateGuideParams}`
    - `onAddTextToGuide={addTextToGuide}`
    - `onAttachToGuide={attachSelectedToGuide}`
    - `onDetachFromGuide={detachSelectedFromGuide}`
    - `onUpdateGuideAttachment={updateGuideAttachment}`
    - `guideShrink={guideShrink}`

  Declare the Sidebar prop types in `SidebarProps` now, so this task typechecks. Do the destructuring in Task 7.

- [ ] **Step 5: Run the static loop and commit.**
  Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
  Expected: everything passes.

```bash
git add src/App.tsx src/components/CanvasStage.tsx src/components/Sidebar.tsx
git commit -m "Guides: add, reshape, attach, detach, delete-with-detach and slide along" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 7: Sidebar UI and e2e

**Files:**
- Create: `src/components/GuideDialog.tsx` (the shape picker, plus the `AddGuideButton`)
- Create: `src/components/sidebar/GuidePanel.tsx`
- Create: `src/components/sidebar/GuideAttachmentPanel.tsx`
- Modify: `src/components/Sidebar.tsx`:
  - the Add grid (after the curved-text button at line ~1858);
  - a Guide type panel under Content;
  - an On guide section inside the Curve panel (line ~2774), hiding the Curve-only rows;
  - the font size row for attached text (line ~3206);
  - Attach to guide… in Content.
- Create: `e2e/guides.spec.ts`

**Interfaces:**
- Consumes the Task 6 props.
- Produces these accessible names:
  - the **"Add guide"** button;
  - in the dialog: **"Circle guide"**, **"Ellipse guide"**, **"Arc guide"**, **"Wave guide"**, **"Line guide"**, **"Pen guide"**;
  - the panel titled **"Guide"**;
  - the **"Add text to guide"** button;
  - the **"Attach to guide"** select;
  - **"Position along guide"** (a range);
  - the **"Detach from guide"** button;
  - the **"Flip"** checkbox.

- [ ] **Step 1: Write the e2e spec first.** Create `e2e/guides.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { blockClientBox, centerOf, dragMouse, getBlocks, gotoApp, placeAtCanvas, settleFrames } from "./harf";
import type { GuideBlock, TextPathBlock } from "../src/types";

/**
 * A guide is a construction line: texts attached to it keep their size,
 * follow it, slide along it, and outlive it. What only a browser shows is
 * that they really draw there, follow a drag, and that exports skip the guide.
 */

const guides = async (page: Page) => (await getBlocks(page)).filter((b): b is GuideBlock => b.type === "guide");
const attached = async (page: Page) =>
  (await getBlocks(page)).filter((b): b is TextPathBlock => b.type === "textPath" && !!b.guide);

async function addCircleWithTwoTexts(page: Page) {
  await gotoApp(page);
  await page.getByRole("button", { name: "Add guide" }).click();
  await page.getByRole("button", { name: "Circle guide" }).click();
  await placeAtCanvas(page, 0.5, 0.5);
  await expect.poll(async () => (await guides(page)).length).toBe(1);
  await page.getByRole("button", { name: "Add text to guide" }).click();
  await expect.poll(async () => (await attached(page)).length).toBe(1);
  // Re-select the guide (via Layers) and add a second text.
  const g = (await guides(page))[0];
  await page.getByText(`Guide · Circle`).first().click();
  await expect.poll(async () => (await getBlocks(page)).find((b) => b.id === g.id) !== undefined).toBe(true);
  await page.getByRole("button", { name: "Add text to guide" }).click();
  await expect.poll(async () => (await attached(page)).length).toBe(2);
  await settleFrames(page);
}

test("texts attached to a guide follow the guide when it is dragged", async ({ page }) => {
  await addCircleWithTwoTexts(page);
  const [t1] = await attached(page);
  const before = await blockClientBox(page, t1.id);
  const g = (await guides(page))[0];
  // Grab the guide's line at its right-hand point (a quarter of the way round).
  const gBox = await blockClientBox(page, g.id);
  const grab = { x: gBox.x + gBox.width - 2, y: gBox.y + gBox.height / 2 };
  await dragMouse(page, grab, { x: grab.x + 80, y: grab.y + 40 });
  await settleFrames(page);
  const after = await blockClientBox(page, t1.id);
  expect(after.x - before.x).toBeGreaterThan(40);
  expect(after.y - before.y).toBeGreaterThan(15);
});

test("dragging an attached text slides it along the guide, one undo restores it", async ({ page }) => {
  await addCircleWithTwoTexts(page);
  const [t1] = await attached(page);
  const box = await blockClientBox(page, t1.id);
  const from = centerOf(box);
  await dragMouse(page, from, { x: from.x + 120, y: from.y + 120 });
  await expect.poll(async () => (await attached(page)).find((b) => b.id === t1.id)!.guide!.offset).not.toBe(t1.guide!.offset);
  const moved = (await getBlocks(page)).find((b) => b.id === t1.id)!;
  expect([moved.x, moved.y]).toEqual([t1.x, t1.y]);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await attached(page)).find((b) => b.id === t1.id)!.guide!.offset).toBe(t1.guide!.offset);
});

test("deleting the guide leaves its texts as plain Curve blocks; undo re-attaches", async ({ page }) => {
  await addCircleWithTwoTexts(page);
  await page.getByText(`Guide · Circle`).first().click();
  await page.getByRole("button", { name: "Delete block" }).click();
  await expect.poll(async () => (await guides(page)).length).toBe(0);
  const curves = (await getBlocks(page)).filter((b): b is TextPathBlock => b.type === "textPath");
  expect(curves).toHaveLength(2);
  expect(curves.every((c) => !c.guide)).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await attached(page)).length).toBe(2);
  await expect.poll(async () => (await guides(page)).length).toBe(1);
});

test("a plain text block can be attached to a guide", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Add guide" }).click();
  await page.getByRole("button", { name: "Line guide" }).click();
  await placeAtCanvas(page, 0.5, 0.7);
  await expect.poll(async () => (await guides(page)).length).toBe(1);
  const starter = (await getBlocks(page)).find((b) => b.type === "text")!;
  await page.getByText(`Block ${starter.id}`).first().click();
  await page.getByLabel("Attach to guide").selectOption({ label: "Guide · Line" });
  await expect.poll(async () => (await attached(page)).map((b) => b.id)).toEqual([starter.id]);
});

test("exports leave the guide out", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Add guide" }).click();
  await page.getByRole("button", { name: "Circle guide" }).click();
  await placeAtCanvas(page, 0.5, 0.5);
  await expect.poll(async () => (await guides(page)).length).toBe(1);
  const hiddenOnExport = await page.evaluate(() => {
    const stage = window.__HARF__!.getStage();
    const g = stage.findOne(".export-hidden") as { id?: () => string } | undefined;
    return !!stage.find(".export-hidden").find((n: { id: () => string }) => n.id().startsWith("block-"));
    void g;
  });
  expect(hiddenOnExport).toBe(true);
});
```

  Adjust the selectors to the real accessible names:
  - Layers rows may be buttons, so use `getByRole("button", { name: /Guide · Circle/ })` if `getByText` is ambiguous.
  - The delete button's `aria-label`: confirm with `grep -n 'aria-label="Delete' src/components/Sidebar.tsx`.

  The export test asserts the guide's node carries `EXPORT_HIDDEN`, which is the mechanism every export path filters by. That's coarse but robust, per the e2e rule file's guidance against exact-image checks.

- [ ] **Step 2: Run the spec and confirm it fails.**
  Run: `npx playwright test e2e/guides.spec.ts --reporter=line`
  Expected: FAIL, because there's no "Add guide" button.

- [ ] **Step 3: Build the UI.**

  **3a.** `src/components/GuideDialog.tsx`:
  - Reuse VerseDialog's portal pattern and classes: `confirmDialogOverlay`, `nameDesignDialog`, `nameDesignHeader`, `nameDesignTitle`, `nameDesignActions`.
  - The dialog is titled "Add guide".
  - It holds six buttons in a 3-column grid, `aria-label={`${GUIDE_SHAPE_LABELS[s]} guide`}`, each with a small inline SVG preview of `guidePathD(s)` (viewBox computed from `pathBoundingBox`).
  - Clicking one calls `onPick(s)` and then closes the dialog.
  - Also export `AddGuideButton({ onAdd })`. It's a `sidebarCircleButton`, `aria-label="Add guide"`, with a dashed-circle 15px icon, and it opens the dialog.

  **3b.** In the `Add` grid in `Sidebar.tsx`, right after the curved-text button: `{onAddGuide && <AddGuideButton onAdd={onAddGuide} />}`. Wrap it in `DemoHover` only if a demo exists; there is none, so use a plain `title="Add a guide shape…"`.

  **3c.** `src/components/sidebar/GuidePanel.tsx` takes `{ guide: GuideBlock; texts: TextPathBlock[]; onParams; onAddText; onSelect; onToggleEdit }`:
  - It shows RangeRows (from `FormControls`) per shape:
    - circle: "Diameter" (40–1200) → `width`;
    - ellipse: "Width" and "Height";
    - arc: "Diameter" and "Sweep" (10–350°);
    - wave: "Width" and "Amplitude" (0–200);
    - line: "Length" (40–1600);
    - pen: an "Edit points" pill toggling `guideEditMode`, through `onUpdateSelectedBlock`.
  - Then a `sidebarSectionButton`, "Add text to guide".
  - Then the list of attached texts. Each is a `sidebarSmallAction` button showing the first 24 characters of its text, and `onSelect(id)` calls `onSelectBlock`.

  **3d.** `src/components/sidebar/GuideAttachmentPanel.tsx` takes `{ attachment; shrink?: number; onChange(patch); onDetach }`:
  - "Position along guide": a RangeRow, 0–100, step 0.5, onto `offset × 100`.
  - Align: a three-pill row of Start, Centre and End.
  - Side: a two-pill row of Outside and Inside.
  - A "Flip" checkbox (`CheckboxRow`).
  - "Gap": a RangeRow, 0–1, step 0.01.
  - When `shrink < 0.999`: a `nameDesignHint` reading `Shrunk to ${Math.round(shrink*100)}% to fit the guide.`
  - A "Detach from guide" `sidebarSectionButton`.

  **3e.** `Sidebar.tsx` wiring:
  - **Guide type panel.** Directly under the Content panel block, add `{selectedBlock?.type === "guide" && (<div className="sidebarPanel"><CollapsibleSection title="Guide" ...><GuidePanel .../></CollapsibleSection></div>)}`. Content is already hidden for guides by Task 5, so this is the first panel in the selected tier for a guide.
  - **Curve panel** (line ~2774). When `selectedBlock.guide` is set:
    - render `GuideAttachmentPanel` at the top of the section;
    - hide the Edit Curve toggle, the preset select, Upload SVG, Flip direction, and Baseline offset by wrapping them in `{!selectedBlock.guide && (<>…</>)}`.
  - **Typography font size** (line ~3206): change the condition to `selectedBlock.type === "textPath" && !selectedBlock.guide ? <letter-size note> : <Font size RangeRow>`.
  - **Content panel:** for `selectedBlock.type === "text"`, when `guides.length > 0` (computed from `blocks`), add a `SelectRow` labelled "Attach to guide". Give it a placeholder option "Choose a guide…" (value ""), plus one option per guide with the label `Guide · ${GUIDE_SHAPE_LABELS[g.guideShape]}` and the value `g.id`. On change to a non-empty value, call `onAttachToGuide(Number(v))`. `SelectRow` must render a `<select>` with an accessible label. Check `FormControls.tsx` to confirm it does.

- [ ] **Step 4: Run e2e until it passes, then the whole loop.**
  Run:
  ```
  npx tsc --noEmit -p e2e/tsconfig.json
  npx playwright test e2e/guides.spec.ts --reporter=line
  ```
  Expected: 5 passed. Fix real bugs in Tasks 4–6 rather than loosening the assertions.

  Then run:
  ```
  npx tsc --noEmit -p tsconfig.app.json
  npm run lint
  npm test
  npm run build
  npm run e2e
  ```
  Expected: everything passes.

- [ ] **Step 5: Commit.**

```bash
git add src/components/GuideDialog.tsx src/components/sidebar/GuidePanel.tsx src/components/sidebar/GuideAttachmentPanel.tsx src/components/Sidebar.tsx e2e/guides.spec.ts
git commit -m "Guides: Add guide picker, Guide and On-guide panels, Attach to guide, e2e" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```

---

### Task 8: Docs, guide page, spec sync

**Files:**
- Create: `.claude/rules/guides.md`
- Create: `src/components/guide/sections/guides.tsx` (order 38; copy `verse.tsx`'s export shape)
- Modify: `CLAUDE.md`:
  - one index line after "Multi-line verse";
  - add `GuideBlock` to the Block union paragraph and the renderer list (`GuideView`).
- Modify: `.claude/rules/text-on-path.md` (a paragraph on guide mode)
- Modify: `.claude/rules/sidebar.md` (the Add grid now holds 9 buttons and wraps to a third row; the Guide type panel)
- Modify: `PROGRESS.md` (a new top entry under Shipped)
- Modify: `docs/superpowers/specs/2026-10-13-shaped-guides-design.md` (Decisions 1–9 from this plan; Status → implemented)

- [ ] **Step 1: Write `.claude/rules/guides.md`.**

```markdown
---
paths:
  - "src/lib/guide*.ts"
  - "src/components/GuideView.tsx"
  - "src/components/GuideDialog.tsx"
  - "src/components/sidebar/Guide*.tsx"
  - "e2e/guides.spec.ts"
---

# Shaped guides

A `guide` block is a dashed construction path (`guideD`, centred on its
origin), named `EXPORT_HIDDEN` so no export draws it and filtered out of the
freeform crop by `exportableBlocks`. A `textPath` block with `guide` set is
*attached*: CanvasStage resolves the guide each render (`resolveGuidePath`)
and `TextOnPathText` lays the text out with `guideGlyphPlacements` —
natural size, shrink only to fit, at `offset` along the guide — instead of
stretching it along its own `textPathD`.

- **Shapes:** `guidePathD` (pure). Closed shapes run clockwise from the top
  centre; offset 0 is the top. Line angle is the block's rotation.
- **Flip** walks the guide reversed; `offset` is always stored un-flipped so a
  flip never moves the text's anchor. **Side**: hang = inside XOR flip.
- **Baseline-offset sign:** positive moves glyphs *down* in the glyph frame
  (the renderer translates after rotating).
- **Sliding:** the attached text's drag handlers are replaced; the node is
  pinned to the guide origin and the pointer projected (`projectToGuide`) with
  the first frame's grab delta kept. No snapping. History via
  `scheduleMoveHistoryPush`, like any drag. The text's own lock governs.
- **Deleting a guide** detaches its surviving texts in the same step
  (`deleteBlocksDetachingGuides`); they keep the guide's path, place, flip and
  an approximate side offset (`DETACH_ASCENT`) as a plain Curve block, which
  then stretches to its curve as Curve blocks do. An attachment orphaned any
  other way is dropped by an effect without history, like mirrors.
- **Traps:** guides are never mirror sources (`isMirrorSourceCandidate`). A
  pasted attached text stays attached at the same offset. `guideShrink` in
  App is renderer feedback for the panel note — never saved, never undone.
- **Not supported:** straight blocks snapping onto a guide, text continuing
  across guides, SVG-upload guides, per-letter drag tools on attached text.
```

- [ ] **Step 2: Write the CLAUDE.md line, the text-on-path paragraph, the sidebar note, the PROGRESS entry and the guide page.**
  - **CLAUDE.md:**

```markdown
- **Shaped guides** — [`.claude/rules/guides.md`](.claude/rules/guides.md). A `guide` block is an export-hidden path; Curve text with `guide` set keeps its own size at an offset along it. Offset stored un-flipped; hang = inside XOR flip; deleting a guide detaches its texts in the same undo step.
```

  - **Guide page:** written for calligraphers. It covers:
    - adding a guide with **Add guide**;
    - **Add text to guide** and **Attach to guide**;
    - dragging text along the guide;
    - Position, Start/Centre/End, Outside/Inside, Flip and Gap;
    - that a guide never prints;
    - that deleting a guide keeps its words on the same shape.

    Keywords: guide, circle, ellipse, arc, wave, line, pen, roundel, medallion, seal, around, دائرة, ختم, attach.
  - **PROGRESS entry:** two or three lines and a pointer to `guides.md`.

- [ ] **Step 3: Sync the spec** with Decisions 1–9, and set `Status: implemented`.

- [ ] **Step 4: Run the loop and commit.**
  Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
  Expected: everything passes.

```bash
git add .claude/rules/guides.md .claude/rules/text-on-path.md .claude/rules/sidebar.md CLAUDE.md PROGRESS.md src/components/guide/sections/guides.tsx docs/superpowers/specs/2026-10-13-shaped-guides-design.md
git commit -m "Guides: docs, guide page and spec sync" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019W6oDz6TEQXoXk9fKSzfEc"
```
