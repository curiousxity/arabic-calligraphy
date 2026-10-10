import { expect, test, type Page } from "@playwright/test";
import {
  alternateTargetCenters,
  chooseFont,
  getBlocks,
  gotoApp,
  hitTargetAt,
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

  await expect.poll(async () => (await alternateTargetCenters(page)).length).toBeGreaterThan(0);
  await settleFrames(page);
  const box = (await nodeClientBox(page, "#block-1"))!;
  const inkBefore = await inkPixels(page, box);

  const at = (await alternateTargetCenters(page))[0];
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
  expect(await alternateTargetCenters(page)).toHaveLength(0);
});

test("the hover outline stays mounted while the pointer sits on a letter", async ({ page }) => {
  await gotoApp(page);
  await armAlternates(page, "Ruqaa", "هههه");
  await expect.poll(async () => (await alternateTargetCenters(page)).length).toBeGreaterThan(0);
  await settleFrames(page);
  const at = (await alternateTargetCenters(page))[0];

  for (let i = 0; i < 8; i++) {
    await page.mouse.move(at.x + (i % 2 === 0 ? 0.5 : -0.5), at.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "alternate-outline"), `outline vanished on move ${i}`).toBe(1);
  }
});

test("double-clicking through shapes does not open the text for editing", async ({ page }) => {
  await gotoApp(page);
  await armAlternates(page, "Ruqaa", "هههه");
  await expect.poll(async () => (await alternateTargetCenters(page)).length).toBeGreaterThan(0);
  await settleFrames(page);
  // Clicking quickly through shapes is exactly what this tool invites; the
  // block's own double-click handler would otherwise focus the Content
  // textarea with the whole text selected, so the next keystroke replaces it.
  const textarea = page.locator("textarea.sidebarTextarea");
  await expect(textarea, "the Content textarea must be mounted for this to test anything").toHaveCount(1);
  // Twice, on warm caches the second time. Re-aimed each pass: a new shape
  // has a new outline, and a double-click on the block's own background
  // rightly opens the text.
  for (let i = 0; i < 2; i++) {
    await settleFrames(page);
    const at = (await alternateTargetCenters(page))[0];
    expect(await hitTargetAt(page, at)).toBe("Rect.alternate-hit");
    await page.mouse.dblclick(at.x, at.y);
    await settleFrames(page);
    await expect(textarea).not.toBeFocused();
  }
  await expect(page.locator("[data-alternate-strip]")).toBeVisible();
});

test("a click that slides a few pixels picks a shape instead of moving the block", async ({ page }) => {
  await gotoApp(page);
  await armAlternates(page, "Ruqaa", "هههه");
  await expect.poll(async () => (await alternateTargetCenters(page)).length).toBeGreaterThan(0);
  await settleFrames(page);
  const at = (await alternateTargetCenters(page))[0];
  const before = (await getBlocks(page))[0];

  // A trackpad click that drifts past Konva's drag threshold.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 6, at.y + 4, { steps: 4 });
  await page.mouse.up();
  await settleFrames(page);

  const after = (await getBlocks(page))[0];
  expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
  expect(after.glyphAlternates ?? []).toHaveLength(1);
});

test("ticking a style set restyles every matching letter, and undo restores it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "هههه");
  await chooseFont(page, "Ruqaa");
  const toggle = page.getByLabel("Looped Haa");
  await expect(toggle).toBeVisible();
  const box = await nodeClientBox(page, "#block-1");
  const inkBefore = await inkPixels(page, box!);

  await toggle.check();
  await expect.poll(async () => (await getBlocks(page))[0].styleSets ?? []).toEqual(["ss01"]);
  await expect.poll(() => inkPixels(page, box!)).not.toBe(inkBefore);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await getBlocks(page))[0].styleSets ?? []).toEqual([]);
});

test("a font without style sets says so", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "هههه");
  await chooseFont(page, "Thuluth");
  await expect(page.getByText("No style sets in this font")).toBeVisible();
});

test("the block can still be dragged from a gap between outlined letters", async ({ page }) => {
  await gotoApp(page);
  // A space gives a gap inside the overlay's bounds that is not a letter.
  await armAlternates(page, "Ruqaa", "هههه   هههه");
  await expect.poll(async () => (await alternateTargetCenters(page)).length).toBeGreaterThan(1);
  await settleFrames(page);
  const centers = await alternateTargetCenters(page);
  // The widest horizontal gap between neighbouring targets is the space.
  const xs = centers.map((c) => c.x).sort((a, b) => a - b);
  let gap = { at: 0, width: 0 };
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > gap.width) gap = { at: (xs[i] + xs[i - 1]) / 2, width: xs[i] - xs[i - 1] };
  }
  const from = { x: gap.at, y: centers[0].y };
  expect(await hitTargetAt(page, from), "the gap must be inside the overlay").toBe("Rect.alternate-hit");
  const before = (await getBlocks(page))[0];

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 12 });
  await page.mouse.up();
  await settleFrames(page);

  const after = (await getBlocks(page))[0];
  expect(after.x).not.toBe(before.x);
  expect(after.glyphAlternates ?? []).toHaveLength(0);
});
