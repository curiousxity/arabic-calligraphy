// The curve a stack block draws between two cut faces, and the splice that
// makes it part of one outline. Pure — no React, Konva or ./harfbuzz.
import type { CutFace } from "../types";
import type { Pt } from "./strokeCuts";
import type { Seg } from "./stackGeometry";

const EPS = 1e-6;
const near = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS;
const mid = (f: CutFace): Pt => [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];

/** The floor on a handle's length, as a fraction of the chord: a zero-length
 *  handle would drop the tangent match at that end. */
export const MIN_HANDLE = 0.05;

/** A join's two handle lengths for a chord: `bow` is their asymmetry and
 *  `depth` their common lengthening, each a fraction of chord/3. Both 0 is the
 *  tangent-matched default; each length is floored at `MIN_HANDLE`·chord. */
export function joinHandles(chord: number, bow: number, depth = 0): [number, number] {
  const k = chord / 3, lo = MIN_HANDLE * chord;
  return [Math.max(lo, k * (1 + depth + bow)), Math.max(lo, k * (1 + depth - bow))];
}

/** Cubic from A's midpoint to B's, leaving along A's outward tangent and
 *  arriving along B's, so the tangent match holds at both ends. Its handles
 *  are `joinHandles(chord, bow, depth)`. The midpoint is the chord's centre
 *  plus (3/8)(h0·t̂A + h1·t̂B): for opposed tangents (an S) only `bow` moves
 *  it (by (chord/4)·bow along t̂A); for parallel tangents (a U) only `depth`
 *  does (by (chord/4)·depth along t̂A). */
export function joinCenterline(A: CutFace, B: CutFace, bow: number, depth = 0): [Pt, Pt, Pt, Pt] {
  const m0 = mid(A), m3 = mid(B);
  const chord = Math.hypot(m3[0] - m0[0], m3[1] - m0[1]);
  const [h0, h1] = joinHandles(chord, bow, depth);
  return [
    m0,
    [m0[0] + h0 * Math.cos(A.tangent), m0[1] + h0 * Math.sin(A.tangent)],
    [m3[0] + h1 * Math.cos(B.tangent), m3[1] + h1 * Math.sin(B.tangent)],
    m3,
  ];
}

/** Ridge on the 2×2 normal equations (whose entries are ~0.14). Dimensionless,
 *  like the matrix; on an exact S it costs ~3.4% of pointer travel. Alone it
 *  does not stop a join a few degrees off an exact S or U from running away
 *  (its near-null mode still has gain up to 1/(2√λ)), so `DRAG_GAIN_CAP`
 *  bounds the response as well. */
const DRAG_RIDGE = 1e-2;
/** No handle length changes by more than this × the pointer's travel. The
 *  step is scaled down as a whole, so the two handles keep their ratio. */
const DRAG_GAIN_CAP = 3;

/**
 * The (bow, depth) that puts the curve's midpoint as close as it can get to
 * where the pointer has moved it. The midpoint moves by
 * M·[Δh0, Δh1] with M = (3/8)[t̂A t̂B], so the change in handle lengths is the
 * regularised least-squares solution (MᵀM + λI)⁻¹Mᵀ·Δ. Everything is in one
 * unit (px or font units, so long as `chord` and `delta` agree); the result
 * keeps both handles at least `MIN_HANDLE`·chord. `start` is the join's
 * bend when the drag began and `delta` the pointer's total travel since.
 */
export function solveJoinDrag(
  start: { bow: number; depth?: number }, tA: number, tB: number, chord: number, delta: Pt
): { bow: number; depth: number } {
  if (!(chord > 0)) return { bow: start.bow, depth: start.depth ?? 0 };
  const [s0, s1] = joinHandles(chord, start.bow, start.depth ?? 0);
  const a: Pt = [0.375 * Math.cos(tA), 0.375 * Math.sin(tA)];
  const b: Pt = [0.375 * Math.cos(tB), 0.375 * Math.sin(tB)];
  const aa = a[0] * a[0] + a[1] * a[1] + DRAG_RIDGE, bb = b[0] * b[0] + b[1] * b[1] + DRAG_RIDGE;
  const ab = a[0] * b[0] + a[1] * b[1];
  const ra = a[0] * delta[0] + a[1] * delta[1], rb = b[0] * delta[0] + b[1] * delta[1];
  const det = aa * bb - ab * ab;
  let d0 = (bb * ra - ab * rb) / det, d1 = (aa * rb - ab * ra) / det;
  const cap = DRAG_GAIN_CAP * Math.hypot(delta[0], delta[1]);
  const big = Math.max(Math.abs(d0), Math.abs(d1));
  if (big > cap) { d0 *= cap / big; d1 *= cap / big; }
  const lo = MIN_HANDLE * chord, k = chord / 3;
  const h0 = Math.max(lo, s0 + d0), h1 = Math.max(lo, s1 + d1);
  return { bow: (h0 - h1) / (2 * k), depth: (h0 + h1) / (2 * k) - 1 };
}

