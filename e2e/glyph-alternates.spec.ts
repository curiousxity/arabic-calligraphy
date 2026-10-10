import { expect, test, type Page } from "@playwright/test";
import {
  centerOf,
  chooseFont,
  getBlocks,
  gotoApp,
  inkPixels,
  namedNodeCount,
  nodeClientBox,
  setBlockText,
  settleFrames,
} from "./harf";

/** Arms Next Shape on the starter block and waits for a clickable letter. */
async function armAlternates(page: Page, font: string, text: string) {
  await setBlockText(page, text);
  await chooseFont(page, font);
  await page.getByLabel("Alternate letter shapes").check();
}

test("clicking a letter steps to an alternate shape, and undo restores it", async ({ page }) => {
  await gotoApp(page);
  await armAlternates(page, "Ruqaa", "هههه");

  await expect.poll(() => namedNodeCount(page, "alternate-hit")).toBeGreaterThan(0);
  await settleFrames(page);
  const box = (await nodeClientBox(page, ".alternate-hit"))!;
  const inkBefore = await inkPixels(page, box);

  const at = centerOf(box);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);

  await expect.poll(async () => ((await getBlocks(page))[0].glyphAlternates ?? []).length).toBe(1);
  await expect.poll(() => inkPixels(page, box)).not.toBe(inkBefore);

  // The sidebar strip now shows that letter's options, the current one pressed.
  await expect(page.locator('[data-alternate-strip] button[aria-pressed="true"]')).toHaveCount(1);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => ((await getBlocks(page))[0].glyphAlternates ?? []).length).toBe(0);
});

test("a font with no alternates says so", async ({ page }) => {
  await gotoApp(page);
  await armAlternates(page, "Thuluth", "هههه");
  await expect(page.getByText("No alternate shapes in this font")).toBeVisible();
  expect(await namedNodeCount(page, "alternate-hit")).toBe(0);
});

test("the hover outline stays mounted while the pointer sits on a letter", async ({ page }) => {
  await gotoApp(page);
  await armAlternates(page, "Ruqaa", "هههه");
  await expect.poll(() => namedNodeCount(page, "alternate-hit")).toBeGreaterThan(0);
  await settleFrames(page);
  const at = centerOf((await nodeClientBox(page, ".alternate-hit"))!);

  for (let i = 0; i < 8; i++) {
    await page.mouse.move(at.x + (i % 2 === 0 ? 0.5 : -0.5), at.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "alternate-outline"), `outline vanished on move ${i}`).toBe(1);
  }
});
