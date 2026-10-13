import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { findBlockGrabPoint, getBlocks, getStageScale, gotoApp, type Point } from "./harf";

// A phone-shaped context: touch input, and the viewport meta honoured the way
// a mobile browser honours it, so a pinch the app fails to claim really does
// zoom the page (the bug this guards against).
test.use({ hasTouch: true, isMobile: true, viewport: { width: 900, height: 700 } });

/**
 * Real multi-touch through CDP. Each call lists every finger still down; CDP
 * presses, moves or releases whichever changed since the last call, one by
 * one, the way a touchscreen reports them. `ids` keeps a finger's identity
 * stable across calls.
 */
async function touches(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", fingers: [number, Point][]) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: fingers.map(([id, p]) => ({ id, x: p.x, y: p.y })),
  });
}

/** Moves two fingers from `from` to `to` in small steps, as a hand would. */
async function twoFingerGesture(cdp: CDPSession, from: [Point, Point], to: [Point, Point]) {
  await touches(cdp, "touchStart", [[0, from[0]]]);
  await touches(cdp, "touchStart", [[0, from[0]], [1, from[1]]]);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const at = (k: 0 | 1): Point => ({
      x: from[k].x + (to[k].x - from[k].x) * t,
      y: from[k].y + (to[k].y - from[k].y) * t,
    });
    await touches(cdp, "touchMove", [[0, at(0)], [1, at(1)]]);
  }
  await touches(cdp, "touchEnd", [[0, to[0]]]);
  await touches(cdp, "touchEnd", []);
}

function stagePosition(page: Page) {
  return page.evaluate(() => {
    const s = window.__HARF__!.getStage()!;
    return { x: s.x(), y: s.y() };
  });
}

function pageZoom(page: Page) {
  return page.evaluate(() => window.visualViewport?.scale ?? 1);
}

test("spreading two fingers over a block zooms the canvas, not the page, and leaves the block alone", async ({
  page,
}) => {
  await gotoApp(page);
  const cdp = await page.context().newCDPSession(page);
  const before = (await getBlocks(page))[0];
  const scale = await getStageScale(page);
  const c = await findBlockGrabPoint(page, 1);

  await twoFingerGesture(
    cdp,
    [{ x: c.x - 30, y: c.y }, { x: c.x + 30, y: c.y }],
    [{ x: c.x - 90, y: c.y }, { x: c.x + 90, y: c.y }]
  );

  // Spacing tripled, so the canvas zoomed in by about that much.
  await expect.poll(() => getStageScale(page)).toBeGreaterThan(scale * 2.5);
  expect(await pageZoom(page)).toBe(1);
  const after = (await getBlocks(page))[0];
  expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
});

test("pinching in zooms the canvas out", async ({ page }) => {
  await gotoApp(page);
  const cdp = await page.context().newCDPSession(page);
  const scale = await getStageScale(page);
  const c = await findBlockGrabPoint(page, 1);

  await twoFingerGesture(
    cdp,
    [{ x: c.x - 120, y: c.y }, { x: c.x + 120, y: c.y }],
    [{ x: c.x - 40, y: c.y }, { x: c.x + 40, y: c.y }]
  );

  await expect.poll(() => getStageScale(page)).toBeLessThan(scale / 2.5);
  expect(await pageZoom(page)).toBe(1);
});

test("dragging two fingers together pans the canvas without zooming or moving a block", async ({ page }) => {
  await gotoApp(page);
  const cdp = await page.context().newCDPSession(page);
  const before = (await getBlocks(page))[0];
  const scale = await getStageScale(page);
  const pos = await stagePosition(page);
  const c = await findBlockGrabPoint(page, 1);
  const d = { x: 110, y: -70 };

  await twoFingerGesture(
    cdp,
    [{ x: c.x - 40, y: c.y }, { x: c.x + 40, y: c.y }],
    [{ x: c.x - 40 + d.x, y: c.y + d.y }, { x: c.x + 40 + d.x, y: c.y + d.y }]
  );

  // The first finger's touchstart alone does nothing to the stage, so the
  // whole travel is the pan.
  const now = await stagePosition(page);
  expect(now.x - pos.x).toBeCloseTo(d.x, 0);
  expect(now.y - pos.y).toBeCloseTo(d.y, 0);
  expect(await getStageScale(page)).toBeCloseTo(scale, 6);
  const after = (await getBlocks(page))[0];
  expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
});

test("one finger drags a block", async ({ page }) => {
  await gotoApp(page);
  const cdp = await page.context().newCDPSession(page);
  const before = (await getBlocks(page))[0];
  const scale = await getStageScale(page);
  const from = await findBlockGrabPoint(page, 1);
  const d = { x: 120, y: 80 };

  await touches(cdp, "touchStart", [[0, from]]);
  for (let i = 1; i <= 24; i++) {
    await touches(cdp, "touchMove", [[0, { x: from.x + (d.x * i) / 24, y: from.y + (d.y * i) / 24 }]]);
  }
  await touches(cdp, "touchEnd", []);

  const after = (await getBlocks(page))[0];
  // Loose for the same reason as core.spec's mouse drag: the drop snaps.
  const tolerance = 20 / scale;
  expect(Math.abs(after.x - (before.x + d.x / scale))).toBeLessThan(tolerance);
  expect(Math.abs(after.y - (before.y + d.y / scale))).toBeLessThan(tolerance);
  expect(await getStageScale(page)).toBeCloseTo(scale, 6);
});

test("a second finger landing mid-drag stops the block and takes over as a pinch", async ({ page }) => {
  await gotoApp(page);
  const cdp = await page.context().newCDPSession(page);
  const before = (await getBlocks(page))[0];
  const scale = await getStageScale(page);
  const from = await findBlockGrabPoint(page, 1);

  // Drag the block a little with one finger...
  await touches(cdp, "touchStart", [[0, from]]);
  const held = { x: from.x + 60, y: from.y };
  for (let i = 1; i <= 12; i++) {
    await touches(cdp, "touchMove", [[0, { x: from.x + (60 * i) / 12, y: from.y }]]);
  }
  // ...then a second finger arrives, and the pair spreads.
  const second = { x: held.x + 50, y: held.y + 50 };
  await touches(cdp, "touchStart", [[0, held], [1, second]]);
  // The second finger ended the drag, which commits where the block got to.
  await expect.poll(async () => (await getBlocks(page))[0].x).toBeGreaterThan(before.x + 30 / scale);
  const atSecondFinger = (await getBlocks(page))[0];
  for (let i = 1; i <= 12; i++) {
    await touches(cdp, "touchMove", [
      [0, { x: held.x - 4 * i, y: held.y - 4 * i }],
      [1, { x: second.x + 4 * i, y: second.y + 4 * i }],
    ]);
  }
  await touches(cdp, "touchEnd", [[0, { x: held.x - 48, y: held.y - 48 }]]);
  // The finger left behind must not resume dragging the block.
  await touches(cdp, "touchMove", [[0, { x: held.x + 100, y: held.y + 100 }]]);
  await touches(cdp, "touchEnd", []);

  const after = (await getBlocks(page))[0];
  expect({ x: after.x, y: after.y }).toEqual({ x: atSecondFinger.x, y: atSecondFinger.y });
  expect(await getStageScale(page)).toBeGreaterThan(scale * 1.5);
});
