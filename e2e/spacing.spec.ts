import { expect, test, type Page } from "@playwright/test";
import {
  blockClientBox,
  getBlocks,
  getStageScale,
  gotoApp,
  openTypography,
  setBlockText,
  settleFrames,
} from "./harf";

/**
 * Letter spacing acts only at the gaps between a word's pieces, word spacing
 * only at spaces. The unit suite proves the advance arithmetic against real
 * fonts; what only a browser shows is that the drawn block really changes
 * width — and that Fit to width, which measures the run separately, measures
 * the spaced one.
 */

/** Sets a range input the way a drag would: native setter, then an `input` event React listens for. */
async function setRange(page: Page, label: RegExp, value: number) {
  await page.getByLabel(label).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** The starter block, narrowed to a text block so its spacing fields type-check. */
async function firstTextBlock(page: Page) {
  const b = (await getBlocks(page))[0];
  if (b.type !== "text") throw new Error(`expected a text block, got ${b.type}`);
  return b;
}

async function firstBlockWidth(page: Page) {
  const id = (await getBlocks(page))[0].id;
  return (await blockClientBox(page, id)).width;
}

test("letter spacing widens a run at its piece breaks", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "درود درود");
  await openTypography(page);
  await settleFrames(page);
  const before = await firstBlockWidth(page);

  await setRange(page, /^Letter spacing/, 0.5);
  await expect.poll(async () => (await firstTextBlock(page)).letterSpacing).toBe(0.5);
  await expect.poll(() => firstBlockWidth(page)).toBeGreaterThan(before + 10);
});

test("letter spacing leaves a fully joined word alone", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "بببب");
  await openTypography(page);
  await settleFrames(page);
  const before = await firstBlockWidth(page);

  await setRange(page, /^Letter spacing/, 0.8);
  await expect.poll(async () => (await firstTextBlock(page)).letterSpacing).toBe(0.8);
  await settleFrames(page);
  expect(Math.abs((await firstBlockWidth(page)) - before)).toBeLessThan(1);
});

test("word spacing widens the gap between words, and undo restores it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, "بب بب");
  await openTypography(page);
  await settleFrames(page);
  const before = await firstBlockWidth(page);

  await setRange(page, /^Word spacing/, 1);
  await expect.poll(() => firstBlockWidth(page)).toBeGreaterThan(before + 10);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await firstTextBlock(page)).wordSpacing ?? 0).toBe(0);
});

test("Fit to width measures the spaced run, so it still never overshoots", async ({ page }) => {
  await gotoApp(page);
  // بسم has joins for kashida; درود has piece breaks for spacing to widen.
  await setBlockText(page, "بسم درود");
  await openTypography(page);
  await setRange(page, /^Letter spacing/, 1);
  await expect.poll(async () => (await firstTextBlock(page)).letterSpacing).toBe(1);
  await settleFrames(page);

  const before = await firstBlockWidth(page);
  const target = (before / (await getStageScale(page))) * 1.2;
  await page.getByLabel("Target width in pixels").fill(String(Math.round(target)));
  const fit = page.getByRole("button", { name: "Fit", exact: true });
  await fit.click();
  await expect(fit).toBeEnabled();
  await expect.poll(async () => (await getBlocks(page))[0].text).toContain("ـ");
  await settleFrames(page);

  // Had the solver measured the unspaced (narrower) run, it would have added
  // more kashida than the target allows and the drawn block would pass it —
  // measured at ~1.36× with that bug. The target is kept small (1.2×) with
  // spacing at its maximum so kashida's per-join cap (8) can't hide the
  // overshoot. The block box is not rasterised, so the slack is tight.
  expect((await firstBlockWidth(page)) / before).toBeLessThanOrEqual(1.2 + 0.01);
});
