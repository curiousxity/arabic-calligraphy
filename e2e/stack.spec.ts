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
 * pieces, and the gestures on them — which live in the editor window
 * (StackEditorDialog), on its own stage. The block itself does not change
 * until Done, so a gesture's effect is read from the window's draft
 * (`getEditorDraft`) and the committed result from the block after `done`.
 */
const WORD = "مصبح";

type PieceLite = { role: string; order: number; y: number; parentId?: string };
type PieceFull = { id: string; role: string; order: number; x: number; y: number; rotation: number; parentId?: string };
type JoinLite = { id: string; bow: number; depth?: number };

/** The pieces the user sees: the window's draft while it is open, else the block's. */
const piecesOf = (page: Page) =>
  page.evaluate(() => (window.__HARF__!.getEditorDraft() ?? (window.__HARF__!.getBlocks()[0] as unknown as { pieces: PieceLite[] })).pieces as PieceLite[]);
const fullPiecesOf = (page: Page) =>
  page.evaluate(() => (window.__HARF__!.getEditorDraft() ?? (window.__HARF__!.getBlocks()[0] as unknown as { pieces: PieceFull[] })).pieces as PieceFull[]);
const joinsOf = (page: Page) =>
  page.evaluate(() => (window.__HARF__!.getEditorDraft() ?? (window.__HARF__!.getBlocks()[0] as unknown as { joins: JoinLite[] })).joins as JoinLite[]);

async function convert(page: Page) {
  await page.getByLabel("Convert to stacked composition").click();
  await expect.poll(async () => (await getBlocks(page))[0].type).toBe("stack");
  await settleFrames(page);
}

/** Open the editor window by double-clicking the composition; wait for its stage. */
async function openEditor(page: Page) {
  const box = await blockClientBox(page, 1);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId("stack-editor").waitFor();
  await page.waitForFunction(() => !!window.__HARF__?.getEditorStage());
  await settleFrames(page);
}

/** Commit the window's draft to the block. */
async function done(page: Page) {
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("stack-editor").waitFor({ state: "detached" });
}

/**
 * The client rect of the `stack-join` band nearest a page point, page px:
 * a freed curve's join, found by the press that freed it. Its band follows
 * the same geometry the ink is drawn from, so a bend shows here even when
 * it stays inside the composition's bounding box (a ح's arch flattened).
 */
async function joinBandNear(page: Page, press: Point) {
  return page.evaluate((pt) => {
    const stage = window.__HARF__!.getEditorStage()!;
    const box = stage.container().getBoundingClientRect();
    const rects = stage.find(".stack-join").map((node) => {
      const r = node.getClientRect();
      return { x: box.left + r.x, y: box.top + r.y, width: r.width, height: r.height };
    });
    rects.sort((a, b) =>
      Math.hypot(a.x + a.width / 2 - pt.x, a.y + a.height / 2 - pt.y) - Math.hypot(b.x + b.width / 2 - pt.x, b.y + b.height / 2 - pt.y));
    return rects[0] ?? null;
  }, press);
}
const rectDelta = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height);

/** Centre of the i-th mounted `stack-piece` hit polygon in the window, in page px. */
async function pieceCentre(page: Page, index: number): Promise<Point> {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getEditorStage()!;
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
 * A page-space point inside the i-th `stack-piece` polygon that the window's
 * stage really routes to that polygon: letters overlap and outlines are
 * concave, so the bbox centre can land on a neighbour or on nothing.
 */
async function pointOnPiece(page: Page, index: number): Promise<Point | null> {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getEditorStage()!;
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
  await openEditor(page);

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
  await done(page);

  const after = (await piecesOf(page))
    .filter((p) => p.role === "letter" && !p.parentId)
    .sort((a, b) => a.order - b.order);
  expect(after[0].y).toBeCloseTo(letters[0].y, 3); // the first letter stayed
  expect(after[1].y).toBeLessThan(letters[1].y - 10); // the dragged one rose (y is down)
  expect(after[2].y).toBeLessThan(letters[2].y - 10); // and carried the chain
  expect((await blockClientBox(page, 1)).height).toBeGreaterThan(0);
});

