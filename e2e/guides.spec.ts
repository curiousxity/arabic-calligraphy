import { expect, test, type Page } from "@playwright/test";
import {
  blockClientBox,
  centerOf,
  dragMouse,
  getBlocks,
  gotoApp,
  openPanel,
  placeAtCanvas,
  settleFrames,
} from "./harf";
import type { GuideBlock, TextPathBlock } from "../src/types";

/**
 * A guide is a construction line: texts attached to it keep their size,
 * follow it, slide along it, and outlive it. The unit suites prove the
 * placement maths against real shaping; what only a browser shows is that the
 * texts really follow a dragged guide, slide under a drag, survive the guide's
 * deletion, and that the guide is marked for every export to skip.
 */

const guides = async (page: Page) =>
  (await getBlocks(page)).filter((b): b is GuideBlock => b.type === "guide");
const attached = async (page: Page) =>
  (await getBlocks(page)).filter((b): b is TextPathBlock => b.type === "textPath" && !!b.guide);

async function selectInLayers(page: Page, label: string) {
  await openPanel(page, /^Layers/);
  await page.getByText(label, { exact: true }).first().click();
}

async function addGuide(page: Page, shape: string, fx = 0.5, fy = 0.5) {
  await page.getByRole("button", { name: "Add guide" }).click();
  await page.getByRole("button", { name: `${shape} guide` }).click();
  await placeAtCanvas(page, fx, fy);
  await expect.poll(async () => (await guides(page)).length).toBeGreaterThan(0);
}

/** Sets a range input the way a drag would: native setter, then the `input` event React listens for. */
async function setRange(page: Page, label: RegExp, value: number) {
  await page.getByLabel(label).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function addCircleWithTwoTexts(page: Page) {
  await gotoApp(page);
  await addGuide(page, "Circle");
  // Small enough that the whole circle, its top included, is on screen at
  // the app's opening zoom.
  await setRange(page, /^Diameter/, 120);
  await expect.poll(async () => (await guides(page))[0].guideParams?.width).toBe(120);
  await page.getByRole("button", { name: "Add text to guide" }).click();
  await expect.poll(async () => (await attached(page)).length).toBe(1);
  await selectInLayers(page, "Guide · Circle");
  await page.getByRole("button", { name: "Add text to guide" }).click();
  await expect.poll(async () => (await attached(page)).length).toBe(2);
  await settleFrames(page);
}

test("texts attached to a guide follow the guide when it is dragged", async ({ page }) => {
  await addCircleWithTwoTexts(page);
  const [t1] = await attached(page);
  const before = await blockClientBox(page, t1.id);
  const g = (await guides(page))[0];
  // Grab the guide's dashed line at its right-hand point.
  const gBox = await blockClientBox(page, g.id);
  const grab = { x: gBox.x + gBox.width - 2, y: gBox.y + gBox.height / 2 };
  await dragMouse(page, grab, { x: grab.x + 80, y: grab.y + 40 });
  await settleFrames(page);
  const after = await blockClientBox(page, t1.id);
  expect(after.x - before.x).toBeGreaterThan(40);
  expect(after.y - before.y).toBeGreaterThan(15);
});

test("dragging an attached text slides it along the guide, and one undo restores it", async ({ page }) => {
  await addCircleWithTwoTexts(page);
  // Both texts start at the top; the second is drawn over the first, so it
  // is the one a drag there picks up.
  const t1 = (await attached(page)).at(-1)!;
  // The text sits centred on the top of the circle, rising off the line; grab
  // it just above the guide's top edge.
  const gBox = await blockClientBox(page, (await guides(page))[0].id);
  const from = { x: gBox.x + gBox.width / 2, y: gBox.y - 30 };
  await dragMouse(page, from, { x: from.x + 120, y: from.y + 140 });
  const offsetOf = async () => (await attached(page)).find((b) => b.id === t1.id)!.guide!.offset;
  await expect.poll(offsetOf).not.toBe(t1.guide!.offset);
  // It slid; it did not leave the guide.
  const moved = (await getBlocks(page)).find((b) => b.id === t1.id)!;
  expect([moved.x, moved.y]).toEqual([t1.x, t1.y]);
  await page.keyboard.press("Control+z");
  await expect.poll(offsetOf).toBe(t1.guide!.offset);
});

test("deleting the guide leaves its texts as plain Curve blocks, and undo re-attaches them", async ({ page }) => {
  await addCircleWithTwoTexts(page);
  await selectInLayers(page, "Guide · Circle");
  await page.getByRole("button", { name: "Delete block" }).click();
  await expect.poll(async () => (await guides(page)).length).toBe(0);
  const curves = (await getBlocks(page)).filter((b): b is TextPathBlock => b.type === "textPath");
  expect(curves).toHaveLength(2);
  expect(curves.every((c) => !c.guide)).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await guides(page)).length).toBe(1);
  await expect.poll(async () => (await attached(page)).length).toBe(2);
});

