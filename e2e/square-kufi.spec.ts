import { test, expect, type Page } from "@playwright/test";
import {
  gotoApp,
  getBlocks,
  blockClientBox,
  getStageScale,
  inkPixels,
  openPanel,
  placeAtCanvas,
  setBlockText,
  settleFrames,
} from "./harf";

/**
 * Square kufi. Everything here drives the app the way a user does — the add
 * button, the Content textarea, the type panel's own controls — and checks the
 * result in pixels on the live stage canvas, per the harness rules in
 * CLAUDE.md.
 *
 * The pixel reads are deliberately coarse ("is there ink in this half", "is
 * this box nearer square than that one"). This block type rasterises axis-
 * aligned rectangles rather than font outlines, so it is steadier across
 * machines than the text specs — but an exact-image assertion would still be
 * the wrong instrument.
 */

const ADD_KUFI = 'button[aria-label="Add square kufi"]';

/** Adds a square-kufi block, drops it on the canvas, and returns its id. */
async function addKufi(page: Page): Promise<number> {
  const before = (await getBlocks(page)).length;
  await page.locator(ADD_KUFI).click();
  await placeAtCanvas(page, 0.5, 0.6);
  await expect.poll(async () => (await getBlocks(page)).length).toBe(before + 1);
  const blocks = await getBlocks(page);
  const added = blocks[blocks.length - 1];
  expect(added.type).toBe("squareKufi");
  return added.id;
}

const openKufiPanel = (page: Page) => openPanel(page, /^Square Kufi/);

type KufiBlock = {
  id: number;
  fontSize: number;
  kufiCellEdits?: { unitIndex: number; dx: number; dy: number; on: boolean }[];
};

const kufiBlock = async (page: Page, id: number): Promise<KufiBlock> =>
  (await getBlocks(page)).find((b) => b.id === id) as unknown as KufiBlock;

const cellEditCount = async (page: Page, id: number) =>
  (await kufiBlock(page, id)).kufiCellEdits?.length ?? 0;

/**
 * A grid-space cell's centre, in page coordinates.
 *
 * `blockClientBox`'s top-left is the block group's own origin, which is the
 * generated grid's `(0, 0)` — the same frame the overlay resolves a pointer in
 * — as long as nothing has grown the grid yet. Callers therefore measure the
 * anchor box *before* painting anything outside the panel.
 */
async function cellPoint(
  page: Page,
  origin: { x: number; y: number },
  cellPx: number,
  gx: number,
  gy: number
) {
  await settleFrames(page);
  return { x: origin.x + (gx + 0.5) * cellPx, y: origin.y + (gy + 0.5) * cellPx };
}

/** Arms the cell painter and returns the geometry a click needs. */
async function armCellPainter(page: Page, id: number) {
  await openKufiPanel(page);
  await page.getByLabel("Paint cells").check();
  const origin = await blockClientBox(page, id);
  const block = await kufiBlock(page, id);
  const cellPx = (block.fontSize / 8) * (await getStageScale(page));
  return { origin, cellPx };
}

