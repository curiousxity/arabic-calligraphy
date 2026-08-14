import { expect, test, type Page } from "@playwright/test";
import { blockClientBox, collectConsoleErrors, getBlocks, gotoApp, inkPixels } from "./harf";

/**
 * A new block follows the cursor until a click on the canvas drops it (see
 * `beginPlacement` in App.tsx), so every insert here is two steps: choose it
 * in the picker, then place it.
 */
async function placeAtCanvasCentre(page: Page): Promise<void> {
  const centre = await page.evaluate(() => {
    const c = window.__HARF__!.getStage()!.container().getBoundingClientRect();
    return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  });
  await page.mouse.click(centre.x, centre.y);
}

async function openPicker(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Shapes and frames" }).click();
  await expect(page.getByRole("dialog", { name: "Shapes & frames" })).toBeVisible();
}

test("the picker renders a thumbnail for every ornament", async ({ page }) => {
  await gotoApp(page);
  await openPicker(page);

  const cards = page.locator(".ornamentCard");
  await expect(cards).toHaveCount(10);

  // A thumbnail is an inline <svg>, so "it rendered" means real path geometry
  // is in the DOM — not that an <img> was requested.
  const drawn = await page
    .locator(".ornamentThumb path")
    .evaluateAll((nodes) =>
      nodes.filter((n) => (n.getAttribute("d") ?? "").length > 20).length
    );
  expect(drawn).toBeGreaterThanOrEqual(10);

  await expect(page.locator('[data-ornament-id="medallion"]')).toBeVisible();
});

test("Escape closes the picker without touching the canvas", async ({ page }) => {
  await gotoApp(page);
  const before = await getBlocks(page);

  await openPicker(page);
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: "Shapes & frames" })).toHaveCount(0);
  expect(await getBlocks(page)).toHaveLength(before.length);
});

test("Fill with text builds a Shape Fill block that has tiled ink in it", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await gotoApp(page);

  await openPicker(page);
  await page
    .locator('[data-ornament-id="medallion"]')
    .getByRole("button", { name: /^Fill with text/ })
    .click();
  await placeAtCanvasCentre(page);

  const blocks = await getBlocks(page);
  expect(blocks).toHaveLength(2);

  const shape = blocks[1];
  expect(shape.type).toBe("shapeFill");
  expect(shape.shapeSvgPath?.length ?? 0).toBeGreaterThan(20);
  // The medallion's viewBox is square, so uniform scaling must keep it square
  // — a stretched import would show up here as unequal sides.
  expect(Math.abs((shape.shapeWidth ?? 0) - (shape.shapeHeight ?? 0))).toBeLessThan(2);

  const box = await blockClientBox(page, shape.id);
  await expect.poll(() => inkPixels(page, box)).toBeGreaterThan(500);

  expect(errors).toEqual([]);
});

test("Insert as frame builds an image block in the chosen colour", async ({ page }) => {
  await gotoApp(page);
  await openPicker(page);

  // Navy rather than the default gold: `inkPixels` only counts dark pixels,
  // so this is what makes the "did the colour actually get baked in" check
  // below observable on the canvas.
  await page.getByRole("button", { name: "Frame colour #1e3a5f" }).click();
  await page
    .locator('[data-ornament-id="border-frame"]')
    .getByRole("button", { name: /^Insert as frame/ })
    .click();
  await placeAtCanvasCentre(page);

  const blocks = await getBlocks(page);
  expect(blocks).toHaveLength(2);

  const frame = blocks[1];
  // Narrowed rather than asserted, so `imageDataUrl` below is reachable on
  // the Block union at all.
  if (frame.type !== "image") throw new Error(`expected an image block, got ${frame.type}`);
  expect(frame.imageDataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);

  const svg = await page.evaluate(
    (url: string) => atob(url.slice("data:image/svg+xml;base64,".length)),
    frame.imageDataUrl
  );
  expect(svg).toContain('fill="#1e3a5f"');

  const box = await blockClientBox(page, frame.id);
  await expect.poll(() => inkPixels(page, box)).toBeGreaterThan(500);
});
