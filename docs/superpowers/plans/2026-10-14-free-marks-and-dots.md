# Free Marks and Dots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tashkeel move sideways as well as up and down, and a letter's dots, hamza and kaf stroke become freely movable on live text and Shape Fill blocks, surviving conversion to a stacked composition as their own pieces.

**Architecture:** Tashkeel gain an `offsetX` on the existing `DiacriticOverride`. Dots and other detached marks are found by a pure topological detector (`src/lib/detachedMarks.ts`: a contour outside every other contour, not the body, small relative to it), scored offline against Unicode dot counts before any canvas work, stored as `DetachedMarkOverride` keyed by cluster plus glyph-id checksum plus raw contour index, applied as a contour translation inside the glyph path before warp, and split into rider pieces at stack convert. A new hover overlay with one move handle mounts between the stroke-cut and tashkeel overlays.

**Tech Stack:** React 19, TypeScript, Konva/react-konva, HarfBuzz via harfbuzzjs (WASM), opentype.js, Vitest, Playwright, tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-10-14-free-marks-and-dots-design.md`

## Global Constraints

- `src/lib/detachedMarks.ts` must never import `./harfbuzz` (static harfbuzzjs import throws under Vitest's Node loader). Import types only from `./normalizeGlyphs`.
- Every test that needs shaped glyphs uses real fonts from `public/fonts/` through the `shapeReal` helper copied from `src/lib/diacritics.test.ts`. No hand-written `{ g, cl }` fixtures.
- Dots and detached marks are translate only: no scale, no rotate, no hide. Tashkeel keep their existing scale and hide.
- All new block fields are optional with no-op defaults. No layout payload version bump.
- Tashkeel `offsetX`/`offsetY` are in local px at the block's font size. `DetachedMarkOverride.dx`/`dy` are in unscaled font units. Do not "unify" them.
- Hover handlers go on the per-placement `Group`, never on the hit `Rect` (Konva leave race, see `.claude/rules/diacritics.md`).
- Overlay mount order inside `ShapedText` and `ShapeFillText`: alternates, stroke cuts, detached marks, tashkeel (largest target to smallest).
- Capability predicates live in `src/lib/blockCapabilities.ts`; `App.tsx` mutators and the Sidebar both use them.
- Any handler inserting tatweel remaps everything keyed by cluster through `kashidaTextPatch` in `App.tsx`.
- Verification loop after each task: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build`. Batch these per task, not per step.
- Commit messages end with the attribution lines in the session's system reminder.

## Review Focus

1. A glyph with both a stroke cut and a moved dot: the dot translation is applied before the cut surgery (raw contour indices), so a dot dragged across the cut line gets cut. Pinned in Task 6 by a test asserting the order and documented as a known residue.
2. A moved dot dragged onto its own letter's body must union with it (nonzero fill), never punch a hole. Pinned in Task 6 by an `inkPixels`-style check in the e2e spec of Task 7.
3. An override whose glyph id no longer matches (font change or retype) must be dropped silently, never applied to a different contour. Pinned in Task 5.
4. Retyping the text before a moved dot must keep the override on the same letter when its cluster shifts via kashida, and drop it when the letter changes. Pinned in Task 5 (remap) and Task 6 (plan filter).
5. A font whose dots are fused to the body yields no handles and no errors on any letter. Pinned in Task 2 with Qahiri's base-codepoint letters (empty outlines) and in Task 4's zero-false-hit half.

---

### Task 1: Tashkeel sideways (`offsetX`)

**Files:**
- Modify: `src/types.ts:19-27` (`DiacriticOverride`)
- Modify: `src/components/ShapedText.tsx:215-220`
- Modify: `src/components/ShapeFillText.tsx:616-623`
- Modify: `src/components/DiacriticHoverHandles.tsx` (hit rect, handles, drag)
- Modify: `src/lib/stackConvert.ts:58-68,156-168`
- Test: `src/lib/stackConvert.test.ts`
- Test: `e2e/diacritics.spec.ts`

**Interfaces:**
- Produces: `DiacriticOverride.offsetX?: number` (local px, default 0), read by every consumer above.

- [ ] **Step 1: Add the field**

In `src/types.ts` replace the `DiacriticOverride` type with:

```ts
export type DiacriticOverride = {
  glyphIndex: number;
  /** Multiplier on the diacritic's natural size. Default 1. */
  scale?: number;
  /** Extra horizontal shift in local (unscaled) units. Default 0. */
  offsetX?: number;
  /** Extra vertical shift in local (unscaled) units. Default 0. */
  offsetY?: number;
  /** When true, this instance is skipped entirely during drawing. */
  hidden?: boolean;
};
```

- [ ] **Step 2: Write the failing stack-convert test**

Append to `src/lib/stackConvert.test.ts`, inside its existing `describe` that already has `shapeReal` and a convert helper (read the file's existing mark-override test and copy its setup; the assertion is the new part):

```ts
it("carries a tashkeel offsetX into the mark piece's x", async () => {
  const { glyphs, font } = await shapeReal("بَ", "Amiri.ttf");
  const upm = font.unitsPerEm || 1000;
  const fontSize = 100;
  const base = convertRunToStack({
    glyphs, font, unitsPerEm: upm, shapableText: "بَ", cutPlan: null,
    diacriticOverrides: [], fontSize,
  });
  const moved = convertRunToStack({
    glyphs, font, unitsPerEm: upm, shapableText: "بَ", cutPlan: null,
    diacriticOverrides: [{ glyphIndex: 0, offsetX: 10, offsetY: 0 }], fontSize,
  });
  const markBase = base.pieces.find((p) => p.role === "mark")!;
  const markMoved = moved.pieces.find((p) => p.role === "mark")!;
  // 10 px at 100 px font size is 10 * (upm / 100) font units; the whole
  // composition is re-centred on its ink, so compare mark minus letter.
  const letterBase = base.pieces.find((p) => p.role === "letter")!;
  const letterMoved = moved.pieces.find((p) => p.role === "letter")!;
  expect((markMoved.x - letterMoved.x) - (markBase.x - letterBase.x)).toBeCloseTo(10 * (upm / fontSize), 3);
});
```

If the fatha in Amiri shapes at glyph index 1 rather than 0, use `glyphs.findIndex((g) => (g.ax ?? 0) === 0)` for `glyphIndex`.

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lib/stackConvert.test.ts -t "offsetX"`
Expected: FAIL, the difference is 0.

- [ ] **Step 4: Apply offsetX in stackConvert**

In `src/lib/stackConvert.ts` `runOutline`:

```ts
out.push(...translateCmds(markAdjusted(p.cmds, o), p.px + (o?.offsetX ?? 0) * scale, p.py + (o?.offsetY ?? 0) * scale));
```

and in the mark-piece loop:

```ts
x: m.px + (o?.offsetX ?? 0) * scale, y: m.py + (o?.offsetY ?? 0) * scale, rotation: 0,
```

- [ ] **Step 5: Apply offsetX in both renderers**

`src/components/ShapedText.tsx` `drawWarpedGlyphRun`:

```ts
if (diacriticOverride) {
  ctx.translate(diacriticOverride.offsetX ?? 0, diacriticOverride.offsetY ?? 0);
  const diacScale = diacriticOverride.scale ?? 1;
  ctx.scale(diacScale, diacScale);
  localScale *= diacScale;
}
```

`src/components/ShapeFillText.tsx` tile loop:

```ts
targetCtx.translate(diacriticOverride.offsetX ?? 0, diacriticOverride.offsetY ?? 0);
```

- [ ] **Step 6: Free the move handle, Shift for the old rail**

In `src/components/DiacriticHoverHandles.tsx`:

Replace `const displayY = cy + (override?.offsetY ?? 0);` with:

```ts
const displayX = cx + (override?.offsetX ?? 0);
const displayY = cy + (override?.offsetY ?? 0);
```

Replace every later use of `cx` as a *position* (hit rect `rx1`/`rx2`, `moveAt`, `resizeAt`, `hideAt`, the rail endpoints, the resize `dist`) with `displayX`. `cy` stays as the un-overridden origin only inside the drag-move computation.

Change the move handle's `dragBoundFunc` and drag handlers:

```tsx
dragBoundFunc={(pos) => {
  const rail = railRef.current;
  if (!rail) return pos;
  return projectOntoAxis(rail.a, rail.b, pos);
}}
onDragStart={(e) => {
  e.cancelBubble = true;
  const parent = e.target.getParent();
  // Shift holds the old vertical rail; otherwise the drag is free.
  if (parent && e.evt.shiftKey) {
    const transform = parent.getAbsoluteTransform();
    const lo = placement.toCanvas(displayX, displayY - fontSize);
    const hi = placement.toCanvas(displayX, displayY + fontSize);
    railRef.current = { a: transform.point(lo), b: transform.point(hi) };
  } else {
    railRef.current = null;
  }
  setDraggingKey(placement.key);
  onBeginDiacriticDrag?.();
}}
onDragMove={(e) => {
  e.cancelBubble = true;
  const pos = e.target.position();
  const local = placement.toLocal(pos.x, pos.y);
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return;
  onDragDiacriticOverride?.(placement.glyphIndex, {
    offsetX: railRef.current ? (override?.offsetX ?? 0) : local.x - cx,
    offsetY: local.y - cy,
  });
}}
```

Update the comment above `railRef` to say the rail is only set while Shift is held.

- [ ] **Step 7: Extend the e2e spec**

In `e2e/diacritics.spec.ts` add after the existing drag test:

```ts
test("a diagonal drag records offsetX as well as offsetY", async ({ page }) => {
  await gotoApp(page);
  await page.locator("textarea.sidebarTextarea").fill(VOCALIZED);
  await expect.poll(() => diacriticHitCenters(page).then((m) => m.length)).toBeGreaterThan(0);
  const handle = await armDiacriticMoveHandle(page);
  await dragFromHere(page, { x: handle.x + 40, y: handle.y + 40 });
  const overrides = (await getBlocks(page))[0].diacriticOverrides ?? [];
  expect(overrides.length).toBeGreaterThan(0);
  expect(Math.abs(overrides[0].offsetX ?? 0)).toBeGreaterThan(5);
  expect(overrides[0].offsetY ?? 0).toBeGreaterThan(5);
});

test("Shift keeps the old vertical rail", async ({ page }) => {
  await gotoApp(page);
  await page.locator("textarea.sidebarTextarea").fill(VOCALIZED);
  await expect.poll(() => diacriticHitCenters(page).then((m) => m.length)).toBeGreaterThan(0);
  const handle = await armDiacriticMoveHandle(page);
  await page.keyboard.down("Shift");
  await dragFromHere(page, { x: handle.x + 40, y: handle.y + 40 });
  await page.keyboard.up("Shift");
  const overrides = (await getBlocks(page))[0].diacriticOverrides ?? [];
  expect(overrides.length).toBeGreaterThan(0);
  expect(Math.abs(overrides[0].offsetX ?? 0)).toBeLessThan(1);
  expect(overrides[0].offsetY ?? 0).toBeGreaterThan(5);
});
```

- [ ] **Step 8: Verify**

Run: `npx vitest run src/lib/stackConvert.test.ts` then `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`, then `npx playwright test e2e/diacritics.spec.ts`.
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/components/ShapedText.tsx src/components/ShapeFillText.tsx src/components/DiacriticHoverHandles.tsx src/lib/stackConvert.ts src/lib/stackConvert.test.ts e2e/diacritics.spec.ts
git commit -m "Tashkeel: free 2-D drag with offsetX; Shift holds the vertical rail"
```

---

### Task 2: Detached-contour detector

**Files:**
- Create: `src/lib/detachedMarks.ts`
- Test: `src/lib/detachedMarks.test.ts`

**Interfaces:**
- Consumes: `toSegments`, `fromSegments` from `./stackGeometry`; `outlineBounds`, `flattenContours`, `toSvgCmds` from `./strokeCuts`; `pointInPolygon` from `./svgPath`.
- Produces:
  ```ts
  export type Bounds = { x1: number; y1: number; x2: number; y2: number };
  export type DetachedContour = { mark: number; cmds: SvgCmd[]; bounds: Bounds };
  export const MAX_MARK_FRACTION = 0.35;
  export function splitContours(cmds: SvgCmd[]): SvgCmd[][];
  export function findDetachedContours(cmds: SvgCmd[], maxFraction?: number): DetachedContour[];
  export function translateContours(cmds: SvgCmd[], offsets: ReadonlyMap<number, readonly [number, number]>): SvgCmd[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/detachedMarks.test.ts`. Copy the whole harfbuzz loading preamble and the `shapeReal` function verbatim from `src/lib/diacritics.test.ts` (lines 1 to 130), then:

```ts
import { findDetachedContours, splitContours, translateContours, MAX_MARK_FRACTION } from "./detachedMarks";
import { toSvgCmds, outlineBounds } from "./strokeCuts";

async function isolatedCmds(letter: string, fontFile: string) {
  const { glyphs, font } = await shapeReal(letter, fontFile);
  const obj = font.glyphs.get(glyphs[0].g)!;
  return toSvgCmds(obj.getPath(0, 0, font.unitsPerEm || 1000).commands);
}

describe("findDetachedContours (real fonts)", () => {
  beforeAll(async () => {
    const hb = await hbPromise;
    expect(typeof hb.shape).toBe("function");
  });

  it("finds three dots on ث and none on the body (Amiri)", async () => {
    const cmds = await isolatedCmds("ث", "Amiri.ttf");
    const marks = findDetachedContours(cmds);
    expect(marks).toHaveLength(3);
    const body = outlineBounds(cmds);
    for (const m of marks) {
      const area = (m.bounds.x2 - m.bounds.x1) * (m.bounds.y2 - m.bounds.y1);
      expect(area).toBeLessThan(MAX_MARK_FRACTION * (body.x2 - body.x1) * (body.y2 - body.y1));
    }
  });

  it("a counter is not a mark: و and م yield none (Amiri, Scheherazade, Kufi)", async () => {
    for (const f of ["Amiri.ttf", "Scheherazade.ttf", "Kufi.ttf"]) {
      for (const letter of ["و", "م", "ه", "ص"]) {
        expect(findDetachedContours(await isolatedCmds(letter, f)), `${letter} ${f}`).toHaveLength(0);
      }
    }
  });

  it("the hamza on أ is a mark (Amiri)", async () => {
    expect(findDetachedContours(await isolatedCmds("أ", "Amiri.ttf"))).toHaveLength(1);
  });

  it("an empty outline yields nothing (Qahiri base codepoints are empty)", async () => {
    expect(findDetachedContours(await isolatedCmds("ب", "Qahiri.ttf"))).toHaveLength(0);
  });

  it("mark indices are raw contour indices", async () => {
    const cmds = await isolatedCmds("ت", "Amiri.ttf");
    const parts = splitContours(cmds);
    for (const m of findDetachedContours(cmds)) {
      expect(outlineBounds(parts[m.mark])).toEqual(m.bounds);
    }
  });

  it("translateContours moves only the named contour", async () => {
    const cmds = await isolatedCmds("ب", "Amiri.ttf");
    const [dot] = findDetachedContours(cmds);
    const moved = translateContours(cmds, new Map([[dot.mark, [50, -70] as const]]));
    const after = splitContours(moved);
    const b = outlineBounds(after[dot.mark]);
    expect(b.x1).toBeCloseTo(dot.bounds.x1 + 50, 6);
    expect(b.y1).toBeCloseTo(dot.bounds.y1 - 70, 6);
    const before = splitContours(cmds);
    before.forEach((c, i) => { if (i !== dot.mark) expect(outlineBounds(after[i])).toEqual(outlineBounds(c)); });
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/detachedMarks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the detector**

Create `src/lib/detachedMarks.ts`:

```ts
// Detached marks: a letter's dots, the hamza on أ إ ؤ ئ, the kaf stroke —
// any closed contour of ink that sits outside the letter's body. Pure: no
// React, no Konva, and no ./harfbuzz import (its static harfbuzzjs import
// throws under Vitest's Node loader). Design:
// docs/superpowers/specs/2026-10-14-free-marks-and-dots-design.md
import type { SvgCmd } from "./svgPath";
import { pointInPolygon } from "./svgPath";
import { toSegments, fromSegments } from "./stackGeometry";
import { outlineBounds, flattenContours } from "./strokeCuts";

export type Bounds = { x1: number; y1: number; x2: number; y2: number };
export type DetachedContour = { mark: number; cmds: SvgCmd[]; bounds: Bounds };

/** Upper bound on a mark's bounding-box area as a fraction of the body's.
 *  An upper bound, not a band round one nuqta: Ruqaa draws a dot pair as a
 *  dash and Gulzar's dots are nearly two nuqta wide. Tuned by
 *  scripts/measureDetachedMarks.mjs. */
export const MAX_MARK_FRACTION = 0.35;

/** One command list per contour, in raw order (the index is the mark key). */
export function splitContours(cmds: SvgCmd[]): SvgCmd[][] {
  return toSegments(cmds).map((segs) => fromSegments([segs]));
}

const area = (b: Bounds) => Math.max(b.x2 - b.x1, 0) * Math.max(b.y2 - b.y1, 0);

/**
 * Rules, in order: (1) the contour's centre lies inside no other contour
 * (a counter fails here; winding is not used because TrueType and CFF
 * disagree); (2) it is not the body, the largest contour passing (1);
 * (3) its area is at most `maxFraction` of the body's.
 */
export function findDetachedContours(cmds: SvgCmd[], maxFraction = MAX_MARK_FRACTION): DetachedContour[] {
  const parts = splitContours(cmds);
  if (parts.length < 2) return [];
  const polys = parts.map((p) => flattenContours(p).flat());
  const bounds = parts.map((p) => outlineBounds(p));
  const outer: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const cx = (bounds[i].x1 + bounds[i].x2) / 2, cy = (bounds[i].y1 + bounds[i].y2) / 2;
    let inside = false;
    for (let j = 0; j < parts.length && !inside; j++) {
      if (j !== i && polys[j].length >= 3 && pointInPolygon(cx, cy, polys[j])) inside = true;
    }
    if (!inside && area(bounds[i]) > 0) outer.push(i);
  }
  if (outer.length < 2) return [];
  const body = outer.reduce((best, i) => (area(bounds[i]) > area(bounds[best]) ? i : best), outer[0]);
  const limit = maxFraction * area(bounds[body]);
  return outer
    .filter((i) => i !== body && area(bounds[i]) <= limit)
    .map((i) => ({ mark: i, cmds: parts[i], bounds: bounds[i] }));
}