test("a plain text block can be attached to a guide", async ({ page }) => {
  await gotoApp(page);
  const starter = (await getBlocks(page)).find((b) => b.type === "text")!;
  await addGuide(page, "Line", 0.5, 0.75);
  await selectInLayers(page, `Block ${starter.id}`);
  await page.getByLabel("Attach to guide").selectOption({ label: "Guide · Line" });
  await expect.poll(async () => (await attached(page)).map((b) => b.id)).toEqual([starter.id]);
});

test("a guide is marked for every export to leave out", async ({ page }) => {
  await gotoApp(page);
  await addGuide(page, "Circle");
  const g = (await guides(page))[0];
  const hidden = await page.evaluate((id) => {
    const node = window.__HARF__!.getStage()?.findOne(`#block-${id}`);
    return node?.hasName("export-hidden") ?? false;
  }, g.id);
  expect(hidden).toBe(true);
});

test("deleting a guide from the Layers panel also keeps its texts in place", async ({ page }) => {
  await addCircleWithTwoTexts(page);
  // Reshape the guide after the texts were attached, so a fallback that kept
  // the attach-time curve would be caught.
  await selectInLayers(page, "Guide · Circle");
  await setRange(page, /^Diameter/, 160);
  await expect.poll(async () => (await guides(page))[0].guideParams?.width).toBe(160);
  await settleFrames(page);
  const g = (await guides(page))[0];
  const textBox = await blockClientBox(page, (await attached(page))[0].id);
  await page.getByRole("button", { name: "Delete selected layer" }).click();
  await expect.poll(async () => (await guides(page)).length).toBe(0);
  const curves = (await getBlocks(page)).filter((b): b is TextPathBlock => b.type === "textPath");
  expect(curves).toHaveLength(2);
  for (const c of curves) {
    expect(c.guide).toBeUndefined();
    expect(c.textPathD).toBe(g.guideD);
    expect([c.x, c.y]).toEqual([g.x, g.y]);
  }
  // Still drawn where it was (now stretched along the curve, so wider).
  const after = await blockClientBox(page, curves[0].id);
  expect(Math.abs(after.y - textBox.y)).toBeLessThan(textBox.height + 40);
});

test("attached texts move with the guide during the drag, not only on drop", async ({ page }) => {
  await addCircleWithTwoTexts(page);
  const [t1] = await attached(page);
  const before = await blockClientBox(page, t1.id);
  const gBox = await blockClientBox(page, (await guides(page))[0].id);
  const grab = { x: gBox.x + gBox.width - 2, y: gBox.y + gBox.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 90, grab.y + 30, { steps: 12 });
  await settleFrames(page);
  const mid = await blockClientBox(page, t1.id);
  await page.mouse.up();
  expect(mid.x - before.x).toBeGreaterThan(50);
});

