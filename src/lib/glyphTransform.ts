import type { GlyphTransform } from "../types";

export type ResolvedGlyphTransform = {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
};

/**
 * A glyph may neither collapse to nothing nor grow so large it swamps the
 * artboard. These bounds are enforced both when reading a drag and when
 * resolving a stored value, so a hand-edited or corrupted project file
 * cannot produce a glyph that is impossible to grab and fix.
 */
export const GLYPH_SCALE_MIN = 0.2;
export const GLYPH_SCALE_MAX = 4;

const clampScale = (v: number) =>
  Number.isFinite(v) ? Math.max(GLYPH_SCALE_MIN, Math.min(GLYPH_SCALE_MAX, v)) : 1;

export function resolveGlyphTransform(
  t: GlyphTransform | undefined
): ResolvedGlyphTransform {
  return {
    offsetX: t?.offsetX ?? 0,
    offsetY: t?.offsetY ?? 0,
    scaleX: clampScale(t?.scaleX ?? 1),
    scaleY: clampScale(t?.scaleY ?? 1),
  };
}

/**
 * Converts a scale-handle drag into a scale multiplier: how far the
 * pointer now sits from the pen-origin pivot, over how far the handle sits
 * from it at rest (scale 1). Both distances are signed along the handle's
 * own rail, so dragging past the pivot reads as a shrink toward the
 * minimum rather than flipping the glyph inside out.
 *
 * `restDistance` of zero would divide by zero — it happens for a
 * zero-width glyph such as a bare combining mark whose box collapses — so
 * it floors to a small epsilon, which drives the result straight to the
 * clamp instead of producing Infinity/NaN.
 */
export function scaleFromDrag(restDistance: number, dragDistance: number): number {
  const rest = Math.abs(restDistance) < 1e-6 ? 1e-6 : restDistance;
  return clampScale(dragDistance / rest);
}

/**
 * The scale a glyph should take when its scale handle has been dragged to
 * `dragDistance` from the pivot.
 *
 * A scale dot rests a fixed `gap` beyond the glyph's own edge, so at scale
 * `s` it sits at `extent · s + gap` from the pivot, where `extent` is the
 * glyph's unscaled edge distance. Inverting that gives the exact scale for
 * any dot position, which is what keeps the dot glued exactly `gap` past
 * the edge for the whole drag instead of slowly outrunning it.
 *
 * `extent` is recovered from the dot's position at drag start rather than
 * measured directly, because the caller only knows where the dot sits and
 * what scale the glyph was already drawn at. Recovering it this way also
 * makes the first frame of a drag return exactly `startScale`, so grabbing
 * a handle never makes the glyph jump — including when a glyph that has
 * already been scaled is dragged a second time, which a naive
 * `startDistance / startScale` rest distance gets wrong by
 * `gap · (1 - 1/startScale)`.
 */
export function scaleFromHandleDrag(
  startDistance: number,
  dragDistance: number,
  gap: number,
  startScale: number
): number {
  const s = Math.abs(startScale) < 1e-6 ? 1 : startScale;
  const extent = (startDistance - gap) / s;
  return scaleFromDrag(extent, dragDistance - gap);
}

/**
 * Where a glyph's bounding box lands once its transform is applied.
 *
 * Mirrors the draw order in ShapedText's `drawWarpedGlyphRun` exactly —
 * `ctx.translate(gx, gy)`, then `ctx.translate(offset)`, then
 * `ctx.scale(...)` — which means the scale pivots on the pen origin
 * `(gx, gy)` and the offset is applied in unscaled units on top. The
 * renderer and the hover overlay must agree on this box, so both call this
 * function rather than repeating the arithmetic.
 */
export function transformedBox(
  box: { x: number; y: number; width: number; height: number },
  gx: number,
  gy: number,
  t: GlyphTransform | undefined
): { x: number; y: number; width: number; height: number } {
  const { offsetX, offsetY, scaleX, scaleY } = resolveGlyphTransform(t);
  return {
    x: gx + (box.x - gx) * scaleX + offsetX,
    y: gy + (box.y - gy) * scaleY + offsetY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}
