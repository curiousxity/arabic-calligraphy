import { test, expect, type Page } from "@playwright/test";
import {
  gotoApp,
  getBlocks,
  blockClientBox,
  inkPixels,
  openPanel,
  placeAtCanvas,
  setBlockText,
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
