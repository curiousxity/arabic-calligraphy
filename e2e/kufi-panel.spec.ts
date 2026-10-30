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
  kufiCellBox,
  kufiCellCenter,
  kufiEditTargets,
  namedNodeCount,
  openPanel,
  placeAtCanvas,
  setBlockText,
  settleFrames,
  type Box,
} from "./harf";
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

// One worker, in order: each of these packs the 21×21 draft in the packer's
// worker inside its time budget, and four drafts racing on one machine can
// run that budget out and leave a different (or no) panel to edit.
test.describe("editing on the canvas", () => {
  test.describe.configure({ mode: "default" });

  test("hovering a letter outlines it, and a click cycles its form to the next one that packs, one step per click", async ({ page }) => {
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

    // Click: the next form in table order that packs (`.0` cannot), pinned where it landed.
    await page.mouse.click(letter.x, letter.y);
    await expect.poll(async () => (await panelEdits(page))?.forms?.[4]).toBe("feh.final.1");
    expect((await panelEdits(page))?.pinned?.[4]).toMatchObject({ unitIndex: 4, glyphId: "feh.final.1" });
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).not.toEqual(before);

    // The outline follows the letter; a second click skips `.2` and comes back to the drawn form.
    const again = (await kufiEditTargets(page)).letters.find((l) => l.unit === 4)!;
    expect(again.glyphId).toBe("feh.final.1");
    await page.mouse.click(again.x, again.y);
    await expect.poll(async () => (await panelEdits(page))?.forms?.[4]).toBe("feh.final.3");

    // Two clicks, two steps.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await panelEdits(page))?.forms?.[4]).toBe("feh.final.1");
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

  test("a click on a handle, with no pull, is a click on the letter", async ({ page }) => {
    await openBaqarahPanel(page);
    const targets = await kufiEditTargets(page);
    // an end handle of the feh (four forms): pressing and releasing on it cycles the form
    const end = targets.ends.find((e) => e.unit === 4)!;
    expect(end).toBeDefined();
    await page.mouse.move(end.x, end.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBe(1);
    await page.mouse.click(end.x, end.y);
    await expect.poll(async () => (await panelEdits(page))?.forms?.[4]).toBe("feh.final.1");
    // a slice grip of the seen (one form): the click reaches the letter and says so
    const grip = (await kufiEditTargets(page)).ends.find((e) => e.unit === 8 && e.kind === "slice")!;
    expect(grip).toBeDefined();
    await page.mouse.click(grip.x, grip.y);
    await expect(kufiPanel(page)).toContainText("That letter has one form");
  });

  test("a drag cut short by losing the selection commits nothing and leaves no preview drawn", async ({ page }) => {
    const box = await openBaqarahPanel(page);
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

  test("hovering a letter shows one handle, the stretch end nearest the pointer", async ({ page }) => {
    await openBaqarahPanel(page);
    const targets = await kufiEditTargets(page);
    const letter = targets.letters.find((l) => l.unit === 2)!;
    expect(targets.ends.filter((e) => e.unit === 2).length).toBeGreaterThan(1);
    await page.mouse.move(letter.x, letter.y);
    await settleFrames(page);
    expect(await namedNodeCount(page, "kufi-hover-outline")).toBeGreaterThan(0);
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBe(1);
  });

  test("a baseline joined on both sides still has a grip on its stretch slice", async ({ page }) => {
    const box = await openBaqarahPanel(page);
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
    expect(await namedNodeCount(page, "kufi-stretch-handle")).toBe(1);

    // The top line is full, so no stretch of it packs: the pull snaps back and says so.
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.dc * 2 * cellPx, grip.y, { steps: 12 });
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await expect(kufiPanel(page)).toContainText("No room to stretch that here");
    expect(await panelEdits(page)).toBeUndefined();
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);
  });

  test("dragging a stretch end two cells previews live, commits one step on release, and undoes", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const box = await openBaqarahPanel(page);
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

  test("dragging a word's first letter along its path asks the packer to move the word; where nothing packs it snaps back and says why", async ({ page }) => {
    const box = await openBaqarahPanel(page);
    await pointerAway(page, box);
    const before = await inkSignature(page, box);
    const x0 = (await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x;
    const targets = await kufiEditTargets(page);
    // الله (unit 5) opens word 2 on the left side, reading upward; it is wedged
    // between the bottom and top bands, so no offset along its path packs.
    const word = targets.words.find((w) => w.word === 2)!;
    expect(word).toMatchObject({ unit: 5, dc: 0, dr: -1 });
    const letter = targets.letters.find((l) => l.unit === 5)!;
    // the press is on the letter's body, not on one of its stretch handles
    for (const e of targets.ends.filter((e) => e.unit === 5)) expect(Math.hypot(e.x - letter.x, e.y - letter.y)).toBeGreaterThan(targets.cellPx);

    await page.mouse.move(letter.x, letter.y);
    await settleFrames(page);
    expect(await hitTargetAt(page, letter)).toBe("Rect.kufi-edit-hit");
    await page.mouse.down();
    await page.mouse.move(letter.x + word.dc * 2 * targets.cellPx, letter.y + word.dr * 2 * targets.cellPx, { steps: 12 });
    // give the previews time to be asked for, refused, and asked for once more
    await page.waitForTimeout(1200);
    await page.mouse.up();

    await expect(kufiPanel(page)).toContainText("No room to move that word here");
    expect(await panelEdits(page)).toBeUndefined();
    // the press was the word's, not the panel's: nothing moved
    expect((await getBlocks(page)).find((b) => b.id === PANEL_ID)!.x).toBe(x0);
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

    // A still press on a first letter is still a click on the letter: الله has
    // three forms, so the click either lands one or says none fits.
    await page.mouse.click(letter.x, letter.y);
    await expect
      .poll(async () => (await panelEdits(page))?.forms?.[5] !== undefined || (await kufiPanel(page).innerText()).includes("No other form"))
      .toBe(true);
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
    const box = await openBaqarahPanel(page);
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

    await expect(kufiPanel(page)).toContainText("No room to stretch that here");
    expect(await panelEdits(page)).toBeUndefined();
    await pointerAway(page, box);
    expect(await inkSignature(page, box)).toEqual(before);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});
