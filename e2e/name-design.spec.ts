import { test, expect, type Page } from "@playwright/test";
import { gotoApp, getBlocks, inkPixels, setBlockText } from "./harf";

/**
 * Name designs — the style gallery and the composition wizard, both reached
 * from the Content panel. Driven the way a user drives them (sidebar button,
 * dialog cards) and checked against the blocks the bridge reports, per the
 * harness's rules in CLAUDE.md.
 */

const OPEN = '[data-testid="name-design-open"]';
const STYLES = '[data-testid="name-design-styles"]';

/** The block a fresh session starts with. */
const SOURCE_ID = 1;

async function openWizard(page: Page): Promise<void> {
  await page.locator(OPEN).click();
  await expect(page.locator(STYLES)).toBeVisible();
}

/** Picks a style in the gallery and moves on to the layout step. */
async function chooseStyle(page: Page, fontKey: string): Promise<void> {
  await page.locator(`${STYLES} [data-font-key="${fontKey}"]`).click();
  await page.getByRole("button", { name: "Choose a layout" }).click();
  await expect(page.locator('[data-layout-id="muthanna"]')).toBeVisible();
}

async function createDesign(page: Page, layout: string): Promise<void> {
  await page.locator(`[data-layout-id="${layout}"]`).click();
  await page.getByRole("button", { name: "Create design" }).click();
}

test.describe("name designs", () => {
  test("the gallery previews the block's own text in every style", async ({ page }) => {
    await gotoApp(page);
    await setBlockText(page, "محمد");
    await openWizard(page);

    const cards = page.locator(`${STYLES} .nameStyleCard`);
    expect(await cards.count()).toBeGreaterThan(5);
    // Every card shows the name itself, which is the whole point of a gallery
    // over a dropdown of family names.
    await expect(cards.first().locator(".nameStyleSample")).toHaveText("محمد");
    await expect(
      page.locator(`${STYLES} [data-font-key="Kufi"] .nameStyleSample`)
    ).toHaveText("محمد");
  });

  test("picking a style rewrites the block in it without adding blocks", async ({ page }) => {
    await gotoApp(page);
    await setBlockText(page, "محمد");
    await openWizard(page);
    await chooseStyle(page, "Kufi");
    await createDesign(page, "single");

    await expect
      .poll(async () => (await getBlocks(page)).find((b) => b.id === SOURCE_ID)?.fontFamily)
      .toBe("Kufi");
    expect(await getBlocks(page)).toHaveLength(1);
  });

  test("muthanna adds a reflection that draws ink beside the name", async ({ page }) => {
    await gotoApp(page);
    await setBlockText(page, "محمد");
    const before = await inkPixels(page);

    await openWizard(page);
    await chooseStyle(page, "Kufi");
    await createDesign(page, "muthanna");

    await expect.poll(async () => (await getBlocks(page)).length).toBe(2);
    const blocks = await getBlocks(page);
    const mirror = blocks[1] as { type: string; sourceId?: number; mode?: string; x: number };
    expect(mirror.type).toBe("mirror");
    expect(mirror.sourceId).toBe(SOURCE_ID);
    expect(mirror.mode).toBe("mirrorX");
    // Spaced by the measured run rather than the fixed nudge a hand-added
    // mirror gets — the two halves must not sit on top of each other.
    const source = blocks[0] as { x: number };
    expect(mirror.x - source.x).toBeGreaterThan(100);
    // The reflection is really drawn, not merely recorded.
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(before);
  });

  test("a medallion turns the requested number of copies around the name", async ({ page }) => {
    await gotoApp(page);
    await setBlockText(page, "محمد");
    await openWizard(page);
    await chooseStyle(page, "Kufi");

    await page.locator('[data-layout-id="medallion"]').click();
    await page.locator("#name-design-radial-count").fill("8");
    await page.getByRole("button", { name: "Create design" }).click();

    await expect.poll(async () => (await getBlocks(page)).length).toBe(2);
    const mirror = (await getBlocks(page))[1] as {
      mode?: string;
      radialCount?: number;
      radialRadius?: number;
    };
    expect(mirror.mode).toBe("radial");
    expect(mirror.radialCount).toBe(8);
    expect(mirror.radialRadius).toBeGreaterThan(0);
  });

  test("a frame is inserted behind the name, not over it", async ({ page }) => {
    await gotoApp(page);
    await setBlockText(page, "محمد");
    await openWizard(page);
    await chooseStyle(page, "Kufi");
    await createDesign(page, "framed");

    await expect.poll(async () => (await getBlocks(page)).length).toBe(2);
    const blocks = await getBlocks(page);
    // Z-order is array order, so the frame must come first or it covers the
    // name it is meant to surround.
    expect(blocks[0].type).toBe("image");
    expect(blocks[1].id).toBe(SOURCE_ID);
    const frame = blocks[0] as { shapeWidth?: number; shapeHeight?: number };
    expect(frame.shapeWidth ?? 0).toBeGreaterThan(0);
    expect(frame.shapeHeight ?? 0).toBeGreaterThan(0);
  });

  test("a whole design is a single undo", async ({ page }) => {
    await gotoApp(page);
    await setBlockText(page, "محمد");
    const fontBefore = (await getBlocks(page))[0].fontFamily;

    await openWizard(page);
    await chooseStyle(page, "Kufi");
    await createDesign(page, "muthanna");
    await expect.poll(async () => (await getBlocks(page)).length).toBe(2);

    await page.keyboard.press("Control+z");
    // One step restores both halves of the change: the added reflection and
    // the style it was created in.
    await expect.poll(async () => (await getBlocks(page)).length).toBe(1);
    await expect.poll(async () => (await getBlocks(page))[0].fontFamily).toBe(fontBefore);
  });
});
