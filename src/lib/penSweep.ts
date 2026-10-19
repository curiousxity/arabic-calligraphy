/**
 * The pen: a flat nib swept along a path. The ink is the area the nib's
 * edge covers as it travels and turns. It is computed by stamping: the nib
 * is placed densely along the path (each end moves at most STEP units
 * between placements), each pair of consecutive placements contributes the
 * convex hull of their four end points, and the hulls are unioned. A turning
 * nib has an interior envelope where a two-rail outline folds over itself
 * (every published pen system reports it as the weak point); the hulls of a
 * turning nib converge on the true sweep as the steps shrink, so stamping
 * stays correct there. Pure. See .claude/rules/tarkib.md.
 */
import { union } from "polygon-clipping";

export type Pt = [number, number];
/** Closed, no repeated last point. */
export type Ring = Pt[];
/** Outer ring first, then holes. */
export type Polygon = Ring[];
/** A node on a pen path. `angle`: the nib edge's angle in degrees from the
 *  baseline, counter-clockwise as the reader sees it (the y-down direction
 *  is (cos a, -sin a)). `width`: share of the pen in contact, 0..1 (1 when
 *  absent). `keep`: which end of the nib stays down when width < 1
 *  ("a" = the end at +direction, "b" = the other; centred when absent). */
export type NibNode = { p: Pt; angle: number; width?: number; keep?: "a" | "b" };
/** A pen path in units: a start node and cubic segments. */
export type PenPath = { start: NibNode; segs: { c1: Pt; c2: Pt; to: NibNode }[] };

/** Units either nib end may travel between two placements. */
const STEP = 1;
/** Bisection depth limit per segment (2^16 placements). */
const MAX_DEPTH = 16;
/** Stamps unioned per batch before the batches are merged. */
const BATCH = 64;

const bez = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
};

/** The nib's two ends ("a", "b") at a centre point. */
function nibEnds(c: Pt, angleDeg: number, width: number, keep: "a" | "b" | undefined, pen: number): [Pt, Pt] {
  const a = (angleDeg * Math.PI) / 180, u: Pt = [Math.cos(a), -Math.sin(a)];
  const w = Math.max(0, Math.min(1, width)) * pen, h = pen / 2;
  if (keep === "a") {
    const A: Pt = [c[0] + u[0] * h, c[1] + u[1] * h];
    return [A, [A[0] - u[0] * w, A[1] - u[1] * w]];
  }
  if (keep === "b") {
    const B: Pt = [c[0] - u[0] * h, c[1] - u[1] * h];
    return [[B[0] + u[0] * w, B[1] + u[1] * w], B];
  }
  return [[c[0] + (u[0] * w) / 2, c[1] + (u[1] * w) / 2], [c[0] - (u[0] * w) / 2, c[1] - (u[1] * w) / 2]];
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull, counter-clockwise in y-up terms (monotone chain); null when it has no area. */
function hull(pts: Pt[]): Ring | null {
  const s = [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const h = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (h.length < 3) return null;
  return Math.abs(ringArea(h)) > 1e-9 ? h : null;
}

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** The ink of one pen path: polygons in the path's units. */
export function sweepPath(path: PenPath, pen: number): Polygon[] {
  const stamps: Polygon[][] = [];
  let prev = path.start;
  for (const seg of path.segs) {
    const from = prev, to = seg.to;
    const at = (t: number): [Pt, Pt] => {
      const c = bez(from.p, seg.c1, seg.c2, to.p, t);
      const angle = from.angle + (to.angle - from.angle) * t;
      const width = (from.width ?? 1) + ((to.width ?? 1) - (from.width ?? 1)) * t;
      // the end kept down changes only at a node: a segment keeps its start node's, or its end node's if only that has one
      return nibEnds(c, angle, width, from.keep ?? to.keep, pen);
    };
    const place = (t0: number, e0: [Pt, Pt], t1: number, e1: [Pt, Pt], depth: number): void => {
      const far = Math.max(Math.hypot(e1[0][0] - e0[0][0], e1[0][1] - e0[0][1]), Math.hypot(e1[1][0] - e0[1][0], e1[1][1] - e0[1][1]));
      if (far > STEP && depth < MAX_DEPTH) {
        const tm = (t0 + t1) / 2, em = at(tm);
        place(t0, e0, tm, em, depth + 1);
        place(tm, em, t1, e1, depth + 1);
        return;
      }
      const h = hull([e0[0], e0[1], e1[0], e1[1]]);
      if (h) stamps.push([[h]]);
    };
    // halves first: a segment whose ends coincide (a nib turning in place) still subdivides
    const e0 = at(0), em = at(0.5), e1 = at(1);
    place(0, e0, 0.5, em, 1);
    place(0.5, em, 1, e1, 1);
    prev = to;
  }
  return unionPolygons(stamps);
}

/** Union of many polygon sets, merged in batches then pairwise. */
export function unionPolygons(polys: Polygon[][]): Polygon[] {
  let level = polys.filter((m) => m.length > 0);
  if (level.length === 0) return [];
  const merge = (ms: Polygon[][]): Polygon[] => {
    const [first, ...rest] = ms as unknown as [Pt[][][], ...Pt[][][][]];
    return clean(union(first, ...rest) as unknown as Polygon[]);
  };
  // one set still goes through union once, which resolves its own overlaps
  do {
    const next: Polygon[][] = [];
    for (let i = 0; i < level.length; i += BATCH) next.push(merge(level.slice(i, i + BATCH)));
    level = next.filter((m) => m.length > 0);
  } while (level.length > 1);
  return level[0] ?? [];
}

/** polygon-clipping's rings repeat their first point last; drop it and collinear points. */
function clean(polys: Polygon[]): Polygon[] {
  return polys.map((poly) => poly.map((ring) => {
    const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    return r.filter((p, i) => Math.abs(cross(r[(i - 1 + r.length) % r.length], p, r[(i + 1) % r.length])) > 1e-6);
  }).filter((ring) => ring.length >= 3)).filter((poly) => poly.length > 0);
}

/** Area of polygons, holes subtracted. */
export function polygonArea(polys: Polygon[]): number {
  let a = 0;
  for (const poly of polys) poly.forEach((ring, i) => { a += i === 0 ? Math.abs(ringArea(ring)) : -Math.abs(ringArea(ring)); });
  return a;
}
