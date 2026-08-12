import type Konva from "konva";
import type { Block } from "../types";

export type Rect = { x: number; y: number; width: number; height: number };

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 3;

/** Padding (content-space px) added around live content by `padBox`. */
export const CONTENT_PADDING = 80;

/**
 * Zoom per pixel of wheel travel, as an exponent. Tuned so one detent of a
 * typical mouse wheel (100px of deltaY) is about a 10% step — the same feel
 * the zoom buttons give — which then makes a trackpad pinch's much smaller
 * per-event deltas produce correspondingly smaller steps. Raise to zoom
 * faster, lower to zoom slower.
 */
const ZOOM_PER_PIXEL = 0.00095;

/**
 * Largest zoom change a single wheel event may cause. Some browser/OS
 * combinations emit one enormous delta for a fast flick, which would
 * otherwise jump several zoom levels in one frame.
 */
const MAX_STEP = 1.25;

/**
 * Converts one wheel event into a zoom multiplier.
 *
 * The multiplier is exponential in the wheel's *actual* travel rather than
 * a fixed step per event, because a trackpad pinch fires many small-delta
 * events per second while a mouse wheel fires a few large ones. A fixed
 * step per event (what this used to do) makes the two feel wildly
 * different — a pinch would rocket through the whole zoom range.
 *
 * `deltaMode` is normalized because browsers may report wheel travel in
 * lines (1) or pages (2) rather than pixels (0); Firefox commonly reports
 * lines, where a raw delta of 3 means roughly 48 pixels.
 */
export function zoomFactorFromWheel(deltaY: number, deltaMode = 0): number {
  const LINE_HEIGHT = 16;
  const PAGE_HEIGHT = 800;
  const pixels =
    deltaMode === 1 ? deltaY * LINE_HEIGHT : deltaMode === 2 ? deltaY * PAGE_HEIGHT : deltaY;

  if (!Number.isFinite(pixels)) return 1;

  // Negative deltaY (scrolling/pinching "up" or out) zooms in.
  const factor = Math.exp(-pixels * ZOOM_PER_PIXEL);
  return Math.min(MAX_STEP, Math.max(1 / MAX_STEP, factor));
}

/** Fallback bounds when there's no content yet (empty canvas), centered on the world origin. */
export const DEFAULT_EMPTY_BOUNDS: Rect = { x: -400, y: -300, width: 800, height: 600 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Union bounding box of every block's rendered Konva node, in stage-space
 * (unaffected by the stage's current pan/zoom). Returns null if there are no
 * blocks or none of their nodes have painted yet.
 */
export function getBlocksBoundingBox(stage: Konva.Stage, blocks: Block[]): Rect | null {
  if (blocks.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  blocks.forEach((block) => {
    const node = stage.findOne(`#block-${block.id}`) as Konva.Node | null;
    if (!node) return;
    const rect = node.getClientRect({ relativeTo: stage });
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  });

  if (!isFinite(minX)) return null;

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Expands a box by `CONTENT_PADDING` on every side. */
export function padBox(box: Rect, padding = CONTENT_PADDING): Rect {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + 2 * padding,
    height: box.height + 2 * padding,
  };
}

/** Smallest box containing both `a` and `b`. */
export function unionRect(a: Rect, b: Rect): Rect {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Scale+position to fit `box` within a `viewportW`x`viewportH` viewport, centered, with a margin. */
export function computeFitToBox(
  viewportW: number,
  viewportH: number,
  box: Rect,
  marginPx: number
) {
  const availW = Math.max(1, viewportW - marginPx * 2);
  const availH = Math.max(1, viewportH - marginPx * 2);
  const scaleX = availW / Math.max(box.width, 1);
  const scaleY = availH / Math.max(box.height, 1);
  const scale = clamp(Math.min(scaleX, scaleY), MIN_SCALE, MAX_SCALE);

  return {
    scale,
    position: {
      x: viewportW / 2 - (box.x + box.width / 2) * scale,
      y: viewportH / 2 - (box.y + box.height / 2) * scale,
    },
  };
}
