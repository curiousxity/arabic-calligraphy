import { expect, test, type Page } from "@playwright/test";
import { chooseFont, getBlocks, gotoApp, openPanel } from "./harf";

/**
 * Stream E — saveable text styles and palettes.
 *
 * The whole promise of a style is *what it does not carry*: applying one must
 * change how a block looks without touching what it says or where it sits.
 * Every assertion below is made through the read-only test bridge for that
 * reason — the styling fields and the content fields are checked in the same
 * breath, which a pixel assertion could not do.
 */

/** The Typography panel is collapsed on boot; the Styles row lives at its top. */
async function openTypography(page: Page): Promise<void> {
  await openPanel(page, /Typography/);
  await expect(page.getByLabel("Text style", { exact: true })).toBeVisible();
}

async function setTextColor(page: Page, hex: string): Promise<void> {
  const input = page.getByLabel("Text color hex value", { exact: true });
  await input.fill(hex);
  await input.press("Enter");
}

/** Clicks a Layers row by its default name, which is how a block is reselected. */
async function selectLayer(page: Page, id: number): Promise<void> {
  await page.getByText(`Block ${id}`, { exact: true }).click();
}

test("a saved style restyles another block without touching its text or position", async ({
  page,
}) => {
  await gotoApp(page);
  await openTypography(page);

  // Block 1 keeps the defaults. Block 2 is the one that gets a look worth
  // saving — duplicated rather than added, because adding starts a
  // click-to-place gesture and this test is about styles, not placement.
  await page.getByRole("button", { name: "Duplicate block" }).click();
  await expect.poll(async () => (await getBlocks(page)).length).toBe(2);

  // Not `setBlockText` — that helper polls block *0*, and the block being
  // edited here is the duplicate.
  await page.locator("textarea.sidebarTextarea").fill("ثاني");
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.id === 2)?.text)
    .toBe("ثاني");
  await chooseFont(page, "Kufi");
  await setTextColor(page, "#c9a227");

  const styled = (await getBlocks(page)).find((b) => b.id === 2)!;
  expect(styled.color.toLowerCase()).toBe("#c9a227");
  expect(styled.fontFamily).toBe("Kufi");

  await page.getByLabel("New text style name", { exact: true }).fill("Gold Kufi");
  await page.getByRole("button", { name: "Save style" }).click();

  // Now the other way round: block 1 still has its own text, place and look.
  await selectLayer(page, 1);
  const before = (await getBlocks(page)).find((b) => b.id === 1)!;
  expect(before.color.toLowerCase()).not.toBe("#c9a227");

  await page.getByLabel("Text style", { exact: true }).selectOption({ label: "Gold Kufi" });
  await page.getByRole("button", { name: "Apply" }).click();

  const after = (await getBlocks(page)).find((b) => b.id === 1)!;
  expect(after.color.toLowerCase()).toBe("#c9a227");
  expect(after.fontFamily).toBe("Kufi");
  // …and nothing a style has no business carrying moved.
  expect(after.text).toBe(before.text);
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  expect(after.id).toBe(1);
  expect(after.type).toBe(before.type);
});

test("applying a style is one undo step", async ({ page }) => {
  await gotoApp(page);
  await openTypography(page);

  await setTextColor(page, "#a3161b");
  await page.getByLabel("New text style name", { exact: true }).fill("Rubric");
  await page.getByRole("button", { name: "Save style" }).click();

  await setTextColor(page, "#123456");
  await page.getByLabel("Text style", { exact: true }).selectOption({ label: "Rubric" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect
    .poll(async () => (await getBlocks(page))[0].color.toLowerCase())
    .toBe("#a3161b");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => (await getBlocks(page))[0].color.toLowerCase())
    .toBe("#123456");
});

test("saved styles survive a reload; the shipped palettes are always there", async ({ page }) => {
  await gotoApp(page);
  await openTypography(page);

  await page.getByLabel("New text style name", { exact: true }).fill("Persistent");
  await page.getByRole("button", { name: "Save style" }).click();

  await page.reload();
  await gotoApp(page);
  await openTypography(page);

  await expect(page.getByLabel("Text style", { exact: true }).locator("option", { hasText: "Persistent" })).toHaveCount(1);
  // The defaults are code, not storage, so they are listed on a fresh profile
  // and after any amount of corruption in the user's own list.
  await expect(page.getByLabel("Palette", { exact: true }).locator("option", { hasText: "Manuscript" })).toHaveCount(1);
});

test("a palette swatch recolours the selected block", async ({ page }) => {
  await gotoApp(page);
  await openTypography(page);

  await page.getByLabel("Palette", { exact: true }).selectOption({ label: "Rubrication" });
  const swatches = page.getByRole("group", { name: "Rubrication colours" }).getByRole("button");
  await expect(swatches.first()).toBeVisible();

  const target = (await swatches.nth(2).getAttribute("aria-label"))!.replace("Use ", "");
  await swatches.nth(2).click();

  await expect
    .poll(async () => (await getBlocks(page))[0].color.toLowerCase())
    .toBe(target.toLowerCase());
});