function bezierAt([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function bezierTangent([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  return [
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]),
  ];
}

/** The most the curve's direction may turn between two neighbouring samples
 *  before the gap is split. A hairpin (a face pointing away from its partner
 *  makes the curve overshoot and hook back) turns 180° in a sliver of `t`;
 *  at `samples` even steps its apex falls between two samples, and the
 *  offset points computed there sit sideways and cross. */
const MAX_TURN = Math.PI / 12;
/** Halvings of a sample gap before giving up on a turn (a true cusp). */
const MAX_SPLIT = 8;

/** Direction of travel at `t` (unit), or null at a cusp. */
function directionAt(cl: [Pt, Pt, Pt, Pt], t: number): Pt | null {
  const d = bezierTangent(cl, t);
  const len = Math.hypot(d[0], d[1]);
  return len < EPS ? null : [d[0] / len, d[1] / len];
}

const turnBetween = (p: Pt | null, q: Pt | null) =>
  p && q ? Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1]))) : 0;

/** `samples` even steps of t, with every gap the curve turns through more
 *  than `MAX_TURN` halved until it does not. */
function sampleParams(cl: [Pt, Pt, Pt, Pt], samples: number): number[] {
  const out: number[] = [];
  const push = (t0: number, t1: number, d0: Pt | null, depth: number) => {
    const d1 = directionAt(cl, t1);
    if (depth < MAX_SPLIT && turnBetween(d0, d1) > MAX_TURN) {
      const tm = (t0 + t1) / 2;
      const dm = directionAt(cl, tm);
      push(t0, tm, d0, depth + 1);
      push(tm, t1, dm, depth + 1);
    } else out.push(t1);
  };
  out.push(0);
  for (let i = 0; i < samples; i++) push(i / samples, (i + 1) / samples, directionAt(cl, i / samples), 0);
  return out;
}

/**
 * The join's two edges. The face vector (a→b) is the pen's cross-section
 * where the stroke was cut, so the edges are the centerline ± half of a
 * vector interpolated from A's to B's: full width across it, thin along it —
 * a broad-edge nib with nothing to measure. `minWidth` is the floor on the
 * thickness perpendicular to the curve, never applied at the two ends so
 * the edges land on the faces exactly. Take it from the faces
 * (`joinFloor`): a floor above the thinner face's own thickness bulges the
 * join in the middle and, at identity, pushes spikes out of the seam.
 *
 * The curve is sampled at `samples` even steps of t plus wherever it turns
 * sharply (`sampleParams`), the rungs stand on the curve's own tangent, and
 * no two neighbouring rungs cross (`clipRungs`) — the three together are
 * what keep a hairpin from pinching to a point.
 */
