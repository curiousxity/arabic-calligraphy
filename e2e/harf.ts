import { expect, type Page } from "@playwright/test";
import type Konva from "konva";
// Type-only, so it is erased before Playwright ever loads this file — but it
// puts `src/lib/testBridge.ts` into the program, which is what makes the
// `window.__HARF__` global augmentation visible to every `page.evaluate`
// body below. The bridge contract therefore lives in exactly one place.
import type { HarfTestBridge } from "../src/lib/testBridge";

export type Bridge = HarfTestBridge;
export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

/** Konva mounts its scene canvas inside this wrapper; the stage has one layer. */
const STAGE_CANVAS = ".konvajs-content canvas";

/** Fill colours `DiacriticHoverHandles` gives its three handles. */
export const DIACRITIC_MOVE_HANDLE_FILL = "#38bdf8";

/**
 * A pixel counts as ink when its channels sum below this. The artboard is
 * white (#ffffff, sum 765) and the alignment grid is a pale grey; the
 * default block colour is #1e3a5f (sum 183). Anything in between is
 * antialiasing. Deliberately coarse — this asks "is there ink here", never
 * "does it look exactly like this", so cross-machine font rasterisation
 * differences cannot flake it.
 */
const INK_CHANNEL_SUM = 330;

/** Attaches error collectors and returns the (growing) list of what they saw. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Loads the app and waits until the bridge is live and the default block has actually rendered. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(STAGE_CANVAS).first().waitFor();
  await page.waitForFunction(() => !!window.__HARF__?.getStage());
  // Shaping is async (HarfBuzz WASM + a font fetch), so a mounted stage is
  // not yet a drawn one.
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
}

export function getBlocks(page: Page) {
  return page.evaluate(() => window.__HARF__!.getBlocks());
}

export function getSelectedIds(page: Page) {
  return page.evaluate(() => window.__HARF__!.getSelectedIds());
}

/** Stage scale, needed to convert a screen-space drag delta into block units. */
export function getStageScale(page: Page) {
  return page.evaluate(() => window.__HARF__!.getStage()!.scaleX());
}

/**
 * A Konva node's on-screen rectangle in page coordinates.
 *
 * `getClientRect()` already folds in the stage's own pan/zoom, so it is in
 * container pixels; adding the container's own offset lands it in the same
 * space `page.mouse` speaks.
 */
export async function nodeClientBox(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((sel) => {
    const stage = window.__HARF__!.getStage();
    const node = stage?.findOne(sel);
    if (!stage || !node) return null;
    const r = node.getClientRect();
    const c = stage.container().getBoundingClientRect();
    return { x: c.left + r.x, y: c.top + r.y, width: r.width, height: r.height };
  }, selector);
}

export async function blockClientBox(page: Page, blockId: number): Promise<Box> {
  const box = await nodeClientBox(page, `#block-${blockId}`);
  if (!box) throw new Error(`block ${blockId} is not on the stage`);
  return box;
}

export const centerOf = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/**
 * Counts dark pixels on the stage canvas, optionally within a page-space
 * box. Reading the live canvas rather than a Playwright screenshot keeps
 * the coordinates identical to the ones the mouse helpers use, and avoids
 * needing a PNG decoder on the Node side.
 */
export async function inkPixels(page: Page, box?: Box): Promise<number> {
  return page.evaluate(
    ({ sel, b, inkSum }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(sel);
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return 0;
      const ratio = canvas.width / rect.width;

      const px = b ? Math.max(0, Math.round((b.x - rect.left) * ratio)) : 0;
      const py = b ? Math.max(0, Math.round((b.y - rect.top) * ratio)) : 0;
      const pw = Math.min(canvas.width - px, b ? Math.round(b.width * ratio) : canvas.width);
      const ph = Math.min(canvas.height - py, b ? Math.round(b.height * ratio) : canvas.height);
      if (pw <= 0 || ph <= 0) return 0;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return 0;
      const { data } = ctx.getImageData(px, py, pw, ph);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 16) continue;
        if (data[i] + data[i + 1] + data[i + 2] < inkSum) count++;
      }
      return count;
    },
    { sel: STAGE_CANVAS, b: box ?? null, inkSum: INK_CHANNEL_SUM }
  );
}

/** Types into the Content panel's textarea and waits for the block to catch up. */
export async function setBlockText(page: Page, text: string): Promise<void> {
  await page.locator("textarea.sidebarTextarea").fill(text);
  await expect.poll(async () => (await getBlocks(page))[0]?.text).toBe(text);
}

/** Centre points of every currently-mounted draggable handle dot, in page space. */
export async function draggableDotCenters(page: Page): Promise<Point[]> {
  return page.evaluate(() => {
    const stage = window.__HARF__!.getStage();
    if (!stage) return [];
    const c = stage.container().getBoundingClientRect();
    return stage
      .find<Konva.Circle>("Circle")
      .filter((n) => n.draggable() && n.isVisible())
      .map((n) => {
        const r = n.getClientRect();
        return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 };
      });
  });
}

/** Centre points of the mounted handle dots painted `fill`, in page space. */
export async function dotCentersWithFill(page: Page, fill: string): Promise<Point[]> {
  return page.evaluate((wanted) => {
    const stage = window.__HARF__!.getStage();
    if (!stage) return [];
    const c = stage.container().getBoundingClientRect();
    return stage
      .find<Konva.Circle>("Circle")
      .filter((n) => n.isVisible() && n.fill() === wanted)
      .map((n) => {
        const r = n.getClientRect();
        return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 };
      });
  }, fill);
}

