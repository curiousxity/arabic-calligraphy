import { expect, test, type Page } from "@playwright/test";
import {
  STAGE_CANVAS,
  blockClientBox,
  centerOf,
  collectConsoleErrors,
  dragMouse,
  getBlocks,
  gotoApp,
  inkPixels,
  openPanel,
  placeAtCanvas,
  setBlockText,
} from "./harf";

/**
 * The Kufi panel block: rendering, saving and export, the Add button and the
 * Kufi panel sidebar.
 *
 * The rendering tests put the block on the canvas by loading a saved project
 * (the quick-save `App.tsx` restores on boot), which also covers the save
 * path: a `kufiPanel` block must survive the legacy sanitizer. The sidebar
 * tests below add theirs with the Add button, as a user does.
 */

const STORAGE_KEY = "calligraphy-layout-v2";
const BAQARAH = "لا يكلف الله نفسا إلا وسعها";
const PANEL_ID = 1;

const savedProject = {
  version: 5,
  selectedId: PANEL_ID,
  backgroundColor: "#ffffff",
  blocks: [
    {
      id: PANEL_ID,
      type: "kufiPanel",
      // Too short for a 21×21 box: the panel loads with nothing drawn.
      text: "الله",
      x: 0,
      y: 0,
      fontSize: 48,
      color: "#1a1a1a",
      fontFamily: "Amiri",
      stroke: "#000000",
      strokeWidth: 0,
      shadowColor: "#000000",
      panelCols: 21,
      panelRows: 21,
    },
  ],
};

