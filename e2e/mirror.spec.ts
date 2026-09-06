import { test, expect, type Page } from "@playwright/test";
import {
  gotoApp, getBlocks, blockClientBox, inkPixels,
  openPanel, openTypography, parkOnDot, settleFrames, setBlockText,
  STRETCH_HANDLE_DOT, strokeProbes, type Box,
} from "./harf";

/**
 * Stream B (muthanna & radial). Everything here drives the app the way a user
 * does — sidebar buttons and sliders — and checks the result in pixels on the
 * live stage canvas, per the harness's rules in CLAUDE.md.
 */

const ADD_MIRROR = 'button[aria-label="Add mirror"]';
const ADD_RADIAL = 'button[aria-label="Add medallion"]';

/** The one block a fresh session starts with, and the mirror added next to it. */
const SOURCE_ID = 1;

type StagePoint = { x: number; y: number };

/** Converts a point in stage (block) coordinates into page coordinates. */
async function stageToPage(page: Page, pt: StagePoint): Promise<StagePoint> {
  return page.evaluate((p) => {
    const stage = window.__HARF__!.getStage()!;
    const c = stage.container().getBoundingClientRect();
    return {
      x: c.left + stage.x() + p.x * stage.scaleX(),
      y: c.top + stage.y() + p.y * stage.scaleY(),
    };
  }, pt);
}

async function stageScale(page: Page): Promise<number> {
  return page.evaluate(() => window.__HARF__!.getStage()!.scaleX());
}

const boxAround = (centre: StagePoint, width: number, height: number): Box => ({
  x: centre.x - width / 2,
  y: centre.y - height / 2,
  width,
  height,
});

/** Ink in a box's left half and its right half. */
async function inkHalves(page: Page, box: Box): Promise<[number, number]> {
  const half = { ...box, width: box.width / 2 };
  return [
    await inkPixels(page, half),
    await inkPixels(page, { ...half, x: box.x + box.width / 2 }),
  ];
}

/**
 * Opens the Mirror type panel. Every type panel in the sidebar starts
 * collapsed and only renders its controls while open.
 */
async function openMirrorPanel(page: Page): Promise<void> {
  await openPanel(page, /^Mirror/);
}

/** Adds a mirror of the (already selected) starter block and returns its id. */
async function addMirror(page: Page, selector: string): Promise<number> {
  const before = (await getBlocks(page)).length;
  await page.locator(selector).click();
  await expect.poll(async () => (await getBlocks(page)).length).toBe(before + 1);
  const blocks = await getBlocks(page);
  return blocks[blocks.length - 1].id;
}

