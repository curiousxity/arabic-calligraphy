import { expect, test, type Page } from "@playwright/test";
import { blockClientBox, getBlocks, gotoApp, inkPixels, openPanel, placeAtCanvas, settleFrames } from "./harf";
import type { MarkBlock } from "../src/types";

/**
 * A mark is a loose pen piece from the library. The unit suite checks the
 * outlines; what only a browser shows is that a click in the Marks panel and a
 * click on the canvas really put ink there, and that the Mark panel changes it.
 */

const marks = async (page: Page) =>
  (await getBlocks(page)).filter((b): b is MarkBlock => b.type === "mark");

test("adds a mark from the library, then flips and swaps it", async ({ page }) => {
  await gotoApp(page);
  await openPanel(page, /^Marks/);
  await page.getByRole("group").filter({ hasText: "Dots (nuqta)" }).locator("summary").click();
  await page.getByRole("button", { name: "Three nuqtas, point up" }).click();
  await placeAtCanvas(page, 0.25, 0.3);
  await expect.poll(async () => (await marks(page)).length).toBe(1);

  const [mark] = await marks(page);
  expect(mark.markId).toBe("dots-48");
  await settleFrames(page);
  const box = await blockClientBox(page, mark.id);
  expect(box.width).toBeGreaterThan(5);
  expect(await inkPixels(page, box)).toBeGreaterThan(30);

  // The type panel shows, and Typography (font rows) does not.
  await openPanel(page, /^Mark$/);
  await expect(page.getByRole("button", { name: /^Typography/ })).toHaveCount(0);

  await page.getByLabel("Flip left–right").check();
  await expect.poll(async () => (await marks(page))[0].markFlipX).toBe(true);

  await page.getByRole("group").filter({ hasText: "Strokes & tails" }).last().locator("summary").click();
  await page.getByRole("button", { name: "Long straight stroke" }).last().click();
  await expect.poll(async () => (await marks(page))[0].markId).toBe("strokes-26");
});
