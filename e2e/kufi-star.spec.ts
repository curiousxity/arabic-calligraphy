import { expect, test } from "@playwright/test";
import { blockClientBox, collectConsoleErrors, getBlocks, gotoApp, inkPixels, placeAtCanvas } from "./harf";

/** The Kufi star panel block: its construction, drawn as one outline. */

test("Add Kufi star draws the 4-fold construction and the lines toggle hides it", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await gotoApp(page);
  const before = new Set((await getBlocks(page)).map((b) => b.id));

  await page.getByRole("button", { name: "Add Kufi star" }).click();
  await placeAtCanvas(page, 0.5, 0.5);
  await expect
    .poll(async () => (await getBlocks(page)).some((b) => b.type === "kufiStar" && !before.has(b.id)))
    .toBe(true);
  const star = (await getBlocks(page)).find((b) => b.type === "kufiStar" && !before.has(b.id))!;
  expect(star).toMatchObject({ type: "kufiStar", starFold: 4, starK: 3, starSize: 24, starLines: true });

  // The starter text may sit under the star, so the lines are judged by how much ink they add.
  const box = await blockClientBox(page, star.id);
  await expect.poll(() => inkPixels(page, box)).toBeGreaterThan(1000);
  const withLines = await inkPixels(page, box);

  await page.getByRole("checkbox", { name: "Show construction lines" }).uncheck();
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.id === star.id) as { starLines?: boolean } | undefined)
    .toMatchObject({ starLines: false });
  await expect.poll(() => inkPixels(page, box)).toBeLessThan(withLines - 1000);
  expect(errors).toEqual([]);
});
