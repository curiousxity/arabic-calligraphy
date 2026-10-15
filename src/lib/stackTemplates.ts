// Built-in container shapes for the stack editor window. Pure; never imports
// ./harfbuzz. A template is a guide shape's formula sized to the composition
// rather than a guide block on the canvas.
import { GUIDE_DEFAULTS, containerPolygon, guidePathD } from "./guideShapes";
import { parseSvgPath } from "./svgPath";

export type StackTemplate = "teardrop" | "almond";
export const STACK_TEMPLATES: readonly StackTemplate[] = ["teardrop", "almond"];

/** The least height a template is ever built at, px: a composition with no
 *  ink yet (or a measured height of 0) still gets a usable shape. */
const MIN_HEIGHT_PX = 40;

/**
 * The template's container polygon in px, centred on the origin, scaled
 * uniformly so its height equals `inkHeightPx × sizeFactor`. Width follows
 * the shape's default aspect. Height is the dimension matched because a
 * stacked name climbs: the composition is tall and the rows fill the height.
 */
export function templatePolygon(t: StackTemplate, inkHeightPx: number, sizeFactor: number): Array<[number, number]> {
  const d = GUIDE_DEFAULTS[t];
  const poly = containerPolygon(parseSvgPath(guidePathD(t, d)));
  if (!poly) return [];
  let y1 = Infinity, y2 = -Infinity, x1 = Infinity, x2 = -Infinity;
  for (const [x, y] of poly) { y1 = Math.min(y1, y); y2 = Math.max(y2, y); x1 = Math.min(x1, x); x2 = Math.max(x2, x); }
  const h = Math.max(y2 - y1, 1);
  const target = Math.max(inkHeightPx * sizeFactor, MIN_HEIGHT_PX);
  const s = target / h;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  return poly.map(([x, y]) => [(x - cx) * s, (y - cy) * s] as [number, number]);
}
