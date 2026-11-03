import { expect, test, type Page } from "@playwright/test";
import { blockClientBox, collectConsoleErrors, getBlocks, getSelectedIds, gotoApp, inkPixels, openPanel, placeAtCanvas, setBlockText } from "./harf";

/** The Kufi star panel block: its construction, drawn as one outline. */

test("Add Kufi star draws the octagon square with الله along each side, and the lines toggle hides the frame", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await gotoApp(page);
  const before = new Set((await getBlocks(page)).map((b) => b.id));

  await page.getByRole("button", { name: "Add Kufi star" }).click();
  await placeAtCanvas(page, 0.5, 0.5);
  await expect
    .poll(async () => (await getBlocks(page)).some((b) => b.type === "kufiStar" && !before.has(b.id)))
    .toBe(true);
  const star = (await getBlocks(page)).find((b) => b.type === "kufiStar" && !before.has(b.id))!;
  expect(star).toMatchObject({
    type: "kufiStar",
    starLayout: "octagon",
    starFold: 4,
    starK: 3,
    starSize: 45,
    starRegions: ["الله الله الله الله"],
    starLines: true,
    text: "الله",
  });

  // The starter text may sit under the star, so the lines are judged by how much ink they add:
  // the frame closes the gaps in each side's feet row, a few cells of ink on the square's edges.
  // At the default zoom a 45-cell square overflows the canvas, so the view is reset to bring its
  // edges on screen, where alone pixels are drawn to count.
  await page.getByRole("button", { name: "Reset view" }).click();
  const box = await blockClientBox(page, star.id);
  await expect.poll(() => inkPixels(page, box), { timeout: 20_000 }).toBeGreaterThan(20_000);
  const withLines = await inkPixels(page, box);

  await page.getByRole("checkbox", { name: "Show construction lines" }).uncheck();
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.id === star.id) as { starLines?: boolean } | undefined)
    .toMatchObject({ starLines: false });
  await expect.poll(() => inkPixels(page, box)).toBeLessThan(withLines - 100);
  expect(errors).toEqual([]);
});

test("the Wedges layout is still there: switching to it draws the 4-fold construction's lines and keeps the text", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await gotoApp(page);
  await page.getByRole("button", { name: "Add Kufi star" }).click();
  await placeAtCanvas(page, 0.5, 0.5);
  await expect.poll(async () => (await getBlocks(page)).some((b) => b.type === "kufiStar")).toBe(true);
  const id = (await getBlocks(page)).find((b) => b.type === "kufiStar")!.id;
  const panel = page.getByTestId("kufi-star-panel");
  await panel.getByRole("button", { name: "Wedges" }).click();
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.id === id) as { starLayout?: string; starSize?: number; starRegions?: string[]; text?: string } | undefined)
    .toMatchObject({ starLayout: "wedges", starSize: 24, starRegions: Array.from({ length: 13 }, () => ""), text: "الله" });
  await expect(panel.getByRole("group", { name: "Fold" })).toBeVisible();
  // the lines alone draw the construction
  await expect.poll(async () => inkPixels(page, await blockClientBox(page, id))).toBeGreaterThan(1000);
  await panel.getByRole("button", { name: "Octagon" }).click();
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.id === id) as { starLayout?: string; starSize?: number; starRegions?: string[] } | undefined)
    .toMatchObject({ starLayout: "octagon", starSize: 15, starRegions: ["الله"] });
  await expect(panel.getByRole("group", { name: "Fold" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

type Star = { id: number; type: string; starRegions?: string[] };
const starOf = async (page: Page, id: number) => (await getBlocks(page)).find((b) => b.id === id) as Star | undefined;

test("Find layouts offers the octagon squares first, then the star splits, and approving one draws the panel", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await gotoApp(page);
  const starter = (await getBlocks(page))[0].id;
  await page.getByRole("button", { name: "Add Kufi star" }).click();
  await placeAtCanvas(page, 0.5, 0.5);
  await expect.poll(async () => (await getBlocks(page)).some((b) => b.type === "kufiStar")).toBe(true);
  const id = (await getBlocks(page)).find((b) => b.type === "kufiStar")!.id;

  // The star is made the only block (the app never leaves the canvas empty, so
  // the starter goes second), so the SVG below holds its path and nothing else.
  await openPanel(page, /^Layers/);
  await page.getByText(`Block ${starter}`, { exact: true }).first().click();
  await expect.poll(() => getSelectedIds(page)).toEqual([starter]);
  await page.getByRole("button", { name: "Delete block" }).click();
  await expect.poll(async () => (await getBlocks(page)).map((b) => b.id)).toEqual([id]);
  await expect.poll(() => getSelectedIds(page)).toEqual([id]);
  await setBlockText(page, "الله", id);
  const panel = page.getByTestId("kufi-star-panel");
  // start from the blank wedges layout, so approving an offer is what puts text in
  await panel.getByRole("button", { name: "Wedges" }).click();
  await expect.poll(async () => (await starOf(page, id))?.starRegions?.every((t) => t === "")).toBe(true);

  await panel.getByRole("button", { name: "Find layouts" }).click();
  const offers = panel.getByTestId("kufi-star-offer");
  await expect(offers.first()).toBeVisible({ timeout: 30_000 });
  // the octagon squares first, then the star constructions
  await expect(offers.first()).toContainText("along each side");
  await expect(offers.filter({ hasText: /4-fold, classic star/ }).first()).toBeVisible();

  // Lines off, so the ink is the text alone: an empty star draws nothing, and
  // the approved offer adds ink.
  await page.getByRole("checkbox", { name: "Show construction lines" }).uncheck();
  await expect.poll(async () => ((await getBlocks(page)).find((b) => b.id === id) as { starLines?: boolean }).starLines).toBe(false);
  const before = await inkPixels(page, await blockClientBox(page, id));
  // a 4-fold wedge offer; the star grows (its words fill a wedge several times), so the view is reset
  // to bring its text back into the viewport, where alone pixels are drawn to count
  await offers.filter({ hasText: /^Fits: .*4-fold, classic star/ }).first().click();
  await expect.poll(async () => (await starOf(page, id))?.starRegions?.some((t) => t !== "")).toBe(true);
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect
    .poll(async () => inkPixels(page, await blockClientBox(page, id)), { timeout: 20_000 })
    .toBeGreaterThan(before + 200);

  // Approving was one step: one undo empties every region.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await starOf(page, id))?.starRegions?.every((t) => t === "")).toBe(true);

  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(async () => (await starOf(page, id))?.starRegions?.some((t) => t !== "")).toBe(true);

  // an octagon offer approves the same way: the square's side text with its repeats
  await offers.first().click();
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.id === id) as { starLayout?: string; starRegions?: string[] } | undefined)
    .toMatchObject({ starLayout: "octagon", starRegions: ["الله"] });
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect.poll(async () => inkPixels(page, await blockClientBox(page, id)), { timeout: 20_000 }).toBeGreaterThan(before + 200);
  await openPanel(page, /^Save & Export/);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG" }).click();
  const download = await downloadPromise;
  let svg = "";
  for await (const chunk of await download.createReadStream()) svg += (chunk as Buffer).toString("utf8");
  expect(svg.match(/<path\b[^>]*>/g) ?? []).toHaveLength(1);

  // A new letter makes the offers stale; the panel keeps what was approved.
  await setBlockText(page, "اللهم", id);
  await expect(panel).toContainText("The text changed");
  expect((await starOf(page, id))?.starRegions?.some((t) => t !== "")).toBe(true);
  expect(errors).toEqual([]);
});