/**
 * Hover letters until one shows a cut span (the free end of a straight
 * stroke), and return a page point that routes to that span.
 */
async function findCutSpan(page: Page, letterIndexes: number[]): Promise<Point> {
  for (const i of letterIndexes) {
    const c = await pieceCentre(page, i);
    await page.mouse.move(c.x, c.y);
    await settleFrames(page);
    if ((await namedNodeCount(page, "stack-cut", { editor: true })) === 0) continue;
    const at = await page.evaluate(() => {
      const stage = window.__HARF__!.getEditorStage()!;
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
  await openEditor(page);

  const before = await fullPiecesOf(page);
  const capsBefore = before.filter((p) => p.role === "letter" && p.parentId).length;
  const letterIdx = before.map((p, i) => (p.role === "letter" && !p.parentId ? i : -1)).filter((i) => i >= 0);

  // No handles at rest: the chrome appears only under the pointer.
  expect(await namedNodeCount(page, "stack-cut", { editor: true })).toBe(0);
  const at = await findCutSpan(page, letterIdx);
  await page.mouse.move(at.x, at.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, at, { editor: true })).toBe("Line.stack-cut");
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

  // One undo step for cut and pull together (the window's own stack).
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length);
  // Redo it, commit, and the block carries the cap.
  await page.keyboard.press("Control+y");
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length + 1);
  await done(page);
  expect((await fullPiecesOf(page)).length).toBe(before.length + 1);
});

