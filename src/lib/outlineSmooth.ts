/**
 * The ink's outline smoothed the way the studio draws its own. A stroke is
 * fitted node by node, about a tenth of a nuqta apart, and each node's small
 * fitting error turns the swept edge a few degrees: ripples the studio's
 * single curves do not have (the user, 2026-10-22). Each ring is split at its
 * real corners (the nib's cuts, sharp joins), which stay exactly where they
 * are; every run between two corners is resampled evenly and smoothed by
 * penalised least squares on its second differences, ends pinned, at the
 * strongest setting that moves no point further than `tol`. Tried on the
 * ledger's shapes (docs/calligraphy/stroke-ledger.md, "Smoothing test"):
 * 0.015 nuqta brings the edges to the studio's smoothness. Pure.
 */
import type { Polygon, Pt, Ring } from "./penSweep";

/** Units. A corner turns more than `cornerDeg` over `cornerArm` either side;
 *  samples within `cornerPad` of one keep their place. */
export type SmoothOpts = { step: number; tol: number; cornerDeg: number; cornerArm: number; cornerPad: number };

/** The smoothing strengths tried, weakest first (per sample: a strength k
 *  irons out ripples of roughly k^(1/4) samples). */
const LADDER = Array.from({ length: 15 }, (_, e) => 10 ** ((e - 2) / 2));

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The ring's point at least `reach` along it from i, stepping by `dir`. */
function along(r: Ring, i: number, dir: 1 | -1, reach: number): Pt {
  let d = 0, k = i;
  for (let s = 0; s < r.length - 1 && d < reach; s++) {
    const nk = (k + dir + r.length) % r.length;
    d += dist(r[k], r[nk]);
    k = nk;
  }
  return r[k];
}

/** Indices of the ring's corners: one per cluster of sharp turns, the sharpest (as penFit's corners). */
function corners(r: Ring, o: SmoothOpts): number[] {
  const turn = r.map((p, i) => {
    const a = along(r, i, -1, o.cornerArm), b = along(r, i, 1, o.cornerArm);
    const u: Pt = [p[0] - a[0], p[1] - a[1]], v: Pt = [b[0] - p[0], b[1] - p[1]];
    return (Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1])) * 180) / Math.PI;
  });
  const out: number[] = [];
  for (let i = 0; i < r.length; i++) {
    if (turn[i] <= o.cornerDeg) continue;
    const ip = (i - 1 + r.length) % r.length, inx = (i + 1) % r.length;
    const prev = dist(r[ip], r[i]) <= o.cornerArm ? turn[ip] : 0, next = dist(r[inx], r[i]) <= o.cornerArm ? turn[inx] : 0;
    if (turn[i] >= prev && turn[i] > next) out.push(i);
  }
  return out;
}

