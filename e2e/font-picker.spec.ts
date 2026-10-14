import { test, expect, type Page } from "@playwright/test";
import { chooseFont, getBlocks, gotoApp, openTypography, setBlockText } from "./harf";

/**
 * Typography's font picker: a button that opens a gallery of the block's
 * own text in every font, grouped by genre. One click applies and closes.
 */

const PICKER = '[data-testid="font-picker"]';

async function openPicker(page: Page): Promise<void> {
  await openTypography(page);
  await page.getByRole("button", { name: /^Font family\b/ }).click();
  await expect(page.locator(PICKER)).toBeVisible();
}

test("the picker previews the block's own text in every font, under genre headings", async ({
  page,
}) => {
  await gotoApp(page);
  await setBlockText(page, "محمد");
  const current = (await getBlocks(page))[0].fontFamily;
  await openPicker(page);

  const cards = page.locator(`${PICKER} .fontPickerCard`);
  expect(await cards.count()).toBeGreaterThan(10);
  // Every card shows the text itself — the point of a gallery over a list of
  // family names.
  await expect(page.locator(`${PICKER} [data-font-key="Kufi"] .fontPickerSample`)).toHaveText(
    "محمد"
  );
  for (const genre of ["Naskh", "Thuluth", "Kufi"]) {
    await expect(page.locator(PICKER).getByRole("heading", { name: genre, exact: true })).toBeVisible();
  }
  // It opens on the block's current font.
  await expect(page.locator(`${PICKER} [data-font-key="${current}"]`)).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("clicking a font applies it, closes the picker, and is one undo", async ({ page }) => {
  await gotoApp(page);
  const before = (await getBlocks(page))[0].fontFamily;
  expect(before).not.toBe("Amiri");

  await chooseFont(page, "Amiri");
  await expect(page.locator(PICKER)).toHaveCount(0);
  await expect.poll(async () => (await getBlocks(page))[0].fontFamily).toBe("Amiri");
  // The trigger now names the new font.
  await expect(page.getByRole("button", { name: /^Font family Amiri/ })).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await getBlocks(page))[0].fontFamily).toBe(before);
});

test("Escape closes the picker without changing the font", async ({ page }) => {
  await gotoApp(page);
  const before = (await getBlocks(page))[0].fontFamily;
  await openPicker(page);

  await page.keyboard.press("Escape");
  await expect(page.locator(PICKER)).toHaveCount(0);
  expect((await getBlocks(page))[0].fontFamily).toBe(before);
});

test("the dropdown is gone", async ({ page }) => {
  await gotoApp(page);
  await openTypography(page);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.locator(".fontSelectTrigger")).toHaveCount(0);
});

test("closing the picker hands focus back to the font row", async ({ page }) => {
  await gotoApp(page);
  await openPicker(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Font family\b/ })).toBeFocused();
});
