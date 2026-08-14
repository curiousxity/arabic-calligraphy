import type { StrokeSpine } from "./types";

export type SpineAnchor = {
  anchor: { x: number; y: number };
  dragOrigin: { x: number; y: number };
  /** The whole spine in block-text units, stored on the handle for change 2's later use. */
  points: { x: number; y: number }[];
  bandWidth: number;
};

/** Below this the axis is too short to displace anything meaningfully. */
const MIN_AXIS_PX = 1e-3;
/** A hairline stroke still needs a grabbable band. */
const MIN_BAND_PX = 4;

/**
 * A spine in font units becomes an axis in the block's text units.
 *
 * `gx`/`gy` come straight off the glyph's own GlyphHitBox (ShapedText.tsx),
 * which already carries the pen origin — the same origin the renderer draws
 * that glyph at. The Y negation is the font's y-up convention against canvas
 * y-down, the one flip mapNormToRealBox used to perform.
 *
 * Band width comes from the spine's own widest radius rather than the old
 * hardcoded 20: radius is the distance to the outline, so twice it is the
 * local stroke width, which is the region a stroke edit should actually reach.
 */
export function spineToBlockSpace(
  spine: StrokeSpine,
  opts: { gx: number; gy: number; fontSize: number; unitsPerEm: number }
): SpineAnchor | null {
  const { gx, gy, fontSize, unitsPerEm } = opts;
  if (!(unitsPerEm > 0) || !(fontSize > 0)) return null;
  if (spine.points.length < 2) return null;

  const scale = fontSize / unitsPerEm;
  const points = spine.points.map((p) => ({ x: gx + p.x * scale, y: gy - p.y * scale }));

  const anchor = points[0];
  const dragOrigin = points[points.length - 1];
  if (Math.hypot(dragOrigin.x - anchor.x, dragOrigin.y - anchor.y) < MIN_AXIS_PX) return null;

  const widest = spine.points.reduce((m, p) => Math.max(m, p.radius), 0);
  const bandWidth = Math.max(MIN_BAND_PX, widest * 2 * scale);

  return { anchor, dragOrigin, points, bandWidth };
}
