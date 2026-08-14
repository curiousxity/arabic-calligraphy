import { expect, test } from "@playwright/test";
import {
  DIACRITIC_MOVE_HANDLE_FILL,
  armDiacriticMoveHandle,
  diacriticHitCenters,
  dotCentersWithFill,
  dragFromHere,
  getBlocks,
  gotoApp,
  hitTargetAt,
  settleFrames,
} from "./harf";

/**
 * The per-mark diacritic overlay is the hardest thing in this app to check
 * without a browser: its handles exist only while the pointer is over a
 * mark, they are Konva nodes rather than DOM elements, and the drag they
 * accept is a small target sitting on top of a draggable block.
 *
 * `مُحَمَّد` is used because every font in `public/fonts/` shapes it with
 * several separately positioned marks.
 */
const VOCALIZED = "مُحَمَّد";

test("hovering a diacritic mounts its handles", async ({ page }) => {
  await gotoApp(page);
  await page.locator("textarea.sidebarTextarea").fill(VOCALIZED);

  await expect.poll(() => diacriticHitCenters(page).then((m) => m.length)).toBeGreaterThan(0);
  // Nothing is hovered yet, so no handle should be mounted.
  expect(await dotCentersWithFill(page, DIACRITIC_MOVE_HANDLE_FILL)).toHaveLength(0);

  const marks = await diacriticHitCenters(page);
  await page.mouse.move(marks[0].x, marks[0].y);
  await settleFrames(page);

  expect((await dotCentersWithFill(page, DIACRITIC_MOVE_HANDLE_FILL)).length).toBeGreaterThan(0);
});

test("dragging a diacritic move handle records an override", async ({ page }) => {
  await gotoApp(page);
  await page.locator("textarea.sidebarTextarea").fill(VOCALIZED);
  await expect.poll(() => diacriticHitCenters(page).then((m) => m.length)).toBeGreaterThan(0);

  expect((await getBlocks(page))[0].diacriticOverrides ?? []).toHaveLength(0);

  const handle = await armDiacriticMoveHandle(page);
  expect(await hitTargetAt(page, handle)).toMatch(/^Circle/);

  await dragFromHere(page, { x: handle.x, y: handle.y + 40 });

  const block = (await getBlocks(page))[0];
  const overrides = block.diacriticOverrides ?? [];
  expect(overrides.length).toBeGreaterThan(0);
  // The handle's rail holds x and varies y, so a downward drag has to land
  // as a positive offsetY. A near-zero value would mean the gesture reached
  // the node but the rail projection swallowed it.
  expect(overrides[0].offsetY ?? 0).toBeGreaterThan(5);
  // The gesture must have been consumed by the handle, not by the block
  // underneath it — that fall-through is the exact failure this suite exists
  // to rule out.
  expect(block.y).toBe(0);
});
