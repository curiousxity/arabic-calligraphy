import { pathToPolygon, type SvgCmd } from "./svgPath";

const ARC_LENGTH_STEPS = 32;

/** Total length of a flattened path (fixed-step bezier subdivision, same resolution used for contour masking elsewhere). */
export function pathLength(cmds: SvgCmd[]): number {
  const pts = pathToPolygon(cmds, ARC_LENGTH_STEPS);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

/**
 * The point and local tangent angle at arc-length distance `s` along the
 * path. `reversed` flips which end `s=0` starts from — RTL text anchors to
 * the curve's *end* point by default (see `TextOnPathText`), which reverses
 * only this lookup, never the stored path itself. `s` is clamped to
 * `[0, pathLength]`.
 */
export function pointAtArcLength(
  cmds: SvgCmd[],
  s: number,
  reversed: boolean
): { x: number; y: number; angle: number } {
  const raw = pathToPolygon(cmds, ARC_LENGTH_STEPS);
  const pts = reversed ? [...raw].reverse() : raw;
  if (pts.length < 2) return { x: 0, y: 0, angle: 0 };

  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    cum.push(cum[i - 1] + Math.hypot(x2 - x1, y2 - y1));
  }
  const total = cum[cum.length - 1];
  const clamped = Math.max(0, Math.min(total, s));

  let i = 1;
  while (i < cum.length - 1 && cum[i] < clamped) i++;

  const [x1, y1] = pts[i - 1];
  const [x2, y2] = pts[i];
  const segStart = cum[i - 1];
  const segLen = cum[i] - segStart;
  const t = segLen > 0 ? (clamped - segStart) / segLen : 0;

  return {
    x: x1 + (x2 - x1) * t,
    y: y1 + (y2 - y1) * t,
    angle: Math.atan2(y2 - y1, x2 - x1),
  };
}
