import { expect, test, type Page } from "@playwright/test";
import { getBlocks, gotoApp, openPanel, openTypography, setBlockText } from "./harf";

/** U+0640 ARABIC TATWEEL — kept literal here so the spec asserts against the
 *  same character a user would type from the Specials row. */
const TATWEEL = "ـ";

/**
 * The horizontal extent of the ink on the stage, in device pixels.
 *
 * `inkPixels` in `harf.ts` counts dark pixels; this asks the different
 * question a kashida poses — did the run get *wider*? A count alone cannot
 * answer it (a longer connecting stroke adds ink, but so does any edit), so
 * this walks the same live canvas and returns the leftmost and rightmost
 * columns that carry ink. Same coarse "is this pixel dark" rule, same reason:
 * font rasterisation differs across machines, exact images flake.
 */
async function inkExtentX(page: Page): Promise<{ min: number; max: number; width: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".konvajs-content canvas");
    if (!canvas) return { min: 0, max: 0, width: 0 };
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { min: 0, max: 0, width: 0 };
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue;
      if (data[i] + data[i + 1] + data[i + 2] >= 330) continue;
      const x = (i / 4) % canvas.width;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    if (!Number.isFinite(min)) return { min: 0, max: 0, width: 0 };
    return { min, max, width: max - min };
  });
}

/** Opens Typography and waits for the Kashida controls inside it. */
async function openKashida(page: Page): Promise<void> {
  await openTypography(page);
  await expect(page.getByLabel("Kashida join")).toBeVisible();
}

const tatweelCount = (text: string) => [...text].filter((c) => c === TATWEEL).length;

test("stepping a kashida up widens the shaped run on the canvas", async ({ page }) => {
  await gotoApp(page);
  // Four dual-joining letters, so the picker offers three joins and the
  // middle one is unambiguously between two others.
  await setBlockText(page, "بسمل");
  await openKashida(page);

  const before = await inkExtentX(page);
  expect(before.width).toBeGreaterThan(0);

  await page.getByLabel("Kashida join").selectOption("1");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Lengthen kashida" }).click();
  }

  await expect.poll(async () => (await getBlocks(page))[0].text).toBe(
    `بس${TATWEEL.repeat(4)}مل`
  );
  await expect(page.getByLabel("Kashida length")).toHaveText("4");

  // The whole point of tatweel over the removed stroke-stretch kashida: the
  // run really is wider, not merely redrawn.
  await expect.poll(async () => (await inkExtentX(page)).width).toBeGreaterThan(before.width);
});

test("the picker offers no slot inside a lam-alef pair", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "بلا");
  await openKashida(page);

  // "بلا" joins beh-lam, and lam-alef is a fused ligature rather than a
  // stretchable join — so exactly one option, labelled with that pair.
  const options = page.getByLabel("Kashida join").locator("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toHaveText(`1. ب ${TATWEEL} ل`);
});

test("undo reverts a kashida step", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "بسمل");
  await openKashida(page);

  await page.getByRole("button", { name: "Lengthen kashida" }).click();
  await expect.poll(async () => (await getBlocks(page))[0].text).toBe(`ب${TATWEEL}سمل`);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await getBlocks(page))[0].text).toBe("بسمل");
});

test("a saved project round-trips the tatweels", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "بسمل");
  await openKashida(page);

  await page.getByRole("button", { name: "Lengthen kashida" }).click();
  await page.getByRole("button", { name: "Lengthen kashida" }).click();
  const stretched = (await getBlocks(page))[0].text;
  expect(tatweelCount(stretched)).toBe(2);

  await openPanel(page, /^Project & Export/);
  await page.getByPlaceholder("Project name…").fill("kashida-roundtrip");
  await page.getByRole("button", { name: "Save As" }).click();

  // Wipe the tatweels out before loading, so a pass cannot come from the
  // canvas simply never having changed.
  await setBlockText(page, "بسمل");

  await page.getByRole("button", { name: "Load kashida-roundtrip" }).click();
  await expect.poll(async () => (await getBlocks(page))[0].text).toBe(stretched);
});
