import { expect, test, type Page } from "@playwright/test";
import {
  blockClientBox,
  getBlocks,
  getStageScale,
  gotoApp,
  openTypography,
  setBlockText,
} from "./harf";

/**
 * Fit to width spreads tatweel kashida across a run's legal joins until it
 * spans a target. The unit suite already proves the solver against real
 * fonts through an injected `measure`; what only a browser can show is that
 * the text it chooses really lands on the canvas at the width it solved for,
 * through the app's own shaping and rendering.
 *
 * `بسم الله` has several joins in every bundled font.
 */
const PHRASE = "بسم الله";
const TATWEEL = "ـ";

const countTatweels = (t: string) => [...t].filter((c) => c === TATWEEL).length;

/**
 * The horizontal extent of the ink on the stage, in device pixels. Copied
 * from `tatweel.spec.ts`, which poses the same question this one does — did
 * the run get *wider*? — and for the same reason a dark-pixel count cannot
 * answer it.
 */
async function inkExtentWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".konvajs-content canvas");
    if (!canvas) return 0;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue;
      if (data[i] + data[i + 1] + data[i + 2] >= 330) continue;
      const x = (i / 4) % canvas.width;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    return Number.isFinite(min) ? max - min : 0;
  });
}

/** The selected block's rendered width in *block* space, which is what a target is in. */
async function blockSpaceWidth(page: Page): Promise<number> {
  const box = await blockClientBox(page, 1);
  return box.width / (await getStageScale(page));
}

const fitButton = (page: Page) => page.getByRole("button", { name: "Fit", exact: true });

/** Types a target into the Fit to width field and runs it. */
async function fitTo(page: Page, target: number): Promise<void> {
  await page.getByLabel("Target width in pixels").fill(String(Math.round(target)));
  await fitButton(page).click();
  // Solving is async — it shapes several candidate strings — so wait for the
  // button to come back out of its pending state before asserting.
  await expect(fitButton(page)).toBeEnabled();
}

test("fitting widens the run toward the target without passing it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, PHRASE);
  await openTypography(page);

  const beforeInk = await inkExtentWidth(page);
  expect(beforeInk).toBeGreaterThan(0);
  expect(countTatweels((await getBlocks(page))[0].text)).toBe(0);

  await fitTo(page, (await blockSpaceWidth(page)) * 1.5);

  const text = (await getBlocks(page))[0].text;
  expect(countTatweels(text)).toBeGreaterThan(0);
  // Only tatweels were added — the letters are untouched.
  expect([...text].filter((c) => c !== TATWEEL).join("")).toBe(PHRASE);

  const afterInk = await inkExtentWidth(page);
  expect(afterInk).toBeGreaterThan(beforeInk);
  // Comparing ratios cancels the stage scale and the device pixel ratio.
  // Never overshooting is the solver's contract, so the slack is small and
  // one-sided; it exists only for rasterisation.
  expect(afterInk / beforeInk).toBeLessThanOrEqual(1.5 + 0.06);
});

test("kashida is spread across joins rather than piled on one", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, PHRASE);
  await openTypography(page);

  await fitTo(page, (await blockSpaceWidth(page)) * 1.6);

  const text = (await getBlocks(page))[0].text;
  // Each run of consecutive tatweels is one stretched join. More than one
  // run means the total was distributed, which is what makes an elongated
  // line read as calligraphy rather than as a mistake.
  const runs = text.match(/ـ+/gu) ?? [];
  expect(runs.length).toBeGreaterThan(1);
});

test("fitting is idempotent and costs exactly one undo", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, PHRASE);
  await openTypography(page);

  const target = (await blockSpaceWidth(page)) * 1.5;
  await fitTo(page, target);

  const fitted = (await getBlocks(page))[0].text;
  expect(countTatweels(fitted)).toBeGreaterThan(0);

  // Running it again with the same target must not compound: the solver
  // rebuilds from the unstretched run using absolute counts.
  await fitTo(page, target);
  expect((await getBlocks(page))[0].text).toBe(fitted);

  // One Ctrl+Z returns the whole fit, not one tatweel of it.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await getBlocks(page))[0].text).toBe(PHRASE);
});

test("text with no stretchable join offers no fit", async ({ page }) => {
  await gotoApp(page);
  // Dal is right-joining: it never extends a join forward, so "ددد" has no
  // legal kashida slot anywhere in it.
  await setBlockText(page, "ددد");
  await openTypography(page);

  // The whole Kashida section degrades to its own notice, and the Fit
  // control goes with it — that message is the feature's answer here.
  await expect(page.getByText(/No stretchable joins in this text/)).toBeVisible();
  await expect(fitButton(page)).toHaveCount(0);
  expect((await getBlocks(page))[0].text).toBe("ددد");
});
