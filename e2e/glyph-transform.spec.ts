import { expect, test, type Page } from "@playwright/test";
import {
  addOrnamentShapeFill,
  blockClientBox,
  diacriticHitCenters,
  dotCentersWithFill,
  dragFromHere,
  getBlocks,
  gotoApp,
  hitTargetAt,
  namedNodeCount,
  openPanel,
  openTypography,
  parkOnDot,
  setBlockText,
  settleFrames,
} from "./harf";

/**
 * Per-glyph move & scale. Two things are covered here, and PROGRESS.md listed
 * both as outstanding:
 *
 * - the dot drag itself, which had never been exercised by a test;
 * - that the handles survive the pointer sitting on them. This overlay had
 *   the same sibling-hover-handler defect as `DiacriticHoverHandles` — hover
 *   handlers on the hit `Rect` with the dots as siblings, so the moment a dot
 *   mounted under the pointer the next mousemove cleared hover and unmounted
 *   it. Both now hang their handlers on the shared ancestor Group.
 */
const MOVE_DOT = "#38bdf8";
const ROTATE_DOT = "#a855f7";
const WORD = "حرف";
/** The same word with a kasra — a mark that hangs *below* the baseline. */
const WORD_WITH_LOW_MARK = "حِرف";

type Point = { x: number; y: number };

/**
 * Arms the tool, then parks the pointer on a mounted dot of the given
 * colour.
 *
 * Kept colour-parameterised rather than duplicated per handle: all four dots
 * mount together on hover, so the only thing that differs between them is
 * which one the pointer finally settles on.
 */
async function armGlyphDot(page: Page, fill: string): Promise<Point> {
  // The checkbox lives in Typography, which is collapsed on load.
  await openTypography(page);
  await page.getByLabel("Move, scale & rotate glyph").check();

  const box = await blockClientBox(page, 1);
  // Sweep across the run at mid-height until a letter's dots mount.
  const probes = Array.from({ length: 9 }, (_, i) => ({
    x: box.x + (box.width * (i + 1)) / 10,
    y: box.y + box.height * 0.5,
  }));
  const dot = await parkOnDot(page, probes, fill);
  if (!dot) {
    throw new Error(`could not park the pointer on a mounted glyph ${fill} dot`);
  }
  return dot;
}

const armGlyphMoveDot = (page: Page) => armGlyphDot(page, MOVE_DOT);

test("the move dot stays mounted while the pointer sits on it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const dot = await armGlyphMoveDot(page);

  for (let i = 0; i < 8; i++) {
    await page.mouse.move(dot.x + (i % 2 === 0 ? 0.5 : -0.5), dot.y);
    await settleFrames(page);
    expect(
      (await dotCentersWithFill(page, MOVE_DOT)).length,
      `dots vanished on move ${i}`
    ).toBeGreaterThan(0);
  }
});

test("dragging the move dot records a glyph transform, not a block move", async ({
  page,
}) => {
  await gotoApp(page);
  await setBlockText(page, WORD);

  expect((await getBlocks(page))[0].glyphTransforms ?? []).toHaveLength(0);
  const dot = await armGlyphMoveDot(page);

  // A deliberately small first step: under ~20px this used to leave the
  // gesture attached to a node the overlay had already unmounted.
  await page.mouse.down();
  await page.mouse.move(dot.x, dot.y + 2);
  await page.mouse.move(dot.x, dot.y + 36, { steps: 20 });
  await page.mouse.up();

  const block = (await getBlocks(page))[0];
  const transforms = block.glyphTransforms ?? [];
  expect(transforms.length).toBeGreaterThan(0);
  expect(transforms[0].offsetY ?? 0).toBeGreaterThan(5);
  // The gesture must have been consumed by the dot, not the block under it.
  expect(block.y).toBe(0);
  // And it must record which glyph it was made for, or it cannot be
  // re-validated after a later text edit.
  expect(typeof transforms[0].glyphId).toBe("number");
});


test("the rotate dot stays mounted while the pointer sits on it", async ({ page }) => {
  // The fourth dot is a new sibling under the same per-glyph Group. If the
  // hover handlers ever drift back onto the hit Rect, or the rect stops
  // covering this dot's rest position, the every-other-frame flicker returns
  // — the measured symptom the other two overlays record.
  await gotoApp(page);
  await setBlockText(page, WORD);
  const dot = await armGlyphDot(page, ROTATE_DOT);

  for (let i = 0; i < 8; i++) {
    await page.mouse.move(dot.x + (i % 2 === 0 ? 0.5 : -0.5), dot.y);
    await settleFrames(page);
    expect(
      (await dotCentersWithFill(page, ROTATE_DOT)).length,
      `the rotate dot vanished on move ${i}`
    ).toBeGreaterThan(0);
  }
});

