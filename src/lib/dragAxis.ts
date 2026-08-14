export type AxisPoint = { x: number; y: number };

/**
 * Projects `pos` onto the line through `a` and `b` (unclamped — the caller
 * decides any bounds separately). Used as a Konva `dragBoundFunc` to
 * constrain an on-canvas handle's drag to a straight rail instead of free 2D
 * movement. All three points must be in the same coordinate space —
 * `dragBoundFunc` specifically receives/returns *absolute* (stage)
 * coordinates, so callers project the rail's endpoints into that same
 * absolute space before calling this (see `DiacriticHoverHandles.tsx` and
 * `GlyphTransformHoverHandles.tsx`).
 */
export function projectOntoAxis(
  a: AxisPoint,
  b: AxisPoint,
  pos: AxisPoint
): AxisPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const axisLen = Math.max(Math.hypot(dx, dy), 1e-6);
  const dirX = dx / axisLen;
  const dirY = dy / axisLen;
  const relX = pos.x - a.x;
  const relY = pos.y - a.y;
  const along = relX * dirX + relY * dirY;
  return { x: a.x + dirX * along, y: a.y + dirY * along };
}
