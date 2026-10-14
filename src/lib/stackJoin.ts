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
 *  like the matrix; on an S it costs under 1% of pointer travel. It only
 *  matters where the tangents are nearly parallel and the asymmetric mode
 *  has almost no effect on the midpoint, so it keeps that mode from running
 *  away on a pointer component the curve cannot follow. */
const DRAG_RIDGE = 2e-3;

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
  const d0 = (bb * ra - ab * rb) / det, d1 = (aa * rb - ab * ra) / det;
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

/**
 * The join's two edges. The face vector (a→b) is the pen's cross-section
 * where the stroke was cut, so the edges are the centerline ± half of a
 * vector interpolated from A's to B's: full width across it, thin along it —
 * a broad-edge nib with nothing to measure. `minWidth` is the floor on the
 * thickness perpendicular to the curve, never applied at the two ends so
 * the edges land on the faces exactly. Take it from the faces
 * (`joinFloor`): a floor above the thinner face's own thickness bulges the
 * join in the middle and, at identity, pushes spikes out of the seam.
 */
export function joinEdges(
  A: CutFace, B: CutFace, bow: number, minWidth: number, samples = 24, depth = 0
): { edgeA: Pt[]; edgeB: Pt[] } {
  const cl = joinCenterline(A, B, bow, depth);
  const vA: Pt = [A.b[0] - A.a[0], A.b[1] - A.a[1]];
  const vB: Pt = [B.b[0] - B.a[0], B.b[1] - B.a[1]];
  const edgeA: Pt[] = [], edgeB: Pt[] = [];
  const centers: Pt[] = [];
  let side = 0;
  for (let i = 0; i <= samples; i++) centers.push(bezierAt(cl, i / samples));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const c = centers[i];
    let v: Pt = [vA[0] + (vB[0] - vA[0]) * t, vA[1] + (vB[1] - vA[1]) * t];
    if (i > 0 && i < samples) {
      // The drawn polyline's own direction (neighbouring samples), so the
      // floor holds on what is actually rendered, not on the ideal curve.
      let dx = centers[i + 1][0] - centers[i - 1][0], dy = centers[i + 1][1] - centers[i - 1][1];
      const len = Math.hypot(dx, dy);
      if (len < EPS) { dx = Math.cos(A.tangent); dy = Math.sin(A.tangent); }
      else { dx /= len; dy /= len; }
      const n: Pt = [-dy, dx];
      const along = v[0] * n[0] + v[1] * n[1];
      const tang = v[0] * dx + v[1] * dy;
      // One side for the whole join, from the first sample that has one. When
      // the pen's cross-section passes through the direction of travel the
      // stroke thins to the nib's edge and stays on the same side; it never
      // swaps its two edges (a ribbon twist).
      if (side === 0 && Math.abs(along) > EPS) side = along > 0 ? 1 : -1;
      const normal = (side || 1) * Math.max(Math.abs(along), minWidth);
      v = [normal * n[0] + tang * dx, normal * n[1] + tang * dy];
    }
    edgeA.push([c[0] - v[0] / 2, c[1] - v[1] / 2]);
    edgeB.push([c[0] + v[0] / 2, c[1] + v[1] / 2]);
  }
  return { edgeA, edgeB };
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
  contours: Seg[][], faceN: CutFace, faceF: CutFace, edges: { edgeA: Pt[]; edgeB: Pt[] }
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

  // F's walk must start at the same label N ended on.
  let fWalk = walkWithout(contours[f.contour], f.seg);
  const fWalkStartsAtA = !f.startsAtA;          // bridge b→a means the walk starts at a
  if (fWalkStartsAtA !== nEndsAtA) fWalk = reversed(fWalk);

  const merged: Seg[] = [...nWalk, ...polyline(out), ...fWalk, ...polyline([...back].reverse())];
  const rest = contours.filter((_, i) => i !== n.contour && i !== f.contour);
  return [...rest, merged];
}