async function openSavedPanel(page: Page) {
  await page.addInitScript(
    ([key, value]) => {
      // Only on the first load, so a reload inside a test keeps what it saved.
      if (!sessionStorage.getItem("kufi-e2e-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("kufi-e2e-seeded", "1");
      }
    },
    [STORAGE_KEY, JSON.stringify(savedProject)] as const
  );
  await page.goto("/");
  await page.locator(STAGE_CANVAS).first().waitFor();
  await page.waitForFunction(() => !!window.__HARF__?.getStage()?.findOne("#block-1"));
}

test("a Kufi panel draws the phrase as one traced outline, on canvas and in SVG", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await openSavedPanel(page);

  const loaded = (await getBlocks(page)).find((b) => b.id === PANEL_ID);
  expect(loaded).toMatchObject({ type: "kufiPanel", panelCols: 21, panelRows: 21 });

  // ok:false (too short for the box) draws nothing inside the block.
  const box = await blockClientBox(page, PANEL_ID);
  expect(box.width).toBeGreaterThan(50);
  expect(await inkPixels(page, box)).toBe(0);

  // Watch the main thread while the first draft packs: the longest gap
  // between animation frames. On the main thread a draft freezes the UI for its whole search.
  await page.evaluate(() => {
    const w = window as unknown as { __kufiMaxGap: number };
    w.__kufiMaxGap = 0;
    let last = performance.now();
    const tick = (t: number) => {
      w.__kufiMaxGap = Math.max(w.__kufiMaxGap, t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await setBlockText(page, BAQARAH, PANEL_ID);

  // The first draft comes from the worker (~1 s): wait for real ink.
  const area = box.width * box.height;
  await expect.poll(async () => inkPixels(page, await blockClientBox(page, PANEL_ID))).toBeGreaterThan(area * 0.15);

  // It packed off the main thread: no frame waited anywhere near a draft's time.
  const maxGap = await page.evaluate(() => (window as unknown as { __kufiMaxGap: number }).__kufiMaxGap);
  // Measured: 17–33 ms with the worker, 450–480 ms when the same draft
  // packs on the main thread (this machine packs it in ~460 ms).
  // 300 ms leaves room for a loaded runner while staying well under that.
  expect(maxGap).toBeLessThan(300);

  await openPanel(page, /^Save & Export/);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("calligraphy.svg");
  let svg = "";
  for await (const chunk of await download.createReadStream()) svg += (chunk as Buffer).toString("utf8");

  // The panel is the only block, and it is one path: every ring of the
  // lattice traced into a single outline, holes and all.
  const paths = svg.match(/<path\b[^>]*>/g) ?? [];
  expect(paths).toHaveLength(1);
  const d = (paths[0] ?? "").match(/\sd="([^"]*)"/)?.[1] ?? "";
  // many rings (the counters are holes), all straight lines on the lattice
  expect((d.match(/M/g) ?? []).length).toBeGreaterThan(5);
  expect(d).not.toMatch(/[CQA]/);

  expect(errors).toEqual([]);
});

test("a Kufi panel with no ink is still grabbable at its box", async ({ page }) => {
  await openSavedPanel(page);
  const before = (await getBlocks(page)).find((b) => b.id === PANEL_ID)!;
  const box = await blockClientBox(page, PANEL_ID);
  const from = centerOf(box);
  await dragMouse(page, from, { x: from.x + 120, y: from.y + 60 });
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x)
    .toBeGreaterThan(before.x + 10);
});

// ---------------------------------------------------------------------------
// The Add button and the Kufi panel sidebar
// ---------------------------------------------------------------------------

/** The Kufi panel type panel's own region, so its Width/Height never match another panel's. */
const kufiPanel = (page: Page) => page.getByTestId("kufi-panel");
const sizeField = (page: Page, which: "Width" | "Height") =>
  kufiPanel(page).getByRole("spinbutton", { name: new RegExp(`^${which}`) });

async function addKufiPanel(page: Page): Promise<number> {
  const before = new Set((await getBlocks(page)).map((b) => b.id));
  await page.getByRole("button", { name: "Add Kufi panel" }).click();
  await placeAtCanvas(page, 0.5, 0.5);
  await expect
    .poll(async () => (await getBlocks(page)).some((b) => b.type === "kufiPanel" && !before.has(b.id)))
    .toBe(true);
  return (await getBlocks(page)).find((b) => b.type === "kufiPanel" && !before.has(b.id))!.id;
}

const panelOf = async (page: Page, id: number) => (await getBlocks(page)).find((b) => b.id === id) as
  | { type: string; panelCols: number; panelRows: number; strokeWidth: number; text: string }
  | undefined;

test("Add Kufi panel places a panel sized to its text, in one undo step", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await gotoApp(page);
  const id = await addKufiPanel(page);

  // A new panel starts at the size its text fits (الله packs at 9×9), with no outline.
  await expect.poll(async () => (await panelOf(page, id))?.panelCols).toBe(9);
  const added = (await panelOf(page, id))!;
  expect(added).toMatchObject({ type: "kufiPanel", panelCols: 9, panelRows: 9, strokeWidth: 0 });
  await expect(sizeField(page, "Width")).toHaveValue("9");
  await expect(sizeField(page, "Height")).toHaveValue("9");
  await expect.poll(async () => inkPixels(page, await blockClientBox(page, id))).toBeGreaterThan(0);

  // No font of its own: the Font panel and the font-only Content tools are gone.
  await expect(page.getByRole("button", { name: /^Font family\b/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear diacritics" })).toHaveCount(0);
  await expect(page.locator("summary", { hasText: /^Presets$/ })).toHaveCount(0);

  // The add and its fit are one step: a single undo removes the panel.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await getBlocks(page)).some((b) => b.id === id)).toBe(false);
  expect(errors).toEqual([]);
});

test("Fit sizes the panel to a new text, and undoes in one step", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await gotoApp(page);
  const id = await addKufiPanel(page);
  await expect(sizeField(page, "Width")).toHaveValue("9");

  await setBlockText(page, BAQARAH, id);
  await expect(kufiPanel(page)).toContainText("Too long for 9×9");

  await kufiPanel(page).getByRole("button", { name: "Fit" }).click();
  await expect(sizeField(page, "Width")).not.toHaveValue("9", { timeout: 20_000 });
  const fitted = (await panelOf(page, id))!;
  expect(fitted.panelCols).toBeGreaterThan(9);
  await expect(sizeField(page, "Height")).toHaveValue(String(fitted.panelRows));
  const box = await blockClientBox(page, id);
  await expect
    .poll(async () => inkPixels(page, await blockClientBox(page, id)), { timeout: 15_000 })
    .toBeGreaterThan(box.width * box.height * 0.15);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await panelOf(page, id))?.panelCols).toBe(9);
  expect((await panelOf(page, id))!.text).toBe(BAQARAH);
  expect(errors).toEqual([]);
});

test("a box too small for the text offers sizes that fit", async ({ page }) => {
  await gotoApp(page);
  const id = await addKufiPanel(page);
  await setBlockText(page, BAQARAH, id);
  await sizeField(page, "Width").fill("3");
  await sizeField(page, "Width").press("Enter");
  await sizeField(page, "Height").fill("3");
  await sizeField(page, "Height").press("Enter");
  await expect.poll(async () => [(await panelOf(page, id))?.panelCols, (await panelOf(page, id))?.panelRows]).toEqual([3, 3]);

  await expect(kufiPanel(page)).toContainText("Too long for 3×3 — try", { timeout: 15_000 });
  const suggestion = kufiPanel(page).getByRole("button", { name: /^\d+×\d+$/ }).first();
  const [cols, rows] = (await suggestion.innerText()).split("×").map(Number);
  await suggestion.click();
  await expect.poll(async () => [(await panelOf(page, id))?.panelCols, (await panelOf(page, id))?.panelRows]).toEqual([cols, rows]);
  await expect
    .poll(async () => inkPixels(page, await blockClientBox(page, id)), { timeout: 15_000 })
    .toBeGreaterThan(0);
});

test("letters the panel cannot draw are named", async ({ page }) => {
  await gotoApp(page);
  const id = await addKufiPanel(page);
  await setBlockText(page, "abc", id);
  await expect(kufiPanel(page)).toContainText("Not drawn: a b c");
});

test("a panel with an outline says the outline exports as its own path", async ({ page }) => {
  await gotoApp(page);
  const id = await addKufiPanel(page);
  await expect(kufiPanel(page)).not.toContainText("separate path");
  await openPanel(page, /^Effects/);
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  const width = page.getByRole("slider", { name: /^Outline width/ });
  await width.focus();
  await width.press("ArrowRight");
  await expect.poll(async () => (await panelOf(page, id))!.strokeWidth).toBeGreaterThan(0);
  await expect(kufiPanel(page)).toContainText("separate path");
});

test("a typed size is applied whole, in one undo step, with no upper cap", async ({ page }) => {
  await gotoApp(page);
  const id = await addKufiPanel(page);
  await expect(sizeField(page, "Width")).toHaveValue("9");

  const width = sizeField(page, "Width");
  await width.click();
  await width.press("ControlOrMeta+a");
  // "7" alone is a valid width: it must not be applied on the way to "75".
  await width.pressSequentially("75");
  await page.waitForTimeout(400);
  expect((await panelOf(page, id))!.panelCols).toBe(9);
  await width.press("Enter");
  await expect.poll(async () => (await panelOf(page, id))?.panelCols).toBe(75);
  await expect(width).toHaveValue("75");

  // An arrow key is a whole size of its own and applies at once. (Wait out
  // the history's 300 ms coalescing window so it is a step of its own.)
  await page.waitForTimeout(400);
  await width.focus();
  await width.press("ArrowUp");
  await expect.poll(async () => (await panelOf(page, id))?.panelCols).toBe(76);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await panelOf(page, id))?.panelCols).toBe(75);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await panelOf(page, id))?.panelCols).toBe(9);
});

