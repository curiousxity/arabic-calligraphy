// Detached marks: a letter's dots, the hamza on أ إ ؤ ئ, the kaf stroke —
// any closed contour of ink that sits outside the letter's body. Pure: no
// React, no Konva, and no ./harfbuzz import (its static harfbuzzjs import
// throws under Vitest's Node loader). Design:
// docs/superpowers/specs/2026-10-14-free-marks-and-dots-design.md
import type { SvgCmd } from "./svgPath";
import { pointInPolygon } from "./svgPath";
import { toSegments, fromSegments } from "./stackGeometry";
import { outlineBounds, flattenContours } from "./strokeCuts";

export type Bounds = { x1: number; y1: number; x2: number; y2: number };
export type DetachedContour = { mark: number; cmds: SvgCmd[]; bounds: Bounds };

/** Upper bound on a mark's bounding-box area as a fraction of the body's.
 *  An upper bound, not a band round one nuqta: Ruqaa draws a dot pair as a
 *  dash and Gulzar's dots are nearly two nuqta wide. Tuned by
 *  scripts/measureDetachedMarks.mjs. */
export const MAX_MARK_FRACTION = 0.35;

/** Second admission path, in square em: anything this small is a mark
 *  whatever its body. Needed because a thin alif's box is small and its
 *  hamza is 0.8 of it and 0.055 em² (Amiri), which no body fraction can admit without
 *  also admitting a two-stroke letter's smaller half. Also tuned by the
 *  gate script. */
export const MAX_MARK_EM_AREA = 0.07;

/** One command list per contour, in raw order (the index is the mark key). */
export function splitContours(cmds: SvgCmd[]): SvgCmd[][] {
  return toSegments(cmds).map((segs) => fromSegments([segs]));
}

const area = (b: Bounds) => Math.max(b.x2 - b.x1, 0) * Math.max(b.y2 - b.y1, 0);

/**
 * Rules, in order: (1) the contour's centre lies inside no other contour
 * (a counter fails here; winding is not used because TrueType and CFF
 * disagree); (2) it is not the body, the largest contour passing (1);
 * (3) its area is at most `maxFraction` of the body's, or at most
 * `maxEmArea` square em.
 */
export function findDetachedContours(
  cmds: SvgCmd[],
  unitsPerEm: number,
  maxFraction = MAX_MARK_FRACTION,
  maxEmArea = MAX_MARK_EM_AREA
): DetachedContour[] {
  const parts = splitContours(cmds);
  if (parts.length < 2) return [];
  const polys = parts.map((p) => flattenContours(p)[0] ?? []);
  const bounds = parts.map((p) => outlineBounds(p));
  const outer: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const cx = (bounds[i].x1 + bounds[i].x2) / 2, cy = (bounds[i].y1 + bounds[i].y2) / 2;
    let inside = false;
    for (let j = 0; j < parts.length && !inside; j++) {
      if (j !== i && polys[j].length >= 3 && pointInPolygon(cx, cy, polys[j])) inside = true;
    }
    if (!inside && area(bounds[i]) > 0) outer.push(i);
  }
  if (outer.length < 2) return [];
  const body = outer.reduce((best, i) => (area(bounds[i]) > area(bounds[best]) ? i : best), outer[0]);
  const upm = Math.max(unitsPerEm || 1000, 1);
  const limit = Math.max(maxFraction * area(bounds[body]), maxEmArea * upm * upm);
  return outer
    .filter((i) => i !== body && area(bounds[i]) <= limit)
    .map((i) => ({ mark: i, cmds: parts[i], bounds: bounds[i] }));
}

/** The same outline with contour `i` translated by `offsets.get(i)`. */
export function translateContours(
  cmds: SvgCmd[],
  offsets: ReadonlyMap<number, readonly [number, number]>
): SvgCmd[] {
  if (offsets.size === 0) return cmds;
  const parts = splitContours(cmds);
  return parts.flatMap((part, i) => {
    const o = offsets.get(i);
    if (!o) return part;
    const [dx, dy] = o;
    return part.map((c): SvgCmd => {
      switch (c.type) {
        case "M": case "L": return { ...c, x: c.x + dx, y: c.y + dy };
        case "Q": return { ...c, x: c.x + dx, y: c.y + dy, x1: c.x1 + dx, y1: c.y1 + dy };
        case "C": return { ...c, x: c.x + dx, y: c.y + dy, x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy };
        default: return c;
      }
    });
  });
}