export function joinEdges(
  A: CutFace, B: CutFace, bow: number, minWidth: number, samples = 24, depth = 0, profile?: readonly number[]
): { edgeA: Pt[]; edgeB: Pt[] } {
  const cl = joinCenterline(A, B, bow, depth);
  const vA: Pt = [A.b[0] - A.a[0], A.b[1] - A.a[1]];
  const vB: Pt = [B.b[0] - B.a[0], B.b[1] - B.a[1]];
  const edgeA: Pt[] = [], edgeB: Pt[] = [];
  const ts = sampleParams(cl, samples);
  const centers = ts.map((t) => bezierAt(cl, t));
  const last = ts.length - 1;
  // Direction of travel at each sample: the curve's own, or where it has
  // none (a cusp) the drawn polyline's.
  const dirs: Pt[] = ts.map((t, i) => {
    const own = directionAt(cl, t);
    if (own) return own;
    const p = centers[Math.max(0, i - 1)], q = centers[Math.min(last, i + 1)];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    return len < EPS ? [Math.cos(A.tangent), Math.sin(A.tangent)] : [dx / len, dy / len];
  });
  // Half of each rung's component across the direction of travel: where the
  // stroke's edge would be with no nib slant, which is what decides whether
  // the inner edge of a turn runs backwards (`clipRungs`).
  const half: Pt[] = [];
  let side = 0;
  for (let i = 0; i <= last; i++) {
    const t = ts[i];
    const c = centers[i];
    let v: Pt = [vA[0] + (vB[0] - vA[0]) * t, vA[1] + (vB[1] - vA[1]) * t];
    const [dx, dy] = dirs[i];
    const n: Pt = [-dy, dx];
    // A stroke with its own width (a curve freed from a letter): the rung is
    // set outright to profile × the faces' interpolated thickness, square
    // across the travel — the pen model's slant would thin a U to nothing
    // where the two face vectors oppose. Never at the two faces (the seam
    // must land on them exactly); the floor below still applies.
    if (profile && profile.length > 1 && i > 0 && i < last) {
      const u = t * (profile.length - 1), k = Math.min(profile.length - 2, Math.floor(u)), f = u - k;
      const m = profile[k] * (1 - f) + profile[k + 1] * f;
      // Keep the rung's own sense across the travel: the faces' a→b vector
      // may point either way, and a rung flipped against its neighbours at
      // the ends twists the ribbon into a figure-eight.
      const sense = v[0] * n[0] + v[1] * n[1] >= 0 ? 1 : -1;
      const target = sense * m * (faceThickness(A) * (1 - t) + faceThickness(B) * t);
      v = [target * n[0], target * n[1]];
    }
    const along = v[0] * n[0] + v[1] * n[1];
    half.push([(along / 2) * n[0], (along / 2) * n[1]]);
    if (i > 0 && i < last) {
      const tang = v[0] * dx + v[1] * dy;
      // One side for the whole join, from the first sample that has one. When
      // the pen's cross-section passes through the direction of travel the
      // stroke thins to the nib's edge and stays on the same side; it never
      // swaps its two edges (a ribbon twist).
      if (side === 0 && Math.abs(along) > EPS) side = along > 0 ? 1 : -1;
      const normal = (side || 1) * Math.max(Math.abs(along), minWidth);
      half[i] = [(normal / 2) * n[0], (normal / 2) * n[1]];
      v = [normal * n[0] + tang * dx, normal * n[1] + tang * dy];
    }
    edgeA.push([c[0] - v[0] / 2, c[1] - v[1] / 2]);
    edgeB.push([c[0] + v[0] / 2, c[1] + v[1] / 2]);
  }
  clipRungs(edgeA, edgeB, centers, half, dirs);
  return { edgeA: clipFolds(edgeA), edgeB: clipFolds(edgeB) };
}