test("a slide with a pause in it is still one undo step", async ({ page }) => {
  await addCircleWithTwoTexts(page);
  const t1 = (await attached(page)).at(-1)!;
  const gBox = await blockClientBox(page, (await guides(page))[0].id);
  const from = { x: gBox.x + gBox.width / 2, y: gBox.y - 30 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 40, { steps: 8 });
  await page.waitForTimeout(600);
  await page.mouse.move(from.x + 140, from.y + 150, { steps: 8 });
  await page.mouse.up();
  const offsetOf = async () => (await attached(page)).find((b) => b.id === t1.id)!.guide!.offset;
  await expect.poll(offsetOf).not.toBe(t1.guide!.offset);
  await page.keyboard.press("Control+z");
  await expect.poll(offsetOf).toBe(t1.guide!.offset);
});

/** A guide on screen at the opening zoom, selected, with nothing on it yet. */
async function addSmallCircle(page: Page) {
  await gotoApp(page);
  await addGuide(page, "Circle");
  await setRange(page, /^Diameter/, 120);
  await expect.poll(async () => (await guides(page))[0].guideParams?.width).toBe(120);
  await settleFrames(page);
  return (await guides(page))[0];
}

const writingField = (page: Page) => page.getByLabel("Write on guide");

/**
 * Starts writing on the selected guide by pressing a key, then types `text`.
 * Playwright cannot press a key outside the US layout (`keyboard.type` turns
 * an Arabic letter into an `insertText`, with no keydown at all), so the
 * session opens on a Latin key and the real words replace it in the field.
 */
async function writeOnSelectedGuide(page: Page, text: string) {
  await page.keyboard.press("s");
  await expect(writingField(page)).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
}

test("typing with a guide selected writes on it; Escape keeps the words", async ({ page }) => {
  await addSmallCircle(page);
  await writeOnSelectedGuide(page, "سلام");
  await expect.poll(async () => (await attached(page)).map((b) => b.text)).toEqual(["سلام"]);
  await page.keyboard.press("Escape");
  await expect(writingField(page)).toHaveCount(0);
  const [t] = await attached(page);
  expect(t.text).toBe("سلام");
  // Anchored at the reading start, so what was typed never shifted.
  expect(t.guide!.align).toBe("start");
});

test("a double-click on the guide starts writing there; leaving before typing adds nothing", async ({ page }) => {
  const g = await addSmallCircle(page);
  const gBox = await blockClientBox(page, g.id);
  // The right-hand point of the circle.
  await page.mouse.dblclick(gBox.x + gBox.width - 2, gBox.y + gBox.height / 2);
  await expect(writingField(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(writingField(page)).toHaveCount(0);
  expect(await attached(page)).toHaveLength(0);
  expect(await guides(page)).toHaveLength(1);
  // The bottom point: offset 0.5 on a top-start clockwise circle.
  await page.mouse.dblclick(gBox.x + gBox.width / 2, gBox.y + gBox.height - 2);
  await expect(writingField(page)).toBeFocused();
  await page.keyboard.type("اب");
  await expect.poll(async () => (await attached(page)).map((b) => b.text)).toEqual(["اب"]);
  const [t] = await attached(page);
  expect(t.guide!.align).toBe("start");
  expect(t.guide!.offset).toBeCloseTo(0.5, 1);
});

test("a double-click on words written on a guide keeps writing them", async ({ page }) => {
  await addSmallCircle(page);
  await writeOnSelectedGuide(page, "سلام");
  await expect.poll(async () => (await attached(page)).map((b) => b.text)).toEqual(["سلام"]);
  await page.keyboard.press("Escape");
  await expect(writingField(page)).toHaveCount(0);
  await settleFrames(page);
  const t = (await attached(page))[0];
  const c = centerOf(await blockClientBox(page, t.id));
  await page.mouse.dblclick(c.x, c.y);
  await expect(writingField(page)).toBeFocused();
  await expect(writingField(page)).toHaveValue("سلام");
  await page.keyboard.type("ي");
  await expect.poll(async () => (await attached(page)).map((b) => b.text)).toEqual(["سلامي"]);
});
