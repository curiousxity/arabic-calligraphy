/**
 * Cubic curves fitted back to the pen's ink. The sweep gives polygons with a
 * point about every unit; the renderers and the SVG export draw curves, which
 * stay smooth at any zoom and are a tenth the size. Each ring is split at its
 * corners (the nib's flat ends), and each run between corners is fitted with
 * Schneider's algorithm ("An Algorithm for Automatically Fitting Digitized
 * Curves", Graphics Gems, 1990) to within `tol` units. Pure.
 */
import type { Polygon, Pt, Ring } from "./penSweep";
import type { SvgCmd } from "./svgPath";

/** A ring point whose outline turns more than this, measured over CORNER_REACH units either side, stays a corner. */
export const CORNER_DEG = 35;
const CORNER_REACH = 2;
/** Newton reparameterisation passes before a run is split. */
const REPARAM = 20;

type Cubic = [Pt, Pt, Pt, Pt];

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

const bez = (c: Cubic, t: number): Pt => {
  const u = 1 - t;
  return [
    u * u * u * c[0][0] + 3 * u * u * t * c[1][0] + 3 * u * t * t * c[2][0] + t * t * t * c[3][0],
    u * u * u * c[0][1] + 3 * u * u * t * c[1][1] + 3 * u * t * t * c[2][1] + t * t * t * c[3][1],
  ];
};
const bezD1 = (c: Cubic, t: number): Pt => {
  const u = 1 - t;
  return add(add(mul(sub(c[1], c[0]), 3 * u * u), mul(sub(c[2], c[1]), 6 * u * t)), mul(sub(c[3], c[2]), 3 * t * t));
};
const bezD2 = (c: Cubic, t: number): Pt => add(mul(add(sub(c[2], mul(c[1], 2)), c[0]), 6 * (1 - t)), mul(add(sub(c[3], mul(c[2], 2)), c[1]), 6 * t));

/** The point at least `reach` units along the ring from i, stepping by `dir`. */
function along(r: Ring, i: number, dir: 1 | -1, reach: number): Pt {
  let d = 0, k = i;
  for (let s = 0; s < r.length - 1 && d < reach; s++) {
    const nk = (k + dir + r.length) % r.length;
    d += len(sub(r[nk], r[k]));
    k = nk;
  }
  return r[k];
}

function corners(r: Ring): number[] {
  const turn = r.map((p, i) => {
    const a = unit(sub(p, along(r, i, -1, CORNER_REACH))), b = unit(sub(along(r, i, 1, CORNER_REACH), p));
    return (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
  });
  // one corner per cluster of neighbouring candidates: the sharpest
  const out: number[] = [];
  for (let i = 0; i < r.length; i++) {
    if (turn[i] <= CORNER_DEG) continue;
    const prev = turn[(i - 1 + r.length) % r.length], next = turn[(i + 1) % r.length];
    if (turn[i] >= prev && turn[i] > next) out.push(i);
  }
  return out;
}

function chordParams(pts: Pt[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generate(pts: Pt[], u: number[], t1: Pt, t2: Pt): Cubic {
  const first = pts[0], last = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  u.forEach((t, i) => {
    const b0 = (1 - t) ** 3, b1 = 3 * t * (1 - t) ** 2, b2 = 3 * t * t * (1 - t), b3 = t ** 3;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  });
  const det = c00 * c11 - c01 * c01;
  let alpha1 = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let alpha2 = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  const segLen = len(sub(last, first)), eps = 1e-6 * segLen;
  // a handle longer than the run itself comes from a near-singular solve, never from the ink: Newton
  // reparameterisation would then crowd every sample onto the curve's ends and pass the error check
  let arc = 0;
  for (let i = 1; i < pts.length; i++) arc += len(sub(pts[i], pts[i - 1]));
  if (!(alpha1 >= eps && alpha2 >= eps && alpha1 <= arc && alpha2 <= arc)) { alpha1 = segLen / 3; alpha2 = segLen / 3; }
  return [first, add(first, mul(t1, alpha1)), add(last, mul(t2, alpha2)), last];
}

function maxError(pts: Pt[], c: Cubic, u: number[]): { err: number; at: number } {
  let err = 0, at = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len(sub(bez(c, u[i]), pts[i]));
    if (d > err) { err = d; at = i; }
  }
  // the other way too: a curve can pass every sample at its own parameter yet loop away between
  // them (handles crossing over), so the curve's own points must also lie near the ink
  for (let k = 1; k < 16; k++) {
    const q = bez(c, k / 16);
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(q, pts[i - 1], pts[i]));
    if (best > err) err = best;
  }
  return { err, at };
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const e = sub(b, a), L2 = dot(e, e) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), e) / L2));
  return len(sub(add(a, mul(e, t)), p));
}