test("a Fit that lands after another edit keeps that edit out of its undo step", async ({ page }) => {
  await gotoApp(page);
  const id = await addKufiPanel(page);
  await expect(sizeField(page, "Width")).toHaveValue("9");
  await openPanel(page, /^Typography/);
  await setBlockText(page, BAQARAH, id);

  await kufiPanel(page).getByRole("button", { name: "Fit" }).click();
  const swatch = page.getByRole("button", { name: "Set text color to #c9a227" });
  await swatch.click();
  // The colour changed while the Fit was still running (the worker is still
  // packing 9×9 Baqarah ahead of it), or this test proves nothing.
  await expect(kufiPanel(page)).toContainText("Finding a size");
  await expect.poll(async () => (await panelOf(page, id) as unknown as { color: string }).color).toBe("#c9a227");

  await expect(kufiPanel(page)).not.toContainText("Finding a size", { timeout: 20_000 });
  expect((await panelOf(page, id))!.panelCols).toBeGreaterThan(9);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await panelOf(page, id))?.panelCols).toBe(9);
  expect((await panelOf(page, id) as unknown as { color: string }).color).toBe("#c9a227");
});

test("a size typed while Fit runs is not overwritten by the Fit", async ({ page }) => {
  await gotoApp(page);
  const id = await addKufiPanel(page);
  await expect(sizeField(page, "Width")).toHaveValue("9");
  await setBlockText(page, BAQARAH, id);

  await kufiPanel(page).getByRole("button", { name: "Fit" }).click();
  await sizeField(page, "Width").fill("15");
  await sizeField(page, "Width").press("Enter");
  await expect.poll(async () => (await panelOf(page, id))?.panelCols).toBe(15);

  // Let any Fit answer arrive (the worker is idle again once 15×9 is packed).
  await expect(kufiPanel(page)).not.toContainText(/Finding a size|Arranging/, { timeout: 20_000 });
  await page.waitForTimeout(500);
  expect((await panelOf(page, id))!.panelCols).toBe(15);
  expect((await panelOf(page, id))!.panelRows).toBe(9);
});
