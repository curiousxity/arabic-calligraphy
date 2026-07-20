import type { GlyphEdit, GlyphRig, GlyphRigValue, GlyphStretchMask } from "../types";

export const STRETCH_ANCHOR_COLOR = "#ff4d4f";
export const STRETCH_DRAG_COLOR = "#22c55e";
export const MASK_CONTOUR_ON_COLOR = "#22c55e";
export const MASK_CONTOUR_OFF_COLOR = "#9ca3af";
export const MASK_LASSO_COLOR = "#22c55e";

/** Standard ray-casting point-in-polygon test (even-odd rule). */
function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Whether a point (in the same "original, undisplaced" coordinate space the
 * mask was authored in) is eligible for a handle/axis's displacement. No
 * mask = every point is eligible, matching the pre-mask behavior.
 */
function passesMask(mask: GlyphStretchMask | undefined, x: number, y: number, contourIndex: number): boolean {
  if (!mask) return true;
  if (mask.mode === "contours") return mask.contourIndices.includes(contourIndex);
  return pointInPolygon(x, y, mask.points);
}

type AxisGeometry = {
  anchorX: number;
  anchorY: number;
  dragOriginX: number;
  dragOriginY: number;
  dragX: number;
  dragY: number;
  bandWidth: number;
};

/**
 * Displaces a single outline point along one anchor→dragOrigin axis,
 * proportional to distance from the anchor (0 at the anchor, 1 at the
 * dragOrigin, unbounded beyond it), tapered by perpendicular distance from
 * the axis (a smoothstep band falloff), and scaled by `valueMultiplier` —
 * 1 for a live-dragged stretch handle (dragX/dragY already ARE the target
 * position), or a [-1, 1] slider value for a rig axis (dragX/dragY are the
 * axis's authored "full strength" position).
 */
function applyAxisDisplacement(
  x: number,
  y: number,
  axis: AxisGeometry,
  valueMultiplier: number
): { x: number; y: number } {
  const axisX = axis.dragOriginX - axis.anchorX;
  const axisY = axis.dragOriginY - axis.anchorY;
  const axisLen = Math.max(Math.hypot(axisX, axisY), 1e-6);
  const dirX = axisX / axisLen;
  const dirY = axisY / axisLen;

  const deltaAlong =
    ((axis.dragX - axis.dragOriginX) * dirX + (axis.dragY - axis.dragOriginY) * dirY) *
    valueMultiplier;
  if (deltaAlong === 0) return { x, y };

  const relX = x - axis.anchorX;
  const relY = y - axis.anchorY;
  const along = relX * dirX + relY * dirY;
  const perpX = relX - along * dirX;
  const perpY = relY - along * dirY;
  const perpDist = Math.hypot(perpX, perpY);

  if (perpDist >= axis.bandWidth) return { x, y };

  const t = 1 - perpDist / axis.bandWidth;
  const falloff = t * t * (3 - 2 * t); // smoothstep — no hard seam at the band edge
  const tAlong = along / axisLen;

  const displacement = deltaAlong * tAlong * falloff;
  return { x: x + displacement * dirX, y: y + displacement * dirY };
}

/**
 * Applies a glyph's edits to a single outline point: each stretch handle
 * pulls points near its anchor→drag axis along that axis, proportional to
 * distance from the anchor (0 at the anchor, 1 at the drag handle's original
 * position, unbounded beyond it) and tapered by perpendicular distance from
 * the axis (a smoothstep band falloff).
 */
export function applyGlyphEdit(
  x: number,
  y: number,
  edit: GlyphEdit | undefined,
  contourIndex = -1
): { x: number; y: number } {
  if (!edit) return { x, y };

  let px = x;
  let py = y;

  for (const h of edit.stretches) {
    // Masked against the original (pre-stretch) position so a point can't be
    // carried out of, or into, its own mask by an earlier handle in the chain.
    if (!passesMask(h.mask, x, y, contourIndex)) continue;
    const p = applyAxisDisplacement(px, py, h, 1);
    px = p.x;
    py = p.y;
  }

  return { x: px, y: py };
}

type PreparedRigAxis = {
  value: number;
  mask: GlyphStretchMask | undefined;
  scaled: AxisGeometry;
};

/** Result of {@link prepareGlyphRig} — the resolved, fontSize/gx/gy-scaled axis list for one glyph occurrence. */
export type PreparedGlyphRig = PreparedRigAxis[];