function reparam(pts: Pt[], u: number[], c: Cubic): number[] {
  return u.map((t, i) => {
    const d = sub(bez(c, t), pts[i]), d1 = bezD1(c, t), d2 = bezD2(c, t);
    const den = dot(d1, d1) + dot(d, d2);
    return den === 0 ? t : Math.max(0, Math.min(1, t - dot(d, d1) / den));
  });
}

function fitRun(pts: Pt[], t1: Pt, t2: Pt, tol: number, out: Cubic[]): void {
  if (pts.length === 2) {
    const d = len(sub(pts[1], pts[0])) / 3;
    out.push([pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]);
    return;
  }
  let u = chordParams(pts);
  let c = generate(pts, u, t1, t2);
  let { err, at } = maxError(pts, c, u);
  if (err < tol) { out.push(c); return; }
  if (err < tol * 4) {
    for (let k = 0; k < REPARAM; k++) {
      u = reparam(pts, u, c);
      // samples out of order (or crowded onto one parameter) no longer describe the ink: split instead
      if (u.some((t, i) => i > 0 && t <= u[i - 1])) break;
      c = generate(pts, u, t1, t2);
      ({ err, at } = maxError(pts, c, u));
      if (err < tol) { out.push(c); return; }
    }
  }
  const mid = unit(sub(pts[at - 1], pts[at + 1]));
  fitRun(pts.slice(0, at + 1), t1, mid, tol, out);
  fitRun(pts.slice(at), mul(mid, -1), t2, tol, out);
}

/** Cubic Béziers through a ring within `tol` units (max distance from any
 *  ring point to the fitted curve). Corners turning more than CORNER_DEG
 *  stay corners. Output: M, C... , Z commands. */
export function fitRing(ring: Ring, tol: number): SvgCmd[] {
  if (ring.length < 3) return [];
  const cs = corners(ring);
  const cubics: Cubic[] = [];
  if (cs.length === 0) {
    // one closed run from the leftmost point; the same tangent leaves and returns, so the join is smooth
    const s = ring.reduce((b, p, i) => (p[0] < ring[b][0] ? i : b), 0);
    const pts = [...ring.slice(s), ...ring.slice(0, s), ring[s]];
    const t = unit(sub(along(ring, s, 1, CORNER_REACH), along(ring, s, -1, CORNER_REACH)));
    fitRun(pts, t, mul(t, -1), tol, cubics);
  } else {
    for (let k = 0; k < cs.length; k++) {
      const a = cs[k], b = cs[(k + 1) % cs.length];
      const pts: Pt[] = [];
      for (let i = a; ; i = (i + 1) % ring.length) { pts.push(ring[i]); if (i === b && pts.length > 1) break; }
      const t1 = unit(sub(along(pts, 0, 1, CORNER_REACH), pts[0]));
      const t2 = unit(sub(along(pts, pts.length - 1, -1, CORNER_REACH), pts[pts.length - 1]));
      fitRun(pts, t1, t2, tol, cubics);
    }
  }
  const cmds: SvgCmd[] = [{ type: "M", x: cubics[0][0][0], y: cubics[0][0][1] }];
  for (const c of cubics) cmds.push({ type: "C", x1: c[1][0], y1: c[1][1], x2: c[2][0], y2: c[2][1], x: c[3][0], y: c[3][1] });
  cmds.push({ type: "Z" });
  return cmds;
}

/** Every ring of every polygon, fitted (fitRing). */
export function fitPolygons(polys: Polygon[], tol: number): SvgCmd[] {
  return polys.flatMap((poly) => poly.flatMap((ring) => fitRing(ring, tol)));
}
