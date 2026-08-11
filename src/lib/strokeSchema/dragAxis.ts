export type AxisPoint = { x: number; y: number };

/**
 * A stroke's on-canvas stretch handle has no independent drag state of its
 * own — its rest position for a given `factor` is derived directly from the
 * anchor→dragOrigin axis already established at handle-creation time
 * (App.tsx's `setStretchFactor`): `dragOrigin` is defined as the `factor=1`
 * (natural) point, and `dragX` (not used here) as the `factor=maxFactor`
 * point, both on the same ray from `anchor`. So `factor` itself is already
 * the interpolation parameter along that ray — no need to go through
 * `lib/glyphEdits.ts`'s `resolveValueMultiplier`, which is a separate,
 * renderer-side concern for how a *glyph outline point* gets displaced, not
 * for where this UI handle sits.
 */
export function dotPositionForFactor(
  anchor: AxisPoint,
  dragOrigin: AxisPoint,
  factor: number
): AxisPoint {
  return {
    x: anchor.x + factor * (dragOrigin.x - anchor.x),
    y: anchor.y + factor * (dragOrigin.y - anchor.y),
  };
}

/**
 * Inverse of `dotPositionForFactor`: projects an arbitrary point onto the
 * anchor→dragOrigin axis and reads off the corresponding `factor`, clamped
 * to `[minFactor, maxFactor]`. Perpendicular distance from the axis is
 * ignored (a drag doesn't have to land exactly on the rail before this is
 * called — `projectOntoAxis` below is what actually constrains the visual
 * drag to the rail; this function just needs *a* point to read a factor
 * from).
 */
export function factorForPosition(
  anchor: AxisPoint,
  dragOrigin: AxisPoint,
  pos: AxisPoint,
  minFactor: number,
  maxFactor: number
): number {
  const dx = dragOrigin.x - anchor.x;
  const dy = dragOrigin.y - anchor.y;
  const axisLen = Math.max(Math.hypot(dx, dy), 1e-6);
  const dirX = dx / axisLen;
  const dirY = dy / axisLen;
  const relX = pos.x - anchor.x;
  const relY = pos.y - anchor.y;
  const along = relX * dirX + relY * dirY;
  const factor = along / axisLen;
  return Math.max(minFactor, Math.min(maxFactor, factor));
}

/**
 * Projects `pos` onto the anchor→dragOrigin line (unclamped — the caller
 * decides factor bounds separately via `factorForPosition`). Used as a
 * Konva `dragBoundFunc` to constrain a stretch handle's drag to a straight
 * rail instead of free 2D movement. All three points must be in the same
 * coordinate space — `dragBoundFunc` specifically receives/returns
 * *absolute* (stage) coordinates, so callers project the axis endpoints
 * into that same absolute space before calling this (see
 * `StrokeStretchHoverHandles.tsx`).
 */
export function projectOntoAxis(
  anchor: AxisPoint,
  dragOrigin: AxisPoint,
  pos: AxisPoint
): AxisPoint {
  const dx = dragOrigin.x - anchor.x;
  const dy = dragOrigin.y - anchor.y;
  const axisLen = Math.max(Math.hypot(dx, dy), 1e-6);
  const dirX = dx / axisLen;
  const dirY = dy / axisLen;
  const relX = pos.x - anchor.x;
  const relY = pos.y - anchor.y;
  const along = relX * dirX + relY * dirY;
  return { x: anchor.x + dirX * along, y: anchor.y + dirY * along };
}
