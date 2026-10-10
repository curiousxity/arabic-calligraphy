# Next Shape on Shape Fill and Curve — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The per-letter Next Shape tool works on Shape Fill (one pick changes every tile) and Curve blocks, through a pointer-resolved overlay that stays at two Konva nodes however many letters are on screen.

**Architecture:** A pure module, `lib/alternateTargets.ts`, hit-tests polygons. `AlternateHoverHandles` is rewritten to mount one listening `Rect` over the targets' bounds and resolve the target under the pointer in arithmetic. Each renderer builds group-space polygons from geometry it already has. For curves, the glyph placement maths moves into a pure `curveGlyphPlacements`, shared by the draw loop and the overlay.

**Tech Stack:** React 19, TypeScript, react-konva, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-next-shape-fill-and-curve-design.md`

## Global Constraints

- `supportsGlyphAlternates` becomes `text | shapeFill | textPath`.
- The overlay mounts exactly **one** listening node (`Rect`, name `alternate-hit`), plus a non-listening outline (`alternate-outline`) and a non-listening marker (`alternate-targets`, attribute `centers`, capped at 500 entries).
- Interaction semantics are unchanged: pick on release within `CLICK_SLOP` (10px), the pressed letter wins, a press on a target cancels bubbling, and `click`/`dblclick` on a target are swallowed. A press on the overlay's bounds that is *not* on a target bubbles, so the block can still be dragged between letters.
- Pure modules don't import `./harfbuzz`.
- The usual verification loop applies: tsc (app + e2e), lint, `npm test`, build, e2e. Every commit ends with the Co-Authored-By line.

## Review Focus

1. **Overlapping letters (tiles or neighbours):** the topmost-drawn (last) target wins, matching what the eye sees. Pinned in Task 1.
2. **A press in the gap between letters, inside the overlay's bounds:** the block must still drag. Pinned in Task 3's e2e.
3. **A rotated Shape Fill (`shapeFillTextRotation`):** outlines follow the tilt. Pinned in Task 1 (rotated quad) and by the adapter reuse.
4. **A curve with a baseline offset:** the outline sits on the drawn glyph, because both come from `curveGlyphPlacements`. Pinned in Task 2.
5. **The largest silhouette:** the node count stays at one listening node. Pinned in Task 4's e2e.

---

### Task 1: `lib/alternateTargets.ts`, pure hit-testing

**Files:** create `src/lib/alternateTargets.ts` and `src/lib/alternateTargets.test.ts`.

**Produces:**
```ts
export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
export function quadFromBox(b: { x: number; y: number; width: number; height: number }, pad?: number): Quad;
export function polygonBounds(polys: readonly Point[][]): { x: number; y: number; width: number; height: number } | null;
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean;
export function hitTestTargets<T extends { polygon: readonly Point[] }>(targets: readonly T[], p: Point): T | null; // last match wins
export function polygonCentre(poly: readonly Point[]): Point;
```

- [ ] Write failing tests:
  - `quadFromBox` corners with padding;
  - `pointInPolygon` inside, outside and on a rotated quad;
  - `hitTestTargets` returns the **last** overlapping target and null outside;
  - `polygonBounds` of two quads, and null for none.
- [ ] Watch them fail, implement with a ray-casting `pointInPolygon` and a bounds pre-check per target, watch them pass, commit.

### Task 2: `curveGlyphPlacements`, the shared curve placement

**Files:** modify `src/lib/textPath.ts`, `src/lib/textPath.test.ts`, `src/components/TextOnPathText.tsx`.

**Produces:**
```ts
export type CurveGlyphPlacement = { glyphIndex: number; x: number; y: number; angle: number; size: number };
export function curveGlyphPlacements(args: {
  glyphs: { ax?: number }[]; fontSize: number; unitsPerEm: number; curveLen: number; arcTable: ArcTable;
}): { placements: CurveGlyphPlacement[]; fitScale: number } | null; // null when nothing to place
export function curvePlacementToGroup(p: CurveGlyphPlacement, local: Point, baselineOffset: number): Point;
```

- [ ] Write failing tests on a straight path `M 0 0 L 300 0` (table built unreversed):
  - three glyphs with advances 100/100/100 at `fontSize === unitsPerEm` fill the 300-long curve, with `fitScale` 1, x at 0/100/200 and angle 0;
  - unequal advances scale to fit;
  - `curvePlacementToGroup` with a 90° angle and a baseline offset maps a local point as `R·(p + (0,b)) + (x,y)`.
- [ ] Implement. Refactor `TextOnPathText`'s draw loop to consume `placements`, so the cursor, size and angle are no longer computed inline. Glyphs with no outline still advance the cursor, so placements are emitted for every glyph and the draw loop skips missing outlines.
- [ ] The tests pass, and the existing ink-surface Curve e2e still passes (`npx playwright test e2e/ink-surface.spec.ts -g Curve`). Commit.

### Task 3: Pointer-resolved overlay, with text blocks on it

**Files:** rewrite `src/components/AlternateHoverHandles.tsx`; modify `src/components/ShapedText.tsx`, `e2e/harf.ts` and `e2e/glyph-alternates.spec.ts`.

**Produces:** `AlternateHitTarget = { key: string; letter: number; polygon: Point[]; options: AlternateOption[] }`, with props `{ isSelected, enabled, targets, alternates, onPick }` (no offsets: polygons are already in group space). Also the e2e helper `alternateTargetCenters(page): Promise<Point[]>`.

- [ ] Add `alternateTargetCenters` to `e2e/harf.ts`. It finds `.alternate-targets`, reads `getAttr("centers")`, maps each point through `node.getAbsoluteTransform().point` and adds the container offset. Switch every `nodeClientBox(page, ".alternate-hit")` centre in `glyph-alternates.spec.ts` to `(await alternateTargetCenters(page))[0]`, and every `namedNodeCount(page, "alternate-hit") > 0` poll to a poll on `alternateTargetCenters(page)` length.
- [ ] Add a failing e2e test: on a text block with the tool armed, a press-and-drag that starts *between* targets but inside the overlay's bounds moves the block. Without the rewrite, the per-letter rects make that region dead or no-op. Run it and watch it fail (the marker node doesn't exist yet, so the helper returns nothing).
- [ ] Rewrite the overlay:
  - On `mousemove` on the hit `Rect`: `group.getRelativePointerPosition()` → `hitTestTargets` → set `hoveredKey`. On `mouseleave`, clear it.
  - On `mousedown`: if a target is hit, cancel bubbling and record `pressRef` plus a `pressedOnTarget` flag.
  - `mouseup`: the existing slop logic.
  - `click`/`dblclick`: cancel bubbling only when `pressedOnTarget`.
  - `tap`: resolve the hit and pick.
  - Outline: a closed dashed `Line` of the hovered polygon.
  - Marker: a `Group name="alternate-targets" listening={false} centers={…}` holding up to 500 centres.
  - Render nothing when there are no targets.
- [ ] In `ShapedText`, build polygons with `quadFromBox` from the per-letter union box, offset by `bx + localDrawX` / `by + localDrawY`, with `PAD` 3. Drop the overlay's offset props.
- [ ] The whole alternates spec passes (`--repeat-each=3`), along with tsc, lint and unit tests. Commit.

### Task 4: Shape Fill

**Files:** modify `src/components/ShapeFillText.tsx`, `src/components/CanvasStage.tsx`, `src/lib/blockCapabilities.ts`, `src/lib/blockRenderProps.ts`; add a test to `e2e/glyph-alternates.spec.ts`.

- [ ] Write the failing e2e test:
  - `addOrnamentShapeFill`, set its text to `هههه`, `chooseFont("Ruqaa")`, tick "Alternate letter shapes", and poll until targets exist;
  - assert `namedNodeCount("alternate-hit") === 1` (the performance guard);
  - record the block's ink, click the first target, and see `glyphAlternates` get length 1 and the ink change;
  - Ctrl+Z restores it.
- [ ] Widen `supportsGlyphAlternates` to `text | shapeFill | textPath`, with an updated doc comment. Add `glyphAlternates` to `shapeFillProps` and `textPathProps`.
- [ ] In `ShapeFillText`:
  - add the props `glyphAlternates`, `glyphAlternateMode`, `alternateLetters` and `onPickAlternate`, with stable defaults;
  - call `useShapedGlyphs(text, fontFamily, glyphAlternates, styleSets)`;
  - gate the `glyphInstances` memo on `diacriticEditMode || glyphAlternateMode` (add it to the deps);
  - build targets: for each instance whose glyph's `letterAtOffset(shapableText, cl)` has options, take the local box from `glyphBoxByIndex`, map its four corners through `makeShapeFillInstanceAdapter({gx, gy, rotationDeg: shapeFillTextRotation, scX, scY, shapeScale}).toCanvas`, and key it `${i}:${glyphIndex}`;
  - mount `AlternateHoverHandles` before `DiacriticHoverHandles`.
- [ ] `CanvasStage`: in the shapeFill branch, pass `glyphAlternateMode`, `alternateLetters` (selected only) and `onPickAlternate`.
- [ ] The test passes ×3, plus the full alternates spec and the diacritics spec. Commit.

### Task 5: Curve

**Files:** modify `src/components/TextOnPathText.tsx` and `src/components/CanvasStage.tsx`; add a test to `e2e/glyph-alternates.spec.ts`.

- [ ] Write the failing e2e test: add curved text at (0.7, 0.6), set its text to `هههه` (`setBlockText(page, "هههه", id)`), choose Ruqaa, arm the tool, click the first target, assert `glyphAlternates` has length 1, then undo.
- [ ] In `TextOnPathText`:
  - add the props `isSelected`, `glyphAlternates`, `glyphAlternateMode`, `alternateLetters` and `onPickAlternate`;
  - pass `glyphAlternates` to `useShapedGlyphs`, and read `shapableText`;
  - memoise the placements (the same call as the draw loop);
  - build targets per glyph with options: corners of `glyph.getPath(0, 0, p.size).getBoundingBox()` padded by 3, each through `curvePlacementToGroup`;
  - mount the overlay after the `Shape`.
- [ ] `CanvasStage`: in the textPath branch, pass the same props and `isSelected`.
- [ ] The test passes ×3, and the existing curve tests still pass. Commit.

### Task 6: Docs and full verification

- [ ] `glyph-alternates.md`: the overlay is now pointer-resolved (why, the node count, the marker for tests), with the three target builders. `text-on-path.md`: the first per-glyph tool on curves, click-only, and why that is safe. `deferred-features.md`: narrow the text-on-path entry to drag tools. The guide's `letter-shapes.tsx`: the tool works on Shape Fill (every repetition) and Curve. Add a PROGRESS entry.
- [ ] Full loop: tsc ×2, lint, `npm test`, build, `npm run e2e`. Commit.
