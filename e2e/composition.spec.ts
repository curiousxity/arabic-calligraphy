import { test, expect } from "@playwright/test";
import { addMedallionToSelected, gotoApp, getBlocks, setBlockText } from "./harf";
import { DEFAULT_RADIAL_COUNT } from "../src/lib/mirror";

/**
 * Block Controls' Add medallion: sets the selected text into a ring of
 * radial copies spaced by its measured run, checked against the blocks the
 * bridge reports.
 */

test.describe("medallion", () => {
  test("Add medallion turns copies of the text around it", async ({ page }) => {
    await gotoApp(page);
    await setBlockText(page, "محمد");
    const mirror = (await addMedallionToSelected(page)) as {
      mode?: string;
      radialCount?: number;
      radialRadius?: number;
    };
    expect(mirror.mode).toBe("radial");
    expect(mirror.radialCount ?? DEFAULT_RADIAL_COUNT).toBe(DEFAULT_RADIAL_COUNT);
    expect(mirror.radialRadius).toBeGreaterThan(0);
  });

  test("a medallion is a single undo", async ({ page }) => {
    await gotoApp(page);
    await setBlockText(page, "محمد");

    await addMedallionToSelected(page);

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await getBlocks(page)).length).toBe(1);
    expect((await getBlocks(page))[0].text).toBe("محمد");
  });
});
