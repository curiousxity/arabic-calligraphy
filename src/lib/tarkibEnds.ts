/**
 * Where a piece's stroke is trimmed for a join: a cut square across the
 * stroke, a little way in from where the next letter meets it. The generated
 * anchors carry the writing direction at the meeting point, which is not the
 * stroke's own direction there: a cut along it was oblique, its face long and
 * slanted, and the pen stroke bridging two slanted faces zig-zagged or left
 * a slit. So the stroke is measured here: from the meeting point inward, the
 * shortest chord across the ink through each point is the stroke's
 * cross-section, and its centre the stroke's middle. Pure. See
 * .claude/rules/tarkib.md.
 */
import { flattenContours, type Contour, type Pt } from "./strokeCuts";
import { pointInPolygon, type SvgCmd } from "./svgPath";
import type { FaceCut } from "./tarkibSchema";

/** Degrees between the chord directions tried. */
const CHORD_STEP = 4;
/** The stroke's direction may differ from the way in by at most this many
 *  degrees at the first step, and turn at most TURN_PER_STEP per step after:
 *  at a tooth's foot the shortest chord runs across the stem, and a walk free
 *  to follow it climbed the stem instead of the stroke leaving the foot. */
const FIRST_CONE = 50;
const TURN_PER_STEP = 20;
/** Units walked inward per step. */
const WALK_STEP = 6;
/** Units: the farthest a cross-section's edge is looked for. */
const REACH = 160;
/** Units of slack either side of the measured stroke in the cut's window. */
const WINDOW_SLACK = 6;

const unit = (v: Pt): Pt => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

function insideInk(contours: readonly Contour[], p: Pt): boolean {
  let n = 0;
  for (const c of contours) if (pointInPolygon(p[0], p[1], c as Array<[number, number]>)) n++;
  return n % 2 === 1;
}

/** Distance from `from` along `dir` to the outline, or null if none. */
function rayHit(contours: readonly Contour[], from: Pt, dir: Pt): number | null {
  let best = Infinity;
  for (const c of contours) for (let i = 0; i < c.length; i++) {
    // a chord longer than REACH either way is no stroke's cross-section
    const ax = c[i][0], ay = c[i][1], bx = c[(i + 1) % c.length][0], by = c[(i + 1) % c.length][1];
    if (Math.max(ax, bx) < from[0] - REACH || Math.min(ax, bx) > from[0] + REACH || Math.max(ay, by) < from[1] - REACH || Math.min(ay, by) > from[1] + REACH) continue;
    const a = c[i], b = c[(i + 1) % c.length];
    const e: Pt = [b[0] - a[0], b[1] - a[1]];
    const den = dir[0] * e[1] - dir[1] * e[0];
    if (Math.abs(den) < 1e-9) continue;
    const ap: Pt = [a[0] - from[0], a[1] - from[1]];
    const t = (ap[0] * e[1] - ap[1] * e[0]) / den, u = (ap[0] * dir[1] - ap[1] * dir[0]) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return Number.isFinite(best) ? best : null;
}

/** The shortest chord across the ink through `p` whose stroke direction
 *  (perpendicular to the chord) is within `cone` degrees of `inward`: its
 *  centre, length, and that direction, pointing inward. */
function crossSection(contours: readonly Contour[], p: Pt, inward: Pt, cone: number): { centre: Pt; thickness: number; tangent: Pt } | null {
  let best: { centre: Pt; thickness: number; tangent: Pt } | null = null;
  const inAngle = Math.atan2(inward[1], inward[0]);
  for (let deg = 0; deg < 180; deg += CHORD_STEP) {
    const a = (deg * Math.PI) / 180;
    // the chord's angle from the way in: 90 degrees is a stroke running straight in
    const off = Math.abs(Math.atan2(Math.sin(a - inAngle), Math.cos(a - inAngle)));
    if (Math.abs(Math.min(off, Math.PI - off) - Math.PI / 2) > (cone * Math.PI) / 180) continue;
    const d: Pt = [Math.cos(a), Math.sin(a)];
    const s = rayHit(contours, p, d), t = rayHit(contours, p, [-d[0], -d[1]]);
    if (s === null || t === null) continue;
    if (!best || s + t < best.thickness) {
      const centre: Pt = [p[0] + (d[0] * (s - t)) / 2, p[1] + (d[1] * (s - t)) / 2];
      let tangent: Pt = [-d[1], d[0]];
      if (tangent[0] * inward[0] + tangent[1] * inward[1] < 0) tangent = [-tangent[0], -tangent[1]];
      best = { centre, thickness: s + t, tangent };
    }
  }
  return best;
}

const faceAt = (x: { centre: Pt; thickness: number; tangent: Pt }, outward: boolean): FaceCut => {
  const t = outward ? [-x.tangent[0], -x.tangent[1]] : x.tangent;
  const angle = Math.atan2(t[1], t[0]), cs = Math.cos(angle), sn = Math.sin(angle);
  return {
    cutX: x.centre[0] * cs + x.centre[1] * sn, angle, thickness: x.thickness,
    window: { y: -x.centre[0] * sn + x.centre[1] * cs, half: x.thickness / 2 + WINDOW_SLACK },
  };
};

/**
 * Square cuts at each of `depths` (units, ascending) into the stroke from
 * `meeting`, walking in along `inward` once (the stroke's middle re-found
 * at every step), as FaceCuts whose angle is `outward ? the way out : the
 * way in` (an exit's angle points out of the piece, an entry's into it:
 * tarkibSchema.ts FaceCut). A depth the walk does not reach (it left the
 * ink, or the stroke turned away) is null.
 */
export function squareCuts(cmds: SvgCmd[], meeting: Pt, inward: Pt, depths: readonly number[], outward: boolean): (FaceCut | null)[] {
  const out: (FaceCut | null)[] = depths.map(() => null);
  const contours = flattenContours(cmds);
  let dir = unit(inward), c: Pt = meeting;
  // the meeting point is on or just outside the ink's edge: step in until inside
  for (let k = 0; k < 8 && !insideInk(contours, c); k++) c = [c[0] + dir[0] * WALK_STEP, c[1] + dir[1] * WALK_STEP];
  if (!insideInk(contours, c)) return out;
  let x = crossSection(contours, c, dir, FIRST_CONE);
  if (!x) return out;
  let walked = 0;
  for (let i = 0; i < depths.length; i++) {
    for (; walked < depths[i]; walked += WALK_STEP) {
      dir = x.tangent;
      const next: Pt = [x.centre[0] + dir[0] * WALK_STEP, x.centre[1] + dir[1] * WALK_STEP];
      if (!insideInk(contours, next)) return out;
      const nx = crossSection(contours, next, dir, TURN_PER_STEP);
      if (!nx) return out;
      x = nx;
    }
    out[i] = faceAt(x, outward);
  }
  return out;
}
