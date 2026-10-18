// Built-in container shapes for the stack editor window. Pure; never imports
// ./harfbuzz. A template is a guide shape's formula sized to the composition
// rather than a guide block on the canvas.
import { GUIDE_DEFAULTS, containerPolygon, guidePathD } from "./guideShapes";
import { parseSvgPath } from "./svgPath";

export type StackTemplate = "teardrop" | "almond" | "rectangle" | "square" | "circle";
export const STACK_TEMPLATES: readonly StackTemplate[] = ["teardrop", "almond", "rectangle", "square", "circle"];

/** The least height a template is ever built at, px: a composition with no
 *  ink yet (or a measured height of 0) still gets a usable shape. */
const MIN_HEIGHT_PX = 40;
/** Width over height of the panel shapes, which have no guide formula. */
export const PANEL_ASPECT: Record<"rectangle" | "square", number> = { rectangle: 1.6, square: 1 };
/** Points per side of a panel shape: the arranger samples chords, and a
 *  polygon of four corners gives it nothing to read between them. */
const SIDE_STEPS = 8;

function unitPolygon(t: StackTemplate): Array<[number, number]> | null {
  if (t === "rectangle" || t === "square") {
    const w = PANEL_ASPECT[t], out: Array<[number, number]> = [];
    const corners: Array<[number, number]> = [[-w / 2, -0.5], [w / 2, -0.5], [w / 2, 0.5], [-w / 2, 0.5]];
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % 4];
      for (let k = 0; k < SIDE_STEPS; k++) out.push([a[0] + ((b[0] - a[0]) * k) / SIDE_STEPS, a[1] + ((b[1] - a[1]) * k) / SIDE_STEPS]);
    });
    return out;
  }
  return containerPolygon(parseSvgPath(guidePathD(t, GUIDE_DEFAULTS[t])));
}

/**
 * The template's container polygon in px, centred on the origin, scaled
 * uniformly so its height equals `inkHeightPx × sizeFactor`. Width follows
 * the shape's default aspect. Height is the dimension matched because a
 * stacked name climbs: the composition is tall and the rows fill the height.
 */
export function templatePolygon(t: StackTemplate, inkHeightPx: number, sizeFactor: number): Array<[number, number]> {
  const poly = unitPolygon(t);
  if (!poly) return [];
  let y1 = Infinity, y2 = -Infinity, x1 = Infinity, x2 = -Infinity;
  for (const [x, y] of poly) { y1 = Math.min(y1, y); y2 = Math.max(y2, y); x1 = Math.min(x1, x); x2 = Math.max(x2, x); }
  const h = Math.max(y2 - y1, 1e-9);
  const target = Math.max(inkHeightPx * sizeFactor, MIN_HEIGHT_PX);
  const s = target / h;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  return poly.map(([x, y]) => [(x - cx) * s, (y - cy) * s] as [number, number]);
}