/** The same outline with contour `i` translated by `offsets.get(i)`. */
export function translateContours(
  cmds: SvgCmd[],
  offsets: ReadonlyMap<number, readonly [number, number]>
): SvgCmd[] {
  if (offsets.size === 0) return cmds;
  const parts = splitContours(cmds);
  return parts.flatMap((part, i) => {
    const o = offsets.get(i);
    if (!o) return part;
    const [dx, dy] = o;
    return part.map((c): SvgCmd => {
      switch (c.type) {
        case "M": case "L": return { ...c, x: c.x + dx, y: c.y + dy };
        case "Q": return { ...c, x: c.x + dx, y: c.y + dy, x1: c.x1 + dx, y1: c.y1 + dy };
        case "C": return { ...c, x: c.x + dx, y: c.y + dy, x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy };
        default: return c;
      }
    });
  });
}
```

Check `flattenContours`' return type in `strokeCuts.ts:91`: it returns `Contour[]` where a contour is `Pt[]`; `pointInPolygon` takes `Array<[number, number]>`. If `Pt` is `[number, number]` the `.flat()` call is wrong and should be dropped (`polys[j]` is already one contour's points when `flattenContours` is called on a single-contour path, so use `flattenContours(p)[0] ?? []`). Use whichever type-checks.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/detachedMarks.test.ts`
Expected: PASS. If the Amiri ث test reports more than 3, print each mark's bounds and the body's; a decorative tail passing the size bound means `MAX_MARK_FRACTION` is too loose for this font and the Task 4 gate will set it. Do not loosen rule 1.

- [ ] **Step 5: Verify a rule is load-bearing**

Temporarily comment out the `inside` test in rule 1 and run the counter test; it must fail (و gains a mark). Restore it. Note the result in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/lib/detachedMarks.ts src/lib/detachedMarks.test.ts
git commit -m "Detached marks: topological contour detector with real-font tests"
```

---

### Task 3: Shaped-run detection, including the separate-glyph route

**Files:**
- Modify: `src/lib/detachedMarks.ts`
- Test: `src/lib/detachedMarks.test.ts`

**Interfaces:**
- Consumes: `HarfBuzzGlyph` (type) from `./normalizeGlyphs`; `opentype.Font` (type).
- Produces:
  ```ts
  export type DetachedMark = DetachedContour & { glyphIndex: number; cluster: number; glyphId: number; /** mark >= 0: contour route; mark < 0: whole-glyph route, ordinal -1 - mark among same (cluster, glyphId) */ };
  export const UNSUPPORTED_FONTS: ReadonlySet<string>;
  export function findDetachedMarks(
    glyphs: HarfBuzzGlyph[], font: opentype.Font | null | undefined, unitsPerEm: number,
    diacriticIndices: ReadonlySet<number>, fontFamily: string, only?: ReadonlySet<number>
  ): Map<number, DetachedMark[]>;  // keyed by glyph index
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/detachedMarks.test.ts`:

```ts
import { findDetachedMarks } from "./detachedMarks";
import { findDiacriticGlyphIndices } from "./diacritics";

