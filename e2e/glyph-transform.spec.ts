import { expect, test, type Page } from "@playwright/test";
import {
  blockClientBox,
  dotCentersWithFill,
  getBlocks,
  gotoApp,
  hitTargetAt,
  openTypography,
  settleFrames,
  setBlockText,
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
const WORD = "حرف";

/** Arms the tool, then parks the pointer on a mounted move dot. */
async function armGlyphMoveDot(page: Page): Promise<{ x: number; y: number }> {
  // The checkbox lives in Typography, which is collapsed on load.
  await openTypography(page);
  await page.getByLabel("Move & scale glyph").check();

  const box = await blockClientBox(page, 1);
  // Sweep across the run at mid-height until a letter's dots mount.
  for (let i = 1; i < 10; i++) {
    const probe = {
      x: box.x + (box.width * i) / 10,
      y: box.y + box.height * 0.5,
    };
    await page.mouse.move(probe.x, probe.y);
    await settleFrames(page);

    const dots = await dotCentersWithFill(page, MOVE_DOT);
    if (dots.length === 0) continue;

    const nearest = dots.reduce((best, d) =>
      Math.hypot(d.x - probe.x, d.y - probe.y) <
      Math.hypot(best.x - probe.x, best.y - probe.y)
        ? d
        : best
    );
    await page.mouse.move(nearest.x, nearest.y);
    await settleFrames(page);
    if ((await hitTargetAt(page, nearest))?.startsWith("Circle")) return nearest;
  }
  throw new Error("could not park the pointer on a mounted glyph move dot");
}

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
