import { expect, test } from "@playwright/test";
import {
  DIACRITIC_MOVE_HANDLE_FILL,
  armDiacriticMoveHandle,
  chooseFont,
  diacriticHitCenters,
  dotCentersWithFill,
  dragFromHere,
  getBlocks,
  gotoApp,
  hitTargetAt,
  setBlockText,
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

/**
 * The overlay used to unmount its own handle the instant the pointer landed
 * on it: the hover hit `Rect` and the handle `Circle` were sibling Konva
 * nodes, so moving between them fired `mouseleave` on the rect and cleared
 * the hover state. Measured before the fix, the handle was mounted on
 * exactly every other mousemove. It now stays put, because the hover
 * handlers sit on the Group that owns both nodes.
 */
test("a handle stays mounted while the pointer sits on it", async ({ page }) => {
  await gotoApp(page);
  await page.locator("textarea.sidebarTextarea").fill(VOCALIZED);
  await expect.poll(() => diacriticHitCenters(page).then((m) => m.length)).toBeGreaterThan(0);

  const handle = await armDiacriticMoveHandle(page);

  // Nudge back and forth across the handle. Every one of these moves used
  // to toggle the handle out of existence on alternate frames.
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(handle.x + (i % 2 === 0 ? 0.5 : -0.5), handle.y);
    await settleFrames(page);
    expect(
      (await dotCentersWithFill(page, DIACRITIC_MOVE_HANDLE_FILL)).length,
      `handle vanished on move ${i}`
    ).toBeGreaterThan(0);
  }
});

/**
 * The same race killed slow drags outright. Konva suppresses its enter/leave
 * processing only once a drag reaches `dragging`, not while it is merely
 * `ready`, so a first step under ~20px (at the app's default 2.75x zoom)
 * retargeted hover and destroyed the node the gesture was attached to.
 * A deliberately tiny first step is the sharpest regression test there is.
 */
test("a drag with a small first step still moves the mark", async ({ page }) => {
  await gotoApp(page);
  await page.locator("textarea.sidebarTextarea").fill(VOCALIZED);
  await expect.poll(() => diacriticHitCenters(page).then((m) => m.length)).toBeGreaterThan(0);

  const handle = await armDiacriticMoveHandle(page);

  await page.mouse.down();
  // 2px first — measured as a losing step before the fix.
  await page.mouse.move(handle.x, handle.y + 2);
  await page.mouse.move(handle.x, handle.y + 40, { steps: 20 });
  await page.mouse.up();

  const block = (await getBlocks(page))[0];
  const overrides = block.diacriticOverrides ?? [];
  expect(overrides.length).toBeGreaterThan(0);
  expect(overrides[0].offsetY ?? 0).toBeGreaterThan(5);
  expect(block.y).toBe(0);
});

/**
 * Whether the overlay arms at all is a property of mark *detection*, and
 * detection reads three signals that different fonts satisfy differently.
 * These two fonts are the ends of that range, and both were wrong before
 * the source-text allowance was added to `findDiacriticGlyphIndices`.
 */
test("a font whose marks are PUA-encoded still arms the overlay (Thuluth)", async ({ page }) => {
  await gotoApp(page);
  await chooseFont(page, "Thuluth");
  await setBlockText(page, VOCALIZED);

  // Thuluth draws every mark as its own Private Use Area glyph with no
  // GPOS offset, so neither the cmap check nor the attachment-offset
  // fallback sees it. Its zero advance is what identifies it.
  await expect
    .poll(() => diacriticHitCenters(page).then((m) => m.length))
    .toBeGreaterThan(0);
});

test("a letter's own dots never arm the overlay (Noto Sans)", async ({ page }) => {
  await gotoApp(page);
  await chooseFont(page, "Noto Sans");
  // No combining marks at all — every hoverable mark here would be a
  // false positive. Noto Sans draws the feh's dot as a separate
  // zero-advance glyph attached to its base, which is the shape the
  // attachment-offset signal reads as a mark.
  await setBlockText(page, "حرف");

  await settleFrames(page);
  expect(await diacriticHitCenters(page)).toHaveLength(0);
});
