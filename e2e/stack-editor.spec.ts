import { expect, test, type Page } from "@playwright/test";
import { blockClientBox, getBlocks, gotoApp, namedNodeCount, settleFrames, setBlockText } from "./harf";

/**
 * The stack editor window: opening, staging, templates. Gestures themselves
 * are covered in stack.spec.ts.
 */
const WORD = "مصبح";

type PieceLite = { id: string; role: string; x: number; y: number; rotation: number; parentId?: string; filler?: boolean };
const blockOf = (page: Page) => getBlocks(page).then((b) => b[0] as unknown as { type: string; x: number; y: number; fontSize: number; pieces: PieceLite[] });

/** Same as stack.spec.ts's `convert`. */
async function convert(page: Page) {
  await page.getByLabel("Convert to stacked composition").click();
  await expect.poll(async () => (await blockOf(page)).type).toBe("stack");
  await settleFrames(page);
}

async function openByDoubleClick(page: Page) {
  const box = await blockClientBox(page, 1);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId("stack-editor").waitFor();
  await page.waitForFunction(() => !!window.__HARF__?.getEditorStage());
  await settleFrames(page);
}

/** Centre of the i-th `stack-piece` hit polygon in the window, page px. */
async function pieceCentre(page: Page, index: number) {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getEditorStage()!;
    const node = stage.find(".stack-piece")[i];
    const r = node.getClientRect();
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
  }, index);
}

async function dragPiece(page: Page, index: number, dy: number) {
  const c = await pieceCentre(page, index);
  await page.mouse.move(c.x, c.y);
  await settleFrames(page);
  await page.mouse.down();
  await page.mouse.move(c.x + 1, c.y - 2);
  await page.mouse.move(c.x, c.y + dy, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);
}

/** Width over height of the dashed template outline in the window. */
async function outlineAspect(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const node = window.__HARF__!.getEditorStage()?.findOne(".stack-template-outline");
    if (!node) return null;
    const r = node.getClientRect();
    return r.width / r.height;
  });
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  await convert(page);
});

test("double-click and the panel button both open the window; Escape closes an untouched one without asking", async ({ page }) => {
  await openByDoubleClick(page);
  expect(await namedNodeCount(page, "stack-piece", { editor: true })).toBeGreaterThan(0);
  // The canvas itself mounts no editing chrome any more.
  expect(await namedNodeCount(page, "stack-piece")).toBe(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  await expect(page.getByRole("dialog", { name: /Discard/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit composition", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor();
});

test("Cancel after a drag leaves the block as it was", async ({ page }) => {
  const before = await blockOf(page);
  await openByDoubleClick(page);
  await dragPiece(page, 1, -60);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  const after = await blockOf(page);
  expect(after.pieces).toEqual(before.pieces);
});

test("Done after a drag commits one history step; Ctrl+Z on the canvas restores", async ({ page }) => {
  const before = await blockOf(page);
  await openByDoubleClick(page);
  await dragPiece(page, 1, -60);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  const after = await blockOf(page);
  expect(after.pieces).not.toEqual(before.pieces);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await blockOf(page)).pieces).toEqual(before.pieces);
});

test("undo inside the window steps the draft, not the canvas", async ({ page }) => {
  const before = await blockOf(page);
  await openByDoubleClick(page);
  await dragPiece(page, 1, -60);
  await page.keyboard.press("Control+z");
  await settleFrames(page);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  expect((await blockOf(page)).pieces).toEqual(before.pieces);
});

test("Teardrop arranges the letters in place: size changes, origin does not, outline shows; Free clears the outline", async ({ page }) => {
  const before = await blockOf(page);
  await openByDoubleClick(page);
  await page.getByRole("button", { name: "Teardrop", exact: true }).click();
  await expect.poll(() => namedNodeCount(page, "stack-template-outline", { editor: true })).toBe(1);
  // Scoped: the sidebar has a status line of its own.
  await expect(page.getByTestId("stack-editor").getByRole("status")).toContainText(/Arranged \d+ letters? in \d+ rows?/);
  await page.getByRole("button", { name: "Free", exact: true }).click();
  await expect.poll(() => namedNodeCount(page, "stack-template-outline", { editor: true })).toBe(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  const after = await blockOf(page);
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  expect(after.fontSize).not.toBe(before.fontSize);
  const letters = (p: PieceLite[]) => p.filter((q) => q.role === "letter" && !q.parentId).length;
  expect(letters(after.pieces)).toBe(letters(before.pieces));
});

test("a later template pick wins over a slower earlier one", async ({ page }) => {
  await openByDoubleClick(page);
  await page.getByRole("button", { name: "Teardrop", exact: true }).click();
  await page.getByRole("button", { name: "Almond", exact: true }).click();
  await expect.poll(() => namedNodeCount(page, "stack-template-outline", { editor: true })).toBe(1);
  // The outline that landed is the almond's (220:400 ≈ 0.55), not the
  // teardrop's (260:380 ≈ 0.68): the slower first arrange was dropped.
  // Letting the fillers load twice settles both before we read.
  await page.waitForTimeout(500);
  await expect.poll(() => outlineAspect(page)).toBeLessThan(0.62);
  await expect(page.getByRole("button", { name: "Almond", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Done on an untouched window records no history step", async ({ page }) => {
  await openByDoubleClick(page);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
  // The only step on the stack is the conversion: one undo returns the text block.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await blockOf(page)).type).toBe("text");
});

test("only closed guides are offered as cards", async ({ page }) => {
  await openByDoubleClick(page);
  // A fresh document has no guides: Free, Teardrop, Almond and nothing else.
  const cards = page.getByRole("group", { name: "Templates" }).getByRole("button");
  await expect(cards).toHaveCount(3);
});
