import type Konva from "konva";
import type { Block } from "../types";

export type Rect = { x: number; y: number; width: number; height: number };

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 3;

/** Padding (content-space px) added around live content by `padBox`. */
export const CONTENT_PADDING = 80;

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