describe("findDetachedMarks (shaped runs)", () => {
  it("NotoSans: ف's separate dot glyph is a mark here and not a diacritic", async () => {
    const { glyphs, font } = await shapeReal("حرف", "NotoSans.ttf");
    const upm = font.unitsPerEm || 1000;
    const dia = findDiacriticGlyphIndices(glyphs, font, "حرف");
    const marks = findDetachedMarks(glyphs, font, upm, dia, "NotoSans");
    const dotIdx = glyphs.findIndex((g, i) => (g.ax ?? 0) === 0 && !dia.has(i));
    expect(dotIdx).toBeGreaterThanOrEqual(0);
    expect(marks.get(dotIdx)?.[0].mark).toBe(-1);
    expect(marks.get(dotIdx)?.[0].glyphId).toBe(glyphs[dotIdx].g);
  });

  it("Amiri: contour-route marks are keyed to their letter's cluster and glyph id", async () => {
    const { glyphs, font } = await shapeReal("ثبت", "Amiri.ttf");
    const upm = font.unitsPerEm || 1000;
    const marks = findDetachedMarks(glyphs, font, upm, new Set(), "Amiri");
    let total = 0;
    for (const [gi, list] of marks) {
      for (const m of list) {
        expect(m.glyphIndex).toBe(gi);
        expect(m.cluster).toBe(glyphs[gi].cl ?? 0);
        expect(m.glyphId).toBe(glyphs[gi].g);
        expect(m.mark).toBeGreaterThanOrEqual(0);
        total++;
      }
    }
    expect(total).toBe(6);
  });

  it("a tashkeel glyph is never a detached mark", async () => {
    const { glyphs, font } = await shapeReal("بَ", "Amiri.ttf");
    const dia = findDiacriticGlyphIndices(glyphs, font, "بَ");
    const marks = findDetachedMarks(glyphs, font, font.unitsPerEm || 1000, dia, "Amiri");
    for (const i of dia) expect(marks.has(i)).toBe(false);
  });

  it("`only` restricts the walk", async () => {
    const { glyphs, font } = await shapeReal("ثبت", "Amiri.ttf");
    const marks = findDetachedMarks(glyphs, font, font.unitsPerEm || 1000, new Set(), "Amiri", new Set([0]));
    expect([...marks.keys()]).toEqual([0]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/detachedMarks.test.ts -t "shaped runs"`
Expected: FAIL, `findDetachedMarks` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/detachedMarks.ts`:

```ts
import type * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import { toSvgCmds } from "./strokeCuts";

export type DetachedMark = DetachedContour & {
  glyphIndex: number;
  cluster: number;
  glyphId: number;
};

/** Fonts the coverage gate failed (scripts/measureDetachedMarks.mjs); the
 *  detector returns nothing for them rather than the bar being loosened. */
export const UNSUPPORTED_FONTS: ReadonlySet<string> = new Set<string>([]);

const glyphCmds = (font: opentype.Font, g: HarfBuzzGlyph, upm: number): SvgCmd[] | null => {
  const obj = font.glyphs.get(g.g);
  return obj ? toSvgCmds(obj.getPath(0, 0, upm).commands) : null;
};

/**
 * Every detached mark in a shaped run, keyed by glyph index.
 *
 * Contour route: a letter's own outline split by `findDetachedContours`;
 * `mark` is the raw contour index. Separate-glyph route (NotoSans, Ruqaa,
 * Kufi2, Qahiri draw dots as their own zero-advance glyph): a zero-advance
 * glyph sharing a cluster with an advance-carrying base, not already a
 * tashkeel per `diacriticIndices`, whose outline is small against the
 * base's body; `mark` is `-1 - n` where `n` is its ordinal among glyphs in
 * the cluster with the same glyph id, so two identical dot glyphs stay
 * distinct. Pass `only` to walk a subset (plan resolution needs only the
 * glyphs that carry overrides).
 */
export function findDetachedMarks(
  glyphs: HarfBuzzGlyph[],
  font: opentype.Font | null | undefined,
  unitsPerEm: number,
  diacriticIndices: ReadonlySet<number>,
  fontFamily: string,
  only?: ReadonlySet<number>
): Map<number, DetachedMark[]> {
  const out = new Map<number, DetachedMark[]>();
  if (!font || UNSUPPORTED_FONTS.has(fontFamily)) return out;
  const upm = Math.max(unitsPerEm || 1000, 1);

  // Base (advance-carrying) glyph per cluster, for the separate-glyph route.
  const baseByCluster = new Map<number, number>();
  glyphs.forEach((g, i) => { if ((g.ax ?? 0) !== 0 && !baseByCluster.has(g.cl ?? 0)) baseByCluster.set(g.cl ?? 0, i); });
  const sameIdOrdinal = new Map<string, number>();

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const cluster = g.cl ?? 0;
    if (diacriticIndices.has(i)) continue;
    if ((g.ax ?? 0) === 0 && (g.ay ?? 0) === 0) {
      const baseIdx = baseByCluster.get(cluster);
      if (baseIdx === undefined || baseIdx === i) continue;
      const key = `${cluster}:${g.g}`;
      const n = sameIdOrdinal.get(key) ?? 0;
      sameIdOrdinal.set(key, n + 1);
      if (only && !only.has(i)) continue;
      const cmds = glyphCmds(font, g, upm);
      const baseCmds = glyphCmds(font, glyphs[baseIdx], upm);
      if (!cmds || !baseCmds) continue;
      const mb = outlineBounds(cmds), bb = outlineBounds(baseCmds);
      if (area(mb) === 0 || area(mb) > MAX_MARK_FRACTION * area(bb)) continue;
      out.set(i, [{ mark: -1 - n, cmds, bounds: mb, glyphIndex: i, cluster, glyphId: g.g }]);
      continue;
    }
    if (only && !only.has(i)) continue;
    const cmds = glyphCmds(font, g, upm);
    if (!cmds) continue;
    const found = findDetachedContours(cmds);
    if (found.length) out.set(i, found.map((m) => ({ ...m, glyphIndex: i, cluster, glyphId: g.g })));
  }
  return out;
}
```

Move the `import type * as opentype` and the `HarfBuzzGlyph` import to the top of the file with the others (ESLint's import ordering).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/detachedMarks.test.ts`
Expected: PASS. If the NotoSans test cannot find a zero-advance non-diacritic glyph, shape `"ف"` alone and inspect `glyphs`; the dot may carry `dy` only, in which case the zero-advance test above still holds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/detachedMarks.ts src/lib/detachedMarks.test.ts
git commit -m "Detached marks: shaped-run detection with the separate-glyph route"
```

---

### Task 4: Coverage gate script and archive

**Files:**
- Create: `scripts/measureDetachedMarks.mjs`
- Create: `docs/archive/detached-mark-coverage.md`
- Modify: `src/lib/detachedMarks.ts` (`MAX_MARK_FRACTION`, `UNSUPPORTED_FONTS`)

**Interfaces:**
- Consumes: `findDetachedMarks`, `findDiacriticGlyphIndices`.
- Produces: the archived numbers; the final `MAX_MARK_FRACTION` and the `UNSUPPORTED_FONTS` list.

- [ ] **Step 1: Write the script**

Create `scripts/measureDetachedMarks.mjs`. Copy the harfbuzz loading block, `FONT_DIR`, the font-loading and shaping helper from `scripts/measureStrokeZones.mjs` (lines 55 onward define how a word is shaped there; reuse that function unchanged). Then:

```js
// Coverage gate for detached-mark detection (dots, hamza, the kaf stroke).
// Run: npx --yes tsx scripts/measureDetachedMarks.mjs [--fraction=0.35]
//
// Unicode fixes how many dots a letter carries, so the detector can be
// scored exactly. Two halves per font:
//   dotted%    (letter, form) cells on dotted letters where detected == expected
//   undotted%  cells on undotted letters with zero detections — the half that
//              matters: a false hit is a handle on the letter's body.
// Gate: dotted >= 95%, undotted >= 99%, else the font goes in UNSUPPORTED_FONTS.
const { findDetachedMarks } = await import("../src/lib/detachedMarks.ts");
const { findDiacriticGlyphIndices } = await import("../src/lib/diacritics.ts");

const EXPECTED = {
  "ا": 0, "د": 0, "ر": 0, "س": 0, "ص": 0, "ط": 0, "ع": 0, "ل": 0, "م": 0, "ه": 0, "و": 0, "ح": 0,
  "ب": 1, "ج": 1, "خ": 1, "ذ": 1, "ز": 1, "ض": 1, "ظ": 1, "غ": 1, "ف": 1, "ن": 1,
  "ت": 2, "ق": 2, "ي": 2,
  "ث": 3, "ش": 3,
  "أ": 1, "إ": 1, "ؤ": 1, "ئ": 1,
};
// ك is reported, not scored: 1 where the kaf stroke is detached, 0 where fused.
const FORMS = (l) => [l, `${l}ـ`, `ـ${l}ـ`, `ـ${l}`];
const fraction = Number((process.argv.find((a) => a.startsWith("--fraction=")) ?? "--fraction=0.35").split("=")[1]);

for (const file of fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/.test(f)).sort()) {
  const family = file.replace(/\.(ttf|otf)$/, "");
  let dottedOk = 0, dottedN = 0, undottedOk = 0, undottedN = 0;
  const misses = [];
  for (const [letter, expected] of Object.entries(EXPECTED)) {
    for (const text of FORMS(letter)) {
      const { glyphs, font, shapableText } = await shapeWord(text, file); // from measureStrokeZones.mjs
      const upm = font.unitsPerEm || 1000;
      const dia = findDiacriticGlyphIndices(glyphs, font, shapableText);
      const marks = findDetachedMarks(glyphs, font, upm, dia, family);
      // Count marks on the letter's own cluster (the tatweels carry none).
      const letterCl = [...text].findIndex((ch) => ch === letter);
      let n = 0;
      for (const list of marks.values()) for (const m of list) if (m.cluster === letterCl) n++;
      if (expected === 0) { undottedN++; if (n === 0) undottedOk++; else misses.push(`${text}:${n}`); }
      else { dottedN++; if (n === expected) dottedOk++; else misses.push(`${text}:${n}/${expected}`); }
    }
  }
  const kaf = await (async () => {
    const { glyphs, font, shapableText } = await shapeWord("ك", file);
    const dia = findDiacriticGlyphIndices(glyphs, font, shapableText);
    return [...findDetachedMarks(glyphs, font, font.unitsPerEm || 1000, dia, family).values()].flat().length;
  })();
  const d = (100 * dottedOk / dottedN).toFixed(1), u = (100 * undottedOk / undottedN).toFixed(1);
  const pass = dottedOk / dottedN >= 0.95 && undottedOk / undottedN >= 0.99;
  console.log(`${family.padEnd(18)} dotted ${d.padStart(5)}%  undotted ${u.padStart(5)}%  kaf ${kaf}  ${pass ? "PASS" : "FAIL"}  ${misses.slice(0, 6).join(" ")}`);
}
```

`shapeWord` must return `{ glyphs, font, shapableText }`; if `measureStrokeZones.mjs`'s helper returns only `glyphs` and `font`, extend the copy to also return the text it shaped (it strips nothing, so `shapableText` is the input). Delete the `--fraction` line from the header comment and the `fraction` constant: the sweep runs at the module's `MAX_MARK_FRACTION`, and tuning means editing that constant and re-running, so the archived number is always the shipped one.

- [ ] **Step 2: Run it**

Run: `npx --yes tsx scripts/measureDetachedMarks.mjs`
Expected: one line per font. Record the full output.

- [ ] **Step 3: Tune and opt out**

If a font fails only the dotted half because a dash-style dot exceeds the size bound, raise `MAX_MARK_FRACTION` in steps of 0.05 up to 0.5 and re-run; stop at the smallest value where no font's undotted half drops. Any font still failing the undotted half at the chosen value goes into `UNSUPPORTED_FONTS` by family key (the key is the filename without extension, matching `NUQTA_RATIO`'s keys). Qahiri will likely show empty outlines on base codepoints; that counts as pass with zero everywhere on the contour route and its separate-glyph dots are scored by the same loop.

- [ ] **Step 4: Archive**

Create `docs/archive/detached-mark-coverage.md`:

```markdown
# Detached-mark detection coverage

The single home for these numbers; `.claude/rules/detached-marks.md` only
summarises. Produced by `scripts/measureDetachedMarks.mjs` on 2026-10-14
with `MAX_MARK_FRACTION = <value>`.

Gate: dotted letters detected == expected on >= 95% of (letter, form)
cells; undotted letters zero detections on >= 99%. A font failing the
second half is listed in `UNSUPPORTED_FONTS` rather than the bar loosened.

| font | dotted % | undotted % | kaf stroke | result |
|---|---|---|---|---|
<one row per font, pasted from the script output>

## Residue

<each miss the script printed for a passing font, one line, with why it is
accepted: e.g. "Amiri ـغـ 0/1: the medial ghayn's dot is fused to the body">

## Opted out

<fonts in UNSUPPORTED_FONTS and the number that failed them>
```

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/lib/detachedMarks.test.ts && npm run lint`
Expected: PASS (the Amiri tests still hold at the chosen fraction).

```bash
git add scripts/measureDetachedMarks.mjs docs/archive/detached-mark-coverage.md src/lib/detachedMarks.ts
git commit -m "Detached marks: coverage gate script and archived per-font numbers"
```

---

### Task 5: Storage, plan resolution, remap, capability

**Files:**
- Modify: `src/types.ts` (`BlockCommon`, re-export)
- Modify: `src/lib/detachedMarks.ts`
- Modify: `src/lib/strokeCuts.ts:798-830` (generic remap)
- Modify: `src/lib/blockCapabilities.ts`
- Test: `src/lib/detachedMarks.test.ts`, `src/lib/strokeCuts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DetachedMarkOverride = { cluster: number; glyphId: number; mark: number; dx: number; dy: number };
  export type DetachedMarkPlan = { contours: Map<number, Map<number, [number, number]>>; glyphs: Map<number, [number, number]> };
  export function buildDetachedMarkPlan(overrides: readonly DetachedMarkOverride[], glyphs: HarfBuzzGlyph[], detected: ReadonlyMap<number, DetachedMark[]>): DetachedMarkPlan;
  export function remapMarksForEdits(marks: DetachedMarkOverride[], edits: readonly { index: number; delta: number }[]): DetachedMarkOverride[];
  export const supportsDetachedMarks: (b: Block) => b is Extract<Block, { type: "text" | "shapeFill" }>;
  ```
  on `BlockCommon`: `detachedMarkOverrides?: DetachedMarkOverride[]; detachedMarkEditMode?: boolean;`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/detachedMarks.test.ts`:

```ts
import { buildDetachedMarkPlan, remapMarksForEdits } from "./detachedMarks";

describe("buildDetachedMarkPlan", () => {
  it("resolves a contour override by cluster + glyph id + mark, and drops a stale glyph id", async () => {
    const { glyphs, font } = await shapeReal("ثبت", "Amiri.ttf");
    const detected = findDetachedMarks(glyphs, font, font.unitsPerEm || 1000, new Set(), "Amiri");
    const [gi, list] = [...detected.entries()][0];
    const m = list[0];
    const plan = buildDetachedMarkPlan(
      [
        { cluster: m.cluster, glyphId: m.glyphId, mark: m.mark, dx: 30, dy: -40 },
        { cluster: m.cluster, glyphId: m.glyphId + 9999, mark: m.mark, dx: 1, dy: 1 },
        { cluster: m.cluster, glyphId: m.glyphId, mark: 999, dx: 1, dy: 1 },
      ],
      glyphs, detected
    );
    expect(plan.contours.get(gi)?.get(m.mark)).toEqual([30, -40]);
    expect(plan.contours.get(gi)?.size).toBe(1);
    expect(plan.glyphs.size).toBe(0);
  });

  it("resolves a whole-glyph override (NotoSans dot)", async () => {
    const { glyphs, font } = await shapeReal("حرف", "NotoSans.ttf");
    const dia = findDiacriticGlyphIndices(glyphs, font, "حرف");
    const detected = findDetachedMarks(glyphs, font, font.unitsPerEm || 1000, dia, "NotoSans");
    const [gi, [m]] = [...detected.entries()][0];
    const plan = buildDetachedMarkPlan([{ cluster: m.cluster, glyphId: m.glyphId, mark: m.mark, dx: 5, dy: 6 }], glyphs, detected);
    expect(plan.glyphs.get(gi)).toEqual([5, 6]);
  });
});

describe("remapMarksForEdits", () => {
  it("shifts clusters after an insertion and leaves the one at the slot", () => {
    const marks = [
      { cluster: 0, glyphId: 1, mark: 0, dx: 1, dy: 1 },
      { cluster: 2, glyphId: 1, mark: 0, dx: 1, dy: 1 },
      { cluster: 3, glyphId: 1, mark: 0, dx: 1, dy: 1 },
    ];
    expect(remapMarksForEdits(marks, [{ index: 2, delta: 1 }]).map((m) => m.cluster)).toEqual([0, 2, 4]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/detachedMarks.test.ts -t "Plan|remap"`
Expected: FAIL, not exported.

- [ ] **Step 3: Make the cut remap generic**

In `src/lib/strokeCuts.ts` change the two remap signatures (bodies unchanged):

```ts
export function remapCutsAfterInsert<T extends { cluster: number }>(cuts: T[], atOffset: number, inserted: number): T[] {
```

```ts
export function remapCutsForEdits<T extends { cluster: number }>(cuts: T[], edits: readonly { index: number; delta: number }[]): T[] {
```

- [ ] **Step 4: Add storage and plan**

Append to `src/lib/detachedMarks.ts`:

```ts
import { remapCutsForEdits } from "./strokeCuts";

/** Where a detached mark has been moved to. Keyed like a stroke cut: the
 *  cluster survives a re-shape that changes the glyph count, the glyph id
 *  checksums the letter, and `mark` picks the contour (>= 0, raw index in
 *  the glyph's path) or the whole mark glyph (< 0, see findDetachedMarks).
 *  `dx`/`dy` are unscaled font units, so a font-size change scales them.
 *  Tashkeel offsets are in px by history; the two are deliberately not the
 *  same convention. */
export type DetachedMarkOverride = {
  cluster: number;
  glyphId: number;
  mark: number;
  dx: number;
  dy: number;
};

export type DetachedMarkPlan = {
  /** glyph index -> contour index -> [dx, dy], font units. */
  contours: Map<number, Map<number, [number, number]>>;
  /** glyph index -> [dx, dy] for whole-glyph marks. */
  glyphs: Map<number, [number, number]>;
};

export const EMPTY_MARK_PLAN: DetachedMarkPlan = { contours: new Map(), glyphs: new Map() };

/** Resolve stored overrides against this run's detected marks. Anything
 *  whose cluster + glyph id no longer names a glyph, or whose mark index is
 *  no longer detected on it, is dropped silently — the guard tashkeel
 *  overrides already get. */
export function buildDetachedMarkPlan(
  overrides: readonly DetachedMarkOverride[],
  glyphs: HarfBuzzGlyph[],
  detected: ReadonlyMap<number, DetachedMark[]>
): DetachedMarkPlan {
  const plan: DetachedMarkPlan = { contours: new Map(), glyphs: new Map() };
  for (const o of overrides) {
    if (o.dx === 0 && o.dy === 0) continue;
    // A whole-glyph mark (mark < 0) names the (-1 - mark)th glyph with this
    // cluster and id, so two identical dot glyphs in one cluster stay
    // distinct; a contour mark names the first such glyph.
    const wanted = o.mark < 0 ? -1 - o.mark : 0;
    let seen = 0;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      if ((g.cl ?? 0) !== o.cluster || g.g !== o.glyphId) continue;
      if (seen++ !== wanted) continue;
      const list = detected.get(i);
      if (!list?.some((m) => m.mark === o.mark)) break;
      if (o.mark < 0) plan.glyphs.set(i, [o.dx, o.dy]);
      else {
        const per = plan.contours.get(i) ?? new Map<number, [number, number]>();
        per.set(o.mark, [o.dx, o.dy]);
        plan.contours.set(i, per);
      }
      break;
    }
  }
  return plan;
}

/** Overrides whose (cluster, glyphId, mark) are in `overrides`, as a set
 *  of glyph indices worth detecting — the `only` argument for
 *  findDetachedMarks when the tool is not armed. */
export function glyphIndicesWithOverrides(overrides: readonly DetachedMarkOverride[], glyphs: HarfBuzzGlyph[]): Set<number> {
  const out = new Set<number>();
  for (const o of overrides) glyphs.forEach((g, i) => { if ((g.cl ?? 0) === o.cluster && g.g === o.glyphId) out.add(i); });
  return out;
}

export const remapMarksForEdits = (
  marks: DetachedMarkOverride[],
  edits: readonly { index: number; delta: number }[]
): DetachedMarkOverride[] => remapCutsForEdits(marks, edits);
```

`findDetachedMarks` assigns `mark = -1 - n` with `n` counted in glyph order over same `(cluster, glyphId)` glyphs, which is the same order the counter above walks, so the two agree by construction.

- [ ] **Step 5: Block fields and capability**

In `src/types.ts` add to the re-exports near line 45:

```ts
export type { DetachedMarkOverride } from "./lib/detachedMarks";
import type { DetachedMarkOverride } from "./lib/detachedMarks";
```

and in `BlockCommon` after `strokeCutEditMode`:

```ts
  /**
   * A letter's dots, hamza or kaf stroke moved off their drawn position.
   * Absent means none, so an older save renders byte-identically. Text and
   * Shape Fill — see `supportsDetachedMarks`.
   */
  detachedMarkOverrides?: DetachedMarkOverride[];
  /** Arms the on-canvas "Move dots & marks" handles. */
  detachedMarkEditMode?: boolean;
```

In `src/lib/blockCapabilities.ts`:

```ts
/**
 * Text and Shape Fill: the two renderers that split a glyph's contours and
 * mount `DetachedMarkHoverHandles`. The fields sit on `BlockCommon`, so a
 * wider guard would accept edits that nothing draws.
 */
export const supportsDetachedMarks = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" }> =>
  b.type === "text" || b.type === "shapeFill";
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/lib/detachedMarks.test.ts src/lib/strokeCuts.test.ts && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/lib/detachedMarks.ts src/lib/detachedMarks.test.ts src/lib/strokeCuts.ts src/lib/blockCapabilities.ts
git commit -m "Detached marks: override storage, plan resolution, cluster remap, capability"
```

---

### Task 6: ShapedText drawing, metrics, placements; App mutators; kashida remap

**Files:**
- Modify: `src/components/ShapedText.tsx` (props, `drawWarpedGlyphRun`, metrics memo, new memos)
- Modify: `src/lib/diacriticPlacement.ts` (new placement type)
- Modify: `src/App.tsx` (mutators near line 705-785; `kashidaTextPatch` at 2550; CanvasStage props at ~3522)
- Modify: `src/components/CanvasStage.tsx` (props at 130-160; wiring at ~950-990)
- Test: `src/lib/detachedMarks.test.ts` (order test)

**Interfaces:**
- Consumes: Task 5's plan and types.
- Produces:
  ```ts
  // diacriticPlacement.ts
  export type DetachedMarkPlacement = {
    key: string; cluster: number; glyphId: number; mark: number;
    /** Current (moved) box, renderer-local px. */
    box: { x: number; y: number; width: number; height: number };
    /** Current offset, font units. */
    dx: number; dy: number;
  } & PlacementAdapter;
  ```
  ShapedText props: `detachedMarkOverrides?: DetachedMarkOverride[]; detachedMarkEditMode?: boolean; onBeginDetachedMarkDrag?: () => void; onSetDetachedMark?: (o: DetachedMarkOverride) => void;`
  App: `setDetachedMark(blockId, o)`, `toggleDetachedMarkMode(blockId)`, `clearDetachedMarks(blockId)`.
  detachedMarks.ts: `export function applyMarkPlanToGlyph(cmds: SvgCmd[], plan: DetachedMarkPlan, glyphIndex: number, scale: number): SvgCmd[]`.

- [ ] **Step 1: Write the failing order test**

Append to `src/lib/detachedMarks.test.ts`:

```ts
import { applyMarkPlanToGlyph } from "./detachedMarks";

it("applyMarkPlanToGlyph translates the contour at the given px scale and leaves other glyphs alone", async () => {
  const cmds = await isolatedCmds("ب", "Amiri.ttf");
  const [dot] = findDetachedContours(cmds);
  const plan = { contours: new Map([[3, new Map([[dot.mark, [100, 0] as [number, number]]])]]), glyphs: new Map() };
  const same = applyMarkPlanToGlyph(cmds, plan, 0, 0.1);
  expect(same).toBe(cmds);
  const moved = applyMarkPlanToGlyph(cmds, plan, 3, 0.1);
  expect(outlineBounds(splitContours(moved)[dot.mark]).x1).toBeCloseTo(dot.bounds.x1 + 10, 6);
});
```

- [ ] **Step 2: Implement the helper**

Append to `src/lib/detachedMarks.ts`:

```ts
/** The glyph's outline with this run's plan applied, `scale` px per font
 *  unit (1 when the commands are already in font units). Returns the same
 *  array when the glyph has no entry, so memos can test identity. */
export function applyMarkPlanToGlyph(cmds: SvgCmd[], plan: DetachedMarkPlan, glyphIndex: number, scale: number): SvgCmd[] {
  const per = plan.contours.get(glyphIndex);
  if (!per || per.size === 0) return cmds;
  const scaled = new Map<number, readonly [number, number]>();
  for (const [i, [dx, dy]] of per) scaled.set(i, [dx * scale, dy * scale]);
  return translateContours(cmds, scaled);
}
```

Run: `npx vitest run src/lib/detachedMarks.test.ts -t "applyMarkPlanToGlyph"` → PASS.

- [ ] **Step 3: Placement type**

Append to `src/lib/diacriticPlacement.ts`:

```ts
/**
 * One hoverable detached mark (a dot, hamza or kaf stroke) on canvas. `box`
 * is where it is drawn now, i.e. already offset by `dx`/`dy`; the overlay
 * adds a drag delta to those and writes the sum back.
 */
export type DetachedMarkPlacement = {
  key: string;
  cluster: number;
  glyphId: number;
  mark: number;
  box: { x: number; y: number; width: number; height: number };
  dx: number;
  dy: number;
} & PlacementAdapter;
```

- [ ] **Step 4: ShapedText: props, detection, plan**

In `src/components/ShapedText.tsx` add imports:

```ts
import {
  findDetachedMarks, buildDetachedMarkPlan, glyphIndicesWithOverrides, applyMarkPlanToGlyph,
  EMPTY_MARK_PLAN, type DetachedMarkPlan, type DetachedMarkOverride, type DetachedMark,
} from "../lib/detachedMarks";
import type { DetachedMarkPlacement } from "../lib/diacriticPlacement";
import { DetachedMarkHoverHandles } from "./DetachedMarkHoverHandles";
```

(The overlay component is written in Task 7; until then leave the mount out and add it there.)

Add props next to the diacritic ones:

```ts
  detachedMarkOverrides?: DetachedMarkOverride[];
  detachedMarkEditMode?: boolean;
  onBeginDetachedMarkDrag?: () => void;
  onSetDetachedMark?: (o: DetachedMarkOverride) => void;
```

with a stable default `const NO_MARK_OVERRIDES: DetachedMarkOverride[] = [];` beside `NO_DIACRITIC_OVERRIDES`, and destructure `detachedMarkOverrides = NO_MARK_OVERRIDES, detachedMarkEditMode = false, onBeginDetachedMarkDrag, onSetDetachedMark`.

After `diacriticGlyphIndices` add:

```ts
  // Detection walks every contour with point-in-polygon tests, so it runs
  // over the whole run only while the tool is armed; otherwise only over the
  // glyphs that carry an override, which is what the plan needs.
  const detectedMarks = useMemo(() => {
    const only = detachedMarkEditMode ? undefined : glyphIndicesWithOverrides(detachedMarkOverrides, shapeData.glyphs);
    if (only && only.size === 0) return new Map<number, DetachedMark[]>();
    return findDetachedMarks(
      shapeData.glyphs, shapeData.font, shapeData.unitsPerEm, diacriticGlyphIndices, fontFamily, only
    );
  }, [detachedMarkEditMode, detachedMarkOverrides, shapeData.glyphs, shapeData.font, shapeData.unitsPerEm, diacriticGlyphIndices, fontFamily]);

  const markPlan = useMemo<DetachedMarkPlan>(
    () => (detachedMarkOverrides.length ? buildDetachedMarkPlan(detachedMarkOverrides, shapeData.glyphs, detectedMarks) : EMPTY_MARK_PLAN),
    [detachedMarkOverrides, shapeData.glyphs, detectedMarks]
  );
```

- [ ] **Step 5: ShapedText: draw**

Add a `markPlan: DetachedMarkPlan = EMPTY_MARK_PLAN` parameter at the end of `drawWarpedGlyphRun` and pass `markPlan` at both call sites (lines ~785 and ~815). Inside the loop, two changes.

Whole-glyph route, right after the tashkeel override block:

```ts
    const wholeMark = markPlan.glyphs.get(glyphIndex);
    if (wholeMark) ctx.translate(wholeMark[0] * scale, wholeMark[1] * scale);
```

Contour route: replace the `sourceCmds` computation with

```ts
      // Dot translation first, on raw contour indices; then cut surgery. A
      // dot dragged across a cut line gets cut — accepted residue.
      const rawCmds = toSvgCmds(opPath.commands);
      const markedCmds = applyMarkPlanToGlyph(rawCmds, markPlan, glyphIndex, scale);
      const sourceCmds: PathCommand[] = cutsHere?.length
        ? (applyCutsToCommands(markedCmds, scaleCuts(cutsHere, scale)) as unknown as PathCommand[])
        : markedCmds === rawCmds
          ? opPath.commands
          : (markedCmds as unknown as PathCommand[]);
```

- [ ] **Step 6: ShapedText: metrics**

In the metrics memo (line ~552) widen the condition so a glyph with mark offsets takes the `outlineBounds` branch:

```ts
        const hasMarks = markPlan.contours.has(i);
        const box = cutsHere?.length || hasMarks
          ? (() => {
              const raw = toSvgCmds(glyphObj.getPath(0, 0, fontSize).commands);
              const marked = applyMarkPlanToGlyph(raw, markPlan, i, scale);
              const b = outlineBounds(cutsHere?.length ? applyCutsToCommands(marked, scaleCuts(cutsHere, scale)) : marked);
              const whole = markPlan.glyphs.get(i);
              const ox = (whole?.[0] ?? 0) * scale, oy = (whole?.[1] ?? 0) * scale;
              return { x1: b.x1 + gx + ox, y1: b.y1 + gy + oy, x2: b.x2 + gx + ox, y2: b.y2 + gy + oy };
            })()
          : glyphObj.getPath(gx, gy, fontSize).getBoundingBox();
```

Add `markPlan` to that memo's dependency array. Also route whole-glyph marks (`markPlan.glyphs.has(i)`) into the same branch by making `hasMarks = markPlan.contours.has(i) || markPlan.glyphs.has(i)`.

- [ ] **Step 7: ShapedText: placements**

After `diacriticPlacements`:

```ts
  const detachedMarkPlacements = useMemo<DetachedMarkPlacement[]>(() => {
    if (!detachedMarkEditMode || !shapeData.font) return [];
    const upm = Math.max(shapeData.unitsPerEm || 1000, 1);
    const scale = fontSize / upm;
    const adapter = makeOffsetAdapter(bx + localDrawX, by + localDrawY);
    const out: DetachedMarkPlacement[] = [];
    let penX = 0;
    for (let i = 0; i < shapeData.glyphs.length; i++) {
      const g = shapeData.glyphs[i];
      const gx = (penX + (g.dx ?? 0) + (cutPlan.shift[i] ?? 0)) * scale;
      const gy = -(g.dy ?? 0) * scale;
      penX += g.ax ?? 0;
      const list = detectedMarks.get(i);
      if (!list) continue;
      for (const m of list) {
        const off = m.mark < 0 ? markPlan.glyphs.get(i) : markPlan.contours.get(i)?.get(m.mark);
        const dx = off?.[0] ?? 0, dy = off?.[1] ?? 0;
        out.push({
          key: `${i}:${m.mark}`, cluster: m.cluster, glyphId: m.glyphId, mark: m.mark, dx, dy,
          box: {
            x: gx + (m.bounds.x1 + dx) * scale, y: gy + (m.bounds.y1 + dy) * scale,
            width: Math.max((m.bounds.x2 - m.bounds.x1) * scale, 1), height: Math.max((m.bounds.y2 - m.bounds.y1) * scale, 1),
          },
          ...adapter,
        });
      }
    }
    return out;
  }, [detachedMarkEditMode, detectedMarks, markPlan, shapeData, fontSize, cutPlan, bx, by, localDrawX, localDrawY]);
```

Note `m.bounds` is in font units with y-down as opentype draws at `upm` (the same frame `getPath(0,0,fontSize)` uses, scaled), so `* scale` is the whole conversion.

- [ ] **Step 8: App mutators and kashida remap**

In `src/App.tsx` next to `setStrokeCut` (line 705):

```ts
  const setDetachedMark = useCallback(
    (blockId: number, o: DetachedMarkOverride) => {
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || !supportsDetachedMarks(b)) return b;
          const rest = (b.detachedMarkOverrides ?? []).filter(
            (m) => !(m.cluster === o.cluster && m.glyphId === o.glyphId && m.mark === o.mark)
          );
          const keep = o.dx !== 0 || o.dy !== 0;
          return { ...b, detachedMarkOverrides: keep ? [...rest, o] : rest };
        })
      );
      // No push: the drag start took one through `onBeginDetachedMarkDrag`.
    },
    []
  );

  const toggleDetachedMarkMode = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsDetachedMarks(b)
            ? { ...b, detachedMarkEditMode: !b.detachedMarkEditMode }
            : b
        )
      );
    },
    [pushHistory]
  );

  const clearDetachedMarks = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsDetachedMarks(b) ? { ...b, detachedMarkOverrides: [] } : b
        )
      );
    },
    [pushHistory]
  );