test("swinging the rotate dot turns the glyph, not the block", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);

  const before = (await getBlocks(page))[0];
  expect(before.glyphTransforms ?? []).toHaveLength(0);

  // The move dot sits exactly on the rotation pivot — `transformedBox` turns
  // the raw outline box about its own centre and takes the AABB, which
  // leaves that centre where it was. So the pivot needs no separate
  // measurement here: it is wherever the blue dot is.
  const pivot = await armGlyphMoveDot(page);
  const dot = await armGlyphDot(page, ROTATE_DOT);

  // Swing the dot a quarter of the way round the pivot. The stage's own
  // pan and zoom are a translation plus a *uniform* scale, both of which
  // preserve angles, so the number recorded should be the number swept.
  const theta = (40 * Math.PI) / 180;
  const dx = dot.x - pivot.x;
  const dy = dot.y - pivot.y;
  const to = {
    x: pivot.x + dx * Math.cos(theta) - dy * Math.sin(theta),
    y: pivot.y + dx * Math.sin(theta) + dy * Math.cos(theta),
  };

  await dragFromHere(page, to, {
    via: { x: dot.x + (to.x - dot.x) * 0.05, y: dot.y + (to.y - dot.y) * 0.05 },
  });

  const block = (await getBlocks(page))[0];
  const transforms = block.glyphTransforms ?? [];
  expect(transforms.length).toBeGreaterThan(0);

  const turned = transforms.find((t) => (t.rotation ?? 0) !== 0);
  expect(turned, "no glyph recorded a rotation").toBeDefined();
  expect(turned!.rotation!).toBeGreaterThan(25);
  expect(turned!.rotation!).toBeLessThan(55);
  // Stamped with the glyph it was made for, or it cannot be re-validated
  // after a later text edit.
  expect(typeof turned!.glyphId).toBe("number");

  // The gesture must have been consumed by the dot, not by the block under
  // it: a per-glyph turn is not a block turn.
  expect(block.rotation ?? 0).toBe(before.rotation ?? 0);
  expect(block.x).toBe(before.x);
  expect(block.y).toBe(before.y);
});

test("the rotate dot is grabbable on a letter carrying a mark below the baseline", async ({
  page,
}) => {
  // Kasra, kasratan and shadda-kasra all hang under the line, and
  // DiacriticHoverHandles mounts *after* this overlay — Konva routes a
  // pointer to the topmost listening shape, so a rotate dot placed below the
  // box centre sits beneath the mark's own hit rect and cannot be grabbed on
  // exactly the letters most likely to want turning. Placing it diagonally
  // above the box is what keeps it reachable.
  //
  // Asserting the drag rather than the dot's coordinates is what makes this
  // discriminating: a buried dot does not merely fail to move the glyph, it
  // hands the gesture to the mark underneath and records a diacritic
  // override instead.
  await gotoApp(page);
  await setBlockText(page, WORD_WITH_LOW_MARK);
  await settleFrames(page);

  const mark = (await diacriticHitCenters(page))[0];
  expect(mark, "the kasra mounted no hit rect to collide with").toBeDefined();

  const box = await blockClientBox(page, 1);
  await openTypography(page);
  await page.getByLabel("Move, scale & rotate glyph").check();

  // Hover the marked letter clear of the mark's own rect, which covers the
  // lower half of the glyph and would otherwise take the hover itself.
  await page.mouse.move(mark.x, box.y + box.height * 0.15);
  await settleFrames(page);

  const dots = await dotCentersWithFill(page, ROTATE_DOT);
  expect(dots.length, "the marked letter mounted no rotate dot").toBeGreaterThan(0);
  const dot = dots[0];
  expect(await hitTargetAt(page, dot), "the rotate dot is buried").toMatch(/^Circle/);

  await page.mouse.move(dot.x, dot.y);
  await settleFrames(page);
  await dragFromHere(
    page,
    { x: dot.x + 90, y: dot.y + 20 },
    { via: { x: dot.x + 6, y: dot.y } }
  );

  const block = (await getBlocks(page))[0];
  const turned = (block.glyphTransforms ?? []).find((t) => (t.rotation ?? 0) !== 0);
  expect(turned, "the gesture recorded no rotation").toBeDefined();
  // And it went to the glyph, not to the mark sitting under the dot.
  expect(block.diacriticOverrides ?? []).toHaveLength(0);
});

