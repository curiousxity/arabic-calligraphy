import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chooseFont, getBlocks, gotoApp, inkPixels, openPanel, openTypography } from "./harf";

/**
 * A real font from `public/fonts/` is the upload fixture: the whole feature
 * is "bytes HarfBuzz can shape", so a synthesized file would only exercise
 * the rejection path. Lateef is deliberately *not* the default block font,
 * which is what makes "the canvas changed" observable.
 */
const FIXTURE_FONT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/fonts/Lateef.ttf"
);

const UPLOAD_LABEL = "E2E Naskh";

async function openFontPicker(page: Page): Promise<void> {
  await openTypography(page);
  await expect(page.getByRole("button", { name: "Font family" })).toBeVisible();
}

async function uploadFixtureFont(page: Page, label = UPLOAD_LABEL): Promise<void> {
  await page.getByRole("button", { name: "Upload a font…" }).click();
  const dialog = page.getByRole("dialog", { name: "Upload a font" });
  await expect(dialog).toBeVisible();

  await dialog.locator('input[type="file"]').setInputFiles(FIXTURE_FONT);
  // The label field appears only once the file has parsed, prefilled from the
  // font's own name table.
  const name = dialog.locator(".fontUploadLabelInput");
  await expect(name).toBeVisible();
  await expect(name).not.toHaveValue("");

  await name.fill(label);
  await dialog.getByRole("button", { name: "Add font" }).click();
  await expect(dialog).toHaveCount(0);
}

test("an uploaded font joins the picker and re-renders the block", async ({ page }) => {
  await gotoApp(page);
  await openFontPicker(page);

  const before = await inkPixels(page);
  expect(before).toBeGreaterThan(0);

  await uploadFixtureFont(page);

  // Listed as an uploaded font, and named what the user called it.
  await expect(page.locator(".customFontItem")).toHaveCount(1);
  await expect(page.locator(".customFontName")).toHaveText(UPLOAD_LABEL);

  await chooseFont(page, UPLOAD_LABEL, { uploaded: true });

  const block = (await getBlocks(page))[0];
  expect(block.fontFamily.startsWith("custom-")).toBe(true);
  // Shaping is async, so the canvas catches up a frame or two later. A
  // different typeface at the same size draws a different amount of ink —
  // coarse on purpose, this asks "did it re-render", not "does it look
  // exactly like this".
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
  await expect.poll(() => inkPixels(page)).not.toBe(before);
});

test("a saved project on an uploaded font reopens on it after a reload", async ({ page }) => {
  await gotoApp(page);
  await openFontPicker(page);
  await uploadFixtureFont(page);
  await chooseFont(page, UPLOAD_LABEL, { uploaded: true });
  const key = (await getBlocks(page))[0].fontFamily;

  // Saving is manual (there is no autosave), and the quick-save button lives
  // in the Project & Export panel, which starts collapsed.
  await openPanel(page, /^Project & Export/);
  await page.getByRole("button", { name: "Quick save" }).click();

  const payload = await page.evaluate(() => localStorage.getItem("calligraphy-layout-v2") ?? "");
  expect(payload).toContain(key);
  // By key only — the bytes must never reach the payload (a cloud row has
  // limits, and this font is ~200KB on its own).
  expect(payload.length).toBeLessThan(20_000);

  await page.reload();
  await gotoApp(page);
  await openFontPicker(page);

  // The font is stored in IndexedDB and re-primed at boot, so the reopened
  // project resolves its key rather than falling back.
  await expect(page.locator(".customFontName")).toHaveText(UPLOAD_LABEL);
  expect((await getBlocks(page))[0].fontFamily).toBe(key);
  await expect(page.locator(".fontMissingNotice")).toHaveCount(0);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
});

test("deleting a font a block uses says so instead of silently substituting", async ({
  page,
}) => {
  await gotoApp(page);
  await openFontPicker(page);
  await uploadFixtureFont(page);
  await chooseFont(page, UPLOAD_LABEL, { uploaded: true });
  const key = (await getBlocks(page))[0].fontFamily;

  await page.getByRole("button", { name: `Remove uploaded font ${UPLOAD_LABEL}` }).click();

  await expect(page.locator(".customFontItem")).toHaveCount(0);
  await expect(page.locator(".fontMissingNotice")).toContainText("using Noto Sans");
  // The block keeps its key — re-uploading the file must bring it back
  // rather than leave it rewritten to the fallback.
  expect((await getBlocks(page))[0].fontFamily).toBe(key);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
});

test("a file that isn't a font is refused with a message", async ({ page }) => {
  await gotoApp(page);
  await openFontPicker(page);

  await page.getByRole("button", { name: "Upload a font…" }).click();
  const dialog = page.getByRole("dialog", { name: "Upload a font" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("this is not a font".repeat(64)),
  });

  await expect(dialog.locator(".fontUploadError")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add font" })).toBeDisabled();
  await expect(page.locator(".customFontItem")).toHaveCount(0);
});