```

Import `supportsDetachedMarks` from `./lib/blockCapabilities`, `DetachedMarkOverride` from `./types`, and `remapMarksForEdits` from `./lib/detachedMarks`.

Replace `kashidaTextPatch`:

```ts
  const kashidaTextPatch = useCallback(
    (block: Block, text: string, edits: readonly { index: number; delta: number }[]) => {
      const cuts = block.strokeCuts;
      const marks = block.detachedMarkOverrides;
      return {
        text,
        ...(cuts?.length ? { strokeCuts: remapCutsForEdits(cuts, edits) } : {}),
        ...(marks?.length ? { detachedMarkOverrides: remapMarksForEdits(marks, edits) } : {}),
      };
    },
    []
  );
```

- [ ] **Step 9: CanvasStage wiring**

In `src/components/CanvasStage.tsx` props (near line 145):

```ts
  /** One `pushHistory()` per dot/mark handle drag, taken on drag start. */
  onBeginDetachedMarkDrag: () => void;
  onSetDetachedMark: (blockId: number, o: DetachedMarkOverride) => void;
```

Destructure them, import the type, and in the `ShapedText` render (near line 976) add:

```tsx
                    detachedMarkOverrides={block.detachedMarkOverrides}
                    detachedMarkEditMode={block.detachedMarkEditMode ?? false}
                    onBeginDetachedMarkDrag={onBeginDetachedMarkDrag}
                    onSetDetachedMark={(o) => onSetDetachedMark(block.id, o)}
