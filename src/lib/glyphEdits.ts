import type { GlyphEdit, GlyphRig, GlyphRigValue } from "../types";

export const MOVE_HANDLE_COLOR = "#4d94ff";
export const STRETCH_ANCHOR_COLOR = "#ff4d4f";
export const STRETCH_DRAG_COLOR = "#22c55e";

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
 * Applies a glyph's edits to a single outline point:
 *  - Each stretch handle pulls points near its anchor→drag axis along that
 *    axis, proportional to distance from the anchor (0 at the anchor, 1 at
 *    the drag handle's original position, unbounded beyond it) and tapered
 *    by perpendicular distance from the axis (a smoothstep band falloff).
 *  - The move offset (if any) then rigidly shifts the whole already-stretched
 *    point — this is what lets a letter be repositioned as one piece while
 *    still supporting a separate stretch on a neighboring glyph's connector
 *    to visually follow it.
 */
export function applyGlyphEdit(
  x: number,
  y: number,
  edit: GlyphEdit | undefined
): { x: number; y: number } {
  if (!edit) return { x, y };

  let px = x;
  let py = y;

  for (const h of edit.stretches) {
    const p = applyAxisDisplacement(px, py, h, 1);
    px = p.x;
    py = p.y;
  }

  if (edit.move) {
    px += edit.move.offsetX;
    py += edit.move.offsetY;
  }

  return { x: px, y: py };
}

/**
 * Applies every rig axis this block has dialed a nonzero value for, for the
 * glyph identified by (fontFamily, glyphId). Axis geometry is stored
 * em-relative (authored value / authoring block's fontSize) so it's
 * rescaled here by the *consuming* block's own fontSize — this is what lets
 * one rig axis look visually correct on any block using that font,
 * regardless of that block's font size. Unknown/dangling axis ids (the
 * library axis was deleted, or this project was opened somewhere that
 * doesn't have it) are silently skipped, matching this app's existing
 * precedent for ignoring unknown persisted fields.
 */
export function applyGlyphRig(
  x: number,
  y: number,
  fontFamily: string,
  glyphId: number,
  fontSize: number,
  glyphRigs: GlyphRig[],
  values: GlyphRigValue[] | undefined
): { x: number; y: number } {
  if (!values?.length) return { x, y };

  const rig = glyphRigs.find((r) => r.fontFamily === fontFamily && r.glyphId === glyphId);
  if (!rig) return { x, y };

  let px = x;
  let py = y;

  for (const v of values) {
    if (!v.value) continue;

    const axis = rig.axes.find((a) => a.id === v.axisId);
    if (!axis) continue;

    const scaled: AxisGeometry = {
      anchorX: axis.anchorX * fontSize,
      anchorY: axis.anchorY * fontSize,
      dragOriginX: axis.dragOriginX * fontSize,
      dragOriginY: axis.dragOriginY * fontSize,
      dragX: axis.dragX * fontSize,
      dragY: axis.dragY * fontSize,
      bandWidth: axis.bandWidth * fontSize,
    };

    const p = applyAxisDisplacement(px, py, scaled, v.value);
    px = p.x;
    py = p.y;
  }

  return { x: px, y: py };
}
