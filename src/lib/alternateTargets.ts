/**
 * Geometry for the Next Shape overlay: letter instances as polygons in a
 * renderer's group space, hit-tested in plain arithmetic.
 *
 * The overlay is pointer-resolved — one listening Konva node, the target
 * under the pointer found here — because a Shape Fill silhouette can tile
 * ~23,000 letters, and one listening node per letter at that count freezes
 * the tab (measured on the removed glyph-transform overlay). Pure, so it is
 * tested without a canvas.
 */

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
type Box = { x: number; y: number; width: number; height: number };

/** A box's corners, clockwise from the top-left, grown by `pad` on every side. */
export function quadFromBox(b: Box, pad = 0): Quad {
  const x1 = b.x - pad;
  const y1 = b.y - pad;
  const x2 = b.x + b.width + pad;
  const y2 = b.y + b.height + pad;
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

/** Axis-aligned bounds of every polygon together, or null when there are none. */
export function polygonBounds(polys: readonly (readonly Point[])[]): Box | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < x1) x1 = p.x;
      if (p.y < y1) y1 = p.y;
      if (p.x > x2) x2 = p.x;
      if (p.y > y2) y2 = p.y;
    }
  }
  if (!isFinite(x1) || !isFinite(y1)) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Even-odd ray cast; works for any simple polygon, including rotated quads. */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The target under `p`. The **last** match wins: targets are listed in paint
 * order, so the letter drawn on top — the one the eye sees — is the one
 * picked where tiles or neighbours overlap. A bounds check skips most
 * polygons before the ray cast.
 */
export function hitTestTargets<T extends { polygon: readonly Point[] }>(
  targets: readonly T[],
  p: Point
): T | null {
  for (let i = targets.length - 1; i >= 0; i--) {
    const poly = targets[i].polygon;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const q of poly) {
      if (q.x < x1) x1 = q.x;
      if (q.y < y1) y1 = q.y;
      if (q.x > x2) x2 = q.x;
      if (q.y > y2) y2 = q.y;
    }
    if (p.x < x1 || p.x > x2 || p.y < y1 || p.y > y2) continue;
    if (pointInPolygon(p, poly)) return targets[i];
  }
  return null;
}

/** Mean of the vertices — the centre of a quad. */
export function polygonCentre(poly: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(poly.length, 1), y: y / Math.max(poly.length, 1) };
}