```

Pass the same four into the `ShapeFillText` render too (its props arrive in Task 8; add them there if TypeScript complains now, or add the props to `ShapeFillText` in this task as unused). In `App.tsx` where `CanvasStage` is rendered (~line 3522):

```tsx
          onBeginDetachedMarkDrag={pushHistory}
          onSetDetachedMark={setDetachedMark}
```

Also pass `detachedMarkOverrides` through `src/lib/blockRenderProps.ts` beside `diacriticOverrides` on both branches (lines 58 and 77), so mirrors draw moved dots. Mirrors do not pass the edit mode.

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: PASS (the overlay import in ShapedText is deferred to Task 7; do not import it yet).

- [ ] **Step 11: Commit**

```bash
git add src/components/ShapedText.tsx src/lib/diacriticPlacement.ts src/lib/detachedMarks.ts src/lib/detachedMarks.test.ts src/App.tsx src/components/CanvasStage.tsx src/lib/blockRenderProps.ts
git commit -m "Detached marks: draw, measure and place moved dots on text blocks; App mutators; kashida remap"
```

---

### Task 7: Overlay, sidebar arming, e2e

**Files:**
- Create: `src/components/DetachedMarkHoverHandles.tsx`
- Modify: `src/components/ShapedText.tsx` (mount)
- Modify: `src/components/Sidebar.tsx:3537-3565` (text panel), props at 314-315 and 610-611
- Modify: `src/App.tsx` (Sidebar props)
- Modify: `e2e/harf.ts`
- Create: `e2e/detached-marks.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DetachedMarkHoverHandlesProps = {
    isSelected: boolean; enabled: boolean; placements: DetachedMarkPlacement[];
    /** px per font unit. */ fontScale: number; fontSize: number;
    onBeginDrag?: () => void; onSet?: (o: DetachedMarkOverride) => void;
  };
  export const DETACHED_MARK_HANDLE_COLOR = "#a855f7";
  ```
  Sidebar props: `onToggleDetachedMarkMode?: (blockId: number) => void; onClearDetachedMarks?: (blockId: number) => void;`
  e2e: `DETACHED_MARK_HANDLE_FILL`, `detachedMarkHitCenters(page)`.

- [ ] **Step 1: Write the overlay**

Create `src/components/DetachedMarkHoverHandles.tsx`:

```tsx
import React, { useRef, useState } from "react";
import { Group, Circle, Rect } from "react-konva";
import type { DetachedMarkPlacement } from "../lib/diacriticPlacement";
import type { DetachedMarkOverride } from "../types";