/** Page-space centres of the hover hit rects `DiacriticHoverHandles` mounts, one per mark. */
export async function diacriticHitCenters(page: Page): Promise<Point[]> {
  return page.evaluate(() => {
    const stage = window.__HARF__!.getStage();
    if (!stage) return [];
    const c = stage.container().getBoundingClientRect();
    return stage.find(".diacritic-hit").map((n) => {
      const r = n.getClientRect();
      return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 };
    });
  });
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Waits two animation frames.
 *
 * A Konva pointer event feeds a React state update, which react-konva turns
 * into a batched draw on the next frame — and the *hit* canvas is redrawn
 * with it. Reading the scene graph before that lands sees handles that
 * `stage.getIntersection` (and therefore a real click) cannot yet reach.
 */
export function settleFrames(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

/** The Konva node `stage.getIntersection` reports at a page-space point, as `ClassName.name`. */
export async function hitTargetAt(page: Page, point: Point): Promise<string | null> {
  return page.evaluate((pt) => {
    const stage = window.__HARF__!.getStage();
    if (!stage) return null;
    const c = stage.container().getBoundingClientRect();
    const node = stage.getIntersection({ x: pt.x - c.left, y: pt.y - c.top });
    return node ? `${node.getClassName()}.${node.name()}` : null;
  }, point);
}

/**
 * Parks the pointer on a diacritic's blue move handle with that handle
 * actually mounted and hit-testable, and leaves it there — the caller must
 * press *without* moving first (see `dragFromHere`).
 *
 * The dance below exists because of a real defect in
 * `DiacriticHoverHandles`, reproduced by `_flicker` evidence in this
 * stream's report: the hover hit `Rect` and the handle `Circle` are
 * siblings, so the moment the mounted handle covers the pointer, the next
 * mousemove retargets to the `Circle` and fires `mouseleave` on the `Rect`,
 * which unmounts the handle again. The handle is therefore present on
 * exactly every other mousemove. Re-issuing the same move flips it back on,
 * so this loop steps until the pointer is on a mounted handle, then stops
 * moving. **Delete this helper's loop, not the tests, once the overlay
 * keeps its handle mounted while hovered.**
 */
export async function armDiacriticMoveHandle(page: Page): Promise<Point> {
  const marks = await diacriticHitCenters(page);
  if (marks.length === 0) throw new Error("no diacritic hit boxes are mounted");

  for (const mark of marks) {
    let target = mark;
    // The remaining loop is *only* for overlapping hit rects: hovering one
    // mark's centre can mount a neighbouring mark's handle, so chase the
    // nearest one. It converges in a step or two. The flicker compensation
    // that used to live here — re-issuing the same move until the handle
    // happened to be mounted — is gone with the defect it worked around.
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.mouse.move(target.x, target.y);
      await settleFrames(page);

      const handles = await dotCentersWithFill(page, DIACRITIC_MOVE_HANDLE_FILL);
      if (handles.length === 0) break;

      const nearest = handles.reduce((best, h) =>
        distance(h, target) < distance(best, target) ? h : best
      );
      if (distance(nearest, target) > 3) {
        target = nearest;
        continue;
      }
      if ((await hitTargetAt(page, target))?.startsWith("Circle")) return target;
      break;
    }
  }
  throw new Error("could not park the pointer on a mounted diacritic move handle");
}

/**
 * Drags from wherever the pointer already is, in interpolated steps.
 *
 * The steps are the point. A hover-mounted handle used to die on any drag
 * whose first step was small: Konva runs its enter/leave processing while a
 * drag is merely `ready` rather than `dragging`, so the first small move
 * retargeted hover from the hit rect to the handle, fired `mouseleave` on
 * the rect, and the overlay unmounted the very node the drag was attached
 * to. Measured at the app's default 2.75x zoom, 2px and 10px first steps
 * lost the gesture while 20px and 40px completed — so this helper used to
 * be pinned to a single jump.
 *
 * `DiacriticHoverHandles` now hangs its hover handlers on the Group that
 * owns both the hit rect and the handles, which makes that retarget an
 * internal move Konva fires no leave for. Dragging in many small steps is
 * therefore the honest gesture *and* the regression test: if the overlay
 * ever goes back to sibling handlers, these drags stop moving anything.
 */
export async function dragFromHere(page: Page, to: Point): Promise<void> {
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
}

/**
 * Finds a point inside a block's hit rect that is safe to press for a plain
 * block drag.
 *
 * A selected text block layers hover-mounted overlays over itself — stroke
 * stretch dots, diacritic handles — and each of those is its own draggable
 * Konva node that swallows the gesture. Hovering is what mounts them, so
 * which dots exist depends on where the cursor already is; the only honest
 * way to pick a clear spot is to hover a candidate and look.
 */
export async function findBlockGrabPoint(page: Page, blockId: number): Promise<Point> {
  const box = await blockClientBox(page, blockId);
  const clearance = 16;
  const candidates: Point[] = [
    { x: box.x + box.width * 0.5, y: box.y + box.height * 0.06 },
    { x: box.x + box.width * 0.5, y: box.y + box.height * 0.94 },
    { x: box.x + box.width * 0.06, y: box.y + box.height * 0.5 },
    { x: box.x + box.width * 0.94, y: box.y + box.height * 0.5 },
    centerOf(box),
  ];

  for (const candidate of candidates) {
    await page.mouse.move(candidate.x, candidate.y);
    const dots = await draggableDotCenters(page);
    if (dots.every((d) => distance(d, candidate) > clearance)) return candidate;
  }
  throw new Error(
    `every candidate grab point on block ${blockId} is covered by a draggable handle`
  );
}

/** A press-move-release gesture with intermediate moves, so Konva sees a real drag. */
export async function dragMouse(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}
