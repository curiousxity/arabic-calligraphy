import { expect, test, type Page } from "@playwright/test";
import {
  blockClientBox,
  dotCentersWithFill,
  getBlocks,
  gotoApp,
  hitTargetAt,
  inkPixels,
  openTypography,
  settleFrames,
  setBlockText,
} from "./harf";

/**
 * Straight-stroke extension: lengthening a letter's own stroke by cutting
 * its outline and bridging the gap.
 *
 * The assertion that matters is that the run gets **visibly wider** — the
 * feature this replaces (the Morph editor's kashida dial) was removed
 * precisely because it displaced outline points without ever moving
 * `penX += advance`, so it looked like it worked and measurably did not.
 * Counting ink here is what makes that failure impossible to repeat
 * unnoticed.
 */
const HANDLE_DOT = "#f97316";
const WORD = "حرف";

/** Arms the tool, then parks the pointer on a mounted stretch handle. */
async function armStretchHandle(page: Page): Promise<{ x: number; y: number }> {
  // Typography is collapsed on load.
  await openTypography(page);
  await page.getByLabel("Stretch strokes").check();

  const box = await blockClientBox(page, 1);
  // Sweep the run: only some letters have a straight stroke, and which ones
  // depends on how the font draws them — see docs/archive/stroke-zone-coverage.md.
  for (let i = 1; i < 20; i++) {
    for (const fy of [0.5, 0.35, 0.65]) {
      const probe = {
        x: box.x + (box.width * i) / 20,
        y: box.y + box.height * fy,
      };
      await page.mouse.move(probe.x, probe.y);
      await settleFrames(page);

      const dots = await dotCentersWithFill(page, HANDLE_DOT);
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
  }
  throw new Error(
    `no stretch handle mounted anywhere on "${WORD}" in the default font`
  );
}

test("the stretch handle stays mounted while the pointer sits on it", async ({
  page,
}) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const dot = await armStretchHandle(page);

  // The sibling-hover-handler defect this codebase has hit twice shows up
  // as the handle being present on exactly every other move.
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(dot.x + (i % 2 === 0 ? 0.5 : -0.5), dot.y);
    await settleFrames(page);
    expect(
      (await dotCentersWithFill(page, HANDLE_DOT)).length,
      `handle vanished on move ${i}`
    ).toBeGreaterThan(0);
  }
});

test("dragging the handle records a cut and widens the run", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);

  expect((await getBlocks(page))[0].strokeCuts ?? []).toHaveLength(0);
  const before = await blockClientBox(page, 1);
  const inkBefore = await inkPixels(page);

  const dot = await armStretchHandle(page);
  // A deliberately small first step, for the same reason the glyph-transform
  // spec uses one: under ~20px a sibling-handler overlay loses the node the
  // gesture is attached to.
  await page.mouse.down();
  await page.mouse.move(dot.x + 2, dot.y);
  await page.mouse.move(dot.x + 60, dot.y, { steps: 24 });
  await page.mouse.up();
  await settleFrames(page);

  const block = (await getBlocks(page))[0];
  const cuts = block.strokeCuts ?? [];
  expect(cuts.length, "the drag recorded no cut").toBeGreaterThan(0);
  expect(cuts[0].nuqta).toBeGreaterThan(0);
  // Stored so the cut can be re-validated after a later text edit, and so it
  // knows which way the stroke runs.
  expect(typeof cuts[0].glyphId).toBe("number");
  expect(typeof cuts[0].angle).toBe("number");

  // The gesture belonged to the handle, not the block under it.
  expect(block.y).toBe(0);

  // The point of the whole feature: the letter is actually longer. Both the
  // measured box and the drawn ink have to agree, or the metrics loop and
  // the draw loop have diverged.
  const after = await blockClientBox(page, 1);
  expect(after.width).toBeGreaterThan(before.width);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(inkBefore);
});

test("undo reverts a stretch", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const dot = await armStretchHandle(page);
  const before = await blockClientBox(page, 1);

  await page.mouse.down();
  await page.mouse.move(dot.x + 2, dot.y);
  await page.mouse.move(dot.x + 60, dot.y, { steps: 24 });
  await page.mouse.up();
  await settleFrames(page);
  expect((await getBlocks(page))[0].strokeCuts ?? []).not.toHaveLength(0);

  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => ((await getBlocks(page))[0].strokeCuts ?? []).length)
    .toBe(0);
  await expect
    .poll(async () => (await blockClientBox(page, 1)).width)
    .toBeLessThanOrEqual(before.width + 1);
});

test("a block with no cuts is byte-identical to one that never had the field", async ({
  page,
}) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  // Absent rather than an empty array: a project saved before this feature
  // must load and render unchanged, which is why nothing writes the field
  // until a cut is actually made.
  expect((await getBlocks(page))[0].strokeCuts).toBeUndefined();
});