/** An open polyline resampled evenly, its first and last points kept. */
function resample(pts: Pt[], step: number): Pt[] {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
  const L = s[s.length - 1], n = Math.max(1, Math.ceil(L / step));
  const out: Pt[] = [pts[0]];
  for (let k = 1, j = 0; k < n; k++) {
    const t = (k * L) / n;
    while (s[j + 1] < t) j++;
    const f = (t - s[j]) / (s[j + 1] - s[j] || 1);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** min sum |q - x|^2 + lam sum |D2 q|^2 with q = x outside [a, b]: one coordinate, by a banded Cholesky solve
 *  (the matrix is pentadiagonal and positive definite). */
function solve(x: number[], a: number, b: number, lam: number): number[] {
  const n = x.length;
  // the bands of I + lam D2'D2 over the whole run
  const d0 = new Array<number>(n).fill(1), d1 = new Array<number>(n).fill(0), d2 = new Array<number>(n).fill(0);
  for (let i = 0; i + 2 < n; i++) {
    const c = [1, -2, 1];
    for (let p = 0; p < 3; p++) {
      d0[i + p] += lam * c[p] * c[p];
      if (p < 2) d1[i + p] += lam * c[p] * c[p + 1];
    }
    d2[i] += lam * c[0] * c[2];
  }
  const m = b - a + 1;
  // the right-hand side, less what the pinned samples on either side contribute
  const rhs = x.slice(a, b + 1);
  if (a >= 1) { rhs[0] -= d1[a - 1] * x[a - 1]; if (m > 1) rhs[1] -= d2[a - 1] * x[a - 1]; }
  if (a >= 2) rhs[0] -= d2[a - 2] * x[a - 2];
  if (b + 1 < n) { rhs[m - 1] -= d1[b] * x[b + 1]; if (m > 1) rhs[m - 2] -= d2[b - 1] * x[b + 1]; }
  if (b + 2 < n) rhs[m - 1] -= d2[b] * x[b + 2];
  // L L' with L lower, bandwidth 2: l0 the diagonal, l1 and l2 one and two below it
  const l0 = new Array<number>(m), l1 = new Array<number>(m).fill(0), l2 = new Array<number>(m).fill(0);
  for (let i = 0; i < m; i++) {
    if (i >= 2) l2[i] = d2[a + i - 2] / l0[i - 2];
    if (i >= 1) l1[i] = (d1[a + i - 1] - l2[i] * l1[i - 1]) / l0[i - 1];
    l0[i] = Math.sqrt(d0[a + i] - l1[i] * l1[i] - l2[i] * l2[i]);
  }
  const y = new Array<number>(m);
  for (let i = 0; i < m; i++) y[i] = (rhs[i] - (i >= 1 ? l1[i] * y[i - 1] : 0) - (i >= 2 ? l2[i] * y[i - 2] : 0)) / l0[i];
  const q = new Array<number>(m);
  for (let i = m - 1; i >= 0; i--) q[i] = (y[i] - (i + 1 < m ? l1[i + 1] * q[i + 1] : 0) - (i + 2 < m ? l2[i + 2] * q[i + 2] : 0)) / l0[i];
  const out = x.slice();
  for (let i = 0; i < m; i++) out[a + i] = q[i];
  return out;
}

/** Samples [a, b] of an evenly spaced run smoothed at the strongest setting that keeps every one within tol. */
function smoothRun(pts: Pt[], a: number, b: number, tol: number): Pt[] {
  if (b - a < 2) return pts;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  let best = pts;
  for (const lam of LADDER) {
    const sx = solve(xs, a, b, lam), sy = solve(ys, a, b, lam);
    const cand = sx.map((x, i) => [x, sy[i]] as Pt);
    if (cand.some((p, i) => dist(p, pts[i]) > tol)) break;
    best = cand;
  }
  return best;
}

/** One ring smoothed between its corners (see the file's note). */
export function smoothRing(ring: Ring, o: SmoothOpts): Ring {
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) perimeter += dist(ring[i], ring[(i + 1) % ring.length]);
  if (ring.length < 4 || perimeter < 8 * o.step) return ring;
  const pad = Math.round(o.cornerPad / o.step);
  const cs = corners(ring, o);
  if (cs.length === 0) {
    // no corner: smooth the whole loop, read from a copy run on past its start either way so it closes smoothly
    const s = resample([...ring, ring[0]], o.step).slice(0, -1), n = s.length, w = Math.min(n, 4 * pad + 50);
    const ext = [...s.slice(n - w), ...s, ...s.slice(0, w)];
    return smoothRun(ext, 1, ext.length - 2, o.tol).slice(w, w + n);
  }
  const out: Pt[] = [];
  for (let k = 0; k < cs.length; k++) {
    const a = cs[k], b = cs[(k + 1) % cs.length];
    const pts: Pt[] = [];
    for (let i = a; ; i = (i + 1) % ring.length) { pts.push(ring[i]); if (i === b && pts.length > 1) break; }
    const run = resample(pts, o.step);
    // the samples near either corner keep their place, so each corner is met as the swept ink meets it
    out.push(...smoothRun(run, pad + 1, run.length - 2 - pad, o.tol).slice(0, -1));
  }
  return out;
}

/** Every ring of every polygon, smoothed (smoothRing). */
export function smoothPolygons(polys: Polygon[], o: SmoothOpts): Polygon[] {
  return polys.map((poly) => poly.map((ring) => smoothRing(ring, o)));
}
