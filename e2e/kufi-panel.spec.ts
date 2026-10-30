import { expect, test, type Page } from "@playwright/test";
import {
  STAGE_CANVAS,
  blockClientBox,
  centerOf,
  collectConsoleErrors,
  dragMouse,
  getBlocks,
  inkPixels,
  openPanel,
  setBlockText,
} from "./harf";

/**
 * The Kufi panel block: rendering, saving and export.
 *
 * The Add button and the Kufi panel sidebar land with the next task, so the
 * block is put on the canvas the other way a user gets one: by loading a
 * saved project (the quick-save `App.tsx` restores on boot). That also covers
 * the save path, since a `kufiPanel` block must survive the legacy sanitizer.
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
