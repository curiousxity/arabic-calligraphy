import type { GlyphTransform } from "../types";

export type ResolvedGlyphTransform = {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
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

/**
 * Folds a rotation into (-180, 180] so a handle dragged several times round
 * stores a small number rather than accumulating without bound, and makes
 * the same defensive promise `clampScale` does: a hand-edited or corrupted
 * project file cannot store a NaN that would make a glyph vanish, leaving no
 * handle to grab and fix it with.
 */
export function normalizeRotation(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const wrapped = ((v % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

export function resolveGlyphTransform(
  t: GlyphTransform | undefined
): ResolvedGlyphTransform {
  return {
    offsetX: t?.offsetX ?? 0,
    offsetY: t?.offsetY ?? 0,
    scaleX: clampScale(t?.scaleX ?? 1),
    scaleY: clampScale(t?.scaleY ?? 1),
    rotation: normalizeRotation(t?.rotation ?? 0),
  };
}

/**
 * The point a glyph turns about: the centre of its own **raw** outline box,
 * expressed relative to the pen origin the renderer has already translated
 * to.
 *
 * Raw is load-bearing. `ShapedText` applies the rotation *inside* the scale,
 * so the pivot must be read off the untransformed box — a pivot derived from
 * the drawn (already-scaled) box would move as the glyph is scaled, and the
 * scale handles snapshot their own pivot once at drag start and measure from
 * that frozen point every frame. A pivot that drifts under them is exactly
 * the "asking for 2x lands near 1.45x" divergence `scaleFromHandleDrag` was
 * written to remove, and it is zero at rotation 0 — so it would ship green.
 */
export function glyphPivot(
  box: { x: number; y: number; width: number; height: number },
  gx: number,
  gy: number
): { x: number; y: number } {
  return {
    x: box.x + box.width / 2 - gx,
    y: box.y + box.height / 2 - gy,
  };
}

/**
 * Reads a rotate-handle drag as an absolute angle: how far the pointer has
 * swung around the pivot since the gesture began, added to the rotation the
 * glyph already carried.
 *
 * Measuring the *change* in bearing rather than the bearing itself is what
 * makes the first frame return exactly `startRotation` — the no-jump
 * property `scaleFromHandleDrag`'s own tests pin — and what lets the handle
 * be grabbed anywhere on its rest circle rather than only at the one point
 * whose bearing happens to equal the current angle.
 */
export function rotationFromHandleDrag(
  pivot: { x: number; y: number },
  startPointer: { x: number; y: number },
  currentPointer: { x: number; y: number },
  startRotation: number
): number {
  const a0 = Math.atan2(startPointer.y - pivot.y, startPointer.x - pivot.x);
  const a1 = Math.atan2(currentPointer.y - pivot.y, currentPointer.x - pivot.x);
  const delta = ((a1 - a0) * 180) / Math.PI;
  return normalizeRotation(normalizeRotation(startRotation) + delta);
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
 * `ctx.scale(...)`, then the rotation about the glyph's own raw box centre
 * — which means the scale pivots on the pen origin `(gx, gy)`, the offset is
 * applied in unscaled units on top, and the turn happens *inside* the scale.
 * The renderer and the hover overlay must agree on this box, so both call
 * this function rather than repeating the arithmetic.
 *
 * At `rotation === 0` it returns exactly what it always did, which is what
 * lets every assertion written before the rotate handle existed stand
 * verbatim as the regression guard.
 */
export function transformedBox(
  box: { x: number; y: number; width: number; height: number },
  gx: number,
  gy: number,
  t: GlyphTransform | undefined
): { x: number; y: number; width: number; height: number } {
  const { offsetX, offsetY, scaleX, scaleY, rotation } = resolveGlyphTransform(t);

  // A rotated glyph has no axis-aligned box of its own, so the overlay gets
  // the AABB of the turned outline box — the smallest upright rectangle that
  // still covers every dot's rest position and the whole hover target.
  // Taken *before* the scale, matching the draw order: rotate about the raw
  // centre, then scale about the pen origin.
  let x = box.x;
  let y = box.y;
  let width = box.width;
  let height = box.height;

  if (rotation !== 0) {
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const px = box.x + box.width / 2;
    const py = box.y + box.height / 2;
    const hw = box.width / 2;
    const hh = box.height / 2;
    // The AABB of a rectangle turned about its own centre is symmetric, so
    // the half-extents are all that is needed and the centre never moves.
    const ex = Math.abs(hw * cos) + Math.abs(hh * sin);
    const ey = Math.abs(hw * sin) + Math.abs(hh * cos);
    x = px - ex;
    y = py - ey;
    width = ex * 2;
    height = ey * 2;
  }

  return {
    x: gx + (x - gx) * scaleX + offsetX,
    y: gy + (y - gy) * scaleY + offsetY,
    width: width * scaleX,
    height: height * scaleY,
  };
}

/**
 * Folds a patch into the transform already stored at a glyph index.
 *
 * The reason this is not a plain spread: transforms are keyed by glyph index,
 * and a text edit can leave a stale entry sitting on an index that now holds a
 * different letter. `ShapedText` stops *rendering* such an entry (its recorded
 * `glyphId` no longer matches), but it is still in the block. Spreading a new
 * patch over it would revive the old glyph's `scaleX`/`scaleY` under the new
 * glyph's id — grab a letter's move dot after an edit and it would jump to a
 * scale set on some other letter. A definite mismatch therefore replaces the
 * entry outright.
 *
 * "Definite" is doing real work: an entry with no `glyphId` predates that
 * field and *is* still being applied, so patching it is correct and must not
 * be mistaken for staleness.
 */
export function mergeGlyphTransform(
  existing: GlyphTransform | undefined,
  glyphIndex: number,
  patch: Partial<GlyphTransform>
): GlyphTransform {
  const isStale =
    existing !== undefined &&
    existing.glyphId !== undefined &&
    patch.glyphId !== undefined &&
    existing.glyphId !== patch.glyphId;

  if (!existing || isStale) return { glyphIndex, ...patch };
  return { ...existing, ...patch };
}
