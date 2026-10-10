import { expect, test } from "@playwright/test";
import { dotCentersWithFill, hitTargetAt, getBlocks, gotoApp, openPanel, placeAtCanvas, settleFrames } from "./harf";

/** The pen tool's anchor gold (`TextPathEditOverlay`'s ANCHOR_COLOR). */
const ANCHOR_FILL = "#d4af37";

/**
 * Reshaping a curve is one undo step even when the drag pauses midway. The
 * debounced history push used to record the pause point as its own entry,
 * so one Ctrl+Z only rewound to the middle of the drag.
 */
test("an anchor drag that pauses midway is undone by a single undo", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Add curved text" }).click();
  await placeAtCanvas(page, 0.7, 0.6);
  await expect
    .poll(async () => (await getBlocks(page)).some((b) => b.type === "textPath"))
    .toBe(true);
  await openPanel(page, /^Curve/);
  await page.getByRole("button", { name: "Edit Curve" }).click();
  await settleFrames(page);

  const anchors = await dotCentersWithFill(page, ANCHOR_FILL);
  expect(anchors.length).toBeGreaterThan(1);
  const curveBefore = (await getBlocks(page)).find((b) => b.type === "textPath")!.textPathD;

  const a = anchors[0];
  // At the default zoom a 400-unit curve is wider than the canvas; the block
  // is placed right of centre so its first anchor is on screen and grabbable.
  expect(await hitTargetAt(page, a)).toMatch(/^Circle/);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 15, a.y + 15, { steps: 10 });
  await page.waitForTimeout(600);
  await page.mouse.move(a.x + 40, a.y + 40, { steps: 10 });
  await page.mouse.up();
  await settleFrames(page);
  const moved = (await getBlocks(page)).find((b) => b.type === "textPath")!.textPathD;
  expect(moved).not.toBe(curveBefore);

  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.type === "textPath")?.textPathD)
    .toBe(curveBefore);
});