/* ------------------------------------------------------------------ *
 * Shape Fill
 *
 * The same overlay, on a renderer that tiles the run across a silhouette.
 * Everything below exists because that tiling changes what the same
 * component means: one glyph index is drawn dozens or hundreds of times, so
 * the mounted-node count and the hover key are the two things that had to be
 * decided rather than inherited.
 * ------------------------------------------------------------------ */

/** Arms the per-glyph tool on the selected block and waits for its rects. */
async function armGlyphToolOnSelection(page: Page): Promise<void> {
  await openTypography(page);
  await page.getByLabel("Move, scale & rotate glyph").check();
  await expect.poll(() => namedNodeCount(page, "glyph-transform-hit")).toBeGreaterThan(0);
}

/** Parks the pointer on a mounted dot of `fill` somewhere over a shape-fill block. */
async function armShapeFillDot(
  page: Page,
  blockId: number,
  fill: string
): Promise<Point> {
  const box = await blockClientBox(page, blockId);
  // A 5x5 grid over the silhouette's middle: only one tile per glyph index
  // mounts a dot, so which cell finds one is not predictable.
  const probes = [];
  for (let iy = 3; iy < 8; iy++) {
    for (let ix = 3; ix < 8; ix++) {
      probes.push({
        x: box.x + (box.width * ix) / 10,
        y: box.y + (box.height * iy) / 10,
      });
    }
  }
  const dot = await parkOnDot(page, probes, fill);
  if (!dot) {
    throw new Error(
      `could not park the pointer on a mounted shape-fill ${fill} dot`
    );
  }
  return dot;
}

test("a shape fill mounts one hit rect per glyph, not one per tile", async ({
  page,
}) => {
  // The decision this feature turns on. A 3000-tall silhouette at fontSize 20
  // tiles a four-glyph run into roughly 23,000 instances, and a listening
  // Konva rect on each is a frozen tab rather than a slow one. Placements are
  // therefore capped to one per glyph index — which costs nothing
  // semantically, since a transform is keyed by glyph index and already
  // applies to every repetition of that letter.
  //
  // The discriminating comparison is against the *diacritic* overlay, which
  // mounts one rect per tiled repetition off the very same instance array: if
  // the cap were removed, the two counts would be of the same order.
  await gotoApp(page);
  const shapeId = await addOrnamentShapeFill(page);
  await setBlockText(page, "حَرف", shapeId);

  // The Diacritic tool lives in the Shape Fill type panel, collapsed on load.
  await openPanel(page, /^Shape Fill/);
  await page.getByLabel("Diacritic tool").check();
  await expect
    .poll(async () => (await diacriticHitCenters(page)).length)
    .toBeGreaterThan(0);
  const tiledMarks = (await diacriticHitCenters(page)).length;

  await armGlyphToolOnSelection(page);
  const glyphRects = await namedNodeCount(page, "glyph-transform-hit");

  // At most one per shaped glyph of a four-character word — generous, since
  // shaping can add or drop a glyph, but nowhere near a per-tile count.
  expect(glyphRects).toBeLessThanOrEqual(8);
  // And the same silhouette really is tiled many times over.
  expect(tiledMarks).toBeGreaterThan(glyphRects * 3);
});

test("hovering one tile shows that tile's dots only", async ({ page }) => {
  // Hover state is keyed on `placement.key`, never on `glyphIndex`: on a
  // tiling renderer an index-keyed hover lights every repetition of that
  // letter at once, which is exactly the clutter the hover rule exists to
  // prevent.
  await gotoApp(page);
  const shapeId = await addOrnamentShapeFill(page);
  await setBlockText(page, "حرف", shapeId);
  await armGlyphToolOnSelection(page);

  await armShapeFillDot(page, shapeId, MOVE_DOT);

  // One hovered placement mounts exactly one of each of the four dots.
  expect(await dotCentersWithFill(page, MOVE_DOT)).toHaveLength(1);
  expect(await dotCentersWithFill(page, ROTATE_DOT)).toHaveLength(1);
});