/** A page point just outside the i-th piece's top edge that routes to its tilt ring. */
async function ringPoint(page: Page, index: number): Promise<Point | null> {
  return page.evaluate((i) => {
    const stage = window.__HARF__!.getEditorStage()!;
    const piece = stage.find(".stack-piece")[i];
    const r = piece.getClientRect();
    const box = stage.container().getBoundingClientRect();
    // Walk up from the top edge until the ring answers, trying columns from
    // the centre outward: at the window's fit scale a concave letter's bbox
    // top-centre can sit far from any ink, and the ring hugs the ink.
    const cols: number[] = [0];
    for (let d = 8; d <= r.width / 2; d += 8) cols.push(-d, d);
    for (const dx of cols) {
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
  await openEditor(page);

  const before = await fullPiecesOf(page);
  const letters = before.filter((p) => p.role === "letter" && !p.parentId).sort((a, b) => a.order - b.order);
  const idx = before.indexOf(letters[1]);
  const at = await ringPoint(page, idx);
  expect(at).not.toBeNull();
  const c = at!;
  await page.mouse.move(c.x, c.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, c, { editor: true })).toBe("Line.stack-ring");

  await page.mouse.down();
  await page.mouse.move(c.x + 1, c.y + 2);
  await page.mouse.move(c.x + 60, c.y + 40, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);
  await done(page);

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

/** A page point on a `stack-join` hit band in the window, with the node's React key order index. */
async function joinPoint(page: Page, which: number | null): Promise<{ x: number; y: number; index: number } | null> {
  return page.evaluate((w) => {
    const stage = window.__HARF__!.getEditorStage()!;
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
  await openEditor(page);

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
  await expect.poll(() => namedNodeCount(page, "stack-join", { editor: true })).toBeGreaterThan(0);
  const piecesBefore = await fullPiecesOf(page);
  const at = await joinPoint(page, null);
  expect(at).not.toBeNull();
  const c = at!;
  await page.mouse.move(c.x, c.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, c, { editor: true })).toBe("Line.stack-join");

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
  await done(page);
  expect((await joinsOf(page)).every((j) => j.bow === 0 && (j.depth ?? 0) === 0)).toBe(true);
});

test("pressing a bowl's apex frees the curve and the same drag bends it; double-click restores; the free and drag undo as one step", async ({ page }) => {
  await gotoApp(page);
  await chooseFont(page, "Amiri");
  await setBlockText(page, "نحن");
  await settleFrames(page);
  await convert(page);
  await openEditor(page);
  const before = await fullPiecesOf(page);
  const joinCount = async () => (await joinsOf(page)).length;
  const joinsBefore = await joinCount();
  expect(await namedNodeCount(page, "stack-curve", { editor: true })).toBe(0);

  // Hover each letter and take the largest curve apex offered, at a point
  // that really routes to it: a letter's short entry hook is a curve too,
  // and bending one that short moves no ink.
  let best: { at: Point; area: number; letter: number } | null = null;
  const letterIdx = before.map((p, i) => (p.role === "letter" && !p.parentId ? i : -1)).filter((i) => i >= 0);
  for (const i of letterIdx) {
    const c = await pieceCentre(page, i);
    await page.mouse.move(c.x, c.y);
    await settleFrames(page);
    if ((await namedNodeCount(page, "stack-curve", { editor: true })) === 0) continue;
    const found = await page.evaluate(() => {
      const stage = window.__HARF__!.getEditorStage()!;
      const box = stage.container().getBoundingClientRect();
      const out: { x: number; y: number; area: number }[] = [];
      for (const node of stage.find(".stack-curve")) {
        const r = node.getClientRect();
        for (let gy = 0; gy <= 10 && out.length === out.length; gy++) {
          let hit: { x: number; y: number } | null = null;
          for (let gx = 0; gx <= 10 && !hit; gx++) {
            const px = Math.round(box.left + r.x + (r.width * gx) / 10), py = Math.round(box.top + r.y + (r.height * gy) / 10);
            if (stage.getIntersection({ x: px - box.left, y: py - box.top }) === node) hit = { x: px, y: py };
          }
          if (hit) { out.push({ ...hit, area: r.width * r.height }); break; }
        }
      }
      return out;
    });
    for (const f of found) if (!best || f.area > best.area) best = { at: { x: f.x, y: f.y }, area: f.area, letter: i };
  }
  expect(best, "a curve apex was offered").not.toBeNull();
  const hover = await pieceCentre(page, best!.letter);
  await page.mouse.move(hover.x, hover.y);
  await settleFrames(page);
  const at: Point = best!.at;
  await page.mouse.move(at.x, at.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, at, { editor: true })).toBe("Line.stack-curve");
  await page.mouse.down();
  await expect.poll(joinCount).toBe(joinsBefore + 1);
  await settleFrames(page);
  const bandRest = (await joinBandNear(page, at))!;
  expect(bandRest).not.toBeNull();
  await page.mouse.move(at.x + 2, at.y + 3);
  await page.mouse.move(at.x, at.y + 40, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);
  // The drag bent the new join away from its rest…
  const bent = await page.evaluate((n) => {
    const j = (window.__HARF__!.getEditorDraft() as unknown as { joins: { bow: number; depth?: number; rest?: { bow: number; depth: number } }[] }).joins[n];
    return { bow: j.bow, depth: j.depth ?? 0, rest: j.rest ?? { bow: 0, depth: 0 } };
  }, joinsBefore);
  expect(Math.abs(bent.bow - bent.rest.bow) + Math.abs(bent.depth - bent.rest.depth), JSON.stringify(bent)).toBeGreaterThan(0.05);
  // …and the ink moved with it: the freed join's band is somewhere else now.
  const bandBent = (await joinBandNear(page, at))!;
  expect(rectDelta(bandBent, bandRest), JSON.stringify({ bandRest, bandBent })).toBeGreaterThan(2);

  // Double-click the freed curve: back to its rest, which reproduces the letter.
  // Join nodes mount only for joins with a visible chord, so find the freed
  // curve's by position: the one nearest the press.
  const joinAt = await page.evaluate((press) => {
    const stage = window.__HARF__!.getEditorStage()!;
    const box = stage.container().getBoundingClientRect();
    const centres = stage.find(".stack-join").map((node) => {
      const r = node.getClientRect();
      return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
    });
    centres.sort((a, b) => Math.hypot(a.x - press.x, a.y - press.y) - Math.hypot(b.x - press.x, b.y - press.y));
    return centres[0];
  }, at);
  await page.mouse.move(joinAt.x, joinAt.y);
  await settleFrames(page);
  await page.mouse.dblclick(joinAt.x, joinAt.y);
  await settleFrames(page);
  const bandBack = (await joinBandNear(page, at))!;
  expect(rectDelta(bandBack, bandRest), JSON.stringify({ bandRest, bandBack })).toBeLessThan(3);

  // The double-click was its own step; the free and the drag were one. So
  // the first undo brings the bend back, and the second restores the letter.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length + 1);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length);
  // Nothing left to commit: Done closes and the block is as converted.
  await done(page);
  expect((await fullPiecesOf(page)).length).toBe(before.length);
});

test("Shift-dragging a freed bowl grows its radius: the tail slides out, the bend is kept, undo restores", async ({ page }) => {
  await gotoApp(page);
  await chooseFont(page, "Amiri");
  await setBlockText(page, "نحن");
  await settleFrames(page);
  await convert(page);
  await openEditor(page);
  const before = await fullPiecesOf(page);
  const joinCount = async () => (await joinsOf(page)).length;
  const joinsBefore = await joinCount();

  // Free a bowl with a bare press, as in the test above.
  let at: Point | null = null;
  const letterIdx = before.map((p, i) => (p.role === "letter" && !p.parentId ? i : -1)).filter((i) => i >= 0);
  for (const i of letterIdx) {
    const c = await pieceCentre(page, i);
    await page.mouse.move(c.x, c.y);
    await settleFrames(page);
    if ((await namedNodeCount(page, "stack-curve", { editor: true })) === 0) continue;
    at = await page.evaluate(() => {
      const stage = window.__HARF__!.getEditorStage()!;
      const r = stage.find(".stack-curve")[0].getClientRect();
      const box = stage.container().getBoundingClientRect();
      return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
    });
    break;
  }
  expect(at, "a curve apex was offered").not.toBeNull();
  await page.mouse.move(at!.x, at!.y);
  await settleFrames(page);
  await page.mouse.down();
  await expect.poll(joinCount).toBe(joinsBefore + 1);
  await page.mouse.up();
  await settleFrames(page);

  // The freed join, in page px: its curve's midpoint and its fixed end (the
  // body's face; the far fragment rides on the body), plus its chord in font units.
  const geom = () => page.evaluate((n) => {
    type Face = { a: [number, number]; b: [number, number] };
    type P = { id: string; x: number; y: number; rotation: number; pivot: [number, number]; parentId?: string; faces: Face[] };
    type J = { id: string; bow: number; depth?: number; from: { pieceId: string; faceIndex: number }; to: { pieceId: string; faceIndex: number } };
    const blk = window.__HARF__!.getEditorDraft() as unknown as { pieces: P[]; joins: J[]; fontSize: number };
    const upm = (window.__HARF__!.getBlocks()[0] as unknown as { unitsPerEm: number }).unitsPerEm;
    const j = blk.joins[n];
    const world = (pid: string, fi: number): [number, number] => {
      const p = blk.pieces.find((q) => q.id === pid)!;
      const f = p.faces[fi];
      const lx = (f.a[0] + f.b[0]) / 2 - p.pivot[0], ly = (f.a[1] + f.b[1]) / 2 - p.pivot[1];
      const c = Math.cos(p.rotation), s = Math.sin(p.rotation);
      return [c * lx - s * ly + p.pivot[0] + p.x, s * lx + c * ly + p.pivot[1] + p.y];
    };
    const from = blk.pieces.find((p) => p.id === j.from.pieceId)!;
    const fixedIsFrom = from.parentId !== j.to.pieceId;
    const A = world(j.from.pieceId, j.from.faceIndex), B = world(j.to.pieceId, j.to.faceIndex);
    const F = fixedIsFrom ? A : B;
    const stage = window.__HARF__!.getEditorStage()!;
    const box = stage.container().getBoundingClientRect();
    const scale = blk.fontSize / (upm || 1000);
    const nodes = stage.find(".stack-join") as unknown as { points(): number[]; getAbsoluteTransform(): { point(p: { x: number; y: number }): { x: number; y: number } } }[];
    // The freed join's node is the one whose curve starts or ends at its faces.
    const node = nodes.find((nd) => {
      const pts = nd.points();
      const ends = [[pts[0], pts[1]], [pts[pts.length - 2], pts[pts.length - 1]]];
      return ends.some(([x, y]) => Math.hypot(x - A[0] * scale, y - A[1] * scale) < 0.5)
        && ends.some(([x, y]) => Math.hypot(x - B[0] * scale, y - B[1] * scale) < 0.5);
    })!;
    const tr = node.getAbsoluteTransform();
    const pts = node.points();
    const mid = tr.point({ x: pts[24], y: pts[25] });
    const fixed = tr.point({ x: F[0] * scale, y: F[1] * scale });
    return {
      mid: { x: box.left + mid.x, y: box.top + mid.y }, fixed: { x: box.left + fixed.x, y: box.top + fixed.y },
      chord: Math.hypot(B[0] - A[0], B[1] - A[1]), F, bow: j.bow, depth: j.depth ?? 0,
    };
  }, joinsBefore);

  const g0 = await geom();
  const len = Math.hypot(g0.mid.x - g0.fixed.x, g0.mid.y - g0.fixed.y);
  const ux = (g0.mid.x - g0.fixed.x) / len, uy = (g0.mid.y - g0.fixed.y) / len;
  await page.mouse.move(g0.mid.x, g0.mid.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, g0.mid, { editor: true })).toBe("Line.stack-join");

  // Drag outward by half the fixed-end-to-midpoint distance: radius × 1.5.
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(g0.mid.x + ux * 2, g0.mid.y + uy * 2);
  await page.mouse.move(g0.mid.x + ux * len * 0.5, g0.mid.y + uy * len * 0.5, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settleFrames(page);

  const g1 = await geom();
  expect(g1.chord / g0.chord, JSON.stringify({ g0, g1 })).toBeGreaterThan(1.4);
  expect(g1.chord / g0.chord).toBeLessThan(1.6);
  // Same shape: the bend is untouched and the fixed end stayed put.
  expect(g1.bow).toBeCloseTo(g0.bow, 9);
  expect(g1.depth).toBeCloseTo(g0.depth, 9);
  expect(Math.hypot(g1.F[0] - g0.F[0], g1.F[1] - g0.F[1])).toBeLessThan(1e-6);

  // One undo step.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await geom()).chord).toBeCloseTo(g0.chord, 6);
});

/** A whole-px page point on the named node (the first that hits), nearest its centre. */
async function pointOn(page: Page, name: string, index = 0): Promise<Point | null> {
  return page.evaluate(([n, i]) => {
    const stage = window.__HARF__!.getEditorStage()!;
    const box = stage.container().getBoundingClientRect();
    const node = stage.find(`.${n}`)[i as number];
    if (!node) return null;
    const r = node.getClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    let best: { x: number; y: number; d: number } | null = null;
    for (let gy = 0; gy <= 12; gy++) for (let gx = 0; gx <= 12; gx++) {
      const px = Math.round(box.left + r.x + (r.width * gx) / 12), py = Math.round(box.top + r.y + (r.height * gy) / 12);
      if (stage.getIntersection({ x: px - box.left, y: py - box.top }) !== node) continue;
      const d = Math.hypot(px - box.left - cx, py - box.top - cy);
      if (!best || d < best.d) best = { x: px, y: py, d };
    }
    return best && { x: best.x, y: best.y };
  }, [name, index] as const);
}

const cmdsOf = (page: Page, id: string) =>
  page.evaluate((pid) => JSON.stringify((window.__HARF__!.getEditorDraft() as unknown as { pieces: { id: string; cmds: unknown }[] })
    .pieces.find((p) => p.id === pid)?.cmds ?? null), id);

test("a pulled tail's cut edge slides along the stroke; Delete or right-click removes the stretch", async ({ page }) => {
  await gotoApp(page);
  await chooseFont(page, "UKIJ Diwani");
  await setBlockText(page, WORD);
  await settleFrames(page);
  await convert(page);
  await openEditor(page);
  const before = await fullPiecesOf(page);
  const letterIdx = before.map((p, i) => (p.role === "letter" && !p.parentId ? i : -1)).filter((i) => i >= 0);

  // Pull a tail out.
  const at = await findCutSpan(page, letterIdx);
  await page.mouse.move(at.x, at.y);
  await settleFrames(page);
  await page.mouse.down();
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length + 1);
  await page.mouse.move(at.x + 1, at.y - 2);
  await page.mouse.move(at.x + 30, at.y - 40, { steps: 8 });
  await page.mouse.up();
  await settleFrames(page);
  const pulled = await fullPiecesOf(page);
  const cap = pulled.find((c) => !before.some((p) => p.id === c.id))!;
  expect(await namedNodeCount(page, "stack-cutedge", { editor: true })).toBe(1);

  // Slide the cut edge toward the body: the tail takes outline from the body.
  const edge = await pointOn(page, "stack-cutedge");
  expect(edge).not.toBeNull();
  await page.mouse.move(edge!.x, edge!.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, edge!, { editor: true })).toBe("Line.stack-cutedge");
  const axis = await page.evaluate(() => {
    const stage = window.__HARF__!.getEditorStage()!;
    const n = stage.find(".stack-cutedge")[0] as unknown as { points(): number[]; getAbsoluteTransform(): { point(p: { x: number; y: number }): { x: number; y: number } } };
    const [ax, ay, bx, by] = n.points();
    const t = n.getAbsoluteTransform();
    const a = t.point({ x: ax, y: ay }), b = t.point({ x: bx, y: by });
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  });
  const bodyCentre = await pieceCentre(page, pulled.findIndex((p) => p.id === cap.parentId));
  const box = await page.evaluate(() => window.__HARF__!.getEditorStage()!.container().getBoundingClientRect().toJSON() as { left: number; top: number });
  const toBody = (bodyCentre.x - box.left - axis.mx) * axis.x + (bodyCentre.y - box.top - axis.my) * axis.y > 0 ? 1 : -1;
  const capCmds = await cmdsOf(page, cap.id);
  const bodyCmds = await cmdsOf(page, cap.parentId!);
  await page.mouse.down();
  await page.mouse.move(edge!.x + toBody * axis.x * 2, edge!.y + toBody * axis.y * 2);
  await page.mouse.move(edge!.x + toBody * axis.x * 12, edge!.y + toBody * axis.y * 12, { steps: 6 });
  await page.mouse.up();
  await settleFrames(page);
  expect(await cmdsOf(page, cap.id)).not.toBe(capCmds);
  expect(await cmdsOf(page, cap.parentId!)).not.toBe(bodyCmds);
  expect((await fullPiecesOf(page)).length).toBe(pulled.length);
  // The slide is one undo step.
  await page.keyboard.press("Control+z");
  await expect.poll(() => cmdsOf(page, cap.id)).toBe(capCmds);

  // Delete over the tail: the stretch goes, the composition stays.
  await page.mouse.move(5, 5);
  const capIdx = (await fullPiecesOf(page)).findIndex((p) => p.id === cap.id);
  const onCap = await pointOn(page, "stack-piece", capIdx);
  expect(onCap).not.toBeNull();
  await page.mouse.move(onCap!.x, onCap!.y);
  await settleFrames(page);
  expect(await hitTargetAt(page, onCap!, { editor: true })).toBe("Line.stack-piece");
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length);
  // Delete removed the stretch only: the window is still open, the block still there.
  await expect(page.getByTestId("stack-editor")).toBeVisible();
  expect((await getBlocks(page)).length).toBe(1);
  expect((await getBlocks(page))[0].type).toBe("stack");

  // Undo brings the tail back; a right-click removes it again.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(pulled.length);
  await page.mouse.move(5, 5);
  await settleFrames(page);
  await page.mouse.move(onCap!.x, onCap!.y);
  await settleFrames(page);
  await page.mouse.click(onCap!.x, onCap!.y, { button: "right" });
  await expect.poll(async () => (await fullPiecesOf(page)).length).toBe(before.length);

  // Done commits the whole letter to the block.
  await done(page);
  expect((await fullPiecesOf(page)).length).toBe(before.length);
});
