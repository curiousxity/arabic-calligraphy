import { expect, test } from "@playwright/test";
import {
  armDiacriticMoveHandle,
  diacriticHitCenters,
  dragFromHere,
  getBlocks,
  gotoApp,
  hitTargetAt,
  placeAtCanvas,
  settleFrames,
} from "./harf";

/** Every bundled font shapes this with several separately positioned marks. */
const VOCALIZED = "مُحَمَّد";

async function addVocalizedCurve(page: import("@playwright/test").Page) {
  await gotoApp(page);
  await page.getByRole("button", { name: "Add curved text" }).click();
  await placeAtCanvas(page, 0.5, 0.5);
  // A curve stretches its text to span it, so one short word is drawn huge
  // and its marks sit above the viewport at the default zoom.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom out" }).click();
  await expect
    .poll(async () => (await getBlocks(page)).some((b) => b.type === "textPath"))
    .toBe(true);
  await page.locator("textarea.sidebarTextarea").fill(VOCALIZED);
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.type === "textPath")?.text)
    .toBe(VOCALIZED);
  await expect.poll(() => diacriticHitCenters(page).then((m) => m.length)).toBeGreaterThan(0);
}

test("a mark on a curve can be dragged, and the curve itself stays put", async ({ page }) => {
  await addVocalizedCurve(page);
  const before = (await getBlocks(page)).find((b) => b.type === "textPath")!;
  expect(before.diacriticOverrides ?? []).toHaveLength(0);

  const handle = await armDiacriticMoveHandle(page);
  expect(await hitTargetAt(page, handle)).toMatch(/^Circle/);
  await dragFromHere(page, { x: handle.x + 30, y: handle.y + 30 });
  await settleFrames(page);

  const after = (await getBlocks(page)).find((b) => b.type === "textPath")!;
  const o = after.diacriticOverrides ?? [];
  expect(o.length).toBeGreaterThan(0);
  expect(Math.hypot(o[0].offsetX ?? 0, o[0].offsetY ?? 0)).toBeGreaterThan(5);
  // The handle consumed the gesture; the block underneath did not move.
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);

  // One drag is one undo step.
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.type === "textPath")?.diacriticOverrides ?? [])
    .toHaveLength(0);
});
