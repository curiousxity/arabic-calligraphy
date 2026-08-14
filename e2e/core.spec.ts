import { expect, test } from "@playwright/test";
import {
  blockClientBox,
  collectConsoleErrors,
  dragMouse,
  findBlockGrabPoint,
  getBlocks,
  getSelectedIds,
  getStageScale,
  gotoApp,
  inkPixels,
  setBlockText,
} from "./harf";

test("boots with the default block selected and no console errors", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await gotoApp(page);

  expect(await getSelectedIds(page)).toEqual([1]);
  const blocks = await getBlocks(page);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].type).toBe("text");
  expect(errors).toEqual([]);
});

test("typing in the Content textarea puts ink on the stage", async ({ page }) => {
  await gotoApp(page);

  // Emptying the block is the clean baseline: whatever else the stage
  // draws (artboard fill, alignment grid) is pale, so a zero here means
  // "no glyphs", not "nothing at all".
  await setBlockText(page, "");
  await expect.poll(() => inkPixels(page)).toBe(0);

  await setBlockText(page, "بسم الله");
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(200);

  // ...and the ink is where the block says it is, not somewhere else.
  const box = await blockClientBox(page, 1);
  expect(await inkPixels(page, box)).toBeGreaterThan(200);
});

test("dragging a block on the canvas moves it by the drag delta", async ({ page }) => {
  await gotoApp(page);

  const before = (await getBlocks(page))[0];
  const scale = await getStageScale(page);
  const from = await findBlockGrabPoint(page, 1);
  const screenDelta = { x: 140, y: 90 };

  await dragMouse(page, from, { x: from.x + screenDelta.x, y: from.y + screenDelta.y });

  const after = (await getBlocks(page))[0];
  const expectedX = before.x + screenDelta.x / scale;
  const expectedY = before.y + screenDelta.y / scale;

  // Loose, because a drop still passes through edge/guide snapping — this
  // asserts the gesture reached Konva and carried the block with it, not
  // that it landed on an exact pixel.
  const tolerance = 20 / scale;
  expect(Math.abs(after.x - expectedX)).toBeLessThan(tolerance);
  expect(Math.abs(after.y - expectedY)).toBeLessThan(tolerance);
});

test("undo reverts an edit and redo reapplies it", async ({ page }) => {
  await gotoApp(page);

  const original = (await getBlocks(page))[0].text;
  await setBlockText(page, "كتب");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await getBlocks(page))[0].text).toBe(original);

  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(async () => (await getBlocks(page))[0].text).toBe("كتب");
});

test("Export PNG downloads a non-trivial file", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: /Project & Export/ }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("calligraphy.png");

  const stream = await download.createReadStream();
  let bytes = 0;
  for await (const chunk of stream) bytes += (chunk as Buffer).length;
  // A blank or truncated PNG is a few hundred bytes; a rendered artboard is
  // orders of magnitude larger. Coarse on purpose.
  expect(bytes).toBeGreaterThan(5_000);
});