/** Where segments p1→p2 and q1→q2 properly cross, or null. */
function crossing(p1: Pt, p2: Pt, q1: Pt, q2: Pt): Pt | null {
  const rx = p2[0] - p1[0], ry = p2[1] - p1[1], sx = q2[0] - q1[0], sy = q2[1] - q1[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < EPS) return null;
  const qx = q1[0] - p1[0], qy = q1[1] - p1[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return [p1[0] + t * rx, p1[1] + t * ry];
}

/**
 * Snaps the inner edge to where neighbouring rungs cross. Where the
 * centerline turns tighter than the edge's offset from it (a hairpin: a face
 * pointing away from its partner makes the curve overshoot and hook back),
 * the inner edge runs backwards against the direction of travel, its rung
 * crosses the one before, and the sliver between them sweeps against the
 * ribbon — under nonzero fill it cancels the ink it overlaps and the stroke
 * pinches to a point. Moving the later rung's inner end to the crossing
 * (the earlier rung's, at the far face, which cannot move) makes the sweep
 * one-way, so overlaps only add: ink over ink, the corner a real pen leaves.
 *
 * Backwards is judged on the edge the rung's *across* component alone would
 * draw (`centers ± half`), not on the drawn edge: where the nib lies along
 * the stroke the drawn rungs are long needles that cross one another at a
 * grazing angle on any bend, and their edge points step back by the slant
 * alone. Those slivers draw as nothing; clipping them would notch the band.
 */
function clipRungs(edgeA: Pt[], edgeB: Pt[], centers: Pt[], half: Pt[], dirs: Pt[]): void {
  const last = edgeA.length - 1;
  const backwards = (sign: 1 | -1, i: number) => {
    const d = dirs[i];
    const dx = centers[i + 1][0] + sign * half[i + 1][0] - centers[i][0] - sign * half[i][0];
    const dy = centers[i + 1][1] + sign * half[i + 1][1] - centers[i][1] - sign * half[i][1];
    return dx * d[0] + dy * d[1] < 0;
  };
  for (let i = 0; i < last; i++) {
    const x = crossing(edgeA[i], edgeB[i], edgeA[i + 1], edgeB[i + 1]);
    if (!x) continue;
    const inner = backwards(-1, i) ? edgeA : backwards(1, i) ? edgeB : null;
    if (!inner) continue;
    inner[i + 1 === last ? i : i + 1] = x;
  }
}

/**
 * An edge with its folds cut out: each loop the polyline makes by crossing
 * itself is replaced by the crossing point. Where the nib lies along the
 * stroke, a rung's slant pushes its two end points far apart along the
 * curve, and on a bend the end points of neighbouring rungs step back past
 * one another — a zigzag whose loops wind against the ribbon and notch the
 * edge. The two end points are never inside a loop, so they stay put.
 */
export function clipFolds(pts: Pt[]): Pt[] {
  // The loop's points all become the crossing, so the edge keeps one point
  // per rung; `spliceJoin`'s polyline drops the zero-length segments.
  const out = [...pts];
  for (let found = true; found; ) {
    found = false;
    for (let i = 0; i + 1 < out.length && !found; i++) {
      for (let j = i + 2; j + 1 < out.length; j++) {
        const x = crossing(out[i], out[i + 1], out[j], out[j + 1]);
        if (!x) continue;
        for (let k = i + 1; k <= j; k++) out[k] = x;
        found = true;
        break;
      }
    }
  }
  return out;
}

/** A face's thickness across its own stroke: |(b − a) × t̂|. */
export function faceThickness(f: CutFace): number {
  return Math.abs((f.b[0] - f.a[0]) * Math.sin(f.tangent) - (f.b[1] - f.a[1]) * Math.cos(f.tangent));
}

/** The join's floor: `minFraction` of the thinner face's own thickness, so
 *  it can never exceed what either end of the stroke actually is. */
export function joinFloor(A: CutFace, B: CutFace, minFraction: number): number {
  return minFraction * Math.min(faceThickness(A), faceThickness(B));
}

type Found = { contour: number; seg: number; startsAtA: boolean };

/** The straight bridge edge a split left between a face's two points. */
function findBridge(contours: Seg[][], f: CutFace, skip = -1): Found | null {
  for (let ci = 0; ci < contours.length; ci++) {
    if (ci === skip) continue;
    const segs = contours[ci];
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      if (s.type !== "L") continue;
      if (near(s.p[0], f.a) && near(s.p[1], f.b)) return { contour: ci, seg: si, startsAtA: true };
      if (near(s.p[0], f.b) && near(s.p[1], f.a)) return { contour: ci, seg: si, startsAtA: false };
    }
  }
  return null;
}

/** The contour's segments walked from just after the bridge round to just
 *  before it: a path from the bridge's end point to its start point. */
function walkWithout(segs: Seg[], bridge: number): Seg[] {
  return [...segs.slice(bridge + 1), ...segs.slice(0, bridge)];
}

function reversed(segs: Seg[]): Seg[] {
  return segs.map((s) => ({ ...s, p: [...s.p].reverse() })).reverse();
}

const polyline = (pts: Pt[]): Seg[] => {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) if (!near(pts[i], pts[i + 1])) out.push({ type: "L", p: [pts[i], pts[i + 1]] });
  return out;
};

/**
 * Replace the two contours carrying `faceN`'s and `faceF`'s bridge edges
 * with one contour: N without its bridge, the edge from N's end point to F's
 * matching point, F without its bridge, and the other edge back. This is
 * what makes a join seam-free under outlines, shadows and SVG export.
 */
