import { expect, test, type Page } from "@playwright/test";
import {
  blockClientBox,
  chooseFont,
  getBlocks,
  gotoApp,
  settleFrames,
  setBlockText,
  type Point,
} from "./harf";

/**
 * Stacked compositions: converting a text block into independently placed
 * pieces, and dragging a letter along its reading-order chain.
 */
const WORD = "مصبح";

type PieceLite = { role: string; order: number; y: number; parentId?: string };
const piecesOf = (page: Page) =>
  getBlocks(page).then((b) => (b[0] as unknown as { pieces: PieceLite[] }).pieces);

async function convert(page: Page) {
  await page.getByLabel("Convert to stacked composition").click();
  await expect.poll(async () => (await getBlocks(page))[0].type).toBe("stack");
  await settleFrames(page);
}

/** Centre of the i-th mounted `stack-piece` hit polygon, in page px. */
async function pieceCentre(page: Page, index: number): Promise<Point> {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getStage()!;
    const node = stage.find(".stack-piece")[i];
    const r = node.getClientRect();
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
  }, index);
}

test("converting bakes the block into pieces and undo brings the text back", async ({
  page,
}) => {
  await gotoApp(page);
  // UKIJ Diwani needs no tatweel fallback, so convert is footprint-neutral.
  await chooseFont(page, "UKIJ Diwani");
  await setBlockText(page, WORD);
  await settleFrames(page);
  const before = await blockClientBox(page, 1);

  await convert(page);
  const block = (await getBlocks(page))[0];
  expect(block.type).toBe("stack");
  expect((block as unknown as { pieces: unknown[] }).pieces.length).toBeGreaterThanOrEqual(4);

  // Convert-and-touch-nothing is the identity, give or take a pixel.
  const after = await blockClientBox(page, 1);
  expect(Math.abs(after.width - before.width)).toBeLessThan(3);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await getBlocks(page))[0].type).toBe("text");
});

test("dragging a letter lifts it and the letters after it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  await convert(page);

  const before = await piecesOf(page);
  const letters = before
    .filter((p) => p.role === "letter" && !p.parentId)
    .sort((a, b) => a.order - b.order);
  expect(letters.length).toBeGreaterThanOrEqual(3);
  // Hit polygons mount in `pieces` order.
  const idx = before.indexOf(letters[1]);
  const c = await pieceCentre(page, idx);

  await page.mouse.move(c.x, c.y);
  await settleFrames(page);
  await page.mouse.down();
  // Small first step, then the travel (see e2e-tests.md).
  await page.mouse.move(c.x + 1, c.y - 2);
  await page.mouse.move(c.x, c.y - 60, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);

  const after = (await piecesOf(page))
    .filter((p) => p.role === "letter" && !p.parentId)
    .sort((a, b) => a.order - b.order);
  expect(after[0].y).toBeCloseTo(letters[0].y, 3); // the first letter stayed
  expect(after[1].y).toBeLessThan(letters[1].y - 10); // the dragged one rose (y is down)
  expect(after[2].y).toBeLessThan(letters[2].y - 10); // and carried the chain
  expect((await blockClientBox(page, 1)).height).toBeGreaterThan(0);
});
