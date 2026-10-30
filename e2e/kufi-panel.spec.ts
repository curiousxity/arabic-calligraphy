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
