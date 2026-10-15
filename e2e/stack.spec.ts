import { expect, test, type Page } from "@playwright/test";
import {
  blockClientBox,
  chooseFont,
  getBlocks,
  gotoApp,
  hitTargetAt,
  namedNodeCount,
  settleFrames,
  setBlockText,
  type Point,
} from "./harf";

/**
 * Stacked compositions: converting a text block into independently placed
 * pieces, and dragging a letter along its reading-order chain.
 */
const WORD = "مصبح";

type PieceLite = { role: string; order: number; y: number; parentId?: string };
const piecesOf = (page: Page) =>
  getBlocks(page).then((b) => (b[0] as unknown as { pieces: PieceLite[] }).pieces);

async function convert(page: Page) {
  await page.getByLabel("Convert to stacked composition").click();
  await expect.poll(async () => (await getBlocks(page))[0].type).toBe("stack");
  await settleFrames(page);
}

/** Centre of the i-th mounted `stack-piece` hit polygon, in page px. */
async function pieceCentre(page: Page, index: number): Promise<Point> {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getStage()!;
    const node = stage.find(".stack-piece")[i];
    const r = node.getClientRect();
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
  }, index);
}

test("converting bakes the block into pieces and undo brings the text back", async ({
  page,
}) => {
  await gotoApp(page);
  // UKIJ Diwani needs no tatweel fallback, so convert is footprint-neutral.
  await chooseFont(page, "UKIJ Diwani");
  await setBlockText(page, WORD);
  await settleFrames(page);

  await convert(page);
  const block = (await getBlocks(page))[0];
  expect(block.type).toBe("stack");
  expect((block as unknown as { pieces: unknown[] }).pieces.length).toBeGreaterThanOrEqual(4);
  const baked = await blockClientBox(page, 1);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await getBlocks(page))[0].type).toBe("text");
  // Convert-and-touch-nothing is the identity, give or take a pixel. Measured
  // against the restored text block, not one read before converting: under
  // parallel load that read can land before the new font has shaped (it was
  // 217.6 px against a settled 203.3 px), whereas by now the shape is cached.
  await expect
    .poll(async () => Math.abs((await blockClientBox(page, 1)).width - baked.width))
    .toBeLessThan(3);
});

/**
 * A page-space point inside the i-th `stack-piece` polygon that the stage
 * really routes to that polygon: letters overlap and outlines are concave, so
 * the bbox centre can land on a neighbour or on nothing.
 */
async function pointOnPiece(page: Page, index: number): Promise<Point | null> {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getStage()!;
    const node = stage.find(".stack-piece")[i];
    const r = node.getClientRect();
    const box = stage.container().getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    let best: { x: number; y: number; d: number } | null = null;
    for (let gy = 0; gy <= 12; gy++) {
      for (let gx = 0; gx <= 12; gx++) {
        const x = r.x + (r.width * gx) / 12, y = r.y + (r.height * gy) / 12;
        if (stage.getIntersection({ x, y }) !== node) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best ? { x: box.left + best.x, y: box.top + best.y } : null;
  }, index);
}

/**
 * Hover the i-th piece, then a point on it that really routes to its body.
 * Hovering first matters: the free ends of a hovered letter's straight
 * strokes are cut targets, and a press there cuts instead of moving.
 */
async function grabPoint(page: Page, index: number): Promise<Point> {
  const c = await pieceCentre(page, index);
  await page.mouse.move(c.x, c.y);
  await settleFrames(page);
  const at = await pointOnPiece(page, index);
  expect(at).not.toBeNull();
  return at!;
}

test("dragging a letter lifts it and the letters after it", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  await convert(page);

  const before = await piecesOf(page);
  const letters = before
    .filter((p) => p.role === "letter" && !p.parentId)
    .sort((a, b) => a.order - b.order);
  expect(letters.length).toBeGreaterThanOrEqual(3);
  // Hit polygons mount in `pieces` order.
  const idx = before.indexOf(letters[1]);
  const c = await grabPoint(page, idx);

  await page.mouse.move(c.x, c.y);
  await settleFrames(page);
  await page.mouse.down();
  // Small first step, then the travel (see e2e-tests.md).
  await page.mouse.move(c.x + 1, c.y - 2);
  await page.mouse.move(c.x, c.y - 60, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);

  const after = (await piecesOf(page))
    .filter((p) => p.role === "letter" && !p.parentId)
    .sort((a, b) => a.order - b.order);
  expect(after[0].y).toBeCloseTo(letters[0].y, 3); // the first letter stayed
  expect(after[1].y).toBeLessThan(letters[1].y - 10); // the dragged one rose (y is down)
  expect(after[2].y).toBeLessThan(letters[2].y - 10); // and carried the chain
  expect((await blockClientBox(page, 1)).height).toBeGreaterThan(0);
});

