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

/** A gentle upward bow from (0, height) to (width, height), peaking near y=0 at the midpoint. */
export function arcPathD(width: number, height: number): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return `M 0 ${h} C ${w * 0.25} 0, ${w * 0.75} 0, ${w} ${h}`;
}

/** One full sine-like cycle across `width`, amplitude `height / 2` around the vertical midpoint. */
export function wavePathD(width: number, height: number): string {
  const w = Math.max(1, width);
  const amp = height / 2;
  const midY = height / 2;
  const q = w / 4;
  return [
    `M 0 ${midY}`,
    `C ${q * 0.5} ${midY - amp}, ${q * 1.5} ${midY - amp}, ${q * 2} ${midY}`,
    `C ${q * 2.5} ${midY + amp}, ${q * 3.5} ${midY + amp}, ${w} ${midY}`,
  ].join(" ");
}

/**
 * Three-quarters of a circle (270°), swept clockwise from the top, leaving
 * the bottom quarter open so the path has a clear start/end for text to
 * anchor to instead of being a closed loop.
 */
export function circlePathD(width: number, height: number): string {
  const r = Math.max(1, Math.min(width, height) / 2);
  const cx = width / 2;
  const cy = height / 2;
  const k = 0.5522847498 * r;

  const top = { x: cx, y: cy - r };
  const right = { x: cx + r, y: cy };
  const bottom = { x: cx, y: cy + r };
  const left = { x: cx - r, y: cy };

  return [
    `M ${top.x} ${top.y}`,
    `C ${top.x + k} ${top.y}, ${right.x} ${right.y - k}, ${right.x} ${right.y}`,
    `C ${right.x} ${right.y + k}, ${bottom.x + k} ${bottom.y}, ${bottom.x} ${bottom.y}`,
    `C ${bottom.x - k} ${bottom.y}, ${left.x} ${left.y + k}, ${left.x} ${left.y}`,
  ].join(" ");
}