export function spliceJoin(
  contours: Seg[][], faceN: CutFace, faceF: CutFace, edges: { edgeA: Pt[]; edgeB: Pt[]; curveA?: [Pt, Pt, Pt, Pt]; curveB?: [Pt, Pt, Pt, Pt] }
): Seg[][] | null {
  const n = findBridge(contours, faceN);
  // Faces that coincide (a fresh split) share points, so F must look elsewhere.
  const f = n && findBridge(contours, faceF, n.contour);
  if (!n || !f) return null;

  // N's walk runs from its bridge's end to its bridge's start.
  const nWalk = walkWithout(contours[n.contour], n.seg);
  const nEndsAtA = n.startsAtA;                 // bridge a→b means the walk ends at a
  const out = nEndsAtA ? edges.edgeA : edges.edgeB;   // leave N at the point it ended on
  const back = nEndsAtA ? edges.edgeB : edges.edgeA;
  // an edge that is one cubic (seamEdges) goes in as that curve, not its samples
  const outCurve = nEndsAtA ? edges.curveA : edges.curveB, backCurve = nEndsAtA ? edges.curveB : edges.curveA;
  const outSegs: Seg[] = outCurve ? [{ type: "C", p: outCurve }] : polyline(out);
  const backSegs: Seg[] = backCurve ? [{ type: "C", p: [...backCurve].reverse() }] : polyline([...back].reverse());

  // F's walk must start at the same label N ended on.
  let fWalk = walkWithout(contours[f.contour], f.seg);
  const fWalkStartsAtA = !f.startsAtA;          // bridge b→a means the walk starts at a
  if (fWalkStartsAtA !== nEndsAtA) fWalk = reversed(fWalk);

  const merged: Seg[] = [...nWalk, ...outSegs, ...fWalk, ...backSegs];
  const rest = contours.filter((_, i) => i !== n.contour && i !== f.contour);
  return [...rest, merged];
}

/** A seam edge pair narrower or wider than this share of the faces'
 *  interpolated thickness falls back to the centre-line bridge. */
const SEAM_WAIST = 0.85;
const SEAM_BULGE = 1.3;
/** Units of outline beside a cut its direction is fitted over. */
const TANGENT_REACH = 4;

/** A segment's points, its curve sampled finely. */
function segPoints(s: Seg): Pt[] {
  if (s.type === "L") return s.p;
  const out: Pt[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32, u = 1 - t;
    out.push(s.type === "Q"
      ? [u * u * s.p[0][0] + 2 * u * t * s.p[1][0] + t * t * s.p[2][0], u * u * s.p[0][1] + 2 * u * t * s.p[1][1] + t * t * s.p[2][1]]
      : bezierAt(s.p as [Pt, Pt, Pt, Pt], t));
  }
  return out;
}

/** The direction the outline leaves `from` along `pts` (points running away
 *  from it): a curve p(s) = from + v·s + a·s²/2 fitted by least squares to
 *  the first TANGENT_REACH units, its v. A chord leans into a curving edge
 *  (3 to 20 degrees off on a lam's foot), and the first segment alone
 *  follows whatever the designer's outline does in its first unit (a ya's
 *  end has a step two units wide that sent the seam off 45 degrees). */
