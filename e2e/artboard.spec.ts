import { expect, test, type Download, type Page } from "@playwright/test";
import {
  dragMouse,
  findBlockGrabPoint,
  getBlocks,
  getStageScale,
  gotoApp,
} from "./harf";

/** Page-space rect of a Konva node, in *stage* coordinates (pan/zoom divided out). */
async function stageRectOf(page: Page, selector: string) {
  const rect = await page.evaluate((sel) => {
    const stage = window.__HARF__!.getStage();
    const node = stage?.findOne(sel);
    if (!stage || !node) return null;
    return node.getClientRect({ relativeTo: stage });
  }, selector);
  if (!rect) throw new Error(`no node matches ${selector}`);
  return rect;
}

/**
 * Width and height straight out of a PNG's IHDR chunk: an 8-byte signature,
 * a 4-byte chunk length and the 4-byte "IHDR" tag, then the two dimensions as
 * big-endian 32-bit integers. Reading the header avoids pulling in an image
 * decoder just to answer "how big is it".
 */
async function pngSize(download: Download): Promise<{ width: number; height: number }> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function openPanel(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

/** Picks a page size and waits for the page rect it draws to actually exist. */
async function choosePage(page: Page, presetId: string) {
  await openPanel(page, /^Artboard/);
  await page.locator("#artboard-preset").selectOption(presetId);
  await expect
    .poll(() => page.evaluate(() => !!window.__HARF__!.getStage()?.findOne("#artboard-chrome-outline")))
    .toBe(true);
}

async function exportPng(page: Page): Promise<Download> {
  await openPanel(page, /Project & Export/);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG" }).click();
  return downloadPromise;
}

test("a page preset fixes the exported pixel size", async ({ page }) => {
  await gotoApp(page);
  await choosePage(page, "ig-square");

  const size = await pngSize(await exportPng(page));
  // Exactly the preset, not the preset times the scale slider (which sits at
  // 2 by default) and not the block bounding box.
  expect(size).toEqual({ width: 1080, height: 1080 });
});

test("a page preset survives a block being moved", async ({ page }) => {
  await gotoApp(page);
  await choosePage(page, "ig-square");

  const from = await findBlockGrabPoint(page, 1);
  await dragMouse(page, from, { x: from.x + 120, y: from.y - 60 });

  // The whole point of a page: export dimensions stop being emergent.
  expect(await pngSize(await exportPng(page))).toEqual({ width: 1080, height: 1080 });
});

test("freeform still exports at the size of its contents", async ({ page }) => {
  await gotoApp(page);

  const block = await stageRectOf(page, "#block-1");
  const size = await pngSize(await exportPng(page));

  expect(size.width).not.toBe(1080);
  // The blocks' bounding box at the default 2x oversampling, allowing for
  // toDataURL's own rounding of a fractional box.
  expect(Math.abs(size.width - block.width * 2)).toBeLessThanOrEqual(4);
  expect(Math.abs(size.height - block.height * 2)).toBeLessThanOrEqual(4);
});

test("dragging a block near the page edge snaps it flush", async ({ page }) => {
  await gotoApp(page);
  await choosePage(page, "ig-square");

  const pageRect = await stageRectOf(page, "#artboard-chrome-outline");
  const before = await stageRectOf(page, "#block-1");
  const scale = await getStageScale(page);

  // Aim the block's left edge a few stage units *short* of the page's left
  // edge — inside the snap threshold (6 screen px), but not on it, so landing
  // flush can only be the snap and not the drag.
  const offBy = 4;
  const wanted = pageRect.x + offBy;
  const screenDelta = { x: (wanted - before.x) * scale, y: 0 };

  const from = await findBlockGrabPoint(page, 1);
  await dragMouse(page, from, { x: from.x + screenDelta.x, y: from.y + screenDelta.y });

  const after = await stageRectOf(page, "#block-1");
  expect(Math.abs(after.x - pageRect.x)).toBeLessThan(1);

  // ...and the block really moved there, rather than the assertion passing on
  // a block that never left home.
  expect(Math.abs(after.x - before.x)).toBeGreaterThan(offBy);
  expect((await getBlocks(page))[0].x).not.toBe(0);
});