export const DETACHED_MARK_HANDLE_COLOR = "#a855f7";

export type DetachedMarkHoverHandlesProps = {
  isSelected: boolean;
  /** Armed by the "Move dots & marks" checkbox. */
  enabled: boolean;
  placements: DetachedMarkPlacement[];
  /** px per font unit — offsets are stored in font units. */
  fontScale: number;
  fontSize: number;
  onBeginDrag?: () => void;
  onSet?: (o: DetachedMarkOverride) => void;
};

/**
 * One move handle per detached mark (a dot, hamza or kaf stroke), shown
 * only while that mark is hovered. Translate only: no resize, no hide —
 * a dot's size is the nib, and hiding one changes the word.
 *
 * Hover handlers sit on the per-placement Group, not the hit Rect, for the
 * Konva leave race recorded in .claude/rules/diacritics.md. The drag reads
 * a delta from where the handle started, in local px, converts it to font
 * units and adds it to the placement's current offset. Double-click resets
 * the mark to its drawn position.
 */
export const DetachedMarkHoverHandles: React.FC<DetachedMarkHoverHandlesProps> = ({
  isSelected, enabled, placements, fontScale, fontSize, onBeginDrag, onSet,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const startRef = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  if (!isSelected || !enabled) return null;
  const margin = fontSize * 0.2;

  return (
    <Group>
      {placements.map((p) => {
        const cx = p.box.x + p.box.width / 2;
        const cy = p.box.y + p.box.height / 2;
        const isHovered = hoveredKey === p.key || draggingKey === p.key;
        const corners = [
          p.toCanvas(p.box.x - margin, p.box.y - margin),
          p.toCanvas(p.box.x + p.box.width + margin, p.box.y - margin),
          p.toCanvas(p.box.x - margin, p.box.y + p.box.height + margin),
          p.toCanvas(p.box.x + p.box.width + margin, p.box.y + p.box.height + margin),
        ];
        const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
        const at = p.toCanvas(cx, cy);
        if (![...xs, ...ys, at.x, at.y].every(Number.isFinite)) return null;
        const write = (local: { x: number; y: number }) => {
          const s = startRef.current;
          if (!s) return;
          onSet?.({
            cluster: p.cluster, glyphId: p.glyphId, mark: p.mark,
            dx: s.dx + (local.x - s.x) / fontScale,
            dy: s.dy + (local.y - s.y) / fontScale,
          });
        };
        return (
          <Group
            key={p.key}
            onMouseEnter={() => setHoveredKey(p.key)}
            onMouseLeave={() => setHoveredKey((v) => (v === p.key ? null : v))}
          >
            <Rect
              name="detached-mark-hit"
              x={Math.min(...xs)} y={Math.min(...ys)}
              width={Math.max(...xs) - Math.min(...xs)} height={Math.max(...ys) - Math.min(...ys)}
              fill="transparent"
            />
            {isHovered && (
              <Circle
                x={at.x} y={at.y} radius={5}
                fill={DETACHED_MARK_HANDLE_COLOR} stroke="#ffffff" strokeWidth={1.5}
                draggable
                onMouseDown={(e) => { e.cancelBubble = true; }}
                onDblClick={(e) => {
                  e.cancelBubble = true;
                  onBeginDrag?.();
                  onSet?.({ cluster: p.cluster, glyphId: p.glyphId, mark: p.mark, dx: 0, dy: 0 });
                }}
                onDragStart={(e) => {
                  e.cancelBubble = true;
                  const pos = e.target.position();
                  const local = p.toLocal(pos.x, pos.y);
                  startRef.current = { x: local.x, y: local.y, dx: p.dx, dy: p.dy };
                  setDraggingKey(p.key);
                  onBeginDrag?.();
                }}
                onDragMove={(e) => {
                  e.cancelBubble = true;
                  const pos = e.target.position();
                  const local = p.toLocal(pos.x, pos.y);
                  if (Number.isFinite(local.x) && Number.isFinite(local.y)) write(local);
                }}
                onDragEnd={(e) => {
                  e.cancelBubble = true;
                  startRef.current = null;
                  setDraggingKey((v) => (v === p.key ? null : v));
                }}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
};

export default DetachedMarkHoverHandles;
```

- [ ] **Step 2: Mount it in ShapedText**

Between `StrokeCutHoverHandles` and `DiacriticHoverHandles`:

```tsx
      <DetachedMarkHoverHandles
        isSelected={isSelected}
        enabled={detachedMarkEditMode}
        placements={detachedMarkPlacements}
        fontScale={fontSize / Math.max(shapeData.unitsPerEm || 1000, 1)}
        fontSize={fontSize}
        onBeginDrag={onBeginDetachedMarkDrag}
        onSet={onSetDetachedMark}
      />
```

Update the ordering comment above the overlays to list four: alternates, stretch rail, dot or mark, tashkeel.

- [ ] **Step 3: Sidebar**

In `src/components/Sidebar.tsx` add props beside `onToggleStrokeCutMode` (line 314) and destructure beside line 610:

```ts
  onToggleDetachedMarkMode?: (blockId: number) => void;
  onClearDetachedMarks?: (blockId: number) => void;
```

After the "Stretch strokes" section (ends at line ~3565) add:

```tsx
                {(selectedBlock.type === "text" || selectedBlock.type === "shapeFill") && (
                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                    <div className="sidebarSectionTitle">Dots & marks</div>

                    <CheckboxRow
                      id={makeId("detached-mark-mode", selectedId)}
                      label="Move dots & marks"
                      checked={!!selectedBlock.detachedMarkEditMode}
                      onChange={() => onToggleDetachedMarkMode?.(selectedBlock.id)}
                    />

                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                      Hover a letter's dot, hamza or kaf stroke and drag it anywhere.
                      Double-click the handle to put it back. Dots keep their size;
                      a dot drawn touching its letter cannot be moved.
                    </div>

                    {(selectedBlock.detachedMarkOverrides?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => onClearDetachedMarks?.(selectedBlock.id)}
                        className="sidebarSmallAction"
                        style={{ background: "var(--bg-input)", marginTop: 8 }}
                      >
                        Reset dots & marks
                      </button>
                    )}
                  </div>
                )}
```

Check whether this region of the Sidebar is already inside a `selectedBlock.type === "text"` guard; if it is, place the block where the Shape Fill "Diacritic tool" checkbox (line ~2752) is reachable too, or render it twice: once in the text panel and once in the Shape Fill panel next to "Diacritic tool". In `App.tsx` pass `onToggleDetachedMarkMode={toggleDetachedMarkMode}` and `onClearDetachedMarks={clearDetachedMarks}` to `Sidebar`.

- [ ] **Step 4: e2e helpers and spec**

In `e2e/harf.ts` add:

```ts
export const DETACHED_MARK_HANDLE_FILL = "#a855f7";

/** Page-space centres of the hover hit rects `DetachedMarkHoverHandles` mounts, one per dot or mark. */
export async function detachedMarkHitCenters(page: Page): Promise<Point[]> {
  return page.evaluate(() => {
    const stage = window.__HARF__!.getStage();
    if (!stage) return [];
    const c = stage.container().getBoundingClientRect();
    return stage.find(".detached-mark-hit").map((n) => {
      const r = n.getClientRect();
      return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 };
    });
  });
}
```

Create `e2e/detached-marks.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import {
  DETACHED_MARK_HANDLE_FILL, detachedMarkHitCenters, dotCentersWithFill, dragFromHere,
  getBlocks, gotoApp, hitTargetAt, inkPixels, openTypography, parkOnDot, setBlockText, settleFrames,
} from "./harf";

/** ثبت: six dots in the default font, none fused. */
const WORD = "ثبت";

async function armDotHandle(page: Page) {
  await openTypography(page);
  await page.getByLabel("Move dots & marks").check();
  await expect.poll(() => detachedMarkHitCenters(page).then((m) => m.length)).toBeGreaterThan(0);
  const dot = await parkOnDot(page, await detachedMarkHitCenters(page), DETACHED_MARK_HANDLE_FILL);
  if (!dot) throw new Error(`no dot handle mounted on "${WORD}" in the default font`);
  return dot;
}

test("arming the tool mounts a hit rect per dot", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  await openTypography(page);
  expect(await detachedMarkHitCenters(page)).toHaveLength(0);
  await page.getByLabel("Move dots & marks").check();
  await expect.poll(() => detachedMarkHitCenters(page).then((m) => m.length)).toBe(6);
});

test("the handle stays mounted while the pointer sits on it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const dot = await armDotHandle(page);
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(dot.x + (i % 2 === 0 ? 0.5 : -0.5), dot.y);
    await settleFrames(page);
    expect((await dotCentersWithFill(page, DETACHED_MARK_HANDLE_FILL)).length, `handle vanished on move ${i}`).toBeGreaterThan(0);
  }
});

test("a diagonal drag records dx and dy, and the ink moves without a hole", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const inkBefore = await inkPixels(page);
  const dot = await armDotHandle(page);
  expect(await hitTargetAt(page, dot)).toMatch(/^Circle/);
  await dragFromHere(page, { x: dot.x - 30, y: dot.y + 30 }, { via: { x: dot.x - 2, y: dot.y + 2 } });
  await settleFrames(page);
  const block = (await getBlocks(page))[0];
  const marks = block.detachedMarkOverrides ?? [];
  expect(marks).toHaveLength(1);
  expect(Math.abs(marks[0].dx)).toBeGreaterThan(5);
  expect(Math.abs(marks[0].dy)).toBeGreaterThan(5);
  // A dot dragged onto its letter unions with it (nonzero fill): the ink
  // count may fall by the overlap but never below the body alone, which is
  // far more than a one-dot loss.
  const inkAfter = await inkPixels(page);
  expect(inkAfter).toBeGreaterThan(inkBefore * 0.8);
});

test("Reset dots & marks clears the overrides", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const dot = await armDotHandle(page);
  await dragFromHere(page, { x: dot.x, y: dot.y + 40 }, { via: { x: dot.x, y: dot.y + 2 } });
  await settleFrames(page);
  expect(((await getBlocks(page))[0].detachedMarkOverrides ?? []).length).toBe(1);
  await page.getByRole("button", { name: "Reset dots & marks" }).click();
  expect(((await getBlocks(page))[0].detachedMarkOverrides ?? []).length).toBe(0);
});
```

If the default font (FatemiMaqala) fuses any of the six dots, change the expected count in the first test to what the Task 4 archive reports for ث ب ت in that font, and say so in a comment.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npm run build && npx playwright test e2e/detached-marks.spec.ts e2e/diacritics.spec.ts e2e/stroke-cuts.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/DetachedMarkHoverHandles.tsx src/components/ShapedText.tsx src/components/Sidebar.tsx src/App.tsx e2e/harf.ts e2e/detached-marks.spec.ts
git commit -m "Detached marks: hover overlay, sidebar arming, e2e"
```

---

### Task 8: Shape Fill

**Files:**
- Modify: `src/components/ShapeFillText.tsx` (props ~70-80, `glyphCache` 251-266, `glyphLocalBoxes` 277-300, tile loop ~605-650, placements ~450-495, mount ~690)
- Modify: `src/components/Sidebar.tsx` (Shape Fill panel near line 2752, if Task 7 did not already render the section there)

**Interfaces:**
- Consumes: Task 5 plan helpers, Task 6 placement type, Task 7 overlay.
- Produces: `ShapeFillText` props `detachedMarkOverrides`, `detachedMarkEditMode`, `onBeginDetachedMarkDrag`, `onSetDetachedMark` (same names as `ShapedText`).

- [ ] **Step 1: Props, detection, plan**

Add the four props with the same defaults as `ShapedText`. After `diacriticGlyphIndices` add the same `detectedMarks` and `markPlan` memos as Task 6 Step 4, verbatim, using `shapeData.unitsPerEm`.

- [ ] **Step 2: Apply the plan once per glyph in glyphCache**

Change `glyphCache` so each entry's `commands` is already moved:

```ts
      const raw: SvgCmd[] = obj ? toSvgCmds(obj.getPath(0, 0, fontSize).commands) : [];
      const commands = applyMarkPlanToGlyph(raw, markPlan, i, scale);
      const whole = markPlan.glyphs.get(i);
      const result = { obj, penX, dx: dx + (whole?.[0] ?? 0) * scale, dy: dy + (whole?.[1] ?? 0) * scale, advance, commands, glyphId: g.g };
```

(`glyphs.map((g) =>` becomes `glyphs.map((g, i) =>`; add `markPlan` to the dependency array; import `toSvgCmds` from `../lib/strokeCuts` if not present. `glyphCache.commands` is typed `SvgCmd[]` already.)

The whole-glyph offset folded into `dx`/`dy` moves the separate dot glyph for every tile. The tile loop needs no change: it draws `g.commands` at `gx = startPenX + g.penX * scX + g.dx * scX`.

- [ ] **Step 3: Boxes from the moved outline**

In `glyphLocalBoxes` replace `g.obj.getPath(0, 0, fontSize).getBoundingBox()` with `outlineBounds(g.commands)` (import from `../lib/strokeCuts`), keeping the finite checks.

- [ ] **Step 4: Placements per tile**

After `diacriticPlacements`:

```ts
  const detachedMarkPlacements = useMemo<DetachedMarkPlacement[]>(() => {
    if (!detachedMarkEditMode) return [];
    const scale = fontSize / Math.max(shapeData.unitsPerEm || 1000, 1);
    const out: DetachedMarkPlacement[] = [];
    glyphInstances.forEach((inst, i) => {
      const list = detectedMarks.get(inst.glyphIndex);
      if (!list) return;
      const adapter = makeShapeFillInstanceAdapter({
        gx: inst.gx, gy: inst.gy, rotationDeg: shapeFillTextRotation, scX: inst.scX, scY: inst.scY, shapeScale,
      });
      for (const m of list) {
        const off = m.mark < 0 ? markPlan.glyphs.get(inst.glyphIndex) : markPlan.contours.get(inst.glyphIndex)?.get(m.mark);
        const dx = off?.[0] ?? 0, dy = off?.[1] ?? 0;
        // Whole-glyph offsets are already folded into the instance's gx/gy
        // through glyphCache.dx/dy, so only contour offsets move the box here.
        const bx = m.mark < 0 ? 0 : dx, by = m.mark < 0 ? 0 : dy;
        out.push({
          key: `${i}:${inst.glyphIndex}:${m.mark}`, cluster: m.cluster, glyphId: m.glyphId, mark: m.mark, dx, dy,
          box: {
            x: (m.bounds.x1 + bx) * scale, y: (m.bounds.y1 + by) * scale,
            width: Math.max((m.bounds.x2 - m.bounds.x1) * scale, 1), height: Math.max((m.bounds.y2 - m.bounds.y1) * scale, 1),
          },
          ...adapter,
        });
      }
    });
    return out;
  }, [detachedMarkEditMode, glyphInstances, detectedMarks, markPlan, shapeData.unitsPerEm, fontSize, shapeFillTextRotation, shapeScale]);
```

`glyphInstances` is gated on `diacriticEditMode || glyphAlternateMode` (line 343); widen that gate to `|| detachedMarkEditMode`, and widen `pinDrag` to `diacriticEditMode || detachedMarkEditMode` so the silhouette does not drag while the tool is armed.

- [ ] **Step 5: Mount**

Before `DiacriticHoverHandles` in the JSX:

```tsx
      <DetachedMarkHoverHandles
        isSelected={isSelected}
        enabled={detachedMarkEditMode}
        placements={detachedMarkPlacements}
        fontScale={fontSize / Math.max(shapeData.unitsPerEm || 1000, 1)}
        fontSize={fontSize}
        onBeginDrag={onBeginDetachedMarkDrag}
        onSet={onSetDetachedMark}
      />
```

- [ ] **Step 6: CanvasStage and Sidebar**

In `CanvasStage.tsx` pass the four props into `ShapeFillText` (same as Task 6 Step 9 did for `ShapedText`). If Task 7's sidebar section is inside a text-only guard, add a copy next to "Diacritic tool" in the Shape Fill panel with the same labels.

- [ ] **Step 7: Verify by hand and by suite**

Run the suite: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`. Then `npm run dev`, add a Shape Fill block (any ornament), type ثبت, arm "Move dots & marks", drag one dot: every tile's dot moves. Record that in the commit message.

- [ ] **Step 8: Commit**

```bash
git add src/components/ShapeFillText.tsx src/components/CanvasStage.tsx src/components/Sidebar.tsx
git commit -m "Detached marks on Shape Fill: one surgery per glyph, placements per tile"
```

---

### Task 9: Stack convert splits marks into rider pieces

**Files:**
- Modify: `src/lib/stackConvert.ts` (`ConvertInput`, `placeGlyphs`, `runOutline`, `convertRunToStack`)
- Modify: `src/App.tsx` (`convertSelectedBlockToStack`, ~2960-3000)
- Test: `src/lib/stackConvert.test.ts`

**Interfaces:**
- `ConvertInput` gains `detachedMarkOverrides: readonly DetachedMarkOverride[]; fontFamily: string;`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/stackConvert.test.ts`:

```ts
it("splits a letter's dots into mark pieces riding on it, at their moved position", async () => {
  const { glyphs, font } = await shapeReal("ب", "Amiri.ttf");
  const upm = font.unitsPerEm || 1000;
  const detected = findDetachedMarks(glyphs, font, upm, new Set(), "Amiri");
  const [, [dot]] = [...detected.entries()][0];
  const input = {
    glyphs, font, unitsPerEm: upm, shapableText: "ب", cutPlan: null,
    diacriticOverrides: [], fontSize: 100, fontFamily: "Amiri",
    detachedMarkOverrides: [{ cluster: dot.cluster, glyphId: dot.glyphId, mark: dot.mark, dx: 80, dy: -60 }],
  };
  const plain = convertRunToStack({ ...input, detachedMarkOverrides: [] });
  const moved = convertRunToStack(input);
  const letter = (r: typeof plain) => r.pieces.find((p) => p.role === "letter")!;
  const mark = (r: typeof plain) => r.pieces.find((p) => p.role === "mark")!;
  expect(plain.pieces.filter((p) => p.role === "mark")).toHaveLength(1);
  expect(mark(plain).parentId).toBe(letter(plain).id);
  expect(mark(moved).x - letter(moved).x - (mark(plain).x - letter(plain).x)).toBeCloseTo(80, 6);
  expect(mark(moved).y - letter(moved).y - (mark(plain).y - letter(plain).y)).toBeCloseTo(-60, 6);
  // The letter piece keeps only the body.
  expect(splitContours(letter(plain).cmds)).toHaveLength(splitContours(toSvgCmds(font.glyphs.get(glyphs[0].g)!.getPath(0, 0, upm).commands)).length - 1);
});
```

Import `findDetachedMarks`, `splitContours` from `./detachedMarks` and `toSvgCmds` from `./strokeCuts`. Add `fontFamily: "<family>"` and `detachedMarkOverrides: []` to every existing `convertRunToStack` call in this file.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/stackConvert.test.ts -t "splits"`
Expected: FAIL (type error on the new fields, then zero mark pieces).

- [ ] **Step 3: Implement**

In `src/lib/stackConvert.ts`:

```ts
import { findDetachedMarks, buildDetachedMarkPlan, splitContours, type DetachedMarkOverride } from "./detachedMarks";
```

Extend `ConvertInput`:

```ts
  detachedMarkOverrides: readonly DetachedMarkOverride[];
  fontFamily: string;
```

Extend `Placed` with `detached: { cmds: SvgCmd[]; dx: number; dy: number }[]` and change `placeGlyphs`:

```ts
function placeGlyphs(input: ConvertInput): Placed[] {
  const { glyphs, font, unitsPerEm: upm, cutPlan, shapableText } = input;
  // Tashkeel are excluded by advance below (kind "mark"), so the detector
  // gets an empty diacritic set here; the convert handler refuses blocks
  // whose tashkeel are PUA-and-zero-advance only in fonts that also draw
  // dots that way, which the kind rule already separates.
  const detected = findDetachedMarks(glyphs, font, upm, new Set(), input.fontFamily);
  const plan = buildDetachedMarkPlan(input.detachedMarkOverrides, glyphs, detected);
  const out: Placed[] = [];
  let penX = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const ax = g.ax ?? 0;
    const obj = font.glyphs.get(g.g);
    if (obj) {
      const raw = toSvgCmds(obj.getPath(0, 0, upm).commands);
      const kind: Placed["kind"] =
        ax === 0 ? "mark" : shapableText[cl(g)] === TATWEEL ? "tatweel" : "letter";
      const detached: Placed["detached"] = [];
      let body = raw;
      if (kind === "letter") {
        const list = detected.get(i) ?? [];
        const drop = new Set(list.map((m) => m.mark));
        const parts = splitContours(raw);
        body = parts.flatMap((p, k) => (drop.has(k) ? [] : p));
        for (const m of list) {
          const off = plan.contours.get(i)?.get(m.mark);
          detached.push({ cmds: m.cmds, dx: off?.[0] ?? 0, dy: off?.[1] ?? 0 });
        }
      }
      const cuts = cutPlan?.surgery.get(i);
      const cmds = cuts?.length ? applyCutsToCommands(body, cuts) : body;
      const whole = plan.glyphs.get(i);
      out.push({
        index: i, cl: cl(g), ax,
        px: penX + (g.dx ?? 0) + (cutPlan?.shift[i] ?? 0) + (whole?.[0] ?? 0),
        py: -(g.dy ?? 0) + (whole?.[1] ?? 0),
        cmds, kind, detached,
      });
    }
    penX += ax;
  }
  return out;
}
const cl = (g: HarfBuzzGlyph) => g.cl ?? 0;
```

In `runOutline`, after pushing a placed glyph's own commands, also push each `detached` entry translated by `(p.px + d.dx, p.py + d.dy)`.

In `convertRunToStack`, in the mark-piece section, add after the existing loop:

```ts
  // A letter's own dots, hamza or kaf stroke: rider pieces on the letter.
  for (const d of drafts) {
    d.placed.detached.forEach((m, k) => {
      markPieces.push({
        id: `d${d.placed.index}-${k}`, cmds: m.cmds, x: d.placed.px + m.dx, y: d.placed.py + m.dy, rotation: 0,
        pivot: cmdsCentre(m.cmds), homeX: 0, homeY: 0, order: d.order, role: "mark", parentId: d.id, faces: [],
      });
    });
  }