test.describe("mirror blocks", () => {
  test("a mirror draws the source's content in its own region", async ({ page }) => {
    await gotoApp(page);

    const mirrorId = await addMirror(page, ADD_MIRROR);
    const blocks = await getBlocks(page);
    const mirror = blocks.find((b) => b.id === mirrorId)!;
    expect(mirror.type).toBe("mirror");
    expect((mirror as { sourceId?: number }).sourceId).toBe(SOURCE_ID);

    // The mirror sits beside the source, so its own region is disjoint from
    // the source's — ink there is the reflection, not the original.
    // A mirror is placed clear of its source, which at the app's default zoom
    // puts it off the right-hand edge of the viewport; fit the content first
    // so both are fully on the canvas and the pixel reads below are complete.
    await page.locator('button[aria-label="Reset view"]').click();

    const sourceBox = await blockClientBox(page, SOURCE_ID);

    // The mirror's drag surface is measured off what actually got drawn, and
    // shaping is async — so wait for that measurement to reach the source's
    // own size before reading anything positional off it.
    await expect
      .poll(async () => (await blockClientBox(page, mirrorId)).width)
      .toBeGreaterThan(sourceBox.width * 0.8);

    const mirrorBox = await blockClientBox(page, mirrorId);
    expect(mirrorBox.x).toBeGreaterThan(sourceBox.x + sourceBox.width);
    expect(await inkPixels(page, mirrorBox)).toBeGreaterThan(0);

    // …and it is a *reflection*, not a second copy: the mirror's left half
    // carries the source's right half, and vice versa. Comparing half-counts
    // keeps this coarse enough to survive rasterisation differences.
    const [sourceLeft, sourceRight] = await inkHalves(page, sourceBox);
    const [mirrorLeft, mirrorRight] = await inkHalves(page, mirrorBox);
    const tolerance = (sourceLeft + sourceRight) * 0.15;
    expect(Math.abs(mirrorLeft - sourceRight)).toBeLessThan(tolerance);
    expect(Math.abs(mirrorRight - sourceLeft)).toBeLessThan(tolerance);
  });

  test("editing the source changes what the mirror draws", async ({ page }) => {
    await gotoApp(page);
    const mirrorId = await addMirror(page, ADD_MIRROR);
    await openMirrorPanel(page);

    // Adding the mirror selected it; the panel's own button walks back to the
    // source so its text can be edited.
    await page.locator("button", { hasText: "Select source" }).click();
    await expect.poll(async () => (await getBlocks(page)).length).toBe(2);

    const before = await inkPixels(page, await blockClientBox(page, mirrorId));
    expect(before).toBeGreaterThan(0);

    await setBlockText(page, "بسم الله الرحمن الرحيم");

    // A much longer phrase draws visibly more ink in the mirror's region,
    // with no edit to the mirror block itself.
    await expect
      .poll(async () => inkPixels(page, await blockClientBox(page, mirrorId)))
      .toBeGreaterThan(before);
  });

  test("deleting the source deletes its mirrors", async ({ page }) => {
    await gotoApp(page);
    const mirrorId = await addMirror(page, ADD_MIRROR);
    await openMirrorPanel(page);

    await page.locator("button", { hasText: "Select source" }).click();
    await expect.poll(getSelectedId(page)).toBe(SOURCE_ID);

    await page.locator('button[aria-label="Delete block"]').click();

    await expect
      .poll(async () => (await getBlocks(page)).map((b) => b.id))
      .not.toContain(mirrorId);
    await expect
      .poll(async () => (await getBlocks(page)).some((b) => b.type === "mirror"))
      .toBe(false);
  });

  test("a radial block with 8 copies puts ink on all eight spokes", async ({ page }) => {
    await gotoApp(page);
    const radialId = await addMirror(page, ADD_RADIAL);
    await openMirrorPanel(page);

    const COUNT = 8;
    const RADIUS = 90;
    await page.locator(`input#radial-count-${radialId}`).fill(String(COUNT));
    await page.locator(`input#radial-radius-${radialId}`).fill(String(RADIUS));
    await expect
      .poll(async () => {
        const b = (await getBlocks(page)).find((x) => x.id === radialId) as {
          radialCount?: number;
          radialRadius?: number;
        };
        return [b?.radialCount, b?.radialRadius];
      })
      .toEqual([COUNT, RADIUS]);

    // Where one copy's ink sits relative to its own origin — measured off the
    // untouched source block rather than assumed, so this doesn't depend on
    // the font's ascender or the block's alignment.
    const scale = await stageScale(page);
    const sourceBox = await blockClientBox(page, SOURCE_ID);
    const sourceOrigin = await stageToPage(page, await blockOrigin(page, SOURCE_ID));
    const inkOffset = {
      x: (sourceBox.x + sourceBox.width / 2 - sourceOrigin.x) / scale,
      y: (sourceBox.y + sourceBox.height / 2 - sourceOrigin.y) / scale,
    };

    const radial = await blockOrigin(page, radialId);
    // Half-size probes, so a spoke's box cannot reach its neighbour's ink.
    const probeW = (sourceBox.width / 2) * 0.5;
    const probeH = (sourceBox.height / 2) * 0.5;

    for (let i = 0; i < COUNT; i++) {
      const radians = ((i * 360) / COUNT) * (Math.PI / 180);
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      // The copy is pushed `RADIUS` along its own spoke and turned to face
      // along it, so its ink offset turns with it.
      const centre = await stageToPage(page, {
        x: radial.x + RADIUS * cos + inkOffset.x * cos - inkOffset.y * sin,
        y: radial.y + RADIUS * sin + inkOffset.x * sin + inkOffset.y * cos,
      });
      const ink = await inkPixels(page, boxAround(centre, probeW, probeH));
      expect(ink, `spoke ${i} of ${COUNT} has no ink`).toBeGreaterThan(0);
    }
  });

  test("a mirror draws its source's stroke cuts", async ({ page }) => {
    // `MirrorBlockView` forwards the source's diacritic overrides and glyph
    // transforms to `ShapedText` but used to omit `strokeCuts`, so a mirror of
    // a stretched block drew it unstretched — and its rAF-settled hit `Rect`,
    // measured off that content, came out too small with it. `CanvasStage`
    // passes the prop on the ordinary path; this is the same one-prop-line
    // omission this file already had once with `fill`.
    //
    // The mirror's own client rect is the assertion because it is measured
    // from the drawn content: a cut that never reaches the mirror cannot
    // widen it. Verified failing before the prop was added.
    await gotoApp(page);
    await setBlockText(page, "حرف");
    const mirrorId = await addMirror(page, ADD_MIRROR);
    await openMirrorPanel(page);
    await page.locator("button", { hasText: "Select source" }).click();
    await expect.poll(async () => (await getBlocks(page)).length).toBe(2);

    const before = await blockClientBox(page, mirrorId);
    expect(before.width).toBeGreaterThan(0);

    // Stretch a stroke on the source, sweeping for a mounted handle exactly
    // as `e2e/stroke-cuts.spec.ts` does — which letters carry a straight
    // stroke depends on the font, so its probe grid is shared, not restated.
    await openTypography(page);
    await page.getByLabel("Stretch strokes").check();
    const dot = await parkOnDot(
      page,
      await strokeProbes(page, SOURCE_ID),
      STRETCH_HANDLE_DOT
    );
    if (!dot) throw new Error("setup: found no mounted stretch handle on the source");

    await page.mouse.down();
    await page.mouse.move(dot.x + 2, dot.y);
    await page.mouse.move(dot.x + 60, dot.y, { steps: 24 });
    await page.mouse.up();
    await settleFrames(page);

    const cuts = (await getBlocks(page)).find((b) => b.id === SOURCE_ID)?.strokeCuts ?? [];
    expect(cuts.length, "setup: the drag recorded no cut on the source").toBeGreaterThan(0);

    // The mirror is drawing a wider letter than it was, with no edit of its own.
    await expect
      .poll(async () => (await blockClientBox(page, mirrorId)).width)
      .toBeGreaterThan(before.width);
  });
});

/** A block's own origin in stage coordinates. */
async function blockOrigin(page: Page, id: number): Promise<StagePoint> {
  const block = (await getBlocks(page)).find((b) => b.id === id);
  if (!block) throw new Error(`no block ${id}`);
  return { x: block.x, y: block.y };
}

const getSelectedId = (page: Page) => async () =>
  (await page.evaluate(() => window.__HARF__!.getSelectedIds()))[0];
