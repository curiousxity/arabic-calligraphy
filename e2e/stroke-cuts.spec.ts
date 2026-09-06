import { expect, test, type Page } from "@playwright/test";
import {
  blockClientBox,
  dotCentersWithFill,
  dragFromHere,
  getBlocks,
  getStageScale,
  gotoApp,
  inkPixels,
  openTypography,
  parkOnDot,
  setBlockText,
  STRETCH_HANDLE_DOT,
  strokeProbes,
  settleFrames,
} from "./harf";

/**
 * Straight-stroke extension: lengthening a letter's own stroke by cutting
 * its outline and bridging the gap.
 *
 * The assertion that matters is that the run gets **visibly wider** — the
 * feature this replaces (the Morph editor's kashida dial) was removed
 * precisely because it displaced outline points without ever moving
 * `penX += advance`, so it looked like it worked and measurably did not.
 * Counting ink here is what makes that failure impossible to repeat
 * unnoticed.
 */
const WORD = "حرف";

/** Arms the tool, then parks the pointer on a mounted stretch handle. */
async function armStretchHandle(page: Page): Promise<{ x: number; y: number }> {
  // Typography is collapsed on load.
  await openTypography(page);
  await page.getByLabel("Stretch strokes").check();

  const dot = await parkOnDot(page, await strokeProbes(page, 1), STRETCH_HANDLE_DOT);
  if (!dot) {
    throw new Error(
      `no stretch handle mounted anywhere on "${WORD}" in the default font`
    );
  }
  return dot;
}

test("the stretch handle stays mounted while the pointer sits on it", async ({
  page,
}) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const dot = await armStretchHandle(page);

  // The sibling-hover-handler defect this codebase has hit twice shows up
  // as the handle being present on exactly every other move.
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(dot.x + (i % 2 === 0 ? 0.5 : -0.5), dot.y);
    await settleFrames(page);
    expect(
      (await dotCentersWithFill(page, STRETCH_HANDLE_DOT)).length,
      `handle vanished on move ${i}`
    ).toBeGreaterThan(0);
  }
});

test("dragging the handle records a cut and widens the run", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);

  expect((await getBlocks(page))[0].strokeCuts ?? []).toHaveLength(0);
  const before = await blockClientBox(page, 1);
  const inkBefore = await inkPixels(page);

  const dot = await armStretchHandle(page);
  // A deliberately small first step, for the same reason the glyph-transform
  // spec uses one: under ~20px a sibling-handler overlay loses the node the
  // gesture is attached to.
  await dragFromHere(page, { x: dot.x + 60, y: dot.y }, { via: { x: dot.x + 2, y: dot.y } });
  await settleFrames(page);

  const block = (await getBlocks(page))[0];
  const cuts = block.strokeCuts ?? [];
  expect(cuts.length, "the drag recorded no cut").toBeGreaterThan(0);
  expect(cuts[0].nuqta).toBeGreaterThan(0);
  // Stored so the cut can be re-validated after a later text edit, and so it
  // knows which way the stroke runs.
  expect(typeof cuts[0].glyphId).toBe("number");
  expect(typeof cuts[0].angle).toBe("number");

  // The gesture belonged to the handle, not the block under it.
  expect(block.y).toBe(0);

  // The point of the whole feature: the letter is actually longer. Both the
  // measured box and the drawn ink have to agree, or the metrics loop and
  // the draw loop have diverged.
  const after = await blockClientBox(page, 1);
  expect(after.width).toBeGreaterThan(before.width);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(inkBefore);
});

test("undo reverts a stretch", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const dot = await armStretchHandle(page);
  const before = await blockClientBox(page, 1);

  await dragFromHere(page, { x: dot.x + 60, y: dot.y }, { via: { x: dot.x + 2, y: dot.y } });
  await settleFrames(page);
  expect((await getBlocks(page))[0].strokeCuts ?? []).not.toHaveLength(0);

  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => ((await getBlocks(page))[0].strokeCuts ?? []).length)
    .toBe(0);
  await expect
    .poll(async () => (await blockClientBox(page, 1)).width)
    .toBeLessThanOrEqual(before.width + 1);
});

test("a block with no cuts is byte-identical to one that never had the field", async ({
  page,
}) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  // Absent rather than an empty array: a project saved before this feature
  // must load and render unchanged, which is why nothing writes the field
  // until a cut is actually made.
  expect((await getBlocks(page))[0].strokeCuts).toBeUndefined();
});

test("a fit moves the block's cuts along with the letters they sit on", async ({ page }) => {
  // Both edits mutate the block's text, and a StrokeCut is keyed by an offset
  // into it. `setKashidaAtSlot` remapped its cuts from the start; Fit to width
  // did not — so a fit left every cut pointing at whatever character the
  // inserted tatweels had pushed into its old offset, and `buildCutPlan`
  // (which resolves by cluster *and* glyphId) then dropped it, taking the
  // stretch with it.
  //
  // The assertion is deliberately on the character the cut points at, not on
  // ink or on `strokeCuts.length`: the cuts stay in state either way, and a
  // fit adds enough tatweel ink to swamp one lost stretch. Verified failing
  // before the remap was added.
  await gotoApp(page);
  const PHRASE = "بسم الله";
  await setBlockText(page, PHRASE);

  const dot = await armStretchHandle(page);
  await dragFromHere(page, { x: dot.x + 60, y: dot.y }, { via: { x: dot.x + 2, y: dot.y } });
  await settleFrames(page);

  const before = (await getBlocks(page))[0];
  const cutsBefore = before.strokeCuts ?? [];
  expect(cutsBefore.length, "setup: the drag recorded no cut").toBeGreaterThan(0);
  const charsBefore = cutsBefore.map((c) => before.text[c.cluster]);

  const box = await blockClientBox(page, 1);
  const target = Math.round((box.width / (await getStageScale(page))) * 1.4);
  await page.getByLabel("Target width in pixels").fill(String(target));
  const fit = page.getByRole("button", { name: "Fit", exact: true });
  await fit.click();
  await expect(fit).toBeEnabled();
  await settleFrames(page);

  const after = (await getBlocks(page))[0];
  const cutsAfter = after.strokeCuts ?? [];
  expect(after.text, "setup: the fit inserted nothing").not.toBe(PHRASE);
  expect(cutsAfter).toHaveLength(cutsBefore.length);

  // Two assertions, and the first is the one that catches the regression: at
  // least one cut sat after an insertion, so its offset *must* have moved. An
  // unremapped fit leaves every cluster exactly where it was, and this fails.
  const moved = cutsAfter.some((c, i) => c.cluster !== cutsBefore[i].cluster);
  expect(moved, "no cut offset moved, so the fit did not remap them").toBe(true);

  // And the second says the move was *right*, not merely present: every cut
  // still points at the character it was made on.
  expect(cutsAfter.map((c) => after.text[c.cluster])).toEqual(charsBefore);
});