function leaving(from: Pt, pts: Pt[]): Pt {
  let s = 0, prev = from, s2 = 0, s3 = 0, s4 = 0;
  const bx = [0, 0], by = [0, 0];
  for (const p of pts) {
    s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
    if (s < 1e-9) continue;
    if (s > TANGENT_REACH) break;
    const dx = p[0] - from[0], dy = p[1] - from[1];
    s2 += s * s; s3 += (s * s * s) / 2; s4 += (s * s * s * s) / 4;
    bx[0] += s * dx; bx[1] += (s * s * dx) / 2; by[0] += s * dy; by[1] += (s * s * dy) / 2;
  }
  const det = s2 * s4 - s3 * s3;
  const v: Pt = Math.abs(det) > 1e-12
    ? [(bx[0] * s4 - bx[1] * s3) / det, (by[0] * s4 - by[1] * s3) / det]
    : [prev[0] - from[0], prev[1] - from[1]];
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/**
 * Where the outline runs as it reaches each of a face's two points: unit
 * vectors pointing out of the letter (`leaving`, reversed), from
 * `contours`, which must still carry the face's straight bridge edge. Null
 * when the face is not found.
 */
export function outlineTangents(contours: Seg[][], f: CutFace): { a: Pt; b: Pt } | null {
  const found = findBridge(contours, f);
  if (!found) return null;
  const segs = contours[found.contour], n = segs.length;
  // the bridge runs p0 -> p1; the outline arrives at p0 and leaves from p1
  const p0 = segs[found.seg].p[0], p1 = segs[found.seg].p[1];
  const before: Pt[] = [], after: Pt[] = [];
  for (let k = 1; k < n && before.length < 400; k++) before.push(...[...segPoints(segs[(found.seg - k + n) % n])].reverse());
  for (let k = 1; k < n && after.length < 400; k++) after.push(...segPoints(segs[(found.seg + k) % n]));
  const back = (v: Pt): Pt => [-v[0], -v[1]];
  const t0 = back(leaving(p0, before)), t1 = back(leaving(p1, after));
  return found.startsAtA ? { a: t0, b: t1 } : { a: t1, b: t0 };
}

/**
 * A join's two edges drawn each as its own cubic, leaving A's outline at
 * A.a (and A.b) in the direction that outline runs there (`tA`, out of A)
 * and arriving on B's along B's (`tB`, out of B): no corner at any of the
 * four seams, where an edge offset from one centre line meets a tapering or
 * curving letter at an angle (the tarkib seams, 3 to 35 degrees). Handles
 * are each edge's chord/3 scaled by `bow` and `depth` as `joinHandles`.
 * Null where it would not read as one stroke — a tangent pointing back into
 * its letter, the two edges crossing, or the stroke pinching below SEAM_WAIST
 * or swelling past SEAM_BULGE of the faces' interpolated thickness — and the
 * caller draws the centre-line bridge (`joinEdges`) instead.
 */
export function seamEdges(
  A: CutFace, B: CutFace, tA: { a: Pt; b: Pt }, tB: { a: Pt; b: Pt }, bow = 0, depth = 0, samples = 24
): { edgeA: Pt[]; edgeB: Pt[]; curveA: [Pt, Pt, Pt, Pt]; curveB: [Pt, Pt, Pt, Pt] } | null {
  const r = seamReport(A, B, tA, tB, bow, depth, samples);
  return r.ok ? { edgeA: r.edgeA, edgeB: r.edgeB, curveA: r.curveA, curveB: r.curveB } : null;
}

/** seamEdges with its verdict: the two edges, the narrowest and widest the
 *  stroke runs between them (shares of the faces' interpolated thickness),
 *  and why they would not do (`ok` false): "tangent", "cross", or "width". */
export function seamReport(
  A: CutFace, B: CutFace, tA: { a: Pt; b: Pt }, tB: { a: Pt; b: Pt }, bow = 0, depth = 0, samples = 24
): { edgeA: Pt[]; edgeB: Pt[]; curveA: [Pt, Pt, Pt, Pt]; curveB: [Pt, Pt, Pt, Pt]; ok: boolean; why?: "tangent" | "cross" | "width"; narrowest: number; widest: number } {
  const outA: Pt = [Math.cos(A.tangent), Math.sin(A.tangent)], outB: Pt = [Math.cos(B.tangent), Math.sin(B.tangent)];
  const dot = (u: Pt, v: Pt) => u[0] * v[0] + u[1] * v[1];
  const bad = [tA.a, tA.b].some((t) => dot(t, outA) < 0.3) || [tB.a, tB.b].some((t) => dot(t, outB) < 0.3);
  const curve = (p: Pt, tp: Pt, q: Pt, tq: Pt): [Pt, Pt, Pt, Pt] => {
    const [h0, h1] = joinHandles(Math.hypot(q[0] - p[0], q[1] - p[1]), bow, depth);
    return [p, [p[0] + tp[0] * h0, p[1] + tp[1] * h0], [q[0] + tq[0] * h1, q[1] + tq[1] * h1], q];
  };
  const curveA = curve(A.a, tA.a, B.a, tB.a), curveB = curve(A.b, tA.b, B.b, tB.b);
  const sample = (cl: [Pt, Pt, Pt, Pt]) => Array.from({ length: samples + 1 }, (_, i) => bezierAt(cl, i / samples));
  const edgeA = sample(curveA), edgeB = sample(curveB);
  // the two edges must not cross
  const cross = (p1: Pt, p2: Pt, q1: Pt, q2: Pt) => {
    const s = (o: Pt, p: Pt, q: Pt) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    return s(p1, p2, q1) * s(p1, p2, q2) < 0 && s(q1, q2, p1) * s(q1, q2, p2) < 0;
  };
  let crossed = false;
  for (let i = 0; i < samples && !crossed; i++) for (let k = 0; k < samples; k++) if (cross(edgeA[i], edgeA[i + 1], edgeB[k], edgeB[k + 1])) { crossed = true; break; }
  // the width across: each point of one edge to the nearest point of the other
  const wA = faceThickness(A), wB = faceThickness(B);
  let narrowest = Infinity, widest = 0;
  for (let i = 1; i < samples; i++) {
    const t = i / samples, w = wA * (1 - t) + wB * t;
    const d = Math.min(...edgeB.map((q) => Math.hypot(q[0] - edgeA[i][0], q[1] - edgeA[i][1]))) / w;
    narrowest = Math.min(narrowest, d); widest = Math.max(widest, d);
  }
  const why = bad ? "tangent" : crossed ? "cross" : narrowest < SEAM_WAIST || widest > SEAM_BULGE ? "width" : undefined;
  return { edgeA, edgeB, curveA, curveB, ok: !why, ...(why ? { why } : {}), narrowest, widest };
}

/** Units of ink outline ahead of a trim searched for a landing (two pens). */
const LANDING_REACH = 96;
/** Units between the landing points tried along the outline. */
const LANDING_STEP = 3;
/** Units: a landing's outer edge bends no tighter than this where any
 *  landing can. The edge is an S (the stroke's edge runs a few units above
 *  the ink's, nearly parallel), and a cubic S bends most at its two ends,
 *  so this is the bend at the seams: read two units a step, as the tests
 *  read an outline, radius 30 turns 3.8 degrees a step, under the 4-degree
 *  corner line. A shorter landing (BRIDGE_RADIUS 10, chord 17 on the ya into
 *  the meem) landed as a visible bump. */
export const LANDING_RADIUS = 30;

export type Landing = {
  /** The edge from the trim's clear corner onto the ink's outline, one cubic. */
  outer: [Pt, Pt, Pt, Pt];
  /** The edge from the trim's buried corner into the ink, one cubic. */
  inner: [Pt, Pt, Pt, Pt];
  /** Where the outer edge lands, on the outline. */
  q: Pt;
  /** Where the inner edge ends, inside the ink under `q`. */
  q2: Pt;
  /** The outer edge's tightest bend, units. */
  radius: number;
  /** Whether the clear corner is the face's `a`. */
  outerIsA: boolean;
};

/** Nonzero winding: is `p` inked by the flattened contours? */
function inked(polys: readonly Pt[][], p: Pt): boolean {
  let w = 0;
  for (const poly of polys) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (a[1] <= p[1]) { if (b[1] > p[1] && cr > 0) w++; }
    else if (b[1] <= p[1] && cr < 0) w--;
  }
  return w !== 0;
}