test("a shape-fill dot stays mounted while the pointer sits on it", async ({
  page,
}) => {
  // The every-other-frame flicker check, on the second renderer. The overlay
  // was reworked to take placements for this stream; if its hover handlers
  // ever drift from the per-placement Group back onto the hit Rect, this is
  // the measurement that sees it.
  await gotoApp(page);
  const shapeId = await addOrnamentShapeFill(page);
  await setBlockText(page, "حرف", shapeId);
  await armGlyphToolOnSelection(page);

  const dot = await armShapeFillDot(page, shapeId, MOVE_DOT);
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(dot.x + (i % 2 === 0 ? 0.5 : -0.5), dot.y);
    await settleFrames(page);
    expect(
      (await dotCentersWithFill(page, MOVE_DOT)).length,
      `the shape-fill dot vanished on move ${i}`
    ).toBeGreaterThan(0);
  }
});

test("dragging a shape-fill glyph records a transform and never moves the block", async ({
  page,
}) => {
  // Two defects in one gesture.
  //
  // The small first step is the one that kills a hover-mounted handle when
  // the overlay's handlers sit on the hit rect rather than on the shared
  // ancestor Group.
  //
  // The block position is the `dragBoundFunc` fix. While a per-glyph tool is
  // armed the silhouette is pinned, and that pin used to return the block's
  // *layer-space* `{x, y}` props — while Konva's contract is absolute stage
  // coordinates. At the app's default 275% zoom a press on an armed
  // silhouette therefore teleported it to wherever those layer coordinates
  // landed on screen. Asserting x/y are untouched is what sees it.
  await gotoApp(page);
  const shapeId = await addOrnamentShapeFill(page);
  await setBlockText(page, "حرف", shapeId);
  await armGlyphToolOnSelection(page);

  const before = (await getBlocks(page)).find((b) => b.id === shapeId)!;
  expect(before.glyphTransforms ?? []).toHaveLength(0);

  const dot = await armShapeFillDot(page, shapeId, MOVE_DOT);
  await page.mouse.down();
  await page.mouse.move(dot.x, dot.y + 2);
  await page.mouse.move(dot.x, dot.y + 40, { steps: 20 });
  await page.mouse.up();

  const after = (await getBlocks(page)).find((b) => b.id === shapeId)!;
  const transforms = after.glyphTransforms ?? [];
  expect(transforms.length).toBeGreaterThan(0);
  expect(Math.abs(transforms[0].offsetY ?? 0)).toBeGreaterThan(1);
  expect(typeof transforms[0].glyphId).toBe("number");

  // The dot swallowed the gesture rather than the block under it.
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
});

test("pressing an armed silhouette does not teleport the block", async ({ page }) => {
  // The `dragBoundFunc` fix, and the only gesture that can see it. A handle
  // dot cancels the bubble on mousedown, so a drag that starts on a dot never
  // begins a *block* drag and never consults the pin at all — the assertion
  // in the test above therefore passes with the bug fully present.
  //
  // Pressing the silhouette itself is what starts the block drag. Konva's
  // `dragBoundFunc` contract is **absolute stage coordinates**; the pin used
  // to return the block's layer-space `{x, y}` props, so at the app's default
  // 275% zoom the block jumped to wherever those layer numbers landed on
  // screen and `onDragEnd` wrote that back as its new position.
  await gotoApp(page);
  const shapeId = await addOrnamentShapeFill(page);
  await setBlockText(page, "حرف", shapeId);
  await armGlyphToolOnSelection(page);

  const before = (await getBlocks(page)).find((b) => b.id === shapeId)!;
  const box = await blockClientBox(page, shapeId);

  // A spot on the silhouette's own hit rect, clear of the capped per-glyph
  // rects (which cluster near the shape's centre) and of the corner handle.
  let grab: Point | null = null;
  for (const fy of [0.06, 0.94, 0.12, 0.88]) {
    for (const fx of [0.5, 0.3, 0.7]) {
      const probe = { x: box.x + box.width * fx, y: box.y + box.height * fy };
      await page.mouse.move(probe.x, probe.y);
      await settleFrames(page);
      if ((await hitTargetAt(page, probe)) === "Rect.") {
        grab = probe;
        break;
      }
    }
    if (grab) break;
  }
  expect(grab, "found no bare spot on the silhouette to press").not.toBeNull();

  await page.mouse.down();
  await page.mouse.move(grab!.x + 4, grab!.y + 4);
  await page.mouse.move(grab!.x + 70, grab!.y + 50, { steps: 20 });
  await page.mouse.up();

  const after = (await getBlocks(page)).find((b) => b.id === shapeId)!;
  expect(after.x).toBeCloseTo(before.x, 3);
  expect(after.y).toBeCloseTo(before.y, 3);
});
