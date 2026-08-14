/**
 * Path-construction primitives for the ornament modules in this folder.
 *
 * Every ornament's geometry is *constructed* from these — arcs, polygons,
 * lobed circles — rather than traced from a found image, which is what keeps
 * the whole set original work with no provenance to track.
 *
 * Two constraints from the app's own path code shape what is in here:
 *
 * - `lib/svgPath.ts`'s `parseSvgPath` degrades an `A` (elliptical arc)
 *   command to a straight line to its endpoint. So nothing here emits `A`;
 *   circular arcs are approximated with cubic béziers instead, which
 *   `pathToPolygon` subdivides properly.
 * - Shape Fill hit-tests with ray-casting over one flat point list, so a
 *   hole must be cut with a *coincident* bridge (out and back along the same
 *   segment) rather than as a separate subpath — see `ringPath`.
 *
 * The filename's leading underscore is only a reading aid; `lib/ornaments.ts`
 * skips this module because it exports no ornament, not because of its name.
 */

/** Trims float noise out of emitted coordinates. */
const f = (n: number): string => String(Math.round(n * 1000) / 1000);

export type Pt = [number, number];

/** A point on the circle (cx, cy, r) at angle `a`, in SVG's y-down space. */
export function polar(cx: number, cy: number, r: number, a: number): Pt {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

export function moveTo([x, y]: Pt): string {
  return `M ${f(x)} ${f(y)}`;
}

export function lineTo([x, y]: Pt): string {
  return `L ${f(x)} ${f(y)}`;
}

/**
 * Cubic-bézier approximation of the circular arc from `a0` to `a1`, emitted
 * as `C` commands only — the caller is responsible for having the pen at the
 * arc's start point already. `a1 < a0` sweeps the other way.
 *
 * Split so no single segment spans more than a quarter turn, which is where
 * the standard `k = 4/3·tan(θ/4)` handle length stays visually exact.
 */
export function arcCommands(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number
): string {
  const segments = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const step = (a1 - a0) / segments;
  const k = (4 / 3) * Math.tan(step / 4);

  const out: string[] = [];
  for (let i = 0; i < segments; i++) {
    const s = a0 + i * step;
    const e = s + step;
    const [x0, y0] = polar(cx, cy, r, s);
    const [x1, y1] = polar(cx, cy, r, e);
    // Tangent of (cos a, sin a) is (-sin a, cos a).
    const c1x = x0 - k * r * Math.sin(s);
    const c1y = y0 + k * r * Math.cos(s);
    const c2x = x1 + k * r * Math.sin(e);
    const c2y = y1 - k * r * Math.cos(e);
    out.push(`C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(x1)} ${f(y1)}`);
  }
  return out.join(" ");
}

/** A whole circle as one closed path. */
export function circlePath(cx: number, cy: number, r: number): string {
  return `${moveTo(polar(cx, cy, r, 0))} ${arcCommands(cx, cy, r, 0, Math.PI * 2)} Z`;
}

/** A closed polygon through `points`. */
export function polygonPath(points: Pt[]): string {
  return `${moveTo(points[0])} ${points.slice(1).map(lineTo).join(" ")} Z`;
}

/**
 * A `points`-pointed star, alternating between `outer` and `inner` radius.
 * `rotation` defaults to straight up, the orientation every seal-of-Solomon
 * style khatam is drawn in.
 */
export function starPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
  rotation = -Math.PI / 2
): string {
  const verts: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rotation + (i * Math.PI) / points;
    verts.push(polar(cx, cy, i % 2 === 0 ? outer : inner, a));
  }
  return polygonPath(verts);
}

/**
 * A disc whose rim is broken into `lobes` outward scallops of depth `bulge`.
 * Each lobe is one cubic bulging past the base circle, so the lobes meet in
 * cusps on the circle itself — the shape a scalloped roundel actually has.
 */
export function scallopedCirclePath(
  cx: number,
  cy: number,
  r: number,
  lobes: number,
  bulge: number,
  rotation = -Math.PI / 2
): string {
  const step = (Math.PI * 2) / lobes;
  const out = [moveTo(polar(cx, cy, r, rotation))];

  for (let i = 0; i < lobes; i++) {
    const a0 = rotation + i * step;
    const a1 = a0 + step;
    const [c1x, c1y] = polar(cx, cy, r + bulge, a0 + step * 0.25);
    const [c2x, c2y] = polar(cx, cy, r + bulge, a0 + step * 0.75);
    const [ex, ey] = polar(cx, cy, r, a1);
    out.push(`C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(ex)} ${f(ey)}`);
  }

  out.push("Z");
  return out.join(" ");
}

/**
 * A ring (outer loop with a hole) as a single closed outline.
 *
 * The hole is reached by a bridge segment traversed twice, out and back
 * along exactly the same line. Two coincident edges are invisible under both
 * SVG fill rules *and* cancel out under the ray-casting test Shape Fill uses
 * — which a conventional two-subpath ring does not, because the implicit
 * joins between subpaths are two different segments and enclose a wedge of
 * area that the ray count then gets wrong.
 *
 * `outer` and `inner` must wind in opposite directions, and the bridge runs
 * from `outer[0]` to `inner[0]`.
 */
export function ringPath(outer: Pt[], inner: Pt[]): string {
  return [
    moveTo(outer[0]),
    ...outer.slice(1).map(lineTo),
    lineTo(outer[0]),
    ...inner.map(lineTo),
    lineTo(inner[0]),
    lineTo(outer[0]),
    "Z",
  ].join(" ");
}
