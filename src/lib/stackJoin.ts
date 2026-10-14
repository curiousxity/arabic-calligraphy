// The curve a stack block draws between two cut faces, and the splice that
// makes it part of one outline. Pure — no React, Konva or ./harfbuzz.
import type { CutFace } from "../types";
import type { Pt } from "./strokeCuts";
import type { Seg } from "./stackGeometry";

const EPS = 1e-6;
const near = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS;
const mid = (f: CutFace): Pt => [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];

/** Cubic from A's midpoint to B's, leaving along A's outward tangent and
 *  arriving along B's. Handles are chord × (1/3 + bow) so a bend never
 *  breaks the tangent match. */
export function joinCenterline(A: CutFace, B: CutFace, bow: number): [Pt, Pt, Pt, Pt] {
  const m0 = mid(A), m3 = mid(B);
  const chord = Math.hypot(m3[0] - m0[0], m3[1] - m0[1]);
  const h = chord * (1 / 3 + bow);
  return [
    m0,
    [m0[0] + h * Math.cos(A.tangent), m0[1] + h * Math.sin(A.tangent)],
    [m3[0] + h * Math.cos(B.tangent), m3[1] + h * Math.sin(B.tangent)],
    m3,
  ];
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
 * the edges land on the faces exactly.
 */
export function joinEdges(
  A: CutFace, B: CutFace, bow: number, minWidth: number, samples = 24
): { edgeA: Pt[]; edgeB: Pt[] } {
  const cl = joinCenterline(A, B, bow);
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