/**
 * Resolves every rig axis this block has dialed a nonzero value for, for the
 * glyph identified by (fontFamily, glyphId), into fontSize/gx/gy-scaled
 * geometry ready for {@link applyPreparedGlyphRig}. Axis geometry is stored
 * em-relative (authored value / authoring block's fontSize) so it's
 * rescaled here by the *consuming* block's own fontSize — this is what lets
 * one rig axis look visually correct on any block using that font,
 * regardless of that block's font size. Unknown/dangling axis ids (the
 * library axis was deleted, or this project was opened somewhere that
 * doesn't have it) are silently skipped, matching this app's existing
 * precedent for ignoring unknown persisted fields.
 *
 * This lookup/rescale work is constant for an entire glyph occurrence, so
 * callers that apply the rig to multiple points of the same glyph (every
 * renderer does — once per path-command coordinate) should call this once
 * per glyph and reuse the result via `applyPreparedGlyphRig`, rather than
 * calling `applyGlyphRig` per point.
 */
export function prepareGlyphRig(
  fontFamily: string,
  glyphId: number,
  fontSize: number,
  glyphRigs: GlyphRig[],
  values: GlyphRigValue[] | undefined,
  // This glyph occurrence's own pen offset — axis geometry is authored
  // relative to the glyph's own origin (see saveStretchHandleAsRig), so it
  // has to be re-added here to land at the right spot for THIS occurrence,
  // which generally sits at a different pen position than the one the axis
  // was authored on.
  gx = 0,
  gy = 0
): PreparedGlyphRig {
  if (!values?.length) return [];

  const rig = glyphRigs.find((r) => r.fontFamily === fontFamily && r.glyphId === glyphId);
  if (!rig) return [];

  const prepared: PreparedGlyphRig = [];

  for (const v of values) {
    if (!v.value) continue;

    const axis = rig.axes.find((a) => a.id === v.axisId);
    if (!axis) continue;

    // Em-relative mask geometry, rescaled by the consuming block's fontSize
    // and re-offset by this occurrence's gx/gy, just like the rest of this
    // axis (see the function comment above).
    const mask: GlyphStretchMask | undefined =
      axis.mask == null
        ? undefined
        : axis.mask.mode === "contours"
          ? axis.mask
          : {
              mode: "lasso",
              points: axis.mask.points.map((p) => ({
                x: p.x * fontSize + gx,
                y: p.y * fontSize + gy,
              })),
            };

    const scaled: AxisGeometry = {
      anchorX: axis.anchorX * fontSize + gx,
      anchorY: axis.anchorY * fontSize + gy,
      dragOriginX: axis.dragOriginX * fontSize + gx,
      dragOriginY: axis.dragOriginY * fontSize + gy,
      dragX: axis.dragX * fontSize + gx,
      dragY: axis.dragY * fontSize + gy,
      bandWidth: axis.bandWidth * fontSize,
    };

    prepared.push({ value: v.value, mask, scaled });
  }

  return prepared;
}

/** Applies an already-resolved {@link PreparedGlyphRig} (see `prepareGlyphRig`) to a single outline point. */
export function applyPreparedGlyphRig(
  x: number,
  y: number,
  prepared: PreparedGlyphRig,
  contourIndex = -1
): { x: number; y: number } {
  let px = x;
  let py = y;

  for (const { value, mask, scaled } of prepared) {
    if (!passesMask(mask, x, y, contourIndex)) continue;
    const p = applyAxisDisplacement(px, py, scaled, value);
    px = p.x;
    py = p.y;
  }

  return { x: px, y: py };
}

/**
 * Convenience one-shot wrapper around `prepareGlyphRig` + `applyPreparedGlyphRig`
 * for a single point. Callers that transform multiple points of the same
 * glyph occurrence (i.e. every renderer) should call `prepareGlyphRig` once
 * per glyph instead, to avoid redoing the rig/axis lookup per point.
 */
export function applyGlyphRig(
  x: number,
  y: number,
  fontFamily: string,
  glyphId: number,
  fontSize: number,
  glyphRigs: GlyphRig[],
  values: GlyphRigValue[] | undefined,
  contourIndex = -1,
  gx = 0,
  gy = 0
): { x: number; y: number } {
  const prepared = prepareGlyphRig(fontFamily, glyphId, fontSize, glyphRigs, values, gx, gy);
  if (prepared.length === 0) return { x, y };
  return applyPreparedGlyphRig(x, y, prepared, contourIndex);
}
