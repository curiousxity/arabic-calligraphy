import type { GlyphEdit } from "../types";

export const MOVE_HANDLE_COLOR = "#4d94ff";
export const STRETCH_ANCHOR_COLOR = "#ff4d4f";
export const STRETCH_DRAG_COLOR = "#22c55e";

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
    const axisX = h.dragOriginX - h.anchorX;
    const axisY = h.dragOriginY - h.anchorY;
    const axisLen = Math.max(Math.hypot(axisX, axisY), 1e-6);
    const dirX = axisX / axisLen;
    const dirY = axisY / axisLen;

    const deltaAlong = (h.dragX - h.dragOriginX) * dirX + (h.dragY - h.dragOriginY) * dirY;
    if (deltaAlong === 0) continue;

    const relX = px - h.anchorX;
    const relY = py - h.anchorY;
    const along = relX * dirX + relY * dirY;
    const perpX = relX - along * dirX;
    const perpY = relY - along * dirY;
    const perpDist = Math.hypot(perpX, perpY);

    if (perpDist >= h.bandWidth) continue;

    const t = 1 - perpDist / h.bandWidth;
    const falloff = t * t * (3 - 2 * t); // smoothstep — no hard seam at the band edge
    const tAlong = along / axisLen;

    const displacement = deltaAlong * tAlong * falloff;
    px += displacement * dirX;
    py += displacement * dirY;
  }

  if (edit.move) {
    px += edit.move.offsetX;
    py += edit.move.offsetY;
  }

  return { x: px, y: py };
}