type PieceFull = { id: string; role: string; order: number; x: number; y: number; rotation: number; parentId?: string };
const fullPiecesOf = (page: Page) =>
  getBlocks(page).then((b) => (b[0] as unknown as { pieces: PieceFull[] }).pieces);

/**
 * Hover letters until one shows a cut span (the free end of a straight
 * stroke), and return a page point that routes to that span.
 */
async function findCutSpan(page: Page, letterIndexes: number[]): Promise<Point> {
  for (const i of letterIndexes) {
    const c = await pieceCentre(page, i);
    await page.mouse.move(c.x, c.y);
    await settleFrames(page);
    if ((await namedNodeCount(page, "stack-cut")) === 0) continue;
    const at = await page.evaluate(() => {
      const stage = window.__HARF__!.getStage()!;
      const box = stage.container().getBoundingClientRect();
      // Whole page px: Chrome delivers mouse events at integer positions, so
      // a point that only hits at a fraction would miss under the real press.
      for (const node of stage.find(".stack-cut")) {
        const r = node.getClientRect();
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        let best: { x: number; y: number; d: number } | null = null;
        for (let gy = 0; gy <= 8; gy++) {
          for (let gx = 0; gx <= 8; gx++) {
            const px = Math.round(box.left + r.x + (r.width * gx) / 8), py = Math.round(box.top + r.y + (r.height * gy) / 8);
            const x = px - box.left, y = py - box.top;
            if (stage.getIntersection({ x, y }) !== node) continue;
            const d = Math.hypot(x - cx, y - cy);
            if (!best || d < best.d) best = { x: px, y: py, d };
          }
        }
        if (best) return { x: best.x, y: best.y };
      }
      return null;
    });
    if (at) return at;
  }
  throw new Error("no letter offered a cut span");
}

test("pulling the end of a stroke cuts it and drags the tail in one gesture", async ({ page }) => {
  await gotoApp(page);
  await chooseFont(page, "UKIJ Diwani");
  await setBlockText(page, WORD);
  await settleFrames(page);
  await convert(page);

  const before = await fullPiecesOf(page);
  const capsBefore = before.filter((p) => p.role === "letter" && p.parentId).length;
  const letterIdx = before.map((p, i) => (p.role === "letter" && !p.parentId ? i : -1)).filter((i) => i >= 0);

  // No handles at rest: the chrome appears only under the pointer.
  expect(await namedNodeCount(page, "stack-cut")).toBe(0);
  const at = await findCutSpan(page, letterIdx);
  await page.mouse.move(at.x, at.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, at)).toBe("Line.stack-cut");
  await page.mouse.down();
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length + 1);
  const split = await fullPiecesOf(page);
  const caps = split.filter((p) => p.role === "letter" && p.parentId);
  expect(caps.length).toBe(capsBefore + 1);
  const cap = caps.find((c) => !before.some((p) => p.id === c.id))!;
  expect(cap).toBeDefined();

  // Same gesture: the press cut, the drag pulls the new tail.
  await page.mouse.move(at.x + 1, at.y - 2);
  await page.mouse.move(at.x + 30, at.y - 40, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);

  const after = await fullPiecesOf(page);
  expect(after.length).toBe(split.length);
  const capAfter = after.find((p) => p.id === cap.id)!;
  expect(Math.hypot(capAfter.x - cap.x, capAfter.y - cap.y)).toBeGreaterThan(10);
  for (const p of after) {
    if (p.id === cap.id) continue;
    const q = split.find((s) => s.id === p.id)!;
    expect(Math.abs(p.x - q.x)).toBeLessThan(1e-3);
    expect(Math.abs(p.y - q.y)).toBeLessThan(1e-3);
    expect(Math.abs(p.rotation - q.rotation)).toBeLessThan(1e-3);
  }

  // One undo step for cut and pull together.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length);
});

/** A page point just outside the i-th piece's top edge that routes to its tilt ring. */
async function ringPoint(page: Page, index: number): Promise<Point | null> {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getStage()!;
    const piece = stage.find(".stack-piece")[i];
    const r = piece.getClientRect();
    const box = stage.container().getBoundingClientRect();
    // Walk up from the top edge's centre column until the ring answers.
    for (const dx of [0, -8, 8, -16, 16, -24, 24]) {
      for (let dy = 2; dy <= 12; dy++) {
        const x = Math.round(r.x + r.width / 2 + dx), y = Math.round(r.y - dy);
        const hit = stage.getIntersection({ x, y });
        if (hit && hit.name() === "stack-ring") return { x: box.left + x, y: box.top + y };
      }
    }
    return null;
  }, index);
}