/** The tightest bend, units, along a sampled edge: at each point, the mean
 *  of the two steps over the turn between them. */
export function tightestRadius(e: readonly Pt[]): number {
  let r = Infinity;
  for (let i = 1; i + 1 < e.length; i++) {
    const u: Pt = [e[i][0] - e[i - 1][0], e[i][1] - e[i - 1][1]], v: Pt = [e[i + 1][0] - e[i][0], e[i + 1][1] - e[i][1]];
    const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    if (lu < 1e-6 || lv < 1e-6) continue;
    const turn = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / lu / lv)));
    if (turn > 1e-6) r = Math.min(r, (lu + lv) / 2 / turn);
  }
  return r;
}

/**
 * Where a trimmed stroke meets ink that cannot be trimmed (a middle meem's
 * head: its window would go), one corner of the trim stands clear of the
 * ink and the other is buried in it. The join is a landing, the way a pen
 * runs into a loop it then draws: the clear corner's edge continues the
 * stroke's outline (`tA`, out of the piece, as outlineTangents gives it) and
 * arrives running along the ink's outline at `q`, the nearest point ahead
 * where one cubic between them bends no tighter than `minRadius` and stays
 * clear of the ink until it lands (failing that, the gentlest that stays
 * clear); the buried corner's edge dives into the ink under `q`, where the
 * ink covers it. `ink` is the contours landed on, the stroke's own excluded.
 * Null where the trim is wholly clear or wholly buried, where the ink ahead
 * has no smooth stretch to land on, or where the inner edge cannot be kept
 * inside the ink (a nick would show).
 */
