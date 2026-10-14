import { expect, test, type Page } from "@playwright/test";
import {
  DETACHED_MARK_HANDLE_FILL,
  addOrnamentShapeFill,
  detachedMarkHitCenters,
  dotCentersWithFill,
  dragFromHere,
  getBlocks,
  gotoApp,
  hitTargetAt,
  inkPixels,
  openTypography,
  parkOnDot,
  setBlockText,
  settleFrames,
} from "./harf";

/**
 * Moving a letter's own dots. The default font (FatemiMaqala) draws every
 * dot of ثبت as its own contour, none fused and none merged — six marks.
 */
const WORD = "ثبت";

async function armDotHandle(page: Page) {
  await openTypography(page);
  await page.getByLabel("Move dots & marks").check();
  await expect.poll(() => detachedMarkHitCenters(page).then((m) => m.length)).toBeGreaterThan(0);
  const dot = await parkOnDot(page, await detachedMarkHitCenters(page), DETACHED_MARK_HANDLE_FILL);
  if (!dot) throw new Error(`no dot handle mounted on "${WORD}" in the default font`);
  return dot;
}

test("arming the tool mounts a hit rect per dot", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  await openTypography(page);
  expect(await detachedMarkHitCenters(page)).toHaveLength(0);
  await page.getByLabel("Move dots & marks").check();
  await expect.poll(() => detachedMarkHitCenters(page).then((m) => m.length)).toBe(6);
});

test("the handle stays mounted while the pointer sits on it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const dot = await armDotHandle(page);
  // The sibling-hover-handler defect this codebase has hit twice shows up
  // as the handle being present on exactly every other move.
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(dot.x + (i % 2 === 0 ? 0.5 : -0.5), dot.y);
    await settleFrames(page);
    expect(
      (await dotCentersWithFill(page, DETACHED_MARK_HANDLE_FILL)).length,
      `handle vanished on move ${i}`
    ).toBeGreaterThan(0);
  }
});

test("a diagonal drag records dx and dy, and the ink moves without a hole", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const inkBefore = await inkPixels(page);
  const dot = await armDotHandle(page);
  expect(await hitTargetAt(page, dot)).toMatch(/^Circle/);
  await dragFromHere(page, { x: dot.x - 30, y: dot.y + 30 }, { via: { x: dot.x - 2, y: dot.y + 2 } });
  await settleFrames(page);
  const block = (await getBlocks(page))[0];
  const marks = block.detachedMarkOverrides ?? [];
  expect(marks).toHaveLength(1);
  expect(Math.abs(marks[0].dx)).toBeGreaterThan(5);
  expect(Math.abs(marks[0].dy)).toBeGreaterThan(5);
  // A dot dragged onto its letter unions with it (nonzero fill): the ink
  // count may fall by the overlap but never below the body alone, which is
  // far more than a one-dot loss.
  const inkAfter = await inkPixels(page);
  expect(inkAfter).toBeGreaterThan(inkBefore * 0.8);
});

test("a Shape Fill block arms a hit rect per dot in every tile", async ({ page }) => {
  await gotoApp(page);
  const id = await addOrnamentShapeFill(page);
  await setBlockText(page, WORD, id);
  await openTypography(page);
  await page.getByLabel("Move dots & marks").check();
  // Six dots per repetition; the silhouette tiles the word more than once.
  await expect.poll(() => detachedMarkHitCenters(page).then((m) => m.length)).toBeGreaterThan(6);
});

test("Reset dots & marks clears the overrides", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  const dot = await armDotHandle(page);
  await dragFromHere(page, { x: dot.x, y: dot.y + 40 }, { via: { x: dot.x, y: dot.y + 2 } });
  await settleFrames(page);
  expect(((await getBlocks(page))[0].detachedMarkOverrides ?? []).length).toBe(1);
  await page.getByRole("button", { name: "Reset dots & marks" }).click();
  expect(((await getBlocks(page))[0].detachedMarkOverrides ?? []).length).toBe(0);
});