test("dragging just outside a letter's edge tilts it and nothing else", async ({ page }) => {
  await gotoApp(page);
  await setBlockText(page, WORD);
  await convert(page);

  const before = await fullPiecesOf(page);
  const letters = before.filter((p) => p.role === "letter" && !p.parentId).sort((a, b) => a.order - b.order);
  const idx = before.indexOf(letters[1]);
  const at = await ringPoint(page, idx);
  expect(at).not.toBeNull();
  const c = at!;
  await page.mouse.move(c.x, c.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, c)).toBe("Line.stack-ring");

  await page.mouse.down();
  await page.mouse.move(c.x + 1, c.y + 2);
  await page.mouse.move(c.x + 60, c.y + 40, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);

  const after = await fullPiecesOf(page);
  const tilted = after.find((p) => p.id === letters[1].id)!;
  expect(Math.abs(tilted.rotation - letters[1].rotation)).toBeGreaterThan(0.05);
  expect(Math.abs(tilted.x - letters[1].x)).toBeLessThan(1e-3);
  expect(Math.abs(tilted.y - letters[1].y)).toBeLessThan(1e-3);
  for (const p of after) {
    if (p.id === tilted.id) continue;
    const q = before.find((b) => b.id === p.id)!;
    expect(Math.abs(p.rotation - q.rotation)).toBeLessThan(1e-3);
    expect(Math.abs(p.x - q.x)).toBeLessThan(1e-3);
  }
});

type JoinLite = { id: string; bow: number; depth?: number };
const joinsOf = (page: Page) =>
  getBlocks(page).then((b) => (b[0] as unknown as { joins: JoinLite[] }).joins);

/** A page point on a `stack-join` hit band, with the node's React key order index. */
async function joinPoint(page: Page, which: number | null): Promise<{ x: number; y: number; index: number } | null> {
  return page.evaluate((w) => {
    const stage = window.__HARF__!.getStage()!;
    const box = stage.container().getBoundingClientRect();
    const nodes = stage.find(".stack-join");
    for (let n = 0; n < nodes.length; n++) {
      if (w !== null && n !== w) continue;
      const node = nodes[n];
      const r = node.getClientRect();
      for (let gy = 0; gy <= 8; gy++) for (let gx = 0; gx <= 8; gx++) {
        const x = Math.round(r.x + (r.width * gx) / 8), y = Math.round(r.y + (r.height * gy) / 8);
        if (stage.getIntersection({ x, y }) === node) return { x: box.left + x, y: box.top + y, index: n };
      }
    }
    return null;
  }, which);
}

test("dragging a join curve bends it; double-click straightens", async ({ page }) => {
  await gotoApp(page);
  await chooseFont(page, "UKIJ Diwani");
  await setBlockText(page, WORD);
  await settleFrames(page);
  await convert(page);

  // Fresh from convert every join is zero-length (its faces touch), so there
  // is nothing to bend until a letter moves: lift the second letter first.
  const initial = await fullPiecesOf(page);
  const letters = initial.filter((p) => p.role === "letter" && !p.parentId).sort((a, b) => a.order - b.order);
  const g = await grabPoint(page, initial.indexOf(letters[1]));
  await page.mouse.move(g.x, g.y);
  await settleFrames(page);
  await page.mouse.down();
  await page.mouse.move(g.x + 1, g.y - 2);
  await page.mouse.move(g.x, g.y - 60, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);

  const before = await joinsOf(page);
  expect(before.length).toBeGreaterThan(0);
  await expect.poll(() => namedNodeCount(page, "stack-join")).toBeGreaterThan(0);
  const piecesBefore = await fullPiecesOf(page);
  const at = await joinPoint(page, null);
  expect(at).not.toBeNull();
  const c = at!;
  await page.mouse.move(c.x, c.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, c)).toBe("Line.stack-join");

  // Along the tangent: the faces here are horizontal, and on such a join the
  // curve's midpoint can only move along the tangent (see stacked-compositions.md).
  await page.mouse.down();
  await page.mouse.move(c.x + 2, c.y + 1);
  await page.mouse.move(c.x + 40, c.y, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);

  const bent = await joinsOf(page);
  const changed = bent.filter((j, i) =>
    Math.abs(j.bow - before[i].bow) > 1e-3 || Math.abs((j.depth ?? 0) - (before[i].depth ?? 0)) > 1e-3);
  expect(changed.length).toBe(1);

  // The drag was read as a bend, not a letter drag: no piece moved.
  const piecesAfter = await fullPiecesOf(page);
  for (const p of piecesAfter) {
    const q = piecesBefore.find((b) => b.id === p.id)!;
    expect(Math.abs(p.x - q.x)).toBeLessThan(1e-3);
    expect(Math.abs(p.y - q.y)).toBeLessThan(1e-3);
  }

  // The curve moved under the pointer; find it again before the double-click.
  const again = await joinPoint(page, c.index);
  expect(again).not.toBeNull();
  await page.mouse.move(again!.x, again!.y);
  await settleFrames(page);
  await page.mouse.dblclick(again!.x, again!.y);
  await settleFrames(page);
  const straight = await joinsOf(page);
  expect(straight.every((j) => j.bow === 0 && (j.depth ?? 0) === 0)).toBe(true);
});