export function landingEdges(A: CutFace, tA: { a: Pt; b: Pt }, ink: readonly Seg[][], minRadius: number): Landing | null {
  const polys = ink.map((c) => c.flatMap(segPoints).filter((p, i, all) => i === 0 || !near(p, all[i - 1])));
  const inA = inked(polys, A.a), inB = inked(polys, A.b);
  if (inA === inB) return null;
  const outerIsA = !inA;
  const P = outerIsA ? A.a : A.b, tP = outerIsA ? tA.a : tA.b;
  const P2 = outerIsA ? A.b : A.a, tP2 = outerIsA ? tA.b : tA.a;
  const dot = (u: Pt, v: Pt) => u[0] * v[0] + u[1] * v[1];
  const unit = (v: Pt): Pt => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  // one cubic from p along tp to q arriving along tq, handles a third of the chord
  const cubic = (p: Pt, tp: Pt, q: Pt, tq: Pt): [Pt, Pt, Pt, Pt] => {
    const h = Math.hypot(q[0] - p[0], q[1] - p[1]) / 3;
    return [p, [p[0] + tp[0] * h, p[1] + tp[1] * h], [q[0] - tq[0] * h, q[1] - tq[1] * h], q];
  };
  const sample = (c: [Pt, Pt, Pt, Pt]) => Array.from({ length: 25 }, (_, i) => bezierAt(c, i / 24));
  let best: { q: Pt; t: Pt; outer: [Pt, Pt, Pt, Pt]; radius: number; chord: number } | null = null;
  for (const poly of polys) {
    const n = poly.length;
    let since = Infinity;
    for (let i = 0; i < n; i++) {
      const q = poly[i];
      since += Math.hypot(q[0] - poly[(i - 1 + n) % n][0], q[1] - poly[(i - 1 + n) % n][1]);
      if (since < LANDING_STEP) continue;
      since = 0;
      const chord = Math.hypot(q[0] - P[0], q[1] - P[1]);
      if (chord < 2 || chord > LANDING_REACH) continue;
      // ahead of the corner
      if (dot([q[0] - P[0], q[1] - P[1]], tP) < 0.3 * chord) continue;
      // the outline's direction at q, fitted both ways: a corner of the ink is no landing
      const ahead: Pt[] = [], behind: Pt[] = [];
      for (let k = 1; k < n && ahead.length < 400; k++) ahead.push(poly[(i + k) % n]);
      for (let k = 1; k < n && behind.length < 400; k++) behind.push(poly[(i - k + n) % n]);
      const f = leaving(q, ahead), b = leaving(q, behind);
      if (dot(f, b) > -0.9) continue;
      let t = unit([f[0] - b[0], f[1] - b[1]]);
      if (dot(t, tP) < 0) t = [-t[0], -t[1]];
      if (dot(t, tP) < 0.5) continue;
      const outer = cubic(P, tP, q, t);
      const pts = sample(outer);
      // clear of the ink until it lands
      if (pts.slice(1, -2).some((p) => inked(polys, p))) continue;
      const radius = tightestRadius(pts);
      const ok = radius >= minRadius;
      if (!best || (ok && (best.radius < minRadius || chord < best.chord)) || (!ok && best.radius < minRadius && radius > best.radius))
        best = { q, t, outer, radius, chord };
    }
  }
  if (!best) return null;
  // the inner edge: into the ink under the landing, by up to the stroke's thickness
  const perp: Pt = [-best.t[1], best.t[0]];
  const nrm: Pt = inked(polys, [best.q[0] + perp[0] * 2, best.q[1] + perp[1] * 2]) ? perp : [-perp[0], -perp[1]];
  const w = faceThickness(A);
  let depth = 0;
  while (depth + 1 <= w && inked(polys, [best.q[0] + nrm[0] * (depth + 1), best.q[1] + nrm[1] * (depth + 1)])) depth++;
  for (let d = Math.max(1, depth - 1); ; d = Math.floor(d / 2)) {
    const q2: Pt = [best.q[0] + nrm[0] * d, best.q[1] + nrm[1] * d];
    const inner = cubic(P2, tP2, q2, best.t);
    if (sample(inner).slice(1).every((p) => inked(polys, p))) return { outer: best.outer, inner, q: best.q, q2, radius: best.radius, outerIsA };
    if (d <= 1) return null;
  }
}

/**
 * The contour carrying face `A`'s bridge edge, extended by its landing on
 * the other contours (landingEdges): the bridge edge replaced by the outer
 * cubic, a step across inside the ink, and the inner cubic back. The ink's
 * own contours are untouched; the overlap draws as one under nonzero fill.
 * Null where nothing lands.
 */
export function landJoin(contours: Seg[][], A: CutFace, tA: { a: Pt; b: Pt }, minRadius: number): Seg[][] | null {
  const n = findBridge(contours, A);
  if (!n) return null;
  const rest = contours.filter((_, i) => i !== n.contour);
  const L = landingEdges(A, tA, rest, minRadius);
  if (!L) return null;
  // the walk ends at the point the bridge edge started from (spliceJoin)
  const walk = walkWithout(contours[n.contour], n.seg);
  const endsAtOuter = n.startsAtA === L.outerIsA;
  const tail: Seg[] = endsAtOuter
    ? [{ type: "C", p: L.outer }, { type: "L", p: [L.q, L.q2] }, { type: "C", p: [...L.inner].reverse() }]
    : [{ type: "C", p: L.inner }, { type: "L", p: [L.q2, L.q] }, { type: "C", p: [...L.outer].reverse() }];
  return [...rest, [...walk, ...tail]];
}
