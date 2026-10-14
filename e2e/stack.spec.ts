import { expect, test, type Page } from "@playwright/test";
import {
  blockClientBox,
  chooseFont,
  getBlocks,
  gotoApp,
  hitTargetAt,
  namedNodeCount,
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

  await convert(page);
  const block = (await getBlocks(page))[0];
  expect(block.type).toBe("stack");
  expect((block as unknown as { pieces: unknown[] }).pieces.length).toBeGreaterThanOrEqual(4);
  const baked = await blockClientBox(page, 1);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await getBlocks(page))[0].type).toBe("text");
  // Convert-and-touch-nothing is the identity, give or take a pixel. Measured
  // against the restored text block, not one read before converting: under
  // parallel load that read can land before the new font has shaped (it was
  // 217.6 px against a settled 203.3 px), whereas by now the shape is cached.
  await expect
    .poll(async () => Math.abs((await blockClientBox(page, 1)).width - baked.width))
    .toBeLessThan(3);
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

type PieceFull = { id: string; role: string; order: number; x: number; y: number; rotation: number; parentId?: string };
const fullPiecesOf = (page: Page) =>
  getBlocks(page).then((b) => (b[0] as unknown as { pieces: PieceFull[] }).pieces);

/**
 * A page-space point inside the i-th `stack-piece` polygon that the stage
 * really routes to that polygon: letters overlap and outlines are concave, so
 * the bbox centre can land on a neighbour or on nothing.
 */
async function pointOnPiece(page: Page, index: number): Promise<Point | null> {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getStage()!;
    const node = stage.find(".stack-piece")[i];
    const r = node.getClientRect();
    const box = stage.container().getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    let best: { x: number; y: number; d: number } | null = null;
    for (let gy = 0; gy <= 12; gy++) {
      for (let gx = 0; gx <= 12; gx++) {
        const x = r.x + (r.width * gx) / 12, y = r.y + (r.height * gy) / 12;
        if (stage.getIntersection({ x, y }) !== node) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best ? { x: box.left + best.x, y: box.top + best.y } : null;
  }, index);
}

test("splitting a stroke makes an end cap that drags alone", async ({ page }) => {
  await gotoApp(page);
  await chooseFont(page, "UKIJ Diwani");
  await setBlockText(page, WORD);
  await settleFrames(page);
  await convert(page);

  const before = await fullPiecesOf(page);
  const capsBefore = before.filter((p) => p.role === "letter" && p.parentId).length;

  await page.getByLabel("Split strokes").check();
  await expect.poll(() => namedNodeCount(page, "stack-split")).toBeGreaterThan(0);
  await settleFrames(page);
  const dot = await page.evaluate(() => {
    const stage = window.__HARF__!.getStage()!;
    const node = stage.find(".stack-split")[0];
    const r = node.getClientRect();
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
  });
  await page.mouse.move(dot.x, dot.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, dot)).toBe("Circle.stack-split");
  await page.mouse.click(dot.x, dot.y);

  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length + 1);
  const split = await fullPiecesOf(page);
  const caps = split.filter((p) => p.role === "letter" && p.parentId);
  expect(caps.length).toBe(capsBefore + 1);
  const cap = caps.find((c) => !before.some((p) => p.id === c.id))!;
  expect(cap).toBeDefined();

  // Disarm so no split dot sits over the cap, then drag the cap by itself.
  await page.getByLabel("Split strokes").uncheck();
  await expect.poll(() => namedNodeCount(page, "stack-split")).toBe(0);
  await settleFrames(page);
  const at = await pointOnPiece(page, split.indexOf(cap));
  expect(at).not.toBeNull();
  const c = at!;
  await page.mouse.move(c.x, c.y);
  await settleFrames(page);
  await page.mouse.down();
  // Small first step, then the travel (see e2e-tests.md).
  await page.mouse.move(c.x + 1, c.y - 2);
  await page.mouse.move(c.x + 30, c.y - 40, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);

  const after = await fullPiecesOf(page);
  const capAfter = after.find((p) => p.id === cap.id)!;
  expect(Math.hypot(capAfter.x - cap.x, capAfter.y - cap.y)).toBeGreaterThan(10);
  for (const p of after) {
    if (p.id === cap.id) continue;
    const q = split.find((s) => s.id === p.id)!;
    expect(Math.abs(p.x - q.x)).toBeLessThan(1e-3);
    expect(Math.abs(p.y - q.y)).toBeLessThan(1e-3);
    expect(Math.abs(p.rotation - q.rotation)).toBeLessThan(1e-3);
  }
});
