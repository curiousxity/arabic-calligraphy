import { test, expect, type Page } from "@playwright/test";
import { getBlocks, inkPixels, openPanel, STAGE_CANVAS } from "./harf";

/** Loads the app without dismissing the start screen (gotoApp does dismiss it). */
async function gotoFresh(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("start-screen")).toBeVisible();
}

test("a fresh load shows the start screen and typing updates every card", async ({ page }) => {
  await gotoFresh(page);
  const gallery = page.getByTestId("start-gallery");
  expect(await gallery.locator(".fontPickerCard").count()).toBeGreaterThan(10);
  await page.getByLabel("Your text").fill("محمد");
  await expect(gallery.locator('[data-font-key="Amiri"] .fontPickerSample')).toHaveText("محمد");
  await expect(gallery.locator('[data-font-key="Thuluth"] .fontPickerSample')).toHaveText("محمد");
  await expect(gallery.getByRole("heading", { name: "Naskh", exact: true })).toBeVisible();
});

test("picking a card lands in the editor with that text and font", async ({ page }) => {
  await gotoFresh(page);
  await page.getByLabel("Your text").fill("محمد");
  await page.getByTestId("start-gallery").locator('[data-font-key="Thuluth"]').click();
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
  await page.locator(STAGE_CANVAS).first().waitFor();
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
  const blocks = await getBlocks(page);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].text).toBe("محمد");
  expect(blocks[0].fontFamily).toBe("Thuluth");
});

test("an empty field falls back to the starter word", async ({ page }) => {
  await gotoFresh(page);
  await page.getByLabel("Your text").fill("");
  await page.getByTestId("start-gallery").locator('[data-font-key="Amiri"]').click();
  await expect.poll(async () => (await getBlocks(page))[0]?.text).toBe("حرف");
});

test("Skip opens the editor with the default block", async ({ page }) => {
  await gotoFresh(page);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
  expect((await getBlocks(page))[0].text).toBe("حرف");
});

test("a quick-save bypasses the start screen", async ({ page }) => {
  await gotoFresh(page);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
  // Quick save lives in the collapsed "Project & Export" panel (aria-label in Sidebar.tsx).
  await openPanel(page, /^Project & Export/);
  await page.getByRole("button", { name: "Quick save", exact: true }).click();
  await page.reload();
  await page.locator(STAGE_CANVAS).first().waitFor();
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
});

test("editor shortcuts do not act on the hidden block while the start screen is up", async ({ page }) => {
  await gotoFresh(page);
  await page.getByTestId("start-gallery").locator('[data-font-key="Amiri"]').focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
  const blocks = await getBlocks(page);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].x).toBe(0);
});

test("undo after picking a font does not bring back the default block", async ({ page }) => {
  await gotoFresh(page);
  const card = page.getByTestId("start-gallery").locator('[data-font-key="Thuluth"]');
  // A shortcut pressed on the overlay must not leave a history entry behind.
  await card.focus();
  await page.keyboard.press("Delete");
  await card.click();
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  const blocks = await getBlocks(page);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].fontFamily).toBe("Thuluth");
});

test("Space on a focused card picks it", async ({ page }) => {
  await gotoFresh(page);
  await page.getByTestId("start-gallery").locator('[data-font-key="Thuluth"]').focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
  expect((await getBlocks(page))[0].fontFamily).toBe("Thuluth");
});

test("Tab and Shift+Tab never reach the editor under the start screen", async ({ page }) => {
  await gotoFresh(page);
  // Where focus is: "start" inside the overlay, "page" when it has left the
  // document (Shift+Tab off the first control goes to the browser chrome, and
  // activeElement falls back to <body>), "editor" anywhere else.
  const where = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return "page";
      return el.closest('[data-testid="start-screen"]') ? "start" : "editor";
    });
  await page.getByLabel("Your text").focus();
  await page.keyboard.press("Shift+Tab");
  expect(await where()).not.toBe("editor");
  await page.getByLabel("Your text").focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await where()).toBe("start");
  }
  await page.getByLabel("Your text").focus();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await where()).not.toBe("editor");
  }
  // Enter wherever focus landed must not have added a block behind the overlay.
  await page.keyboard.press("Enter");
  expect(await getBlocks(page)).toHaveLength(1);
});
