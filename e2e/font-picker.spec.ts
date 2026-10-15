import { test, expect, type Page } from "@playwright/test";
import {
  chooseFont,
  getBlocks,
  gotoApp,
  openFontGallery,
  openFontPanel,
  setBlockText,
  UPLOAD_LABEL,
  uploadFixtureFont,
} from "./harf";

/**
 * The Font panel's full gallery: a button that opens a gallery of the
 * block's own text in every font, grouped by genre. One click applies and
 * closes. The panel's strip is the one-click shortcut beside it.
 */

const PICKER = '[data-testid="font-picker"]';

async function openPicker(page: Page): Promise<void> {
  await expect(await openFontGallery(page)).toBeVisible();
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
  await openFontPanel(page);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.locator(".fontSelectTrigger")).toHaveCount(0);
});

test("closing the picker hands focus back to the font row", async ({ page }) => {
  await gotoApp(page);
  await openPicker(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Font family\b/ })).toBeFocused();
});

test("UKIJ Diwani is offered and the retired Layla Diwani is not", async ({ page }) => {
  await gotoApp(page);
  await openPicker(page);
  await expect(page.locator(`${PICKER} [data-font-key="UKIJDiwani"]`)).toBeVisible();
  await expect(page.locator(`${PICKER} [data-font-key="HarfCanvasDiwani"]`)).toHaveCount(0);
});

test("a saved block on the retired Layla Diwani still opens on it, and can leave it", async ({
  page,
}) => {
  await gotoApp(page);
  // Quick-save, then point the saved block at the retired key, as a project
  // saved before the retirement would be.
  await page.getByRole("button", { name: /^Project & Export/ }).click();
  await page.getByRole("button", { name: "Quick save" }).click();
  await page.evaluate(() => {
    const key = "calligraphy-layout-v2";
    const payload = JSON.parse(localStorage.getItem(key)!);
    const retarget = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(retarget);
      else if (node && typeof node === "object") {
        const rec = node as Record<string, unknown>;
        if (typeof rec.fontFamily === "string") rec.fontFamily = "HarfCanvasDiwani";
        Object.values(rec).forEach(retarget);
      }
    };
    retarget(payload);
    localStorage.setItem(key, JSON.stringify(payload));
  });
  await page.reload();
  await gotoApp(page);
  expect((await getBlocks(page))[0].fontFamily).toBe("HarfCanvasDiwani");

  // The row still names the font the block is on, and the gallery shows it
  // as the current choice.
  await openFontPanel(page);
  await expect(page.getByRole("button", { name: /^Font family Layla Diwani \(retired\)/ })).toBeVisible();
  await openPicker(page);
  await expect(page.locator(`${PICKER} [data-font-key="HarfCanvasDiwani"]`)).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // Once the block moves off it, it is gone from the gallery.
  await page.locator(`${PICKER} [data-font-key="UKIJDiwani"]`).click();
  await expect.poll(async () => (await getBlocks(page))[0].fontFamily).toBe("UKIJDiwani");
  await openPicker(page);
  await expect(page.locator(`${PICKER} [data-font-key="HarfCanvasDiwani"]`)).toHaveCount(0);
});

test("the Font panel's strip applies a font in one click and highlights it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "محمد");
  const strip = page.getByTestId("font-strip");
  await expect(strip).toBeVisible(); // the panel starts open
  await expect(strip.locator('[data-font-key="Amiri"] .fontStripSample')).toHaveText("محمد");
  const before = (await getBlocks(page))[0].fontFamily;
  expect(before).not.toBe("Amiri");

  await strip.locator('[data-font-key="Amiri"]').click();
  await expect.poll(async () => (await getBlocks(page))[0].fontFamily).toBe("Amiri");
  await expect(strip.locator('[data-font-key="Amiri"]')).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await getBlocks(page))[0].fontFamily).toBe(before);
});

test("a block on a font this browser lacks still shows the strip and the notice", async ({ page }) => {
  // The bridge is read-only, so reach the state through the UI: upload a
  // font, put the block on it, then remove the upload. The block now names a
  // key the catalogue no longer knows.
  await gotoApp(page);
  await uploadFixtureFont(page);
  await chooseFont(page, UPLOAD_LABEL, { uploaded: true });
  await page.getByRole("button", { name: `Remove uploaded font ${UPLOAD_LABEL}` }).click();
  await expect(page.getByTestId("font-strip")).toBeVisible();
  // Scoped to the notice itself: the sidebar has other `role="status"` rows
  // (the export status), and an unscoped role query would trip strict mode
  // whenever one of them is showing.
  const notice = page.locator(".fontMissingNotice");
  await expect(notice).toHaveAttribute("role", "status");
  await expect(notice).toContainText("isn't available");
});