test.describe("square kufi", () => {
  test("adds a block that draws ink without a font", async ({ page }) => {
    await gotoApp(page);
    const id = await addKufi(page);

    // The block carries no usable font choice of its own — its letters are
    // cells, not outlines — so ink here proves the lattice renderer ran rather
    // than that a font resolved.
    const box = await blockClientBox(page, id);
    expect(box.width).toBeGreaterThan(0);
    await expect.poll(() => inkPixels(page, box)).toBeGreaterThan(50);
  });

  test("re-lays the grid when the text changes", async ({ page }) => {
    await gotoApp(page);
    const id = await addKufi(page);
    const before = await blockClientBox(page, id);

    // ا ل ل ه: four letters, three of them full-height, so the run is narrow.
    await setBlockText(page, "الله", id);
    await expect.poll(async () => (await blockClientBox(page, id)).width).not.toBe(
      before.width
    );
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
  });

  test("Fit to square wraps a long run into a panel", async ({ page }) => {
    await gotoApp(page);
    const id = await addKufi(page);
    await setBlockText(page, "لا اله الا الله محمد رسول الله", id);

    const band = await blockClientBox(page, id);
    // Unwrapped, this is a long strip — much wider than it is tall.
    expect(band.width / band.height).toBeGreaterThan(3);

    await openKufiPanel(page);
    await page.getByRole("button", { name: "Fit to square" }).click();

    await expect
      .poll(async () => {
        const block = (await getBlocks(page)).find((b) => b.id === id) as
          | { kufiColumns?: number }
          | undefined;
        return block?.kufiColumns ?? 0;
      })
      .toBeGreaterThan(0);

    const panel = await blockClientBox(page, id);
    const squareness = (b: { width: number; height: number }) =>
      Math.abs(b.width / b.height - 1);
    expect(squareness(panel)).toBeLessThan(squareness(band));
    expect(panel.height).toBeGreaterThan(band.height);
  });

  test("the panel-width dial wraps and unwraps the run", async ({ page }) => {
    await gotoApp(page);
    const id = await addKufi(page);
    await setBlockText(page, "السلام عليكم ورحمة الله", id);
    await openKufiPanel(page);

    const band = await blockClientBox(page, id);
    await page.locator('input[name^="kufiColumns"]').fill("24");
    await expect.poll(async () => (await blockClientBox(page, id)).height).toBeGreaterThan(
      band.height
    );

    // Back to 0 is the running band again — the dial is a wrap width, not a
    // one-way conversion into a panel.
    await page.locator('input[name^="kufiColumns"]').fill("0");
    await expect
      .poll(async () => Math.round((await blockClientBox(page, id)).height))
      .toBe(Math.round(band.height));
  });

  test("hides the font picker, which a lattice block has no use for", async ({ page }) => {
    await gotoApp(page);
    await addKufi(page);
    await openPanel(page, /^Typography/);

    // Font size and colour still apply; the family does not.
    await expect(page.getByLabel("Font size")).toBeVisible();
    await expect(page.getByText("Font family")).toHaveCount(0);
  });

  test("says which characters it could not draw", async ({ page }) => {
    await gotoApp(page);
    const id = await addKufi(page);
    await openKufiPanel(page);

    await setBlockText(page, "حرف A1", id);
    await expect(page.getByRole("status")).toContainText("Left out of the grid");

    // Tashkeel is not "unsupported" — square kufi has never drawn it, so it is
    // dropped in silence rather than reported as a failure.
    await setBlockText(page, "حَرْف", id);
    await expect(page.getByText("Left out of the grid")).toHaveCount(0);
  });

  test("paints a cell, and reports the ink that cell added", async ({ page }) => {
    await gotoApp(page);
    const id = await addKufi(page);
    // A full-height word on purpose: an empty block's grab surface has a
    // four-cell floor, and a short run sits inside it, so the box would not
    // visibly grow when the grid does.
    await setBlockText(page, "الله", id);
    const before = await blockClientBox(page, id);
    const { origin, cellPx } = await armCellPainter(page, id);

    const inkBefore = await inkPixels(page);
    // One row above the panel — outside the generated grid, so this also
    // exercises the origin shift: the block has to report a box that contains
    // the cell, or `exportBox` crops it out of every PNG.
    const pt = await cellPoint(page, origin, cellPx, 1, -1);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    // Off the lattice, so the hover highlight is not sitting over the ink.
    await page.mouse.move(origin.x, origin.y + before.height * 4);

    await expect.poll(() => cellEditCount(page, id)).toBe(1);
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(inkBefore);

    const grown = await blockClientBox(page, id);
    expect(grown.y).toBeLessThan(before.y);
    expect(grown.height).toBeGreaterThan(before.height);
  });

  test("a drag is one stroke, and one undo takes all of it back", async ({ page }) => {
    await gotoApp(page);
    const id = await addKufi(page);
    await setBlockText(page, "محمد", id);
    const { origin, cellPx } = await armCellPainter(page, id);

    const from = await cellPoint(page, origin, cellPx, 1, -1);
    const mid = await cellPoint(page, origin, cellPx, 2, -1);
    const to = await cellPoint(page, origin, cellPx, 3, -1);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();

    await expect.poll(() => cellEditCount(page, id)).toBe(3);

    // One entry per stroke, not per cell: history is pushed on mousedown and
    // the writes themselves push none.
    await page.keyboard.press("Control+z");
    await expect.poll(() => cellEditCount(page, id)).toBe(0);
  });

  test("keeps a painted cell on its letter when the panel is rewrapped", async ({
    page,
  }) => {
    await gotoApp(page);
    const id = await addKufi(page);
    await setBlockText(page, "السلام عليكم ورحمة", id);
    const { origin, cellPx } = await armCellPainter(page, id);

    const pt = await cellPoint(page, origin, cellPx, 4, -1);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => cellEditCount(page, id)).toBe(1);

    // Wrapping moves every absolute grid coordinate in the panel. The edit is
    // anchored to a letter, so it follows rather than being dropped.
    await page.locator('input[name^="kufiColumns"]').fill("22");
    await expect.poll(async () => (await blockClientBox(page, id)).height).toBeGreaterThan(
      cellPx * 8
    );
    expect(await cellEditCount(page, id)).toBe(1);
    await expect(page.getByText("no longer drawn")).toHaveCount(0);
  });

  test("clicking a painted cell again removes the entry rather than storing a no-op", async ({
    page,
  }) => {
    await gotoApp(page);
    const id = await addKufi(page);
    await setBlockText(page, "محمد", id);
    const { origin, cellPx } = await armCellPainter(page, id);

    const pt = await cellPoint(page, origin, cellPx, 1, -1);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => cellEditCount(page, id)).toBe(1);

    // The block's own origin has not moved — only the grid grew around it —
    // so the same page point is still the same cell.
    await page.mouse.move(pt.x + cellPx * 2, pt.y);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => cellEditCount(page, id)).toBe(0);
  });

  test("mirrors like any other block", async ({ page }) => {
    await gotoApp(page);
    const id = await addKufi(page);
    await setBlockText(page, "محمد", id);

    const before = (await getBlocks(page)).length;
    await page.locator('button[aria-label="Add mirror"]').click();
    await expect.poll(async () => (await getBlocks(page)).length).toBe(before + 1);

    const mirror = (await getBlocks(page)).at(-1)! as {
      id: number;
      type: string;
      sourceId?: number;
    };
    expect(mirror.type).toBe("mirror");
    expect(mirror.sourceId).toBe(id);

    await page.locator('button[aria-label="Reset view"]').click();
    // The mirror measures its own drag surface off what actually got drawn, so
    // wait for that box to reach a real size before reading ink from it.
    await expect
      .poll(async () => (await blockClientBox(page, mirror.id)).width)
      .toBeGreaterThan(20);
    const box = await blockClientBox(page, mirror.id);
    await expect.poll(() => inkPixels(page, box)).toBeGreaterThan(50);
  });
});
