import { expect, test, type Page } from "@playwright/test";
import {
  STAGE_CANVAS,
  blockClientBox,
  centerOf,
  collectConsoleErrors,
  draggableDotCenters,
  dragMouse,
  getBlocks,
  getStageScale,
  gotoApp,
  hitTargetAt,
  inkPixels,
  nodeClientBox,
  kufiCellBox,
  kufiCellCenter,
  kufiEditTargets,
  namedNodeCount,
  namedNodeText,
  openPanel,
  placeAtCanvas,
  setBlockText,
  settleFrames,
  type Box,
} from "./harf";
import type Konva from "konva";
import type { KufiPanelEdits } from "../src/lib/kufi/kufiPack";

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

async function openSavedPanel(page: Page, project: object = savedProject) {
  await page.addInitScript(
    ([key, value]) => {
      // Only on the first load, so a reload inside a test keeps what it saved.
      if (!sessionStorage.getItem("kufi-e2e-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("kufi-e2e-seeded", "1");
      }
    },
    [STORAGE_KEY, JSON.stringify(project)] as const
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
  // Only the editor frame and its message are drawn there (no ink; the export test below checks that).
  expect(await namedNodeCount(page, "kufi-unfit-frame")).toBe(1);
  expect(await inkPixels(page, box)).toBeLessThan(box.width * box.height * 0.05);

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

test("Fit packs «سبحان الله» and draws it", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await gotoApp(page);
  const id = await addKufiPanel(page);
  await setBlockText(page, "سبحان الله", id);
  await kufiPanel(page).getByRole("button", { name: "Fit" }).click();

  // Fit runs in the worker and can take seconds: it lands on a rectangle, not a square.
  await expect.poll(async () => (await panelOf(page, id))?.panelCols, { timeout: 60_000 }).toBe(13);
  expect((await panelOf(page, id))!.panelRows).toBe(15);
  await expect(kufiPanel(page)).not.toContainText(/Too (long|short)/, { timeout: 60_000 });
  await expect.poll(() => namedNodeCount(page, "kufi-unfit-frame"), { timeout: 60_000 }).toBe(0);
  const box = await blockClientBox(page, id);
  await expect
    .poll(async () => inkPixels(page, await blockClientBox(page, id)), { timeout: 60_000 })
    .toBeGreaterThan(box.width * box.height * 0.15);
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

// ---------------------------------------------------------------------------
// Editing on the canvas: hover, click to cycle a form, drag a stroke end
// ---------------------------------------------------------------------------

/**
 * Baqarah at 21×21, the packer's own first draft (deterministic for a given
 * text and box). The units the tests touch were read off that draft:
 *
 * - unit 4, `feh:final`, drawn `feh.final.3`, has four forms; from it the
 *   next in table order (`.0`) does not pack and `.1` does, and from `.1`
 *   `.2` does not and `.3` does — so two clicks skip two forms and come back.
 * - unit 2, `kaf:medial`, has a column stretch whose ends on the right
 *   (dc = 1) pack at +1 and +2.
 * - unit 3, `lam:medial`, is drawn shortened (`[-2]`); pulling its stem up
 *   by one or two cells does not pack.
 * - unit 2 pinned at its 21×21 place (by the +2 stretch) cannot stay in a
 *   20×20 box: `pinConflict`; released, 20×20 is "Too long".
 */
const savedBaqarah = {
  ...savedProject,
  // Centred on the view (the block draws from its top-left; a 21-cell box is
  // 126 px), so every letter is on screen and clear of the canvas controls
  // in the corners, which would take the pointer before the stage does.
  blocks: [{ ...savedProject.blocks[0], text: BAQARAH, x: -63, y: -63 }],
};

async function openBaqarahPanel(page: Page): Promise<Box> {
  await openSavedPanel(page, savedBaqarah);
  const box = await blockClientBox(page, PANEL_ID);
  await expect
    .poll(async () => inkPixels(page, await blockClientBox(page, PANEL_ID)), { timeout: 15_000 })
    .toBeGreaterThan(box.width * box.height * 0.15);
  // the overlay is up once the draft is drawn
  await expect.poll(async () => (await kufiEditTargets(page)).letters.length).toBeGreaterThan(0);
  return box;
}

/**
 * Keeps the explore worker from loading, so the panel never learns its
 * letters' options: the canvas falls back to asking the packer, as it does
 * before exploration has reached a letter. The tests of that fallback (a
 * refused pull snaps back and says why) use it, since in a live browser the
 * exploration's repacks run on a clock and may or may not reach a count the
 * drag's own repack refuses.
 */
async function withoutExploration(page: Page) {
  await page.route(/kufiExplore\.worker/, (route) => route.abort());
}

/** Waits until the explore worker has tried every single change to the panel as drawn. */
async function explored(page: Page) {
  await expect(kufiPanel(page)).not.toContainText("Looking…", { timeout: 60_000 });
}

/** Waits until the selected letter's forms have all been tried. */
async function formsExplored(page: Page) {
  const options = kufiPanel(page).getByTestId("kufi-letter-options");
  await expect(options).toBeVisible();
  await expect(options).not.toContainText("Checking…", { timeout: 60_000 });
}

const panelEdits = async (page: Page) =>
  ((await getBlocks(page)).find((b) => b.id === PANEL_ID) as { panelEdits?: KufiPanelEdits } | undefined)?.panelEdits;

/** Ink per quadrant of a box: coarse, but a letter that moved or grew changes it. */
async function inkSignature(page: Page, box: Box): Promise<number[]> {
  const w = box.width / 2;
  const h = box.height / 2;
  const out: number[] = [];
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]])
    out.push(await inkPixels(page, { x: box.x + fx * w, y: box.y + fy * h, width: w, height: h }));
  return out;
}

/** Parks the pointer off the panel, so no hover chrome is in the pixels read next. */
async function pointerAway(page: Page, box: Box) {
  await page.mouse.move(box.x - 40, box.y - 40);
  await settleFrames(page);
}

type KufiToolName = "Select" | "Stretch" | "Move word" | "Paint";
/** Picks a canvas tool from the Kufi panel's tool row. */
async function chooseTool(page: Page, name: KufiToolName) {
  const button = kufiPanel(page).getByRole("button", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

/** The refusal or confirmation drawn beside the letter on the canvas, or null when none is up. */
const canvasNotice = (page: Page) => namedNodeText(page, "kufi-notice");
/** Waits for the notice beside the letter to fade, so it is not in the pixels read next. */
const noticeGone = (page: Page) => expect.poll(() => namedNodeCount(page, "kufi-notice"), { timeout: 5_000 }).toBe(0);

// One worker, in order: each of these packs the 21×21 draft in the packer's
// worker inside its time budget, and four drafts racing on one machine can
// run that budget out and leave a different (or no) panel to edit.
test.describe("editing on the canvas", () => {
  test.describe.configure({ mode: "default" });

  test("the tool row picks which handles show", async ({ page }) => {
    const box = await openBaqarahPanel(page);
    await pointerAway(page, box);
    const targets = await kufiEditTargets(page);
    const kaf = targets.letters.find((l) => l.unit === 2)!;
    const word = targets.words.find((w) => w.word === 2)!;
    for (const name of ["Select", "Stretch", "Move word", "Paint"])
      await expect(kufiPanel(page).getByRole("button", { name, exact: true })).toBeVisible();

    // Select, the default: the letter outlines, and no handle of any kind shows.
    await expect(kufiPanel(page).getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(kaf.x, kaf.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-hover-outline")).toBeGreaterThan(0);
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBe(0);
    expect(await namedNodeCount(page, "kufi-route-handle")).toBe(0);

    // Stretch: the hovered letter's stretch ends, and no route handle.
    await chooseTool(page, "Stretch");
    await page.mouse.move(kaf.x, kaf.y);
    await page.mouse.move(kaf.x + 1, kaf.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBeGreaterThan(0);
    expect(await namedNodeCount(page, "kufi-route-handle")).toBe(0);

    // Move word: the route handles, on each word's first letter, and no stretch end.
    await chooseTool(page, "Move word");
    await page.mouse.move(word.x, word.y);
    await page.mouse.move(word.x + 1, word.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-route-handle")).toBeGreaterThan(0);
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBe(0);

    // Paint: a cell outline and no letter chrome; a plain click paints, one step.
    await chooseTool(page, "Paint");
    const t = await kufiEditTargets(page);
    const cell = paintableCell(t.grid)!;
    const at = kufiCellCenter(t, cell.col, cell.row);
    await page.mouse.move(at.x, at.y);
    await page.mouse.move(at.x + 1, at.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-cell-outline")).toBe(1);
    expect(await namedNodeCount(page, "kufi-hover-outline")).toBe(0);
    await page.mouse.click(at.x + 1, at.y);
    await expect.poll(async () => (await panelEdits(page))?.cells?.length).toBe(1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
  });

  test("a refusal shows beside the letter and fades", async ({ page }) => {
    await withoutExploration(page);
    const box = await openBaqarahPanel(page);
    await pointerAway(page, box);
    const cellPx = 6 * (await getStageScale(page));
    await chooseTool(page, "Stretch");
    // unit 8, seen:medial on the full top line: no stretch of it packs
    const grip = (await kufiEditTargets(page)).ends.find((e) => e.unit === 8)!;
    expect(grip).toBeDefined();
    await page.mouse.move(grip.x, grip.y);
    await settleFrames(page);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.dc * 2 * cellPx, grip.y, { steps: 12 });
    await page.waitForTimeout(1200);
    await page.mouse.up();

    await expect.poll(() => canvasNotice(page)).toBe("No room to stretch that here");
    await expect(kufiPanel(page)).not.toContainText("No room");
    // beside the letter: the label sits within a few cells of the pulled grip
    const near = await page.evaluate(() => {
      const stage = window.__HARF__!.getStage()!;
      const r = stage.findOne(".kufi-notice")!.getClientRect();
      const c = stage.container().getBoundingClientRect();
      return { x: r.x + c.left, y: r.y + c.top, width: r.width, height: r.height };
    });
    const dx = Math.max(near.x - grip.x, 0, grip.x - (near.x + near.width));
    const dy = Math.max(near.y - grip.y, 0, grip.y - (near.y + near.height));
    expect(Math.hypot(dx, dy)).toBeLessThan(8 * cellPx);
    await page.waitForTimeout(2500);
    expect(await namedNodeCount(page, "kufi-notice")).toBe(0);
  });

  test("hovering a letter outlines it, a click picks it, and a click on the picked letter cycles its form to the next one that packs, one step per click", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectConsoleErrors(page);
    const box = await openBaqarahPanel(page);
    await pointerAway(page, box);
    const before = await inkSignature(page, box);

    const letter = (await kufiEditTargets(page)).letters.find((l) => l.unit === 4)!;
    expect(letter).toMatchObject({ glyphId: "feh.final.3", forms: 4 });

    // Hover: an outline in one listening node, and no coloured dots anywhere.
    await page.mouse.move(letter.x, letter.y);
    await settleFrames(page);
    expect(await hitTargetAt(page, letter)).toBe("Rect.kufi-edit-hit");
    expect(await namedNodeCount(page, "kufi-hover-outline")).toBeGreaterThan(0);
    expect(await namedNodeCount(page, "kufi-edit-hit")).toBe(1);
    expect(await draggableDotCenters(page)).toEqual([]);

    // A first click only picks the letter: its options show, nothing changes.
    await explored(page);
    await page.mouse.click(letter.x, letter.y);
    await expect(kufiPanel(page).getByTestId("kufi-letter-options")).toBeVisible();
    await page.waitForTimeout(400);
    expect(await panelEdits(page)).toBeUndefined();

    // A click on the picked letter: the next form in table order that packs
    // (`.0` does, with filler bars), pinned where it landed; once explored, it
    // comes from the exploration's try.
    await page.mouse.click(letter.x, letter.y);
    await expect.poll(async () => (await panelEdits(page))?.forms?.[4]).toBe("feh.final.0");
    expect((await panelEdits(page))?.pinned?.[4]).toMatchObject({ unitIndex: 4, glyphId: "feh.final.0" });
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).not.toEqual(before);

    // The outline follows the letter, still picked; another click goes on to the next form.
    const again = (await kufiEditTargets(page)).letters.find((l) => l.unit === 4)!;
    expect(again.glyphId).toBe("feh.final.0");
    await formsExplored(page);
    await page.mouse.click(again.x, again.y);
    await expect.poll(async () => (await panelEdits(page))?.forms?.[4]).toBe("feh.final.1");

    // Two clicks, two steps.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await panelEdits(page))?.forms?.[4]).toBe("feh.final.0");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);
    expect(errors).toEqual([]);
  });

  test("a press on a letter that drifts drags the whole panel, and changes no letter", async ({ page }) => {
    await openBaqarahPanel(page);
    const x0 = (await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x;
    const letter = (await kufiEditTargets(page)).letters.find((l) => l.unit === 4)!;
    await dragMouse(page, letter, { x: letter.x + 120, y: letter.y + 60 });
    await expect.poll(async () => (await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x).toBeGreaterThan(x0 + 10);
    expect(await panelEdits(page)).toBeUndefined();

    // A jittery click (a few px of drift) nudges the panel and is not also a
    // form change: one step, not two.
    // (past the history's 300 ms coalescing window, so the nudge is a step of its own)
    await page.waitForTimeout(400);
    const x1 = (await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x;
    const again = (await kufiEditTargets(page)).letters.find((l) => l.unit === 4)!;
    await page.mouse.move(again.x, again.y);
    await page.mouse.down();
    await page.mouse.move(again.x + 4, again.y + 2, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x).not.toBe(x1);
    await page.waitForTimeout(600);
    expect(await panelEdits(page)).toBeUndefined();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x).toBe(x1);
  });

  test("in the Stretch tool a click on a handle, with no pull, selects the letter and changes nothing; in Select a one-form letter says so beside it", async ({ page }) => {
    await withoutExploration(page);
    await openBaqarahPanel(page);
    await chooseTool(page, "Stretch");
    const targets = await kufiEditTargets(page);
    // an end handle of the feh (four forms): pressing and releasing on it selects the letter, no form change
    const end = targets.ends.find((e) => e.unit === 4)!;
    expect(end).toBeDefined();
    await page.mouse.move(end.x, end.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBeGreaterThan(0);
    await page.mouse.click(end.x, end.y);
    await expect(kufiPanel(page).getByTestId("kufi-letter-options")).toBeVisible();
    await page.waitForTimeout(600);
    expect(await panelEdits(page)).toBeUndefined();
    // Select: a first click on the seen (one form) picks it and says nothing;
    // a click on the picked letter reaches its form and says so beside it
    await chooseTool(page, "Select");
    const seen = (await kufiEditTargets(page)).letters.find((l) => l.unit === 8)!;
    await page.mouse.click(seen.x, seen.y);
    await expect(kufiPanel(page).getByTestId("kufi-letter-options")).toContainText("That letter has one form");
    await page.waitForTimeout(400);
    expect(await canvasNotice(page)).toBeNull();
    await page.mouse.click(seen.x, seen.y);
    await expect.poll(() => canvasNotice(page)).toBe("That letter has one form");
  });

  test("a drag cut short by losing the selection commits nothing and leaves no preview drawn", async ({ page }) => {
    const box = await openBaqarahPanel(page);
    await chooseTool(page, "Stretch");
    await pointerAway(page, box);
    const before = await inkSignature(page, box);
    const cellPx = 6 * (await getStageScale(page));
    const targets = await kufiEditTargets(page);
    const end = targets.ends.find((e) => e.unit === 2 && e.si === 0 && e.dc === 1 && e.dr === 0)!;
    const leftEndBefore = targets.ends.find((e) => e.unit === 2 && e.dc === -1)!;

    // Copy the panel first; pasting mid-drag selects the copy and so unmounts
    // the overlay while the stretch is still held.
    await page.keyboard.press("ControlOrMeta+c");
    await page.mouse.move(end.x, end.y);
    await settleFrames(page);
    await page.mouse.down();
    await page.mouse.move(end.x + 2 * cellPx, end.y, { steps: 12 });
    await expect
      .poll(async () => (await kufiEditTargets(page)).ends.find((e) => e.unit === 2 && e.dc === -1)?.x, { timeout: 5_000 })
      .toBeLessThan(leftEndBefore.x - 1.5 * cellPx);
    await page.keyboard.press("ControlOrMeta+v");
    await expect.poll(async () => (await getBlocks(page)).length).toBe(2);
    await page.mouse.up();

    // The copy is gone again; the panel is unselected and draws its own layout.
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await getBlocks(page)).length).toBe(1);
    await pointerAway(page, box);
    await expect.poll(async () => inkSignature(page, box)).toEqual(before);
    expect(await panelEdits(page)).toBeUndefined();
  });

  test("in the Stretch tool, hovering a letter shows every one of its stretch ends", async ({ page }) => {
    await withoutExploration(page);
    await openBaqarahPanel(page);
    await chooseTool(page, "Stretch");
    const targets = await kufiEditTargets(page);
    const letter = targets.letters.find((l) => l.unit === 2)!;
    const ends = targets.ends.filter((e) => e.unit === 2).length;
    expect(ends).toBeGreaterThan(1);
    await page.mouse.move(letter.x, letter.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-hover-outline")).toBeGreaterThan(0);
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBe(ends);
  });

  test("a baseline joined on both sides still has a grip on its stretch slice", async ({ page }) => {
    await withoutExploration(page);
    const box = await openBaqarahPanel(page);
    await chooseTool(page, "Stretch");
    await pointerAway(page, box);
    const before = await inkSignature(page, box);
    const cellPx = 6 * (await getStageScale(page));
    // unit 8, seen:medial on the top line: no free end, so its column slice carries the grip
    const grips = (await kufiEditTargets(page)).ends.filter((e) => e.unit === 8);
    expect(grips.length).toBeGreaterThan(0);
    expect(grips.every((g) => g.kind === "slice" && g.dr === 0)).toBe(true);
    const grip = grips[0];

    await page.mouse.move(grip.x, grip.y);
    await settleFrames(page);
    expect(await hitTargetAt(page, grip)).toBe("Rect.kufi-edit-hit");
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBe(grips.length);

    // The top line is full, so no stretch of it packs: the pull snaps back and says so.
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.dc * 2 * cellPx, grip.y, { steps: 12 });
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await expect.poll(() => canvasNotice(page)).toBe("No room to stretch that here");
    expect(await panelEdits(page)).toBeUndefined();
    await noticeGone(page);
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);
  });

  test("dragging a stretch end two cells previews live, commits one step on release, and undoes", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const box = await openBaqarahPanel(page);
    await chooseTool(page, "Stretch");
    await pointerAway(page, box);
    const before = await inkSignature(page, box);
    const cellPx = 6 * (await getStageScale(page));

    const targets = await kufiEditTargets(page);
    const end = targets.ends.find((e) => e.unit === 2 && e.si === 0 && e.dc === 1 && e.dr === 0)!;
    expect(end).toBeDefined();
    const leftEndBefore = targets.ends.find((e) => e.unit === 2 && e.dc === -1)!;

    // Hover the end: the one handle, a small square, mounts; still one listening node.
    await page.mouse.move(end.x, end.y);
    await settleFrames(page);
    expect(await hitTargetAt(page, end)).toBe("Rect.kufi-edit-hit");
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBeGreaterThan(0);
    expect(await draggableDotCenters(page)).toEqual([]);

    // Watch the main thread through the drag: the longest gap between frames.
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

    await page.mouse.down();
    await page.mouse.move(end.x + 2 * cellPx, end.y, { steps: 12 });
    // Live: the letter has grown in the drawn panel (its far end moved two
    // cells) while nothing is committed yet.
    await expect
      .poll(async () => (await kufiEditTargets(page)).ends.find((e) => e.unit === 2 && e.dc === -1)?.x, { timeout: 5_000 })
      .toBeLessThan(leftEndBefore.x - 1.5 * cellPx);
    expect(await panelEdits(page)).toBeUndefined();
    await page.mouse.up();

    await expect.poll(async () => (await panelEdits(page))?.stretch?.[2]).toEqual([2]);
    expect((await panelEdits(page))?.pinned?.[2]).toMatchObject({ unitIndex: 2, stretch: [2] });
    const maxGap = await page.evaluate(() => (window as unknown as { __kufiMaxGap: number }).__kufiMaxGap);
    // The previews pack in the worker (median 60 ms, at most ~150 ms each on
    // this machine); on the main thread each would hold a frame for that long.
    expect(maxGap).toBeLessThan(300);
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).not.toEqual(before);

    // One step: undo restores the draft exactly.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);
    expect(errors).toEqual([]);
  });

  test("dragging a word's route handle along its path asks the packer to move the word; where nothing packs it snaps back and says why", async ({ page }) => {
    const box = await openBaqarahPanel(page);
    await chooseTool(page, "Move word");
    await pointerAway(page, box);
    const before = await inkSignature(page, box);
    const x0 = (await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x;
    const targets = await kufiEditTargets(page);
    // الله (unit 5) opens word 2 on the left side, reading upward; it is wedged
    // between the bottom and top bands, so no offset along its path packs.
    const word = targets.words.find((w) => w.word === 2)!;
    expect(word).toMatchObject({ unit: 5, dc: 0, dr: -1 });
    const letter = targets.letters.find((l) => l.unit === 5)!;
    // the handle is on the letter's leading cell, away from the cell the letter is pressed on below
    expect(Math.hypot(word.x - letter.x, word.y - letter.y)).toBeGreaterThan(targets.cellPx);

    // Hovering the handle shows it (and no stretch handle in its place).
    await page.mouse.move(word.x, word.y);
    await settleFrames(page);
    expect(await hitTargetAt(page, word)).toBe("Rect.kufi-edit-hit");
    expect(await namedNodeCount(page, "kufi-route-handle")).toBeGreaterThan(0);
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBe(0);
    await page.mouse.down();
    await page.mouse.move(word.x + word.dc * 2 * targets.cellPx, word.y + word.dr * 2 * targets.cellPx, { steps: 12 });
    // give the previews time to be asked for, refused, and asked for once more
    await page.waitForTimeout(1200);
    await page.mouse.up();

    await expect.poll(() => canvasNotice(page)).toBe("No room to move that word here");
    expect(await panelEdits(page)).toBeUndefined();
    // the press was the word's, not the panel's: nothing moved
    expect((await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x).toBe(x0);
    await noticeGone(page);
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

    // In Select, a still press on the first letter is a click on the letter:
    // the first picks it, and the next (on the picked letter) cycles its form;
    // الله has three forms, so that click either lands one or says none fits.
    await chooseTool(page, "Select");
    await page.mouse.click(letter.x, letter.y);
    await expect(kufiPanel(page).getByTestId("kufi-letter-options")).toBeVisible();
    await page.waitForTimeout(400);
    expect(await panelEdits(page)).toBeUndefined();
    await page.mouse.click(letter.x, letter.y);
    await expect
      .poll(async () => (await panelEdits(page))?.forms?.[5] !== undefined || (await canvasNotice(page)) === "No other form of that letter fits here")
      .toBe(true);
    await page.waitForTimeout(400);

    // A press elsewhere on a first letter that drifts drags the whole panel, not the word.
    const x1 = (await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x;
    const again = (await kufiEditTargets(page)).letters.find((l) => l.unit === 5)!;
    await dragMouse(page, again, { x: again.x + 120, y: again.y + 60 });
    await expect.poll(async () => (await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x).toBeGreaterThan(x1 + 10);
    expect((await panelEdits(page))?.routes).toBeUndefined();
  });

  /**
   * نصر من الله at 15×9: نصر along the bottom, من up the left side (unit 3,
   * the م, opens word 1 at the bottom-left corner), الله along the top. The
   * ص before the corner has a stretch along the bottom line, so من can be
   * dragged two cells up its path: the ص lengthens by two and the ر moves
   * into the corner under the م. One cell up would not pack (the ر has no
   * room under a م moved only one), so the drag steps two cells at a time
   * and never asks for it.
   */
  const NASR = "نصر من الله";
  const savedNasr = {
    ...savedProject,
    blocks: [{ ...savedProject.blocks[0], text: NASR, x: -45, y: -27, panelCols: 15, panelRows: 9 }],
  };

  test("dragging a word's first letter along its path moves the word: live preview, one step on release, undo restores", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openSavedPanel(page, savedNasr);
    const box = await blockClientBox(page, PANEL_ID);
    await expect
      .poll(async () => inkPixels(page, await blockClientBox(page, PANEL_ID)), { timeout: 15_000 })
      .toBeGreaterThan(box.width * box.height * 0.15);
    await expect.poll(async () => (await kufiEditTargets(page)).letters.length).toBe(6);
    await pointerAway(page, box);
    const before = await inkSignature(page, box);
    const targets = await kufiEditTargets(page);
    const word = targets.words.find((w) => w.word === 1)!;
    expect(word).toMatchObject({ unit: 3, dc: 0, dr: -1 });
    const letter = targets.letters.find((l) => l.unit === 3)!;
    const rowOf = (y: number) => Math.floor((y - targets.origin.y) / targets.cellPx);
    const meemRow = rowOf(letter.y);

    // the word is dragged by its route handle, on the م's leading cell
    await chooseTool(page, "Move word");
    await page.mouse.move(word.x, word.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-route-handle")).toBeGreaterThan(0);
    await page.mouse.down();
    await page.mouse.move(word.x, word.y - 2 * targets.cellPx, { steps: 12 });
    // live: the م has moved two cells up its line in the drawn panel while nothing is committed
    await expect
      .poll(async () => rowOf((await kufiEditTargets(page)).letters.find((l) => l.unit === 3)!.y), { timeout: 5_000 })
      .toBe(meemRow - 2);
    expect(await panelEdits(page)).toBeUndefined();
    await page.mouse.up();

    // committed: the route recorded, every letter of the word pinned where it landed, one step
    await expect.poll(async () => (await panelEdits(page))?.routes?.[1]).toBe(2);
    const edits = (await panelEdits(page))!;
    expect(edits.pinned?.[3]).toMatchObject({ unitIndex: 3, key: "meem:initial" });
    expect(edits.pinned?.[4]).toMatchObject({ unitIndex: 4, key: "noon:final" });
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).not.toEqual(before);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  /**
   * The same panel, word 0 (نصر, along the bottom) dragged two cells on: no
   * nearer change makes room, so the packer rearranges the panel round it,
   * moving two other letters, which the preview outlines.
   */
  test("Move word rearranges the panel and one undo restores it", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openSavedPanel(page, savedNasr);
    const box = await blockClientBox(page, PANEL_ID);
    await expect
      .poll(async () => inkPixels(page, await blockClientBox(page, PANEL_ID)), { timeout: 15_000 })
      .toBeGreaterThan(box.width * box.height * 0.15);
    await expect.poll(async () => (await kufiEditTargets(page)).letters.length).toBe(6);
    await pointerAway(page, box);
    const before = await inkSignature(page, box);
    const targets = await kufiEditTargets(page);
    const cellsBefore = targets.grid;
    const word = targets.words.find((w) => w.word === 0)!;
    expect(word).toMatchObject({ unit: 0 });

    await chooseTool(page, "Move word");
    await page.mouse.move(word.x, word.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-route-handle")).toBeGreaterThan(0);
    expect(await namedNodeCount(page, "kufi-moved-outline")).toBe(0);
    await page.mouse.down();
    await page.mouse.move(word.x + word.dc * 2 * targets.cellPx, word.y + word.dr * 2 * targets.cellPx, { steps: 12 });
    // live: the letters the move shifted outside the word are outlined, nothing committed yet
    await expect.poll(() => namedNodeCount(page, "kufi-moved-outline"), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    expect(await panelEdits(page)).toBeUndefined();
    await page.mouse.up();

    // committed as one step: the route recorded, and, since other letters moved, the whole panel pinned
    await expect.poll(async () => (await panelEdits(page))?.routes?.[0]).toBe(2);
    const edits = (await panelEdits(page))!;
    expect(Object.keys(edits.pinned ?? {}).length).toBe(6);
    expect(await namedNodeCount(page, "kufi-moved-outline")).toBe(0);
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).not.toEqual(before);
    expect((await kufiEditTargets(page)).grid).not.toEqual(cellsBefore);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
    await expect.poll(async () => (await kufiEditTargets(page)).grid).toEqual(cellsBefore);
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  /** A paper cell whose painting completes no 2×2 of ink (preferring the panel's inside), or null. */
  function paintableCell(grid: string[], skip: Set<string> = new Set()): { col: number; row: number } | null {
    const ink = (c: number, r: number) => grid[r]?.[c] === "#";
    for (let r = 1; r + 1 < grid.length; r++)
      for (let c = 1; c + 1 < grid[r].length; c++) {
        if (grid[r][c] !== "." || skip.has(`${c},${r}`)) continue;
        let closes = false;
        for (const dc of [-1, 1]) for (const dr of [-1, 1]) if (ink(c + dc, r) && ink(c, r + dr) && ink(c + dc, r + dr)) closes = true;
        if (!closes) return { col: c, row: r };
      }
    return null;
  }

  /** A paper cell whose painting would complete a 2×2 of ink, or null. */
  function blockedCell(grid: string[]): { col: number; row: number } | null {
    const ink = (c: number, r: number) => grid[r]?.[c] === "#";
    for (let r = 0; r < grid.length; r++)
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] !== ".") continue;
        for (const dc of [-1, 1]) for (const dr of [-1, 1]) if (ink(c + dc, r) && ink(c, r + dr) && ink(c + dc, r + dr)) return { col: c, row: r };
      }
    return null;
  }

  /** An ink cell whose erasing opens a 2×2 of paper (a lone square, a dot), or null. */
  function gapCell(grid: string[]): { col: number; row: number } | null {
    const paper = (c: number, r: number) => grid[r]?.[c] === ".";
    for (let r = 1; r + 1 < grid.length; r++)
      for (let c = 1; c + 1 < grid[r].length; c++) {
        if (grid[r][c] !== "#") continue;
        for (const dc of [-1, 1]) for (const dr of [-1, 1]) if (paper(c + dc, r) && paper(c, r + dr) && paper(c + dc, r + dr)) return { col: c, row: r };
      }
    return null;
  }

  /** Three paper cells in a row that can be painted one after the other without making a 2×2 of ink. */
  function paintableRun(grid: string[]): Array<{ col: number; row: number }> | null {
    for (let r = 1; r + 1 < grid.length; r++)
      for (let c = 1; c + 3 < grid[r].length; c++) {
        const g = grid.slice();
        const run: Array<{ col: number; row: number }> = [];
        for (let k = 0; k < 3; k++) {
          const ink = (cc: number, rr: number) => g[rr]?.[cc] === "#";
          const cc = c + k;
          if (g[r][cc] !== ".") break;
          let closes = false;
          for (const dc of [-1, 1]) for (const dr of [-1, 1]) if (ink(cc + dc, r) && ink(cc, r + dr) && ink(cc + dc, r + dr)) closes = true;
          if (closes) break;
          g[r] = g[r].slice(0, cc) + "#" + g[r].slice(cc + 1);
          run.push({ col: cc, row: r });
        }
        if (run.length === 3) return run;
      }
    return null;
  }

  const cellOutlineStroke = (page: Page) =>
    page.evaluate(() => {
      const node = window.__HARF__!.getStage()?.findOne(".kufi-cell-outline") as { stroke(): string } | undefined;
      return node ? node.stroke() : null;
    });

  test("Alt shows a cell outline, Alt-click paints a cell and Alt-click again clears it, one step each; a tap of Alt leaves nothing stuck", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const box = await openBaqarahPanel(page);
    await pointerAway(page, box);
    const t = await kufiEditTargets(page);
    const cell = paintableCell(t.grid)!;
    expect(cell).not.toBeNull();
    const at = kufiCellCenter(t, cell.col, cell.row);
    expect(await inkPixels(page, kufiCellBox(t, cell.col, cell.row))).toBe(0);

    // Holding Alt over paper: a thin outline round the cell, no letter chrome, no dots.
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Alt");
    await page.mouse.move(at.x + 1, at.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-cell-outline")).toBe(1);
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBe(0);
    expect(await draggableDotCenters(page)).toEqual([]);

    // Alt-click: the cell is ink, saved as an offset from the nearest letter.
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await panelEdits(page))?.cells?.length).toBe(1);
    expect((await panelEdits(page))!.cells![0]).toMatchObject({ on: true });
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
    await pointerAway(page, box);
    expect(await inkPixels(page, kufiCellBox(t, cell.col, cell.row))).toBeGreaterThan(0);
    // a lone painted square breaks nothing
    await expect(kufiPanel(page)).not.toContainText("leave a gap");

    // Alt released: the outline is gone and the letters' hover chrome is back; the page's focus is where it was.
    expect(await namedNodeCount(page, "kufi-cell-outline")).toBe(0);
    const letter = (await kufiEditTargets(page)).letters.find((l) => l.unit === 4)!;
    await page.mouse.move(letter.x, letter.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-hover-outline")).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement?.tagName === "CANVAS")).toBe(true);

    // Alt-click the same cell: the edit is removed, not stacked.
    // (past the history's 300 ms coalescing window, so the second click is a step of its own)
    await page.waitForTimeout(400);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await panelEdits(page))?.cells).toBeUndefined();
    await pointerAway(page, box);
    expect(await inkPixels(page, kufiCellBox(t, cell.col, cell.row))).toBe(0);

    // Two clicks, two steps.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await panelEdits(page))?.cells?.length).toBe(1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("Alt-drag paints every cell it crosses the way its first cell went, as one step", async ({ page }) => {
    const box = await openBaqarahPanel(page);
    await pointerAway(page, box);
    const t = await kufiEditTargets(page);
    const run = paintableRun(t.grid)!;
    expect(run).not.toBeNull();
    const from = kufiCellCenter(t, run[0].col, run[0].row);
    const to = kufiCellCenter(t, run[2].col, run[2].row);

    await page.mouse.move(from.x, from.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    // live: the cells are ink while nothing is committed yet
    await settleFrames(page);
    expect(await inkPixels(page, kufiCellBox(t, run[1].col, run[1].row))).toBeGreaterThan(0);
    expect(await panelEdits(page)).toBeUndefined();
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect.poll(async () => (await panelEdits(page))?.cells?.length).toBe(3);
    expect((await panelEdits(page))!.cells!.every((c) => c.on)).toBe(true);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
  });

  test("a fast Alt-drag paints the cells it jumped over too, as one step", async ({ page }) => {
    const box = await openBaqarahPanel(page);
    await pointerAway(page, box);
    const t = await kufiEditTargets(page);
    const run = paintableRun(t.grid)!;
    expect(run).not.toBeNull();
    const from = kufiCellCenter(t, run[0].col, run[0].row);
    const to = kufiCellCenter(t, run[2].col, run[2].row);

    await page.mouse.move(from.x, from.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    // one pointer sample two cells on: the cell between gets no mousemove of its own
    await page.mouse.move(to.x, to.y, { steps: 1 });
    await settleFrames(page);
    expect(await inkPixels(page, kufiCellBox(t, run[1].col, run[1].row))).toBeGreaterThan(0);
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect.poll(async () => (await panelEdits(page))?.cells?.length).toBe(3);
    expect((await panelEdits(page))!.cells!.every((c) => c.on)).toBe(true);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  test("a cell that would make a 2×2 of ink is refused and the outline flashes red; erasing is allowed and a gap is reported", async ({ page }) => {
    const box = await openBaqarahPanel(page);
    await pointerAway(page, box);
    const t = await kufiEditTargets(page);
    const blocked = blockedCell(t.grid)!;
    expect(blocked).not.toBeNull();
    const at = kufiCellCenter(t, blocked.col, blocked.row);

    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Alt");
    await page.mouse.move(at.x + 1, at.y);
    await settleFrames(page);
    const accent = await cellOutlineStroke(page);
    expect(accent).not.toBeNull();
    await page.mouse.down();
    await page.mouse.up();
    // refused: red for a moment, then the outline's own colour again, and nothing saved
    await expect.poll(() => cellOutlineStroke(page)).toBe("#e03131");
    await expect.poll(() => cellOutlineStroke(page), { timeout: 2000 }).toBe(accent);
    await page.keyboard.up("Alt");
    await page.waitForTimeout(300);
    expect(await panelEdits(page)).toBeUndefined();
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

    // Erasing a lone square (a dot) opens a 2×2 of paper: allowed, and the status says so.
    const gap = gapCell(t.grid)!;
    expect(gap).not.toBeNull();
    const g = kufiCellCenter(t, gap.col, gap.row);
    await page.mouse.move(g.x, g.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await panelEdits(page))?.cells?.length).toBe(1);
    expect((await panelEdits(page))!.cells![0]).toMatchObject({ on: false });
    await expect(kufiPanel(page)).toContainText("Painted cells leave a gap");
    await pointerAway(page, box);
    expect(await inkPixels(page, kufiCellBox(t, gap.col, gap.row))).toBe(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
    await expect(kufiPanel(page)).not.toContainText("leave a gap");
  });

  test("a painted cell survives Fit and a text change that keeps the same letters", async ({ page }) => {
    const box = await openBaqarahPanel(page);
    await pointerAway(page, box);
    const t = await kufiEditTargets(page);
    const cell = paintableCell(t.grid)!;
    const at = kufiCellCenter(t, cell.col, cell.row);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await panelEdits(page))?.cells?.length).toBe(1);
    const painted = (await panelEdits(page))!.cells![0];

    // Fit: the same letters in whatever box it picks; the edit rides along.
    await kufiPanel(page).getByRole("button", { name: "Fit" }).click();
    await expect(kufiPanel(page)).not.toContainText("Finding a size", { timeout: 20_000 });
    expect((await panelEdits(page))?.cells).toEqual([painted]);

    // A fatha on the first letter is dropped by the panel: the same units, so the edit follows them.
    await setBlockText(page, "لَا يكلف الله نفسا إلا وسعها", PANEL_ID);
    await expect.poll(async () => ((await getBlocks(page)).find((b) => b.id === PANEL_ID) as { text: string }).text).toContain("لَا");
    expect((await panelEdits(page))?.cells).toEqual([painted]);
    await pointerAway(page, box);
    await expect.poll(async () => inkPixels(page, kufiCellBox(await kufiEditTargets(page), cell.col, cell.row))).toBeGreaterThan(0);
  });

  test("a stretch nothing can pack snaps back, commits nothing, and says why", async ({ page }) => {
    await withoutExploration(page);
    const box = await openBaqarahPanel(page);
    await chooseTool(page, "Stretch");
    await pointerAway(page, box);
    const before = await inkSignature(page, box);
    const cellPx = 6 * (await getStageScale(page));
    const end = (await kufiEditTargets(page)).ends.find((e) => e.unit === 3 && e.dc === 0 && e.dr === -1)!;
    expect(end).toBeDefined();

    await page.mouse.move(end.x, end.y);
    await settleFrames(page);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y - 2 * cellPx, { steps: 12 });
    // give the previews time to be refused
    await page.waitForTimeout(800);
    await page.mouse.up();

    await expect.poll(() => canvasNotice(page)).toBe("No room to stretch that here");
    expect(await panelEdits(page)).toBeUndefined();
    await noticeGone(page);
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  test("Release hand edits frees pinned letters after a size change they cannot survive, in one undo step", async ({ page }) => {
    const box = await openBaqarahPanel(page);
    await expect(kufiPanel(page)).not.toContainText("Release hand edits");
    await chooseTool(page, "Stretch");

    // A hand edit: the kaf's right end pulled two cells, as in the stretch test
    // (a pull re-asks while the pointer rests, so it holds up under the full
    // suite's load where a form click's two tries can be refused by the clock).
    const cellPx = 6 * (await getStageScale(page));
    const targets = await kufiEditTargets(page);
    const end = targets.ends.find((e) => e.unit === 2 && e.si === 0 && e.dc === 1 && e.dr === 0)!;
    const leftEndBefore = targets.ends.find((e) => e.unit === 2 && e.dc === -1)!;
    await page.mouse.move(end.x, end.y);
    await settleFrames(page);
    await page.mouse.down();
    await page.mouse.move(end.x + 2 * cellPx, end.y, { steps: 12 });
    await expect
      .poll(async () => (await kufiEditTargets(page)).ends.find((e) => e.unit === 2 && e.dc === -1)?.x, { timeout: 10_000 })
      .toBeLessThan(leftEndBefore.x - 1.5 * cellPx);
    await page.mouse.up();
    await expect.poll(async () => (await panelEdits(page))?.pinned?.[2]).toBeDefined();
    await pointerAway(page, box);
    // offered whenever the panel has pins
    await expect(kufiPanel(page).getByRole("button", { name: "Release hand edits" })).toBeVisible();

    // 20×20: the pin holds the kaf at a cell the smaller box does not have.
    await page.waitForTimeout(400);
    await sizeField(page, "Width").fill("20");
    await sizeField(page, "Width").press("Enter");
    await sizeField(page, "Height").fill("20");
    await sizeField(page, "Height").press("Enter");
    await expect.poll(async () => [(await panelOf(page, PANEL_ID))?.panelCols, (await panelOf(page, PANEL_ID))?.panelRows]).toEqual([20, 20]);
    await expect(kufiPanel(page)).toContainText("A pinned edit can't stay where it is at this size", { timeout: 15_000 });
    const release = kufiPanel(page).getByRole("button", { name: "Release hand edits" });
    await expect(release).toBeVisible();

    // Released: the pin goes, the stretch stays, and the packer answers for 20×20
    // (a packed panel, or "Too long", with sizes to try when its budget finds some).
    await page.waitForTimeout(400);
    await release.click();
    await expect.poll(async () => (await panelEdits(page))?.pinned).toBeUndefined();
    expect((await panelEdits(page))?.stretch?.[2]).toEqual([2]);
    await expect(kufiPanel(page)).not.toContainText("pinned edit");
    await expect(release).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const text = await kufiPanel(page).innerText();
          if (text.includes("Arranging")) return "waiting";
          if (/Too long for 20×20/.test(text)) return "too long";
          const b = await blockClientBox(page, PANEL_ID);
          return (await inkPixels(page, b)) > b.width * b.height * 0.15 ? "packed" : text;
        },
        { timeout: 20_000 }
      )
      .toMatch(/^(too long|packed)$/);

    // One undo brings the pins back, and with them the conflict.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await panelEdits(page))?.pinned?.[2]).toBeDefined();
    await expect(kufiPanel(page)).toContainText("A pinned edit can't stay where it is at this size", { timeout: 15_000 });
  });

  test.describe("on a touchscreen", () => {
    test.use({ hasTouch: true });

    test("the Paint tool paints the cells a finger drags across, as one step", async ({ page }) => {
      const box = await openBaqarahPanel(page);
      await pointerAway(page, box);
      await chooseTool(page, "Paint");
      const t = await kufiEditTargets(page);
      const run = paintableRun(t.grid)!;
      expect(run).not.toBeNull();
      const from = kufiCellCenter(t, run[0].col, run[0].row);
      const to = kufiCellCenter(t, run[2].col, run[2].row);
      const cdp = await page.context().newCDPSession(page);
      const finger = (type: "touchStart" | "touchMove" | "touchEnd", p?: { x: number; y: number }) =>
        cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ id: 0, x: p.x, y: p.y }] : [] });

      await finger("touchStart", from);
      for (let i = 1; i <= 12; i++)
        await finger("touchMove", { x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 });
      await finger("touchEnd");

      await expect.poll(async () => (await panelEdits(page))?.cells?.length).toBe(3);
      expect((await panelEdits(page))!.cells!.every((c) => c.on)).toBe(true);
      // the panel stayed put: the finger painted, it did not drag the block
      const after = centerOf(await blockClientBox(page, PANEL_ID));
      const before = centerOf(box);
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect.poll(async () => panelEdits(page)).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// The selected letter's options
// ---------------------------------------------------------------------------

test.describe("the selected letter's options", () => {
  test.describe.configure({ mode: "default" });

  test("the selected letter lists its forms and only fitting ones apply", async ({ page }) => {
    test.setTimeout(120_000);
    const box = await openBaqarahPanel(page);
    await explored(page);
    const letter = (await kufiEditTargets(page)).letters.find((l) => l.unit === 4)!;
    expect(letter.glyphId).toBe("feh.final.3");

    // A click picks the letter and changes nothing; a click on the picked
    // letter swaps it to its next fitting form; undo takes the swap back and
    // keeps the letter picked.
    await page.mouse.click(letter.x, letter.y);
    await expect(kufiPanel(page).getByTestId("kufi-letter-options")).toBeVisible();
    await page.waitForTimeout(400);
    expect(await panelEdits(page)).toBeUndefined();
    await page.mouse.click(letter.x, letter.y);
    await expect.poll(async () => (await panelEdits(page))?.forms?.[4]).toBe("feh.final.0");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
    await pointerAway(page, box);

    await formsExplored(page);
    const options = kufiPanel(page).getByTestId("kufi-letter-options");
    const form = (id: string) => options.locator(`[data-glyph-id="${id}"]`);
    await expect(options.locator("[data-glyph-id]")).toHaveCount(4);
    await expect(form("feh.final.3")).toHaveAttribute("aria-pressed", "true");
    // all four fit, two of them only with filler bars
    for (const id of ["feh.final.0", "feh.final.1", "feh.final.2"]) await expect(form(id)).toBeEnabled();

    await form("feh.final.1").click();
    await expect.poll(async () => (await panelEdits(page))?.forms?.[4]).toBe("feh.final.1");
    expect((await panelEdits(page))?.pinned?.[4]).toMatchObject({ unitIndex: 4, glyphId: "feh.final.1" });
    await expect(form("feh.final.1")).toHaveAttribute("aria-pressed", "true");

    // One step.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
  });

  test("once explored, a stretch slice no length fits shows no handle", async ({ page }) => {
    test.setTimeout(120_000);
    await openBaqarahPanel(page);
    await chooseTool(page, "Stretch");
    // unit 8, seen:medial on the full top line: its grip shows before exploration knows better
    await explored(page);
    const targets = await kufiEditTargets(page);
    expect(targets.ends.filter((e) => e.unit === 8)).toEqual([]);
    const seen = targets.letters.find((l) => l.unit === 8)!;
    await page.mouse.move(seen.x, seen.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-hover-outline")).toBeGreaterThan(0);
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBe(0);
    // the kaf's right end, which fits a step or two longer, keeps its handle
    expect(targets.ends.some((e) => e.unit === 2 && e.dc === 1)).toBe(true);
  });

  test("while a stretch is held, the lengths that fit are marked, and the marks go on release", async ({ page }) => {
    test.setTimeout(120_000);
    const box = await openBaqarahPanel(page);
    await chooseTool(page, "Stretch");
    await explored(page);
    await pointerAway(page, box);
    const cellPx = 6 * (await getStageScale(page));
    // unit 2, the kaf: its right end fits a step or two longer
    const end = (await kufiEditTargets(page)).ends.find((e) => e.unit === 2 && e.si === 0 && e.dc === 1 && e.dr === 0)!;
    expect(end).toBeDefined();
    await page.mouse.move(end.x, end.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-fit-mark")).toBe(0);
    await page.mouse.down();
    await page.mouse.move(end.x + cellPx, end.y, { steps: 6 });
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-fit-mark")).toBeGreaterThan(0);
    // back to the start: the release commits nothing, and the marks go
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-fit-mark")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The arrangements strip
// ---------------------------------------------------------------------------

test.describe("arrangements strip", () => {
  test.describe.configure({ mode: "default" });

  test("shows other arrangements and applies one in one undo step", async ({ page }) => {
    const box = await openBaqarahPanel(page);
    await pointerAway(page, box);
    const before = await inkSignature(page, box);

    await expect(kufiPanel(page).getByRole("heading", { name: "Arrangements" })).toBeVisible();
    const first = kufiPanel(page).getByRole("button", { name: "Arrangement 1" });
    await expect(first).toBeVisible({ timeout: 20_000 });
    await expect(kufiPanel(page).getByRole("button", { name: "Current arrangement" })).toHaveAttribute("aria-pressed", "true");
    expect(await panelEdits(page)).toBeUndefined();

    await first.click();
    await expect.poll(async () => panelEdits(page)).toBeDefined();
    await pointerAway(page, box);
    await expect.poll(async () => JSON.stringify(await inkSignature(page, box))).not.toBe(JSON.stringify(before));

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => panelEdits(page)).toBeUndefined();
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);

    // Explored already for these inputs: the options are back at once.
    await expect(kufiPanel(page).getByRole("button", { name: "Arrangement 1" })).toBeVisible();
    await expect(kufiPanel(page)).not.toContainText("Looking…");
  });

  test("a panel that does not pack shows no arrangements", async ({ page }) => {
    await openBaqarahPanel(page);
    const cols = sizeField(page, "Width");
    await cols.click();
    await cols.press("ControlOrMeta+a");
    await cols.pressSequentially("23");
    await cols.press("Enter");
    const rows = sizeField(page, "Height");
    await rows.click();
    await rows.press("ControlOrMeta+a");
    await rows.pressSequentially("23");
    await rows.press("Enter");
    await expect.poll(async () => (await panelOf(page, PANEL_ID))?.panelRows).toBe(23);
    await expect(kufiPanel(page)).toContainText(/Too (long|short)|Couldn.t arrange/, { timeout: 20_000 });
    await expect(kufiPanel(page).getByRole("heading", { name: "Arrangements" })).toHaveCount(0);
    await expect(kufiPanel(page)).not.toContainText("Looking…");
  });

  test.describe("on a dense screen", () => {
    test.use({ deviceScaleFactor: 2 });

    test("thumbnails draw a whole number of device pixels per cell, at the same size on the page", async ({ page }) => {
      await openBaqarahPanel(page);
      const current = kufiPanel(page).getByRole("button", { name: "Current arrangement" }).locator("canvas");
      await expect(current).toBeVisible();
      // 21 cells of 3 CSS px, at 2 device px per CSS px
      await expect.poll(() => current.evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([126, 126]);
      expect((await current.boundingBox())!.width).toBeCloseTo(63, 0);
    });
  });
});

/** The page-space centre of the first canvas node named `name` whose text is `label`. */
async function canvasButtonCenter(page: Page, name: string, label: string) {
  return page.evaluate(
    ([n, l]) => {
      const stage = window.__HARF__!.getStage();
      const node = stage?.find(`.${n}`).find((g) => (g as Konva.Group).findOne<Konva.Text>("Text")?.text() === l);
      if (!stage || !node) return null;
      const r = node.getClientRect();
      const c = stage.container().getBoundingClientRect();
      return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 };
    },
    [name, label] as const
  );
}

test("a box too big still shows its frame and a way back", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await openBaqarahPanel(page);
  await sizeField(page, "Width").fill("23");
  await sizeField(page, "Width").press("Enter");
  await sizeField(page, "Height").fill("23");
  await sizeField(page, "Height").press("Enter");
  await expect(kufiPanel(page)).toContainText("Too short to fill a box", { timeout: 15_000 });

  // The frame is drawn at the box's size, with the reason beside it.
  await expect.poll(() => namedNodeCount(page, "kufi-unfit-frame")).toBe(1);
  const frame = (await nodeClientBox(page, ".kufi-unfit-frame"))!;
  const box = await blockClientBox(page, PANEL_ID);
  expect(frame.width).toBeCloseTo(box.width, 0);
  expect(frame.height).toBeCloseTo(box.height, 0);
  expect(await namedNodeText(page, "kufi-unfit-text")).toContain("Too short to fill a box");

  // It is chrome: the export holds no path for the panel.
  await openPanel(page, /^Save & Export/);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG" }).click();
  let svg = "";
  for await (const chunk of await (await downloadPromise).createReadStream()) svg += (chunk as Buffer).toString("utf8");
  expect(svg.match(/<path\b[^>]*>/g) ?? []).toHaveLength(0);

  // A suggested size on the canvas sets the box back.
  await expect.poll(() => canvasButtonCenter(page, "kufi-unfit-size", "21×21")).not.toBeNull();
  const at = (await canvasButtonCenter(page, "kufi-unfit-size", "21×21"))!;
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => [(await panelOf(page, PANEL_ID))?.panelCols, (await panelOf(page, PANEL_ID))?.panelRows]).toEqual([21, 21]);
  await expect.poll(() => namedNodeCount(page, "kufi-unfit-frame")).toBe(0);
  expect(errors).toEqual([]);
});