```

A zone sweep for joins runs on `E.cmds`/`L.cmds`, which are now body-only. That is correct: a dot was never a joinable stroke.

- [ ] **Step 4: App convert handler**

In `convertSelectedBlockToStack`, pass `detachedMarkOverrides: source.detachedMarkOverrides ?? [], fontFamily` into `convertRunToStack`, and extend the retry guard:

```ts
const marks = source.detachedMarkOverrides ?? [];
if (before > 0 && shaped.shapableText === source.text && overrides.length === 0 && marks.length === 0) {
```

- [ ] **Step 5: Verify**

Run: `npx vitest run src/lib/stackConvert.test.ts src/lib/stackOutline.test.ts && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build && npx playwright test e2e/stack.spec.ts`
Expected: PASS. The existing stack e2e converts a word; its piece count will rise by the number of dots. If it asserts an exact count, update the number and say why in the commit.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stackConvert.ts src/lib/stackConvert.test.ts src/App.tsx
git commit -m "Stack convert: a letter's dots and marks become rider pieces at their moved position"
```

---

### Task 10: Extend the nuqta table

**Files:**
- Modify: `src/lib/nuqta.ts` (`NUQTA_RATIO`)
- Modify: `docs/archive/nuqta-measurements.md`
- Test: `src/lib/nuqta.test.ts` (if present; else `src/lib/strokeCuts.test.ts` where `nuqtaUnits` is used)

- [ ] **Step 1: Add the five agreeing rows**

In `NUQTA_RATIO` add, alphabetically:

```ts
  Blaka: 0.167,
  Gulzar: 0.189,
  HarfCanvasDiwani: 0.0586,
  Rabat: 0.092,
  UKIJDiwani: 0.1172,
```

Update the comment above `FALLBACK_RATIO` to say the fallback now covers Raqq, Ruqaa and RanaKufi (methods disagreed or looked wrong) and every uploaded font.

- [ ] **Step 2: Archive the run**

Append to `docs/archive/nuqta-measurements.md` a dated section "2026-10-14 run on the eight fonts added since" with the table from the spec's "Per-font nuqta table" section verbatim, including the three flagged rows and the instruction that they need a look by eye.

- [ ] **Step 3: Pin it**

If `src/lib/nuqta.test.ts` exists, add:

```ts
it("the five newly measured fonts have their own ratio", () => {
  for (const f of ["Blaka", "Gulzar", "HarfCanvasDiwani", "Rabat", "UKIJDiwani"]) {
    expect(nuqtaUnits(f, 1000)).not.toBe(FALLBACK_RATIO * 1000);
  }
});
```

Otherwise create that file with this one test and the imports `nuqtaUnits, FALLBACK_RATIO` from `./nuqta`.

- [ ] **Step 4: Verify and commit**

Run: `npm test`

```bash
git add src/lib/nuqta.ts src/lib/nuqta.test.ts docs/archive/nuqta-measurements.md
git commit -m "Nuqta table: five fonts measured since the archive; three flagged for a look by eye"
```

---

### Task 11: Documentation

**Files:**
- Create: `.claude/rules/detached-marks.md`
- Modify: `CLAUDE.md` (subsystem index)
- Modify: `.claude/rules/diacritics.md`
- Modify: `.claude/rules/deferred-features.md`
- Modify: `.claude/rules/stacked-compositions.md` (one line on dot pieces)
- Modify: `PROGRESS.md`
- Create: `src/components/guide/sections/dots-and-marks.tsx`

- [ ] **Step 1: The subsystem note**

Create `.claude/rules/detached-marks.md`:

```markdown
---
paths:
  - "src/lib/detachedMarks*.ts"
  - "src/components/DetachedMarkHoverHandles.tsx"
  - "scripts/measureDetachedMarks.mjs"
  - "e2e/detached-marks.spec.ts"
---

# Detached marks: dots, hamza and the kaf stroke (`src/lib/detachedMarks.ts`)

A letter's own dots, the hamza on أ إ ؤ ئ and the small stroke inside ك,
movable on text and Shape Fill blocks and split into rider pieces at stack
convert. Design: `docs/superpowers/specs/2026-10-14-free-marks-and-dots-design.md`;
plan: `docs/superpowers/plans/2026-10-14-free-marks-and-dots.md`.

**Detection is topological, not metric.** A contour is a detached mark
when its centre lies inside no other contour (a counter fails here), it is
not the body (the largest such contour), and its area is at most
`MAX_MARK_FRACTION` of the body's. Size is an upper bound only: Ruqaa draws
a dot pair as a dash and Gulzar's dots are nearly two nuqta wide, so a band
round the nuqta table would miss real marks. Winding is not used; the
TrueType and CFF faces here disagree on it. Both tests in
`detachedMarks.test.ts` were checked to fail against the variant they rule
out (drop the containment test and و gains a mark).

**Two routes, one override shape.** Most fonts draw dots inside the
letter's outline; `mark` is the raw contour index. NotoSans, Ruqaa, Kufi2
and Qahiri draw them as a separate zero-advance glyph, the very glyph
`findDiacriticGlyphIndices`' allowance gate refuses; here it is admitted as
a whole-glyph mark with `mark = -1 - n`, `n` its ordinal among same-id
glyphs in the cluster.

**The gate was met, not accepted.** `scripts/measureDetachedMarks.mjs`
scores every bundled font against Unicode's dot counts, isolated and joined;
numbers live in `docs/archive/detached-mark-coverage.md` (the single home).
A font failing the zero-false-hit half is in `UNSUPPORTED_FONTS` by name
rather than the bar being loosened.

**Keyed like stroke cuts, stored in font units.** `cluster` + `glyphId`
checksum + `mark`; `dx`/`dy` are unscaled font units. Tashkeel offsets are
px at the block's size by history. The two conventions are deliberate; do
not unify them. `kashidaTextPatch` remaps both on a tatweel insertion.

**Translate only.** No scale (removed-subsystems.md), no hide (a missing dot
changes the word). Double-click resets.

**Order on text blocks: marks, then cuts, then warp.** The contour
translation is applied to the raw commands (raw contour indices), then
stroke-cut surgery, then the warp mapping, so a moved dot follows its
letter through the warp. That is the opposite order from the tashkeel
override, which is a ctx transform after the warp on a separate glyph. A
dot dragged across a cut line gets cut: accepted residue.

**The metrics loop boxes the moved outline** through `outlineBounds`, the
same branch cut glyphs take, so snapping and alignment see real ink.

**Shape Fill does the surgery once per glyph in `glyphCache`**, never per
tile; one override moves every repetition. Arming widens the
`glyphInstances` gate and pins the silhouette's drag, as the diacritic tool
does.

**Detection runs over the whole run only while armed**; otherwise only over
glyphs carrying an override (`glyphIndicesWithOverrides`).

**Overlay order:** alternates, stroke cuts, detached marks, tashkeel.
Handlers on the per-placement `Group`, never the `Rect` (diacritics.md).

**At stack convert** detected marks leave the letter's commands and become
`role: "mark"` pieces with `parentId` the letter, at their moved position.
Zone detection for joins runs on the body only. Convert refuses the tatweel
retry when the block has mark overrides, for the same reason as tashkeel.
```

- [ ] **Step 2: Index line and cross-references**

In `CLAUDE.md`'s "Subsystem notes" add after the diacritics line:

```markdown
- **Detached marks (dots, hamza, kaf stroke)** — [`.claude/rules/detached-marks.md`](.claude/rules/detached-marks.md). Topological detector (containment, not size); gate met per font, failures opted out by name. Keyed like stroke cuts in font units; tashkeel offsets stay in px. Marks, then cuts, then warp. Translate only.
```

In `.claude/rules/diacritics.md`, after the paragraph on the move handle's `dragBoundFunc`, add:

```markdown
**The move handle drags freely; Shift holds the old vertical rail.**
`offsetX` joined `offsetY` on 2026-10-14. The rail is captured only when
Shift is down at drag start, so a plain drag writes both offsets. Every
consumer that reads `offsetY` reads `offsetX` (both renderers, the overlay,
`stackConvert`). A letter's dots are not diacritics and are not handled
here — see [detached-marks.md](detached-marks.md).
```

In `.claude/rules/deferred-features.md` replace the "Free movement of nuqtas and diacritics" entry with:

```markdown
- **Free movement of nuqtas and diacritics** — Shipped 2026-10-14; see
  [detached-marks.md](detached-marks.md) and diacritics.md. Still deferred:
  rotation of a mark, and splitting a dot the font draws fused to its stem.
```

In `.claude/rules/stacked-compositions.md`, after "Marks: separate pieces riding with the letter" wording in the convert paragraph (or at the end of the "A tail is a split plus a join" paragraph), add one line:

```markdown
A letter's own dots, hamza and kaf stroke are also riders: `convertRunToStack` splits them out of the letter's commands at their moved position (`d<index>-<k>` ids), so the join sweep runs on the body only — see [detached-marks.md](detached-marks.md).
```

- [ ] **Step 3: PROGRESS.md**

Under the shipped log (follow the file's existing date format) add:

```markdown
- **2026-10-14 — Free movement of tashkeel and dots.** Tashkeel drag in 2-D
  (Shift for the vertical rail). A letter's dots, hamza and kaf stroke move
  on text and Shape Fill blocks and become rider pieces at stack convert.
  Detector gate numbers: `docs/archive/detached-mark-coverage.md`.
```

In "Known limitations" add:

```markdown
- **A dot dragged across a stroke cut on the same letter gets cut**: mark
  translation runs before cut surgery. See detached-marks.md.
- **Fonts in `UNSUPPORTED_FONTS` show no dot handles** (listed in the
  coverage archive); a dot fused to its stem has no handle in any font.
```

- [ ] **Step 4: Guide section**

Create `src/components/guide/sections/dots-and-marks.tsx` following `artboard.tsx`'s shape:

```tsx
import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "dots-and-marks",
  title: "Moving dots and marks",
  order: 36,
  keywords: ["dots", "nuqta", "nuqat", "i'jam", "hamza", "tashkeel", "harakat", "fatha", "damma", "kasra", "shadda", "move a dot", "vowel marks", "compose"],
  Body: () => (
    <>
      <p>
        A calligrapher places the dots and vowel marks where the composition
        wants them, not where a typeface puts them. Both can be moved here.
      </p>
      <p>
        <strong>Vowel marks.</strong> Select a text block and hover any
        mark: drag the blue handle anywhere. Hold Shift to move it straight
        up or down only. The gold handle resizes it, the red one hides that
        one mark.
      </p>
      <p>
        <strong>Dots, hamza and the kaf stroke.</strong> Tick "Move dots &amp;
        marks" in the block's panel, then hover a dot and drag its purple
        handle anywhere. Double-click the handle to put it back. Dots keep
        their size on purpose: a dot is one touch of the pen. If a font
        draws a dot touching its letter there is nothing separate to move.
      </p>
      <p>
        Everything you place survives converting the block to a stacked
        composition, where each dot becomes its own piece riding on its
        letter.
      </p>
    </>
  ),
};
```

Check the `order` values of the neighbouring sections (`glyph-editing.tsx`, `stretching.tsx`) and pick one that places this after them.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run build`

```bash
git add .claude/rules/detached-marks.md CLAUDE.md .claude/rules/diacritics.md .claude/rules/deferred-features.md .claude/rules/stacked-compositions.md PROGRESS.md src/components/guide/sections/dots-and-marks.tsx
git commit -m "Docs: detached marks subsystem note, guide section, progress"
```

---

## Final verification

- [ ] `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p e2e/tsconfig.json && npm run lint && npm test && npm run build && npm run e2e`
- [ ] Open the app: type مُحَمَّد, drag a fatha diagonally, Shift-drag another vertically. Type ثبت, arm "Move dots & marks", drag a dot onto the body (no hole), double-click to reset, convert to a stack and drag the dot piece alone.
- [ ] Open an old save with diacritic overrides: renders identically.
