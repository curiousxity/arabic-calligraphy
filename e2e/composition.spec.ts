import { test, expect } from "@playwright/test";
import { composeSelected, gotoApp, getBlocks, inkPixels, setBlockText } from "./harf";

/**
 * Compositions — the wizard reached from the Content panel that sets the
 * block's text into a pair or a medallion. Driven the way a user
 * drives it (sidebar button, dialog cards) and checked against the blocks the
 * bridge reports.
 */

/** The block a fresh session starts with. */
const SOURCE_ID = 1;

test.describe("compositions", () => {
  test("muthanna adds a reflection that draws ink beside the text, in its own font", async ({
    page,
  }) => {
    await gotoApp(page);
    // Long enough that the measured run is clearly wider than the 100px
    // threshold below in the default font, whatever that font is.
    await setBlockText(page, "عبد الرحمن");
    const fontBefore = (await getBlocks(page))[0].fontFamily;
    const before = await inkPixels(page);

    await composeSelected(page, "muthanna");

    const blocks = await getBlocks(page);
    const mirror = blocks[1] as { type: string; sourceId?: number; mode?: string; x: number };
    expect(mirror.type).toBe("mirror");
    expect(mirror.sourceId).toBe(SOURCE_ID);
    expect(mirror.mode).toBe("mirrorX");
    // Spaced by the measured run rather than the fixed nudge a hand-added
    // mirror gets — the two halves must not sit on top of each other.
    const source = blocks[0] as { x: number };
    expect(mirror.x - source.x).toBeGreaterThan(100);
    // The source keeps the font it had; the wizard no longer changes it.
    expect(blocks[0].fontFamily).toBe(fontBefore);
    // The reflection is really drawn, not merely recorded.
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(before);
  });

  test("a medallion turns the requested number of copies around the text", async ({ page }) => {
    await gotoApp(page);
    await setBlockText(page, "محمد");
    const mirror = (await composeSelected(page, "medallion", { radialCount: 8 })) as {
      mode?: string;
      radialCount?: number;
      radialRadius?: number;
    };
    expect(mirror.mode).toBe("radial");
    expect(mirror.radialCount).toBe(8);
    expect(mirror.radialRadius).toBeGreaterThan(0);
  });

  test("a whole composition is a single undo", async ({ page }) => {
    await gotoApp(page);
    await setBlockText(page, "محمد");

    await composeSelected(page, "muthanna");

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await getBlocks(page)).length).toBe(1);
    expect((await getBlocks(page))[0].text).toBe("محمد");
  });
});
