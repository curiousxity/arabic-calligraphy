import { expect, test, type Page } from "@playwright/test";
import { blockClientBox, getBlocks, gotoApp, settleFrames } from "./harf";
import type { TextBlock } from "../src/types";

/**
 * The unit suites prove the solver and the layout against real shaping; what
 * only a browser shows is that the drawn lines come out the same width, that
 * bayt really puts the first misra' on the right, and that a whole Justify is
 * one undo.
 */

const POEM = ["محمد رسول الله", "بسم الله", "سلام عليكم ورحمة الله"];

async function verseLines(page: Page): Promise<TextBlock[]> {
  return (await getBlocks(page))
    .filter((b): b is TextBlock => b.type === "text" && b.verse !== undefined)
    .sort((a, b) => a.verse!.index - b.verse!.index);
}

async function createVerse(page: Page, layout: "Stacked" | "Bayt") {
  await page.getByRole("button", { name: "New verse…" }).click();
  const dialog = page.getByRole("dialog", { name: "New verse" });
  await dialog.getByLabel("Verse lines").fill(POEM.join("\n"));
  await dialog.getByLabel(layout).check();
  await dialog.getByRole("button", { name: "Create verse" }).click();
  await expect.poll(async () => (await verseLines(page)).length).toBe(3);
  await settleFrames(page);
}

async function widths(page: Page) {
  const lines = await verseLines(page);
  return Promise.all(lines.map(async (l) => (await blockClientBox(page, l.id)).width));
}

test("a new stacked verse justifies every line to the same width", async ({ page }) => {
  await gotoApp(page);
  await createVerse(page, "Stacked");
  await expect
    .poll(async () => {
      const w = await widths(page);
      return (Math.max(...w) - Math.min(...w)) / Math.max(...w);
    })
    .toBeLessThan(0.03);
  const lines = await verseLines(page);
  expect(lines[1].y).toBeGreaterThan(lines[0].y);
  expect(lines[0].x).toBeCloseTo(lines[1].x, 3);
});

test("bayt puts the first misra' on the right, the second on the left", async ({ page }) => {
  await gotoApp(page);
  await createVerse(page, "Bayt");
  const [a, b, c] = await verseLines(page);
  expect(a.x).toBeGreaterThan(b.x);
  expect(a.y).toBeCloseTo(b.y, 3);
  expect(c.y).toBeGreaterThan(a.y);
});

test("Justify twice changes nothing, and a width change is one undo", async ({ page }) => {
  await gotoApp(page);
  await createVerse(page, "Stacked");
  const before = (await verseLines(page)).map((l) => l.text);

  await page.getByRole("button", { name: "Justify", exact: true }).click();
  await settleFrames(page);
  expect((await verseLines(page)).map((l) => l.text)).toEqual(before);

  const wider = Math.round((await verseLines(page))[0].fontSize * 12);
  await page.getByLabel("Verse width").fill(String(wider));
  await page.getByLabel("Verse width").press("Enter");
  await expect.poll(async () => (await verseLines(page))[0].verse?.width).toBe(wider);
  await expect.poll(async () => (await verseLines(page)).map((l) => l.text)).not.toEqual(before);

  await page.getByRole("button", { name: "Justify", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await verseLines(page)).map((l) => l.text)).toEqual(before);
});
